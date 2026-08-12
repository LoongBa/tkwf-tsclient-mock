import { describe, it, expect } from "vitest";
import { createMockDb } from "./mock-db";
import { MockTransport } from "./mock-transport";
import { createScenarioContext } from "./scenario";

interface PaymentLog {
  id: number;
  status: string;
  amount: number;
  createdAt: Date;
}

const seed: PaymentLog[] = [
  { id: 1, status: "SUCCESS", amount: 100, createdAt: new Date("2026-01-01T00:00:00Z") },
  { id: 2, status: "FAILED", amount: 50, createdAt: new Date("2026-01-02T00:00:00Z") },
  { id: 3, status: "PROCESSING", amount: 200, createdAt: new Date("2026-01-03T00:00:00Z") },
  { id: 4, status: "SUCCESS", amount: 75, createdAt: new Date("2026-01-04T00:00:00Z") },
  { id: 5, status: "SUCCESS", amount: 150, createdAt: new Date("2026-01-05T00:00:00Z") },
];

describe("createScenarioContext — 协调器联动", () => {
  it("同时切换 db 数据集 + transport 场景（两侧联动）", () => {
    const db = createMockDb(
      { logs: seed },
      {
        datasets: {
          empty: { logs: [] },
        },
      },
    );
    const transport = new MockTransport(
      { ping: () => ({ pong: true }) },
      { scenarios: { empty: { delayMs: 5 } } },
    );
    const scenario = createScenarioContext({ db, transport });

    scenario.setScenario("empty");
    // db 侧：数据切到空数据集
    expect(db.getDatasetName()).toBe("empty");
    expect(db.query("logs")).toHaveLength(0);
    // transport 侧：场景切到 empty
    expect(transport.getScenario()).toBe("empty");
    expect(scenario.getScenario()).toBe("empty");
  });

  it("仅数据场景：只切换 db，transport 保持不变", () => {
    const db = createMockDb(
      { logs: seed },
      {
        datasets: {
          empty: { logs: [] },
        },
      },
    );
    const transport = new MockTransport({ ping: () => ({ pong: true }) });
    const scenario = createScenarioContext({ db, transport });

    scenario.setScenario("empty");
    expect(db.getDatasetName()).toBe("empty");
    expect(db.query("logs")).toHaveLength(0);
    // transport 未配置 empty 场景 → 维持 default
    expect(transport.getScenario()).toBe("default");
  });

  it("仅注入场景：只切换 transport，db 保持不变", async () => {
    const db = createMockDb({ logs: seed });
    const transport = new MockTransport(
      { ping: () => ({ pong: true }) },
      {
        scenarios: {
          error: { fieldOptions: { ping: { error: new Error("boom") } } },
        },
      },
    );
    const scenario = createScenarioContext({ db, transport });

    scenario.setScenario("error");
    expect(transport.getScenario()).toBe("error");
    // db 未配置 error 数据集 → 维持 default
    expect(db.getDatasetName()).toBe("default");
    expect(db.query("logs")).toHaveLength(5);
    // 注入生效
    await expect(
      transport.execute({ field: "ping", type: "query" }),
    ).rejects.toThrow("boom");
  });

  it("自定义场景名：非内置场景名可正常联动", () => {
    const db = createMockDb(
      { logs: seed },
      {
        datasets: {
          emptyLoading: { logs: [] },
        },
      },
    );
    const transport = new MockTransport(
      { ping: () => ({ pong: true }) },
      { scenarios: { emptyLoading: { delayMs: 5 } } },
    );
    const scenario = createScenarioContext({ db, transport });

    scenario.setScenario("emptyLoading");
    expect(db.getDatasetName()).toBe("emptyLoading");
    expect(transport.getScenario()).toBe("emptyLoading");
    expect(scenario.getScenario()).toBe("emptyLoading");
  });

  it("不存在场景：预校验抛错，不执行任何切换", () => {
    const db = createMockDb({ logs: seed });
    const transport = new MockTransport({ ping: () => ({ pong: true }) });
    const scenario = createScenarioContext({ db, transport });

    expect(() => scenario.setScenario("nope")).toThrow(/does not exist/);
    // 两侧状态均未改变
    expect(db.getDatasetName()).toBe("default");
    expect(transport.getScenario()).toBe("default");
  });

  it("切换-再切回恢复：error→default 数据与注入都恢复", async () => {
    const db = createMockDb(
      { logs: seed },
      {
        datasets: {
          error: {
            logs: [{ id: 99, status: "ERROR", amount: 1, createdAt: new Date() }],
          },
        },
      },
    );
    const transport = new MockTransport(
      { getLogs: () => db.query("logs") },
      {
        scenarios: {
          error: { fieldOptions: { getLogs: { error: new Error("boom") } } },
        },
      },
    );
    const scenario = createScenarioContext({ db, transport });

    // 初始：default 数据 + 无注入
    expect(db.getDatasetName()).toBe("default");
    expect(transport.getScenario()).toBe("default");

    // 切到 error：数据 + 注入同时生效
    scenario.setScenario("error");
    expect(db.getDatasetName()).toBe("error");
    expect(db.query("logs")).toHaveLength(1);
    expect(transport.getScenario()).toBe("error");
    await expect(
      transport.execute({ field: "getLogs", type: "query" }),
    ).rejects.toThrow("boom");

    // 切回 default：数据 + 注入都恢复
    scenario.setScenario("default");
    expect(db.getDatasetName()).toBe("default");
    expect(db.query("logs")).toHaveLength(5);
    expect(transport.getScenario()).toBe("default");
    await expect(
      transport.execute({ field: "getLogs", type: "query" }),
    ).resolves.toHaveLength(5);
  });

  it("切换期间 handler 执行中：in-flight 请求使用执行开始时的场景配置", async () => {
    const db = createMockDb({ logs: seed });
    const transport = new MockTransport(
      { ping: () => ({ pong: true }) },
      {
        scenarios: {
          loading: { delayMs: 30 },
          error: { fieldOptions: { ping: { error: new Error("boom") } } },
        },
      },
    );
    const scenario = createScenarioContext({ db, transport });

    scenario.setScenario("loading");
    const start = Date.now();
    // 不 await：delay(30ms) 挂起中
    const inFlight = transport.execute({ field: "ping", type: "query" });

    // 挂起中切到 error 场景
    scenario.setScenario("error");
    expect(transport.getScenario()).toBe("error");

    // in-flight 请求捕获的是执行开始时的 loading 配置
    // → 不抛 error 注入，正常返回，且经过 loading 的长延迟
    const result = await inFlight;
    expect(result).toEqual({ pong: true });
    expect(Date.now() - start).toBeGreaterThanOrEqual(25);

    // 后续新请求使用 error 配置 → 抛注入错误
    await expect(
      transport.execute({ field: "ping", type: "query" }),
    ).rejects.toThrow("boom");
  });
});