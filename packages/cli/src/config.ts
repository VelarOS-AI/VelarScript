import { createHash } from "node:crypto";
import { lstat, readFile, stat, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, extname, isAbsolute, join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { VELAR_CORE_API_VERSION, type CompilerExtension } from "@velarscript/compiler";
import {
  VELAR_FRAMEWORK_HOST_PROTOCOL_VERSION,
  type FrameworkHostExtension,
} from "@velarscript/compiler/framework-host";
import { standardModuleInterfaces, standardModuleSources } from "@velarscript/core";
import { hostErrorCode, hostErrorMessage, isHostErrorCode } from "./host-error.ts";
import {
  OFFICIAL_WEB_EXTENSION_PACKAGE,
  isToolchainExtensionPackage,
  resolveExtensionPackages,
  surfaceOfExtensionPackage,
  validateLoadedExtension,
  type ResolvedExtensionPackage,
} from "./extension-metadata.ts";
import {
  CORE_WORKER_CONFIG_KEY,
  CORE_PROJECT_MANIFEST_FIELDS,
  CURRENT_PROJECT_FORMAT_VERSION,
  unsupportedProjectFormat,
} from "./project-format.ts";
import { bundledExtension } from "./bundled-extension-registry.ts";
import type { JavaScriptBuildMode } from "./javascript-output.ts";

export { CURRENT_PROJECT_FORMAT_VERSION } from "./project-format.ts";

// BLD-U1: configuration diagnostics teach one complete, valid manifest —
// including the web extension's package identity, which is the part authors
// cannot guess — instead of only naming the missing field.
const MINIMAL_MANIFEST_EXAMPLE = [
  "a minimal web-project velar.json is:",
  "{",
  `  "formatVersion": ${CURRENT_PROJECT_FORMAT_VERSION},`,
  "  \"kind\": \"application\",",
  "  \"entry\": \"src/main.vel\",",
  `  "extensions": [${JSON.stringify(OFFICIAL_WEB_EXTENSION_PACKAGE)}]`,
  "}",
  "(drop \"extensions\" for a Node/CLI project)",
].join("\n");

export interface ResolvedFrameworkHost {
  readonly host: FrameworkHostExtension;
  readonly config: unknown;
}

export type VelarProjectKind = "application" | "library";

export interface VelarProjectConfig {
  readonly formatVersion: number;
  /** 应用入口由宿主执行 @main；库入口只发布声明和导出。 */
  readonly kind: VelarProjectKind;
  readonly root: string;
  readonly manifestPath: string | null;
  readonly manifestIdentity: string | null;
  readonly entryPath: string;
  readonly outDir: string;
  readonly publicDir: string;
  readonly build: {
    /** 默认是可直接部署的生产产物；可读模式必须由项目或命令显式选择。 */
    readonly mode: JavaScriptBuildMode;
    /**
     * 是否为正式构建保留 Source Map。它是独立开关，不由 JavaScript 的
     * production/readable 表达形式推导；开发服务器仍始终使用自己的映射。
     */
    readonly sourceMaps: boolean;
  };
  readonly extensions: readonly string[];
  readonly extensionGraph: readonly ResolvedExtensionPackage[];
  readonly compilerExtensions: readonly CompilerExtension[];
  readonly extensionConfig: ReadonlyMap<string, unknown>;
  readonly framework: ResolvedFrameworkHost | null;
  readonly workerEntries: ReadonlyMap<string, string>;
}

interface ProjectExtension {
  readonly id: string;
  readonly manifestKey: string;
  readonly parse: (value: unknown, manifestPath: string) => unknown;
  /**
   * D38 §48 for manifests: the mechanical rewrite `velar fix` applies when this
   * extension retires a manifest shape. It receives the manifest's whole text
   * and returns the migrated text, or null when nothing needs migrating. The
   * extension that owns the shape owns the rewrite, exactly as it owns `parse`,
   * so the check-time error and the fix are one migration.
   */
  readonly migrate?: (manifestText: string, manifestPath: string) => string | null;
}

interface LoadedExtensions {
  readonly packages: readonly ResolvedExtensionPackage[];
  readonly compiler: readonly CompilerExtension[];
  readonly project: readonly ProjectExtension[];
  readonly hosts: readonly FrameworkHostExtension[];
}

interface ManifestShape {
  readonly formatVersion?: unknown;
  readonly kind?: unknown;
  readonly entry?: unknown;
  readonly outDir?: unknown;
  readonly publicDir?: unknown;
  readonly build?: unknown;
  readonly extensions?: unknown;
  readonly workers?: unknown;
  readonly surfaces?: unknown;
}

export async function resolveVelarProject(input: string | null, cwd = process.cwd()): Promise<VelarProjectConfig> {
  const explicit = input ? resolve(cwd, input) : null;
  const kind = explicit ? await pathKind(explicit) : null;
  if (explicit && kind === "missing") throw new Error(`'${input}' does not exist`);

  if (explicit && (kind === "file") && extname(explicit) === ".vel") {
    const manifestPath = await findManifest(dirname(explicit));
    return manifestPath ? loadManifest(manifestPath, explicit) : standaloneProject(explicit);
  }

  const manifestPath = explicit
    ? kind === "directory" ? join(explicit, "velar.json") : explicit
    : await findManifest(resolve(cwd));
  if (!manifestPath || !await ordinaryManifestFile(manifestPath)) {
    throw new Error(input
      ? `'${input}' is neither a .vel file nor a directory containing velar.json; ${MINIMAL_MANIFEST_EXAMPLE}`
      : `velar.json was not found; run this command in a VelarScript project or pass an entry .vel file — ${MINIMAL_MANIFEST_EXAMPLE}`);
  }
  return loadManifest(manifestPath);
}

export async function resolveVelarProjectForDocument(path: string): Promise<VelarProjectConfig> {
  const documentPath = resolve(path);
  const manifestPath = await findManifest(dirname(documentPath));
  return manifestPath ? loadManifest(manifestPath) : standaloneProject(documentPath);
}

export interface ProjectManifestMigration {
  readonly manifestPath: string;
  /**
   * What each extension rewrote, in application order, without the manifest
   * path: the command that prints them owns how a path is displayed.
   */
  readonly changes: readonly string[];
}

/**
 * The manifest half of `velar fix`. A retired manifest shape cannot be
 * migrated by the source fixer, because the manifest is what fails first:
 * `resolveVelarProject` refuses to parse it, so nothing downstream ever runs.
 * This locates the manifest, loads the extensions it names, and lets each
 * extension that owns a manifest key rewrite its own retired shape before the
 * project is resolved at all.
 *
 * A project with no manifest — a bare `.vel` entry — has nothing to migrate and
 * answers null rather than failing.
 */
export async function migrateVelarProjectManifest(input: string | null, cwd = process.cwd()): Promise<ProjectManifestMigration | null> {
  const explicit = input ? resolve(cwd, input) : null;
  const kind = explicit ? await pathKind(explicit) : null;
  const manifestPath = explicit
    ? kind === "file" && extname(explicit) === ".vel" ? await findManifest(dirname(explicit))
      : kind === "directory" ? join(explicit, "velar.json") : explicit
    : await findManifest(resolve(cwd));
  if (!manifestPath || !await ordinaryManifestFile(manifestPath)) return null;
  const metadata = await lstat(manifestPath);
  if (metadata.size > 1024 * 1024) throw new RangeError(`Cannot read ${manifestPath}: project manifest exceeds 1 MiB`);
  const original = await readFile(manifestPath, "utf8");
  let manifest: ManifestShape;
  try { manifest = JSON.parse(original) as ManifestShape; }
  catch (error) { throw new Error(`Cannot read ${manifestPath}: ${hostErrorMessage(error)}`); }
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) return null;
  const extensions = await loadExtensions(dirname(manifestPath), extensionList(manifest.extensions, manifestPath), manifestPath);
  const changes: string[] = [];
  let text = original;
  for (const extension of extensions.project) {
    if (!extension.migrate) continue;
    const migrated = extension.migrate(text, manifestPath);
    if (migrated === null || migrated === text) continue;
    text = migrated;
    changes.push(`migrated the '${extension.manifestKey}' manifest section to the shape ${extension.id} publishes today`);
  }
  if (changes.length === 0) return { manifestPath, changes: Object.freeze([]) };
  // The rewrite was computed from the text read above, so a save that landed
  // since then is not in it; the manifest is left untouched and the conflict is
  // reported rather than silently reverting the author's edit.
  if (await readFile(manifestPath, "utf8") !== original) {
    throw new Error(`${manifestPath}: the manifest changed on disk during this fix pass; nothing was written`);
  }
  await writeFile(manifestPath, text, "utf8");
  return { manifestPath, changes: Object.freeze(changes) };
}

