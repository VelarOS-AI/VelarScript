/**
 * The leaves of the expression grammar: literals, names, collection and record
 * literals, parenthesized expressions, spreads, and f-strings — whose
 * interpolations re-enter the compiler through the parser's own nested-parse
 * seam, so a fragment is lexed and parsed with the same extensions.
 */
import type { BinaryExpression, ComparisonChainExpression, Expression, FStringPart, IdentifierExpression, ObjectProperty } from "../../ast.ts";
import { diagnostic, type Diagnostic } from "../../diagnostic.ts";
import { findInterpolatedExpressionEnd, scanStringEscape, scanStringLiteral, type StringTokenPayload } from "../../interpolated-string.ts";
import { span, type Span } from "../../source.ts";
import { type Token, type TokenKind } from "../../token.ts";
import { memberNameKinds, writtenNumber } from "../tokens.ts";

export interface PrimaryParserHost {
  advance(): Token;
  check(kind: TokenKind): boolean;
  readonly contextualKeywords: ReadonlySet<string>;
  current(): Token;
  readonly diagnostics: Diagnostic[];
  expect(kind: TokenKind, message: string): Token;
  index: number;
  match(kind: TokenKind): boolean;
  parseExpression(minimumPrecedence?: number): Expression;
  parseExtensionExpression(_token: Token): Expression | undefined;
  parseExtensionNumericLiteral(token: Token, value: number, unit: string): Expression | undefined;
  parseNestedExpression(
    fragment: string,
    offset: number,
    bracketFragment?: boolean,
    sourceOffsets?: readonly number[]): Expression;
  peekKind(distance: number): TokenKind;
  previous(): Token;
  reservedWordMessageFor(token: Token, noun: string): string | null;
  skipMistypedDeclaration(): void;
  synchronize(): void;
  readonly tokens: Token[];
}

export class PrimaryParser {
  private readonly host: PrimaryParserHost;

  constructor(host: PrimaryParserHost) {
    this.host = host;
  }

  parsePrimary(): Expression {
    const token = this.host.advance();
    switch (token.kind) {
      case "number":
        return this.numberLiteral(token);
      case "unitNumber": {
        const match = /^(\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)([A-Za-z%]+)$/u.exec(token.value);
        if (!match) {
          this.host.diagnostics.push(diagnostic("VEL2002", "Invalid unit literal", token.span));
          return { kind: "LiteralExpression", value: 0, raw: "0", span: token.span };
        }
        const value = Number(match[1]);
        const exact = Number.isFinite(value) && this.checkExactIntegerLiteral(match[1]!, writtenNumber(token).slice(0, -match[2]!.length), token.span);
        if (!Number.isFinite(value)) this.host.diagnostics.push(diagnostic("VEL2017", "Numeric literals must be finite", token.span));
        const extensionExpression = this.host.parseExtensionNumericLiteral(
          token,
          exact ? value : 0,
          match[2]!,
        );
        if (extensionExpression) return extensionExpression;
        this.host.diagnostics.push(diagnostic("VEL2002", `No compiler extension accepts numeric suffix '${match[2]}'`, token.span));
        return { kind: "LiteralExpression", value: 0, raw: "0", span: token.span };
      }
      case "string":
        return { kind: "LiteralExpression", value: token.value, raw: token.value, span: token.span };
      case "import": {
        this.host.expect("leftParen", "Expected '(' after 'import'");
        const source = this.host.expect("string", "Dynamic imports require a literal relative .vel path");
        const close = this.host.expect("rightParen", "Expected ')' after dynamic import path");
        if ((!source.value.startsWith("./") && !source.value.startsWith("../")) || !source.value.endsWith(".vel")) {
          this.host.diagnostics.push(diagnostic(
            "VEL2014",
            "Dynamic imports require a literal relative path ending in '.vel'",
            source.span,
          ));
        }
        return {
          kind: "DynamicImportExpression",
          source: source.value,
          sourceSpan: source.span,
          span: span(token.span.start, close.span.end),
        };
      }
      case "fstring":
        return this.parseFString(token);
      case "extensionToken": {
        const extensionExpression = this.host.parseExtensionExpression(token);
        if (extensionExpression) return extensionExpression;
        this.host.diagnostics.push(diagnostic("VEL2002", "No compiler extension accepts this embedded expression", token.span));
        return { kind: "LiteralExpression", value: null, raw: "null", span: token.span };
      }
      case "true":
        return { kind: "LiteralExpression", value: true, raw: token.value, span: token.span };
      case "false":
        return { kind: "LiteralExpression", value: false, raw: token.value, span: token.span };
      case "null":
        return { kind: "LiteralExpression", value: null, raw: token.value, span: token.span };
      case "identifier":
        return this.parseIdentifierPrimary(token);
      case "super":
        return { kind: "SuperExpression", span: token.span };
      case "leftParen": {
        const expression = this.host.parseExpression();
        this.host.expect("rightParen", "Expected ')' after expression");
        // Explicit parentheses are the author's grouping decision. Binary
        // nodes carry that fact so the '??' / 'and' / 'or' mixing rule can
        // tell a deliberate grouping from a bare chain.
        return expression.kind === "BinaryExpression" || expression.kind === "ComparisonChainExpression" || expression.kind === "IsExpression"
          ? { ...expression, parenthesized: true }
          : expression;
      }
      case "leftBracket": {
        const elements: Expression[] = [];
        if (!this.host.check("rightBracket")) {
          do {
            elements.push(this.parseSpreadExpression());
          } while (this.host.match("comma") && !this.host.check("rightBracket"));
        }
        const close = this.host.expect("rightBracket", "Expected ']' after list elements");
        return { kind: "ListExpression", elements, span: span(token.span.start, close.span.end) };
      }
      case "leftBrace":
        return this.parseRecordLiteral(token);
      default:
        return this.parseUnexpectedPrimary(token);
    }
  }

