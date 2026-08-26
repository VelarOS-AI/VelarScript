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
import { writeServerConfigurationDependency, writeWebSocketDependency } from "./node-runtime-dependencies.ts";
import { prepareStandardModules } from "./test-runner.ts";
import {
  compiledTestModulePath,
  createCompiledSandbox,
  removeCompiledSandbox,
  writeCompiledTestProject,
} from "./test-output.ts";

const NODE_EXTENSION_ID = "@velarscript/node";
const SERVER_EXTENSION_ID = "@velarscript/server";
const SERVER_IDENTITY = "velar/serve#type:Server";
const WEBSOCKET_SERVER_IDENTITY = "velar/websocket#type:WebSocketServer";
const CHILD_SHUTDOWN_DEADLINE_MS = 35_000;
const REBUILD_DEBOUNCE_MS = 50;

export type NodeApplicationKind = "server-factory" | "websocket-factory";

export interface CheckedNodeApplication {
  readonly entry: ProjectModule;
  readonly kind: NodeApplicationKind;
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
  if (!config.compilerExtensions.some((extension) => extension.capabilities?.includes("node")) || config.framework) return null;
  const server = config.extensionConfig.get(SERVER_EXTENSION_ID);
  if (server && typeof server === "object") return server as VelarNodeConfig;
  const value = config.extensionConfig.get(NODE_EXTENSION_ID);
  return value && typeof value === "object" ? value as VelarNodeConfig : null;
}

export async function runNodeApplication(
  config: VelarProjectConfig,
): Promise<number> {
  const node = requireNodeConfig(config);
  const prepared = await prepareNodeApplication(config, node, "serve", false);
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
      const prepared = await prepareNodeApplication(config, node, "dev", true);
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
    try { application = nodeApplicationEntry(project, node); }
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
    const launcher = join(sandbox, ".velar-node-entry.mjs");
    const entryUrl = pathToFileURL(compiledTestModulePath(project, application.entry, sandbox)).href;
    await writeFile(launcher, nodeApplicationLauncherSource(entryUrl, node, development, application.kind), "utf8");
    return { sandbox, launcher, projectRoot: project.projectRoot, compilation: project.stats };
  } catch (error) {
    await removeCompiledSandbox(sandbox);
    throw error;
  }
}

export function nodeApplicationEntry(project: ProjectResult, config: VelarNodeConfig): CheckedNodeApplication {
  const entry = project.modules.find((module) => module.inputPath === project.entryPath);
  const exportType = entry?.result.moduleInterface.exports.get(config.app);
  if (entry && exportType && isServerFactoryType(exportType)) return { entry, kind: "server-factory" };
  if (entry && exportType && isWebSocketFactoryType(exportType)) return { entry, kind: "websocket-factory" };
  throw new Error(`${project.entryPath}: Node application entry must export an async zero-argument '${config.app}' startup function returning Server or WebSocketServer (set server.app or node.app to choose another export)`);
}

export function nodeApplicationLauncherSource(
  entryUrl: string,
  config: VelarNodeConfig,
  development: boolean,
  kind: NodeApplicationKind,
): string {
  const runtimeImport = kind === "server-factory"
    ? `import {Server} from "velar/serve";\n`
    : `import {WebSocketServer} from "velar/websocket";\n`;
  const serverType = kind === "server-factory" ? "Server" : "WebSocketServer";
  const start = `const start = entry[${JSON.stringify(config.app)}];\n`
    + `if (typeof start !== "function") throw new TypeError("Configured Node application export is not callable");\n`
    + `const server = ${serverType}.parse(await start());\n`;
  return runtimeImport
    + `import * as entry from ${JSON.stringify(entryUrl)};\n`
    + start
    + `process.stdout.write(${JSON.stringify(`VelarScript ${development ? "development" : "production"} server listening on port `)} + server.port + "\\n");\n`
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
  if (!node) throw new Error("the project does not activate a Node-capable application target such as @velarscript/server or @velarscript/node");
  return node;
}

function isServerFactoryType(type: ValueType): boolean {
  return zeroArgumentServerFactory(type, SERVER_IDENTITY);
}

function isWebSocketFactoryType(type: ValueType): boolean {
  return zeroArgumentServerFactory(type, WEBSOCKET_SERVER_IDENTITY);
}

function zeroArgumentServerFactory(type: ValueType, resultIdentity: string): boolean {
  return type.kind === "function"
    && type.typeParameterNames === undefined
    && type.rest === undefined
    && type.requiredParameters === 0
    && type.parameters.length === 0
    && type.result.kind === "promise"
    && type.result.value.kind === "named"
    && type.result.value.identity === resultIdentity;
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
