import type { MockHandler } from "./mock-transport.js";

/**
 * 类型化 handler 定义辅助。
 *
 * 两种用法：
 * 1. 泛型约束（codegen 产物使用）：`defineMock<{ field; args; result }>` 在编译期约束 handler 签名
 * 2. 无泛型（现状兼容）：`defineMock(handler)` 直接透传 MockHandler
 */

/** codegen 产物的 field 契约三元组（编译期约束） */
export interface MockFieldContract<TField extends string, TArgs, TResult> {
  field: TField;
  args: TArgs;
  result: TResult;
}

/**
 * defineMock —— 类型化 handler 定义辅助。
 *
 * 泛型约束（方案 B，Oracle 审核确定）：
 * - handler 签名与现 `MockHandler` 完全一致（ctx 无 type），无运行时桥接问题
 * - 编译期：`vars` 被约束为 TContract["args"]，返回类型被约束为 TContract["result"]
 * - 生成的 handler 传入 `vars?.where` 等的类型错误会在编译时暴露
 */
export function defineMock(
  handler: MockHandler,
): MockHandler;
export function defineMock<TContract extends MockFieldContract<string, unknown, unknown>>(
  handler: (
    vars: TContract["args"] | undefined,
    ctx: { sessionKey?: string; signal?: AbortSignal },
  ) => TContract["result"] | Promise<TContract["result"]>,
): MockHandler;
export function defineMock(
  handler: MockHandler,
): MockHandler {
  return handler;
}
