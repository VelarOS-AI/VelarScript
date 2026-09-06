import type { VelarProjectConfig } from "./config.ts";

const NODE_EXTENSION_ID = "@velarscript/node";
const SERVER_EXTENSION_ID = "@velarscript/server";

/** The host-facing Node application fields derived from checked extensions. */
export interface NodeApplicationConfig {
  readonly configuration: string | null;
}

/**
 * Identifies a Node-hosted application without importing the runner, bundler,
 * or test sandbox. Editor and project-policy code use this lightweight owner.
 */
export function nodeApplicationConfig(config: VelarProjectConfig): NodeApplicationConfig | null {
  if (config.kind !== "application"
    || !config.compilerExtensions.some((extension) => extension.capabilities?.includes("node"))
    || config.framework) return null;
  const server = config.extensionConfig.get(SERVER_EXTENSION_ID);
  if (server && typeof server === "object") {
    const configuration = (server as { readonly configuration?: unknown }).configuration;
    if (typeof configuration !== "string") {
      throw new Error("the Server extension did not provide its checked configuration path");
    }
    return { configuration };
  }
  const value = config.extensionConfig.get(NODE_EXTENSION_ID);
  return value && typeof value === "object" ? { configuration: null } : null;
}

/** Adds the build-only path that velar/server resolves from the emitted runtime package. */
export function serverArtifactExtensionConfig(
  extensionConfig: ReadonlyMap<string, unknown>,
  artifactConfiguration: string | null,
): ReadonlyMap<string, unknown> {
  if (artifactConfiguration === null) return extensionConfig;
  const server = extensionConfig.get(SERVER_EXTENSION_ID);
  if (!server || typeof server !== "object" || Array.isArray(server)) {
    throw new Error("the Server extension did not provide its checked configuration path");
  }
  const configured = new Map(extensionConfig);
  configured.set(SERVER_EXTENSION_ID, Object.freeze({
    ...server,
    artifactConfiguration,
  }));
  return configured;
}
