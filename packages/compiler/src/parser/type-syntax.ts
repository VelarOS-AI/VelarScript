/**
 * Written type syntax: `List<T?>`, `(a: A) -> B`, `Name.Member`, and the
 * optional suffix, plus the two refusals the type position owns — the retired
 * `Function` shorthand and a `=>` written where `->` belongs.
 *
 * The `>` problem lives here as well: a generic close that runs into the next
 * operator lexes as one token, so `checkTypeGreater`/`expectTypeGreater` on the
 * host split it, and every nested reference goes back through the parser's own
 * `parseTypeReference` so the depth budget is charged once per level.
 */
import type { TypeNameSegment, TypeReference, TypeSyntax } from "../ast.ts";
import { CORE_WORDS } from "../core-vocabulary.ts";
import { diagnostic, mechanicalEdits, mechanicalFix, recoveredDiagnostic, type Diagnostic } from "../diagnostic.ts";
import { sourceTypeNameGuidance } from "../language-guidance.ts";
import { span, type Span } from "../source.ts";
import { type Token, type TokenKind } from "../token.ts";
import { formatTypeSyntax } from "../types.ts";

export interface TypeSyntaxParserHost {
  advance(): Token;
  check(kind: TokenKind): boolean;
  checkTypeGreater(): boolean;
  checkWord(value: string): boolean;
  current(): Token;
  readonly diagnostics: Diagnostic[];
  expect(kind: TokenKind, message: string): Token;
  expectTypeGreater(message: string): Token;
  index: number;
  match(kind: TokenKind): boolean;
  parseTypeReference(allowTrailingOptional?: boolean): TypeReference;
  peekKind(distance: number): TokenKind;
  previous(): Token;
  readonly tokens: Token[];
  validateExtensionTypeArguments(_name: string, _arguments: readonly TypeSyntax[], _nameSpan: Span): boolean;
}

export class TypeSyntaxParser {
  private readonly host: TypeSyntaxParserHost;

  constructor(host: TypeSyntaxParserHost) {
    this.host = host;
  }

  parseTypeReferenceBody(allowTrailingOptional: boolean): TypeReference {
    const start = this.host.current().span.start;
    const members: TypeSyntax[] = [this.parseSingleTypeReference(allowTrailingOptional)];
    while (this.host.match("pipe")) {
      members.push(this.parseSingleTypeReference(allowTrailingOptional));
    }
    const referenceSpan = span(start, this.host.previous().span.end);
    return {
      syntax: members.length === 1 ? members[0]! : { kind: "UnionTypeSyntax", members, span: referenceSpan },
      span: referenceSpan,
    };
  }

