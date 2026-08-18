import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createMockDb } from "./mock-db.js";
import { exportDatasetSeed, importDatasetSeed, loadMockDataSpec } from "./dataset-io.js";

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "ds-io-test-"));
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

describe("loadMockDataSpec", () => {
  it("loads a valid MockDataSpec from a JSON file", () => {
    const filePath = join(tmpDir, "spec.json");
    writeFileSync(
      filePath,
      JSON.stringify({
        version: 1,
        entities: {
          users: { count: 5, fields: { name: { kind: "string", strategy: "faker" } } },
        },
      }),
      "utf-8",
    );
    const spec = loadMockDataSpec(filePath);
    expect(spec.version).toBe(1);
    expect(spec.entities.users.count).toBe(5);
  });

  it("throws when the file does not exist", () => {
    expect(() => loadMockDataSpec(join(tmpDir, "nonexistent.json"))).toThrow();
  });

  it("throws when the file contains invalid JSON", () => {
    const filePath = join(tmpDir, "bad.json");
    writeFileSync(filePath, "{ bad", "utf-8");
    expect(() => loadMockDataSpec(filePath)).toThrow(/无效的 JSON/);
  });
});

describe("exportDatasetSeed", () => {
  it("writes a correct JSON file with all requested tables", () => {
    const db = createMockDb({
      users: [
        { id: 1, name: "Alice" },
        { id: 2, name: "Bob" },
      ],
      orders: [{ id: "o1", total: 100 }],
    });

    const filePath = join(tmpDir, "export.json");
    exportDatasetSeed(db, ["users", "orders"], filePath);

    expect(existsSync(filePath)).toBe(true);
    const content = readFileSync(filePath, "utf-8");
    const parsed = JSON.parse(content);
    expect(parsed.users).toHaveLength(2);
    expect(parsed.orders).toHaveLength(1);
    expect(parsed.users[0].name).toBe("Alice");
  });

  it("creates parent directories if they do not exist", () => {
    const db = createMockDb({ users: [{ id: 1, name: "Alice" }] });
    const filePath = join(tmpDir, "sub", "nested", "export.json");

    exportDatasetSeed(db, ["users"], filePath);

    expect(existsSync(filePath)).toBe(true);
    const content = readFileSync(filePath, "utf-8");
    const parsed = JSON.parse(content);
    expect(parsed.users).toHaveLength(1);
  });
});

describe("importDatasetSeed", () => {
  it("loads data from a file into a MockDb", () => {
    const filePath = join(tmpDir, "seed.json");
    writeFileSync(
      filePath,
      JSON.stringify({
        customers: [
          { id: 10, name: "Customer A" },
          { id: 20, name: "Customer B" },
        ],
      }),
      "utf-8",
    );

    const db = createMockDb({ customers: [] });
    importDatasetSeed(db, filePath);

    const rows = db.query<{ id: number; name: string }>("customers");
    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.id === 10)?.name).toBe("Customer A");
    expect(rows.find((r) => r.id === 20)?.name).toBe("Customer B");
  });

  it("throws when the file contains invalid DatasetSeed", () => {
    const filePath = join(tmpDir, "bad.json");
    writeFileSync(filePath, JSON.stringify({ customers: "not-an-array" }), "utf-8");

    const db = createMockDb({ customers: [] });
    expect(() => importDatasetSeed(db, filePath)).toThrow(/not an array/);
  });
});