#!/usr/bin/env node

/**
 * The `velar` command entry.
 *
 * This file is the dispatcher and nothing else: it reads the command word, the
 * four spellings of help and version that come before any command, and hands
 * the rest to the module that owns that command. Every arm lives in
 * `commands/<command>.ts`, the writers a build reaches for live in `build/`,
 * the option grammars live in `arguments.ts`, and the two help texts live in
 * `help.ts`. A reader looking for what `velar test` does opens `commands/test.ts`
 * rather than the middle of a 675-line `main`.
 */

import { fileURLToPath } from "node:url";
import { helpRequested } from "./arguments.ts";
import { runBuildLibraryCommand } from "./commands/build-library.ts";
import { runCheckedProjectCommand } from "./commands/build-tail.ts";
import { runCreateCommand } from "./commands/create.ts";
import { runDevCommand } from "./commands/dev.ts";
import { runFixCommand } from "./commands/fix.ts";
import { runFormatCommand } from "./commands/format.ts";
import { runGraphCommand } from "./commands/graph.ts";
import { runCommandHelp, runHelpCommand, runTopLevelHelp } from "./commands/help.ts";
import { runDependencyArm } from "./commands/install.ts";
import { runLspCommand } from "./commands/lsp.ts";
import { runPreviewCommand } from "./commands/preview.ts";
import { runReproCommand } from "./commands/repro.ts";
import { runRunCommand } from "./commands/run.ts";
import { runServeCommand } from "./commands/serve.ts";
import { runSkillCommand } from "./commands/skill.ts";
import { runTestCommand } from "./commands/test.ts";
import { runVerifyCommand } from "./commands/verify.ts";
import { runVerifyDeploymentCommand } from "./commands/verify-deployment.ts";
import { runVersionCommand } from "./commands/version.ts";
import { commandNames, printHelp } from "./help.ts";
import { hostErrorMessage } from "./host-error.ts";

/** What every command arm is: the arguments after the command word, and an exit code. */
type CommandArm = (rest: readonly string[]) => Promise<number>;

/**
 * The command word a `velar` invocation names, and the arm that answers it.
 *
 * A `Map` rather than an object literal, because the key comes from `argv`:
 * `velar constructor` must be an unknown command and not a reachable member of
 * `Object.prototype`.
 *
 * `check`, `build` and `package` are deliberately absent — they share one
 * prologue and reach their own answers through `runCheckedProjectCommand`.
 */
const COMMAND_ARMS: ReadonlyMap<string, CommandArm> = new Map<string, CommandArm>([
  ["lsp", runLspCommand],
  ["skill", runSkillCommand],
  ["graph", runGraphCommand],
  ["create", runCreateCommand],
  ["install", (rest) => runDependencyArm("install", rest)],
  ["add", (rest) => runDependencyArm("add", rest)],
  ["remove", (rest) => runDependencyArm("remove", rest)],
  ["update", (rest) => runDependencyArm("update", rest)],
  ["verify", runVerifyCommand],
  ["preview", runPreviewCommand],
  ["verify-deployment", runVerifyDeploymentCommand],
  ["run", runRunCommand],
  ["fix", runFixCommand],
  // `velar repro` re-checks the bundle it wrote by spawning the toolchain entry
  // again, and the entry is this file. The arm is handed the path rather than
  // reading `import.meta.url` itself, which there would name the arm's module.
  ["repro", (rest) => runReproCommand(rest, fileURLToPath(import.meta.url))],
  ["build-library", runBuildLibraryCommand],
  ["format", runFormatCommand],
  ["dev", runDevCommand],
  ["serve", runServeCommand],
  ["test", runTestCommand],
]);

async function main(arguments_: readonly string[]): Promise<number> {
  const [command, ...rest] = arguments_;

  if (!command || command === "--help" || command === "-h") return runTopLevelHelp(rest);
  if (command === "help") return runHelpCommand(rest);
  if (command === "--version" || command === "-v") return runVersionCommand(rest);
  if (commandNames.has(command) && helpRequested(command, rest)) return runCommandHelp(command);

  const arm = COMMAND_ARMS.get(command);
  if (arm !== undefined) return arm(rest);

  if (command !== "check" && command !== "build" && command !== "package") {
    process.stderr.write(`Unknown command '${command}'.\n\n`);
    printHelp(process.stderr);
    return 2;
  }
  return runCheckedProjectCommand(command, rest);
}

try {
  process.exitCode = await main(process.argv.slice(2));
} catch (error) {
  process.stderr.write(`velar: ${hostErrorMessage(error)}\n`);
  process.exitCode = 1;
}
