import { createReadStream, readdirSync, statSync, watch } from "node:fs";
import { createServer, type ServerResponse } from "node:http";
import { resolve } from "node:path";
import { pipeline } from "node:stream/promises";
import { formatDiagnostic } from "@velarscript/compiler";
import type { FrameworkHostArtifacts } from "@velarscript/compiler/framework-host";
import { compileProject, type ProjectResult } from "./project.ts";
import { createFrameworkArtifacts, frameworkBase } from "./framework-host.ts";
import { moduleOutput, publicAsset } from "./module-assets.ts";
import { npmAsset, resolveBrowserNpm, type BrowserNpmPackage } from "./npm.ts";
import type { VelarProjectConfig } from "./config.ts";
import { standardModuleAsset } from "./standard-modules.ts";

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

export async function runDevServer(config: VelarProjectConfig, port: number): Promise<void> {
  if (!config.framework) throw new Error("The project does not declare an application framework host");
  const framework = config.framework;
  const base = frameworkBase(framework);
  let snapshot = await compileSnapshot(config);
  let compiling: Promise<void> | null = null;
  let revision = 0;
  let rebuildTimer: ReturnType<typeof setTimeout> | null = null;
  let forceFullRebuild = false;
  let dirtyRevision = 0;
  const dirtyPaths = new Set<string>();
  const clients = new Set<ServerResponse>();
  const packageWatchers = new Map<string, DirectoryTreeWatcher>();
  const scheduleRebuild = (): void => {
    if (rebuildTimer) clearTimeout(rebuildTimer);
    rebuildTimer = setTimeout(() => void rebuild(), 40);
  };
  const syncPackageWatchers = (project: ProjectResult, npmPackages: readonly BrowserNpmPackage[]): void => {
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
        if (!/\.(?:vel|[cm]?js)$/u.test(name) && !declarationChanged && name !== "package.json") return;
        const path = resolve(root, name);
        dirtyPaths.add(path);
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
    compiling = compileSnapshot(config, previous, dirtyPaths).then((next) => {
      syncPackageWatchers(next.project, next.npmPackages);
      snapshot = next.errors.length > 0 && snapshot.artifacts
        ? { ...snapshot, errors: next.errors, notices: next.notices, compilation: next.project.stats }
        : next;
      if (next.errors.length === 0 && dirtyRevision === rebuildRevision) {
        dirtyPaths.clear();
        forceFullRebuild = false;
      }
      revision += 1;
      const update = JSON.stringify({ revision, errors: next.errors, compilation: next.project.stats });
      for (const client of clients) client.write(`event: reload\ndata: ${update}\n\n`);
      process.stdout.write(next.errors.length === 0
        ? `VelarScript app rebuilt in ${next.project.stats.durationMs}ms (${next.project.stats.compiledModules} compiled, ${next.project.stats.reusedModules} reused)\n`
        : `VelarScript app has ${next.errors.length} error${next.errors.length === 1 ? "" : "s"}\n`);
    }).catch((error: unknown) => {
      const message = `VelarScript rebuild failed: ${error instanceof Error ? error.message : String(error)}`;
      snapshot = { ...snapshot, errors: [message] };
      revision += 1;
      const update = JSON.stringify({ revision, errors: snapshot.errors, compilation: snapshot.compilation });
      for (const client of clients) client.write(`event: reload\ndata: ${update}\n\n`);
      process.stderr.write(`${message}\n`);
      process.stdout.write("VelarScript app has 1 error\n");
    }).finally(() => {
      compiling = null;
      if (dirtyRevision !== rebuildRevision) scheduleRebuild();
    });
    return compiling;
  };

  const server = createServer(async (request, response) => {
    if (request.method !== "GET" && request.method !== "HEAD") {
      response.setHeader("Allow", "GET, HEAD");
      send(response, 405, "Method not allowed\n", "text/plain; charset=utf-8");
      return;
    }
    let url: URL;
    try { url = new URL(request.url ?? "/", "http://127.0.0.1"); }
    catch { send(response, 400, "Bad request path\n", "text/plain; charset=utf-8"); return; }
    const pathname = url.pathname;
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
    if (!fileName?.endsWith(".vel") && !fileName?.startsWith(relativePublic(config))) return;
    dirtyRevision += 1;
    if (fileName.endsWith(".vel")) {
      dirtyPaths.add(resolve(config.root, fileName));
    }
    scheduleRebuild();
  }, new Set([config.outDir]));
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => resolve());
  });
  const url = `http://127.0.0.1:${port}${base}`;
  process.stdout.write(`VelarScript dev server: ${url}\n`);
  if (snapshot.errors.length > 0) process.stdout.write(`${snapshot.errors.join("\n\n")}\n`);

  const close = (): void => {
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
}

function watchDirectoryTree(
  root: string,
  listener: (event: string, fileName: string | null) => void,
  excludedDirectories: ReadonlySet<string> = new Set(),
): DirectoryTreeWatcher {
  if (process.platform !== "win32") {
    return watch(root, { recursive: true }, (event, fileName) => listener(event, fileName === null ? null : String(fileName)));
  }

  let snapshot = snapshotDirectoryTree(root, excludedDirectories);
  const timer = setInterval(() => {
    const next = snapshotDirectoryTree(root, excludedDirectories);
    for (const [path, signature] of next) {
      if (snapshot.get(path) !== signature) listener(snapshot.has(path) ? "change" : "rename", path);
    }
    for (const path of snapshot.keys()) {
      if (!next.has(path)) listener("rename", path);
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
        if (entry.name !== "node_modules" && entry.name !== ".git" && !excludedDirectories.has(absolute)) {
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
  const npm = await resolveBrowserNpm(project);
  const errors = [
    ...project.failures.map((failure) => `${failure.path}: ${failure.message}`),
    ...project.modules.flatMap((module) => module.result.diagnostics.map((item) => formatDiagnostic(module.result.source, item))),
    ...npm.failures,
  ];
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
  catch (error) { if (!response.destroyed) response.destroy(error instanceof Error ? error : new Error(String(error))); }
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
  const normalized = pathname.replace(/^\/+/, "").replace(/\.js$/u, ".vel");
  const module = project.modules.find((item) => item.relativePath.replaceAll("\\", "/") === normalized);
  if (!module?.result.sourceMap || generatedLine < 1 || generatedColumn < 1) return null;
  let map: SourceMapShape;
  try {
    map = JSON.parse(module.result.sourceMap) as SourceMapShape;
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
      const source = map.sources[selected.source] ?? module.inputPath;
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
