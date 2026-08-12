import { describe, it, expect } from "vitest";
import { defineMock } from "./define-mock.js";
import type { MockFieldContract } from "./define-mock.js";
import type { MockHandler } from "./mock-transport.js";

describe("defineMock 泛型约束", () => {
  it("泛型调用：handler 参数类型被约束，返回 MockHandler", () => {
    // 编译期验证：泛型约束生效，handler 的 vars 类型 = TContract["args"]
    const h: MockHandler = defineMock<MockFieldContract<"test", { id: number }, string>>(
      (vars) => {
        // vars 被推断为 { id: number } | undefined
        return vars?.id ? "ok" : "default";
      },
    );
    expect(typeof h).toBe("function");
    expect(h({ id: 1 }, {})).toBe("ok");
    expect(h(undefined, {})).toBe("default");
  });

  it("无泛型调用：旧签名兼容，直接透传 MockHandler", () => {
    const h: MockHandler = defineMock((_vars) => 42);
    expect(typeof h).toBe("function");
    expect(h({}, {})).toBe(42);
  });
});