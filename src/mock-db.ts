export type DatasetSeed = Record<string, Record<string, unknown>[]>;

/**
 * 字符串模式匹配大小写模式（Prisma 风格）。
 * - `default`：区分大小写（默认）
 * - `insensitive`：不区分大小写（比较前 toLowerCase）
 */
export type QueryMode = "default" | "insensitive";

/**
 * 单字段谓词：eq/neq/contains/gt/gte/lt/lte/in/nin
 * + OperationFilterInput 家族反向操作符（ngt/ngte/nlt/nlte/ncontains/nstartsWith/nendsWith/isTrue/isFalse）
 * + v1.5.0 新增（isNull/between/mode/containsAny/containsAll）
 */
export interface FilterPredicate {
  eq?: unknown;
  neq?: unknown;
  gt?: unknown;
  gte?: unknown;
  lt?: unknown;
  lte?: unknown;
  ngt?: unknown;
  ngte?: unknown;
  nlt?: unknown;
  nlte?: unknown;
  in?: readonly unknown[];
  nin?: readonly unknown[];
  contains?: string;
  ncontains?: string;
  startsWith?: string;
  nstartsWith?: string;
  endsWith?: string;
  nendsWith?: string;
  isTrue?: boolean;
  isFalse?: boolean;
  // v1.5.0 新增
  isNull?: boolean;                       // 空值检测：字段为 null/undefined 时匹配
  between?: readonly [unknown, unknown];  // 闭区间 [low, high]：low <= value <= high（含边界）
  mode?: QueryMode;                       // 字符串模式匹配大小写（仅影响 contains/startsWith/endsWith 及 n 前缀）
  containsAny?: readonly unknown[];       // 数组字段：包含任一值（compareValues 比较）
  containsAll?: readonly unknown[];       // 数组字段：包含全部值（compareValues 比较）
}

/**
 * 递归过滤输入：字段名→谓词 + and/or 子树
 * 兼容两种格式：
 * 1. 自有格式：and/or 为数组，字段值为 FilterPredicate
 * 2. OperationFilterInput 家族：and/or 为单对象，字段值为操作符对象族
 */
export interface FilterInput {
  and?: FilterInput | readonly FilterInput[];
  or?: FilterInput | readonly FilterInput[];
  [field: string]: FilterPredicate | FilterInput | readonly FilterInput[] | undefined;
}

/** 排序声明：{ field: "asc" | "desc" | "ASC" | "DESC" }（大小写归一） */
export type SortInput = Record<string, "asc" | "desc" | "ASC" | "DESC">;

/** 游标分页参数 */
export interface CursorPage {
  first: number;
  after?: string;
}

/** 偏移分页参数 */
export interface OffsetPage {
  page: number;
  size: number;
}

export type PageInput = CursorPage | OffsetPage;

export interface MockDbOptions {
  seed?: number;
  /** 命名数据集字典：key 为数据集名，value 为 DatasetSeed（可选） */
  datasets?: Record<string, DatasetSeed>;
}

export interface MockDb {
  /** 注册查询 handler：field → 从表读取 */
  registerQuery(field: string, table: string): void;
  /** 注册变更 handler：field → 写入表（CRUD），写后 query 立即可见 */
  registerMutation(
    field: string,
    table: string,
    op: "create" | "update" | "delete" | "custom",
  ): void;

  /** 分页/列表语义：解析 where/orderBy/page 参数 */
  query<T>(table: string, filter?: unknown, sort?: unknown, page?: unknown): T[];
  /** 单条查询：query(table, filter)[0] */
  queryOne<T>(table: string, filter?: unknown): T | undefined;
  /** 直接操作 */
  insert<T>(table: string, row: T): T;
  update<T>(table: string, id: string | number, patch: Partial<T>): T | undefined;
  remove(table: string, id: string | number): boolean;
  /** 批量种子数据导入 */
  buildDataset(dataset: DatasetSeed): void;
  /** 重置数据：无参时重置当前数据集到初始快照；传 name 时切换到该数据集并重置 */
  reset(name?: string): void;
  /** 切换当前数据集到指定名称，不存在则抛出错误 */
  switchDataset(name: string): void;
  /** 获取当前数据集名称，默认为 "default" */
  getDatasetName(): string;
  /** 列出所有可用数据集名称（含默认的 "default"） */
  listDatasets(): string[];
}

