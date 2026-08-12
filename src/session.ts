import type { MockHandler } from "./mock-transport";

/**
 * 内置默认会话处理器。
 * 提供登录链路（requestChallenge/loginByContext/loginByPassword/logout）的 mock 实现。
 */
export const defaultSessionHandlers: Record<string, MockHandler> = {
  requestChallenge: () => ({
    challengeToken: "mock-challenge",
    salt: "mock-salt",
  }),

  loginByContext: (variables) => ({
    sessionKey: "mock-session",
    userName: (variables as { userName?: string })?.userName ?? "mock-user",
  }),

  loginByPassword: (variables) => ({
    sessionKey: "mock-session",
    userName: (variables as { userName?: string })?.userName ?? "mock-user",
  }),

  logout: () => true,
};