import { describe, it, expect, afterEach } from "vitest";
import type { Transport } from "@tkwf/tsclient";
import { MockHttpServer } from "./server";
import { GraphQLHandler } from "./graphql-handler";

/** 构造最小 Transport 桩（模拟 MockTransport 行为） */
function makeFakeTransport(handler: (field: string, variables?: Record<string, unknown>) => unknown): Transport {
  return {
    async execute<T>(op: { field: string; type: "query" | "mutation"; variables?: Record<string, unknown> }): Promise<T> {
      return handler(op.field, op.variables) as T;
    },
    async executeRawGraphQL<T>(): Promise<T> {
      throw new Error("not used in HTTP tests");
    },
  };
}

async function fetchJson(url: string, init?: RequestInit): Promise<{ status: number; body: unknown }> {
  const res = await fetch(url, init);
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

describe("MockHttpServer — 生命周期", () => {
  const servers: MockHttpServer[] = [];

  async function startServer(options: Parameters<typeof MockHttpServer.prototype.start>[0] extends never ? never : Parameters<ConstructorParameters<typeof MockHttpServer>[0]>[0]): Promise<MockHttpServer> {
    const server = new MockHttpServer(options);
    servers.push(server);
    await server.start();
    return server;
  }

  afterEach(async () => {
    await Promise.all(servers.splice(0).map((s) => s.stop()));
  });

  it("start() 返回有效端口号", async () => {
    const transport = makeFakeTransport(() => ({ ok: true }));
    const server = new MockHttpServer({ transport });
    servers.push(server);
    const port = await server.start();
    expect(port).toBeGreaterThan(0);
    expect(server.port).toBe(port);
  });

  it("stop() 释放端口", async () => {
    const transport = makeFakeTransport(() => ({ ok: true }));
    const server = new MockHttpServer({ transport });
    servers.push(server);
    const port = await server.start();
    await server.stop();
    // 连接已被 accept 拒绝 → fetch 应失败
    await expect(fetch(`http://127.0.0.1:${port}/health`)).rejects.toThrow();
  });
});

describe("MockHttpServer — GraphQL", () => {
  const servers: MockHttpServer[] = [];

  afterEach(async () => {
    await Promise.all(servers.splice(0).map((s) => s.stop()));
  });

  async function startServer(transport: Transport, options: Record<string, unknown> = {}): Promise<MockHttpServer> {
    const server = new MockHttpServer({ transport, ...options });
    servers.push(server);
    await server.start();
    return server;
  }

  it("POST /graphql 返回 200 + data", async () => {
    const transport = makeFakeTransport(() => ({ nodes: [], totalCount: 0 }));
    const server = await startServer(transport);
    const res = await fetchJson(`http://127.0.0.1:${server.port}/graphql`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: "query { paymentLogs }" }),
    });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ data: { nodes: [], totalCount: 0 } });
  });

  it("POST /graphql 传递 variables", async () => {
    let seenVariables: Record<string, unknown> | undefined;
    const transport = makeFakeTransport((_field, variables) => {
      seenVariables = variables;
      return { ok: true };
    });
    const server = await startServer(transport);
    await fetchJson(`http://127.0.0.1:${server.port}/graphql`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: "query { paymentLog }", variables: { id: 5 } }),
    });
    expect(seenVariables).toEqual({ id: 5 });
  });

  it("query 缺字段返回 422", async () => {
    const transport = makeFakeTransport(() => ({}));
    const server = await startServer(transport);
    const res = await fetchJson(`http://127.0.0.1:${server.port}/graphql`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ variables: {} }),
    });
    expect(res.status).toBe(422);
  });

  it("mutation 关键字识别为 mutation 类型", async () => {
    const t = makeFakeTransport(() => ({ id: 1 }));
    // 包装以捕获 type
    const captured: string[] = [];
    const transport: Transport = {
      async execute<T>(op: { field: string; type: "query" | "mutation" }): Promise<T> {
        captured.push(op.type);
        return t.execute<T>(op as never);
      },
      async executeRawGraphQL<T>(): Promise<T> {
        throw new Error("n/a");
      },
    };
    const server = await startServer(transport);
    await fetchJson(`http://127.0.0.1:${server.port}/graphql`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: "mutation CreateLog { createLog }" }),
    });
    expect(captured).toContain("mutation");
  });

  it("404 未知路径", async () => {
    const transport = makeFakeTransport(() => ({}));
    const server = await startServer(transport);
    const res = await fetchJson(`http://127.0.0.1:${server.port}/unknown`);
    expect(res.status).toBe(404);
  });

  it("GET /health 返回 ok", async () => {
    const transport = makeFakeTransport(() => ({}));
    const server = await startServer(transport);
    const res = await fetchJson(`http://127.0.0.1:${server.port}/health`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "ok" });
  });
});

