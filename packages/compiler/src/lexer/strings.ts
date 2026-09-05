/**
 * String literals: the inline and layout forms, the `f` prefix's interpolated
 * parts, the escapes a literal may spell, and the two advisories a JavaScript
 * template reflex earns (A5 and A6).
 *
 * D115 §三 / D114 R1f: the string half of `lexer.ts`. The scanning of one
 * literal's bytes stays in `interpolated-string.ts`, which the formatter and
 * the editor read as well; this module is what the lexer does with the result.
 */
import { advisory, diagnostic, mechanicalEdits, mechanicalFix, recoveredDiagnostic, type Advisory, type Diagnostic } from "../diagnostic.ts";
import { findInterpolatedExpressionEnd, scanStringEscape, type StringLiteralScan, type StringTokenPayload } from "../interpolated-string.ts";
import { span, type Span } from "../source.ts";
import { type Token } from "../token.ts";

/**
 * D89 A5/A6: the interpolation bodies whose rewrite is registered as a
 * mechanical fix. D38 §48 admits a fix only where no judgment is involved, and
 * the judgment-free core of "delete the `$`" is a body that is already a Vel
 * expression: a dotted name path reads identically in JavaScript and in an
 * `f` string, so the rewrite is a spelling change. Anything wider — a call, an
 * operator, a JavaScript-only form like `a ?? b.x()` — might not compile once
 * it becomes an interpolation, and a registered fix that hands back a new
 * diagnostic is a guess, not a fix. Those bodies keep the advisory and lose
 * only the one-click edit.
 */
const interpolationPathBody = /^[\p{L}_][\p{L}\p{N}_]*(?:\.[\p{L}_][\p{L}\p{N}_]*)*$/u;

interface TemplateInterpolationOccurrence {
  /** Content index of the `$`. */
  readonly dollar: number;
  /** Content index of the matching `}`. */
  readonly close: number;
  /** The text between the braces, exactly as written. */
  readonly body: string;
}

interface TemplateInterpolationScanResult {
  /** Each `${...}` with a matching `}` and a non-empty body, in source order. */
  readonly occurrences: readonly TemplateInterpolationOccurrence[];
  /** False once a `${` without a matching close or with an empty body appears; the rewrite is withheld. */
  readonly allWellFormed: boolean;
  /** Whether a `{` or `}` stands outside every `${...}` — only read for plain strings, where an `f` prefix would change what that brace means. */
  readonly bareBrace: boolean;
}

/**
 * D89 A5/A6: reads the `${...}` occurrences of one string literal's content.
 * The walk mirrors `diagnoseStringContents` so the two never disagree about
 * what a brace means: escapes are skipped in non-raw text (`"\u{E9}"` carries
 * a brace that belongs to the escape), and in an interpolated string a `{{`
 * pair and a real `{...}` interpolation are stepped over rather than counted,
 * because there they already mean what the author asked for. Brace matching
 * inside a `${...}` body is by depth, which is the same reading JavaScript
 * gives the template it came from.
 */
function templateInterpolationScan(content: string, syntax: { readonly raw: boolean; readonly interpolated: boolean }): TemplateInterpolationScanResult {
  const occurrences: TemplateInterpolationOccurrence[] = [];
  let allWellFormed = true;
  let bareBrace = false;
  for (let index = 0; index < content.length; index += 1) {
    const character = content[index]!;
    if (!syntax.raw && character === "\\") {
      index = scanStringEscape(content, index).end - 1;
      continue;
    }
    if (character !== "{") {
      if (!syntax.interpolated && character === "}") bareBrace = true;
      continue;
    }
    if (content[index - 1] === "$" && !(syntax.interpolated && content[index + 1] === "{")) {
      // In an interpolated string `${{x}}` is a literal `$` ahead of a real
      // interpolation, so the `$` there is not holding anything back and the
      // next iteration reads the braces the way the lexer does.
      const close = matchInterpolationClose(content, index + 1);
      if (close < 0 || content.slice(index + 1, close).trim() === "") {
        allWellFormed = false;
        continue;
      }
      occurrences.push({ dollar: index - 1, close, body: content.slice(index + 1, close) });
      index = close;
      continue;
    }
    if (!syntax.interpolated) {
      bareBrace = true;
      continue;
    }
    if (content[index + 1] === "{") {
      index += 1;
      continue;
    }
    const close = findInterpolatedExpressionEnd(content, index + 1);
    if (close < 0) break;
    index = close;
  }
  return { occurrences, allWellFormed, bareBrace };
}

