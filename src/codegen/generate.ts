import * as path from "node:path";
import type { ParsedDoc } from "./parse-doc.js";
import { parseDoc, entityTypeToTableName } from "./parse-doc.js";
import { parseServiceMethods, type ServiceMethod } from "./parse-service.js";
import { parseDtoSchemas, extractEnumFieldNames, inferDtoRelations, type DtoSchemaMap } from "./parse-dto.js";
import * as tpl from "./templates.js";

/**
 * 生成器等价的已解析中间结果。
 */
export interface CodegenModel {
  parsedDoc: ParsedDoc;
  serviceMethods: ServiceMethod[];
  dtoSchemas: DtoSchemaMap;
}

/**
 * 解析源文件 → 中间模型。
 */
export function parseModel(source: string): CodegenModel {
  const parsedDoc = parseDoc(source);
  const serviceMethods = parseServiceMethods(parsedDoc);
  const enumFieldNames = extractEnumFieldNames(parsedDoc);
  const dtoSchemas = parseDtoSchemas(parsedDoc, enumFieldNames);
  return { parsedDoc, serviceMethods, dtoSchemas };
}

/**
 * 生成 ts-client.mock.g.ts 内容。
 *
 * @param source 源文件内容
 * @param inputPath 源文件路径（用于推导 import 相对路径）
 * @param outputPath 输出文件路径（用于推导 import 相对路径）
 */
export function generate(source: string, inputPath: string, outputPath: string): {
  content: string;
  fieldCount: number;
  dtoCount: number;
} {
  const model = parseModel(source);
  const { serviceMethods, dtoSchemas } = model;

  // 推导 import 相对路径：从 output 目录到 input 文件的相对路径
  const importPath = deriveImportPath(inputPath, outputPath);

  // 收集源文件中的类型引用（供 import）
  const typeNames = collectTypeNames(model);

  const lines: string[] = [];
  lines.push(tpl.header());
  lines.push(tpl.imports(importPath, typeNames));

  // 表名推导：实体类型 → 表
  const tableToTypes = collectTables(serviceMethods);
  const tableInits: Record<string, string> = {};
  for (const [table, entityType] of Object.entries(tableToTypes)) {
    tableInits[table] = entityType;
  }
  lines.push(tpl.dbSkeleton(tableInits));

  // DTO schema 常量（提前声明：XxxSchema 先于 defineXxx、先于 scenarios）
  const dtoBlocks = Object.entries(dtoSchemas).map(([name, schema]) => ({
    name,
    schema: tpl.schemaLiteral(schema, "  "),
  }));
  lines.push(tpl.dtoTypeSchemas(dtoBlocks));

  // 工厂 DSL 骨架（v1.9.0）— 引用 XxxSchema，必须在 dtoTypeSchemas 之后
  lines.push(tpl.factorySkeleton(dtoBlocks));

  // 场景数据集骨架（v2.0.0：default 调用 defineXxx.makeN() 预填充）
  const dtoNames = Object.keys(dtoSchemas);
  lines.push(tpl.scenariosSkeleton(tableInits, dtoNames));
  lines.push(tpl.scenarioOverridesSkeleton());

  // 运行时校验骨架（v1.4.0）
  const schemaNames = Object.keys(dtoSchemas);
  lines.push(tpl.validateZodHelpers(schemaNames));

  // 实体关联注册骨架（v1.8.0）—— 从 DTO 类型自动推断 registerRelation
  const relations = inferDtoRelations(model.parsedDoc, dtoSchemas);
  if (relations.length > 0) {
    const relationCalls = relations.map((rel) => {
      const table = entityTypeToTableName(rel.sourceDto);
      const targetTable = entityTypeToTableName(rel.targetDto);
      return `db.registerRelation("${table}", "${rel.field}", {\n    type: "${rel.type}",\n    targetTable: "${targetTable}",\n    foreignKey: "${rel.fkField}"\n  });`;
    });
    lines.push(tpl.relationSkeleton(relationCalls));
  }

  // field handlers
  lines.push("// ── field handlers（骨架：db 操作已生成，Agent 只填业务意图） ──");
  lines.push("export const handlers = {");
  for (const method of serviceMethods) {
    lines.push(renderHandler(method));
  }
  lines.push(tpl.handlersSatisfies());
  lines.push(tpl.assertAllFieldsCovered());

  const content = lines.join("\n");
  return {
    content,
    fieldCount: serviceMethods.length,
    dtoCount: Object.keys(dtoSchemas).length,
  };
}

/**
 * 推导 import 相对路径：从 output 目录到 input 文件的相对路径。
 * nodenext 模块解析要求相对导入带显式扩展名（.js 指向同目录 .ts 源文件）。
 * 例如 input=src/ts-client.g.ts, output=src/ts-client.mock.g.ts → "./ts-client.g.js"
 */
function deriveImportPath(inputPath: string, outputPath: string): string {
  const outputDir = path.dirname(outputPath);
  let rel = path.relative(outputDir, inputPath);
  rel = rel.replace(/\\/g, "/");
  if (!rel.startsWith(".")) {
    rel = "./" + rel;
  }
  // 扩展名 .ts → .js（nodenext 下 ESM 相对导入必须带扩展名）
  rel = rel.replace(/\.ts$/, ".js");
  return rel;
}

/**
 * 收集生成产物中需要 import 的类型名。
 * 只收集真正的类型（args 类型、返回类型、Query/Mutation const），排除基础类型。
 */
