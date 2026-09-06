import { spawnSync, type SpawnSyncReturns } from "node:child_process";

/**
 * D115 §一.6 — the one copy of "run this emitted JavaScript".
 *
 * Twenty-seven test files each carried their own three-line `executeModule`,
 * and twenty-four of them were the same three lines. The generated program goes
 * in on stdin rather than through `--eval`, because a generated program is as
 * long as the source that produced it and `--eval` is bounded by the host's
 * command-line size (notably Linux `ARG_MAX`); stdin is the portable module
 * boundary and keeps the test about the runtime ABI it owns.
 *
 * `timeout` is the one option a caller has ever varied — a program written to
 * probe an unbounded loop must not hold the suite open — so it is a parameter
 * rather than a second copy of the function.
 */
export function executeModule(code: string, options: { readonly timeout?: number | undefined } = {}): SpawnSyncReturns<string> {
  return spawnSync(process.execPath, ["--input-type=module"], {
    encoding: "utf8",
    input: code,
    timeout: options.timeout,
  });
}

/** The same run, with the two streams read as text rather than as `Buffer | string`. */
export function executeModuleText(code: string): {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
} {
  const result = executeModule(code);
  return { status: result.status, stdout: String(result.stdout), stderr: String(result.stderr) };
}
