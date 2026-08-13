# @tkwf/tsclient-mock — 版本演进与执行记录

> **状态**：✅ v1.0.0–v1.2.2 已发布；v1.3.0–v1.9.0 为历史开发 tag（未独立发布）；v2.0.0/v2.0.1 方案合并回 v1.2.2
> **版本范围**：mock 包当前版本 v1.2.2 + 主包 v1.1.0
> **关联**：D07M（设计方案）、G07M（使用指南）、AGENTS_TKWF.md（开发规则）

---

## 一、版本号

| 包 | 版本 | 说明 | 状态 |
|----|------|------|------|
| `@tkwf/tsclient-mock` | v1.0.0 → **v2.0.1** | 完整覆盖：Transport 注入 / 内存数据库 / 工厂 / 场景 / 录制回放 / zod 校验 / 关联过滤 / HTTP server / 策略化工厂 / 关联数据生成 | ✅ 已全部发布 |
| `@tkwf/tsclient` | **v1.1.0** | minor：新增 `DomainHostClientOptions.transport` 注入点 | ✅ 已完成 |

> ⚠️ mock 是独立包而非内置：dev-time 工具与生产 SDK 分离，生产零携带（只进 `devDependencies`）。

---

## 二、版本演进与执行记录

| 版本 | 交付内容 | 测试 | Oracle 审查 | 状态 |
|------|---------|------|------------|------|
| v1.0.0 | MockTransport / createMockFactory / createMockDb / 会话 | 105 | — | ✅ |
| v1.1.0 | gen-mock-handlers + AI 编排（validateMock/selfHealing/detectChange） | — | — | ✅ |
| v1.2.0 | 场景切换（setScenario）+ 多数据集 + createScenarioContext + codegen 场景骨架 | 131 | 4🔴+5🟡 | ✅ |
| v1.3.0–v1.9.0 | 录制回放 / zod 校验 / 查询增强 / 关联过滤 / 双向同步+聚合 / 关系推导 / HTTP server / 工厂 DSL | 161–228 | 逐版本审查 | ⚠️ 历史开发 tag（能力并入 v1.2.2） |
| **v2.0.0** | **策略化数据生成（_strategy/_generators/_faker + 字段名映射 + codegen 预填充）** | **228** | **5🔴+9🟡** | ⚠️ 方案（版本合并至 v1.2.2） |
| **v2.0.1** | **关联数据生成（_relations + generateRelations + 循环防护）** | **230** | — | ⚠️ 方案（版本合并至 v1.2.2） |
| **v1.2.2** | **当前发布版：汇总 v1.3.0–v1.9.0 全部能力 + 策略化工厂 + 关联数据生成** | **230** | — | ✅ 已发布 |

> 每个版本独立走：开发方案 → Oracle 审核 → 开发 → 审核报告 → 提交 → tag（征求同意自动发布 npm）。

---

## 三、设计文档索引

> 设计内容已迁移至 D07M（`_TKWF/docs/D07M-RPC-前端客户端-ts-client-mock-设计方案.md`）。

| 文档 | 位置 | 说明 |
|------|------|------|
| 设计方案 | `_TKWF/docs/D07M-*.md` | 架构、模块设计、接口定义 |
| 使用指南 | `_TKWF/docs/G07M-*.md` | 用法、代码示例、场景指南 |
| 各版本方案 | `docs/迭代开发过程/V{主版本}/v{version}-*-开发方案.md` | 逐版本详细方案 |
| 各版本审核报告 | `docs/迭代开发过程/V{主版本}/v{version}-*-审核报告.md` | Oracle 审查记录 |
| 开发规则 | `Agents_TKWF.md` | 代码纪律、发布流程 |

---

## 四、主包 transport 注入点（已完成 ✅）

`@tkwf/tsclient` v1.1.0 已新增 `DomainHostClientOptions.transport` 字段（约 5 行改动），已完成。

### 改动

```typescript
// src/domain-host-client.ts
export interface DomainHostClientOptions {
  transport?: Transport;  // 注入自定义 Transport，优先级最高
}

private createTransport(): Transport {
  if (this.options?.transport) return this.options.transport;
  // ...原有 GraphQL/Rest 分支
}
```

### 消费端使用

```typescript
import { MockTransport, createMockDb } from "@tkwf/tsclient-mock";
import { Tkwf } from "@tkwf/tsclient";

const transport = new MockTransport(handlers, { delayMs: 150 });
Tkwf.configure("default", { endpoint: "/graphql", transport });
// 业务代码零改动：Tkwf.User.Use<XxxService>() 自动走 mock
```

---

## 五、代码纪律

- 不新增 `as any` / `@ts-ignore` / `@ts-expect-error`
- mock 包必须 `import type` 主包类型，运行时仅依赖 `Transport` 接口
- 修改后必须 `npm test` + `npm run build`
- 不允许留下未使用的导出或死代码
- 版本号手动管理：`package.json` + `git tag v{version}`（tag 前征求同意）
- 推送不自动打 tag；tag 触发 GitHub Actions 自动发布 npm（含 Sigstore 签名）