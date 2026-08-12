import type { ParsedDoc, ParsedInterface } from "./parse-doc.js";
import type { MockFieldSchema } from "../factory.js";
import type { RelationType } from "../mock-db.js";

/**
 * DTO 解析结果：接口名 → record 字段名 → MockFieldSchema
 */
export type DtoSchemaMap = Record<string, Record<string, MockFieldSchema>>;

/**
 * 推断出的 DTO 间关系（v1.8.0）。
 */
export interface DtoRelationInference {
  /** 源 DTO 名（如表 "paymentLogs" 对应 PaymentLog） */
  sourceDto: string;
  /** 源 DTO 中触发推断的字段名（如 "merchant"） */
  field: string;
  type: RelationType;
  /** 目标 DTO 名 */
  targetDto: string;
  /** 外键字段名（已推断，如 "merchantId"） */
  fkField: string;
}

/**
 * 从 DTO 类型自动推断实体关联（v1.8.0）。
 *
 * 推断规则（FK 字段门控，Oracle 审查 B4）：
 * - DTO 直接引用（如 `merchant?: Merchant`）+ 源 DTO 存在 `merchantId` 字段 → belongsTo
 * - DTO 数组字段（如 `logs?: PaymentLog[]`）+ 目标 DTO 存在 `merchantId` 字段 → hasMany
 * - 无 FK 字段的 DTO 引用 → 视为嵌入 embed，不推断
 * - 自引用（如 `Merchant.children?: Merchant[]`）→ 不推断
 *
 * @param parsedDoc 已解析的文档模型
 * @param dtoSchemas 已解析的 DTO schema 映射（用于 FK 字段门控）
 */
export function inferDtoRelations(
  parsedDoc: ParsedDoc,
  dtoSchemas: DtoSchemaMap,
): DtoRelationInference[] {
  const relations: DtoRelationInference[] = [];
  const dtoNames = new Set(parsedDoc.dtoInterfaceNames);

  // 方向 1：belongsTo —— DTO 直接引用字段 + FK 字段门控
  for (const sourceDto of dtoNames) {
    const iface = parsedDoc.interfaces.find((i) => i.name === sourceDto);
    const schema = dtoSchemas[sourceDto];
    if (!iface || !schema) continue;

    for (const prop of iface.properties) {
      // 解析字段类型文本：去可选/联合，取裸类型名
      const typeName = extractScalarRefType(prop.typeText);
      if (!typeName || !dtoNames.has(typeName) || typeName === sourceDto) continue;

      // FK 门控：源 DTO 必须有 `<target 首小写>Id` 字段
      const fkField = firstLower(typeName) + "Id";
      if (schema[fkField] === undefined) continue;

      // 排除 FK 字段本身（如 merchantId: number 不是引用）与 id
      if (prop.name === "id" || prop.name === fkField) continue;

      relations.push({
        sourceDto,
        field: prop.name,
        type: "belongsTo",
        targetDto: typeName,
        fkField,
      });
    }
  }

  // 方向 2：hasMany —— DTO 数组字段 + 目标 DTO 有反向 FK
  for (const sourceDto of dtoNames) {
    const iface = parsedDoc.interfaces.find((i) => i.name === sourceDto);
    if (!iface) continue;

    for (const prop of iface.properties) {
      const elemType = extractArrayElementType(prop.typeText);
      if (!elemType || !dtoNames.has(elemType) || elemType === sourceDto) continue;

      // FK 门控：目标 DTO 有 `<source 首小写>Id` 字段（反向 FK 指向 source）
      const reverseFk = firstLower(sourceDto) + "Id";
      if (dtoSchemas[elemType]?.[reverseFk] === undefined) continue;

      relations.push({
        sourceDto,
        field: prop.name,
        type: "hasMany",
        targetDto: elemType,
        fkField: reverseFk,
      });
    }
  }

  return relations;
}

/** 取标量引用类型的裸类型名（去可选标记、去 null/undefined 联合、去泛型） */
function extractScalarRefType(typeText: string): string | null {
  const clean = typeText.replace(/[?]/g, "").split("|").map((s) => s.trim());
  const nonNull = clean.find((t) => t !== "null" && t !== "undefined");
  if (!nonNull) return null;
  // 内联对象/数组/基本类型 → 非 DTO 引用
  if (nonNull.startsWith("{") || nonNull.endsWith("[]") || /^(Readonly)?Array<.+>$/.test(nonNull)) {
    return null;
  }
  const match = nonNull.match(/^(\w+)$/);
  return match ? match[1] : null;
}

function firstLower(name: string): string {
  return name.charAt(0).toLowerCase() + name.slice(1);
}

function extractArrayElementType(typeText: string): string | null {
  const arr = typeText.replace(/\?/g, "").match(/^(.+)\[\]$/);
  if (arr) return arr[1]?.trim() ?? null;
  const generic = typeText.replace(/\?/g, "").match(/^(?:Readonly)?Array<(.+)>$/);
  return generic?.[1]?.trim() ?? null;
}

/**
 * 将 DTO interface 转换为 MockFieldSchema 记录。
 *
 * @param parsedDoc 已解析的文档模型
 * @param enumFieldNames 已知的枚举字段名列表（来自 filter input 中引用 EnumOperationFilterInput 的字段）
 */
export function parseDtoSchemas(
  parsedDoc: ParsedDoc,
  enumFieldNames: string[],
): DtoSchemaMap {
  const result: DtoSchemaMap = {};
  const interfaceMap = new Map(
    parsedDoc.interfaces.map((i) => [i.name, i]),
  );

  // visited 集合用于循环引用防护
  const visited = new Set<string>();

  for (const dtoName of parsedDoc.dtoInterfaceNames) {
    const iface = interfaceMap.get(dtoName);
    if (!iface) continue;
    const schema = processInterface(iface, interfaceMap, enumFieldNames, visited);
    result[dtoName] = schema;
  }

  return result;
}

