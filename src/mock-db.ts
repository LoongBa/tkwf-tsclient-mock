export type DatasetSeed = Record<string, Record<string, unknown>[]>;

/**
 * 单字段谓词：eq/neq/contains/gt/gte/lt/lte/in/nin
 */
export interface FilterPredicate {
  eq?: unknown;
  neq?: unknown;
  contains?: string;
  gt?: unknown;
  gte?: unknown;
  lt?: unknown;
  lte?: unknown;
  in?: readonly unknown[];
  nin?: readonly unknown[];
}

/**
 * 递归过滤输入：字段名→谓词 + and/or 子树
 */
export interface FilterInput {
  and?: readonly FilterInput[];
  or?: readonly FilterInput[];
  [field: string]: FilterPredicate | readonly FilterInput[] | undefined;
}

/** 排序声明：{ field: "asc" | "desc" } */
export type SortInput = Record<string, "asc" | "desc">;

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
  /** 直接操作 */
  insert<T>(table: string, row: T): T;
  update<T>(table: string, id: string | number, patch: Partial<T>): T | undefined;
  remove(table: string, id: string | number): boolean;
  /** 批量种子数据导入 */
  buildDataset(dataset: DatasetSeed): void;
  /** 重置到初始种子状态（保留 field→table 映射） */
  reset(): void;
}

// ─── 混合类型比较 ───────────────────────────────────────────

function compareValues(a: unknown, b: unknown): number {
  if (a instanceof Date && b instanceof Date) return a.getTime() - b.getTime();
  if (typeof a === "string" && typeof b === "string") return a.localeCompare(b);
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a).localeCompare(String(b));
}

// ─── 过滤引擎 ───────────────────────────────────────────────

const MAX_FILTER_DEPTH = 5;

/**
 * 递归匹配行：
 * 1. 遍历 filter 上所有非 and/or 的键 → 视为字段名，值视为谓词 → 逐字段检查
 * 2. 再评估 and（every）/or（some）子树
 */
function matchRow(row: Record<string, unknown>, filter: Record<string, unknown>, depth: number): boolean {
  if (depth > MAX_FILTER_DEPTH) {
    throw new Error("Mock: filter nesting too deep");
  }

  const filterKeys = Object.keys(filter);

  // 阶段 1：叶子谓词（隐式 AND）
  for (const key of filterKeys) {
    if (key === "and" || key === "or") continue;
    const predicate = filter[key] as Record<string, unknown> | undefined;
    if (!predicate || typeof predicate !== "object") continue;

    const rowValue = row[key];

    // eq
    if (predicate.eq !== undefined) {
      if (compareValues(rowValue, predicate.eq) !== 0) return false;
    }
    // neq
    if (predicate.neq !== undefined) {
      if (compareValues(rowValue, predicate.neq) === 0) return false;
    }
    // contains
    if (predicate.contains !== undefined) {
      const needle = String(predicate.contains);
      const haystack = typeof rowValue === "string" ? rowValue : String(rowValue);
      if (!haystack.includes(needle)) return false;
    }
    // gt
    if (predicate.gt !== undefined) {
      if (compareValues(rowValue, predicate.gt) <= 0) return false;
    }
    // gte
    if (predicate.gte !== undefined) {
      if (compareValues(rowValue, predicate.gte) < 0) return false;
    }
    // lt
    if (predicate.lt !== undefined) {
      if (compareValues(rowValue, predicate.lt) >= 0) return false;
    }
    // lte
    if (predicate.lte !== undefined) {
      if (compareValues(rowValue, predicate.lte) > 0) return false;
    }
    // in
    if (predicate.in !== undefined) {
      const inArr = predicate.in as readonly unknown[];
      if (!inArr.some((v) => compareValues(rowValue, v) === 0)) return false;
    }
    // nin
    if (predicate.nin !== undefined) {
      const ninArr = predicate.nin as readonly unknown[];
      if (ninArr.some((v) => compareValues(rowValue, v) === 0)) return false;
    }
  }

  // 阶段 2：and/or 子树
  const andArr = filter.and as Record<string, unknown>[] | undefined;
  if (andArr && !andArr.every((sub) => matchRow(row, sub, depth + 1))) return false;

  const orArr = filter.or as Record<string, unknown>[] | undefined;
  if (orArr && !orArr.some((sub) => matchRow(row, sub, depth + 1))) return false;

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
      if (cmp !== 0) return dir === "desc" ? -cmp : cmp;
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
  _entities: Record<string, unknown>,
  _options?: { seed?: number },
): MockDb {
  const tables = new Map<string, Map<string | number, Record<string, unknown>>>();
  const snapshots = new Map<string, Map<string | number, Record<string, unknown>>>();
  const fieldTableMap = new Map<string, string>();

  // 初始化表
  for (const [name, data] of Object.entries(_entities)) {
    const rows = Array.isArray(data) ? data : [];
    const table = new Map<string | number, Record<string, unknown>>();
    for (const row of rows as Record<string, unknown>[]) {
      const id = (row.id ?? row.Id) as string | number;
      if (id !== undefined) table.set(id, { ...row });
    }
    tables.set(name, table);
    snapshots.set(name, new Map(table));
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

  return {
    registerQuery(field: string, table: string): void {
      fieldTableMap.set(field, table);
    },

    registerMutation(field: string, table: string, _op: string): void {
      fieldTableMap.set(field, table);
    },

    query<T>(_table: string, filter?: unknown, sort?: unknown, page?: unknown): T[] {
      const rows = tables.get(_table);
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

    reset(): void {
      tables.clear();
      for (const [name, snapshot] of snapshots) {
        tables.set(name, new Map(snapshot));
      }
    },
  };
}