import { spawn } from "node:child_process";
import { repositoryRoot } from "./repository-root.ts";

/**
 * D115 P5 — the one copy of "spawn this command in the repository root and
 * collect everything it wrote".
 *
 * `tests/support/run-cli.ts` is the synchronous CLI runner; this is the
 * streaming one the Web fixtures need, because a fixture run is minutes long
 * and its output is read as one string at the end rather than parsed as it
 * arrives. Both streams are captured into one buffer, in arrival order, which
 * is what a reader of the run's report sees.
 *
 * There are two of them, and the difference is the question the caller is
 * asking. `runCommand` treats a non-zero exit as a failure of the test, which
 * is right when the run is expected to pass. `runCommandOutcome` hands the exit
 * code back instead, which is what a probe that asserts a run *fails* in a
 * particular bounded way needs: a rejection there would lose the report the
 * assertion is about.
 */
export function runCommand(command: string, arguments_: readonly string[]): Promise<string> {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, arguments_, { cwd: repositoryRoot, stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => { output += chunk; });
    child.stderr.on("data", (chunk: string) => { output += chunk; });
    child.once("error", rejectPromise);
    child.once("exit", (code) => {
      if (code === 0) resolvePromise(output);
      else rejectPromise(new Error(output || `Command exited with ${String(code)}`));
    });
  });
}

/** What the command wrote and the code it exited with; a spawn that never started still rejects. */
export interface CommandOutcome {
  readonly output: string;
  readonly code: number | null;
}

export function runCommandOutcome(command: string, arguments_: readonly string[]): Promise<CommandOutcome> {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, arguments_, { cwd: repositoryRoot, stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => { output += chunk; });
    child.stderr.on("data", (chunk: string) => { output += chunk; });
    child.once("error", rejectPromise);
    child.once("exit", (code) => resolvePromise({ output, code }));
  });
}
