import type { VelarPackageManifest } from "../scripts/velar-packages.mjs";

// ---------------------------------------------------------------------------
// A-024 — what a published VelarScript package must contain, derived from what
// the package itself promises.
//
// `test:packages` packed a derived roster (`velarWorkspacePackageNames`) and then wrote
// the same eight names out again by hand: the content checks walked six of
// them, the clean install listed eight tarball paths, and `gate:build:packages`
// held a sixth copy. The commit that derived the roster said a new package
// "joins the gate the day it exists"; that was true of `pack()` and of nothing
// after it. A publishable package with no LICENSE, no README, no `dist`, and an
// `exports` pointing at a file that does not exist passed the whole gate with
// exit 0 while a real consumer importing it got ERR_MODULE_NOT_FOUND.
//
// So the contract below asks the manifest, not a list. Every path a manifest
// promises a consumer — `main`, `types`, `bin`, every string leaf of `exports`,
// `velar.entry` — must be inside the tarball, and every specifier those
// promises create must resolve after a clean install. A package that publishes
// a new export subpath is checked for it without anybody editing this file, and
// a package added to the workspace is checked at all.
// ---------------------------------------------------------------------------

/** One file inside a packed tarball, as `npm pack --json` reports it. */
export interface PackedFile {
  readonly path: string;
}

/** One packed tarball, as `npm pack --json` reports it. */
export interface PackedPackage {
  readonly filename: string;
  readonly files: readonly PackedFile[];
}

/** Every file path a manifest promises a consumer, in declaration order. */
export function declaredEntryPaths(manifest: VelarPackageManifest): string[] {
  const paths: string[] = [];
  const add = (value: unknown): void => {
    if (typeof value !== "string" || value === "") return;
    const path = value.startsWith("./") ? value.slice(2) : value;
    if (!paths.includes(path)) paths.push(path);
  };
  add(manifest.main);
  add(manifest.types);
  // `exports` is a tree of conditions whose leaves are all file targets, so the
  // walk is structural: a condition this file has never heard of is still read.
  const walk = (value: unknown): void => {
    if (typeof value === "string") return add(value);
    if (Array.isArray(value)) return void value.forEach(walk);
    if (value !== null && typeof value === "object") return void Object.values(value).forEach(walk);
  };
  walk(manifest.exports);
  if (typeof manifest.bin === "string") add(manifest.bin);
  else for (const value of Object.values(manifest.bin ?? {})) add(value);
  add(manifest.velar?.entry);
  return paths;
}

/**
 * The import specifiers a clean consumer must be able to resolve. A `.vel`
 * source package publishes no JavaScript entry point — the Vel toolchain reads
 * its `velar.entry` — so it contributes none, and its entry file is checked as
 * a path instead.
 */
export function declaredImportSpecifiers(manifest: VelarPackageManifest): string[] {
  const exports = manifest.exports;
  if (typeof exports === "string") return [manifest.name];
  if (exports === null || typeof exports !== "object" || Array.isArray(exports)) {
    return manifest.main !== undefined ? [manifest.name] : [];
  }
  const specifiers: string[] = [];
  for (const key of Object.keys(exports)) {
    // A subpath key starts with '.'; anything else is a condition name at the
    // top level, which means the whole object describes the '.' entry.
    if (!key.startsWith(".")) return [manifest.name];
    if (key.includes("*")) continue;
    specifiers.push(key === "." ? manifest.name : `${manifest.name}/${key.slice(2)}`);
  }
  return specifiers;
}

/** A `*` target matched against the tarball's file list. */
function matchesPattern(pattern: string, paths: readonly string[]): boolean {
  const expression = new RegExp(`^${pattern.split("*").map((part) => part.replaceAll(/[.*+?^${}()|[\]\\]/gu, "\\$&")).join("[^\\n]*")}$`, "u");
  return paths.some((path) => expression.test(path));
}

/**
 * Everything wrong with one published package, as a list of sentences. Empty
 * means the package satisfies what it promises; the caller decides how loudly
 * to say so.
 */
export function packageContentFailures(manifest: VelarPackageManifest, packed: PackedPackage): string[] {
  const paths = packed.files.map((file) => file.path);
  const failures: string[] = [];
  const has = (path: string): boolean => paths.includes(path);
  // Every published package carries its licence and its public README. Neither
  // is declared in `files` — npm includes them — so an empty package fails here
  // before anything else is examined.
  if (!has("LICENSE")) failures.push(`${manifest.name}: the tarball carries no LICENSE`);
  if (!has("README.md")) failures.push(`${manifest.name}: the tarball carries no README.md`);
  const declared = declaredEntryPaths(manifest);
  if (declared.length === 0) {
    failures.push(`${manifest.name}: the manifest promises a consumer no entry point at all — no 'main', 'types', 'exports', 'bin' or 'velar.entry'`);
  }
  for (const path of declared) {
    const present = path.includes("*") ? matchesPattern(path, paths) : has(path);
    if (!present) failures.push(`${manifest.name}: the manifest points at '${path}', which is not in the tarball (${paths.length} file${paths.length === 1 ? "" : "s"} packed)`);
  }
  for (const path of paths) {
    if (/(?:^|\/)tests?(?:\/|$)/u.test(path)) failures.push(`${manifest.name}: the tarball ships '${path}'; tests are not published`);
  }
  return failures;
}
