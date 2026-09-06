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

/** Deepest output directory a build may bake an offset for. */
const MAX_PROJECT_ROOT_OFFSET_SEGMENTS = 64;

/**
 * D114 F7-node-b item 2: the path from the directory an emitted entry lands in
 * back to the project root, in the one form the emitted `velar/serve` can join
 * onto `import.meta.dirname` — a `..` chain with `/` separators — or `""` for
 * "there is no offset", which leaves the entry's own directory as the only
 * candidate a relative static root resolves to.
 *
 * Only a pure `..` chain is baked, which is to say: only an output directory
 * *inside* the project. That is a fact about how deep the output sits, not
 * about where the checkout is, so two builds of one project write the same
 * bytes wherever either one runs — the property `output-fingerprint.lock` and
 * `velar verify` both rest on. An `--out-dir` somewhere else on the machine
 * would need the checkout's own absolute path to name the project root, and an
 * output that far from its project is already a relocated artifact: `""` says
 * so, and its assets are the ones sitting beside the entry.
 */
export function portableProjectRootOffset(value: unknown): string {
  if (typeof value !== "string" || value.length === 0) return "";
  const segments = value.replaceAll("\\", "/").split("/");
  if (segments.length > MAX_PROJECT_ROOT_OFFSET_SEGMENTS) return "";
  return segments.every((segment) => segment === "..") ? segments.join("/") : "";
}

/**
 * The extension config the emitted `velar/serve` is rendered from, carrying the
 * offset this output directory sits at.
 *
 * It is not a manifest field and `nodeConfig` still refuses every `node` key: a
 * project cannot write this, because it is a fact about the directory *a build*
 * chose, not about the project. `velar/server`'s `artifactConfiguration`
 * reaches its runtime by the same build-only door.
 */
export function nodeProjectRootOffsetConfig(
  extensionConfig: ReadonlyMap<string, unknown>,
  offset: string,
): ReadonlyMap<string, unknown> {
  const projectRootOffset = portableProjectRootOffset(offset);
  if (projectRootOffset === "") return extensionConfig;
  const existing = extensionConfig.get("@velarscript/node");
  const configured = new Map(extensionConfig);
  configured.set("@velarscript/node", Object.freeze({
    ...(existing && typeof existing === "object" && !Array.isArray(existing) ? existing : {}),
    projectRootOffset,
  }));
  return configured;
}
