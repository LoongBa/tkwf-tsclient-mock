/**
 * mock 数据规范（MockDataSpec）运行时。
 *
 * - `parseMockDataSpec(json)`：解析并校验 JSON 字符串 → `MockDataSpec`，非法输入抛出描述性错误
 * - `generateFromSpec(spec, options?)`：将规范转换为确定性数据集（`DatasetSeed`）
 *
 * 生成管线：
 * 1. 按 relation（belongsTo）对实体做拓扑排序（Kahn 算法），确保父实体先于子实体生成；
 * 2. 每个实体按字段规则构建 `_generators`（`GeneratorConfig`），交由 `createMockFactory` 生成 N 条；
 * 3. `ref` / relation 策略引用父实体已生成的 id / 标量字段池；
 * 4. `computed` 字段与 `nullable` 权重在生成完成后进行后处理。
 */

import type { GeneratorConfig, GeneratorContext, MockFieldSchema } from "./factory.js";
import { createMockFactory } from "./factory.js";
import type { DatasetSeed } from "./mock-db.js";

// ── 类型定义 ──

export interface MockDataSpec {
  $schema?: string;
  version: 1;
  locale?: string;
  seed?: number;
  entities: Record<string, MockEntitySpec>;
  scenarios?: Record<string, MockScenarioDef>;
}

export interface MockEntitySpec {
  count: number;
  strict?: boolean;
  fields: Record<string, MockFieldRule>;
  relations?: MockRelationDef[];
}

export interface MockFieldRule {
  kind: "string" | "number" | "boolean" | "date" | "enum";
  strategy: string;
  distribution?: "uniform" | "weighted" | "gaussian" | "cyclic";
  weights?: number[];
  nullable?: { weight: number };
  validation?: MockValidation;
  start?: number;
  ref?: string;
  fakerMethod?: string;
  min?: number;
  max?: number;
  between?: [string, string];
  pattern?: string;
  value?: unknown;
  samples?: unknown[];
  values?: (string | number)[];
  compute?: MockComputeExpr;
}

export interface MockComputeExpr {
  op: "add" | "subtract" | "multiply" | "divide" | "coalesce";
  operands: { field?: string; literal?: number | string; expr?: MockComputeExpr }[];
}

export interface MockRelationDef {
  type: "belongsTo";
  field: string;
  targetEntity: string;
  targetField: string;
  generate?: boolean;
}

export interface MockScenarioDef {
  [entityName: string]: { count: number };
}

export interface MockValidation {
  regex?: string;
  unique?: boolean;
  notEmpty?: boolean;
  min?: number;
  max?: number;
}

// ── 常量 ──

const FIELD_KINDS = ["string", "number", "boolean", "date", "enum"] as const;
const DISTRIBUTIONS = ["uniform", "weighted", "gaussian", "cyclic"] as const;
const ARITHMETIC_OPS = ["add", "subtract", "multiply", "divide"] as const;

// ── parseMockDataSpec ──

/** 解析并校验 mock 数据规范 JSON */
export function parseMockDataSpec(json: string): MockDataSpec {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    throw new Error("[tsclient-mock] parseMockDataSpec: 无效的 JSON 字符串。");
  }
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new Error("[tsclient-mock] parseMockDataSpec: 规范顶层必须是对象。");
  }
  const spec = raw as Record<string, unknown>;

  if (spec.version !== 1) {
    throw new Error(`[tsclient-mock] parseMockDataSpec: 仅支持 version=1，收到版本：${String(spec.version)}。`);
  }
  if (spec.seed !== undefined && typeof spec.seed !== "number") {
    throw new Error("[tsclient-mock] parseMockDataSpec: seed 必须是数字。");
  }
  if (spec.locale !== undefined && typeof spec.locale !== "string") {
    throw new Error("[tsclient-mock] parseMockDataSpec: locale 必须是字符串。");
  }

  if (typeof spec.entities !== "object" || spec.entities === null || Array.isArray(spec.entities)) {
    throw new Error("[tsclient-mock] parseMockDataSpec: 缺少 entities 对象。");
  }
  const entities = spec.entities as Record<string, unknown>;
  if (Object.keys(entities).length === 0) {
    throw new Error("[tsclient-mock] parseMockDataSpec: entities 不能为空对象。");
  }
  for (const [entityName, entityRaw] of Object.entries(entities)) {
    validateEntity(entityName, entityRaw);
  }

  validateScenarios(spec.scenarios);

  return spec as unknown as MockDataSpec;
}

