export interface VelarServerConfig {
  /** Exported zero-argument startup function in the project entry module. */
  readonly app: string;
  readonly build: {
    readonly sourceMaps: boolean;
  };
}

export const velarProjectExtension = Object.freeze({
  id: "@velarscript/server",
  manifestKey: "server",
  parse(value: unknown, manifestPath: string): VelarServerConfig {
    return serverConfig(value, manifestPath);
  },
});

function serverConfig(value: unknown, manifestPath: string): VelarServerConfig {
  if (value !== undefined && (!value || typeof value !== "object" || Array.isArray(value))) {
    throw new Error(`${manifestPath}: 'server' must be an object`);
  }
  const server = value as {readonly app?: unknown; readonly build?: unknown} | undefined;
  if (server) knownFields(server as Record<string, unknown>, new Set(["app", "build"]), "server", manifestPath);
  const app = stringField(server?.app, "server.app", "start", 128);
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/u.test(app)) {
    throw new Error(`${manifestPath}: 'server.app' must name an exported VelarScript binding`);
  }
  return Object.freeze({app, build: buildConfig(server?.build, manifestPath)});
}

function buildConfig(value: unknown, manifestPath: string): VelarServerConfig["build"] {
  if (value !== undefined && (!value || typeof value !== "object" || Array.isArray(value))) {
    throw new Error(`${manifestPath}: 'server.build' must be an object`);
  }
  const build = value as {readonly sourceMaps?: unknown} | undefined;
  if (build) knownFields(build as Record<string, unknown>, new Set(["sourceMaps"]), "server.build", manifestPath);
  const sourceMaps = build?.sourceMaps === undefined ? false : build.sourceMaps;
  if (typeof sourceMaps !== "boolean") throw new Error(`${manifestPath}: 'server.build.sourceMaps' must be a boolean`);
  return Object.freeze({sourceMaps});
}

function stringField(value: unknown, field: string, fallback: string, maximum: number): string {
  if (value === undefined) return fallback;
  if (typeof value !== "string" || value.length === 0 || value.length > maximum || value.includes("\0")) {
    throw new Error(`'${field}' must be a bounded non-empty string`);
  }
  return value;
}

function knownFields(value: Record<string, unknown>, allowed: ReadonlySet<string>, field: string, manifestPath: string): void {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw new Error(`${manifestPath}: unknown '${field}' field '${key}'`);
  }
}
