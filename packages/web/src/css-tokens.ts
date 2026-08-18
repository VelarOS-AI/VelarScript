/**
 * CSS token scanning for the D53 unsafe-CSS gates.
 *
 * Both gates ask a question about CSS *tokens*: "does this stylesheet declare
 * an `@import` at-rule" and "does a `url()` name a relative address". Text
 * scanning answers neither, and it fails in both directions at once: a `)`
 * inside a quoted URL ends a regex match early, so `url("./mark).svg")` — a
 * legal reference to a legal filename — matches nothing and walks past the
 * gate into a production build that 404s; while a `url(...)` written inside a
 * string literal, which is text and not a reference at all, matches and gets
 * refused. One scanner, reading the token grammar, is what both gates need,
 * so both read the stream produced here instead of writing a private regex.
 *
 * Coverage is CSS Syntax Level 3 tokenization as far as those two questions
 * reach: comments, strings (escapes, line continuations, bad-string), ident
 * sequences, at-keywords, function tokens, and both url forms (the unquoted
 * url-token and the `url(` function over a string), including bad-url
 * recovery. Selectors, declarations, at-rule blocks, and numeric detail stay
 * unparsed — CSS remains raw and unowned under D53, and this is a reader of
 * addresses, not a CSS parser.
 */

/** A token one of the unsafe-CSS gates asks about. */
export type CssToken =
  /** `@import`, `@media`, … — the at-rule name, escapes already decoded. */
  | { readonly kind: "at-keyword"; readonly name: string }
  /** A `url()` address, escapes decoded, exactly what a browser resolves. */
  | { readonly kind: "url"; readonly value: string }
  /** A bare string that the image-set grammar defines as a URL. */
  | { readonly kind: "asset-address"; readonly value: string; readonly syntax: "image-set" | "-webkit-image-set" };

const REPLACEMENT = "�";
const MAXIMUM_CODE_POINT = 0x10_ff_ff;

function isNewline(character: string): boolean {
  return character === "\n" || character === "\r" || character === "\f";
}

function isWhitespace(character: string): boolean {
  return character === " " || character === "\t" || isNewline(character);
}

function isDigit(character: string): boolean {
  return character >= "0" && character <= "9";
}

function isHexDigit(character: string): boolean {
  return isDigit(character) || (character >= "a" && character <= "f") || (character >= "A" && character <= "F");
}

function isIdentStartCodePoint(character: string): boolean {
  return (character >= "a" && character <= "z")
    || (character >= "A" && character <= "Z")
    || character === "_"
    || character.charCodeAt(0) >= 0x80;
}

function isIdentCodePoint(character: string): boolean {
  return isIdentStartCodePoint(character) || isDigit(character) || character === "-";
}

/** U+0000–U+0008, U+000B, U+000E–U+001F, U+007F: these end a url token. */
function isNonPrintable(character: string): boolean {
  const code = character.charCodeAt(0);
  return code <= 0x08 || code === 0x0b || (code >= 0x0e && code <= 0x1f) || code === 0x7f;
}

class CssScanner {
  private index = 0;
  private readonly source: string;

  constructor(source: string) {
    this.source = source;
  }

  *tokens(): Generator<CssToken> {
    while (this.index < this.source.length) {
      const character = this.source[this.index]!;
      if (character === "/" && this.source[this.index + 1] === "*") {
        this.consumeComment();
        continue;
      }
      if (character === "\"" || character === "'") {
        this.consumeString(character);
        continue;
      }
      if (character === "@" && this.startsIdentSequence(this.index + 1)) {
        this.index += 1;
        yield { kind: "at-keyword", name: this.consumeIdentSequence() };
        continue;
      }
      if (isDigit(character)) {
        // A number's trailing ident sequence is a unit, never a function: the
        // `px` of `20px` must not be read as the head of a `url(`-alike.
        this.consumeNumeric();
        continue;
      }
      if (this.startsIdentSequence(this.index)) {
        for (const token of this.consumeIdentLike()) yield token;
        continue;
      }
      this.index += 1;
    }
  }

