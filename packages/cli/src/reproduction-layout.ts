import { resolve } from "node:path";
import type { CheckedProject } from "./project-check.ts";
import type { ProjectResource } from "./project.ts";
import type { ProjectSourcePackageContract } from "./project-source-package.ts";

export interface ReproductionCarriedFile {
  readonly source: string;
  readonly target: string;
  readonly contents: string | Uint8Array;
}

export interface ReproductionLayout {
  readonly nestedProject: boolean;
  readonly carried: readonly ReproductionCarriedFile[];
  readonly sourcePackage: ProjectSourcePackageContract | null;
}

const RESERVED_ROOT_FILES = new Set(["package.json", "velar.json", "README.md"]);

/**
 * Keeps checked resource paths intact when a project file occupies a bundle
 * bootstrap name. Bare self-package resources alone can instead be relocated
 * through their explicit package contract, retaining the compact flat bundle.
 */
export function planReproductionLayout(
  projectRoot: string,
  checked: CheckedProject,
  carried: readonly ReproductionCarriedFile[],
): ReproductionLayout {
  if (requiresNestedProjectDirectory(projectRoot, checked, carried)) {
    return { nestedProject: true, carried, sourcePackage: checked.sourcePackage ?? null };
  }
  const relocated = [...carried];
  return {
    nestedProject: false,
    carried: relocated,
    sourcePackage: relocateReservedPackageResources(projectRoot, checked, relocated),
  };
}

export function uniqueCarriedFiles(
  files: readonly ReproductionCarriedFile[],
): ReadonlyMap<string, ReproductionCarriedFile> {
  const output = new Map<string, ReproductionCarriedFile>();
  for (const file of files) {
    const path = file.target.replaceAll("\\", "/");
    const existing = output.get(path);
    if (existing && !sameContents(existing.contents, file.contents)) {
      throw new Error(`cannot reproduce '${path}' because checked inputs claim it with different bytes`);
    }
    if (!existing) output.set(path, { ...file, target: path });
  }
  return output;
}

export function sameContents(left: string | Uint8Array, right: string | Uint8Array): boolean {
  return Buffer.from(left).equals(Buffer.from(right));
}

function requiresNestedProjectDirectory(
  projectRoot: string,
  checked: CheckedProject,
  carried: readonly ReproductionCarriedFile[],
): boolean {
  const resources = checked.roots.flatMap((root) => root.result.resources);
  const sourcePackage = checked.sourcePackage ?? null;
  return carried.some((file) => {
    const target = file.target.replaceAll("\\", "/");
    if (!RESERVED_ROOT_FILES.has(target)) return false;
    const claims = resources.filter((resource) => resolve(resource.inputPath) === resolve(file.source));
    if (claims.some((resource) => resource.source.startsWith("."))) return true;
    return !claims.some((resource) => sourcePackage !== null && isOwnedPackageResource(
      resource, projectRoot, sourcePackage.name, resource.packageSubpath ?? "./",
    ));
  });
}

function relocateReservedPackageResources(
  projectRoot: string,
  checked: CheckedProject,
  carried: ReproductionCarriedFile[],
): ProjectSourcePackageContract | null {
  const sourcePackage = checked.sourcePackage ?? null;
  if (!sourcePackage?.resources) return sourcePackage;
  const resources = Object.fromEntries(Object.entries(sourcePackage.resources)
    .map(([subpath, resource]) => [subpath, { ...resource }]));
  const exports = { ...(sourcePackage.exports ?? {}) };
  const projectResources = checked.roots.flatMap((root) => root.result.resources);
  const occupied = new Set(carried.map((file) => file.target.replaceAll("\\", "/")));
  const relocations = new Map<string, string>();
  let sequence = 0;

  for (const [subpath, declaration] of Object.entries(resources)) {
    const original = declaration.path.replaceAll("\\", "/");
    if (!RESERVED_ROOT_FILES.has(original)) continue;
    const packageResource = projectResources.find((resource) => isOwnedPackageResource(
      resource, projectRoot, sourcePackage.name, subpath,
    ));
    if (!packageResource) {
      throw new Error(`cannot reproduce source-package resource '${subpath}' without its checked file snapshot`);
    }
    let target = relocations.get(original);
    if (!target) {
      do {
        sequence += 1;
        target = `.velar-reproduction/resources/resource-${sequence}.json`;
      } while (occupied.has(target));
      if (!carried.some((file) => file.target.replaceAll("\\", "/") === original)) {
        throw new Error(`cannot reproduce source-package resource '${subpath}' without its carried bytes`);
      }
      for (let index = 0; index < carried.length; index += 1) {
        if (carried[index]!.target.replaceAll("\\", "/") === original) {
          carried[index] = { ...carried[index]!, target };
        }
      }
      occupied.add(target);
      relocations.set(original, target);
    }
    resources[subpath] = { ...declaration, path: target };
    exports[subpath] = `./${target}`;
  }
  if (relocations.size === 0) return sourcePackage;
  return { ...sourcePackage, resources: Object.freeze(resources), exports: Object.freeze(exports) };
}

function isOwnedPackageResource(
  resource: ProjectResource,
  projectRoot: string,
  packageName: string,
  subpath: string,
): boolean {
  return resource.packageName === packageName
    && resource.packageRoot !== null
    && resolve(resource.packageRoot) === resolve(projectRoot)
    && resource.packageSubpath === subpath;
}
