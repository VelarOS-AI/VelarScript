import { join } from "node:path";
import type { GeneratedOutputClaim } from "./generated-output-claim.ts";
import {
  MAX_PACKAGE_IMPORT_COPY_FILES,
  MAX_PACKAGE_IMPORT_COPY_TOTAL_BYTES,
  readProjectPackageImports,
  snapshotPackageImportTargets,
  type PackageImportFileSnapshot,
} from "./package-import-sandbox.ts";
import type { ProjectResult } from "./project.ts";
import { standardRuntimePackageRoot } from "./standard-runtime-package-layout.ts";

export interface SourcePackageImportsSnapshot {
  readonly imports: ReadonlyMap<string, Record<string, unknown>>;
  readonly files: readonly PackageImportFileSnapshot[];
  readonly claims: readonly GeneratedOutputClaim[];
}

/** Keeps each source dependency's private JS aliases inside its own npm owner. */
export async function snapshotSourcePackageImports(
  project: ProjectResult,
  outputRoot: string,
): Promise<SourcePackageImportsSnapshot> {
  const imports = new Map<string, Record<string, unknown>>();
  const files: PackageImportFileSnapshot[] = [];
  const claims: GeneratedOutputClaim[] = [];
  let bytes = 0;
  for (const package_ of project.velarPackages) {
    // Frozen entries already execute through their authenticated artifact owner.
    if (package_.artifacts.size > 0) continue;
    const ownerImports = await readProjectPackageImports(package_.root);
    if (!ownerImports) continue;
    imports.set(package_.name, ownerImports);
    const ownerFiles = await snapshotPackageImportTargets(package_.root, ownerImports);
    const packageRoot = standardRuntimePackageRoot("node_modules", package_.name);
    for (const file of ownerFiles) {
      bytes += file.contents.byteLength;
      if (files.length >= MAX_PACKAGE_IMPORT_COPY_FILES || bytes > MAX_PACKAGE_IMPORT_COPY_TOTAL_BYTES) {
        throw new RangeError("Source package imports exceed the sandbox file graph budget");
      }
      const relativePath = join(packageRoot, file.relativePath);
      files.push({relativePath, contents: file.contents});
      claims.push({
        path: join(outputRoot, relativePath),
        kind: "file",
        owner: `Source package '${package_.name}' private import '${file.relativePath}'`,
      });
    }
  }
  return {imports, files: Object.freeze(files), claims: Object.freeze(claims)};
}
