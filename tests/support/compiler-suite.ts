import assert from "node:assert/strict";
import { mkdir, symlink, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { applyMechanicalFixes, compile as compileCore, describeType, formatDiagnostic, formatSource, inspectModule as inspectCoreModule, MAX_VELAR_SOURCE_CODE_UNITS, semanticVisibleSymbolsAt, SourceText, type CompilerExtension } from "@velarscript/compiler";
import { keywordKinds } from "../../packages/compiler/src/token.ts";
import { compileProject as compileProjectCore, moduleInterfaceIdentity, type CompileProjectOptions, type ProjectResult } from "../../packages/cli/src/project.ts";
import { standardModuleApi as standardModuleApiCore, standardModuleAsset as standardModuleAssetCore, standardModuleClosure, standardModuleDependencies, standardModuleInterface as standardModuleInterfaceCore, standardModuleSource as standardModuleSourceCore } from "../../packages/cli/src/standard-modules.ts";
import { velarCompilerExtension, webModuleInterfaces, webModuleSource, webModuleSources } from "../../packages/web/src/compiler.ts";
import { executeModule } from "./execute-module.ts";

/**
 * D115 §一.6 — the shared setup `tests/compiler.test.ts` carried at its top.
 *
 * The file split into 78 subject files; these twenty-two declarations were the one
 * thing every one of them needed, so they live here once instead of being
 * copied into each. Nothing below changed: the bodies are the bodies that file
 * had, with `export` in front of them.
 */
export const webCompilerExtensions = Object.freeze([velarCompilerExtension]);

export const webFormatOptions = Object.freeze({ extensions: webCompilerExtensions });

// `velar/realtime` normally enters a built application together with its
// declared `velar/websocket` dependency. EventSource-only unit tests execute
// one module body directly, so replace that import with an inert boundary; the
// dedicated realtime-client tests exercise the real dependency separately.
export function standaloneRealtimeSource(): string {
  return (standardModuleSource("velar/realtime") ?? "").replace(
    /^import \{[^\n]+\} from "velar\/websocket";$/mu,
    'const __velarRealtimeConnection = {parse(value) { return value; }};\nconst __velarRealtimeConnect = async () => { throw new Error("WebSocket test boundary is unavailable"); };',
  );
}

export function runNpmSync(arguments_: readonly string[], cwd: string): ReturnType<typeof spawnSync> {
  const npmEntry = process.env.npm_execpath;
  return npmEntry
    ? spawnSync(process.execPath, [npmEntry, ...arguments_], { cwd, encoding: "utf8", timeout: 300_000 })
    : spawnSync(process.platform === "win32" ? "npm.cmd" : "npm", arguments_, { cwd, encoding: "utf8", timeout: 300_000 });
}

// D30 item 16: an extension's contextual keywords are ordinary names, so a
// signature may use them; only hard-reserved and forbidden spellings are
// unwritable at a call site.
export const unavailableOfficialParameterNames = new Set([
  ...Object.keys(keywordKinds),
  ...Object.keys(velarCompilerExtension.lexical?.forbiddenIdentifiers ?? {}),
]);

export function compile(text: string, options: Parameters<typeof compileCore>[1] = {}) {
  const imports = new Map(options.analysis?.imports);
  const lookExports = webModuleInterfaces.get("velar/look")?.exports;
  for (const match of text.matchAll(/import\s*\{([^}]*)\}\s*from\s*"velar\/look"/gu)) {
    for (const raw of match[1]!.split(",")) {
      const [imported, local = imported] = raw.trim().split(/\s+as\s+/u);
      if (!imported) continue;
      const type = lookExports?.get(imported);
      if (type) imports.set(local!, type);
    }
  }
  return compileCore(text, {
    ...options,
    analysis: { ...options.analysis, imports },
    extensions: options.extensions ?? webCompilerExtensions,
  });
}

export function inspectModule(text: string, options: Parameters<typeof inspectCoreModule>[1] = {}) {
  return inspectCoreModule(text, { ...options, extensions: options.extensions ?? webCompilerExtensions });
}

export function compileProject(
  entry: string,
  overrides: ReadonlyMap<string, string> = new Map(),
  options: CompileProjectOptions = {},
  previous: ProjectResult | null = null,
  changedPaths: ReadonlySet<string> = new Set(),
) {
  return compileProjectCore(entry, overrides, { ...options, extensions: options.extensions ?? webCompilerExtensions }, previous, changedPaths);
}

export function standardModuleApi() {
  return standardModuleApiCore(webCompilerExtensions);
}

export function standardModuleInterface(source: string) {
  return standardModuleInterfaceCore(source, webCompilerExtensions);
}

export function standardModuleSource(source: string, web: { readonly base: string; readonly publicConfig?: Readonly<Record<string, unknown>> } = { base: "/" }) {
  return standardModuleSourceCore(source, web, webCompilerExtensions);
}

