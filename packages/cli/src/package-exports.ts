import type { VelarLibraryArtifactTarget } from "./library-artifact-receipt.ts";
import type { VelarPackageSubpath } from "./package-entry.ts";

export const NODE_ESM_PACKAGE_CONDITIONS: ReadonlySet<string> = new Set(["node-addons", "node", "import", "module-sync"]);
export const BROWSER_ESM_PACKAGE_CONDITIONS: ReadonlySet<string> = new Set(["browser", "import", "module"]);

/**
 * Resolves only conditions an emitted ESM artifact can actually run through.
 * A `types` or `require` branch is a separate package promise and must not be
 * mistaken for a conflicting Velar JavaScript route.
 */
export function packageRuntimeExportTargets(
  exports: unknown,
  subpath: VelarPackageSubpath,
  target: VelarLibraryArtifactTarget,
): readonly `./${string}`[] {
  const environments = target === "node"
    ? [NODE_ESM_PACKAGE_CONDITIONS]
    : [NODE_ESM_PACKAGE_CONDITIONS, BROWSER_ESM_PACKAGE_CONDITIONS];
  return packageExportTargets(exports, subpath, environments).map(exactRuntimeExportTarget);
}

/** Resolves one exact subpath under each runtime's active conditions, in declaration order. */
export function packageExportTargets(
  exports: unknown,
  subpath: VelarPackageSubpath,
  environments: readonly ReadonlySet<string>[],
): readonly string[] {
  const selected = packageExportAt(exports, subpath);
  const output: string[] = [];
  for (const conditions of environments) {
    const resolved = resolveConditionalExport(selected, conditions);
    if (resolved.kind !== "target") return [];
    if (!output.includes(resolved.value)) output.push(resolved.value);
  }
  return output;
}

/**
 * Resolves an ordinary dependency export, including one `*` package-subpath
 * pattern, under every requested runtime. Frozen Core artifacts leave these
 * imports bare, so both Node and browser must have an answering ESM branch.
 */
export function externalPackageExportTargets(
  exports: unknown,
  subpath: VelarPackageSubpath,
  environments: readonly ReadonlySet<string>[],
): readonly string[] {
  const selected = externalPackageExportAt(exports, subpath);
  const output: string[] = [];
  for (const conditions of environments) {
    const resolved = resolveConditionalExport(selected.value, conditions);
    if (resolved.kind !== "target") return [];
    const target = selected.replacement === ""
      ? resolved.value
      : resolved.value.replaceAll("*", selected.replacement);
    assertPackageExportTarget(target);
    if (!output.includes(target)) output.push(target);
  }
  return output;
}

function packageExportAt(exports: unknown, subpath: VelarPackageSubpath): unknown {
  if (typeof exports === "string" || Array.isArray(exports)) return subpath === "." ? exports : undefined;
  if (exports === null || typeof exports !== "object") return undefined;
  const fields = exports as Record<string, unknown>;
  const keys = Object.keys(fields);
  const subpathKeys = keys.filter((key) => key.startsWith("."));
  if (subpathKeys.length > 0 && subpathKeys.length !== keys.length) {
    throw new Error("package.json 'exports' cannot mix package subpath keys with condition keys in one object");
  }
  return subpathKeys.length > 0 ? fields[subpath] : subpath === "." ? exports : undefined;
}

function externalPackageExportAt(
  exports: unknown,
  subpath: VelarPackageSubpath,
): { readonly value: unknown; readonly replacement: string } {
  if (typeof exports === "string" || Array.isArray(exports)) {
    return { value: subpath === "." ? exports : undefined, replacement: "" };
  }
  if (exports === null || typeof exports !== "object") return { value: undefined, replacement: "" };
  const fields = exports as Record<string, unknown>;
  const keys = Object.keys(fields);
  const subpathKeys = keys.filter((key) => key.startsWith("."));
  if (subpathKeys.length > 0 && subpathKeys.length !== keys.length) {
    throw new Error("package.json 'exports' cannot mix package subpath keys with condition keys in one object");
  }
  if (subpathKeys.length === 0) {
    return { value: subpath === "." ? exports : undefined, replacement: "" };
  }
  if (Object.hasOwn(fields, subpath)) return { value: fields[subpath], replacement: "" };
  let selected: { readonly key: string; readonly value: unknown; readonly replacement: string } | null = null;
  for (const key of subpathKeys) {
    const star = key.indexOf("*");
    if (star === -1 || key.indexOf("*", star + 1) !== -1) continue;
    const prefix = key.slice(0, star), suffix = key.slice(star + 1);
    if (!subpath.startsWith(prefix) || !subpath.endsWith(suffix)
      || subpath.length < prefix.length + suffix.length) continue;
    const candidate = {
      key,
      value: fields[key],
      replacement: subpath.slice(prefix.length, subpath.length - suffix.length),
    };
    if (!selected || prefix.length > selected.key.indexOf("*")
      || (prefix.length === selected.key.indexOf("*") && key.length > selected.key.length)) selected = candidate;
  }
  return selected ?? { value: undefined, replacement: "" };
}

