/**
 * What `check`, `build` and `package` do before they differ: parse, resolve the
 * project, check it, print the report, and stop on a failing check.
 *
 * The three commands share one prologue because they share one requirement — a
 * project that checks — and each of them answers for what happens after it.
 */

import { parseCommandArguments, parsePackageArguments } from "../arguments.ts";
import { resolveVelarProject, type VelarProjectConfig } from "../config.ts";
import { hostErrorMessage } from "../host-error.ts";
import { libraryBuildRefusal } from "../library-build-guard.ts";
import { formatCheckOutput } from "../project-check.ts";
import { checkedProjectForCommand } from "../project-check-command.ts";
import { reproductionHint } from "../reproduction.ts";
import { writeBuildCommandOutput } from "./build.ts";
import { reportCheckedProject } from "./check.ts";
import { packageCheckedApplication } from "./package.ts";

export async function runCheckedProjectCommand(command: string, rest: readonly string[]): Promise<number> {
  const parsed = command === "package" ? parsePackageArguments(rest) : parseCommandArguments(rest, command === "build");
  if (typeof parsed === "string") {
    process.stderr.write(`velar ${command}: ${parsed}\n`);
    return 2;
  }

  let projectConfig: VelarProjectConfig;
  try {
    projectConfig = await resolveVelarProject(parsed.input);
  } catch (error) {
    process.stderr.write(`velar ${command}: ${hostErrorMessage(error)}\n`);
    return 1;
  }

  // Authorize library output ownership before compilation or output staging.
  if (command === "build") {
    try {
      const refusal = await libraryBuildRefusal(projectConfig, parsed);
      if (refusal !== null) {
        process.stderr.write(`velar build: ${refusal}\n`);
        return 2;
      }
    } catch (error) {
      process.stderr.write(`velar build: cannot establish safe library output ownership: ${hostErrorMessage(error)}\n`);
      return 2;
    }
  }

  const checkResult = await checkedProjectForCommand(command, projectConfig, parsed);
  if (checkResult.error !== null) {
    process.stderr.write(`velar ${command}: ${checkResult.error}\n`);
    return checkResult.exitCode;
  }
  const checked = checkResult.checked;
  const project = checked.project;
  process.stderr.write(formatCheckOutput(checked));
  if (checked.errors.length > 0) {
    // D66 ruling 7B: a failing check ends with the command that bundles the
    // failure — one line, no persuasion, and nothing about data leaving the
    // machine, because `velar repro` never sends any. `build` and `package`
    // reach this same exit, and the ruling names `check`: it is the command the
    // reproduction's own README tells a reader to run.
    if (command === "check") process.stderr.write(`${reproductionHint(parsed.input)}\n`);
    return 1;
  }

  if (command === "check") return reportCheckedProject(checked, parsed, projectConfig);
  if (command === "package") return packageCheckedApplication(project, projectConfig);
  return writeBuildCommandOutput(parsed, project, projectConfig);
}
