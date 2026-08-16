import { isAbsolute } from "node:path";

export const projectTaskCommands = [
  "check",
  "test",
  "build",
  "fix",
  "package",
  "run",
] as const;

export type ProjectTaskCommand = typeof projectTaskCommands[number];

const supportedProjectTaskCommands = new Set<string>(projectTaskCommands);
const isProjectTaskCommand = (value: string | undefined): value is ProjectTaskCommand =>
  typeof value === "string" && supportedProjectTaskCommands.has(value);

/**
 * Translates Desktop's closed task vocabulary into the exact public CLI
 * invocation. The host never accepts arbitrary CLI options; adding a task is
 * an explicit capability change here and in velar/desktop.
 */
export function projectTaskCliArguments(arguments_: readonly string[]): readonly string[] | string {
  const [command, projectRoot, separator, ...programArguments] = arguments_;
  if (!isProjectTaskCommand(command) || typeof projectRoot !== "string"
    || !isAbsolute(projectRoot) || projectRoot.length > 4096 || projectRoot.includes("\0")) {
    return "invalid package-owned task invocation";
  }
  if (command === "run") {
    if (separator !== undefined && separator !== "--") return "invalid package-owned task invocation";
    return separator === undefined ? ["run", projectRoot] : ["run", projectRoot, "--", ...programArguments];
  }
  if (separator !== undefined || programArguments.length > 0) return "invalid package-owned task invocation";
  return [command, projectRoot];
}
