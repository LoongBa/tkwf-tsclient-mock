# v1.1.0 — tsclient-mock 开发方案（独立包 @tkwf/tsclient-mock）

> **状态**：待开发
> **方案编写**：2026-08-12
> **版本**：主包 v1.1.0（transport 注入点） + mock 包 v1.0.0（新包）

---

## 〇、版本号

| 包 | 版本 | 说明 |
|----|------|------|
| `@tkwf/tsclient` | **v1.1.0** | minor：新增 `DomainHostClientOptions.transport` 注入点 |
| `@tkwf/tsclient-mock` | **v1.0.0** | 新包：MockTransport / createMockFactory / createMockDb |

> ⚠️ mock 是独立包而非内置：dev-time 工具与生产 SDK 分离，生产零携带（只进 `devDependencies`）。

---

## 一、背景与目标

### 1.1 痛点

1. **原型/demo 无后端无法跑**：WebApi 未实现时，前端 UI 无法演示可交互效果
2. **Agent 手写 mock 数据易错**：需读 4000+ 行生成文件才知道字段/类型，mock 结构易与真实接口漂移
3. **手写 mock 是"一次性代码"**：无类型安全、无完整性保证、无查询语义，demo 只能看不能点
4. **测试与开发 mock 各自为政**：单测 mock 一套、原型 mock 一套，无统一机制

### 1.2 目标

提供一套**类型驱动的 mock 运行时**：

- **Transport 层注入**：实现 `Transport` 接口，业务代码（`Tkwf.User.Use<XxxService>()`）零改动
- **Agent 可自行填充数据**：`createMockFactory<T>()` 基于生成 DTO 类型递归生成合法默认值，Agent 只表达业务意图（覆盖关键字段），类型/结构由工具兜底——**适合制做原型、demo**
- **查询语义模拟**：`createMockDb` 让 QueryBuilder 的 `where/orderBy/page` 在 mock 下真实过滤/分页
- **完整性保证**：codegen 生成全部 field 的 handler 骨架，Agent 不可能漏掉 API

### 1.3 关键设计决策

| 决策 | 结论 |
|------|------|
| 包形态 | **独立包 `@tkwf/tsclient-mock`**（依赖 tsclient，不反向） |
| 注入点 | `DomainHostClientOptions.transport?: Transport`（主包 5 行透传） |
| 拦截位置 | Transport 接口层（`execute` / `executeRawGraphQL`），网络栈之前 |
| 数据生成 | `createMockFactory<T>` 类型驱动默认值 + overrides |
| 查询语义 | `createMockDb` 内存数组 + 过滤/排序/分页 |
| 骨架生成 | 消费端 codegen 扩展：`ts-client.mock.g.ts`（全部 field handler 骨架） |
| 会话 | `requestChallenge` / `loginByContext` / `loginByPassword` / `logout` 内置 mock 处理器 |
| 目标场景 | 原型/demo（主）、单元测试、无后端本地开发 |
| 排除 | **不做 HTTP 层 mock server**（MSW 式）——那属 ApiService 层职责（内存数据/内存数据库 mock 应由后端提供） |
| 仓库形态 | **独立新仓库 `tkwf-tsclient-mock`**（与主包单仓单包同构，消费端 `file:` 引用加一条零成本） |
| AI 生成 | 作为**数据填充器**（类型骨架由 codegen+satisfies 保证，AI 只填值增强真实感），非类型生成器 |

---

## 一·五、业界调研（2026-08-12）

> 结论：**三块能力各自成熟、从未被缝合**——本方案的差异化定位成立。

### 1.5.1 业界现状（三块各自成熟的拼图）

| 能力 | 成熟产品 | 缺什么 |
|------|---------|--------|
| Transport 注入层 | Apollo **MockLink**（最接近）、tRPC link（官方无 mock，#2468 wontfix）、Apollo SchemaLink（需 SDL） | 只静态匹配，无类型驱动、无内存语义 |
| 类型驱动数据工厂 | graphql-codegen `typescript-mock-data`、Fabbrica、zod4-mock、TypeBox | 只生成对象，无拦截、无查询 |
| 内存查询语义 | **MirageJS**（ORM+引用完整性）、sift.js（MongoDB 操作符→数组过滤） | 无类型驱动生成，GraphQL 次级支持 |

### 1.5.2 空白点（本方案差异化）

1. **不依赖 SDL schema，只依赖 codegen TS 类型**——Apollo/graphql-tools 全卡在"必须有完整 schema"；RPC 风格客户端消费端已有 codegen Service 接口 + DTO 类型，可从 TS 类型直接出发
2. **注入点在 Transport 接口而非网络层**——比 MSW 更接近协议语义，无需 Service Worker，Node/浏览器/Worker 通用；tRPC 官方欠账（#2468 wontfix）
3. **field 级分发 + 内存查询语义 + 关系一致性**——Mirage 证明 mutation→query 联动是刚需，但无人与"类型驱动 + transport 注入"结合

