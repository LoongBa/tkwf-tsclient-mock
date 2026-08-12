#!/usr/bin/env node
/**
 * gen-mock-handlers CLI — 消费端 codegen 扩展。
 *
 * 读取 ts-client.g.ts，生成 ts-client.mock.g.ts。
 *
 * 用法: gen-mock-handlers --input <ts-client.g.ts> --output <ts-client.mock.g.ts>
 */

import { genMockHandlers } from "./index.js";

function main(): void {
  const args = process.argv.slice(2);

  let input: string | undefined;
  let output: string | undefined;

  // 手写参数解析（不引入依赖）
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--input" || arg === "-i") {
      input = args[++i];
    } else if (arg === "--output" || arg === "-o") {
      output = args[++i];
    } else if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    }
  }

  if (!input) {
    console.error("错误：缺少 --input 参数");
    console.error("用法: gen-mock-handlers --input <ts-client.g.ts> --output <ts-client.mock.g.ts>");
    process.exit(1);
  }

  if (!output) {
    console.error("错误：缺少 --output 参数");
    console.error("用法: gen-mock-handlers --input <ts-client.g.ts> --output <ts-client.mock.g.ts>");
    process.exit(1);
  }

  try {
    const result = genMockHandlers(input, output);
    console.log(`✓ gen-mock-handlers 完成`);
    console.log(`  field: ${result.fields} 个`);
    console.log(`  DTO: ${result.dtos} 个`);
    console.log(`  输出: ${output}`);
  } catch (err) {
    console.error(`错误: 生成失败 — ${(err as Error).message}`);
    process.exit(1);
  }
}

function printHelp(): void {
  console.log("gen-mock-handlers — 消费端 codegen mock handler 生成器");
  console.log("");
  console.log("用法:");
  console.log("  gen-mock-handlers --input <ts-client.g.ts> --output <ts-client.mock.g.ts>");
  console.log("");
  console.log("选项:");
  console.log("  -i, --input   输入文件路径（ts-client.g.ts）");
  console.log("  -o, --output  输出文件路径（ts-client.mock.g.ts）");
  console.log("  -h, --help    显示帮助信息");
}

main();