async function loadManifest(manifestPath: string, entryOverride: string | null = null): Promise<VelarProjectConfig> {
  let manifest: ManifestShape;
  let manifestIdentity: string;
  try {
    if (!await ordinaryManifestFile(manifestPath)) throw new Error("project manifest does not exist");
    const metadata = await lstat(manifestPath);
    if (metadata.size > 1024 * 1024) throw new RangeError("project manifest exceeds 1 MiB");
    const source = await readFile(manifestPath, "utf8");
    if (Buffer.byteLength(source, "utf8") > 1024 * 1024) throw new RangeError("project manifest exceeds 1 MiB");
    manifestIdentity = createHash("sha256").update(source).digest("hex");
    manifest = JSON.parse(source) as ManifestShape;
  } catch (error) {
    throw new Error(`Cannot read ${manifestPath}: ${hostErrorMessage(error)}`);
  }
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) throw new Error(`${manifestPath} must contain a JSON object`);
  if (manifest.formatVersion === undefined) throw new Error(`${manifestPath}: 'formatVersion' is required; this compiler does not load legacy project formats — ${MINIMAL_MANIFEST_EXAMPLE}`);
  const formatVersion = integerField(manifest.formatVersion, "formatVersion");
  if (formatVersion !== CURRENT_PROJECT_FORMAT_VERSION) {
    throw new Error(`${manifestPath}: ${unsupportedProjectFormat(formatVersion)} — ${MINIMAL_MANIFEST_EXAMPLE}`);
  }
  const projectKind = projectKindField(manifest.kind, manifestPath);
  const root = dirname(manifestPath);
  const entry = entryOverride ?? resolveProjectPath(root, stringField(manifest.entry, "entry", "src/main.vel"), "entry");
  if (extname(entry) !== ".vel") throw new Error(`${manifestPath}: 'entry' must point to a .vel file`);
  const outDir = resolveProjectPath(root, stringField(manifest.outDir, "outDir", "dist"), "outDir");
  const publicDir = resolveProjectPath(root, stringField(manifest.publicDir, "publicDir", "public"), "publicDir");
  const build = buildConfig(manifest.build, manifestPath);
  const workerEntries = workerEntryMap(manifest.workers, root, manifestPath);
  const extensions = extensionList(manifest.extensions, manifestPath);
  const loadedExtensions = await loadExtensions(root, extensions, manifestPath);
  knownFields(
    manifest as Record<string, unknown>,
    new Set([...CORE_PROJECT_MANIFEST_FIELDS, ...loadedExtensions.project.map((extension) => extension.manifestKey)]),
    "project",
    manifestPath,
  );
  assertDeclaredSurfaces(manifest.surfaces, installedSurfaces(loadedExtensions.packages), manifestPath);
  const extensionConfig = new Map<string, unknown>(loadedExtensions.project.map((extension) => [
    extension.id,
    extension.parse((manifest as Record<string, unknown>)[extension.manifestKey], manifestPath),
  ]));
  for (const [name, path] of workerEntries) {
    const fromSourceRoot = relative(dirname(entry), path);
    if (fromSourceRoot === ".." || fromSourceRoot.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) || isAbsolute(fromSourceRoot)) {
      throw new Error(`${manifestPath}: 'workers.${name}' must stay inside the entry source directory ${dirname(entry)}`);
    }
  }
  extensionConfig.set(CORE_WORKER_CONFIG_KEY, Object.freeze(Object.fromEntries([...workerEntries].map(([name, path]) => [
    name,
    relative(dirname(entry), path).replaceAll("\\", "/").replace(/\.vel$/u, ".js"),
  ]))));
  const framework = resolveFrameworkHost(loadedExtensions, extensionConfig, projectKind, manifestPath);
  assertProjectPaths(root, entry, outDir, publicDir, manifestPath);
  for (const workerEntry of workerEntries.values()) assertProjectPaths(root, workerEntry, outDir, publicDir, manifestPath);
  return {
    formatVersion,
    kind: projectKind,
    root,
    manifestPath,
    manifestIdentity,
    entryPath: entry,
    outDir,
    publicDir,
    build,
    extensions,
    extensionGraph: loadedExtensions.packages,
    compilerExtensions: loadedExtensions.compiler,
    extensionConfig,
    framework,
    workerEntries,
  };
}

