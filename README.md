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

> **不做 HTTP 层 mock server（MSW 式）**——那属 ApiService 层职责，应由后端提供内存 mock。
> `@tkwf/tsclient-mock` 只做 **Transport 接口层**的注入，更接近协议语义。

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
| `createMockDb()` | 内存数据库：CRUD + FilterInput/SortInput/分页 + 关联图 + **mutation→query 状态同步** |
| `defaultSessionHandlers` | 登录链路（requestChallenge / loginByContext / loginByPassword / logout）内置 mock |
| `defineMock()` | 类型化 handler 定义辅助（消费端 codegen 产物使用） |

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
- ❌ **无录制回放**：真实请求的 HAR 录制导入（Pact/HAR）为未来方向
- ❌ **运行时契约校验缺位**：TS 类型 → zod 的运行时校验（P4）未实现，mock 数据绕过真实 schema 校验

---

## 未来规划（版本路线图）

> 每个版本独立走：开发方案 → 审核 → 开发 → 审核报告 → 提交（见 `docs/迭代开发过程/V{主版本}/`）。
> 当前实现 = v1.0.0 内容（v0.1.x 为预发布内部迭代代号）。

| 版本 | 内容 | 说明 |
|------|------|------|
| **v1.0.0** | 三大核心（MockTransport / createMockFactory / createMockDb） | ✅ 已实现，package.json 已为 1.0.0 |
| **v1.1.0** | 消费端 codegen 扩展（`gen-mock-handlers.ts`）+ AI 填充编排层 | P1：生成全部 field 的 handler 骨架（`ts-client.mock.g.ts`），Agent 不可能漏掉 API |
| **v1.2.0** | 场景切换（`setScenario`）+ 分阶段策略落地 | P3/P2：默认/空态/错误态/加载态，Storybook 友好；原型→开发→测试分阶段 |
| **v1.3.0** | 录制回放（record-replay） | P3：真实请求 HAR 导入 → 回放，测试用真实数据而非手工 mock |
| **v1.4.0** | 运行时契约校验（TS 类型 → zod） | P4：mock 数据经过真实 schema 校验，AI 填充错误被自愈重试捕获 |

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
