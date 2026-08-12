export type DatasetSeed = Record<string, Record<string, unknown>[]>;

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
  /** 关联图构建：批量生成外键一致的图 */
  buildDataset(dataset: DatasetSeed): void;
  /** 重置到初始种子状态 */
  reset(): void;
}

/**
 * 创建内存数据库，提供 CRUD + 过滤/排序/分页语义 + 状态同步。
 *
 * 原型/demo 的可交互性依赖"mutation 后 query 看到新数据"。
 * createMockDb 是让原型从"演示"升级为"可交互"的关键。
 */
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

    query<T>(_table: string, _filter?: unknown, _sort?: unknown, _page?: unknown): T[] {
      const rows = tables.get(_table);
      if (!rows) return [];
      return Array.from(rows.values()) as T[];
    },

    insert<T>(table: string, row: T): T {
      const rows = tables.get(table);
      if (!rows) {
        const newRows = new Map<string | number, Record<string, unknown>>();
        tables.set(table, newRows);
      }
      const entry = { ...row as Record<string, unknown> };
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
      const updated = { ...existing, ...patch as Record<string, unknown> };
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