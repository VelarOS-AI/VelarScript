import { CORE_STATEMENT_HEAD_KEYWORDS } from "./core-vocabulary.ts";
import { scanEmbeddedJavaScriptLiteral } from "./embedded-javascript.ts";
import { MAX_VELAR_SOURCE_CODE_UNITS } from "./limits.ts";
import { findInterpolatedExpressionEnd, scanStringEscape, scanStringLiteral, type StringLiteralScan } from "./interpolated-string.ts";
import type { CompilerExtension, CompilerFormattingOpaqueSourceScan } from "./extension.ts";
import { isSourceIdentifierPart, isSourceIdentifierStart } from "./source-names.ts";
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
  let embeddedDepth = 0;
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
    // A leading-dot chain continuation keeps its own canonical indentation —
    // one level past the statement it continues — without opening a block for
    // the lines that follow it.
    if (embeddedDepth === 0 && isChainContinuationLine(content) && formatted.length > 0) {
      const column = (statementLevel + 1) * indentWidth;
      const line = formatInlineLine(content, angleEmbedding, markupLayout(indentWidth, column, angleEmbedding), preceding);
      formatted.push(`${" ".repeat(column)}${line.text}`);
      preceding = line.trailing ?? preceding;
      continue;
    }
    const current = indentation.at(-1) ?? 0;
    if (width > current) {
      indentation.push(width);
    } else if (width < current) {
      while (indentation.length > 1 && width < (indentation.at(-1) ?? 0)) indentation.pop();
      if (width !== (indentation.at(-1) ?? 0)) indentation.push(width);
    }
    statementLevel = indentation.length - 1;
    const indent = " ".repeat(statementLevel * indentWidth);
    const layout = markupLayout(indentWidth, statementLevel * indentWidth, angleEmbedding);
    if (embeddedDepth > 0) {
      formatted.push(`${indent}${formatEmbeddedContent(content, angleEmbedding, layout, layout.column)}`);
      preceding = undefined;
    } else {
      const line = formatInlineLine(content, angleEmbedding, layout, preceding);
      formatted.push(`${indent}${line.text}`);
      preceding = line.trailing ?? preceding;
    }
    embeddedDepth = nextEmbeddedDepth(content, embeddedDepth, angleEmbedding);
  }

  while (formatted.at(-1) === "") formatted.pop();
  return protectedStrings.restore(`${formatted.join("\n")}\n`);
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
      let marker = `__velar_formatter_multiline_comment_${replacements.length}__`;
      while (source.includes(marker)) marker += "_";
      const placeholder = JSON.stringify(marker);
      const lineStart = Math.max(source.lastIndexOf("\n", index - 1), source.lastIndexOf("\r", index - 1)) + 1;
      const originalIndent = /^[ \t]*/u.exec(source.slice(lineStart, index))?.[0] ?? "";
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
      let marker = opaqueSource.attachedToPrevious
        ? `__velar_formatter_attached_opaque_source_${replacements.length}__`
        : `__velar_formatter_opaque_source_${replacements.length}__`;
      while (source.includes(marker)) marker += "_";
      const placeholder = JSON.stringify(marker);
      const lineStart = Math.max(source.lastIndexOf("\n", start - 1), source.lastIndexOf("\r", start - 1)) + 1;
      const originalIndent = /^[ \t]*/u.exec(source.slice(lineStart, start))?.[0] ?? "";
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
    let marker = `__velar_formatter_multiline_string_${replacements.length}__`;
    while (source.includes(marker)) marker += "_";
    const placeholder = JSON.stringify(marker);
    const lineStart = Math.max(source.lastIndexOf("\n", start - 1), source.lastIndexOf("\r", start - 1)) + 1;
    const originalIndent = /^[ \t]*/u.exec(source.slice(lineStart, start))?.[0] ?? "";
    replacements.push({ placeholder, value, kind: scanned.layout ? "layout" : "opaqueString", originalIndent });
    output += placeholder;
  }
  return {
    text: output,
    restore: (formatted) => replacements.reduce((current, replacement) => {
      const marker = current.indexOf(replacement.placeholder);
      if (marker < 0) return current;
      const lineStart = Math.max(current.lastIndexOf("\n", marker - 1), current.lastIndexOf("\r", marker - 1)) + 1;
      const formattedIndent = /^[ \t]*/u.exec(current.slice(lineStart, marker))?.[0] ?? "";
      const value = replacement.kind === "layout"
        ? reindentLayoutLiteral(replacement.value, replacement.originalIndent, formattedIndent)
        : replacement.kind === "blockComment"
          ? reindentBlockComment(replacement.value, replacement.originalIndent, formattedIndent)
          : replacement.value;
      return `${current.slice(0, marker)}${value}${current.slice(marker + replacement.placeholder.length)}`;
    }, formatted),
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
      // result fail `git diff --check`.
      if (text.trim().length === 0) text = "";
      else if (text.startsWith(originalMargin)) text = `${formattedMargin}${text.slice(originalMargin.length)}`;
    }
    return `${text}${line.newline}`;
  }).join("");
}

