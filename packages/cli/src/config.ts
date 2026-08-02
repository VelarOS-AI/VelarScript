import { readFile, stat } from "node:fs/promises";
import { dirname, extname, isAbsolute, join, relative, resolve } from "node:path";

export interface VelarWebConfig {
  readonly title: string;
  readonly base: string;
  readonly publicConfig: Readonly<Record<string, unknown>>;
  readonly build: VelarWebBuildConfig;
  readonly security: VelarWebSecurityConfig;
  readonly deployment: VelarWebDeploymentConfig;
}

export interface VelarWebBuildConfig {
  readonly sourceMaps: boolean;
}

export interface VelarWebSecurityConfig {
  readonly contentSecurityPolicy: boolean;
  readonly connectSources: readonly string[];
  readonly imageSources: readonly string[];
}

export interface VelarWebDeploymentConfig {
  readonly spaFallback: boolean;
  readonly adapter: "neutral" | "netlify";
}

export interface VelarProjectConfig {
  readonly formatVersion: number;
  readonly needsUpgrade: boolean;
  readonly root: string;
  readonly manifestPath: string | null;
  readonly entryPath: string;
  readonly outDir: string;
  readonly publicDir: string;
  readonly web: VelarWebConfig;
}

interface ManifestShape {
  readonly formatVersion?: unknown;
  readonly entry?: unknown;
  readonly outDir?: unknown;
  readonly publicDir?: unknown;
  readonly web?: unknown;
}

export const CURRENT_PROJECT_FORMAT_VERSION = 1;

