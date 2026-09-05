/**
 * The declaration statements: `const`/`let`, `using`, `def`, `type`, `enum`,
 * and the two block forms Core owns — `@context(...)` on the declaration that
 * follows it and the compiler-owned `@main` region, whose one-per-module rule
 * is checked here once the program is parsed.
 */
import type { BindingPattern, ContextMarker, EnumDeclaration, Expression, FunctionDeclaration, ImportDeclaration, MainBlock, Parameter, ReExportDeclaration, Statement, TypeDeclaration, TypeAliasDeclaration, TypeField, TypeParameterDeclaration, TypeReference, UsingDeclaration, VariableDeclaration } from "../../ast.ts";
import { isModuleDeclarationStatement } from "../../ast.ts";
import { CORE_COMPILER_CONTEXTUAL_NAMES, CORE_WORDS, TYPE_PARAMETER_DECLARATION_FORMS, typeParameterDeclarationFormsPhrase } from "../../core-vocabulary.ts";
import { diagnostic, type Diagnostic } from "../../diagnostic.ts";
import { type StringTokenPayload } from "../../interpolated-string.ts";
import { span, type Span } from "../../source.ts";
import { type Token, type TokenKind } from "../../token.ts";
import { declarationNameAhead, writtenNumber } from "../tokens.ts";

export interface DeclarationParserHost {
  advance(): Token;
  check(kind: TokenKind): boolean;
  checkExactIntegerLiteral(text: string, written: string, literalSpan: Span, negative?: boolean): boolean;
  checkWord(value: string): boolean;
  consumeNewlines(): void;
  readonly contextMarkers: ContextMarker[];
  current(): Token;
  readonly diagnostics: Diagnostic[];
  expect(kind: TokenKind, message: string): Token;
  expectMemberName(message?: string): Token;
  expectStatementEnd(): void;
  match(kind: TokenKind): boolean;
  parseBindingPattern(): BindingPattern;
  parseBlock(): readonly Statement[];
  parseDeclarationName(noun: "type" | "class" | "enum"): Token | null;
  parseExpression(minimumPrecedence?: number): Expression;
  parseParameters(): readonly Parameter[];
  parseStatement(): Statement | null;
  parseTypeParameters(): readonly TypeParameterDeclaration[] | null;
  parseTypeReference(allowTrailingOptional?: boolean): TypeReference;
  peekKind(distance: number): TokenKind;
  peekValue(distance: number): string;
  previous(): Token;
  readonly statementBlockDepth: number;
  synchronize(): void;
}

export class DeclarationParser {
  private readonly host: DeclarationParserHost;

  constructor(host: DeclarationParserHost) {
    this.host = host;
  }

  parseVariable(start: number, exported: boolean): VariableDeclaration {
    const bindingToken = this.host.advance();
    const pattern = this.host.parseBindingPattern();
    const type = this.host.match("colon") ? this.host.parseTypeReference() : null;
    this.host.expect("assign", "Expected '=' after binding pattern");
    const initializer = this.host.parseExpression();

    return {
      kind: "VariableDeclaration",
      binding: bindingToken.kind === "let" ? "let" : "const",
      exported,
      pattern,
      type,
      initializer,
      span: span(start, initializer.span.end),
    };
  }

  parseUsing(start: number): UsingDeclaration {
    const name = this.host.expect("identifier", "Expected a name after 'using'");
    this.host.expect("assign", "Expected '=' after a 'using' name");
    const initializer = this.host.parseExpression();
    return {
      kind: "UsingDeclaration",
      name: name.value,
      nameSpan: name.span,
      initializer,
      span: span(start, initializer.span.end),
    };
  }

  parseFunction(start: number, exported: boolean, asynchronous: boolean): FunctionDeclaration {
    const name = this.host.expect("identifier", "Expected a function name");
    const typeParameters = this.host.parseTypeParameters();
    const parameters = this.host.parseParameters();
    const parameterListEnd = this.host.previous().span.end;
    const returnType = this.host.match("arrow") ? this.host.parseTypeReference() : null;
    const body = this.host.parseBlock();
    const end = body.at(-1)?.span.end ?? returnType?.span.end ?? name.span.end;

    return {
      kind: "FunctionDeclaration",
      exported,
      asynchronous,
      name: name.value,
      ...(typeParameters ? { typeParameters } : {}),
      parameters,
      returnType,
      ...(returnType ? { resultAnnotationSpan: span(parameterListEnd, returnType.span.end) } : {}),
      signatureSpan: span(start, returnType?.span.end ?? parameterListEnd),
      body,
      span: span(start, end),
    };
  }

