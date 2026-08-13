# Agents_TKWF — tkwf-tsclient-mock 开发规则

> 本仓库的**开发规则**。所有 Agent（AI）与人工开发者在本仓库内执行任何开发、文档、版本操作时，必须遵守本文件。

---

## 1. 仓库定位

TypeScript Domain 客户端 mock 运行时，为 `@tkwf/tsclient` 提供 Transport 层 mock 注入、类型驱动工厂、内存查询引擎。

- **上游包**：`@tkwf/tsclient`（`file:../tkwf-tsclient` 本地引用）
- **npm 包名**：`@tkwf/tsclient-mock`
- **发布地址**：https://www.npmjs.com/package/@tkwf/tsclient-mock

## 2. 版本体系

- **语义化版本**：手动管理，`package.json` 中 `version` 字段 + `git tag` 确认。
- **标签前缀**：`v`（如 `v1.0.0`、`v1.2.2`）。
- 版本号与主包 `@tkwf/tsclient` 独立，mock 包从 `v1.0.0` 起步。
- **`git tag` 必须与 `package.json` 的 `version` 字段一致**（如 `package.json` 中 `"version": "1.2.2"` 则 tag 为 `v1.2.2`）。不一致会导致 `npm publish` 发布错误的版本号。

## 3. 迭代开发流程

1. 新功能开发前 → 编写 `docs/迭代开发过程/V{主版本}/v{version}-{feat}-开发方案.md`
2. 方案经审核通过后 → 按方案执行开发
3. 开发完成 → 审查代码 → 编写 `docs/迭代开发过程/V{主版本}/v{version}-{feat}-审核报告.md`
4. 测试（`npm test`）→ 构建（`npm run build`）→ 提交
5. **推送（push）但不打 tag** → **tag 和发布必须征求同意**（见 §4）
6. 发布流程：用户确认后 → `git tag v{version}` → `git push origin v{version}` → GitHub Actions 自动发布到 npm

### 代码审查

- **默认**：由 Sisyphus 审查代码
- **复杂设计/实现**：由 Sisyphus 判断，建议用户使用 Oracle 审核
- **注意**：Momus 仅审核开发方案（`.sisyphus/plans/*.md`），**拒绝审查代码**

### 提交纪律

- **不频繁提交**：每个逻辑单元（feature/fix/docs）完成后才提交，避免逐补丁高频提交。
- **提交语义完整**：同一主题的探索性/失败尝试改动应合并为单条有意义的提交，而非保留中间过程。
- **禁止提交调试噪音**：无关的临时修改、未验证的半成品不入提交。

## 4. Tag 与发布纪律

- **任何 `git tag` 操作（创建/推送）和 `npm publish` 必须事先征求用户同意**。tag = 版本发布确认（触发 GitHub Actions 自动发布到 npm）。
- 日常开发、迭代完成 → 只 `push` 提交，**不自动打 tag**。
- 用户明确同意后，使用 `v` 前缀（如 `v1.0.0`），版本号与 `package.json` 一致。
- 发布 workflow 由 tag 推送自动触发（`.github/workflows/publish.yml`），包含 Sigstore 签名（`--provenance`）。
- `NODE_AUTH_TOKEN` 已配置为仓库 Secrets 中的 `NPM_TOKEN`。

## 5. CI 与测试

- CI：`npm ci` → `npm run build` → `npx vitest run`
- 发布前必须确保所有测试全部通过
- 构建产物 `dist/` 由 CI 生成，不提交到仓库

## 6. 代码纪律

- **只 `import type` 主包类型**，运行时仅依赖 `Transport` 接口
- 禁止使用 `as any`、`@ts-ignore`、`@ts-expect-error` 绕过程序员检查
- 修改源文件后必须运行 `npm run build` 确保编译通过
- 不允许留下未使用的导出或死代码

## 7. 文档

- 仓库文档（README.md）随功能变更同步更新
- 迭代文档：
  - 开发方案：`v{version}-{feat}-开发方案.md`，存放于 `docs/迭代开发过程/V{主版本}/`
  - 审核报告：`v{version}-{feat}-审核报告.md`，存放于同一目录
- 开发方案必须在开发前编写并审核，审核报告在开发完成后审查代码时编写
- 不主动创建其他额外文档文件（除非被明确要求）

### 7.1 文档引用索引

以下文档位于 `_TKWF` 仓库（独立仓库 `TKW.Framework`），与本仓库的版本迭代同步维护：

| 文档 | 定位 | 位置 | 更新时机 |
|------|------|------|---------|
| **D07M** 设计方案 | 架构视角（为什么这样设计） | `_TKWF/docs/D07M-*.md` | 架构变更时 |
| **G07M** 使用指南 | 开发视角（怎么用） | `_TKWF/docs/G07M-*.md` | 新功能/API 变更时 |
| **README** | 项目首页 | 本仓库根目录 | 每版本迭代 |

### 7.2 Tag 前文档同步规则

**每次 `git tag` 之前，必须先向用户确认是否需要同步以上文档**（`_TKWF` 是独立仓库，tag 不会自动触发文档同步）。确认流程：

```
tag 前 → 询问用户："是否同步 _TKWF 文档（D07M/G07M）和 README？"
        → 是：git -C _TKWF add/commit/push + git add README.md && commit
        → 否：跳过，下次 tag 时再次询问
```