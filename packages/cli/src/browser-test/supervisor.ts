/**
 * The fork every browser-test run starts with: this process is either the
 * worker that drives the browsers, or the supervisor that owns a worker and the
 * one bound that lives outside the body a test can wedge.
 */
import { resolve } from "node:path";
import type { VelarProjectConfig } from "../config.ts";
import {
  exitBrowserWorker,
  observeBrowserWorkerParent,
  superviseBrowserWorker,
} from "../browser-process-owner.ts";
import { captureUnownedErrors, mapCompiledStacksToSources } from "../unowned-errors.ts";
import {
  browserTestHostGuidance,
  browserTestLimits,
  browserTestWorkerEnvironment,
  stackOf,
  type BrowserEngineSelection,
  type BrowserTestRunnerOptions,
} from "./run.ts";
import { runBrowserTestsInWorker } from "./worker.ts";

export async function runBrowserTests(
  config: VelarProjectConfig,
  explicitInput: string | null,
  selection: BrowserEngineSelection,
  options: BrowserTestRunnerOptions = {},
): Promise<number> {
  const workerOptions = process.env[browserTestWorkerEnvironment];
  if (workerOptions !== undefined && typeof process.send === "function") {
    const resolvedOptions = browserTestWorkerOptions(workerOptions);
    const stopObservingParent = observeBrowserWorkerParent();
    // The worker owns its process and ends it with process.exit, so the exit
    // net is this runner's last guarantee that a report arriving after the
    // verdict cannot leave the run green.
    const channel = captureUnownedErrors({ exitNet: true });
    mapCompiledStacksToSources();
    let code = 1;
    try {
      code = await runBrowserTestsInWorker(config, explicitInput, selection, resolvedOptions, channel);
    } catch (error) {
      process.stderr.write(`${stackOf(error)}\n`);
    }
    const trailing = await channel.drain();
    if (trailing.length > 0) {
      process.stderr.write(`✗ an unowned error was reported after the last browser test\n${trailing.join("\n")}\n${browserTestHostGuidance}\n`);
      code = code === 0 ? 1 : code;
    }
    stopObservingParent();
    await exitBrowserWorker(code);
  }
  return superviseBrowserTests(config, explicitInput, selection, options);
}

async function superviseBrowserTests(
  config: VelarProjectConfig,
  explicitInput: string | null,
  selection: BrowserEngineSelection,
  options: BrowserTestRunnerOptions,
): Promise<number> {
  const limits = browserTestLimits(options);
  const executable = resolve(options.executable ?? process.argv[1]!);
  const input = explicitInput === null ? config.root : resolve(explicitInput);
  return superviseBrowserWorker({
    executable: process.execPath,
    arguments: [executable, "test", input, `--browser=${selection}`],
    cwd: config.root,
    environment: { ...process.env, [browserTestWorkerEnvironment]: JSON.stringify(limits) },
    deadlineMs: limits.runTimeoutMs,
    cleanupTimeoutMs: limits.cleanupTimeoutMs,
  });
}

export function browserTestWorkerOptions(value: string): BrowserTestRunnerOptions {
  let parsed: unknown;
  try { parsed = JSON.parse(value); }
  catch { throw new TypeError("Browser test worker options are invalid"); }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)
    || Object.keys(parsed).some((name) => name !== "testTimeoutMs" && name !== "runTimeoutMs" && name !== "cleanupTimeoutMs")) {
    throw new TypeError("Browser test worker options are invalid");
  }
  const record = parsed as Record<string, unknown>;
  for (const name of ["testTimeoutMs", "runTimeoutMs", "cleanupTimeoutMs"] as const) {
    const descriptor = Object.getOwnPropertyDescriptor(record, name);
    if (!descriptor?.enumerable || !("value" in descriptor) || typeof descriptor.value !== "number") {
      throw new TypeError("Browser test worker options are invalid");
    }
  }
  return browserTestLimits(record as unknown as BrowserTestRunnerOptions);
}
