import { realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import {
  assertDirectorySnapshotUnchanged,
  inspectBoundedDirectory,
  productionDirectoryPolicy,
  type BoundedDirectorySnapshot,
} from "./bounded-directory-snapshot.ts";
import {
  authorizeBuildOutputCommit,
  type BuildOutputCommitAuthorization,
} from "./build-output-commit.ts";
import { BUILD_STAGING_MARKER } from "./build-staging.ts";
import type { VelarLibraryBuildConfig } from "./library-artifact-build.ts";
import { loadVelarLibraryArtifactSet } from "./library-artifact.ts";

/** Authenticates one complete frozen-library tree for the final output transaction. */
export async function verifyVelarLibraryBuildForCommit(
  build: VelarLibraryBuildConfig,
  directory: string,
): Promise<BuildOutputCommitAuthorization> {
  const root = resolve(directory);
  const snapshot = await inspectVelarLibraryBuild(build, root);
  return authorizeBuildOutputCommit(root, snapshot, async (installedDirectory) => {
    await inspectVelarLibraryBuild(build, resolve(installedDirectory));
  });
}

async function inspectVelarLibraryBuild(
  build: VelarLibraryBuildConfig,
  root: string,
): Promise<BoundedDirectorySnapshot> {
  const snapshot = await inspectBoundedDirectory(root, "Velar library build", productionDirectoryPolicy, {
    ignoredRootNames: new Set([BUILD_STAGING_MARKER]),
  });
  const descriptor = relative(build.project.root, build.receiptPath).replaceAll("\\", "/");
  const artifacts = await loadVelarLibraryArtifactSet({
    packageRoot: build.project.root,
    packageName: build.packageName,
    packageVersion: build.packageVersion,
    packageEntries: new Map([...build.entries].map(([subpath, entry]) => [
      subpath,
      { relativePath: entry.sourceEntry },
    ])),
    descriptor,
    target: build.target,
    packageExports: build.packageExports,
    runtimeDependencies: build.runtimeDependencies,
    compilerExtensions: build.project.compilerExtensions,
    extensionConfig: build.project.extensionConfig,
    artifactRoot: root,
  });
  const first = artifacts.values().next().value;
  if (first === undefined) throw new Error("Velar library build has no authenticated entry");
  const physicalPaths = new Set<string>([first.receiptPath]);
  for (const artifact of artifacts.values()) {
    for (const path of artifact.interfacePaths) physicalPaths.add(path);
    for (const entry of [...artifact.entrySnapshots, ...artifact.chunkSnapshots]) {
      physicalPaths.add(entry.path);
      physicalPaths.add(entry.sourceMapPath);
    }
  }
  const canonicalRoot = await realpath(root);
  const expectedFiles = new Set<string>();
  for (const path of physicalPaths) {
    const canonicalPath = await realpath(path);
    const fromRoot = relative(canonicalRoot, canonicalPath);
    if (!fromRoot || fromRoot === ".." || fromRoot.startsWith(`..${sep}`) || isAbsolute(fromRoot)) {
      throw new Error(`Velar library artifact '${path}' escapes prepared output '${root}'`);
    }
    expectedFiles.add(fromRoot.replaceAll("\\", "/"));
  }
  assertExactArtifactTree(snapshot, expectedFiles);
  await assertDirectorySnapshotUnchanged(snapshot, "Velar library build");
  return snapshot;
}

function assertExactArtifactTree(
  snapshot: BoundedDirectorySnapshot,
  expectedFiles: ReadonlySet<string>,
): void {
  const actualFiles = [...snapshot.files.keys()].sort(byCodePoint);
  const expectedFileList = [...expectedFiles].sort(byCodePoint);
  if (JSON.stringify(actualFiles) !== JSON.stringify(expectedFileList)) {
    throw new Error("Velar library build contains files outside its authenticated artifact receipt");
  }
  const expectedDirectories = new Set<string>();
  for (const path of expectedFiles) {
    const segments = path.split("/");
    for (let length = 1; length < segments.length; length += 1) {
      expectedDirectories.add(segments.slice(0, length).join("/"));
    }
  }
  const actualDirectories = [...snapshot.directories.keys()].filter(Boolean).sort(byCodePoint);
  const expectedDirectoryList = [...expectedDirectories].sort(byCodePoint);
  if (JSON.stringify(actualDirectories) !== JSON.stringify(expectedDirectoryList)) {
    throw new Error("Velar library build contains directories outside its authenticated artifact receipt");
  }
}

function byCodePoint(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
