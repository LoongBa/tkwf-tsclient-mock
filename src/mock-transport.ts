import type { Transport } from "@tkwf/tsclient";

/** 单个 field 的注入配置 */
export interface FieldOption {
  delayMs?: number;
  error?: unknown;
  failRate?: number;
  /** 超时模拟（ms）：handler 超时后抛 Error("Mock: timeout for <field>") */
  timeoutMs?: number;
}

/** 场景级 transport 配置 */
export interface ScenarioConfig {
  /** 加载态：长延迟 */
  delayMs?: number;
  /** 场景级快捷注入：整场景所有 field 统一报错（fieldOptions 可逐 field 覆盖） */
  error?: unknown;
  /** 错误态：逐 field 注入 error / failRate / timeoutMs */
  fieldOptions?: Record<string, FieldOption>;
}

export type MockHandler = (
  variables: Record<string, unknown> | undefined,
  ctx: { sessionKey?: string; signal?: AbortSignal; scenario?: string },
) => unknown;

export interface MockTransportOptions {
  /** 全局模拟延迟（ms） */
  delayMs?: number;
  /** per-field 覆盖：延迟/错误注入/超时模拟 */
  fieldOptions?: Record<string, FieldOption>;
  /** 初始场景名（默认 "default"） */
  scenario?: string;
  /** 场景配置字典 */
  scenarios?: Record<string, ScenarioConfig>;
}

export class MockTransport implements Transport {
  private handlers: Record<string, MockHandler>;
  private options?: MockTransportOptions;
  private scenario: string;

  constructor(
    handlers: Record<string, MockHandler>,
    options?: MockTransportOptions,
  ) {
    this.handlers = handlers;
    this.options = options;
    this.scenario = options?.scenario ?? "default";
  }

  /** 切换场景（不存在则 throw） */
  setScenario(name: string): void {
    if (!this.options?.scenarios || !(name in this.options.scenarios)) {
      // "default" 场景始终存在（即使未在 scenarios 中显式定义）
      if (name !== "default") {
        throw new Error(`Mock: scenario "${name}" does not exist`);

      }
    }
    this.scenario = name;
  }

  /** 获取当前场景名 */
  getScenario(): string {
    return this.scenario;
  }

  /** 获取全部场景名（至少含 "default"） */
  getScenarioNames(): string[] {
    const names = this.options?.scenarios
      ? Object.keys(this.options.scenarios)
      : [];
    if (!names.includes("default")) {
      names.unshift("default");
    }
    return names;
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

    // 1. 解析场景级注入（场景优先，逐项覆盖）
    const scenarioConfig = this.options?.scenarios?.[this.scenario];

    // error: scenarios[scenario].fieldOptions?.[field]?.error ?? scenarios[scenario].error ?? fieldOptions?.[field]?.error
    const fieldOpt = this.options?.fieldOptions?.[field];
    const scenarioFieldOpt = scenarioConfig?.fieldOptions?.[field];
    const effError = scenarioFieldOpt?.error ?? scenarioConfig?.error ?? fieldOpt?.error;
    if (effError) throw effError;

    // failRate: scenarios[scenario].fieldOptions?.[field]?.failRate ?? fieldOptions?.[field]?.failRate
    const effFailRate = scenarioFieldOpt?.failRate ?? fieldOpt?.failRate;
    if (effFailRate !== undefined && Math.random() < effFailRate) {
      throw new Error(`Mock: simulated failure for "${field}"`);
    }

    // delayMs: scenarios[scenario].fieldOptions?.[field]?.delayMs ?? scenarios[scenario].delayMs ?? fieldOptions?.[field]?.delayMs ?? delayMs
    const effDelay =
      scenarioFieldOpt?.delayMs
      ?? scenarioConfig?.delayMs
      ?? fieldOpt?.delayMs
      ?? this.options?.delayMs;
    if (effDelay) await new Promise((r) => setTimeout(r, effDelay));

    // 2. 查 handlers[field]
    const handler = this.handlers[field];
    if (!handler) {
      throw new Error(`Mock: no handler for "${field}"`);
    }

    // 3. 调用 handler，支持 timeoutMs 超时模拟
    const handlerPromise = Promise.resolve(
      handler(variables, { sessionKey, signal, scenario: this.scenario }),
    );

    // timeoutMs: scenarios[scenario].fieldOptions?.[field]?.timeoutMs ?? fieldOptions?.[field]?.timeoutMs
    const effTimeoutMs = scenarioFieldOpt?.timeoutMs ?? fieldOpt?.timeoutMs;
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    let settled: Promise<unknown> = handlerPromise;
    if (effTimeoutMs !== undefined) {
      const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutId = setTimeout(
          () => reject(new Error(`Mock: timeout for "${field}"`)),
          effTimeoutMs,
        );
      });
      settled = Promise.race([handlerPromise, timeoutPromise]);
    }

    try {
      const handlerResult = await settled;
      // GraphQL 契约：execute() 返回 GraphQL `data` 对象（{ [field]: 结果 }），
      // 与 GraphQLTransport.parseResponse（返回 json.data）保持一致。
      // 上层 DomainClientUser.loginAs/loginByContext/QueryBuilder 均按该形状消费。
      return { [field]: handlerResult } as T;
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