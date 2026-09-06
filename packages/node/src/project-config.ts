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

/** Longest identity a build bakes, and the longest one a candidate may claim. */
const MAX_PROJECT_IDENTITY_CODE_UNITS = 1024;

/**
 * D114 F9-node-cli, audit NO-D1: who the project directory beside an output has
 * to be before that output will serve files out of it.
 *
 * The offset above says *where* the project root would be; it cannot say
 * *whether the directory there is this application's project*. Nothing did, and
 * the answer was taken from `stat().isDirectory()` alone — so a `dist/` copied
 * into `deploy/` beside a stranger's `deploy/public/` published the stranger's
 * files as its own assets, including files the application never had.
 *
 * So the build bakes an identity and the emitted `velar/serve` re-derives it
 * from the `velar.json` it actually finds at `<entry>/<offset>`: the manifest's
 * `name` when it declares one, and otherwise the project-relative path of the
 * entry it names. This function is the one definition of that derivation —
 * `velar/serve` carries its **source** (`NODE_PROJECT_IDENTITY_SOURCE`), the
 * same treatment `routeShapeFromSegments` gets, so the two referees cannot
 * drift. Its body uses only indexed access, `.length` and primitive string
 * concatenation, because the Realm that re-derives it assumes every prototype
 * is hostile.
 *
 * The identity is a path rather than a digest of the manifest's bytes on
 * purpose: it must not change when a field of `velar.json` that has nothing to
 * do with identity is edited, or an output already built would quietly stop
 * recognising the project it came from.
 */
export function nodeProjectIdentity(name: unknown, entry: unknown): string {
  const named = typeof name === "string" && name.length > 0 && name.length <= 214 ? name : "";
  if (named !== "") return `name:${named}`;
  const declared = typeof entry === "string" && entry.length > 0 && entry.length <= 512 ? entry : "src/main.vel";
  let path = "";
  for (let index = 0; index < declared.length; index += 1) path += declared[index] === "\\" ? "/" : declared[index];
  return `entry:${path}`;
}

/**
 * The same definition as JavaScript source, for the `velar/serve` template.
 * Deriving it from the compiled function keeps the rule written once: editing
 * `nodeProjectIdentity` edits both referees.
 */
export const NODE_PROJECT_IDENTITY_SOURCE: string = nodeProjectIdentity.toString();

/**
 * The identity in the one form the emitted module can carry: bounded text, or
 * `""` for "this build knew none". `""` is honest for every caller that is not
 * a build, and it leaves the offset judged by whether the directory is there —
 * which is what a project with no manifest at all, a bare `.vel` file run from
 * its own directory, has to be judged by.
 */
export function portableProjectIdentity(value: unknown): string {
  if (typeof value !== "string" || value.length === 0 || value.length > MAX_PROJECT_IDENTITY_CODE_UNITS) return "";
  return value.includes("\0") ? "" : value;
}

/**
 * The extension config the emitted `velar/serve` is rendered from, carrying the
 * offset this output directory sits at and the identity of the project it was
 * compiled from.
 *
 * Neither is a manifest field and `nodeConfig` still refuses every `node` key: a
 * project cannot write these, because they are facts about the directory *a
 * build* chose and the project it read, not settings. `velar/server`'s
 * `artifactConfiguration` reaches its runtime by the same build-only door.
 */
export function nodeProjectRootOffsetConfig(
  extensionConfig: ReadonlyMap<string, unknown>,
  offset: string,
  identity: string = "",
): ReadonlyMap<string, unknown> {
  const projectRootOffset = portableProjectRootOffset(offset);
  if (projectRootOffset === "") return extensionConfig;
  const existing = extensionConfig.get("@velarscript/node");
  const configured = new Map(extensionConfig);
  configured.set("@velarscript/node", Object.freeze({
    ...(existing && typeof existing === "object" && !Array.isArray(existing) ? existing : {}),
    projectRootOffset,
    projectIdentity: portableProjectIdentity(identity),
  }));
  return configured;
}
