import { watch, type FSWatcher } from "node:fs";
import { spawn, type ChildProcess } from "node:child_process";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { writeFile } from "node:fs/promises";
import { formatDiagnostic, type ValueType } from "@velarscript/compiler";
import type { VelarNodeConfig } from "@velarscript/node/compiler";
import type { VelarProjectConfig } from "./config.ts";
import { compileProject, type ProjectModule, type ProjectResult } from "./project.ts";
import { hostErrorMessage } from "./host-error.ts";
import { prepareStandardModules } from "./test-runner.ts";
import {
  compiledTestModulePath,
  createCompiledSandbox,
  removeCompiledSandbox,
  writeCompiledTestProject,
} from "./test-output.ts";

const NODE_EXTENSION_ID = "@velarscript/node";
const SERVE_APP_IDENTITY = "velar/serve#type:ServeApp";
const CHILD_SHUTDOWN_DEADLINE_MS = 35_000;
const REBUILD_DEBOUNCE_MS = 50;

export interface NodeApplicationOverrides {
  readonly host?: string;
  readonly port?: number;
}

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

export function nodeApplicationConfig(config: VelarProjectConfig): VelarNodeConfig | null {
  if (!config.extensions.includes(NODE_EXTENSION_ID) || config.framework) return null;
  const value = config.extensionConfig.get(NODE_EXTENSION_ID);
  return value && typeof value === "object" ? value as VelarNodeConfig : null;
}

export async function runNodeApplication(
  config: VelarProjectConfig,
  overrides: NodeApplicationOverrides = {},
): Promise<number> {
  const node = requireNodeConfig(config);
  const prepared = await prepareNodeApplication(config, node, overrides, "serve", false);
  if (!prepared) return 1;
  try {
    const running = startPreparedApplication(prepared, node.build.sourceMaps);
    return await forwardProcessSignals(running);
  } finally {
    await removeCompiledSandbox(prepared.sandbox);
  }
}

export async function runNodeDevelopment(
  config: VelarProjectConfig,
  overrides: NodeApplicationOverrides = {},
): Promise<void> {
  const node = requireNodeConfig(config);
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
      const prepared = await prepareNodeApplication(config, node, overrides, "dev", true);
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
  node: VelarNodeConfig,
  overrides: NodeApplicationOverrides,
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
  const entry = project.modules.find((module) => module.inputPath === project.entryPath);
  if (errors.length === 0) {
    try { nodeApplicationEntry(project, node); }
    catch (error) { errors.push(hostErrorMessage(error)); }
  }
  if (errors.length > 0 || !entry) {
    process.stderr.write(`${errors.join("\n\n")}\n`);
    return null;
  }

  const sandbox = await createCompiledSandbox(config.root, prefix);
  try {
    await prepareStandardModules(sandbox, config);
    await writeCompiledTestProject(project, sandbox);
    const launcher = join(sandbox, ".velar-node-entry.mjs");
    const entryUrl = pathToFileURL(compiledTestModulePath(project, entry, sandbox)).href;
    await writeFile(launcher, nodeApplicationLauncherSource(entryUrl, node, overrides, development), "utf8");
    return { sandbox, launcher, projectRoot: project.projectRoot, compilation: project.stats };
  } catch (error) {
    await removeCompiledSandbox(sandbox);
    throw error;
  }
}

export function nodeApplicationEntry(project: ProjectResult, config: VelarNodeConfig): ProjectModule {
  const entry = project.modules.find((module) => module.inputPath === project.entryPath);
  const exportType = entry?.result.moduleInterface.exports.get(config.app);
  if (!entry || !exportType || !isServeAppType(exportType)) {
    throw new Error(`${project.entryPath}: Node application entry must export ServeApp '${config.app}' (set node.app to choose another export)`);
  }
  return entry;
}

export function nodeApplicationLauncherSource(
  entryUrl: string,
  config: VelarNodeConfig,
  overrides: NodeApplicationOverrides,
  development: boolean,
): string {
  const host = overrides.host ?? config.host;
  const port = overrides.port ?? config.port;
  return `import {ServeApp, serve} from "velar/serve";\n`
    + `import * as entry from ${JSON.stringify(entryUrl)};\n`
    + `const app = ServeApp.parse(entry[${JSON.stringify(config.app)}]);\n`
    + `const server = await serve(app, ${port}, ${JSON.stringify(host)}, ${config.maxBodyBytes});\n`
    + `process.stdout.write(${JSON.stringify(`VelarScript ${development ? "development" : "production"} server: http://${displayHost(host)}:${port}\n`)});\n`
    + `let stopping = false;\n`
    + `const stop = async signal => { if (stopping) return; stopping = true; try { await server.stop(); } catch (error) { console.error(error); process.exitCode = 1; } if (signal === "SIGINT" && process.exitCode == null) process.exitCode = 130; if (signal === "SIGTERM" && process.exitCode == null) process.exitCode = 143; };\n`
    + `process.once("SIGINT", () => void stop("SIGINT"));\n`
    + `process.once("SIGTERM", () => void stop("SIGTERM"));\n`;
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

function requireNodeConfig(config: VelarProjectConfig): VelarNodeConfig {
  const node = nodeApplicationConfig(config);
  if (!node) throw new Error("the project does not activate the @velarscript/node application target");
  return node;
}

function isServeAppType(type: ValueType): boolean {
  return type.kind === "named" && type.identity === SERVE_APP_IDENTITY;
}

function watchedProjectPath(config: VelarProjectConfig, input: string): boolean {
  const path = input.replaceAll("\\", "/").replace(/^\.\//u, "");
  if (!path || path.split("/").some((segment) => segment === "node_modules" || segment === ".git" || segment === ".velar")) return false;
  const absolute = resolve(config.root, path);
  const fromOutput = relative(config.outDir, absolute);
  if (fromOutput === "" || (!fromOutput.startsWith("..") && !isAbsolute(fromOutput))) return false;
  return path.endsWith(".vel") || path.endsWith(".json");
}

function displayHost(host: string): string {
  if (host === "0.0.0.0" || host === "::") return "127.0.0.1";
  return host.includes(":") ? `[${host}]` : host;
}