/** The index of the `}` closing the brace at `open - 1`, matched by depth, or -1. */
function matchInterpolationClose(content: string, open: number): number {
  let depth = 1;
  for (let index = open; index < content.length; index += 1) {
    if (content[index] === "{") depth += 1;
    else if (content[index] === "}") {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return -1;
}

/** Everything this half of the lexer asks of the scanner that hosts it, and nothing more. */
export interface StringScannerHost {
  readonly advisories: Advisory[];
  atLineStart: boolean;
  readonly bracketFragment: boolean;
  readonly diagnostics: { push(...reports: readonly Diagnostic[]): void };
  index: number;
  isAtEnd(): boolean;
  isBidirectionalControl(codePoint: number): boolean;
  isForbiddenLiteralControl(codePoint: number): boolean;
  readonly text: string;
  readonly tokens: Token[];
}

export class StringScanner {
  private readonly host: StringScannerHost;

  constructor(host: StringScannerHost) {
    this.host = host;
  }

  readString(scanned: StringLiteralScan): void {
    const start = this.host.index;
    this.host.index = scanned.end;
    this.diagnoseStringContents(scanned);
    if (!scanned.closed) {
      const message = scanned.layout
        ? "Unterminated layout string; close it with a quote at the opening line's indentation"
        : scanned.quote === "`"
          ? "Inline strings cannot contain a line break; use a double-quoted layout string with the opening quote at the end of its line"
          : `Unterminated ${scanned.interpolated ? "interpolated " : ""}string literal before the end of the line`;
      this.host.diagnostics.push(diagnostic("VEL1003", message, span(start, this.host.index)));
    }
    if (scanned.indentationError) {
      this.host.diagnostics.push(diagnostic(
        "VEL1004",
        "Layout string lines must keep the indentation established by the first content line",
        span(scanned.indentationError.start, scanned.indentationError.end),
      ));
    }
    if (!scanned.canonical) {
      this.host.diagnostics.push(recoveredDiagnostic("VEL1005", "Use 'rf' rather than 'fr' for raw interpolated strings", span(start, start + scanned.prefixLength),
        mechanicalFix(span(start, start + scanned.prefixLength), "rf", "Use the 'rf' raw interpolated string prefix")));
    }
    if (scanned.quote === "'") {
      this.host.diagnostics.push(diagnostic(
        "VEL1005",
        "Use double quotes or backticks for strings; single-quoted strings are not part of VelarScript",
        span(start + scanned.prefixLength, Math.min(this.host.index, start + scanned.prefixLength + 1)),
      ));
    }
    this.adviseTemplateInterpolation(scanned, start);
    const payload: StringTokenPayload = {
      prefixLength: scanned.prefixLength,
      quote: scanned.quote,
      raw: scanned.raw,
      layout: scanned.layout,
      ...(scanned.contentOffsets ? { contentOffsets: scanned.contentOffsets } : {}),
    };
    this.host.tokens.push({
      kind: scanned.interpolated ? "fstring" : "string",
      value: scanned.interpolated ? scanned.content : this.decodeStringText(scanned.content, scanned.raw, scanned.quote, scanned.layout),
      span: span(start, this.host.index),
      payload,
    });
    // An unterminated layout string swallows its line breaks, so recovery also
    // closes the logical line. Without this the next physical line would be
    // read as a leftover token on the broken line, and the statement-boundary
    // rule would report it instead of letting it declare its own names.
    if (scanned.recoverAtLineStart) {
      this.host.atLineStart = true;
      this.host.tokens.push({ kind: "newline", value: "", span: span(this.host.index, this.host.index) });
    }
  }

  /**
   * D89 A5/A6: JavaScript's `${...}` never interpolates in VelarScript. The
   * charter keeps it literal on purpose — generating JavaScript source is a
   * real use of these literals — so the spelling cannot become an error, and a
   * string that carries it compiles in silence with a meaning the JavaScript
   * reflex behind it did not intend. That is D89's admission shape exactly,
   * on both sides of the `f` prefix:
   *
   * - A5, a plain double-quoted or backtick string: nothing interpolates, the
   *   `${name}` stays text. The way out is the `f` prefix with `{name}`.
   * - A6, an `f` or `rf` string: the `$` ahead of `{` keeps that brace
   *   literal, so the author who wrote the prefix *and* the JavaScript
   *   spelling still gets text. The way out is dropping the `$`.
   *
   * The non-triggers, each deliberate: an empty `${}` or an unclosed `${`
   * carries no expression to interpolate; a raw `r"..."` string is the author
   * asking for literal text by name, so the deliberate-literal reading wins
   * there (`rf` still triggers A6 — its rawness is about backslashes, not
   * about interpolation); a single-quoted string is already VEL1005; an
   * unterminated string is already VEL1003; and an inline `extern js` /
   * `unsafe js` block never reaches this method at all — it is scanned by
   * `readEmbeddedJavaScript`, where `${...}` is documented literal
   * JavaScript. One advisory speaks per literal: the rewrite names the whole
   * string, so a second occurrence adds nothing the first did not say.
   *
   * The fix is registered only where D38 §48's no-judgment bar holds: every
   * `${...}` well-formed, every body a plain dotted name path (see
   * `interpolationPathBody`), no `$` immediately ahead of an occurrence's own
   * `$` — JavaScript's `$${x}` spells a literal `$` before an interpolation,
   * and deleting the occurrence's `$` leaves `${x}`, whose surviving `$`
   * holds the brace literal all over again, so the quoted rewrite would not
   * interpolate — and, for A5, no bare brace outside the occurrences, because
   * the `f` prefix would turn `{` into an interpolation opener and `{{` into
   * a single literal brace. Everything else keeps the message and loses the
   * one-click edit.
   *
   * A bracket fragment is exempt for A1's reason: its lexer holds the
   * fragment's text rather than the module's, so a span there would not land
   * on the physical line a `velar-allow` reads.
   */
  adviseTemplateInterpolation(scanned: StringLiteralScan, start: number): void {
    if (this.host.bracketFragment || !scanned.closed || scanned.quote === "'") return;
    if (scanned.raw && !scanned.interpolated) return;
    const scan = templateInterpolationScan(scanned.content, scanned);
    const first = scan.occurrences[0];
    if (!first) return;
    const sourceOffset = (index: number): number => scanned.contentOffsets?.[index] ?? scanned.contentStart + index;
    const reportSpan = span(sourceOffset(first.dollar), sourceOffset(first.close) + 1);

    const quotedFirst = scanned.content.slice(first.dollar, first.close + 1);
    const shown = quotedFirst.length <= 40 ? quotedFirst : `${quotedFirst.slice(0, 39)}…`;
    const fixable = scan.allWellFormed
      && (scanned.interpolated || !scan.bareBrace)
      && scan.occurrences.every((occurrence) => interpolationPathBody.test(occurrence.body.trim())
        && scanned.content[occurrence.dollar - 1] !== "$");

    const deletions = scan.occurrences.map((occurrence) => ({ span: span(sourceOffset(occurrence.dollar), sourceOffset(occurrence.dollar) + 1), text: "" }));
    if (scanned.interpolated) {
      const rewritten = fixable ? this.literalWithoutDollars(start, deletions) : null;
      this.host.advisories.push(advisory(
        "A6",
        rewritten !== null && rewritten.length <= 60
          ? `VelarScript interpolation is '{...}', and '$' keeps the brace after it literal even under the 'f' prefix, so this stays the characters '${shown}'; drop the '$' and write '${rewritten}'`
          : `VelarScript interpolation is '{...}', and '$' keeps the brace after it literal even under the 'f' prefix, so this stays the characters '${shown}'; drop the '$' and write '{${first.body.trim()}}'`,
        reportSpan,
        fixable ? mechanicalEdits(deletions, "Drop the '$' and interpolate") : undefined,
      ));
      return;
    }
    const edits = [{ span: span(start, start), text: "f" }, ...deletions];
    const rewritten = fixable ? `f${this.literalWithoutDollars(start, deletions)}` : null;
    this.host.advisories.push(advisory(
      "A5",
      rewritten !== null && rewritten.length <= 60
        ? `'\${...}' is literal text in a VelarScript string — only the 'f' prefix interpolates — so this stays the characters '${shown}'; write '${rewritten}'`
        : `'\${...}' is literal text in a VelarScript string — only the 'f' prefix interpolates — so this stays the characters '${shown}'; write '{${first.body.trim()}}' under an 'f' prefix`,
      reportSpan,
      fixable ? mechanicalEdits(edits, "Interpolate with an 'f' string") : undefined,
    ));
  }

  /** The literal's source text with each occurrence's `$` removed, for the message that quotes the rewrite. */
  private literalWithoutDollars(start: number, deletions: readonly { readonly span: Span }[]): string {
    let text = "";
    let cursor = start;
    for (const deletion of deletions) {
      text += this.host.text.slice(cursor, deletion.span.start);
      cursor = deletion.span.end;
    }
    return text + this.host.text.slice(cursor, this.host.index);
  }

  private diagnoseStringContents(scanned: StringLiteralScan): void {
    const sourceOffset = (index: number): number => scanned.contentOffsets?.[index] ?? scanned.contentStart + index;
    for (let index = 0; index < scanned.content.length; index += 1) {
      const character = scanned.content[index]!;
      const next = scanned.content[index + 1];
      if (!scanned.raw && character === "\\") {
        const escaped = scanStringEscape(scanned.content, index);
        if (escaped.error !== null) {
          const start = sourceOffset(index);
          const messages = {
            legacyUnicode: "Use a braced Unicode escape such as '\\u{E9}'; '\\uXXXX' escapes are not part of VelarScript",
            hex: "Use a braced Unicode escape such as '\\u{E9}'; '\\xNN' escapes are not part of VelarScript",
            unicodeForm: "A Unicode escape must be '\\u{' followed by 1 to 6 hexadecimal digits and '}'",
            unicodeRange: "A Unicode escape cannot exceed U+10FFFF",
            unicodeSurrogate: "A Unicode escape cannot encode a surrogate from U+D800 through U+DFFF",
            unknown: `Unknown string escape '${next === "\n" || next === "\r" ? "line break" : `\\${next ?? ""}`}'; use '\\\\' for a literal backslash or an r\"...\" raw string`,
          } as const;
          this.host.diagnostics.push(diagnostic("VEL1008", messages[escaped.error], span(start, sourceOffset(escaped.end))));
        }
        index = escaped.end - 1;
        continue;
      }
      const codePoint = character.codePointAt(0)!;
      if (!this.host.isBidirectionalControl(codePoint) && this.host.isForbiddenLiteralControl(codePoint)) {
        const start = sourceOffset(index);
        this.host.diagnostics.push(diagnostic(
          "VEL1009",
          `Control character U+${codePoint.toString(16).toUpperCase().padStart(4, "0")} must be written with a '\\u{...}' escape inside a string literal`,
          span(start, sourceOffset(index + 1)),
        ));
      }
      if (!scanned.interpolated || character !== "{") continue;
      if (scanned.content[index - 1] === "$") continue;
      if (next === "{") {
        index += 1;
        continue;
      }
      const close = findInterpolatedExpressionEnd(scanned.content, index + 1);
      if (close < 0) break;
      index = close;
    }
  }

  private decodeStringText(value: string, raw: boolean, quote: "\"" | "'" | "`", layout: boolean): string {
    let decoded = "";
    for (let index = 0; index < value.length; index += 1) {
      const character = value[index]!;
      const next = value[index + 1];
      if (raw && !layout && character === quote && next === quote) {
        decoded += quote;
        index += 1;
      } else if (!raw && character === "\\" && next !== undefined) {
        const escaped = scanStringEscape(value, index);
        decoded += escaped.value ?? next;
        index = escaped.end - 1;
      } else {
        decoded += character;
      }
    }
    return decoded;
  }

  legacyTripleQuotePrefix(): { readonly prefix: "" | "f" | "r" | "rf" | "fr"; readonly interpolated: boolean; readonly raw: boolean } | null {
    for (const prefix of ["rf", "fr", "f", "r", ""] as const) {
      if (!this.host.text.startsWith(`${prefix}\"\"\"`, this.host.index)) continue;
      return {
        prefix,
        interpolated: prefix === "f" || prefix === "rf" || prefix === "fr",
        raw: prefix === "r" || prefix === "rf" || prefix === "fr",
      };
    }
    return null;
  }

  readLegacyTripleQuote(options: { readonly prefix: "" | "f" | "r" | "rf" | "fr"; readonly interpolated: boolean; readonly raw: boolean }): void {
    const start = this.host.index;
    this.host.index += options.prefix.length + 3;
    const contentStart = this.host.index;
    while (!this.host.isAtEnd() && !this.host.text.startsWith('\"\"\"', this.host.index)) this.host.index += 1;
    const closed = !this.host.isAtEnd();
    const contentEnd = this.host.index;
    if (closed) this.host.index += 3;
    const canonicalPrefix = options.prefix === "fr" ? "rf" : options.prefix;
    this.host.diagnostics.push(recoveredDiagnostic(
      "VEL1005",
      `Use a ${canonicalPrefix ? `'${canonicalPrefix}\"'` : "'\"'"} layout string; VelarScript uses indentation rather than triple-quote delimiters`,
      span(start, this.host.index),
    ));
    if (!closed) this.host.diagnostics.push(diagnostic("VEL1003", "Unterminated legacy triple-quoted string", span(start, this.host.index)));
    this.host.tokens.push({
      kind: options.interpolated ? "fstring" : "string",
      value: this.host.text.slice(contentStart, contentEnd),
      span: span(start, this.host.index),
      ...(options.interpolated ? {
        payload: { prefixLength: options.prefix.length, quote: '"', raw: options.raw, layout: true } satisfies StringTokenPayload,
      } : {}),
    });
  }
}
