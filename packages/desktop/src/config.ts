export const VELAR_DESKTOP_API_VERSION = "0.10";
export const DEFAULT_DESKTOP_SIZE_BUDGET_BYTES = 20 * 1024 * 1024;

export interface DesktopWindowConfig {
  readonly title: string;
  readonly width: number;
  readonly height: number;
  readonly minWidth: number;
  readonly minHeight: number;
}

export interface DesktopPermissionConfig {
  readonly files: readonly ("app-data" | "project")[];
  readonly processes: readonly string[];
  readonly terminal: boolean;
  readonly network: readonly string[];
  readonly environment: readonly string[];
  readonly secrets: readonly string[];
}

export interface VelarDesktopConfig {
  readonly productName: string;
  readonly identifier: string;
  readonly window: DesktopWindowConfig;
  readonly permissions: DesktopPermissionConfig;
  readonly build: {
    readonly outDir: string;
    readonly sizeBudgetBytes: number;
  };
}

export const velarProjectExtension = Object.freeze({
  id: "@velarscript/desktop",
  manifestKey: "desktop",
  parse(value: unknown, manifestPath: string): VelarDesktopConfig {
    return desktopConfig(value, manifestPath);
  },
});

function desktopConfig(value: unknown, manifestPath: string): VelarDesktopConfig {
  const desktop = objectField(value, "desktop", manifestPath);
  knownFields(desktop, new Set(["productName", "identifier", "window", "permissions", "build"]), "desktop", manifestPath);
  const productName = stringField(desktop.productName, "desktop.productName");
  if (!/^[^/:\0]{1,80}$/u.test(productName) || productName === "." || productName === "..") {
    throw new Error(`${manifestPath}: 'desktop.productName' must be a safe application name of at most 80 characters`);
  }
  const identifier = stringField(desktop.identifier, "desktop.identifier");
  if (!/^[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+$/u.test(identifier)) {
    throw new Error(`${manifestPath}: 'desktop.identifier' must be a reverse-DNS application identifier`);
  }
  return Object.freeze({
    productName,
    identifier,
    window: windowConfig(desktop.window, productName, manifestPath),
    permissions: permissionConfig(desktop.permissions, manifestPath),
    build: buildConfig(desktop.build, manifestPath),
  });
}

function windowConfig(value: unknown, productName: string, manifestPath: string): DesktopWindowConfig {
  const window = value === undefined ? {} : objectField(value, "desktop.window", manifestPath);
  knownFields(window, new Set(["title", "width", "height", "minWidth", "minHeight"]), "desktop.window", manifestPath);
  const width = integerField(window.width, "desktop.window.width", 1180, 480, 8192);
  const height = integerField(window.height, "desktop.window.height", 760, 320, 8192);
  return Object.freeze({
    title: window.title === undefined ? productName : stringField(window.title, "desktop.window.title"),
    width,
    height,
    minWidth: integerField(window.minWidth, "desktop.window.minWidth", 720, 320, width),
    minHeight: integerField(window.minHeight, "desktop.window.minHeight", 520, 240, height),
  });
}

function permissionConfig(value: unknown, manifestPath: string): DesktopPermissionConfig {
  const permissions = value === undefined ? {} : objectField(value, "desktop.permissions", manifestPath);
  knownFields(permissions, new Set(["files", "processes", "terminal", "network", "environment", "secrets"]), "desktop.permissions", manifestPath);
  const files = stringList(permissions.files, "desktop.permissions.files", 3);
  const validFileScopes = new Set(["app-data", "project"]);
  for (const scope of files) if (!validFileScopes.has(scope)) throw new Error(`${manifestPath}: unknown desktop file scope '${scope}'`);
  const processes = stringList(permissions.processes, "desktop.permissions.processes", 64);
  for (const command of processes) {
    if (!/^[A-Za-z0-9._+-]{1,128}$/u.test(command)) throw new Error(`${manifestPath}: desktop process permissions must be executable names, not paths or shell text`);
  }
  const terminal = booleanField(permissions.terminal, "desktop.permissions.terminal", false);
  const network = stringList(permissions.network, "desktop.permissions.network", 64);
  for (const origin of network) {
    let parsed: URL;
    try { parsed = new URL(origin); }
    catch { throw new Error(`${manifestPath}: desktop network permission '${origin}' must be an absolute origin`); }
    const loopback = parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1" || parsed.hostname === "[::1]";
    if ((parsed.protocol !== "https:" && !(parsed.protocol === "http:" && loopback))
      || parsed.username || parsed.password || parsed.pathname !== "/" || parsed.search || parsed.hash) {
      throw new Error(`${manifestPath}: desktop network permission '${origin}' must be an HTTPS origin or exact loopback origin`);
    }
  }
  const environment = stringList(permissions.environment, "desktop.permissions.environment", 64);
  for (const name of environment) {
    if (!/^[A-Z_][A-Z0-9_]{0,127}$/u.test(name)) throw new Error(`${manifestPath}: desktop environment permissions must be uppercase variable names`);
  }
  const secrets = stringList(permissions.secrets, "desktop.permissions.secrets", 64);
  for (const name of secrets) {
    if (!/^[A-Z_][A-Z0-9_]{0,127}$/u.test(name)) throw new Error(`${manifestPath}: desktop secret permissions must be uppercase variable names`);
    if (environment.includes(name)) throw new Error(`${manifestPath}: desktop secret '${name}' cannot also be exposed through desktop.permissions.environment`);
  }
  return Object.freeze({ files: files as DesktopPermissionConfig["files"], processes, terminal, network, environment, secrets });
}

function buildConfig(value: unknown, manifestPath: string): VelarDesktopConfig["build"] {
  const build = value === undefined ? {} : objectField(value, "desktop.build", manifestPath);
  knownFields(build, new Set(["outDir", "sizeBudgetBytes"]), "desktop.build", manifestPath);
  const outDir = build.outDir === undefined ? "dist/desktop" : stringField(build.outDir, "desktop.build.outDir");
  if (outDir.startsWith("/") || outDir.split(/[\\/]/u).includes("..")) throw new Error(`${manifestPath}: 'desktop.build.outDir' must stay inside the project`);
  return Object.freeze({
    outDir,
    sizeBudgetBytes: integerField(build.sizeBudgetBytes, "desktop.build.sizeBudgetBytes", DEFAULT_DESKTOP_SIZE_BUDGET_BYTES, 64 * 1024, 1024 * 1024 * 1024),
  });
}

function stringList(value: unknown, field: string, maximum: number): readonly string[] {
  if (value === undefined) return Object.freeze([]);
  if (!Array.isArray(value) || value.length > maximum || value.some((item) => typeof item !== "string" || !item || item.includes("\0"))) {
    throw new Error(`'${field}' must be a list of at most ${maximum} non-empty strings`);
  }
  if (new Set(value).size !== value.length) throw new Error(`'${field}' cannot contain duplicates`);
  return Object.freeze([...value] as string[]);
}

function objectField(value: unknown, field: string, manifestPath: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${manifestPath}: '${field}' must be an object`);
  return value as Record<string, unknown>;
}

function stringField(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0 || value.includes("\0")) throw new Error(`'${field}' must be a non-empty string without NUL bytes`);
  return value;
}

function integerField(value: unknown, field: string, fallback: number, minimum: number, maximum: number): number {
  if (value === undefined) return fallback;
  if (!Number.isSafeInteger(value) || (value as number) < minimum || (value as number) > maximum) {
    throw new Error(`'${field}' must be an integer from ${minimum} through ${maximum}`);
  }
  return value as number;
}

function booleanField(value: unknown, field: string, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  if (typeof value !== "boolean") throw new Error(`'${field}' must be a boolean`);
  return value;
}

function knownFields(value: Record<string, unknown>, allowed: ReadonlySet<string>, field: string, manifestPath: string): void {
  for (const key of Object.keys(value)) if (!allowed.has(key)) throw new Error(`${manifestPath}: unknown '${field}' field '${key}'`);
}
