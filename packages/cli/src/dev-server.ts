import { type FSWatcher, lstatSync, readdirSync, statSync, watch } from "node:fs";
import { createServer, type Server } from "node:http";
import { isAbsolute, relative, resolve } from "node:path";
import { formatDiagnostic } from "@velarscript/compiler";
import { compileProjectEntries, type ProjectResult } from "./project.ts";
import { formatProjectFailure, formatProjectFailures } from "./project-failure.ts";
import { createFrameworkArtifacts, frameworkBase } from "./framework-host.ts";
import { resolveBrowserNpm } from "./npm.ts";
import type { VelarProjectConfig } from "./config.ts";
import { hostErrorMessage } from "./host-error.ts";
import { assertUniqueEmbeddedModuleOutputs } from "./embedded-modules.ts";
import { applicationEntryRefusal } from "./application-entry.ts";
import { buildDevelopmentWorkerModules } from "./production-build.ts";
import { projectManifestBytes } from "./project-manifest-site.ts";
import { projectPackageTarget } from "./project-package-target.ts";
import { projectModuleClosure } from "./project-module-closure.ts";
import { watchParentDeath } from "./process-lifetime.ts";
import { type DevelopmentRequestContext, handleDevelopmentRequest } from "./dev/request-handler.ts";
import type {
  BranchDirectoryTreeWatcher,
  DevelopmentRebuild,
  DevelopmentServerState,
  DirectoryTreeWatcher,
  Snapshot,
} from "./dev/state.ts";

export type { BranchDirectoryTreeWatcher } from "./dev/state.ts";

/**
 * The port a listening server actually bound.
 *
 * D114: this server used to announce the port it was *asked* for, which is the
 * same number in every case but the one that matters — `--port 0`, where the
 * host chooses. Announcing the request there named port 0, so nobody could
 * address the server they had just started, and every caller that needed a port
 * had to pick a free one, release it, and hope nothing else took it in between.
 * The address is a fact the server owns after `listen`, so it is read from the
 * server rather than repeated from the argument.
 */
function listeningPort(server: { address(): string | { port: number } | null }): number {
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("The development server bound no TCP address");
  return address.port;
}

/** One development server's own state, empty except for the first compile. */
async function createDevelopmentServerState(config: VelarProjectConfig): Promise<DevelopmentServerState> {
  return {
    snapshot: await compileSnapshot(config),
    compiling: null,
    revision: 0,
    rebuildTimer: null,
    closing: false,
    forceFullRebuild: false,
    dirtyRevision: 0,
    dirtyPaths: new Set(),
    clients: new Set(),
    packageWatchers: new Map(),
    npmPackageRoots: new Set(),
    staleNpmRoots: new Set(),
    excludedWatchDirectories: new Set([config.outDir, resolve(config.root, ".velar")]),
  };
}

/** Coalesces the writes of one editor save into a single rebuild. */
function scheduleDevelopmentRebuild(config: VelarProjectConfig, state: DevelopmentServerState): void {
  if (state.closing) return;
  if (state.rebuildTimer) clearTimeout(state.rebuildTimer);
  state.rebuildTimer = setTimeout(() => void rebuildDevelopmentSnapshot(config, state), 40);
}

/**
 * A watcher for every VelarScript package and every installed npm package the
 * current project reaches, and none for a root it no longer reaches.
 */
function syncPackageWatchers(
  config: VelarProjectConfig,
  state: DevelopmentServerState,
  project: ProjectResult,
  npmWatchRoots: readonly string[],
): void {
  state.npmPackageRoots.clear();
  for (const root of npmWatchRoots) state.npmPackageRoots.add(root);
  const roots = new Set([
    ...project.velarPackages.map((item) => item.root),
    ...npmWatchRoots,
  ]);
  for (const [root, watcher] of state.packageWatchers) {
    if (roots.has(root)) continue;
    watcher.close();
    state.packageWatchers.delete(root);
  }
  for (const root of roots) {
    if (state.packageWatchers.has(root)) continue;
    state.packageWatchers.set(root, watchDirectoryTree(root, (_event, fileName) => {
      if (!fileName) return;
      const name = fileName;
      const declarationChanged = /\.d\.[cm]?ts$/u.test(name);
      if (!/\.(?:vel|[cm]?js|json)$/u.test(name) && !declarationChanged && name !== "package.json") return;
      const path = resolve(root, name);
      state.dirtyPaths.add(path);
      if (state.npmPackageRoots.has(root)) state.staleNpmRoots.add(root);
      state.dirtyRevision += 1;
      if (name === "package.json" || declarationChanged) state.forceFullRebuild = true;
      scheduleDevelopmentRebuild(config, state);
    }, state.excludedWatchDirectories));
  }
}

