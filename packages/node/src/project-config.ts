export interface VelarNodeConfig {}

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
  if (value) knownFields(value as Record<string, unknown>, new Set(), "node", manifestPath);
  return Object.freeze({});
}

function knownFields(value: Record<string, unknown>, allowed: ReadonlySet<string>, field: string, manifestPath: string): void {
  for (const key of Object.keys(value)) if (!allowed.has(key)) throw new Error(`${manifestPath}: unknown '${field}' field '${key}'`);
}
