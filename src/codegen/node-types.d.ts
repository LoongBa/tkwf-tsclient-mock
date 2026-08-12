/**
 * 最小 Node.js 类型声明 —— 供 codegen（dev 工具）使用。
 * 项目未安装 @types/node，这里声明 codegen 用到的 Node 内建能力。
 * 本文件无 top-level import/export，作为全局脚本参与编译。
 */

declare var process: {
  argv: string[];
  execPath: string;
  exit(code?: number): never;
  stdout: {
    write(data: string): boolean;
  };
  stderr: {
    write(data: string): boolean;
  };
};

declare module "node:fs" {
  export function readFileSync(path: string, encoding?: string): string;
  export function writeFileSync(path: string, data: string, encoding?: string): void;
  export function existsSync(path: string): boolean;
  export function copyFileSync(src: string, dest: string): void;
  export function mkdirSync(path: string, options?: { recursive?: boolean }): string | undefined;
  export function mkdtempSync(prefix: string): string;
  export function readdirSync(path: string): string[];
  export function rmSync(path: string, options?: { recursive?: boolean; force?: boolean }): void;
}

declare module "node:path" {
  export function dirname(path: string): string;
  export function relative(from: string, to: string): string;
  export function join(...paths: string[]): string;
}

declare module "node:url" {
  export function fileURLToPath(url: string | URL): string;
}

declare module "node:os" {
  export function tmpdir(): string;
}

declare module "node:child_process" {
  export function spawnSync(
    command: string,
    args?: readonly string[],
    options?: { encoding?: string; timeout?: number },
  ): { status: number | null; stdout: string; stderr: string };
}