export const CURRENT_PROJECT_FORMAT_VERSION = 2;

export const CORE_PROJECT_MANIFEST_FIELDS = Object.freeze([
  "formatVersion",
  "entry",
  "outDir",
  "publicDir",
  "extensions",
  "workers",
] as const);

/** Internal standard-module config carrying logical worker names to output paths. */
export const CORE_WORKER_CONFIG_KEY = "velar:core-workers-v1";

const reservedExtensionManifestKeys = new Set<string>([
  ...CORE_PROJECT_MANIFEST_FIELDS,
  "__proto__",
  "constructor",
  "prototype",
]);

export function isReservedExtensionManifestKey(value: string): boolean {
  return reservedExtensionManifestKeys.has(value);
}
