/** `velar dev`: the watching development server for a Web, Desktop or Node target. */

import { parseDevArguments } from "../arguments.ts";
import { resolveVelarProject, type VelarProjectConfig } from "../config.ts";
import { runDevServer } from "../dev-server.ts";
import { hostErrorMessage } from "../host-error.ts";
import { nodeApplicationConfig } from "../node-application-config.ts";
import { runNodeDevelopment } from "../node-application.ts";

export async function runDevCommand(rest: readonly string[]): Promise<number> {
  const parsed = parseDevArguments(rest);
  if (typeof parsed === "string") {
    process.stderr.write(`velar dev: ${parsed}\n`);
    return 2;
  }
  let projectConfig: VelarProjectConfig;
  try {
    projectConfig = await resolveVelarProject(parsed.input);
    if (projectConfig.framework) await runDevServer(projectConfig, parsed.port ?? 5173);
    else if (nodeApplicationConfig(projectConfig)) {
      if (parsed.port !== null) throw new Error("Node application host and port belong to velar/server configuration; --port is available only to Web and Desktop development servers");
      await runNodeDevelopment(projectConfig);
    }
    else throw new Error("the project does not declare a Web, Desktop, or Node application target");
  } catch (error) {
    process.stderr.write(`velar dev: ${hostErrorMessage(error)}\n`);
    return 1;
  }
  return 0;
}
