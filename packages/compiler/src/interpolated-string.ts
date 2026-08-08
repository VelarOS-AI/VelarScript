export interface StringLiteralSyntax {
  readonly prefix: "" | "f" | "r" | "rf" | "fr";
  readonly prefixLength: number;
  readonly quote: "\"" | "'";
  readonly raw: boolean;
  readonly interpolated: boolean;
  readonly canonical: boolean;
}

export interface StringLiteralScan extends StringLiteralSyntax {
  readonly contentStart: number;
  readonly contentEnd: number;
  readonly content: string;
  readonly contentOffsets?: readonly number[];
  readonly end: number;
  readonly closed: boolean;
  readonly layout: boolean;
  readonly recoverAtLineStart: boolean;
  readonly indentationError?: { readonly start: number; readonly end: number };
}

export interface StringTokenPayload {
  readonly prefixLength: number;
  readonly quote: "\"" | "'";
  readonly raw: boolean;
  readonly layout: boolean;
  readonly contentOffsets?: readonly number[];
}

export function stringLiteralSyntax(source: string, start: number): StringLiteralSyntax | null {
  let prefix: StringLiteralSyntax["prefix"] = "";
  let prefixLength = 0;
  if ((source.startsWith("rf", start) || source.startsWith("fr", start))
    && (source[start + 2] === "\"" || source[start + 2] === "'")) {
    prefix = source.slice(start, start + 2) as "rf" | "fr";
    prefixLength = 2;
  } else if ((source[start] === "f" || source[start] === "r")
    && (source[start + 1] === "\"" || source[start + 1] === "'")) {
    prefix = source[start] as "f" | "r";
    prefixLength = 1;
  } else if (source[start] !== "\"" && source[start] !== "'") {
    return null;
  }
  const quote = source[start + prefixLength];
  if (quote !== "\"" && quote !== "'") return null;
  return {
    prefix,
    prefixLength,
    quote,
    raw: prefix === "r" || prefix === "rf" || prefix === "fr",
    interpolated: prefix === "f" || prefix === "rf" || prefix === "fr",
    canonical: prefix !== "fr",
  };
}

export function scanStringLiteral(source: string, start: number): StringLiteralScan | null {
  const syntax = stringLiteralSyntax(source, start);
  if (!syntax) return null;
  const quoteEnd = start + syntax.prefixLength + 1;
  if (newlineLength(source, quoteEnd) > 0) return scanLayoutString(source, start, syntax);
  return syntax.interpolated
    ? scanInlineInterpolatedString(source, start, syntax)
    : scanInlinePlainString(source, start, syntax);
}

export function findInterpolatedExpressionEnd(source: string, start: number, end = source.length): number {
  let depth = 1;
  for (let index = start; index < end; index += 1) {
    if (source.startsWith("//", index)) {
      const newline = source.indexOf("\n", index + 2);
      if (newline < 0 || newline >= end) return -1;
      index = newline;
      continue;
    }
    const literal = scanStringLiteral(source, index);
    if (literal) {
      if (!literal.closed || literal.end > end) return -1;
      index = literal.end - 1;
      continue;
    }
    const character = source[index]!;
    if (character === "{") {
      depth += 1;
    } else if (character === "}" && --depth === 0) {
      return index;
    }
  }
  return -1;
}

function scanInlineInterpolatedString(source: string, start: number, syntax: StringLiteralSyntax): StringLiteralScan {
  const contentStart = start + syntax.prefixLength + 1;
  const lineEnd = nextLineStart(source, contentStart).newlineStart;
  let index = contentStart;
  while (index < lineEnd) {
    const character = source[index]!;
    if (character === syntax.quote) {
      if (syntax.raw && source[index + 1] === syntax.quote) {
        index += 2;
        continue;
      }
      return inlineResult(source, syntax, contentStart, index, index + 1, true);
    }
    if (!syntax.raw && character === "\\") {
      index += Math.min(2, lineEnd - index);
      continue;
    }
    if ((character === "{" || character === "}") && source[index + 1] === character) {
      index += 2;
      continue;
    }
    if (character === "{") {
      const close = findInterpolatedExpressionEnd(source, index + 1, lineEnd);
      if (close < 0) return inlineResult(source, syntax, contentStart, lineEnd, lineEnd, false);
      index = close + 1;
      continue;
    }
    index += 1;
  }
  return inlineResult(source, syntax, contentStart, lineEnd, lineEnd, false);
}

function scanInlinePlainString(source: string, start: number, syntax: StringLiteralSyntax): StringLiteralScan {
  const contentStart = start + syntax.prefixLength + 1;
  const lineEnd = nextLineStart(source, contentStart).newlineStart;
  let index = contentStart;
  while (index < lineEnd) {
    const character = source[index]!;
    if (character === syntax.quote) {
      if (syntax.raw && source[index + 1] === syntax.quote) {
        index += 2;
        continue;
      }
      return inlineResult(source, syntax, contentStart, index, index + 1, true);
    }
    if (!syntax.raw && character === "\\") index += Math.min(2, lineEnd - index);
    else index += 1;
  }
  return inlineResult(source, syntax, contentStart, lineEnd, lineEnd, false);
}

