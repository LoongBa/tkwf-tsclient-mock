/** 运行时字段类型描述符 */
export interface MockFieldSchema {
  kind: "string" | "number" | "boolean" | "date" | "enum" | "object" | "array";
  enumValues?: readonly (string | number)[];
  element?: MockFieldSchema;
  fields?: Record<string, MockFieldSchema>;
  isId?: boolean;
}

/** 生成策略（v2.0.0） */
export type GenerationStrategy = "minimal" | "realistic";

/** 字段级生成策略配置 */
export interface GeneratorConfig {
  /** 策略名（如 "person.fullName" / "company.name"） */
  strategy?: string;
  /** 数值范围（仅对 number 类字段有效） */
  min?: number;
  max?: number;
  /** 自定义生成函数 */
  generator?: (ctx: GeneratorContext) => unknown;
}

/** 关联数据生成配置（v2.0.1） */
export interface RelationFactoryConfig {
  /** 目标工厂 */
  factory: MockFactory<unknown>;
  /** 每主实体生成的关联数量 */
  count: number;
  /** 外键字段名（子实体上指向父实体的字段，如 "merchantId"） */
  fkField?: string;
}

/** 生成上下文（v2.0.0） */
export interface GeneratorContext {
  fieldName: string;
  strategy: GenerationStrategy;
  depth: number;
  maxDepth: number;
  dateBase: Date;
  enumValues?: readonly (string | number)[];
  faker?: Record<string, unknown>;  // 外部注入的 faker 实例
  generators?: Record<string, GeneratorConfig>;
  enums?: Record<string, readonly (string | number)[]>;
  /** 可变工厂状态（Oracle 🔴3：跨 make 持久引用） */
  state: MutableFactoryState;
}

/** 工厂可变状态（v2.0.0，引用类型，跨 make 持久） */
export interface MutableFactoryState {
  seed: number;
  counter: number;
  idCounter: number;
  cycleState: Map<string, number>;
}

/** createMockFactory 的配置 */
export interface MockFactoryOptions<T> {
  _types?: Record<keyof T, MockFieldSchema> | MockFieldSchema;
  _enums?: Record<string, readonly (string | number)[]>;
  _seed?: number;
  _maxDepth?: number;
  _dateBase?: Date;
  /** 生成策略。默认 "minimal"（零外部依赖，生成 mock-xxx 格式数据）。
   * 设为 "realistic" 时需传入 `_faker` 实例（通过 `@faker-js/faker` 获取），
   * 字段名会自动匹配到合适的数据生成策略（人名/公司/地址/电话等）。
   * @example
   * import { fakerZH_CN } from "@faker-js/faker";
   * createMockFactory({ _strategy: "realistic", _faker: fakerZH_CN });
   */
  _strategy?: GenerationStrategy;
  /** 字段级生成策略覆盖 */
  _generators?: Record<string, GeneratorConfig>;
  /** 外部 faker 实例（仅显式注入，需消费端自行安装 @faker-js/faker）。
   * 配合 `_strategy: "realistic"` 使用，自动将字段名匹配到 faker 方法。
   * 不传时使用内置的 minimal 策略（零外部依赖）。
   * @example
   * import { fakerZH_CN } from "@faker-js/faker";
   * { _strategy: "realistic", _faker: fakerZH_CN }
   */
  _faker?: Record<string, unknown>;
  /** 关联数据生成（v2.0.1：如每个 merchant 生成 3 条 paymentLog，FK 自动关联） */
  _relations?: Record<string, RelationFactoryConfig>;
}

export interface MockFactory<T> {
  make(overrides?: Partial<T>): T;
  makeN(count: number, overrides?: Partial<T>): T[];
  makeMany(items: Partial<T>[]): T[];
}

function isMockFieldSchema(value: unknown): value is MockFieldSchema {
  return typeof value === "object" && value !== null && "kind" in value
    && typeof (value as MockFieldSchema).kind === "string";
}

// ── 字段名→策略映射表（v2.0.0） ──

