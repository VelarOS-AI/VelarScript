/**
 * The two pattern grammars: a binding pattern (`const {a, b} = value`,
 * `const [first, ...rest] = items`) and a `case` pattern, including the literal
 * values a case may test against. Both are recursive, and both re-enter through
 * the host's `withParseDepth` so one budget covers the whole nest.
 */
import type { BindingPattern, Expression, IdentifierExpression, MemberExpression, MatchStatement, TypeReference } from "../ast.ts";
import { CORE_WORDS } from "../core-vocabulary.ts";
import { diagnostic, type Diagnostic } from "../diagnostic.ts";
import { span, type Span } from "../source.ts";
import { type Token, type TokenKind } from "../token.ts";

export interface PatternParserHost {
  advance(): Token;
  check(kind: TokenKind): boolean;
  checkWord(value: string): boolean;
  current(): Token;
  readonly diagnostics: Diagnostic[];
  expect(kind: TokenKind, message: string): Token;
  expectMemberName(message?: string): Token;
  match(kind: TokenKind): boolean;
  matchWord(value: string): boolean;
  numberLiteral(token: Token, negative?: boolean, literalSpan?: Span): Extract<Expression, { kind: "LiteralExpression" }>;
  parseTypeReference(allowTrailingOptional?: boolean): TypeReference;
  peekKind(distance: number): TokenKind;
  previous(): Token;
  reservedWordMessage(noun: string): string | null;
  withParseDepth<T>(parse: () => T): T;
}

export class PatternParser {
  private readonly host: PatternParserHost;

  constructor(host: PatternParserHost) {
    this.host = host;
  }

  parseBindingPattern(): BindingPattern {
    return this.host.withParseDepth(() => this.parseBindingPatternBody());
  }

  private parseBindingPatternBody(): BindingPattern {
    if (this.host.match("identifier")) {
      const name = this.host.previous();
      return { kind: "NameBindingPattern", name: name.value, span: name.span };
    }
    if (this.host.match("leftBrace")) {
      const open = this.host.previous();
      const entries: Extract<BindingPattern, { kind: "ObjectBindingPattern" }>["entries"][number][] = [];
      let rest: Extract<BindingPattern, { kind: "NameBindingPattern" }> | null = null;
      while (!this.host.check("rightBrace") && !this.host.check("eof")) {
        if (this.host.match("ellipsis")) {
          const name = this.host.expect("identifier", "Expected a name after '...'");
          rest = { kind: "NameBindingPattern", name: name.value, span: name.span };
          if (!this.host.check("rightBrace")) this.host.diagnostics.push(diagnostic("VEL2011", "A rest binding must be last", name.span));
          break;
        }
        const property = this.host.expectMemberName("Expected an object binding field name");
        const renamed = this.host.match("colon");
        if (!renamed && property.kind !== "identifier") {
          this.host.diagnostics.push(diagnostic(
            "VEL2011",
            `Keyword-named field '${property.value}' requires ': name' in an object binding pattern`,
            property.span,
          ));
        }
        const pattern = renamed
          ? this.parseBindingPattern()
          : { kind: "NameBindingPattern", name: property.kind === "identifier" ? property.value : "_invalid", span: property.span } satisfies BindingPattern;
        entries.push({ property: property.value, pattern, span: span(property.span.start, pattern.span.end) });
        if (!this.host.match("comma")) break;
      }
      const close = this.host.expect("rightBrace", "Expected '}' after object binding");
      return { kind: "ObjectBindingPattern", entries, rest, span: span(open.span.start, close.span.end) };
    }
    if (this.host.match("leftBracket")) {
      const open = this.host.previous();
      const elements: (BindingPattern | null)[] = [];
      let rest: Extract<BindingPattern, { kind: "NameBindingPattern" }> | null = null;
      while (!this.host.check("rightBracket") && !this.host.check("eof")) {
        if (this.host.match("comma")) {
          elements.push(null);
          continue;
        }
        if (this.host.match("ellipsis")) {
          const name = this.host.expect("identifier", "Expected a name after '...'");
          rest = { kind: "NameBindingPattern", name: name.value, span: name.span };
          if (!this.host.check("rightBracket")) this.host.diagnostics.push(diagnostic("VEL2011", "A rest binding must be last", name.span));
          break;
        }
        elements.push(this.parseBindingPattern());
        if (!this.host.match("comma")) break;
      }
      const close = this.host.expect("rightBracket", "Expected ']' after list binding");
      return { kind: "ListBindingPattern", elements, rest, span: span(open.span.start, close.span.end) };
    }
    const token = this.host.current();
    this.host.diagnostics.push(diagnostic("VEL2011", this.host.reservedWordMessage("binding name") ?? "Expected a binding name or destructuring pattern", token.span));
    this.host.advance();
    return { kind: "NameBindingPattern", name: "_invalid", span: token.span };
  }

