import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseDoc } from "./parse-doc";

const fixturePath = fileURLToPath(new URL("./__fixtures__/sample.g.ts", import.meta.url));
const fixture = readFileSync(fixturePath, "utf-8");

describe("parse-doc", () => {
  it("提取 Query/Mutation 的 field 清单（含分类）", () => {
    const doc = parseDoc(fixture);
    const queryFields = doc.fields.filter((f) => f.type === "query").map((f) => f.name);
    const mutationFields = doc.fields.filter((f) => f.type === "mutation").map((f) => f.name);

    expect(queryFields).toContain("paymentLog");
    expect(queryFields).toContain("paymentLogs");
    expect(queryFields).toContain("merchant");
    expect(mutationFields).toEqual(["createPaymentLog", "updatePaymentLog", "deletePaymentLog"]);

    const paymentLog = doc.fields.find((f) => f.name === "paymentLog");
    expect(paymentLog?.type).toBe("query");
    const create = doc.fields.find((f) => f.name === "createPaymentLog");
    expect(create?.type).toBe("mutation");
  });

  it("跳过 import 声明并不产生字段", () => {
    const doc = parseDoc(fixture);
    expect(doc.fields.some((f) => f.name === "ChainablePromise")).toBe(false);
    expect(doc.fields.some((f) => f.name === "Connection")).toBe(false);
    expect(doc.fields.some((f) => f.name === "Edge")).toBe(false);
  });

  it("提取可选的 operationSelection 映射", () => {
    const doc = parseDoc(fixture);
    expect(doc.operationSelection).not.toBeNull();
    expect(doc.operationSelection?.["paymentLog"]).toBe("id uId status createTime");
    expect(doc.operationSelection?.["paymentLogs"]).toBe("id uId status createTime");
  });

  it("识别 Service 接口与 DTO 接口的区分", () => {
    const doc = parseDoc(fixture);
    expect(doc.serviceInterfaceNames).toContain("PaymentLogService");
    expect(doc.serviceInterfaceNames).toContain("MerchantService");

    expect(doc.dtoInterfaceNames).toContain("PaymentLog");
    expect(doc.dtoInterfaceNames).toContain("Merchant");
    expect(doc.dtoInterfaceNames).not.toContain("PaymentLogArgs");
    expect(doc.dtoInterfaceNames).not.toContain("PaymentLogFilterInput");
    expect(doc.dtoInterfaceNames).not.toContain("PaymentLogEdge");
    expect(doc.dtoInterfaceNames).not.toContain("CreatePaymentLogInput");
    expect(doc.dtoInterfaceNames).not.toContain("PaymentLogService");
  });

  it("提取 type 别名（含 Connection 双参数别名）", () => {
    const doc = parseDoc(fixture);
    const aliases = doc.typeAliases.map((a) => a.name);
    expect(aliases).toContain("PaymentLogConnection");
    expect(aliases).toContain("PaymentLogEdge");
    expect(aliases).toContain("MerchantConnection");
    expect(aliases).toContain("SortEnumType");
  });

  it("提取 FilterInput 家族接口名", () => {
    const doc = parseDoc(fixture);
    expect(doc.filterInputNames).toContain("PaymentLogFilterInput");
    expect(doc.filterInputNames).toContain("MerchantFilterInput");
    expect(doc.filterInputNames).toContain("LongOperationFilterInput");
    expect(doc.filterInputNames).toContain("StringOperationFilterInput");
  });

  it("多行嵌套对象字面量的接口不被截断（深度感知）", () => {
    const src = `
export interface NestedDto {
  id: number;
  meta: {
    a: string;
    b: number;
  };
  tags: string[];
}
export interface OtherDto {
  ok: boolean;
}
`;
    const doc = parseDoc(src);
    expect(doc.dtoInterfaceNames).toContain("NestedDto");
    expect(doc.dtoInterfaceNames).toContain("OtherDto");
    const nested = doc.interfaces.find((i) => i.name === "NestedDto");
    // meta 属性完整保留，且 OtherDto 未被吞并
    expect(nested?.properties.some((p) => p.name === "meta" && p.typeText.includes("a: string"))).toBe(true);
    expect(nested?.properties.some((p) => p.name === "meta" && p.typeText.includes("b: number"))).toBe(true);
  });
});