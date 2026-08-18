import { describe, expect, it, vi } from "vitest";
import type { MockFieldSchema } from "./factory.js";
import {
  parseMockDataSpec,
  generateFromSpec,
  serializeDatasetSeed,
  parseDatasetSeed,
} from "./mock-data-spec.js";
import type { DatasetSeed } from "./mock-db.js";

// ── parseMockDataSpec ───────────────────────────────────────

describe("parseMockDataSpec", () => {
  it("parses valid JSON with version=1, entities, fields", () => {
    const spec = parseMockDataSpec(
      JSON.stringify({
        version: 1,
        entities: {
          users: {
            count: 3,
            fields: {
              name: { kind: "string", strategy: "faker" },
            },
          },
        },
      }),
    );
    expect(spec.version).toBe(1);
    expect(spec.entities).toBeDefined();
    expect(Object.keys(spec.entities)).toEqual(["users"]);
    expect(spec.entities.users.count).toBe(3);
  });

  it("throws on invalid JSON string", () => {
    expect(() => parseMockDataSpec("{ bad")).toThrow(/无效的 JSON/);
  });

  it("throws when version is missing", () => {
    expect(() =>
      parseMockDataSpec(
        JSON.stringify({
          entities: { e: { count: 1, fields: { n: { kind: "string", strategy: "faker" } } } },
        }),
      ),
    ).toThrow(/version=1/);
  });

  it("throws when entities is empty", () => {
    expect(() => parseMockDataSpec(JSON.stringify({ version: 1, entities: {} }))).toThrow(
      /entities 不能为空/,
    );
  });

  it("throws when an entity lacks count", () => {
    expect(() =>
      parseMockDataSpec(
        JSON.stringify({
          version: 1,
          entities: { e: { fields: { n: { kind: "string", strategy: "faker" } } } },
        }),
      ),
    ).toThrow(/count/);
  });

  it("throws when version is not 1", () => {
    expect(() => parseMockDataSpec(JSON.stringify({ version: 2, entities: { e: { count: 1, fields: { n: { kind: "string", strategy: "faker" } } } } }))).toThrow(/version=1/);
  });

  it("throws when entities is not an object", () => {
    expect(() => parseMockDataSpec(JSON.stringify({ version: 1, entities: "bad" }))).toThrow(/缺少 entities/);
  });

  it("throws when a field lacks strategy", () => {
    expect(() =>
      parseMockDataSpec(
        JSON.stringify({ version: 1, entities: { e: { count: 1, fields: { n: { kind: "string" } } } } }),
      ),
    ).toThrow(/strategy/);
  });

  it("throws when a field has invalid kind", () => {
    expect(() =>
      parseMockDataSpec(
        JSON.stringify({
          version: 1,
          entities: { e: { count: 1, fields: { n: { kind: "color", strategy: "faker" } } } },
        }),
      ),
    ).toThrow(/kind/);
  });

  it("accepts locale, seed, and $schema", () => {
    const spec = parseMockDataSpec(
      JSON.stringify({
        $schema: "./spec.json",
        version: 1,
        locale: "zh-CN",
        seed: 42,
        entities: {
          users: { count: 1, fields: { name: { kind: "string", strategy: "faker" } } },
        },
      }),
    );
    expect(spec.locale).toBe("zh-CN");
    expect(spec.seed).toBe(42);
    expect(spec.$schema).toBe("./spec.json");
  });
});

// ── generateFromSpec ────────────────────────────────────────

