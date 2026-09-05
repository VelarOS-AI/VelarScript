/**
 * What a caller may ask of the formatter, what it answers with, and the one
 * width every line-breaking rule is measured against.
 *
 * D115 §三 / D114 R1f: the floor of the `format/` directory. It imports nothing
 * from its siblings, so every one of them may read it.
 */
import type { Diagnostic } from "../diagnostic.ts";
import type { CompilerExtension } from "../extension.ts";

export interface FormatOptions {
  readonly indentWidth?: number;
  readonly extensions?: readonly CompilerExtension[];
}

export interface FormatResult {
  /** The formatted text, or the source unchanged when `blocked` names a diagnostic. */
  readonly text: string;
  /** The diagnostic that says this source must not be written back, or null. */
  readonly blocked: Diagnostic | null;
}

export const FORMAT_PRINT_WIDTH = 120;
