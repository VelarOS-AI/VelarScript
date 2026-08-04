#!/usr/bin/env node

import { createVelarProject, parseCreateArguments, VELAR_CREATE_VERSION } from "./index.ts";

async function main(arguments_: readonly string[]): Promise<number> {
  if (arguments_.length === 1 && (arguments_[0] === "--version" || arguments_[0] === "-v")) {
    process.stdout.write(`create-velar ${VELAR_CREATE_VERSION}\n`);
    return 0;
  }
  if (arguments_.some((argument) => argument === "--help" || argument === "-h")) {
    if (arguments_.length !== 1) {
      process.stderr.write("create-velar: help does not accept project or template arguments\n");
      return 2;
    }
    printHelp();
    return 0;
  }
  const parsed = parseCreateArguments(arguments_);
  if (typeof parsed === "string") {
    process.stderr.write(`create-velar: ${parsed}\n`);
    return 2;
  }
  try {
    const result = await createVelarProject(parsed.directory, { template: parsed.template });
    process.stdout.write(`Created VelarScript ${result.template} project -> ${result.root}\n`);
    return 0;
  } catch (error) {
    process.stderr.write(`create-velar: ${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }
}

function printHelp(): void {
  process.stdout.write([
    "Create VelarScript",
    "",
    "Usage: create-velar <project-directory> [--template <web|docs|library|component>]",
    "",
    "Creates files transactionally without installing dependencies or initializing Git.",
    "",
  ].join("\n"));
}

try {
  process.exitCode = await main(process.argv.slice(2));
} catch (error) {
  process.stderr.write(`create-velar: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
