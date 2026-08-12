import type { Transport } from "@tkwf/tsclient";

// ── 录制版本（与 mock 包版本独立） ──
const RECORDING_VERSION = "1.3.0";

// ── 类型定义 ──

/**
 * 单个录制条目（一次 execute/executeRawGraphQL 的请求→响应对）。
 */
export interface RecordedEntry {
  field: string;
  type: "query" | "mutation";
  /** 归一化后的请求 variables */
  variables?: Record<string, unknown>;
  /** 成功响应的 data */
  result?: unknown;
  /** 出错时的错误信息 */
  error?: {
    message: string;
    /** 错误来源：injected / failRate / timeout / missingHandler / handler / transport / network */
    source?: string;
    /** DomainClientError 携带的 errCode（可选） */
    errorCode?: string;
  };
  /** 响应耗时（ms） */
  durationMs: number;
  /** ISO-8601 时间戳（录制时生成，回放不用于匹配） */
  timestamp: string;
}

/**
 * 一次命名录制会话。
 */
export interface Recording {
  name: string;
  /** 录制时的场景名（可选） */
  scenario?: string;
  entries: RecordedEntry[];
  createdAt: string;
  /** mock 包版本（兼容性检测） */
  version: string;
}

/**
 * 可插拔录制存储接口。
 *
 * 所有方法允许返回 Promise<void>/Promise<Recording> 以兼容 IndexedDB 等浏览器异步后端。
 * 同步实现（如 MemoryRecordingStore）返回 void/Recording 即可（void 是 Promise<void> 的兼容子集）。
 */
export interface RecordingStore {
  /** 开始录制会话。options.scenario 可选场景名。 */
  start(name: string, options?: { scenario?: string }): void | Promise<void>;
  /** 记录单条条目。必须在 start() 之后、stop() 之前调用，否则抛错。 */
  record(entry: RecordedEntry): void | Promise<void>;
  /** 结束当前会话，返回录制结果。未 start() 时调用抛错。 */
  stop(): Recording | undefined | Promise<Recording | undefined>;
  /** 加载已归档的录制。 */
  load(name: string): Recording | undefined | Promise<Recording | undefined>;
  /** 列出所有已归档的录制名。 */
  list(): string[] | Promise<string[]>;
}

export type RecordingMode = "record" | "replay" | "passthrough";

export interface RecordingTransportOptions {
  mode: RecordingMode;
  /** 录制会话名（record 时创建，replay 时加载） */
  recordingName: string;
  /** 可选，默认 activeStore */
  store?: RecordingStore;
  normalizers?: {
    /** 录制和回放都运行（保证匹配一致）。用户函数之后，系统再做键排序 + undefined→{} 归一化。 */
    normalizeVariables?: (variables: Record<string, unknown> | undefined, field: string) => Record<string, unknown> | undefined;
    /** 仅在录制时运行（存储的就是归一化后的确定性数据）。 */
    normalizeResult?: (result: unknown, field: string) => unknown;
  };
  /** true = 有序 FIFO（默认），false = 无序匹配（polling 场景） */
  order?: boolean;
  /** 单条可消费次数，默认 1 */
  maxUsageCount?: number;
  /** 回放未命中回调 */
  onMiss?: (op: { field: string; type: string; variables?: unknown }) => void;
  /** true = 录制版本不匹配抛错；false（默认）= 仅 console.warn */
  strictVersion?: boolean;
  /** 可选：回放时检查该 signal 是否已 aborted */
  signal?: AbortSignal;
}

// ── MockRecordingError ──

/**
 * 回放错误条目时抛出的专用错误，携带录制时的错误来源和信息。
 */
export class MockRecordingError extends Error {
  /** 录制时的错误来源 */
  source: string;
  /** 原始错误 message */
  originalMessage: string;
  /** DomainClientError 的 errCode（可选） */
  errorCode?: string;

