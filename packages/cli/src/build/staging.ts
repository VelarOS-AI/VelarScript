/**
 * The claim a directory build takes on its output path, and the ownership test
 * that authorizes replacing what is there.
 *
 * Every directory writer in this family stages into a reserved sibling and
 * commits under an authorization this module produced; nothing else in the CLI
 * decides that a directory may be replaced.
 */

import { lstat, mkdir, readdir } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, parse as parsePath, resolve } from "node:path";
import { type AdditionalBuildInput, assertBuildInputsOutsideOutput } from "../build-input-boundary.ts";
import {
  hasBuildOutputReceipt,
  prepareClaimedBuildStaging,
  type PreparedBuildStaging,
  recoverInterruptedBuilds,
  releaseBuildStagingReservation,
  reserveBuildStaging,
  validateBuildOutputTarget,
} from "../build-output-directory.ts";
import { isHostErrorCode } from "../host-error.ts";
import { verifyNodeProductionBuild } from "../node-production-verifier.ts";
import { assertBuildOutputBoundary } from "../package-scope.ts";
import { verifyProductionBuild } from "../production-verifier.ts";
import type { ProjectResult } from "../project.ts";

export /** How much of the output directory's current contents this build may replace. */
interface BuildOutputReplacement {
  /** `--force` was passed: replace the directory even without an ownership marker. */
  readonly forced: boolean;
  /** The path is the project manifest's own `outDir`, which declares velar owns it. */
  readonly declared: boolean;
  readonly projectRoot?: string;
}

/**
 * Reclaims only staging directories carrying a marker that names this exact
 * output. A process cut can happen before or after either rename, so recovery
 * also finishes restoring the previous output when installation never began.
 */
export async function prepareBuildStaging(
  outputDirectory: string,
  replacement: BuildOutputReplacement,
  project?: ProjectResult,
  additionalInputs: readonly AdditionalBuildInput[] = [],
): Promise<PreparedBuildStaging> {
  const normalizedOutput = resolve(outputDirectory);
  if (replacement.projectRoot !== undefined) await assertBuildOutputBoundary(replacement.projectRoot, normalizedOutput, replacement.declared);
  if (project) await assertBuildInputsOutsideOutput(project, normalizedOutput, additionalInputs);
  const parent = dirname(normalizedOutput);
  const staging = await reserveBuildStaging(normalizedOutput);
  try {
    await mkdir(parent, { recursive: true });
    await recoverInterruptedBuilds(normalizedOutput, staging.claim, isBuildOutputDirectory);
    const authorization = await validateBuildOutputTarget(
      normalizedOutput,
      async () => assertReplaceableBuildOutput(normalizedOutput, replacement),
    );
    return await prepareClaimedBuildStaging(staging, authorization);
  } catch (error) {
    await releaseBuildStagingReservation(staging);
    throw error;
  }
}

/**
 * A build replaces its output directory wholesale, so the path is accepted only
 * when velar owns it: absent, empty, carrying a manifest a previous build wrote,
 * or named by the project manifest's own `outDir`. Every other destructive path
 * in this repository makes the same test first — `assertReplaceableReleaseOutput`
 * in scripts/release-toolchain.mjs, `prepareDirectory` in reproduction.ts, and
 * `createVelarProject` — and `--out-dir` was the one an author runs daily that
 * did not. `--force` waives the ownership test and nothing else: the home
 * directory, the filesystem root and a symbolic link stay refused.
 */
async function assertReplaceableBuildOutput(outputDirectory: string, replacement: BuildOutputReplacement): Promise<void> {
  const directory = resolve(outputDirectory);
  if (directory === parsePath(directory).root || directory === resolve(homedir())) {
    throw new Error(`refusing to replace '${directory}': a build output cannot be the filesystem root or the home directory`);
  }
  let metadata;
  try {
    metadata = await lstat(directory);
  } catch (error) {
    if (isHostErrorCode(error, "ENOENT") || isHostErrorCode(error, "ENOTDIR")) return;
    throw error;
  }
  if (metadata.isSymbolicLink()) throw new Error(`refusing to replace '${directory}': it is a symbolic link`);
  if (!metadata.isDirectory()) throw new Error(`refusing to replace '${directory}': it is not a directory`);
  if (replacement.forced || replacement.declared) return;
  if ((await readdir(directory)).length === 0) return;
  if (await isBuildOutputDirectory(directory)) return;
  throw new Error(`refusing to replace '${directory}': it is not empty and was not produced by velar build (pass --force to overwrite)`);
}

/**
 * A generic directory carries a complete path-bound inventory receipt;
 * framework and Node directories carry their fully verified production
 * manifests. A transaction marker alone never authorizes replacement.
 */
export async function isBuildOutputDirectory(directory: string, expectedOutputDirectory = directory): Promise<boolean> {
  if (await hasBuildOutputReceipt(directory, expectedOutputDirectory)) return true;
  try {
    await verifyProductionBuild(directory, process.cwd(), { allowBuildStagingMarker: true });
    return true;
  } catch {}
  try {
    await verifyNodeProductionBuild(directory, process.cwd(), { allowBuildStagingMarker: true });
    return true;
  } catch {}
  return false;
}