  parseTypeDefinition(start: number, exported: boolean, readonly = false): TypeDeclaration | TypeAliasDeclaration | null {
    const name = this.host.parseDeclarationName("type");
    if (!name) return null;
    const typeParameters = this.host.parseTypeParameters();
    if (this.host.match("assign")) {
      const target = this.host.parseTypeReference();
      if (readonly) {
        this.host.diagnostics.push(diagnostic(
          "VEL2025",
          "'readonly type' declares a record body; for an alias, put 'readonly' on the target — type Name = readonly Other",
          span(start, name.span.end),
        ));
      }
      // D55 rule 120 admits the generic *record*. An alias names an
      // instantiation — `type Boxed = Box<string>` — which is rule 123's whole
      // idiom, so a parameter list here has nothing to bind and the refusal
      // says what to write instead.
      if (typeParameters) {
        this.host.diagnostics.push(diagnostic(
          "VEL2025",
          `Type alias '${name.value}' cannot declare type parameters; an alias names one instantiation with concrete arguments, while '<T>' belongs to a '${TYPE_PARAMETER_DECLARATION_FORMS.join("' or a '")}' declaration`,
          name.span,
        ));
      }
      return { kind: "TypeAliasDeclaration", exported, name: name.value, target, span: span(start, target.span.end) };
    }
    const base = this.host.match("extends") ? this.host.parseTypeReference() : null;
    this.host.expect("colon", "Expected ':' after type name");
    this.host.expect("newline", "Expected a newline before type fields");
    this.host.consumeNewlines();
    this.host.expect("indent", "Expected indented type fields");
    const fields: TypeField[] = [];
    this.host.consumeNewlines();

    while (!this.host.check("dedent") && !this.host.check("eof")) {
      // D64 rule 164: `readonly` is a contextual keyword, so it is claimed by
      // its own shape and by nothing else. `readonly: number` is a field named
      // `readonly` — every other contextual keyword already reads that way in
      // this position, `{readonly: 1}` already builds that record on the value
      // side, and charter §3 promises the word is an ordinary name here.
      // `readonly readonly: number` still declares a read-only field of that
      // name, because the modifier shape is `readonly` followed by a name.
      const readonly = this.host.checkWord(CORE_WORDS.readonly) && this.host.peekKind(1) !== "colon";
      const fieldStart = readonly ? this.host.advance().span.start : this.host.current().span.start;
      const fieldName = this.host.expectMemberName("Expected a field name");
      this.host.expect("colon", "Expected ':' after field name");
      const type = this.host.parseTypeReference();
      if (this.host.check("assign")) {
        // ENM-U5: record fields carry no defaults — a record is data, so
        // every construction site states its values.
        this.host.diagnostics.push(diagnostic(
          "VEL2017",
          `Record fields do not take default values; make the field optional ('${fieldName.value}: ...?') or set the value where the record is built`,
          this.host.current().span,
        ));
        this.host.advance();
        this.host.parseExpression();
      }
      fields.push({ readonly, name: fieldName.value, type, span: span(fieldStart, type.span.end) });
      this.host.expectStatementEnd();
      this.host.consumeNewlines();
    }
    const close = this.host.expect("dedent", "Expected the end of type fields");
    return { kind: "TypeDeclaration", exported, readonly, name: name.value, ...(typeParameters ? { typeParameters } : {}), base, fields, span: span(start, fields.at(-1)?.span.end ?? close.span.end) };
  }

