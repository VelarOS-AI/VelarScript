/**
 * The line model: which physical lines belong to one logical line, what each
 * one is indented to, which suites may be written compactly, and the multiline
 * text a line must not touch. This is also where the 120-column rule is
 * applied to an element that would otherwise run past it.
 *
 * D115 §三 / D114 R1f: the line half of `formatter.ts`.
 */
import { statementOwnsBlock } from "../ast.ts";
import type { Statement } from "../ast.ts";
import { scanEmbeddedJavaScriptLiteral } from "../embedded-javascript.ts";
import type { CompilerExtension, CompilerFormattingOpaqueSourceScan } from "../extension.ts";
import { findInterpolatedExpressionEnd, scanStringLiteral } from "../interpolated-string.ts";
import { Lexer } from "../lexer.ts";
import { Parser } from "../parser.ts";
import { isSourceIdentifierPart, isSourceIdentifierStart } from "../source-names.ts";
import { formatInlineLine, renderMarkupElement } from "./inline.ts";
import { heldMarkupLayout, markupLayout, scanMarkupElement, MAX_MARKUP_DEPTH, type MarkupEmbedding, type MarkupLayout } from "./markup.ts";
import { FORMAT_PRINT_WIDTH, type FormatOptions } from "./options.ts";
import { blockCommentEnd, lastLineWidth, type InlineToken } from "./tokens.ts";

export function formatLexicalSource(text: string, indentWidth: number, options: FormatOptions): string {
  const angleOwners = (options.extensions ?? []).flatMap((extension) => extension.formatting?.angleBracketEmbedding
    ? [extension.formatting.angleBracketEmbedding]
    : []);
  if (angleOwners.length > 1) throw new Error("Only one compiler extension may own angle-bracket formatting");
  const angleEmbedding = angleOwners[0] ?? null;
  const opaqueSourceScanners = (options.extensions ?? []).flatMap((extension) => extension.formatting?.scanOpaqueSource
    ? [extension.formatting.scanOpaqueSource]
    : []);

  const protectedStrings = protectMultilineStrings(text, opaqueSourceScanners);
  const lines = protectedStrings.text.replaceAll("\r\n", "\n").replaceAll("\r", "\n").split("\n");
  const indentation = [0];
  const formatted: string[] = [];
  let embedded = closedEmbeddedScan;
  let statementLevel = 0;
  /** The last token of the previous line — the context a continuation reads. */
  let preceding: InlineToken | undefined;

  for (const original of lines) {
    const line = original.replace(/[ \t]+$/u, "");
    if (line.trim().length === 0) {
      if (formatted.length > 0 && formatted.at(-1) !== "") formatted.push("");
      continue;
    }

    const leading = line.match(/^[ \t]*/u)?.[0] ?? "";
    const width = [...leading].reduce((total, character) => total + (character === "\t" ? indentWidth : 1), 0);
    const content = line.slice(leading.length);
    const current = indentation.at(-1) ?? 0;
    // A leading member step or binary operator keeps its own canonical
    // indentation — one level past the statement it continues — without
    // opening a block for the lines that follow it. Inside brackets the
    // current indentation already belongs to the bracket layout, so an
    // operator aligned with that content stays aligned there.
    if (!isEmbeddedLine(embedded) && width > current && isExpressionContinuationLine(content) && formatted.length > 0) {
      const column = (statementLevel + 1) * indentWidth;
      const line = formatInlineLine(content, angleEmbedding, markupLayout(indentWidth, column, angleEmbedding), preceding);
      formatted.push(`${" ".repeat(column)}${line.text}`);
      preceding = line.trailing ?? preceding;
      continue;
    }
    if (width > current) {
      indentation.push(width);
    } else if (width < current) {
      while (indentation.length > 1 && width < (indentation.at(-1) ?? 0)) indentation.pop();
      if (width !== (indentation.at(-1) ?? 0)) indentation.push(width);
    }
    statementLevel = indentation.length - 1;
    const indent = " ".repeat(statementLevel * indentWidth);
    const layout = markupLayout(indentWidth, statementLevel * indentWidth, angleEmbedding);
    if (isEmbeddedLine(embedded)) {
      formatted.push(`${indent}${formatEmbeddedContent(content, angleEmbedding, layout, layout.column)}`);
      preceding = undefined;
    } else {
      const line = formatInlineLine(content, angleEmbedding, layout, preceding);
      formatted.push(`${indent}${line.text}`);
      preceding = line.trailing ?? preceding;
    }
    embedded = nextEmbeddedScan(content, embedded, angleEmbedding);
  }

  while (formatted.at(-1) === "") formatted.pop();
  // The terminating newline is settled on the restored text. An unterminated
  // block comment or layout string runs to the end of the module, so its
  // placeholder value carries the file's final newline where neither the trim
  // above nor an append here can see it — appending one to the joined lines
  // adds a newline on every run, and charter line 422 makes formatting
  // idempotent.
  const restored = protectedStrings.restore(formatted.join("\n"));
  const terminated = restored.endsWith("\n") || restored.endsWith("\r") ? restored : `${restored}\n`;
  return formatCompactSuites(terminated, indentWidth, options.extensions ?? []);
}

