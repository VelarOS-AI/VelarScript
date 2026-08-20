const DEFAULT_MAX_BODY_BYTES = 16 * 1024 * 1024;
const MAX_BODY_BYTES = 16 * 1024 * 1024;

export interface VelarNodeConfig {
  /** Exported ServeApp value in the project entry module. */
  readonly app: string;
  readonly host: string;
  readonly port: number;
  /** Per-request ceiling; the Node host also enforces its aggregate byte budget. */
  readonly maxBodyBytes: number;
  readonly build: {
    readonly sourceMaps: boolean;
  };
}

export const velarProjectExtension = Object.freeze({
  id: "@velarscript/node",
  manifestKey: "node",
  parse(value: unknown, manifestPath: string): VelarNodeConfig {
    return nodeConfig(value, manifestPath);
  },
});

function nodeConfig(value: unknown, manifestPath: string): VelarNodeConfig {
  if (value !== undefined && (!value || typeof value !== "object" || Array.isArray(value))) {
    throw new Error(`${manifestPath}: 'node' must be an object`);
  }
  const node = value as {
    readonly app?: unknown;
    readonly host?: unknown;
    readonly port?: unknown;
    readonly maxBodyBytes?: unknown;
    readonly build?: unknown;
  } | undefined;
  if (node) knownFields(node as Record<string, unknown>, new Set(["app", "host", "port", "maxBodyBytes", "build"]), "node", manifestPath);
  const app = stringField(node?.app, "node.app", "app", 128);
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/u.test(app)) {
    throw new Error(`${manifestPath}: 'node.app' must name an exported VelarScript binding`);
  }
  const host = stringField(node?.host, "node.host", "127.0.0.1", 255);
  if (/[/\\\s?#]/u.test(host) || host.includes(":" ) && host !== "::" && !/^[:0-9a-f]+$/iu.test(host)) {
    throw new Error(`${manifestPath}: 'node.host' must be a hostname or IP address without a URL scheme or port`);
  }
  return Object.freeze({
    app,
    host,
    port: integerField(node?.port, "node.port", 3000, 1, 65_535),
    maxBodyBytes: integerField(node?.maxBodyBytes, "node.maxBodyBytes", DEFAULT_MAX_BODY_BYTES, 1, MAX_BODY_BYTES),
    build: buildConfig(node?.build, manifestPath),
  });
}

function buildConfig(value: unknown, manifestPath: string): VelarNodeConfig["build"] {
  if (value !== undefined && (!value || typeof value !== "object" || Array.isArray(value))) {
    throw new Error(`${manifestPath}: 'node.build' must be an object`);
  }
  const build = value as { readonly sourceMaps?: unknown } | undefined;
  if (build) knownFields(build as Record<string, unknown>, new Set(["sourceMaps"]), "node.build", manifestPath);
  const sourceMaps = build?.sourceMaps === undefined ? false : build.sourceMaps;
  if (typeof sourceMaps !== "boolean") throw new Error(`${manifestPath}: 'node.build.sourceMaps' must be a boolean`);
  return Object.freeze({ sourceMaps });
}

function integerField(value: unknown, field: string, fallback: number, minimum: number, maximum: number): number {
  if (value === undefined) return fallback;
  if (!Number.isSafeInteger(value) || (value as number) < minimum || (value as number) > maximum) {
    throw new Error(`'${field}' must be an integer from ${minimum} through ${maximum}`);
  }
  return value as number;
}

function stringField(value: unknown, field: string, fallback: string, maximum: number): string {
  if (value === undefined) return fallback;
  if (typeof value !== "string" || value.length === 0 || value.length > maximum || value.includes("\0")) {
    throw new Error(`'${field}' must be non-empty text of at most ${maximum} characters without NUL bytes`);
  }
  return value;
}

function knownFields(value: Record<string, unknown>, allowed: ReadonlySet<string>, field: string, manifestPath: string): void {
  for (const key of Object.keys(value)) if (!allowed.has(key)) throw new Error(`${manifestPath}: unknown '${field}' field '${key}'`);
}
