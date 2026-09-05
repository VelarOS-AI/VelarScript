import { readFile, realpath, stat } from "node:fs/promises";
import { findPackageJSON, isBuiltin } from "node:module";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import {
  inspectJavaScriptModule,
  MAX_JAVASCRIPT_MODULE_SYNTAX_NODES,
} from "@velarscript/compiler";
import { readBoundedText } from "./bounded-text.ts";
import { hostErrorMessage } from "./host-error.ts";
import { assertJavaScriptDataModuleTarget } from "./javascript-data-module.ts";
import type { VelarPackageSubpath } from "./package-entry.ts";
import {
  BROWSER_ESM_PACKAGE_CONDITIONS,
  externalPackageExportTargets,
  NODE_ESM_PACKAGE_CONDITIONS,
} from "./package-exports.ts";
import {
  resolvePackageImportsSpecifier,
  type JavaScriptPackageTarget,
} from "./package-imports.ts";
import { npmPackageNameFromSpecifier } from "./package-name.ts";
import {
  assertDeclaredRuntimeDependency,
  packageRuntimeDependencyNames,
} from "./package-runtime-dependency-manifest.ts";
import { findPackageSelfReferenceRoot, nearestPackageTypeForFile } from "./package-scope.ts";
import type { VelarPackageTarget } from "./source-package-manifest.ts";

const MAX_PACKAGE_OWNED_JAVASCRIPT_MODULES = 256;
const MAX_PACKAGE_OWNED_JAVASCRIPT_BYTES = 16 * 1024 * 1024;

export interface JavaScriptSpecifierDiagnostic {
  readonly code: string;
  readonly message: string;
  readonly source: string;
}

/** Resolves one bare JavaScript bridge edge under the emitted target's conditions. */
export async function judgeJavaScriptSpecifier(
  source: string,
  importerPath: string,
  target: JavaScriptPackageTarget,
  packageTarget: VelarPackageTarget,
): Promise<JavaScriptSpecifierDiagnostic | null> {
  if (source.startsWith("velar/compiler-runtime-") && source.endsWith("-v1")) {
    return diagnostic(source, `JavaScript import ${JSON.stringify(source)} names a compiler-internal runtime module; it is emitted only as generated implementation support and cannot be imported from VelarScript source`);
  }
  if (source.startsWith("node:")) {
    return diagnostic(source, `JavaScript builtin import ${JSON.stringify(source)} is not a Node builtin; fix the specifier`);
  }
  if (source.startsWith("#")) return judgePackageImportsSpecifier(source, importerPath, target, packageTarget);
  let manifestPath: string | undefined;
  try {
    manifestPath = findPackageJSON(source, pathToFileURL(importerPath)) ?? undefined;
  } catch {
    manifestPath = undefined;
  }
  if (manifestPath === undefined) {
    return diagnostic(source, `JavaScript package import ${JSON.stringify(source)} does not resolve to an installed package; install it, or fix the specifier`);
  }
  let manifest: JavaScriptDependencyManifest;
  try {
    manifest = await readJavaScriptDependencyManifest(manifestPath, source);
  } catch (error) {
    return diagnostic(source, `JavaScript package import ${JSON.stringify(source)} has an unreadable or invalid package.json: ${hostErrorMessage(error)}`);
  }
  if (typeof manifest.velar?.entry === "string" && manifest.velar.entry.length > 0) {
    if (await isSelfJavaScriptSubpath(source, importerPath, manifestPath, manifest.velar.entries)) {
      try {
        await assertSelfJavaScriptPackageTarget(source, manifest, dirname(manifestPath), target, packageTarget);
        return null;
      } catch (error) {
        return diagnostic(source, `Package-owned JavaScript import ${JSON.stringify(source)} is not valid for the '${packageTarget}' target: ${hostErrorMessage(error)}`);
      }
    }
    return diagnostic(source, `'${packageNameOf(source)}' is a VelarScript package; import it without 'js' — import {name} from ${JSON.stringify(source)}`);
  }
  try {
    await assertJavaScriptPackageRuntime(source, manifest, dirname(manifestPath), target, packageTarget);
  } catch (error) {
    const subject = packageTarget === "core"
      ? `Core JavaScript package import ${JSON.stringify(source)} is not target-neutral`
      : `JavaScript package import ${JSON.stringify(source)} does not resolve for the '${target}' target`;
    return diagnostic(source, `${subject}: ${hostErrorMessage(error)}`);
  }
  return null;
}