/**
 * One rebuild, and the reload every connected client is told about. A rebuild
 * already in flight is joined rather than started again, and a change that
 * arrived while it ran schedules the next one from its own `finally`.
 */
function rebuildDevelopmentSnapshot(config: VelarProjectConfig, state: DevelopmentServerState): Promise<void> {
  if (state.compiling) return state.compiling;
  const rebuild = captureDevelopmentRebuild(state.snapshot, state.forceFullRebuild, state.dirtyRevision, state.dirtyPaths, state.staleNpmRoots);
  state.compiling = compileSnapshot(config, rebuild.previous, rebuild.changedPaths, rebuild.staleNpmRoots).then((next) => {
    state.snapshot = next.errors.length > 0 && state.snapshot.artifacts
      ? { ...state.snapshot, errors: next.errors, notices: next.notices, compilation: next.project.stats }
      : next;
    if (!state.closing) syncPackageWatchers(config, state, state.snapshot.project, state.snapshot.npmWatchRoots);
    if (next.errors.length === 0 && state.dirtyRevision === rebuild.revision) {
      state.dirtyPaths.clear();
      state.staleNpmRoots.clear();
      state.forceFullRebuild = false;
    }
    state.revision += 1;
    const update = JSON.stringify({ revision: state.revision, errors: next.errors, compilation: next.project.stats, fullReload: requiresFullReload(rebuild, next) });
    for (const client of state.clients) client.write(`event: reload\ndata: ${update}\n\n`);
    process.stdout.write(next.errors.length === 0
      ? `VelarScript app rebuilt in ${next.project.stats.durationMs}ms (${next.project.stats.compiledModules} compiled, ${next.project.stats.reusedModules} reused)\n`
      : `VelarScript app has ${next.errors.length} error${next.errors.length === 1 ? "" : "s"}\n`);
  }).catch((error: unknown) => {
    const message = `VelarScript rebuild failed: ${hostErrorMessage(error)}`;
    state.snapshot = { ...state.snapshot, errors: [message] };
    state.revision += 1;
    const update = JSON.stringify({ revision: state.revision, errors: state.snapshot.errors, compilation: state.snapshot.compilation, fullReload: false });
    for (const client of state.clients) client.write(`event: reload\ndata: ${update}\n\n`);
    process.stderr.write(`${message}\n`);
    process.stdout.write("VelarScript app has 1 error\n");
  }).finally(() => {
    state.compiling = null;
    if (!state.closing && state.dirtyRevision !== rebuild.revision) scheduleDevelopmentRebuild(config, state);
  });
  return state.compiling;
}

/** The project's own tree: its `.vel` and `.json` sources, and its public assets. */
function watchDevelopmentProjectTree(config: VelarProjectConfig, state: DevelopmentServerState): DirectoryTreeWatcher {
  return watchDirectoryTree(config.root, (_event, fileName) => {
    if (!fileName?.endsWith(".vel") && !fileName?.endsWith(".json") && !fileName?.startsWith(relativePublic(config))) return;
    state.dirtyRevision += 1;
    if (fileName.endsWith(".vel") || fileName.endsWith(".json")) {
      state.dirtyPaths.add(resolve(config.root, fileName));
    }
    scheduleDevelopmentRebuild(config, state);
  }, state.excludedWatchDirectories);
}

/** Every watcher, client and connection this server owns, released on one path. */
function closeDevelopmentServer(
  state: DevelopmentServerState,
  server: Server,
  watcher: DirectoryTreeWatcher,
): void {
  state.closing = true;
  if (state.rebuildTimer) {
    clearTimeout(state.rebuildTimer);
    state.rebuildTimer = null;
  }
  watcher.close();
  for (const packageWatcher of state.packageWatchers.values()) packageWatcher.close();
  state.packageWatchers.clear();
  for (const client of state.clients) client.end();
  server.close();
  server.closeIdleConnections();
  server.closeAllConnections();
}

