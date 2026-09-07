/**
 * `velar` with no command, `velar --help`, `velar help [command]`, and the
 * `--help` any command accepts.
 */

import { commandNames, printCommandHelp, printHelp } from "../help.ts";

export function runTopLevelHelp(rest: readonly string[]): number {
  if (rest.length > 0) {
    process.stderr.write("velar help: unexpected arguments after the top-level help option\n");
    return 2;
  }
  printHelp();
  return 0;
}

export function runHelpCommand(rest: readonly string[]): number {
  if (rest.length === 0) {
    printHelp();
    return 0;
  }
  if (rest.length !== 1 || !commandNames.has(rest[0]!)) {
    process.stderr.write(`velar help: unknown command '${rest[0] ?? ""}'\n`);
    return 2;
  }
  printCommandHelp(rest[0]!);
  return 0;
}

export function runCommandHelp(command: string): number {
  printCommandHelp(command);
  return 0;
}
