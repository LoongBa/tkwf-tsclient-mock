import type { Transport } from "@tkwf/tsclient";

// ── 类型定义 ──

/** 单个录制条目（一次 execute/executeRawGraphQL 的请求→响应对） */
export interface RecordedEntry {
  field: string;
  type: "query" | "mutation";
  variables?: Record<string, unknown>;
  result?: unknown;
  error?: {
    message: string;
    source?: "injected" | "failRate" | "timeout" | "missingHandler" | "handler" | "transport" | "network";
    errorCode?: string;
  };
  durationMs: number;
  timestamp: string;
}

/** 一次命名录制会话 */
export interface Recording {
  name: string;
  scenario?: string;
  entries: RecordedEntry[];
  createdAt: string;
  version: string;
}

/** 可插拔录制存储 —— 所有方法允许 Promise 返回（兼容 IndexedDB 等异步后端） */
export interface RecordingStore {
  /** 开始录制会话（已存在进行中会话时抛错） */
  start(name: string, options?: { scenario?: string }): void | Promise<void>;
  /** 记录单条条目（无活动会话时抛错） */
  record(entry: RecordedEntry): void | Promise<void>;
  /** 结束会话，返回录制结果（无活动会话时抛错） */
  stop(): Recording | undefined | Promise<Recording | undefined>;
  /** 加载已完成的录制 */
  load(name: string): Recording | undefined | Promise<Recording | undefined>;
  /** 列出所有可用录制名 */
  list(): string[] | Promise<string[]>;
}

export type RecordingMode = "record" | "replay" | "passthrough";

export interface RecordingTransportOptions {
  mode: RecordingMode;
  recordingName: string;
  store?: RecordingStore;
  normalizers?: {
    normalizeVariables?: (variables: Record<string, unknown> | undefined, field: string) => Record<string, unknown> | undefined;
    normalizeResult?: (result: unknown, field: string) => unknown;
  };
  /** false = 无序匹配（polling 场景），默认 true = 有序 FIFO */
  order?: boolean;
  /** 单条可消费次数，默认 1 */
  maxUsageCount?: number;
  /** 回放未命中回调 */
  onMiss?: (op: { field: string; type: string; variables?: unknown }) => void;
  /** true = 录制版本不匹配抛错；默认 false = 仅 console.warn */
  strictVersion?: boolean;
  /** 可选：回放时检查该 signal 是否已 aborted */
  signal?: AbortSignal;
}

// ── MockRecordingError ──

/** 回放错误包装：保留录制时的 source 元数据 */
export class MockRecordingError extends Error {
  source: string;
  originalMessage: string;
  errorCode?: string;

  constructor(message: string, source: string, errorCode?: string) {
    super(`[MockRecordingError] ${message}`);
    this.name = "MockRecordingError";
    this.source = source;
    this.originalMessage = message;
    this.errorCode = errorCode;
  }
}

// ── MemoryRecordingStore ──

/** 内存录制存储（默认实现） */
export class MemoryRecordingStore implements RecordingStore {
  private activeName: string | null = null;
  private activeScenario: string | undefined;
  private entries: RecordedEntry[] = [];
  private archive = new Map<string, Recording>();

  start(name: string, options?: { scenario?: string }): void {
    if (this.activeName !== null) {
      throw new Error(`RecordingStore: session "${this.activeName}" already active, call stop() first`);
    }
    this.activeName = name;
    this.activeScenario = options?.scenario;
    this.entries = [];
  }

  record(entry: RecordedEntry): void {
    if (this.activeName === null) {
      throw new Error("RecordingStore: no active session, call start() first");
    }
    this.entries.push(entry);
  }

  stop(): Recording | undefined {
    if (this.activeName === null) {
      throw new Error("RecordingStore: no active session, call start() first");
    }
    const recording: Recording = {
      name: this.activeName,
      scenario: this.activeScenario,
      entries: this.entries,
      createdAt: new Date().toISOString(),
      version: "1.3.0",
    };
    this.archive.set(this.activeName, recording);
    this.activeName = null;
    this.activeScenario = undefined;
    this.entries = [];
    return recording;
  }

