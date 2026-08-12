/**
 * CLI 入口：npx mock-server
 *
 * 启动 HTTP mock server，桥接到已有的 MockTransport 实例。
 *
 * 用法：
 * npx mock-server --port 3000
 *   （需要消费端代码中 import/创建 MockTransport 后启动 server）
 *
 * 编程式用法（推荐）：
 * ```typescript
 * import { MockHttpServer, MockTransport, createMockDb } from "@tkwf/tsclient-mock";
 * import { handlers } from "./ts-client.mock.g";
 *
 * const transport = new MockTransport(handlers);
 * const server = new MockHttpServer({ transport, port: 3000 });
 * await server.start();
 * ```
 */

// 注意：CLI 参数解析使用 process.argv（已有 node-types.d.ts 声明 process）
const args = process.argv.slice(2);
const portIdx = args.indexOf("--port");
const port = portIdx >= 0 ? parseInt(args[portIdx + 1], 10) || 0 : 0;

console.log(`mock-server: use programming API (see README).`);
console.log(`MockHttpServer port: ${port || "auto"}`);
console.log("");
console.log("Example:");
console.log('  import { MockHttpServer, MockTransport } from "@tkwf/tsclient-mock";');
console.log('  const transport = new MockTransport(handlers);');
console.log("  const server = new MockHttpServer({ transport, port: 3000 });");
console.log("  await server.start();");