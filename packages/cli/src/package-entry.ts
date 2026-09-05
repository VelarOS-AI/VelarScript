import { isAbsolute } from "node:path";

/** The root package export or one exact npm package subpath. */
export type VelarPackageSubpath = "." | `./${string}`;

const MAX_PACKAGE_ENTRIES = 256;
const PACKAGE_SUBPATH = /^\.\/[A-Za-z0-9][A-Za-z0-9._/-]*$/u;

/**
 * One package-owned parser for `velar.entry` and `velar.entries`.
 *
 * Callers still own resolving the returned source paths inside the package,
 * but checking, source fallback, and frozen-artifact builds must agree on the
 * exact public specifiers and source spellings before they do so.
 */
export function parseVelarPackageEntrySources(
  rootEntry: unknown,
  entries: unknown,
  label = "package.json#velar",
): ReadonlyMap<VelarPackageSubpath, string> {
  const root = velarSourceEntry(rootEntry, `${label}.entry`);
  const output = new Map<VelarPackageSubpath, string>([[".", root]]);
  if (entries === undefined) return output;
  if (entries === null || typeof entries !== "object" || Array.isArray(entries)) {
    throw new Error(`${label}.entries must be an object mapping exact package subpaths to .vel source files`);
  }
  const declarations = Object.entries(entries as Record<string, unknown>);
  if (declarations.length > MAX_PACKAGE_ENTRIES - 1) {
    throw new RangeError(`${label}.entries cannot declare more than ${MAX_PACKAGE_ENTRIES - 1} subpath entries`);
  }
  for (const [subpath, sourceEntry] of declarations) {
    assertVelarPackageEntrySubpath(subpath, `${label}.entries key '${subpath}'`);
    output.set(subpath, velarSourceEntry(sourceEntry, `${label}.entries.${subpath}`));
  }
  return output;
}

/** Validates one explicit non-root VelarScript package subpath. */
export function assertVelarPackageSubpath(value: string, label: string): asserts value is `./${string}` {
  if (!PACKAGE_SUBPATH.test(value) || value.includes("*")
    || value.slice(2).split("/").some((part) => part === "" || part === "." || part === "..")) {
    throw new Error(`${label} must be an exact './name' package subpath without wildcards or traversal`);
  }
}

/** Validates one public source or artifact entry subpath. */
export function assertVelarPackageEntrySubpath(value: string, label: string): asserts value is `./${string}` {
  assertVelarPackageSubpath(value, label);
  if (value.endsWith(".vel")) {
    throw new Error(`${label} must not end with .vel`);
  }
}

function velarSourceEntry(value: unknown, label: string): string {
  if (typeof value !== "string" || value === "" || /[\u0000-\u001f\u007f]/u.test(value) || isAbsolute(value) || value.includes("\\")
    || value.split("/").some((part) => part === "" || part === "." || part === "..")) {
    throw new Error(`${label} must be a normalized package-relative .vel source path`);
  }
  if (!value.endsWith(".vel")) throw new Error(`${label} must point to a .vel source file`);
  return value;
}