function inlineResult(
  source: string,
  syntax: StringLiteralSyntax,
  contentStart: number,
  contentEnd: number,
  end: number,
  closed: boolean,
): StringLiteralScan {
  return {
    ...syntax,
    contentStart,
    contentEnd,
    content: source.slice(contentStart, contentEnd),
    end,
    closed,
    layout: false,
    recoverAtLineStart: false,
  };
}

function scanLayoutString(source: string, start: number, syntax: StringLiteralSyntax): StringLiteralScan {
  const quoteEnd = start + syntax.prefixLength + 1;
  const contentStart = quoteEnd + newlineLength(source, quoteEnd);
  const openingLineStart = previousLineStart(source, start);
  const baseIndent = leadingWhitespace(source.slice(openingLineStart, start));
  const baseWidth = indentationWidth(baseIndent);
  const lines: { readonly start: number; readonly end: number; readonly newlineEnd: number; readonly indent: string; readonly blank: boolean }[] = [];
  let margin: string | null = null;
  let indentationError: StringLiteralScan["indentationError"];
  let cursor = contentStart;

  while (cursor < source.length) {
    const boundary = nextLineStart(source, cursor);
    const line = source.slice(cursor, boundary.newlineStart);
    const indent = leadingWhitespace(line);
    const body = line.slice(indent.length);
    const blank = body.length === 0;
    const width = indentationWidth(indent);
    if (!blank && width <= baseWidth) {
      if (indent === baseIndent && body.startsWith(syntax.quote)) {
        const close = cursor + indent.length;
        const built = buildLayoutContent(source, lines, margin, contentStart);
        return {
          ...syntax,
          contentStart,
          contentEnd: cursor,
          content: built.content,
          contentOffsets: built.offsets,
          end: close + 1,
          closed: true,
          layout: true,
          recoverAtLineStart: false,
          ...(indentationError ? { indentationError } : {}),
        };
      }
      const built = buildLayoutContent(source, lines, margin, contentStart);
      return {
        ...syntax,
        contentStart,
        contentEnd: cursor,
        content: built.content,
        contentOffsets: built.offsets,
        end: cursor,
        closed: false,
        layout: true,
        recoverAtLineStart: true,
        ...(indentationError ? { indentationError } : {}),
      };
    }
    if (!blank) {
      if (margin === null) margin = indent;
      else if (!line.startsWith(margin) && indentationError === undefined) {
        indentationError = { start: cursor, end: cursor + indent.length };
      }
    }
    lines.push({ start: cursor, end: boundary.newlineStart, newlineEnd: boundary.nextStart, indent, blank });
    if (boundary.nextStart === cursor || boundary.nextStart >= source.length) {
      cursor = source.length;
      break;
    }
    cursor = boundary.nextStart;
  }

  const built = buildLayoutContent(source, lines, margin, contentStart);
  return {
    ...syntax,
    contentStart,
    contentEnd: source.length,
    content: built.content,
    contentOffsets: built.offsets,
    end: source.length,
    closed: false,
    layout: true,
    recoverAtLineStart: false,
    ...(indentationError ? { indentationError } : {}),
  };
}

function buildLayoutContent(
  source: string,
  lines: readonly { readonly start: number; readonly end: number; readonly newlineEnd: number; readonly indent: string; readonly blank: boolean }[],
  margin: string | null,
  fallbackOffset: number,
): { readonly content: string; readonly offsets: readonly number[] } {
  let content = "";
  const offsets: number[] = [];
  const append = (start: number, end: number): void => {
    if (offsets.length === 0) offsets.push(start);
    else offsets[offsets.length - 1] = start;
    content += source.slice(start, end);
    for (let index = start; index < end; index += 1) offsets.push(index + 1);
  };
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!;
    const bodyStart = line.blank ? line.end : line.start + (margin && source.startsWith(margin, line.start) ? margin.length : line.indent.length);
    append(bodyStart, line.end);
    if (index < lines.length - 1) append(line.end, line.newlineEnd);
  }
  if (offsets.length === 0) offsets.push(lines[0]?.start ?? fallbackOffset);
  return { content, offsets };
}

function nextLineStart(source: string, start: number): { readonly newlineStart: number; readonly nextStart: number } {
  for (let index = start; index < source.length; index += 1) {
    const length = newlineLength(source, index);
    if (length > 0) return { newlineStart: index, nextStart: index + length };
  }
  return { newlineStart: source.length, nextStart: source.length };
}

function previousLineStart(source: string, index: number): number {
  while (index > 0 && source[index - 1] !== "\n" && source[index - 1] !== "\r") index -= 1;
  return index;
}

function leadingWhitespace(value: string): string {
  return /^[ \t]*/u.exec(value)?.[0] ?? "";
}

function indentationWidth(value: string): number {
  let width = 0;
  for (const character of value) width += character === "\t" ? 4 : 1;
  return width;
}

function newlineLength(source: string, index: number): number {
  if (source[index] === "\r") return source[index + 1] === "\n" ? 2 : 1;
  return source[index] === "\n" ? 1 : 0;
}