  private parseSingleTypeReference(allowTrailingOptional = true): TypeSyntax {
    const wrapped = this.parseWrappedTypeSyntax(allowTrailingOptional);
    if (wrapped !== null) return wrapped;
    const functionType = this.parseFunctionTypeSyntax();
    if (functionType !== null) return functionType;
    const name = this.host.check("null") ? this.host.advance() : this.host.expect("identifier", "Expected a type name");
    const nameGuidance = sourceTypeNameGuidance(name.value);
    if (nameGuidance) {
      // A guidance spelling with a replacement recovers as the guided type
      // name so semantic analysis still runs and reports its own guidance.
      this.host.diagnostics.push(nameGuidance.replacement && nameGuidance.title
        ? recoveredDiagnostic("VEL2012", nameGuidance.message, name.span,
          mechanicalFix(name.span, nameGuidance.replacement, nameGuidance.title))
        : diagnostic("VEL2012", nameGuidance.message, name.span));
    }
    const typeName = nameGuidance?.replacement ?? name.value;
    /**
     * A dotted path — the enum singleton `Status.pending`, the
     * namespace-qualified `library.Box` — is a type reference head exactly as a
     * bare name is, so it falls into the one argument-list grammar below rather
     * than returning ahead of it. The two spellings used to disagree about
     * whether `<` may follow: `Box<string>` parsed and `library.Box<string>`
     * ended the statement at the `<`, so a namespace-qualified generic answered
     * with three recovery messages where its bare-name sibling earns one
     * refusal.
     */
    const segments: TypeNameSegment[] = [];
    while (this.host.match("dot")) {
      const segment = this.host.expect("identifier", "Expected an enum member after '.' in a singleton type");
      segments.push({ name: segment.value, span: segment.span });
    }
    const { member, pathSpan, pathText, memberPath } = this.typeNamePath(name, typeName, segments);
    let syntax: TypeSyntax = member
      ? memberPath(null, pathSpan)
      : { kind: "NamedTypeSyntax", name: typeName, span: name.span };
    const angleArguments = this.host.match("less");
    const squareArguments = !angleArguments && this.host.match("leftBracket");
    if (angleArguments || squareArguments) {
      const open = this.host.previous();
      const closeKind = squareArguments ? "rightBracket" : "greater";
      const arguments_: TypeSyntax[] = [];
      if (!(squareArguments ? this.host.check(closeKind) : this.host.checkTypeGreater())) {
        do {
          arguments_.push(this.host.parseTypeReference().syntax);
        } while (this.host.match("comma") && !(squareArguments ? this.host.check(closeKind) : this.host.checkTypeGreater()));
      }
      const close = squareArguments
        ? this.host.expect(closeKind, "Expected ']' after type arguments")
        : this.host.expectTypeGreater("Expected '>' after type arguments");
      if (squareArguments && arguments_.length === 0) {
        // A postfix 'Name[]' array annotation guides straight to the List
        // spelling and recovers as 'List<Name>'.
        this.host.diagnostics.push(recoveredDiagnostic(
          "VEL2012",
          `Use 'List<${pathText}>' for ordered collections; VelarScript has no postfix '[]' array types`,
          span(pathSpan.start, close.span.end),
          mechanicalFix(span(pathSpan.start, close.span.end), `List<${pathText}>`, `Use 'List<${pathText}>'`),
        ));
        return this.finishTypeReferenceSuffix({
          kind: "GenericTypeSyntax",
          name: "List",
          nameSpan: pathSpan,
          arguments: [member ? syntax : this.retiredFunctionShorthand(syntax, null, syntax.span) ?? syntax],
          span: span(pathSpan.start, close.span.end),
        }, allowTrailingOptional);
      }
      if (squareArguments) {
        this.host.diagnostics.push(recoveredDiagnostic("VEL2012", "Generic type arguments use '<...>', not '[...]'", span(open.span.start, close.span.end),
          // Brackets that follow a real type name are that name's arguments;
          // a bare '[...]' is some other mistake and names no rewrite.
          name.value === ""
            ? undefined
            : mechanicalEdits([{ span: open.span, text: "<" }, { span: close.span, text: ">" }], "Use angle brackets for generic type arguments")));
      }
      const wholeSpan = span(pathSpan.start, close.span.end);
      if (member) {
        // A dotted path is never a Core built-in, an extension family, or the
        // retired `Function` shorthand — every one of those is a bare name — so
        // the arity and retirement questions below belong to that spelling
        // alone. What the arguments mean here is the analyzer's to answer, and
        // it answers with one refusal for the whole path.
        syntax = memberPath(arguments_, wholeSpan);
        return this.finishTypeReferenceSuffix(syntax, allowTrailingOptional);
      }
      const expectedArguments = typeName === "Map" ? 2 : typeName === "List" || typeName === "Set" || typeName === "Record" || typeName === "Promise" || typeName === "Type" ? 1 : null;
      if (this.host.validateExtensionTypeArguments(typeName, arguments_, name.span)) {
        // The owning extension validates its own generic surface.
      } else if (typeName === "Function" && arguments_.length === 0) {
        // D114 ③: the empty argument list is an invalid form rather than the
        // retired shorthand, so it names the arrow spelling without offering
        // a rewrite of text the author never finished writing.
        this.host.diagnostics.push(diagnostic("VEL2012", "'Function<>' names no type; a function type is written as an arrow — '() -> null' takes no input and answers null", name.span));
      } else if (expectedArguments !== null && arguments_.length !== expectedArguments) {
        this.host.diagnostics.push(diagnostic("VEL2012", `Type '${typeName}' expects ${expectedArguments} type argument${expectedArguments === 1 ? "" : "s"}`, name.span));
      }
      syntax = { kind: "GenericTypeSyntax", name: typeName, nameSpan: name.span, arguments: arguments_, span: wholeSpan };
      if (typeName === "Function" && arguments_.length === 0) {
        // The invalid form above already named '() -> null'; recovering as it
        // keeps the rest of the annotation analyzable without a second report.
        syntax = { kind: "FunctionTypeSyntax", parameters: [], result: { kind: "NamedTypeSyntax", name: "null", span: wholeSpan }, span: wholeSpan };
      } else {
        syntax = this.retiredFunctionShorthand(syntax, arguments_, wholeSpan) ?? syntax;
      }
    }
    // The bare name, reached only when no argument list followed it.
    if (!angleArguments && !squareArguments && !member) {
      syntax = this.retiredFunctionShorthand(syntax, null, syntax.span) ?? syntax;
    }
    return this.finishTypeReferenceSuffix(syntax, allowTrailingOptional);
  }

