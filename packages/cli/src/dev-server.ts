import { createReadStream, type FSWatcher, lstatSync, readdirSync, statSync, watch } from "node:fs";
import { createServer, type ServerResponse } from "node:http";
import { isAbsolute, posix, relative, resolve } from "node:path";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";
import { formatDiagnostic } from "@velarscript/compiler";
import type { FrameworkHostArtifacts } from "@velarscript/compiler/framework-host";
import { compileProject, type ProjectResult } from "./project.ts";
import { createFrameworkArtifacts, frameworkBase } from "./framework-host.ts";
import { moduleOutput, publicAsset } from "./module-assets.ts";
import { npmAsset, resolveBrowserNpm, type BrowserNpmPackage } from "./npm.ts";
import type { VelarProjectConfig } from "./config.ts";
import { standardModuleAsset } from "./standard-modules.ts";
import { asHostError, hostErrorMessage } from "./host-error.ts";
import { assertUniqueEmbeddedModuleOutputs } from "./embedded-modules.ts";
import { localRequestRefusal } from "./local-request-guard.ts";
import { applicationEntry } from "./application-entry.ts";

interface Snapshot {
  readonly project: ProjectResult;
  readonly artifacts: FrameworkHostArtifacts | null;
  readonly errors: readonly string[];
  readonly npmPackages: readonly BrowserNpmPackage[];
  readonly compilation: ProjectResult["stats"];
  readonly notices: readonly string[];
}

interface DirectoryTreeWatcher {
  close(): void;
}

export interface BranchDirectoryTreeWatcher extends DirectoryTreeWatcher {
  /**
   * The directories that hold a watch. The exclusion is structural here, so an
   * excluded tree never appears — which is the whole point of this branch.
   */
  watchedDirectories(): readonly string[];
}