function validateScenarios(scenariosRaw: unknown): void {
  if (scenariosRaw === undefined) return;
  if (typeof scenariosRaw !== "object" || scenariosRaw === null || Array.isArray(scenariosRaw)) {
    throw new Error("[tsclient-mock] parseMockDataSpec: scenarios 必须是对象。");
  }
  for (const [scenarioName, defRaw] of Object.entries(scenariosRaw as Record<string, unknown>)) {
    if (typeof defRaw !== "object" || defRaw === null || Array.isArray(defRaw)) {
      throw new Error(`[tsclient-mock] parseMockDataSpec: 场景 "${scenarioName}" 必须是对象。`);
    }
    for (const [entityName, countRaw] of Object.entries(defRaw as Record<string, unknown>)) {
      const counts = countRaw as { count?: unknown } | null;
      if (counts === null || typeof counts !== "object" || typeof counts.count !== "number" || counts.count < 0) {
        throw new Error(`[tsclient-mock] parseMockDataSpec: 场景 "${scenarioName}" 中实体 "${entityName}" 缺少合法的 count（非负数字）。`);
      }
    }
  }
}

function validateEntity(entityName: string, entityRaw: unknown): void {
  if (typeof entityRaw !== "object" || entityRaw === null || Array.isArray(entityRaw)) {
    throw new Error(`[tsclient-mock] parseMockDataSpec: 实体 "${entityName}" 必须是对象。`);
  }
  const entity = entityRaw as Record<string, unknown>;
  if (typeof entity.count !== "number" || !Number.isFinite(entity.count) || entity.count < 0) {
    throw new Error(`[tsclient-mock] parseMockDataSpec: 实体 "${entityName}" 缺少合法的 count（非负数字）。`);
  }
  if (typeof entity.fields !== "object" || entity.fields === null || Array.isArray(entity.fields)) {
    throw new Error(`[tsclient-mock] parseMockDataSpec: 实体 "${entityName}" 缺少 fields 对象。`);
  }
  for (const [fieldName, fieldRaw] of Object.entries(entity.fields as Record<string, unknown>)) {
    validateFieldRule(entityName, fieldName, fieldRaw);
  }
  if (entity.relations !== undefined) {
    if (!Array.isArray(entity.relations)) {
      throw new Error(`[tsclient-mock] parseMockDataSpec: 实体 "${entityName}" 的 relations 必须是数组。`);
    }
    for (const relationRaw of entity.relations) {
      if (typeof relationRaw !== "object" || relationRaw === null || Array.isArray(relationRaw)) {
        throw new Error(`[tsclient-mock] parseMockDataSpec: 实体 "${entityName}" 的 relations 包含非法项。`);
      }
      const relation = relationRaw as Record<string, unknown>;
      if (typeof relation.field !== "string" || typeof relation.targetEntity !== "string") {
        throw new Error(`[tsclient-mock] parseMockDataSpec: 实体 "${entityName}" 的 relation 必须包含 field 与 targetEntity（字符串）。`);
      }
    }
  }
}

function validateFieldRule(entityName: string, fieldName: string, fieldRaw: unknown): void {
  if (typeof fieldRaw !== "object" || fieldRaw === null || Array.isArray(fieldRaw)) {
    throw new Error(`[tsclient-mock] parseMockDataSpec: 实体 "${entityName}" 字段 "${fieldName}" 必须是对象。`);
  }
  const rule = fieldRaw as Record<string, unknown>;
  const kind = rule.kind;
  if (typeof kind !== "string" || !FIELD_KINDS.includes(kind as (typeof FIELD_KINDS)[number])) {
    throw new Error(`[tsclient-mock] parseMockDataSpec: 实体 "${entityName}" 字段 "${fieldName}" 缺少合法 kind（string|number|boolean|date|enum）。`);
  }
  if (typeof rule.strategy !== "string") {
    throw new Error(`[tsclient-mock] parseMockDataSpec: 实体 "${entityName}" 字段 "${fieldName}" 缺少 strategy（字符串）。`);
  }
  if (rule.distribution !== undefined) {
    const distribution = rule.distribution;
    if (typeof distribution !== "string" || !DISTRIBUTIONS.includes(distribution as (typeof DISTRIBUTIONS)[number])) {
      throw new Error(`[tsclient-mock] parseMockDataSpec: 实体 "${entityName}" 字段 "${fieldName}" 的 distribution 非法。`);
    }
  }
  if (rule.weights !== undefined) {
    if (!Array.isArray(rule.weights) || rule.weights.some((w) => typeof w !== "number")) {
      throw new Error(`[tsclient-mock] parseMockDataSpec: 实体 "${entityName}" 字段 "${fieldName}" 的 weights 必须是数字数组。`);
    }
  }
}