  /**
   * A bare name — or the extension expression an installed target claims that
   * name for, and the three refusals a name in value position can earn.
   */
  private parseIdentifierPrimary(token: Token): Expression {
    // An extension's contextual keyword is an ordinary name until its own
    // parser recognizes the shape it owns; only then does the extension
    // expression win over the identifier reading.
    if (this.host.contextualKeywords.has(token.value)) {
      const extensionExpression = this.host.parseExtensionExpression(token);
      if (extensionExpression) return extensionExpression;
    }
    // A block-valued Web word reaching Core means the extension is not
    // active: the module was moved, or velar.json is missing the entry. One
    // message names the cause instead of a statement-boundary cascade.
    if ((token.value === "keyframes" || token.value === "look") && this.host.check("colon") && this.host.peekKind(1) === "newline") {
      this.host.diagnostics.push(diagnostic(
        "VEL2035",
        `'${token.value}:' belongs to @velarscript/web; add "@velarscript/web" to velar.json extensions, or move this module into a Web project`,
        token.span,
      ));
      this.host.skipMistypedDeclaration();
      return { kind: "LiteralExpression", value: null, raw: "null", span: token.span };
    }
    if (token.value === "function" && (this.host.check("leftParen") || (this.host.check("identifier") && this.host.peekKind(1) === "leftParen"))) {
      this.host.diagnostics.push(diagnostic(
        "VEL2031",
        "VelarScript has no 'function' expressions; declare 'def name(...)' or write an arrow '(x) => value'",
        token.span,
      ));
      this.host.synchronize();
      return { kind: "LiteralExpression", value: null, raw: "null", span: token.span };
    }
    return { kind: "IdentifierExpression", name: token.value, span: token.span };
  }