  parseEnumDeclaration(start: number, exported: boolean): EnumDeclaration | null {
    const name = this.host.parseDeclarationName("enum");
    if (!name) return null;
    // D55 rule 127.1: `enum` was the one declaration in this family with no
    // `parseTypeParameters` call at all, so `enum Color<T>:` cascaded into six
    // parse errors instead of saying the one thing that is wrong.
    if (this.host.check("less")) {
      this.host.parseTypeParameters();
      this.host.diagnostics.push(diagnostic("VEL2025", `Enum '${name.value}' cannot declare type parameters; ${typeParameterDeclarationFormsPhrase()} take '<T>'`, name.span));
    }
    this.host.expect("colon", "Expected ':' after enum name");
    this.host.expect("newline", "Expected a newline before enum members");
    this.host.consumeNewlines();
    this.host.expect("indent", "Expected indented enum members");
    const members: EnumDeclaration["members"][number][] = [];
    this.host.consumeNewlines();

    while (!this.host.check("dedent") && !this.host.check("eof")) {
      // ENM-I8: a bare `pass` line is the placeholder statement here exactly
      // as in a class body — never a member named 'pass'. An enum whose body
      // is only `pass` then falls through to the existing "requires at least
      // one member" rule, and 'pass' becomes the one undeclarable member name.
      if (this.host.check("pass")) {
        const keyword = this.host.advance();
        if (this.host.check("assign")) {
          this.host.diagnostics.push(diagnostic(
            "VEL2017",
            "'pass' is the placeholder line and cannot be declared as an enum member; pick another member name",
            keyword.span,
          ));
          this.host.synchronize();
        } else {
          this.host.expectStatementEnd();
        }
        this.host.consumeNewlines();
        continue;
      }
      const member = this.host.expectMemberName("Expected an enum member name");
      let value: string | number = member.value;
      let valueSpan: Span | undefined;
      if (this.host.match("assign")) {
        if (this.host.check("string")) {
          const serialized = this.host.advance();
          const payload = serialized.payload as StringTokenPayload | undefined;
          if (payload?.layout) {
            this.host.diagnostics.push(diagnostic("VEL2017", "An enum member value must be an inline string", serialized.span));
          }
          value = serialized.value;
          valueSpan = serialized.span;
        } else if (this.host.check("fstring")) {
          const serialized = this.host.advance();
          this.host.diagnostics.push(diagnostic(
            "VEL2017",
            "An enum member value is static; use an inline quoted string without interpolation",
            serialized.span,
          ));
          valueSpan = serialized.span;
        } else if (this.host.check("number") || (this.host.check("minus") && this.host.peekKind(1) === "number")) {
          const numeric = this.parseEnumNumericValue();
          if (numeric) {
            value = numeric.value;
            valueSpan = numeric.span;
          }
        } else {
          this.host.diagnostics.push(diagnostic("VEL2001", "Expected an inline string or an integer value after '=' in an enum member", this.host.current().span));
          this.host.synchronize();
        }
      }
      if (member.value) members.push({ name: member.value, value, ...(valueSpan ? { valueSpan } : {}), span: member.span });
      this.host.expectStatementEnd();
      this.host.consumeNewlines();
    }
    const close = this.host.expect("dedent", "Expected the end of enum members");
    if (members.length === 0) {
      this.host.diagnostics.push(diagnostic("VEL2017", `Enum '${name.value}' requires at least one member`, span(start, close.span.end)));
    }
    const last = members.at(-1);
    return { kind: "EnumDeclaration", exported, name: name.value, members, span: span(start, last?.valueSpan?.end ?? last?.span.end ?? close.span.end) };
  }

