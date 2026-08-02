import { MAX_VELAR_SOURCE_CODE_UNITS } from "./limits.ts";

export interface FormatOptions {
  readonly indentWidth?: number;
}

/**
 * Conservative source formatter for the Core language. It owns line endings,
 * indentation width, trailing whitespace, and the final newline while leaving
 * strings, comments, and expression layout untouched.
 */
export function formatSource(text: string, options: FormatOptions = {}): string {
  if (text.length > MAX_VELAR_SOURCE_CODE_UNITS) throw new RangeError("A Velar source module cannot exceed 4 MiB");
  const indentWidth = options.indentWidth ?? 4;
  const lines = text.replaceAll("\r\n", "\n").replaceAll("\r", "\n").split("\n");
  const indentation = [0];
  const formatted: string[] = [];

  for (const original of lines) {
    const line = original.replace(/[ \t]+$/u, "");
    if (line.trim().length === 0) {
      formatted.push("");
      continue;
    }

    const leading = line.match(/^[ \t]*/u)?.[0] ?? "";
    const width = [...leading].reduce((total, character) => total + (character === "\t" ? indentWidth : 1), 0);
    const content = line.slice(leading.length);
    const current = indentation.at(-1) ?? 0;
    if (width > current) {
      indentation.push(width);
    } else if (width < current) {
      while (indentation.length > 1 && width < (indentation.at(-1) ?? 0)) indentation.pop();
      if (width !== (indentation.at(-1) ?? 0)) indentation.push(width);
    }
    formatted.push(`${" ".repeat((indentation.length - 1) * indentWidth)}${content}`);
  }

  while (formatted.at(-1) === "") formatted.pop();
  return `${formatted.join("\n")}\n`;
}
