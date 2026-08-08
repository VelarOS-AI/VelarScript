export interface InterpolatedStringScan {
  readonly contentStart: number;
  readonly contentEnd: number;
  readonly end: number;
  readonly closed: boolean;
}

export function findInterpolatedExpressionEnd(source: string, start: number, end = source.length): number {
  let depth = 1;
  let quote: "\"" | "'" | "`" | null = null;
  for (let index = start; index < end; index += 1) {
    const character = source[index]!;
    if (quote) {
      if (character === "\\") {
        index += 1;
      } else if (character === quote) {
        quote = null;
      }
      continue;
    }
    if (character === "\"" || character === "'" || character === "`") {
      quote = character;
    } else if (character === "{") {
      depth += 1;
    } else if (character === "}" && --depth === 0) {
      return index;
    }
  }
  return -1;
}

export function scanInterpolatedString(source: string, start: number): InterpolatedStringScan {
  const quote = source[start + 1];
  const multiline = quote === "`";
  const contentStart = start + 2;
  let expressionDepth = 0;
  let expressionQuote = "";
  let index = contentStart;

  while (index < source.length) {
    const character = source[index]!;
    if (expressionDepth === 0 && character === quote) {
      return { contentStart, contentEnd: index, end: index + 1, closed: true };
    }
    if (!multiline && (character === "\n" || character === "\r")) {
      return { contentStart, contentEnd: index, end: index, closed: false };
    }
    if (character === "\\") {
      if (!multiline && (source[index + 1] === "\n" || source[index + 1] === "\r")) {
        return { contentStart, contentEnd: index + 1, end: index + 1, closed: false };
      }
      index += Math.min(2, source.length - index);
      continue;
    }
    if (expressionDepth === 0) {
      if ((character === "{" || character === "}") && source[index + 1] === character) {
        index += 2;
        continue;
      }
      if (character === "{") expressionDepth = 1;
    } else if (expressionQuote) {
      if (character === expressionQuote) expressionQuote = "";
    } else if (character === "\"" || character === "'" || character === "`") {
      expressionQuote = character;
    } else if (character === "{") {
      expressionDepth += 1;
    } else if (character === "}") {
      expressionDepth -= 1;
    }
    index += 1;
  }

  return { contentStart, contentEnd: source.length, end: source.length, closed: false };
}
