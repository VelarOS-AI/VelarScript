import { MAX_VELAR_SOURCE_CODE_UNITS } from "./limits.ts";
import { findInterpolatedExpressionEnd, scanStringEscape, scanStringLiteral, type StringLiteralScan } from "./interpolated-string.ts";
import type { CompilerExtension } from "./extension.ts";
import { isSourceIdentifierPart, isSourceIdentifierStart } from "./source-names.ts";

export interface FormatOptions {
  readonly indentWidth?: number;
  readonly extensions?: readonly CompilerExtension[];
}

type InlineKind = "word" | "literal" | "string" | "operator" | "open" | "close" | "comma" | "colon" | "dot" | "at" | "embedded" | "comment";

interface InlineToken {
  readonly kind: InlineKind;
  readonly text: string;
  readonly generic?: boolean;
}

const multiCharacterOperators = ["...", "?.", "??", "->", "=>", "==", "!=", "<=", ">=", "**", "+=", "-=", "*=", "/=", "%="] as const;
const genericNames = new Set(["List", "Set", "Map", "Promise", "Function", "Type"]);
const binaryWords = new Set(["and", "or", "in", "is"]);
const prefixWords = new Set(["not", "await"]);
const expressionStatementWords = new Set(["return", "throw", "assert"]);
const parenthesizedKeywordWords = new Set([
  "if", "while", "for", "catch",
  ...expressionStatementWords,
  ...binaryWords,
  ...prefixWords,
]);
// D30 item 16: `match` and `case` are contextual keywords, so `match(value)` is
// a call and must not gain a keyword's space. They keep it only where a
// keyword can stand — the head of a statement line.
const statementHeadKeywordWords = new Set(["match", "case"]);

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

  const protectedStrings = protectMultilineStrings(text);
  const lines = protectedStrings.text.replaceAll("\r\n", "\n").replaceAll("\r", "\n").split("\n");
  const indentation = [0];
  const formatted: string[] = [];
  let embeddedDepth = 0;
  let statementLevel = 0;

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
      formatted.push(`${" ".repeat((statementLevel + 1) * indentWidth)}${formatInline(content, angleEmbedding)}`);
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
    formatted.push(`${" ".repeat(statementLevel * indentWidth)}${embeddedDepth > 0 ? content : formatInline(content, angleEmbedding)}`);
    embeddedDepth = nextEmbeddedDepth(content, embeddedDepth, angleEmbedding);
  }

  while (formatted.at(-1) === "") formatted.pop();
  return protectedStrings.restore(`${formatted.join("\n")}\n`);
}

function protectMultilineStrings(source: string): { readonly text: string; readonly restore: (formatted: string) => string } {
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
): string {
  const tokens = tokenizeInline(source, embedding);
  if (tokens.length === 0) return "";
  let output = "";
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]!;
    const previous = tokens[index - 1];
    const next = tokens[index + 1];
    if (previous && needsSpace(previous, token, next, tokens, index)) output += " ";
    output += token.text;
  }
  return output;
}

function tokenizeInline(
  source: string,
  embedding: NonNullable<CompilerExtension["formatting"]>["angleBracketEmbedding"] | null,
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
        && (genericNames.has(previous.text) || genericStack.at(-1) === true || beginsTypeBracket(tokens));
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
const typeBracketOperators = new Set(["->", "|", "is", "case"]);

function beginsTypeBracket(tokens: readonly InlineToken[]): boolean {
  const before = tokens.at(-2);
  if (!before) return false;
  if (before.kind === "word" && typeBracketDeclarationWords.has(before.text)) return true;
  if (before.text === "not" && tokens.at(-3)?.text === "is") return true;
  return typeBracketOperators.has(before.text);
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

function beginsEmbeddedAngleSyntax(tokens: readonly InlineToken[], source: string, index: number): boolean {
  if (!/[A-Za-z>]/u.test(source[index + 1] ?? "")) return false;
  const previous = tokens.at(-1);
  return !previous || previous.text === "return" || previous.text === "=>" || previous.text === "="
    || previous.text === "(" || previous.text === "[" || previous.text === "{" || previous.text === ","
    || previous.text === ":" || previous.text === "?";
}

function needsSpace(
  previous: InlineToken,
  current: InlineToken,
  next: InlineToken | undefined,
  tokens: readonly InlineToken[],
  index: number,
): boolean {
  if (current.kind === "comment") return true;
  if (previous.kind === "comment") return !previous.text.startsWith("//");
  if (current.kind === "embedded") return previous.kind !== "open" && previous.kind !== "comma" && previous.kind !== "colon";
  if (current.kind === "comma" || current.kind === "close" || current.kind === "dot" || current.kind === "colon") {
    if (current.kind === "colon" && isTernaryColon(tokens, index)) return true;
    return false;
  }
  if (previous.kind === "dot" || previous.kind === "at") return false;
  if (current.kind === "at") return previous.kind !== "open" && previous.kind !== "operator";
  if (previous.kind === "comma" || previous.kind === "colon") return true;
  if (previous.kind === "open") return false;
  if (current.kind === "open") {
    if (current.text === "{") return true;
    const memberAccess = tokens[index - 2]?.kind === "dot";
    if (!memberAccess && expressionStatementWords.has(previous.text)) return true;
    if (!memberAccess && current.text === "(" && parenthesizedKeywordWords.has(previous.text)) return true;
    if (!memberAccess && current.text === "(" && index === 1 && statementHeadKeywordWords.has(previous.text)) return true;
    if (current.generic || current.text === "[" && (previous.kind === "word" || previous.kind === "close")) return false;
    return previous.kind !== "word" && previous.kind !== "close" && previous.kind !== "literal";
  }
  if (previous.kind === "close" && previous.generic) return current.text !== "?";
  if (previous.kind === "operator" || current.kind === "operator") {
    if (previous.text === "..." || current.text === "...") return false;
    if (current.text === "?" && isOptionalQuestion(current, next, tokens[index + 2])) return false;
    if (previous.text === "?" && isOptionalQuestion(previous, current, next)) return true;
    if (isUnaryOperator(previous, tokens[index - 2])) return previous.text === "not" || previous.text === "await";
    if (isUnaryOperator(current, previous)) return true;
    return true;
  }
  if ((previous.kind === "word" && (binaryWords.has(previous.text) || prefixWords.has(previous.text)))
    || (current.kind === "word" && binaryWords.has(current.text))) return true;
  return true;
}

function isUnaryOperator(token: InlineToken, previous: InlineToken | undefined): boolean {
  if (prefixWords.has(token.text)) return true;
  if (token.text !== "+" && token.text !== "-") return false;
  return !previous || previous.kind === "operator" || previous.kind === "open" || previous.kind === "comma" || previous.kind === "colon";
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