// ── generateFromSpec ──

export interface GenerateFromSpecOptions {
  /** 外部注入的 faker 实例（结构：faker[module][method]） */
  faker?: Record<string, unknown>;
  /** 实体名 → MockFieldSchema 记录（交由工厂做类型驱动兜底生成） */
  schemas?: Record<string, Record<string, unknown>>;
}

/** 将 mock 数据规范转换为确定性数据集 */
export function generateFromSpec(
  spec: MockDataSpec,
  options?: GenerateFromSpecOptions,
): DatasetSeed {
  const seed = spec.seed ?? 42;
  const order = topologicalSortEntityNames(spec);

  const idPool = new Map<string, (string | number)[]>(); // 实体/字段 → 标量值池（ref / relation 引用）
  const result: DatasetSeed = {};

  for (let index = 0; index < order.length; index++) {
    const entityName = order[index];
    const entity = spec.entities[entityName];

    const generators = buildGenerators(entityName, entity, options, idPool);
    const strategy = options?.faker !== undefined ? ("realistic" as const) : ("minimal" as const);
    const factoryOptions = {
      _types: buildTypeHints(entityName, entity, options?.schemas),
      _seed: seed + index + 1,
      _maxDepth: 3,
      _strategy: strategy,
      ...(options?.faker ? { _faker: options.faker } : {}),
      ...(generators !== undefined ? { _generators: generators } : {}),
    };
    const factory = createMockFactory<Record<string, unknown>>(factoryOptions);

    const items = factory.makeN(entity.count) as Record<string, unknown>[];

    applyPostPass(entityName, entity, items);
    applyRelations(entityName, entity, items, idPool);
    collectIds(entityName, items, idPool);

    result[entityName] = items;
  }
  return result;
}

// ── 拓扑排序（Kahn 算法） ──

/** belongsTo 关系 → 父实体先于子实体生成 */
function topologicalSortEntityNames(spec: MockDataSpec): string[] {
  const entityNames = Object.keys(spec.entities);
  const graph = new Map<string, Set<string>>(); // 父实体 → 依赖它的子实体
  const indegree = new Map<string, number>();

  for (const name of entityNames) {
    graph.set(name, new Set());
    indegree.set(name, 0);
  }

  for (const name of entityNames) {
    const knownDeps = new Set<string>();
    for (const relation of spec.entities[name].relations ?? []) {
      if (relation.type !== "belongsTo") continue;
      if (relation.targetEntity && spec.entities[relation.targetEntity] !== undefined) {
        knownDeps.add(relation.targetEntity);
      }
    }
    for (const dep of knownDeps) {
      graph.get(dep)?.add(name);
      indegree.set(name, (indegree.get(name) ?? 0) + 1);
    }
  }

  const queue = entityNames.filter((name) => (indegree.get(name) ?? 0) === 0);
  const ordered: string[] = [];
  while (queue.length > 0) {
    const current = queue.shift() as string;
    ordered.push(current);
    for (const child of graph.get(current) ?? []) {
      const next = (indegree.get(child) ?? 0) - 1;
      indegree.set(child, next);
      if (next === 0) queue.push(child);
    }
  }
  // 环 / 缺失依赖时兜底：保持声明的原始顺序
  for (const name of entityNames) {
    if (!ordered.includes(name)) ordered.push(name);
  }
  return ordered;
}

// ── 生成器构建 ──

type Generator = (ctx: GeneratorContext) => unknown;

