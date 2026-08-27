import { watch, type FSWatcher } from "node:fs";
import { spawn, type ChildProcess } from "node:child_process";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { formatDiagnostic } from "@velarscript/compiler";
import type { VelarProjectConfig } from "./config.ts";
import { compileProject, type ProjectResult } from "./project.ts";
import { hostErrorMessage } from "./host-error.ts";
import { writeServerConfigurationDependency, writeWebSocketDependency } from "./node-runtime-dependencies.ts";
import { prepareStandardModules } from "./test-runner.ts";
import {
  compiledTestModulePath,
  createCompiledSandbox,
  removeCompiledSandbox,
  writeCompiledTestProject,
} from "./test-output.ts";
import { applicationEntry, type CheckedApplicationEntry } from "./application-entry.ts";

const NODE_EXTENSION_ID = "@velarscript/node";
const SERVER_EXTENSION_ID = "@velarscript/server";
const CHILD_SHUTDOWN_DEADLINE_MS = 35_000;
const REBUILD_DEBOUNCE_MS = 50;

export interface NodeApplicationConfig {
  readonly configuration: string | null;
}

export type CheckedNodeApplication = CheckedApplicationEntry;

interface PreparedNodeApplication {
  readonly sandbox: string;
  readonly launcher: string;
  readonly projectRoot: string;
  readonly compilation: ProjectResult["stats"];
}

interface RunningNodeApplication {
  readonly prepared: PreparedNodeApplication;
  readonly child: ChildProcess;
  readonly exited: Promise<number>;
}

export function nodeApplicationConfig(config: VelarProjectConfig): NodeApplicationConfig | null {
  if (config.kind !== "application"
    || !config.compilerExtensions.some((extension) => extension.capabilities?.includes("node"))
    || config.framework) return null;
  const server = config.extensionConfig.get(SERVER_EXTENSION_ID);
  if (server && typeof server === "object") {
    const configuration = (server as {readonly configuration?: unknown}).configuration;
    if (typeof configuration !== "string") throw new Error("the Server extension did not provide its checked configuration path");
    return {configuration};
  }
  const value = config.extensionConfig.get(NODE_EXTENSION_ID);
  return value && typeof value === "object" ? {configuration: null} : null;
}

export async function runNodeApplication(
  config: VelarProjectConfig,
): Promise<number> {
  requireNodeConfig(config);
  const prepared = await prepareNodeApplication(config, "serve", false);
  if (!prepared) return 1;
  try {
    const running = startPreparedApplication(prepared, config.build.sourceMaps);
    return await forwardProcessSignals(running);
  } finally {
    await removeCompiledSandbox(prepared.sandbox);
  }
}

export async function runNodeDevelopment(
  config: VelarProjectConfig,
): Promise<void> {
  requireNodeConfig(config);
  let current: RunningNodeApplication | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let rebuilding = false;
  let rebuildAgain = false;
  let closing = false;
  let watcher: FSWatcher | null = null;
  const expectedStops = new WeakSet<ChildProcess>();

  const rebuild = async (): Promise<void> => {
    if (closing) return;
    if (rebuilding) {
      rebuildAgain = true;
      return;
    }
    rebuilding = true;
    try {
      const prepared = await prepareNodeApplication(config, "dev", true);
      if (!prepared || closing) {
        if (prepared) await removeCompiledSandbox(prepared.sandbox);
        return;
      }
      const previous = current;
      if (previous) {
        expectedStops.add(previous.child);
        await stopRunningApplication(previous);
      }
      if (closing) {
        await removeCompiledSandbox(prepared.sandbox);
        return;
      }
      const running = startPreparedApplication(prepared, true);
      current = running;
      running.exited.then(async (code) => {
        if (current?.prepared.sandbox !== prepared.sandbox) return;
        current = null;
        await removeCompiledSandbox(prepared.sandbox);
        if (!closing && !expectedStops.has(running.child) && code !== 0) process.stderr.write(`VelarScript Node app exited with status ${code}; waiting for a source change\n`);
      }).catch(async (error: unknown) => {
        if (current?.prepared.sandbox === prepared.sandbox) current = null;
        await removeCompiledSandbox(prepared.sandbox);
        if (!closing) process.stderr.write(`VelarScript Node app failed: ${hostErrorMessage(error)}\n`);
      });
      process.stdout.write(`VelarScript Node app rebuilt in ${prepared.compilation.durationMs}ms (${prepared.compilation.compiledModules} compiled, ${prepared.compilation.reusedModules} reused)\n`);
    } finally {
      rebuilding = false;
      if (rebuildAgain && !closing) {
        rebuildAgain = false;
        void rebuild();
      }
    }
  };

  const schedule = (): void => {
    if (closing) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      void rebuild();
    }, REBUILD_DEBOUNCE_MS);
  };

  await rebuild();
  watcher = watch(config.root, { recursive: true }, (_event, fileName) => {
    if (fileName !== null && !watchedProjectPath(config, String(fileName))) return;
    schedule();
  });

  await new Promise<void>((done) => {
    let finishing = false;
    const close = async (): Promise<void> => {
      if (finishing) return;
      finishing = true;
      closing = true;
      if (timer) clearTimeout(timer);
      timer = null;
      watcher?.close();
      watcher = null;
      const running = current;
      current = null;
      if (running) await stopRunningApplication(running);
      process.off("SIGINT", onInterrupt);
      process.off("SIGTERM", onTerminate);
      done();
    };
    const onInterrupt = (): void => { void close(); };
    const onTerminate = (): void => { void close(); };
    process.once("SIGINT", onInterrupt);
    process.once("SIGTERM", onTerminate);
  });
}