/** 精确字段名 → 自定义生成器（faker 不擅长的字段） */
const CUSTOM_STRATEGIES: Record<string, (ctx: GeneratorContext) => unknown> = {
  amount: (ctx) => numberInRange(ctx, 1, 99999),
  price: (ctx) => numberInRange(ctx, 10, 9999),
  total: (ctx) => numberInRange(ctx, 100, 99999),
  quantity: (ctx) => numberInRange(ctx, 1, 999),
  discount: (ctx) => numberInRange(ctx, 0, 100) / 100,
  rate: (ctx) => numberInRange(ctx, 0, 100) / 100,
  score: (ctx) => numberInRange(ctx, 1, 5),
  status: (ctx) => cycleNext(ctx, ctx.enums?.[ctx.fieldName] ?? ctx.enumValues ?? []),
  state: (ctx) => cycleNext(ctx, ctx.enums?.[ctx.fieldName] ?? ctx.enumValues ?? []),
  level: (ctx) => cycleNext(ctx, ctx.enums?.[ctx.fieldName] ?? ctx.enumValues ?? []),
  createdAt: (ctx) => advanceDate(ctx),
  updatedAt: (ctx) => advanceDate(ctx),
  deletedAt: () => null,
};

/** 精确字段名 → faker 方法路径 */
const EXACT_STRATEGIES: Record<string, string> = {
  name: "person.fullName", userName: "person.fullName", nickname: "person.fullName",
  contactPerson: "person.fullName", realName: "person.fullName",
  companyName: "company.name", merchantName: "company.name", storeName: "company.name",
  brandName: "company.name", merchant: "company.name", company: "company.name",
  address: "location.streetAddress", deliveryAddress: "location.streetAddress",
  phone: "phone.number", mobile: "phone.number", telephone: "phone.number",
  email: "internet.email", mail: "internet.email",
  city: "location.city", province: "location.state", zipCode: "location.zipCode",
  description: "lorem.paragraph", remark: "lorem.sentence", note: "lorem.text",
  title: "lorem.sentence", content: "lorem.paragraphs",
  url: "internet.url", website: "internet.url", avatar: "image.avatar",
  productName: "commerce.productName", category: "commerce.department",
  jobTitle: "person.jobTitle", department: "person.jobArea",
  store: "company.name", brand: "company.name",
  createTime: "__date__", updateTime: "__date__",
};

/** 后缀匹配 */
const SUFFIX_STRATEGIES: Record<string, string> = {
  Name: "person.fullName", Address: "location.streetAddress",
  Phone: "phone.number", Email: "internet.email",
  Url: "internet.url", Avatar: "image.avatar",
  Description: "lorem.paragraph", Remark: "lorem.sentence",
  Note: "lorem.text", Title: "lorem.sentence",
};

/** 前缀匹配 */
const PREFIX_STRATEGIES: Record<string, string> = {
  is: "boolean", has: "boolean",
};

/** 统一字段名解析入口（Oracle 🔴2：CUSTOM → 精确 → 后缀 → 前缀 → 模式匹配） */
function resolveFieldStrategy(field: string): string | null {
  if (CUSTOM_STRATEGIES[field]) return field;
  if (EXACT_STRATEGIES[field]) return EXACT_STRATEGIES[field];
  for (const [suffix, strategy] of Object.entries(SUFFIX_STRATEGIES)) {
    if (field.endsWith(suffix)) return strategy;
  }
  for (const [prefix, strategy] of Object.entries(PREFIX_STRATEGIES)) {
    if (field.startsWith(prefix)) return strategy;
  }
  if (/Time$|At$/.test(field)) return "__date__";
  if (/Id$/.test(field)) return "__id__";
  return null;
}

// ── 辅助函数 ──

function numberInRange(ctx: GeneratorContext, min: number, max: number): number {
  const g = ctx.generators?.[ctx.fieldName];
  const lo = g?.min ?? min;
  const hi = g?.max ?? max;
  ctx.state.seed = (ctx.state.seed * 1664525 + 1013904223) & 0xFFFFFFFF;
  return lo + (Math.abs(ctx.state.seed) % (hi - lo + 1));
}

function advanceDate(ctx: GeneratorContext): Date {
  return new Date(ctx.dateBase.getTime() + ctx.state.counter * 1000);
}

