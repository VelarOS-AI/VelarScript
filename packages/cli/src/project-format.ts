export const CURRENT_PROJECT_FORMAT_VERSION = 2;

export const CORE_PROJECT_MANIFEST_FIELDS = Object.freeze([
  "formatVersion",
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
