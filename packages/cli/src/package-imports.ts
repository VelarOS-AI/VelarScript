import { realpath, stat } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { readBoundedText } from "./bounded-text.ts";
import { npmPackageNameFromSpecifier } from "./package-name.ts";
import { BROWSER_ESM_PACKAGE_CONDITIONS, NODE_ESM_PACKAGE_CONDITIONS } from "./package-exports.ts";

const MAX_PACKAGE_MANIFEST_BYTES = 1024 * 1024;
const MAX_PACKAGE_IMPORTS = 4096;
const PACKAGE_IMPORT_CONDITIONS: Readonly<Record<JavaScriptPackageTarget, ReadonlySet<string>>> = {
  browser: BROWSER_ESM_PACKAGE_CONDITIONS,
  node: NODE_ESM_PACKAGE_CONDITIONS,
};

export type JavaScriptPackageTarget = "browser" | "node";

export interface JavaScriptPackageManifest {
  readonly name?: string;
  readonly version?: string;
  readonly type?: string;
  readonly exports?: unknown;
  readonly imports?: unknown;
  readonly browser?: unknown;
  readonly module?: unknown;
  readonly main?: unknown;
}

export interface ResolvedPackageImportsSpecifier {
  readonly ownerRoot: string;
  readonly ownerManifestPath: string;
  readonly ownerManifest: JavaScriptPackageManifest;
  readonly target:
    | { readonly kind: "file"; readonly path: string }
    | { readonly kind: "external"; readonly specifier: string };
}

/** Resolves one `#` alias with the conditions of the emitted JavaScript host. */
export async function resolvePackageImportsSpecifier(
  specifier: string,
  baseDirectory: string,
  target: JavaScriptPackageTarget,
): Promise<ResolvedPackageImportsSpecifier> {
  assertPackageImportsSpecifier(specifier);
  const owner = await packageImportsOwner(baseDirectory);
  const conditions = PACKAGE_IMPORT_CONDITIONS[target];
  const selected = resolveImportsTarget(specifier, owner.ownerManifest.imports, conditions, new Set());
  if (selected.startsWith("#")) {
    throw new Error(`package.json#imports alias '${specifier}' did not resolve beyond '${selected}'`);
  }
  if (!selected.startsWith("./")) {
    return { ...owner, target: { kind: "external", specifier: selected } };
  }
  const path = resolve(owner.ownerRoot, selected);
  assertInsideOwner(path, owner.ownerRoot, `package.json#imports target '${selected}'`);
  let identity: string;
  try {
    identity = await realpath(path);
    if (!(await stat(identity)).isFile()) throw new Error("not an ordinary file");
  } catch (error) {
    throw new Error(`package.json#imports target '${selected}' does not resolve to an ordinary file: ${error instanceof Error ? error.message : String(error)}`);
  }
  assertInsideOwner(identity, owner.ownerRoot, `package.json#imports target '${selected}'`);
  return { ...owner, target: { kind: "file", path: identity } };
}

interface PackageImportsOwner {
  readonly ownerRoot: string;
  readonly ownerManifestPath: string;
  readonly ownerManifest: JavaScriptPackageManifest;
}

async function packageImportsOwner(baseDirectory: string): Promise<PackageImportsOwner> {
  let current = resolve(baseDirectory);
  while (true) {
    const manifestPath = join(current, "package.json");
    try {
      if ((await stat(manifestPath)).isFile()) {
        const root = await realpath(current);
        const manifest = JSON.parse(await readBoundedText(
          manifestPath,
          MAX_PACKAGE_MANIFEST_BYTES,
          "package.json#imports owner manifest",
        )) as JavaScriptPackageManifest;
        return { ownerRoot: root, ownerManifestPath: manifestPath, ownerManifest: manifest };
      }
    } catch (error) {
      if (!(error && typeof error === "object" && "code" in error && error.code === "ENOENT")) throw error;
    }
    const parent = dirname(current);
    if (parent === current) throw new Error("no package.json above the importing module declares an 'imports' map");
    current = parent;
  }
}

function resolveImportsTarget(
  specifier: string,
  imports: unknown,
  conditions: ReadonlySet<string>,
  seen: Set<string>,
): string {
  if (seen.has(specifier)) throw new Error(`package.json#imports aliases contain a cycle at '${specifier}'`);
  seen.add(specifier);
  const map = importsMap(imports);
  const match = matchedImportsEntry(specifier, map);
  if (!match) throw new Error(`package.json#imports does not define '${specifier}' for the active target`);
  const selected = selectImportsTarget(match.value, match.replacement, conditions);
  if (selected === null) throw new Error(`package.json#imports blocks '${specifier}' for the active target`);
  if (selected === undefined) throw new Error(`package.json#imports does not define '${specifier}' for the active target`);
  const normalized = assertPackageImportsTarget(selected);
  return normalized.startsWith("#") ? resolveImportsTarget(normalized, imports, conditions, seen) : normalized;
}

