export interface InterpolatedStringScan {
  readonly contentStart: number;
  readonly contentEnd: number;
  readonly end: number;
  readonly closed: boolean;
}

export function scanInterpolatedString(source: string, start: number): InterpolatedStringScan {
  const quote = source[start + 1];
  const contentStart = start + 2;
  let expressionDepth = 0;
  let expressionQuote = "";
  let index = contentStart;

  while (index < source.length) {
    const character = source[index]!;
    if (expressionDepth === 0 && character === quote) {
      return { contentStart, contentEnd: index, end: index + 1, closed: true };
    }
    if (character === "\n" || character === "\r") {
      return { contentStart, contentEnd: index, end: index, closed: false };
    }
    if (character === "\\") {
      if (source[index + 1] === "\n" || source[index + 1] === "\r") {
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
    } else if (character === "\"" || character === "'") {
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