function standaloneProject(entryPath: string): VelarProjectConfig {
  const root = dirname(entryPath);
  return {
    formatVersion: CURRENT_PROJECT_FORMAT_VERSION,
    kind: "application",
    root,
    manifestPath: null,
    manifestIdentity: null,
    entryPath,
    outDir: join(root, "dist"),
    publicDir: join(root, "public"),
    build: { mode: "production", sourceMaps: false },
    extensions: [],
    extensionGraph: [],
    compilerExtensions: [],
    extensionConfig: new Map(),
    framework: null,
    workerEntries: new Map(),
  };
}

function buildConfig(value: unknown, manifestPath: string): VelarProjectConfig["build"] {
  if (value !== undefined && (!value || typeof value !== "object" || Array.isArray(value))) {
    throw new Error(`${manifestPath}: 'build' must be an object`);
  }
  const build = value as { readonly mode?: unknown; readonly sourceMaps?: unknown } | undefined;
  if (build) knownFields(build as Record<string, unknown>, new Set(["mode", "sourceMaps"]), "build", manifestPath);
  const mode = build?.mode ?? "production";
  if (mode !== "production" && mode !== "readable") {
    throw new Error(`${manifestPath}: 'build.mode' must be 'production' or 'readable'`);
  }
  const sourceMaps = build?.sourceMaps ?? false;
  if (typeof sourceMaps !== "boolean") {
    throw new Error(`${manifestPath}: 'build.sourceMaps' must be a boolean`);
  }
  return Object.freeze({ mode, sourceMaps });
}

