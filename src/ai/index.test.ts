import { describe, expect, it } from "vitest";
import { validateMock, selfHealing, detectChange, sha256, configureSidecar } from "./index.js";
import type { MockFieldSchema } from "../factory.js";

const userSchema: MockFieldSchema = {
  kind: "object",
  fields: {
    id: { kind: "number", isId: true },
    name: { kind: "string" },
    age: { kind: "number" },
    isActive: { kind: "boolean" },
    createdAt: { kind: "date" },
    role: { kind: "enum", enumValues: ["ADMIN", "USER"] },
    tags: { kind: "array", element: { kind: "string" } },
  },
};

describe("validateMock", () => {
  it("合法数据通过", () => {
    const result = validateMock(
      { id: 1, name: "alice", age: 30, isActive: true, createdAt: new Date(), role: "ADMIN", tags: ["a"] },
      userSchema,
    );
    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it("类型错误报错列表且带路径", () => {
    const result = validateMock(
      { id: "1", name: 42, age: "x", isActive: "yes", createdAt: 12345, role: "SUPER", tags: "not-array" },
      userSchema,
    );
    expect(result.ok).toBe(false);
    expect(result.errors.join("\n")).toContain("$.id");
    expect(result.errors.join("\n")).toContain("$.name");
    expect(result.errors.join("\n")).toContain("$.role: Invalid option");
    expect(result.errors.join("\n")).toContain("$.tags: Invalid input: expected array");
  });

  it("undefined 不报错（未填充由 Agent 决定）,缺失字段不报错", () => {
    const result = validateMock({ id: 1 }, userSchema);
    expect(result.ok).toBe(true);
    expect(validateMock(undefined, userSchema).ok).toBe(true);
  });

  it("嵌套对象递归校验", () => {
    const nested: MockFieldSchema = {
      kind: "object",
      fields: {
        address: { kind: "object", fields: { city: { kind: "string" }, zip: { kind: "number" } } },
      },
    };
    expect(validateMock({ address: { city: "SH", zip: "200000" } }, nested).ok).toBe(false);
    expect(validateMock({ address: { city: "SH", zip: 200000 } }, nested).ok).toBe(true);
  });

  it("array 元素逐一校验", () => {
    const result = validateMock([1, "x", 3], { kind: "array", element: { kind: "number" } });
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain("$[1]");
  });
});

describe("selfHealing", () => {
  const schema: MockFieldSchema = { kind: "object", fields: { id: { kind: "number" } } };

  it("首次生成即通过 → 直接返回", async () => {
    const result = await selfHealing<{ id: number }>({
      schema,
      generator: () => ({ id: 1 }),
    });
    expect(result).toEqual({ id: 1 });
  });

  it("验证失败重试，最后成功返回", async () => {
    let calls = 0;
    const result = await selfHealing<{ id: number }>({
      schema,
      maxRetries: 3,
      generator: () => (++calls < 3 ? ({ id: "bad" } as unknown) : { id: 42 }),
    });
    expect(result).toEqual({ id: 42 });
    expect(calls).toBe(3);
  });

  it("全部失败 → 抛错且携带 errors", async () => {
    await expect(
      selfHealing<{ id: number }>({
        schema,
        maxRetries: 1,
        generator: () => ({ id: "bad" } as unknown),
      }),
    ).rejects.toThrow("id");
  });

  it("未提供 generator → 抛错提示", async () => {
    await expect(selfHealing({ schema })).rejects.toThrow("generator");
  });
});

describe("detectChange / sha256", () => {
  it("sha256 输出 64 位 hex 且确定性", async () => {
    const h1 = await sha256("abc");
    const h2 = await sha256("abc");
    expect(h1).toMatch(/^[0-9a-f]{64}$/);
    expect(h1).toBe(h2);
    expect(h1).not.toBe(await sha256("abd"));
  });

  it("首次生成（无 sidecar）→ changed=false 并记录 hash", async () => {
    configureSidecar({ read: () => undefined, write: () => {} });
    const result = await detectChange("source-a");
    expect(result.changed).toBe(false);
    expect(result.previousHash).toBeUndefined();
  });

  it("内容未变 → changed=false", async () => {
    let stored: string | undefined;
    configureSidecar({
      read: () => stored,
      write: (h) => {
        stored = h;
      },
    });
    const first = await detectChange("same");
    const second = await detectChange("same");
    expect(first.changed).toBe(false);
    expect(second.changed).toBe(false);
  });

  it("内容变更 → changed=true 并更新 sidecar", async () => {
    let stored: string | undefined;
    configureSidecar({
      read: () => stored,
      write: (h) => {
        stored = h;
      },
    });
    const first = await detectChange("old");
    const second = await detectChange("new");
    expect(second.changed).toBe(true);
    expect(second.previousHash).toBe(first.hash);
  });
});