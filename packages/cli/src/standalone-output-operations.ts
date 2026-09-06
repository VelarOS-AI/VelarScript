import { lstat, opendir } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import type { BuildOutputClaim } from "./build-input-boundary.ts";
import {
  assertStandaloneRuntimeOwner,
  generatedRuntimePackageOwnership,
} from "./generated-runtime-package.ts";
import { isHostErrorCode } from "./host-error.ts";
import {
  STANDALONE_TRANSACTION_EVIDENCE_MARKER,
  STANDALONE_TRANSACTION_MARKER,
} from "./standalone-output-ownership.ts";
import { MAX_STANDALONE_TRANSACTION_OPERATIONS } from "./standalone-output-limits.ts";
import { byCodeUnit } from "./stable-order.ts";

export interface StandaloneOutputOperation extends BuildOutputClaim {
  readonly stagedPath: string | null;
  readonly runtimePackageName?: string;
  readonly standaloneRuntimeOwner?: string;
}

/** Plans the complete file and generated-package mutation set before installation. */
export async function standaloneOutputOperations(
  staging: string,
  outputRoot: string,
  cleanupFiles: readonly string[],
  previouslyOwned: ReadonlySet<string>,
  outputPath: string,
): Promise<readonly StandaloneOutputOperation[]> {
  const operations = new Map<string, StandaloneOutputOperation>();
  const add = (operation: StandaloneOutputOperation): void => {
    const target = resolve(operation.path);
    if (operations.has(target)) throw new Error(`Standalone build claimed '${target}' more than once`);
    if (operations.size >= MAX_STANDALONE_TRANSACTION_OPERATIONS) {
      throw new RangeError(`Standalone transaction cannot contain more than ${MAX_STANDALONE_TRANSACTION_OPERATIONS} operations`);
    }
    operations.set(target, {...operation, path: target});
  };
  const stagingDirectory = await opendir(staging);
  let stagingEntryCount = 0;
  for await (const entry of stagingDirectory) {
    if (stagingEntryCount >= MAX_STANDALONE_TRANSACTION_OPERATIONS) {
      throw new RangeError(`Standalone staging inventory cannot exceed ${MAX_STANDALONE_TRANSACTION_OPERATIONS} entries`);
    }
    stagingEntryCount += 1;
    const stagedPath = join(staging, entry.name);
    if (entry.name === STANDALONE_TRANSACTION_MARKER || entry.name === STANDALONE_TRANSACTION_EVIDENCE_MARKER
      || entry.name === `${STANDALONE_TRANSACTION_MARKER}.next` || entry.name === ".previous") continue;
    if (entry.name === "node_modules" && entry.isDirectory()) {
      for (const package_ of await runtimePackageDirectories(stagedPath, true)) {
        add(await runtimePackageOperation(package_.path, package_.targetName, outputRoot, basename(outputPath)));
      }
      continue;
    }
    if (entry.isSymbolicLink() || !entry.isFile() && !entry.isDirectory()) {
      throw new Error(`Standalone staging emitted unsupported output '${stagedPath}'`);
    }
    const target = join(outputRoot, entry.name);
    if (entry.isFile() && await pathExists(target) && target !== outputPath
      && !previouslyOwned.has(resolve(target))) {
      throw new Error(`Refusing to replace unowned standalone sidecar '${target}'`);
    }
    add({path: target, kind: entry.isDirectory() ? "tree" : "file", stagedPath});
  }

  const obsoleteFiles = new Set([...cleanupFiles.map((candidate) => resolve(candidate)), ...previouslyOwned]);
  for (const path of obsoleteFiles) {
    if (operations.has(path) || !previouslyOwned.has(path) || !await pathExists(path)) continue;
    const metadata = await lstat(path);
    if (metadata.isDirectory() && !metadata.isSymbolicLink()) {
      throw new Error(`Refusing to remove directory '${path}' as a standalone file sidecar`);
    }
    add({path, kind: "file", stagedPath: null});
  }

  const nodeModulesRoot = join(outputRoot, "node_modules");
  for (const package_ of await runtimePackageDirectories(nodeModulesRoot, false)) {
    const ownership = await generatedRuntimePackageOwnership(package_.path, package_.name);
    if (!operations.has(package_.path) && ownership.kind === "generated"
      && ownership.standaloneOwner === basename(outputPath)) {
      add({
        path: package_.path,
        kind: "tree",
        stagedPath: null,
        runtimePackageName: package_.name,
        standaloneRuntimeOwner: basename(outputPath),
      });
    }
  }
  return [...operations.values()].sort((left, right) => byCodeUnit(left.path, right.path));
}