export interface CompactSuiteCandidate {
  readonly ownerStart: number;
  readonly body: readonly Statement[];
}

export interface CompactSuiteEdit {
  readonly start: number;
  readonly end: number;
  readonly text: string;
}

/** One protected value: the text taken out, and the indent it was written at. */
interface ProtectedValue {
  readonly placeholder: string;
  readonly value: string;
  readonly kind: "layout" | "blockComment" | "opaqueString";
  readonly originalIndent: string;
}

/**
 * A placeholder prefix this module does not already contain, so every
 * placeholder built from it is unique by construction. Asking the same
 * question again per replacement re-reads the whole module each time, which
 * costs O(placeholders x module) on a file full of layout strings.
 *
 * The prefix is the marker plus the smallest serial the module does not
 * already write after it. Growing the marker by a character per collision
 * instead would let a module spelling the marker followed by a long run of
 * underscores grow the prefix without bound, and `placeholderPattern` then
 * builds a pattern the regular-expression engine refuses — a crashed formatter
 * rather than a diagnostic. A serial cannot collide: an occurrence of
 * `marker + serial + "_"` is an occurrence of the marker whose digit run is
 * exactly that serial, which this scan already recorded.
 *
 * D115 §一.1: split out of `protectMultilineStrings` unchanged.
 */
function settledPlaceholderPrefix(source: string): string {
  const marker = "__velar_formatter_";
  const writtenSerials = new Set<string>();
  for (let at = source.indexOf(marker); at !== -1; at = source.indexOf(marker, at + 1)) {
    let end = at + marker.length;
    while (end < source.length && source[end]! >= "0" && source[end]! <= "9") end += 1;
    writtenSerials.add(source.slice(at + marker.length, end));
  }
  let serial = 0;
  while (writtenSerials.has(String(serial))) serial += 1;
  return `${marker}${serial}_`;
}

/**
 * Puts every protected value back where the printer left its placeholder, at
 * the indentation the printer chose rather than the one the author wrote.
 *
 * D115 §一.1: split out of `protectMultilineStrings` unchanged; the two values
 * it closed over arrive as parameters.
 */
function restorePlaceholders(
  formatted: string,
  byPlaceholder: ReadonlyMap<string, ProtectedValue>,
  placeholderPattern: RegExp,
): string {
  let restored = "";
  /** The restored text after its last line break — the indent a value reads. */
  let lineTail = "";
  let cursor = 0;
  const append = (segment: string): void => {
    restored += segment;
    const lineStart = Math.max(segment.lastIndexOf("\n"), segment.lastIndexOf("\r"));
    lineTail = lineStart === -1 ? lineTail + segment : segment.slice(lineStart + 1);
  };
  for (const match of formatted.matchAll(placeholderPattern)) {
    const replacement = byPlaceholder.get(match[0]);
    if (!replacement) continue;
    append(formatted.slice(cursor, match.index));
    const formattedIndent = /^[ \t]*/u.exec(lineTail)?.[0] ?? "";
    append(replacement.kind === "layout"
      ? reindentLayoutLiteral(replacement.value, replacement.originalIndent, formattedIndent)
      : replacement.kind === "blockComment"
        ? reindentBlockComment(replacement.value, replacement.originalIndent, formattedIndent)
        : replacement.value);
    cursor = match.index + match[0].length;
  }
  append(formatted.slice(cursor));
  return restored;
}

/**
 * Canonicalizes the one-statement executable suites the parser has already
 * proved. A short simple body shares its header line (`if ready: run()`); once
 * that complete line would exceed the formatter's print width, the same suite
 * is expanded after the colon. Structural bodies and nested block statements
 * never participate, and the whitespace-only gap requirement keeps comments
 * attached exactly where the author wrote them.
 */
