/** `velar build-library`: a checked Core or Node source library's frozen ABI-1 artifact. */

import { parseBuildLibraryArguments } from "../arguments.ts";
import { directoryBuildInputs } from "../build-input-boundary.ts";
import {
  commitBuildOutputDirectory,
  discardBuildStaging,
  type PreparedBuildStaging,
} from "../build-output-directory.ts";
import { prepareBuildStaging } from "../build/staging.ts";
import { resolveVelarProject } from "../config.ts";
import { hostErrorMessage } from "../host-error.ts";
import {
  assertVelarLibrarySourcesSurviveOutputReplacement,
  checkVelarLibraryEntries,
  resolveVelarLibraryBuild,
  writeVelarLibraryArtifact,
} from "../library-artifact-build.ts";
import { verifyVelarLibraryBuildForCommit } from "../library-artifact-verifier.ts";

export async function runBuildLibraryCommand(rest: readonly string[]): Promise<number> {
  const parsed = parseBuildLibraryArguments(rest);
  if (typeof parsed === "string") {
    process.stderr.write(`velar build-library: ${parsed}\n`);
    return 2;
  }
  let staging: PreparedBuildStaging | null = null;
  try {
    const config = await resolveVelarProject(parsed.input);
    const library = await resolveVelarLibraryBuild(config);
    const checked = await checkVelarLibraryEntries(library, parsed.input);
    process.stderr.write(checked.output);
    if (checked.failed) return 1;
    await assertVelarLibrarySourcesSurviveOutputReplacement(library, checked.projects);
    staging = await prepareBuildStaging(library.outputRoot,
      { declared: true, forced: false, projectRoot: config.root },
      checked.projects.get(".")!,
      await directoryBuildInputs(config, [...checked.projects.values()]),
    );
    await writeVelarLibraryArtifact(library, checked.projects, staging.directory, parsed.mode ?? config.build.mode);
    const authorization = await verifyVelarLibraryBuildForCommit(library, staging.directory);
    await commitBuildOutputDirectory(staging, authorization);
    staging = null;
    process.stdout.write(`Built Velar library ABI 1 ${library.packageName}@${library.packageVersion} (${library.target}${library.entries.size === 1 ? "" : `, ${library.entries.size} entries`}) -> ${library.receiptPath}\n`);
    return 0;
  } catch (error) {
    if (staging !== null) await discardBuildStaging(staging, error);
    process.stderr.write(`velar build-library: ${hostErrorMessage(error)}\n`);
    return 1;
  }
}