// ─── 混合类型比较 ───────────────────────────────────────────

function compareValues(a: unknown, b: unknown): number {
  if (a instanceof Date && b instanceof Date) return a.getTime() - b.getTime();
  if (typeof a === "string" && typeof b === "string") return a.localeCompare(b);
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a).localeCompare(String(b));
}

// ─── OperationFilterInput 家族统一操作符表 ─────────────────

type OperatorName =
  | "eq" | "neq"
  | "gt" | "gte" | "lt" | "lte"
  | "ngt" | "ngte" | "nlt" | "nlte"
  | "in" | "nin"
  | "contains" | "ncontains"
  | "startsWith" | "nstartsWith"
  | "endsWith" | "nendsWith"
  | "isTrue" | "isFalse"
  // v1.5.0 新增（mode 是修饰符，不进操作符表）
  | "isNull" | "between" | "containsAny" | "containsAll";

type OperatorEvaluator = (rowValue: unknown, operand: unknown) => boolean;

/** 统一操作符表：既有 eq/neq/contains 与 OperationFilterInput 反向操作符共用 */
const OPERATOR_EVALUATORS: Record<OperatorName, OperatorEvaluator> = {
  eq: (rv, op) => compareValues(rv, op) === 0,
  neq: (rv, op) => compareValues(rv, op) !== 0,
  gt: (rv, op) => compareValues(rv, op) > 0,
  gte: (rv, op) => compareValues(rv, op) >= 0,
  lt: (rv, op) => compareValues(rv, op) < 0,
  lte: (rv, op) => compareValues(rv, op) <= 0,
  // 反向：ngt = not greater than（<=），ngte = not >=（<）
  ngt: (rv, op) => compareValues(rv, op) <= 0,
  ngte: (rv, op) => compareValues(rv, op) < 0,
  // 反向：nlt = not <（>=），nlte = not <=（>）
  nlt: (rv, op) => compareValues(rv, op) >= 0,
  nlte: (rv, op) => compareValues(rv, op) > 0,
  in: (rv, op) => Array.isArray(op) && (op as readonly unknown[]).some((v) => compareValues(rv, v) === 0),
  nin: (rv, op) => Array.isArray(op) && !(op as readonly unknown[]).some((v) => compareValues(rv, v) === 0),
  contains: (rv, op) => String(rv).includes(String(op)),
  ncontains: (rv, op) => !String(rv).includes(String(op)),
  startsWith: (rv, op) => String(rv).startsWith(String(op)),
  nstartsWith: (rv, op) => !String(rv).startsWith(String(op)),
  endsWith: (rv, op) => String(rv).endsWith(String(op)),
  nendsWith: (rv, op) => !String(rv).endsWith(String(op)),
  // isTrue/isFalse：operand=true 时激活过滤（值 === true / 值 === false）；operand=false 时条件不生效
  isTrue: (rv, op) => (op === true ? rv === true : true),
  isFalse: (rv, op) => (op === true ? rv === false : true),
  // v1.5.0：isNull 惰性（非 true 放行，对齐 isTrue/isFalse）；非 null 字段由求值器处理
  isNull: (rv, op) => (op === true ? rv === null || rv === undefined : true),
  // between：闭区间 [low, high]（含边界）；非数组或长度不足 → false（防御性校验）
  between: (rv, op) => {
    if (!Array.isArray(op) || op.length < 2) return false;
    const [low, high] = op.slice(0, 2) as [unknown, unknown];
    return compareValues(rv, low) >= 0 && compareValues(rv, high) <= 0;
  },
  // containsAny/containsAll：字段值是数组，检查是否包含任一/全部目标值（compareValues 比较，与 in 一致）
  containsAny: (rv, op) => {
    if (!Array.isArray(rv) || !Array.isArray(op)) return false;
    return (op as readonly unknown[]).some((v) =>
      (rv as unknown[]).some((rvItem) => compareValues(rvItem, v) === 0),
    );
  },
  containsAll: (rv, op) => {
    if (!Array.isArray(rv) || !Array.isArray(op)) return false;
    return (op as readonly unknown[]).every((v) =>
      (rv as unknown[]).some((rvItem) => compareValues(rvItem, v) === 0),
    );
  },
};

