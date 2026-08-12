// @tkwf/tsclient-mock — Type-driven mock runtime for @tkwf/tsclient
//
// MockTransport      — Transport 层实现，按 field 分发 handler
// createMockFactory  — 类型驱动默认值生成器（递归）+ 确定性种子
// createMockDb       — 内存数据库：CRUD + where/orderBy/page 语义 + 关联图 + 状态同步
// defaultSessionHandlers — 登录链路（requestChallenge/loginByContext/loginByPassword/logout）内置 handler
// defineMock         — 类型化 handler 定义辅助

export { MockTransport } from "./mock-transport.js";
export type { MockHandler, MockTransportOptions } from "./mock-transport.js";

export { createMockFactory } from "./factory.js";
export type { MockFactory, MockFactoryOptions, MockFieldSchema } from "./factory.js";

export { createMockDb, encodeCursor, decodeCursor } from "./mock-db.js";
export type {
  MockDb,
  MockDbOptions,
  DatasetSeed,
  FilterPredicate,
  FilterInput,
  QueryMode,
  SortInput,
  CursorPage,
  OffsetPage,
  PageInput,
} from "./mock-db.js";

export { defaultSessionHandlers } from "./session.js";

export { defineMock } from "./define-mock.js";
export type { MockFieldContract } from "./define-mock.js";

export { createScenarioContext } from "./scenario.js";
export type { ScenarioContext, ScenarioConfig, FieldOption, BuiltinScenario } from "./scenario.js";

export { validateMock, selfHealing, detectChange, sha256, configureSidecar } from "./ai/index.js";
export type { ValidateResult, SidecarStore } from "./ai/index.js";

export {
  createRecordingTransport,
  configureRecordingStore,
  normalizeTimestamps,
  normalizeUuids,
  MemoryRecordingStore,
  MockRecordingError,
} from "./record-replay.js";
export type {
  Recording,
  RecordingStore,
  RecordedEntry,
  RecordingMode,
  RecordingTransportOptions,
} from "./record-replay.js";

export { FileRecordingStore } from "./file-recording-store.js";

export { mockFieldSchemaToZod, validateWithZod } from "./zod.js";
export type { ValidateIssue, ValidateWithZodResult } from "./zod.js";