describe("MockHttpServer — CORS", () => {
  const servers: MockHttpServer[] = [];

  afterEach(async () => {
    await Promise.all(servers.splice(0).map((s) => s.stop()));
  });

  it("OPTIONS 预检返回 204 + CORS 头", async () => {
    const transport = makeFakeTransport(() => ({}));
    const server = new MockHttpServer({ transport });
    servers.push(server);
    await server.start();

    const res = await fetch(`http://127.0.0.1:${server.port}/graphql`, {
      method: "OPTIONS",
      headers: { Origin: "http://example.com" },
    });
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-origin")).toBe("http://example.com");
    expect(res.headers.get("access-control-allow-methods")).toContain("POST");
  });

  it("非 OPTIONS 请求注入 CORS 头", async () => {
    const transport = makeFakeTransport(() => ({}));
    const server = new MockHttpServer({ transport });
    servers.push(server);
    await server.start();

    const res = await fetch(`http://127.0.0.1:${server.port}/health`, {
      headers: { Origin: "http://example.com" },
    });
    expect(res.headers.get("access-control-allow-origin")).toBe("http://example.com");
  });
});

describe("MockHttpServer — 鉴权", () => {
  const servers: MockHttpServer[] = [];

  afterEach(async () => {
    await Promise.all(servers.splice(0).map((s) => s.stop()));
  });

  it("Authorization header 传递为 sessionKey", async () => {
    let seenSessionKey: string | undefined;
    const transport: Transport = {
      async execute<T>(op: { sessionKey?: string }): Promise<T> {
        seenSessionKey = op.sessionKey;
        return { ok: true } as T;
      },
      async executeRawGraphQL<T>(): Promise<T> {
        throw new Error("n/a");
      },
    };
    const server = new MockHttpServer({ transport, auth: true });
    servers.push(server);
    await server.start();

    await fetchJson(`http://127.0.0.1:${server.port}/graphql`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer test-token" },
      body: JSON.stringify({ query: "query { paymentLogs }" }),
    });
    expect(seenSessionKey).toBe("test-token");
  });
});

describe("GraphQLHandler — 独立单元测试", () => {
  it("从 query 提取 field（别名/指令兼容）", async () => {
    let seenField: string | undefined;
    const transport: Transport = {
      async execute<T>(op: { field: string }): Promise<T> {
        seenField = op.field;
        return { ok: true } as T;
      },
      async executeRawGraphQL<T>(): Promise<T> {
        throw new Error("n/a");
      },
    };
    const handler = new GraphQLHandler(transport);
    await handler.handle({ query: "query Foo @cache { logs: paymentLogs(first: 10) { id } }" }, null);
    expect(seenField).toBe("paymentLogs");
  });

  it("mutation 带变量声明仍能提取 field", async () => {
    let seenField: string | undefined;
    let seenType: string | undefined;
    const transport: Transport = {
      async execute<T>(op: { field: string; type: string }): Promise<T> {
        seenField = op.field;
        seenType = op.type;
        return { ok: true } as T;
      },
      async executeRawGraphQL<T>(): Promise<T> {
        throw new Error("n/a");
      },
    };
    const handler = new GraphQLHandler(transport);
    await handler.handle({ query: "mutation CreateLog($input: CreateInput!) { createPaymentLog(input: $input) { id } }", variables: { input: {} } }, null);
    expect(seenField).toBe("createPaymentLog");
    expect(seenType).toBe("mutation");
  });
});