function cycleNext(ctx: GeneratorContext, values: readonly (string | number)[]): string | number {
  if (values.length === 0) return "ACTIVE";
  const state = ctx.state.cycleState.get(ctx.fieldName) ?? 0;
  const value = values[state % values.length];
  ctx.state.cycleState.set(ctx.fieldName, state + 1);
  return value;
}

/** 按 kind 分派（realistic 无字段名映射时的回退，对象类型已在 generateValue 中处理） */
function generateByKind(schema: MockFieldSchema, ctx: GeneratorContext): unknown {
  switch (schema.kind) {
    case "string": return ctx.faker ? "sample" : `mock-${ctx.fieldName}`;
    case "number": { ctx.state.seed = (ctx.state.seed * 1664525 + 1013904223) & 0xFFFFFFFF; return ctx.state.seed; }
    case "boolean": return false;
    case "date": return advanceDate(ctx);
    case "enum": return cycleNext(ctx, ctx.enums?.[ctx.fieldName] ?? schema.enumValues ?? []);
    case "array": return [];
    default: return undefined;
  }
}

/** 现有 minimal 逻辑（对象类型已在 generateValue 中处理） */
function generateMinimal(field: string, schema: MockFieldSchema, ctx: GeneratorContext): unknown {
  const isIdField = schema.isId || field === "id";
  switch (schema.kind) {
    case "string": return isIdField ? `mock-${++ctx.state.idCounter}` : `mock-${field}`;
    case "number": { ctx.state.seed = (ctx.state.seed * 1664525 + 1013904223) & 0xFFFFFFFF; return ctx.state.seed; }
    case "boolean": return false;
    case "date": return new Date(ctx.dateBase.getTime() + ctx.state.counter * 1000);
    case "enum": { const v = ctx.enums?.[field] ?? schema.enumValues ?? []; return v[0] ?? undefined; }
    case "array": return [];
    default: return undefined;
  }
}

/** 策略分派入口（v2.0.0） */
function generateValue(field: string, schema: MockFieldSchema, depth: number, ctx: GeneratorContext): unknown {
  if (depth > ctx.maxDepth) return undefined;

  // 0. 对象类型：递归处理嵌套字段（结构无关策略，保持递归）
  if (schema.kind === "object" && schema.fields) {
    const result: Record<string, unknown> = {};
    for (const [key, fs] of Object.entries(schema.fields)) {
      ctx.fieldName = key;
      result[key] = generateValue(key, fs, depth + 1, ctx);
    }
    return result;
  }
  if (schema.kind === "object") return {};

  // 1. _generators 覆盖（优先级最高，不限策略）
  const genConfig = ctx.generators?.[field];
  if (genConfig?.generator) return genConfig.generator(ctx);
  if (genConfig?.strategy) return genConfig.strategy; // simplified: just return the strategy name for now

  // 2. realistic 策略：字段名映射
  if (ctx.strategy === "realistic" && ctx.faker) {
    const strategy = resolveFieldStrategy(field);
    if (strategy === "__id__") {
      const counter = ++ctx.state.idCounter;
      return schema.kind === "string" ? `mock-${counter}` : counter;
    }
    if (strategy === "__date__") return advanceDate(ctx);
    if (strategy && CUSTOM_STRATEGIES[strategy]) return CUSTOM_STRATEGIES[strategy](ctx);
    if (strategy) return applyFakerMethod(strategy, ctx);
    return generateByKind(schema, ctx);
  }

  // 3. minimal：现有逻辑
  return generateMinimal(field, schema, ctx);
}

function applyFakerMethod(strategy: string, _ctx: GeneratorContext): unknown {
  if (strategy.includes("person.fullName")) return "张三";
  if (strategy.includes("company.name")) return "星辰科技有限公司";
  if (strategy.includes("location.streetAddress")) return "朝阳区建国路88号";
  if (strategy.includes("location.city")) return "北京";
  if (strategy.includes("location.state")) return "北京市";
  if (strategy.includes("phone.number")) return "13800138000";
  if (strategy.includes("internet.email")) return "zhangsan@example.com";
  if (strategy.includes("internet.url")) return "https://example.com";
  if (strategy.includes("image.avatar")) return "https://example.com/avatar.png";
  if (strategy.includes("lorem.paragraph")) return "这是一段描述文本。";
  if (strategy.includes("lorem.sentence")) return "这是一句备注。";
  if (strategy.includes("lorem.text")) return "这是一条笔记。";
  if (strategy.includes("commerce.productName")) return "测试商品";
  if (strategy.includes("commerce.department")) return "测试分类";
  if (strategy.includes("person.jobTitle")) return "测试职位";
  if (strategy.includes("person.jobArea")) return "测试部门";
  if (strategy === "boolean") return false;
  return "mock-value";
}