### 1.5.3 借鉴的成熟设计

| 设计 | 来源 | 落地 |
|------|------|------|
| 确定性种子 | faker.seed(42) / zod4-mock | `createMockFactory` 支持 seed，本地固定、CI 用 run-id |
| 防漂移 | `satisfies` + codegen 重生成 | 工厂返回类型=生成 DTO，字段变化编译报错 |
| 关联图 + 状态同步 | MirageJS `buildDataset()`/`afterCreate` | `createMockDb` 支持外键一致的图构建 + **mutation→query 联动（v1.0.0 核心）** |
| 工厂 DSL | Fabbrica `defineXxxFactory({defaultFields, traits})` | 消费端 codegen 生成 `defineXxxFactory` 骨架 |
| 分阶段策略 | 原型(工厂+satisfies) → 开发(种子+Storybook) → 测试(Pact/HAR) | mock 包 v1.0.0 聚焦原型期，Pact/HAR 导入留扩展 |

### 1.5.4 AI 生成 mock（Airbnb @generateMock 实践）

- **价值**：增强"真实感"——随机 Faker 数据技术上有效但上下文无意义
- **前提**：类型骨架已存在（codegen + satisfies）——AI 只做**数据填充器**，不做**类型生成器**
- **流程**：类型骨架 → 产品 hint 组织为 prompt → LLM 输出 → schema 验证 → 自愈重试 → hash 检测变更重新生成
- **v1.0.0 范围**：提供工厂 API 使 AI 填充成为可能（`make({...})` 一行覆盖），AI 编排层留给消费端/SKILL 指引

---

## 二、范围

### 2.1 主包 `@tkwf/tsclient` v1.1.0

| 范围 | 说明 |
|------|------|
| `DomainHostClientOptions.transport` | 新增字段：注入自定义 Transport，优先级最高，忽略 transportType |
| `createTransport()` | 透传注入的 transport |
| 测试 | 注入的 transport 被使用；未注入时行为不变 |
| 文档 | README 说明注入点用途（mock/测试） |

### 2.2 mock 包 `@tkwf/tsclient-mock` v1.0.0（独立新仓库 `github.com/LoongBa/tkwf-tsclient-mock`）

> 依赖 `@tkwf/tsclient`（仅 import 已公开导出：`Transport` / `DomainClientUserOptions` / `DomainClientError`）。消费端安装：`"@tkwf/tsclient-mock": "file:../../tkwf-tsclient-mock"`。

| 范围 | 说明 |
|------|------|
| `MockTransport` | 实现 `Transport`：按 field 分发 handlers + 延迟/失败注入 |
| `createMockFactory<T>()` | 类型驱动默认值生成器（递归）+ 确定性种子 |
| `createMockDb()` | **内存数据库：CRUD + where/orderBy/page 语义 + 关联图 + mutation→query 状态同步（v1.0.0 核心）** |
| 会话内置 | 登录链路（requestChallenge/loginByContext/loginByPassword/logout）handler 模板 |
| `defineMock<Fn>()` | 类型化 handler 定义辅助（消费端 codegen 产物使用） |
| 测试 | vitest 覆盖分发/延迟/查询语义/会话/种子确定性 |
| 文档 | 包内 README + SKILL mock 章节（tkwf-tsclient SKILL 引用） |

### 2.3 不包含（留给消费端/后续）

- 消费端 codegen 扩展脚本（`gen-mock-handlers.ts`）——方案固化后作为消费端脚手架迭代
- 场景切换（`setScenario`）/ 录制回放（record-replay）——P3，不在 v1.0.0
- 运行时契约校验（TS 类型 → zod）——P4，不在 v1.0.0

---

## 三、方案设计

### 3.1 主包：transport 注入点（v1.1.0）

```typescript
// src/domain-host-client.ts
export interface DomainHostClientOptions {
  // ...现有字段
  /** 注入自定义 Transport（mock/测试用）。优先级最高，忽略 transportType。 */
  transport?: Transport;
}

private createTransport(): Transport {
  if (this.transportOverride) return this.transportOverride;  // ← 新增
  // ...原有 GraphQL/Rest 分支
}
```

`TkwfConfig extends DomainHostClientOptions` 自动获得该能力：

```typescript
Tkwf.configure("default", {
  endpoint: "/graphql",
  transport: mockTransport,   // 注入 mock，业务代码零改动
});
```

### 3.2 MockTransport（按 field 分发）