export async function assertStandaloneRuntimeOperationOwners(
  operations: readonly StandaloneOutputOperation[],
): Promise<void> {
  for (const operation of operations) {
    if (operation.runtimePackageName === undefined || operation.standaloneRuntimeOwner === undefined) continue;
    assertStandaloneRuntimeOwner(
      operation.path,
      await generatedRuntimePackageOwnership(operation.path, operation.runtimePackageName),
      operation.standaloneRuntimeOwner,
    );
  }
}

export async function assertStandaloneTargetShape(operation: StandaloneOutputOperation): Promise<void> {
  if (!await pathExists(operation.path)) return;
  const metadata = await lstat(operation.path);
  if (operation.kind === "file" && (metadata.isDirectory() || metadata.isSymbolicLink())) {
    throw new Error(`Refusing to replace ${metadata.isSymbolicLink() ? "symbolic link" : "directory"} '${operation.path}' with a standalone file`);
  }
  if (operation.kind === "tree" && (!metadata.isDirectory() || metadata.isSymbolicLink())) {
    throw new Error(`Refusing to replace non-directory output tree '${operation.path}'`);
  }
}

interface RuntimePackageDirectory {
  readonly path: string;
  readonly name: string;
  readonly targetName: string;
}

async function runtimePackageOperation(
  stagedPath: string,
  packageName: string,
  outputRoot: string,
  standaloneOwner: string,
): Promise<StandaloneOutputOperation> {
  const ownership = await generatedRuntimePackageOwnership(stagedPath, packageName);
  if (ownership.kind !== "generated" || ownership.standaloneOwner !== standaloneOwner) {
    throw new Error(`Standalone staging emitted package '${packageName}' without owner '${standaloneOwner}'`);
  }
  return {
    path: join(outputRoot, "node_modules", ...packageName.split("/")),
    kind: "tree",
    stagedPath,
    runtimePackageName: packageName,
    standaloneRuntimeOwner: standaloneOwner,
  };
}

async function runtimePackageDirectories(root: string, strict: boolean): Promise<readonly RuntimePackageDirectory[]> {
  const output: RuntimePackageDirectory[] = [];
  let directory;
  try {
    directory = await opendir(root);
  } catch (error) {
    if (!strict && (isHostErrorCode(error, "ENOENT") || isHostErrorCode(error, "ENOTDIR"))) return output;
    throw error;
  }
  for await (const entry of directory) {
    if (output.length >= MAX_STANDALONE_TRANSACTION_OPERATIONS) {
      throw new RangeError(`Standalone runtime package inventory cannot exceed ${MAX_STANDALONE_TRANSACTION_OPERATIONS} entries`);
    }
    const path = join(root, entry.name);
    if (entry.name.startsWith("@") && entry.isDirectory()) {
      const scope = await opendir(path);
      for await (const packageEntry of scope) {
        if (output.length >= MAX_STANDALONE_TRANSACTION_OPERATIONS) {
          throw new RangeError(`Standalone runtime package inventory cannot exceed ${MAX_STANDALONE_TRANSACTION_OPERATIONS} entries`);
        }
        if (!packageEntry.isDirectory() || packageEntry.isSymbolicLink()) {
          if (strict) throw new Error(`Standalone runtime staging emitted unsupported package '${join(path, packageEntry.name)}'`);
          continue;
        }
        const name = `${entry.name}/${packageEntry.name}`;
        output.push({path: join(path, packageEntry.name), name, targetName: name});
      }
      continue;
    }
    if (!entry.isDirectory() || entry.isSymbolicLink()) {
      if (strict) throw new Error(`Standalone runtime staging emitted unsupported output '${path}'`);
      continue;
    }
    output.push({path, name: entry.name, targetName: entry.name});
  }
  return output;
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if (isHostErrorCode(error, "ENOENT") || isHostErrorCode(error, "ENOTDIR")) return false;
    throw error;
  }
}
