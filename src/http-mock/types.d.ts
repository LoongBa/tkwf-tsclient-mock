/**
 * node:http / node:url / node:net 类型声明（替代 @types/node，v1.8.0 HTTP mock server 用）。
 * 仅声明实际使用的 API，避免引入 @types/node 依赖。
 */

declare module "node:http" {
  export interface IncomingMessage {
    method?: string;
    url?: string;
    headers: Record<string, string | string[] | undefined>;
    statusCode?: number;
    on(event: "data", handler: (chunk: Buffer) => void): void;
    on(event: "end", handler: () => void): void;
    on(event: "error", handler: (err: Error) => void): void;
    [Symbol.asyncIterator](): AsyncIterableIterator<Buffer>;
  }

  export interface ServerResponse {
    statusCode: number;
    headersSent: boolean;
    setHeader(name: string, value: string | number | string[]): void;
    writeHead(statusCode: number, headers?: Record<string, string | number>): void;
    end(data?: string | Buffer): void;
    on(event: "close", handler: () => void): void;
  }

  export interface Server {
    listen(port: number, hostname?: string, callback?: () => void): Server;
    close(callback?: (err?: Error) => void): void;
    closeAllConnections(): void;
    address(): { port: number; family: string; address: string } | string | null;
    on(event: "connection", handler: (socket: import("node:net").Socket) => void): void;
    on(event: "close", handler: () => void): void;
    on(event: "error", handler: (err: Error) => void): void;
  }

  export function createServer(
    requestListener?: (req: IncomingMessage, res: ServerResponse) => void,
  ): Server;
}

declare module "node:net" {
  export interface Socket {
    destroy(): void;
    on(event: string, handler: (...args: unknown[]) => void): void;
  }
}

declare module "node:url" {
  export class URL {
    constructor(url: string, base?: string);
    pathname: string;
    searchParams: URLSearchParams;
  }
}

/** 最小 Buffer 声明（供 node:http body 解析使用） */
declare class Buffer {
  constructor(data?: ArrayLike<number> | string, encoding?: string);
  toString(encoding?: string): string;
  static concat(list: Buffer[]): Buffer;
}