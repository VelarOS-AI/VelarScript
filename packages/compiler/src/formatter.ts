/**
 * The formatter's entry points, and nothing else. `formatSource` lays a module
 * out; `formatSourceResult` is the second question every writer has to ask
 * first — whether this source may be written back at all.
 *
 * D115 §三 / D114 R1f: the layout rules moved into `format/` — the line model,
 * the token spacing, the delimiter choice, the positional `<`/`>` reading and
 * the markup element. Every name this module published is still published
 * here, so an existing `from "./formatter.ts"` import is unchanged.
 */
import type { Diagnostic } from "./diagnostic.ts";
import type { CompilerExtension } from "./extension.ts";
import { MAX_VELAR_SOURCE_CODE_UNITS } from "./limits.ts";
import { Lexer } from "./lexer.ts";
import { Parser } from "./parser.ts";
import { formatLexicalSource } from "./format/lines.ts";
import { type FormatOptions, type FormatResult } from "./format/options.ts";

export { type FormatOptions } from "./format/options.ts";
export { type FormatResult } from "./format/options.ts";


/**
 * Formats VelarScript source without round-tripping through generated JavaScript.
 * The formatter tokenizes each logical source line so strings, comments,
 * extension-owned embeddings and literals, operators, named arguments, and
 * type syntax retain their meaning while whitespace becomes canonical.
 *
 * Reading tokens rather than a program is what lets it lay out a fragment, an
 * unfinished line, and source a loaded extension does not claim. Anything that
 * *writes the result back* has to ask a second question first; that question is
 * `formatSourceResult`, and every writer asks it.
 */
export function formatSource(text: string, options: FormatOptions = {}): string {
  if (text.length > MAX_VELAR_SOURCE_CODE_UNITS) throw new RangeError("A VelarScript source module cannot exceed 4 MiB");
  const indentWidth = options.indentWidth ?? 4;
  if (!Number.isSafeInteger(indentWidth) || indentWidth < 1 || indentWidth > 16) {
    throw new RangeError("VelarScript formatter indentWidth must be an integer from 1 through 16");
  }
  return formatLexicalSource(text, indentWidth, options);
}

/**
 * D114 0.28.0 I-D1: formatting for a writer — the layout, and the diagnostic
 * that says this file must keep the bytes its author wrote.
 *
 * Reading tokens rather than a program means the formatter has an answer for
 * source that is not a program, and one of those answers destroys the file:
 * extension-owned angle-bracket markup that no loaded extension claims lexes as
 * `<` and `>`, so an element is written back as a chain of comparison
 * operators. That is reachable from `velar format` on a lone file and from an
 * editor formatting on save. So the question every writer asks — the CLI, the
 * language server's formatting request, and the repository's own format gate —
 * is stated once here: a source whose lexer or parser reports a diagnostic it
 * did not recover from is answered unchanged, beside the diagnostic to report,
 * so the author fixes the syntax first.
 *
 * Recovered guidance is deliberately not blocking. A `!` the parser rewrote to
 * `not` left it holding a program, so a file whose only diagnostics are
 * guidance is written back exactly as it always was.
 *
 * Neither is whitespace the formatter owns. A module indented with tabs is
 * refused by the lexer (VEL1002) and is exactly the file `velar format` exists
 * to correct, so "does not parse" cannot be the whole question — the question
 * is whether the formatter's *own result* is still not a program. Asking it
 * that way needs no roster of which diagnostics the formatter can fix: it
 * formats, asks again, and keeps the result only when the second answer is
 * clean. What survives both is precisely the file whose layout is not the
 * module its author wrote.
 */
export function formatSourceResult(text: string, options: FormatOptions = {}): FormatResult {
  const extensions = options.extensions ?? [];
  const blocked = unparsedSourceDiagnostic(text, extensions);
  const formatted = formatSource(text, options);
  if (blocked === null) return { text: formatted, blocked: null };
  return unparsedSourceDiagnostic(formatted, extensions) === null
    ? { text: formatted, blocked: null }
    : { text, blocked };
}

/**
 * The first diagnostic that makes a source something no writer may rewrite.
 * The parse is the compile's own — the same lexer, the same extension-owned
 * parser — so "does this file parse" has one answer in the repository rather
 * than a second one written for the formatter.
 */
function unparsedSourceDiagnostic(text: string, extensions: readonly CompilerExtension[]): Diagnostic | null {
  const lexicalExtensions = extensions.flatMap((extension) => extension.lexical ? [extension.lexical] : []);
  const lexed = new Lexer(text, lexicalExtensions).lex();
  const lexical = lexed.diagnostics.find((item) => item.recovered !== true);
  if (lexical) return lexical;
  // Two parser extensions are a configuration the compile itself refuses; the
  // formatter has never chosen between them and does not start here.
  const parserExtensions = extensions.filter((extension) => extension.parser);
  if (parserExtensions.length > 1) return null;
  const parser = parserExtensions[0]?.parser?.create(lexed.tokens, lexicalExtensions)
    ?? new Parser(lexed.tokens, lexicalExtensions);
  return parser.parse().diagnostics.find((item) => item.recovered !== true) ?? null;
}