export function formatCompactSuites(source: string, indentWidth: number, extensions: readonly CompilerExtension[]): string {
  const lexicalExtensions = extensions.flatMap((extension) => extension.lexical ? [extension.lexical] : []);
  const lexed = new Lexer(source, lexicalExtensions).lex();
  if (lexed.diagnostics.length > 0) return source;
  const parserExtensions = extensions.filter((extension) => extension.parser);
  if (parserExtensions.length > 1) return source;
  const parser = parserExtensions[0]?.parser?.create(lexed.tokens, lexicalExtensions)
    ?? new Parser(lexed.tokens, lexicalExtensions);
  const parsed = parser.parse();
  if (parsed.diagnostics.length > 0) return source;

  const candidates: CompactSuiteCandidate[] = [];
  for (const statement of parsed.program.body) collectCompactSuiteCandidates(statement, candidates);
  const edits = candidates.flatMap((candidate) => compactSuiteEdit(source, candidate, indentWidth) ?? []);
  edits.sort((left, right) => right.start - left.start || right.end - left.end);

  let output = source;
  let previousStart = source.length + 1;
  for (const edit of edits) {
    if (edit.end > previousStart) continue;
    output = `${output.slice(0, edit.start)}${edit.text}${output.slice(edit.end)}`;
    previousStart = edit.start;
  }
  return output;
}

export function collectCompactSuiteCandidates(statement: Statement, output: CompactSuiteCandidate[]): void {
  const body = (ownerStart: number, statements: readonly Statement[] | null): void => {
    if (!statements) return;
    output.push({ ownerStart, body: statements });
    for (const child of statements) collectCompactSuiteCandidates(child, output);
  };

  switch (statement.kind) {
    case "FunctionDeclaration":
    case "TestDeclaration":
    case "MainBlock":
    case "ForStatement":
    case "WhileStatement":
      body(statement.span.start, statement.body);
      return;
    case "IfStatement":
      body(statement.span.start, statement.thenBody);
      body(statement.span.start, statement.elseBody);
      return;
    case "MatchStatement":
      for (const branch of statement.cases) body(branch.span.start, branch.body);
      return;
    case "TryStatement":
      body(statement.span.start, statement.tryBody);
      body(statement.span.start, statement.catchBody);
      body(statement.span.start, statement.finallyBody);
      return;
    case "ClassDeclaration":
      if (statement.initialization) body(statement.initialization.span.start, statement.initialization.body);
      if (statement.dispose) body(statement.dispose.span.start, statement.dispose.body);
      if (statement.iterate) body(statement.iterate.span.start, statement.iterate.body);
      for (const member of [...statement.getters, ...statement.methods]) body(member.span.start, member.body);
      return;
    default: {
      if (!statement.kind.startsWith("ExtensionStatement:")) return;
      const extensionBody = (statement as Statement & { readonly body?: readonly Statement[] }).body;
      if (Array.isArray(extensionBody)) {
        for (const child of extensionBody) collectCompactSuiteCandidates(child, output);
      }
    }
  }
}

export function compactSuiteEdit(source: string, candidate: CompactSuiteCandidate, indentWidth: number): CompactSuiteEdit | null {
  if (candidate.body.length !== 1) return null;
  const child = candidate.body[0]!;
  if (statementOwnsBlock(child)) return null;
  const childText = source.slice(child.span.start, child.span.end);
  if (childText.includes("\n") || childText.includes("\r")) return null;

  const colon = source.lastIndexOf(":", child.span.start - 1);
  if (colon < candidate.ownerStart) return null;
  const gap = source.slice(colon + 1, child.span.start);
  if (!/^[\t\r\n ]*$/u.test(gap)) return null;

  const lineStart = Math.max(source.lastIndexOf("\n", colon - 1), source.lastIndexOf("\r", colon - 1)) + 1;
  const newline = source.indexOf("\n", child.span.end);
  const lineEnd = newline === -1 ? source.length : newline;
  const inlineLine = `${source.slice(lineStart, colon + 1)} ${source.slice(child.span.start, lineEnd)}`;
  const multiline = gap.includes("\n") || gap.includes("\r");

  if (inlineLine.length <= FORMAT_PRINT_WIDTH) {
    return multiline ? { start: colon + 1, end: child.span.start, text: " " } : null;
  }
  if (multiline) return null;

  const leading = /^[ ]*/u.exec(source.slice(lineStart, colon))?.[0] ?? "";
  return {
    start: colon + 1,
    end: child.span.start,
    text: `\n${leading}${" ".repeat(indentWidth)}`,
  };
}

