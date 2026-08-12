# @tkwf/tsclient-mock — 正式开发方案（总纲）

> **状态**：✅ v1.0.0–v1.9.0 已全部开发完成并发布；主包 transport 注入点待办（见 §9）
> **方案编写**：2026-08-12（v1.0.0 原有讨论方案归档合并）
> **版本范围**：mock 包 v1.0.0–v1.9.0 + 主包 v1.1.0（transport 注入点，待办）
> **关联**：AGENTS_TKWF.md（开发规则）、G07F（ts-client 使用指南）、G07M（ts-client-mock 使用指南）

---

## 〇、版本号

| 包 | 版本 | 说明 | 状态 |
|----|------|------|------|
| `@tkwf/tsclient-mock` | v1.0.0 → **v1.9.0** | mock 运行时：Transport 注入 / 内存数据库 / 工厂 / 场景 / 录制回放 / zod 校验 / 关联过滤 / HTTP server 等 | ✅ 已发布 |
| `@tkwf/tsclient` | **v1.1.0** | minor：新增 `DomainHostClientOptions.transport` 注入点（约 5 行改动） | ⬜ 待办（另一仓库） |

> ⚠️ mock 是独立包而非内置：dev-time 工具与生产 SDK 分离，生产零携带（只进 `devDependencies`）。

---

## 一、背景与目标

### 1.1 痛点

1. **原型/demo 无后端无法跑**：WebApi 未实现时，前端 UI 无法演示可交互效果
2. **Agent 手写 mock 数据易错**：需读 4000+ 行生成文件才知道字段/类型，mock 结构易与真实接口漂移
3. **手写 mock 是"一次性代码"**：无类型安全、无完整性保证、无查询语义，demo 只能看不能点
4. **测试与开发 mock 各自为政**：单测 mock 一套、原型 mock 一套，无统一机制
5. **后端异常路径无法模拟**：错误态/加载态/HTTP 状态码（401/429/500）在无后端时无法验证

### 1.2 目标

提供一套**类型驱动的 mock 运行时**：

- **Transport 层注入**：实现 `Transport` 接口，业务代码（`Tkwf.User.Use<XxxService>()`）零改动
- **Agent 可自行填充数据**：`createMockFactory<T>()` 基于生成 DTO 类型递归生成合法默认值，Agent 只表达业务意图
- **查询语义模拟**：`createMockDb` 让 QueryBuilder 的 `where/orderBy/page` 在 mock 下真实过滤/分页
- **完整性保证**：codegen 生成全部 field 的 handler 骨架，`satisfies` + `_AssertAllFieldsCovered` 防漏
- **运行时行为切换**：场景切换（空态/错误态/加载态）、录制回放（真实数据回放）、HTTP 层模拟

### 1.3 关键设计决策

| 决策 | 结论 |
|------|------|
| 包形态 | **独立包 `@tkwf/tsclient-mock`**（依赖 tsclient，不反向） |
| 注入点 | `DomainHostClientOptions.transport?: Transport`（主包约 5 行透传） |
| 拦截位置 | Transport 接口层（`execute` / `executeRawGraphQL`），网络栈之前 |
| 数据生成 | `createMockFactory<T>` 类型驱动默认值 + overrides + 确定性种子 |
| 查询语义 | `createMockDb` 内存查询引擎（过滤/排序/分页/关联/聚合） |
| 骨架生成 | 消费端 codegen 扩展：`ts-client.mock.g.ts`（handler + schema + 工厂 + 关系骨架） |
| 会话 | `requestChallenge` / `loginByContext` / `loginByPassword` / `logout` 内置 mock 处理器 |
| 目标场景 | 原型/demo（主）、组件测试、无后端本地开发、CI 回放 |
| 扩展能力 | 场景切换、录制回放、运行时校验（zod）、关联过滤、HTTP server（v1.8.0 起纳入） |
| 仓库形态 | **独立新仓库 `tkwf-tsclient-mock`**（消费端 `file:` 引用） |
| AI 生成 | 作为**数据填充器**（类型骨架由 codegen+satisfies 保证），非类型生成器 |
| 代码纪律 | 禁止 `as any` / `@ts-ignore` / `@ts-expect-error`；只 `import type` 主包类型 |

