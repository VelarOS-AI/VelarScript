import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

/**
 * D115 §一.6 — the one copy of "spawn the CLI the way a person would".
 *
 * Thirty-three test files each carried a `runCli` of their own, differing in
 * nothing that mattered — which of two argument orders, whether the streams
 * came back through `String(…)` or `?? ""`, a timeout of 120 or 300 seconds —
 * and the CLI entry itself was spelled four different ways
 * (`new URL(…).pathname`, `fileURLToPath(new URL(…))`, `join(repositoryRoot, …)`,
 * `join(workspaceRoot, …)`). One spawn, one entry, one result shape here; what
 * a caller varies it passes.
 *
 * The two argument orders both survive as thin binders rather than as two
 * implementations, because reordering several hundred call sites would be a
 * change to the tests rather than to the harness they share.
 */
export const cliPath = fileURLToPath(new URL("../../packages/cli/src/cli.ts", import.meta.url));

/** What every one of those thirty-three helpers returned. */
export interface CliRun {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

export interface CliRunOptions {
  /** Milliseconds before the child is killed; absent means no bound. */
  readonly timeout?: number | undefined;
  /** Added on top of `process.env`; absent means the parent environment, unchanged. */
  readonly environment?: Readonly<Record<string, string>> | undefined;
  /** Bytes of captured output; absent means Node's default. */
  readonly maxBuffer?: number | undefined;
}

/** Run the CLI in `cwd`. The canonical shape: working directory first. */
export function runCli(cwd: string, arguments_: readonly string[], options: CliRunOptions = {}): CliRun {
  const result = spawnSync(process.execPath, [cliPath, ...arguments_], {
    cwd,
    encoding: "utf8",
    timeout: options.timeout,
    maxBuffer: options.maxBuffer,
    ...(options.environment === undefined ? {} : { env: { ...process.env, ...options.environment } }),
  });
  return { status: result.status, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

/** A `runCli` with its options already bound: `(cwd, arguments)`. */
export function cliRunner(options: CliRunOptions = {}): (cwd: string, arguments_: readonly string[]) => CliRun {
  return (cwd, arguments_) => runCli(cwd, arguments_, options);
}

/** The same, spelled `(cwd, ...arguments)`. */
export function variadicCliRunner(options: CliRunOptions = {}): (cwd: string, ...arguments_: readonly string[]) => CliRun {
  return (cwd, ...arguments_) => runCli(cwd, arguments_, options);
}

/** The same, spelled `(arguments, cwd)` — the order the library-artifact family was written with. */
export function argumentsFirstCliRunner(options: CliRunOptions = {}): (arguments_: readonly string[], cwd: string) => CliRun {
  return (arguments_, cwd) => runCli(cwd, arguments_, options);
}
