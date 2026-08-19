# tkwf-tsclient-mock Skill

> **维护位置**：`_TKWF/docs/AC-Kit/skills/tkwf-tsclient-mock/` — 修改 skill 时应同步更新 AC-Kit 副本。
> 本副本随 npm 包发布（`package.json` 的 `files` 字段包含 `skills` 目录）。
>
> 为消费项目生成和填充 mock 数据，使前端在无后端时也能运行。
> 输入：`ts-client.g.ts` + `ts-client.mock.g.ts` 骨架 + 领域文档；输出：`MockDataSpec JSON` + 自动生成的数据。
> 依赖 `@tkwf/tsclient-mock`（gen-mock-handlers / createMockFactory / MockTransport / generateFromSpec）。

## 适用场景

- 后端未实现时，前端原型/demo 需要可交互的 mock 数据
- 需要跨语言复用 mock 数据规则（TS ↔ .NET 共享同一 MockDataSpec）
- schema 变更后，同步 mock 数据以覆盖新 API
- 单测/演示需要确定性数据

## 前置条件

- [ ] `ts-client.g.ts` 已生成（消费项目运行 `npm run gen-ts-client` 或 `buildSchema.ps1 -Quick`）
- [ ] `ts-client.mock.g.ts` 已生成（消费项目运行 `npm run gen-mock` 或 `start-dev.ps1 -GenMock`）
- [ ] `src/mock/data.ts` 存在（含 `initialData` 和 `scenarioOverrides` 导出）

## 工作流

本 skill 采用**四步工作流**：从规则定义到数据生成，再到跨语言产出。

### Step 1：初始化规则文件（首次）

如果 `<项目>/.TKWF/merchant/MOCK_SPEC.md` 不存在：

1. 复制模板到 `<项目>/.TKWF/merchant/MOCK_SPEC.md`
   - 模板位置：`MOCK_SPEC.md.template`（与本 skill 同级）
   - 安装包：`<项目>/node_modules/@tkwf/tsclient-mock/skills/tkwf-tsclient-mock/MOCK_SPEC.md.template`
2. 运行 `gen-mock-handlers --input <ts-client.g.ts> --output <ts-client.mock.g.ts> --mock-spec <项目>/.TKWF/merchant/MOCK_SPEC.md` 填充映射表
3. 根据项目需求文档（Rxx）和 `DOMAIN_MAP.md` 填写数据策略（第二节）
4. 根据 `DOMAIN_MAP.md` 实体关系填写表间关系（第三节）
5. 根据 MOCK_SPEC.md 的数据策略，生成 `MockDataSpec JSON` 骨架：
   - 参考 `MOCK_DATA_SPEC.example.json` 理解格式
   - 字段策略从字段名启发式推导，后续修正

### Step 2：填写规则（编辑 MockDataSpec JSON）

1. 读 `MOCK_SPEC.md` 数据策略节 → 理解每张表的条数/约束
2. 读 `Business.md` → 理解字段业务含义和关系
3. 编辑 `MockDataSpec JSON`（如 `.tkwf/mock-data-spec.json`）：
   - 修正字段 `strategy`（faker / range / dateRange / weighted / ...）
   - 填 `distribution` / `weights`（分布）
   - 填 `relations`（FK 引用）
   - 填 `scenarios`（default / empty / minimal）——v1.5.0 起 `generateFromSpec(spec, { scenario })` 会按场景覆盖实体 count；运行时场景切换（数据+注入联动）仍用 `createScenarioContext`
   - 校验：`mock-data-spec.schema.json` 描述了 JSON Schema 约束

### Step 3：生成与验证

1. 调用 `generateFromSpec(spec)` 生成 `DatasetSeed`
2. 调用 `MockDb.buildDataset(seed)` 加载到内存数据库
3. 运行 `npm test`（确保测试通过）
4. 运行 `npm run dev:mock`（启动后登录，逐个页面检查数据渲染）
5. 检查统计值一致性：如 `paymentLogStatsDtos` 的统计值与 `paymentLogs` 明细一致

### Step 4（可选）：跨语言产出

1. 调用 `exportDatasetSeed(db, tables, path)` 导出 DatasetSeed JSON 文件
2. C# 侧调用 `DacMigrator.JsonToDatabaseAsync()` 写入 PostgreSQL（路径"转换"）
3. 或 C# 侧直接从 MockDataSpec JSON 用 Bogus 生成（路径"重新生成"）

## 工具参考

