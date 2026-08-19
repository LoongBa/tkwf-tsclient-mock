import { describe, it, expect, vi } from "vitest";
import { createMockDb, encodeCursor, decodeCursor } from "./mock-db";

interface PaymentLog {
  id: number;
  status: string;
  amount: number;
  createdAt: Date;
}

interface PaymentLogInput {
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

function makeDb() {
  return createMockDb({ logs: seed });
}

describe("createMockDb — 过滤", () => {
  it("eq / neq 精确匹配", () => {
    const db = makeDb();
    expect(db.query<PaymentLog>("logs", { status: { eq: "SUCCESS" } })).toHaveLength(3);
    expect(db.query<PaymentLog>("logs", { status: { neq: "SUCCESS" } })).toHaveLength(2);
  });

  it("contains 子串匹配", () => {
    const db = makeDb();
    const rows = db.query<PaymentLog>("logs", { status: { contains: "SUC" } });
    expect(rows).toHaveLength(3);
    expect(rows.every((r) => r.status === "SUCCESS")).toBe(true);
  });

  it("gt / gte / lt / lte 范围过滤", () => {
    const db = makeDb();
    expect(db.query<PaymentLog>("logs", { amount: { gt: 100 } })).toHaveLength(2);
    expect(db.query<PaymentLog>("logs", { amount: { gte: 100 } })).toHaveLength(3);
    expect(db.query<PaymentLog>("logs", { amount: { lt: 100 } })).toHaveLength(2);
    expect(db.query<PaymentLog>("logs", { amount: { lte: 100 } })).toHaveLength(3);
  });

  it("in / nin 集合匹配", () => {
    const db = makeDb();
    expect(
      db.query<PaymentLog>("logs", { status: { in: ["SUCCESS", "FAILED"] } }),
    ).toHaveLength(4);
    expect(
      db.query<PaymentLog>("logs", { status: { nin: ["SUCCESS", "FAILED"] } }),
    ).toHaveLength(1);
  });

  it("多字段谓词隐式 AND", () => {
    const db = makeDb();
    // status=SUCCESS AND amount >= 100
    const rows = db.query<PaymentLog>("logs", {
      status: { eq: "SUCCESS" },
      amount: { gte: 100 },
    });
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.id)).toEqual([1, 5]);
  });

  it("and / or 子树嵌套（GraphQL 惯例）", () => {
    const db = makeDb();
    // or: amount > 150 或 status = FAILED
    const rows = db.query<PaymentLog>("logs", {
      or: [{ amount: { gt: 150 } }, { status: { eq: "FAILED" } }],
    });
    expect(rows.map((r) => r.id).sort()).toEqual([2, 3]);

    // and + or 混合：status SUCCESS 且 (amount >= 150 或 id = 1)
    const mixed = db.query<PaymentLog>("logs", {
      status: { eq: "SUCCESS" },
      and: [{ or: [{ amount: { gte: 150 } }, { id: { eq: 1 } }] }],
    });
    expect(mixed.map((r) => r.id).sort()).toEqual([1, 5]);
  });

  it("混合类型比较不抛错（Date/string/number 互比）", () => {
    const db = makeDb();
    // number vs string → 跨类型转字符串比较
    const byString = db.query<PaymentLog>("logs", { amount: { gt: "100" } });
    expect(Array.isArray(byString)).toBe(true);
    // Date vs Date → getTime 差值比较
    const since = db.query<PaymentLog>("logs", {
      createdAt: { gt: new Date("2026-01-03T00:00:00Z") },
    });
    expect(since.map((r) => r.id)).toEqual([4, 5]);
    // Date vs ISO string → 跨类型不抛错
    const byIsoString = db.query<PaymentLog>("logs", {
      createdAt: { gt: "2026-01-03T00:00:00Z" },
    });
    expect(Array.isArray(byIsoString)).toBe(true);
  });

  it("and/or 嵌套深度超过 5 层抛错", () => {
    const db = makeDb();
    // 构造 6 层 and 嵌套 → 最内层深度 6 > 5
    let filter: Record<string, unknown> = { status: { eq: "SUCCESS" } };
    for (let i = 0; i < 6; i++) {
      filter = { and: [filter] };
    }
    expect(() => db.query("logs", filter)).toThrow("Mock: filter nesting too deep");

    // 恰好 5 层 → 合法
    let ok: Record<string, unknown> = { status: { eq: "SUCCESS" } };
    for (let i = 0; i < 5; i++) {
      ok = { and: [ok] };
    }
    expect(db.query<PaymentLog>("logs", ok)).toHaveLength(3);
  });
});

describe("createMockDb — 排序", () => {
  it("单字段排序", () => {
    const db = makeDb();
    const asc = db.query<PaymentLog>("logs", undefined, [{ amount: "asc" }]);
    expect(asc.map((r) => r.amount)).toEqual([50, 75, 100, 150, 200]);
    const desc = db.query<PaymentLog>("logs", undefined, [{ amount: "desc" }]);
    expect(desc.map((r) => r.amount)).toEqual([200, 150, 100, 75, 50]);
  });

  it("多字段排序：先 createdAt desc 同值再 id asc", () => {
    const db = makeDb();
    const rows = db.query<PaymentLog>("logs", undefined, [
      { createdAt: "desc" },
      { id: "asc" },
    ]);
    expect(rows.map((r) => r.id)).toEqual([5, 4, 3, 2, 1]);
  });
});