function isChainContinuationLine(content: string): boolean {
  const member = content.startsWith("?.") ? content[2] : content[1];
  return (content.startsWith(".") || content.startsWith("?.")) && Boolean(member && isSourceIdentifierStart(member));
}

function nextEmbeddedDepth(
  source: string,
  currentDepth: number,
  embedding: NonNullable<CompilerExtension["formatting"]>["angleBracketEmbedding"] | null,
): number {
  if (!embedding) return 0;
  let depth = currentDepth;
  let index = 0;
  if (depth === 0) {
    const start = embeddedStart(source);
    if (start === -1) return 0;
    index = start;
  }
  while (index < source.length) {
    if (source.startsWith("<!--", index)) {
      const end = source.indexOf("-->", index + 4);
      if (end === -1) return depth;
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
    let quote = "";
    let braces = 0;
    while (cursor < source.length) {
      const character = source[cursor++]!;
      if (quote) {
        if (character === "\\") cursor += 1;
        else if (character === quote) quote = "";
      } else if (character === '"' || character === "'") quote = character;
      else if (character === "{") braces += 1;
      else if (character === "}") braces = Math.max(0, braces - 1);
      else if (character === ">" && braces === 0) break;
    }
    const tag = source.slice(index, cursor);
    const selfClosing = /\/\s*>$/u.test(tag) || embedding.voidElements?.has(name) === true;
    if (closing) depth = Math.max(0, depth - 1);
    else if (!selfClosing) depth += 1;
    index = cursor;
  }
  return depth;
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
          || (opensAnnotatedType(tokens) && closesAsTypeArguments(source, index)));
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
  let depth = 0;
  let parenthesized = 0;
  let index = start;
  while (index < source.length) {
    const character = source[index]!;
    if (character === "<") {
      depth += 1;
      index += 1;
      continue;
    }
    if (character === ">") {
      // The close is the close whatever follows it: an author may write
      // `const values: List<number>=[1, 2, 3]` and expect canonical spacing.
      depth -= 1;
      index += 1;
      if (depth === 0) return true;
      continue;
    }
    if (source.startsWith("->", index)) {
      index += 2;
      continue;
    }
    if (isSourceIdentifierStart(character)) {
      const wordStart = index;
      index += 1;
      while (index < source.length && isSourceIdentifierPart(source[index]!)) index += 1;
      const word = source.slice(wordStart, index);
      if (binaryWords.has(word) || prefixWords.has(word)) return false;
      continue;
    }
    if (character === "(") {
      parenthesized += 1;
      index += 1;
      continue;
    }
    if (character === ")") {
      parenthesized -= 1;
      if (parenthesized < 0) return false;
      index += 1;
      continue;
    }
    if (character === ":" && parenthesized > 0) {
      index += 1;
      continue;
    }
    if (" \t,.?|".includes(character)) {
      index += 1;
      continue;
    }
    return false;
  }
  return false;
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
  return token.kind === "string" && token.text.includes("__velar_formatter_attached_opaque_source_");
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
const MARKUP_PRINT_WIDTH = 120;
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
  if (!layout.breakable || column + inline.length <= MARKUP_PRINT_WIDTH) return inline;
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
  if (!layout.breakable || column + inline.length <= MARKUP_PRINT_WIDTH || element.attributes.length === 0) return inline;
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
