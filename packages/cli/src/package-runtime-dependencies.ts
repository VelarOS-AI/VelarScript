import { join } from "node:path";
import type { VelarLibraryArtifactTarget } from "./library-artifact-receipt.ts";
import { assertExternalJavaScriptPackageTarget } from "./javascript-dependency-target.ts";
import { assertDeclaredRuntimeDependency } from "./package-runtime-dependency-manifest.ts";

/** Ensures every retained bare edge has an npm owner after a clean install. */
export function assertDeclaredArtifactRuntimeDependencies(
  specifiers: ReadonlySet<string>,
  dependencies: ReadonlySet<string>,
  packageName: string,
): void {
  for (const specifier of specifiers) assertDeclaredRuntimeDependency(specifier, dependencies, packageName);
}

/** Applies declaration ownership and the same target fence used by source check. */
export async function assertArtifactRuntimeDependencies(
  specifiers: ReadonlySet<string>,
  dependencies: ReadonlySet<string>,
  packageRoot: string,
  packageName: string,
  target: VelarLibraryArtifactTarget,
): Promise<void> {
  assertDeclaredArtifactRuntimeDependencies(specifiers, dependencies, packageName);
  const importer = join(packageRoot, "__velar_artifact_runtime__.mjs");
  for (const specifier of specifiers) {
    await assertExternalJavaScriptPackageTarget(specifier, importer, "node", target);
  }
}