  /**
   * The two type syntaxes that wrap another one: the `readonly` view modifier,
   * and a parenthesized group. `null` means neither opened here — including a
   * `(` that opens a function type's parameter list, which the next form owns.
   */
  private parseWrappedTypeSyntax(allowTrailingOptional: boolean): TypeSyntax | null {
    if (this.host.checkWord(CORE_WORDS.readonly)) {
      const keyword = this.host.advance();
      const inner = this.parseSingleTypeReference(allowTrailingOptional);
      return { kind: "ReadonlyTypeSyntax", inner, span: span(keyword.span.start, inner.span.end) };
    }
    if (this.host.check("leftParen") && !this.isFunctionTypeParenthesis()) {
      const open = this.host.advance();
      const grouped = this.host.parseTypeReference();
      const close = this.host.expect("rightParen", "Expected ')' after grouped type");
      if (!allowTrailingOptional || !this.host.match("question")) return grouped.syntax;
      return this.makeOptionalTypeSyntax(grouped.syntax, span(open.span.start, this.host.previous().span.end));
    }
    return null;
  }

  /**
   * A function type — `(name: T, ...rest: R) -> U`. Its parameter list is the
   * one place a type position takes names, optionality and a rest element, so
   * the three rules that order them are answered here. `null` means the next
   * token did not open one.
   */
  private parseFunctionTypeSyntax(): TypeSyntax | null {
    if (this.host.match("leftParen")) {
      const open = this.host.previous();
      const parameters: Extract<TypeSyntax, { kind: "FunctionTypeSyntax" }>["parameters"][number][] = [];
      let sawRest = false;
      let sawOptional = false;
      if (!this.host.check("rightParen")) {
        do {
          const parameterStart = this.host.current().span.start;
          const rest = this.host.match("ellipsis");
          if (sawRest) this.host.diagnostics.push(diagnostic("VEL2016", "A rest function type parameter must be final", this.host.current().span));
          const named = this.host.check("identifier")
            && (this.host.peekKind(1) === "colon" || (this.host.peekKind(1) === "question" && this.host.peekKind(2) === "colon"));
          const parameterName = named ? this.host.advance().value : null;
          const optional = parameterName !== null && this.host.match("question");
          if (parameterName) this.host.expect("colon", "Expected ':' after a function type parameter name");
          const type = this.host.parseTypeReference();
          if (rest && optional) this.host.diagnostics.push(diagnostic("VEL2016", "A rest function type parameter cannot be optional", span(parameterStart, type.span.end)));
          if (!optional && sawOptional && !rest) {
            this.host.diagnostics.push(diagnostic("VEL2016", "A required function type parameter cannot follow an optional parameter", span(parameterStart, type.span.end)));
          }
          parameters.push({ name: parameterName, type: type.syntax, rest, optional, span: span(parameterStart, type.span.end) });
          if (optional) sawOptional = true;
          if (rest) sawRest = true;
        } while (this.host.match("comma") && !this.host.check("rightParen"));
      }
      this.host.expect("rightParen", "Expected ')' after function type parameters");
      if (this.host.check("fatArrow")) this.reportTypePositionFatArrow(this.host.advance());
      else this.host.expect("arrow", "Expected '->' after function type parameters");
      const result = this.host.parseTypeReference();
      return { kind: "FunctionTypeSyntax", parameters, result: result.syntax, span: span(open.span.start, result.span.end) };
    }
    return null;
  }

  /**
   * What a dotted type-reference head names. A namespace-imported enum needs
   * three segments — `library.Status.pending` — so the path is read to its end
   * and refused whole rather than stopping the statement at the second dot:
   * the last segment is the member, and the segments before it qualify the
   * name that owns it.
   */
  private typeNamePath(name: Token, typeName: string, segments: readonly TypeNameSegment[]): {
    readonly member: TypeNameSegment | null;
    readonly pathSpan: Span;
    readonly pathText: string;
    readonly memberPath: (arguments_: readonly TypeSyntax[] | null, wholeSpan: Span) => TypeSyntax;
  } {
    const member = segments.at(-1) ?? null;
    const qualifiers: TypeNameSegment[] = segments.length > 1
      ? [{ name: typeName, span: name.span }, ...segments.slice(0, -2)]
      : [];
    const owner = segments.length > 1
      ? segments.at(-2)!
      : { name: typeName, span: name.span };
    const pathSpan = member ? span(name.span.start, member.span.end) : name.span;
    const pathText = [typeName, ...segments.map((segment) => segment.name)].join(".");
    const memberPath = (arguments_: readonly TypeSyntax[] | null, wholeSpan: Span): TypeSyntax => ({
      kind: "EnumMemberTypeSyntax",
      ...(qualifiers.length > 0 ? { qualifiers } : {}),
      enumName: owner.name,
      enumNameSpan: owner.span,
      member: member!.name,
      memberSpan: member!.span,
      ...(arguments_ ? { arguments: arguments_ } : {}),
      span: wholeSpan,
    });
    return { member, pathSpan, pathText, memberPath };
  }