export async function runDevServer(config: VelarProjectConfig, port: number): Promise<void> {
  if (!config.framework) throw new Error("The project does not declare an application framework host");
  const framework = config.framework;
  const base = frameworkBase(framework);
  let snapshot = await compileSnapshot(config);
  let compiling: Promise<void> | null = null;
  let revision = 0;
  let rebuildTimer: ReturnType<typeof setTimeout> | null = null;
  let closing = false;
  let forceFullRebuild = false;
  let dirtyRevision = 0;
  const dirtyPaths = new Set<string>();
  const clients = new Set<ServerResponse>();
  const packageWatchers = new Map<string, DirectoryTreeWatcher>();
  // Installed npm package roots whose files changed since the last successful
  // rebuild; their dev prebundles are rebuilt instead of served from cache.
  const npmPackageRoots = new Set<string>();
  const staleNpmRoots = new Set<string>();
  const scheduleRebuild = (): void => {
    if (closing) return;
    if (rebuildTimer) clearTimeout(rebuildTimer);
    rebuildTimer = setTimeout(() => void rebuild(), 40);
  };
  const syncPackageWatchers = (project: ProjectResult, npmPackages: readonly BrowserNpmPackage[]): void => {
    npmPackageRoots.clear();
    for (const item of npmPackages) npmPackageRoots.add(item.root);
    const roots = new Set([
      ...project.velarPackages.map((item) => item.root),
      ...npmPackages.map((item) => item.root),
    ]);
    for (const [root, watcher] of packageWatchers) {
      if (roots.has(root)) continue;
      watcher.close();
      packageWatchers.delete(root);
    }
    for (const root of roots) {
      if (packageWatchers.has(root)) continue;
      packageWatchers.set(root, watchDirectoryTree(root, (_event, fileName) => {
        if (!fileName) return;
        const name = fileName;
        const declarationChanged = /\.d\.[cm]?ts$/u.test(name);
        if (!/\.(?:vel|[cm]?js|json)$/u.test(name) && !declarationChanged && name !== "package.json") return;
        const path = resolve(root, name);
        dirtyPaths.add(path);
        if (npmPackageRoots.has(root)) staleNpmRoots.add(root);
        dirtyRevision += 1;
        if (name === "package.json" || declarationChanged) forceFullRebuild = true;
        scheduleRebuild();
      }));
    }
  };
  const rebuild = (): Promise<void> => {
    if (compiling) return compiling;
    const previous = forceFullRebuild ? null : snapshot.project;
    const rebuildRevision = dirtyRevision;
    compiling = compileSnapshot(config, previous, dirtyPaths, staleNpmRoots).then((next) => {
      if (!closing) syncPackageWatchers(next.project, next.npmPackages);
      snapshot = next.errors.length > 0 && snapshot.artifacts
        ? { ...snapshot, errors: next.errors, notices: next.notices, compilation: next.project.stats }
        : next;
      if (next.errors.length === 0 && dirtyRevision === rebuildRevision) {
        dirtyPaths.clear();
        staleNpmRoots.clear();
        forceFullRebuild = false;
      }
      revision += 1;
      const update = JSON.stringify({ revision, errors: next.errors, compilation: next.project.stats });
      for (const client of clients) client.write(`event: reload\ndata: ${update}\n\n`);
      process.stdout.write(next.errors.length === 0
        ? `VelarScript app rebuilt in ${next.project.stats.durationMs}ms (${next.project.stats.compiledModules} compiled, ${next.project.stats.reusedModules} reused)\n`
        : `VelarScript app has ${next.errors.length} error${next.errors.length === 1 ? "" : "s"}\n`);
    }).catch((error: unknown) => {
      const message = `VelarScript rebuild failed: ${hostErrorMessage(error)}`;
      snapshot = { ...snapshot, errors: [message] };
      revision += 1;
      const update = JSON.stringify({ revision, errors: snapshot.errors, compilation: snapshot.compilation });
      for (const client of clients) client.write(`event: reload\ndata: ${update}\n\n`);
      process.stderr.write(`${message}\n`);
      process.stdout.write("VelarScript app has 1 error\n");
    }).finally(() => {
      compiling = null;
      if (!closing && dirtyRevision !== rebuildRevision) scheduleRebuild();
    });
    return compiling;
  };

  const server = createServer(async (request, response) => {
    // Before routing: a page that has rebound its own hostname to 127.0.0.1 is
    // otherwise same-origin with this server and can read `/main.js.map`, whose
    // `sourcesContent` is the project's verbatim source.
    const refusal = localRequestRefusal(request.headers);
    if (refusal) {
      send(response, refusal.status, `Refused: ${refusal.message}\n`, "text/plain; charset=utf-8");
      return;
    }
    if (request.method !== "GET" && request.method !== "HEAD") {
      response.setHeader("Allow", "GET, HEAD");
      send(response, 405, "Method not allowed\n", "text/plain; charset=utf-8");
      return;
    }
    let url: URL;
    // The Host header has already been judged above, so the fixed base here only
    // supplies a scheme and authority for path parsing.
    try { url = new URL(request.url ?? "/", "http://127.0.0.1"); }
    catch { send(response, 400, "Bad request path\n", "text/plain; charset=utf-8"); return; }
    let pathname: string;
    // Everything downstream reads a filesystem-shaped path: `publicAsset` and
    // the module routes resolve the pathname literally, so `public/my file.txt`
    // is unreachable until the escape is decoded. `publicAsset` keeps its `..`
    // and `relative()` confinement, which runs after this decoding.
    try { pathname = decodeURIComponent(url.pathname); }
    catch { send(response, 400, "Bad request path\n", "text/plain; charset=utf-8"); return; }
    const routedPath = stripBase(pathname, base);
    if (routedPath === "/__velar/events") {
      if (request.method === "HEAD") { response.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" }).end(); return; }
      if (clients.size >= 64) { send(response, 503, "Too many development event clients\n", "text/plain; charset=utf-8"); return; }
      response.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      });
      response.write("event: ready\ndata: connected\n\n");
      if (snapshot.errors.length > 0 && snapshot.artifacts) {
        response.write(`event: reload\ndata: ${JSON.stringify({ revision, errors: snapshot.errors })}\n\n`);
      }
      clients.add(response);
      request.on("close", () => clients.delete(response));
      return;
    }
    if (routedPath === "/__velar/map") {
      const file = url.searchParams.get("file");
      const line = Number(url.searchParams.get("line"));
      const column = Number(url.searchParams.get("column"));
      const mapped = file && Number.isInteger(line) && Number.isInteger(column)
        ? mapSourcePosition(snapshot.project, stripBase(file, base), line, column)
        : null;
      send(response, mapped ? 200 : 404, JSON.stringify(mapped ?? { error: "Source position was not mapped" }), "application/json; charset=utf-8");
      return;
    }
    if (routedPath === "/__velar/status") {
      send(response, 200, JSON.stringify({
        framework: framework.host.id,
        protocolVersion: framework.host.protocolVersion,
        apiVersion: framework.host.apiVersion,
        revision,
        ready: snapshot.errors.length === 0 && snapshot.artifacts !== null,
        errors: snapshot.errors,
        notices: snapshot.notices,
        compilation: snapshot.compilation,
        packages: snapshot.project.velarPackages.map((item) => item.name).sort(),
      }), "application/json; charset=utf-8");
      return;
    }
    if (routedPath === "/" || routedPath === "/index.html") {
      if (snapshot.errors.length > 0 && !snapshot.artifacts) {
        send(response, 500, framework.host.createErrorDocument({ config: framework.config, errors: snapshot.errors }), "text/html; charset=utf-8");
      } else if (snapshot.artifacts) {
        send(response, 200, snapshot.artifacts.html, "text/html; charset=utf-8");
      } else {
        send(response, 400, framework.host.createErrorDocument({ config: framework.config, errors: ["The framework host did not create an application entry."] }), "text/html; charset=utf-8");
      }
      return;
    }
    if (routedPath === "/styles.css" && snapshot.artifacts) {
      send(response, 200, snapshot.artifacts.css, "text/css; charset=utf-8");
      return;
    }
    const module = moduleOutput(snapshot.project, routedPath, url.searchParams.get("velar"));
    if (module) {
      send(response, 200, module.body, module.contentType);
      return;
    }
    const standard = standardModuleAsset(routedPath, config.extensionConfig, config.compilerExtensions);
    if (standard) {
      send(response, 200, standard, "text/javascript; charset=utf-8");
      return;
    }
    const packageAsset = await npmAsset(snapshot.npmPackages, routedPath);
    if (packageAsset) {
      await sendFile(response, packageAsset, request.method === "HEAD");
      return;
    }
    const asset = await publicAsset(snapshot.project.publicRoot, routedPath);
    if (asset) {
      await sendFile(response, asset, request.method === "HEAD");
      return;
    }
    if (snapshot.artifacts && request.method === "GET" && request.headers.accept?.includes("text/html")) {
      send(response, 200, snapshot.artifacts.html, "text/html; charset=utf-8");
      return;
    }
    send(response, 404, "Not found\n", "text/plain; charset=utf-8");
  });

  syncPackageWatchers(snapshot.project, snapshot.npmPackages);
  const watcher = watchDirectoryTree(config.root, (_event, fileName) => {
    if (!fileName?.endsWith(".vel") && !fileName?.endsWith(".json") && !fileName?.startsWith(relativePublic(config))) return;
    dirtyRevision += 1;
    if (fileName.endsWith(".vel") || fileName.endsWith(".json")) {
      dirtyPaths.add(resolve(config.root, fileName));
    }
    scheduleRebuild();
  }, new Set([config.outDir, resolve(config.root, ".velar")]));
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => resolve());
  });
  // Long-running processes the target's manifest declares, started beside the
  // page and converged when this server closes. The framework host owns them;
  // this server owns only the promise that they do not outlive it.
  const processes = await framework.host.startDevelopmentProcesses?.({ config: framework.config, projectRoot: config.root }) ?? null;
  for (const line of processes?.report ?? []) process.stdout.write(line);
  const url = `http://127.0.0.1:${port}${base}`;
  process.stdout.write(`VelarScript dev server: ${url}\n`);
  if (snapshot.errors.length > 0) process.stdout.write(`${snapshot.errors.join("\n\n")}\n`);

  const close = (): void => {
    closing = true;
    if (rebuildTimer) {
      clearTimeout(rebuildTimer);
      rebuildTimer = null;
    }
    watcher.close();
    for (const packageWatcher of packageWatchers.values()) packageWatcher.close();
    packageWatchers.clear();
    for (const client of clients) client.end();
    server.close();
    server.closeIdleConnections();
    server.closeAllConnections();
  };
  process.once("SIGINT", close);
  process.once("SIGTERM", close);
  await new Promise<void>((resolve) => server.once("close", resolve));
  await processes?.stop();
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
  const project = await compileProject(
    config.entryPath,
    new Map(),
    {
      projectRoot: config.root,
      publicRoot: config.publicDir,
      extensions: config.compilerExtensions,
      extensionConfig: config.extensionConfig,
      framework: config.framework,
    },
    previous,
    changedPaths,
  );
  const npm = await resolveBrowserNpm(project, staleNpmRoots);
  const artifactErrors: string[] = [];
  try {
    assertUniqueEmbeddedModuleOutputs(project.modules.map((module) => ({
      ownerPath: module.relativePath.replace(/\.vel$/u, ".js"),
      embeddedModules: module.result.embeddedModules,
    })));
  } catch (error) {
    artifactErrors.push(hostErrorMessage(error));
  }
  const errors = [
    ...project.failures.map((failure) => `${failure.path}: ${failure.message}`),
    ...project.modules.flatMap((module) => module.result.diagnostics.map((item) => formatDiagnostic(module.result.source, item))),
    ...npm.failures,
    ...artifactErrors,
  ];
  // 开发服务器也走与 check/build/package 相同的入口校验。这样缺少 @main
  // 时显示编译错误页，而不会出现“命令启动成功但浏览器只有空白页”的假成功。
  if (errors.length === 0) {
    try { applicationEntry(project); }
    catch (error) { errors.push(hostErrorMessage(error)); }
  }
  const notices = project.notices.map((notice) => `${notice.path}: ${notice.message}`);
  return {
    project,
    artifacts: errors.length === 0 ? createFrameworkArtifacts(project, true, npm.imports) : null,
    errors,
    npmPackages: npm.packages,
    compilation: project.stats,
    notices,
  };
}

