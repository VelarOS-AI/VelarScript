import { closeSync, constants, fstatSync, openSync, readSync } from "node:fs";
import { fileURLToPath } from "node:url";

// The CLI owns filesystem-backed source snippets; the compiler runtime owns
// every decision about which stack frames belong to the author. Both the run
// launcher and the test reporter execute this exact generated source.
function __velarProgramCodeFrame(frame) {
  const position = __velarHostErrorFramePosition(frame);
  if (position === null || !position.path.endsWith(".vel") || position.column > 241) return [];
  let file = null;
  try {
    const path = position.path.startsWith("file:") ? fileURLToPath(position.path) : position.path;
    file = openSync(path, constants.O_RDONLY | constants.O_NONBLOCK);
    const before = fstatSync(file);
    if (!before.isFile() || before.size > 4 * 1024 * 1024) return [];
    const bytes = Buffer.alloc(before.size + 1);
    let count = 0;
    while (count < bytes.length) {
      const read = readSync(file, bytes, count, bytes.length - count, count);
      if (read === 0) break;
      count += read;
    }
    const after = fstatSync(file);
    if (count !== before.size || after.size !== before.size || after.mtimeMs !== before.mtimeMs) return [];
    const line = bytes.toString("utf8", 0, count).split(/\r\n|\r|\n/u)[position.line - 1];
    if (line === undefined || line.length > 240 || position.column > line.length + 1) return [];
    return [line, " ".repeat(position.column - 1) + "^"];
  } catch { return []; }
  finally { if (file !== null) { try { closeSync(file); } catch {} } }
}

function __velarProgramExcludedFrames(harness) {
  if (typeof harness !== "string" || harness === "") return [];
  try { return [harness, fileURLToPath(harness)]; }
  catch { return [harness]; }
}

function __velarProgramFailure(error, harness, fullStack = false, command = "velar test", ownHeader = true, runtimeRoots = []) {
  const output = [];
  let current = error;
  const excluded = __velarProgramExcludedFrames(harness);
  for (let depth = 0; depth <= 8; depth += 1) {
    const trace = __velarHostErrorPresentation(__velarHostErrorDescription(current), fullStack, excluded, runtimeRoots);
    if (depth > 0) output.push("caused by:");
    if (depth > 0 || ownHeader) output.push(...trace.header);
    if (depth === 0 && trace.snippet !== undefined) output.push(...__velarProgramCodeFrame(trace.snippet));
    output.push(...trace.frames);
    if (trace.hidden > 0) output.push(__velarHostErrorSummary(trace.hidden, command));
    const cause = __velarHostErrorOwnCause(current);
    if (cause === undefined || cause === null) break;
    if (depth === 8) {
      output.push("caused by: (further causes omitted)");
      break;
    }
    current = cause;
  }
  return output.join("\n");
}
