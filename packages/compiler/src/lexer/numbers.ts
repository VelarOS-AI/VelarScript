/**
 * Numeric literals: the decimal and radix forms, the `_` separators a reader
 * groups digits with, the suffix a target may own, and the `#rrggbb` colour
 * literal that is spelled like one.
 *
 * D115 §三 / D114 R1f: the number half of `lexer.ts`.
 */
import { diagnostic, mechanicalFix, recoveredDiagnostic, type Diagnostic } from "../diagnostic.ts";
import { webNumericUnitOwner } from "../language-guidance.ts";
import { span, type Span } from "../source.ts";
import { type NumberTokenPayload, type Token } from "../token.ts";

/** Everything this half of the lexer asks of the scanner that hosts it, and nothing more. */
export interface NumberScannerHost {
  advance(): string;
  readonly diagnostics: { push(...reports: readonly Diagnostic[]): void };
  index: number;
  isDigit(character: string): boolean;
  isIdentifierPart(character: string): boolean;
  isIdentifierStart(character: string): boolean;
  readonly numericSuffixes: ReadonlySet<string>;
  peek(offset?: number): string;
  readonly text: string;
  readonly tokens: Token[];
}

export class NumberScanner {
  private readonly host: NumberScannerHost;

  constructor(host: NumberScannerHost) {
    this.host = host;
  }

  readNumber(): void {
    const start = this.host.index;
    if (this.host.peek() === "0" && ["x", "X", "b", "B", "o", "O"].includes(this.host.peek(1))) {
      this.readRadixNumber();
      return;
    }
    const integer = this.readDigitsWithSeparators();
    if (integer.length > 1 && integer.startsWith("0")) {
      this.host.diagnostics.push(diagnostic(
        "VEL1007",
        "Remove the leading zeros; octal literals are not part of VelarScript",
        span(start, this.host.index),
      ));
    }
    let value = integer;
    if (this.host.peek() === "." && (this.host.isDigit(this.host.peek(1)) || this.host.peek(1) === "_")) {
      this.host.advance();
      value += `.${this.readDigitsWithSeparators()}`;
    } else if (this.host.peek() === "." && !this.host.isIdentifierStart(this.host.peek(1)) && this.host.peek(1) !== ".") {
      const point = this.host.index;
      this.host.advance();
      value += ".0";
      this.host.diagnostics.push(recoveredDiagnostic(
        "VEL1007",
        `Write '${integer}.0'; decimal literals require a digit after the point`,
        span(point, this.host.index),
        mechanicalFix(span(point, this.host.index), ".0", `Write '${integer}.0'`),
      ));
    }
    if ((this.host.peek() === "e" || this.host.peek() === "E")
      && (this.host.isDigit(this.host.peek(1)) || this.host.peek(1) === "_"
        || ((this.host.peek(1) === "+" || this.host.peek(1) === "-") && (this.host.isDigit(this.host.peek(2)) || this.host.peek(2) === "_")))) {
      const exponent = this.host.advance();
      value += exponent;
      if (this.host.peek() === "+" || this.host.peek() === "-") value += this.host.advance();
      value += this.readDigitsWithSeparators();
    }
    const numberEnd = this.host.index;
    // LOK-I5: where the percentage unit does not exist, Core still reads `50%`
    // as the percentage shape in the positions where no remainder operand can
    // follow — end of line, `)`, `]`, `,` — so the author gets the unit's own
    // guidance instead of a statement-continuation error about a spelling they
    // never meant as arithmetic. `10 % 3` and `10%3` both keep a right operand
    // and stay remainder in Core.
    if (this.host.peek() === "%" && (this.host.numericSuffixes.has("%") || this.isPercentUnitPosition())) this.host.advance();
    else while (this.host.isIdentifierPart(this.host.peek())) this.host.advance();
    const suffix = this.host.text.slice(numberEnd, this.host.index);
    if (suffix && this.host.numericSuffixes.has(suffix)) {
      this.pushNumber("unitNumber", `${value}${suffix}`, span(start, this.host.index));
      return;
    }
    if (suffix) {
      const radix = integer === "0" && suffix.length > 1 ? suffix[0]?.toLowerCase() : null;
      const radixName = radix === "x" ? "Hexadecimal" : radix === "b" ? "Binary" : radix === "o" ? "Octal" : null;
      // The unit vocabulary is the Web extension's. A Core file that spells a
      // Look unit names the extension that owns it and how to enable it —
      // D37 rule 45's cross-extension voice — instead of calling a perfectly
      // good spelling unknown.
      const owner = webNumericUnitOwner(suffix);
      this.host.diagnostics.push(diagnostic(
        "VEL1007",
        radixName
          ? `${radixName} literals are not part of VelarScript; write the decimal value`
          : owner
            ? `The numeric unit '${suffix}' belongs to ${owner}; add "${owner}" to velar.json extensions, or move this module into a Web project`
            : this.host.numericSuffixes.size > 0
              ? `Unknown numeric unit '${suffix}'`
              : `Unexpected characters '${suffix}' after a number`,
        span(numberEnd, this.host.index),
      ));
    }
    this.pushNumber("number", value, span(start, numberEnd));
  }