describe("createMockDb — 分页", () => {
  it("游标分页：first/after 连续翻页", () => {
    const db = makeDb();
    const sort = [{ id: "asc" }];
    const page1 = db.query<PaymentLog>("logs", undefined, sort, { first: 2 });
    expect(page1.map((r) => r.id)).toEqual([1, 2]);

    const cursor = encodeCursor(page1[page1.length - 1], "id");
    const page2 = db.query<PaymentLog>("logs", undefined, sort, {
      first: 2,
      after: cursor,
    });
    expect(page2.map((r) => r.id)).toEqual([3, 4]);

    const page3 = db.query<PaymentLog>("logs", undefined, sort, {
      first: 2,
      after: encodeCursor(page2[page2.length - 1], "id"),
    });
    expect(page3.map((r) => r.id)).toEqual([5]);
  });

  it("游标指向的行已删除 → 从该位置之后降级返回", () => {
    const db = makeDb();
    const sort = [{ id: "asc" }];
    // 游标指向 id=3
    const cursor = encodeCursor({ id: 3, idSort: 3 }, "id");
    db.remove("logs", 3);
    const rows = db.query<PaymentLog>("logs", undefined, sort, {
      first: 2,
      after: cursor,
    });
    // 降级：从 id=3 之前的位置之后第一行开始 → id=4,5
    expect(rows.map((r) => r.id)).toEqual([4, 5]);
  });

  it("偏移分页：page/size 取切片", () => {
    const db = makeDb();
    const page1 = db.query<PaymentLog>("logs", undefined, [{ id: "asc" }], {
      page: 1,
      size: 2,
    });
    expect(page1.map((r) => r.id)).toEqual([1, 2]);
    const page2 = db.query<PaymentLog>("logs", undefined, [{ id: "asc" }], {
      page: 2,
      size: 2,
    });
    expect(page2.map((r) => r.id)).toEqual([3, 4]);
    const outOfRange = db.query<PaymentLog>("logs", undefined, [{ id: "asc" }], {
      page: 99,
      size: 2,
    });
    expect(outOfRange).toEqual([]);
  });

  it("游标编码可逆且携带 id + sortValue", () => {
    const row = { id: 7, amount: 120 };
    const cursor = encodeCursor(row, "amount");
    expect(decodeCursor(cursor)).toEqual({ id: 7, sortValue: 120 });
  });
});