| 工具 | 用法 | 说明 |
|------|------|------|
| `gen-mock-handlers --mock-spec` | `gen-mock-handlers -i ts-client.g.ts -o ts-client.mock.g.ts -m MOCK_SPEC.md` | 生成骨架 + 幂等更新 MOCK_SPEC 映射表 |
| `parseMockDataSpec(json)` | `parseMockDataSpec(readFileSync("spec.json", "utf-8"))` | 解析 MockDataSpec JSON（校验结构） |
| `generateFromSpec(spec)` | `generateFromSpec(spec, { faker, schemas })` | 从规则生成 DatasetSeed |
| `serializeDatasetSeed(seed)` | `serializeDatasetSeed(seed)` | 序列化 DatasetSeed 为 JSON 字符串 |
| `exportDatasetSeed(db, tables, path)` | `exportDatasetSeed(db, ["paymentLogs"], "seed.json")` | 导出 DatasetSeed 到文件（Node-only） |
| `importDatasetSeed(db, path)` | `importDatasetSeed(db, "seed.json")` | 从文件导入 DatasetSeed（Node-only） |
| `createMockFactory<T>()` | `createMockFactory<T>({ _types, _strategy: "realistic" })` | 类型驱动的真实感数据生成（需 faker.js） |
| `defineXxxFactory.make()` | `defineXxxFactory.make({ key: value })` | 覆盖关键字段，其余自动生成 |
| `db.registerRelation()` | `db.registerRelation(table, field, { type, targetTable, foreignKey })` | 注册外键关系，启用关联过滤 |
| `createScenarioContext` | `scenario.setScenario("error" / "loading" / "default")` | 运行时切换场景 |

## 参考文件

| 文件 | 路径 | 说明 |
|------|------|------|
| MOCK_SPEC.md.template | `skills/tkwf-tsclient-mock/MOCK_SPEC.md.template` | 人类可读数据策略模板 |
| mock-data-spec.schema.json | `skills/tkwf-tsclient-mock/mock-data-spec.schema.json` | MockDataSpec JSON Schema |
| MOCK_DATA_SPEC.example.json | `skills/tkwf-tsclient-mock/MOCK_DATA_SPEC.example.json` | 完整示例（PaymentLog + StoreInfo） |

## 常见问题

### MOCK_SPEC.md 被 gitignore

`.TKWF/{域}/` 是 xCodeGen 生成目录（gitignore）。MOCK_SPEC.md 放这里不会被 git 跟踪。如项目需要版本控制数据策略：
- 在 `.gitignore` 加例外：`!.TKWF/{域}/MOCK_SPEC.md`
- 或将手写策略移到前端项目 `src/mock/MOCK_SPEC.md`（映射表仍由 `--mock-spec` 维护）

### MockDataSpec JSON 与 MOCK_SPEC.md 的关系

两者并存，不是替代关系：MOCK_SPEC.md 面向人类阅读（数据策略叙述、最少条数、关键字段约束），MockDataSpec JSON 面向机器消费（结构化字段策略、分布、权重、关系）。变更时保持同步。

### 表名不一致

`createMockDb` 的表名由实体类型名推导（首字母小写 + 复数 `s`），如 `PaymentLog` → `paymentLogs`。填充 `data.ts` 时必须与 `ts-client.mock.g.ts` 的表名完全一致，否则 `buildDataset` 不会注入数据。

### 场景切换

- `default`：正常数据（`initialData`）
- `empty`：空表（验证空态 UI）
- `error`：注入错误（验证错误提示）
- `loading`：长延迟（验证加载状态）

### ref 策略 vs belongsTo 关系：何时用哪个

| 场景 | 用 ref | 用 belongsTo relation |
|------|--------|----------------------|
| 单个 FK 字段引用父实体 ID | ✅ `ref: "StoreInfo.Uid"` | 也可用（但 ref 更简洁） |
| 多个字段需对齐同一父行（如 storeUid + storeName） | ❌ 各自独立随机，永远无法对齐 | ✅ 多条 relation 指向同一 targetEntity，轮询同步 |
| 字段值从父实体某字段取值（非 ID） | ✅ `ref: "StoreInfo.Name"` | ✅ `relation.targetField: "Name"` |

**规则**：`ref` 策略用 `random01` 独立随机取样，各自独立；`belongsTo` 用 `offset % pool.length` 轮询顺序分配，同父多字段天然对齐。

### 浏览器端如何使用 MockDataSpec

`generateFromSpec` 和 `parseMockDataSpec` 是浏览器安全的（主入口导出），但 `loadMockDataSpec`（读文件）是 Node-only（`/server` 子路径）。

**浏览器端部署步骤**：
1. 在 Node 环境（如 build 脚本）用 `loadMockDataSpec` 读取 spec JSON
2. 调用 `generateFromSpec` 生成 DatasetSeed
3. 用 `serializeDatasetSeed` 序列化为 JSON 字符串
4. 将 JSON 写入 TS 模块文件（如 `src/mock/spec-seed.g.ts`）：
   ```typescript
   // 自动生成——由 scripts/gen-mock-spec-seed.ts 生成
   import type { DatasetSeed } from "@tkwf/tsclient-mock";
   export const specSeed: DatasetSeed = { ... };
   ```
5. 浏览器端直接 `import { specSeed } from "./spec-seed.g"` 并 `db.buildDataset(specSeed)`

### 包装/分页响应（Connection）不在 MockDataSpec 范围内

`generateFromSpec` 返回平坦的 `DatasetSeed = Record<string, T[]>`，不包含分页/Connection 包装结构（如 `{ items, page, total }`）。这些包装由 `createMockDb.query()` 运行时自动组装。如果消费端需要包装表数据，需在 `data.ts` 中手写或通过 `db.query()` 组装。跨语言交换时，目标语言也需自行组装包装结构。