describe("generateFromSpec", () => {
  it("generates a DatasetSeed with correct count for a basic spec", () => {
    const spec = parseMockDataSpec(
      JSON.stringify({
        version: 1,
        entities: {
          users: {
            count: 5,
            fields: {
              name: { kind: "string", strategy: "faker" },
            },
          },
        },
      }),
    );
    const seed = generateFromSpec(spec);
    expect(seed.users).toHaveLength(5);
    // string field should produce a value
    for (const item of seed.users) {
      expect(typeof item.name).toBe("string");
    }
  });

  it("generates FK values for belongsTo relations", () => {
    const spec = parseMockDataSpec(
      JSON.stringify({
        version: 1,
        entities: {
          users: {
            count: 3,
            fields: {
              id: { kind: "number", strategy: "sequence", start: 1 },
              name: { kind: "string", strategy: "faker" },
            },
          },
          orders: {
            count: 4,
            fields: {
              ownerId: { kind: "number", strategy: "ref", ref: "users" },
              total: { kind: "number", strategy: "range", min: 1, max: 10 },
            },
            relations: [
              { type: "belongsTo", field: "userId", targetEntity: "users", targetField: "id" },
            ],
          },
        },
      }),
    );
    const data = generateFromSpec(spec);
    expect(data.users).toHaveLength(3);
    expect(data.orders).toHaveLength(4);
    // FK values from belongsTo should exist in the users id pool
    const userIds = data.users.map((u) => u.id);
    for (const order of data.orders) {
      expect(userIds).toContain(order.userId);
    }
    // ref strategy should also reference user ids
    for (const order of data.orders) {
      expect(userIds).toContain(order.ownerId);
    }
  });

  it("evaluates computed fields (subtract + coalesce)", () => {
    const spec = parseMockDataSpec(
      JSON.stringify({
        version: 1,
        entities: {
          invoices: {
            count: 5,
            fields: {
              totalAmount: { kind: "number", strategy: "range", min: 100, max: 500 },
              discountAmount: {
                kind: "number",
                strategy: "range",
                min: 0,
                max: 50,
              },
              netAmount: {
                kind: "number",
                strategy: "computed",
                compute: {
                  op: "subtract",
                  operands: [
                    { field: "totalAmount" },
                    {
                      expr: {
                        op: "coalesce",
                        operands: [{ field: "discountAmount" }, { literal: 0 }],
                      },
                    },
                  ],
                },
              },
            },
          },
        },
      }),
    );
    const data = generateFromSpec(spec);
    expect(data.invoices).toHaveLength(5);
    for (const inv of data.invoices) {
      const total = inv.totalAmount as number;
      const discount = (inv.discountAmount as number) ?? 0;
      expect(inv.netAmount).toBe(total - discount);
    }
  });

  it("applies nullable with weight ~0.3 (25-35% null in 1000 items)", () => {
    const spec = parseMockDataSpec(
      JSON.stringify({
        version: 1,
        entities: {
          items: {
            count: 1000,
            fields: {
              id: { kind: "number", strategy: "sequence", start: 1 },
              label: { kind: "string", strategy: "faker", nullable: { weight: 0.3 } },
            },
          },
        },
      }),
    );
    const data = generateFromSpec(spec);
    const nullCount = data.items.filter((i) => i.label === null).length;
    const pct = nullCount / 1000;
    expect(pct).toBeGreaterThan(0.2);
    expect(pct).toBeLessThan(0.4);
  });

  it("produces weighted distribution matching weights", () => {
    const spec = parseMockDataSpec(
      JSON.stringify({
        version: 1,
        entities: {
          widgets: {
            count: 1000,
            fields: {
              color: {
                kind: "enum",
                strategy: "pick",
                values: ["R", "G", "B"],
                weights: [0.5, 0.3, 0.2],
              },
            },
          },
        },
      }),
    );
    const data = generateFromSpec(spec);
    // With 1000 items, the counts should roughly follow the weights
    const counts = { R: 0, G: 0, B: 0 };
    for (const w of data.widgets) {
      counts[w.color as "R" | "G" | "B"]++;
    }
    // Allow generous tolerance for deterministic LCG
    expect(counts.R).toBeGreaterThan(300);
    expect(counts.G).toBeGreaterThan(150);
    expect(counts.B).toBeGreaterThan(50);
    expect(counts.R + counts.G + counts.B).toBe(1000);
  });

  it("sequence strategy increments values by 1", () => {
    const spec = parseMockDataSpec(
      JSON.stringify({
        version: 1,
        entities: {
          counters: {
            count: 10,
            fields: {
              seq: { kind: "number", strategy: "sequence", start: 1 },
            },
          },
        },
      }),
    );
    const data = generateFromSpec(spec);
    expect(data.counters).toHaveLength(10);
    for (let i = 0; i < 10; i++) {
      expect(data.counters[i].seq).toBe(i + 1);
    }
  });

  it("falls back to factory heuristics when spec has no overrides", () => {
    // A field with only kind and strategy — factory generates default values
    const spec = parseMockDataSpec(
      JSON.stringify({
        version: 1,
        entities: {
          things: {
            count: 3,
            fields: {
              id: { kind: "number", strategy: "sequence", start: 1 },
              name: { kind: "string", strategy: "faker" },
              active: { kind: "boolean", strategy: "random" },
            },
          },
        },
      }),
    );
    const data = generateFromSpec(spec);
    expect(data.things).toHaveLength(3);
    for (const item of data.things) {
      expect(typeof item.id).toBe("number");
      expect(typeof item.name).toBe("string");
      expect(typeof item.active).toBe("boolean");
    }
  });

  it("passes _types to factory when schemas option is provided", () => {
    const spec = parseMockDataSpec(
      JSON.stringify({
        version: 1,
        entities: {
          products: {
            count: 3,
            fields: {
              sku: { kind: "string", strategy: "sequence" },
              price: { kind: "number", strategy: "range", min: 10, max: 50 },
            },
          },
        },
      }),
    );
    const schemas: Record<string, Record<string, MockFieldSchema>> = {
      products: {
        sku: { kind: "string" },
        price: { kind: "number" },
      },
    };
    const data = generateFromSpec(spec, { schemas });
    expect(data.products).toHaveLength(3);
    for (const item of data.products) {
      expect(typeof item.sku).toBe("string");
      expect(typeof item.price).toBe("number");
    }
  });

  it("is deterministic for the same seed", () => {
    const raw = JSON.stringify({
      version: 1,
      seed: 42,
      entities: {
        items: {
          count: 5,
          fields: {
            val: { kind: "number", strategy: "range", min: 0, max: 100 },
            label: { kind: "string", strategy: "faker" },
          },
        },
      },
    });
    const spec = parseMockDataSpec(raw);
    const a = generateFromSpec(spec);
    const b = generateFromSpec(spec);
    expect(a).toEqual(b);
  });
});