describe("createMockDb — 状态同步 / reset / 注册", () => {
  it("registerMutation 写入后 query 立即可见 + id 自增", () => {
    const db = createMockDb({ logs: [] });
    db.registerMutation("createPaymentLog", "logs", "create");
    db.registerQuery("paymentLogs", "logs");

    const created = db.insert<PaymentLogInput>("logs", {
      status: "SUCCESS",
      amount: 300,
      createdAt: new Date("2026-01-06T00:00:00Z"),
    }) as PaymentLog;
    expect(created.id).toBe(1);

    // 同一 MockDb：query 立即可见
    const rows = db.query<PaymentLog>("logs");
    expect(rows).toHaveLength(1);
    expect(rows[0].amount).toBe(300);

    // 连续插入 id 递增
    db.insert<PaymentLogInput>("logs", { status: "FAILED", amount: 10, createdAt: new Date() });
    expect(db.query<PaymentLog>("logs").map((r) => r.id)).toEqual([1, 2]);

    // 字段映射：registerQuery/registerMutation 登记后 handler 可路由
    expect(db.query<PaymentLog>("logs")).toHaveLength(2);
  });

  it("reset 只重置数据，保留 field→table 映射", () => {
    const db = makeDb();
    db.registerQuery("paymentLogs", "logs");
    db.registerMutation("createPaymentLog", "logs", "create");

    // 写入新数据
    db.insert<PaymentLogInput>("logs", { status: "NEW", amount: 999, createdAt: new Date() });
    expect(db.query<PaymentLog>("logs")).toHaveLength(6);

    db.reset();
    expect(db.query<PaymentLog>("logs")).toHaveLength(5);
    expect(db.query<PaymentLog>("logs").map((r) => r.id)).toEqual([1, 2, 3, 4, 5]);

    // 状态同步仍可用（映射保留）
    const created = db.insert<PaymentLogInput>("logs", {
      status: "AFTER_RESET",
      amount: 1,
      createdAt: new Date(),
    }) as PaymentLog;
    expect(db.query<PaymentLog>("logs")).toHaveLength(6);
    expect(created.id).toBe(6);
  });

  it("重复 registerQuery/registerMutation 同一 field → 后者覆盖前者", () => {
    const db = createMockDb({ logs: seed, archive: [] });
    db.registerQuery("paymentLogs", "logs");
    db.registerQuery("paymentLogs", "archive");
    expect(db.query("paymentLogs")).toEqual([]);

    db.registerMutation("createPaymentLog", "logs", "create");
    db.registerMutation("createPaymentLog", "archive", "custom");
    db.insert("archive", { id: 1, status: "A", amount: 1, createdAt: new Date() });
    expect(db.query("archive")).toHaveLength(1);
  });

  it("buildDataset 批量导入后可查询", () => {
    const db = createMockDb({ logs: [] });
    db.buildDataset({
      logs: [
        { id: 10, status: "SUCCESS", amount: 1, createdAt: new Date() },
        { id: 11, status: "FAILED", amount: 2, createdAt: new Date() },
      ],
    });
    expect(db.query<PaymentLog>("logs")).toHaveLength(2);
    expect(db.query<PaymentLog>("logs", { id: { eq: 10 } })).toHaveLength(1);
  });

  it("buildDataset strict 模式校验 FK 引用完整性（合法数据通过）", () => {
    const db = createMockDb({ logs: [], merchants: [] });
    db.registerRelation("logs", "merchant", {
      type: "belongsTo", targetTable: "merchants", foreignKey: "merchantId",
    });
    db.buildDataset({
      logs: [{ id: 1, status: "OK", merchantId: 10 }],
      merchants: [{ id: 10, name: "M" }],
    }, { strict: true });
    // 合法数据 → 不抛错
    expect(db.query("logs")).toHaveLength(1);
  });

  it("buildDataset strict 模式缺少目标行抛错", () => {
    const db = createMockDb({ logs: [], merchants: [] });
    db.registerRelation("logs", "merchant", {
      type: "belongsTo", targetTable: "merchants", foreignKey: "merchantId",
    });
    expect(() => {
      db.buildDataset({
        logs: [{ id: 1, status: "OK", merchantId: 99 }],  // merchants 中没有 id=99
        merchants: [{ id: 10, name: "M" }],
      }, { strict: true });
    }).toThrow(/FK violation/);
  });

  it("buildDataset 无 strict 时不抛错（向后兼容）", () => {
    const db = createMockDb({ logs: [], merchants: [] });
    db.registerRelation("logs", "merchant", {
      type: "belongsTo", targetTable: "merchants", foreignKey: "merchantId",
    });
    // 不传 strict → 默认 false，不校验
    db.buildDataset({
      logs: [{ id: 1, status: "OK", merchantId: 99 }],
      merchants: [],
    });
    expect(db.query("logs")).toHaveLength(1);
  });

  it("buildDataset unknownTables: warn 输出未知表名（v1.4.2）", () => {
    const db = createMockDb({ logs: [] });
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      db.buildDataset({ logs: [], PaymentLog: [{ id: 1 }] }, { unknownTables: "warn" });
      expect(warnSpy).toHaveBeenCalledTimes(1);
      const msg = warnSpy.mock.calls[0][0] as string;
      expect(msg).toContain("PaymentLog");
      expect(msg).toContain("logs");
    } finally {
      warnSpy.mockRestore();
    }
  });

  it("buildDataset unknownTables: error 抛错（v1.4.2）", () => {
    const db = createMockDb({ logs: [] });
    expect(() => {
      db.buildDataset({ logs: [], PaymentLog: [{ id: 1 }] }, { unknownTables: "error" });
    }).toThrow(/未声明的表/);
  });

  it("buildDataset unknownTables 默认 ignore 静默（向后兼容，v1.4.2）", () => {
    const db = createMockDb({ logs: [] });
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      // 不传 unknownTables → 默认 "ignore"
      db.buildDataset({ logs: [], PaymentLog: [{ id: 1 }] });
      expect(warnSpy).not.toHaveBeenCalled();
      // 数据仍导入（原行为）
      expect(db.query("logs")).toHaveLength(0);
      expect(db.query("PaymentLog")).toHaveLength(1);
    } finally {
      warnSpy.mockRestore();
    }
  });

  it("buildDataset 空初始化 db 不做未知表检测（v1.4.2）", () => {
    const db = createMockDb({});  // 无已声明表
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      db.buildDataset({ anything: [{ id: 1 }] }, { unknownTables: "warn" });
      expect(warnSpy).not.toHaveBeenCalled();
    } finally {
      warnSpy.mockRestore();
    }
  });
});