---

## 二、业界调研（差异化定位）

> 结论：**三块能力各自成熟、从未被缝合**——本方案的差异化定位成立。

| 能力 | 成熟产品 | 缺什么 |
|------|---------|--------|
| Transport 注入层 | Apollo **MockLink**、tRPC link | 只静态匹配，无类型驱动、无内存语义 |
| 类型驱动数据工厂 | graphql-codegen `typescript-mock-data`、Fabbrica | 只生成对象，无拦截、无查询 |
| 内存查询语义 | **MirageJS**、sift.js | 无类型驱动生成，GraphQL 次级支持 |

**空白点**：
1. **不依赖 SDL schema，只依赖 codegen TS 类型**——RPC 风格客户端已有 codegen Service 接口 + DTO 类型
2. **注入点在 Transport 接口而非网络层**——Node/浏览器/Worker 通用，无需 Service Worker
3. **field 级分发 + 内存查询语义 + 关系一致性**——无人与"类型驱动 + transport 注入"结合

**借鉴设计**：确定性种子（faker/zod4-mock）、防漂移（satisfies）、关联图+状态同步（MirageJS `buildDataset`/`afterCreate`）、工厂 DSL（Fabbrica `defineXxxFactory`）、分阶段策略（原型→开发→测试）。

---

## 三、总体架构

```
@tkwf/tsclient-mock
├── Transport 层
│   ├── MockTransport          — 按 field 分发 handler + 注入 delay/failRate/error/timeout
│   ├── MockTransportOptions   — scenario / fieldOptions 配置
│   └── MockHandler            — (vars, ctx) => unknown
│
├── 内存数据库（src/mock-db.ts）
│   ├── createMockDb           — CRUD + 过滤/排序/分页/聚合
│   ├── FilterPredicate        — 26 个操作符（eq/between/mode/containsAny 等）
│   ├── registerRelation       — 关联注册（hasMany/belongsTo + inverse 双向同步）
│   └── buildDataset(strict)   — 批量导入 + FK 校验
│
├── 数据工厂（src/factory.ts）
│   ├── createMockFactory<T>   — 类型驱动默认值生成（递归 + 确定性种子）
│   └── MockFieldSchema        — 运行时字段类型描述符
│
├── 场景系统（src/scenario.ts）
│   └── createScenarioContext  — db 数据集 + transport 注入联动切换
│
├── 录制回放（src/record-replay.ts + file-recording-store.ts）
│   ├── createRecordingTransport — 装饰器（record/replay/passthrough）
│   └── RecordingStore          — 内存/文件可插拔存储
│
├── 运行时校验（src/zod.ts）
│   └── mockFieldSchemaToZod    — MockFieldSchema → zod 适配器（v4）
│
├── AI 编排（src/ai/*）
│   └── validateMock / selfHealing / detectChange
│
├── codegen 扩展（src/codegen/*）
│   ├── gen-mock-handlers（CLI）
│   ├── parse-doc / parse-service / parse-dto / inferDtoRelations
│   └── templates（db/scenarios/relations/factory/validate 骨架）
│
├── HTTP mock server（src/http-mock/*）
│   └── MockHttpServer          — node:http 零依赖 + CORS/鉴权/GraphQL over HTTP
│
└── 会话（src/session.ts）
    └── defaultSessionHandlers  — 登录链路内置 mock
```

**核心模块文件布局**：

```
src/
├── index.ts              # 全部公开导出
├── mock-transport.ts     # MockTransport + MockHandler + MockTransportOptions
├── mock-db.ts            # createMockDb + FilterInput + RelationDef + AggregateInput
├── factory.ts            # createMockFactory + MockFieldSchema
├── scenario.ts           # createScenarioContext + ScenarioConfig
├── define-mock.ts        # defineMock 类型化辅助
├── session.ts            # defaultSessionHandlers
├── record-replay.ts      # 录制回放 + 归一化器
├── file-recording-store.ts  # 文件存储
├── zod.ts                # MockFieldSchema → zod 适配器
├── ai/                   # validateMock / selfHealing / detectChange
├── codegen/              # CLI + parse + templates + generate
├── http-mock/            # MockHttpServer + 中间件 + GraphQL handler
└── *.test.ts             # vitest 全量测试
```