  private consumeComment(): void {
    const end = this.source.indexOf("*/", this.index + 2);
    this.index = end === -1 ? this.source.length : end + 2;
  }

  /** The string's value, or null when a newline made it a bad-string. */
  private consumeString(quote: string): string | null {
    this.index += 1;
    let value = "";
    while (this.index < this.source.length) {
      const character = this.source[this.index]!;
      if (character === quote) {
        this.index += 1;
        return value;
      }
      if (isNewline(character)) return null;
      if (character === "\\") {
        const next = this.source[this.index + 1];
        if (next === undefined) {
          this.index += 1;
          return value;
        }
        if (isNewline(next)) {
          this.index += 1;
          if (next === "\r" && this.source[this.index + 1] === "\n") this.index += 1;
          this.index += 1;
          continue;
        }
        value += this.consumeEscape();
        continue;
      }
      value += character;
      this.index += 1;
    }
    return value;
  }

  /** Consumes `\` plus its escape and returns the code point it names. */
  private consumeEscape(): string {
    this.index += 1;
    const first = this.source[this.index];
    if (first === undefined) return REPLACEMENT;
    if (!isHexDigit(first)) {
      const text = String.fromCodePoint(this.source.codePointAt(this.index)!);
      this.index += text.length;
      return text;
    }
    let hex = "";
    while (hex.length < 6 && this.index < this.source.length && isHexDigit(this.source[this.index]!)) {
      hex += this.source[this.index]!;
      this.index += 1;
    }
    const trailing = this.source[this.index];
    if (trailing !== undefined && isWhitespace(trailing)) {
      if (trailing === "\r" && this.source[this.index + 1] === "\n") this.index += 1;
      this.index += 1;
    }
    const code = Number.parseInt(hex, 16);
    if (code === 0 || code > MAXIMUM_CODE_POINT || (code >= 0xd8_00 && code <= 0xdf_ff)) return REPLACEMENT;
    return String.fromCodePoint(code);
  }

  private isValidEscape(index: number): boolean {
    if (this.source[index] !== "\\") return false;
    const next = this.source[index + 1];
    return next === undefined || !isNewline(next);
  }

  private startsIdentSequence(index: number): boolean {
    const character = this.source[index];
    if (character === undefined) return false;
    if (character === "-") {
      const next = this.source[index + 1];
      if (next === undefined) return false;
      if (isIdentStartCodePoint(next) || next === "-") return true;
      return this.isValidEscape(index + 1);
    }
    if (isIdentStartCodePoint(character)) return true;
    return this.isValidEscape(index);
  }

  private consumeIdentSequence(): string {
    let value = "";
    while (this.index < this.source.length) {
      const character = this.source[this.index]!;
      if (isIdentCodePoint(character)) {
        value += character;
        this.index += 1;
        continue;
      }
      if (this.isValidEscape(this.index)) {
        value += this.consumeEscape();
        continue;
      }
      break;
    }
    return value;
  }

  private consumeNumeric(): void {
    while (this.index < this.source.length && isDigit(this.source[this.index]!)) this.index += 1;
    if (this.source[this.index] === "." && isDigit(this.source[this.index + 1] ?? "")) {
      this.index += 1;
      while (this.index < this.source.length && isDigit(this.source[this.index]!)) this.index += 1;
    }
    if (this.startsIdentSequence(this.index)) this.consumeIdentSequence();
    else if (this.source[this.index] === "%") this.index += 1;
  }

  /** The addresses when this function carries URL-valued tokens. */
  private consumeIdentLike(): readonly CssToken[] {
    const name = this.consumeIdentSequence();
    if (this.source[this.index] !== "(") return [];
    this.index += 1;
    const normalizedName = name.toLowerCase();
    if (normalizedName === "image-set" || normalizedName === "-webkit-image-set") {
      return this.consumeImageSet(normalizedName);
    }
    if (normalizedName !== "url") return [];
    const value = this.consumeUrlFunctionValue();
    return value === null ? [] : [{ kind: "url", value }];
  }

