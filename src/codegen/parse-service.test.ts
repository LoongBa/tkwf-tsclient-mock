import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseDoc } from "./parse-doc";
import { parseServiceMethods, entityTypeToTableName } from "./parse-service";

const fixturePath = fileURLToPath(new URL("./__fixtures__/sample.g.ts", import.meta.url));
const fixture = readFileSync(fixturePath, "utf-8");

function setup() {
  const doc = parseDoc(fixture);
  const methods = parseServiceMethods(doc);
  return { doc, methods };
}

describe("parse-service", () => {
  it("提取所有 Service 方法（含参数和返回类型）", () => {
    const { methods } = setup();
    const names = methods.map((m) => m.name);
    expect(names).toContain("paymentLog");
    expect(names).toContain("paymentLogs");
    expect(names).toContain("createPaymentLog");
    expect(names).toContain("updatePaymentLog");
    expect(names).toContain("deletePaymentLog");
    expect(names).toContain("merchant");
    expect(methods.length).toBe(6);
  });

  it("统一单 args 对象模式：参数保留原始字段名", () => {
    const { methods } = setup();
    const paymentLogs = methods.find((m) => m.name === "paymentLogs")!;
    expect(paymentLogs.params.length).toBe(1);

    // 检查 args 结构
    const argsType = paymentLogs.params[0].typeText;
    expect(argsType).toMatch(/PaymentLogsArgs/);

    // 检查 hasWhere/hasOrder/hasForwardPagination
    expect(paymentLogs.hasWhere).toBe(true);
    expect(paymentLogs.hasOrder).toBe(true);
    expect(paymentLogs.hasForwardPagination).toBe(true);
    expect(paymentLogs.hasInput).toBe(false);
  });

  it("ChainablePromise 解包：去掉包装类型", () => {
    const { methods } = setup();
    const paymentLog = methods.find((m) => m.name === "paymentLog")!;
    expect(paymentLog.unwrappedReturnType).toBe("PaymentLog");

    const paymentLogs = methods.find((m) => m.name === "paymentLogs")!;
    expect(paymentLogs.unwrappedReturnType).toBe("PaymentLogConnection");

    const deleteMethod = methods.find((m) => m.name === "deletePaymentLog")!;
    expect(deleteMethod.unwrappedReturnType).toBe("boolean");
  });

  it("Connection 别名两层跳转：得到实体类型", () => {
    const { methods } = setup();
    const paymentLogs = methods.find((m) => m.name === "paymentLogs")!;
    expect(paymentLogs.entityType).toBe("PaymentLog");

    const merchant = methods.find((m) => m.name === "merchant")!;
    expect(merchant.entityType).toBe("Merchant");
  });

  it("单实体查询的 entityType 保留原名", () => {
    const { methods } = setup();
    const paymentLog = methods.find((m) => m.name === "paymentLog")!;
    // paymentLog 返回 PaymentLog（非 Connection），所以 entityType 就是 PaymentLog
    expect(paymentLog.entityType).toBe("PaymentLog");
  });

  it("提取 mutation 的参数特征（hasInput/hasIdField）", () => {
    const { methods } = setup();
    const create = methods.find((m) => m.name === "createPaymentLog")!;
    expect(create.hasInput).toBe(true);
    expect(create.hasIdField).toBe(false);

    const update = methods.find((m) => m.name === "updatePaymentLog")!;
    expect(update.hasInput).toBe(true);
    expect(update.hasIdField).toBe(true);

    const del = methods.find((m) => m.name === "deletePaymentLog")!;
    expect(del.hasInput).toBe(false);
    expect(del.hasIdField).toBe(true);
  });

  it("entityTypeToTableName: 实体名 → 表名", () => {
    expect(entityTypeToTableName("PaymentLog")).toBe("paymentLogs");
    expect(entityTypeToTableName("Merchant")).toBe("merchants");
    expect(entityTypeToTableName("User")).toBe("users");
    expect(entityTypeToTableName("")).toBe("");
  });
});