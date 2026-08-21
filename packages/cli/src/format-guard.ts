import { formatSource } from "@velarscript/compiler";
import type { CompilerExtension } from "@velarscript/compiler";

export interface CheckedFormatOptions {
  readonly indentWidth?: number;
  readonly extensions?: readonly CompilerExtension[];
}

export interface CheckedFormatResult {
  /** The formatted text — the first pass's result, never the second's. */
  readonly text: string;
  /** Formatting the result again reproduced it, so the text is a fixed point. */
  readonly stable: boolean;
}

/**
 * Formatting is idempotent by contract, so a second pass that changes the text
 * again is a formatter defect and the file it would land on is not the file the
 * author wrote. Every writer runs the source through here and keeps the
 * original bytes when `stable` is false: a reported bug costs one command, a
 * written-out unstable form costs the module.
 */
export function formatSourceChecked(source: string, options: CheckedFormatOptions = {}): CheckedFormatResult {
  const text = formatSource(source, options);
  return { text, stable: formatSource(text, options) === text };
}
