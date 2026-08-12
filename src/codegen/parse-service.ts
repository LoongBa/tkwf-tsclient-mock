import type { ParsedDoc, ParsedProperty } from "./parse-doc.js";

/**
 * 解析后的 Service 方法信息。
 */
export interface ServiceMethod {
  /** 方法名（对应 field 名） */
  name: string;
  /** 参数（统一单 args 对象） */
  params: ParsedProperty[];
  /** 原始返回类型文本 */
  returnTypeText: string;
  /** 解包后的返回类型名（去掉 ChainablePromise） */
  unwrappedReturnType: string;
  /** 实体类型名（从 Connection 别名解包后） */
  entityType: string;
  /** 参数是否含 last/before */
  hasReversePagination: boolean;
  /** 参数是否含 input 字段 */
  hasInput: boolean;
  /** 参数是否含 where 字段 */
  hasWhere: boolean;
  /** 参数是否含 order 字段 */
  hasOrder: boolean;
  /** 参数是否含 first/after */
  hasForwardPagination: boolean;
  /** 参数是否含 id 字段 */
  hasIdField: boolean;
}

/**
 * 解析 Service 方法：
 * 1. 从 ParsedDoc 中找到所有 Service 接口（含方法签名的 interface）
 * 2. 提取每个方法 → 方法名、参数、返回类型
 * 3. 解包 ChainablePromise<T> → T
 * 4. 解析 XxxConnection 别名 → 实体类型
 */
export function parseServiceMethods(parsedDoc: ParsedDoc): ServiceMethod[] {
  const typeAliasMap = new Map(
    parsedDoc.typeAliases.map((a) => [a.name, a.typeText]),
  );
  const interfaceMap = new Map(
    parsedDoc.interfaces.map((i) => [i.name, i]),
  );

  const methods: ServiceMethod[] = [];
  const seen = new Set<string>();

  for (const iface of parsedDoc.interfaces) {
    if (!iface.isService) continue;
    for (const method of iface.methods) {
      if (seen.has(method.name)) continue;
      seen.add(method.name);

      const unwrappedReturnType = unwrapChainablePromise(method.returnTypeText);
      let entityType = resolveEntityType(unwrappedReturnType, typeAliasMap);

      // 若返回类型不是实体（如 mutation 返回 boolean），从方法名推导实体类型
      // 例如 deletePaymentLog → PaymentLog
      if (isPrimitiveType(entityType)) {
        const derived = deriveEntityFromMethodName(method.name);
        if (derived) entityType = derived;
      }

      const argsProp = method.params[0];
      const argsTypeName = argsProp ? resolveTypeName(argsProp.typeText) : undefined;
      const argsInterface = argsTypeName ? interfaceMap.get(argsTypeName) : undefined;

      const hasInput = argsInterface
        ? argsInterface.properties.some((p) => p.name === "input")
        : false;
      const hasWhere = argsInterface
        ? argsInterface.properties.some((p) => p.name === "where")
        : false;
      const hasOrder = argsInterface
        ? argsInterface.properties.some((p) => p.name === "order")
        : false;
      const hasFirst = argsInterface
        ? argsInterface.properties.some((p) => p.name === "first")
        : false;
      const hasAfter = argsInterface
        ? argsInterface.properties.some((p) => p.name === "after")
        : false;
      const hasLast = argsInterface
        ? argsInterface.properties.some((p) => p.name === "last")
        : false;
      const hasBefore = argsInterface
        ? argsInterface.properties.some((p) => p.name === "before")
        : false;
      const hasIdField = argsInterface
        ? argsInterface.properties.some((p) => p.name === "id")
        : false;

      methods.push({
        name: method.name,
        params: method.params,
        returnTypeText: method.returnTypeText,
        unwrappedReturnType,
        entityType,
        hasReversePagination: hasLast || hasBefore,
        hasInput,
        hasWhere,
        hasOrder,
        hasForwardPagination: hasFirst || hasAfter,
        hasIdField,
      });
    }
  }

  return methods;
}

/**
 * 从类型文本中提取类型名（如 `PaymentLogArgs` → `"PaymentLogArgs"`，
 * `PaymentLogArgs | CreatePaymentLogInput` → `"PaymentLogArgs"`）。
 */
function resolveTypeName(typeText: string): string {
  // 联合类型 → 取第一个
  const first = typeText.split("|").map((s) => s.trim())[0];
  if (first) return first;
  return typeText;
}

/**
 * 解包 `ChainablePromise<T>` → `T`。
 * 也处理 `Promise<T>`。
 */
function unwrapChainablePromise(typeText: string): string {
  const match = typeText.match(/^(ChainablePromise|Promise)<(.+)>$/);
  if (match) {
    return match[2].trim();
  }
  return typeText.trim();
}

/**
 * 解析实体类型：
 * 1. 如果类型名是 type alias（如 `XxxConnection = Connection<Xxx, XxxEdge>`），取第一个类型参数
 * 2. 否则原样返回
 */
function resolveEntityType(typeName: string, typeAliasMap: Map<string, string>): string {
  const alias = typeAliasMap.get(typeName);
  if (!alias) return typeName;

  // 从 Connection<Xxx, XxxEdge> 提取第一个类型参数
  const connMatch = alias.match(/^Connection<(\w+)/);
  if (connMatch) {
    return connMatch[1];
  }
  return typeName;
}

export { entityTypeToTableName } from "./parse-doc.js";

const PRIMITIVE_TYPES = new Set(["boolean", "string", "number", "long", "int", "void", "Date"]);

function isPrimitiveType(typeName: string): boolean {
  return PRIMITIVE_TYPES.has(typeName);
}

/**
 * 从 mutation 方法名推导实体类型。
 * 例如 deletePaymentLog → PaymentLog，createOrder → Order。
 */
function deriveEntityFromMethodName(methodName: string): string {
  const verbs = ["create", "update", "delete", "remove", "insert", "save", "upsert"];
  for (const verb of verbs) {
    if (methodName.toLowerCase().startsWith(verb) && methodName.length > verb.length) {
      const rest = methodName.slice(verb.length);
      // 首字母大写，得到实体类型名
      return rest.charAt(0).toUpperCase() + rest.slice(1);
    }
  }
  // 无动词前缀时，尝试整体按首字母大写（如 paymentLog → PaymentLog）
  return methodName.charAt(0).toUpperCase() + methodName.slice(1);
}