function workerEntryMap(value: unknown, root: string, manifestPath: string): ReadonlyMap<string, string> {
  if (value === undefined) return new Map();
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${manifestPath}: 'workers' must be an object mapping logical names to relative .vel entry paths`);
  }
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length > 32) throw new Error(`${manifestPath}: 'workers' cannot declare more than 32 entries`);
  const workers = new Map<string, string>();
  for (const [name, candidate] of entries) {
    if (!/^[a-z][a-z0-9_-]{0,63}$/u.test(name)) throw new Error(`${manifestPath}: worker names must start with a lowercase letter and contain only lowercase letters, digits, '_' or '-'`);
    const path = resolveProjectPath(root, stringField(candidate, `workers.${name}`, ""), `workers.${name}`);
    if (extname(path) !== ".vel") throw new Error(`${manifestPath}: 'workers.${name}' must point to a .vel file`);
    workers.set(name, path);
  }
  return workers;
}

/**
 * The surface versions this project actually has installed (D110 rule 1):
 * `core`, which every project is written in, plus one per activated official
 * target extension.
 *
 * The extensions' numbers are read from the packages that are really installed
 * for *this* project, not from the ones this CLI was built against, because
 * "the installed value" is the whole subject of the check below —
 * `resolveExtensionPackages` already resolves a project's own copy ahead of the
 * toolchain's.
 */
function installedSurfaces(packages: readonly ResolvedExtensionPackage[]): ReadonlyMap<string, string> {
  const surfaces = new Map<string, string>([["core", VELAR_CORE_API_VERSION]]);
  for (const package_ of packages) {
    const surface = surfaceOfExtensionPackage(package_.name);
    if (surface !== null) surfaces.set(surface, package_.apiVersion);
  }
  return surfaces;
}

/** The complete `surfaces` block for a project, as an author would write it. */
function surfacesExample(installed: ReadonlyMap<string, string>): string {
  const lines = [...installed].map(([surface, version]) => `    ${JSON.stringify(surface)}: ${JSON.stringify(version)}`);
  return [`  "surfaces": {`, lines.join(",\n"), "  }"].join("\n");
}

/**
 * D110 rule 5 — what a project says it was written against, checked against
 * what it has.
 *
 * The key is optional; declaring nothing keeps every manifest written before
 * this ruling loading unchanged. But a declaration that is *present* has to be
 * complete — `core` plus each activated surface, no more and no fewer — because
 * a partial one is a typo rather than a setting, and because the value of the
 * whole mechanism is that a surface you never named cannot drift past you in
 * silence.
 *
 * A mismatch is an error rather than a warning, and that is the point of the
 * ruling: VelarScript promises no backwards compatibility, so the one thing an
 * upgrade owes an author is *which* surface moved. A refusal here makes the
 * re-read mandatory instead of conscientious.
 */
function assertDeclaredSurfaces(value: unknown, installed: ReadonlyMap<string, string>, manifestPath: string): void {
  if (value === undefined) return;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${manifestPath}: 'surfaces' must be an object mapping each surface this project activates to the version it was written against —\n${surfacesExample(installed)}`);
  }
  const declared = new Map(Object.entries(value as Record<string, unknown>));
  const missing = [...installed.keys()].filter((surface) => !declared.has(surface));
  const extra = [...declared.keys()].filter((surface) => !installed.has(surface));
  if (missing.length > 0 || extra.length > 0) {
    const wrong = [
      missing.length > 0 ? `does not name ${missing.join(", ")}` : "",
      extra.length > 0 ? `names ${extra.join(", ")}, which this project does not activate` : "",
    ].filter((part) => part !== "").join(", and ");
    throw new Error(`${manifestPath}: 'surfaces' ${wrong}. A declaration is complete or absent; a partial one is a typo, not a setting. This project activates ${[...installed.keys()].join(", ")}, so its complete declaration is —\n${surfacesExample(installed)}\n(remove the key entirely to declare nothing)`);
  }
  for (const [surface, version] of installed) {
    const written = declared.get(surface);
    if (typeof written !== "string" || !/^(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)$/u.test(written)) {
      throw new Error(`${manifestPath}: 'surfaces.${surface}' must be a 'major.minor' surface version written as a string; the installed one is ${JSON.stringify(version)}`);
    }
    if (written === version) continue;
    const section = `${surface[0]!.toUpperCase()}${surface.slice(1)}`;
    throw new Error(`${manifestPath}: this project is written against ${surface}@${written}, but ${surface}@${version} is installed. The ${section} surface changed, so the code that uses it has to be re-read: work through the '${section}' sections of CHANGELOG.md from ${surface}@${written} to ${surface}@${version}, then write "${surface}": ${JSON.stringify(version)} here. A surface version counts changes to that one surface, so this refusal is the review the upgrade asks for — it is not a compatibility range to widen.`);
  }
}