function stripBase(pathname: string, base: string): string {
  if (base === "/") return pathname;
  const prefix = base.slice(0, -1);
  if (pathname === prefix) return "/";
  return pathname.startsWith(base) ? `/${pathname.slice(base.length)}` : pathname;
}

function relativePublic(config: VelarProjectConfig): string {
  const normalized = config.publicDir.slice(config.root.length).replace(/^[/\\]+/u, "").replaceAll("\\", "/");
  return normalized ? `${normalized}/` : "";
}

function send(response: ServerResponse, status: number, body: string | Buffer, contentType: string): void {
  response.writeHead(status, { "Content-Type": contentType, "Cache-Control": "no-store" });
  response.end(body);
}

async function sendFile(
  response: ServerResponse,
  asset: { readonly path: string; readonly sizeBytes: number; readonly contentType: string },
  head: boolean,
): Promise<void> {
  response.writeHead(200, {
    "Content-Type": asset.contentType,
    "Content-Length": String(asset.sizeBytes),
    "Cache-Control": "no-store",
  });
  if (head) { response.end(); return; }
  try { await pipeline(createReadStream(asset.path), response); }
  catch (error) { if (!response.destroyed) response.destroy(asHostError(error)); }
}

interface SourceMapShape {
  readonly sources: readonly string[];
  readonly mappings: string;
}

