import type { Transport } from "@tkwf/tsclient";

export type MockHandler = (
  variables: Record<string, unknown> | undefined,
  ctx: { sessionKey?: string; signal?: AbortSignal },
) => unknown;

export interface MockTransportOptions {
  /** 全局模拟延迟（ms） */
  delayMs?: number;
  /** per-field 覆盖：延迟/错误注入/超时模拟 */
  fieldOptions?: Record<string, {
    delayMs?: number;
    error?: unknown;
    failRate?: number;
    /** 超时模拟（ms）：handler 超时后抛 Error("Mock: timeout for <field>") */
    timeoutMs?: number;
  }>;
}

export class MockTransport implements Transport {
  private handlers: Record<string, MockHandler>;
  private options?: MockTransportOptions;

  constructor(
    handlers: Record<string, MockHandler>,
    options?: MockTransportOptions,
  ) {
    this.handlers = handlers;
    this.options = options;
  }

  async execute<T>(op: {
    field: string;
    type: "query" | "mutation";
    variables?: Record<string, unknown>;
    variableTypes?: Record<string, string>;
    sessionKey?: string;
    signal?: AbortSignal;
    selection?: string;
  }): Promise<T> {
    const { field, variables, sessionKey, signal } = op;

    // 1. 查 fieldOptions：delayMs / failRate / error
    const fieldOpt = this.options?.fieldOptions?.[field];
    if (fieldOpt?.error) throw fieldOpt.error;
    if (fieldOpt?.failRate !== undefined && Math.random() < fieldOpt.failRate) {
      throw new Error(`Mock: simulated failure for "${field}"`);
    }

    const delay = fieldOpt?.delayMs ?? this.options?.delayMs;
    if (delay) await new Promise((r) => setTimeout(r, delay));

    // 2. 查 handlers[field]
    const handler = this.handlers[field];
    if (!handler) {
      throw new Error(`Mock: no handler for "${field}"`);
    }

    // 3. 调用 handler，支持 timeoutMs 超时模拟
    const handlerPromise = handler(variables, { sessionKey, signal }) as Promise<T> | T;

    const timeoutMs = fieldOpt?.timeoutMs;
    if (timeoutMs === undefined) {
      return handlerPromise;
    }

    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(
        () => reject(new Error(`Mock: timeout for "${field}"`)),
        timeoutMs,
      );
    });

    try {
      return await Promise.race([handlerPromise, timeoutPromise]);
    } finally {
      if (timeoutId !== undefined) clearTimeout(timeoutId);
    }
  }

  async executeRawGraphQL<T>(query: string, sessionKey?: string, signal?: AbortSignal): Promise<T> {
    // 从 query 字符串提取 field 名（首个顶层标识符）
    // 例如: `query { paymentLog(...) }` → `paymentLog`
    const field = this.extractField(query);
    if (!field) {
      throw new Error(`Mock: unable to extract field from raw query`);
    }
    return this.execute<T>({ field, type: "query", sessionKey, signal });
  }

  private extractField(query: string): string | null {
    // 两阶段提取：
    // 1. strip 注释（#... 到行尾）
    // 2. 匹配首个顶层 field
    const noComments = query.replace(/#[^\n]*/g, "");
    const match = noComments.match(
      /^\s*(?:query|mutation)?\s*\w*\s*\{[^}]*?\b(\w+)\b/,
    );
    return match ? match[1] : null;
  }
}