function extensionList(value: unknown, manifestPath: string): readonly string[] {
  // BLD-U1: a Core (Node/CLI) project loads no compiler extensions, and the
  // manifest diagnostics above teach exactly that by telling authors to drop
  // the key. An absent 'extensions' is therefore the empty list — following the
  // teaching has to produce a working manifest, not a second error. An explicit
  // `"extensions": []` stays equally valid; every other shape is a mistake.
  if (value === undefined) return Object.freeze([]);
  if (!Array.isArray(value)) {
    throw new Error(`${manifestPath}: 'extensions' must be a list of installed package names — [${JSON.stringify(OFFICIAL_WEB_EXTENSION_PACKAGE)}] activates the web target`);
  }
  if (value.length > 16) throw new Error(`${manifestPath}: a project cannot load more than 16 compiler extensions`);
  const names = value.map((item) => {
    if (typeof item !== "string" || !/^(?:@[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*|[a-z0-9][a-z0-9._-]*)$/u.test(item)) {
      throw new Error(`${manifestPath}: compiler extension names must be npm package names`);
    }
    return item;
  });
  if (new Set(names).size !== names.length) throw new Error(`${manifestPath}: compiler extensions cannot be repeated`);
  return Object.freeze(names);
}

async function loadExtensions(root: string, names: readonly string[], manifestPath: string): Promise<LoadedExtensions> {
  const packages = await resolveExtensionPackages(root, names);
  const compiler: CompilerExtension[] = [];
  const project: ProjectExtension[] = [];
  const hosts: FrameworkHostExtension[] = [];
  for (const package_ of packages) {
    const name = package_.name;
    if (package_.resolution === "bundled") {
      const bundled = bundledExtension(name);
      if (!bundled) throw new Error(`${manifestPath}: bundled compiler extension '${name}' is unavailable`);
      const extension = validateLoadedExtension(package_, bundled.compiler);
      compiler.push(extension);
      if (package_.manifestKey !== null) {
        const projectExtension = bundled.project;
        if (!projectExtension || projectExtension.id !== name || projectExtension.manifestKey !== package_.manifestKey || typeof projectExtension.parse !== "function"
          || (projectExtension.migrate !== undefined && typeof projectExtension.migrate !== "function")) {
          throw new Error(`'${name}/compiler' exports an invalid velarProjectExtension`);
        }
        project.push(projectExtension);
      } else if (bundled.project !== null) {
        throw new Error(`'${name}/compiler' exports velarProjectExtension without declaring manifestKey metadata`);
      }
      if (bundled.host) hosts.push(validateFrameworkHost(bundled.host, extension, name));
      continue;
    }
    const require = createRequire(package_.manifestPath);
    try {
      const entry = require.resolve(`${name}/compiler`);
      const namespace = await import(pathToFileURL(entry).href) as { readonly velarCompilerExtension?: unknown; readonly velarProjectExtension?: unknown };
      const extension = validateLoadedExtension(package_, namespace.velarCompilerExtension as Partial<CompilerExtension> | undefined);
      compiler.push(extension);
      if (package_.manifestKey !== null) {
        const projectExtension = namespace.velarProjectExtension as Partial<ProjectExtension>;
        if (!projectExtension || projectExtension.id !== name || projectExtension.manifestKey !== package_.manifestKey || typeof projectExtension.parse !== "function"
          || (projectExtension.migrate !== undefined && typeof projectExtension.migrate !== "function")) {
          throw new Error(`'${name}/compiler' exports an invalid velarProjectExtension`);
        }
        project.push(projectExtension as ProjectExtension);
      } else if (namespace.velarProjectExtension !== undefined) {
        throw new Error(`'${name}/compiler' exports velarProjectExtension without declaring manifestKey metadata`);
      }
      const host = await loadFrameworkHost(require, name);
      if (host) hosts.push(validateFrameworkHost(host, extension, name));
    } catch (error) {
      throw new Error(`${manifestPath}: cannot load compiler extension '${name}': ${hostErrorMessage(error)}`);
    }
  }
  if (new Set(project.map((extension) => extension.manifestKey)).size !== project.length) {
    throw new Error(`${manifestPath}: compiler extensions define conflicting project manifest fields`);
  }
  validateModuleOwnership(compiler, manifestPath);
  return { packages, compiler: Object.freeze(compiler), project: Object.freeze(project), hosts: Object.freeze(hosts) };
}

/**
 * `velar/*` is a closed vocabulary owned by the language, so Core's own roster
 * is in the table before any extension is, and no package outside the official
 * toolchain may name that prefix at all. Without both halves an extension named
 * in `velar.json` could declare `velar/id` and have the compiler type-check
 * against its contract and emit its source with no diagnostic anywhere, because
 * `standardModuleInterface` consults extensions before Core.
 *
 * An official target extension may still take a Core name: `@velarscript/node`
 * replaces `velar/worker` with the Node implementation of the same contract,
 * which is what target capabilities are for. That is the only exemption.
 */
function validateModuleOwnership(extensions: readonly CompilerExtension[], manifestPath: string): void {
  const owners = new Map<string, string>();
  for (const specifier of coreModuleRoster()) owners.set(specifier, CORE_MODULE_OWNER);
  for (const extension of extensions) {
    const official = isToolchainExtensionPackage(extension.id);
    const specifiers = new Set([
      ...(extension.modules?.interfaces.keys() ?? []),
      ...(extension.modules?.sources.keys() ?? []),
    ]);
    for (const specifier of specifiers) {
      if (!official && specifier.startsWith("velar/")) {
        throw new Error(`${manifestPath}: extension '${extension.id}' cannot declare Velar module '${specifier}'; 'velar/*' belongs to the language — an extension publishes its modules under its own package name`);
      }
      const owner = owners.get(specifier);
      if (owner && owner !== extension.id && !(official && owner === CORE_MODULE_OWNER)) {
        throw new Error(`${manifestPath}: Velar module '${specifier}' has more than one extension owner (${owner}, ${extension.id})`);
      }
      owners.set(specifier, extension.id);
    }
  }
}

const CORE_MODULE_OWNER = "core";

/** Core's roster is what the standard-module tables hold with no extension active. */
function coreModuleRoster(): ReadonlySet<string> {
  return new Set([...standardModuleInterfaces().keys(), ...standardModuleSources().keys()]);
}

async function loadFrameworkHost(require: NodeJS.Require, name: string): Promise<unknown | null> {
  let entry: string;
  try {
    entry = require.resolve(`${name}/host`);
  } catch (error) {
    const code = hostErrorCode(error);
    const message = hostErrorMessage(error);
    if (code === "ERR_PACKAGE_PATH_NOT_EXPORTED"
      || (code === "MODULE_NOT_FOUND" && message.includes(`'${name}/host'`))) return null;
    throw error;
  }
  const namespace = await import(pathToFileURL(entry).href) as { readonly velarFrameworkHost?: unknown };
  if (namespace.velarFrameworkHost === undefined) throw new Error(`'${name}/host' does not export velarFrameworkHost`);
  return namespace.velarFrameworkHost;
}

function validateFrameworkHost(value: unknown, compiler: CompilerExtension, name: string): FrameworkHostExtension {
  const host = value as Partial<FrameworkHostExtension> | null;
  if (!host || typeof host !== "object") throw new Error(`'${name}/host' exports an invalid framework host`);
  if (host.protocolVersion !== VELAR_FRAMEWORK_HOST_PROTOCOL_VERSION) {
    throw new Error(`'${name}/host' uses unsupported framework host protocol ${String(host.protocolVersion)}`);
  }
  if (host.id !== name) throw new Error(`'${name}/host' framework identity does not match its package`);
  if (typeof host.capability !== "string" || !compiler.capabilities?.includes(host.capability)) {
    throw new Error(`'${name}/host' must bind one capability owned by its compiler extension`);
  }
  if (host.target !== "browser" || typeof host.displayName !== "string" || !host.displayName
    || typeof host.apiVersion !== "string" || !host.apiVersion
    || typeof host.artifactKind !== "string" || !/^[a-z][a-z0-9-]*$/u.test(host.artifactKind)
    || typeof host.base !== "function"
    || typeof host.createArtifacts !== "function" || typeof host.createErrorDocument !== "function"
    || typeof host.staticDeployment !== "function"
    || (host.requiredPublicAssets !== undefined && typeof host.requiredPublicAssets !== "function")
    || (host.validateProject !== undefined && typeof host.validateProject !== "function")) {
    throw new Error(`'${name}/host' exports an invalid framework host contract`);
  }
  if (compiler.modules?.apiVersion && compiler.modules.apiVersion !== host.apiVersion) {
    throw new Error(`'${name}/host' API version does not match its compiler extension`);
  }
  if (host.browserTests && (typeof host.browserTests.runtimeKey !== "string" || !host.browserTests.runtimeKey
    || typeof host.browserTests.sourceSuffix !== "string" || !host.browserTests.sourceSuffix.endsWith(".test.vel")
    || (host.browserTests.initScript !== undefined && typeof host.browserTests.initScript !== "function")
    || (host.browserTests.createController !== undefined && typeof host.browserTests.createController !== "function")
    || (host.browserTests.initScript !== undefined && host.browserTests.createController !== undefined))) {
    throw new Error(`'${name}/host' exports an invalid browser-test contract`);
  }
  return Object.freeze(host as FrameworkHostExtension);
}

function resolveFrameworkHost(
  extensions: LoadedExtensions,
  configs: ReadonlyMap<string, unknown>,
  projectKind: VelarProjectKind,
  manifestPath: string,
): ResolvedFrameworkHost | null {
  if (extensions.hosts.length > 1) {
    throw new Error(`${manifestPath}: a project can compose only one application framework host`);
  }
  const host = extensions.hosts[0];
  if (!host) return null;
  // 应用扩展同时提供语法、类型和运行时能力。库可以使用这些能力，但明确
  // 声明 kind=library 后不会因此被悄悄变成一个需要页面或监听端口的应用。
  if (projectKind === "library") return null;
  if (!configs.has(host.id)) {
    throw new Error(`${manifestPath}: framework host '${host.id}' must define a project configuration extension`);
  }
  return Object.freeze({ host, config: configs.get(host.id) });
}

function projectKindField(value: unknown, manifestPath: string): VelarProjectKind {
  if (value === undefined) return "application";
  if (value !== "application" && value !== "library") {
    throw new Error(`${manifestPath}: 'kind' must be 'application' or 'library'`);
  }
  return value;
}

function integerField(value: unknown, field: string): number {
  if (!Number.isInteger(value) || (value as number) < 1) throw new Error(`'${field}' must be a positive integer`);
  return value as number;
}

function stringField(value: unknown, field: string, fallback: string): string {
  if (value === undefined) return fallback;
  if (typeof value !== "string" || value.trim().length === 0 || value.includes("\0")) {
    throw new Error(`'${field}' must be a non-empty string without NUL bytes`);
  }
  return value;
}

function knownFields(value: Record<string, unknown>, allowed: ReadonlySet<string>, field: string, manifestPath: string): void {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw new Error(`${manifestPath}: unknown '${field}' field '${key}'`);
  }
}

