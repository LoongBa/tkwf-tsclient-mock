import { describe, it, expect, beforeEach } from "vitest";
import type { Transport } from "@tkwf/tsclient";
import {
  MemoryRecordingStore,
  configureRecordingStore,
  createRecordingTransport,
  normalizeTimestamps,
  normalizeUuids,
  MockRecordingError,
} from "./record-replay";
import type { RecordedEntry } from "./record-replay";

/** 构造一个最小可用的 Transport 桩（模拟真实后端行为） */
function makeFakeTransport(handler: (field: string, variables?: Record<string, unknown>) => unknown): Transport {
  return {
    async execute<T>(op: { field: string; type: "query" | "mutation"; variables?: Record<string, unknown> }): Promise<T> {
      return handler(op.field, op.variables) as T;
    },
    async executeRawGraphQL<T>(query: string): Promise<T> {
      const field = query.match(/\{(\w+)/)?.[1] ?? "unknown";
      return handler(field) as T;
    },
  };
}

function makeEntry(field: string, overrides: Partial<RecordedEntry> = {}): RecordedEntry {
  return {
    field,
    type: "query",
    durationMs: 5,
    timestamp: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

/** 预置一条录制（直接写入 store 的 archive） */
function seedRecording(store: MemoryRecordingStore, name: string, entries: RecordedEntry[]): void {
  store.start(name);
  for (const entry of entries) store.record(entry);
  store.stop();
}

describe("MemoryRecordingStore — 内存录制存储", () => {
  let store: MemoryRecordingStore;

  beforeEach(() => {
    store = new MemoryRecordingStore();
  });

  it("生命周期：start → record → stop 后返回完整录制", () => {
    store.start("session", { scenario: "error" });
    store.record(makeEntry("paymentLog", { result: { id: 1 } }));
    const recording = store.stop();

    expect(recording?.name).toBe("session");
    expect(recording?.scenario).toBe("error");
    expect(recording?.entries).toHaveLength(1);
    expect(recording?.version).toBe("1.3.0");
  });

  it("录制会话名含 scenario 元数据", () => {
    store.start("test-session", { scenario: "paymentLogs-error" });
    store.record(makeEntry("paymentLog", { result: {} }));
    const recording = store.stop();

    expect(recording?.name).toBe("test-session");
    expect(recording?.scenario).toBe("paymentLogs-error");
  });

  it("生命周期约束：record 在 start 之前调用抛错", () => {
    expect(() => store.record(makeEntry("paymentLog"))).toThrow(/no active session/);
  });

  it("生命周期约束：stop 在 start 之前调用抛错", () => {
    expect(() => store.stop()).toThrow(/no active session/);
  });

  it("生命周期约束：未 stop 时再次 start 抛错", () => {
    store.start("a");
    expect(() => store.start("b")).toThrow(/already active/);
  });

  it("load/list：stop 后可加载与列出录制", () => {
    seedRecording(store, "rec1", [makeEntry("paymentLog", { result: 1 })]);
    seedRecording(store, "rec2", [makeEntry("users", { result: 2 })]);

    expect(store.load("rec1")?.entries[0]?.result).toBe(1);
    expect(store.list()).toEqual(["rec1", "rec2"]);
  });
});

describe("createRecordingTransport — record 模式", () => {
  it("record：拦截 execute 并记录条目，返回值透传", async () => {
    const store = new MemoryRecordingStore();
    const inner = makeFakeTransport(() => ({ nodes: [], totalCount: 0 }));
    const transport = createRecordingTransport(inner, {
      mode: "record",
      recordingName: "rec",
      store,
    });

    store.start("rec");
    const result = await transport.execute({ field: "paymentLogs", type: "query", variables: { first: 10 } });
    store.stop();

    expect(result).toEqual({ nodes: [], totalCount: 0 });
    const rec = store.load("rec");
    expect(rec?.entries).toHaveLength(1);
    expect(rec?.entries[0]?.field).toBe("paymentLogs");
    expect(rec?.entries[0]?.variables).toEqual({ first: 10 });
  });

  it("record：错误也记录为 error 条目并重新抛出", async () => {
    const store = new MemoryRecordingStore();
    const inner = makeFakeTransport(() => {
      throw new Error("backend down");
    });
    const transport = createRecordingTransport(inner, {
      mode: "record",
      recordingName: "rec",
      store,
    });

    store.start("rec");
    await expect(transport.execute({ field: "pay", type: "query" })).rejects.toThrow("backend down");
    store.stop();

    const rec = store.load("rec");
    expect(rec?.entries[0]?.error?.message).toBe("backend down");
    expect(rec?.entries[0]?.error?.source).toBe("transport");
  });

  it("record：executeRawGraphQL 记录条目，field 从 query 提取", async () => {
    const store = new MemoryRecordingStore();
    const inner = makeFakeTransport(() => ({ nodes: [1] }));
    const transport = createRecordingTransport(inner, {
      mode: "record",
      recordingName: "rec",
      store,
    });

    store.start("rec");
    const result = await transport.executeRawGraphQL("query { paymentLogs(first: 10) { nodes } }");
    store.stop();

    expect(result).toEqual({ nodes: [1] });
    const rec = store.load("rec");
    expect(rec?.entries).toHaveLength(1);
    expect(rec?.entries[0]?.field).toBe("paymentLogs");
    expect(rec?.entries[0]?.type).toBe("query");
  });

  it("record：normalizeResult 在录制时运行，存储的是归一化后的数据", async () => {
    const store = new MemoryRecordingStore();
    const inner = makeFakeTransport(() => ({ createdAt: "2026-05-01T12:00:00.000Z" } as unknown));
    const transport = createRecordingTransport(inner, {
      mode: "record",
      recordingName: "rec",
      store,
      normalizers: {
        normalizeResult: (result) => normalizeTimestamps(result),
      },
    });

    store.start("rec");
    await transport.execute({ field: "paymentLog", type: "query" });
    store.stop();

    const rec = store.load("rec");
    expect(rec?.entries[0]?.result).toEqual({ createdAt: "2026-01-01T00:00:00.000Z" });
  });
});

describe("createRecordingTransport — replay 模式", () => {
  it("replay：order=true 按 FIFO 顺序消费，先 A 后 B", async () => {
    const store = new MemoryRecordingStore();
    seedRecording(store, "rec", [
      makeEntry("first", { variables: { id: 1 }, result: "A" }),
      makeEntry("second", { variables: { id: 2 }, result: "B" }),
    ]);
    const transport = createRecordingTransport(makeFakeTransport(() => ({})), {
      mode: "replay",
      recordingName: "rec",
      store,
      order: true,
    });

    await expect(transport.execute({ field: "first", type: "query", variables: { id: 1 } })).resolves.toBe("A");
    await expect(transport.execute({ field: "second", type: "query", variables: { id: 2 } })).resolves.toBe("B");
  });

  it("replay：order=true 时跳过当前 FIFO 位置的请求视为未命中", async () => {
    const store = new MemoryRecordingStore();
    seedRecording(store, "rec", [
      makeEntry("first", { result: "A" }),
      makeEntry("second", { result: "B" }),
    ]);
    const transport = createRecordingTransport(makeFakeTransport(() => ({})), {
      mode: "replay",
      recordingName: "rec",
      store,
      order: true,
    });

    // FIFO 位置 0 是 first，请求 second 不匹配 → 未命中
    await expect(transport.execute({ field: "second", type: "query" })).rejects.toThrow(/no recorded response/);
  });

  it("replay：order=false 无序匹配，可跳过不匹配条目", async () => {
    const store = new MemoryRecordingStore();
    seedRecording(store, "rec", [
      makeEntry("first", { result: "A" }),
      makeEntry("second", { result: "B" }),
    ]);
    const transport = createRecordingTransport(makeFakeTransport(() => ({})), {
      mode: "replay",
      recordingName: "rec",
      store,
      order: false,
    });

    // 无序模式下直接请求 second → 命中
    await expect(transport.execute({ field: "second", type: "query" })).resolves.toBe("B");
  });

  it("replay：variables 为 undefined 时归一化为 {} 匹配", async () => {
    const store = new MemoryRecordingStore();
    seedRecording(store, "rec", [
      makeEntry("q", { result: "no-vars" }),
    ]);
    const transport = createRecordingTransport(makeFakeTransport(() => ({})), {
      mode: "replay",
      recordingName: "rec",
      store,
    });

    // 录制时无 variables（undefined），回放时也无 variables → 匹配
    const result = await transport.execute({ field: "q", type: "query" });
    expect(result).toBe("no-vars");
  });

  it("replay：命中返回录制 result", async () => {
    const store = new MemoryRecordingStore();
    seedRecording(store, "rec", [
      makeEntry("paymentLogs", { variables: { first: 5 }, result: { nodes: [1, 2, 3, 4, 5] } }),
    ]);
    const transport = createRecordingTransport(makeFakeTransport(() => ({ panic: true })), {
      mode: "replay",
      recordingName: "rec",
      store,
    });

    const result = await transport.execute({ field: "paymentLogs", type: "query", variables: { first: 5 } });
    expect(result).toEqual({ nodes: [1, 2, 3, 4, 5] });
  });

  it("replay：未命中抛错并触发 onMiss 回调", async () => {
    const store = new MemoryRecordingStore();
    seedRecording(store, "rec", [
      makeEntry("paymentLogs", { variables: { first: 5 }, result: { nodes: [] } }),
    ]);
    let missed: string | undefined;
    const transport = createRecordingTransport(makeFakeTransport(() => ({})), {
      mode: "replay",
      recordingName: "rec",
      store,
      onMiss: (op) => {
        missed = op.field;
      },
    });

    await expect(
      transport.execute({ field: "otherField", type: "query", variables: { first: 5 } }),
    ).rejects.toThrow(/no recorded response/);
    expect(missed).toBe("otherField");
  });

  it("replay：error 条目回放时抛 MockRecordingError（携带 source）", async () => {
    const store = new MemoryRecordingStore();
    seedRecording(store, "rec", [
      makeEntry("pay", { error: { message: "boom", source: "injected" } }),
    ]);
    const transport = createRecordingTransport(makeFakeTransport(() => ({})), {
      mode: "replay",
      recordingName: "rec",
      store,
    });

    await expect(transport.execute({ field: "pay", type: "query" })).rejects.toMatchObject({
      name: "MockRecordingError",
      source: "injected",
      originalMessage: "boom",
    });
  });

  it("replay：maxUsageCount 消费后再次命中 → 未命中抛错", async () => {
    const store = new MemoryRecordingStore();
    seedRecording(store, "rec", [
      makeEntry("ping", { result: "pong" }),
    ]);
    const transport = createRecordingTransport(makeFakeTransport(() => ({})), {
      mode: "replay",
      recordingName: "rec",
      store,
      maxUsageCount: 1,
    });

    await expect(transport.execute({ field: "ping", type: "query" })).resolves.toBe("pong");
    await expect(transport.execute({ field: "ping", type: "query" })).rejects.toThrow(/no recorded response/);
  });

  it("replay：variables 键排序归一化匹配（{a:1,b:2} 与 {b:2,a:1} 同键）", async () => {
    const store = new MemoryRecordingStore();
    seedRecording(store, "rec", [
      makeEntry("q", { variables: { a: 1, b: 2 }, result: "matched" }),
    ]);
    const transport = createRecordingTransport(makeFakeTransport(() => ({})), {
      mode: "replay",
      recordingName: "rec",
      store,
    });

    const result = await transport.execute({ field: "q", type: "query", variables: { b: 2, a: 1 } });
    expect(result).toBe("matched");
  });

  it("replay：executeRawGraphQL 提取 field 并匹配", async () => {
    const store = new MemoryRecordingStore();
    seedRecording(store, "rec", [
      makeEntry("paymentLogs", { result: { nodes: [] } }),
    ]);
    const transport = createRecordingTransport(makeFakeTransport(() => ({})), {
      mode: "replay",
      recordingName: "rec",
      store,
    });

    const result = await transport.executeRawGraphQL("query { paymentLogs(first: 10) { nodes } }");
    expect(result).toEqual({ nodes: [] });
  });

  it("replay：strictVersion=true 时版本不匹配抛错", async () => {
    const store = new MemoryRecordingStore();
    store.start("rec");
    store.record(makeEntry("q", { result: 1 }));
    const rec = store.stop();
    if (rec) rec.version = "9.9.9"; // 篡改版本

    const transport = createRecordingTransport(makeFakeTransport(() => ({})), {
      mode: "replay",
      recordingName: "rec",
      store,
      strictVersion: true,
    });

    await expect(transport.execute({ field: "q", type: "query" })).rejects.toThrow(/version/);
  });

  it("replay：signal aborted 时直接抛错", async () => {
    const store = new MemoryRecordingStore();
    seedRecording(store, "rec", [makeEntry("q", { result: 1 })]);
    const controller = new AbortController();
    controller.abort();
    const transport = createRecordingTransport(makeFakeTransport(() => ({})), {
      mode: "replay",
      recordingName: "rec",
      store,
      signal: controller.signal,
    });

    await expect(transport.execute({ field: "q", type: "query" })).rejects.toThrow(/aborted/);
  });
});

describe("createRecordingTransport — passthrough 模式", () => {
  it("passthrough：直通不录，返回原 Transport 结果", async () => {
    const store = new MemoryRecordingStore();
    const inner = makeFakeTransport(() => ({ passthrough: true }));
    const transport = createRecordingTransport(inner, {
      mode: "passthrough",
      recordingName: "rec",
      store,
    });

    store.start("rec");
    const result = await transport.execute({ field: "q", type: "query" });
    store.stop();

    expect(result).toEqual({ passthrough: true });
    expect(store.load("rec")?.entries).toHaveLength(0);
  });
});

describe("configureRecordingStore — 全局存储注入", () => {
  it("configureRecordingStore：默认 store 是 MemoryRecordingStore，可注入自定义", async () => {
    const custom = new MemoryRecordingStore();
    configureRecordingStore(custom);

    const inner = makeFakeTransport(() => ({ ok: true }));
    const transport = createRecordingTransport(inner, {
      mode: "record",
      recordingName: "global",
    });
    custom.start("global");
    await transport.execute({ field: "q", type: "query" });
    custom.stop();

    expect(custom.load("global")?.entries).toHaveLength(1);
  });
});

describe("归一化器 — normalizeTimestamps / normalizeUuids", () => {
  it("normalizeTimestamps：替换 ISO-8601 字符串，保留其他值", () => {
    const input = { createdAt: "2026-05-01T12:00:00.000Z", name: "keep", items: ["2026-01-02T00:00:00Z", 42] };
    const out = normalizeTimestamps(input) as Record<string, unknown>;
    expect(out.createdAt).toBe("2026-01-01T00:00:00.000Z");
    expect(out.name).toBe("keep");
    expect((out.items as unknown[])[0]).toBe("2026-01-01T00:00:00.000Z");
    expect((out.items as unknown[])[1]).toBe(42);
  });

  it("normalizeUuids：替换 UUID 字符串，保留非 UUID", () => {
    const input = { id: "550e8400-e29b-41d4-a716-446655440000", name: "x", code: "ABC-123" };
    const out = normalizeUuids(input) as Record<string, unknown>;
    expect(out.id).toBe("00000000-0000-0000-0000-000000000000");
    expect(out.name).toBe("x");
    expect(out.code).toBe("ABC-123");
  });

  it("normalizeTimestamps：不修改嵌套数组中的对象", () => {
    const input = { list: [{ when: "2026-03-01T00:00:00Z", n: 1 }] };
    const out = normalizeTimestamps(input) as { list: Array<{ when: string; n: number }> };
    expect(out.list[0]?.when).toBe("2026-01-01T00:00:00.000Z");
    expect(out.list[0]?.n).toBe(1);
  });
});