// ─── 过滤引擎 ───────────────────────────────────────────────

const MAX_FILTER_DEPTH = 5;

/**
 * 递归匹配行：
 * 1. 遍历 filter 上所有非 and/or 的键 → 视为字段值，从统一操作符表逐键评估
 * 2. 再评估 and（every）/or（some）子树（兼容数组与 OperationFilterInput 单对象两种形态）
 */
function matchRow(row: Record<string, unknown>, filter: Record<string, unknown>, depth: number): boolean {
  if (depth > MAX_FILTER_DEPTH) {
    throw new Error("Mock: filter nesting too deep");
  }

  const filterKeys = Object.keys(filter);

  // 阶段 1：叶子谓词（隐式 AND）——统一操作符表评估
  for (const key of filterKeys) {
    if (key === "and" || key === "or") continue;
    const predicate = filter[key];
    if (!predicate || typeof predicate !== "object" || Array.isArray(predicate)) continue;

    const rowValue = row[key];
    const predObj = predicate as Record<string, unknown>;

    // null 门控（v1.5.0）：字段为 null/undefined 时，仅 isNull 操作符生效
    if (rowValue === null || rowValue === undefined) {
      const isNullOp = predObj["isNull"];
      if (isNullOp !== undefined) return isNullOp === true;
      return false; // 其他操作符对 null 均返回 false
    }

    // mode 提取（v1.5.0）：同字段的 mode 修饰符
    const mode = predObj["mode"] as QueryMode | undefined;
    const STRING_OPS = new Set(["contains", "ncontains", "startsWith", "nstartsWith", "endsWith", "nendsWith"]);

    for (const [op, operand] of Object.entries(predObj)) {
      const evaluate = OPERATOR_EVALUATORS[op as OperatorName];
      if (!evaluate) continue; // 未知键（如嵌套对象字段、mode 修饰符）→ 忽略

      // mode 归一化：对 6 个字符串模式操作符，不区分大小写比较
      let effectiveRv: unknown = rowValue;
      let effectiveOp: unknown = operand;
      if (mode === "insensitive" && STRING_OPS.has(op)) {
        effectiveRv = String(rowValue).toLowerCase();
        effectiveOp = String(operand).toLowerCase();
      }
      if (!evaluate(effectiveRv, effectiveOp)) return false;
    }
  }

  // 阶段 2：and/or 子树（兼容数组与 OperationFilterInput 单对象两种形态）
  const andVal = filter["and"];
  if (andVal !== undefined && andVal !== null) {
    const andNodes = Array.isArray(andVal) ? andVal : [andVal];
    if (!andNodes.every((sub) => matchRow(row, sub as Record<string, unknown>, depth + 1))) return false;
  }

  const orVal = filter["or"];
  if (orVal !== undefined && orVal !== null) {
    const orNodes = Array.isArray(orVal) ? orVal : [orVal];
    if (!orNodes.some((sub) => matchRow(row, sub as Record<string, unknown>, depth + 1))) return false;
  }

  return true;
}

// ─── 排序引擎 ───────────────────────────────────────────────

function sortRows(rows: Record<string, unknown>[], sort: SortInput[]): Record<string, unknown>[] {
  return [...rows].sort((a, b) => {
    for (const clause of sort) {
      const field = Object.keys(clause)[0];
      const dir = clause[field];
      const va = a[field];
      const vb = b[field];
      const cmp = compareValues(va, vb);
      if (cmp !== 0) return String(dir).toLowerCase() === "desc" ? -cmp : cmp;
    }
    return 0;
  });
}

