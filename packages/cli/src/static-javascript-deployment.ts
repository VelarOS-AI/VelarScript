import { realpath } from "node:fs/promises";
import { isBuiltin } from "node:module";
import { dirname, extname, isAbsolute, resolve } from "node:path";
import {
  createJavaScriptModuleGraphBudget,
  inspectJavaScriptModuleWithinBudget,
  type JavaScriptModuleGraphBudget,
} from "./javascript-module-budget.ts";
import {
  createInstalledPackageLookupCache,
  enclosingInstalledPackage,
  type InstalledPackageIdentity,
} from "./installed-package-closure.ts";
import { readOrdinaryFileSnapshot } from "./ordinary-file-snapshot.ts";
import { decodeJavaScriptDataModule } from "./javascript-data-module.ts";
import { resolvePackageImportsSpecifier } from "./package-imports.ts";
import type { JavaScriptPackageImportKind } from "./package-imports.ts";
import { npmPackageNameFromSpecifier } from "./package-name.ts";

export const MAX_STATIC_DEPLOYMENT_JAVASCRIPT_BYTES = 16 * 1024 * 1024;
export const MAX_STATIC_DEPLOYMENT_JAVASCRIPT_INPUTS = 16_384;

export interface StaticJavaScriptDeploymentSource {
  readonly code: string;
  readonly label: string;
}

/** Exact ordinary-file bytes already consumed by a bundler. */
export interface StaticJavaScriptDeploymentInputSnapshot {
  readonly path: string;
  readonly bytes: Uint8Array;
}

export interface StaticJavaScriptDeploymentSourceResult {
  /** A literal Node package edge esbuild must close even when the compiler did not report it. */
  readonly requiresNodeBundle: boolean;
}

interface StaticJavaScriptDeploymentBudget {
  readonly dataModules: Set<string>;
  readonly syntax: JavaScriptModuleGraphBudget;
  remainingBytes: number;
  remainingInputs: number;
}

/** Checks generated or virtual JavaScript that has no ordinary-file package owner. */
export function assertStaticJavaScriptDeploymentSources(
  sources: readonly StaticJavaScriptDeploymentSource[],
  owner: string,
  externalModules: ReadonlySet<string> = new Set(),
): StaticJavaScriptDeploymentSourceResult {
  const budget = createStaticJavaScriptDeploymentBudget(sources.length, owner);
  let requiresNodeBundle = false;
  for (const source of sources) {
    const bytes = Buffer.byteLength(source.code, "utf8");
    consumeStaticDeploymentBytes(budget, bytes, owner);
    const loads = inspectStaticJavaScriptDeploymentSource(source.code, source.label, owner, budget);
    if (loads.some((load) => load.kind === "require"
      || specifierRequiresNodeBundle(load.specifier, externalModules))) {
      requiresNodeBundle = true;
    }
  }
  return { requiresNodeBundle };
}

function specifierRequiresNodeBundle(specifier: string, externalModules: ReadonlySet<string>): boolean {
  if (externalModules.has(specifier) || isBuiltin(specifier)) return false;
  return specifier.startsWith("#") || isBarePackageSpecifier(specifier);
}

/**
 * Completes esbuild's static graph proof for ordinary filesystem inputs.
 * esbuild follows ESM edges and literal CommonJS require calls; computed or
 * indirect loaders would otherwise survive in an apparently successful build.
 */
export async function assertStaticJavaScriptDeploymentInputs(
  inputPaths: readonly string[],
  owner: string,
): Promise<void> {
  const paths = [...new Set(inputPaths.map((path) => resolve(path)))].sort(compare);
  if (paths.length > MAX_STATIC_DEPLOYMENT_JAVASCRIPT_INPUTS) {
    throw new RangeError(`${owner} cannot contain more than ${MAX_STATIC_DEPLOYMENT_JAVASCRIPT_INPUTS} JavaScript inputs`);
  }
  const snapshots: StaticJavaScriptDeploymentInputSnapshot[] = [];
  let remainingBytes = MAX_STATIC_DEPLOYMENT_JAVASCRIPT_BYTES;
  for (const path of paths) {
    const extension = extname(path).toLowerCase();
    if (extension === ".json") continue;
    if (extension !== ".js" && extension !== ".mjs" && extension !== ".cjs") {
      throw new Error(`${owner} includes unsupported JavaScript input '${path}'`);
    }
    if (remainingBytes < 1) throw deploymentSizeError(owner);
    let bytes: Buffer;
    try {
      ({ bytes } = await readOrdinaryFileSnapshot(
        path,
        remainingBytes,
        `${owner} JavaScript input '${path}'`,
      ));
    } catch (error) {
      if (error instanceof RangeError) throw deploymentSizeError(owner);
      throw error;
    }
    remainingBytes -= bytes.byteLength;
    snapshots.push({ path, bytes });
  }
  await assertStaticJavaScriptDeploymentInputSnapshots(snapshots, owner);
}