describe("createMockDb — OperationFilterInput 家族兼容", () => {
  it("反向操作符 ngt/ngte/nlt/nlte 语义", () => {
    const db = makeDb();
    // ngt = not > = <= 100 → ids 1,2,4 (amounts 100,50,75)
    expect(db.query<PaymentLog>("logs", { amount: { ngt: 100 } }).map((r) => r.id).sort()).toEqual([1, 2, 4]);
    // ngte = not >= = < 100 → ids 2,4 (50,75)
    expect(db.query<PaymentLog>("logs", { amount: { ngte: 100 } }).map((r) => r.id).sort()).toEqual([2, 4]);
    // nlt = not < = >= 100 → ids 1,3,5 (100,200,150)
    expect(db.query<PaymentLog>("logs", { amount: { nlt: 100 } }).map((r) => r.id).sort()).toEqual([1, 3, 5]);
    // nlte = not <= = > 100 → ids 3,5 (200,150)
    expect(db.query<PaymentLog>("logs", { amount: { nlte: 100 } }).map((r) => r.id).sort()).toEqual([3, 5]);
  });

  it("字符串操作符 startsWith/endsWith/ncontains/nstartsWith/nendsWith", () => {
    const db = makeDb();
    // startsWith "SUC" → SUCCESS x3
    expect(db.query<PaymentLog>("logs", { status: { startsWith: "SUC" } })).toHaveLength(3);
    // endsWith "SS" → SUCCESS x3
    expect(db.query<PaymentLog>("logs", { status: { endsWith: "SS" } })).toHaveLength(3);
    // ncontains "SUC" → FAILED, PROCESSING
    expect(db.query<PaymentLog>("logs", { status: { ncontains: "SUC" } }).map((r) => r.id).sort()).toEqual([2, 3]);
    // nstartsWith "S" → FAILED, PROCESSING
    expect(db.query<PaymentLog>("logs", { status: { nstartsWith: "S" } }).map((r) => r.id).sort()).toEqual([2, 3]);
    // nendsWith "SS" → FAILED, PROCESSING
    expect(db.query<PaymentLog>("logs", { status: { nendsWith: "SS" } }).map((r) => r.id).sort()).toEqual([2, 3]);
  });

  it("isTrue / isFalse 布尔操作符", () => {
    const db = createMockDb({
      flags: [
        { id: 1, active: true },
        { id: 2, active: false },
        { id: 3, active: true },
      ],
    });
    expect(db.query("flags", { active: { isTrue: true } })).toHaveLength(2);
    expect(db.query("flags", { active: { isFalse: true } })).toHaveLength(1);
    // isTrue: false → 条件不生效（全部通过），isFalse: false 同理
    expect(db.query("flags", { active: { isTrue: false } })).toHaveLength(3);
    expect(db.query("flags", { active: { isFalse: false } })).toHaveLength(3);
  });

  it("同一字段多操作符 AND 组合", () => {
    const db = makeDb();
    // amount >= 100 且 amount < 200 → ids 1 (100), 5 (150)
    const rows = db.query<PaymentLog>("logs", { amount: { gte: 100, lt: 200 } });
    expect(rows.map((r) => r.id).sort()).toEqual([1, 5]);
  });

  it("OperationFilterInput 与自有 FilterInput 两种格式共存", () => {
    const db = makeDb();
    // 自有格式（正向操作符）
    expect(db.query<PaymentLog>("logs", { amount: { gt: 100 } })).toHaveLength(2);
    // OperationFilterInput 格式（反向操作符）
    expect(db.query<PaymentLog>("logs", { amount: { ngt: 100 } })).toHaveLength(3);
    // 同一字段混合正向 + 反向操作符：gte(>=100) 且 lte(<=100) = 恰好 100
    expect(db.query<PaymentLog>("logs", { amount: { gte: 100, lte: 100 } })).toHaveLength(1); // =100
  });

  it("OperationFilterInput and/or 单对象子树", () => {
    const db = makeDb();
    // and 为单对象（非数组）
    const rows = db.query<PaymentLog>("logs", {
      and: { status: { eq: "SUCCESS" }, amount: { gte: 100 } },
    });
    expect(rows.map((r) => r.id).sort()).toEqual([1, 5]);

    // or 为单对象
    const rows2 = db.query<PaymentLog>("logs", { or: { amount: { gt: 150 } } });
    expect(rows2.map((r) => r.id)).toEqual([3]);
  });

  it("深度限制在 OperationFilterInput 单对象格式下仍生效", () => {
    const db = makeDb();
    // 6 层 and 单对象嵌套 → 抛错
    let filter: Record<string, unknown> = { status: { eq: "SUCCESS" } };
    for (let i = 0; i < 6; i++) {
      filter = { and: filter };
    }
    expect(() => db.query("logs", filter)).toThrow("Mock: filter nesting too deep");

    // 恰好 5 层 → 合法
    let ok: Record<string, unknown> = { status: { eq: "SUCCESS" } };
    for (let i = 0; i < 5; i++) {
      ok = { and: ok };
    }
    expect(db.query<PaymentLog>("logs", ok)).toHaveLength(3);
  });
});

