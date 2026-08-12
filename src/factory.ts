export interface MockFactory<T> {
  /** 生成一条：默认值 + overrides 合并 */
  make(overrides?: Partial<T>): T;
  /** 生成 n 条：id 自增（mock-1, mock-2...） */
  makeN(count: number, overrides?: Partial<T>): T[];
  /** 显式列表 */
  makeMany(items: Partial<T>[]): T[];
}

/**
 * 创建一个类型驱动的 mock 工厂。
 *
 * 基于一个空对象骨架，递归生成合法默认值，支持 overrides 合并。
 * 适合 Agent 填充数据：只表达业务意图，类型/结构由工具兜底。
 */
export function createMockFactory<T>(_defaults?: Partial<T>): MockFactory<T> {
  let counter = 0;

  function merge(_target: T, overrides?: Partial<T>): T {
    if (!overrides) return { ..._target };
    const result = { ..._target } as Record<string, unknown>;
    for (const [key, val] of Object.entries(overrides)) {
      if (val !== undefined) {
        result[key] = val;
      }
    }
    return result as T;
  }

  return {
    make(overrides?: Partial<T>): T {
      ++counter;
      const base = {} as T;
      return merge(base, overrides);
    },
    makeN(count: number, overrides?: Partial<T>): T[] {
      return Array.from({ length: count }, () => this.make(overrides));
    },
    makeMany(items: Partial<T>[]): T[] {
      return items.map((item) => this.make(item));
    },
  };
}