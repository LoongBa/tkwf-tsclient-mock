import type { MockFieldSchema } from "../factory.js";

/**
 * AI 编排基础设施 —— 为消费端 AI/Agent 填充 mock 数据提供验证、自愈、变更检测能力。
 *
 * 不内置 LLM 调用：只提供三层基础设施，LLM 编排由消费端 SKILL 组合使用。
 */

export interface ValidateResult {
  ok: boolean;
  errors: string[];
}

/**
 * 校验 mock 数据是否符合 DTO schema（复用 MockFieldSchema）。
 *
 * 规则：
 * - `string` → typeof 为 string
 * - `number` → typeof 为 number（且非 NaN）
 * - `boolean` → typeof 为 boolean
 * - `date` → 接受 Date 实例或可 parse 的字符串/数字
 * - `enum` → 值在 enumValues 内（enumValues 为空时跳过校验，等待 Agent 填充）
 * - `object` → 递归校验 fields 子集（缺失字段不报错，多出字段不报错）
 * - `array` → 数组且元素逐一校验
 * - 数据为 undefined 时不报错（视为"未填充"，由 Agent 决定）
 */
export function validateMock(data: unknown, schema: MockFieldSchema, path = "$"): ValidateResult {
  if (data === undefined) return { ok: true, errors: [] };

  const errors: string[] = [];

  switch (schema.kind) {
    case "string": {
      if (typeof data !== "string") {
        errors.push(`${path}: 期望 string，实际 ${describeType(data)}`);
      }
      break;
    }
    case "number": {
      if (typeof data !== "number" || Number.isNaN(data)) {
        errors.push(`${path}: 期望 number，实际 ${describeType(data)}`);
      }
      break;
    }
    case "boolean": {
      if (typeof data !== "boolean") {
        errors.push(`${path}: 期望 boolean，实际 ${describeType(data)}`);
      }
      break;
    }
    case "date": {
      if (!isDateLike(data)) {
        errors.push(`${path}: 期望 Date/可解析日期，实际 ${describeType(data)}`);
      }
      break;
    }
    case "enum": {
      if (schema.enumValues && schema.enumValues.length > 0) {
        if (!schema.enumValues.includes(data as string | number)) {
          errors.push(`${path}: 期望枚举值之一 [${schema.enumValues.join(", ")}]，实际 ${String(data)}`);
        }
      }
      // enumValues 为空 → 无法校验，跳过（Agent 填充后由消费端 SKILL 校验）
      break;
    }
    case "object": {
      if (typeof data !== "object" || data === null || Array.isArray(data)) {
        errors.push(`${path}: 期望 object，实际 ${describeType(data)}`);
        break;
      }
      for (const [key, fieldSchema] of Object.entries(schema.fields ?? {})) {
        const child = (data as Record<string, unknown>)[key];
        if (child === undefined || fieldSchema === undefined) continue; // 缺失字段不报错
        errors.push(...validateMock(child, fieldSchema, `${path}.${key}`).errors);
      }
      break;
    }
    case "array": {
      if (!Array.isArray(data)) {
        errors.push(`${path}: 期望 array，实际 ${describeType(data)}`);
        break;
      }
      if (schema.element) {
        data.forEach((item, i) => {
          const element = schema.element;
          if (element) {
            errors.push(...validateMock(item, element, `${path}[${i}]`).errors);
          }
        });
      }
      break;
    }
    default:
      // 未知 kind：保守放行
      break;
  }

  return { ok: errors.length === 0, errors };
}

/** 判断值是否为 Date 或可解析的日期（字符串/数字）。 */
function isDateLike(value: unknown): boolean {
  if (value instanceof Date) return !Number.isNaN(value.getTime());
  if (typeof value === "string" || typeof value === "number") {
    const t = new Date(value).getTime();
    return !Number.isNaN(t);
  }
  return false;
}

/** 描述值的实际类型（用于错误信息）。 */
function describeType(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

/**
 * 自愈重试：schema 验证失败 → 重新生成，最多 maxRetries 次。
 *
 * generator 可注入（LLM/工厂），默认回退到 createMockFactory 提供的 generate。
 * 全部失败后抛出携带 errors 列表的错误。
 */
export async function selfHealing<T>(options: {
  schema: MockFieldSchema;
  /** 数据生成器（LLM/工厂注入点）。默认为空实现 —— 必须由调用方提供或指定 factory。 */
  generator?: () => unknown | Promise<unknown>;
  /** 最大重试次数（默认 3）。注意：第 1 次生成 + maxRetries 次重试。 */
  maxRetries?: number;
  /** 自定义校验器（默认 validateMock）。 */
  validate?: (d: unknown) => ValidateResult;
}): Promise<T> {
  const maxRetries = options.maxRetries ?? 3;
  const validate = options.validate ?? ((d: unknown) => validateMock(d, options.schema));

  if (!options.generator) {
    throw new Error(
      "selfHealing: 需要提供 generator（LLM/工厂注入点）。示例：selfHealing({ schema, generator: () => createMockFactory({ _types: schema }).make() })",
    );
  }

  let lastErrors: string[] = [];
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const data = await options.generator();
    const result = validate(data);
    if (result.ok) return data as T;
    lastErrors = result.errors;
  }

  throw new Error(`selfHealing: 生成数据在 ${maxRetries + 1} 次尝试后仍未通过 schema 校验：\n- ${lastErrors.join("\n- ")}`);
}

/**
 * 变更检测：codegen 产物内容 sha256 hash。
 *
 * 输入为源文件内容字符串，返回 hash。由消费端负责与 sidecar 文件（<output>.hash）比对，
 * changed=true 时提示"codegen 产物已变更，请重新执行 gen-mock-handlers"。
 *
 * 使用全局 crypto（Node ≥20 / 浏览器）实现，无 Node 专属依赖。
 */
export async function detectChange(source: string): Promise<{ hash: string; changed: boolean; previousHash?: string }> {
  const hash = await sha256(source);
  const previousHash = await readSidecar();

  if (previousHash === undefined) {
    // 无历史 → 视为首次生成，不算"变更"，并记录当前 hash
    await writeSidecar(hash);
    return { hash, changed: false };
  }

  const changed = previousHash !== hash;
  if (changed) {
    await writeSidecar(hash);
  }
  return { hash, changed, previousHash };
}

/**
 * 与 detectChange 配对的 sidecar 读写 —— 默认实现使用内存存储（测试/无文件系统环境）。
 * 消费端可注入自定义 read/write（如 node:fs 持久化到 <output>.hash）。
 */
export interface SidecarStore {
  read: () => string | undefined | Promise<string | undefined>;
  write: (hash: string) => void | Promise<void>;
}

const memoryStore: SidecarStore = {
  read: () => memorySidecar,
  write: (hash) => {
    memorySidecar = hash;
  },
};
let memorySidecar: string | undefined;

let activeStore: SidecarStore = memoryStore;

/** 注入自定义 sidecar 存储（如基于 node:fs 的文件存储）。 */
export function configureSidecar(store: SidecarStore): void {
  activeStore = store;
}

async function readSidecar(): Promise<string | undefined> {
  return await activeStore.read();
}

async function writeSidecar(hash: string): Promise<void> {
  await activeStore.write(hash);
}

/** sha256 计算（全局 crypto，Node ≥20 与浏览器通用）。 */
export async function sha256(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