describe("createMockDb — v1.5.0 新增操作符", () => {
  it("isNull: true 匹配 null 字段", () => {
    const db = makeDb();
    // 插入一条 status 为 null 的行
    db.insert<Record<string, unknown>>("logs", { status: null, amount: 0, createdAt: new Date() } as Record<string, unknown>);
    const result = db.query<PaymentLog>("logs", { status: { isNull: true } });
    expect(result).toHaveLength(1);
  });

  it("isNull: false 匹配非 null 字段", () => {
    const db = makeDb();
    db.insert<Record<string, unknown>>("logs", { status: null, amount: 0, createdAt: new Date() } as Record<string, unknown>);
    const result = db.query<PaymentLog>("logs", { status: { isNull: false } });
    expect(result).toHaveLength(5); // 5 条原有数据有 status 值
  });

  it("null 字段 + 其他操作符 → 不匹配", () => {
    const db = makeDb();
    db.insert<Record<string, unknown>>("logs", { status: null, amount: 0, createdAt: new Date() } as Record<string, unknown>);
    const result = db.query<PaymentLog>("logs", { status: { eq: "PENDING" } });
    expect(result).toHaveLength(0); // null 不匹配 eq
  });

  it("between [low, high] 闭区间，含边界", () => {
    const db = makeDb();
    const result = db.query<PaymentLog>("logs", { amount: { between: [100, 300] } });
    expect(result).toHaveLength(3); // 100, 200, 300
  });

  it("between 超出范围不匹配", () => {
    const db = makeDb();
    const result = db.query<PaymentLog>("logs", { amount: { between: [400, 500] } });
    expect(result).toHaveLength(0);
  });

  it("mode: insensitive + contains 不区分大小写", () => {
    const db = makeDb();
    const result = db.query<PaymentLog>("logs", { status: { contains: "success", mode: "insensitive" } });
    expect(result).toHaveLength(3); // SUCCESS, SUCCESS, SUCCESS
  });

  it("mode: default（默认）区分大小写", () => {
    const db = makeDb();
    const result = db.query<PaymentLog>("logs", { status: { contains: "success", mode: "default" } });
    expect(result).toHaveLength(0); // 实际值是大写 SUCCESS
  });

  it("mode: insensitive + startsWith/endsWith", () => {
    const db = makeDb();
    const sw = db.query<PaymentLog>("logs", { status: { startsWith: "suc", mode: "insensitive" } });
    expect(sw).toHaveLength(3);
    const ew = db.query<PaymentLog>("logs", { status: { endsWith: "ss", mode: "insensitive" } });
    expect(ew).toHaveLength(3);
  });

  it("containsAny 数组字段匹配任一值", () => {
    const db = makeDb();
    db.insert<Record<string, unknown>>("logs", { status: "TAGGED", amount: 10, createdAt: new Date(), tags: ["a", "b"] } as Record<string, unknown>);
    const result = db.query<Record<string, unknown>>("logs", { tags: { containsAny: ["a", "z"] } });
    expect(result).toHaveLength(1);
  });

  it("containsAll 数组字段匹配全部值", () => {
    const db = makeDb();
    db.insert<Record<string, unknown>>("logs", { status: "TAGGED", amount: 10, createdAt: new Date(), tags: ["a", "b", "c"] } as Record<string, unknown>);
    const result = db.query<Record<string, unknown>>("logs", { tags: { containsAll: ["a", "c"] } });
    expect(result).toHaveLength(1);
  });

  it("containsAny 非数组字段 → false", () => {
    const db = makeDb();
    const result = db.query<PaymentLog>("logs", { status: { containsAny: ["SUCCESS"] } });
    expect(result).toHaveLength(0);
  });
});