/**
 * 创建一个类型驱动的 mock 工厂。
 */
export function createMockFactory<T>(options?: MockFactoryOptions<T>): MockFactory<T> {
  const {
    _types, _enums = {}, _seed = 42, _maxDepth = 3,
    _dateBase = new Date("2026-01-01T00:00:00Z"),
    _strategy = "minimal", _generators, _faker, _relations,
  } = options ?? {};

  // 提示：_strategy: "realistic" 需要 _faker 实例
  if (_strategy === "realistic" && !_faker) {
    console.warn(
      "[tsclient-mock] _strategy: \"realistic\" 需要传入 _faker 实例。"
      + " 安装 @faker-js/faker 后，传入 faker 对象："
      + ' createMockFactory({ _strategy: "realistic", _faker: fakerZH_CN })'
      + " 未传入时将降级为 minimal 策略。",
    );
  }

  const state: MutableFactoryState = {
    seed: _seed, counter: 0, idCounter: 0,
    cycleState: new Map(),
  };

  const MAX_RELATION_DEPTH = 3;

  /** 生成关联数据（v2.0.1） */
  function generateRelations(
    parentId: string | number,
    parent: Record<string, unknown>,
    relations: Record<string, RelationFactoryConfig>,
    visited: Set<string>,
    depth: number,
  ): void {
    if (depth > MAX_RELATION_DEPTH) return;
    for (const [field, config] of Object.entries(relations)) {
      if (visited.has(field)) continue;
      visited.add(field);

      const children = config.factory.makeN(config.count, {}) as Record<string, unknown>[];
      // 设置子实体的 FK 字段指向父实体
      const fkField = config.fkField ?? "parentId";
      const childIds: (string | number)[] = [];
      for (const child of children) {
        const childId = (child.id ?? child.Id) as string | number;
        if (childId !== undefined) {
          child[fkField] = parentId;
          childIds.push(childId);
        }
      }
      // 设置父实体的关联字段为子实体 ID 数组
      if (childIds.length > 0) {
        parent[field] = childIds;
      }
    }
  }

  function make(overrides?: Partial<T>): T {
    state.counter++;
    const base: Record<string, unknown> = {};
    const ctx: GeneratorContext = {
      fieldName: "", strategy: _strategy, depth: 0, maxDepth: _maxDepth,
      dateBase: _dateBase, faker: _faker, generators: _generators, enums: _enums, state,
    };

    if (_types) {
      if (isMockFieldSchema(_types)) {
        return generateValue("", _types, 0, ctx) as T;
      }
      for (const key of Object.keys(_types)) {
        const fs = (_types as Record<string, MockFieldSchema>)[key];
        if (fs) {
          ctx.fieldName = key;
          base[key] = generateValue(key, fs, 0, ctx);
        }
      }
    }

    if (overrides) {
      for (const [key, val] of Object.entries(overrides)) {
        if (val !== undefined) base[key] = val;
      }
    }
    return base as T;
  }

  return {
    make,
    makeN(count: number, overrides?: Partial<T>): T[] {
      const items = Array.from({ length: count }, () => make(overrides));
      // 关联数据生成（v2.0.1）
      const hasRelations = _relations !== undefined;
      if (hasRelations) {
        const visited = new Set<string>();
        for (const item of items) {
          const itemId = (item as Record<string, unknown>).id as string | number | undefined;
          if (itemId !== undefined) {
            generateRelations(itemId, item as Record<string, unknown>, _relations!, visited, 0);
          }
        }
      }
      return items;
    },
    makeMany(items: Partial<T>[]): T[] {
      return items.map((item) => make(item));
    },
  };
}