function mapSourcePosition(
  project: ProjectResult,
  pathname: string,
  generatedLine: number,
  generatedColumn: number,
): { readonly path: string; readonly line: number; readonly column: number } | null {
  const route = pathname.replace(/^\/+/, "");
  const normalized = route.replace(/\.js$/u, ".vel");
  let module = project.modules.find((item) => item.relativePath.replaceAll("\\", "/") === normalized);
  let sourceMap = module?.result.sourceMap ?? null;
  if (!module) {
    for (const candidate of project.modules) {
      const directory = posix.dirname(candidate.relativePath.replaceAll("\\", "/"));
      const embedded = candidate.result.embeddedModules.find((item) =>
        posix.normalize(posix.join(directory, item.specifier)) === route);
      if (!embedded) continue;
      module = candidate;
      sourceMap = embedded.sourceMap;
      break;
    }
  }
  if (!module || !sourceMap || generatedLine < 1 || generatedColumn < 1) return null;
  let map: SourceMapShape;
  try {
    map = JSON.parse(sourceMap) as SourceMapShape;
  } catch {
    return null;
  }
  let previousSource = 0;
  let previousOriginalLine = 0;
  let previousOriginalColumn = 0;
  const lines = map.mappings.split(";");
  for (let lineIndex = 0; lineIndex < Math.min(generatedLine, lines.length); lineIndex += 1) {
    let generated = 0;
    let selected: { source: number; line: number; column: number } | null = null;
    for (const encoded of lines[lineIndex]!.split(",").filter(Boolean)) {
      const values = decodeVlqSegment(encoded);
      if (values.length < 4) continue;
      generated += values[0]!;
      previousSource += values[1]!;
      previousOriginalLine += values[2]!;
      previousOriginalColumn += values[3]!;
      if (lineIndex === generatedLine - 1 && generated <= generatedColumn - 1) {
        selected = { source: previousSource, line: previousOriginalLine + 1, column: previousOriginalColumn + 1 };
      }
    }
    if (lineIndex === generatedLine - 1 && selected) {
      const mappedSource = map.sources[selected.source] ?? module.inputPath;
      const source = mappedSource.startsWith("file:") ? fileURLToPath(mappedSource) : mappedSource;
      const path = relativePath(project.projectRoot, source);
      return { path, line: selected.line, column: selected.column };
    }
  }
  return null;
}

function decodeVlqSegment(value: string): number[] {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  const output: number[] = [];
  let current = 0;
  let shift = 0;
  for (const character of value) {
    const digit = alphabet.indexOf(character);
    if (digit < 0) return [];
    current += (digit & 31) << shift;
    if (digit & 32) {
      shift += 5;
      continue;
    }
    const negative = (current & 1) === 1;
    output.push((negative ? -1 : 1) * (current >> 1));
    current = 0;
    shift = 0;
  }
  return output;
}

function relativePath(root: string, path: string): string {
  const normalized = path.startsWith(root) ? path.slice(root.length).replace(/^[/\\]+/u, "") : path;
  return normalized.replaceAll("\\", "/");
}
