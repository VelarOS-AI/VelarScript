import { CORE_STATEMENT_HEAD_KEYWORDS } from "./core-vocabulary.ts";
import type { Statement } from "./ast.ts";
import { scanEmbeddedJavaScriptLiteral } from "./embedded-javascript.ts";
import { MAX_VELAR_SOURCE_CODE_UNITS } from "./limits.ts";
import { findInterpolatedExpressionEnd, scanStringEscape, scanStringLiteral, type StringLiteralScan } from "./interpolated-string.ts";
import type { CompilerExtension, CompilerFormattingOpaqueSourceScan } from "./extension.ts";
import { Lexer } from "./lexer.ts";
import { Parser } from "./parser.ts";
import { isSourceIdentifierPart, isSourceIdentifierStart, isTypeEvidenceName } from "./source-names.ts";
import { keywordKinds } from "./token.ts";

export interface FormatOptions {
  readonly indentWidth?: number;
  readonly extensions?: readonly CompilerExtension[];
}

type InlineKind = "word" | "literal" | "string" | "operator" | "open" | "close" | "comma" | "colon" | "dot" | "at" | "embedded" | "markup" | "comment";

interface InlineToken {
  readonly kind: InlineKind;
  readonly text: string;
  readonly generic?: boolean;
  /** The parsed element behind a "markup" token; the printer owns its layout. */
  readonly element?: MarkupElement;
}

const multiCharacterOperators = [">>>=", "<<=", ">>=", ">>>", "<<", ">>", "...", "?.", "??", "->", "=>", "==", "!=", "<=", ">=", "**", "+=", "-=", "*=", "/=", "%=", "|=", "&=", "^="] as const;
const binaryWords = new Set(["and", "or", "in", "is"]);
const prefixWords = new Set(["not", "await"]);
// D30 item 16: `match` and `case` are contextual keywords, so `match(value)` is
// a call and must not gain a keyword's space. They keep it only where a
// keyword can stand — the head of a statement line. D62 rule 157: which words
// those are is Core's roster to answer, not this file's — the copy that stood
// here knew two of the ten and could not have learned about an eleventh.
const statementHeadKeywordWords = new Set<string>(CORE_STATEMENT_HEAD_KEYWORDS);
/**
 * The reserved words that stand in expression position: `super` and `import`
 * name one directly — `super(id)`, `import("./page.vel")` — and the formatter
 * has already read `true`, `false` and `null` as literals by the time this set
 * is consulted. Every other reserved word is a keyword in the structural sense
 * `endsExpression` uses: it cannot end an expression, so what follows it opens
 * a new one.
 */
const expressionKeywordWords = new Set(["true", "false", "null", "super", "import"]);
const nonExpressionKeywordWords = new Set(Object.keys(keywordKinds).filter((word) => !expressionKeywordWords.has(word)));
const FORMAT_PRINT_WIDTH = 120;

/**
 * Formats VelarScript source without round-tripping through generated JavaScript.
 * The formatter tokenizes each logical source line so strings, comments,
 * extension-owned embeddings and literals, operators, named arguments, and
 * type syntax retain their meaning while whitespace becomes canonical.
 */
