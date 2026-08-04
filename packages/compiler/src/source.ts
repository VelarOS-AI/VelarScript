export interface Span {
  readonly start: number;
  readonly end: number;
}

export interface SourceLocation {
  readonly line: number;
  readonly column: number;
}

export class SourceText {
  readonly path: string;
  readonly text: string;
  readonly lineStarts: readonly number[];

  constructor(path: string, text: string, indexLines = true) {
    this.path = path;
    this.text = text;
    const starts = [0];
    if (indexLines) {
      for (let index = 0; index < text.length; index += 1) {
        if (text[index] === "\r") {
          if (text[index + 1] === "\n") index += 1;
          starts.push(index + 1);
        } else if (text[index] === "\n") {
          starts.push(index + 1);
        }
      }
    }
    this.lineStarts = starts;
  }

  location(offset: number): SourceLocation {
    const bounded = Math.max(0, Math.min(offset, this.text.length));
    let low = 0;
    let high = this.lineStarts.length - 1;

    while (low <= high) {
      const middle = Math.floor((low + high) / 2);
      const start = this.lineStarts[middle] ?? 0;
      const next = this.lineStarts[middle + 1] ?? Number.POSITIVE_INFINITY;

      if (bounded < start) {
        high = middle - 1;
      } else if (bounded >= next) {
        low = middle + 1;
      } else {
        return { line: middle + 1, column: bounded - start + 1 };
      }
    }

    return { line: 1, column: 1 };
  }

  lineText(line: number): string {
    const start = this.lineStarts[line - 1];
    if (start === undefined) {
      return "";
    }
    const carriageReturn = this.text.indexOf("\r", start);
    const lineFeed = this.text.indexOf("\n", start);
    const end = carriageReturn === -1
      ? lineFeed
      : lineFeed === -1
        ? carriageReturn
        : Math.min(carriageReturn, lineFeed);
    return this.text.slice(start, end === -1 ? this.text.length : end);
  }
}

export function span(start: number, end: number): Span {
  return { start, end };
}