async function judgePackageImportsSpecifier(
  source: string,
  importerPath: string,
  target: JavaScriptPackageTarget,
  packageTarget: VelarPackageTarget,
): Promise<JavaScriptSpecifierDiagnostic | null> {
  try {
    const targets: readonly JavaScriptPackageTarget[] = packageTarget === "core" ? ["node", "browser"] : [target];
    const resolved = await Promise.all(targets.map((environment) => (
      resolvePackageImportsSpecifier(source, dirname(importerPath), environment)
    )));
    if (packageTarget === "core" && !samePackageImportsTarget(resolved[0]!, resolved[1]!)) {
      throw new Error("Core package imports aliases must resolve to the same target under Node and browser conditions");
    }
    for (let index = 0; index < resolved.length; index += 1) {
      await assertJavaScriptPackageImportsTarget(resolved[index]!, packageTarget, targets[index]!);
    }
    return null;
  } catch (error) {
    return diagnostic(
      source,
      `JavaScript package import ${JSON.stringify(source)} is not defined by the importing project's package.json#imports map, or its target does not resolve: ${hostErrorMessage(error)}`,
    );
  }
}

interface JavaScriptDependencyManifest {
  readonly browser?: unknown;
  readonly dependencies?: unknown;
  readonly exports?: unknown;
  readonly main?: unknown;
  readonly module?: unknown;
  readonly type?: unknown;
  readonly velar?: { readonly entry?: unknown; readonly entries?: unknown };
}

type PackageImportsResolution = Awaited<ReturnType<typeof resolvePackageImportsSpecifier>>;

function samePackageImportsTarget(left: PackageImportsResolution, right: PackageImportsResolution): boolean {
  if (left.ownerRoot !== right.ownerRoot || left.target.kind !== right.target.kind) return false;
  if (left.target.kind === "file" && right.target.kind === "file") return left.target.path === right.target.path;
  return left.target.kind === "external" && right.target.kind === "external"
    && left.target.specifier === right.target.specifier;
}

async function assertJavaScriptPackageImportsTarget(
  resolved: PackageImportsResolution,
  packageTarget: VelarPackageTarget,
  resolutionTarget: JavaScriptPackageTarget,
): Promise<void> {
  if (resolved.target.kind === "file") {
    await assertPackageOwnedJavaScriptGraph(
      [resolved.target.path],
      resolved.ownerRoot,
      typeof resolved.ownerManifest.name === "string" ? resolved.ownerManifest.name : "",
      resolved.ownerManifest as JavaScriptDependencyManifest,
      resolutionTarget,
      packageTarget,
    );
    return;
  }
  if (isBuiltin(resolved.target.specifier)) {
    if (packageTarget === "node") return;
    throw new Error(`Node builtin '${resolved.target.specifier}' is available only to the Node target`);
  }
  const ownerImporter = pathToFileURL(join(resolved.ownerRoot, "__velar_package_import__.js"));
  const manifestPath = findPackageJSON(resolved.target.specifier, ownerImporter);
  if (manifestPath === undefined) {
    throw new Error(`external package '${resolved.target.specifier}' is not installed from the imports owner`);
  }
  const manifest = await readJavaScriptDependencyManifest(manifestPath, resolved.target.specifier);
  await assertJavaScriptPackageRuntime(
    resolved.target.specifier,
    manifest,
    dirname(manifestPath),
    resolutionTarget,
    packageTarget,
  );
}

async function readJavaScriptDependencyManifest(
  manifestPath: string,
  source: string,
): Promise<JavaScriptDependencyManifest> {
  const parsed: unknown = JSON.parse(await readBoundedText(
    manifestPath,
    1024 * 1024,
    `Package manifest for '${source}'`,
  ));
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new TypeError("package.json must contain a JSON object");
  }
  return parsed as JavaScriptDependencyManifest;
}