export function protectMultilineStrings(
  source: string,
  opaqueSourceScanners: readonly ((source: string, start: number) => CompilerFormattingOpaqueSourceScan | null)[],
): { readonly text: string; readonly restore: (formatted: string) => string } {
  const replacements: ProtectedValue[] = [];
  const prefix = settledPlaceholderPrefix(source);
  // Walking back to the line break costs a column, while asking the module for
  // its last `\r` before an index costs the whole prefix of the module when it
  // has none — which is every module with Unix line endings.
  const lineStartBefore = (position: number): number => {
    let start = position;
    while (start > 0 && source[start - 1] !== "\n" && source[start - 1] !== "\r") start -= 1;
    return start;
  };
  let output = "";
  let index = 0;
  while (index < source.length) {
    if (source.startsWith("//", index)) {
      const end = source.indexOf("\n", index + 2);
      const next = end === -1 ? source.length : end;
      output += source.slice(index, next);
      index = next;
      continue;
    }
    if (source.startsWith("/*", index)) {
      const end = blockCommentEnd(source, index);
      const value = source.slice(index, end);
      if (!value.includes("\n") && !value.includes("\r")) {
        output += value;
        index = end;
        continue;
      }
      const placeholder = JSON.stringify(`${prefix}multiline_comment_${replacements.length}__`);
      const originalIndent = /^[ \t]*/u.exec(source.slice(lineStartBefore(index), index))?.[0] ?? "";
      replacements.push({ placeholder, value, kind: "blockComment", originalIndent });
      output += placeholder;
      index = end;
      continue;
    }
    const opaqueSource = scanFormattingOpaqueSource(source, index, opaqueSourceScanners);
    if (opaqueSource) {
      const start = index;
      index = opaqueSource.end;
      const value = source.slice(start, index);
      const placeholder = JSON.stringify(opaqueSource.attachedToPrevious
        ? `${prefix}attached_opaque_source_${replacements.length}__`
        : `${prefix}opaque_source_${replacements.length}__`);
      const originalIndent = /^[ \t]*/u.exec(source.slice(lineStartBefore(start), start))?.[0] ?? "";
      replacements.push({ placeholder, value, kind: "opaqueString", originalIndent });
      output += placeholder;
      continue;
    }
    const previous = source[index - 1];
    const scanned = (!previous || !isSourceIdentifierPart(previous)) ? scanStringLiteral(source, index) : null;
    if (!scanned) {
      output += source[index]!;
      index += 1;
      continue;
    }
    const start = index;
    index = scanned.end;
    const value = source.slice(start, index);
    if (!value.includes("\n") && !value.includes("\r")) {
      output += value;
      continue;
    }
    const placeholder = JSON.stringify(`${prefix}multiline_string_${replacements.length}__`);
    const originalIndent = /^[ \t]*/u.exec(source.slice(lineStartBefore(start), start))?.[0] ?? "";
    replacements.push({ placeholder, value, kind: scanned.layout ? "layout" : "opaqueString", originalIndent });
    output += placeholder;
  }
  // Every placeholder shares the settled prefix, so one pass over the formatted
  // text finds them all wherever the printer moved them. Searching for each
  // placeholder from the start and splicing it into a rebuilt string is the
  // other half of the same quadratic cost.
  const byPlaceholder = new Map(replacements.map((replacement) => [replacement.placeholder, replacement]));
  const placeholderPattern = new RegExp(`"${prefix}[A-Za-z0-9_]*"`, "gu");
  return {
    text: output,
    restore: (formatted) => restorePlaceholders(formatted, byPlaceholder, placeholderPattern),
  };
}

export function scanFormattingOpaqueSource(
  source: string,
  start: number,
  extensionScanners: readonly ((source: string, start: number) => CompilerFormattingOpaqueSourceScan | null)[],
): CompilerFormattingOpaqueSourceScan | null {
  const core = scanEmbeddedJavaScriptLiteral(source, start);
  let claimed: CompilerFormattingOpaqueSourceScan | null = core
    ? { end: core.end, attachedToPrevious: true }
    : null;
  for (const scan of extensionScanners) {
    const candidate = scan(source, start);
    if (!candidate) continue;
    if (!Number.isSafeInteger(candidate.end) || candidate.end <= start || candidate.end > source.length
      || typeof candidate.attachedToPrevious !== "boolean") {
      throw new RangeError("A compiler formatting opaque-source scanner returned an invalid result");
    }
    if (claimed && (claimed.end !== candidate.end || claimed.attachedToPrevious !== candidate.attachedToPrevious)) {
      throw new Error("Multiple compiler formatting owners claimed the same opaque source with different boundaries");
    }
    claimed = candidate;
  }
  return claimed;
}