  /**
   * A record literal `{name: value, ...spread, shorthand}`.
   */
  private parseRecordLiteral(token: Token): Expression {
    const properties: Extract<Expression, { kind: "ObjectExpression" }>["properties"][number][] = [];
    if (!this.host.check("rightBrace")) {
      do {
        if (this.host.match("ellipsis")) {
          const spread = this.host.previous();
          const value = this.host.parseExpression();
          properties.push({ kind: "ObjectSpread", value, span: span(spread.span.start, value.span.end) });
          continue;
        }
        const name = memberNameKinds.has(this.host.current().kind) || this.host.check("string")
          ? this.host.advance()
          : this.host.expect("identifier", "Expected an object field name");
        const hasValue = this.host.match("colon");
        if (!hasValue && name.kind !== "identifier") {
          // D30 item 16 retired this teaching for the softened words; what
          // remains are the hard keywords and quoted names, and a hard
          // keyword is named so the reader knows why the shorthand cannot
          // reach a binding of that spelling.
          this.host.diagnostics.push(diagnostic("VEL2020", name.kind === "string"
            ? "A quoted object field requires ':' and a value"
            : `'${name.value}' is a VelarScript keyword, so no binding spells it; write '${name.value}: value'`, name.span));
        }
        const valueStart = this.host.current();
        const value = hasValue
          ? this.host.parseExpression()
          : name.kind === "identifier"
            ? { kind: "IdentifierExpression", name: name.value, span: name.span } satisfies IdentifierExpression
            : { kind: "LiteralExpression", value: null, raw: "null", span: name.span } satisfies Expression;
        const sameNameIdentifierValue = hasValue
          && name.kind === "identifier"
          && valueStart.kind === "identifier"
          && value.kind === "IdentifierExpression"
          && value.name === name.value
          && value.span.start === valueStart.span.start
          && value.span.end === valueStart.span.end;
        properties.push({
          kind: "ObjectProperty",
          name: name.value,
          value,
          ...(hasValue ? {} : { shorthand: true }),
          ...(sameNameIdentifierValue ? { sameNameIdentifierValue: true } : {}),
          span: span(name.span.start, value.span.end),
        });
      } while (this.host.match("comma") && !this.host.check("rightBrace"));
    }
    const close = this.host.expect("rightBrace", "Expected '}' after object fields");
    return { kind: "ObjectExpression", properties, span: span(token.span.start, close.span.end) };
  }

  /**
   * A token that begins no expression. Each shape that reaches here is a
   * mistake the parser can name — an orphan indented block, a statement
   * keyword in value position, a reserved word — so it is answered rather
   * than left to a bare "Expected an expression".
   */
  private parseUnexpectedPrimary(token: Token): Expression {
    if (token.kind === "indent") {
      // GRM-A5's sibling shape: a line indented under a complete
      // statement continues nothing. One diagnostic owns the whole
      // orphan block so its lines do not cascade.
      this.host.diagnostics.push(diagnostic(
        "VEL2002",
        "A statement ends at its newline; this indented line continues nothing — parenthesize an expression to span lines, or align the line with its block",
        token.span,
      ));
      let blocks = 1;
      while (blocks > 0 && !this.host.check("eof")) {
        if (this.host.check("indent")) blocks += 1;
        else if (this.host.check("dedent")) blocks -= 1;
        this.host.advance();
      }
      return { kind: "LiteralExpression", value: null, raw: "null", span: token.span };
    }
    if (token.kind === "newline" || token.kind === "dedent" || token.kind === "eof") {
      // GRM-A5: an operator dangling at the line end leaves the parser at
      // the statement boundary. GRM-D2's postfix shape lands here too
      // (`i++` parses as `i + +<nothing>`), so it gets its own teaching.
      const beforeBoundary = this.host.tokens[this.host.index - 2];
      const stacked = this.host.tokens[this.host.index - 3];
      const increment = beforeBoundary && stacked
        && beforeBoundary.kind === stacked.kind
        && (beforeBoundary.kind === "plus" || beforeBoundary.kind === "minus")
        && stacked.span.end === beforeBoundary.span.start;
      if (increment) {
        const operator = beforeBoundary.kind === "plus" ? "+" : "-";
        const target = this.host.tokens[this.host.index - 4];
        const name = target?.kind === "identifier" ? target.value : "name";
        this.host.diagnostics.push(diagnostic(
          "VEL2031",
          `VelarScript has no '${operator}${operator}'; write '${name} ${operator}= 1'`,
          span(stacked.span.start, beforeBoundary.span.end),
        ));
      } else {
        this.host.diagnostics.push(diagnostic(
          "VEL2002",
          "A statement ends at its newline; parenthesize the expression to continue it across lines",
          token.span,
        ));
      }
      if (token.kind === "newline") {
        // A continuation line indented under the broken statement would
        // cascade line by line; it belongs to this one error, so its
        // whole block is consumed here.
        let ahead = 0;
        while (this.host.peekKind(ahead) === "newline") ahead += 1;
        if (this.host.peekKind(ahead) === "indent") {
          while (ahead > 0) {
            this.host.advance();
            ahead -= 1;
          }
          this.host.advance();
          let blocks = 1;
          while (blocks > 0 && !this.host.check("eof")) {
            if (this.host.check("indent")) blocks += 1;
            else if (this.host.check("dedent")) blocks -= 1;
            this.host.advance();
          }
        } else {
          this.host.index -= 1;
        }
      } else if (token.kind === "dedent") {
        this.host.index -= 1;
      }
      return { kind: "LiteralExpression", value: null, raw: "null", span: token.span };
    }
    // `@name` is resolved only by a compiler-owned syntax context. Here it
    // cannot become an expression or runtime value, so name the namespace
    // rule instead of reporting a bare 'Expected an expression'.
    if (token.kind === "at") {
      const name = this.host.check("identifier") ? this.host.advance().value : "";
      this.host.diagnostics.push(diagnostic(
        "VEL2002",
        `'@${name}' is a compiler-owned contextual name and is not valid here; use it only in a context that defines it, such as a component's '@mounted:' block`,
        span(token.span.start, this.host.previous().span.end),
      ));
      this.host.skipMistypedDeclaration();
      return { kind: "LiteralExpression", value: null, raw: "null", span: token.span };
    }
    // A hard-reserved word standing where a value belongs is the same
    // mistake as one standing in a name position, so it gets the same
    // named message rather than a bare "Expected an expression".
    this.host.diagnostics.push(diagnostic("VEL2002", this.host.reservedWordMessageFor(token, "name") ?? "Expected an expression", token.span));
    return { kind: "LiteralExpression", value: null, raw: "null", span: token.span };
  }

