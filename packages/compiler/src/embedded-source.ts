/** A contiguous raw source slice delimited by a structural multiline backtick. */
export interface OpaqueEmbeddedSourceScan {
  readonly start: number;
  readonly sourceStart: number;
  readonly sourceEnd: number;
  readonly end: number;
  readonly closed: boolean;
  readonly openingLineBreak: boolean;
  readonly closingTailStart: number | null;
  readonly closingTailEnd: number | null;
}

/**
 * Scans an opaque multiline payload without knowing its language or owner.
 * The closing backtick must appear at `declarationIndentation`, alone except
 * for a tail accepted by its language owner. Content is never decoded,
 * dedented, or searched for language constructs.
 */
export function scanOpaqueEmbeddedSource(
  source: string,
  start: number,
  declarationIndentation: string,
  acceptsClosingTail: (tail: string) => boolean,
): OpaqueEmbeddedSourceScan {
  const openingBreakLength = newlineLength(source, start + 1);
  const openingLineBreak = openingBreakLength > 0;
  const firstBoundary = nextLineBoundary(source, start + 1);
  const sourceStart = openingLineBreak ? start + 1 + openingBreakLength : firstBoundary.nextStart;
  let lineStart = sourceStart;

  while (lineStart < source.length) {
    const boundary = nextLineBoundary(source, lineStart);
    const expected = `${declarationIndentation}\``;
    if (source.startsWith(expected, lineStart)) {
      const delimiter = lineStart + expected.length - 1;
      const closingTailStart = delimiter + 1;
      const closingTailEnd = boundary.newlineStart;
      if (acceptsClosingTail(source.slice(closingTailStart, closingTailEnd))) {
        return {
          start,
          sourceStart,
          sourceEnd: lineStart,
          end: delimiter + 1,
          closed: true,
          openingLineBreak,
          closingTailStart,
          closingTailEnd,
        };
      }
    }
    if (boundary.nextStart <= lineStart || boundary.nextStart >= source.length) break;
    lineStart = boundary.nextStart;
  }

  return {
    start,
    sourceStart,
    sourceEnd: source.length,
    end: source.length,
    closed: false,
    openingLineBreak,
    closingTailStart: null,
    closingTailEnd: null,
  };
}

function nextLineBoundary(source: string, start: number): { readonly newlineStart: number; readonly nextStart: number } {
  for (let index = start; index < source.length; index += 1) {
    const length = newlineLength(source, index);
    if (length > 0) return { newlineStart: index, nextStart: index + length };
  }
  return { newlineStart: source.length, nextStart: source.length };
}

function newlineLength(source: string, index: number): number {
  if (source[index] === "\r") return source[index + 1] === "\n" ? 2 : 1;
  return source[index] === "\n" ? 1 : 0;
}
