export interface UncaughtProgramEntryOptions {
  /** The compiled entry module the launcher imports. */
  readonly entryUrl: string;
  /** The `.vel` entry the author wrote, named in the failure header. */
  readonly sourcePath: string;
  /** Prints every frame, including Node.js internals, instead of the owned ones. */
  readonly fullStack: boolean;
}

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
 * unchanged.
 */
export function uncaughtProgramEntrySource(options: UncaughtProgramEntryOptions): string {
  return `import { readFileSync } from "node:fs";

const entryUrl = ${JSON.stringify(options.entryUrl)};
const sourcePath = ${JSON.stringify(options.sourcePath)};
const fullStack = ${options.fullStack ? "true" : "false"};
const maximumTextLength = 64 * 1024;
const maximumCauseDepth = 8;
const internalFrame = /(?:^|\\s|\\()node:[a-z_]+(?:\\/|:)/u;
const framePosition = /\\(?([^()]+):(\\d+):(\\d+)\\)?$/u;
const launcherUrl = import.meta.url;

const bounded = (value) => (value.length <= maximumTextLength ? value : \`\${value.slice(0, maximumTextLength)}…\`);
const portableFrame = (frame) => frame.replaceAll("\\\\", "/");

const describe = (error) => {
  if (error instanceof Error) {
    const stack = typeof error.stack === "string" && error.stack.length > 0
      ? error.stack
      : \`\${error.name}: \${error.message}\`;
    return bounded(stack);
  }
  if (typeof error === "string") return bounded(\`The program threw a non-Error string value: \${error}\`);
  const kind = error === null ? "null" : typeof error;
  return \`The program threw a non-Error \${kind} value\`;
};

const presentTrace = (error) => {
  const lines = describe(error).split("\\n");
  // The launcher itself is never the author's frame in either presentation.
  const frames = lines.filter((line) => /^\\s+at\\s/u.test(line) && !line.includes(launcherUrl));
  const owned = fullStack ? frames : frames.filter((line) => !internalFrame.test(line));
  const header = lines.filter((line) => !/^\\s+at\\s/u.test(line));
  return { header, owned, hidden: frames.length - owned.length };
};

const codeFrame = (frame) => {
  const position = framePosition.exec(frame.trimEnd());
  if (!position || !position[1].endsWith(".vel")) return [];
  try {
    const text = readFileSync(position[1], "utf8");
    if (text.length > 4 * 1024 * 1024) return [];
    const line = text.split(/\\r\\n|\\r|\\n/u)[Number(position[2]) - 1];
    if (line === undefined || line.length > 240) return [];
    const column = Math.max(1, Number(position[3]));
    return [line, \`\${" ".repeat(column - 1)}^\`];
  } catch {
    return [];
  }
};

const present = (error) => {
  const output = [\`velar run: uncaught error while running \${sourcePath}\`];
  let current = error;
  for (let depth = 0; depth <= maximumCauseDepth; depth += 1) {
    const trace = presentTrace(current);
    if (depth > 0) output.push("caused by:");
    output.push(...trace.header);
    if (depth === 0 && trace.owned.length > 0) output.push(...codeFrame(trace.owned[0]));
    output.push(...trace.owned.map(portableFrame));
    if (trace.hidden > 0) {
      output.push(\`  (\${trace.hidden} Node.js internal frame\${trace.hidden === 1 ? "" : "s"} hidden; rerun with 'velar run --stack' for the full trace)\`);
    }
    const cause = current instanceof Error ? current.cause : undefined;
    if (cause === undefined || cause === null) break;
    if (depth === maximumCauseDepth) {
      output.push("caused by: (further causes omitted)");
      break;
    }
    current = cause;
  }
  process.stderr.write(\`\${output.join("\\n")}\\n\`);
};

process.on("uncaughtException", (error) => {
  // Another listener means the program owns this error and Node.js would not
  // have made it fatal; the launcher stays out of the way.
  if (process.listeners("uncaughtException").length > 1) return;
  present(error);
  process.exit(1);
});

// The entry is imported without awaiting it here: an await in this launcher
// would add a launcher frame to every async stack the program itself prints.
import(entryUrl).catch((error) => {
  present(error);
  process.exit(1);
});
`;
}