/**
 * D114 S3: the collection functions `velar/collections` published are
 * compiler-owned List members now, so their runtime is proved by emitting it.
 * A standalone compile inlines the whole collection lowering runtime, and
 * `executeModule` appends JavaScript to that same module scope, so every
 * `__velarList*` helper is reachable there by name.
 */
export function emittedCollectionRuntime(): string {
  const emitted = compileCore(`
export def total(values: List<number>) -> number:
    return values.sum()
`.trimStart());
  assert.deepEqual(emitted.diagnostics, []);
  return emitted.code ?? "";
}

/**
 * A standard module with its hidden runtime dependencies linked as data URLs,
 * so the source can be executed inline. velar/test reaches for the Core
 * comparison rather than restating it (D50 rule 97.2), so inlining it now
 * means linking that edge.
 */
export function linkedStandardModuleSource(name: string): string {
  const urls = new Map<string, string>();
  const closure = [...standardModuleClosure([name])].reverse();
  for (const member of closure) {
    let source = standardModuleSource(member)!;
    for (const [linked, url] of urls) source = source.replaceAll(JSON.stringify(linked), JSON.stringify(url));
    urls.set(member, `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`);
  }
  let source = standardModuleSource(name)!;
  for (const [linked, url] of urls) {
    if (linked === name) continue;
    source = source.replaceAll(JSON.stringify(linked), JSON.stringify(url));
  }
  return source;
}

export function executeWithLookModule(code: string): ReturnType<typeof spawnSync> {
  const source = webModuleSources.get("velar/look");
  assert.ok(source);
  const url = `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;
  return executeModule(code.replaceAll('"velar/look"', JSON.stringify(url)));
}

export function assertDevServerExit(exitCode: number | null, stderr: string): void {
  assert.ok(exitCode === 0 || (process.platform === "win32" && exitCode === null), stderr || `Unexpected dev-server exit code ${String(exitCode)}`);
}

export async function stopDevServer(child: ReturnType<typeof spawn>): Promise<void> {
  // A signal-terminated ChildProcess keeps exitCode null. Windows reaps the
  // server with SIGKILL because it has no POSIX SIGTERM lifecycle, so the
  // after-hook must recognize signalCode as an already observed exit too.
  if (child.exitCode !== null || child.signalCode !== null) return;
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("Dev server did not stop"));
    }, 2_000);
    child.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
    // Windows has no POSIX SIGTERM lifecycle. Its CI contract is that the
    // spawned server can be reaped, while graceful signal drainage remains
    // covered on the two POSIX runners.
    child.kill(process.platform === "win32" ? "SIGKILL" : "SIGTERM");
  });
}

export const WATCHED_CHANGE_RETRIGGER_MS = 250;

export const WATCHED_CHANGE_TIMEOUT_MS = 30_000;

/**
 * Writes a change the dev server can only learn about from the operating
 * system, re-writing it until the server reacts. `fs.watch` with
 * `recursive: true` arms its macOS FSEvents stream asynchronously on another
 * thread, and the dev server prints its banner without waiting for that, so a
 * single write can land before the stream starts and is then never reported at
 * all. Only the first change on a given watched root needs this: once one
 * notification has been delivered the stream is armed for the rest of the run.
 */
export async function reportedChange(path: string, contents: string, reacted: () => boolean, label: string): Promise<void> {
  const deadline = Date.now() + WATCHED_CHANGE_TIMEOUT_MS;
  for (;;) {
    await writeFile(path, contents, "utf8");
    const retriggerAt = Date.now() + WATCHED_CHANGE_RETRIGGER_MS;
    while (!reacted() && Date.now() < retriggerAt) await new Promise((resolveWait) => setTimeout(resolveWait, 10));
    if (reacted()) return;
    if (Date.now() >= deadline) {
      throw new Error(`${label} never reported ${path} within ${WATCHED_CHANGE_TIMEOUT_MS} milliseconds of repeated changes; the operating-system watch is not delivering notifications for this root.`);
    }
  }
}

export async function linkWorkspaceWebExtension(projectRoot: string): Promise<void> {
  const scope = join(projectRoot, "node_modules", "@velarscript");
  await mkdir(scope, { recursive: true });
  await symlink(resolve("packages/web"), join(scope, "web"), "dir");
}

export async function linkWorkspaceNodeExtension(projectRoot: string): Promise<void> {
  const scope = join(projectRoot, "node_modules", "@velarscript");
  await mkdir(scope, { recursive: true });
  await symlink(resolve("packages/node"), join(scope, "node"), "dir");
}

export async function linkWorkspaceDesktopExtension(projectRoot: string): Promise<void> {
  const scope = join(projectRoot, "node_modules", "@velarscript");
  await mkdir(scope, { recursive: true });
  await symlink(resolve("packages/desktop"), join(scope, "desktop"), "dir");
}