  constructor(message: string, source: string, errorCode?: string) {
    super(message);
    this.name = "MockRecordingError";
    this.source = source;
    this.originalMessage = message;
    this.errorCode = errorCode;
    // 修复 prototype 链，确保 instanceof 正确
    Object.setPrototypeOf(this, MockRecordingError.prototype);
  }
}

// ── MemoryRecordingStore ──

/**
 * 内存录制存储 —— 可实例化，也作为模块级默认单例。
 *
 * 生命周期约束：
 * - record() 必须在 start() 之后、stop() 之前调用，否则抛错
 * - start() 在未 stop() 时再次调用抛错（防止覆盖进行中的会话）
 * - stop() 在未 start() 时调用抛错
 * - load()/list() 可在 start() 进行中调用（不影响当前会话）
 */
export class MemoryRecordingStore implements RecordingStore {
  private activeName: string | null = null;
  private activeScenario: string | undefined;
  private entries: RecordedEntry[] = [];
  private archive = new Map<string, Recording>();

  start(name: string, options?: { scenario?: string }): void {
    if (this.activeName !== null) {
      throw new Error(`RecordingStore: session "${this.activeName}" is already active, stop it first`);
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
      throw new Error("RecordingStore: no active session to stop");
    }
    const recording: Recording = {
      name: this.activeName,
      scenario: this.activeScenario,
      entries: this.entries,
      createdAt: new Date().toISOString(),
      version: RECORDING_VERSION,
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

/**
 * 默认内存 RecordingStore（模块级单例）。
 */
export const memoryStore: RecordingStore = new MemoryRecordingStore();

let activeStore: RecordingStore = memoryStore;

/**
 * 注入自定义 RecordingStore（如 FileRecordingStore / IndexedDB）。
 *
 * 复用 configureSidecar 注入模式，默认使用内存存储。
 */
export function configureRecordingStore(store: RecordingStore): void {
  activeStore = store;
}

/**
 * 获取当前活跃的 RecordingStore。
 * @internal
 */
export function getActiveStore(): RecordingStore {
  return activeStore;
}

// ── 辅助函数 ──

/**
 * 从 GraphQL 查询字符串中提取顶层 field 名。
 * 两阶段提取：1) strip 注释 2) 匹配首个顶层 field。
 */
function extractField(query: string): string | null {
  const noComments = query.replace(/#[^\n]*/g, "");
  const match = noComments.match(
    /^\s*(?:query|mutation)?\s*\w*\s*\{[^}]*?\b(\w+)\b/,
  );
  return match ? match[1] : null;
}

/**
 * 归一化 variables：用户函数 → undefined→{} → 键排序。
 *
 * 返回排序后的新对象，不修改原对象。
 */
function normalizeVariables(
  variables: Record<string, unknown> | undefined,
  field: string,
  userNormalizer?: (variables: Record<string, unknown> | undefined, field: string) => Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  // 1. 用户归一化函数
  let result = userNormalizer ? userNormalizer(variables, field) : variables;

  // 2. undefined → {}
  if (result === undefined || result === null) {
    result = {};
  }

  // 3. 键排序
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(result).sort()) {
    sorted[key] = result[key];
  }

  return sorted;
}

/**
 * 构建匹配键：field + type + sorted-variables JSON。
 */
function buildMatchKey(
  field: string,
  type: string,
  variables: Record<string, unknown> | undefined,
  userNormalizer?: (variables: Record<string, unknown> | undefined, field: string) => Record<string, unknown> | undefined,
): string {
  const norm = normalizeVariables(variables, field, userNormalizer);
  return `${field}:${type}:${JSON.stringify(norm)}`;
}

// ── createRecordingTransport ──

/**
 * 创建录制回放 Transport 装饰器。
 *
 * 包装任意 Transport 实例，根据 mode 提供录制/回放/直通三种行为。
 * 不侵入源 Transport 实现。
 *
 * @param transport - 被包装的 Transport 实例
 * @param options - 录制回放配置
 * @returns 包装后的 Transport（与原 Transport 接口一致）
 */
export function createRecordingTransport(
  transport: Transport,
  options: RecordingTransportOptions,
): Transport {
  const {
    mode,
    recordingName,
    normalizers,
    order = true,
    maxUsageCount = 1,
    onMiss,
    strictVersion = false,
    signal: abortSignal,
  } = options;

  const store = options.store ?? activeStore;

  // 回放状态：每个条目剩余消费次数
  // 使用 Map 记录每个条目的消费次数（key 为 entry 引用）
  const usageMap = new Map<RecordedEntry, number>();
  let replayLoaded = false;

  /** 获取当前（录制时归一化的）匹配键 */
  function entryMatchKey(entry: RecordedEntry): string {
    return buildMatchKey(entry.field, entry.type, entry.variables);
  }

  /** 检查条目是否还有剩余消费次数 */
  function canConsume(entry: RecordedEntry): boolean {
    return (usageMap.get(entry) ?? 0) < maxUsageCount;
  }

  /** 消费一次，返回是否已耗尽 */
  function consume(entry: RecordedEntry): void {
    usageMap.set(entry, (usageMap.get(entry) ?? 0) + 1);
  }

  /** 加载并校验录制 */
  async function loadRecording(): Promise<Recording> {
    const rec = await (store.load(recordingName) as Promise<Recording | undefined>);
    if (!rec) {
      throw new Error(`Mock: recording "${recordingName}" not found`);
    }
    // 版本检查
    if (rec.version !== RECORDING_VERSION) {
      const msg = `Recording "${recordingName}" version mismatch: stored="${rec.version}", current="${RECORDING_VERSION}"`;
      if (strictVersion) {
        throw new Error(msg);
      }
      console.warn(`[tkwf/tsclient-mock] ${msg}`);
    }
    replayLoaded = true;
    return rec;
  }

  /** 回放模式下的匹配逻辑 */
  async function replayMatch(
    field: string,
    type: "query" | "mutation",
    variables: Record<string, unknown> | undefined,
  ): Promise<unknown> {
    if (!replayLoaded) {
      await loadRecording();
    }
    // 重新加载以确保获取最新状态（如果有并发修改）
    const rec = await (store.load(recordingName) as Promise<Recording | undefined>);
    if (!rec) {
      onMiss?.({ field, type, variables });
      throw new Error(`Mock: no recorded response for "${field}"`);
    }

    const matchKey = buildMatchKey(field, type, variables, normalizers?.normalizeVariables);

    if (order) {
      // order=true：严格 FIFO，必须按录制顺序消费
      for (const entry of rec.entries) {
        if (!canConsume(entry)) continue;
        const eKey = entryMatchKey(entry);
        if (eKey !== matchKey) {
          // FIFO 模式下，第一个可消费的条目必须匹配
          onMiss?.({ field, type, variables });
          throw new Error(`Mock: no recorded response for "${field}"`);
        }
        consume(entry);
        if (entry.error) {
          throw new MockRecordingError(
            entry.error.message,
            entry.error.source ?? "recorded",
            entry.error.errorCode,
          );
        }
        return entry.result;
      }
      // 所有条目已耗尽
      onMiss?.({ field, type, variables });
      throw new Error(`Mock: no recorded response for "${field}"`);
    }

    // order=false：按 key 匹配，取第一个匹配且有剩余次数的条目
    for (const entry of rec.entries) {
      if (!canConsume(entry)) continue;
      const eKey = entryMatchKey(entry);
      if (eKey !== matchKey) continue;
      consume(entry);
      if (entry.error) {
        throw new MockRecordingError(
          entry.error.message,
          entry.error.source ?? "recorded",
          entry.error.errorCode,
        );
      }
      return entry.result;
    }

    // 未命中
    onMiss?.({ field, type, variables });
    throw new Error(`Mock: no recorded response for "${field}"`);
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
          return (await replayMatch(field, type, variables)) as T;
        }

        case "record": {
          const startTime = performance.now();
          try {
            const result = await transport.execute<T>(op);
            const durationMs = Math.round(performance.now() - startTime);
            const normVars = normalizeVariables(variables, field, normalizers?.normalizeVariables);
            const entry: RecordedEntry = {
              field,
              type,
              variables: normVars,
              result: normalizers?.normalizeResult
                ? normalizers.normalizeResult(result, field)
                : result,
              durationMs,
              timestamp: new Date().toISOString(),
            };
            await (store.record(entry) as Promise<void>);
            return result;
          } catch (e) {
            const durationMs = Math.round(performance.now() - startTime);
            const err = e as Error & { errorCode?: string };
            const normVars = normalizeVariables(variables, field, normalizers?.normalizeVariables);
            await (store.record({
              field,
              type,
              variables: normVars,
              error: {
                message: err.message,
                source: "transport",
                errorCode: err.errorCode,
              },
              durationMs,
              timestamp: new Date().toISOString(),
            }) as Promise<void>);
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
          // executeRawGraphQL 回放时按 (field, "query", undefined→{}) 匹配
          return (await replayMatch(field, "query", undefined)) as T;
        }

        case "record": {
          const startTime = performance.now();
          try {
            const result = await transport.executeRawGraphQL<T>(query, _sessionKey, _signal);
            const durationMs = Math.round(performance.now() - startTime);
            await (store.record({
              field,
              type: "query",
              variables: normalizeVariables(undefined, field, normalizers?.normalizeVariables),
              result: normalizers?.normalizeResult
                ? normalizers.normalizeResult(result, field)
                : result,
              durationMs,
              timestamp: new Date().toISOString(),
            }) as Promise<void>);
            return result;
          } catch (e) {
            const durationMs = Math.round(performance.now() - startTime);
            const err = e as Error;
            await (store.record({
              field,
              type: "query",
              variables: normalizeVariables(undefined, field, normalizers?.normalizeVariables),
              error: { message: err.message, source: "transport" },
              durationMs,
              timestamp: new Date().toISOString(),
            }) as Promise<void>);
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

// ── 归一化器 ──

/**
 * ISO-8601 时间戳正则（匹配 UTC / 时区偏移格式）。
 */
const ISO_TIMESTAMP_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})$/;

/**
 * UUID v1-v5 正则。
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * 递归遍历对象/数组，将 ISO-8601 时间戳字符串替换为确定性占位符。
 *
 * 不修改原对象/数组，返回新值。
 *
 * @param value - 要遍历的值（对象/数组/原始值）
 * @param replaceWith - 替换用的时间戳，默认 "2026-01-01T00:00:00.000Z"
 * @returns 替换后的新值
 */
export function normalizeTimestamps(value: unknown, replaceWith = "2026-01-01T00:00:00.000Z"): unknown {
  if (typeof value === "string") {
    return ISO_TIMESTAMP_RE.test(value) ? replaceWith : value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => normalizeTimestamps(item, replaceWith));
  }
  if (value !== null && typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>)) {
      result[key] = normalizeTimestamps((value as Record<string, unknown>)[key], replaceWith);
    }
    return result;
  }
  return value;
}

/**
 * 递归遍历对象/数组，将 UUID v1-v5 字符串替换为确定性占位符。
 *
 * 不修改原对象/数组，返回新值。
 *
 * @param value - 要遍历的值（对象/数组/原始值）
 * @param replaceWith - 替换用的 UUID，默认 "00000000-0000-0000-0000-000000000000"
 * @returns 替换后的新值
 */
export function normalizeUuids(value: unknown, replaceWith = "00000000-0000-0000-0000-000000000000"): unknown {
  if (typeof value === "string") {
    return UUID_RE.test(value) ? replaceWith : value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => normalizeUuids(item, replaceWith));
  }
  if (value !== null && typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>)) {
      result[key] = normalizeUuids((value as Record<string, unknown>)[key], replaceWith);
    }
    return result;
  }
  return value;
}