export function reindentBlockComment(value: string, originalIndent: string, formattedIndent: string): string {
  const lines = value.split(/(\r\n|\r|\n)/u);
  for (let index = 0; index < lines.length; index += 2) {
    const line = lines[index]!;
    if (index === 0) continue;
    if (line.startsWith(originalIndent)) lines[index] = `${formattedIndent}${line.slice(originalIndent.length)}`;
  }
  return lines.join("");
}

export function reindentLayoutLiteral(value: string, originalIndent: string, formattedIndent: string): string {
  const lines: { readonly text: string; readonly newline: string }[] = [];
  let cursor = 0;
  while (cursor < value.length) {
    const boundary = /\r\n|\r|\n/gu;
    boundary.lastIndex = cursor;
    const match = boundary.exec(value);
    const end = match?.index ?? value.length;
    lines.push({ text: value.slice(cursor, end), newline: match?.[0] ?? "" });
    if (!match) break;
    cursor = end + match[0].length;
  }
  const leading = (line: string): string => /^[ \t]*/u.exec(line)?.[0] ?? "";
  const width = (indent: string): number => [...indent].reduce((total, character) => total + (character === "\t" ? 4 : 1), 0);
  const contentMargin = lines.slice(1, -1)
    .map((line) => line.text)
    .find((line) => line.trim().length > 0);
  const originalMargin = contentMargin === undefined ? null : leading(contentMargin);
  const marginWidth = originalMargin === null ? 0 : width(originalMargin);
  const shiftedMarginWidth = Math.max(width(formattedIndent) + 1, marginWidth + width(formattedIndent) - width(originalIndent));
  const formattedMargin = " ".repeat(shiftedMarginWidth);

  return lines.map((line, index) => {
    let text = line.text;
    if (index === lines.length - 1) {
      if (text.startsWith(originalIndent)) text = `${formattedIndent}${text.slice(originalIndent.length)}`;
    } else if (index > 0 && originalMargin !== null) {
      // Blank layout-string lines participate in the literal without needing
      // an indentation payload. Reintroducing the content margin here writes
      // trailing spaces into otherwise canonical source and makes a formatter
      // result fail `git diff --check`. That holds only for a line whose whole
      // indentation is the margin or less: whitespace past the margin is the
      // string's own value (charter lines 381-384 preserve it exactly), so a
      // line carrying it is re-margined like any other and keeps its payload.
      if (originalMargin.startsWith(text)) text = "";
      else if (text.startsWith(originalMargin)) text = `${formattedMargin}${text.slice(originalMargin.length)}`;
    }
    return `${text}${line.newline}`;
  }).join("");
}

