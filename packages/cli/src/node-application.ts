import { watch, type FSWatcher } from "node:fs";
import { spawn, type ChildProcess } from "node:child_process";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { formatDiagnostic } from "@velarscript/compiler";
import { requiredCompilerRuntimeModules } from "./compiler-runtime-modules.ts";
import type { VelarProjectConfig } from "./config.ts";
import { compileProject, type ProjectResult } from "./project.ts";
import { formatProjectFailure, formatProjectFailures } from "./project-failure.ts";
import { displayManifestPath } from "./help.ts";
import { hostErrorMessage } from "./host-error.ts";
import { writeNodeCompilerRuntimeResolverBootstrap } from "./node-compiler-runtime-resolver.ts";
import { writeNodeStandardModuleSandbox } from "./standard-module-sandbox.ts";
import {
  compiledTestModulePath,
  createCompiledSandbox,
  removeCompiledSandbox,
  writeCompiledTestProject,
} from "./test-output.ts";
import { applicationEntry, applicationEntryRefusal, type CheckedApplicationEntry } from "./application-entry.ts";
import {
  nodeApplicationConfig,
  type NodeApplicationConfig,
} from "./node-application-config.ts";
import { projectManifestBytes } from "./project-manifest-site.ts";
import { projectLayerFindings } from "./project-layer-findings.ts";
import { projectPackageTarget } from "./project-package-target.ts";

const CHILD_SHUTDOWN_DEADLINE_MS = 35_000;
const REBUILD_DEBOUNCE_MS = 50;

export type CheckedNodeApplication = CheckedApplicationEntry;

interface PreparedNodeApplication {
  readonly sandbox: string;
  readonly launcher: string;
  readonly runtimeResolver: string;
  readonly projectRoot: string;
  readonly compilation: ProjectResult["stats"];
}

interface RunningNodeApplication {
  readonly prepared: PreparedNodeApplication;
  readonly child: ChildProcess;
  readonly exited: Promise<number>;
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
    packageTarget: projectPackageTarget(config),
    manifest: projectManifestBytes(config),
  });
  for (const notice of project.notices) process.stderr.write(`${notice.path}: notice: ${notice.message}\n`);
  const errors = [
    ...(await projectLayerFindings(config, project)).map((finding) => formatProjectFailure(finding, project)),
    ...formatProjectFailures(project),
    ...project.modules.flatMap((module) => module.result.diagnostics.map((diagnostic) => formatDiagnostic(module.result.source, diagnostic))),
  ];
  let application: CheckedNodeApplication | null = null;
  if (errors.length === 0) {
    // GA-I4: the same positioned refusal `check` prints, from the same rule.
    const refusal = applicationEntryRefusal(project);
    if (refusal) errors.push(formatProjectFailure(refusal, project));
    else application = nodeApplicationEntry(project);
  }
  if (errors.length > 0 || !application) {
    process.stderr.write(`${errors.join("\n\n")}\n`);
    return null;
  }

  const sandbox = await createCompiledSandbox(config.root, prefix);
  try {
    const runtimeModules = requiredCompilerRuntimeModules(project);
    await writeNodeStandardModuleSandbox(sandbox, config, runtimeModules);
    await writeCompiledTestProject(project, sandbox, development || config.build.sourceMaps, runtimeModules);
    const launcher = compiledTestModulePath(project, application.entry, sandbox);
    const runtimeResolver = await writeNodeCompilerRuntimeResolverBootstrap(
      sandbox, runtimeModules, project.velarArtifactImports.values(),
    );
    return { sandbox, launcher, runtimeResolver, projectRoot: project.projectRoot, compilation: project.stats };
  } catch (error) {
    await removeCompiledSandbox(sandbox);
    throw error;
  }
}

export function nodeApplicationEntry(project: ProjectResult): CheckedNodeApplication {
  return applicationEntry(project);
}

function startPreparedApplication(prepared: PreparedNodeApplication, sourceMaps: boolean): RunningNodeApplication {
  const child = spawn(process.execPath, [
    ...(sourceMaps ? ["--enable-source-maps"] : []),
    "--import",
    pathToFileURL(prepared.runtimeResolver).href,
    prepared.launcher,
  ], {
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
  if (!node) {
    throw new Error(`${displayManifestPath(config)} 'extensions' does not activate a Node-capable application target such as '@velarscript/server' or '@velarscript/node'`);
  }
  return node;
}

function watchedProjectPath(config: VelarProjectConfig, input: string): boolean {
  const path = input.replaceAll("\\", "/").replace(/^\.\//u, "");
  if (!path || path.split("/").some((segment) => segment === "node_modules" || segment === ".git" || segment === ".velar")) return false;
  const absolute = resolve(config.root, path);
  const fromOutput = relative(config.outDir, absolute);
  if (fromOutput === "" || (!fromOutput.startsWith("..") && !isAbsolute(fromOutput))) return false;
  return path.endsWith(".vel") || path.endsWith(".json") || path.endsWith(".yml") || path.endsWith(".yaml");
}