async function assertJavaScriptPackageRuntime(
  specifier: string,
  manifest: JavaScriptDependencyManifest,
  packageRoot: string,
  resolutionTarget: JavaScriptPackageTarget,
  packageTarget: VelarPackageTarget,
): Promise<void> {
  const packageName = packageNameOf(specifier);
  const subpath = (specifier === packageName ? "." : `.${specifier.slice(packageName.length)}`) as VelarPackageSubpath;
  if (manifest.exports === undefined) {
    if (packageTarget === "core") throw new Error(`package '${packageName}' has no explicit Node-and-browser ESM exports map`);
    await assertLegacyJavaScriptPackageTarget(packageName, subpath, manifest, packageRoot, resolutionTarget);
    return;
  }
  const environments = packageTarget === "core"
    ? [NODE_ESM_PACKAGE_CONDITIONS, BROWSER_ESM_PACKAGE_CONDITIONS]
    : [resolutionTarget === "node" ? NODE_ESM_PACKAGE_CONDITIONS : BROWSER_ESM_PACKAGE_CONDITIONS];
  const targets = externalPackageExportTargets(manifest.exports, subpath, environments);
  if (targets.length === 0) {
    const environment = packageTarget === "core" ? "both Node and browser" : resolutionTarget;
    throw new Error(`package '${packageName}' does not export '${subpath}' under ${environment} ESM conditions`);
  }
  for (const selected of targets) {
    const selectedPath = resolve(packageRoot, selected);
    let packageType: string | null;
    try {
      packageType = await nearestPackageTypeForFile(
        packageRoot,
        selectedPath,
        `package '${packageName}' export '${selected}'`,
      );
    } catch (error) {
      throw new Error(`package '${packageName}' export '${selected}' does not resolve to an ordinary file: ${hostErrorMessage(error)}`);
    }
    if (packageTarget === "core" && !isJavaScriptEsmTarget(selected, packageType)) {
      throw new Error(`package '${packageName}' export '${selected}' is not provably ESM for both Node and browser consumers`);
    }
  }
}

/** Validates one artifact-retained bare package without applying Velar source-import teaching. */
export async function assertExternalJavaScriptPackageTarget(
  specifier: string,
  importerPath: string,
  resolutionTarget: JavaScriptPackageTarget,
  packageTarget: VelarPackageTarget,
): Promise<void> {
  const manifestPath = findPackageJSON(specifier, pathToFileURL(importerPath));
  if (manifestPath === undefined) throw new Error(`package '${specifier}' is not installed`);
  const manifest = await readJavaScriptDependencyManifest(manifestPath, specifier);
  await assertJavaScriptPackageRuntime(specifier, manifest, dirname(manifestPath), resolutionTarget, packageTarget);
}

async function assertSelfJavaScriptPackageTarget(
  specifier: string,
  manifest: JavaScriptDependencyManifest,
  packageRoot: string,
  resolutionTarget: JavaScriptPackageTarget,
  packageTarget: VelarPackageTarget,
): Promise<void> {
  await assertJavaScriptPackageRuntime(specifier, manifest, packageRoot, resolutionTarget, packageTarget);
  const targets = javascriptPackageTargets(specifier, manifest, packageTarget, resolutionTarget);
  if (packageTarget === "core" && targets.length !== 1) {
    throw new Error("Core package self JavaScript exports must resolve to the same file under Node and browser conditions");
  }
  await assertPackageOwnedJavaScriptGraph(
    targets.map((target) => resolve(packageRoot, target)),
    packageRoot,
    packageNameOf(specifier),
    manifest,
    resolutionTarget,
    packageTarget,
  );
}

async function assertPackageOwnedJavaScriptGraph(
  entries: readonly string[],
  packageRoot: string,
  packageName: string,
  manifest: JavaScriptDependencyManifest,
  resolutionTarget: JavaScriptPackageTarget,
  packageTarget: VelarPackageTarget,
): Promise<void> {
  const rootIdentity = await realpath(packageRoot);
  const runtimeDependencies = packageRuntimeDependencyNames(
    manifest.dependencies,
    `Package '${packageName}' package.json#dependencies`,
  );
  const pending = [...entries];
  const visited = new Set<string>();
  let totalBytes = 0;
  let remainingSyntaxNodes = MAX_JAVASCRIPT_MODULE_SYNTAX_NODES;
  while (pending.length > 0) {
    const file = await packageOwnedJavaScriptFile(pending.pop()!, rootIdentity);
    const { identity } = file;
    if (visited.has(identity)) continue;
    visited.add(identity);
    if (visited.size > MAX_PACKAGE_OWNED_JAVASCRIPT_MODULES) {
      throw new RangeError(`package-owned JavaScript graph exceeds ${MAX_PACKAGE_OWNED_JAVASCRIPT_MODULES} modules`);
    }
    totalBytes += file.size;
    if (totalBytes > MAX_PACKAGE_OWNED_JAVASCRIPT_BYTES) {
      throw new RangeError(`package-owned JavaScript graph exceeds ${MAX_PACKAGE_OWNED_JAVASCRIPT_BYTES} bytes`);
    }
    const bytes = await readFile(identity);
    if (bytes.byteLength !== file.size) throw new Error(`package-owned JavaScript '${identity}' changed while it was read`);
    const code = strictJavaScriptText(bytes, identity);
    const inspection = inspectJavaScriptModule(code, { maximumSyntaxNodes: remainingSyntaxNodes });
    remainingSyntaxNodes -= inspection.syntaxNodes;
    for (const edge of inspection.edges) {
      await inspectPackageOwnedJavaScriptEdge(
        edge.source,
        identity,
        rootIdentity,
        packageName,
        manifest,
        runtimeDependencies,
        resolutionTarget,
        packageTarget,
        pending,
      );
    }
  }
}

