import { readFileSync, writeFileSync } from "node:fs";
import { generate } from "./generate.js";

/**
 * gen-mock-handlers 的 API 形式。
 *
 * 读取消费端 ts-client.g.ts，生成 ts-client.mock.g.ts。
 *
 * @param input 输入文件路径（ts-client.g.ts）
 * @param output 输出文件路径（ts-client.mock.g.ts）
 * @returns 统计信息：{ fields, dtos }
 */
export function genMockHandlers(input: string, output: string): { fields: number; dtos: number } {
  const source = readFileSync(input, "utf-8");
  const result = generate(source, input, output);
  writeFileSync(output, result.content, "utf-8");
  return { fields: result.fieldCount, dtos: result.dtoCount };
}

export { generate, parseModel } from "./generate.js";
export type { CodegenModel } from "./generate.js";
export { parseDoc } from "./parse-doc.js";
export type { ParsedDoc, ParsedInterface, ParsedProperty, ParsedMethod, ParsedTypeAlias } from "./parse-doc.js";
export { parseServiceMethods, entityTypeToTableName } from "./parse-service.js";
export type { ServiceMethod } from "./parse-service.js";
export { parseDtoSchemas, extractEnumFieldNames } from "./parse-dto.js";
export type { DtoSchemaMap } from "./parse-dto.js";