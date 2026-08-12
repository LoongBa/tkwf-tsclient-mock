import type { Transport } from "@tkwf/tsclient";

export interface GraphQLRequestBody {
  query: string;
  operationName?: string;
  variables?: Record<string, unknown>;
}

export interface GraphQLHandlerResult {
  status: number;
  body: unknown;
}

/**
 * GraphQL over HTTP 请求处理。
 * 桥接到 MockTransport.execute()，遵循 graphql-over-http 规范。
 */
export class GraphQLHandler {
  constructor(private transport: Transport) {}

  async handle(request: GraphQLRequestBody, sessionKey: string | null): Promise<GraphQLHandlerResult> {
    const { query, variables } = request;

    // 从 query 提取 field 和 type
    const { field, type: opType } = this.extractOperation(query);
    if (!field) {
      return {
        status: 422,
        body: { errors: [{ message: "Unable to extract field from GraphQL query" }] },
      };
    }

    try {
      const result = await this.transport.execute({
        field,
        type: opType,
        variables,
        sessionKey: sessionKey ?? undefined,
      });

      return {
        status: 200,
        body: { data: result },
      };
    } catch (err) {
      const error = err as Error & { source?: string; errorCode?: string };
      // 映射 HTTP 状态码
      let status = 500;
      if (error.message?.includes("no handler")) {
        status = 404;
      } else if (error.message?.includes("simulated failure")) {
        status = 500;
      } else if (error.errorCode === "RATE_LIMITED") {
        status = 429;
      } else if (error.errorCode === "AUTH_EXPIRED" || error.errorCode === "AUTH_FAILED" || error.errorCode === "AUTH_REQUIRED") {
        status = 401;
      } else if (error.errorCode === "TIMEOUT") {
        status = 504;
      } else if (error.errorCode === "FORBIDDEN") {
        status = 403;
      }

      return {
        status,
        body: {
          errors: [{
            message: error.message ?? "Internal Server Error",
            ...(error.errorCode ? { extensions: { code: error.errorCode } } : {}),
          }],
          ...(error.errorCode === "AUTH_EXPIRED" ? { data: null } : {}),
        },
      };
    }
  }

  /**
   * 从 GraphQL query 字符串提取 field 名和操作类型。
   * 兼容 query/mutation 关键字、操作名、变量声明、别名、指令。
   * 比 MockTransport.extractField 更健壮（Oracle 审查 🔴2）。
   */
  private extractOperation(query: string): { field: string | null; type: "query" | "mutation" } {
    const noComments = query.replace(/#[^\n]*/g, "").trim();

    // 检测操作类型
    let type: "query" | "mutation" = "query";
    if (/^\s*mutation\b/.test(noComments)) {
      type = "mutation";
    }

    // 提取首个顶层字段：跳过操作名、变量声明、指令
    // 匹配 { fieldName(...) 或 { alias: fieldName(...)
    const stripped = noComments
      .replace(/^\s*(?:query|mutation)\s+\w*\s*(?:\([^)]*\))?\s*(?:@\w+(?:\([^)]*\))?\s*)*/, "")
      .replace(/^\s*\{/, "{");

    // 从 selection set 中提取第一个 field（跳过 fragment spread、inline fragment）
    const match = stripped.match(/\{\s*(?:\w+\s*:\s*)?(\w+)/);
    if (!match) {
      return { field: null, type };
    }

    return { field: match[1], type };
  }
}