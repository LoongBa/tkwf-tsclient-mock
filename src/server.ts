// @tkwf/tsclient-mock/server — Node.js 专用子路径入口
//
// 主入口（@tkwf/tsclient-mock）只导出浏览器安全模块；
// 以下模块依赖 Node.js 内置模块（node:http / node:fs / node:path），
// 浏览器打包会触发 "Module has been externalized" 报错，
// 因此独立到 /server 子路径，仅 Node 环境按需导入。

export { MockHttpServer } from "./http-mock/server.js";
export type { MockHttpServerOptions } from "./http-mock/server.js";

export { FileRecordingStore } from "./file-recording-store.js";