  /**
   * D114 ③: `Function`, `Function<R>` and `Function<A, …, R>` were a second
   * spelling of the arrow function type, admitted before D28 and never given a
   * decision record of their own. The family is retired: a function type has
   * one spelling. Every type position recovers as the arrow the shorthand
   * meant, so analysis continues and a nested occurrence — `List<Function<T>>`,
   * a parameter inside another function type, an alias body, a record or class
   * field, an extern contract — is rewritten where it stands rather than
   * collapsing the annotation around it.
   *
   * `arguments_` is the written type argument list, or `null` for the bare
   * name. Answers `null` when `syntax` is not the retired shorthand, so a
   * caller can pass any type syntax through it.
   */
  private retiredFunctionShorthand(syntax: TypeSyntax, arguments_: readonly TypeSyntax[] | null, wholeSpan: Span): TypeSyntax | null {
    if (arguments_ === null) {
      if (syntax.kind !== "NamedTypeSyntax" || syntax.name !== "Function") return null;
    } else if (syntax.kind !== "GenericTypeSyntax" || syntax.name !== "Function") return null;
    const parameters = (arguments_ ?? []).slice(0, -1).map((type) => ({ name: null, type, rest: false, optional: false, span: type.span }));
    const result = arguments_?.at(-1) ?? { kind: "NamedTypeSyntax", name: "null", span: wholeSpan } as const;
    const recovered: TypeSyntax = { kind: "FunctionTypeSyntax", parameters, result, span: wholeSpan };
    const spelling = formatTypeSyntax(recovered);
    // The written form is named as the shape it is rather than quoted back:
    // a nested occurrence has already recovered by the time the annotation
    // around it is built, so quoting would report text the author never wrote.
    this.host.diagnostics.push(recoveredDiagnostic(
      "VEL2012",
      `The '${arguments_ === null ? "Function" : "Function<...>"}' type shorthand is retired; a function type has one spelling, the arrow — write '${spelling}'`,
      wholeSpan,
      mechanicalFix(wholeSpan, spelling, `Use '${spelling}'`),
    ));
    return recovered;
  }

  private finishTypeReferenceSuffix(syntax: TypeSyntax, allowTrailingOptional = true): TypeSyntax {
    if (allowTrailingOptional && this.host.match("question")) {
      return this.makeOptionalTypeSyntax(syntax, span(syntax.span.start, this.host.previous().span.end));
    }
    return syntax;
  }

  private makeOptionalTypeSyntax(inner: TypeSyntax, optionalSpan: Span): TypeSyntax {
    if (inner.kind === "NamedTypeSyntax" && inner.name === "null") {
      this.host.diagnostics.push(recoveredDiagnostic("VEL2012", "'null?' is redundant; use 'null'", optionalSpan,
        mechanicalFix(span(inner.span.end, optionalSpan.end), "", "Remove the redundant '?'")));
      return { ...inner, span: optionalSpan };
    }
    return { kind: "OptionalTypeSyntax", inner, span: optionalSpan };
  }

  /**
   * D63 rule 161: `=>` counts as evidence here even though it is the wrong
   * spelling. VelarScript writes the value-level arrow `=>` and the type-level
   * arrow `->`, and a TypeScript reader writes `(string, string) => T` in a
   * type position on the first try. Reading that as a *grouped* type produced
   * `Expected ')' after grouped type` plus five cascades, none of which said
   * `->` — a pile of cascades with no right answer in it is no diagnostic
   * (D42's standing criterion). Claiming the parenthesis as a function type
   * lets `reportTypePositionFatArrow` say the one thing worth saying, and the
   * rest of the annotation parses normally, so the cascade never starts.
   */
  private isFunctionTypeParenthesis(): boolean {
    let depth = 0;
    for (let offset = 0; this.host.index + offset < this.host.tokens.length; offset += 1) {
      const kind = this.host.tokens[this.host.index + offset]!.kind;
      if (kind === "leftParen") depth += 1;
      else if (kind === "rightParen" && --depth === 0) {
        const next = this.host.tokens[this.host.index + offset + 1]?.kind;
        return next === "arrow" || next === "fatArrow";
      } else if (kind === "newline" || kind === "eof") return false;
    }
    return false;
  }

  /** The one diagnostic a `=>` in a type position gets, with its rewrite. */
  private reportTypePositionFatArrow(token: Token): void {
    this.host.diagnostics.push(recoveredDiagnostic(
      "VEL2012",
      "A function type writes its result after '->'; '=>' is the value-level arrow that introduces a lambda body",
      token.span,
      mechanicalFix(token.span, "->", "Use '->' in a function type"),
    ));
  }
}
