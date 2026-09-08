/** `velar run`: compile the resolved Core project and execute its entry once. */

import { parseRunArguments } from "../arguments.ts";
import { resolveVelarProject, type VelarProjectConfig } from "../config.ts";
import { displayManifestPath } from "../help.ts";
import { hostErrorMessage } from "../host-error.ts";
import { runProgram } from "../program-runner.ts";
import { isExplicitProjectSourceInput } from "../project-source-package.ts";

export async function runRunCommand(rest: readonly string[]): Promise<number> {
  const parsed = parseRunArguments(rest);
  if (typeof parsed === "string") {
    process.stderr.write(`velar run: ${parsed}\n`);
    return 2;
  }
  let projectConfig: VelarProjectConfig;
  try {
    projectConfig = await resolveVelarProject(parsed.input);
  } catch (error) {
    process.stderr.write(`velar run: ${hostErrorMessage(error)}\n`);
    return 1;
  }
  if (projectConfig.framework) {
    // GA-U6: the refusal names the manifest entry that decided it, because
    // that is the line the reader edits to change the answer.
    process.stderr.write(`velar run: ${displayManifestPath(projectConfig)} lists '${projectConfig.framework.host.id}' in 'extensions', which makes this a ${projectConfig.framework.host.displayName} application; use 'velar dev' or 'velar build' instead\n`);
    return 1;
  }
  // GA-U3: a library publishes declarations and exports; it has no entry the
  // host executes, so `velar run` answered a library with exit 0 and no output
  // at all. The command that does have something to do with a library is named.
  // A named `.vel` source scopes the run to itself rather than to the project's
  // entry, exactly as it scopes out the project-layer rules, so it still runs.
  if (projectConfig.kind === "library" && !isExplicitProjectSourceInput(projectConfig)) {
    process.stderr.write(`velar run: ${displayManifestPath(projectConfig)} declares kind "library", and a library has no entry to run; use 'velar test' to run its tests or 'velar build-library' to write its artifact\n`);
    return 1;
  }
  try {
    return await runProgram(projectConfig, parsed.programArguments, { fullStack: parsed.fullStack });
  } catch (error) {
    process.stderr.write(`velar run: ${hostErrorMessage(error)}\n`);
    return 1;
  }
}