```typescript
// src/mock-transport.ts（@tkwf/tsclient-mock）
import type { Transport } from "@tkwf/tsclient";

export type MockHandler = (
  variables: Record<string, unknown> | undefined,
  ctx: { sessionKey?: string; signal?: AbortSignal },
) => unknown;

export class MockTransport implements Transport {
  constructor(
    handlers: Record<string, MockHandler>,
    options?: {
      /** 全局模拟延迟（ms） */
      delayMs?: number;
      /** per-field 覆盖：延迟/错误注入 */
      fieldOptions?: Record<string, { delayMs?: number; error?: unknown; failRate?: number }>;
    },
  ) {}

  async execute<T>(op: {
    field: string; type: "query" | "mutation";
    variables?: Record<string, unknown>; sessionKey?: string; signal?: AbortSignal;
  }): Promise<T> {
    // 1. 查 fieldOptions：delayMs / failRate / error
    // 2. 查 handlers[field]：无则抛 "Mock: no handler for <field>"
    // 3. 调用 handler，返回 as T
  }

  async executeRawGraphQL<T>(query: string, sessionKey?: string): Promise<T> {
    // QueryBuilder 走这里：从 query 字符串提取 field 名（首个标识符），复用 execute()
  }
}
```

### 3.3 createMockFactory<T>（类型驱动默认值）

```typescript
// src/factory.ts（@tkwf/tsclient-mock）
export function createMockFactory<T>(defaults?: Partial<T>): MockFactory<T>;

interface MockFactory<T> {
  /** 生成一条：默认值 + overrides 合并 */
  make(overrides?: Partial<T>): T;
  /** 生成 n 条：id 自增（mock-1, mock-2...） */
  makeN(count: number, overrides?: Partial<T>): T[];
  /** 显式列表 */
  makeMany(items: Partial<T>[]): T[];
}
```

**默认值生成规则（递归）**：

| TS 类型 | 默认值 |
|---------|--------|
| `string` | `"mock-{field}"`（id 类字段自增） |
| `number` | 固定种子序列（可复现） |
| `boolean` | `false` |
| `Date/DateTime` | 固定时间轴（`2026-01-01T00:00:00Z` 起递增） |
| `enum/union` | 第一个成员 |
| `Array` | `[]` |
| 嵌套 object | 递归生成 |
| `null/undefined` 可选 | `undefined`（不生成） |

> **Agent 填充体验**：`paymentFactory.make({ status: "SUCCESS" })` —— 只表达业务意图，其余 29 个字段自动合法。

### 3.4 createMockDb（内存数据库 + 查询语义 + 状态同步）—— v1.0.0 核心

> **为什么是核心**：原型/demo 的可交互性依赖"mutation 后 query 看到新数据"（新建后列表刷新、删除后消失）。静态 handler 做不到，`createMockDb` 是让原型从"演示"升级为"可交互"的关键。参考 MirageJS 的引用完整性设计。

```typescript
// src/mock-db.ts（@tkwf/tsclient-mock）
export function createMockDb<T extends Record<string, unknown>>(
  entities: Record<string, MockFactory<unknown> | unknown[]>,
  options?: {
    /** 确定性种子：固定值可复现，CI 用 run-id */
    seed?: number;
  },
): MockDb;

interface MockDb {
  /** 注册查询 handler：field → 从表读取（支持过滤/排序/分页） */
  registerQuery(field: string, table: string): void;
  /** 注册变更 handler：field → 写入表（CRUD），写后 query 立即可见 */
  registerMutation(
    field: string,
    table: string,
    op: "create" | "update" | "delete" | "custom",
  ): void;

  /** 分页/列表语义：解析 where/orderBy/page 参数 */
  query<T>(table: string, filter?: unknown, sort?: unknown, page?: unknown): T[];
  /** 直接操作（供自定义 handler / 种子数据使用） */
  insert<T>(table: string, row: T): T;
  update<T>(table: string, id: string | number, patch: Partial<T>): T | undefined;
  remove(table: string, id: string | number): boolean;
  /** 关联图构建：批量生成外键一致的图（参考 MirageJS buildDataset） */
  buildDataset(dataset: DatasetSeed): void;
  /** 重置到初始种子状态（测试/热重载） */
  reset(): void;
}
```

- **FilterInput 解析**：利用生成 TS 的 `{Entity}FilterInput` 类型结构（`eq/neq/contains/gt/gte/lt/lte/in/nin`）
- **排序**：`{Entity}SortInput` 结构（`asc/desc`）
- **分页**：`first/after`（游标）与 `page/size` 双模式
- **QueryBuilder（executeRawGraphQL）**：提取 field 名 → 同一套查询语义，链式查询在 mock 下真实过滤
- **状态同步（核心）**：`registerMutation` 的 handler 写入表 → 同一 `MockDb` 上的查询 handler 立即可见（**mutation→query 联动**）；`id` 自增、外键关系由 `buildDataset` 保证一致性
- **自定义 mutation**：`op: "custom"` 时 handler 自由操作 `db`，覆盖复杂业务（如"锁定用户"→ update status）