  private consumeUrlFunctionValue(): string | null {
    let probe = this.index;
    while (probe < this.source.length && isWhitespace(this.source[probe]!)) probe += 1;
    const quote = this.source[probe];
    if (quote === "\"" || quote === "'") {
      // `url( "…" )` is a function over a string, not a url token: the address
      // is the string's value, so a `)` or a quote inside it is just content.
      this.index = probe;
      const value = this.consumeString(quote);
      while (this.index < this.source.length && isWhitespace(this.source[this.index]!)) this.index += 1;
      if (value === null || this.source[this.index] !== ")") return null;
      this.index += 1;
      return value;
    }
    return this.consumeUrlToken();
  }

  /**
   * CSS Images 4 makes a top-level string at the start of each image-set
   * option a URL. Strings inside type(), gradients, and other nested
   * functions remain ordinary strings and are deliberately ignored.
   */
  private consumeImageSet(syntax: "image-set" | "-webkit-image-set"): readonly CssToken[] {
    const tokens: CssToken[] = [];
    let depth = 0;
    let optionStart = true;
    while (this.index < this.source.length) {
      const character = this.source[this.index]!;
      if (character === "/" && this.source[this.index + 1] === "*") {
        this.consumeComment();
        continue;
      }
      if (isWhitespace(character)) {
        this.index += 1;
        continue;
      }
      if (character === ")") {
        this.index += 1;
        if (depth === 0) return tokens;
        depth -= 1;
        continue;
      }
      if (character === "," && depth === 0) {
        this.index += 1;
        optionStart = true;
        continue;
      }
      if (character === "\"" || character === "'") {
        const value = this.consumeString(character);
        if (depth === 0 && optionStart && value !== null) {
          tokens.push({ kind: "asset-address", value, syntax });
          optionStart = false;
        }
        continue;
      }
      if (this.startsIdentSequence(this.index)) {
        const functionName = this.consumeIdentSequence().toLowerCase();
        if (this.source[this.index] === "(") {
          this.index += 1;
          if (functionName === "url") {
            const value = this.consumeUrlFunctionValue();
            if (value !== null) tokens.push({ kind: "url", value });
          } else {
            depth += 1;
          }
          if (depth <= 1 && optionStart) optionStart = false;
        } else if (depth === 0 && optionStart) {
          optionStart = false;
        }
        continue;
      }
      if (depth === 0 && optionStart) optionStart = false;
      this.index += 1;
    }
    return tokens;
  }

  /** The unquoted url token's address, or null when it is a bad-url. */
  private consumeUrlToken(): string | null {
    while (this.index < this.source.length && isWhitespace(this.source[this.index]!)) this.index += 1;
    let value = "";
    while (this.index < this.source.length) {
      const character = this.source[this.index]!;
      if (character === ")") {
        this.index += 1;
        return value;
      }
      if (isWhitespace(character)) {
        while (this.index < this.source.length && isWhitespace(this.source[this.index]!)) this.index += 1;
        if (this.index >= this.source.length) return value;
        if (this.source[this.index] === ")") {
          this.index += 1;
          return value;
        }
        this.consumeBadUrlRemnants();
        return null;
      }
      if (character === "\"" || character === "'" || character === "(" || isNonPrintable(character)) {
        this.consumeBadUrlRemnants();
        return null;
      }
      if (character === "\\") {
        if (this.isValidEscape(this.index)) {
          value += this.consumeEscape();
          continue;
        }
        this.consumeBadUrlRemnants();
        return null;
      }
      value += character;
      this.index += 1;
    }
    return value;
  }

  private consumeBadUrlRemnants(): void {
    while (this.index < this.source.length) {
      if (this.source[this.index] === ")") {
        this.index += 1;
        return;
      }
      if (this.isValidEscape(this.index)) {
        this.consumeEscape();
        continue;
      }
      this.index += 1;
    }
  }
}

/**
 * Yields the at-keyword and url tokens of a stylesheet. Every other token is
 * still tokenized — that is the whole point, a string is skipped as a string
 * and a comment as a comment — it is simply not reported.
 */
export function cssTokens(source: string): Generator<CssToken> {
  return new CssScanner(source).tokens();
}
