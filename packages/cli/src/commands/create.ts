/** `velar create`: a transactional new project from a packaged template. */

import { createVelarProject, parseCreateArguments } from "create-velar";
import { hostErrorMessage } from "../host-error.ts";

export async function runCreateCommand(rest: readonly string[]): Promise<number> {
  const parsed = parseCreateArguments(rest);
  if (typeof parsed === "string") {
    process.stderr.write(`velar create: ${parsed}\n`);
    return 2;
  }
  try {
    const result = await createVelarProject(parsed.directory, { template: parsed.template });
    process.stdout.write(`Created VelarScript ${result.template} project -> ${result.root}\n`);
    return 0;
  } catch (error) {
    process.stderr.write(`velar create: ${hostErrorMessage(error)}\n`);
    return 1;
  }
}