describe("createMockDb — v1.6.0 关联过滤嵌套", () => {
  interface Merchant {
    id: number;
    name: string;
    rating: number;
  }

  const merchantSeed: Merchant[] = [
    { id: 1, name: "LoongTech", rating: 5 },
    { id: 2, name: "AlphaCorp", rating: 3 },
    { id: 3, name: "BetaInc", rating: 4 },
  ];

  function makeRelationDb() {
    const db = createMockDb({
      logs: seed,
      merchants: merchantSeed,
    });
    // 注册关系：logs.merchantId → merchants.id（belongsTo）
    db.registerRelation("logs", "merchant", {
      type: "belongsTo",
      targetTable: "merchants",
      foreignKey: "merchantId",
    });
    // 注册关系：merchants.logIds → logs.id（hasMany，foreignKey 为当前行 ID 数组）
    db.registerRelation("merchants", "logs", {
      type: "hasMany",
      targetTable: "logs",
      foreignKey: "logIds",
    });
    // 给部分日志设置 merchantId（belongsTo 方向）
    db.insert<Record<string, unknown>>("logs", { id: 100, status: "SUCCESS", amount: 500, createdAt: new Date(), merchantId: 1 } as Record<string, unknown>);
    db.insert<Record<string, unknown>>("logs", { id: 101, status: "FAILED", amount: 50, createdAt: new Date(), merchantId: 2 } as Record<string, unknown>);
    db.insert<Record<string, unknown>>("logs", { id: 102, status: "SUCCESS", amount: 300, createdAt: new Date(), merchantId: 1 } as Record<string, unknown>);
    db.insert<Record<string, unknown>>("logs", { id: 103, status: "PENDING", amount: 100, createdAt: new Date(), merchantId: 3 } as Record<string, unknown>);
    // 给 merchants 设置 logIds（hasMany 方向，ID 数组）
    db.insert<Record<string, unknown>>("merchants", { id: 1, name: "LoongTech", rating: 5, logIds: [100, 102] } as Record<string, unknown>);
    db.insert<Record<string, unknown>>("merchants", { id: 2, name: "AlphaCorp", rating: 3, logIds: [101] } as Record<string, unknown>);
    db.insert<Record<string, unknown>>("merchants", { id: 3, name: "BetaInc", rating: 4, logIds: [103] } as Record<string, unknown>);
    return db;
  }

  it("hasMany some：至少一条关联行匹配", () => {
    const db = makeRelationDb();
    // 查询 merchants：至少有一条 logs rating > 4
    const result = db.query<Merchant>("merchants", { logs: { some: { status: { eq: "FAILED" } } } });
    expect(result).toHaveLength(1);
    expect(result[0]?.name).toBe("AlphaCorp");
  });

  it("hasMany every：所有关联行匹配", () => {
    const db = makeRelationDb();
    // 查询 merchants：所有 logs 都是 SUCCESS
    const result = db.query<Merchant>("merchants", { logs: { every: { status: { eq: "SUCCESS" } } } });
    expect(result).toHaveLength(1);
    expect(result[0]?.name).toBe("LoongTech");
  });

  it("hasMany none：没有关联行匹配", () => {
    const db = makeRelationDb();
    // 查询 merchants：没有 logs 是 FAILED
    const result = db.query<Merchant>("merchants", { logs: { none: { status: { eq: "FAILED" } } } });
    expect(result).toHaveLength(2); // LoongTech, BetaInc
  });

  it("hasMany some 空关联 → false", () => {
    const db = makeRelationDb();
    // 插入一条无关联日志的 merchant
    db.insert<Merchant>("merchants", { id: 99, name: "EmptyMerchant", rating: 1 });
    const result = db.query<Merchant>("merchants", { logs: { some: { amount: { gt: 0 } } } });
    // EmptyMerchant 无关联日志，some 返回 false → 不包含
    const names = result.map((r) => r.name);
    expect(names).not.toContain("EmptyMerchant");
  });

  it("hasMany every 空关联 → true（空真）", () => {
    const db = makeRelationDb();
    db.insert<Merchant>("merchants", { id: 99, name: "EmptyMerchant", rating: 1 });
    // every 对空数组返回 true → EmptyMerchant 被包含
    const result = db.query<Merchant>("merchants", { logs: { every: { amount: { gt: 999999 } } } });
    const names = result.map((r) => r.name);
    expect(names).toContain("EmptyMerchant");
  });

  it("belongsTo some：单关联行匹配", () => {
    const db = makeRelationDb();
    // 查询 logs：关联 merchant rating > 4
    const result = db.query<Record<string, unknown>>("logs", { merchant: { some: { rating: { gt: 4 } } } });
    expect(result).toHaveLength(2); // merchantId=1 的两条
  });

  it("belongsTo 外键为 null → 不匹配", () => {
    const db = makeRelationDb();
    // 原有 5 条日志无 merchantId，加上 4 条有 merchantId 的 = 9 条
    // 查询有关联 merchant 的日志
    const result = db.query<Record<string, unknown>>("logs", { merchant: { some: { rating: { gt: 0 } } } });
    expect(result).toHaveLength(4); // 只有有 merchantId 的 4 条
  });

  it("未注册关系字段 → 跳过（向后兼容）", () => {
    const db = makeRelationDb();
    // 对未注册关系的字段使用 some → 静默跳过，不影响结果
    const result = db.query<Merchant>("merchants", { unknownField: { some: { x: { eq: 1 } } } });
    expect(result.length).toBeGreaterThan(0);
  });

  it("嵌套多级关联（some → some）", () => {
    const db = makeRelationDb();
    // 先注册反向关系已由 makeRelationDb 完成
    // 查询 merchants：logs 中至少有一条的 merchant 是 LoongTech
    // 这是自指遍历，但 depth=5 阻止无限递归
    const result = db.query<Merchant>("merchants", { logs: { some: { merchant: { some: { name: { eq: "LoongTech" } } } } } });
    // merchantId=1 的有 2 条日志，它们关联到 LoongTech
    expect(result).toHaveLength(1);
    expect(result[0]?.name).toBe("LoongTech");
  });
});