export async function resolveVelarProject(input: string | null, cwd = process.cwd()): Promise<VelarProjectConfig> {
  const explicit = input ? resolve(cwd, input) : null;
  const kind = explicit ? await pathKind(explicit) : null;
  if (explicit && kind === "missing") throw new Error(`'${input}' does not exist`);

  if (explicit && (kind === "file") && extname(explicit) === ".vel") {
    const manifestPath = await findManifest(dirname(explicit));
    return manifestPath ? loadManifest(manifestPath, explicit) : legacyProject(explicit);
  }

  const manifestPath = explicit
    ? kind === "directory" ? join(explicit, "velar.json") : explicit
    : await findManifest(resolve(cwd));
  if (!manifestPath || await pathKind(manifestPath) !== "file") {
    throw new Error(input
      ? `'${input}' is neither a .vel file nor a directory containing velar.json`
      : "velar.json was not found; run this command in a Velar project or pass an entry .vel file");
  }
  return loadManifest(manifestPath);
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
    throw new Error(`Cannot read ${manifestPath}: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) throw new Error(`${manifestPath} must contain a JSON object`);
  knownFields(manifest as Record<string, unknown>, new Set(["formatVersion", "entry", "outDir", "publicDir", "web"]), "project", manifestPath);
  const formatVersion = manifest.formatVersion === undefined
    ? CURRENT_PROJECT_FORMAT_VERSION
    : integerField(manifest.formatVersion, "formatVersion");
  if (formatVersion !== CURRENT_PROJECT_FORMAT_VERSION) {
    throw new Error(`${manifestPath}: unsupported formatVersion ${formatVersion}; this compiler supports ${CURRENT_PROJECT_FORMAT_VERSION}`);
  }
  const root = dirname(manifestPath);
  const entry = entryOverride ?? resolveProjectPath(root, stringField(manifest.entry, "entry", "src/main.vel"), "entry");
  if (extname(entry) !== ".vel") throw new Error(`${manifestPath}: 'entry' must point to a .vel file`);
  const outDir = resolveProjectPath(root, stringField(manifest.outDir, "outDir", "dist"), "outDir");
  const publicDir = resolveProjectPath(root, stringField(manifest.publicDir, "publicDir", "public"), "publicDir");
  const web = webConfig(manifest.web, manifestPath);
  assertProjectPaths(root, entry, outDir, publicDir, manifestPath);
  return {
    formatVersion,
    needsUpgrade: manifest.formatVersion === undefined,
    root,
    manifestPath,
    entryPath: entry,
    outDir,
    publicDir,
    web,
  };
}

function legacyProject(entryPath: string): VelarProjectConfig {
  const root = dirname(entryPath);
  return {
    formatVersion: CURRENT_PROJECT_FORMAT_VERSION,
    needsUpgrade: false,
    root,
    manifestPath: null,
    entryPath,
    outDir: join(root, "dist"),
    publicDir: join(root, "public"),
    web: {
      title: "Velar App",
      base: "/",
      publicConfig: {},
      build: { sourceMaps: false },
      security: { contentSecurityPolicy: true, connectSources: [], imageSources: [] },
      deployment: { spaFallback: true, adapter: "neutral" },
    },
  };
}

function integerField(value: unknown, field: string): number {
  if (!Number.isInteger(value) || (value as number) < 1) throw new Error(`'${field}' must be a positive integer`);
  return value as number;
}

function webConfig(value: unknown, manifestPath: string): VelarWebConfig {
  if (value !== undefined && (!value || typeof value !== "object" || Array.isArray(value))) {
    throw new Error(`${manifestPath}: 'web' must be an object`);
  }
  const web = value as {
    readonly title?: unknown;
    readonly base?: unknown;
    readonly publicConfig?: unknown;
    readonly build?: unknown;
    readonly security?: unknown;
    readonly deployment?: unknown;
  } | undefined;
  if (web) knownFields(web as Record<string, unknown>, new Set(["title", "base", "publicConfig", "build", "security", "deployment"]), "web", manifestPath);
  const title = stringField(web?.title, "web.title", "Velar App");
  let base = stringField(web?.base, "web.base", "/");
  if (!base.startsWith("/")) throw new Error(`${manifestPath}: 'web.base' must start with '/'`);
  if (!base.endsWith("/")) base += "/";
  validateWebBase(base, manifestPath);
  const deployment = deploymentConfig(web?.deployment, manifestPath);
  if (deployment.adapter === "netlify" && base !== "/") {
    throw new Error(`${manifestPath}: 'web.deployment.adapter' netlify currently requires 'web.base' to be '/'`);
  }
  return {
    title,
    base,
    publicConfig: publicConfigField(web?.publicConfig, manifestPath),
    build: buildConfig(web?.build, manifestPath),
    security: securityConfig(web?.security, manifestPath),
    deployment,
  };
}

function buildConfig(value: unknown, manifestPath: string): VelarWebBuildConfig {
  if (value !== undefined && (!value || typeof value !== "object" || Array.isArray(value))) {
    throw new Error(`${manifestPath}: 'web.build' must be an object`);
  }
  const build = value as { readonly sourceMaps?: unknown } | undefined;
  if (build) knownFields(build as Record<string, unknown>, new Set(["sourceMaps"]), "web.build", manifestPath);
  return { sourceMaps: booleanField(build?.sourceMaps, "web.build.sourceMaps", false) };
}

function publicConfigField(value: unknown, manifestPath: string): Readonly<Record<string, unknown>> {
  if (value === undefined) return Object.freeze({});
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${manifestPath}: 'web.publicConfig' must be a JSON object`);
  }
  const dangerous = new Set(["__proto__", "prototype", "constructor"]);
  const visit = (item: unknown, path: string): void => {
    if (item === null || typeof item === "string" || typeof item === "boolean") return;
    if (typeof item === "number") {
      if (!Number.isFinite(item)) throw new Error(`${manifestPath}: '${path}' must contain a finite JSON number`);
      return;
    }
    if (Array.isArray(item)) {
      item.forEach((child, index) => visit(child, `${path}[${index}]`));
      return;
    }
    if (!item || typeof item !== "object") {
      throw new Error(`${manifestPath}: '${path}' contains a non-JSON value`);
    }
    for (const [key, child] of Object.entries(item)) {
      if (dangerous.has(key)) throw new Error(`${manifestPath}: '${path}' contains reserved key '${key}'`);
      visit(child, `${path}.${key}`);
    }
  };
  visit(value, "web.publicConfig");
  const encoded = JSON.stringify(value);
  if (Buffer.byteLength(encoded, "utf8") > 65_536) {
    throw new Error(`${manifestPath}: 'web.publicConfig' cannot exceed 64 KiB`);
  }
  return JSON.parse(encoded) as Record<string, unknown>;
}

