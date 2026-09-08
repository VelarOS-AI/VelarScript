import { parentDeathPollIntervalMs } from "./process-lifetime.ts";
import { VELAR_PROGRAM_FAILURE_RUNTIME } from "./runtime-sources.generated.ts";

export interface UncaughtProgramEntryOptions {
  /** The compiled entry module the launcher imports. */
  readonly entryUrl: string;
  /** The `.vel` entry the author wrote, named in the failure header. */
  readonly sourcePath: string;
  /** Prints every frame, including Node.js internals, instead of the owned ones. */
  readonly fullStack: boolean;
}

/** The launcher's presentation uses the same generated Node reporter as tests. */
const PROGRAM_ENTRY_PRESENTATION = `globalThis[Symbol.for("velar.run.stack")] = Object.freeze({ fullStack, command: "velar run" });
const present = (summary, error, ownHeader = true) => {
  const detail = __velarProgramFailure(error, import.meta.url, fullStack, "velar run", ownHeader);
  process.stderr.write(\`\${summary}\\n\${detail}\\n\`);
};
`;

/**
 * The launcher's entry half: the two failures a `velar run` program can end in
 * without the program itself having said so.
 *
 * D114 item A, the launcher half. The entry is a **dynamically** imported
 * module, so Node.js does not apply to it the exit-13 rule it applies to an
 * unsettled top-level `await` in a main module: the loop simply drains, the
 * process exits **0**, and stdout is truncated at whatever `@main` had printed
 * — a success that had not happened. Holding the entry's promise is what makes
 * the difference observable: `beforeExit` is the moment the loop has drained,
 * and an entry still unsettled then is a program whose `@main` never finished.
 * The report goes through the same formatter the uncaught path uses, so
 * `velar run --stack` shows its frames too, and the exit code is 13 — the code
 * Node.js itself gives this exact program shape when the entry is the main
 * module, so how `velar run` entered the program stops changing how it ends.
 *
 * A settled entry, fulfilled or rejected, is untouched, and a program that ends
 * through `velar/host`'s `exit` never reaches `beforeExit` at all.
 */
const PROGRAM_ENTRY_COMPLETION = `process.on("uncaughtException", (error) => {
  // Another listener means the program owns this error and Node.js would not
  // have made it fatal; the launcher stays out of the way.
  if (process.listeners("uncaughtException").length > 1) return;
  present(\`velar run: uncaught error while running \${sourcePath}\`, error);
  process.exit(1);
});

let entryFinished = false;
let incompleteReported = false;

// The entry is imported without awaiting it here: an await in this launcher
// would add a launcher frame to every async stack the program itself prints.
// The promise is held rather than discarded, because whether it ever settled is
// the one thing that separates a program that finished from a loop that drained
// with '@main' still unfinished.
const entry = import(entryUrl);
entry.then(() => { entryFinished = true; }, (error) => {
  entryFinished = true;
  present(\`velar run: uncaught error while running \${sourcePath}\`, error);
  process.exit(1);
});

process.on("beforeExit", () => {
  if (entryFinished || incompleteReported) return;
  incompleteReported = true;
  // The loop drained with the entry unsettled. The Node runtime modules publish
  // no in-flight probe, so the report names the only thing the launcher can
  // prove rather than guessing which awaited call it was; the frames of the
  // drain itself are one 'velar run --stack' away.
  present(
    "velar run: the program's @main did not finish:"
      + " the event loop drained while an awaited value never settled",
    new Error("the program's @main did not finish"),
    false,
  );
  // 13 is Node.js's own code for an unsettled top-level await. The program has
  // exactly that shape; only the dynamic import kept Node.js from applying it.
  process.exit(13);
});
`;

/**
 * D114 F9-node-cli, audit NO-D3: the program `velar run` started must not
 * outlive the launcher that started it.
 *
 * `velar run` forwards SIGINT and SIGTERM to its child and gives it the 30
 * second window `velar/host` promises, which covers every ordinary ending. It
 * does not cover the launcher being killed outright: SIGKILL runs no handler,
 * the child is reparented, and a server keeps its port with nobody left to
 * report to. B1 and B2 answered exactly this for the development server, the
 * preview server and the browser-test supervisor — `watchParentDeath` in
 * `process-lifetime.ts` — and `velar run` was the one launcher the mechanism
 * had not reached. The child is a launcher this file writes, so the mechanism
 * is written here, as the same three observations: the reparenting a poll of
 * `process.ppid` sees, an IPC channel closing, and nothing left reading the
 * output. It reports once, and what it does is send itself the signal the
 * launcher would have sent — so the program runs the one shutdown path it
 * already has rather than a second one written for this case.
 *
 * The poll interval is the exported one, not a number copied here: a ladder a
 * gate has to know cannot have two rungs of different length.
 */
const PROGRAM_ENTRY_PARENT_WATCH = `const parentAtStart = process.ppid;
let parentDeathReported = false;
const endWithParent = (reason) => {
  if (parentDeathReported) return;
  parentDeathReported = true;
  try { process.stderr.write(\`velar run: ending \${sourcePath} because \${reason}\\n\`); } catch {}
  try { process.kill(process.pid, "SIGTERM"); } catch { process.exit(143); }
};
// The watch must never be the reason the program stays up: a program that ends
// on its own has to end whether or not anyone is still watching for a parent.
setInterval(() => {
  if (process.ppid !== parentAtStart) endWithParent("the process that started it exited");
}, parentDeathPollIntervalMs).unref();
process.on("disconnect", () => endWithParent("the process that started it closed their channel"));
// Listening is also what keeps a broken pipe from becoming an uncaught
// exception: process.stdout is never destroyed by an error, so without a
// listener every later line writes, fails, and throws again.
const onWriteFailure = (error) => {
  if (error?.code !== "EPIPE" && error?.code !== "ERR_STREAM_DESTROYED") return;
  endWithParent("nothing is reading its output");
};
process.stdout.on("error", onWriteFailure);
process.stderr.on("error", onWriteFailure);
`;

/**
 * MOD-U10: an uncaught module-initialization or entry error used to reach the
 * author as a raw Node.js crash dump — `.vel` frames source-mapped correctly but
 * buried between `ModuleJob.run (node:internal/...)` frames and a `Node.js
 * vX.Y.Z` banner, which reads as a toolchain crash rather than a program
 * failure. `velar run` therefore enters the program through this launcher: the
 * failure is presented as an owned VelarScript failure with the author's frames,
 * and the unfiltered trace stays one flag away (`velar run --stack`).
 *
 * The launcher only presents an error Node.js would otherwise have made fatal:
 * when the program installs its own `uncaughtException` listener the program
 * owns the error and this handler stands down, so program semantics are
 * unchanged. D114 item A added the second report the launcher owns — see
 * `PROGRAM_ENTRY_COMPLETION` — for the one failure Node.js does *not* make
 * fatal in a dynamically imported entry: an `@main` that never finished.
 */
export function uncaughtProgramEntrySource(options: UncaughtProgramEntryOptions): string {
  return `${VELAR_PROGRAM_FAILURE_RUNTIME}

const entryUrl = ${JSON.stringify(options.entryUrl)};
const sourcePath = ${JSON.stringify(options.sourcePath)};
const fullStack = ${options.fullStack ? "true" : "false"};
const parentDeathPollIntervalMs = ${parentDeathPollIntervalMs};
${PROGRAM_ENTRY_PRESENTATION}
${PROGRAM_ENTRY_PARENT_WATCH}
${PROGRAM_ENTRY_COMPLETION}`;
}