  load(name: string): Recording | undefined {
    return this.archive.get(name);
  }

  list(): string[] {
    return [...this.archive.keys()].sort();
  }
}

// ── 全局默认存储 ──

let activeStore: RecordingStore = new MemoryRecordingStore();

/** 注入自定义录制存储（如 FileRecordingStore，复用 configureSidecar 模式） */
export function configureRecordingStore(store: RecordingStore): void {
  activeStore = store;
}

// ── 归一化器 ──

/** 递归遍历对象/数组，将 ISO-8601 时间戳字符串替换为固定占位符（默认 "2026-01-01T00:00:00.000Z"） */
export function normalizeTimestamps(value: unknown, replaceWith = "2026-01-01T00:00:00.000Z"): unknown {
  if (typeof value === "string") {
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(value)) {
      return replaceWith;
    }
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => normalizeTimestamps(item, replaceWith));
  }
  if (value !== null && typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      result[k] = normalizeTimestamps(v, replaceWith);
    }
    return result;
  }
  return value;
}

/** 递归遍历对象/数组，将 UUID v1-v5 字符串替换为固定占位符（默认 "00000000-0000-0000-0000-000000000000"） */
export function normalizeUuids(value: unknown, replaceWith = "00000000-0000-0000-0000-000000000000"): unknown {
  if (typeof value === "string") {
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) {
      return replaceWith;
    }
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => normalizeUuids(item, replaceWith));
  }
  if (value !== null && typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      result[k] = normalizeUuids(v, replaceWith);
    }
    return result;
  }
  return value;
}

// ── 匹配键辅助 ──

/** 生成匹配键：field + type + 归一化 variables（键排序 + undefined→{}） */
function makeMatchKey(field: string, type: "query" | "mutation", variables?: Record<string, unknown>): string {
  const normVars = variables ?? {};
  const sorted = Object.keys(normVars)
    .sort()
    .reduce<Record<string, unknown>>((acc, k) => {
      acc[k] = (normVars as Record<string, unknown>)[k];
      return acc;
    }, {});
  return `${field}:${type}:${JSON.stringify(sorted)}`;
}

// ── extractField（从 raw query 提取 field 名） ──

