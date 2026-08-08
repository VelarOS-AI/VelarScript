import { MAX_VELAR_SOURCE_CODE_UNITS } from "./limits.ts";
import { findInterpolatedExpressionEnd, scanStringLiteral, type StringLiteralScan } from "./interpolated-string.ts";

export interface FormatOptions {
  readonly indentWidth?: number;
}

type InlineKind = "word" | "literal" | "string" | "operator" | "open" | "close" | "comma" | "colon" | "dot" | "at" | "jsx" | "comment";

interface InlineToken {
  readonly kind: InlineKind;
  readonly text: string;
  readonly generic?: boolean;
}

const multiCharacterOperators = ["...", "?.", "??", "->", "=>", "==", "!=", "<=", ">=", "**", "+=", "-=", "*=", "/=", "%="] as const;
const genericNames = new Set(["List", "Set", "Map", "Promise"]);
const binaryWords = new Set(["and", "or", "in", "is"]);
const prefixWords = new Set(["not", "await"]);
const expressionStatementWords = new Set(["return", "throw", "assert"]);
const parenthesizedKeywordWords = new Set([
  "if", "while", "for", "match", "case", "catch",
  ...expressionStatementWords,
  ...binaryWords,
  ...prefixWords,
]);

/**
 * Formats VelarScript source without round-tripping through generated JavaScript.
 * The formatter tokenizes each logical source line so strings, comments, JSX,
 * unit literals, Look hooks, operators, named arguments, and type syntax retain
 * their meaning while whitespace and indentation become canonical.
 */
export function formatSource(text: string, options: FormatOptions = {}): string {
  if (text.length > MAX_VELAR_SOURCE_CODE_UNITS) throw new RangeError("A VelarScript source module cannot exceed 4 MiB");
  const indentWidth = options.indentWidth ?? 4;
  if (!Number.isSafeInteger(indentWidth) || indentWidth < 1 || indentWidth > 16) {
    throw new RangeError("VelarScript formatter indentWidth must be an integer from 1 through 16");
  }

  const protectedStrings = protectMultilineStrings(text);
  const lines = protectedStrings.text.replaceAll("\r\n", "\n").replaceAll("\r", "\n").split("\n");
  const indentation = [0];
  const formatted: string[] = [];
  let jsxDepth = 0;
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
    if (jsxDepth === 0 && isChainContinuationLine(content) && formatted.length > 0) {
      formatted.push(`${" ".repeat((statementLevel + 1) * indentWidth)}${formatInline(content)}`);
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
    formatted.push(`${" ".repeat(statementLevel * indentWidth)}${jsxDepth > 0 ? content : formatInline(content)}`);
    jsxDepth = nextJsxDepth(content, jsxDepth);
  }

  while (formatted.at(-1) === "") formatted.pop();
  return protectedStrings.restore(`${formatted.join("\n")}\n`);
}

function protectMultilineStrings(source: string): { readonly text: string; readonly restore: (formatted: string) => string } {
  const replacements: {
    readonly placeholder: string;
    readonly value: string;
    readonly layout: boolean;
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
    const previous = source[index - 1];
    const scanned = (!previous || !/[A-Za-z0-9_]/u.test(previous)) ? scanStringLiteral(source, index) : null;
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
    replacements.push({ placeholder, value, layout: scanned.layout, originalIndent });
    output += placeholder;
  }
  return {
    text: output,
    restore: (formatted) => replacements.reduce((current, replacement) => {
      const marker = current.indexOf(replacement.placeholder);
      if (marker < 0) return current;
      const lineStart = Math.max(current.lastIndexOf("\n", marker - 1), current.lastIndexOf("\r", marker - 1)) + 1;
      const formattedIndent = /^[ \t]*/u.exec(current.slice(lineStart, marker))?.[0] ?? "";
      const value = replacement.layout
        ? reindentLayoutLiteral(replacement.value, replacement.originalIndent, formattedIndent)
        : replacement.value;
      return `${current.slice(0, marker)}${value}${current.slice(marker + replacement.placeholder.length)}`;
    }, formatted),
  };
}

