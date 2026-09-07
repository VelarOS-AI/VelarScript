/** `velar serve`: a checked Node server factory under production runtime behavior. */

import { parseServeArguments } from "../arguments.ts";
import { resolveVelarProject } from "../config.ts";
import { hostErrorMessage } from "../host-error.ts";
import { runNodeApplication } from "../node-application.ts";

export async function runServeCommand(rest: readonly string[]): Promise<number> {
  const parsed = parseServeArguments(rest);
  if (typeof parsed === "string") {
    process.stderr.write(`velar serve: ${parsed}\n`);
    return 2;
  }
  try {
    const projectConfig = await resolveVelarProject(parsed.input);
    return await runNodeApplication(projectConfig);
  } catch (error) {
    process.stderr.write(`velar serve: ${hostErrorMessage(error)}\n`);
    return 1;
  }
}