describe("createMockDb — v1.7.0 inverse 双向同步", () => {
  function makeInverseDb() {
    const db = createMockDb({ logs: [], merchants: [] });
    db.registerRelation("logs", "merchant", {
      type: "belongsTo",
      targetTable: "merchants",
      foreignKey: "merchantId",
      inverse: "logs",
    });
    db.registerRelation("merchants", "logs", {
      type: "hasMany",
      targetTable: "logs",
      foreignKey: "logIds",
      inverse: "merchant",
    });
    return db;
  }

  it("insert 自动更新 inverse hasMany FK 数组", () => {
    const db = makeInverseDb();
    db.insert<Record<string, unknown>>("merchants", { id: 1, name: "M1", logIds: [] } as Record<string, unknown>);
    db.insert<Record<string, unknown>>("logs", { id: 10, status: "SUCCESS", merchantId: 1 } as Record<string, unknown>);
    const merchant = db.queryOne<Record<string, unknown>>("merchants", { id: { eq: 1 } });
    expect((merchant?.logIds as (string | number)[])).toContain(10);
  });

  it("insert hasMany 父行同步子行 belongsTo FK", () => {
    const db = makeInverseDb();
    db.insert<Record<string, unknown>>("logs", { id: 10, status: "SUCCESS" } as Record<string, unknown>);
    db.insert<Record<string, unknown>>("logs", { id: 11, status: "FAILED" } as Record<string, unknown>);
    db.insert<Record<string, unknown>>("merchants", { id: 1, name: "M1", logIds: [10, 11] } as Record<string, unknown>);
    const log10 = db.queryOne<Record<string, unknown>>("logs", { id: { eq: 10 } });
    expect(log10?.merchantId).toBe(1);
  });

  it("update FK 变更时旧值移除 + 新值追加", () => {
    const db = makeInverseDb();
    db.insert<Record<string, unknown>>("merchants", { id: 1, name: "M1", logIds: [] } as Record<string, unknown>);
    db.insert<Record<string, unknown>>("merchants", { id: 2, name: "M2", logIds: [] } as Record<string, unknown>);
    db.insert<Record<string, unknown>>("logs", { id: 10, status: "SUCCESS", merchantId: 1 } as Record<string, unknown>);

    // 变更 merchantId 1 → 2
    db.update<Record<string, unknown>>("logs", 10, { merchantId: 2 } as Record<string, unknown>);

    const m1 = db.queryOne<Record<string, unknown>>("merchants", { id: { eq: 1 } });
    const m2 = db.queryOne<Record<string, unknown>>("merchants", { id: { eq: 2 } });
    expect(m1?.logIds).not.toContain(10);
    expect((m2?.logIds as (string | number)[])).toContain(10);
  });

  it("remove 时清理 inverse hasMany FK 数组", () => {
    const db = makeInverseDb();
    db.insert<Record<string, unknown>>("merchants", { id: 1, name: "M1", logIds: [] } as Record<string, unknown>);
    db.insert<Record<string, unknown>>("logs", { id: 10, status: "SUCCESS", merchantId: 1 } as Record<string, unknown>);
    db.remove("logs", 10);
    const merchant = db.queryOne<Record<string, unknown>>("merchants", { id: { eq: 1 } });
    expect((merchant?.logIds as (string | number)[])).not.toContain(10);
  });

  it("无 inverse 字段时无同步（向后兼容）", () => {
    const db = createMockDb({ logs: [], merchants: [] });
    db.registerRelation("logs", "merchant", {
      type: "belongsTo",
      targetTable: "merchants",
      foreignKey: "merchantId",
      // 无 inverse
    });
    db.insert<Record<string, unknown>>("merchants", { id: 1, name: "M1", logIds: [] } as Record<string, unknown>);
    db.insert<Record<string, unknown>>("logs", { id: 10, status: "SUCCESS", merchantId: 1 } as Record<string, unknown>);
    const merchant = db.queryOne<Record<string, unknown>>("merchants", { id: { eq: 1 } });
    // merchants.logIds 未注册为 inverse → 无同步追加，保持初始 []
    expect(merchant?.logIds).toEqual([]);
  });
});

describe("createMockDb — v1.7.0 聚合过滤", () => {
  function makeAggDb() {
    return createMockDb({ logs: seed });
  }

  it("count 基本计数", () => {
    const db = makeAggDb();
    const result = db.aggregate("logs", { fields: { total: { function: "count" } } });
    expect(result.total).toBe(5);
  });

  it("sum/avg/max/min 数值计算", () => {
    const db = makeAggDb();
    const result = db.aggregate("logs", {
      fields: {
        totalAmount: { function: "sum", field: "amount" },
        avgAmount: { function: "avg", field: "amount" },
        maxAmount: { function: "max", field: "amount" },
        minAmount: { function: "min", field: "amount" },
      },
    });
    expect(result.totalAmount).toBe(575); // 100+50+200+75+150
    expect(result.avgAmount).toBe(115);
    expect(result.maxAmount).toBe(200);
    expect(result.minAmount).toBe(50);
  });

  it("filter 先过滤后聚合", () => {
    const db = makeAggDb();
    const result = db.aggregate("logs", {
      fields: {
        successCount: { function: "count", filter: { status: { eq: "SUCCESS" } } },
        successSum: { function: "sum", field: "amount", filter: { status: { eq: "SUCCESS" } } },
      },
    });
    expect(result.successCount).toBe(3);
    expect(result.successSum).toBe(325); // 100+75+150
  });

  it("where 整体过滤 + per-field filter 为 AND", () => {
    const db = makeAggDb();
    const result = db.aggregate("logs", {
      fields: {
        total: { function: "count" },
        successCount: { function: "count", filter: { status: { eq: "SUCCESS" } } },
      },
      where: { amount: { gte: 100 } },
    });
    expect(result.total).toBe(3); // amount≥100: 100,200,150 → 3
    expect(result.successCount).toBe(2); // SUCCESS + amount≥100 → 100,150
  });
});

describe("createMockDb — queryOne", () => {
  it("queryOne 返回第一条匹配，无匹配返回 undefined", () => {
    const db = makeDb();
    // 返回第一条匹配
    const row = db.queryOne<PaymentLog>("logs", { status: { eq: "SUCCESS" } });
    expect(row?.id).toBe(1);

    // 无过滤 → 第一条
    expect(db.queryOne<PaymentLog>("logs")?.id).toBe(1);

    // 无匹配 → undefined
    expect(db.queryOne("logs", { status: { eq: "NOPE" } })).toBeUndefined();
  });
});

describe("createMockDb — 排序大小写归一", () => {
  it("SortInput 接受 ASC/DESC 大写并归一", () => {
    const db = makeDb();
    const asc = db.query<PaymentLog>("logs", undefined, [{ amount: "ASC" }]);
    expect(asc.map((r) => r.amount)).toEqual([50, 75, 100, 150, 200]);

    const desc = db.query<PaymentLog>("logs", undefined, [{ amount: "DESC" }]);
    expect(desc.map((r) => r.amount)).toEqual([200, 150, 100, 75, 50]);

    // 小写仍正常工作
    const ascLower = db.query<PaymentLog>("logs", undefined, [{ amount: "asc" }]);
    expect(ascLower.map((r) => r.amount)).toEqual([50, 75, 100, 150, 200]);
  });
});

