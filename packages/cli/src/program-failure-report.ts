import { readFileSync } from "node:fs";

/**
 * GA-I3: how a VelarScript program's failure reads when the toolchain reports
 * it, rather than when Node.js does.
 *
 * `velar run` has printed this shape since MOD-U10 — the thrown value's own
 * header, the `.vel` line that raised it with a caret under the column, the
 * frames the author owns, and a count of the ones that were hidden. `velar
 * test` printed the message alone: `Expected "Hello, Velar!" to be "Hello,
 * WRONG!"` with no file, no line, no column and no frames, for the same
 * `AssertionError` that `velar run` located exactly. A failing test is the one
 * moment an author most needs the position, and it was the one report that had
 * none.
 *
 * Two things kept it that way, and both are handled here. `hostErrorStack` reads
 * `stack` as an *own data* property, and V8 publishes it as an own accessor, so
 * every stack fell back to the message; and nothing applied the frame policy
 * outside the `velar run` launcher, so a raw trace would have been Node's
 * internals with the author's two lines somewhere inside.
 *
 * The policy itself is the one `packages/compiler/runtime/error.js` and the
 * `velar run` launcher apply: a frame is the author's unless it is Node's own,
 * the language runtime's (recognized by the reserved `__velar` name prefix the
 * compiler's inlined helpers carry), or a shipped runtime module's. The hidden
 * count is stated without naming a flag — `velar test` has no `--stack`, and a
 * report that tells a reader to rerun with a flag that does not exist is worse
 * than one that says nothing.
 */
const MAXIMUM_TEXT_LENGTH = 64 * 1024;
const MAXIMUM_CAUSE_DEPTH = 8;
const MAXIMUM_CODE_FRAME_BYTES = 4 * 1024 * 1024;
const MAXIMUM_CODE_FRAME_COLUMNS = 240;

