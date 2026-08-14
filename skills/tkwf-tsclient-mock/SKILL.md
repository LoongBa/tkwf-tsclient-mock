# tkwf-tsclient-mock Skill

> 为消费项目生成和填充 mock 数据，使前端在无后端时也能运行。
> 输入：`ts-client.g.ts` + `ts-client.mock.g.ts` 骨架 + 领域文档；输出：`data.ts` 初始数据 + MOCK_SPEC.md。
> 依赖 `@tkwf/tsclient-mock`（gen-mock-handlers / createMockFactory / MockTransport）。

## 适用场景

- 后端未实现时，前端原型/demo 需要可交互的 mock 数据
- schema 变更后，同步 mock 数据以覆盖新 API
- 单测/演示需要确定性数据

## 前置条件

- [ ] `ts-client.g.ts` 已生成（消费项目运行 `npm run gen-ts-client` 或 `buildSchema.ps1 -Quick`）
- [ ] `ts-client.mock.g.ts` 已生成（消费项目运行 `npm run gen-mock` 或 `start-dev.ps1 -GenMock`）
- [ ] `src/mock/data.ts` 存在（含 `initialData` 和 `scenarioOverrides` 导出）

## 步骤

### Step 1：初始化 MOCK_SPEC.md（首次）

如果 `<项目>/.TKWF/merchant/MOCK_SPEC.md` 不存在：

1. 复制模板到 `<项目>/.TKWF/merchant/MOCK_SPEC.md`
   - 模板位置（本节模板同级）：`MOCK_SPEC.md.template`
   - 源码仓库：`<tkwf-tsclient-mock>/skills/tkwf-tsclient-mock/MOCK_SPEC.md.template`
   - 安装包（npm/file:）：`<项目>/node_modules/@tkwf/tsclient-mock/skills/tkwf-tsclient-mock/MOCK_SPEC.md.template`
2. 运行 `gen-mock-handlers --input <ts-client.g.ts> --output <ts-client.mock.g.ts> --mock-spec <项目>/.TKWF/merchant/MOCK_SPEC.md` 填充映射表
3. 根据项目需求文档（Rxx）和 `DOMAIN_MAP.md` 填写数据策略（第二节）
4. 根据 `DOMAIN_MAP.md` 实体关系填写表间关系（第三节）

### Step 2：填充 initialData

1. 读 `ts-client.mock.g.ts` 的 `createMockDb({...})` → 拿到所有表名和 `// → API:` 注释（每张表影响哪些 API）
2. 读 `MOCK_SPEC.md` 的映射表 → 知道每张表影响哪些 API
3. 读 `MOCK_SPEC.md` 的数据策略 → 知道每张表填多少条、字段约束
4. 读 `schema.graphql` 对应 DTO 类型 → 知道字段名和类型
5. 读 `DOMAIN_MAP.md` 对应实体字段描述 → 知道字段含义
6. 读 `Business.md` 业务规则 → 知道数据间约束关系
7. 编辑 `src/mock/data.ts` 的 `initialData`，填充数据

### Step 3：验证

- 运行 `npm test`（确保测试通过）
- 运行 `npm run dev:mock`（启动后登录，逐个页面检查数据渲染）
- 检查统计值一致性：如 `paymentLogStatsDtos` 的统计值与 `paymentLogs` 明细一致

## 工具参考

| 工具 | 用法 | 说明 |
|------|------|------|
| `gen-mock-handlers --mock-spec` | `gen-mock-handlers -i ts-client.g.ts -o ts-client.mock.g.ts -m MOCK_SPEC.md` | 生成骨架 + 幂等更新 MOCK_SPEC 映射表 |
| `createMockFactory<T>()` | `createMockFactory<T>({ _types: XxxSchema, _strategy: "realistic" })` | 类型驱动的真实感数据生成（需 faker.js） |
| `defineXxxFactory.make()` | `defineXxxFactory.make({ key: value })` | 覆盖关键字段，其余自动生成 |
| `db.registerRelation()` | `db.registerRelation(table, field, { type, targetTable, foreignKey })` | 注册外键关系，启用关联过滤 |
| `createScenarioContext` | `scenario.setScenario("error" / "loading" / "default")` | 运行时切换场景 |
| `scenarioOverrides` | `{ scenarios: { error: {...}, loading: { delayMs } } }` | 场景注入配置 |

## 常见问题

### MOCK_SPEC.md 被 gitignore

`.TKWF/{域}/` 是 xCodeGen 生成目录（gitignore）。MOCK_SPEC.md 放这里不会被 git 跟踪。如项目需要版本控制数据策略：
- 在 `.gitignore` 加例外：`!.TKWF/{域}/MOCK_SPEC.md`
- 或将手写策略移到前端项目 `src/mock/MOCK_SPEC.md`（映射表仍由 `--mock-spec` 维护）

### 表名不一致

`createMockDb` 的表名由实体类型名推导（首字母小写 + 复数 `s`），如 `PaymentLog` → `paymentLogs`。填充 `data.ts` 时必须与 `ts-client.mock.g.ts` 的表名完全一致，否则 `buildDataset` 不会注入数据。

### 场景切换

- `default`：正常数据（`initialData`）
- `empty`：空表（验证空态 UI）
- `error`：注入错误（验证错误提示）
- `loading`：长延迟（验证加载状态）