function reindentLayoutLiteral(value: string, originalIndent: string, formattedIndent: string): string {
  let output = "";
  let cursor = 0;
  let first = true;
  while (cursor < value.length) {
    const boundary = /\r\n|\r|\n/gu;
    boundary.lastIndex = cursor;
    const match = boundary.exec(value);
    const end = match?.index ?? value.length;
    const line = value.slice(cursor, end);
    output += first || !line.startsWith(originalIndent)
      ? line
      : `${formattedIndent}${line.slice(originalIndent.length)}`;
    first = false;
    if (!match) break;
    output += match[0];
    cursor = end + match[0].length;
  }
  return output;
}

function isChainContinuationLine(content: string): boolean {
  return /^(?:\.|\?\.)[A-Za-z_]/u.test(content);
}

function nextJsxDepth(source: string, currentDepth: number): number {
  let depth = currentDepth;
  let index = 0;
  if (depth === 0) {
    const start = jsxStart(source);
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
    const selfClosing = /\/\s*>$/u.test(tag) || (name === name.toLowerCase() && formatterVoidTags.has(name));
    if (closing) depth = Math.max(0, depth - 1);
    else if (!selfClosing) depth += 1;
    index = cursor;
  }
  return depth;
}

function jsxStart(source: string): number {
  for (let index = 0; index < source.length - 1; index += 1) {
    if (source[index] !== "<" || !/[A-Za-z>]/u.test(source[index + 1] ?? "")) continue;
    const prefix = source.slice(0, index).trimEnd();
    if (prefix === "" || /(?:\breturn|=>|=|\(|\[|\{|,|:|\?)$/u.test(prefix)) return index;
  }
  return -1;
}

const formatterVoidTags = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"]);

function formatInline(source: string): string {
  const tokens = tokenizeInline(source);
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

function tokenizeInline(source: string): InlineToken[] {
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
    const scannedString = scanStringLiteral(source, index);
    if (scannedString) {
      const start = index;
      index = scannedString.end;
      tokens.push({
        kind: "string",
        text: scannedString.interpolated ? formatInterpolatedString(source, start, scannedString) : source.slice(start, index),
      });
      continue;
    }
    if (character === "<" && beginsJsx(tokens, source, index)) {
      tokens.push({ kind: "jsx", text: source.slice(index).trimEnd() });
      break;
    }
    if (/[A-Za-z_]/u.test(character)) {
      const start = index++;
      while (index < source.length && /[A-Za-z0-9_]/u.test(source[index]!)) index += 1;
      const value = source.slice(start, index);
      tokens.push({ kind: value === "true" || value === "false" || value === "null" ? "literal" : "word", text: value });
      continue;
    }
    if (/[0-9]/u.test(character)) {
      const start = index++;
      while (index < source.length && /[0-9]/u.test(source[index]!)) index += 1;
      if (source[index] === "." && /[0-9]/u.test(source[index + 1] ?? "")) {
        index += 1;
        while (index < source.length && /[0-9]/u.test(source[index]!)) index += 1;
      }
      if ((source[index] === "e" || source[index] === "E") && /[+\-0-9]/u.test(source[index + 1] ?? "")) {
        index += 1;
        if (source[index] === "+" || source[index] === "-") index += 1;
        while (index < source.length && /[0-9]/u.test(source[index]!)) index += 1;
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
  return typeBracketOperators.has(before.text);
}

function formatInterpolatedString(source: string, start: number, scanned: StringLiteralScan): string {
  if (!scanned.closed) return source.slice(start, scanned.end);
  let output = source.slice(start, scanned.contentStart);
  let index = scanned.contentStart;
  while (index < scanned.contentEnd) {
    const character = source[index]!;
    const next = source[index + 1];
    if (!scanned.raw && character === "\\" && next !== undefined) {
      output += `${character}${next}`;
      index += 2;
      continue;
    }
    if ((character === "{" || character === "}") && next === character) {
      output += `${character}${next}`;
      index += 2;
      continue;
    }
    if (character !== "{") {
      output += character;
      index += 1;
      continue;
    }
    const close = findInterpolatedExpressionEnd(source, index + 1, scanned.contentEnd);
    if (close < 0) return source.slice(start, scanned.end);
    output += `{${formatInline(source.slice(index + 1, close).trim())}}`;
    index = close + 1;
  }
  return `${output}${source.slice(scanned.contentEnd, scanned.end)}`;
}

function beginsJsx(tokens: readonly InlineToken[], source: string, index: number): boolean {
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
  if (previous.kind === "comment") return false;
  if (current.kind === "jsx") return previous.kind !== "open" && previous.kind !== "comma" && previous.kind !== "colon";
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