const INTERNAL_FRAME = /(?:^|\s|\()node:[a-z_]+(?:\/|:)/u;
const RUNTIME_FRAME = /\bat\s(?:async\s)?(?:new\s)?(?:[^\s(]*\.)?__[Vv]elar/u;
const FRAME_LINE = /^\s+at\s/u;
const FRAME_POSITION = /\(?([^()]+):(\d+):(\d+)\)?$/u;

/**
 * One failure, presented the way `velar run` presents an uncaught one.
 *
 * `harness` is the module URL of the code that invoked the program — the test
 * thread's own entry. Its frames are removed rather than hidden, because they
 * are not the program's and were never the author's; `velar run`'s launcher
 * removes its own frame the same way.
 */
export function formatProgramFailure(error: unknown, harness?: string): string {
  const output: string[] = [];
  let current: unknown = error;
  for (let depth = 0; depth <= MAXIMUM_CAUSE_DEPTH; depth += 1) {
    const trace = presentTrace(current, harness);
    if (depth > 0) output.push("caused by:");
    output.push(...trace.header);
    if (depth === 0 && trace.snippet !== undefined) output.push(...codeFrame(trace.snippet));
    output.push(...trace.owned.map((frame) => portableFrame(frame)));
    if (trace.hidden > 0) {
      output.push(`  (${trace.hidden} Node.js internal frame${trace.hidden === 1 ? "" : "s"} hidden)`);
    }
    const cause = current instanceof Error ? current.cause : undefined;
    if (cause === undefined || cause === null) break;
    if (depth === MAXIMUM_CAUSE_DEPTH) {
      output.push("caused by: (further causes omitted)");
      break;
    }
    current = cause;
  }
  return output.join("\n");
}

interface PresentedTrace {
  readonly header: readonly string[];
  readonly owned: readonly string[];
  /** The first frame the author owns, whose source line the code frame is cut from. */
  readonly snippet: string | undefined;
  readonly hidden: number;
}

function presentTrace(error: unknown, harness: string | undefined): PresentedTrace {
  const lines = describe(error).split("\n");
  const frames = withoutRepeats(lines.filter((line) =>
    FRAME_LINE.test(line) && (harness === undefined || !line.includes(harness))));
  const owned = frames.filter(ownedFrame);
  return {
    header: lines.filter((line) => !FRAME_LINE.test(line)),
    owned,
    snippet: owned[0],
    hidden: frames.length - owned.length,
  };
}

/**
 * A frame is the author's unless it is Node's own or the language runtime's —
 * with one refinement the `velar run` launcher does not need.
 *
 * A `test "…"` declaration is emitted as a function the compiler names
 * `__velarTest<offset>`, which the reserved-prefix rule reads as runtime code.
 * That rule exists to hide the helpers the compiler *inlines* into a module,
 * and those frames name the generated `.js` because no source mapping covers
 * them (CO-U2 is exactly that observation). A frame that maps back to a `.vel`
 * file is source the author wrote, whatever the emitted function ended up being
 * called, so it stays. Without this the failing test's own line — the one thing
 * the report exists to show — was the frame that got hidden.
 */
function ownedFrame(line: string): boolean {
  if (INTERNAL_FRAME.test(line)) return false;
  if (line.includes("/node_modules/velar/")) return false;
  return !RUNTIME_FRAME.test(line) || velarSourceFrame(line);
}

function velarSourceFrame(line: string): boolean {
  return FRAME_POSITION.exec(line.trimEnd())?.[1]?.endsWith(".vel") === true;
}

/**
 * The frame as the author reads it: forward slashes on every platform, and no
 * compiler-chosen name. A `test "…"` body is emitted as `__velarTest<offset>`,
 * a spelling no source may bind and nobody wrote; naming the frame for what the
 * author declared keeps the reserved prefix out of a report about their code.
 */
function portableFrame(frame: string): string {
  return frame.replaceAll("\\", "/").replace(/\bat __velarTest\d+ /u, "at <test> ");
}

/**
 * CO-U3's rule, in the second place that needs it: a runtime narrowing guard is
 * lowered as an arrow applied at the read it guards, so a failed guard leaves
 * two frames at one `file:line:column`. Two frames a reader cannot tell apart
 * are not two call sites.
 */
function withoutRepeats(frames: readonly string[]): readonly string[] {
  return frames.filter((line, index) => line !== frames[index - 1]);
}

/**
 * The thrown value as text. The stack is read through the property rather than
 * through an own *data* descriptor, because V8 publishes `stack` as an own
 * accessor; the read is guarded because the value may be a foreign object whose
 * getter throws, and bounded because it may be arbitrarily long.
 */
function describe(error: unknown): string {
  if (error instanceof Error) {
    let stack: unknown;
    try { stack = error.stack; } catch { stack = undefined; }
    if (typeof stack === "string" && stack.length > 0) return bounded(stack);
    return bounded(`${error.name}: ${error.message}`);
  }
  if (typeof error === "string") return bounded(`The program threw a non-Error string value: ${error}`);
  return `The program threw a non-Error ${error === null ? "null" : typeof error} value`;
}

function bounded(value: string): string {
  return value.length <= MAXIMUM_TEXT_LENGTH ? value : `${value.slice(0, MAXIMUM_TEXT_LENGTH)}…`;
}

/** The `.vel` line a frame names, with a caret under its column. */
function codeFrame(frame: string): readonly string[] {
  const position = FRAME_POSITION.exec(frame.trimEnd());
  if (!position || !position[1]!.endsWith(".vel")) return [];
  try {
    const text = readFileSync(position[1]!, "utf8");
    if (text.length > MAXIMUM_CODE_FRAME_BYTES) return [];
    const line = text.split(/\r\n|\r|\n/u)[Number(position[2]) - 1];
    if (line === undefined || line.length > MAXIMUM_CODE_FRAME_COLUMNS) return [];
    const column = Math.max(1, Number(position[3]));
    return [line, `${" ".repeat(column - 1)}^`];
  } catch {
    return [];
  }
}
