import type { IncomingMessage, ServerResponse } from "node:http";

export type Middleware = (
  req: IncomingMessage,
  res: ServerResponse,
  next: () => void | Promise<void>,
) => void | Promise<void>;

/**
 * CORS 中间件。
 * OPTIONS 预检请求直接返回 204 + CORS 头。
 * 非 OPTIONS 请求注入 Access-Control-Allow-Origin 头后继续。
 */
export function corsMiddleware(): Middleware {
  return (req: IncomingMessage, res: ServerResponse, next: () => void | Promise<void>) => {
    const origin = req.headers.origin as string | undefined;
    res.setHeader("Access-Control-Allow-Origin", origin ?? "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Session-Key");
    res.setHeader("Access-Control-Max-Age", "86400");

    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    return next();
  };
}

/**
 * 鉴权中间件。
 * 提取 Authorization: Bearer <token> 头，注入到 req 供后续使用。
 * 若 auth 选项启用但无 token，返回 401。
 */
export function authMiddleware(): Middleware {
  return (req: IncomingMessage, _res: ServerResponse, next: () => void | Promise<void>) => {
    const raw = req.headers.authorization;
    const authHeader = Array.isArray(raw) ? raw[0] : raw;
    if (authHeader) {
      const normalized = authHeader.trim();
      if (normalized.toLowerCase().startsWith("bearer ")) {
        (req as unknown as Record<string, unknown>).authToken = normalized.slice("bearer ".length).trim();
      }
    }
    // 不阻塞——鉴权失败由后续 handler 处理（401 vs 正常）
    return next();
  };
}