async function inspectPackageOwnedJavaScriptEdge(
  source: string | null,
  importerPath: string,
  packageRoot: string,
  packageName: string,
  manifest: JavaScriptDependencyManifest,
  runtimeDependencies: ReadonlySet<string>,
  resolutionTarget: JavaScriptPackageTarget,
  packageTarget: VelarPackageTarget,
  pending: string[],
): Promise<void> {
  if (source === null) throw new Error("package-owned JavaScript cannot use a computed dynamic import");
  if (source.startsWith("data:")) {
    assertJavaScriptDataModuleTarget(source, packageTarget);
    return;
  }
  if (isBuiltin(source)) {
    if (packageTarget !== "node") throw new Error(`Node builtin '${source}' is available only to the Node target`);
    return;
  }
  if (source.startsWith("node:")) throw new Error(`'${source}' is not a Node builtin`);
  if (source.startsWith("./") || source.startsWith("../")) {
    pending.push(resolve(dirname(importerPath), source));
    return;
  }
  if (source.startsWith("#")) {
    const targets: readonly JavaScriptPackageTarget[] = packageTarget === "core" ? ["node", "browser"] : [resolutionTarget];
    const resolved = await Promise.all(targets.map((target) => resolvePackageImportsSpecifier(source, dirname(importerPath), target)));
    if (packageTarget === "core" && !samePackageImportsTarget(resolved[0]!, resolved[1]!)) {
      throw new Error("Core package imports aliases must resolve to the same target under Node and browser conditions");
    }
    for (let index = 0; index < resolved.length; index += 1) {
      const target = resolved[index]!.target;
      if (target.kind === "file") pending.push(target.path);
      else if (isBuiltin(target.specifier)) {
        if (packageTarget !== "node") throw new Error(`Node builtin '${target.specifier}' is available only to the Node target`);
      } else {
        assertDeclaredRuntimeDependency(target.specifier, runtimeDependencies, packageName);
        await assertExternalJavaScriptPackageTarget(target.specifier, importerPath, targets[index]!, packageTarget);
      }
    }
    return;
  }
  if (packageName !== "" && (source === packageName || source.startsWith(`${packageName}/`))) {
    const targets = javascriptPackageTargets(source, manifest, packageTarget, resolutionTarget);
    if (packageTarget === "core" && targets.length !== 1) {
      throw new Error("Core package self JavaScript exports must resolve to the same file under Node and browser conditions");
    }
    pending.push(...targets.map((target) => resolve(packageRoot, target)));
    return;
  }
  assertDeclaredRuntimeDependency(source, runtimeDependencies, packageName);
  await assertExternalJavaScriptPackageTarget(source, importerPath, resolutionTarget, packageTarget);
}

function javascriptPackageTargets(
  specifier: string,
  manifest: JavaScriptDependencyManifest,
  packageTarget: VelarPackageTarget,
  resolutionTarget: JavaScriptPackageTarget,
): readonly string[] {
  const name = packageNameOf(specifier);
  const subpath = (specifier === name ? "." : `.${specifier.slice(name.length)}`) as VelarPackageSubpath;
  const environments = packageTarget === "core"
    ? [NODE_ESM_PACKAGE_CONDITIONS, BROWSER_ESM_PACKAGE_CONDITIONS]
    : [resolutionTarget === "node" ? NODE_ESM_PACKAGE_CONDITIONS : BROWSER_ESM_PACKAGE_CONDITIONS];
  const targets = externalPackageExportTargets(manifest.exports, subpath, environments);
  if (targets.length === 0) throw new Error(`package '${name}' does not export '${subpath}' for the active target`);
  return targets;
}