function extractField(query: string): string | null {
  const noComments = query.replace(/#[^\n]*/g, "");
  const match = noComments.match(/^\s*(?:query|mutation)?\s*\w*\s*\{[^}]*?\b(\w+)\b/);
  return match ? match[1] : null;
}

// ── 条目消费计数辅助 ──

const usageCounts = new WeakMap<object, number>();

function canConsume(entry: RecordedEntry, maxUsage: number): boolean {
  return (usageCounts.get(entry) ?? 0) < maxUsage;
}

function consumeEntry(entry: RecordedEntry): void {
  usageCounts.set(entry, (usageCounts.get(entry) ?? 0) + 1);
}

// ── createRecordingTransport ──

/** 当前包版本（用于 version 兼容性检查） */
const RECORDING_VERSION = "1.3.0";

/**
 * 创建录制回放 Transport 装饰器。
 *
 * 包装任意 Transport 实例，添加 record/replay/passthrough 三态模式。
 * 不侵入原 Transport 实现。
 */
export function createRecordingTransport(
  transport: Transport,
  options: RecordingTransportOptions,
): Transport {
  const {
    mode,
    recordingName,
    store,
    normalizers,
    maxUsageCount = 1,
    onMiss,
    strictVersion = false,
    signal: abortSignal,
  } = options;
  const targetStore = store ?? activeStore;

  function normalizeVars(variables: Record<string, unknown> | undefined, _field: string): Record<string, unknown> | undefined {
    let result = variables;
    if (normalizers?.normalizeVariables) {
      result = normalizers.normalizeVariables(result, _field);
    }
    return result;
  }

  function normalizeRes(result: unknown, _field: string): unknown {
    if (normalizers?.normalizeResult) {
      return normalizers.normalizeResult(result, _field);
    }
    return result;
  }

  function replayMatch(field: string, type: "query" | "mutation", variables?: Record<string, unknown>): unknown {
    const rec = (targetStore as RecordingStore).load(recordingName) as Recording | undefined;

    if (!rec) {
      onMiss?.({ field, type, variables });
      throw new Error(`Mock: no recorded response for "${field}"`);
    }

    if (rec.version !== RECORDING_VERSION) {
      const msg = `Recording "${recordingName}" version ${rec.version} != current ${RECORDING_VERSION}`;
      if (strictVersion) {
        throw new Error(msg);
      } else {
        console.warn(`[record-replay] ${msg}`);
      }
    }

    const normVars = normalizeVars(variables, field);
    const matchKey = makeMatchKey(field, type, normVars);

    for (let i = 0; i < rec.entries.length; i++) {
      const entry = rec.entries[i];
      const entryKey = makeMatchKey(entry.field, entry.type, entry.variables);
      if (entryKey !== matchKey) continue;
      if (!canConsume(entry, maxUsageCount)) continue;
      consumeEntry(entry);

      if (entry.error) {
        throw new MockRecordingError(entry.error.message, entry.error.source ?? "recorded", entry.error.errorCode);
      }
      return entry.result;
    }

    onMiss?.({ field, type, variables: normVars });
    throw new Error(`Mock: no recorded response for "${field}" (key: ${matchKey})`);
  }

  const decorated: Transport = {
    async execute<T>(op: {
      field: string;
      type: "query" | "mutation";
      variables?: Record<string, unknown>;
      variableTypes?: Record<string, string>;
      sessionKey?: string;
      signal?: AbortSignal;
      selection?: string;
    }): Promise<T> {
      if (abortSignal?.aborted) {
        throw new Error("Mock: operation aborted");
      }

      const { field, type, variables } = op;

      switch (mode) {
        case "replay": {
          return replayMatch(field, type, variables) as T;
        }

        case "record": {
          const startTime = performance.now();
          try {
            const result = await transport.execute<T>(op);
            const entry: RecordedEntry = {
              field,
              type,
              variables: normalizeVars(variables, field),
              result: normalizeRes(result, field),
              durationMs: performance.now() - startTime,
              timestamp: new Date().toISOString(),
            };
            await targetStore.record(entry);
            return result;
          } catch (e) {
            const err = e as Error;
            await targetStore.record({
              field,
              type,
              variables: normalizeVars(variables, field),
              error: { message: err.message, source: "transport", errorCode: (e as Record<string, string>)?.errorCode },
              durationMs: performance.now() - startTime,
              timestamp: new Date().toISOString(),
            });
            throw e;
          }
        }

        case "passthrough":
          return transport.execute<T>(op);
      }
    },

    async executeRawGraphQL<T>(query: string, _sessionKey?: string, _signal?: AbortSignal): Promise<T> {
      if (abortSignal?.aborted) {
        throw new Error("Mock: operation aborted");
      }

      const field = extractField(query);
      if (!field) {
        throw new Error("Mock: unable to extract field from raw query");
      }

      switch (mode) {
        case "replay": {
          return replayMatch(field, "query", undefined) as T;
        }

        case "record": {
          const startTime = performance.now();
          try {
            const result = await transport.executeRawGraphQL<T>(query, _sessionKey, _signal);
            await targetStore.record({
              field,
              type: "query",
              variables: undefined,
              result: normalizeRes(result, field),
              durationMs: performance.now() - startTime,
              timestamp: new Date().toISOString(),
            });
            return result;
          } catch (e) {
            const err = e as Error;
            await targetStore.record({
              field,
              type: "query",
              error: { message: err.message, source: "transport" },
              durationMs: performance.now() - startTime,
              timestamp: new Date().toISOString(),
            });
            throw e;
          }
        }

        case "passthrough":
          return transport.executeRawGraphQL<T>(query, _sessionKey, _signal);
      }
    },
  };

  return decorated;
}