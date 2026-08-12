import { createServer } from "node:http";
import type { IncomingMessage, ServerResponse, Server } from "node:http";
import type { Transport } from "@tkwf/tsclient";
import { corsMiddleware, authMiddleware, type Middleware } from "./middleware.js";
import { GraphQLHandler } from "./graphql-handler.js";

export interface MockHttpServerOptions {
  /** MockTransport 实例（必填） */
  transport: Transport;
  /** 监听端口，默认 0（OS 自动分配） */
  port?: number;
  /** 监听地址，默认 "127.0.0.1" */
  host?: string;
  /** 启用 CORS，默认 true */
  cors?: boolean;
  /** 启用 Authorization 鉴权模拟，默认 false */
  auth?: boolean;
  /** 全局延迟模拟（ms），默认 0 */
  delayMs?: number;
}

/**
 * 基于 node:http 的轻量 HTTP mock server（v1.8.0）。
 *
 * 零外部依赖，遵循 graphql-over-http 规范。
 * 桥接到 MockTransport 实现 field 分发。
 *
 * @example
 * const server = new MockHttpServer({ transport: mockTransport });
 * const port = await server.start();
 * // http://localhost:${port}/graphql
 * await server.stop();
 */
export class MockHttpServer {
  private server: Server | null = null;
  private _port: number;
  private host: string;
  private options: MockHttpServerOptions;
  private graphqlHandler: GraphQLHandler;

  constructor(options: MockHttpServerOptions) {
    this.host = options.host ?? "127.0.0.1";
    this._port = options.port ?? 0;
    this.options = options;
    this.graphqlHandler = new GraphQLHandler(options.transport);
  }

  /** 启动 server，返回实际端口号 */
  start(): Promise<number> {
    return new Promise((resolve, reject) => {
      // 构建中间件链
      const middlewares: Middleware[] = [];

      if (this.options.cors !== false) {
        middlewares.push(corsMiddleware());
      }

      if (this.options.auth) {
        middlewares.push(authMiddleware());
      }

      this.server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
        try {
          // 中间件链
          let idx = 0;
          const next = async (): Promise<void> => {
            if (idx < middlewares.length) {
              await middlewares[idx++](req, res, next);
            }
          };
          await next();
          if (res.headersSent) return; // 中间件已处理（如 OPTIONS 204）

          // 全局延迟模拟
          const delay = this.options.delayMs ?? 0;
          if (delay > 0) await new Promise((r) => setTimeout(r, delay));

          await this.dispatch(req, res);
        } catch (err) {
          this.sendJson(res, 500, { errors: [{ message: (err as Error).message ?? "Internal Server Error" }] });
        }
      });

      // 错误处理
      this.server.on("connection", (socket) => {
        socket.on("error", () => {}); // 吞掉连接错误
      });

      this.server.on("error", reject);

      this.server.listen(this._port, this.host, () => {
        const addr = this.server!.address();
        if (addr && typeof addr === "object") {
          this._port = addr.port;
          resolve(addr.port);
        } else {
          reject(new Error("Failed to get server address"));
        }
      });
    });
  }

  /** 停止 server */
  stop(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.server) {
        resolve();
        return;
      }
      this.server.closeAllConnections();
      this.server.close((err) => {
        if (err) reject(err);
        else resolve();
      });
      this.server = null;
    });
  }

  /** 获取当前端口号 */
  get port(): number {
    return this._port;
  }

  /** 请求分发 */
  private async dispatch(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const method = req.method ?? "GET";
    const url = req.url ?? "/";

    // 路由表
    if (method === "POST" && url === "/graphql") {
      await this.handleGraphQL(req, res);
    } else if (method === "GET" && url === "/health") {
      this.sendJson(res, 200, { status: "ok" });
    } else {
      this.sendJson(res, 404, { errors: [{ message: `Not found: ${method} ${url}` }] });
    }
  }

  /** GraphQL 请求处理 */
  private async handleGraphQL(req: IncomingMessage, res: ServerResponse): Promise<void> {
    // 解析 body
    const bodyText = await this.parseBody(req);
    if (!bodyText) {
      this.sendJson(res, 400, { errors: [{ message: "Request body is required" }] });
      return;
    }

    let body: Record<string, unknown>;
    try {
      body = JSON.parse(bodyText);
    } catch {
      this.sendJson(res, 400, { errors: [{ message: "Invalid JSON in request body" }] });
      return;
    }

    if (typeof body.query !== "string") {
      this.sendJson(res, 422, { errors: [{ message: "Missing or invalid 'query' field" }] });
      return;
    }

    // 提取 sessionKey
    const sessionKey = this.extractSessionKey(req, body);

    // 桥接到 MockTransport
    const result = await this.graphqlHandler.handle({
      query: body.query as string,
      operationName: body.operationName as string | undefined,
      variables: body.variables as Record<string, unknown> | undefined,
    }, sessionKey);

    this.sendJson(res, result.status, result.body);
  }

  /** 请求体解析（for await...of） */
  private async parseBody(req: IncomingMessage): Promise<string> {
    const chunks: Buffer[] = [];
    for await (const chunk of req) {
      chunks.push(chunk as Buffer);
    }
    return Buffer.concat(chunks).toString("utf-8");
  }

  /** 提取 sessionKey（从 Authorization header 或 body.variables） */
  private extractSessionKey(req: IncomingMessage, _body: Record<string, unknown>): string | null {
    const raw = req.headers.authorization;
    const authHeader = Array.isArray(raw) ? raw[0] : raw;
    if (authHeader) {
      const normalized = authHeader.trim();
      if (normalized.toLowerCase().startsWith("bearer ")) {
        return normalized.slice("bearer ".length).trim();
      }
    }
    // 回退到 mock-session（模拟登录态）
    return "mock-session";
  }

  /** JSON 响应辅助 */
  private sendJson(res: ServerResponse, status: number, data: unknown): void {
    const body = JSON.stringify(data);
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(body);
  }
}