export async function runDevServer(config: VelarProjectConfig, port: number): Promise<void> {
  if (!config.framework) throw new Error("The project does not declare an application framework host");
  const framework = config.framework;
  const base = frameworkBase(framework);
  const state = await createDevelopmentServerState(config);
  const context: DevelopmentRequestContext = { config, framework, base, state };
  const server = createServer(async (request, response) => handleDevelopmentRequest(context, request, response));

  syncPackageWatchers(config, state, state.snapshot.project, state.snapshot.npmWatchRoots);
  const watcher = watchDevelopmentProjectTree(config, state);
  const boundPort = await new Promise<number>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => resolve(listeningPort(server)));
  });
  // Long-running processes the target's manifest declares, started beside the
  // page and converged when this server closes. The framework host owns them;
  // this server owns only the promise that they do not outlive it.
  const processes = await framework.host.startDevelopmentProcesses?.({ config: framework.config, projectRoot: config.root }) ?? null;
  for (const line of processes?.report ?? []) process.stdout.write(line);
  const url = `http://127.0.0.1:${boundPort}${base}`;
  process.stdout.write(`VelarScript dev server: ${url}\n`);
  if (state.snapshot.errors.length > 0) process.stdout.write(`${state.snapshot.errors.join("\n\n")}\n`);

  const stopWatchingParent = observeDevelopmentServerOwner(() => closeDevelopmentServer(state, server, watcher));
  await new Promise<void>((resolve) => server.once("close", resolve));
  stopWatchingParent();
  await processes?.stop();
}

/**
 * Every way this server is told that its work is over, ending on one path.
 *
 * A development server is asked to stop by a person at a terminal, and it is
 * *left* by a test harness or a script that spawned it and then died — which
 * is the case that had no answer at all. `tests/browser.acceptance.ts` starts
 * one, reads its output, and stops it; when the harness itself was killed the
 * server kept its port, its file watcher and the compiler service it started
 * for as long as the machine stayed up, because nothing had told it that the
 * only reader of its output was gone.
 */
function observeDevelopmentServerOwner(close: () => void): () => void {
  process.once("SIGINT", close);
  process.once("SIGTERM", close);
  return watchParentDeath({ stop: () => close() });
}

/** Capture one rebuild boundary before asynchronous compilation can observe later watcher writes. */
function captureDevelopmentRebuild(
  snapshot: Snapshot,
  forceFullRebuild: boolean,
  revision: number,
  changedPaths: ReadonlySet<string>,
  staleNpmRoots: ReadonlySet<string>,
): DevelopmentRebuild {
  return {
    previous: forceFullRebuild ? null : snapshot.project,
    changedPaths: new Set(changedPaths),
    staleNpmRoots: new Set(staleNpmRoots),
    revision,
    packageImportsKey: snapshot.packageImportsKey,
  };
}

function requiresFullReload(rebuild: DevelopmentRebuild, next: Snapshot): boolean {
  // A Worker bundle has no live module-swap protocol. Reloading the document
  // is what retires existing Worker instances after one of its npm roots moved.
  return next.errors.length === 0
    && (rebuild.staleNpmRoots.size > 0 || next.packageImportsKey !== rebuild.packageImportsKey);
}

function watchDirectoryTree(
  root: string,
  listener: (event: string, fileName: string | null) => void,
  excludedDirectories: ReadonlySet<string> = new Set(),
): DirectoryTreeWatcher {
  // Every platform drops the same paths. Without them the dev server rebuilds
  // and full-page-reloads on its own `.velar/` prebundles and on a `dist/`
  // write from a second terminal running `velar build` or `velar test`.
  // `fs.watch` cannot express an exclusion, so a branch that hands it a whole
  // tree has to enforce the set on the way out instead of at the walk.
  const report = (event: string, fileName: string | null): void => {
    if (fileName !== null && isExcludedWatchPath(root, fileName, excludedDirectories)) return;
    listener(event, fileName);
  };
  // macOS watches a whole tree with one FSEvents stream, so the exclusion is
  // only ever a filter there. Linux has no kernel-side recursive watch: Node
  // walks the tree and allocates one inotify watch per directory, so a
  // recursive watch on a project root spends `fs.inotify.max_user_watches` on
  // `node_modules` and fails `velar dev` with ENOSPC before any event is
  // filtered. Walking it ourselves is what keeps an excluded tree unwatched
  // rather than watched and then ignored. Every platform Node does not
  // implement a recursive watch on takes the same branch.
  if (process.platform === "darwin") {
    return watch(root, { recursive: true }, (event, fileName) => report(event, fileName === null ? null : String(fileName)));
  }
  if (process.platform !== "win32") return watchDirectoryBranches(root, report, excludedDirectories);

  let snapshot = snapshotDirectoryTree(root, excludedDirectories);
  const timer = setInterval(() => {
    const next = snapshotDirectoryTree(root, excludedDirectories);
    for (const [path, signature] of next) {
      if (snapshot.get(path) !== signature) report(snapshot.has(path) ? "change" : "rename", path);
    }
    for (const path of snapshot.keys()) {
      if (!next.has(path)) report("rename", path);
    }
    snapshot = next;
  }, 80);
  timer.unref();
  return {
    close(): void {
      clearInterval(timer);
      snapshot.clear();
    },
  };
}

