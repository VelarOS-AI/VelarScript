/**
 * The characters VelarScript refuses to read directly: the twelve
 * `Bidi_Control` code points that can reorder a reviewer's line, and the C0/C1
 * controls that have to be written as a visible escape. Also the one report an
 * unsupported character run earns.
 *
 * D115 §三 / D114 R1f: the hygiene half of `lexer.ts`.
 */
import { diagnostic, type Diagnostic } from "../diagnostic.ts";
import { span } from "../source.ts";

/**
 * D51 rule 104: all twelve `Bidi_Control` code points. LRM/RLM/ALM were the
 * three missing, and CVE-2021-42574 names them in the same breath as the nine
 * that were already banned — three open doors is the same as no door. ZWJ and
 * the variation selectors stay legal: they compose emoji, they do not reorder
 * a reviewer's line.
 */
const bidirectionalControls = new Set([
  0x061c, 0x200e, 0x200f,
  0x202a, 0x202b, 0x202c, 0x202d, 0x202e,
  0x2066, 0x2067, 0x2068, 0x2069,
]);

/** Everything this half of the lexer asks of the scanner that hosts it, and nothing more. */
export interface SourceHygieneHost {
  readonly diagnosedBidirectionalOffsets: Set<number>;
  readonly diagnostics: { push(...reports: readonly Diagnostic[]): void };
  index: number;
  isAtEnd(): boolean;
  readonly text: string;
}

export class SourceHygiene {
  private readonly host: SourceHygieneHost;

  constructor(host: SourceHygieneHost) {
    this.host = host;
  }

  diagnoseForbiddenSourceCharacters(): void {
    for (let index = 0; index < this.host.text.length; index += 1) {
      const codePoint = this.host.text.codePointAt(index)!;
      if (!this.isBidirectionalControl(codePoint)) {
        if (codePoint > 0xffff) index += 1;
        continue;
      }
      this.host.diagnosedBidirectionalOffsets.add(index);
      const point = codePoint.toString(16).toUpperCase().padStart(4, "0");
      this.host.diagnostics.push(diagnostic(
        "VEL1009",
        `Bidirectional control U+${point} cannot appear directly in VelarScript source; write it inside a string as '\\u{${point}}' so the source remains reviewable`,
        span(index, index + 1),
      ));
    }
  }

  isBidirectionalControl(codePoint: number): boolean {
    return bidirectionalControls.has(codePoint);
  }

  isForbiddenLiteralControl(codePoint: number): boolean {
    // Physical CR/LF are structural content in layout strings. Every other C0
    // control, DEL, and the C1 block must use the visible escape spelling.
    return (codePoint >= 0 && codePoint <= 0x1f && codePoint !== 0x0a && codePoint !== 0x0d)
      || (codePoint >= 0x7f && codePoint <= 0x9f);
  }

  invalidCharacter(character: string, start: number): void {
    const firstCodePoint = this.host.text.codePointAt(start) ?? character.codePointAt(0)!;
    this.host.index = start + (firstCodePoint > 0xffff ? 2 : 1);
    if (this.host.diagnosedBidirectionalOffsets.has(start) || this.isBidirectionalControl(firstCodePoint)) return;

    // One unsupported source run is one spelling error. Reading a non-ASCII
    // typo one UTF-16 unit at a time used to report `哈大大` as three VEL1001
    // diagnostics, then left the parser to add a fourth boundary diagnostic
    // for the same absent expression. Keep ASCII punctuation as individual
    // recovery points, but own a contiguous unsupported Unicode run here.
    if (firstCodePoint > 0x7f && firstCodePoint !== 0xfeff && !this.isForbiddenLiteralControl(firstCodePoint)) {
      while (!this.host.isAtEnd()) {
        const next = this.host.text.codePointAt(this.host.index)!;
        if (next <= 0x7f || next === 0xfeff || this.isBidirectionalControl(next) || this.isForbiddenLiteralControl(next)) break;
        this.host.index += next > 0xffff ? 2 : 1;
      }
    }

    const invalid = this.host.text.slice(start, this.host.index);
    this.host.diagnostics.push(diagnostic(
      "VEL1001",
      firstCodePoint === 0xfeff
        ? "Unexpected UTF-8 BOM (U+FEFF); remove the BOM or save the file as UTF-8 without BOM"
        : [...invalid].length === 1
          ? `Unexpected character '${invalid}'`
          : `Unexpected characters '${invalid}'`,
      span(start, this.host.index),
    ));
  }
}
