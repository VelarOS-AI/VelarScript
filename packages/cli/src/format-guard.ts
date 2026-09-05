import { formatSource, formatSourceResult } from "@velarscript/compiler";
import type { CompilerExtension, Diagnostic } from "@velarscript/compiler";

export interface CheckedFormatOptions {
  readonly indentWidth?: number;
  readonly extensions?: readonly CompilerExtension[];
}

export interface CheckedFormatResult {
  /** The formatted text — the first pass's result, never the second's. */
  readonly text: string;
  /** Formatting the result again reproduced it, so the text is a fixed point. */
  readonly stable: boolean;
  /**
   * The parse diagnostic that stopped the formatter, or null when the source
   * parsed. When it is set, `text` is the source unchanged: the caller reports
   * this and writes nothing.
   */
  readonly blocked: Diagnostic | null;
}

/**
 * Formatting is idempotent by contract, so a second pass that changes the text
 * again is a formatter defect and the file it would land on is not the file the
 * author wrote. Every writer runs the source through here and keeps the
 * original bytes when `stable` is false: a reported bug costs one command, a
 * written-out unstable form costs the module.
 *
 * D114 0.28.0 I-D1 adds the other way a written-out form costs the module. The
 * formatter reads tokens, so a file `velar check` refuses to parse is still
 * rewritten — JSX the active extensions cannot see comes back as comparison
 * operators. A blocked source is returned exactly as it came in, the second
 * pass is not run on it (there is nothing to be unstable), and every writer
 * reports the parse error instead of saving.
 */
export function formatSourceChecked(source: string, options: CheckedFormatOptions = {}): CheckedFormatResult {
  const { text, blocked } = formatSourceResult(source, options);
  if (blocked !== null) return { text: source, stable: true, blocked };
  return { text, stable: formatSource(text, options) === text, blocked: null };
}