export function isExpressionContinuationLine(content: string): boolean {
  const member = content.startsWith("?.") ? content[2] : content[1];
  if ((content.startsWith(".") || content.startsWith("?.")) && Boolean(member && isSourceIdentifierStart(member))) return true;
  if (/^(?:and|or|in|is)\b/u.test(content) || /^not\s+in\b/u.test(content)) return true;
  return /^(?:>>>|<<|>>|\?\?|==|!=|<=|>=|[|^&<>+\-*/%])(?![=/*])/u.test(content);
}

/**
 * A tag whose `>` or `/>` the line ended before reaching. The author may wrap
 * an open tag over as many lines as its attributes need, so the terminator —
 * not the tag name — is what says whether a child level opened: a void element
 * that closed on its own line is self-closing whatever it was written with,
 * while one whose `>` is still ahead has not closed anything yet.
 */
export interface PendingMarkupTag {
  readonly name: string;
  readonly closing: boolean;
  /** The last significant character was `/`, so the next `>` closes the tag. */
  readonly slash: boolean;
}

/** How much of an embedding the lines read so far have left open. */
export interface EmbeddedScan {
  readonly depth: number;
  readonly pending: PendingMarkupTag | null;
}

export const closedEmbeddedScan: EmbeddedScan = { depth: 0, pending: null };

/** A line inside an embedding, or inside an open tag, is copied, not formatted. */
export function isEmbeddedLine(scan: EmbeddedScan): boolean {
  return scan.depth > 0 || scan.pending !== null;
}

export function nextEmbeddedScan(
  source: string,
  current: EmbeddedScan,
  embedding: NonNullable<CompilerExtension["formatting"]>["angleBracketEmbedding"] | null,
): EmbeddedScan {
  if (!embedding) return closedEmbeddedScan;
  let depth = current.depth;
  let pending = current.pending;
  let index = 0;
  if (depth === 0 && pending === null) {
    const start = embeddedStart(source);
    if (start === -1) return closedEmbeddedScan;
    index = start;
  }
  while (index < source.length) {
    if (pending === null) {
      if (source.startsWith("<!--", index)) {
        const end = source.indexOf("-->", index + 4);
        if (end === -1) break;
        index = end + 3;
        continue;
      }
      if (source.startsWith("/*", index)) {
        index = blockCommentEnd(source, index);
        continue;
      }
      if (source[index] !== "<" || !/[A-Za-z/>]/u.test(source[index + 1] ?? "")) {
        index += 1;
        continue;
      }
      const closing = source[index + 1] === "/";
      let cursor = index + (closing ? 2 : 1);
      const nameStart = cursor;
      while (/[A-Za-z0-9_.:-]/u.test(source[cursor] ?? "")) cursor += 1;
      const name = source.slice(nameStart, cursor);
      const fragment = name === "" && source[cursor] === ">";
      if (!name && !fragment) {
        index += 1;
        continue;
      }
      pending = { name, closing, slash: false };
      index = cursor;
    }
    let quote = "";
    let braces = 0;
    let slash = pending.slash;
    let terminated = false;
    while (index < source.length) {
      const character = source[index++]!;
      if (quote) {
        if (character === "\\") index += 1;
        else if (character === quote) quote = "";
        continue;
      }
      if (character === '"' || character === "'") {
        quote = character;
        slash = false;
      } else if (character === "{") {
        braces += 1;
        slash = false;
      } else if (character === "}") {
        braces = Math.max(0, braces - 1);
        slash = false;
      } else if (braces > 0) continue;
      else if (character === ">") {
        terminated = true;
        break;
      } else if (character === "/") slash = true;
      else if (!/\s/u.test(character)) slash = false;
    }
    if (!terminated) {
      pending = { ...pending, slash };
      break;
    }
    const selfClosing = slash || embedding.voidElements?.has(pending.name) === true;
    if (pending.closing) depth = Math.max(0, depth - 1);
    else if (!selfClosing) depth += 1;
    pending = null;
  }
  return { depth, pending };
}

export function embeddedStart(source: string): number {
  for (let index = 0; index < source.length - 1; index += 1) {
    if (source[index] !== "<" || !/[A-Za-z>]/u.test(source[index + 1] ?? "")) continue;
    const prefix = source.slice(0, index).trimEnd();
    if (prefix === "" || /(?:\breturn|=>|=|\(|\[|\{|,|:|\?)$/u.test(prefix)) return index;
  }
  return -1;
}

/**
 * Formats a line inside markup the author spread across lines. The line's own
 * layout is the author's; each balanced element on it still takes its canonical
 * shape, and everything else — code inside holes, text, unbalanced tag
 * fragments — is copied exactly.
 */
export function formatEmbeddedContent(
  source: string,
  embedding: MarkupEmbedding,
  layout: MarkupLayout,
  column: number,
  depth = 0,
): string {
  if (!embedding || depth > MAX_MARKUP_DEPTH) return source;
  let output = "";
  let index = 0;
  while (index < source.length) {
    const character = source[index]!;
    if (character === '"' || character === "'" || character === "`") {
      const scanned = scanStringLiteral(source, index);
      const end = scanned && scanned.end > index ? scanned.end : index + 1;
      output += source.slice(index, end);
      index = end;
      continue;
    }
    if (character === "{") {
      const end = findInterpolatedExpressionEnd(source, index + 1);
      if (end < 0) {
        output += character;
        index += 1;
        continue;
      }
      // A hole is code, and the formatter never reflows code: markup inside it
      // keeps its line, exactly as it does on a statement line.
      const innerColumn = column + lastLineWidth(output) + 1;
      output += `{${formatEmbeddedContent(source.slice(index + 1, end), embedding, heldMarkupLayout(layout), innerColumn, depth + 1)}}`;
      index = end + 1;
      continue;
    }
    if (character === "<" && /[A-Za-z>]/u.test(source[index + 1] ?? "")) {
      const scanned = scanMarkupElement(source, index, embedding, layout);
      if (scanned) {
        output += renderMarkupElement(scanned.element, layout, column + lastLineWidth(output));
        index = scanned.end;
        continue;
      }
    }
    output += character;
    index += 1;
  }
  return output;
}