  parseSpreadExpression(): Expression {
    if (!this.host.match("ellipsis")) return this.host.parseExpression();
    const start = this.host.previous().span.start;
    const value = this.host.parseExpression();
    return { kind: "SpreadExpression", value, span: span(start, value.span.end) };
  }

  private parseFString(token: Token): Expression {
    const payload = token.payload as StringTokenPayload | undefined;
    const raw = payload?.raw ?? false;
    const contentOffset = (payload?.prefixLength ?? 1) + 1 + (payload?.layout ? 1 : 0);
    const sourceOffset = (index: number): number => payload?.contentOffsets?.[index] ?? token.span.start + contentOffset + index;
    const parts: FStringPart[] = [];
    let textStart = 0;
    let index = 0;

    while (index < token.value.length) {
      if (!raw && token.value[index] === "\\") {
        index = scanStringEscape(token.value, index).end;
        continue;
      }
      if (token.value[index] === "$" && token.value[index + 1] === "{") {
        const close = token.value.indexOf("}", index + 2);
        index = close < 0 ? index + 2 : close + 1;
        continue;
      }
      if (token.value[index] === "{" && token.value[index + 1] === "{") {
        index += 2;
        continue;
      }
      if (token.value[index] === "}" && token.value[index + 1] === "}") {
        index += 2;
        continue;
      }
      if (token.value[index] === "}") {
        const offset = sourceOffset(index);
        this.host.diagnostics.push(diagnostic("VEL2009", "Unmatched '}' in interpolated string", span(offset, offset + 1)));
        index += 1;
        continue;
      }
      if (token.value[index] !== "{") {
        index += 1;
        continue;
      }

      if (index > textStart) {
        parts.push({ kind: "text", value: this.decodeFStringText(token.value.slice(textStart, index), payload) });
      }

      const close = findInterpolatedExpressionEnd(token.value, index + 1);
      if (close < 0) {
        const offset = sourceOffset(index);
        this.host.diagnostics.push(diagnostic("VEL2009", "Unclosed expression in interpolated string", span(offset, token.span.end)));
        parts.push({ kind: "text", value: this.decodeFStringText(token.value.slice(index), payload) });
        textStart = token.value.length;
        break;
      }

      const rawFragment = token.value.slice(index + 1, close);
      let fragment = rawFragment.trim();
      const leadingWhitespace = rawFragment.length - rawFragment.trimStart().length;
      const fragmentStart = index + 1 + leadingWhitespace;
      // TXT-I2: a top-level ':' in an interpolation is the Python
      // format-spec habit (f"{x:.2f}"). One directed diagnostic teaches the
      // real spelling, and only the value expression is parsed, so the spec
      // text never cascades into numeric-unit noise.
      const specColon = this.interpolationFormatSpecColon(fragment);
      if (specColon !== null) {
        const colonOffset = sourceOffset(fragmentStart + specColon);
        this.host.diagnostics.push(diagnostic(
          "VEL2009",
          "An interpolation holds one expression; VelarScript has no ':' format specs. Format the value first — value.toFixed(2) for fixed decimals, str(value).padStart(size) for width",
          span(colonOffset, sourceOffset(close)),
        ));
        fragment = fragment.slice(0, specColon).trimEnd();
      }
      const offset = sourceOffset(fragmentStart);
      const fragmentOffsets = payload?.contentOffsets?.slice(fragmentStart, fragmentStart + fragment.length + 1);
      parts.push({ kind: "expression", value: this.host.parseNestedExpression(fragment, offset, false, fragmentOffsets) });
      index = close + 1;
      textStart = index;
    }

    if (textStart < token.value.length) {
      parts.push({ kind: "text", value: this.decodeFStringText(token.value.slice(textStart), payload) });
    }

    return { kind: "FStringExpression", parts, span: token.span };
  }

