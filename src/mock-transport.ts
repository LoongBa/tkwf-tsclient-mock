import type { Transport } from "@tkwf/tsclient";

export type MockHandler = (
  variables: Record<string, unknown> | undefined,
  ctx: { sessionKey?: string; signal?: AbortSignal },
) => unknown;

export interface MockTransportOptions {
  /** 全局模拟延迟（ms） */
  delayMs?: number;
  /** per-field 覆盖：延迟/错误注入 */
  fieldOptions?: Record<string, {
    delayMs?: number;
    error?: unknown;
    failRate?: number;
  }>;
}

export class MockTransport implements Transport {
  constructor(
    private handlers: Record<string, MockHandler>,
    private options?: MockTransportOptions,
  ) {}

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

    // 3. 调用 handler
    return handler(variables, { sessionKey, signal }) as Promise<T> | T;
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
    // 简单提取：匹配 query/mutation { FieldName 或 { FieldName
    const match = query.match(/(?:query|mutation)?\s*\{\s*(\w+)/);
    return match ? match[1] : null;
  }
}