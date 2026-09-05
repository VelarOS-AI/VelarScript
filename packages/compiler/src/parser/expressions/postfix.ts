/**
 * What may follow a primary expression: calls with named arguments, member and
 * optional-member access, indexing, and an explicit type-argument list — which
 * is only a type-argument list when the token run between `<` and `>` can be
 * one, since every other `<` is a comparison.
 */
import type { Expression, IdentifierExpression, MemberExpression } from "../../ast.ts";
import { diagnostic, mechanicalFix, recoveredDiagnostic, type Diagnostic } from "../../diagnostic.ts";
import { span } from "../../source.ts";
import { isTypeEvidenceName } from "../../source-names.ts";
import { type Token, type TokenKind } from "../../token.ts";
import { typeArgumentTokenKinds } from "../tokens.ts";

export interface PostfixParserHost {
  advance(): Token;
  check(kind: TokenKind): boolean;
  current(): Token;
  readonly diagnostics: Diagnostic[];
  expect(kind: TokenKind, message: string): Token;
  expectMemberName(message?: string): Token;
  readonly genericCallableNames: ReadonlySet<string>;
  index: number;
  match(kind: TokenKind): boolean;
  parseExpression(minimumPrecedence?: number): Expression;
  parsePrimary(): Expression;
  parseSpreadExpression(): Expression;
  peekKind(distance: number): TokenKind;
  previous(): Token;
  readonly tokens: Token[];
}

export class PostfixParser {
  private readonly host: PostfixParserHost;

  constructor(host: PostfixParserHost) {
    this.host = host;
  }

  parsePostfix(): Expression {
    let expression = this.host.parsePrimary();
    let typeArgumentsRemoved = false;

    while (true) {
      const explicitTypeArgumentsEnd = this.explicitTypeArgumentsEnd(expression);
      if (explicitTypeArgumentsEnd !== null) {
        const start = this.host.current().span.start;
        while (this.host.index <= explicitTypeArgumentsEnd) this.host.advance();
        const name = expression.kind === "IdentifierExpression" ? expression.name
          : expression.kind === "MemberExpression" ? expression.property
            : "function";
        // D85 rule 207: an empty `Set<string>()` has no argument to infer from,
        // so "remove the type arguments" alone would leave the author with
        // code the analyzer rejects. Name where the type belongs instead, and
        // withhold the mechanical fix that would not reach working source.
        const emptyCollection = (name === "Set" || name === "Map")
          && this.host.check("leftParen") && this.host.peekKind(1) === "rightParen";
        this.host.diagnostics.push(recoveredDiagnostic(
          "VEL2031",
          emptyCollection
            ? `Type arguments are inferred at each call site; an empty '${name}()' takes its type from the binding — write 'const values: ${name === "Set" ? "Set<string>" : "Map<string, number>"} = ${name}()'`
            : `Type arguments are inferred at each call site; write '${name}(...)' without '<...>'`,
          span(start, this.host.previous().span.end),
          ...(emptyCollection
            ? []
            : [mechanicalFix(span(start, this.host.previous().span.end), "", "Remove the explicit type arguments")]),
        ));
        typeArgumentsRemoved = true;
        continue;
      }
      // D86 rule 212: a `!` that follows an operand is the required-value
      // unwrap. It binds with the rest of the postfix chain, so `a!.b` unwraps
      // `a` and then reads `b`, and `a.b!` unwraps the field.
      if (this.host.match("bang")) {
        const bang = this.host.previous();
        expression = { kind: "RequiredExpression", value: expression, span: span(expression.span.start, bang.span.end) };
        continue;
      }
      let call = false;
      let optionalCall = false;
      if (this.host.match("leftParen")) {
        call = true;
      } else if (this.host.check("optionalDot") && this.host.peekKind(1) === "leftParen") {
        this.host.advance();
        this.host.advance();
        call = true;
        optionalCall = true;
      }
      if (call) {
        const { arguments_, argumentNames, sawNamed } = this.parseCallArguments();
        const close = this.host.expect("rightParen", "Expected ')' after arguments");
        expression = {
          kind: "CallExpression",
          callee: expression,
          arguments: arguments_,
          ...(sawNamed ? { argumentNames } : {}),
          optional: optionalCall,
          ...(typeArgumentsRemoved ? { typeArgumentsRemoved: true } : {}),
          span: span(expression.span.start, close.span.end),
        };
        typeArgumentsRemoved = false;
        continue;
      }

      if (this.host.check("optionalDot") && this.host.peekKind(1) === "leftBracket") {
        this.host.advance();
        this.host.advance();
        const index = this.host.parseExpression();
        const close = this.host.expect("rightBracket", "Expected ']' after optional index");
        expression = { kind: "IndexExpression", object: expression, index, optional: true, span: span(expression.span.start, close.span.end) };
        continue;
      }

      if (this.host.match("dot") || this.host.match("optionalDot")) {
        const optional = this.host.previous().kind === "optionalDot";
        const property = this.host.expectMemberName();
        expression = { kind: "MemberExpression", object: expression, property: property.value, optional, span: span(expression.span.start, property.span.end) };
        continue;
      }

      if (this.host.match("leftBracket")) {
        const index = this.host.parseExpression();
        const close = this.host.expect("rightBracket", "Expected ']' after index");
        expression = { kind: "IndexExpression", object: expression, index, optional: false, span: span(expression.span.start, close.span.end) };
        continue;
      }

      break;
    }

    return expression;
  }