function collectTypeNames(model: CodegenModel): string[] {
  const names = new Set<string>();
  // args 类型名
  for (const method of model.serviceMethods) {
    const argsProp = method.params[0];
    if (argsProp) {
      const first = argsProp.typeText.split("|")[0].trim().replace(/^\?/, "").trim();
      if (first && !isPrimitiveType(first)) names.add(first);
    }
  }
  // 返回类型名（过滤掉基础类型）
  for (const method of model.serviceMethods) {
    const rt = method.unwrappedReturnType;
    if (rt && !isPrimitiveType(rt)) names.add(rt);
  }
  // 实体类型名（dbSkeleton 的表初始化引用，如 `[] satisfies Merchant[]`）
  for (const method of model.serviceMethods) {
    const entity = method.entityType;
    if (entity && !isPrimitiveType(entity) && !entity.endsWith("Connection") && !entity.endsWith("Edge")) {
      names.add(entity);
    }
  }
  // Query / Mutation const 类型名
  names.add("Query");
  names.add("Mutation");
  return Array.from(names).filter((n) => n.length > 0);
}

const PRIMITIVE_TYPES = new Set(["boolean", "string", "number", "long", "int", "void", "Date", "DateTime"]);

function isPrimitiveType(typeName: string): boolean {
  return PRIMITIVE_TYPES.has(typeName);
}

/**
 * 收集表名 → 实体类型名映射。
 * 表名从实体类型名推导（首字母小写 + 复数 s）。
 */
function collectTables(serviceMethods: ServiceMethod[]): Record<string, string> {
  const result: Record<string, string> = {};
  for (const method of serviceMethods) {
    const entityType = method.entityType;
    if (!entityType) continue;
    const table = entityTypeToTableName(entityType);
    result[table] = entityType;
  }
  return result;
}

/**
 * 渲染单个 field 的 handler。
 */
function renderHandler(method: ServiceMethod): string {
  const fieldName = method.name;
  const argsProp = method.params[0];
  const argsTypeName = argsProp ? resolveArgsTypeName(argsProp.typeText) : undefined;
  const returnTypeName = method.unwrappedReturnType;
  const table = entityTypeToTableName(method.entityType);

  const isMutation = argsTypeName?.startsWith("Create")
    || argsTypeName?.startsWith("Update")
    || argsTypeName?.startsWith("Delete")
    || argsTypeName?.startsWith("Remove")
    || argsTypeName?.startsWith("Insert")
    || method.hasInput;

  if (isMutation) {
    // update 类 mutation（含 input）
    if (method.name.toLowerCase().startsWith("update") && method.hasInput) {
      const idExpr = method.hasIdField ? "vars?.id" : "vars?.input?.id";
      const entity = method.entityType ?? "unknown";
      const body = [
        `return db.update<${entity}>("${table}", ${idExpr} as string | number, (vars?.input ?? {}) as Partial<${entity}>) as ${returnTypeName};`,
        tpl.idExtractionTodo(),
      ].join("\n    ");
      return tpl.handlerBlock(fieldName, argsTypeName, returnTypeName, body, " (mutation)");
    }
    // insert 类 mutation（create）
    if (method.hasInput) {
      const body = `return db.insert("${table}", vars?.input) as ${returnTypeName};`;
      return tpl.handlerBlock(fieldName, argsTypeName, returnTypeName, body, " (mutation)");
    }
    // delete / remove 类 mutation
    if (method.name.toLowerCase().startsWith("delete") || method.name.toLowerCase().startsWith("remove")) {
      const body = `return db.remove("${table}", vars?.id as string | number) as ${returnTypeName};`;
      return tpl.handlerBlock(fieldName, argsTypeName, returnTypeName, body, " (mutation)");
    }
    // 无法归类 mutation
    const body = [
      `return db.query("${table}");`,
      "// " + tpl.agentFillTodo(),
    ].join("\n    ");
    return tpl.handlerBlock(fieldName, argsTypeName, returnTypeName, body, " (mutation)");
  }

  // query 处理
  const reversePaginationNote = method.hasReversePagination
    ? `\n  // ${tpl.reversePaginationTodo()}`
    : "";

  if (isConnectionReturn(returnTypeName)) {
    // Connection 返回 → db.query 结果包成 Connection 形状（nodes/totalCount/pageInfo）
    const parts: string[] = [];
    if (method.hasWhere) parts.push("vars?.where");
    if (method.hasOrder) parts.push("vars?.order");
    if (method.hasForwardPagination) {
      parts.push("{ first: vars?.first, after: vars?.after }");
    }
    const args = parts.length > 0 ? ", " + parts.join(", ") : "";
    const body = [
      `const rows = db.query("${table}"${args});`,
      `return { nodes: rows, totalCount: rows.length, pageInfo: { hasPreviousPage: false, hasNextPage: false } } as ${returnTypeName};`,
      `// TODO: pageInfo 游标分页需按 rows 计算，骨架先置空（Agent 可细化）`,
    ].join("\n    ");
    return tpl.handlerBlock(fieldName, argsTypeName, returnTypeName, body, " (query)") + reversePaginationNote;
  }

  // 单实体 query → db.queryOne（骨架假定存在；消费端可自行改判空逻辑）
  let body: string;
  if (method.hasWhere) {
    body = `return db.queryOne("${table}", vars?.where) as ${returnTypeName};`;
  } else if (method.hasIdField) {
    // args 无 where 但含 id（如 getById 型查询）→ 按 id 过滤
    body = `return db.queryOne("${table}", { id: vars?.id }) as ${returnTypeName};`;
  } else {
    body = `return db.queryOne("${table}") as ${returnTypeName};`;
  }
  return tpl.handlerBlock(fieldName, argsTypeName, returnTypeName, body, " (query, 单条)");
}

function resolveArgsTypeName(raw: string): string {
  const clean = raw.replace(/^\?/, "");
  const first = clean.split("|")[0].trim();
  return first.replace(/[?]/g, "").trim();
}

function isConnectionReturn(returnTypeName: string): boolean {
  return returnTypeName.endsWith("Connection");
}