async function prepareNodeApplication(
  config: VelarProjectConfig,
  prefix: "dev" | "serve",
  development: boolean,
): Promise<PreparedNodeApplication | null> {
  const project = await compileProject(config.entryPath, new Map(), {
    sourceRoot: dirname(config.entryPath),
    projectRoot: config.root,
    publicRoot: config.publicDir,
    extensions: config.compilerExtensions,
    extensionConfig: config.extensionConfig,
    framework: null,
  });
  for (const notice of project.notices) process.stderr.write(`${notice.path}: notice: ${notice.message}\n`);
  const errors = [
    ...project.failures.map((failure) => `${failure.path}: ${failure.message}`),
    ...project.modules.flatMap((module) => module.result.diagnostics.map((diagnostic) => formatDiagnostic(module.result.source, diagnostic))),
  ];
  let application: CheckedNodeApplication | null = null;
  if (errors.length === 0) {
    try { application = nodeApplicationEntry(project); }
    catch (error) { errors.push(hostErrorMessage(error)); }
  }
  if (errors.length > 0 || !application) {
    process.stderr.write(`${errors.join("\n\n")}\n`);
    return null;
  }

  const sandbox = await createCompiledSandbox(config.root, prefix);
  try {
    await prepareStandardModules(sandbox, config);
    if (usesNodeWebSocket(project)) await writeWebSocketDependency(join(sandbox, "node_modules"));
    if (usesNodeServerConfiguration(project)) await writeServerConfigurationDependency(join(sandbox, "node_modules"));
    await writeCompiledTestProject(project, sandbox, development || config.build.sourceMaps);
    const launcher = compiledTestModulePath(project, application.entry, sandbox);
    return { sandbox, launcher, projectRoot: project.projectRoot, compilation: project.stats };
  } catch (error) {
    await removeCompiledSandbox(sandbox);
    throw error;
  }
}

export function nodeApplicationEntry(project: ProjectResult): CheckedNodeApplication {
  return applicationEntry(project);
}

function startPreparedApplication(prepared: PreparedNodeApplication, sourceMaps: boolean): RunningNodeApplication {
  const child = spawn(process.execPath, [...(sourceMaps ? ["--enable-source-maps"] : []), prepared.launcher], {
    cwd: prepared.projectRoot,
    stdio: "inherit",
  });
  const exited = new Promise<number>((resolveExit, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => resolveExit(code ?? (signal === "SIGINT" ? 130 : signal === "SIGTERM" ? 143 : 1)));
  });
  return { prepared, child, exited };
}

async function forwardProcessSignals(running: RunningNodeApplication): Promise<number> {
  let shutdownTimer: ReturnType<typeof setTimeout> | null = null;
  let forwarded = false;
  const forward = (signal: "SIGINT" | "SIGTERM"): void => {
    if (running.child.exitCode !== null || running.child.signalCode !== null) return;
    if (forwarded) {
      running.child.kill("SIGKILL");
      return;
    }
    forwarded = true;
    running.child.kill(signal);
    shutdownTimer = setTimeout(() => running.child.kill("SIGKILL"), CHILD_SHUTDOWN_DEADLINE_MS);
    shutdownTimer.unref();
  };
  const interrupt = (): void => forward("SIGINT");
  const terminate = (): void => forward("SIGTERM");
  process.on("SIGINT", interrupt);
  process.on("SIGTERM", terminate);
  try {
    return await running.exited;
  } finally {
    process.off("SIGINT", interrupt);
    process.off("SIGTERM", terminate);
    if (shutdownTimer) clearTimeout(shutdownTimer);
  }
}

async function stopRunningApplication(running: RunningNodeApplication): Promise<void> {
  if (running.child.exitCode === null && running.child.signalCode === null) {
    running.child.kill("SIGTERM");
    const force = setTimeout(() => running.child.kill("SIGKILL"), CHILD_SHUTDOWN_DEADLINE_MS);
    force.unref();
    try { await running.exited; }
    finally { clearTimeout(force); }
  }
  await removeCompiledSandbox(running.prepared.sandbox);
}

function requireNodeConfig(config: VelarProjectConfig): NodeApplicationConfig {
  const node = nodeApplicationConfig(config);
  if (!node) throw new Error("the project does not activate a Node-capable application target such as @velarscript/server or @velarscript/node");
  return node;
}

function usesNodeWebSocket(project: ProjectResult): boolean {
  return project.modules.some((module) => module.result.dependencies.some((dependency) => dependency.source === "velar/websocket")
    || module.result.runtimeModules.includes("velar/websocket"));
}

function usesNodeServerConfiguration(project: ProjectResult): boolean {
  return project.modules.some((module) => module.result.dependencies.some((dependency) => dependency.source === "velar/server")
    || module.result.runtimeModules.includes("velar/server"));
}

function watchedProjectPath(config: VelarProjectConfig, input: string): boolean {
  const path = input.replaceAll("\\", "/").replace(/^\.\//u, "");
  if (!path || path.split("/").some((segment) => segment === "node_modules" || segment === ".git" || segment === ".velar")) return false;
  const absolute = resolve(config.root, path);
  const fromOutput = relative(config.outDir, absolute);
  if (fromOutput === "" || (!fromOutput.startsWith("..") && !isAbsolute(fromOutput))) return false;
  return path.endsWith(".vel") || path.endsWith(".json") || path.endsWith(".yml") || path.endsWith(".yaml");
}
