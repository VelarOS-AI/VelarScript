export interface VelarServerConfig {
  /** Project-root-relative runtime configuration copied to the same build path. */
  readonly configuration: string;
}

export const velarProjectExtension = Object.freeze({
  id: "@velarscript/server",
  manifestKey: "server",
  parse(value: unknown, manifestPath: string): VelarServerConfig {
    return serverConfig(value, manifestPath);
  },
});

function serverConfig(value: unknown, manifestPath: string): VelarServerConfig {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${manifestPath}: 'server' must be an object`);
  }
  const server = value as {readonly configuration?: unknown};
  knownFields(server as Record<string, unknown>, new Set(["configuration"]), "server", manifestPath);
  return Object.freeze({configuration: configurationPath(server.configuration, manifestPath)});
}

function configurationPath(value: unknown, manifestPath: string): string {
  if (typeof value !== "string" || value.length === 0 || value.length > 1024 || value.includes("\0")) {
    throw new Error(`${manifestPath}: 'server.configuration' must be bounded non-empty text`);
  }
  if (value.startsWith("/") || /^[A-Za-z]:[\\/]/u.test(value) || value.includes("\\")) {
    throw new Error(`${manifestPath}: 'server.configuration' must be a project-relative path using '/' separators`);
  }
  const segments = value.split("/");
  if (segments.some((segment) => segment.length === 0 || segment === "." || segment === "..")) {
    throw new Error(`${manifestPath}: 'server.configuration' must stay inside the project root`);
  }
  if (!/\.(?:json|ya?ml)$/iu.test(value)) {
    throw new Error(`${manifestPath}: 'server.configuration' must end in .yml, .yaml, or .json`);
  }
  return value;
}

function knownFields(value: Record<string, unknown>, allowed: ReadonlySet<string>, field: string, manifestPath: string): void {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw new Error(`${manifestPath}: unknown '${field}' field '${key}'`);
  }
}