function buildGenerators(
  entityName: string,
  entity: MockEntitySpec,
  options: GenerateFromSpecOptions | undefined,
  idPool: Map<string, (string | number)[]>,
): Record<string, GeneratorConfig> | undefined {
  const generators: Record<string, GeneratorConfig> = {};
  let added = 0;
  for (const [field, rule] of Object.entries(entity.fields)) {
    const resolver = buildFieldResolver(entityName, field, rule, options, idPool);
    if (resolver === undefined) continue; // computed 字段交由后处理
    generators[field] = { generator: resolver };
    added++;
  }
  return added > 0 ? generators : undefined;
}

type BuildResult = Generator | undefined;

function buildFieldResolver(
  entityName: string,
  field: string,
  rule: MockFieldRule,
  options: GenerateFromSpecOptions | undefined,
  idPool: Map<string, (string | number)[]>,
): BuildResult {
  if (rule.compute !== undefined) return undefined; // computed → 后处理

  // 1. 固定值（strategy: "fixed" 或显式 value）
  if (rule.value !== undefined || rule.strategy === "fixed") {
    return () => rule.value;
  }

  // 2. ref 策略：引用父实体数据池
  const refTarget = parseRefTarget(rule.ref);
  if (rule.strategy === "ref" || refTarget !== undefined) {
    return createRefGenerator(entityName, field, idPool, refTarget);
  }

  // 3. 序列（sequence / increment，或 number + start）
  if (isSequenceStrategy(rule)) {
    return createSequenceGenerator(rule);
  }

  // 4. 样本/枚举池：samples / values / enum kind
  if (rule.samples !== undefined || rule.values !== undefined || rule.kind === "enum") {
    return createPickerGenerator(field, rule);
  }

  // 5. 按 kind 分派默认生成
  switch (rule.kind) {
    case "boolean":
      return (ctx) => random01(ctx) < 0.5;
    case "number":
      return createNumberGenerator(field, rule);
    case "date":
      return createDateGenerator(field, rule);
    case "string":
      return createStringGenerator(field, rule, options?.faker);
  }
  return undefined;
}

function isSequenceStrategy(rule: MockFieldRule): boolean {
  if (rule.strategy === "sequence" || rule.strategy === "increment" || rule.strategy === "sequential") {
    return true;
  }
  return rule.kind === "number"
    && rule.start !== undefined
    && rule.min === undefined
    && rule.max === undefined
    && rule.distribution === undefined;
}

function parseRefTarget(ref: string | undefined): { entity: string; field: string } | undefined {
  if (ref === undefined || ref === "") return undefined;
  const parts = ref.split(".");
  if (parts.length === 1) return { entity: parts[0], field: "id" };
  return { entity: parts[0], field: parts.slice(1).join(".") };
}

function createRefGenerator(
  entityName: string,
  field: string,
  idPool: Map<string, (string | number)[]>,
  target: { entity: string; field: string } | undefined,
): Generator {
  const refInfo = target ?? { entity: "", field: "id" };
  let warned = false;
  return (ctx) => {
    const pool = getFieldPool(idPool, refInfo.entity, refInfo.field);
    if (pool !== undefined && pool.length > 0) {
      return pool[Math.floor(random01(ctx) * pool.length)];
    }
    if (!warned) {
      warned = true;
      console.warn(
        `[tsclient-mock] 字段 "${field}"（实体 "${entityName}"）引用目标 "${refInfo.entity}.${refInfo.field}"`
        + " 的数据池为空，回退为占位引用。",
      );
    }
    return `mock-${ctx.state.idCounter++}`;
  };
}

function createSequenceGenerator(rule: MockFieldRule): Generator {
  let n = rule.start ?? 1;
  return () => {
    const value = n;
    n += 1;
    if (rule.kind === "string") return `seq-${value}`;
    return value;
  };
}

/** 从枚举/样本池选择（uniform / weighted / cyclic；gaussian 降级为 uniform） */
function createPickerGenerator(
  field: string,
  rule: MockFieldRule,
): Generator {
  const pool = (rule.samples !== undefined && rule.samples.length > 0)
    ? rule.samples
    : (rule.values ?? []);
  const weights = normalizeWeights(rule.weights, pool.length);
  const distribution = rule.distribution ?? (weights !== undefined ? "weighted" : "uniform");
  let cycleIndex = 0;
  let gaussianWarned = false;

  return (ctx) => {
    if (distribution === "cyclic") {
      if (pool.length === 0) return rule.kind === "number" ? 0 : "ACTIVE";
      const value = pool[cycleIndex % pool.length];
      cycleIndex += 1;
      return value;
    }
    if (distribution === "gaussian") {
      if (!gaussianWarned) {
        gaussianWarned = true;
        console.warn(`[tsclient-mock] 字段 "${field}" distribution=gaussian 暂不支持，降级为 uniform。`);
      }
    }
    if (pool.length === 0) return rule.kind === "number" ? 0 : "ACTIVE";
    if (distribution === "weighted" && weights !== undefined) {
      return pool[weightedIndex(weights, random01(ctx))];
    }
    return pool[Math.floor(random01(ctx) * pool.length)];
  };
}