type ConditionalExportResolution =
  | { readonly kind: "target"; readonly value: string }
  | { readonly kind: "blocked" | "unmatched" };

class InvalidPackageExportTargetError extends Error {}

// Node permits an exports array to recover from a structurally invalid package
// target. An exact-path ambiguity is different: the target was selected, but
// cannot name one stable source byte path, so silently trying the next element
// would make check/build disagree with the runtime URL resolver.
class AmbiguousPackageExportTargetError extends Error {}

function resolveConditionalExport(value: unknown, conditions: ReadonlySet<string>): ConditionalExportResolution {
  if (value === undefined) return { kind: "unmatched" };
  if (typeof value === "string") {
    assertPackageExportTarget(value);
    return { kind: "target", value };
  }
  if (value === null) return { kind: "blocked" };
  if (Array.isArray(value)) {
    if (value.length === 0) return { kind: "blocked" };
    let deferred: { readonly kind: "blocked" } | InvalidPackageExportTargetError | null = null;
    for (const item of value) {
      let resolved: ConditionalExportResolution;
      try {
        resolved = resolveConditionalExport(item, conditions);
      } catch (error) {
        if (!(error instanceof InvalidPackageExportTargetError)) throw error;
        deferred = error;
        continue;
      }
      if (resolved.kind === "target") return resolved;
      if (resolved.kind === "blocked") deferred = { kind: "blocked" };
    }
    if (deferred instanceof InvalidPackageExportTargetError) throw deferred;
    return deferred ?? { kind: "unmatched" };
  }
  if (typeof value !== "object") {
    throw new InvalidPackageExportTargetError(`package.json 'exports' target must be a string, object, array, or null; received ${typeof value}`);
  }
  const keys = Object.keys(value);
  if (keys.some((key) => /^(?:0|[1-9][0-9]*)$/u.test(key))) {
    throw new Error("package.json 'exports' condition objects cannot use integer property keys because their order is not stable");
  }
  if (keys.some((key) => key.startsWith("."))) {
    throw new Error("package.json 'exports' condition objects cannot contain package subpath keys");
  }
  for (const [condition, target] of Object.entries(value as Record<string, unknown>)) {
    if (condition !== "default" && !conditions.has(condition)) continue;
    const resolved = resolveConditionalExport(target, conditions);
    if (resolved.kind !== "unmatched") return resolved;
  }
  return { kind: "unmatched" };
}

function assertPackageExportTarget(value: string): void {
  if (!value.startsWith("./")) {
    throw new InvalidPackageExportTargetError(`package.json 'exports' target '${value}' must start with './'`);
  }
  const parts = value.slice(2).split("/");
  if (parts.some((part) => part === "." || part === ".." || /^(?:%2e|\.%2e|%2e\.|%2e%2e)$/iu.test(part)
    || part.toLowerCase() === "node_modules")) {
    throw new InvalidPackageExportTargetError(`package.json 'exports' target '${value}' cannot contain traversal or node_modules path segments`);
  }
  if (value.includes("\\") || /[\u0000-\u001f\u007f%?#]/u.test(value)) {
    throw new AmbiguousPackageExportTargetError(
      `package.json 'exports' target '${value}' must be an exact normalized package-relative path`,
    );
  }
  if (parts.some((part) => part === "")) {
    throw new AmbiguousPackageExportTargetError(
      `package.json 'exports' target '${value}' cannot contain empty path segments`,
    );
  }
}

function exactRuntimeExportTarget(value: string): `./${string}` {
  if (!value.startsWith("./") || value.includes("\\") || /[\u0000-\u001f\u007f*?#%]/u.test(value)) {
    throw new Error(`Velar library runtime export '${value}' must be one exact normalized package-relative ESM file`);
  }
  const parts = value.slice(2).split("/");
  if (parts.some((part) => part === "" || part === "." || part === ".." || part.toLowerCase() === "node_modules")) {
    throw new Error(`Velar library runtime export '${value}' cannot contain empty, traversal, or node_modules path segments`);
  }
  if (!value.endsWith(".js") && !value.endsWith(".mjs")) {
    throw new Error(`Velar library runtime export '${value}' must point to an ESM .js or .mjs file`);
  }
  return value as `./${string}`;
}