/** Proves deployment from the exact byte snapshots handed to esbuild. */
export async function assertStaticJavaScriptDeploymentInputSnapshots(
  inputSnapshots: readonly StaticJavaScriptDeploymentInputSnapshot[],
  owner: string,
): Promise<void> {
  const snapshots = [...inputSnapshots].sort((left, right) => compare(resolve(left.path), resolve(right.path)));
  const budget = createStaticJavaScriptDeploymentBudget(snapshots.length, owner);
  const packageCache = createInstalledPackageLookupCache();
  const seen = new Set<string>();
  for (const snapshot of snapshots) {
    const path = resolve(snapshot.path);
    if (seen.has(path)) throw new Error(`${owner} supplied conflicting JavaScript snapshots for '${path}'`);
    seen.add(path);
    const extension = extname(path).toLowerCase();
    if (extension !== ".js" && extension !== ".mjs" && extension !== ".cjs") {
      throw new Error(`${owner} includes unsupported JavaScript input '${path}'`);
    }
    consumeStaticDeploymentBytes(budget, snapshot.bytes.byteLength, owner);
    let source: string;
    try {
      source = new TextDecoder("utf-8", { fatal: true }).decode(snapshot.bytes);
    } catch {
      throw new Error(`${owner} JavaScript input '${path}' is not valid UTF-8`);
    }
    const label = `JavaScript input '${path}'`;
    const visibleLoads = inspectStaticJavaScriptDeploymentSource(source, label, owner, budget);
    const bareSpecifiers = await deploymentPackageSpecifiers(visibleLoads, path, owner);
    if (bareSpecifiers.length === 0) continue;
    const package_ = await enclosingInstalledPackage(await realpath(path), undefined, packageCache);
    assertDeclaredPackageEdges(package_, bareSpecifiers, path, owner);
  }
}

function inspectStaticJavaScriptDeploymentSource(
  source: string,
  label: string,
  owner: string,
  budget: StaticJavaScriptDeploymentBudget,
): StaticJavaScriptLoad[] {
  const visibleLoads: StaticJavaScriptLoad[] = [];
  const pending: Array<{ readonly code: string; readonly dataModule: boolean; readonly label: string }> = [
    { code: source, dataModule: false, label },
  ];
  while (pending.length > 0) {
    const current = pending.pop()!;
    let inspection;
    try {
      inspection = inspectJavaScriptModuleWithinBudget(current.code, budget.syntax);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new Error(`${owner} cannot prove ${current.label} is statically deployable: ${detail}`);
    }
    if (inspection.edges.some((edge) => edge.dynamic && edge.source === null)) {
      throw new Error(`${owner} ${current.label} uses a computed dynamic import`);
    }
    for (const load of inspection.opaqueLoads) {
      if (!current.dataModule && load.kind === "commonjs-require" && load.bundlerVisible && load.target !== null) {
        visibleLoads.push({ specifier: load.target, kind: "require" });
        continue;
      }
      const mechanism = load.kind === "create-require"
        ? "createRequire"
        : load.kind === "get-builtin-module"
          ? "process.getBuiltinModule"
          : load.target === null && load.bundlerVisible ? "computed CommonJS require" : "indirect CommonJS require";
      throw new Error(`${owner} ${current.label} uses ${mechanism}; production deployment requires statically visible module dependencies`);
    }
    for (const edge of inspection.edges) {
      if (edge.source === null) continue;
      if (edge.source.startsWith("data:")) {
        if (budget.dataModules.has(edge.source)) continue;
        budget.dataModules.add(edge.source);
        const code = decodeJavaScriptDataModule(edge.source);
        consumeStaticDeploymentInput(budget, Buffer.byteLength(code, "utf8"), owner);
        pending.push({
          code,
          dataModule: true,
          label: `inline JavaScript data module ${budget.dataModules.size} imported by ${current.label}`,
        });
        continue;
      }
      if (current.dataModule) {
        if (isBuiltin(edge.source)) continue;
        throw new Error(`${owner} ${current.label} imports '${edge.source}', which has no portable package owner`);
      }
      visibleLoads.push({ specifier: edge.source, kind: "import" });
    }
  }
  return visibleLoads;
}

