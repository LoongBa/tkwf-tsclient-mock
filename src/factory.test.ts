import { describe, it, expect } from "vitest";
import { createMockFactory } from "./factory";
import type { MockFieldSchema } from "./factory";

interface TestEntity {
  id: string;
  name: string;
  count: number;
  active: boolean;
  createdAt: Date;
  status: string;
  tags: string[];
  extra: { x: number };
}

const testSchema: Record<keyof TestEntity, MockFieldSchema> = {
  id: { kind: "string", isId: true },
  name: { kind: "string" },
  count: { kind: "number" },
  active: { kind: "boolean" },
  createdAt: { kind: "date" },
  status: { kind: "enum" },
  tags: { kind: "array", element: { kind: "string" } },
  extra: { kind: "object", fields: { x: { kind: "number" } } },
};

describe("createMockFactory", () => {
  it("generates string fields with mock- prefix and isId auto-increment", () => {
    const factory = createMockFactory<TestEntity>({ _types: testSchema });
    const item = factory.make();
    expect(item.id).toBe("mock-1");
    expect(item.name).toBe("mock-name");
  });

  it("generates number fields via LCG seeded sequence", () => {
    const factory = createMockFactory<TestEntity>({ _types: testSchema, _seed: 42 });
    const item = factory.make();
    const expected = (42 * 1664525 + 1013904223) >>> 0;
    expect(item.count).toBe(expected);
  });

  it("generates boolean fields as false and array as empty", () => {
    const factory = createMockFactory<TestEntity>({ _types: testSchema });
    const item = factory.make();
    expect(item.active).toBe(false);
    expect(item.tags).toEqual([]);
  });

  it("generates date fields as Date instances on fixed timeline", () => {
    const factory = createMockFactory<TestEntity>({
      _types: testSchema,
      _dateBase: new Date("2026-01-01T00:00:00Z"),
    });
    const item = factory.make();
    expect(item.createdAt).toBeInstanceOf(Date);
    // 第一次 make()：counter=1 → base + 1000ms
    expect(item.createdAt.getTime()).toBe(
      new Date("2026-01-01T00:00:00Z").getTime() + 1000,
    );
  });

  it("is deterministic for the same seed", () => {
    const a = createMockFactory<TestEntity>({ _types: testSchema, _seed: 123 });
    const b = createMockFactory<TestEntity>({ _types: testSchema, _seed: 123 });
    expect(a.make().count).toBe(b.make().count);
    expect(a.make().count).toBe(b.make().count);
  });

  it("uses the first enum member from _enums", () => {
    const factory = createMockFactory<TestEntity>({
      _types: testSchema,
      _enums: { status: ["DRAFT", "PUBLISHED", "ARCHIVED"] },
    });
    expect(factory.make().status).toBe("DRAFT");
  });

  it("falls back to schema.enumValues when _enums is absent", () => {
    const schema: Record<keyof TestEntity, MockFieldSchema> = {
      ...testSchema,
      status: { kind: "enum", enumValues: ["OPEN", "CLOSED"] },
    };
    const factory = createMockFactory<TestEntity>({ _types: schema });
    expect(factory.make().status).toBe("OPEN");
  });

  it("stops recursion at maxDepth to prevent circular references", () => {
    interface Circular {
      id: string;
      child: Circular | null;
    }
    // 自引用 schema：child 指向同一结构（模拟 User ↔ Post 循环）
    const nodeSchema: MockFieldSchema = { kind: "object", fields: {} };
    nodeSchema.fields = {
      id: { kind: "string", isId: true },
      child: nodeSchema,
    };

    const factory = createMockFactory<Circular>({
      _types: nodeSchema,
      _maxDepth: 2,
    });
    const item = factory.make();
    // 深度 0、1 均生成；深度 2 的字段 id 在 depth 3 超出 maxDepth → undefined
    expect(item.id).toBe("mock-1");
    expect(item.child!.id).toBe("mock-2");
    // 深度 3 超出 maxDepth → child 字段为 undefined
    expect(item.child!.child!.child).toBeUndefined();
  });

  it("merges overrides over generated defaults (shallow)", () => {
    const factory = createMockFactory<TestEntity>({
      _types: testSchema,
      _enums: { status: ["DRAFT"] },
    });
    const item = factory.make({ status: "SUCCESS", count: 99 });
    expect(item.status).toBe("SUCCESS");
    expect(item.count).toBe(99);
    // 未覆盖字段仍是默认
    expect(item.id).toBe("mock-1");
    expect(item.active).toBe(false);
  });

  it("makeN returns count items with sequential incremented ids", () => {
    const factory = createMockFactory<TestEntity>({ _types: testSchema });
    const items = factory.makeN(3);
    expect(items).toHaveLength(3);
    expect(items.map((i) => i.id)).toEqual(["mock-1", "mock-2", "mock-3"]);
  });

  it("makeN applies the same overrides to every item", () => {
    const factory = createMockFactory<TestEntity>({
      _types: testSchema,
      _enums: { status: ["DRAFT"] },
    });
    const items = factory.makeN(2, { status: "SUCCESS" });
    expect(items.every((i) => i.status === "SUCCESS")).toBe(true);
    expect(items[0].id).toBe("mock-1");
    expect(items[1].id).toBe("mock-2");
  });

  it("makeMany maps each partial through make()", () => {
    const factory = createMockFactory<TestEntity>({
      _types: testSchema,
      _enums: { status: ["DRAFT"] },
    });
    const items = factory.makeMany([{ name: "a" }, { name: "b", count: 7 }]);
    expect(items).toHaveLength(2);
    expect(items[0].name).toBe("a");
    expect(items[1].name).toBe("b");
    expect(items[1].count).toBe(7);
    expect(items.map((i) => i.id)).toEqual(["mock-1", "mock-2"]);
  });

  it("supports explicit isId on non-id fields", () => {
    interface WithId {
      id: string;
      userId: string;
    }
    const schema: Record<keyof WithId, MockFieldSchema> = {
      id: { kind: "string" },
      userId: { kind: "string", isId: true },
    };
    const factory = createMockFactory<WithId>({ _types: schema });
    const item = factory.make();
    // id 严格匹配（默认 isId），自增；userId 显式 isId 也自增
    expect(item.id).toBe("mock-1");
    expect(item.userId).toBe("mock-2");
  });
});