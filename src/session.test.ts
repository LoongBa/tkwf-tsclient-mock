import { describe, expect, it } from "vitest";
import { defaultSessionHandlers } from "./session";

describe("defaultSessionHandlers", () => {
  it("requestChallenge 返回 challengeToken 与 salt", () => {
    const result = defaultSessionHandlers.requestChallenge({}, {});
    expect(result).toEqual({ challengeToken: "mock-challenge", salt: "mock-salt" });
  });

  it("loginByContext 返回 success + sessionKey + userName + displayName（v1.4.3 修复）", () => {
    const withName = defaultSessionHandlers.loginByContext({ userName: "alice" }, {});
    expect(withName).toEqual({
      success: true,
      sessionKey: "mock-session",
      userName: "alice",
      displayName: "alice",
    });

    const fallback = defaultSessionHandlers.loginByContext({}, {});
    expect(fallback).toEqual({
      success: true,
      sessionKey: "mock-session",
      userName: "mock-user",
      displayName: "mock-user",
    });
  });

  it("loginByPassword 返回 success + sessionKey + userName + displayName（v1.4.3 修复）", () => {
    const result = defaultSessionHandlers.loginByPassword({ userName: "bob" }, {});
    expect(result).toEqual({
      success: true,
      sessionKey: "mock-session",
      userName: "bob",
      displayName: "bob",
    });
  });

  it("loginBySms 返回 success + userName 取 mobile（v1.4.3 新增）", () => {
    const result = defaultSessionHandlers.loginBySms({ mobile: "13800138000", captcha: "123456" }, {});
    expect(result).toEqual({
      success: true,
      sessionKey: "mock-session",
      userName: "13800138000",
      displayName: "13800138000",
    });
  });

  it("loginBySms 不传 mobile 时 userName 回退 mock-user", () => {
    const result = defaultSessionHandlers.loginBySms({}, {});
    expect(result).toMatchObject({ success: true, userName: "mock-user" });
  });

  it("ping 返回 isAuthenticated=true（v1.4.3 新增）", () => {
    const result = defaultSessionHandlers.ping({}, {});
    expect(result).toEqual({
      success: true,
      isAuthenticated: true,
      userName: "mock-user",
      sessionKey: "mock-session",
    });
  });

  it("registerSecure 返回 success=true（v1.4.3 新增）", () => {
    const result = defaultSessionHandlers.registerSecure({ userName: "newuser" }, {});
    expect(result).toEqual({
      success: true,
      message: "注册成功",
      userName: "newuser",
    });
  });

  it("loginByQrCode 返回 success=true（v1.4.3 新增，防御性）", () => {
    const result = defaultSessionHandlers.loginByQrCode({ userName: "qrcode-user" }, {});
    expect(result).toEqual({
      success: true,
      sessionKey: "mock-session",
      userName: "qrcode-user",
    });
  });

  it("logout 返回 true", () => {
    expect(defaultSessionHandlers.logout({}, {})).toBe(true);
  });
});