async function packageOwnedJavaScriptFile(
  path: string,
  packageRoot: string,
): Promise<{ readonly identity: string; readonly size: number }> {
  const identity = await realpath(path);
  const fromRoot = relative(packageRoot, identity);
  if (!fromRoot || fromRoot === ".." || fromRoot.startsWith(`..${sep}`) || isAbsolute(fromRoot)) {
    throw new Error(`package-owned JavaScript '${path}' escapes its package root`);
  }
  const metadata = await stat(identity);
  if (!metadata.isFile()) throw new Error(`package-owned JavaScript '${path}' is not an ordinary file`);
  if (metadata.size > MAX_PACKAGE_OWNED_JAVASCRIPT_BYTES) {
    throw new RangeError(`package-owned JavaScript '${path}' exceeds ${MAX_PACKAGE_OWNED_JAVASCRIPT_BYTES} bytes`);
  }
  return { identity, size: metadata.size };
}

function strictJavaScriptText(bytes: Uint8Array, path: string): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new Error(`package-owned JavaScript '${path}' is not valid UTF-8`);
  }
}

async function assertLegacyJavaScriptPackageTarget(
  packageName: string,
  subpath: VelarPackageSubpath,
  manifest: JavaScriptDependencyManifest,
  packageRoot: string,
  target: JavaScriptPackageTarget,
): Promise<void> {
  if (target === "browser" && manifest.browser !== undefined && typeof manifest.browser !== "string") {
    throw new Error(
      `package '${packageName}' uses a legacy package.json#browser map that cannot be proved by check; expose an explicit browser ESM branch through package.json#exports`,
    );
  }
  const selected = subpath === "." ? legacyJavaScriptPackageEntry(manifest, target) : subpath.slice(2);
  const requested = selected.startsWith("./") ? selected.slice(2) : selected;
  if (requested.includes("\\") || /[\u0000-\u001f\u007f%?#]/u.test(requested) || isAbsolute(requested)
    || requested.split("/").some((part) => part === "" || part === "." || part === ".." || part.toLowerCase() === "node_modules")) {
    throw new Error(`package '${packageName}' has an invalid legacy ${target} entry '${requested}'`);
  }
  try {
    await nearestPackageTypeForFile(
      packageRoot,
      resolve(packageRoot, requested),
      `package '${packageName}' legacy ${target} entry '${requested}'`,
    );
  } catch (error) {
    throw new Error(
      `package '${packageName}' legacy ${target} entry '${requested}' does not resolve to an ordinary file: ${hostErrorMessage(error)}`,
    );
  }
}

function legacyJavaScriptPackageEntry(
  manifest: JavaScriptDependencyManifest,
  target: JavaScriptPackageTarget,
): string {
  if (target === "browser" && typeof manifest.browser === "string") return manifest.browser;
  if (target === "browser" && typeof manifest.module === "string") return manifest.module;
  return typeof manifest.main === "string" ? manifest.main : "index.js";
}

function isJavaScriptEsmTarget(target: string, packageType: unknown): boolean {
  return target.endsWith(".mjs") || (target.endsWith(".js") && packageType === "module");
}

async function isSelfJavaScriptSubpath(
  source: string,
  importerPath: string,
  manifestPath: string,
  entries: unknown,
): Promise<boolean> {
  const name = packageNameOf(source);
  const selfRoot = await findPackageSelfReferenceRoot(name, importerPath);
  if (selfRoot === null || resolve(selfRoot) !== resolve(dirname(manifestPath))) return false;
  const subpath = source === name ? "." : `.${source.slice(name.length)}`;
  if (subpath === ".") return false;
  return entries === null || typeof entries !== "object" || Array.isArray(entries)
    || !Object.hasOwn(entries, subpath);
}

function packageNameOf(source: string): string {
  return npmPackageNameFromSpecifier(source, `Package import '${source}'`);
}

function diagnostic(source: string, message: string): JavaScriptSpecifierDiagnostic {
  return { code: "VEL6006", message, source };
}