  parseMatchPattern(root: boolean): MatchStatement["cases"][number]["pattern"] {
    return this.host.withParseDepth(() => this.parseMatchPatternBody(root));
  }

  private parseMatchPatternBody(root: boolean): MatchStatement["cases"][number]["pattern"] {
    const start = this.host.current().span.start;
    let pattern: MatchStatement["cases"][number]["pattern"];

    if (this.host.match("leftBrace")) {
      const entries: Extract<MatchStatement["cases"][number]["pattern"], { kind: "MatchObjectPattern" }>["entries"][number][] = [];
      let rest: Extract<MatchStatement["cases"][number]["pattern"], { kind: "MatchObjectPattern" }>["rest"] = null;
      while (!this.host.check("rightBrace") && !this.host.check("eof")) {
        if (this.host.match("ellipsis")) {
          const binding = this.host.expect("identifier", "Expected an object rest binding after '...'");
          rest = { name: binding.value, span: binding.span };
          if (this.host.match("comma") && !this.host.check("rightBrace")) {
            this.host.diagnostics.push(diagnostic("VEL2015", "An object rest pattern must be last", this.host.current().span));
          }
          break;
        }
        const property = this.host.expectMemberName("Expected a field name in an object pattern");
        const renamed = this.host.match("colon");
        if (!renamed && property.kind !== "identifier") {
          this.host.diagnostics.push(diagnostic(
            "VEL2015",
            `Keyword-named field '${property.value}' requires ': name' in an object pattern`,
            property.span,
          ));
        }
        const child = renamed
          ? this.parseMatchPattern(false)
          : {
              kind: "MatchCapturePattern" as const,
              binding: { name: property.kind === "identifier" ? property.value : "_invalid", span: property.span },
              span: property.span,
            };
        entries.push({ property: property.value, pattern: child, span: span(property.span.start, child.span.end) });
        if (!this.host.match("comma")) break;
      }
      const close = this.host.expect("rightBrace", "Expected '}' after an object pattern");
      pattern = { kind: "MatchObjectPattern", entries, rest, span: span(start, close.span.end) };
    } else if (this.host.match("leftBracket")) {
      const elements: Extract<MatchStatement["cases"][number]["pattern"], { kind: "MatchListPattern" }>["elements"][number][] = [];
      let rest: Extract<MatchStatement["cases"][number]["pattern"], { kind: "MatchListPattern" }>["rest"] = null;
      while (!this.host.check("rightBracket") && !this.host.check("eof")) {
        if (this.host.match("ellipsis")) {
          const binding = this.host.expect("identifier", "Expected a List rest binding after '...'");
          rest = { name: binding.value, span: binding.span };
          if (this.host.match("comma") && !this.host.check("rightBracket")) {
            this.host.diagnostics.push(diagnostic("VEL2015", "A List rest pattern must be last", this.host.current().span));
          }
          break;
        }
        elements.push(this.parseMatchPattern(false));
        if (!this.host.match("comma")) break;
      }
      const close = this.host.expect("rightBracket", "Expected ']' after a List pattern");
      pattern = { kind: "MatchListPattern", elements, rest, span: span(start, close.span.end) };
    } else if (this.host.check("identifier") && this.host.current().value === "_") {
      const wildcard = this.host.advance();
      pattern = { kind: "MatchWildcardPattern", span: wildcard.span };
    } else if (this.startsMatchValue()) {
      const values: Extract<MatchStatement["cases"][number]["pattern"], { kind: "MatchValuePattern" }>["values"][number][] = [];
      do {
        const value = this.parseMatchValue();
        if (value) values.push(value);
      } while (root && this.host.match("comma") && !this.host.checkWord(CORE_WORDS.as) && !this.host.check("if") && !this.host.check("colon"));
      pattern = {
        kind: "MatchValuePattern",
        values,
        span: span(start, values.at(-1)?.span.end ?? this.host.current().span.start),
      };
    } else if (!root && this.host.check("identifier")) {
      const binding = this.host.advance();
      pattern = {
        kind: "MatchCapturePattern",
        binding: { name: binding.value, span: binding.span },
        span: binding.span,
      };
    } else {
      const type = this.host.parseTypeReference();
      pattern = { kind: "MatchTypePattern", type, span: span(start, type.span.end) };
    }

    // ENM-U3: `case a | b:` reads naturally to authors from either parent
    // language, but alternatives are spelled with a comma; '|' joins types
    // only inside type annotations. One diagnostic, and the alternatives are
    // consumed so the rest of the match parses cleanly.
    if (root && this.host.check("pipe")) {
      this.host.diagnostics.push(diagnostic(
        "VEL2015",
        "Combine match alternatives with a comma — 'case a, b:'; '|' joins types only in type annotations",
        this.host.current().span,
      ));
      while (this.host.match("pipe") && !this.host.check("colon") && !this.host.check("newline") && !this.host.check("eof")) {
        if (this.startsMatchValue()) this.parseMatchValue();
        else this.parseMatchPattern(false);
      }
    }

    if (this.host.matchWord(CORE_WORDS.as)) {
      const binding = this.host.expect("identifier", "Expected a binding name after 'as'");
      pattern = {
        kind: "MatchAsPattern",
        pattern,
        binding: { name: binding.value, span: binding.span },
        span: span(start, binding.span.end),
      };
    }
    return pattern;
  }