  /**
   * D102 ruling 1: an enum member's numeric wire value. The slot takes exactly
   * the shape the charter (section 3) calls an integer literal — decimal or an
   * explicit radix, digit separators allowed, no fraction part and no exponent
   * — with an optional leading minus, which is how `parseMatchValue` already
   * spells a signed literal in a slot that is not an expression position. A
   * decimal spelling is refused here rather than rounded, because `2.0` and `2`
   * are one JavaScript number and a wire value has to read at the declaration
   * as the integer it is. Exact representability is D90 R6's existing test, so
   * `9007199254740993 = ...` reports once, in R6's own words, and the safe
   * integer fence below never fires behind it — it stands for the value, not
   * for the spelling.
   *
   * Returns `null` when it reported, so the member keeps its name-derived value
   * instead of a salvaged one; a bogus `0` here would collide with a real `0`
   * and produce a second, contradicting duplicate-value report.
   */
  private parseEnumNumericValue(): { readonly value: number; readonly span: Span } | null {
    const negative = this.host.match("minus");
    const start = negative ? this.host.previous().span.start : this.host.current().span.start;
    const token = this.host.advance();
    const literalSpan = span(start, token.span.end);
    const text = token.value;
    if (!text) return null;
    // `-0` and `0` are one wire value: they emit the same JSON and `===` cannot
    // tell them apart, so the declaration carries the one spelling downstream.
    const signed = Number(text) * (negative ? -1 : 1);
    const numeric = Object.is(signed, -0) ? 0 : signed;
    if (!/^(?:[0-9]+|0[xXbBoO][0-9a-fA-F]+)$/u.test(text)) {
      this.host.diagnostics.push(diagnostic(
        "VEL2017",
        `An enum member's numeric wire value must be a whole number; '${negative ? "-" : ""}${writtenNumber(token)}' spells a decimal`,
        literalSpan,
      ));
      return null;
    }
    if (!Number.isFinite(numeric)) {
      this.host.diagnostics.push(diagnostic("VEL2017", "Numeric literals must be finite", literalSpan));
      return null;
    }
    if (!this.host.checkExactIntegerLiteral(text, writtenNumber(token), literalSpan, negative)) return null;
    if (!Number.isSafeInteger(numeric)) {
      this.host.diagnostics.push(diagnostic(
        "VEL2017",
        `An enum member's numeric wire value must be a safe integer; '${negative ? "-" : ""}${writtenNumber(token)}' is outside that range`,
        literalSpan,
      ));
      return null;
    }
    return { value: numeric, span: literalSpan };
  }

  /**
   * D30 item 16: `type` opens a declaration only in its declaration shape —
   * the word, a name, and then ':' for a record body, '=' for an alias, '<'
   * for type parameters, or `extends` for record inheritance. `type = payload.type`,
   * `type(value)`, and `type.field` all keep the identifier reading.
   */
  typeDeclarationAhead(): boolean {
    // A reserved word in the name slot is a `type` declaration too, and reading
    // it as one is what lets the name slot refuse it. Read as an expression,
    // `type null:` answered with the statement-layout recovery — a message
    // about lines, for a mistake about names.
    if (!this.host.checkWord(CORE_WORDS.type) || !declarationNameAhead(this.host.peekKind(1), this.host.peekValue(1))) return false;
    const shape = this.host.peekKind(2);
    return shape === "colon" || shape === "assign" || shape === "less" || shape === "extends";
  }

  /** `readonly` remains an ordinary name unless the complete record declaration head follows. */
  readonlyTypeDeclarationAhead(): boolean {
    if (!this.host.checkWord(CORE_WORDS.readonly) || this.host.peekValue(1) !== CORE_WORDS.type
      || !declarationNameAhead(this.host.peekKind(2), this.host.peekValue(2))) return false;
    const shape = this.host.peekKind(3);
    return shape === "colon" || shape === "assign" || shape === "less" || shape === "extends";
  }

  /**
   * `@context("…")` is Core's one author-supplied business label. It annotates
   * the next top-level declaration in compiler metadata while returning that
   * declaration unchanged to analysis and emission, so it creates neither a
   * runtime wrapper nor a hidden scope.
   */
  parseContextMarkedDeclaration(start: number): Statement | null {
    const atModuleTopLevel = this.host.statementBlockDepth === 0;
    const at = this.host.expect("at", "Expected '@' before 'context'");
    const marker = this.host.expect("identifier", "Expected 'context' after '@'");
    const markerSpan = span(at.span.start, marker.span.end);
    this.host.expect("leftParen", "Expected '(' after '@context'");
    const name = this.host.expect("string", "Expected one static business context name");
    const close = this.host.expect("rightParen", "Expected ')' after the business context name");
    if (name.value.trim().length === 0) {
      this.host.diagnostics.push(diagnostic("VEL2022", "'@context' requires a non-empty business context name", name.span));
    } else if (name.value.length > 120) {
      this.host.diagnostics.push(diagnostic("VEL2022", "An '@context' name cannot exceed 120 code units", name.span));
    } else if (/\p{Cc}/u.test(name.value)) {
      this.host.diagnostics.push(diagnostic("VEL2022", "An '@context' name cannot contain control characters", name.span));
    }
    this.host.expect("newline", "Expected the declaration on the line after '@context(...)'");
    if (this.host.check("newline")) {
      this.host.diagnostics.push(diagnostic(
        "VEL2022",
        "'@context' must be immediately followed by the declaration it describes",
        span(start, close.span.end),
      ));
      this.host.consumeNewlines();
    }
    if (this.host.check("eof") || this.host.check("dedent")) {
      this.host.diagnostics.push(diagnostic(
        "VEL2022",
        "'@context' must be followed by a top-level declaration or framework structure",
        markerSpan,
      ));
      return null;
    }
    const target = this.host.parseStatement();
    if (!target) return null;
    if (!atModuleTopLevel
      || !isModuleDeclarationStatement(target)
      || target.kind === "ImportDeclaration"
      || target.kind === "ReExportDeclaration") {
      this.host.diagnostics.push(diagnostic(
        "VEL2022",
        "'@context' describes a top-level declaration or framework structure, not local code or an import",
        target.span,
      ));
      return target;
    }
    if (this.host.contextMarkers.some((item) => item.targetSpan.start === target.span.start
      && item.targetSpan.end === target.span.end)) {
      this.host.diagnostics.push(diagnostic(
        "VEL2022",
        "A declaration can have only one '@context' marker",
        markerSpan,
      ));
      return target;
    }
    if (name.value.trim().length > 0 && name.value.length <= 120 && !/\p{Cc}/u.test(name.value)) {
      this.host.contextMarkers.push({
        name: name.value.trim(),
        nameSpan: name.span,
        markerSpan,
        targetSpan: target.span,
      });
    }
    return target;
  }

