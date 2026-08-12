/**
 * 轻量级文档解析器 —— 用正则解析 ts-client.g.ts。
 *
 * 输入格式由主包 codegen 产物决定，结构稳定，适合正则匹配。
 * 不依赖 typescript compiler API（TS7 已移除旧 API）。
 */

export interface ParsedDoc {
  /** Query/Mutation 的 field 清单（含分类） */
  fields: Array<{ name: string; type: "query" | "mutation" }>;
  /** operationSelection 映射（可选） */
  operationSelection: Readonly<Record<string, string>> | null;
  /** 全部命名的 interface 声明 */
  interfaces: ParsedInterface[];
  /** 全部命名的 type 别名声明 */
  typeAliases: ParsedTypeAlias[];
  /** 含方法签名的 interface 名（Service 接口） */
  serviceInterfaceNames: string[];
  /** 过滤输入类型名（*FilterInput） */
  filterInputNames: string[];
  /** 候选 DTO 接口名（非 Service / 非 Args / 非 Input / 非 FilterInput / 非 SortInput / 非 Edge） */
  dtoInterfaceNames: string[];
}

export interface ParsedInterface {
  name: string;
  /** 是否含方法签名（Service 接口） */
  isService: boolean;
  /** 属性成员（DTO 字段） */
  properties: ParsedProperty[];
  /** 方法成员（Service 方法） */
  methods: ParsedMethod[];
}

export interface ParsedProperty {
  name: string;
  typeText: string;
  optional: boolean;
}

export interface ParsedMethod {
  name: string;
  /** 参数（统一单 args 对象） */
  params: ParsedProperty[];
  returnTypeText: string;
}

export interface ParsedTypeAlias {
  name: string;
  typeText: string;
}

const SERVICE_SUFFIX = "Service";
const ARGS_SUFFIX = "Args";
const INPUT_SUFFIX = "Input";
const FILTER_INPUT_SUFFIX = "FilterInput";
const SORT_INPUT_SUFFIX = "SortInput";
const EDGE_SUFFIX = "Edge";

/**
 * 解析 ts-client.g.ts 的结构化文档模型。
 * 跳过 import 声明；只提取结构，不推断语义。
 */
export function parseDoc(source: string): ParsedDoc {
  // 去掉 import 行
  const noImports = source.replace(/^import\s+.*?;$/gm, "").trim();

  const fields: ParsedDoc["fields"] = [];
  const interfaces: ParsedInterface[] = [];
  const typeAliases: ParsedTypeAlias[] = [];
  let operationSelection: Record<string, string> | null = null;

  // 提取 export const Query = { ... } 的键
  for (const key of extractConstObjectKeys(noImports, "Query")) {
    fields.push({ name: key, type: "query" });
  }

  // 提取 export const Mutation = { ... } 的键
  for (const key of extractConstObjectKeys(noImports, "Mutation")) {
    fields.push({ name: key, type: "mutation" });
  }

  // 提取 export const operationSelection = { ... }
  const opSelMatch = noImports.match(
    /export\s+const\s+operationSelection\s*=\s*\{([^}]+)\}\s*as\s+const\s*;/,
  );
  if (opSelMatch) {
    operationSelection = {};
    const body = opSelMatch[1];
    const pairRegex = /(\w+)\s*:\s*"([^"]*)"/g;
    let pair;
    while ((pair = pairRegex.exec(body)) !== null) {
      operationSelection[pair[1]] = pair[2];
    }
  }

  // 提取 interface 声明（括号深度扫描，非贪婪正则会在多行嵌套对象处提前截断）
  const ifaceDeclRegex = /export\s+interface\s+(\w+)\s*(\{|<)/g;
  let ifaceMatch;
  while ((ifaceMatch = ifaceDeclRegex.exec(noImports)) !== null) {
    const name = ifaceMatch[1];
    // 泛型 interface（如 EnumOperationFilterInput<T>）不解析，跳过
    if (ifaceMatch[2] !== "{") continue;
    const bodyStart = noImports.indexOf("{", ifaceMatch.index);
    if (bodyStart === -1) continue;
    // 深度扫描匹配闭合花括号
    let depth = 0;
    let i = bodyStart;
    for (; i < noImports.length; i++) {
      const ch = noImports[i];
      if (ch === "{") depth++;
      else if (ch === "}") {
        depth--;
        if (depth === 0) break;
      }
    }
    if (depth !== 0) continue; // 未闭合，跳过
    const body = noImports.slice(bodyStart + 1, i).trim();
    if (!body) continue;

    const parsed = parseInterfaceBody(name, body);
    interfaces.push(parsed);
  }

  // 提取 type 别名声明
  const typeAliasRegex = /export\s+type\s+(\w+)\s*=\s*([^;]+);/g;
  let aliasMatch;
  while ((aliasMatch = typeAliasRegex.exec(noImports)) !== null) {
    typeAliases.push({
      name: aliasMatch[1],
      typeText: aliasMatch[2].trim(),
    });
  }

  const serviceInterfaceNames = interfaces
    .filter((i) => i.isService)
    .map((i) => i.name);

  const filterInputNames = interfaces
    .map((i) => i.name)
    .filter((n) => n.endsWith(FILTER_INPUT_SUFFIX));

  const dtoInterfaceNames = interfaces
    .filter((i) => !i.isService)
    .filter((i) => !isNonDtoName(i.name))
    .map((i) => i.name);

  return {
    fields,
    operationSelection,
    interfaces,
    typeAliases,
    serviceInterfaceNames,
    filterInputNames,
    dtoInterfaceNames,
  };
}

