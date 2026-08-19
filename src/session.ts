import type { MockHandler } from "./mock-transport.js";

/**
 * 内置默认会话处理器。
 * 提供登录链路（requestChallenge/loginByContext/loginByPassword/loginBySms/loginByQrCode/
 * registerSecure/ping/logout）的 mock 实现。
 *
 * v1.4.3：补齐 loginBySms / ping / registerSecure / loginByQrCode；
 *         修复 loginByPassword / loginByContext 补 success + displayName。
 */
export const defaultSessionHandlers: Record<string, MockHandler> = {
  requestChallenge: () => ({
    challengeToken: "mock-challenge",
    salt: "mock-salt",
  }),

  loginByContext: (variables) => ({
    success: true,
    sessionKey: "mock-session",
    userName: (variables as { userName?: string })?.userName ?? "mock-user",
    displayName: (variables as { userName?: string })?.userName ?? "mock-user",
  }),

  loginByPassword: (variables) => ({
    success: true,
    sessionKey: "mock-session",
    userName: (variables as { userName?: string })?.userName ?? "mock-user",
    displayName: (variables as { userName?: string })?.userName ?? "mock-user",
  }),

  loginBySms: (variables) => ({
    success: true,
    sessionKey: "mock-session",
    userName: (variables as { mobile?: string })?.mobile ?? "mock-user",
    displayName: (variables as { mobile?: string })?.mobile ?? "mock-user",
  }),

  ping: () => ({
    success: true,
    isAuthenticated: true,
    userName: "mock-user",
    sessionKey: "mock-session",
  }),

  registerSecure: (variables) => ({
    success: true,
    message: "注册成功",
    userName: (variables as { userName?: string })?.userName ?? "mock-user",
  }),

  loginByQrCode: (variables) => ({
    success: true,
    sessionKey: "mock-session",
    userName: (variables as { userName?: string })?.userName ?? "mock-user",
  }),

  logout: () => true,
};