  readRadixNumber(): void {
    const start = this.host.index;
    const prefix = this.host.peek(1).toLowerCase();
    const radix = prefix === "x" ? 16 : prefix === "b" ? 2 : 8;
    const radixName = radix === 16 ? "hexadecimal" : radix === 2 ? "binary" : "octal";
    this.host.advance();
    this.host.advance();
    let digits = "";
    let sawDigit = false;
    while (this.host.isIdentifierPart(this.host.peek())) {
      const character = this.host.peek();
      if (character === "_") {
        const separator = this.host.index;
        const previous = this.host.text[this.host.index - 1] ?? "";
        const next = this.host.peek(1);
        this.host.advance();
        if (!this.isRadixDigit(previous, radix) || !this.isRadixDigit(next, radix)) {
          this.host.diagnostics.push(diagnostic("VEL1007", "Numeric separators must appear only between digits", span(separator, this.host.index)));
        }
        continue;
      }
      if (!this.isRadixDigit(character, radix)) {
        const invalidStart = this.host.index;
        while (this.host.isIdentifierPart(this.host.peek())) this.host.advance();
        this.host.diagnostics.push(diagnostic("VEL1007", `Invalid digit in ${radixName} integer literal`, span(invalidStart, this.host.index)));
        break;
      }
      sawDigit = true;
      digits += this.host.advance();
    }
    if (!sawDigit) {
      this.host.diagnostics.push(diagnostic("VEL1007", `${radixName[0]!.toUpperCase()}${radixName.slice(1)} integer literals require at least one digit`, span(start, this.host.index)));
      digits = "0";
    }
    this.pushNumber("number", `0${prefix}${digits}`, span(start, this.host.index));
  }

  /**
   * A number token, carrying the author's own spelling whenever the value it
   * holds is spelled differently — `1_000` loses its separators and `0X20`
   * loses its uppercase prefix on the way to the token. D90 R6 quotes the
   * literal back when it is not exactly representable, and it must quote what
   * was written: reporting `'10000000000000000001'` for a source line that
   * reads `1_000_000_000_000_000_000_1` sends the author looking for text that
   * is not there.
   */
  private pushNumber(kind: "number" | "unitNumber", value: string, tokenSpan: Span): void {
    const written = this.host.text.slice(tokenSpan.start, tokenSpan.end);
    if (written === value) {
      this.host.tokens.push({ kind, value, span: tokenSpan });
      return;
    }
    this.host.tokens.push({ kind, value, span: tokenSpan, payload: { written } satisfies NumberTokenPayload });
  }

  private isRadixDigit(character: string, radix: number): boolean {
    if (character >= "0" && character <= "9") return Number(character) < radix;
    if (radix !== 16) return false;
    const lower = character.toLowerCase();
    return lower >= "a" && lower <= "f";
  }

  /**
   * LOK-I5: `%` right after a number is the percentage unit only where a
   * remainder operator could not stand — the operator always takes a right
   * operand, so a `%` followed by a line end, a closing bracket, or a
   * separator is a unit spelling and nothing else.
   */
  private isPercentUnitPosition(): boolean {
    const next = this.host.peek(1);
    return next === "\0" || next === "\n" || next === "\r" || next === ")" || next === "]" || next === "}" || next === "," || next === ";" || next === ":";
  }

  readLeadingDotNumber(): void {
    const start = this.host.index;
    this.host.advance();
    let value = `0.${this.readDigitsWithSeparators()}`;
    if ((this.host.peek() === "e" || this.host.peek() === "E")
      && (this.host.isDigit(this.host.peek(1)) || this.host.peek(1) === "_"
        || ((this.host.peek(1) === "+" || this.host.peek(1) === "-") && (this.host.isDigit(this.host.peek(2)) || this.host.peek(2) === "_")))) {
      value += this.host.advance();
      if (this.host.peek() === "+" || this.host.peek() === "-") value += this.host.advance();
      value += this.readDigitsWithSeparators();
    }
    this.host.diagnostics.push(recoveredDiagnostic(
      "VEL1007",
      `Write '${value}'; decimal literals require a digit before the point`,
      span(start, this.host.index),
      mechanicalFix(span(start, this.host.index), value, `Write '${value}'`),
    ));
    this.pushNumber("number", value, span(start, this.host.index));
  }

  private readDigitsWithSeparators(): string {
    let value = "";
    while (this.host.isDigit(this.host.peek()) || this.host.peek() === "_") {
      if (this.host.isDigit(this.host.peek())) {
        value += this.host.advance();
        continue;
      }
      const separator = this.host.index;
      const valid = this.host.isDigit(this.host.text[this.host.index - 1] ?? "") && this.host.isDigit(this.host.peek(1));
      this.host.advance();
      if (!valid) {
        this.host.diagnostics.push(diagnostic(
          "VEL1007",
          "Numeric separators must appear only between digits",
          span(separator, this.host.index),
        ));
      }
    }
    return value;
  }

  // A bare hex color such as '#3478f6' is guided to its quoted-string
  // spelling and recovered as that string token, so the digits never fall
  // into number lexing and produce a misleading unknown-numeric-unit error.
  readHexColor(start: number): boolean {
    let length = 0;
    while (/[0-9a-fA-F]/.test(this.host.peek(1 + length))) length += 1;
    if ((length !== 3 && length !== 4 && length !== 6 && length !== 8) || this.host.isIdentifierPart(this.host.peek(1 + length))) {
      return false;
    }
    const end = start + 1 + length;
    const text = this.host.text.slice(start, end);
    this.host.diagnostics.push(recoveredDiagnostic(
      "VEL1005",
      `Use '"${text}"'; VelarScript writes hex colors as quoted strings or color builders such as rgb(...)`,
      span(start, end),
      mechanicalFix(span(start, end), `"${text}"`, `Quote the hex color as '"${text}"'`),
    ));
    this.host.tokens.push({ kind: "string", value: text, span: span(start, end) });
    this.host.index = end;
    return true;
  }
}