function resolveProjectPath(root: string, value: string, field: string): string {
  if (isAbsolute(value)) throw new Error(`'${field}' must be relative to velar.json`);
  const path = resolve(root, value);
  const pathFromRoot = relative(root, path);
  if (pathFromRoot === ".." || pathFromRoot.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) || isAbsolute(pathFromRoot)) {
    throw new Error(`'${field}' cannot escape the VelarScript project`);
  }
  return path;
}

function assertProjectPaths(root: string, entry: string, outDir: string, publicDir: string, manifestPath: string): void {
  if (outDir === root) throw new Error(`${manifestPath}: 'outDir' cannot be the project root`);
  if (isWithin(outDir, entry)) throw new Error(`${manifestPath}: 'entry' cannot be inside 'outDir'`);
  if (isWithin(outDir, publicDir) || isWithin(publicDir, outDir)) {
    throw new Error(`${manifestPath}: 'outDir' and 'publicDir' cannot overlap`);
  }
}

function isWithin(root: string, candidate: string): boolean {
  const pathFromRoot = relative(root, candidate);
  return pathFromRoot === "" || (!pathFromRoot.startsWith("..") && !isAbsolute(pathFromRoot));
}

async function findManifest(start: string): Promise<string | null> {
  let directory = resolve(start);
  while (true) {
    const candidate = join(directory, "velar.json");
    if (await ordinaryManifestFile(candidate)) return candidate;
    const parent = dirname(directory);
    if (parent === directory) return null;
    directory = parent;
  }
}

async function pathKind(path: string): Promise<"file" | "directory" | "missing"> {
  try {
    const information = await stat(path);
    return information.isDirectory() ? "directory" : "file";
  } catch (error) {
    if (isHostErrorCode(error, "ENOENT") || isHostErrorCode(error, "ENOTDIR")) return "missing";
    throw error;
  }
}

async function ordinaryManifestFile(path: string): Promise<boolean> {
  try {
    const information = await lstat(path);
    if (!information.isFile() || information.isSymbolicLink()) {
      throw new Error(`${path}: project manifest must be an ordinary file`);
    }
    return true;
  } catch (error) {
    if (isHostErrorCode(error, "ENOENT") || isHostErrorCode(error, "ENOTDIR")) return false;
    throw error;
  }
}