function importsMap(value: unknown): ReadonlyMap<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("package.json#imports must be an object");
  }
  const entries = Object.entries(value);
  if (entries.length > MAX_PACKAGE_IMPORTS) throw new RangeError(`package.json#imports cannot contain more than ${MAX_PACKAGE_IMPORTS} entries`);
  for (const [key] of entries) {
    assertPackageImportsSpecifier(key);
    if ((key.match(/\*/gu) ?? []).length > 1) throw new Error(`package.json#imports key '${key}' cannot contain more than one '*'`);
  }
  return new Map(entries);
}

function matchedImportsEntry(
  specifier: string,
  imports: ReadonlyMap<string, unknown>,
): { readonly value: unknown; readonly replacement: string } | null {
  if (imports.has(specifier)) return { value: imports.get(specifier), replacement: "" };
  let best: { readonly key: string; readonly value: unknown; readonly replacement: string } | null = null;
  for (const [key, value] of imports) {
    const star = key.indexOf("*");
    if (star === -1) continue;
    const prefix = key.slice(0, star), suffix = key.slice(star + 1);
    if (!specifier.startsWith(prefix) || !specifier.endsWith(suffix)
      || specifier.length < prefix.length + suffix.length) continue;
    const candidate = { key, value, replacement: specifier.slice(prefix.length, specifier.length - suffix.length) };
    if (!best || prefix.length > best.key.indexOf("*")
      || (prefix.length === best.key.indexOf("*") && key.length > best.key.length)) best = candidate;
  }
  return best ? { value: best.value, replacement: best.replacement } : null;
}

class InvalidPackageImportsTargetError extends Error {}

function selectImportsTarget(
  value: unknown,
  replacement: string,
  conditions: ReadonlySet<string>,
): string | null | undefined {
  if (value === null) return null;
  if (typeof value === "string") return assertPackageImportsTarget(value.replaceAll("*", replacement));
  if (Array.isArray(value)) {
    let deferred: InvalidPackageImportsTargetError | null = null;
    let blocked = false;
    for (const item of value) {
      try {
        const selected = selectImportsTarget(item, replacement, conditions);
        if (typeof selected === "string") return selected;
        if (selected === null) blocked = true;
      } catch (error) {
        if (!(error instanceof InvalidPackageImportsTargetError)) throw error;
        deferred = error;
      }
    }
    if (deferred) throw deferred;
    return blocked ? null : undefined;
  }
  if (typeof value !== "object") throw new InvalidPackageImportsTargetError("package.json#imports target must be a string, object, array, or null");
  const keys = Object.keys(value);
  if (keys.some((key) => /^(?:0|[1-9][0-9]*)$/u.test(key))) {
    throw new Error("package.json#imports condition objects cannot use integer property keys");
  }
  for (const [condition, nested] of Object.entries(value as Record<string, unknown>)) {
    if (condition !== "default" && !conditions.has(condition)) continue;
    const selected = selectImportsTarget(nested, replacement, conditions);
    if (selected !== undefined) return selected;
  }
  return undefined;
}

function assertPackageImportsSpecifier(value: string): void {
  if (!value.startsWith("#") || value === "#" || value.startsWith("#/")
    || value.includes("\\") || /[\u0000-\u001f\u007f?%]/u.test(value)
    || value.split("/").some((part) => part === "." || part === ".." || part.toLowerCase() === "node_modules")) {
    throw new Error(`invalid package.json#imports specifier '${value}'`);
  }
}

function assertPackageImportsTarget(value: string): string {
  if (value.startsWith("#")) {
    assertPackageImportsSpecifier(value);
    return value;
  }
  if (value.startsWith("./")) {
    if (value.includes("\\") || /[\u0000-\u001f\u007f%?#]/u.test(value)) {
      throw new InvalidPackageImportsTargetError(`invalid package.json#imports target '${value}'`);
    }
    const parts = value.slice(2).split("/");
    if (parts.some((part) => part === "" || part === "." || part === ".." || part.toLowerCase() === "node_modules")) {
      throw new InvalidPackageImportsTargetError(`invalid package.json#imports target '${value}'`);
    }
    return value;
  }
  if (value.startsWith("../") || value.startsWith("/") || value.includes("\\") || isAbsolute(value)
    || /[\u0000-\u001f\u007f%?#]/u.test(value)) {
    throw new InvalidPackageImportsTargetError(`invalid package.json#imports target '${value}'`);
  }
  if (value.startsWith("node:")) return value;
  let packageName: string;
  try {
    packageName = npmPackageNameFromSpecifier(value, `package.json#imports target '${value}'`);
  } catch (error) {
    throw new InvalidPackageImportsTargetError(error instanceof Error ? error.message : String(error));
  }
  const subpath = value.slice(packageName.length);
  if (subpath !== "" && (!subpath.startsWith("/")
    || subpath.slice(1).split("/").some((part) => part === "" || part === "." || part === ".." || part.toLowerCase() === "node_modules"))) {
    throw new InvalidPackageImportsTargetError(`invalid package.json#imports target '${value}'`);
  }
  return value;
}

function assertInsideOwner(path: string, root: string, label: string): void {
  const fromRoot = relative(root, path);
  if (!fromRoot || fromRoot === ".." || fromRoot.startsWith(`..${sep}`) || isAbsolute(fromRoot)) {
    throw new Error(`${label} escapes its package directory`);
  }
}