function createNumberGenerator(field: string, rule: MockFieldRule): Generator {
  const distribution = rule.distribution ?? "uniform";
  if (distribution === "gaussian") {
    console.warn(`[tsclient-mock] 字段 "${field}" distribution=gaussian 暂不支持，降级为 uniform。`);
  }
  if (distribution === "weighted") {
    console.warn(`[tsclient-mock] 字段 "${field}" 为 number 且无 values 样本，weighted 分布降级为 uniform。`);
  }
  const lo = rule.min ?? 0;
  const hi = rule.max ?? 100;
  const lower = Math.min(lo, hi);
  const span = Math.abs(hi - lo);
  return (ctx) => lower + Math.floor(random01(ctx) * (span + 1));
}

function createDateGenerator(field: string, rule: MockFieldRule): Generator {
  if (rule.between !== undefined) {
    const from = parseDateTime(rule.between[0]);
    const to = parseDateTime(rule.between[1]);
    if (from !== undefined && to !== undefined && to.getTime() >= from.getTime()) {
      return (ctx) => new Date(from.getTime() + random01(ctx) * (to.getTime() - from.getTime()));
    }
    console.warn(`[tsclient-mock] 字段 "${field}" 的 between 区间非法（${rule.between[0]} ~ ${rule.between[1]}），回退为逐条递增。`);
  }
  return (ctx) => new Date(ctx.dateBase.getTime() + ctx.state.counter * 1000);
}

function createStringGenerator(
  field: string,
  rule: MockFieldRule,
  faker: Record<string, unknown> | undefined,
): Generator {
  const fakerPath = rule.fakerMethod ?? (rule.strategy.includes(".") ? rule.strategy : undefined);
  if (fakerPath !== undefined && faker !== undefined) {
    const segments = fakerPath.split(".");
    return () => {
      const value = callFakerMethod(faker, segments);
      if (value !== undefined && value !== null) return value;
      return fallbackString(field, rule);
    };
  }
  if (rule.pattern !== undefined) {
    return () => patternedString(rule.pattern ?? "");
  }
  return () => fallbackString(field, rule);
}

// ── 辅助：随机 / 权重 / faker ──

function random01(ctx: GeneratorContext): number {
  ctx.state.seed = (Math.imul(ctx.state.seed, 1664525) + 1013904223) >>> 0;
  return ctx.state.seed / 0x100000000;
}

function normalizeWeights(weights: number[] | undefined, length: number): number[] | undefined {
  if (weights === undefined || weights.length === 0 || length === 0) return undefined;
  const normalized = weights.slice(0, length).map((w) => (Number.isFinite(w) && w >= 0 ? w : 0));
  const sum = normalized.reduce((a, b) => a + b, 0);
  if (sum <= 0) return undefined;
  return normalized.map((w) => w / sum);
}

function weightedIndex(weights: number[], random: number): number {
  let acc = 0;
  for (let i = 0; i < weights.length; i++) {
    acc += weights[i];
    if (random <= acc) return i;
  }
  return weights.length - 1;
}

