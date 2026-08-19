#!/usr/bin/env node
/**
 * gen-seed CLI — 从 MockDataSpec JSON 生成 DatasetSeed JSON 文件。
 *
 * 用法: gen-seed --spec <mock-data-spec.json> [--output seed.json] [--scenario default] [--faker]
 *
 * 核心逻辑在 gen-seed-core.ts 的 generateSeedFile()，本文件仅做 CLI 参数解析。
 */

import { generateSeedFile } from "./gen-seed-core.js";

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  let specPath: string | undefined;
  let output: string | undefined;
  let scenario: string | undefined;
  let useFaker = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--spec" || arg === "-s") {
      specPath = args[++i];
    } else if (arg === "--output" || arg === "-o") {
      output = args[++i];
    } else if (arg === "--scenario" || arg === "--sc") {
      scenario = args[++i];
    } else if (arg === "--faker" || arg === "-f") {
      useFaker = true;
    } else if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    }
  }

  if (!specPath) {
    console.error("错误：缺少 --spec 参数");
    console.error("用法: gen-seed --spec <mock-data-spec.json> [--output seed.json] [--scenario default] [--faker]");
    process.exit(1);
  }

  // 动态加载 faker（peerDependency，可能未安装）
  let faker: Record<string, unknown> | undefined;
  if (useFaker) {
    try {
      const fakerModule = await import("@faker-js/faker");
      faker = fakerModule.fakerZH_CN as unknown as Record<string, unknown>;
    } catch {
      console.warn("@faker-js/faker 未安装，降级为 minimal 策略。安装：npm install --save-dev @faker-js/faker");
    }
  }

  try {
    const result = await generateSeedFile(specPath, { output, scenario, faker });
    console.log(`✓ gen-seed 完成`);
    console.log(`  表: ${result.tableCount} 张`);
    console.log(`  输出: ${result.outputPath}`);
    if (scenario) {
      console.log(`  场景: ${scenario}`);
    }
  } catch (err) {
    console.error(`错误: 生成失败 — ${(err as Error).message}`);
    process.exit(1);
  }
}

function printHelp(): void {
  console.log("gen-seed — 从 MockDataSpec JSON 生成 DatasetSeed JSON");
  console.log("");
  console.log("用法:");
  console.log("  gen-seed --spec <mock-data-spec.json> [--output seed.json] [--scenario default] [--faker]");
  console.log("");
  console.log("选项:");
  console.log("  -s, --spec       输入文件路径（mock-data-spec.json）");
  console.log("  -o, --output     输出文件路径（默认 seed.json）");
  console.log("      --scenario   生成期场景名（覆盖实体 count，v1.4.1）");
  console.log("  -f, --faker      启用 faker 策略（需安装 @faker-js/faker）");
  console.log("  -h, --help       显示帮助信息");
}

main();
