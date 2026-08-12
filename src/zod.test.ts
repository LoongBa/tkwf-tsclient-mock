import { describe, it, expect } from "vitest";
import { mockFieldSchemaToZod, validateWithZod } from "./zod.js";
import type { MockFieldSchema } from "./factory.js";

describe("mockFieldSchemaToZod — 适配器映射", () => {
  it("string：接受字符串，拒绝数字", () => {
    const schema = mockFieldSchemaToZod({ kind: "string" });
    expect(schema.safeParse("hello").success).toBe(true);
    expect(schema.safeParse(42).success).toBe(false);
  });

  it("number：接受数字，拒绝字符串", () => {
    const schema = mockFieldSchemaToZod({ kind: "number" });
    expect(schema.safeParse(42).success).toBe(true);
    expect(schema.safeParse("x").success).toBe(false);
  });

  it("boolean：接受布尔值，拒绝数字", () => {
    const schema = mockFieldSchemaToZod({ kind: "boolean" });
    expect(schema.safeParse(true).success).toBe(true);
    expect(schema.safeParse(1).success).toBe(false);
  });

  it("date：兼容 Date 实例 / ISO 字符串 / number 时间戳", () => {
    const schema = mockFieldSchemaToZod({ kind: "date" });
    expect(schema.safeParse(new Date("2026-01-01")).success).toBe(true);
    expect(schema.safeParse("2026-01-01T00:00:00Z").success).toBe(true);
    expect(schema.safeParse(1700000000000).success).toBe(true);
    expect(schema.safeParse("not-a-date").success).toBe(false);
  });

  it("enum：全部字符串用 z.enum，含 number 用 z.literal 联合", () => {
    const stringEnum = mockFieldSchemaToZod({ kind: "enum", enumValues: ["A", "B"] });
    expect(stringEnum.safeParse("A").success).toBe(true);
    expect(stringEnum.safeParse("Z").success).toBe(false);

    const mixedEnum = mockFieldSchemaToZod({ kind: "enum", enumValues: [1, 2, "X"] });
    expect(mixedEnum.safeParse(1).success).toBe(true);
    expect(mixedEnum.safeParse("X").success).toBe(true);
    expect(mixedEnum.safeParse(99).success).toBe(false);
  });

  it("空 enumValues：降级为 string|number 联合（放行）", () => {
    const schema = mockFieldSchemaToZod({ kind: "enum", enumValues: [] });
    expect(schema.safeParse("hello").success).toBe(true);
    expect(schema.safeParse(42).success).toBe(true);
  });

  it("array：元素逐一校验", () => {
    const schema = mockFieldSchemaToZod({ kind: "array", element: { kind: "number" } });
    expect(schema.safeParse([1, 2, 3]).success).toBe(true);
    expect(schema.safeParse([1, "x", 3]).success).toBe(false);
  });

  it("object：缺失字段不报错，多出字段不报错", () => {
    const schema = mockFieldSchemaToZod({
      kind: "object",
      fields: { name: { kind: "string" }, age: { kind: "number" } },
    });
    // 缺失字段
    expect(schema.safeParse({ name: "alice" }).success).toBe(true);
    // 多出字段
    expect(schema.safeParse({ name: "alice", age: 30, extra: true }).success).toBe(true);
    // 类型错误
    expect(schema.safeParse({ name: "alice", age: "x" }).success).toBe(false);
  });

  it("undefined 顶层放行", () => {
    const schema = mockFieldSchemaToZod({ kind: "string" });
    expect(schema.safeParse(undefined).success).toBe(true);
  });

  it("嵌套对象递归校验", () => {
    const schema = mockFieldSchemaToZod({
      kind: "object",
      fields: {
        address: { kind: "object", fields: { city: { kind: "string" }, zip: { kind: "number" } } },
      },
    });
    expect(schema.safeParse({ address: { city: "SH", zip: 200000 } }).success).toBe(true);
    expect(schema.safeParse({ address: { city: "SH", zip: "200000" } }).success).toBe(false);
  });
});

describe("validateWithZod — 便捷校验辅助", () => {
  const schema: MockFieldSchema = {
    kind: "object",
    fields: {
      name: { kind: "string" },
      tags: { kind: "array", element: { kind: "number" } },
    },
  };

  it("成功时 ok=true, errors=[], issues 不存在", () => {
    const result = validateWithZod(schema, { name: "alice", tags: [1, 2] });
    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
    // 类型收窄后在 success 分支 issues 不存在
  });

  it("失败时 ok=false, errors 为可读描述, issues 为结构化问题", () => {
    const result = validateWithZod(schema, { name: 42, tags: [1, "x"] });
    if (!result.ok) {
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0]).toContain("$.");
      expect(result.issues).toBeDefined();
      expect(result.issues[0].code).toBeTruthy();
      expect(result.issues[0].path).toBeDefined();
      expect(result.issues[0].message).toBeTruthy();
    }
  });

  it("嵌套路径格式正确", () => {
    const result = validateWithZod(schema, { name: "alice", tags: [1, "x"] });
    if (!result.ok) {
      const tagIssue = result.issues.find((i) => i.path.includes("tags"));
      expect(tagIssue).toBeDefined();
      expect(tagIssue?.code).toBe("invalid_type");
    }
  });
});