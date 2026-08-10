#!/usr/bin/env node

import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { buildDesktopApplication } from "./build.ts";

async function main(arguments_: readonly string[]): Promise<number> {
  const [command, ...rest] = arguments_;
  if (!command || command === "help" || command === "--help" || command === "-h") {
    process.stdout.write(
      "VelarScript Desktop\n\n"
      + "Usage:\n"
      + "  velar-desktop build [project-directory]\n"
      + "  velar-desktop test [project-directory] [--browser chromium|firefox|webkit|all]\n",
    );
    return 0;
  }
  if (command === "--version" || command === "-v") {
    process.stdout.write("velar-desktop 0.10.0\n");
    return 0;
  }
  if (command === "test") {
    const parsed = parseTestArguments(rest);
    if (typeof parsed === "string") {
      process.stderr.write(`velar-desktop test: ${parsed}\n`);
      return 2;
    }
    return runDesktopTests(parsed.project, parsed.browser);
  }
  if (command !== "build" || rest.length > 1 || rest.some((item) => item.startsWith("-"))) {
    process.stderr.write("velar-desktop: expected 'build' or 'test'\n");
    return 2;
  }
  try {
    const result = await buildDesktopApplication(rest[0] ?? null);
    const sizes = result.manifest.sizes;
    process.stdout.write(
      `Built ${result.manifest.productName} -> ${result.applicationBundle}\n`
      + `Size ${formatBytes(sizes.totalBytes)} / ${formatBytes(result.manifest.sizeBudgetBytes)} `
      + `(host ${formatBytes(sizes.hostBytes)}, renderer ${formatBytes(sizes.rendererBytes)}, capabilities ${formatBytes(sizes.capabilityHostBytes)})\n`
      + `Runtime external Node.js >=${result.manifest.runtime.minimumMajor} (not embedded)\n`,
    );
    return 0;
  } catch (error) {
    process.stderr.write(`velar-desktop build: ${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }
}

function parseTestArguments(arguments_: readonly string[]): { readonly project: string | null; readonly browser: string } | string {
  let project: string | null = null;
  let browser = "chromium";
  const engines = new Set(["chromium", "firefox", "webkit", "all"]);
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index]!;
    if (argument === "--browser") {
      const value = arguments_[index + 1];
      if (!value || !engines.has(value)) return "--browser requires chromium, firefox, webkit, or all";
      browser = value;
      index += 1;
    } else if (argument.startsWith("--browser=")) {
      const value = argument.slice("--browser=".length);
      if (!engines.has(value)) return "--browser requires chromium, firefox, webkit, or all";
      browser = value;
    } else if (argument.startsWith("-")) {
      return `unknown option '${argument}'`;
    } else if (project !== null) {
      return `unexpected extra input '${argument}'`;
    } else {
      project = argument;
    }
  }
  return { project, browser };
}

async function runDesktopTests(project: string | null, browser: string): Promise<number> {
  const cli = fileURLToPath(new URL("../../cli/dist/cli.js", import.meta.url));
  const child = spawn(process.execPath, [cli, "test", project ?? ".", `--browser=${browser}`], {
    cwd: process.cwd(),
    stdio: "inherit",
  });
  return await new Promise<number>((resolveExit) => {
    child.once("error", (error) => {
      process.stderr.write(`velar-desktop test: ${error.message}\n`);
      resolveExit(1);
    });
    child.once("exit", (code, signal) => {
      if (signal) process.stderr.write(`velar-desktop test: runner stopped by ${signal}\n`);
      resolveExit(code ?? 1);
    });
  });
}

function formatBytes(value: number): string {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KiB`;
  return `${(value / 1024 / 1024).toFixed(2)} MiB`;
}

process.exitCode = await main(process.argv.slice(2));