---

## 四、版本演进规划（执行记录）

| 版本 | 交付内容 | 测试 | 状态 |
|------|---------|------|------|
| v1.0.0 | MockTransport / createMockFactory / createMockDb / 会话 | 105 | ✅ |
| v1.1.0 | gen-mock-handlers + AI 编排（validateMock/selfHealing/detectChange）+ mock-db 过滤增强 | 105→ | ✅ |
| v1.2.0 | 场景切换（setScenario）+ 多数据集 + createScenarioContext + codegen 场景骨架 | 131 | ✅ |
| v1.3.0 | 录制回放（record-replay）+ FileRecordingStore + 归一化器 | 161 | ✅ |
| v1.4.0 | 运行时契约校验（MockFieldSchema → zod v4）+ validateMock 迁移 | 180 | ✅ |
| v1.5.0 | 查询语义增强（isNull/between/mode/containsAny/containsAll） | 191 | ✅ |
| v1.6.0 | 关联过滤嵌套（registerRelation + some/every/none） | 200 | ✅ |
| v1.7.0 | 双向同步（inverse）+ 聚合过滤（aggregate） | 209 | ✅ |
| v1.7.1 | codegen 关系推导（inferDtoRelations + registerRelation 骨架） | 211 | ✅ |
| v1.8.0 | HTTP mock server（MockHttpServer + CORS/鉴权/GraphQL over HTTP） | 224 | ✅ |
| v1.9.0 | 工厂 DSL（defineXxxFactory 骨架）+ buildDataset FK 校验（strict） | 228 | ✅ |
| **下一版** | 主包 transport 注入点落地后联调验证 | — | ⬜ |

> 每个版本独立走：开发方案 → Oracle 审核 → 开发 → 审核报告 → 提交 → tag（征求同意自动发布 npm）。

---

## 五、核心能力设计

### 5.1 createMockDb（内存数据库 + 查询语义 + 状态同步）

> 原型/demo 的可交互性依赖"mutation 后 query 看到新数据"。参考 MirageJS 的引用完整性设计。

```typescript
export function createMockDb(
  entities: DatasetSeed,
  options?: MockDbOptions,   // { seed?, datasets? }
): MockDb;

interface MockDb {
  registerQuery(field: string, table: string): void;
  registerMutation(field: string, table: string, op: "create" | "update" | "delete" | "custom"): void;
  query<T>(table: string, filter?: unknown, sort?: unknown, page?: unknown): T[];
  queryOne<T>(table: string, filter?: unknown): T | undefined;
  insert<T>(table: string, row: T): T;
  update<T>(table: string, id: string | number, patch: Partial<T>): T | undefined;
  remove(table: string, id: string | number): boolean;
  buildDataset(dataset: DatasetSeed, options?: { strict?: boolean }): void;
  reset(name?: string): void;
  switchDataset(name: string): void;
  getDatasetName(): string;
  listDatasets(): string[];
  registerRelation(table: string, field: string, relation: RelationDef): void;
  aggregate(table: string, input: AggregateInput): AggregateResult;
}
```

- **FilterInput 操作符（26 个）**：eq/neq、gt/gte/lt/lte、ngt/ngte/nlt/nlte、in/nin、contains/ncontains、startsWith/nstartsWith、endsWith/nendsWith、isTrue/isFalse、isNull、between、mode（QueryMode）、containsAny/containsAll、and/or
- **关联过滤**：`registerRelation` 声明 hasMany/belongsTo + `some`/`every`/`none` 关联查询
- **双向同步（inverse）**：insert/update/remove 时自动维护 FK 数组（不可变更新）
- **聚合查询**：`aggregate(table, { fields })` 支持 count/avg/sum/max/min + filter/where
- **状态同步（核心）**：mutation 写入 → query 立即可见；id 自增；`buildDataset({ strict: true })` 校验 FK 引用完整性

