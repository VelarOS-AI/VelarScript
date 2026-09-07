/**
 * The entry point into an installed package's declarations: which package a
 * specifier names, which file in it declares that subpath's types, and the
 * polite degradation when a declared `types` path cannot be read.
 */
import { realpath, stat } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { resolveInstalledPackageRoot } from "../installed-package.ts";
import {
  MAX_PACKAGE_MANIFEST_BYTES,
  readTypeScriptDeclarationSource,
  type TypeScriptDeclarationReadOperations,
} from "../typescript-declaration-source.ts";
import { emptyDeclarationBridge, unique, type TypeScriptDeclarationBridge } from "./bridge.ts";
import {
  declarationFileCandidates,
  insideRoot,
  isDeclarationFile,
  loadTypeScriptDeclarationGraph,
} from "./graph.ts";
import { exportedTypes, packageNameOf, stringValue } from "./package-exports.ts";

export async function loadTypeScriptDeclarations(source: string, importerPath: string, operations: TypeScriptDeclarationReadOperations = {}): Promise<TypeScriptDeclarationBridge | null> {
  if (source.startsWith(".") || source.startsWith("/") || source.startsWith("#")) return null;
  const packageName = packageNameOf(source);
  const subpath = source === packageName ? "." : `.${source.slice(packageName.length)}`;
  const require = createRequire(pathToFileURL(join(dirname(importerPath), "__velar_types__.js")));
  let root: string;
  try {
    root = await resolveInstalledPackageRoot(packageName, source, require);
  } catch {
    return null;
  }
  let runtimeEntry: string | null = null;
  try {
    runtimeEntry = require.resolve(source);
  } catch {
    // An ESM-only package can still publish a complete `types` condition.
  }
  const manifestPath = join(root, "package.json");
  let manifest: {
    readonly name?: unknown;
    readonly types?: unknown;
    readonly typings?: unknown;
    readonly exports?: unknown;
  };
  try {
    manifest = JSON.parse((await readTypeScriptDeclarationSource(manifestPath, MAX_PACKAGE_MANIFEST_BYTES, "package manifest", operations, true)).text) as typeof manifest;
  } catch {
    return null;
  }
  if (manifest.name !== undefined && manifest.name !== packageName) return null;
  const declared = exportedTypes(manifest.exports, subpath)
    ?? (subpath === "." ? stringValue(manifest.types) ?? stringValue(manifest.typings) : null);
  const path = await firstDeclarationEntry(root, declared, runtimeEntry, subpath === ".");
  if (!path) {
    // BRG-U3: a declared types path that cannot be read fires the polite
    // degradation notice instead of degrading in silence.
    if (declared !== null) {
      return {
        ...emptyDeclarationBridge(manifestPath, `package '${packageName}' declares types '${declared}', but that is not a readable declaration file inside the package; the import is typed as unknown`),
        unreadableDeclaredTypes: true,
      };
    }
    return null;
  }
  try {
    const bridge = await loadTypeScriptDeclarationGraph(root, path, packageName, source, operations);
    return { ...bridge, dependencies: [...unique([manifestPath, ...bridge.dependencies])].sort() };
  } catch {
    return null;
  }
}

async function firstDeclarationEntry(root: string, declared: string | null, runtimeEntry: string | null, rootFallback: boolean): Promise<string | null> {
  const rootPath = await realpath(root);
  const candidates: string[] = [];
  if (declared && !isAbsolute(declared)) {
    const target = resolve(root, declared);
    if (insideRoot(root, target)) candidates.push(...declarationFileCandidates(target));
  }
  if (runtimeEntry) candidates.push(...declarationFileCandidates(runtimeEntry));
  if (rootFallback) candidates.push(join(root, "index.d.ts"), join(root, "index.d.mts"), join(root, "index.d.cts"));
  for (const candidate of unique(candidates)) {
    try {
      const path = await realpath(candidate);
      if (!insideRoot(rootPath, path) || !isDeclarationFile(path) || !(await stat(path)).isFile()) continue;
      return path;
    } catch {
      // Try the next declaration convention.
    }
  }
  return null;
}