function createStaticJavaScriptDeploymentBudget(
  count: number,
  owner: string,
): StaticJavaScriptDeploymentBudget {
  if (count > MAX_STATIC_DEPLOYMENT_JAVASCRIPT_INPUTS) {
    throw new RangeError(`${owner} cannot contain more than ${MAX_STATIC_DEPLOYMENT_JAVASCRIPT_INPUTS} JavaScript inputs`);
  }
  return {
    dataModules: new Set(),
    syntax: createJavaScriptModuleGraphBudget(),
    remainingBytes: MAX_STATIC_DEPLOYMENT_JAVASCRIPT_BYTES,
    remainingInputs: MAX_STATIC_DEPLOYMENT_JAVASCRIPT_INPUTS - count,
  };
}

function consumeStaticDeploymentInput(
  budget: StaticJavaScriptDeploymentBudget,
  bytes: number,
  owner: string,
): void {
  if (budget.remainingInputs < 1) {
    throw new RangeError(`${owner} cannot contain more than ${MAX_STATIC_DEPLOYMENT_JAVASCRIPT_INPUTS} JavaScript inputs`);
  }
  budget.remainingInputs -= 1;
  consumeStaticDeploymentBytes(budget, bytes, owner);
}

function consumeStaticDeploymentBytes(
  budget: StaticJavaScriptDeploymentBudget,
  bytes: number,
  owner: string,
): void {
  if (bytes > budget.remainingBytes) throw deploymentSizeError(owner);
  budget.remainingBytes -= bytes;
}

interface StaticJavaScriptLoad {
  readonly specifier: string;
  readonly kind: JavaScriptPackageImportKind;
}

async function deploymentPackageSpecifiers(
  loads: readonly StaticJavaScriptLoad[],
  path: string,
  owner: string,
): Promise<readonly string[]> {
  const packageSpecifiers = new Set<string>();
  const seen = new Set<string>();
  for (const { specifier, kind } of loads) {
    const loadIdentity = `${kind}\0${specifier}`;
    if (seen.has(loadIdentity)) continue;
    seen.add(loadIdentity);
    if (specifier.startsWith("#")) {
      let resolved;
      try {
        resolved = await resolvePackageImportsSpecifier(specifier, dirname(path), "node", kind);
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        throw new Error(`${owner} JavaScript input '${path}' cannot resolve package import '${specifier}': ${detail}`);
      }
      if (resolved.target.kind === "external" && isBarePackageSpecifier(resolved.target.specifier)) {
        packageSpecifiers.add(resolved.target.specifier);
      }
      continue;
    }
    if (isBarePackageSpecifier(specifier)) packageSpecifiers.add(specifier);
  }
  return [...packageSpecifiers].sort(compare);
}

function assertDeclaredPackageEdges(
  package_: InstalledPackageIdentity,
  specifiers: readonly string[],
  path: string,
  owner: string,
): void {
  const declared = new Set([
    ...Object.keys(package_.manifest.dependencies),
    ...Object.keys(package_.manifest.optionalDependencies),
    ...Object.keys(package_.manifest.peerDependencies),
  ]);
  for (const specifier of specifiers) {
    const dependencyName = npmPackageNameFromSpecifier(
      specifier,
      `${owner} JavaScript input '${path}' import '${specifier}'`,
    );
    if (dependencyName === package_.name || declared.has(dependencyName)) continue;
    throw new Error(
      `${owner} JavaScript input '${path}' imports undeclared npm package '${dependencyName}' from physical owner `
      + `'${package_.name}'; declare it in dependencies, optionalDependencies, or peerDependencies instead of relying on hoisting`,
    );
  }
}

function isBarePackageSpecifier(specifier: string): boolean {
  if (isBuiltin(specifier) || specifier.startsWith("#") || isAbsolute(specifier)) return false;
  if (specifier === "." || specifier === ".." || specifier.startsWith("./") || specifier.startsWith("../")) return false;
  if (/^[A-Za-z]:[\\/]/u.test(specifier) || /^[A-Za-z][A-Za-z0-9+.-]*:/u.test(specifier)) return false;
  return true;
}

function deploymentSizeError(owner: string): RangeError {
  return new RangeError(`${owner} JavaScript inputs exceed ${MAX_STATIC_DEPLOYMENT_JAVASCRIPT_BYTES} bytes`);
}

function compare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
