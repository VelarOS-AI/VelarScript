/**
 * `velar install`, `add`, `remove` and `update`: the four dependency commands.
 *
 * They differ only in the action word they carry into the package manager and
 * in the sentence they report, so they are one arm with four names.
 */

import { hostErrorMessage } from "../host-error.ts";
import { type DependencyAction, parseDependencyArguments, runDependencyCommand } from "../package-manager.ts";

export async function runDependencyArm(command: DependencyAction, rest: readonly string[]): Promise<number> {
  const parsed = parseDependencyArguments(command, rest);
  if (typeof parsed === "string") {
    process.stderr.write(`velar ${command}: ${parsed}\n`);
    return 2;
  }
  try {
    const result = await runDependencyCommand(command, parsed);
    process.stdout.write(dependencyResultMessage(command, result.root, result.packages, result.activatedExtensions, result.removedExtensions));
    return 0;
  } catch (error) {
    process.stderr.write(`velar ${command}: ${hostErrorMessage(error)}\n`);
    return 1;
  }
}

function dependencyResultMessage(
  action: DependencyAction,
  root: string,
  packages: readonly string[],
  activated: readonly string[],
  removed: readonly string[],
): string {
  if (action === "install") return `Installed and validated VelarScript project dependencies -> ${root}\n`;
  const names = packages.length > 0 ? packages.join(", ") : "all direct dependencies";
  const detail = activated.length > 0
    ? `; activated extensions: ${activated.join(", ")}`
    : removed.length > 0
      ? `; removed extensions: ${removed.join(", ")}`
      : "";
  const verb = action === "add" ? "Added" : action === "remove" ? "Removed" : "Updated";
  return `${verb} ${names}${detail} -> ${root}\n`;
}