export function formatSource(text: string, options: FormatOptions = {}): string {
  if (text.length > MAX_VELAR_SOURCE_CODE_UNITS) throw new RangeError("A VelarScript source module cannot exceed 4 MiB");
  const indentWidth = options.indentWidth ?? 4;
  if (!Number.isSafeInteger(indentWidth) || indentWidth < 1 || indentWidth > 16) {
    throw new RangeError("VelarScript formatter indentWidth must be an integer from 1 through 16");
  }
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

interface CompactSuiteCandidate {
  readonly ownerStart: number;
  readonly body: readonly Statement[];
}

interface CompactSuiteEdit {
  readonly start: number;
  readonly end: number;
  readonly text: string;
}

/**
 * Canonicalizes the one-statement executable suites the parser has already
 * proved. A short simple body shares its header line (`if ready: run()`); once
 * that complete line would exceed the formatter's print width, the same suite
 * is expanded after the colon. Structural bodies and nested block statements
 * never participate, and the whitespace-only gap requirement keeps comments
 * attached exactly where the author wrote them.
 */
function formatCompactSuites(source: string, indentWidth: number, extensions: readonly CompilerExtension[]): string {
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

function collectCompactSuiteCandidates(statement: Statement, output: CompactSuiteCandidate[]): void {
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

function compactSuiteEdit(source: string, candidate: CompactSuiteCandidate, indentWidth: number): CompactSuiteEdit | null {
  if (candidate.body.length !== 1) return null;
  const child = candidate.body[0]!;
  if (statementOwnsCompactSuite(child)) return null;
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

function statementOwnsCompactSuite(statement: Statement): boolean {
  if (statement.kind.startsWith("ExtensionStatement:")) return true;
  switch (statement.kind) {
    case "ExternModuleDeclaration":
    case "EmbeddedJavaScriptDeclaration":
    case "TypeDeclaration":
    case "EnumDeclaration":
    case "ClassDeclaration":
    case "TestDeclaration":
    case "MainBlock":
    case "FunctionDeclaration":
    case "IfStatement":
    case "MatchStatement":
    case "ForStatement":
    case "WhileStatement":
    case "TryStatement":
      return true;
    default:
      return false;
  }
}

function protectMultilineStrings(
  source: string,
  opaqueSourceScanners: readonly ((source: string, start: number) => CompilerFormattingOpaqueSourceScan | null)[],
): { readonly text: string; readonly restore: (formatted: string) => string } {
  const replacements: {
    readonly placeholder: string;
    readonly value: string;
    readonly kind: "layout" | "blockComment" | "opaqueString";
    readonly originalIndent: string;
  }[] = [];
  // One scan settles a prefix the module does not already contain, so every
  // placeholder built from it is unique by construction. Asking the same
  // question again per replacement re-reads the whole module each time, which
  // costs O(placeholders x module) on a file full of layout strings.
  //
  // The prefix is the marker plus the smallest serial the module does not
  // already write after it. Growing the marker by a character per collision
  // instead would let a module spelling the marker followed by a long run of
  // underscores grow the prefix without bound, and `placeholderPattern` below
  // then builds a pattern the regular-expression engine refuses — a crashed
  // formatter rather than a diagnostic. A serial cannot collide: an occurrence
  // of `marker + serial + "_"` is an occurrence of the marker whose digit run
  // is exactly that serial, which this scan already recorded.
  const marker = "__velar_formatter_";
  const writtenSerials = new Set<string>();
  for (let at = source.indexOf(marker); at !== -1; at = source.indexOf(marker, at + 1)) {
    let end = at + marker.length;
    while (end < source.length && source[end]! >= "0" && source[end]! <= "9") end += 1;
    writtenSerials.add(source.slice(at + marker.length, end));
  }
  let serial = 0;
  while (writtenSerials.has(String(serial))) serial += 1;
  const prefix = `${marker}${serial}_`;
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
    restore: (formatted) => {
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
    },
  };
}

function scanFormattingOpaqueSource(
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

function reindentBlockComment(value: string, originalIndent: string, formattedIndent: string): string {
  const lines = value.split(/(\r\n|\r|\n)/u);
  for (let index = 0; index < lines.length; index += 2) {
    const line = lines[index]!;
    if (index === 0) continue;
    if (line.startsWith(originalIndent)) lines[index] = `${formattedIndent}${line.slice(originalIndent.length)}`;
  }
  return lines.join("");
}

function blockCommentEnd(source: string, start: number): number {
  let index = start + 2;
  let depth = 1;
  while (index < source.length && depth > 0) {
    if (source.startsWith("/*", index)) {
      depth += 1;
      index += 2;
    } else if (source.startsWith("*/", index)) {
      depth -= 1;
      index += 2;
    } else {
      index += 1;
    }
  }
  return index;
}

function reindentLayoutLiteral(value: string, originalIndent: string, formattedIndent: string): string {
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

function isExpressionContinuationLine(content: string): boolean {
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
interface PendingMarkupTag {
  readonly name: string;
  readonly closing: boolean;
  /** The last significant character was `/`, so the next `>` closes the tag. */
  readonly slash: boolean;
}

/** How much of an embedding the lines read so far have left open. */
interface EmbeddedScan {
  readonly depth: number;
  readonly pending: PendingMarkupTag | null;
}

const closedEmbeddedScan: EmbeddedScan = { depth: 0, pending: null };

/** A line inside an embedding, or inside an open tag, is copied, not formatted. */
function isEmbeddedLine(scan: EmbeddedScan): boolean {
  return scan.depth > 0 || scan.pending !== null;
}

function nextEmbeddedScan(
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

function embeddedStart(source: string): number {
  for (let index = 0; index < source.length - 1; index += 1) {
    if (source[index] !== "<" || !/[A-Za-z>]/u.test(source[index + 1] ?? "")) continue;
    const prefix = source.slice(0, index).trimEnd();
    if (prefix === "" || /(?:\breturn|=>|=|\(|\[|\{|,|:|\?)$/u.test(prefix)) return index;
  }
  return -1;
}

function formatInline(
  source: string,
  embedding: NonNullable<CompilerExtension["formatting"]>["angleBracketEmbedding"] | null,
  layout: MarkupLayout = heldLayoutFor(embedding),
): string {
  return formatInlineLine(source, embedding, layout).text;
}

/**
 * D59 rule 143, fourth item: the formatter reads one physical line at a time,
 * so a line that opens with `+` or `-` used to have no token in front of it at
 * all and was read as a negation — `basePrice` on one line and `+ shipping` on
 * the next came back as `+shipping`, against the charter's own example. Inside
 * brackets a newline is not a statement boundary (charter §2), so the token in
 * front is simply on the previous line: the caller carries it across, and the
 * unary question is answered from the same position every other one is. It also
 * answers the case with the opposite result, where a list literal's `-1` on its
 * own line follows the `[` that opened it and stays a negation.
 */
function formatInlineLine(
  source: string,
  embedding: NonNullable<CompilerExtension["formatting"]>["angleBracketEmbedding"] | null,
  layout: MarkupLayout = heldLayoutFor(embedding),
  preceding: InlineToken | undefined = undefined,
): { readonly text: string; readonly trailing: InlineToken | undefined } {
  const tokens = tokenizeInline(source, embedding, layout);
  if (
    tokens[0]?.text === "extern"
    && tokens[1]?.text === "js"
    && tokens[2]?.text === "("
    && tokens[3]?.text === ")"
    && tokens[4]
    && isAttachedOpaqueSourcePlaceholder(tokens[4])
  ) {
    tokens.splice(2, 2);
  }
  if (tokens.length === 0) return { text: "", trailing: undefined };
  let output = "";
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]!;
    const previous = tokens[index - 1];
    const next = tokens[index + 1];
    if (previous && needsSpace(previous, token, next, tokens, index, preceding)) output += " ";
    output += token.element
      ? renderMarkupElement(token.element, layout, layout.column + lastLineWidth(output))
      : token.text;
  }
  // A comment is not part of the expression it sits next to, so it never
  // becomes the context the next line reads.
  return { text: output, trailing: tokens.findLast((token) => token.kind !== "comment") };
}

function lastLineWidth(output: string): number {
  const start = output.lastIndexOf("\n");
  return start === -1 ? output.length : output.length - start - 1;
}

function tokenizeInline(
  source: string,
  embedding: NonNullable<CompilerExtension["formatting"]>["angleBracketEmbedding"] | null,
  layout: MarkupLayout = heldLayoutFor(embedding),
): InlineToken[] {
  const tokens: InlineToken[] = [];
  const genericStack: boolean[] = [];
  let index = 0;
  while (index < source.length) {
    const character = source[index]!;
    if (character === " " || character === "\t") {
      index += 1;
      continue;
    }
    if (character === "/" && source[index + 1] === "/") {
      tokens.push({ kind: "comment", text: source.slice(index).trimEnd() });
      break;
    }
    if (character === "/" && source[index + 1] === "*") {
      const end = blockCommentEnd(source, index);
      tokens.push({ kind: "comment", text: source.slice(index, end) });
      index = end;
      continue;
    }
    const scannedString = scanStringLiteral(source, index);
    if (scannedString) {
      const start = index;
      index = scannedString.end;
      const formattedString = scannedString.interpolated
        ? formatInterpolatedString(source, start, scannedString, embedding)
        : source.slice(start, index);
      tokens.push({
        kind: "string",
        text: canonicalizeInlineString(formattedString),
      });
      continue;
    }
    if (embedding && character === "<" && beginsEmbeddedAngleSyntax(tokens, source, index)) {
      // D39 §54: an element that both opens and closes on this line is the
      // formatter's to shape. Anything else — an element whose children live on
      // later lines — stays exactly as the author laid it out.
      const scanned = scanMarkupElement(source, index, embedding, layout);
      if (scanned) {
        tokens.push({ kind: "markup", text: source.slice(index, scanned.end), element: scanned.element });
        index = scanned.end;
        continue;
      }
      tokens.push({ kind: "embedded", text: source.slice(index).trimEnd() });
      break;
    }
    if (isSourceIdentifierStart(character)) {
      const start = index++;
      while (index < source.length && isSourceIdentifierPart(source[index]!)) index += 1;
      const value = source.slice(start, index);
      tokens.push({ kind: value === "true" || value === "false" || value === "null" ? "literal" : "word", text: value });
      continue;
    }
    if (/[0-9]/u.test(character)) {
      const start = index++;
      if (character === "0" && /[xXbBoO]/u.test(source[index] ?? "")) {
        index += 1;
        while (index < source.length && /[A-Za-z0-9_]/u.test(source[index]!)) index += 1;
        tokens.push({ kind: "literal", text: source.slice(start, index) });
        continue;
      }
      while (index < source.length && /[0-9_]/u.test(source[index]!)) index += 1;
      if (source[index] === "." && /[0-9_]/u.test(source[index + 1] ?? "")) {
        index += 1;
        while (index < source.length && /[0-9_]/u.test(source[index]!)) index += 1;
      }
      if ((source[index] === "e" || source[index] === "E") && /[+\-0-9_]/u.test(source[index + 1] ?? "")) {
        index += 1;
        if (source[index] === "+" || source[index] === "-") index += 1;
        while (index < source.length && /[0-9_]/u.test(source[index]!)) index += 1;
      }
      while (index < source.length && /[A-Za-z%]/u.test(source[index]!)) index += 1;
      tokens.push({ kind: "literal", text: source.slice(start, index) });
      continue;
    }
    if (character === ">" && genericStack.at(-1) === true) {
      genericStack.pop();
      tokens.push({ kind: "close", text: character, generic: true });
      index += 1;
      continue;
    }
    const operator = multiCharacterOperators.find((candidate) => source.startsWith(candidate, index));
    if (operator) {
      tokens.push({ kind: operator === "?." ? "dot" : "operator", text: operator });
      index += operator.length;
      continue;
    }
    if (character === "@") {
      tokens.push({ kind: "at", text: character });
      index += 1;
      continue;
    }
    if (character === ".") {
      tokens.push({ kind: "dot", text: character });
      index += 1;
      continue;
    }
    if (character === ",") {
      tokens.push({ kind: "comma", text: character });
      index += 1;
      continue;
    }
    if (character === ":") {
      tokens.push({ kind: "colon", text: character });
      index += 1;
      continue;
    }
    if (character === "(" || character === "[" || character === "{") {
      tokens.push({ kind: "open", text: character });
      index += 1;
      continue;
    }
    if (character === ")" || character === "]" || character === "}") {
      tokens.push({ kind: "close", text: character });
      index += 1;
      continue;
    }
    if (character === "<") {
      const previous = tokens.at(-1);
      const generic = previous?.kind === "word"
        && (genericStack.at(-1) === true
          || beginsTypeBracket(tokens)
          || (opensAnnotatedType(tokens) && closesAsTypeArguments(source, index))
          || opensCallTypeArguments(source, index));
      if (generic) genericStack.push(true);
      tokens.push({ kind: generic ? "open" : "operator", text: character, generic });
      index += 1;
      continue;
    }
    if (character === ">") {
      tokens.push({ kind: "operator", text: character });
      index += 1;
      continue;
    }
    if ("=+-*/%?|".includes(character)) {
      tokens.push({ kind: "operator", text: character });
      index += 1;
      continue;
    }
    tokens.push({ kind: "operator", text: character });
    index += 1;
  }
  return tokens;
}

// Structural generic-bracket detection: '<' after the name of a def/type/class
// declaration or after a type-only operator opens a bracket; every other
// expression-position '<' stays a comparison.
const typeBracketDeclarationWords = new Set(["def", "type", "class"]);
const typeBracketOperators = new Set(["->", "|", "is", "case", "extends"]);

function beginsTypeBracket(tokens: readonly InlineToken[]): boolean {
  const before = tokens.at(-2);
  if (!before) return false;
  if (before.kind === "word" && typeBracketDeclarationWords.has(before.text)) return true;
  if (before.text === "not" && tokens.at(-3)?.text === "is") return true;
  return typeBracketOperators.has(before.text);
}

/**
 * D55 rule 127.2 / D57 rule 134: which '<' opens a type argument list is a
 * question about position, never about the name in front of it. A whitelist of
 * generic names — the shape this used to have — is blind to `Record<T>` today
 * and to every generic a program declares for itself tomorrow, so the two
 * remaining type positions are read structurally instead.
 *
 * The first is the annotation a ':' introduces (`x: Record<string>` as a
 * parameter, a field, or a `const`), reached by walking back over the words and
 * dots the type itself owns so modifiers such as `readonly` do not hide it.
 * The second is the target of a type alias, where everything right of '=' on a
 * `type` line is type syntax.
 */
function opensAnnotatedType(tokens: readonly InlineToken[]): boolean {
  let index = tokens.length - 2;
  while (index >= 0) {
    const token = tokens[index]!;
    if (token.kind !== "word" && token.kind !== "dot") break;
    if (typeBracketOperators.has(token.text)) break;
    index -= 1;
  }
  const introducer = tokens[index];
  if (!introducer) return false;
  if (introducer.kind === "colon") return true;
  if (typeBracketOperators.has(introducer.text)) return true;
  return introducer.text === "=" && isTypeAliasLine(tokens);
}

function isTypeAliasLine(tokens: readonly InlineToken[]): boolean {
  const head = tokens[0]?.text;
  return head === "type" || (head === "export" && tokens[1]?.text === "type");
}

/**
 * The annotation position is the one type position a comparison also occupies,
 * so the bracket has to prove itself: a type argument list closes on this line
 * with nothing between the brackets but type syntax. `{visible: count < limit}`
 * never closes, and `{ok: a < b and c > d}` carries a word no type argument
 * list can hold.
 *
 * A function type carries its parameter names, so the `:` of `List<(x: number)
 * -> string>` is type syntax too — but only inside the parameter list it names
 * a parameter in. At the top of the argument list a `:` is the one in
 * `{visible: count < limit, other: x > y}`, which is a record and two
 * comparisons, so the paren depth is what separates them.
 */
function closesAsTypeArguments(source: string, start: number): boolean {
  return scanTypeArguments(source, start) !== null;
}

/**
 * D90 (compiler-front-15): the type argument list a TypeScript habit puts on a
 * call — `Map<string, number>()`, `id<string>("a")`. VelarScript infers type
 * arguments, so the spelling is always an error and the parser reads it without
 * regard to spacing. The formatter has to read it too: respacing it into
 * `Map < string, number > ()` rewrites the author's line into a spelling that
 * appears nowhere in their source, in exactly the file `velar format` is
 * pointed at while the teaching diagnostic is on screen.
 *
 * The evidence is the parser's (`explicitTypeArgumentsEnd`) minus the same-file
 * generic roster a line-based formatter cannot see: the brackets close on this
 * line with `(` directly behind them, and every `,`-separated argument carries
 * type evidence of its own — so `two(a < Limit, g > (c))`, two comparisons and
 * a working program, keeps its operator spacing. Being narrower than the parser
 * can only cost a respace on a line that is an error either way; it can never
 * change which reading the compiler gives a line, because the parser does not
 * consult the spacing.
 */
function opensCallTypeArguments(source: string, start: number): boolean {
  const scanned = scanTypeArguments(source, start);
  return scanned !== null && scanned.typed && source[scanned.end] === "(";
}

interface TypeArgumentScan {
  /** The offset just past the closing '>'. */
  readonly end: number;
  /** Every ','-separated argument carried evidence of being a type, and there was one. */
  readonly typed: boolean;
}

function scanTypeArguments(source: string, start: number): TypeArgumentScan | null {
  let depth = 0;
  let parenthesized = 0;
  let index = start;
  let everyArgumentIsTyped = true;
  let argumentIsTyped = false;
  while (index < source.length) {
    const character = source[index]!;
    if (character === "<") {
      depth += 1;
      index += 1;
      if (depth >= 2) argumentIsTyped = true;
      continue;
    }
    if (character === ">") {
      // The close is the close whatever follows it: an author may write
      // `const values: List<number>=[1, 2, 3]` and expect canonical spacing.
      depth -= 1;
      index += 1;
      if (depth === 0) return { end: index, typed: everyArgumentIsTyped && argumentIsTyped };
      continue;
    }
    if (source.startsWith("->", index)) {
      index += 2;
      argumentIsTyped = true;
      continue;
    }
    if (isSourceIdentifierStart(character)) {
      const wordStart = index;
      index += 1;
      while (index < source.length && isSourceIdentifierPart(source[index]!)) index += 1;
      const word = source.slice(wordStart, index);
      if (binaryWords.has(word) || prefixWords.has(word)) return null;
      if (isTypeEvidenceName(word)) argumentIsTyped = true;
      continue;
    }
    if (character === "(") {
      parenthesized += 1;
      index += 1;
      continue;
    }
    if (character === ")") {
      parenthesized -= 1;
      if (parenthesized < 0) return null;
      index += 1;
      continue;
    }
    if (character === ":" && parenthesized > 0) {
      index += 1;
      continue;
    }
    if (character === "," && depth === 1) {
      everyArgumentIsTyped &&= argumentIsTyped;
      argumentIsTyped = false;
      index += 1;
      continue;
    }
    if (character === "?" || character === "|") {
      argumentIsTyped = true;
      index += 1;
      continue;
    }
    if (" \t,.".includes(character)) {
      index += 1;
      continue;
    }
    return null;
  }
  return null;
}

function formatInterpolatedString(
  source: string,
  start: number,
  scanned: StringLiteralScan,
  embedding: NonNullable<CompilerExtension["formatting"]>["angleBracketEmbedding"] | null,
): string {
  if (!scanned.closed) return source.slice(start, scanned.end);
  let output = source.slice(start, scanned.contentStart);
  let index = scanned.contentStart;
  while (index < scanned.contentEnd) {
    const character = source[index]!;
    const next = source[index + 1];
    if (!scanned.raw && character === "\\" && next !== undefined) {
      const escaped = scanStringEscape(source, index, scanned.contentEnd);
      output += source.slice(index, escaped.end);
      index = escaped.end;
      continue;
    }
    if ((character === "{" || character === "}") && next === character) {
      output += `${character}${next}`;
      index += 2;
      continue;
    }
    if (character === "$" && next === "{") {
      const close = source.indexOf("}", index + 2);
      const end = close < 0 || close >= scanned.contentEnd ? Math.min(scanned.contentEnd, index + 2) : close + 1;
      output += source.slice(index, end);
      index = end;
      continue;
    }
    if (character !== "{") {
      output += character;
      index += 1;
      continue;
    }
    const close = findInterpolatedExpressionEnd(source, index + 1, scanned.contentEnd);
    if (close < 0) return source.slice(start, scanned.end);
    output += `{${formatInline(source.slice(index + 1, close).trim(), embedding)}}`;
    index = close + 1;
  }
  return `${output}${source.slice(scanned.contentEnd, scanned.end)}`;
}

type CanonicalStringChunk =
  | { readonly kind: "text" | "templateText"; readonly value: string }
  | { readonly kind: "expression"; readonly value: string };

function canonicalizeInlineString(source: string): string {
  let scanned = scanStringLiteral(source, 0);
  if (!scanned || !scanned.closed || scanned.layout || scanned.quote === "'") return source;
  const protectedEscapes = scanned.raw ? null : protectCanonicalEscapes(source, scanned);
  const working = protectedEscapes?.source ?? source;
  if (protectedEscapes) {
    const rescanned = scanStringLiteral(working, 0);
    if (!rescanned) return source;
    scanned = rescanned;
  }
  const chunks = splitCanonicalStringChunks(working, scanned);
  if (!chunks) return source;
  const literal = chunks.filter((chunk) => chunk.kind !== "expression").map((chunk) => chunk.value).join("");
  const doubleQuotes = [...literal].filter((character) => character === '"').length;
  const backticks = [...literal].filter((character) => character === "`").length;
  const quote: '"' | "`" = doubleQuotes === 0
    ? '"'
    : backticks === 0
      ? "`"
      : backticks < doubleQuotes
        ? "`"
        : '"';
  const body = chunks.map((chunk) => chunk.kind === "expression"
    ? chunk.value
    : encodeCanonicalStringText(chunk.value, quote, scanned.raw, scanned.interpolated, chunk.kind === "templateText"))
    .join("");
  const formatted = `${scanned.prefix}${quote}${body}${quote}`;
  return protectedEscapes?.restore(formatted) ?? formatted;
}

function protectCanonicalEscapes(
  source: string,
  scanned: StringLiteralScan,
): { readonly source: string; readonly restore: (value: string) => string } {
  const replacements: { readonly marker: string; readonly value: string }[] = [];
  let output = source.slice(0, scanned.contentStart);
  let index = scanned.contentStart;
  while (index < scanned.contentEnd) {
    if (source[index] !== "\\") {
      output += source[index]!;
      index += 1;
      continue;
    }
    const escaped = scanStringEscape(source, index, scanned.contentEnd);
    const spelling = source.slice(index, escaped.end);
    const preserve = escaped.error === null
      && (spelling === "\\n" || spelling === "\\r" || spelling === "\\t" || spelling === "\\\\" || spelling.startsWith("\\u{"));
    if (!preserve) {
      output += spelling;
      index = escaped.end;
      continue;
    }
    let codePoint = 0xe000 + replacements.length;
    let marker = String.fromCodePoint(codePoint);
    while (source.includes(marker) || replacements.some((item) => item.marker === marker)) {
      codePoint += 1;
      marker = String.fromCodePoint(codePoint);
    }
    replacements.push({ marker, value: spelling });
    output += marker;
    index = escaped.end;
  }
  output += source.slice(scanned.contentEnd);
  return {
    source: output,
    restore: (value) => replacements.reduce((current, item) => current.replaceAll(item.marker, item.value), value),
  };
}

function splitCanonicalStringChunks(source: string, scanned: StringLiteralScan): CanonicalStringChunk[] | null {
  const chunks: CanonicalStringChunk[] = [];
  let cursor = scanned.contentStart;
  let textStart = cursor;
  const flush = (end: number): boolean => {
    if (end <= textStart) return true;
    const decoded = decodeCanonicalStringText(source.slice(textStart, end), scanned, true);
    if (decoded === null) return false;
    chunks.push({ kind: "text", value: decoded });
    return true;
  };
  if (!scanned.interpolated) {
    const decoded = decodeCanonicalStringText(scanned.content, scanned, false);
    return decoded === null ? null : [{ kind: "text", value: decoded }];
  }
  while (cursor < scanned.contentEnd) {
    const character = source[cursor]!;
    const next = source[cursor + 1];
    if (!scanned.raw && character === "\\") {
      cursor = scanStringEscape(source, cursor, scanned.contentEnd).end;
      continue;
    }
    if (scanned.raw && character === scanned.quote && next === scanned.quote) {
      cursor += 2;
      continue;
    }
    if ((character === "{" || character === "}") && next === character) {
      cursor += 2;
      continue;
    }
    if (character === "$" && next === "{") {
      if (!flush(cursor)) return null;
      const close = source.indexOf("}", cursor + 2);
      const end = close < 0 || close >= scanned.contentEnd ? Math.min(scanned.contentEnd, cursor + 2) : close + 1;
      const decoded = decodeCanonicalStringText(source.slice(cursor, end), scanned, false);
      if (decoded === null) return null;
      chunks.push({ kind: "templateText", value: decoded });
      cursor = end;
      textStart = cursor;
      continue;
    }
    if (character === "{") {
      const close = findInterpolatedExpressionEnd(source, cursor + 1, scanned.contentEnd);
      if (close < 0) return null;
      if (!flush(cursor)) return null;
      chunks.push({ kind: "expression", value: source.slice(cursor, close + 1) });
      cursor = close + 1;
      textStart = cursor;
      continue;
    }
    cursor += 1;
  }
  if (!flush(scanned.contentEnd)) return null;
  return chunks;
}

function decodeCanonicalStringText(value: string, scanned: StringLiteralScan, collapseBraces: boolean): string | null {
  let output = "";
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index]!;
    const next = value[index + 1];
    if (scanned.raw && character === scanned.quote && next === scanned.quote) {
      output += character;
      index += 1;
    } else if (!scanned.raw && character === "\\") {
      const escaped = scanStringEscape(value, index);
      if (escaped.error !== null || escaped.value === null) return null;
      output += escaped.value;
      index = escaped.end - 1;
    } else if (collapseBraces && scanned.interpolated
      && (character === "{" || character === "}") && next === character) {
      output += character;
      index += 1;
    } else {
      output += character;
    }
  }
  return output;
}

function encodeCanonicalStringText(
  value: string,
  quote: '"' | "`",
  raw: boolean,
  interpolated: boolean,
  templateText: boolean,
): string {
  let output = "";
  for (const character of value) {
    const codePoint = character.codePointAt(0)!;
    if (raw) {
      if (character === quote) output += `${quote}${quote}`;
      else if (interpolated && !templateText && (character === "{" || character === "}")) output += `${character}${character}`;
      else output += character;
      continue;
    }
    if (character === "\\") output += "\\\\";
    else if (character === "\n") output += "\\n";
    else if (character === "\r") output += "\\r";
    else if (character === "\t") output += "\\t";
    else if (character === quote) output += `\\${quote}`;
    else if (interpolated && !templateText && (character === "{" || character === "}")) output += `${character}${character}`;
    else if ((codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f)
      || (codePoint >= 0x202a && codePoint <= 0x202e) || (codePoint >= 0x2066 && codePoint <= 0x2069))) {
      output += `\\u{${codePoint.toString(16).toUpperCase()}}`;
    } else output += character;
  }
  return output;
}

/**
 * D57 rule 134, restated for this file: the spacing questions below are all one
 * question — does the token in front end an expression? What follows something
 * that ends one is applied to it (`values[0]` indexes, `f(x)` calls, `a - b`
 * subtracts, `a < b` compares); what follows anything else begins a fresh
 * expression (`const [head, ...tail]` destructures, `async (id) =>` takes
 * parameters, `return -1` negates, `?? <em>x</em>` is markup).
 *
 * The tokens that can end an expression are a closed structural set: a name, a
 * literal, a string, a closing bracket, an element. The words that cannot are
 * the language's own reserved vocabulary, read from the lexer's table rather
 * than kept here. The hand-kept list this replaced was blind to `const` and
 * `let` (D59 143.1), to `async` (143.2), and to `return` in front of an
 * operator (143.3), and a word the language gains tomorrow would have gone
 * missing from it the same way.
 */
function endsExpression(token: InlineToken | undefined, statementHead = false): boolean {
  if (!token) return false;
  // D86 rule 212: a postfix `!` ends the value it unwraps, so `tags!(...)` and
  // `rows!` keep the tight spelling the rest of a postfix chain uses. The
  // prefix reading is a VEL1005 diagnostic rather than canonical source, and
  // the tight `!(...)` it formats to is the JavaScript spelling anyway.
  if (token.kind === "operator" && token.text === "!") return true;
  switch (token.kind) {
    case "word":
      // `match` and `case` are keywords only at the head of a statement line
      // (D30 item 16); anywhere else the same spelling is an ordinary name.
      if (statementHead && statementHeadKeywordWords.has(token.text)) return false;
      return !nonExpressionKeywordWords.has(token.text);
    case "literal":
    case "string":
    case "close":
    case "markup":
    case "embedded":
      return true;
    default:
      return false;
  }
}

/**
 * D60 rule 147: whether a `<` opens embedded markup is the same question. An
 * element stands where an expression can begin — after `??`, after `and`, after
 * a comma, at the head of a line — and a comparison stands after something that
 * ends an expression. Reading a list of the positions instead is what wrote
 * `{text ?? <em>x</em>}` out as `{text ?? < em > x < / em >}`, which no longer
 * compiles.
 */
function beginsEmbeddedAngleSyntax(tokens: readonly InlineToken[], source: string, index: number): boolean {
  if (!/[A-Za-z>]/u.test(source[index + 1] ?? "")) return false;
  return !endsExpression(tokens.at(-1), tokens.length === 1);
}

/**
 * D59 rule 142 — `name=value` is one argument, and the charter and every
 * documentation table spell it tight. Which `=` separates a named argument is a
 * question about position: the name has to open an argument (it follows the
 * call's `(`, or a `,` inside it) and the parentheses have to be a call's. The
 * other `=` that stands inside parentheses is a default value, and a default
 * value's parentheses belong to a declaration or a lambda, never to a call.
 */
function isNamedArgumentEquals(tokens: readonly InlineToken[], index: number): boolean {
  const equals = tokens[index];
  if (!equals || equals.kind !== "operator" || equals.text !== "=") return false;
  if (tokens[index - 1]?.kind !== "word") return false;
  const opener = tokens[index - 2];
  if (!opener || (opener.kind !== "comma" && !(opener.kind === "open" && opener.text === "("))) return false;
  const open = enclosingParenIndex(tokens, index - 2);
  if (open < 0) return false;
  return !isDeclarationParameterList(tokens, open) && endsExpression(tokens[open - 1], open === 1);
}

/** The index of the `(` whose argument list `index` sits directly inside. */
function enclosingParenIndex(tokens: readonly InlineToken[], index: number): number {
  let depth = 0;
  for (let cursor = index; cursor >= 0; cursor -= 1) {
    const token = tokens[cursor]!;
    if (token.kind === "close") depth += 1;
    else if (token.kind === "open") {
      if (depth === 0) return token.text === "(" ? cursor : -1;
      depth -= 1;
    }
  }
  return -1;
}

/**
 * A declaration's parentheses hold parameters, and a parameter's `= value` is a
 * default. Three positions say the list is a declaration's, and none of them
 * needs to know which words introduce a declaration:
 *
 *  - `def name(...)`, with or without a type argument list of its own.
 *  - Two names in a row in front of it. Nothing applies one name to another in
 *    an expression, so `component Row(...)` and `action submit(...)` are
 *    declaration headers while `check(...)` and `if check(...)` are calls —
 *    including the declaration forms an extension owns, which this file cannot
 *    otherwise see.
 *  - A single name at the head of a line whose `)` opens a block, which is
 *    `constructor(...):` and nothing a call can be.
 */
function isDeclarationParameterList(tokens: readonly InlineToken[], open: number): boolean {
  let name = open - 1;
  const typeArguments = tokens[name];
  if (typeArguments?.kind === "close" && typeArguments.generic === true) {
    name = matchingGenericOpenIndex(tokens, name) - 1;
  }
  if (name < 0 || tokens[name]?.kind !== "word") return false;
  const introducer = tokens[name - 1];
  if (introducer?.text === "def") return true;
  if (introducer?.kind === "word" && endsExpression(introducer, name === 1)) return true;
  const close = matchingCloseIndex(tokens, open);
  return name === 0 && close >= 0 && tokens[close + 1]?.kind === "colon";
}

function matchingGenericOpenIndex(tokens: readonly InlineToken[], close: number): number {
  let depth = 0;
  for (let cursor = close; cursor >= 0; cursor -= 1) {
    const token = tokens[cursor]!;
    if (token.kind === "close" && token.generic === true) depth += 1;
    else if (token.kind === "open" && token.generic === true) {
      depth -= 1;
      if (depth === 0) return cursor;
    }
  }
  return -1;
}

function matchingCloseIndex(tokens: readonly InlineToken[], open: number): number {
  let depth = 0;
  for (let cursor = open; cursor < tokens.length; cursor += 1) {
    const token = tokens[cursor]!;
    if (token.kind === "open") depth += 1;
    else if (token.kind === "close") {
      depth -= 1;
      if (depth === 0) return cursor;
    }
  }
  return -1;
}

function needsSpace(
  previous: InlineToken,
  current: InlineToken,
  next: InlineToken | undefined,
  tokens: readonly InlineToken[],
  index: number,
  preceding: InlineToken | undefined,
): boolean {
  if (isAttachedOpaqueSourcePlaceholder(current)) return false;
  if (current.kind === "comment") return true;
  if (previous.kind === "comment") return !previous.text.startsWith("//");
  if (current.kind === "embedded" || current.kind === "markup") {
    // D60 rule 147: markup is an argument like any other after a `,` or a `:`,
    // so it keeps the separator's space; only an opening bracket sits tight
    // against it. A named argument's value is the one exception, because
    // `name=value` is written as one thing.
    if (previous.text === "=" && isNamedArgumentEquals(tokens, index - 1)) return false;
    return previous.kind !== "open";
  }
  if (current.kind === "comma" || current.kind === "close" || current.kind === "dot" || current.kind === "colon") {
    if (current.kind === "colon" && isTernaryColon(tokens, index)) return true;
    return false;
  }
  if (previous.kind === "dot" || previous.kind === "at") return false;
  if (current.kind === "at") return previous.kind !== "open" && previous.kind !== "operator";
  if (previous.kind === "comma" || previous.kind === "colon") return true;
  if (previous.kind === "open") return false;
  if (current.kind === "open") {
    if (current.text === "(" && previous.text === "js" && tokens[0]?.text === "extern") return false;
    // A named argument's value is written against its name whatever the value
    // is — `initial=0`, `combine=(total, value) => …`, `value={type: "bool"}`.
    if (previous.text === "=" && isNamedArgumentEquals(tokens, index - 1)) return false;
    if (current.text === "{") return true;
    if (current.generic) return false;
    // A member name is a name even when it is spelled like a keyword —
    // `values.in(other)`, `values.case[0]` — so the dot decides, not the word.
    if (tokens[index - 2]?.kind === "dot") return false;
    // D51 item NEW-D9, now derived: `[` and `(` after something that ends an
    // expression apply to it — `values[0]`, `format(value)`. After a keyword
    // they open a fresh one — `const [head, ...tail]`, `for i in [1, 2]`,
    // `async (id: string) =>`. The whitelist this replaced had `in` but never
    // `const`, and `--check` then enforced the shape it wrote.
    return !endsExpression(previous, index === 1);
  }
  if (previous.kind === "close" && previous.generic) return current.text !== "?";
  if (previous.kind === "operator" || current.kind === "operator") {
    if (current.text === "=" && isNamedArgumentEquals(tokens, index)) return false;
    if (previous.text === "=" && isNamedArgumentEquals(tokens, index - 1)) return false;
    if (previous.text === "..." || current.text === "...") return false;
    if (current.text === "?" && isOptionalQuestion(current, next, tokens[index + 2])) return false;
    if (previous.text === "?" && isOptionalQuestion(previous, current, next)) return true;
    // D86 rule 212: `!` after a value is the required-value unwrap and sits
    // against it, like `?.` and `[`. Before a value it is the negation the
    // compiler guides to `not`, and it keeps that reading's spacing.
    if (current.text === "!" && endsExpression(previous, index === 1)) return false;
    if (isUnaryOperator(previous, index >= 2 ? tokens[index - 2] : preceding, index === 2)) {
      return previous.text === "not" || previous.text === "await";
    }
    if (isUnaryOperator(current, previous, index === 1)) return true;
    return true;
  }
  if ((previous.kind === "word" && (binaryWords.has(previous.text) || prefixWords.has(previous.text)))
    || (current.kind === "word" && binaryWords.has(current.text))) return true;
  return true;
}

function isAttachedOpaqueSourcePlaceholder(token: InlineToken): boolean {
  // The marker carries a settled serial, so the placeholder is recognised by
  // the fixed middle `protectMultilineStrings` gives it rather than by the
  // marker spelled out — which would stop matching the moment a module made
  // the marker settle on anything but its first spelling.
  return token.kind === "string"
    && token.text.includes("__velar_formatter_")
    && token.text.includes("attached_opaque_source_");
}

function isUnaryOperator(token: InlineToken, previous: InlineToken | undefined, statementHead = false): boolean {
  if (prefixWords.has(token.text)) return true;
  if (token.text === "~") return true;
  if (token.text !== "+" && token.text !== "-") return false;
  return !endsExpression(previous, statementHead);
}

function isOptionalQuestion(token: InlineToken, next: InlineToken | undefined, after: InlineToken | undefined): boolean {
  if (token.text !== "?") return false;
  return !next || next.kind === "comma" || next.kind === "close" || next.kind === "colon"
    || next.text === "=" || next.text === "|" || after?.text === "=>";
}

function isTernaryColon(tokens: readonly InlineToken[], colonIndex: number): boolean {
  let depth = 0;
  for (let index = colonIndex - 1; index >= 0; index -= 1) {
    const token = tokens[index]!;
    if (token.kind === "close") depth += 1;
    else if (token.kind === "open") depth -= 1;
    else if (depth === 0 && token.text === "?" && !isOptionalQuestion(token, tokens[index + 1], tokens[index + 2])) return true;
    else if (depth === 0 && (token.kind === "colon" || token.kind === "comma")) return false;
  }
  return false;
}

/**
 * D39 §54 — the canonical shape of embedded angle-bracket markup.
 *
 * The formatter reflows one thing and only one thing: an element that both
 * opens and closes on a single physical line. Such an element is written on one
 * line while it fits inside the print width, and takes the block shape — open
 * tag, one child per line indented one level, closing tag at the element's own
 * indentation — as soon as it does not. Attributes follow the same rule one
 * level down: they stay on the open tag until the open tag alone overflows,
 * and then take one line each.
 *
 * Two rules keep this a layout change and never a rendering change:
 *
 *  - Whitespace between children is program text. Markup drops a line break
 *    with its surrounding indentation but keeps a written space, so an element
 *    whose children carry meaningful spaces is never broken, and text is never
 *    re-wrapped or re-spaced.
 *  - Markup the author already spread across lines keeps its line structure,
 *    exactly like every other construct in the language: the formatter
 *    canonicalizes spelling, not the author's line breaks.
 */
const MAX_MARKUP_DEPTH = 48;

type MarkupEmbedding = NonNullable<CompilerExtension["formatting"]>["angleBracketEmbedding"] | null;

interface MarkupLayout {
  readonly indentWidth: number;
  /** The canonical indentation column of the line the markup starts on. */
  readonly column: number;
  /** False inside a string interpolation, where a line break would change the string. */
  readonly breakable: boolean;
  readonly embedding: MarkupEmbedding;
}

/**
 * The layout of markup that cannot take a line of its own — inside a string
 * interpolation, or inside a `{...}` hole. It still carries the embedding, so
 * markup nested further in is recognized as markup rather than re-spaced as
 * comparison operators.
 */
function heldLayoutFor(embedding: MarkupEmbedding): MarkupLayout {
  return { indentWidth: 4, column: 0, breakable: false, embedding };
}

function markupLayout(indentWidth: number, column: number, embedding: MarkupEmbedding): MarkupLayout {
  return { indentWidth, column, breakable: true, embedding };
}

function heldMarkupLayout(layout: MarkupLayout): MarkupLayout {
  return { ...layout, breakable: false };
}

interface MarkupAttribute {
  /** The attribute name, or "" for a `{...spread}` attribute. */
  readonly name: string;
  /** The written value including its quotes or braces, or null for a bare attribute. */
  readonly value: string | null;
}

type MarkupChild =
  | { readonly kind: "element"; readonly element: MarkupElement }
  | { readonly kind: "expression"; readonly text: string }
  | { readonly kind: "text"; readonly text: string };

interface MarkupElement {
  readonly tag: string;
  readonly attributes: readonly MarkupAttribute[];
  readonly children: readonly MarkupChild[];
  readonly selfClosing: boolean;
}

/**
 * Reads one balanced element starting at `<`. It returns null the moment the
 * element is not complete and unambiguous within `source` — an unclosed
 * element, a mismatched closing tag, an HTML comment, an unterminated string or
 * expression — and the caller then leaves the text exactly as written.
 */
function scanMarkupElement(
  source: string,
  start: number,
  embedding: MarkupEmbedding,
  layout: MarkupLayout,
  depth = 0,
): { readonly element: MarkupElement; readonly end: number } | null {
  if (depth > MAX_MARKUP_DEPTH || source[start] !== "<") return null;
  let index = start + 1;
  const nameStart = index;
  while (index < source.length && /[A-Za-z0-9_.:-]/u.test(source[index]!)) index += 1;
  const tag = source.slice(nameStart, index);
  if (!tag && source[index] !== ">") return null;

  const attributes: MarkupAttribute[] = [];
  let selfClosing = false;
  let closed = false;
  while (index < source.length) {
    while (index < source.length && /\s/u.test(source[index]!)) index += 1;
    if (source.startsWith("/>", index)) {
      index += 2;
      selfClosing = true;
      closed = true;
      break;
    }
    if (source[index] === ">") {
      index += 1;
      closed = true;
      break;
    }
    if (source[index] === "{") {
      const end = findInterpolatedExpressionEnd(source, index + 1);
      if (end < 0) return null;
      attributes.push({ name: "", value: source.slice(index, end + 1) });
      index = end + 1;
      continue;
    }
    const attributeStart = index;
    while (index < source.length && /[A-Za-z0-9_.:-]/u.test(source[index]!)) index += 1;
    const name = source.slice(attributeStart, index);
    if (!name) return null;
    let cursor = index;
    while (cursor < source.length && /[ \t]/u.test(source[cursor]!)) cursor += 1;
    if (source[cursor] !== "=") {
      attributes.push({ name, value: null });
      continue;
    }
    cursor += 1;
    while (cursor < source.length && /[ \t]/u.test(source[cursor]!)) cursor += 1;
    if (source[cursor] === '"' || source[cursor] === "'") {
      const quote = source[cursor]!;
      const close = source.indexOf(quote, cursor + 1);
      if (close < 0) return null;
      attributes.push({ name, value: source.slice(cursor, close + 1) });
      index = close + 1;
      continue;
    }
    if (source[cursor] === "{") {
      const end = findInterpolatedExpressionEnd(source, cursor + 1);
      if (end < 0) return null;
      attributes.push({ name, value: source.slice(cursor, end + 1) });
      index = end + 1;
      continue;
    }
    return null;
  }
  if (!closed) return null;
  if (selfClosing || (tag !== "" && tag === tag.toLowerCase() && embedding?.voidElements?.has(tag) === true)) {
    return { element: { tag, attributes, children: [], selfClosing: true }, end: index };
  }

  const children: MarkupChild[] = [];
  while (index < source.length && !source.startsWith("</", index)) {
    if (source.startsWith("<!--", index)) return null;
    if (source[index] === "<") {
      const child = scanMarkupElement(source, index, embedding, layout, depth + 1);
      if (!child) return null;
      children.push({ kind: "element", element: child.element });
      index = child.end;
      continue;
    }
    if (source[index] === "{") {
      const end = findInterpolatedExpressionEnd(source, index + 1);
      if (end < 0) return null;
      children.push({ kind: "expression", text: source.slice(index, end + 1) });
      index = end + 1;
      continue;
    }
    const textStart = index;
    while (index < source.length && source[index] !== "<" && source[index] !== "{") index += 1;
    children.push({ kind: "text", text: source.slice(textStart, index) });
  }
  if (!source.startsWith("</", index)) return null;
  index += 2;
  const closingStart = index;
  while (index < source.length && /[A-Za-z0-9_.:-]/u.test(source[index]!)) index += 1;
  if (source.slice(closingStart, index) !== tag) return null;
  while (index < source.length && /\s/u.test(source[index]!)) index += 1;
  if (source[index] !== ">") return null;
  return { element: { tag, attributes, children, selfClosing: false }, end: index + 1 };
}

function renderMarkupElement(element: MarkupElement, layout: MarkupLayout, column: number): string {
  const inline = renderInlineMarkup(element, layout);
  if (!layout.breakable || column + inline.length <= FORMAT_PRINT_WIDTH) return inline;
  if (element.selfClosing) return renderMarkupOpenTag(element, layout, column);
  if (!isBreakableMarkup(element)) return inline;
  const indent = " ".repeat(layout.column);
  const childIndent = " ".repeat(layout.column + layout.indentWidth);
  const childLayout = markupLayout(layout.indentWidth, layout.column + layout.indentWidth, layout.embedding);
  const lines = [renderMarkupOpenTag(element, layout, column)];
  for (const child of element.children) {
    if (child.kind === "text") {
      const text = child.text.trim();
      if (text.length > 0) lines.push(`${childIndent}${text}`);
      continue;
    }
    lines.push(`${childIndent}${child.kind === "element"
      ? renderMarkupElement(child.element, childLayout, childLayout.column)
      : renderMarkupExpression(child.text, childLayout)}`);
  }
  lines.push(`${indent}</${element.tag}>`);
  return lines.join("\n");
}

function renderMarkupOpenTag(element: MarkupElement, layout: MarkupLayout, column: number): string {
  const inline = `<${element.tag}${element.attributes.map((attribute) => ` ${renderMarkupAttribute(attribute, layout)}`).join("")}${element.selfClosing ? " />" : ">"}`;
  if (!layout.breakable || column + inline.length <= FORMAT_PRINT_WIDTH || element.attributes.length === 0) return inline;
  const indent = " ".repeat(layout.column);
  const attributeIndent = " ".repeat(layout.column + layout.indentWidth);
  const attributeLayout = markupLayout(layout.indentWidth, layout.column + layout.indentWidth, layout.embedding);
  return [
    `<${element.tag}`,
    ...element.attributes.map((attribute) => `${attributeIndent}${renderMarkupAttribute(attribute, attributeLayout)}`),
    `${indent}${element.selfClosing ? "/>" : ">"}`,
  ].join("\n");
}

function renderInlineMarkup(element: MarkupElement, layout: MarkupLayout): string {
  const open = `<${element.tag}${element.attributes.map((attribute) => ` ${renderMarkupAttribute(attribute, layout)}`).join("")}`;
  if (element.selfClosing) return `${open} />`;
  const children = element.children.map((child) => child.kind === "text"
    ? child.text
    : child.kind === "element"
      ? renderInlineMarkup(child.element, layout)
      : renderMarkupExpression(child.text, layout)).join("");
  return `${open}>${children}</${element.tag}>`;
}

function renderMarkupAttribute(attribute: MarkupAttribute, layout: MarkupLayout): string {
  if (attribute.name === "") return renderMarkupExpression(attribute.value ?? "{}", layout);
  if (attribute.value === null) return attribute.name;
  if (!attribute.value.startsWith("{")) return `${attribute.name}=${attribute.value}`;
  return `${attribute.name}=${renderMarkupExpression(attribute.value, layout)}`;
}

/** Formats the code inside `{...}`; a hole never breaks across lines. */
function renderMarkupExpression(text: string, layout: MarkupLayout): string {
  return `{${formatInline(text.slice(1, -1).trim(), layout.embedding, heldMarkupLayout(layout))}}`;
}

/**
 * An element breaks between children only when it has no text child at all —
 * when it is a container of elements and holes rather than a piece of written
 * content.
 *
 * That is one line drawn for two reasons at once. It is the safe line: markup
 * renders a written space between children but not a line break with its
 * indentation, so any text child (even a bare "/" separator) could change what
 * the page shows if the boundaries around it moved. It is also the readable
 * line: a sentence belongs on its line, not spread one word and one hole at a
 * time.
 */
function isBreakableMarkup(element: MarkupElement): boolean {
  if (element.selfClosing || element.children.length === 0) return false;
  return element.children.every((child) => child.kind !== "text" || child.text.trim() === child.text);
}

/**
 * Formats a line inside markup the author spread across lines. The line's own
 * layout is the author's; each balanced element on it still takes its canonical
 * shape, and everything else — code inside holes, text, unbalanced tag
 * fragments — is copied exactly.
 */
function formatEmbeddedContent(
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
