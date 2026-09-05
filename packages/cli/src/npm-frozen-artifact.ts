import { dirname, resolve } from "node:path";
import type { Plugin } from "esbuild";
import {
  artifactSnapshotContents,
  type VelarLibraryArtifactJavaScriptSnapshot,
} from "./library-artifact.ts";
import { npmPackageNameFromSpecifier } from "./package-name.ts";
import { projectImportKey, type ProjectResult } from "./project.ts";

export const FROZEN_ARTIFACT_NAMESPACE = "velar-frozen-artifact";
export const FROZEN_ARTIFACT_NAMESPACE_PREFIX = `${FROZEN_ARTIFACT_NAMESPACE}:`;

export interface FrozenArtifactSnapshotSet {
  readonly receiptPath: string;
  readonly snapshots: ReadonlyMap<string, VelarLibraryArtifactJavaScriptSnapshot>;
}

export interface ProjectFrozenArtifacts {
  readonly byEntry: ReadonlyMap<string, FrozenArtifactSnapshotSet>;
  readonly expectedEntries: ReadonlyMap<string, ReadonlySet<string>>;
}

export interface FrozenArtifactPrebundleState {
  readonly artifactSnapshots: ReadonlyMap<string, VelarLibraryArtifactJavaScriptSnapshot>;
}

export function projectFrozenArtifacts(project: ProjectResult): ProjectFrozenArtifacts {
  const receipts = new Map<string, {
    readonly entries: Set<string>;
    readonly snapshots: Map<string, VelarLibraryArtifactJavaScriptSnapshot>;
  }>();
  for (const artifact of project.velarArtifactImports.values()) {
    const receiptPath = resolve(artifact.receiptPath);
    if (receipts.has(receiptPath)) continue;
    const receipt = { entries: new Set<string>(), snapshots: new Map<string, VelarLibraryArtifactJavaScriptSnapshot>() };
    receipts.set(receiptPath, receipt);
    for (const snapshot of artifact.entrySnapshots) {
      receipt.entries.add(snapshot.path);
      registerFrozenSnapshot(receipt.snapshots, snapshot);
    }
    for (const snapshot of artifact.chunkSnapshots) registerFrozenSnapshot(receipt.snapshots, snapshot);
  }
  const byEntry = new Map<string, FrozenArtifactSnapshotSet>();
  for (const [receiptPath, receipt] of receipts) {
    const set = { receiptPath, snapshots: receipt.snapshots };
    for (const entry of receipt.entries) {
      const existing = byEntry.get(entry);
      if (existing && existing.receiptPath !== receiptPath) {
        throw new Error(`Frozen artifact entry '${entry}' is claimed by more than one verified receipt`);
      }
      byEntry.set(entry, set);
    }
  }
  const expectedEntries = new Map<string, Set<string>>();
  for (const module of project.modules) {
    for (const dependency of module.result.dependencies) {
      const artifact = project.velarArtifactImports.get(projectImportKey(module.inputPath, dependency.source));
      if (!artifact) continue;
      const entries = expectedEntries.get(dependency.source) ?? new Set<string>();
      entries.add(artifact.entrySnapshot.path);
      expectedEntries.set(dependency.source, entries);
    }
  }
  return { byEntry, expectedEntries };
}

export function matchingFrozenArtifact(
  artifacts: ProjectFrozenArtifacts,
  specifier: string,
  entry: string,
): FrozenArtifactSnapshotSet | null {
  const expected = artifacts.expectedEntries.get(specifier);
  if (expected && !expected.has(entry)) {
    throw new Error(`the frozen artifact entry changed after it was checked; expected one of ${[...expected].map((item) => JSON.stringify(item)).join(", ")}, received ${JSON.stringify(entry)}`);
  }
  const artifact = artifacts.byEntry.get(entry) ?? null;
  if (expected && !artifact) throw new Error(`the frozen artifact entry '${entry}' is not covered by its verified receipt`);
  return artifact;
}

export function frozenArtifactPrebundle(state: FrozenArtifactPrebundleState): Plugin {
  return {
    name: "velar-frozen-artifact-prebundle",
    setup(context) {
      context.onResolve({ filter: /.*/ }, (arguments_) => {
        if (arguments_.kind !== "entry-point") return null;
        const path = resolve(arguments_.path);
        return state.artifactSnapshots.has(path)
          ? { path, namespace: FROZEN_ARTIFACT_NAMESPACE }
          : null;
      });
      context.onResolve({ filter: /^\.\.?\//, namespace: "file" }, (arguments_) => {
        const target = resolve(arguments_.resolveDir, arguments_.path);
        return state.artifactSnapshots.has(target)
          ? { path: target, namespace: FROZEN_ARTIFACT_NAMESPACE }
          : null;
      });
      context.onResolve({ filter: /.*/, namespace: FROZEN_ARTIFACT_NAMESPACE }, (arguments_) => {
        if (!state.artifactSnapshots.has(arguments_.importer)) {
          return { errors: [{ text: `Frozen artifact importer '${arguments_.importer}' is outside its verified receipt` }] };
        }
        if (arguments_.path.startsWith("./") || arguments_.path.startsWith("../")) {
          const target = resolve(dirname(arguments_.importer), arguments_.path);
          return state.artifactSnapshots.has(target)
            ? { path: target, namespace: FROZEN_ARTIFACT_NAMESPACE }
            : { errors: [{ text: `Frozen artifact relative import '${arguments_.path}' is not covered by its verified receipt` }] };
        }
        if (externalPrebundleImport(arguments_.path)) return { path: arguments_.path, external: true };
        return { errors: [{ text: `Frozen artifact import '${arguments_.path}' is not a permitted relative or bare package import` }] };
      });
      context.onLoad({ filter: /.*/, namespace: FROZEN_ARTIFACT_NAMESPACE }, (arguments_) => {
        const snapshot = state.artifactSnapshots.get(arguments_.path);
        return snapshot
          ? { contents: artifactSnapshotContents(snapshot, false), loader: "js", resolveDir: dirname(snapshot.path) }
          : { errors: [{ text: `Frozen artifact module '${arguments_.path}' was not present in its verified receipt` }] };
      });
    },
  };
}

export function frozenArtifactInputPath(path: string): string {
  return `${FROZEN_ARTIFACT_NAMESPACE_PREFIX}${path}`;
}

function registerFrozenSnapshot(
  snapshots: Map<string, VelarLibraryArtifactJavaScriptSnapshot>,
  snapshot: VelarLibraryArtifactJavaScriptSnapshot,
): void {
  const existing = snapshots.get(snapshot.path);
  if (existing && (existing.code !== snapshot.code || existing.sourceMap !== snapshot.sourceMap
    || existing.sourceMapPath !== snapshot.sourceMapPath)) {
    throw new Error(`Frozen artifact '${snapshot.path}' has conflicting verified snapshots`);
  }
  snapshots.set(snapshot.path, snapshot);
}

function externalPrebundleImport(specifier: string): boolean {
  if (specifier.startsWith("node:") || specifier.startsWith("#")) return true;
  if (specifier.includes(":") || specifier.includes("\\") || specifier.startsWith(".") || specifier.startsWith("/")) return false;
  try {
    npmPackageNameFromSpecifier(specifier, `Frozen artifact import '${specifier}'`);
    return true;
  } catch {
    return false;
  }
}