  private parseMatchValue(): Extract<MatchStatement["cases"][number]["pattern"], { kind: "MatchValuePattern" }>["values"][number] | null {
    const negative = this.host.match("minus");
    const start = negative ? this.host.previous().span.start : this.host.current().span.start;
    const token = this.host.current();
    if (negative) {
      const number = this.host.expect("number", "A negative match case requires a numeric literal");
      if (!number.value) return null;
      return this.host.numberLiteral(number, true, span(start, number.span.end));
    }
    if (token.kind === "identifier" && this.host.peekKind(1) === "dot") {
      // ENM-U2: a dotted path is a value pattern at any depth — the same rule
      // the father language uses (dotted = value, bare name = binding).
      const object = this.host.advance();
      let expression: Expression = { kind: "IdentifierExpression", name: object.value, span: object.span };
      while (this.host.match("dot")) {
        // ENM-I7: keyword member names follow the member-access grammar, so
        // `case S.null:` parses. `pass` stays out: it is the placeholder line
        // and the one name an enum can never declare (ENM-I8).
        if (this.host.check("pass")) {
          this.host.diagnostics.push(diagnostic(
            "VEL2015",
            "'pass' is the placeholder line, and the one name an enum never declares; no member spells it",
            this.host.current().span,
          ));
          this.host.advance();
          return null;
        }
        const property = this.host.expectMemberName("Expected an enum member after '.'");
        expression = {
          kind: "MemberExpression",
          object: expression,
          property: property.value,
          optional: false,
          span: span(object.span.start, property.span.end),
        };
      }
      return expression as Extract<MatchStatement["cases"][number]["pattern"], { kind: "MatchValuePattern" }>["values"][number];
    }
    this.host.advance();
    switch (token.kind) {
      case "number": return this.host.numberLiteral(token);
      case "string": return { kind: "LiteralExpression", value: token.value, raw: token.value, span: token.span };
      case "true": return { kind: "LiteralExpression", value: true, raw: "true", span: token.span };
      case "false": return { kind: "LiteralExpression", value: false, raw: "false", span: token.span };
      case "null": return { kind: "LiteralExpression", value: null, raw: "null", span: token.span };
      default:
        this.host.diagnostics.push(diagnostic("VEL2015", "Match cases accept literals or qualified enum members", token.span));
        return null;
    }
  }

  private startsMatchValue(): boolean {
    const kind = this.host.current().kind;
    return kind === "minus"
      || kind === "number"
      || kind === "string"
      || kind === "true"
      || kind === "false"
      || kind === "null"
      || (kind === "identifier" && this.host.peekKind(1) === "dot");
  }
}