### 5.2 createMockFactory<T>（类型驱动默认值）

```typescript
export function createMockFactory<T>(options?: MockFactoryOptions<T>): MockFactory<T>;

interface MockFactory<T> {
  make(overrides?: Partial<T>): T;
  makeN(count: number, overrides?: Partial<T>): T[];
  makeMany(items: Partial<T>[]): T[];
}
```

**默认值生成规则（递归）**：

| TS 类型 | 默认值 |
|---------|--------|
| `string` | `"mock-{field}"`（id 类字段自增） |
| `number` | 固定种子序列（LCG，可复现） |
| `boolean` | `false` |
| `Date/DateTime` | 固定时间轴（`2026-01-01T00:00:00Z` 起递增） |
| `enum/union` | 第一个成员 |
| `Array` | `[]` |
| 嵌套 object | 递归生成 |

**option 支持**：`_types`（schema）/ `_enums`（枚举覆盖）/ `_seed`（确定性种子）/ `_maxDepth`（防循环）/ `_dateBase`（时间轴基准）。

### 5.3 MockTransport（按 field 分发）

```typescript
export class MockTransport implements Transport {
  constructor(
    handlers: Record<string, MockHandler>,
    options?: MockTransportOptions,   // { delayMs?, fieldOptions?, scenario?, scenarios? }
  ) {}
  async execute<T>(op): Promise<T>;
  async executeRawGraphQL<T>(query, sessionKey?, signal?): Promise<T>;
  setScenario(name: string): void;
  getScenario(): string;
  getScenarioNames(): string[];
}
```

**执行管道**：`error → failRate → delay → handler → timeout`，逐项可被 scenario 覆盖。

### 5.4 会话内置（登录链路）

```typescript
export const defaultSessionHandlers = {
  requestChallenge: () => ({ challengeToken: "mock-challenge", salt: "mock-salt" }),
  loginByContext: (vars) => ({ sessionKey: "mock-session", userName: vars?.userName ?? "mock-user" }),
  loginByPassword: (vars) => ({ /* 同 loginByContext */ }),
  logout: () => true,
};
```

### 5.5 消费端接入（dev 环境开关）

```typescript
const useMock = import.meta.env.VITE_USE_MOCK === "true";
Tkwf.configure("default", {
  endpoint: "/graphql",
  ...(useMock ? { transport: new MockTransport(handlers) } : {}),
});
```

---

## 六、扩展能力设计

### 6.1 场景切换（scenario）

场景 = **数据视图（db 数据集）+ 注入配置（transport 场景）**，以场景名关联。

```typescript
const scenario = createScenarioContext({ db, transport });
scenario.setScenario("empty");    // 空态
scenario.setScenario("error");    // 错误态
scenario.setScenario("loading");  // 加载态
```

内置场景约定：`default`（正常数据）/ `empty` / `error` / `loading`。注入优先级：`scenarios[scenario].fieldOptions?.[field] > fieldOptions?.[field] > scenarios[scenario].delayMs > delayMs`。

### 6.2 录制回放（record-replay）

三态装饰器：`record`（真实响应 + 记录）/ `replay`（确定性回放）/ `passthrough`。

```typescript
createRecordingTransport(transport, { mode, recordingName, store, normalizers });
```

匹配键：`field + type + 归一化 variables`。可插拔存储：`MemoryRecordingStore` / `FileRecordingStore`。归一化器：`normalizeTimestamps` / `normalizeUuids`。

### 6.3 运行时契约校验（zod）

`mockFieldSchemaToZod` 将 7 种 kind 递归映射为 zod v4 schema。保留语义：undefined 不报错、object 缺失字段不报错、空 enum 放行、date 兼容 Date/ISO string/number。

### 6.4 HTTP mock server

`MockHttpServer` 基于 `node:http`（零外部依赖），支持 CORS / 鉴权（Bearer）/ GraphQL over HTTP / 状态码映射（200/401/403/404/429/500/504）。

---

## 七、codegen 骨架（gen-mock-handlers）

```bash
npx gen-mock-handlers --input src/ts-client.g.ts --output src/ts-client.mock.g.ts
```