  /**
   * One call's argument list, read from just after `(` to just before `)`.
   * The two named-argument spellings and the positional-before-named rule are
   * one decision, so they are answered in one place; `sawSpread` never leaves
   * this list because the only rule that reads it is inside it.
   */
  private parseCallArguments(): { readonly arguments_: Expression[]; readonly argumentNames: (string | null)[]; readonly sawNamed: boolean } {
    const arguments_: Expression[] = [];
    const argumentNames: (string | null)[] = [];
    let sawNamed = false;
    let sawSpread = false;
    if (!this.host.check("rightParen")) {
      do {
        if (this.host.check("identifier") && this.host.peekKind(1) === "colon") {
          const name = this.host.advance();
          this.host.advance();
          this.host.diagnostics.push(diagnostic("VEL2024", `Write '=' between the name and value for named argument '${name.value}': ${name.value} = value`, name.span,
            mechanicalFix(this.host.previous().span, "=", "Use '=' for the named argument")));
          if (sawSpread) this.host.diagnostics.push(diagnostic("VEL2024", "Named arguments cannot be combined with a call spread", name.span));
          sawNamed = true;
          argumentNames.push(name.value);
          arguments_.push(this.host.parseExpression());
          this.recoverChainedNamedArgument();
        } else if (this.host.check("identifier") && this.host.peekKind(1) === "assign") {
          const name = this.host.advance();
          this.host.advance();
          if (sawSpread) this.host.diagnostics.push(diagnostic("VEL2024", "Named arguments cannot be combined with a call spread", name.span));
          sawNamed = true;
          argumentNames.push(name.value);
          arguments_.push(this.host.parseExpression());
          this.recoverChainedNamedArgument();
        } else {
          const argument = this.host.parseSpreadExpression();
          if (sawNamed) this.host.diagnostics.push(diagnostic("VEL2024", "Positional arguments must appear before named arguments", argument.span));
          if (argument.kind === "SpreadExpression") sawSpread = true;
          argumentNames.push(null);
          arguments_.push(argument);
        }
      } while (this.host.match("comma") && !this.host.check("rightParen"));
    }
    return { arguments_, argumentNames, sawNamed };
  }

  private explicitTypeArgumentsEnd(expression: Expression): number | null {
    const callableName = expression.kind === "IdentifierExpression" ? expression.name
      : expression.kind === "MemberExpression" ? expression.property
        : null;
    if (callableName === null || !this.host.check("less")) return null;
    // Beyond the same-file generic-name list, the recovery extends to any
    // callee — imported generics and methods — when the angle content carries
    // type evidence: a builtin type name, a capitalized name, optional or
    // union syntax, or nested generics. Without that evidence the comparison
    // reading wins, so `a<b>(c)` over three numbers stays a chain (rule #41).
    //
    // D90: the reading does not depend on the spacing around `<` and `>`, so a
    // formatter pass that adds or removes a space can never move a line
    // between the two grammars — `Map < string, number > ()` earns the same
    // teaching diagnostic as `Map<string, number>()`. What stands in for the
    // adjacency is grammar evidence, on two axes. Every token inside the
    // angles must be one a type argument list can contain, so
    // `a < Limit and g > (c)` stays the pair of comparisons it is. And every
    // argument of a `,`-separated list must carry evidence of its own, so
    // `two(a < Limit, g > (c))` stays two ordinary arguments — a program that
    // works — while `mapValues<string, bool>([1])` is still claimed.
    const knownGeneric = this.host.genericCallableNames.has(callableName);
    const typeEvidence = (token: Token): boolean => {
      if (token.kind === "question" || token.kind === "pipe" || token.kind === "arrow") return true;
      return token.kind === "identifier" && isTypeEvidenceName(token.value);
    };
    let everyArgumentIsTyped = true;
    let argumentIsTyped = false;
    let depth = 0;
    for (let index = this.host.index; index < this.host.tokens.length; index += 1) {
      const token = this.host.tokens[index]!;
      if (token.kind === "newline" || token.kind === "eof") return null;
      if (token.kind === "less") {
        depth += 1;
        if (depth >= 2) argumentIsTyped = true;
      } else if (token.kind === "greater") {
        depth -= 1;
        if (depth === 0) {
          if (this.host.tokens[index + 1]?.kind !== "leftParen") return null;
          return knownGeneric || (everyArgumentIsTyped && argumentIsTyped) ? index : null;
        }
      } else if (!typeArgumentTokenKinds.has(token.kind)) {
        return null;
      } else if (token.kind === "comma" && depth === 1) {
        everyArgumentIsTyped &&= argumentIsTyped;
        argumentIsTyped = false;
      } else if (typeEvidence(token)) {
        argumentIsTyped = true;
      }
    }
    return null;
  }

  // GRM-T1: `f(x=y=2)` chains a second '=' after the named value; the whole
  // chain is consumed under one diagnostic so ')' recovery does not cascade.
  private recoverChainedNamedArgument(): void {
    while (this.host.check("assign")) {
      this.host.diagnostics.push(diagnostic("VEL2024", "A named argument takes one value; remove the extra '='", this.host.current().span));
      this.host.advance();
      this.host.parseExpression();
    }
  }
}