  /**
   * 解析模块语句位置的编译器角色。目前这个封闭命名空间只有 `@main`。
   *
   * 正文复用普通可执行块的解析入口，因此 `@main: run()` 与缩进正文拥有完全
   * 相同的语句语义；共享入口也会继续拒绝把另一个块头塞进单行正文。
   */
  parseCompilerOwnedModuleBlock(start: number): MainBlock | Statement {
    const marker = this.host.expect("at", "Expected '@' before a compiler-owned module name");
    const name = this.host.expect("identifier", "Expected a compiler-owned module name after '@'");
    const keywordSpan = span(marker.span.start, name.span.end);
    const body = this.host.parseBlock();
    const blockSpan = span(start, body.at(-1)?.span.end ?? this.host.previous().span.end);
    if (!(CORE_COMPILER_CONTEXTUAL_NAMES.module as readonly string[]).includes(name.value)) {
      this.host.diagnostics.push(diagnostic(
        "VEL2022",
        `Unknown compiler-owned name '@${name.value}' at statement scope; the module namespace contains only ${CORE_COMPILER_CONTEXTUAL_NAMES.module.map((item) => `'@${item}:'`).join(", ")}`,
        keywordSpan,
      ));
      return { kind: "PassStatement", span: blockSpan };
    }
    return { kind: "MainBlock", keywordSpan, body, span: blockSpan };
  }

  /** `@main` 是模块的最终入口区域；唯一性和位置在完整模块可见后统一检查。 */
  validateMainBlocks(body: readonly Statement[]): void {
    const mainIndexes = body
      .map((statement, index) => statement.kind === "MainBlock" ? index : -1)
      .filter((index) => index >= 0);
    for (const duplicate of mainIndexes.slice(1)) {
      this.host.diagnostics.push(diagnostic(
        "VEL2022",
        "A module can declare at most one '@main' region",
        body[duplicate]!.span,
      ));
    }
    const finalMain = mainIndexes.at(-1);
    if (finalMain !== undefined && finalMain !== body.length - 1) {
      this.host.diagnostics.push(diagnostic(
        "VEL2022",
        "'@main' must be the module's final top-level region",
        body[finalMain]!.span,
      ));
    }

    if (mainIndexes.length === 0) return;
    for (const statement of body) {
      // 扩展语句由拥有它的框架定义其声明性质；Core 不能把 component、server
      // 等合法顶层声明误判成散落执行代码。这份分类由 `ast.ts` 拥有，因为读它的
      // 不只有这里：缺少 `@main` 的入口要靠同一份分类判断哪些语句是启动代码。
      if (isModuleDeclarationStatement(statement)) continue;
      this.host.diagnostics.push(diagnostic(
        "VEL2022",
        "Executable module code must be placed inside the module's '@main' region",
        statement.span,
      ));
    }
  }
}