function processInterface(
  iface: ParsedInterface,
  interfaceMap: Map<string, ParsedInterface>,
  enumFieldNames: string[],
  visited: Set<string>,
): Record<string, MockFieldSchema> {
  const schema: Record<string, MockFieldSchema> = {};

  for (const prop of iface.properties) {
    schema[prop.name] = typeTextToSchema(
      prop.name,
      prop.typeText,
      interfaceMap,
      enumFieldNames,
      visited,
      iface.name,
    );
  }

  return schema;
}

function typeTextToSchema(
  fieldName: string,
  typeText: string,
  interfaceMap: Map<string, ParsedInterface>,
  enumFieldNames: string[],
  visited: Set<string>,
  currentInterfaceName: string,
): MockFieldSchema {
  // 处理联合类型（如 `string | null`）→ 取第一个非 null/undefined 子类型
  if (typeText.includes("|")) {
    const parts = typeText.split("|").map((s) => s.trim());
    const nonNull = parts.find((t) => t !== "null" && t !== "undefined");
    if (nonNull) {
      return typeTextToSchema(fieldName, nonNull, interfaceMap, enumFieldNames, visited, currentInterfaceName);
    }
  }

  // 数组类型：T[] 或 Array<T>
  const arrayMatch = typeText.match(/^(.+)\[\]$/);
  if (arrayMatch) {
    return {
      kind: "array",
      element: typeTextToSchema(fieldName, arrayMatch[1], interfaceMap, enumFieldNames, visited, currentInterfaceName),
    };
  }

  // ReadonlyArray<T> / Array<T>
  const genericArrayMatch = typeText.match(/^(?:Readonly)?Array<(.+)>$/);
  if (genericArrayMatch) {
    return {
      kind: "array",
      element: typeTextToSchema(fieldName, genericArrayMatch[1], interfaceMap, enumFieldNames, visited, currentInterfaceName),
    };
  }

  // Record<K, V> / Partial<T> / Required<T> / Pick<T> / Omit<T> → 降级为 string
  if (/^(Record|Partial|Required|Pick|Omit|Readonly)</.test(typeText)) {
    return { kind: "string" };
  }

  // 基本类型
  if (typeText === "string") {
    return handleStringField(fieldName, enumFieldNames);
  }
  if (typeText === "number" || typeText === "long" || typeText === "int") {
    return isIdField(fieldName) ? { kind: "number", isId: true } : { kind: "number" };
  }
  if (typeText === "boolean") {
    return { kind: "boolean" };
  }
  if (typeText === "Date" || typeText === "DateTime") {
    return { kind: "date" };
  }

  // 枚举类型引用
  if (typeText.includes("Enum") || typeText.includes("enum")) {
    return { kind: "enum", enumValues: [] };
  }

  // 其他类型引用 → 可能是嵌套 interface
  if (interfaceMap.has(typeText)) {
    // 循环引用防护
    if (visited.has(typeText)) {
      return { kind: "object", fields: {} };
    }
    visited.add(typeText);
    const nested = interfaceMap.get(typeText)!;
    const fields = processInterface(nested, interfaceMap, enumFieldNames, visited);
    visited.delete(typeText);
    return { kind: "object", fields };
  }

  // 内联对象类型字面量：{ nested: string; value: number }
  if (typeText.startsWith("{") && typeText.endsWith("}")) {
    const inner = typeText.slice(1, -1).trim();
    const fields: Record<string, MockFieldSchema> = {};
    // 解析内联字段：propName: type;
    const propRegex = /(\w+)\s*:\s*([^;]+?)(?:;|$)/g;
    let propMatch;
    while ((propMatch = propRegex.exec(inner)) !== null) {
      const propName = propMatch[1];
      const propType = propMatch[2].trim();
      fields[propName] = typeTextToSchema(propName, propType, interfaceMap, enumFieldNames, visited, currentInterfaceName);
    }
    return { kind: "object", fields };
  }

  // 未知类型 → 降级为 string
  return { kind: "string" };
}

function handleStringField(fieldName: string, enumFieldNames: string[]): MockFieldSchema {
  if (enumFieldNames.includes(fieldName)) {
    return { kind: "enum", enumValues: [] };
  }
  // 字段名含 At/Time → date
  if (/[Aa]t\b/.test(fieldName) || /[Tt]ime/.test(fieldName)) {
    return { kind: "date" };
  }
  return isIdField(fieldName) ? { kind: "string", isId: true } : { kind: "string" };
}

function isIdField(fieldName: string): boolean {
  return fieldName === "id";
}

/**
 * 从 parsedDoc 中提取枚举字段名列表。
 * 规则：若 filter input 的某个字段引用 EnumOperationFilterInput，则该字段名标记为枚举。
 */
export function extractEnumFieldNames(parsedDoc: ParsedDoc): string[] {
  const enumFieldNames: string[] = [];
  const interfaceMap = new Map(
    parsedDoc.interfaces.map((i) => [i.name, i]),
  );

  for (const filterName of parsedDoc.filterInputNames) {
    const iface = interfaceMap.get(filterName);
    if (!iface) continue;
    for (const prop of iface.properties) {
      if (isEnumOperationFilterInput(prop.typeText)) {
        enumFieldNames.push(prop.name);
      }
    }
  }

  return enumFieldNames;
}

function isEnumOperationFilterInput(typeText: string): boolean {
  return typeText.includes("EnumOperationFilterInput");
}