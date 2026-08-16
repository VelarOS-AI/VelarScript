import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute, relative } from "node:path";

export const projectTaskCommands = [
  "check",
  "test",
  "browserTest",
  "build",
  "fix",
  "package",
  "run",
] as const;

export type ProjectTaskCommand = typeof projectTaskCommands[number];

export const projectTaskBrowserWorkerEnvironment = "VELAR_BROWSER_TEST_WORKER_V1";

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
  if (command === "browserTest") return ["test", projectRoot, "--browser=all"];
  return [command, projectRoot];
}

/**
 * The browser owner supervises its test body in a second invocation of the
 * same immutable tool. Desktop strips this private marker from the initial
 * task environment, so only the official supervisor can enter this path.
 */
export function projectTaskBrowserWorkerCliArguments(
  arguments_: readonly string[],
  serializedLimits: string | undefined,
): readonly string[] | string {
  if (typeof serializedLimits !== "string" || serializedLimits.length < 2 || serializedLimits.length > 4096) {
    return "invalid supervised browser-test limits";
  }
  try {
    const limits: unknown = JSON.parse(serializedLimits);
    if (limits === null || typeof limits !== "object" || Array.isArray(limits)) {
      return "invalid supervised browser-test limits";
    }
  } catch {
    return "invalid supervised browser-test limits";
  }
  const [command, input, browser, ...rest] = arguments_;
  if (command === "test" && typeof input === "string" && isAbsolute(input)
    && /^--browser=(?:chromium|firefox|webkit|all)$/u.test(browser ?? "") && rest.length === 0) {
    return arguments_;
  }
  const [buildCommand, projectRoot, outFlag, outputDirectory, ...buildRest] = arguments_;
  const temporaryRoot = typeof outputDirectory === "string" ? dirname(outputDirectory) : "";
  const fromSystemTemporary = temporaryRoot === "" ? ".." : relative(tmpdir(), temporaryRoot);
  if (buildCommand === "build" && typeof projectRoot === "string" && isAbsolute(projectRoot)
    && outFlag === "--out-dir" && typeof outputDirectory === "string" && isAbsolute(outputDirectory)
    && basename(outputDirectory) === "site" && basename(temporaryRoot).startsWith("velar-browser-tests-")
    && fromSystemTemporary !== "" && fromSystemTemporary !== ".." && !fromSystemTemporary.startsWith("../")
    && !isAbsolute(fromSystemTemporary) && buildRest.length === 0) {
    return arguments_;
  }
  return "invalid supervised browser-test arguments";
}