function securityConfig(value: unknown, manifestPath: string): VelarWebSecurityConfig {
  if (value !== undefined && (!value || typeof value !== "object" || Array.isArray(value))) {
    throw new Error(`${manifestPath}: 'web.security' must be an object`);
  }
  const security = value as {
    readonly contentSecurityPolicy?: unknown;
    readonly connectSources?: unknown;
    readonly imageSources?: unknown;
  } | undefined;
  if (security) knownFields(security as Record<string, unknown>, new Set(["contentSecurityPolicy", "connectSources", "imageSources"]), "web.security", manifestPath);
  return {
    contentSecurityPolicy: booleanField(security?.contentSecurityPolicy, "web.security.contentSecurityPolicy", true),
    connectSources: sourceList(security?.connectSources, "web.security.connectSources", new Set(["https:", "wss:"])),
    imageSources: sourceList(security?.imageSources, "web.security.imageSources", new Set(["https:"])),
  };
}

function deploymentConfig(value: unknown, manifestPath: string): VelarWebDeploymentConfig {
  if (value !== undefined && (!value || typeof value !== "object" || Array.isArray(value))) {
    throw new Error(`${manifestPath}: 'web.deployment' must be an object`);
  }
  const deployment = value as { readonly spaFallback?: unknown; readonly adapter?: unknown } | undefined;
  if (deployment) knownFields(deployment as Record<string, unknown>, new Set(["spaFallback", "adapter"]), "web.deployment", manifestPath);
  const adapter = stringField(deployment?.adapter, "web.deployment.adapter", "neutral");
  if (adapter !== "neutral" && adapter !== "netlify") {
    throw new Error(`'web.deployment.adapter' must be 'neutral' or 'netlify'`);
  }
  return {
    spaFallback: booleanField(deployment?.spaFallback, "web.deployment.spaFallback", true),
    adapter,
  };
}

function booleanField(value: unknown, field: string, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  if (typeof value !== "boolean") throw new Error(`'${field}' must be a boolean`);
  return value;
}

function sourceList(value: unknown, field: string, protocols: ReadonlySet<string>): readonly string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new Error(`'${field}' must be a list of secure origins`);
  }
  return [...new Set(value.map((item) => {
    let url: URL;
    try {
      url = new URL(item as string);
    } catch {
      throw new Error(`'${field}' contains invalid origin '${String(item)}'`);
    }
    if (!protocols.has(url.protocol) || url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
      throw new Error(`'${field}' contains unsupported origin '${String(item)}'`);
    }
    return url.origin;
  }))].sort();
}

function stringField(value: unknown, field: string, fallback: string): string {
  if (value === undefined) return fallback;
  if (typeof value !== "string" || value.trim().length === 0 || value.includes("\0")) throw new Error(`'${field}' must be a non-empty string without NUL bytes`);
  return value;
}

function knownFields(value: Record<string, unknown>, allowed: ReadonlySet<string>, field: string, manifestPath: string): void {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw new Error(`${manifestPath}: unknown '${field}' field '${key}'`);
  }
}

function validateWebBase(base: string, manifestPath: string): void {
  if (base.includes("?") || base.includes("#") || base.includes("\\")) {
    throw new Error(`${manifestPath}: 'web.base' must be a canonical URL pathname`);
  }
  const segments = base.split("/").slice(1, -1);
  if (segments.some((segment) => segment.length === 0)) {
    throw new Error(`${manifestPath}: 'web.base' cannot contain empty path segments`);
  }
  for (const segment of segments) {
    let decoded: string;
    try { decoded = decodeURIComponent(segment); }
    catch { throw new Error(`${manifestPath}: 'web.base' contains invalid percent encoding`); }
    if (decoded === "." || decoded === ".." || decoded.includes("/") || decoded.includes("\\")) {
      throw new Error(`${manifestPath}: 'web.base' must use canonical path segments`);
    }
  }
  const parsed = new URL(base, "https://velar.invalid");
  if (parsed.pathname !== base || parsed.search || parsed.hash) {
    throw new Error(`${manifestPath}: 'web.base' must be a canonical URL pathname`);
  }
}

function resolveProjectPath(root: string, value: string, field: string): string {
  if (isAbsolute(value)) throw new Error(`'${field}' must be relative to velar.json`);
  const path = resolve(root, value);
  const pathFromRoot = relative(root, path);
  if (pathFromRoot === ".." || pathFromRoot.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) || isAbsolute(pathFromRoot)) {
    throw new Error(`'${field}' cannot escape the Velar project`);
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
