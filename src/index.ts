// @tkwf/tsclient-mock — Type-driven mock runtime for @tkwf/tsclient
//
// MockTransport      — Transport 层实现，按 field 分发 handler
// createMockFactory  — 类型驱动默认值生成器（递归）+ 确定性种子
// createMockDb       — 内存数据库：CRUD + where/orderBy/page 语义 + 关联图 + 状态同步
// defaultSessionHandlers — 登录链路（requestChallenge/loginByContext/loginByPassword/logout）内置 handler
// defineMock         — 类型化 handler 定义辅助

export { MockTransport } from "./mock-transport";
export type { MockHandler, MockTransportOptions } from "./mock-transport";

export { createMockFactory } from "./factory";
export type { MockFactory } from "./factory";

export { createMockDb } from "./mock-db";
export type { MockDb, DatasetSeed } from "./mock-db";

export { defaultSessionHandlers } from "./session";

export { defineMock } from "./define-mock";