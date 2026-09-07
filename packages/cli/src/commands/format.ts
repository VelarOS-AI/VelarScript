/** `velar format`: one file or every manifest-owned `.vel` source, to its fixed point. */

import { writeFile } from "node:fs/promises";
import { extname, resolve } from "node:path";
import { formatDiagnostic, SourceText } from "@velarscript/compiler";
import type { CompilerExtension } from "@velarscript/compiler";
import { parseFormatArguments } from "../arguments.ts";
import { resolveVelarProject } from "../config.ts";
import { formatSourceChecked } from "../format-guard.ts";
import { displayPath } from "../help.ts";
import { hostErrorMessage } from "../host-error.ts";
import { discoverVelarSources } from "../project-check.ts";
import { readVelarSourceFile } from "../source-limits.ts";

export async function runFormatCommand(rest: readonly string[]): Promise<number> {
  const parsed = parseFormatArguments(rest);
  if (typeof parsed === "string") {
    process.stderr.write(`velar format: ${parsed}\n`);
    return 2;
  }
  const singleFile = parsed.input !== null && extname(resolve(parsed.input)) === ".vel";
  let inputs: string[];
  let formattingExtensions: readonly CompilerExtension[] = [];
  try {
    if (singleFile) {
      inputs = [resolve(parsed.input!)];
      const config = await resolveVelarProject(parsed.input);
      formattingExtensions = config.compilerExtensions;
    } else {
      const config = await resolveVelarProject(parsed.input);
      inputs = await discoverVelarSources(config);
      formattingExtensions = config.compilerExtensions;
    }
  } catch (error) {
    process.stderr.write(`velar format: ${hostErrorMessage(error)}\n`);
    return 1;
  }
  if (inputs.length === 0) {
    process.stderr.write("velar format: no .vel source files were found\n");
    return 1;
  }
  const changed: string[] = [];
  const unstable: string[] = [];
  const unparsed: { readonly input: string; readonly report: string }[] = [];
  try {
    for (const input of inputs) {
      const source = await readVelarSourceFile(input);
      const { text: formatted, stable, blocked } = formatSourceChecked(source, { extensions: formattingExtensions });
      // D114 0.28.0 I-D1. The formatter reads tokens, so it has an answer for
      // source `velar check` refuses to parse -- and that answer rewrites JSX
      // the active extensions cannot see into comparison operators. Nothing
      // is written back until the file parses, and the parse error is what
      // the author is handed, because it is the one thing to fix first.
      if (blocked !== null) {
        unparsed.push({ input, report: formatDiagnostic(new SourceText(input, source), blocked) });
        continue;
      }
      // Formatting is idempotent by contract. A result the formatter would
      // change again is a formatter defect, and writing it would replace a
      // module that compiles with one that may not, so the file keeps the
      // bytes the author wrote and the command reports the defect.
      if (!stable) {
        unstable.push(input);
        continue;
      }
      if (formatted === source) continue;
      changed.push(input);
      if (!parsed.check) await writeFile(input, formatted, "utf8");
    }
  } catch (error) {
    process.stderr.write(`velar format: ${hostErrorMessage(error)}\n`);
    return 1;
  }
  if (unparsed.length > 0) {
    for (const item of unparsed) {
      process.stderr.write(`velar format: ${displayPath(item.input)} does not parse, so it was left unchanged; fix the syntax first\n`);
      process.stderr.write(`${item.report}\n`);
    }
    return 1;
  }
  if (unstable.length > 0) {
    for (const input of unstable) {
      process.stderr.write(`velar format: ${displayPath(input)}: the formatter did not reach a fixed point; the file was left unchanged\n`);
    }
    return 1;
  }
  if (parsed.check && changed.length > 0) {
    for (const input of changed) process.stderr.write(`${displayPath(input)} is not formatted\n`);
    process.stderr.write(`${changed.length} of ${inputs.length} VelarScript source file${inputs.length === 1 ? "" : "s"} require formatting\n`);
    return 1;
  }
  if (singleFile) {
    process.stdout.write(parsed.check ? `${parsed.input} is formatted\n` : `Formatted ${parsed.input}\n`);
  } else if (parsed.check) {
    process.stdout.write(`Checked formatting of ${inputs.length} VelarScript source file${inputs.length === 1 ? "" : "s"}\n`);
  } else {
    process.stdout.write(`Formatted ${changed.length} of ${inputs.length} VelarScript source file${inputs.length === 1 ? "" : "s"}\n`);
  }
  return 0;
}
