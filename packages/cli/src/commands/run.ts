/** `velar run`: compile the resolved Core project and execute its entry once. */

import { parseRunArguments } from "../arguments.ts";
import { resolveVelarProject, type VelarProjectConfig } from "../config.ts";
import { hostErrorMessage } from "../host-error.ts";
import { runProgram } from "../program-runner.ts";

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
    process.stderr.write(`velar run: this project enables the '${projectConfig.framework.host.id}' application framework; use 'velar dev' or 'velar build' instead\n`);
    return 1;
  }
  try {
    return await runProgram(projectConfig, parsed.programArguments, { fullStack: parsed.fullStack });
  } catch (error) {
    process.stderr.write(`velar run: ${hostErrorMessage(error)}\n`);
    return 1;
  }
}
