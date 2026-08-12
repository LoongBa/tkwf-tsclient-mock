import { describe, expect, it } from "vitest";
import { defaultSessionHandlers } from "./session";

describe("defaultSessionHandlers", () => {
  it("requestChallenge 返回 challengeToken 与 salt", () => {
    const result = defaultSessionHandlers.requestChallenge({});
    expect(result).toEqual({ challengeToken: "mock-challenge", salt: "mock-salt" });
  });

  it("loginByContext 生成固定 sessionKey，userName 取变量或回退 mock-user", () => {
    const withName = defaultSessionHandlers.loginByContext({ userName: "alice" });
    expect(withName).toEqual({ sessionKey: "mock-session", userName: "alice" });

    const fallback = defaultSessionHandlers.loginByContext({});
    expect(fallback).toEqual({ sessionKey: "mock-session", userName: "mock-user" });
  });

  it("loginByPassword 与 loginByContext 行为一致", () => {
    const result = defaultSessionHandlers.loginByPassword({ userName: "bob" });
    expect(result).toEqual({ sessionKey: "mock-session", userName: "bob" });
  });

  it("logout 返回 true", () => {
    expect(defaultSessionHandlers.logout({})).toBe(true);
  });
});