function extractConstObjectKeys(source: string, constName: string): string[] {
  const regex = new RegExp(
    `export\\s+const\\s+${constName}\\s*=\\s*\\{([\\s\\S]*?)\\}\\s*(as\\s+const)?\\s*;`,
  );
  const match = source.match(regex);
  if (!match) return [];

  const body = match[1];
  const keys: string[] = [];
  // 匹配键: { field: "...", type: "..." }
  const keyRegex = /(\w+)\s*:\s*\{/g;
  let keyMatch;
  while ((keyMatch = keyRegex.exec(body)) !== null) {
    keys.push(keyMatch[1]);
  }
  return keys;
}

function parseInterfaceBody(name: string, body: string): ParsedInterface {
  const properties: ParsedProperty[] = [];
  const methods: ParsedMethod[] = [];
  let isService = false;

  const lines = splitInterfaceBody(body);

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // 方法签名: methodName(args?: Type): ReturnType;
    const methodMatch = trimmed.match(
      /^(\w+)\s*\(([^)]*)\)\s*:\s*(.+?);$/,
    );
    if (methodMatch) {
      isService = true;
      const methodName = methodMatch[1];
      const paramsText = methodMatch[2];
      const returnTypeText = methodMatch[3].trim();

      const params = parseParams(paramsText);
      methods.push({
        name: methodName,
        params,
        returnTypeText,
      });
      continue;
    }

    // 属性签名: propName?: Type;（s 标志支持跨行嵌套对象字面量）
    const propMatch = trimmed.match(
      /^(\w+)(\??)\s*:\s*(.+?);\s*$/s,
    );
    if (propMatch) {
      properties.push({
        name: propMatch[1],
        optional: propMatch[2] === "?",
        typeText: propMatch[3].trim(),
      });
    }
  }

  return { name, isService, properties, methods };
}

function splitInterfaceBody(body: string): string[] {
  // 智能分割：处理嵌套 {}
  const lines: string[] = [];
  let current = "";
  let depth = 0;

  for (const ch of body) {
    if (ch === "{") {
      depth++;
      current += ch;
    } else if (ch === "}") {
      depth--;
      current += ch;
    } else if (ch === ";" && depth === 0) {
      current += ch;
      lines.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  if (current.trim()) {
    lines.push(current);
  }

  return lines;
}

function parseParams(paramsText: string): ParsedProperty[] {
  if (!paramsText.trim()) return [];
  const params: ParsedProperty[] = [];
  const parts = splitParams(paramsText);
  for (const part of parts) {
    const match = part.match(/(\w+)(\??)\s*:\s*(.+)/);
    if (match) {
      params.push({
        name: match[1],
        optional: match[2] === "?",
        typeText: match[3].trim(),
      });
    }
  }
  return params;
}

function splitParams(text: string): string[] {
  // 按逗号分割，考虑泛型 <> 嵌套
  const parts: string[] = [];
  let current = "";
  let depth = 0;
  for (const ch of text) {
    if (ch === "<" || ch === "{" || ch === "(") {
      depth++;
      current += ch;
    } else if (ch === ">" || ch === "}" || ch === ")") {
      depth--;
      current += ch;
    } else if (ch === "," && depth === 0) {
      parts.push(current.trim());
      current = "";
    } else {
      current += ch;
    }
  }
  if (current.trim()) {
    parts.push(current.trim());
  }
  return parts;
}

/**
 * 实体类型名 → 表名（首字母小写 + 复数 s）
 */
export function entityTypeToTableName(entityType: string): string {
  if (entityType.length === 0) return entityType;
  return entityType.charAt(0).toLowerCase() + entityType.slice(1) + "s";
}

function isNonDtoName(name: string): boolean {
  return (
    name.endsWith(ARGS_SUFFIX) ||
    name.endsWith(INPUT_SUFFIX) ||
    name.endsWith(FILTER_INPUT_SUFFIX) ||
    name.endsWith(SORT_INPUT_SUFFIX) ||
    name.endsWith(EDGE_SUFFIX) ||
    name.endsWith(SERVICE_SUFFIX)
  );
}