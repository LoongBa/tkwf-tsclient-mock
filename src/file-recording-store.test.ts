import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { FileRecordingStore } from "./file-recording-store";
import type { RecordedEntry } from "./record-replay";

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "file-recording-store-"));

function makeEntry(field: string, overrides: Partial<RecordedEntry> = {}): RecordedEntry {
  return {
    field,
    type: "query",
    durationMs: 5,
    timestamp: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("FileRecordingStore — 文件录制存储", () => {
  beforeAll(() => {
    fs.mkdirSync(tempDir, { recursive: true });
  });

  afterAll(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("写入录制：start → record → stop 后生成 <dir>/<name>.json 文件", () => {
    const store = new FileRecordingStore(tempDir);
    store.start("write-test", { scenario: "error" });
    store.record(makeEntry("paymentLog"));
    store.record(makeEntry("createPaymentLog", { type: "mutation", result: { id: "1" } }));
    const recording = store.stop();

    expect(recording?.name).toBe("write-test");
    expect(recording?.scenario).toBe("error");
    expect(recording?.entries).toHaveLength(2);
    expect(recording?.createdAt).toBeTruthy();
    expect(recording?.version).toBeTruthy();

    // 文件落盘 + 2 空格缩进
    const filePath = path.join(tempDir, "write-test.json");
    expect(fs.existsSync(filePath)).toBe(true);
    const raw = fs.readFileSync(filePath, "utf-8");
    expect(raw).toContain("\n  ");
    expect(raw).toContain('"field": "paymentLog"');
  });

  it("读取录制：load 从文件还原 Recording", () => {
    const store = new FileRecordingStore(tempDir);
    store.start("load-test");
    store.record(makeEntry("me", { result: { name: "Alice" } }));
    store.stop();

    const loaded = store.load("load-test");
    expect(loaded?.name).toBe("load-test");
    expect(loaded?.entries[0]?.field).toBe("me");
    expect(loaded?.entries[0]?.result).toEqual({ name: "Alice" });
  });

  it("列出录制：list 返回目录下全部录制名（去 .json 扩展名）", () => {
    const store = new FileRecordingStore(tempDir);
    store.start("list-a");
    store.stop();
    store.start("list-b");
    store.stop();

    const names = store.list();
    expect(names).toContain("list-a");
    expect(names).toContain("list-b");
    // 不包含目录本身或非 .json 文件
    expect(names.some((n) => n.endsWith(".json"))).toBe(false);
  });

  it("目录不存在时自动创建", () => {
    const nested = path.join(tempDir, "nested", "deep");
    const store = new FileRecordingStore(nested);
    expect(fs.existsSync(nested)).toBe(true);

    store.start("auto-mkdir");
    store.stop();
    expect(fs.existsSync(path.join(nested, "auto-mkdir.json"))).toBe(true);
  });

  it("load 不存在的录制返回 undefined", () => {
    const store = new FileRecordingStore(tempDir);
    expect(store.load("missing-recording")).toBeUndefined();
  });

  it("record 在 start 之前调用抛错", () => {
    const store = new FileRecordingStore(tempDir);
    expect(() => store.record(makeEntry("ping"))).toThrow(/no active session/);
  });

  it("stop 在 start 之前调用抛错", () => {
    const store = new FileRecordingStore(tempDir);
    expect(() => store.stop()).toThrow(/no active session/);
  });

  it("未 stop 时再次 start 抛错", () => {
    const store = new FileRecordingStore(tempDir);
    store.start("busy");
    expect(() => store.start("again")).toThrow(/already active/);
  });

  it("stop 后可重新 start 开始新会话", () => {
    const store = new FileRecordingStore(tempDir);
    store.start("first");
    store.stop();
    expect(() => store.start("second")).not.toThrow();
  });
});