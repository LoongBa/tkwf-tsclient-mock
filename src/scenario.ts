import type { MockDb } from "./mock-db.js";
import type { MockTransport } from "./mock-transport.js";
import type { ScenarioConfig as MockTransportScenarioConfig, FieldOption } from "./mock-transport.js";

/** 内置约定场景名（消费端可自定义扩展） */
export type BuiltinScenario = "default" | "empty" | "error" | "loading";

/** 场景级 transport 配置（re-export from mock-transport） */
export type ScenarioConfig = MockTransportScenarioConfig;

/** 单个 field 的注入配置（re-export from mock-transport） */
export type { FieldOption };

export interface ScenarioContext {
  /** 同时切换 db 数据集 + transport 场景 */
  setScenario(name: string): void;
  getScenario(): string;
  readonly db: MockDb;
  readonly transport: MockTransport;
}

/**
 * 创建场景协调器，封装 db 数据集 + transport 注入的场景联动切换。
 *
 * @param options.db - createMockDb 实例
 * @param options.transport - MockTransport 实例
 * @param options.scenarios - 场景配置字典（可选，仅用于协调器对注入型场景的预校验）
 */
export function createScenarioContext(options: {
  db: MockDb;
  transport: MockTransport;
  scenarios?: Record<string, ScenarioConfig>;
}): ScenarioContext {
  const { db, transport } = options;
  const knownScenarios = options.scenarios ?? {};

  return {
    setScenario(name: string): void {
      // 1. 预校验：name 必须在 db 数据集、transport 场景或 knownScenarios 中存在
      const dbDatasets = db.listDatasets();
      const transportNames = transport.getScenarioNames();
      const dbHas = dbDatasets.includes(name);
      const transportHas = transportNames.includes(name);
      const knownHas = name in knownScenarios;

      if (!dbHas && !transportHas && !knownHas) {
        throw new Error(
          `Scenario "${name}" does not exist. ` +
          `Available datasets: [${dbDatasets.join(", ")}], ` +
          `available scenarios: [${transportNames.join(", ")}]`,
        );
      }

      // 记录切换前的状态以备回滚
      const prevDataset = db.getDatasetName();
      const prevScenario = transport.getScenario();
      let dbSwitched = false;
      let transportSwitched = false;

      try {
        // 2. 切换 db 数据集（如果存在）
        if (dbHas) {
          db.switchDataset(name);
          dbSwitched = true;
        }

        // 3. 切换 transport 场景（如果存在）
        if (transportHas) {
          transport.setScenario(name);
          transportSwitched = true;
        }
      } catch (err) {
        // 4. 回滚：任一侧抛错后，恢复已完成切换的一侧
        if (dbSwitched && !transportSwitched) {
          try {
            db.switchDataset(prevDataset);
          } catch {
            // 回滚失败不覆盖原始错误
          }
        }
        if (transportSwitched && !dbSwitched) {
          try {
            transport.setScenario(prevScenario);
          } catch {
            // 回滚失败不覆盖原始错误
          }
        }
        throw err;
      }
    },

    getScenario(): string {
      return transport.getScenario();
    },

    get db() {
      return db;
    },

    get transport() {
      return transport;
    },
  };
}