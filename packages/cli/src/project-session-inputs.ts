import { join, resolve } from "node:path";
import type { ProjectResult } from "./project.ts";

export type ProjectSessionDependencyKind =
  | "package manifest"
  | "artifact receipt"
  | "artifact JavaScript"
  | "artifact source map"
  | "artifact interface"
  | "compiler resource"
  | "external type dependency";

export interface ProjectSessionDependencyInput {
  readonly path: string;
  readonly kind: ProjectSessionDependencyKind;
  readonly maxBytes: number;
  /** A change can alter resolution or a checked frozen interface. */
  readonly structural: boolean;
}

/** Every non-source file whose bytes participated in the checked project. */
export function projectSessionDependencyInputs(
  project: ProjectResult | null,
): ReadonlyMap<string, ProjectSessionDependencyInput> {
  const inputs = new Map<string, ProjectSessionDependencyInput>();
  const add = (path: string, kind: ProjectSessionDependencyKind, maxBytes: number, structural: boolean): void => {
    const normalized = resolve(path);
    const existing = inputs.get(normalized);
    inputs.set(normalized, existing
      ? { path: normalized, kind: existing.structural ? existing.kind : kind, maxBytes: Math.max(existing.maxBytes, maxBytes), structural: existing.structural || structural }
      : { path: normalized, kind, maxBytes, structural });
  };
  for (const package_ of project?.velarPackages ?? []) {
    add(join(package_.root, "package.json"), "package manifest", 1024 * 1024, true);
    for (const artifact of package_.artifacts.values()) {
      add(artifact.receiptPath, "artifact receipt", 4 * 1024 * 1024, true);
      for (const snapshot of artifact.entrySnapshots) {
        add(snapshot.path, "artifact JavaScript", 64 * 1024 * 1024, true);
        add(snapshot.sourceMapPath, "artifact source map", 64 * 1024 * 1024, true);
      }
      for (const path of artifact.interfacePaths) add(path, "artifact interface", 8 * 1024 * 1024, true);
      for (const snapshot of artifact.chunkSnapshots) {
        add(snapshot.path, "artifact JavaScript", 64 * 1024 * 1024, true);
        add(snapshot.sourceMapPath, "artifact source map", 64 * 1024 * 1024, true);
      }
    }
  }
  for (const resource of project?.resources ?? []) {
    add(resource.inputPath, "compiler resource", 4 * 1024 * 1024, false);
  }
  for (const path of project?.externalTypeDependencies.keys() ?? []) {
    add(path, "external type dependency", 2 * 1024 * 1024, false);
  }
  return inputs;
}

export function projectSessionNeedsFullRebuild(
  inputs: ReadonlyMap<string, ProjectSessionDependencyInput>,
  changedPaths: ReadonlySet<string>,
): boolean {
  for (const path of changedPaths) if (inputs.get(path)?.structural) return true;
  return false;
}
