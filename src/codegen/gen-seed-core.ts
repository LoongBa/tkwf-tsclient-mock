import * as fs from "node:fs";
import * as path from "node:path";
import {
  parseMockDataSpec,
  generateFromSpec,
  serializeDatasetSeed,
} from "../mock-data-spec.js";
import type { DatasetSeed } from "../mock-db.js";

/**
 * Generate a DatasetSeed JSON file from a MockDataSpec JSON file.
 *
 * Reads the spec, generates data via `generateFromSpec`, serializes to JSON,
 * and writes to the output path. Creates parent directories as needed.
 *
 * @param specPath  Path to mock-data-spec.json
 * @param options   Optional: { output, scenario, faker }
 * @returns         Object with table count and output path
 *
 * @example
 * ```ts
 * const result = await generateSeedFile("mock-data-spec.json", {
 *   output: "seed.json",
 *   scenario: "default",
 *   faker: fakerZH_CN,
 * });
 * console.log(`Generated ${result.tableCount} tables → ${result.outputPath}`);
 * ```
 */
export async function generateSeedFile(
  specPath: string,
  options?: {
    output?: string;
    scenario?: string;
    faker?: Record<string, unknown>;
  },
): Promise<{ tableCount: number; outputPath: string }> {
  const outputPath = options?.output ?? "seed.json";

  const content = fs.readFileSync(specPath, "utf-8");
  const spec = parseMockDataSpec(content);

  const seed: DatasetSeed = generateFromSpec(spec, {
    faker: options?.faker,
    scenario: options?.scenario,
  });

  const json = serializeDatasetSeed(seed, { pretty: true });
  const dir = path.dirname(outputPath);
  if (dir && dir !== ".") {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(outputPath, json, "utf-8");

  return { tableCount: Object.keys(seed).length, outputPath };
}

