/**
 * Which delimiter a string literal is written with, and the escapes that
 * choice implies. Canonicalizing one literal never reads anything outside it,
 * so this module imports nothing from its siblings.
 *
 * D115 §三 / D114 R1f: the string half of `formatter.ts`.
 */
import { findInterpolatedExpressionEnd, scanStringEscape, scanStringLiteral, type StringLiteralScan } from "../interpolated-string.ts";

export type CanonicalStringChunk =
  | { readonly kind: "text" | "templateText"; readonly value: string }
  | { readonly kind: "expression"; readonly value: string };

export function canonicalizeInlineString(source: string): string {
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

export function protectCanonicalEscapes(
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

export function splitCanonicalStringChunks(source: string, scanned: StringLiteralScan): CanonicalStringChunk[] | null {
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

export function decodeCanonicalStringText(value: string, scanned: StringLiteralScan, collapseBraces: boolean): string | null {
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

export function encodeCanonicalStringText(
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