**生成产物结构**：

```
ts-client.mock.g.ts
├── createMockDb({ ... })            — 内存数据库骨架
├── scenarios / scenarioOverrides    — 场景骨架（v1.2.0）
├── XxxSchema = { ... } as const      — DTO schema 常量
├── defineXxxFactory                  — 工厂 DSL 骨架（v1.9.0）
├── validateXxx                       — 运行时校验函数（v1.4.0）
├── registerRelations(db)             — 实体关系骨架（v1.7.1）
├── handlers = { ... }                — 全部 field handler 骨架
├── satisfies Record<...>             — 编译期完整性检查
└── _AssertAllFieldsCovered           — 漏掉 API 编译报错
```

**codegen 关系推导（inferDtoRelations）**：从 DTO 类型推断 belongsTo（`merchant?: Merchant` + `merchantId` 字段）与 hasMany（`logs?: PaymentLog[]` + 反向 FK），自动生成 `registerRelation` 骨架。

---

## 八、审核要点（每版本执行）

1. **向后兼容**：新增参数全为可选，不传时行为与上一版本完全一致
2. **类型安全**：无 `as any` / `@ts-ignore` / `@ts-expect-error`；`satisfies` 保证 codegen 产物防漂移
3. **状态同步**：mutation 写入后同一查询 handler 立即可见；id 自增；buildDataset 外键一致
4. **包边界**：mock 包不 import 主包内部未导出符号；主包无 mock 依赖
5. **注入优先级**：transport > transportType > 默认 GraphQL；未注入时行为不变
6. **测试**：每版本 5–30+ 用例，全量 228 通过（15 文件）
7. **数据一致性**：inverse 同步不可变更新、快照隔离不被破坏、FK 校验（strict 模式）

---

## 九、主包 transport 注入点（待办，另一仓库）

> 消费端接入 mock 需要 `@tkwf/tsclient` 提供 Transport 注入点。当前 `Tkwf.configure()` 只支持 `endpoint`/`transportType`，没有注入自定义 Transport 的入口。

### 改动（约 5 行）

```typescript
// src/domain-host-client.ts
export interface DomainHostClientOptions {
  // ...现有字段不变
  /** 注入自定义 Transport（mock/测试用）。优先级最高，忽略 transportType/endpoint。 */
  transport?: Transport;
}

private createTransport(): Transport {
  if (this.options?.transport) return this.options.transport;  // ← 新增
  // ...原有 GraphQL/Rest 分支
}
```

### 注意事项

| 项 | 说明 |
|----|------|
| **优先级** | `transport` > `transportType` > 默认 GraphQL |
| **类型安全** | `transport` 字段类型为 `Transport` 接口，`MockTransport` 已实现，无需额外适配 |
| **未注入时** | 行为完全不变 |
| **测试** | 2 条：注入的 transport 被使用 / 未注入时行为不变 |
| **依赖关系** | 主包不依赖 mock 包；mock 包只 `import type { Transport }` 主包类型 |

---

## 十、代码纪律

- 不新增 `as any` / `@ts-ignore` / `@ts-expect-error`
- mock 包必须 `import type` 主包类型，运行时仅依赖 `Transport` 接口
- 修改后必须 `npm test` + `npm run build`
- 不允许留下未使用的导出或死代码
- 版本号手动管理：`package.json` + `git tag v{version}`（tag 前征求同意）
- 推送不自动打 tag；tag 触发 GitHub Actions 自动发布 npm（含 Sigstore 签名）

---

## 十一、文档索引

| 文档 | 位置 |
|------|------|
| 开发规则 | `Agents_TKWF.md` |
| 迭代开发过程 | `docs/迭代开发过程/V1/v{version}-*-开发方案.md` + `-审核报告.md` |
| 使用指南（G07M） | `_TKWF/docs/G07M-RPC-前端客户端-ts-client-mock-使用指南.md` |
| ts-client 使用指南（G07F） | `_TKWF/docs/G07F-RPC-前端客户端-ts-client-使用指南.md` |
| 项目 README | `README.md` |