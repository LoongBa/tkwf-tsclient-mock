# @tkwf/tsclient-mock

**类型驱动的 mock 运行时**——为 [@tkwf/tsclient](https://github.com/LoongBa/tkwf-tsclient) 提供 Transport 层注入的 mock 能力，让原型、demo、单测在**后端未实现时也能真实运行**。

```
业务代码（Tkwf.User.Use<XxxService>()）零改动
        ↓
   Transport 接口层 ← MockTransport 注入在这里（网络栈之前）
        ↓
   Mock 数据 / 内存数据库（createMockFactory / createMockDb）
```

---

## 为什么需要它

### 痛点

| 痛点 | 后果 |
|------|------|
| **WebApi 未实现，原型/demo 跑不起来** | UI 无法演示可交互效果，前端被后端阻塞 |
| **Agent 手写 mock 数据易错** | 需读 4000+ 行生成文件才知道字段/类型，mock 结构与真实接口漂移 |
| **手写 mock 是"一次性代码"** | 无类型安全、无完整性保证、无查询语义，demo 只能看不能点 |
| **测试与开发 mock 各自为政** | 单测一套 mock、原型一套 mock，无统一机制 |

### 目标

- **业务零改动**：实现 `Transport` 接口，`Tkwf.User.Use<XxxService>()` 调用链完全不变
- **Agent 可自行填充**：`createMockFactory<T>()` 基于生成 DTO 类型递归生成合法默认值，Agent 只表达业务意图（覆盖关键字段），类型/结构由工具兜底
- **查询语义真实**：`createMockDb` 让 QueryBuilder 的 `where/orderBy/page` 在 mock 下真实过滤/排序/分页
- **完整性保证**：codegen 生成全部 field 的 handler 骨架，API 不可能漏掉

### 不做什么

> **HTTP mock server 已作为 v1.8.0 功能新增**（见下方章节）。
> 以下仍不属于本包范围：

- **不做 HTTP 层 mock server（MSW 式）**——那属 ApiService 层职责，由 v1.8.0 `MockHttpServer` 在 `@tkwf/tsclient-mock` 内实现（走 `node:http`，零外部依赖）
- 不做运行时契约校验与 mock 数据的自动缝合（AI 编排场景由消费端 SKILL 落地）
- 不做多语言 mock 运行时（仅 TypeScript 消费端）

---

## 安装

```json
// package.json（dev 依赖，生产零携带）
{
  "devDependencies": {
    "@tkwf/tsclient-mock": "file:../tkwf-tsclient-mock"
  }
}
```

## 快速开始

```typescript
import { MockTransport, createMockDb, defaultSessionHandlers } from "@tkwf/tsclient-mock";
import { Tkwf } from "@tkwf/tsclient";

// 1. 建内存数据库 + 注册 field handler
const db = createMockDb({ paymentLogs: [] });
db.registerQuery("paymentLog", "paymentLogs");
db.registerMutation("createPaymentLog", "paymentLogs", "create");

// 2. 组装 MockTransport（会话用内置 handler）
const transport = new MockTransport({
  ...defaultSessionHandlers,
  paymentLog: (vars) => db.query("paymentLogs", vars?.filter, vars?.sort, vars?.page),
  createPaymentLog: (vars) => db.insert("paymentLogs", vars?.input),
}, { delayMs: 150 });

// 3. 注入 Transport —— 业务代码零感知
const useMock = import.meta.env.VITE_USE_MOCK === "true";
Tkwf.configure("default", {
  endpoint: "/graphql",
  ...(useMock ? { transport } : {}),
});
```

之后 `Tkwf.User.Use<PaymentLogService>().getList()` 照常调用，走的是 mock 数据。

---

## 核心能力

| 模块 | 能力 |
|------|------|
| `MockTransport` | 实现 `Transport`：按 field 分发 handler + `delayMs` / `failRate` / `error` 注入 + `executeRawGraphQL` 解析 |
| `createMockFactory<T>()` | 类型驱动默认值生成（递归）+ 确定性种子 + `make/makeN/makeMany` |
| `createMockDb()` | 内存数据库：CRUD + FilterInput/SortInput/分页 + 关联图 + **mutation→query 状态同步** + `queryOne` + OperationFilterInput 家族兼容 |
| `gen-mock-handlers` | 消费端 codegen 扩展：读 `ts-client.g.ts` → 生成全部 field 的 handler 骨架 `ts-client.mock.g.ts` |
| `validateMock` / `selfHealing` / `detectChange` | AI 编排基础设施：schema 校验 / 自愈重试 / 产物变更检测（不内置 LLM） |
| `defaultSessionHandlers` | 登录链路（requestChallenge / loginByContext / loginByPassword / logout）内置 mock |
| `defineMock()` | 类型化 handler 定义辅助（消费端 codegen 产物使用，泛型约束 field/args/result） |
| `createScenarioContext()` | 场景协调器：`setScenario` 联动 db 数据集 + transport 注入，一键切换默认/空态/错误态/加载态 |
| `createRecordingTransport()` | 录制回放装饰器：record/replay/passthrough 三态模式，真实请求录制 → 测试回放 |
| `mockFieldSchemaToZod()` | 运行时契约校验：`MockFieldSchema → zod` 适配器，`validateMock` 底层基于 zod safeParse |
| `registerRelation()` | 关联过滤嵌套：`registerRelation` 声明外键关系，`some`/`every`/`none` 关联查询 |
| `aggregate()` | 聚合查询：`db.aggregate(table, { fields })` 支持 count/avg/sum/max/min |
| `MockHttpServer` | HTTP mock server：基于 node:http 的轻量 HTTP 层 mock，CORS/鉴权/GraphQL over HTTP |

---

## 消费端 codegen 工作流（v1.1.0）

### 一次性生成全部 handler 骨架

```bash
npx gen-mock-handlers --input src/ts-client.g.ts --output src/ts-client.mock.g.ts
```

读取消费端 codegen 产物 `ts-client.g.ts`（主包生成），生成 `ts-client.mock.g.ts`：

- **全部 field 的 handler 骨架**（Query/Mutation 分类读 const 对象，不启发式推断）
- 每个 field 用 `defineMock<{ field; args; result }>` 约束，类型错误编译期暴露
- 生成 `createMockDb` 内存数据库 + DTO → `MockFieldSchema` 推导（`_types`）
- 编译期完整性检查：`_AssertAllFieldsCovered` —— 主包 codegen 新增 field 后重跑本命令，漏掉的 API 直接编译报错

生成后的骨架：

```typescript
export const db = createMockDb({ paymentLogs: [] });

export const handlers = {
  paymentLogs: defineMock<{ field: "paymentLogs"; args: PaymentLogsArgs; result: PaymentLogConnection }>(
    (vars) => db.query("paymentLogs", vars?.where, vars?.order, { first: vars?.first, after: vars?.after }),
  ),
  createPaymentLog: defineMock<{ field: "createPaymentLog"; args: CreatePaymentLogInput; result: PaymentLog }>(
    (vars) => db.insert("paymentLogs", vars),
  ),
} satisfies Record<keyof typeof Query | keyof typeof Mutation, MockHandler>;
```

骨架遵循的语义映射：

| field 特征 | 生成骨架 |
|-----------|---------|
| `query` + 返回 `XxxConnection` | `db.query("xxx", args.where, args.order, { first, after })` |
| `query` + 返回单实体 | `db.queryOne("xxx", args.where)` |
| `mutation` + args 含 `input` | `db.insert("xxx", args.input)` |
| `mutation` + 命名 create/update/delete | `db.insert` / `db.update(table, id, patch)` / `db.remove(table, id)` |
| 无法归类 | `db.query("xxx")` + 注释"待 Agent 填充" |

### AI 编排基础设施（`src/ai/`）

不内置 LLM 调用，为消费端 AI/Agent 填充提供三层能力（`validateMock` / `selfHealing` / `detectChange`）：

```typescript
import { validateMock, selfHealing, detectChange } from "@tkwf/tsclient-mock";

// 1. 校验：mock 数据是否符合 DTO schema（复用 MockFieldSchema）
const { ok, errors } = validateMock(agentData, dtoSchema);

// 2. 自愈：schema 校验失败自动重新生成（LLM/工厂可注入，默认重试 3 次）
const data = await selfHealing({
  schema: dtoSchema,
  generator: () => llmFill(prompt, dtoSchema),   // LLM 调用由消费端 SKILL 落地
});

// 3. 变更检测：codegen 产物 sha256 hash 与 sidecar 文件（<output>.hash）比对
const { hash, changed } = await detectChange(readFileSync("src/ts-client.g.ts", "utf-8"));
if (changed) console.log("codegen 产物已变更，请重新执行 gen-mock-handlers");
```

AI 填充工作流：`gen-mock-handlers` 生成骨架 → Agent 填充业务意图（覆盖关键字段）→ `validateMock` 校验 → 失败由 `selfHealing` 重试 → `detectChange` 感知主包 codegen 产物变更。

---

## 场景切换（v1.2.0）

运行时切换 mock 行为：默认态（正常数据）/ 空态（空数据）/ 错误态（注入 error）/ 加载态（长延迟）——不重启、不改代码、零业务改动。

### 核心概念

- **场景** = `数据视图（db 数据集）` + `注入配置（transport 注入）`，以场景名关联
- 四种内置场景约定：`default`（正常数据 + 无注入）、`empty`（空数据）、`error`（注入 error/failRate）、`loading`（长 delayMs）
- **消费端可自定义扩展**任意场景名（如 `"emptyLoading"` 同时设空数据 + 长延迟）

### 多数据集（`createMockDb`）

```typescript
const db = createMockDb(
  { paymentLogs: [] },                             // default 数据集
  {
    datasets: {
      default: { paymentLogs: [{ id: 1, status: "ok", amount: 100 }] },
      empty: { paymentLogs: [] },
    },
  },
);

db.switchDataset("empty");     // 切换到空数据
db.getDatasetName();           // → "empty"
db.listDatasets();             // → ["default", "empty"]
db.reset();                    // 重置当前活跃数据集到初始快照
db.reset("default");           // 切换到 default 并重置
```

### 场景注入（`MockTransport`）

```typescript
const transport = new MockTransport(handlers, {
  scenarios: {
    error: {
      fieldOptions: {
        paymentLogs: { error: new Error("数据库不可用") },
      },
    },
    loading: { delayMs: 3000 },
  },
});

transport.setScenario("error");     // 切换错误态
transport.getScenario();            // → "error"
transport.getScenarioNames();       // → ["default", "error", "loading"]
```

**注入优先级**（逐项覆盖，场景优先）：

```
error:     scenarios[scenario].fieldOptions?.[field]?.error ?? scenarios[scenario].error ?? fieldOptions?.[field]?.error
failRate:  scenarios[scenario].fieldOptions?.[field]?.failRate ?? fieldOptions?.[field]?.failRate
delayMs:   scenarios[scenario].fieldOptions?.[field]?.delayMs ?? scenarios[scenario].delayMs ?? fieldOptions?.[field]?.delayMs ?? delayMs
timeoutMs: scenarios[scenario].fieldOptions?.[field]?.timeoutMs ?? fieldOptions?.[field]?.timeoutMs
```

### handler 感知场景

`ctx.scenario` 可选字段，handler 内部可据此返回差异化数据：

```typescript
const handlers = {
  paymentLogs: (vars, ctx) => {
    if (ctx.scenario === "error") {
      return { nodes: [], totalCount: 0, pageInfo: {} };  // 错误态返回空列表
    }
    return db.query("paymentLogs", vars?.where, vars?.order, { first: vars?.first });
  },
};
```

### 场景协调器（`createScenarioContext`）

一键联动 db 数据集 + transport 注入：

```typescript
const db = createMockDb({ paymentLogs: [] }, {
  datasets: {
    default: { paymentLogs: [{ id: 1, status: "ok" }] },
    empty: { paymentLogs: [] },
  },
});
const transport = new MockTransport(handlers, {
  scenarios: {
    error: { fieldOptions: { paymentLogs: { error: new Error("boom") } } },
    loading: { delayMs: 3000 },
  },
});

const scenario = createScenarioContext({ db, transport });

scenario.setScenario("empty");    // 一起切换：数据变空 + 注入不变
scenario.setScenario("error");    // 数据正常 + 注入 error
scenario.setScenario("loading");  // 数据正常 + 长延迟
```

协调器自动保证原子性：校验优先（场景名必须存在于 db 或 transport 至少一侧），切换失败时回滚已成功的一侧。

### codegen 场景骨架

`gen-mock-handlers` 生成的 `ts-client.mock.g.ts` 产物新增两段，供消费端 Agent 填充：

```typescript
// ── 场景数据集骨架（数据留 Agent 填充） ──
export const scenarios = {
  default: { paymentLogs: [] satisfies PaymentLog[], ... },
  empty:   { paymentLogs: [] satisfies PaymentLog[], ... },
};

// ── 场景注入配置骨架 ──
export const scenarioOverrides: Record<string, ScenarioConfig> = {
  error:   { fieldOptions: { /* TODO: Agent 按 field 填 error / failRate */ } },
  loading: { delayMs: 3000 },
};
```

### 分阶段策略指南

| 阶段 | 场景组合 | 说明 |
|------|---------|------|
| 原型 | `setScenario("default")` + 简单数据 | 快速验证 UI 交互，数据不严格但可交互 |
| 开发 | 自定义场景：`datasets.local` + `scenarios.dev` | 本地调试数据，可叠加错误态验证异常路径 |
| 测试 | `setScenario("empty")` / `setScenario("error")` | 确定性的空态/错误态，无需改代码切换 |

场景切换 = 运行时行为，不涉及代码变更或重新生成。原型→开发→测试的过度只需切场景名，业务代码零改动。

---

## 与其它类似项目的差异

### 业界现状：三块各自成熟的拼图

| 能力 | 成熟产品 | 缺什么 |
|------|---------|--------|
| Transport 注入层 | Apollo **MockLink**（最接近）、tRPC link（官方无 mock，#2468 wontfix）、Apollo SchemaLink | 只静态匹配，无类型驱动、无内存语义 |
| 类型驱动数据工厂 | graphql-codegen `typescript-mock-data`、Fabbrica、zod4-mock、TypeBox | 只生成对象，无拦截、无查询 |
| 内存查询语义 | **MirageJS**（ORM+引用完整性）、sift.js（MongoDB 操作符→数组过滤） | 无类型驱动生成，GraphQL 次级支持 |

### 差异化：三块拼图的缝合点

**1. 不依赖 SDL schema，只依赖 codegen TS 类型**

Apollo / graphql-tools 全卡在"必须有完整 schema"。RPC 风格客户端消费端**已有 codegen Service 接口 + DTO 类型**，本包从 TS 类型直接出发，schema 无关。

**2. 注入点在 Transport 接口而非网络层**

比 MSW 更接近协议语义：无需 Service Worker，Node / 浏览器 / Worker 全环境通用；业务代码不感知 mock 存在。这是 tRPC 官方欠账（#2468 wontfix）的空白。

**3. field 级分发 + 内存查询语义 + 关系一致性**

Mirage 证明了 mutation→query 联动是刚需，但**无人把"类型驱动生成 + transport 注入 + 内存查询"三者缝合**——这正是本包的定位。

### 优势

- ✅ **零业务改动**：Transport 层注入，调用链不变
- ✅ **类型即契约**：`satisfies` + codegen 重生成 → 字段变化编译报错，防漂移
- ✅ **可交互 demo**：mutation 后 query 立即可见新数据（不是静态假数据）
- ✅ **环境无关**：Node/浏览器/Worker 通用，无 Service Worker 依赖
- ✅ **确定性可复现**：种子固定 → 本地固定、CI 用 run-id
- ✅ **生产零携带**：独立包 + devDependencies，生产不打包

### 局限

- ❌ **不适用**：需要真实 HTTP 语义（CORS/中间件/鉴权链路）的场景
- ❌ **查询语义子集**：FilterInput 覆盖常用操作符，非常规 GraphQL 过滤需自定义 handler
- ❌ **运行时契约校验缺位**：TS 类型 → zod 的运行时校验（P4）未实现，mock 数据绕过真实 schema 校验

---

## 录制回放（v1.3.0）

真实后端的请求/响应录制 → 测试时确定性回放，测试用真实数据而非手工 mock。

### 三态模式

| 模式 | 行为 |
|------|------|
| `record` | 走真实 Transport，记录请求/响应（含错误） |
| `replay` | 从录制数据匹配请求，返回录制响应（不依赖后端） |
| `passthrough` | 直通真实 Transport，不记录 |

### 快速开始

```typescript
import { createRecordingTransport, FileRecordingStore, normalizeTimestamps } from "@tkwf/tsclient-mock";

// 1. 录制：真实后端 → 文件
const recordTransport = createRecordingTransport(realTransport, {
  mode: "record",
  recordingName: "payment-flow",
  store: new FileRecordingStore("./recordings"),
  normalizers: {
    normalizeResult: (result) => normalizeTimestamps(normalizeTimestamps(result)),  // 时间戳归一化
  },
});
const store = new FileRecordingStore("./recordings");
store.start("payment-flow");
await recordTransport.execute({ field: "paymentLogs", type: "query", variables: { first: 10 } });
store.stop();

// 2. 回放：测试时从文件加载，确定性返回
const replayTransport = createRecordingTransport(mockTransport, {
  mode: "replay",
  recordingName: "payment-flow",
  store: new FileRecordingStore("./recordings"),
});
const result = await replayTransport.execute({ field: "paymentLogs", type: "query", variables: { first: 10 } });
// result = 录制时的真实响应
```

### 匹配与消费

- **匹配键**：`field + type + 归一化 variables`（variables 键排序、`undefined`→`{}`）
- **有序（默认）**：FIFO 消费录制条目，`maxUsageCount` 控制单条可消费次数
- **无序（`order: false`）**：polling 场景，取第一个可消费条目（确定性）
- **未命中**：触发 `onMiss` 回调 + 抛错
- **错误条目**：回放时抛 `MockRecordingError`（携带 `source`/`errorCode`）

### 归一化

非确定性字段（时间戳/UUID）录制时替换为固定占位符，回放可重复：

```typescript
import { normalizeTimestamps, normalizeUuids } from "@tkwf/tsclient-mock";

normalizeTimestamps("2026-05-01T12:00:00.000Z");  // → "2026-01-01T00:00:00.000Z"
normalizeUuids("550e8400-e29b-41d4-a716-446655440000");  // → "00000000-0000-0000-0000-000000000000"
```

> 提示：归一化器默认用于 `normalizeResult`（避免误伤 variables 中的合法业务 ID/时间戳）。

### 存储

- **内存**（默认）：`MemoryRecordingStore`，进程内
- **文件**：`FileRecordingStore(dir)`，`<dir>/<name>.json` 每文件一录制
- **自定义**：实现 `RecordingStore` 接口 + `configureRecordingStore()` 注入（复用 `configureSidecar` 模式）

---

## 运行时契约校验（v1.4.0）

mock 数据经过**真实 schema 校验**（基于 zod v4），AI 填充错误被自愈重试捕获。

### MockFieldSchema → zod 适配器

`mockFieldSchemaToZod(schema)` 将 7 种 kind（string/number/boolean/date/enum/array/object）递归映射为 zod schema：

```typescript
import { mockFieldSchemaToZod, validateWithZod } from "@tkwf/tsclient-mock";

// 直接校验数据
const result = validateWithZod(PaymentLogSchema, agentData);
if (!result.ok) {
  console.log(result.errors);   // ["$.status: Invalid option: expected one of ..."]
  console.log(result.issues);   // [{ code, path, message }] 结构化问题
}
```

### 语义保留（对齐旧 validateMock）

| 语义 | 实现 |
|------|------|
| `undefined` 不报错（未填充） | 顶层 `.optional()` |
| object 缺失/多出字段不报错 | `.partial()` + strip |
| 空 `enumValues` 放行 | 降级 `z.union([z.string(), z.number()])` |
| date 兼容 Date / ISO string / number 时间戳 | `z.union([z.iso.datetime(), z.date(), z.number()])` |

### codegen 运行时校验骨架

`gen-mock-handlers` 生成的产物新增 `validateXxx(data)` 辅助函数（动态 import，不调用不加载 zod）：

```typescript
const result = await validatePaymentLog(agentData);  // zod safeParse 结果
if (!result.success) console.log(result.error.issues);
```

### 依赖

`zod@^4` 作为 **peerDependency**——消费端需自行安装（仅校验功能需要）：

```bash
npm install --save-dev zod@^4
```

---

## 未来规划（版本路线图）

> 每个版本独立走：开发方案 → 审核 → 开发 → 审核报告 → 提交（见 `docs/迭代开发过程/V{主版本}/`）。
> 当前实现 = v1.4.0 内容。

| 版本 | 内容 | 说明 |
|------|------|------|
| **v1.0.0** | 三大核心（MockTransport / createMockFactory / createMockDb） | ✅ 已实现 |
| **v1.1.0** | 消费端 codegen 扩展（`gen-mock-handlers`）+ AI 编排基础设施（validateMock / selfHealing / detectChange）+ mock-db 过滤桥接增强 | ✅ 已实现 |
| **v1.2.0** | 场景切换（`setScenario`）+ 分阶段策略落地 | ✅ 已实现 |
| **v1.3.0** | 录制回放（record-replay） | ✅ 已实现 |
| **v1.4.0** | 运行时契约校验（TS 类型 → zod） | ✅ 已实现 |
| **v1.5.0** | 查询语义增强（FilterInput 操作符扩展） | ✅ 已实现 |
| **v1.6.0** | 关联过滤嵌套（some/every/none） | ✅ 已实现 |
| **v1.7.0** | 关系增强（双向同步 + codegen 关系推导 + 聚合过滤） | ✅ 已实现 |
| **v1.8.0** | HTTP mock server（基于 node:http 的轻量 HTTP 层 mock） | ✅ 已实现 |

主包 `@tkwf/tsclient` v1.1.0：`DomainHostClientOptions.transport` 注入点（另一仓库，独立迭代）。

---

## 开发

```bash
npm install     # 安装依赖（含 file: 本地 @tkwf/tsclient）
npm test        # vitest 全量测试
npm run build   # tsc 构建 dist/
```

开发规则见 [Agents_TKWF.md](./Agents_TKWF.md)。

## License

MIT © LoongBa
