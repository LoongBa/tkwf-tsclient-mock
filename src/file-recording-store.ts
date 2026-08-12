import type { Recording, RecordingStore, RecordedEntry } from "./record-replay.js";
import * as fs from "node:fs";
import * as path from "node:path";

/** 录制文件版本（mock 包版本，兼容性检测用） */
const RECORDING_VERSION = "1.3.0";

/**
 * 基于 node:fs 的文件存储（独立模块，不污染核心）。
 * 目录结构：`<dir>/<recordingName>.json`，每个文件一个 `Recording`。
 *
 * 生命周期约束（与 RecordingStore 接口一致）：
 * - `record()` 必须在 `start()` 之后、`stop()` 之前调用，否则抛错
 * - `stop()` 无活动会话 → 抛错
 * - 未 `stop()` 时再次 `start()` → 抛错（防止覆盖进行中的会话）
 * - `load()`/`list()` 可在录制进行中调用（读取已完成的录制，不影响当前会话）
 */
export class FileRecordingStore implements RecordingStore {
  private dir: string;
  private activeName: string | null = null;
  private activeScenario: string | undefined;
  private entries: RecordedEntry[] = [];

  constructor(dir: string) {
    // 确保目录存在（不存在则创建）
    fs.mkdirSync(dir, { recursive: true });
    this.dir = dir;
  }

  /** 开始录制会话（已存在进行中会话时抛错） */
  start(name: string, options?: { scenario?: string }): void {
    if (this.activeName !== null) {
      throw new Error(
        `RecordingStore: session "${this.activeName}" already active, call stop() first`,
      );
    }
    this.activeName = name;
    this.activeScenario = options?.scenario;
    this.entries = [];
  }

  /** 记录单条条目（无活动会话时抛错） */
  record(entry: RecordedEntry): void {
    if (this.activeName === null) {
      throw new Error(
        "RecordingStore: no active session, call start() first",
      );
    }
    this.entries.push(entry);
  }

  /** 结束会话，将 Recording 写入 `<dir>/<name>.json` 并返回（无活动会话时抛错） */
  stop(): Recording | undefined {
    if (this.activeName === null) {
      throw new Error(
        "RecordingStore: no active session, call start() first",
      );
    }

    const name = this.activeName;
    const recording: Recording = {
      name,
      scenario: this.activeScenario,
      entries: this.entries,
      createdAt: new Date().toISOString(),
      version: RECORDING_VERSION,
    };

    const filePath = path.join(this.dir, `${name}.json`);
    fs.writeFileSync(filePath, JSON.stringify(recording, null, 2), "utf-8");

    // 会话结束，清理活动状态（stop 后可再次 start）
    this.activeName = null;
    this.activeScenario = undefined;
    this.entries = [];

    return recording;
  }

  /** 从 `<dir>/<name>.json` 读取并解析 Recording（文件不存在返回 undefined） */
  load(name: string): Recording | undefined {
    const filePath = path.join(this.dir, `${name}.json`);
    if (!fs.existsSync(filePath)) return undefined;
    const raw = fs.readFileSync(filePath, "utf-8");
    return JSON.parse(raw) as Recording;
  }

  /** 列出目录下全部录制名（`*.json` 文件名去扩展名） */
  list(): string[] {
    return fs
      .readdirSync(this.dir)
      .filter((file) => file.endsWith(".json"))
      .map((file) => file.slice(0, -".json".length))
      .sort();
  }
}