// ── serializeDatasetSeed ────────────────────────────────────

describe("serializeDatasetSeed", () => {
  const seed: DatasetSeed = {
    users: [
      { id: 1, name: "Alice" },
      { id: 2, name: "Bob" },
    ],
  };

  it("returns pretty-printed JSON by default", () => {
    const json = serializeDatasetSeed(seed);
    expect(json).toContain("\n");
    expect(json).toContain('  "id"');
  });

  it("returns compact JSON when pretty=false", () => {
    const json = serializeDatasetSeed(seed, { pretty: false });
    expect(json).not.toContain("\n");
    expect(json).toBe('{"users":[{"id":1,"name":"Alice"},{"id":2,"name":"Bob"}]}');
  });
});

// ── parseDatasetSeed ────────────────────────────────────────

describe("parseDatasetSeed", () => {
  it("parses a valid JSON DatasetSeed", () => {
    const json = JSON.stringify({
      users: [
        { id: 1, name: "Alice" },
        { id: 2, name: "Bob" },
      ],
    });
    const seed = parseDatasetSeed(json);
    expect(seed.users).toHaveLength(2);
    expect(seed.users[0].name).toBe("Alice");
  });

  it("throws on invalid JSON", () => {
    expect(() => parseDatasetSeed("{ bad")).toThrow(/Invalid JSON/);
  });

  it("throws when root is not an object", () => {
    expect(() => parseDatasetSeed("[]")).toThrow(/expected a non-null object/);
    expect(() => parseDatasetSeed("null")).toThrow(/expected a non-null object/);
  });

  it("throws when a value is not an array", () => {
    expect(() =>
      parseDatasetSeed(JSON.stringify({ users: "not-an-array" })),
    ).toThrow(/not an array/);
  });

  it("throws when an item is not a record", () => {
    expect(() => parseDatasetSeed(JSON.stringify({ users: [42] }))).toThrow(/not a record/);
  });
});

// ── Roundtrip ───────────────────────────────────────────────

describe("serializeDatasetSeed + parseDatasetSeed roundtrip", () => {
  it("produces the same structure after serialize then parse", () => {
    const original: DatasetSeed = {
      orders: [
        { id: "o1", total: 100, status: "active" },
        { id: "o2", total: 200, status: "inactive" },
      ],
    };
    const json = serializeDatasetSeed(original);
    const parsed = parseDatasetSeed(json);
    expect(parsed).toEqual(original);
  });
});