/** The directory names no walk here descends into, at any depth. */
const alwaysExcludedWatchSegments = new Set(["node_modules", ".git", ".velar"]);

function isExcludedWatchPath(root: string, fileName: string, excludedDirectories: ReadonlySet<string>): boolean {
  const segments = fileName.replaceAll("\\", "/").split("/").filter(Boolean);
  if (segments.length === 0) return false;
  // Every segment, not only the first: a monorepo's `packages/ui/node_modules`
  // and a sub-package's `.git` storm exactly as the root's do, and an
  // `npm install` one directory down is the common way to meet them.
  if (segments.some((segment) => alwaysExcludedWatchSegments.has(segment))) return true;
  if (excludedDirectories.size === 0) return false;
  const path = resolve(root, fileName);
  for (const excluded of excludedDirectories) {
    if (path === excluded) return true;
    const inside = relative(excluded, path);
    if (inside && !inside.startsWith("..") && !isAbsolute(inside)) return true;
  }
  return false;
}

/**
 * A recursive watch assembled from one non-recursive watch per directory. It
 * exists so an excluded tree costs no watch at all: `fs.watch` cannot express
 * an exclusion, and on Linux the recursive watch it would otherwise use spends
 * one inotify watch on every directory it walks, `node_modules` included.
 */
