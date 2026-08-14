import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname } from "node:path";
import { mkdirSync } from "node:fs";
import { generate } from "./generate.js";

/**
 * gen-mock-handlers 的 API 形式。
 *
 * 读取消费端 ts-client.g.ts，生成 ts-client.mock.g.ts。
 * 可选的 --mock-spec 输出 MOCK_SPEC.md 的 API → 数据表映射表。
 *
 * @param input 输入文件路径（ts-client.g.ts）
 * @param output 输出文件路径（ts-client.mock.g.ts）
 * @param mockSpecPath 可选：MOCK_SPEC.md 路径（幂等更新映射表标记段）
 * @returns 统计信息：{ fields, dtos }
 */
export function genMockHandlers(
  input: string,
  output: string,
  mockSpecPath?: string,
): { fields: number; dtos: number } {
  const source = readFileSync(input, "utf-8");
  const result = generate(source, input, output, mockSpecPath ? { mockSpecPath } : undefined);
  writeFileSync(output, result.content, "utf-8");

  if (result.mockSpecContent && mockSpecPath) {
    writeMockSpec(mockSpecPath, result.mockSpecContent);
  }

  return { fields: result.fieldCount, dtos: result.dtoCount };
}

/**
 * 幂等更新 MOCK_SPEC.md 的映射表标记段：
 * - 文件存在且有 `<!-- auto-generated: mapping-table -->` / `<!-- end-auto-generated -->` 标记 → 只替换标记段
 * - 文件存在但无标记 → 追加到文件末尾
 * - 文件不存在 → 创建目录并写入
 */
function writeMockSpec(mockSpecPath: string, newBlock: string): void {
  const blockPattern = /<!-- auto-generated: mapping-table -->[\s\S]*?<!-- end-auto-generated -->/;

  if (existsSync(mockSpecPath)) {
    const existing = readFileSync(mockSpecPath, "utf-8");
    let updated: string;
    if (blockPattern.test(existing)) {
      updated = existing.replace(blockPattern, newBlock);
    } else {
      updated = `${existing.replace(/\s*$/, "")}\n\n${newBlock}\n`;
    }
    writeFileSync(mockSpecPath, updated, "utf-8");
  } else {
    // 文件不存在 → 确保目录存在后写入
    mkdirSync(dirname(mockSpecPath), { recursive: true });
    writeFileSync(mockSpecPath, `${newBlock}\n`, "utf-8");
  }
}

export { generate, parseModel } from "./generate.js";
export type { CodegenModel } from "./generate.js";
export { parseDoc } from "./parse-doc.js";
export type { ParsedDoc, ParsedInterface, ParsedProperty, ParsedMethod, ParsedTypeAlias } from "./parse-doc.js";
export { parseServiceMethods, entityTypeToTableName } from "./parse-service.js";
export type { ServiceMethod } from "./parse-service.js";
export { parseDtoSchemas, extractEnumFieldNames } from "./parse-dto.js";
export type { DtoSchemaMap } from "./parse-dto.js";