function callFakerMethod(faker: Record<string, unknown>, segments: string[]): unknown {
  let current: unknown = faker;
  for (const segment of segments) {
    if (typeof current !== "object" || current === null) return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  if (typeof current !== "function") return undefined;
  const raw = current();
  if (typeof raw === "string" || typeof raw === "number") return raw;
  return raw !== undefined && raw !== null ? String(raw) : undefined;
}

function fallbackString(field: string, rule: MockFieldRule): string {
  const pool = rule.samples ?? rule.values;
  if (pool !== undefined && pool.length > 0) return String(pool[0]);
  if (rule.pattern !== undefined && rule.pattern !== "") return patternedString(rule.pattern);
  return `mock-${field}`;
}

/** 轻量 pattern 填充：#=数字 X=大写字母 x=小写字母，其余字符原样保留 */
function patternedString(pattern: string): string {
  const upper = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const lower = upper.toLowerCase();
  let output = "";
  for (const char of pattern) {
    if (char === "#") output += Math.floor(Math.random() * 10);
    else if (char === "X") output += upper[Math.floor(Math.random() * upper.length)];
    else if (char === "x") output += lower[Math.floor(Math.random() * lower.length)];
    else output += char;
  }
  return output;
}

// ── 类型提示（_types） ──

/** 仅当存在 schema 覆盖时才回退工厂启发式；否则由规则派生 MockFieldSchema */
function buildTypeHints(
  entityName: string,
  entity: MockEntitySpec,
  schemas: Record<string, Record<string, unknown>> | undefined,
): Record<string, MockFieldSchema> | undefined {
  const hints: Record<string, MockFieldSchema> = {};
  const external = schemas?.[entityName];
  if (external !== undefined) {
    for (const [name, schemaRaw] of Object.entries(external)) {
      if (isFieldSchemaLike(schemaRaw)) hints[name] = schemaRaw;
    }
  }
  for (const [field, rule] of Object.entries(entity.fields)) {
    hints[field] = ruleToSchema(rule);
  }
  return Object.keys(hints).length > 0 ? hints : undefined;
}

function ruleToSchema(rule: MockFieldRule): MockFieldSchema {
  const schema: MockFieldSchema = { kind: rule.kind };
  if (rule.kind === "enum") {
    const enumValues = rule.values ?? rule.samples;
    if (enumValues !== undefined && enumValues.length > 0) {
      schema.enumValues = enumValues as (string | number)[];
    }
  }
  return schema;
}

function isFieldSchemaLike(value: unknown): value is MockFieldSchema {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const kind = (value as { kind?: unknown }).kind;
  return typeof kind === "string";
}

// ── 后处理：computed / nullable / relation / id 池 ──

function applyPostPass(entityName: string, entity: MockEntitySpec, items: Record<string, unknown>[]): void {
  for (const item of items) {
    // computed：引用同一实体内的其他字段计算
    for (const [field, rule] of Object.entries(entity.fields)) {
      if (rule.compute !== undefined) {
        const value = evaluateCompute(rule.compute, item);
        if (value !== undefined) item[field] = value;
      }
    }
    // nullable：按权重（确定性随机）将字段置 null
    for (const [field, rule] of Object.entries(entity.fields)) {
      const weight = rule.nullable?.weight;
      if (typeof weight === "number") {
        const state = { s: hashString(`${entityName}\u0000${field}\u0000${itemIndexKey(item)}`) };
        if (lcgNext(state) < weight) item[field] = null;
      }
    }
  }
}

function itemIndexKey(item: Record<string, unknown>): string {
  const id = item.id ?? item.Id;
  if (typeof id === "string" || typeof id === "number") return String(id);
  return JSON.stringify(item) ?? "";
}

function evaluateCompute(expr: MockComputeExpr, record: Record<string, unknown>): unknown {
  if (ARITHMETIC_OPS.includes(expr.op as (typeof ARITHMETIC_OPS)[number])) {
    let result = 0;
    let started = false;
    for (const operand of expr.operands) {
      const raw = resolveOperand(operand, record, expr.op);
      if (raw === undefined) continue;
      const num = Number(raw);
      if (Number.isNaN(num)) continue;
      if (expr.op === "add") {
        result += num;
      } else if (expr.op === "subtract") {
        result = started ? result - num : num;
      } else if (expr.op === "multiply") {
        result = started ? result * num : num;
      } else if (num !== 0) {
        result = started ? result / num : num;
      }
      started = true;
    }
    return started ? result : undefined;
  }
  // coalesce：返回第一个非 null/undefined 操作数
  if (expr.op === "coalesce") {
    for (const operand of expr.operands) {
      const value = resolveOperand(operand, record, "coalesce");
      if (value !== undefined && value !== null) return value;
    }
    return undefined;
  }
  return undefined;
}

function resolveOperand(
  operand: MockComputeExpr["operands"][number],
  record: Record<string, unknown>,
  op: MockComputeExpr["op"],
): unknown {
  if (operand.literal !== undefined) return operand.literal;
  if (operand.expr !== undefined) return evaluateCompute(operand.expr, record);
  if (operand.field !== undefined) {
    const value = record[operand.field];
    if (value === undefined) return undefined;
    if ((ARITHMETIC_OPS as readonly string[]).includes(op)) {
      const num = Number(value);
      return Number.isNaN(num) ? undefined : num;
    }
    return value;
  }
  return undefined;
}

/** relation（belongsTo）：将子实体的 FK 字段指向父实体数据池成员 */
function applyRelations(
  entityName: string,
  entity: MockEntitySpec,
  items: Record<string, unknown>[],
  idPool: Map<string, (string | number)[]>,
): void {
  for (const relation of entity.relations ?? []) {
    if (relation.type !== "belongsTo") continue;
    const pool = getFieldPool(idPool, relation.targetEntity, relation.targetField);
    if (pool === undefined || pool.length === 0) {
      console.warn(
        `[tsclient-mock] 实体 "${entityName}" 的关系 "${relation.field}"`
        + ` 引用 "${relation.targetEntity}.${relation.targetField}" 的数据池为空，跳过 FK 填充。`,
      );
      continue;
    }
    let offset = 0;
    for (const item of items) {
      item[relation.field] = pool[offset % pool.length];
      offset += 1;
    }
  }
}

/** 收集实体的标量字段值，供 ref / relation 引用（id 别名 id/Id 入主池） */
function collectIds(
  entityName: string,
  items: Record<string, unknown>[],
  idPool: Map<string, (string | number)[]>,
): void {
  const idOwner = idPool.get(entityName);
  const mainPool = idOwner !== undefined ? idOwner : [];
  for (const item of items) {
    const id = item.id ?? item.Id;
    if (typeof id === "string" || typeof id === "number") mainPool.push(id);
    for (const [field, value] of Object.entries(item)) {
      if (typeof value !== "string" && typeof value !== "number") continue;
      pushPool(idPool, `${entityName}.${field}`, value);
    }
  }
  if (mainPool.length > 0) idPool.set(entityName, mainPool);
}

function getFieldPool(
  idPool: Map<string, (string | number)[]>,
  targetEntity: string,
  targetField: string | undefined,
): (string | number)[] | undefined {
  if (targetEntity === "") return undefined;
  if (targetField === undefined || targetField === "id" || targetField === "Id") {
    return idPool.get(targetEntity);
  }
  return idPool.get(`${targetEntity}.${targetField}`) ?? idPool.get(targetEntity);
}

function pushPool(idPool: Map<string, (string | number)[]>, key: string, value: string | number): void {
  const existing = idPool.get(key);
  if (existing !== undefined) {
    existing.push(value);
  } else {
    idPool.set(key, [value]);
  }
}

// ── 辅助：日期 / 哈希（确定性随机） ──

function parseDateTime(input: string): Date | undefined {
  const parsed = new Date(input);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

function hashString(input: string): number {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function lcgNext(state: { s: number }): number {
  state.s = (Math.imul(state.s, 1664525) + 1013904223) >>> 0;
  return state.s / 0x100000000;
}

// ── DatasetSeed 序列化（浏览器安全，无 Node 依赖） ──

/**
 * Serialize a DatasetSeed to a JSON string.
 * Browser-safe — no Node.js runtime dependencies.
 */
export function serializeDatasetSeed(
  seed: DatasetSeed,
  options?: { pretty?: boolean },
): string {
  const pretty = options?.pretty ?? true;
  return pretty ? JSON.stringify(seed, null, 2) : JSON.stringify(seed);
}

/**
 * Parse a JSON string into a DatasetSeed.
 * Validates the structure is Record<string, Record<string, unknown>[]>.
 * Browser-safe — no Node.js runtime dependencies.
 */
export function parseDatasetSeed(json: string): DatasetSeed {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error("Invalid JSON: unable to parse input");
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("Invalid DatasetSeed: expected a non-null object");
  }
  for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (!Array.isArray(value)) {
      throw new Error(`Invalid DatasetSeed: value for key "${key}" is not an array`);
    }
    for (let i = 0; i < value.length; i++) {
      const item = value[i];
      if (typeof item !== "object" || item === null || Array.isArray(item)) {
        throw new Error(`Invalid DatasetSeed: item at "${key}[${i}]" is not a record`);
      }
    }
  }
  return parsed as DatasetSeed;
}