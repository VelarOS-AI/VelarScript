export const CURRENT_PROJECT_FORMAT_VERSION = 2;

export const CORE_PROJECT_MANIFEST_FIELDS = Object.freeze([
  "formatVersion",
  // D114 F9-node-cli residual 1 — what this project calls itself. A Node build
  // bakes it into `velar/serve`'s project identity, which is what keeps an
  // output from being talked into serving a stranger's directory. Optional, and
  // deliberately not a `formatVersion` bump for the same reason `surfaces`
  // below is not one: an added optional key leaves every manifest written
  // before it loading exactly as it did.
  "name",
  "kind",
  "entry",
  "outDir",
  "publicDir",
  "build",
  "extensions",
  "workers",
  // D110 rule 5. Optional, and deliberately not a `formatVersion` bump: the key
  // is additive, so every manifest written before it keeps loading. Making it
  // mandatory would be formatVersion 2 → 3, and that is a separate ruling the
  // decision explicitly declines to make — in practice every manifest in this
  // repository carries it, and a format break buys nothing on top of that.
  "surfaces",
] as const);

/** Internal standard-module config carrying logical worker names to output paths. */
export { CORE_WORKER_CONFIG_KEY } from "@velarscript/core";

const reservedExtensionManifestKeys = new Set<string>([
  ...CORE_PROJECT_MANIFEST_FIELDS,
  "__proto__",
  "constructor",
  "prototype",
]);

export function isReservedExtensionManifestKey(value: string): boolean {
  return reservedExtensionManifestKeys.has(value);
}

/**
 * The longest `name` a manifest may declare.
 *
 * A project name is text a person reads, not an npm package name, and a Node
 * build carries it into the emitted `velar/serve` as `name:<name>` — so it is
 * bounded here, once, and 100 characters is more than a name meant to be read
 * ever needs.
 */
export const MAX_PROJECT_NAME_LENGTH = 100;

/** Every Unicode control character, which is what a project name may not carry. */
const CONTROL_CHARACTER = /\p{Cc}/u;

/**
 * D114 F9-node-cli residual 1: `name` is optional, and a manifest that declares
 * one has to mean it.
 *
 * NO-D1 gave every Node output a baked project identity, so that a `dist/`
 * standing beside a stranger's directory cannot publish the stranger's files as
 * its own — and left one case open: two projects that both take the default
 * entry share the identity `entry:src/main.vel`, and either one's output
 * believes the other's project. `name` is how a project says which one it is.
 *
 * That is worth nothing unless the name is the one its author reads out of the
 * file. An empty string is not a name; whitespace at either end is invisible in
 * every renderer a manifest is read through, and would be the difference
 * between two identities that look identical; a control character is text no
 * terminal shows. Each is refused rather than trimmed, because a build must
 * bake what the manifest says and not a cleaned-up reading of it.
 *
 * The refusal names the whole rule instead of the clause that failed: an author
 * who wrote one of these wants to be told what a name is, and the rule is one
 * short sentence.
 */
export function assertProjectName(value: unknown, manifestPath: string): void {
  if (value === undefined) return;
  if (typeof value !== "string" || value.length === 0 || value.length > MAX_PROJECT_NAME_LENGTH
    || value.trim() !== value || CONTROL_CHARACTER.test(value)) {
    throw new Error(`${manifestPath}: 'name' must be a non-empty string of at most ${MAX_PROJECT_NAME_LENGTH} characters, with no control characters and no leading or trailing whitespace`);
  }
}

/**
 * A manifest this toolchain cannot read, said in the direction it is wrong in.
 * The two directions need different actions from the author — a newer manifest
 * wants a newer toolchain, an older one is a format this compiler no longer
 * reads — and one "unsupported formatVersion" sentence told them neither. The
 * opening clause is unchanged so the phrase every caller already reports, and
 * every test already matches, still names the field and the number.
 */
export function unsupportedProjectFormat(formatVersion: number): string {
  return formatVersion > CURRENT_PROJECT_FORMAT_VERSION
    ? `unsupported formatVersion ${formatVersion}: newer than this toolchain supports (${CURRENT_PROJECT_FORMAT_VERSION}); upgrade @velarscript/cli`
    : `unsupported formatVersion ${formatVersion}: no longer supported by this toolchain (${CURRENT_PROJECT_FORMAT_VERSION})`;
}
