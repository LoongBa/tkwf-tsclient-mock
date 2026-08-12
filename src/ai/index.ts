import type { MockFieldSchema } from "../factory.js";
import { mockFieldSchemaToZod, formatPath } from "../zod.js";

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
 * 校验 mock 数据是否符合 DTO schema（底层使用 zod safeParse）。
 *
 * v1.4.0 迁移：原手写 switch 校验替换为 mockFieldSchemaToZod 适配器 + zod safeParse。
 * 语义保持与之前一致：
 * - undefined 不报错（视为"未填充"）
 * - object 缺失字段不报错，多出字段不报错
 * - enumValues 为空时放行（等待 Agent 填充）
 * - date 接受 Date 实例 / ISO 8601 字符串 / number 时间戳
 *
 * 注意：错误消息从中文变为英文（zod 默认），格式由 `$: 期望 string，实际 number` 变为 `$: Expected string, received number`。
 */
export function validateMock(data: unknown, schema: MockFieldSchema, _path = "$"): ValidateResult {
  const zodSchema = mockFieldSchemaToZod(schema);
  const result = zodSchema.safeParse(data);
  if (result.success) return { ok: true, errors: [] };
  return {
    ok: false,
    errors: result.error.issues.map((issue) => {
      if (issue.path.length === 0) return `${_path}: ${issue.message}`;
      const inner = formatPath(issue.path.filter((s): s is string | number => typeof s !== "symbol")).slice(1); // 去掉前导 "$"
      return `${_path}${inner}: ${issue.message}`;
    }),
  };
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
