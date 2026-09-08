import { lstat, mkdir, open, realpath } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { readBoundedFileHandle } from "./bounded-text.ts";
import { writeExclusiveBuildFile } from "./build-staging.ts";
import { hostErrorMessage, isHostErrorCode } from "./host-error.ts";
import { MAXIMUM_SERVER_CONFIGURATION_BYTES } from "./server-configuration-limits.ts";

export interface ConfiguredServerSnapshot {
  readonly sourcePath: string;
  readonly canonicalSourcePath: string;
  readonly relativePath: string;
  readonly contents: Buffer;
}

export interface ReservedBuildOutputClaim {
  readonly relativePath: string;
  readonly owner: string;
}

/** Applies the same descriptor-backed configuration rule to non-emitting checks. */
export async function configuredServerConfigurationFailure(
  projectRoot: string,
  configuration: string,
): Promise<string | null> {
  try {
    await readConfiguredServerConfiguration(projectRoot, configuration);
    return null;
  } catch (error) {
    return hostErrorMessage(error);
  }
}

/** Reads one immutable, project-contained configuration image through a verified descriptor. */
export async function readConfiguredServerConfiguration(
  projectRoot: string,
  configuration: string,
): Promise<ConfiguredServerSnapshot> {
  const root = resolve(projectRoot);
  const path = resolve(root, configuration);
  if (!isWithin(root, path)) throw new Error(`Server configuration '${configuration}' must stay inside the project root`);
  try {
    const [canonicalRoot, canonicalPath, before] = await Promise.all([
      realpath(root),
      realpath(path),
      lstat(path, { bigint: true }),
    ]);
    if (!isWithin(canonicalRoot, canonicalPath)) {
      throw new Error(`Server configuration '${configuration}' escapes the project root through a symbolic link`);
    }
    if (before.isSymbolicLink() || !before.isFile()) {
      throw new Error(`Server configuration '${configuration}' must be a regular file`);
    }
    if (before.size > BigInt(MAXIMUM_SERVER_CONFIGURATION_BYTES)) refuseOversized(configuration);

    const handle = await open(path, "r");
    try {
      const opened = await handle.stat({ bigint: true });
      if (!opened.isFile() || !sameFile(before, opened)) refuseChanged(configuration);
      let contents: Buffer;
      try {
        contents = await readBoundedFileHandle(
          handle,
          MAXIMUM_SERVER_CONFIGURATION_BYTES,
          `Server configuration '${configuration}'`,
        );
      } catch (error) {
        if (error instanceof RangeError) refuseOversized(configuration);
        throw error;
      }
      const after = await handle.stat({ bigint: true });
      const [afterPath, afterCanonicalPath, afterCanonicalRoot] = await Promise.all([
        lstat(path, { bigint: true }),
        realpath(path),
        realpath(root),
      ]);
      if (!after.isFile() || !afterPath.isFile() || afterPath.isSymbolicLink()
        || !sameFile(opened, after) || !sameFile(opened, afterPath)
        || !sameSnapshot(opened, after) || BigInt(contents.byteLength) !== after.size
        || afterCanonicalRoot !== canonicalRoot || afterCanonicalPath !== canonicalPath
        || !isWithin(afterCanonicalRoot, afterCanonicalPath)) refuseChanged(configuration);
      return { sourcePath: path, canonicalSourcePath: canonicalPath, relativePath: configuration, contents };
    } finally {
      await handle.close();
    }
  } catch (error) {
    if (isHostErrorCode(error, "ENOENT")) throw new Error(`Server configuration '${configuration}' does not exist`);
    throw error;
  }
}

/** Materializes the checked image only when no generated or reserved output already owns its path. */
export async function writeConfiguredServerConfiguration(
  outputRoot: string,
  configuration: ConfiguredServerSnapshot,
  reserved: readonly ReservedBuildOutputClaim[],
): Promise<void> {
  const root = resolve(outputRoot);
  const output = resolve(root, configuration.relativePath);
  if (!isWithin(root, output)) {
    throw new Error(`Server configuration output '${configuration.relativePath}' must stay inside the build root`);
  }
  for (const claim of reserved) {
    const target = resolve(root, claim.relativePath);
    if (claimsOverlap(output, target)) refuseClaimedOutput(configuration.relativePath, claim.owner);
  }
  try {
    await lstat(output);
    refuseClaimedOutput(configuration.relativePath, "an existing generated build output");
  } catch (error) {
    if (!isHostErrorCode(error, "ENOENT")) {
      if (isHostErrorCode(error, "ENOTDIR")) {
        refuseClaimedOutput(configuration.relativePath, "an existing generated build output");
      }
      throw error;
    }
  }
  try {
    await mkdir(dirname(output), { recursive: true });
  } catch (error) {
    if (isHostErrorCode(error, "EEXIST") || isHostErrorCode(error, "ENOTDIR")) {
      refuseClaimedOutput(configuration.relativePath, "an existing generated build output");
    }
    throw error;
  }
  await writeExclusiveBuildFile(
    output,
    configuration.contents,
    `Server configuration output '${configuration.relativePath}'`,
  );
}

interface FileState {
  readonly dev: bigint;
  readonly ino: bigint;
  readonly size: bigint;
  readonly mtimeNs: bigint;
  readonly ctimeNs: bigint;
}

function sameFile(left: FileState, right: FileState): boolean {
  return left.dev === right.dev && left.ino === right.ino;
}

function sameSnapshot(left: FileState, right: FileState): boolean {
  return left.size === right.size && left.mtimeNs === right.mtimeNs && left.ctimeNs === right.ctimeNs;
}

function isWithin(root: string, candidate: string): boolean {
  const fromRoot = relative(root, candidate);
  return fromRoot !== "" && fromRoot !== ".." && !fromRoot.startsWith("../")
    && !fromRoot.startsWith("..\\") && !isAbsolute(fromRoot);
}

function claimsOverlap(left: string, right: string): boolean {
  const fromLeft = relative(left, right);
  const fromRight = relative(right, left);
  return fromLeft === "" || isDescendant(fromLeft) || isDescendant(fromRight);
}

function isDescendant(path: string): boolean {
  return path !== ".." && !path.startsWith(`..${sep}`) && !isAbsolute(path);
}

function refuseClaimedOutput(path: string, owner: string): never {
  throw new Error(`Server configuration output '${path}' conflicts with ${owner}`);
}

function refuseChanged(configuration: string): never {
  throw new Error(`Server configuration '${configuration}' changed while it was being read`);
}

function refuseOversized(configuration: string): never {
  throw new Error(`Server configuration '${configuration}' cannot exceed 1 MiB`);
}
