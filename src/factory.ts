/** 运行时字段类型描述符 */
export interface MockFieldSchema {
  kind: "string" | "number" | "boolean" | "date" | "enum" | "object" | "array";
  /** kind="enum" 时的候选值（运行时值列表） */
  enumValues?: readonly (string | number)[];
  /** kind="array" 时的元素 schema */
  element?: MockFieldSchema;
  /** kind="object" 时的嵌套字段描述 */
  fields?: Record<string, MockFieldSchema>;
  /** 是否为 id 类字段（自增） */
  isId?: boolean;
}

/** createMockFactory 的配置 */
export interface MockFactoryOptions<T> {
  /** 运行时字段类型描述（轻量 schema，镜像 T 的结构） */
  _types?: Record<keyof T, MockFieldSchema> | MockFieldSchema;
  /** 枚举值列表（运行时值）：{ status: ["DRAFT", "PUBLISHED"] } */
  _enums?: Record<string, readonly (string | number)[]>;
  /** 确定性种子（默认 42） */
  _seed?: number;
  /** 最大递归深度（默认 3，防循环引用） */
  _maxDepth?: number;
  /** Date 基准时间轴（默认 2026-01-01T00:00:00Z） */
  _dateBase?: Date;
}

export interface MockFactory<T> {
  /** 生成一条：默认值 + overrides 合并 */
  make(overrides?: Partial<T>): T;
  /** 生成 n 条：id 自增（mock-1, mock-2...） */
  makeN(count: number, overrides?: Partial<T>): T[];
  /** 显式列表 */
  makeMany(items: Partial<T>[]): T[];
}

/**
 * 判断一个值是否为 MockFieldSchema（而非 Record 类型）。
 * 通过检查 `kind` 属性是否为字符串来区分。
 */
function isMockFieldSchema(value: unknown): value is MockFieldSchema {
  return (
    typeof value === "object" &&
    value !== null &&
    "kind" in value &&
    typeof (value as MockFieldSchema).kind === "string"
  );
}

/**
 * 创建一个类型驱动的 mock 工厂。
 *
 * 基于运行时 schema（_types）递归生成合法默认值，支持 overrides 合并。
 * 适合 Agent 填充数据：只表达业务意图，类型/结构由工具兜底。
 */
export function createMockFactory<T>(options?: MockFactoryOptions<T>): MockFactory<T> {
  const {
    _types,
    _enums = {},
    _seed = 42,
    _maxDepth = 3,
    _dateBase = new Date("2026-01-01T00:00:00Z"),
  } = options ?? {};

  let counter = 0;   // make 调用计数（用于 date 时间轴）
  let idCounter = 0; // isId 字段自增计数器
  let seed = _seed;

  /**
   * 递归生成字段值，受 schema.kind 驱动。
   * 输出为 unknown 类型，禁止中间 as T / as any 硬造。
   */
  function generateValue(field: string, schema: MockFieldSchema, depth: number): unknown {
    // 深度耗尽 → 返回 undefined，防止循环引用无限递归
    if (depth > _maxDepth) return undefined;

    const isIdField = schema.isId || field === "id";

    switch (schema.kind) {
      case "string": {
        return isIdField ? `mock-${++idCounter}` : `mock-${field}`;
      }
      case "number": {
        // LCG：线性同余生成器，固定序列可复现
        seed = (seed * 1664525 + 1013904223) & 0xFFFFFFFF;
        return seed;
      }
      case "boolean": {
        return false;
      }
      case "date": {
        // 固定时间轴递增：base + counter * 1000ms
        return new Date(_dateBase.getTime() + counter * 1000);
      }
      case "enum": {
        // 优先 _enums[field]，次选 schema.enumValues，最后 undefined
        const vals = _enums[field] ?? schema.enumValues ?? [];
        return vals[0];
      }
      case "array": {
        return [];
      }
      case "object": {
        if (!schema.fields) return {};
        const result: Record<string, unknown> = {};
        for (const [key, fs] of Object.entries(schema.fields)) {
          result[key] = generateValue(key, fs, depth + 1);
        }
        return result;
      }
      default: {
        return undefined;
      }
    }
  }

  function make(overrides?: Partial<T>): T {
    counter++;
    const base: Record<string, unknown> = {};

    if (_types) {
      if (isMockFieldSchema(_types)) {
        // 单 schema 模式（scalar T）
        return generateValue("", _types, 0) as T;
      }
      // Record 模式（object T）：遍历 _types 的每个字段
      for (const key of Object.keys(_types)) {
        const fs = (_types as Record<string, MockFieldSchema>)[key];
        if (fs) {
          base[key] = generateValue(key, fs, 0);
        }
      }
    }

    // 合并 overrides（浅合并，Object.assign 语义）
    if (overrides) {
      for (const [key, val] of Object.entries(overrides)) {
        if (val !== undefined) {
          base[key] = val;
        }
      }
    }

    // 末尾一次受控类型断言到 T（Oracle 审核许可）
    return base as T;
  }

  return {
    make,
    makeN(count: number, overrides?: Partial<T>): T[] {
      return Array.from({ length: count }, () => make(overrides));
    },
    makeMany(items: Partial<T>[]): T[] {
      return items.map((item) => make(item));
    },
  };
}