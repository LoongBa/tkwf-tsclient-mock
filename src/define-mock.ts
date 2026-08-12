import type { MockHandler } from "./mock-transport";

/**
 * 类型化 handler 定义辅助。
 *
 * 消费端 codegen 产物使用：
 * ```ts
 * export const paymentLogHandler = defineMock<PaymentLogQuery>((vars, ctx) => { ... });
 * ```
 */
export function defineMock(
  handler: MockHandler,
): MockHandler {
  return handler;
}