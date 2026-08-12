import * as z from "zod";
import type { MockFieldSchema } from "./factory.js";

// ── 自定义校验问题类型（不暴露 zod 内部类型给消费端，避免 peerDependency 类型泄漏） ──

/** 校验问题描述（与 zod ZodIssue 结构对齐，但仅含稳定字段） */
export interface ValidateIssue {
  code: string;
  path: (string | number)[];
  message: string;
}

// ── MockFieldSchema → zod 适配器 ──

/** schema 缓存：同一 MockFieldSchema 引用只建一次 zod schema（codegen 生成的 as const 常量引用稳定） */
const schemaCache = new WeakMap<MockFieldSchema, z.ZodType>();

/**
 * MockFieldSchema → zod ZodType 递归转换。
 *
 * 保留现有 validateMock 语义：
 * - undefined 不报错 → 顶层包装 `.optional()`
 * - object 缺失字段不报错 → `.partial()`（多余字段 strip 不报错）
 * - 空 enumValues 放行 → 降级 `z.union([z.string(), z.number()])`
 * - date 兼容 Date 实例 / ISO 字符串 / number 时间戳（对齐 isDateLike）
 */
export function mockFieldSchemaToZod(schema: MockFieldSchema): z.ZodType {
  const cached = schemaCache.get(schema);
  if (cached) return cached;
  const zodSchema = toZod(schema).optional();
  schemaCache.set(schema, zodSchema);
  return zodSchema;
}

function toZod(schema: MockFieldSchema): z.ZodType {
  switch (schema.kind) {
    case "string":
      return z.string();

    case "number":
      return z.number();

    case "boolean":
      return z.boolean();

    case "date":
      // 对齐现有 isDateLike：接受 Date 实例 / ISO 8601 字符串 / number 时间戳
      return z.union([z.iso.datetime(), z.date(), z.number()]);

    case "enum": {
      const values = schema.enumValues;
      if (!values || values.length === 0) {
        // 空 enumValues = 未填充，放行（对齐旧"跳过校验"语义，宽松接受 string/number）
        return z.union([z.string(), z.number()]);
      }
      const allStrings = values.every((v) => typeof v === "string");
      if (allStrings) {
        return z.enum(values as unknown as [string, ...string[]]);
      }
      // 含 number 的混合枚举 → z.literal 联合（Oracle 审查 🔴2）
      return z.union(values.map((v) => z.literal(v)));
    }

    case "array":
      return schema.element
        ? z.array(toZod(schema.element))
        : z.array(z.unknown());

    case "object": {
      const fields: Record<string, z.ZodType> = {};
      for (const [key, child] of Object.entries(schema.fields ?? {})) {
        fields[key] = toZod(child);
      }
      // .partial()：缺失字段不报错；strip 多余字段（对齐旧 validateMock 语义）
      return z.object(fields).partial();
    }

    // 未知 kind：保守放行（对齐旧 validateMock default 分支）
    default:
      return z.unknown();
  }
}

// ── 便捷校验辅助 ──

/**
 * 使用 zod safeParse 校验数据，返回结构化结果。
 * 成功时 errors 为空数组、无 issues；失败时 errors 为可读描述、issues 为结构化问题。
 */
export type ValidateWithZodResult =
  | { ok: true; errors: []; issues?: never }
  | { ok: false; errors: string[]; issues: ValidateIssue[] };

export function validateWithZod(schema: MockFieldSchema, data: unknown): ValidateWithZodResult {
  const zodSchema = mockFieldSchemaToZod(schema);
  const result = zodSchema.safeParse(data);
  if (result.success) return { ok: true, errors: [] };

  const issues: ValidateIssue[] = result.error.issues.map((issue) => ({
    code: issue.code,
    path: issue.path.filter((s): s is string | number => typeof s !== "symbol"),
    message: issue.message,
  }));
  const errors = issues.map(
    (issue) => `${formatPath(issue.path)}: ${issue.message}`,
  );
  return { ok: false, errors, issues };
}

/** 数组下标格式化为 `[i]`，对象键格式化为 `.key`（对齐旧 validateMock 路径风格） */
export function formatPath(path: (string | number)[]): string {
  if (path.length === 0) return "$";
  let result = "$";
  for (const segment of path) {
    result += typeof segment === "number" ? `[${segment}]` : `.${segment}`;
  }
  return result;
}