// ─── 游标编码/解码 ──────────────────────────────────────────

/**
 * 游标编码：base64(JSON.stringify({ id, sortValue }))
 * 基于行身份而非索引，数据插入/删除后游标不漂移。
 */
export function encodeCursor(row: unknown, sortField: string): string {
  const r = row as Record<string, unknown>;
  return btoa(JSON.stringify({ id: r.id, sortValue: r[sortField] }));
}

export function decodeCursor(cursor: string): { id: unknown; sortValue: unknown } {
  return JSON.parse(atob(cursor)) as { id: unknown; sortValue: unknown };
}

// ─── 分页引擎 ───────────────────────────────────────────────

function paginateRows(
  rows: Record<string, unknown>[],
  page: PageInput,
  sortFields: string[],
): Record<string, unknown>[] {
  if ("page" in page && "size" in page) {
    // 偏移模式
    const { page: pageNum, size } = page;
    const start = (pageNum - 1) * size;
    return rows.slice(start, start + size);
  }

  // 游标模式
  const { first, after } = page;
  if (!after) return rows.slice(0, first);

  const cursor = decodeCursor(after);
  // 在已排序列表中定位该行
  const startIndex = rows.findIndex((r) => r.id === cursor.id);
  if (startIndex === -1) {
    // 降级：行已被删除 → 从 sortValue 位置之后的第一行开始
    const fallbackIndex = rows.findIndex(
      (r) => compareValues(r[sortFields[0] ?? "id"], cursor.sortValue) >= 0,
    );
    if (fallbackIndex === -1) return [];
    return rows.slice(fallbackIndex, fallbackIndex + first);
  }
  return rows.slice(startIndex + 1, startIndex + 1 + first);
}

// ─── createMockDb ───────────────────────────────────────────

