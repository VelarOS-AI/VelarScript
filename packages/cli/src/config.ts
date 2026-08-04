import { readFile, stat } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, extname, isAbsolute, join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { CompilerExtension } from "@velarscript/compiler";
import {
  VELAR_FRAMEWORK_HOST_PROTOCOL_VERSION,
  type FrameworkHostExtension,
} from "@velarscript/compiler/framework-host";
import { hostErrorCode, hostErrorMessage } from "./host-error.ts";

export interface ResolvedFrameworkHost {
  readonly host: FrameworkHostExtension;
  readonly config: unknown;
}

export interface VelarProjectConfig {
  readonly formatVersion: number;
  readonly root: string;
  readonly manifestPath: string | null;
  readonly entryPath: string;
  readonly outDir: string;
  readonly publicDir: string;
  readonly extensions: readonly string[];
  readonly compilerExtensions: readonly CompilerExtension[];
  readonly extensionConfig: ReadonlyMap<string, unknown>;
  readonly framework: ResolvedFrameworkHost | null;
}

interface ProjectExtension {
  readonly id: string;
  readonly manifestKey: string;
  readonly parse: (value: unknown, manifestPath: string) => unknown;
}

interface LoadedExtensions {
  readonly compiler: readonly CompilerExtension[];
  readonly project: readonly ProjectExtension[];
  readonly hosts: readonly FrameworkHostExtension[];
}

interface ManifestShape {
  readonly formatVersion?: unknown;
  readonly entry?: unknown;
  readonly outDir?: unknown;
  readonly publicDir?: unknown;
  readonly extensions?: unknown;
}

export const CURRENT_PROJECT_FORMAT_VERSION = 2;

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
  if (!manifestPath || await pathKind(manifestPath) !== "file") {
    throw new Error(input
      ? `'${input}' is neither a .vel file nor a directory containing velar.json`
      : "velar.json was not found; run this command in a VelarScript project or pass an entry .vel file");
  }
  return loadManifest(manifestPath);
}

export async function resolveVelarProjectForDocument(path: string): Promise<VelarProjectConfig> {
  const documentPath = resolve(path);
  const manifestPath = await findManifest(dirname(documentPath));
  return manifestPath ? loadManifest(manifestPath, documentPath) : standaloneProject(documentPath);
}

async function loadManifest(manifestPath: string, entryOverride: string | null = null): Promise<VelarProjectConfig> {
  let manifest: ManifestShape;
  try {
    const metadata = await stat(manifestPath);
    if (metadata.size > 1024 * 1024) throw new RangeError("project manifest exceeds 1 MiB");
    const source = await readFile(manifestPath, "utf8");
    if (Buffer.byteLength(source, "utf8") > 1024 * 1024) throw new RangeError("project manifest exceeds 1 MiB");
    manifest = JSON.parse(source) as ManifestShape;
  } catch (error) {
    throw new Error(`Cannot read ${manifestPath}: ${hostErrorMessage(error)}`);
  }
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) throw new Error(`${manifestPath} must contain a JSON object`);
  if (manifest.formatVersion === undefined) throw new Error(`${manifestPath}: 'formatVersion' is required; this compiler does not load legacy project formats`);
  const formatVersion = integerField(manifest.formatVersion, "formatVersion");
  if (formatVersion !== CURRENT_PROJECT_FORMAT_VERSION) {
    throw new Error(`${manifestPath}: unsupported formatVersion ${formatVersion}; this compiler supports ${CURRENT_PROJECT_FORMAT_VERSION}`);
  }
  const root = dirname(manifestPath);
  const entry = entryOverride ?? resolveProjectPath(root, stringField(manifest.entry, "entry", "src/main.vel"), "entry");
  if (extname(entry) !== ".vel") throw new Error(`${manifestPath}: 'entry' must point to a .vel file`);
  const outDir = resolveProjectPath(root, stringField(manifest.outDir, "outDir", "dist"), "outDir");
  const publicDir = resolveProjectPath(root, stringField(manifest.publicDir, "publicDir", "public"), "publicDir");
  const extensions = extensionList(manifest.extensions, manifestPath);
  const loadedExtensions = await loadExtensions(root, extensions, manifestPath);
  knownFields(
    manifest as Record<string, unknown>,
    new Set(["formatVersion", "entry", "outDir", "publicDir", "extensions", ...loadedExtensions.project.map((extension) => extension.manifestKey)]),
    "project",
    manifestPath,
  );
  const extensionConfig = new Map(loadedExtensions.project.map((extension) => [
    extension.id,
    extension.parse((manifest as Record<string, unknown>)[extension.manifestKey], manifestPath),
  ]));
  const framework = resolveFrameworkHost(loadedExtensions, extensionConfig, manifestPath);
  assertProjectPaths(root, entry, outDir, publicDir, manifestPath);
  return {
    formatVersion,
    root,
    manifestPath,
    entryPath: entry,
    outDir,
    publicDir,
    extensions,
    compilerExtensions: loadedExtensions.compiler,
    extensionConfig,
    framework,
  };
}

