import type { DatasetSeed, MockDb } from "./mock-db.js";
import type { MockDataSpec } from "./mock-data-spec.js";
import { parseMockDataSpec, parseDatasetSeed } from "./mock-data-spec.js";
import * as fs from "node:fs";
import * as path from "node:path";

/**
 * Export selected tables from a MockDb to a JSON file.
 * Node-only — uses fs and path.
 * Creates the parent directory if it does not exist.
 */
export function exportDatasetSeed(
  db: MockDb,
  tables: string[],
  filePath: string,
): void {
  const seed: DatasetSeed = {};
  for (const table of tables) {
    seed[table] = db.query<Record<string, unknown>>(table);
  }
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(seed, null, 2), "utf-8");
}

/**
 * Import a DatasetSeed from a JSON file into a MockDb.
 * Node-only — uses fs.
 * @param options.unknownTables v1.4.3：透传给 buildDataset，检测表名不匹配（"warn" | "error" | "ignore"）
 */
export function importDatasetSeed(
  db: MockDb,
  filePath: string,
  options?: { unknownTables?: "warn" | "error" | "ignore" },
): void {
  const content = fs.readFileSync(filePath, "utf-8");
  const seed = parseDatasetSeed(content);
  db.buildDataset(seed, { unknownTables: options?.unknownTables });
}

/**
 * Load a MockDataSpec from a JSON file.
 * Node-only — uses fs.
 */
export function loadMockDataSpec(filePath: string): MockDataSpec {
  const content = fs.readFileSync(filePath, "utf-8");
  return parseMockDataSpec(content);
}