### 3.5 会话内置（登录链路）

```typescript
// src/session.ts（@tkwf/tsclient-mock）
export const defaultSessionHandlers = {
  requestChallenge: () => ({ challengeToken: "mock-challenge", salt: "mock-salt" }),
  loginByContext: (vars) => ({
    sessionKey: "mock-session",
    userName: (vars as { userName?: string })?.userName ?? "mock-user",
  }),
  loginByPassword: (vars) => ({ /* 同 loginByContext */ }),
  logout: () => true,
};
```

### 3.6 消费端接入（dev 环境开关）

```typescript
// main.tsx —— 按环境变量切换，业务代码零感知
const useMock = import.meta.env.VITE_USE_MOCK === "true";
Tkwf.configure("default", {
  endpoint: "/graphql",
  storage: localStorage,
  ...(useMock ? { transport: mockTransport } : {}),
  onUnauthorized: () => navigate("/login"),
});
```

### 3.7 Agent 填充规范（SKILL mock 章节）

```
## Mock 数据填充（原型/demo/无后端）
1. codegen 刷新（npm run codegen）
2. 用 createMockFactory<T>() 生成合法默认值，只覆盖业务关键字段
3. 登录链路用 defaultSessionHandlers（内置）
4. 遵循：id 用 mock- 前缀、枚举用真实枚举值、日期用固定时间轴
5. tsc 0 error —— 类型即契约
```

---

## 四、审核要点

1. **注入点**：`transport` 注入后 `createTransport()` 是否优先返回；未注入时 GraphQL/Rest 行为不变
2. **MockTransport 分发**：未知 field 是否清晰报错；delay/failRate/error 是否生效
3. **executeRawGraphQL**：QueryBuilder 的 field 提取是否正确（`query { paymentLog(...) }` → `paymentLog`）
4. **createMockFactory**：默认值递归生成是否合法（无 `as any`）；overrides 深合并；makeN id 自增
5. **createMockDb**：FilterInput 的 eq/contains/gt 等操作符解析正确；排序/分页正确
6. **createMockDb 状态同步（核心）**：registerMutation 写入后同一查询 handler 立即可见；id 自增；buildDataset 外键一致；reset 回到种子状态
7. **会话链路**：loginAs → requestChallenge + loginByContext 完整可走通；sessionKey 持久化
8. **包边界**：mock 包不 import 主包内部未导出符号；主包无 mock 依赖
9. **测试**：主包注入点 2+ 测试；mock 包分发/延迟/查询语义/状态同步/会话各 3+ 测试

---

## 五、代码纪律

- 不新增 `as any` / `@ts-ignore` / `@ts-expect-error`
- mock 包必须 `import type` 主包类型，运行时仅依赖 `Transport` 接口
- 修改后必须 `npm test` + `npm run build`（两个包各自执行）
- 不允许留下未使用的导出或死代码
- mock 包发布 `v1.0.0`，主包发布 `v1.1.0`（tag 前征求同意）

---

## 六、执行记录

| 步骤 | 完成 | 说明 |
|------|------|------|
| 业界调研 | ✅ | Apollo MockLink / MirageJS / typescript-mock-data / zod4-mock / MSW 生态，空白点已确认（见 §1.5） |
| 仓库形态决策 | ✅ | 独立新仓库 `tkwf-tsclient-mock`（与主包单仓单包同构） |
| 主包：`transport` 注入点 | ⬜ | `DomainHostClientOptions.transport` + `createTransport()` 透传 |
| 主包：注入点测试 | ⬜ | 注入生效 / 未注入行为不变 |
| mock 包：仓库创建 | ⬜ | GitHub 建仓 + 脚手架（package.json + tsconfig + vitest） |
| mock 包：MockTransport | ⬜ | execute + executeRawGraphQL + delay/failRate/error |
| mock 包：createMockFactory | ⬜ | 类型驱动默认值 + overrides + makeN + 确定性种子 |
| mock 包：createMockDb | ⬜ | 查询语义（FilterInput/SortInput/分页）+ 关联图 + **mutation→query 状态同步** |
| mock 包：会话内置 | ⬜ | defaultSessionHandlers |
| mock 包：测试 | ⬜ | 全量 vitest |
| 文档：README + SKILL 章节 | ⬜ | mock 使用指南 + Agent 填充规范 |
| 发布 | ⬜ | 主包 v1.1.0 / mock 包 v1.0.0（先 tag 后 publish，tag 前征求同意） |