export function createMockDb(
  _entities: DatasetSeed,
  _options?: MockDbOptions,
): MockDb {
  const tables = new Map<string, Map<string | number, Record<string, unknown>>>();
  const snapshots = new Map<string, Map<string | number, Record<string, unknown>>>();
  const fieldTableMap = new Map<string, string>();
  const datasetSnapshots = new Map<string, Map<string, Map<string | number, Record<string, unknown>>>>();
  let currentDatasetName = "default";

  // 从 DatasetSeed 构建表 Map
  function buildTablesFromSeed(seed: DatasetSeed): Map<string, Map<string | number, Record<string, unknown>>> {
    const result = new Map<string, Map<string | number, Record<string, unknown>>>();
    for (const [name, data] of Object.entries(seed)) {
      const rows = Array.isArray(data) ? data : [];
      const table = new Map<string | number, Record<string, unknown>>();
      for (const row of rows as Record<string, unknown>[]) {
        const id = (row.id ?? row.Id) as string | number;
        if (id !== undefined) table.set(id, { ...row });
      }
      result.set(name, table);
    }
    return result;
  }

  // 初始化 default 数据集（_entities 参数）
  const defaultTables = buildTablesFromSeed(_entities);
  for (const [name, table] of defaultTables) {
    tables.set(name, table);
    snapshots.set(name, new Map(table));
  }
  datasetSnapshots.set("default", new Map());
  for (const [name, table] of defaultTables) {
    datasetSnapshots.get("default")!.set(name, new Map(table));
  }

  // 初始化附加数据集（允许覆盖 default）
  if (_options?.datasets) {
    for (const [dsName, seed] of Object.entries(_options.datasets)) {
      const dsTables = buildTablesFromSeed(seed);
      datasetSnapshots.set(dsName, dsTables);
    }
  }

  /** 加载指定数据集到当前 tables + snapshots */
  function loadDataset(name: string): void {
    const ds = datasetSnapshots.get(name);
    if (!ds) {
      throw new Error(
        `MockDb: dataset "${name}" not found, available: ${[...datasetSnapshots.keys()].join(", ")}`,
      );
    }
    tables.clear();
    snapshots.clear();
    for (const [tableName, tableMap] of ds) {
      tables.set(tableName, new Map(tableMap));
      snapshots.set(tableName, new Map(tableMap));
    }
    currentDatasetName = name;
  }

  function nextId(table: string): number {
    const rows = tables.get(table);
    if (!rows || rows.size === 0) return 1;
    const maxId = Math.max(
      ...Array.from(rows.values()).map((r) => {
        const id = (r.id ?? r.Id) as number | undefined;
        return typeof id === "number" ? id : 0;
      }),
    );
    return maxId + 1;
  }

  function runQuery<T>(table: string, filter?: unknown, sort?: unknown, page?: unknown): T[] {
    const rows = tables.get(table);
    if (!rows) return [];
    let result = Array.from(rows.values());

    // 过滤
    if (filter && typeof filter === "object") {
      result = result.filter((row) => matchRow(row, filter as Record<string, unknown>, 0));
    }

    // 排序
    const sortArr: SortInput[] = [];
    if (sort) {
      if (Array.isArray(sort)) {
        sortArr.push(...(sort as SortInput[]));
      } else if (typeof sort === "object") {
        sortArr.push(sort as SortInput);
      }
    }

    if (sortArr.length > 0) {
      result = sortRows(result, sortArr);
    }

    // 分页
    if (page && typeof page === "object") {
      const sortFields = sortArr.length > 0 ? Object.keys(sortArr[0]) : ["id"];
      result = paginateRows(result, page as PageInput, sortFields);
    }

    return result as T[];
  }

  return {
    registerQuery(field: string, table: string): void {
      fieldTableMap.set(field, table);
    },

    registerMutation(field: string, table: string, _op: string): void {
      fieldTableMap.set(field, table);
    },

    query<T>(table: string, filter?: unknown, sort?: unknown, page?: unknown): T[] {
      return runQuery<T>(table, filter, sort, page);
    },

    queryOne<T>(table: string, filter?: unknown): T | undefined {
      return runQuery<T>(table, filter)[0];
    },

    insert<T>(table: string, row: T): T {
      const rows = tables.get(table);
      if (!rows) {
        const newRows = new Map<string | number, Record<string, unknown>>();
        tables.set(table, newRows);
      }
      const entry = { ...(row as Record<string, unknown>) };
      if (entry.id === undefined && entry.Id === undefined) {
        entry.id = nextId(table);
      }
      const id = (entry.id ?? entry.Id) as string | number;
      tables.get(table)!.set(id, entry);
      return entry as T;
    },

    update<T>(table: string, id: string | number, patch: Partial<T>): T | undefined {
      const rows = tables.get(table);
      if (!rows) return undefined;
      const existing = rows.get(id);
      if (!existing) return undefined;
      const updated = { ...existing, ...(patch as Record<string, unknown>) };
      rows.set(id, updated);
      return updated as T;
    },

    remove(table: string, id: string | number): boolean {
      const rows = tables.get(table);
      if (!rows) return false;
      return rows.delete(id);
    },

    buildDataset(dataset: DatasetSeed): void {
      for (const [table, rows] of Object.entries(dataset)) {
        const tableMap = tables.get(table) ?? new Map();
        for (const row of rows) {
          const id = (row.id ?? row.Id) as string | number;
          tableMap.set(id, { ...row });
        }
        tables.set(table, tableMap);
      }
    },

    reset(name?: string): void {
      if (name !== undefined) {
        loadDataset(name);
      }
      tables.clear();
      for (const [tableName, snapshot] of snapshots) {
        tables.set(tableName, new Map(snapshot));
      }
    },

    switchDataset(name: string): void {
      loadDataset(name);
    },

    getDatasetName(): string {
      return currentDatasetName;
    },

    listDatasets(): string[] {
      return [...datasetSnapshots.keys()];
    },
  };
}