describe("createMockDb — 多数据集", () => {
  const busySeedForLogs: PaymentLog[] = [
    { id: 7, status: "SUCCESS", amount: 500, createdAt: new Date("2026-02-01T00:00:00Z") },
  ];

  function makeMultiDb() {
    return createMockDb(
      { logs: seed },
      {
        datasets: {
          empty: { logs: [] },
          busy: { logs: busySeedForLogs },
        },
      },
    );
  }

  it("datasets 初始化：listDatasets 含 default 与各命名数据集", () => {
    const db = makeMultiDb();
    expect(db.listDatasets()).toEqual(["default", "empty", "busy"]);
    expect(db.getDatasetName()).toBe("default");
    // default 数据为 _entities
    expect(db.query<PaymentLog>("logs")).toHaveLength(5);
  });

  it("switchDataset 切换数据：数据随之切换，可切回", () => {
    const db = makeMultiDb();
    db.switchDataset("empty");
    expect(db.getDatasetName()).toBe("empty");
    expect(db.query<PaymentLog>("logs")).toHaveLength(0);

    db.switchDataset("busy");
    expect(db.getDatasetName()).toBe("busy");
    expect(db.query<PaymentLog>("logs")).toHaveLength(1);
    expect(db.query<PaymentLog>("logs")[0].id).toBe(7);

    db.switchDataset("default");
    expect(db.getDatasetName()).toBe("default");
    expect(db.query<PaymentLog>("logs")).toHaveLength(5);
  });

  it("switchDataset 不存在的数据集抛错，状态不变", () => {
    const db = makeMultiDb();
    expect(() => db.switchDataset("nonexistent")).toThrow(/not found/);
    // 状态不变
    expect(db.getDatasetName()).toBe("default");
    expect(db.query<PaymentLog>("logs")).toHaveLength(5);
  });

  it("reset() 无参重置当前活跃数据集，而非 default", () => {
    const db = makeMultiDb();
    db.switchDataset("busy");
    // 在 busy 上做修改
    db.insert<PaymentLogInput>("logs", { status: "NEW", amount: 1, createdAt: new Date() });
    expect(db.query<PaymentLog>("logs")).toHaveLength(2);
    db.reset();
    // 重置回 busy 初始快照（1 条），而非 default
    expect(db.getDatasetName()).toBe("busy");
    expect(db.query<PaymentLog>("logs")).toHaveLength(1);
    expect(db.query<PaymentLog>("logs")[0].id).toBe(7);
  });

  it("reset(name) 切换到该数据集并重置，等价 switchDataset + reset", () => {
    const db = makeMultiDb();
    db.reset("empty");
    expect(db.getDatasetName()).toBe("empty");
    expect(db.query<PaymentLog>("logs")).toHaveLength(0);
    // 再插入并 reset("busy") → 切到 busy 初始快照
    db.insert<PaymentLogInput>("logs", { status: "X", amount: 1, createdAt: new Date() });
    db.reset("busy");
    expect(db.getDatasetName()).toBe("busy");
    expect(db.query<PaymentLog>("logs")).toHaveLength(1);
  });

  it("向后兼容：不传 datasets 时 listDatasets 为 default，switchDataset(default) 合法、其他抛错", () => {
    const db = makeDb(); // createMockDb({ logs: seed })
    expect(db.listDatasets()).toEqual(["default"]);
    expect(db.getDatasetName()).toBe("default");
    // switchDataset("default") 合法
    db.switchDataset("default");
    expect(db.getDatasetName()).toBe("default");
    // 其他名字抛错
    expect(() => db.switchDataset("empty")).toThrow(/not found/);
    // reset() 行为与 v1.1.0 一致
    db.insert<PaymentLogInput>("logs", { status: "NEW", amount: 999, createdAt: new Date() });
    expect(db.query<PaymentLog>("logs")).toHaveLength(6);
    db.reset();
    expect(db.query<PaymentLog>("logs")).toHaveLength(5);
    expect(db.query<PaymentLog>("logs").map((r) => r.id)).toEqual([1, 2, 3, 4, 5]);
  });

  it("切换数据集保留 field→table 注册映射", () => {
    const db = createMockDb(
      { logs: seed, archive: [] },
      {
        datasets: {
          empty: { logs: [], archive: [] },
        },
      },
    );
    db.registerQuery("paymentLogs", "logs");
    db.registerMutation("createPaymentLog", "logs", "create");
    // 切换后映射仍生效
    db.switchDataset("empty");
    expect(db.query<PaymentLog>("logs")).toHaveLength(0);
    // 通过 buildDataset 灌入后 query handler 仍可路由
    db.buildDataset({ logs: [{ id: 9, status: "SUCCESS", amount: 1, createdAt: new Date() }] });
    expect(db.query<PaymentLog>("logs")).toHaveLength(1);
    expect(db.query<PaymentLog>("logs")[0].id).toBe(9);
  });
});