export function watchDirectoryBranches(
  root: string,
  report: (event: string, fileName: string | null) => void,
  excludedDirectories: ReadonlySet<string>,
): BranchDirectoryTreeWatcher {
  const watchers = new Map<string, FSWatcher>();
  let closed = false;
  const isExcludedBranch = (absolute: string, name: string): boolean =>
    alwaysExcludedWatchSegments.has(name) || excludedDirectories.has(absolute);
  // Only the POSIX branches reach here, so a `/` separator is the whole story.
  const closeBranch = (absolute: string): void => {
    const prefix = `${absolute}/`;
    for (const [path, watcher] of watchers) {
      if (path !== absolute && !path.startsWith(prefix)) continue;
      watcher.close();
      watchers.delete(path);
    }
  };
  // `announce` reports what the walk finds. A directory that arrives already
  // populated — a `git checkout` that adds a folder of modules, an editor that
  // renames a finished directory into place — exists in full before this watch
  // can attach, so its contents would otherwise never be reported at all.
  const watchBranch = (absolute: string, relativePath: string, announce: boolean): void => {
    if (closed || watchers.has(absolute)) return;
    let watcher: FSWatcher;
    try {
      watcher = watch(absolute);
    } catch {
      // A directory can vanish between the walk that found it and this watch.
      return;
    }
    watchers.set(absolute, watcher);
    watcher.on("error", () => {
      watcher.close();
      watchers.delete(absolute);
    });
    watcher.on("change", (event, fileName) => {
      if (closed) return;
      if (fileName === null || fileName === undefined) {
        report(String(event), relativePath === "" ? null : relativePath);
        return;
      }
      const name = String(fileName);
      const childAbsolute = resolve(absolute, name);
      const childRelative = relativePath === "" ? name : `${relativePath}/${name}`;
      // A directory created after the walk holds no watch yet, and this event is
      // the only notice of it; one that was removed has to give its watches back.
      if (isDirectoryPath(childAbsolute)) {
        if (!isExcludedBranch(childAbsolute, name)) watchBranch(childAbsolute, childRelative, true);
      } else {
        closeBranch(childAbsolute);
      }
      report(String(event), childRelative);
    });
    let entries;
    try {
      entries = readdirSync(absolute, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const childAbsolute = resolve(absolute, entry.name);
      const childRelative = relativePath === "" ? entry.name : `${relativePath}/${entry.name}`;
      if (entry.isDirectory() && !entry.isSymbolicLink()) {
        if (!isExcludedBranch(childAbsolute, entry.name)) watchBranch(childAbsolute, childRelative, announce);
        continue;
      }
      if (announce) report("rename", childRelative);
    }
  };
  watchBranch(root, "", false);
  return {
    watchedDirectories: () => [...watchers.keys()].sort(),
    close(): void {
      closed = true;
      for (const watcher of watchers.values()) watcher.close();
      watchers.clear();
    },
  };
}

/** A symbolic link is not descended into, exactly as the walks above do not. */
function isDirectoryPath(path: string): boolean {
  return lstatSync(path, { throwIfNoEntry: false })?.isDirectory() ?? false;
}

function snapshotDirectoryTree(root: string, excludedDirectories: ReadonlySet<string>): Map<string, string> {
  const files = new Map<string, string>();
  const pending: Array<{ readonly absolute: string; readonly relative: string }> = [{ absolute: root, relative: "" }];
  while (pending.length > 0) {
    const directory = pending.pop()!;
    let entries;
    try {
      entries = readdirSync(directory.absolute, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      const absolute = resolve(directory.absolute, entry.name);
      const relative = directory.relative ? `${directory.relative}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        if (!alwaysExcludedWatchSegments.has(entry.name) && !excludedDirectories.has(absolute)) {
          pending.push({ absolute, relative });
        }
        continue;
      }
      if (!entry.isFile()) continue;
      try {
        const stats = statSync(absolute, { bigint: true });
        files.set(relative, `${stats.size}:${stats.mtimeNs}:${stats.ctimeNs}`);
      } catch {
        // A file can disappear between discovery and metadata inspection.
      }
    }
  }
  return files;
}

async function compileSnapshot(
  config: VelarProjectConfig,
  previous: ProjectResult | null = null,
  changedPaths: ReadonlySet<string> = new Set(),
  staleNpmRoots: ReadonlySet<string> = new Set(),
): Promise<Snapshot> {
  const project = await compileProjectEntries(
    [config.entryPath, ...config.workerEntries.values()],
    config.entryPath,
    new Map(),
    {
      projectRoot: config.root,
      publicRoot: config.publicDir,
      extensions: config.compilerExtensions,
      extensionConfig: config.extensionConfig,
      framework: config.framework,
      packageTarget: projectPackageTarget(config),
      manifest: projectManifestBytes(config),
    },
    previous,
    changedPaths,
  );
  const pageModules = projectModuleClosure(project, [project.entryPath]);
  const npm = await resolveBrowserNpm(project, staleNpmRoots, pageModules);
  const artifactErrors: string[] = [];
  let workerModules: ReadonlyMap<string, string> = new Map();
  const workerNpmRoots = new Set<string>();
  try {
    assertUniqueEmbeddedModuleOutputs(project.modules.map((module) => ({
      ownerPath: module.relativePath.replace(/\.vel$/u, ".js"),
      embeddedModules: module.result.embeddedModules,
    })));
    const projectFailed = project.failures.length > 0
      || project.modules.some((module) => module.result.diagnostics.length > 0)
      || npm.failures.length > 0;
    if (!projectFailed) workerModules = await buildDevelopmentWorkerModules(project, workerNpmRoots);
  } catch (error) {
    artifactErrors.push(hostErrorMessage(error));
  }
  const errors = [
    ...formatProjectFailures(project),
    ...project.modules.flatMap((module) => module.result.diagnostics.map((item) => formatDiagnostic(module.result.source, item))),
    ...npm.failures,
    ...artifactErrors,
  ];
  // 开发服务器也走与 check/build/package 相同的入口校验。这样缺少 @main
  // 时显示编译错误页，而不会出现“命令启动成功但浏览器只有空白页”的假成功。
  if (errors.length === 0) {
    // GA-I4: the same positioned refusal `check` prints, from the same rule.
    const refusal = applicationEntryRefusal(project);
    if (refusal) errors.push(formatProjectFailure(refusal, project));
  }
  const notices = project.notices.map((notice) => `${notice.path}: ${notice.message}`);
  return {
    project,
    artifacts: errors.length === 0 ? createFrameworkArtifacts(project, true, npm.imports) : null,
    errors,
    packageImportsKey: JSON.stringify(npm.imports),
    npmPackages: npm.packages,
    npmWatchRoots: [...new Set([...npm.packages.map((package_) => package_.root), ...workerNpmRoots])].sort(),
    compilation: project.stats,
    notices,
    workerModules,
  };
}

function relativePublic(config: VelarProjectConfig): string {
  const normalized = config.publicDir.slice(config.root.length).replace(/^[/\\]+/u, "").replaceAll("\\", "/");
  return normalized ? `${normalized}/` : "";
}