  numberLiteral(token: Token, negative = false, literalSpan: Span = token.span): Extract<Expression, { kind: "LiteralExpression" }> {
    const value = Number(token.value) * (negative ? -1 : 1);
    const exact = Number.isFinite(value) && this.checkExactIntegerLiteral(token.value, writtenNumber(token), literalSpan, negative);
    if (!Number.isFinite(value)) this.host.diagnostics.push(diagnostic("VEL2017", "Numeric literals must be finite", literalSpan));
    return {
      kind: "LiteralExpression",
      value: exact ? value : 0,
      raw: `${negative ? "-" : ""}${token.value}`,
      span: literalSpan,
    };
  }

  /**
   * D90 R6: an integer literal whose value cannot be held exactly is rejected
   * rather than rounded, so `9007199254740993` is an error instead of silently
   * becoming `9007199254740992`. Only a literal *written* as an integer is one
   * here: a fraction part or an exponent spells a decimal value, which keeps
   * the ordinary nearest-value reading. An explicit radix takes the same test,
   * because a hex literal is written precisely when the exact bit pattern is
   * the point.
   *
   * The report quotes the author's own spelling — the token carries it when the
   * two differ — so a source line reading `1_000_000_000_000_000_000_1` is
   * quoted with its separators rather than as the normalized digits the value
   * was read from.
   */
  checkExactIntegerLiteral(text: string, written: string, literalSpan: Span, negative = false): boolean {
    if (!/^(?:[0-9]+|0[xXbBoO][0-9a-fA-F]+)$/u.test(text)) return true;
    const rounded = Number(text);
    if (BigInt(text) === BigInt(rounded)) return true;
    const sign = negative ? "-" : "";
    this.host.diagnostics.push(diagnostic(
      "VEL2017",
      `Numeric literals must be exactly representable; '${sign}${written}' becomes ${sign}${rounded}`,
      literalSpan,
    ));
    return false;
  }

  // TXT-I2: the offset of a top-level ':' in an interpolation fragment, or
  // null. Ternary colons are consumed by their pending '?', bracket and
  // string contents never count, and '?.'/'??' are not ternary heads — so
  // the only ':' that survives to depth zero is a format spec.
  private interpolationFormatSpecColon(fragment: string): number | null {
    let depth = 0;
    let pendingTernary = 0;
    for (let index = 0; index < fragment.length; index += 1) {
      const literal = scanStringLiteral(fragment, index);
      if (literal) {
        if (!literal.closed) return null;
        index = literal.end - 1;
        continue;
      }
      const character = fragment[index]!;
      if (character === "(" || character === "[" || character === "{") depth += 1;
      else if (character === ")" || character === "]" || character === "}") depth -= 1;
      else if (character === "?" && depth === 0) {
        const next = fragment[index + 1];
        if (next === "." || next === "?") index += 1;
        else pendingTernary += 1;
      } else if (character === ":" && depth === 0) {
        if (pendingTernary > 0) pendingTernary -= 1;
        else return index;
      }
    }
    return null;
  }

  private decodeFStringText(value: string, payload: StringTokenPayload | undefined): string {
    const raw = payload?.raw ?? false;
    const quote = payload?.quote ?? '"';
    let decoded = "";
    for (let index = 0; index < value.length; index += 1) {
      const character = value[index]!;
      const next = value[index + 1];
      if (raw && !payload?.layout && character === quote && next === quote) {
        decoded += quote;
        index += 1;
      } else if (!raw && character === "\\" && next !== undefined) {
        const escaped = scanStringEscape(value, index);
        decoded += escaped.value ?? next;
        index = escaped.end - 1;
      } else if ((character === "{" && next === "{") || (character === "}" && next === "}")) {
        decoded += character;
        index += 1;
      } else {
        decoded += character;
      }
    }
    return decoded;
  }
}