function standaloneProject(entryPath: string): VelarProjectConfig {
  const root = dirname(entryPath);
  return {
    formatVersion: CURRENT_PROJECT_FORMAT_VERSION,
    root,
    manifestPath: null,
    entryPath,
    outDir: join(root, "dist"),
    publicDir: join(root, "public"),
    extensions: [],
    compilerExtensions: [],
    extensionConfig: new Map(),
    framework: null,
  };
}

function extensionList(value: unknown, manifestPath: string): readonly string[] {
  if (!Array.isArray(value)) {
    throw new Error(`${manifestPath}: 'extensions' must be a list of installed package names`);
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
  const require = createRequire(join(root, "package.json"));
  const compiler: CompilerExtension[] = [];
  const project: ProjectExtension[] = [];
  const hosts: FrameworkHostExtension[] = [];
  for (const name of names) {
    try {
      const entry = require.resolve(`${name}/compiler`);
      const namespace = await import(pathToFileURL(entry).href) as { readonly velarCompilerExtension?: unknown; readonly velarProjectExtension?: unknown };
      const extension = namespace.velarCompilerExtension as Partial<CompilerExtension> | undefined;
      if (!extension || extension.id !== name || (extension.createEmitter !== undefined && typeof extension.createEmitter !== "function")) {
        throw new Error(`'${name}/compiler' does not export a matching velarCompilerExtension`);
      }
      compiler.push(extension as CompilerExtension);
      if (namespace.velarProjectExtension !== undefined) {
        const projectExtension = namespace.velarProjectExtension as Partial<ProjectExtension>;
        if (projectExtension.id !== name || typeof projectExtension.manifestKey !== "string" || typeof projectExtension.parse !== "function") {
          throw new Error(`'${name}/compiler' exports an invalid velarProjectExtension`);
        }
        project.push(projectExtension as ProjectExtension);
      }
      const host = await loadFrameworkHost(require, name);
      if (host) hosts.push(validateFrameworkHost(host, extension as CompilerExtension, name));
    } catch (error) {
      throw new Error(`${manifestPath}: cannot load compiler extension '${name}': ${hostErrorMessage(error)}`);
    }
  }
  if (new Set(project.map((extension) => extension.manifestKey)).size !== project.length) {
    throw new Error(`${manifestPath}: compiler extensions define conflicting project manifest fields`);
  }
  return { compiler: Object.freeze(compiler), project: Object.freeze(project), hosts: Object.freeze(hosts) };
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
    || typeof host.base !== "function" || typeof host.sourceMaps !== "function"
    || typeof host.createArtifacts !== "function" || typeof host.createErrorDocument !== "function"
    || typeof host.staticDeployment !== "function") {
    throw new Error(`'${name}/host' exports an invalid framework host contract`);
  }
  if (compiler.modules?.apiVersion && compiler.modules.apiVersion !== host.apiVersion) {
    throw new Error(`'${name}/host' API version does not match its compiler extension`);
  }
  if (host.browserTests && (typeof host.browserTests.runtimeKey !== "string" || !host.browserTests.runtimeKey
    || typeof host.browserTests.sourceSuffix !== "string" || !host.browserTests.sourceSuffix.endsWith(".test.vel"))) {
    throw new Error(`'${name}/host' exports an invalid browser-test contract`);
  }
  return Object.freeze(host as FrameworkHostExtension);
}

function resolveFrameworkHost(
  extensions: LoadedExtensions,
  configs: ReadonlyMap<string, unknown>,
  manifestPath: string,
): ResolvedFrameworkHost | null {
  if (extensions.hosts.length > 1) {
    throw new Error(`${manifestPath}: a project can compose only one application framework host`);
  }
  const host = extensions.hosts[0];
  if (!host) return null;
  if (!configs.has(host.id)) {
    throw new Error(`${manifestPath}: framework host '${host.id}' must define a project configuration extension`);
  }
  return Object.freeze({ host, config: configs.get(host.id) });
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
    if (await pathKind(candidate) === "file") return candidate;
    const parent = dirname(directory);
    if (parent === directory) return null;
    directory = parent;
  }
}

async function pathKind(path: string): Promise<"file" | "directory" | "missing"> {
  try {
    const information = await stat(path);
    return information.isDirectory() ? "directory" : "file";
  } catch {
    return "missing";
  }
}
