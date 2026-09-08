import { join, resolve } from "node:path";
import type { GeneratedOutputClaim } from "./generated-output-claim.ts";
import {
  createPackageImportSnapshotBudget,
  readProjectPackageImports,
  snapshotPackageImportTargets,
  type PackageImportFileSnapshot,
} from "./package-import-sandbox.ts";
import type { ProjectResult } from "./project.ts";
import { standardRuntimePackageRoot } from "./standard-runtime-package-layout.ts";

export interface SourcePackageImportsSnapshot {
  readonly projectImports: Record<string, unknown> | null;
  readonly imports: ReadonlyMap<string, Record<string, unknown>>;
  readonly files: readonly PackageImportFileSnapshot[];
  readonly claims: readonly GeneratedOutputClaim[];
}

interface PackageOwnerImportsSnapshot {
  readonly imports: Record<string, unknown> | null;
  readonly files: readonly PackageImportFileSnapshot[];
}

export interface SourcePackageImportSnapshots {
  owner(root: string): Promise<PackageOwnerImportsSnapshot>;
}

/** A multi-entry plan captures each owner once and shares one total cost ceiling. */
export function createSourcePackageImportSnapshots(): SourcePackageImportSnapshots {
  const budget = createPackageImportSnapshotBudget();
  const owners = new Map<string, Promise<PackageOwnerImportsSnapshot>>();
  return {
    owner(root) {
      const identity = resolve(root);
      let snapshot = owners.get(identity);
      if (!snapshot) {
        snapshot = (async () => {
          const imports = await readProjectPackageImports(identity);
          const files = imports ? await snapshotPackageImportTargets(identity, imports, budget) : [];
          return {imports, files};
        })();
        owners.set(identity, snapshot);
      }
      return snapshot;
    },
  };
}

/** Keeps the project and every source dependency's aliases with their npm owner. */
export async function snapshotSourcePackageImports(
  project: ProjectResult,
  outputRoot: string,
  snapshots = createSourcePackageImportSnapshots(),
): Promise<SourcePackageImportsSnapshot> {
  const imports = new Map<string, Record<string, unknown>>();
  const projectOwner = await snapshots.owner(project.projectRoot);
  const projectImports = projectOwner.imports;
  const files = [...projectOwner.files];
  const claims: GeneratedOutputClaim[] = [];
  for (const file of files) claims.push({
    path: join(outputRoot, file.relativePath), kind: "file",
    owner: `Project private import '${file.relativePath}'`,
  });
  for (const package_ of project.velarPackages) {
    // Frozen entries already execute through their authenticated artifact owner.
    if (package_.artifacts.size > 0) continue;
    const owner = await snapshots.owner(package_.root);
    if (!owner.imports) continue;
    imports.set(package_.name, owner.imports);
    const packageRoot = standardRuntimePackageRoot("node_modules", package_.name);
    for (const file of owner.files) {
      const relativePath = join(packageRoot, file.relativePath);
      files.push({relativePath, contents: file.contents});
      claims.push({
        path: join(outputRoot, relativePath),
        kind: "file",
        owner: `Source package '${package_.name}' private import '${file.relativePath}'`,
      });
    }
  }
  return {projectImports, imports, files: Object.freeze(files), claims: Object.freeze(claims)};
}
