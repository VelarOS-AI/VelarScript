import { isBuiltin } from "node:module";
import { dirname, isAbsolute, resolve, win32 } from "node:path";
import {
  inspectJavaScriptModule,
  MAX_JAVASCRIPT_MODULE_SYNTAX_NODES,
  type JavaScriptModuleEdge,
} from "@velarscript/compiler";
import type { VelarLibraryArtifactJavaScriptSnapshot } from "./library-artifact-snapshot.ts";
import { isNpmPackageSelfSpecifier, npmPackageNameFromSpecifier } from "./package-name.ts";
import type { VelarLibraryArtifactTarget } from "./library-artifact-receipt.ts";

/**
 * Proves that every package-owned JavaScript edge stays inside the authenticated
 * entry/chunk set. This is a loader invariant: commands may choose different
 * ways to consume the snapshots, but none may discover another local file.
 */
export function assertVelarLibraryArtifactModuleClosure(
  snapshots: readonly VelarLibraryArtifactJavaScriptSnapshot[],
  packageName: string,
  target: VelarLibraryArtifactTarget,
): ReadonlySet<string> {
  const declared = new Set(snapshots.map((snapshot) => snapshot.path));
  const externalSpecifiers = new Set<string>();
  let remainingSyntaxNodes = MAX_JAVASCRIPT_MODULE_SYNTAX_NODES;
  for (const snapshot of snapshots) {
    const inspection = inspectArtifactModule(snapshot, packageName, remainingSyntaxNodes);
    remainingSyntaxNodes -= inspection.syntaxNodes;
    for (const edge of inspection.edges) {
      assertArtifactModuleEdge(edge, snapshot, declared, externalSpecifiers, packageName, target);
    }
  }
  return externalSpecifiers;
}

function inspectArtifactModule(
  snapshot: VelarLibraryArtifactJavaScriptSnapshot,
  packageName: string,
  remainingSyntaxNodes: number,
): ReturnType<typeof inspectJavaScriptModule> {
  if (remainingSyntaxNodes < 1) {
    throw new RangeError(
      `Velar library artifact '${packageName}' exceeds ${MAX_JAVASCRIPT_MODULE_SYNTAX_NODES} JavaScript syntax nodes`,
    );
  }
  try {
    return inspectJavaScriptModule(snapshot.code, { maximumSyntaxNodes: remainingSyntaxNodes });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    if (error instanceof RangeError) {
      throw new RangeError(`Velar library artifact '${packageName}' exceeds its JavaScript syntax complexity budget: ${detail}`);
    }
    throw new Error(`Velar library artifact '${packageName}' contains invalid ESM in '${snapshot.path}': ${detail}`);
  }
}

function assertArtifactModuleEdge(
  edge: JavaScriptModuleEdge,
  snapshot: VelarLibraryArtifactJavaScriptSnapshot,
  declared: ReadonlySet<string>,
  externalSpecifiers: Set<string>,
  packageName: string,
  target: VelarLibraryArtifactTarget,
): void {
  if (edge.source === null) {
    throw new Error(
      `Velar library artifact '${packageName}' module '${snapshot.path}' uses a computed dynamic import; `
      + "every dynamic import must have a static string target so the receipt module closure can be verified",
    );
  }
  assertModuleTarget(edge.source, snapshot, declared, externalSpecifiers, packageName, target);
}

function assertModuleTarget(
  specifier: string,
  snapshot: VelarLibraryArtifactJavaScriptSnapshot,
  declared: ReadonlySet<string>,
  externalSpecifiers: Set<string>,
  packageName: string,
  target: VelarLibraryArtifactTarget,
): void {
  if (specifier.startsWith("#") || isNpmPackageSelfSpecifier(specifier, packageName)) {
    throw new Error(
      `Velar library artifact '${packageName}' module '${snapshot.path}' retains package-owned import '${specifier}'; `
      + "build-library must include package imports aliases and self JavaScript exports in the receipt module closure",
    );
  }
  if (specifier.includes("\\")) invalidArtifactModuleSpecifier(specifier, snapshot, packageName);
  if (isBuiltin(specifier)) {
    if (target === "node") return;
    throw new Error(
      `Core Velar library artifact '${packageName}' module '${snapshot.path}' imports Node builtin '${specifier}'; `
      + "Core artifacts must remain independent of the Node environment",
    );
  }
  if (specifier.startsWith("data:")) {
    throw new Error(
      `Velar library artifact '${packageName}' module '${snapshot.path}' retains data URL import '${specifier}'; `
      + "build-library must inline data JavaScript so its complete module graph remains authenticated by the receipt",
    );
  }
  if (specifier.startsWith("./") || specifier.startsWith("../")) {
    assertPortableRelativeModuleSpecifier(specifier, snapshot, packageName);
    const resolvedTarget = resolve(dirname(snapshot.path), specifier);
    if (declared.has(resolvedTarget)) return;
    throw new Error(
      `Velar library artifact '${packageName}' module '${snapshot.path}' imports relative module '${specifier}', `
      + "but that target is absent from the receipt entries and chunks",
    );
  }
  assertExternalPackageSpecifier(specifier, snapshot, packageName);
  externalSpecifiers.add(specifier);
}

function assertPortableRelativeModuleSpecifier(
  specifier: string,
  snapshot: VelarLibraryArtifactJavaScriptSnapshot,
  packageName: string,
): void {
  if (specifier.includes("?") || specifier.includes("#") || specifier.includes("%")
    || /[\u0000-\u001f\u007f]/u.test(specifier)
    || specifier.split("/").some((part, index) => index > 0 && (part === "" || part === "."))) {
    invalidArtifactModuleSpecifier(specifier, snapshot, packageName);
  }
}

function assertExternalPackageSpecifier(
  specifier: string,
  snapshot: VelarLibraryArtifactJavaScriptSnapshot,
  packageName: string,
): void {
  if (specifier.startsWith("/") || isAbsolute(specifier) || win32.isAbsolute(specifier)
    || specifier.includes(":") || /[\s\u0000-\u001f\u007f?#%]/u.test(specifier)) {
    invalidArtifactModuleSpecifier(specifier, snapshot, packageName);
  }
  let dependencyName: string;
  try {
    dependencyName = npmPackageNameFromSpecifier(specifier, `Artifact module import '${specifier}'`);
  } catch {
    invalidArtifactModuleSpecifier(specifier, snapshot, packageName);
  }
  const subpath = specifier.slice(dependencyName.length);
  if (subpath !== "" && (!subpath.startsWith("/")
    || subpath.slice(1).split("/").some((part) => part === "" || part === "." || part === ".." || part.toLowerCase() === "node_modules"))) {
    invalidArtifactModuleSpecifier(specifier, snapshot, packageName);
  }
}

function invalidArtifactModuleSpecifier(
  specifier: string,
  snapshot: VelarLibraryArtifactJavaScriptSnapshot,
  packageName: string,
): never {
  throw new Error(
    `Velar library artifact '${packageName}' module '${snapshot.path}' has unsupported module specifier '${specifier}'; `
    + "use a receipt-covered relative module or a valid npm package specifier",
  );
}
