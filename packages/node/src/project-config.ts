export interface VelarNodeConfig {
  /** Exported zero-argument server startup function in the project entry module. */
  readonly app: string;
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
    readonly build?: unknown;
  } | undefined;
  if (node) knownFields(node as Record<string, unknown>, new Set(["app", "build"]), "node", manifestPath);
  const app = stringField(node?.app, "node.app", "start", 128);
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/u.test(app)) {
    throw new Error(`${manifestPath}: 'node.app' must name an exported VelarScript binding`);
  }
  return Object.freeze({
    app,
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
