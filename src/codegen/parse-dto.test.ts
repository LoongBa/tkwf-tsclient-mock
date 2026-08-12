import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseDoc } from "./parse-doc";
import { parseDtoSchemas, extractEnumFieldNames } from "./parse-dto";

const fixturePath = fileURLToPath(new URL("./__fixtures__/sample.g.ts", import.meta.url));
const fixture = readFileSync(fixturePath, "utf-8");

function setup() {
  const doc = parseDoc(fixture);
  const enumFieldNames = extractEnumFieldNames(doc);
  const schemas = parseDtoSchemas(doc, enumFieldNames);
  return { doc, schemas, enumFieldNames };
}

describe("parse-dto", () => {
  it("提取枚举字段名：从 filter input 中引用 EnumOperationFilterInput 的字段", () => {
    const { enumFieldNames } = setup();
    // PaymentLogFilterInput 中 status 引用 EnumOperationFilterInput
    expect(enumFieldNames).toContain("status");
    // MerchantFilterInput 中 status 也引用 EnumOperationFilterInput
    expect(enumFieldNames).toContain("status");
    // id 不是枚举
    expect(enumFieldNames).not.toContain("id");
  });

  it("DTO 各类型推导正确", () => {
    const { schemas } = setup();
    const paymentLog = schemas["PaymentLog"];
    expect(paymentLog).toBeDefined();

    // id: number → { kind: "number", isId: true }
    expect(paymentLog.id).toEqual({ kind: "number", isId: true });

    // uId: string → { kind: "string" }
    expect(paymentLog.uId).toEqual({ kind: "string" });

    // status: string（枚举字段）→ { kind: "enum", enumValues: [] }
    expect(paymentLog.status).toEqual({ kind: "enum", enumValues: [] });

    // createTime: string（字段名含 Time）→ { kind: "date" }
    expect(paymentLog.createTime).toEqual({ kind: "date" });

    // isDeleted: boolean → { kind: "boolean" }
    expect(paymentLog.isDeleted).toEqual({ kind: "boolean" });
  });

  it("数组类型推导为 array", () => {
    const { schemas } = setup();
    const paymentLog = schemas["PaymentLog"];
    // tags?: string[] → { kind: "array", element: { kind: "string" } }
    expect(paymentLog.tags).toEqual({
      kind: "array",
      element: { kind: "string" },
    });
  });

  it("内联对象类型字面量推导为 object", () => {
    const { schemas } = setup();
    const paymentLog = schemas["PaymentLog"];
    // extra?: { nested: string; value: number } → object
    expect(paymentLog.extra.kind).toBe("object");
    if (paymentLog.extra.kind === "object" && paymentLog.extra.fields) {
      expect(paymentLog.extra.fields.nested).toEqual({ kind: "string" });
      expect(paymentLog.extra.fields.value).toEqual({ kind: "number" });
    }
  });

  it("Record<string, string> 降级为 string", () => {
    const { schemas } = setup();
    const paymentLog = schemas["PaymentLog"];
    // meta?: Record<string, string> → { kind: "string" }
    expect(paymentLog.meta.kind).toBe("string");
  });

  it("枚举降级不报错（空 enumValues）", () => {
    const { schemas } = setup();
    const paymentLog = schemas["PaymentLog"];
    expect(paymentLog.status.kind).toBe("enum");
    if (paymentLog.status.kind === "enum") {
      expect(paymentLog.status.enumValues).toEqual([]);
    }
  });

  it("循环引用防护：自引用不无限递归", () => {
    const { schemas } = setup();
    const merchant = schemas["Merchant"];
    expect(merchant).toBeDefined();
    // children?: Merchant[] → array
    const children = merchant.children;
    expect(children.kind).toBe("array");
    // 元素应为 object（循环引用 → 空对象 fields）
    if (children.kind === "array" && children.element) {
      expect(children.element.kind).toBe("object");
    }
  });
});