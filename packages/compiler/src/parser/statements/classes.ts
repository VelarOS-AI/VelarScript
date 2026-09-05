/**
 * `class` and `extern class`: the declaration head and its type parameters, the
 * constructor's parameter list (the one list that may declare fields), the
 * member forms — field, getter, method, `@init:`, `@dispose:`, `@iterate:` —
 * and the extern mirror of all of it.
 */
import type { ClassDeclaration, ClassFieldDeclaration, ClassGetterDeclaration, ClassDisposeBlock, ClassInitBlock, ClassIterateBlock, ClassMethodDeclaration, ClassParameter, Expression, ExternClassDeclaration, ExternClassFieldDeclaration, ExternClassGetterDeclaration, ExternClassMethodDeclaration, FunctionDeclaration, Parameter, Statement, TypeParameterDeclaration, TypeReference, TypeSyntax } from "../../ast.ts";
import { CORE_COMPILER_CONTEXTUAL_NAMES, CORE_WORDS } from "../../core-vocabulary.ts";
import { diagnostic, mechanicalFix, recoveredDiagnostic, type Diagnostic } from "../../diagnostic.ts";
import { declarationKeywordGuidance, REST_PARAMETER_ELEMENT_TYPE_MESSAGE } from "../../language-guidance.ts";
import { span } from "../../source.ts";
import { type Token, type TokenKind } from "../../token.ts";
import { formatTypeSyntax } from "../../types.ts";

export interface ClassParserHost {
  advance(): Token;
  check(kind: TokenKind): boolean;
  checkWord(value: string): boolean;
  consumeNewlines(): void;
  current(): Token;
  readonly diagnostics: Diagnostic[];
  expect(kind: TokenKind, message: string): Token;
  expectBindingName(message: string, noun: string): Token;
  expectMemberName(message?: string): Token;
  expectStatementEnd(): void;
  match(kind: TokenKind): boolean;
  parseBlock(): readonly Statement[];
  parseDeclarationName(noun: "type" | "class" | "enum"): Token | null;
  parseExpression(minimumPrecedence?: number): Expression;
  parseParameters(): readonly Parameter[];
  parseSpreadExpression(): Expression;
  parseTypeArgumentList(): readonly TypeSyntax[];
  parseTypeParameters(): readonly TypeParameterDeclaration[] | null;
  parseTypeReference(allowTrailingOptional?: boolean): TypeReference;
  peekKind(distance: number): TokenKind;
  previous(): Token;
  reportClassMemberReadonly(modifier: Token | null, member: "field" | "executable", code: string): void;
  reportExternDeclarationBody(): boolean;
  reportUntypedExternParameters(parameters: readonly Parameter[]): void;
  skipMistypedDeclaration(): void;
  synchronize(): void;
}

export class ClassParser {
  private readonly host: ClassParserHost;

  constructor(host: ClassParserHost) {
    this.host = host;
  }

  parseClassDeclaration(start: number, exported: boolean, abstract: boolean): ClassDeclaration | null {
    const name = this.host.parseDeclarationName("class");
    if (!name) return null;
    // D55 rule 120 layer two: `class Stack<T>` and `class Stack<T: Bound>` read
    // through the same `parseTypeParameters` every other declaration form uses.
    const typeParameters = this.host.parseTypeParameters();
    let parameters: ClassParameter[] = [];
    if (this.host.match("leftParen")) {
      this.host.diagnostics.push(diagnostic("VEL2022", `Class '${name.value}' declares its constructor in the class body with 'constructor(...)'`, this.host.previous().span));
      if (!this.host.check("rightParen")) {
        do {
          const rest = this.host.match("ellipsis");
          let private_ = false;
          if (this.host.check("private") && (this.host.peekKind(1) === "const" || this.host.peekKind(1) === "let")) {
            this.host.advance();
            private_ = true;
          }
          const binding = this.host.match("const") ? "const" : this.host.match("let") ? "let" : null;
          const parameterName = this.host.expect("identifier", "Expected a class parameter name");
          const type = this.host.match("colon") ? this.host.parseTypeReference() : null;
          const defaultValue = this.host.match("assign") ? this.host.parseExpression() : null;
          if (rest) {
            this.host.diagnostics.push(diagnostic("VEL2016", "Class constructors do not support rest parameters", parameterName.span));
          }
          parameters.push({
            name: parameterName.value,
            binding,
            private: private_ && binding !== null,
            type,
            defaultValue,
            rest,
            span: span(parameterName.span.start, defaultValue?.span.end ?? type?.span.end ?? parameterName.span.end),
          });
        } while (this.host.match("comma") && !this.host.check("rightParen"));
      }
      this.host.expect("rightParen", "Expected ')' after class parameters");
    }

    let base: ClassDeclaration["base"] = null;
    if (this.host.match("extends")) {
      const baseName = this.host.expect("identifier", "Expected a base class name after 'extends'");
      // D55 rule 120 layer two: `extends Stack<number>` and `extends Stack<T>`.
      // The arguments are read positionally here, exactly as an annotation
      // reads them, and the analyzer judges arity, bounds, and what they mean.
      const typeArguments = this.host.check("less") ? this.host.parseTypeArgumentList() : null;
      const arguments_: Expression[] = [];
      let end = typeArguments ? this.host.previous().span.end : baseName.span.end;
      if (this.host.match("leftParen")) {
        this.host.diagnostics.push(diagnostic("VEL2022", "Pass base constructor arguments with an explicit 'super(...)' call inside the constructor", this.host.previous().span));
        if (!this.host.check("rightParen")) {
          do {
            arguments_.push(this.host.parseSpreadExpression());
          } while (this.host.match("comma") && !this.host.check("rightParen"));
        }
        end = this.host.expect("rightParen", "Expected ')' after base constructor arguments").span.end;
      }
      base = {
        name: baseName.value,
        nameSpan: baseName.span,
        ...(typeArguments ? { typeArguments } : {}),
        arguments: arguments_,
        span: span(baseName.span.start, end),
      };
    }
    this.host.expect("colon", "Expected ':' before class body");
    this.host.expect("newline", "Expected a newline before class body");
    this.host.consumeNewlines();
    this.host.expect("indent", "Expected an indented class body");
    const { parameters: bodyParameters, fields, initialization, dispose, iterate, getters, methods, close } = this.parseClassBody(name, parameters);
    return {
      kind: "ClassDeclaration",
      exported,
      abstract,
      name: name.value,
      ...(typeParameters ? { typeParameters } : {}),
      parameters: bodyParameters,
      base,
      fields,
      initialization,
      getters,
      methods,
      dispose,
      iterate,
      span: span(start, Math.max(methods.at(-1)?.span.end ?? 0, getters.at(-1)?.span.end ?? 0, fields.at(-1)?.span.end ?? 0, initialization?.span.end ?? 0, dispose?.span.end ?? 0, iterate?.span.end ?? 0, close.span.end)),
    };
  }

  /**
   * A class body: every member it declares, and the `dedent` that closed it.
   * `parameters` arrives from the declaration head and leaves changed when the
   * body declares a `constructor(...)`, which is the one member that owns the
   * class's parameter list.
   */
  private parseClassBody(name: Token, parameters: ClassParameter[]): {
    readonly parameters: ClassParameter[];
    readonly fields: ClassFieldDeclaration[];
    readonly initialization: ClassInitBlock | null;
    readonly dispose: ClassDisposeBlock | null;
    readonly iterate: ClassIterateBlock | null;
    readonly getters: ClassGetterDeclaration[];
    readonly methods: ClassMethodDeclaration[];
    readonly close: Token;
  } {
    const fields: ClassFieldDeclaration[] = [];
    let initialization: ClassInitBlock | null = null;
    let dispose: ClassDisposeBlock | null = null;
    let iterate: ClassIterateBlock | null = null;
    const getters: ClassGetterDeclaration[] = [];
    const methods: ClassMethodDeclaration[] = [];
    this.host.consumeNewlines();

    while (!this.host.check("dedent") && !this.host.check("eof")) {
      const methodStart = this.host.current().span.start;
      // `@` always selects the contextual compiler namespace. In a class that
      // closed namespace contains `dispose` and `iterate`; their behavior
      // differs, but their resolution, rejection, and collision rules do not.
      if (this.host.check("at")) {
        const parsed = this.parseClassContextBlock(methodStart);
        if (parsed.iterate) {
          if (iterate) this.host.diagnostics.push(diagnostic("VEL2022", `Class '${name.value}' has more than one '@iterate' block`, parsed.iterate.span));
          else iterate = parsed.iterate;
        }
        if (parsed.dispose) {
          if (dispose) this.host.diagnostics.push(diagnostic("VEL2022", `Class '${name.value}' has more than one '@dispose' block`, parsed.dispose.span));
          else dispose = parsed.dispose;
        }
        this.host.consumeNewlines();
        continue;
      }
      const { abstract: methodAbstract, override: methodOverride, static: methodStatic,
        private: methodPrivate, asynchronous, readonlyModifier } = this.scanClassMemberModifiers();
      // D62 rule 157: `constructor` comes from Core's roster. `init` stays a
      // literal on purpose — it is the removed `init:` block, recognized only
      // to teach its replacement, so it is not a spelling the language has.
      if (this.host.checkWord(CORE_WORDS.constructor) || (this.host.check("identifier") && this.host.current().value === "init")) {
        const constructorName = this.host.current();
        this.host.advance();
        this.host.reportClassMemberReadonly(readonlyModifier, "executable", "VEL2021");
        if (constructorName.value === "init") {
          this.host.diagnostics.push(diagnostic("VEL2022", "Use 'constructor(...)' for class construction; the separate 'init:' block was removed", constructorName.span));
        }
        if (methodAbstract || methodOverride || methodStatic || methodPrivate || asynchronous) {
          this.host.diagnostics.push(diagnostic("VEL2022", "A constructor does not accept method modifiers", span(methodStart, this.host.previous().span.end)));
        }
        parameters = constructorName.value === CORE_WORDS.constructor ? [...this.parseClassConstructorParameters()] : [];
        const initBody = this.host.parseBlock();
        const block = {
          kind: "ClassInitBlock",
          body: initBody,
          span: span(methodStart, initBody.at(-1)?.span.end ?? this.host.previous().span.end),
        } satisfies ClassInitBlock;
        if (initialization) {
          this.host.diagnostics.push(diagnostic("VEL2022", `Class '${name.value}' has more than one constructor`, block.span));
        } else {
          initialization = block;
        }
        this.host.consumeNewlines();
        continue;
      }
      if (this.host.check("const") || this.host.check("let")) {
        fields.push(this.parseClassField(methodStart, { abstract: methodAbstract, override: methodOverride, static: methodStatic, private: methodPrivate, asynchronous, readonlyModifier }));
        this.host.expectStatementEnd();
        this.host.consumeNewlines();
        continue;
      }
      if (this.host.checkWord(CORE_WORDS.get)) {
        this.host.advance();
        this.host.reportClassMemberReadonly(readonlyModifier, "executable", "VEL2021");
        getters.push(this.parseClassGetter(methodStart, methodAbstract, methodOverride, methodStatic, methodPrivate, asynchronous));
        this.host.consumeNewlines();
        continue;
      }
      if (this.refuseClassSetter({ abstract: methodAbstract, override: methodOverride, static: methodStatic, private: methodPrivate, asynchronous, readonlyModifier })) {
        this.host.consumeNewlines();
        continue;
      }
      if (!this.host.match("def")) {
        const recovered = this.parseMistypedClassMember(methodStart, { abstract: methodAbstract, override: methodOverride, static: methodStatic, private: methodPrivate, asynchronous, readonlyModifier });
        if (recovered) methods.push(recovered);
        this.host.consumeNewlines();
        continue;
      }
      this.host.reportClassMemberReadonly(readonlyModifier, "executable", "VEL2021");
      const method = this.parseClassMethod(methodStart, asynchronous, methodAbstract, methodOverride, methodStatic, methodPrivate);
      methods.push(method);
      this.host.consumeNewlines();
    }
    const close = this.host.expect("dedent", "Expected the end of class body");
    return { parameters, fields, initialization, dispose, iterate, getters, methods, close };
  }

  /**
   * A compiler-owned class block. `@` always selects the contextual compiler
   * namespace; in a class that closed namespace holds `dispose` and `iterate`,
   * whose behaviour differs but whose resolution and rejection do not. Which
   * of the two was written is what this returns; whether the class already had
   * one is the body's question.
   */
  private parseClassContextBlock(methodStart: number): { readonly iterate: ClassIterateBlock | null; readonly dispose: ClassDisposeBlock | null } {
    const marker = this.host.advance();
    const memberName = this.host.expect("identifier", "Expected a compiler-owned class name after '@'");
    const keywordSpan = span(marker.span.start, memberName.span.end);
    const known = (CORE_COMPILER_CONTEXTUAL_NAMES.class as readonly string[]).includes(memberName.value);
    if (!known) {
      this.host.diagnostics.push(diagnostic(
        "VEL2022",
        `Unknown compiler-owned name '@${memberName.value}' in a class; the class namespace contains only ${CORE_COMPILER_CONTEXTUAL_NAMES.class.map((item) => `'@${item}:'`).join(" and ")}`,
        keywordSpan,
      ));
    }
    const body = this.host.parseBlock();
    const blockSpan = span(methodStart, body.at(-1)?.span.end ?? this.host.previous().span.end);
    if (memberName.value === "iterate") {
      return { iterate: { kind: "ClassIterateBlock", body, keywordSpan, span: blockSpan }, dispose: null };
    }
    if (memberName.value === "dispose") {
      return { iterate: null, dispose: { kind: "ClassDisposeBlock", body, keywordSpan, span: blockSpan } };
    }
    return { iterate: null, dispose: null };
  }

  /**
   * The modifiers a class member may carry, read in any order. CLS-I5:
   * `readonly` is returned rather than reported, because the advice depends on
   * the member kind that follows — a field has `const`, an executable member
   * has no read-only contract at all.
   */
  private scanClassMemberModifiers(): {
    readonly abstract: boolean; readonly override: boolean; readonly static: boolean;
    readonly private: boolean; readonly asynchronous: boolean; readonly readonlyModifier: Token | null;
  } {
  let methodAbstract = false;
  let methodOverride = false;
  let methodStatic = false;
  let methodPrivate = false;
  let asynchronous = false;
  let scanningModifiers = true;
  // CLS-I5: `readonly` is reported once the member kind is known, because
  // the advice differs — a field has `const`, while an executable member
  // has no read-only contract at all.
  let readonlyModifier: Token | null = null;
  while (scanningModifiers) {
    if (this.host.match("abstract")) methodAbstract = true;
    else if (this.host.match("override")) methodOverride = true;
    else if (this.host.match("static")) methodStatic = true;
    else if (this.host.match("private")) methodPrivate = true;
    else if (this.host.checkWord(CORE_WORDS.readonly)) readonlyModifier = this.host.advance();
    else if (this.host.match("async")) asynchronous = true;
    else scanningModifiers = false;
  }
    return {
      abstract: methodAbstract, override: methodOverride, static: methodStatic,
      private: methodPrivate, asynchronous, readonlyModifier,
    };
  }

  /**
   * One `const`/`let` class field. Two shapes are answered here besides the
   * ordinary one: a field carrying method-only modifiers, and CLS-U7's
   * TypeScript optional-property spelling `let name?: T`, which VelarScript
   * has no syntax for — a field carries an optional type instead.
   */
  private parseClassField(
    methodStart: number,
    modifiers: { readonly abstract: boolean; readonly override: boolean; readonly static: boolean; readonly private: boolean; readonly asynchronous: boolean; readonly readonlyModifier: Token | null },
  ): ClassFieldDeclaration {
    const binding = this.host.advance().kind as "const" | "let";
    this.host.reportClassMemberReadonly(modifiers.readonlyModifier, "field", "VEL2021");
    if (modifiers.abstract || modifiers.override || modifiers.asynchronous) {
      this.host.diagnostics.push(diagnostic("VEL2021", "Class fields support only the 'private' and 'static' modifiers; use 'const' for a read-only field", this.host.previous().span));
    }
    const fieldName = this.host.expectMemberName("Expected a class field name");
    // CLS-U7: `let name?: T` is the TypeScript optional-property shape.
    // The type here is explicit, so the missing-type message was simply
    // wrong; VelarScript has no optional-field syntax at all — the field
    // carries an optional type instead.
    const optionalMarker = this.host.check("question") ? this.host.advance() : null;
    let type: TypeReference;
    if (this.host.match("colon")) {
      type = this.host.parseTypeReference();
    } else if (optionalMarker) {
      type = { syntax: { kind: "NamedTypeSyntax", name: "unknown", span: fieldName.span }, span: fieldName.span };
    } else {
      this.host.diagnostics.push(diagnostic("VEL2021", "Class fields require an explicit type", fieldName.span));
      type = { syntax: { kind: "NamedTypeSyntax", name: "unknown", span: fieldName.span }, span: fieldName.span };
    }
    if (optionalMarker) {
      const written = formatTypeSyntax(type.syntax);
      const optional = written === "unknown" ? "T?" : written.endsWith("?") ? written : `${written}?`;
      this.host.diagnostics.push(diagnostic(
        "VEL2021",
        `VelarScript has no optional-field syntax; a field carries an optional type instead — write '${binding} ${fieldName.value}: ${optional} = null'`,
        span(fieldName.span.start, optionalMarker.span.end),
      ));
    }
    const initializer = this.host.match("assign") ? this.host.parseExpression() : null;
    return {
      binding,
      static: modifiers.static,
      private: modifiers.private,
      name: fieldName.value,
      type,
      initializer,
      span: span(methodStart, initializer?.span.end ?? type.span.end),
    };
  }

  /**
// D45 rule 79 (CLS-U1): `set name(value):` is the JavaScript accessor
// shape. VelarScript has no setters (section 19), and the shape used to
// fall through to three generic cascades that never said so. `get` has
// its own parse path, so `set` gets the matching recognition — used only
// to teach the rejection. `def set(...)` and a field named `set` are
// other shapes and stay legal.
   */
  private refuseClassSetter(modifiers: { readonly abstract: boolean; readonly override: boolean; readonly static: boolean; readonly private: boolean; readonly asynchronous: boolean; readonly readonlyModifier: Token | null }): boolean {
    if (!(this.host.check("identifier") && this.host.current().value === "set"
      && this.host.peekKind(1) === "identifier" && this.host.peekKind(2) === "leftParen")) return false;
    const keyword = this.host.advance();
    const setterName = this.host.advance();
    this.host.reportClassMemberReadonly(modifiers.readonlyModifier, "executable", "VEL2021");
    const method = `set${setterName.value.slice(0, 1).toUpperCase()}${setterName.value.slice(1)}`;
    this.host.diagnostics.push(diagnostic(
      "VEL2007",
      `VelarScript classes have no setters; assign the field directly, or declare a method such as 'def ${method}(value: T)'`,
      span(keyword.span.start, setterName.span.end),
    ));
    this.host.skipMistypedDeclaration();
    return true;
  }

  /**
   * A class member that does not open with `def`: `pass`, a member declared
   * with another language's keyword — recovered as the method it meant when it
   * has that shape — or something the class body has no form for. The method
   * returned, when there is one, is the recovery's; `null` means the member
   * was answered without producing one.
   */
  private parseMistypedClassMember(methodStart: number, modifiers: { readonly abstract: boolean; readonly override: boolean; readonly static: boolean; readonly private: boolean; readonly asynchronous: boolean; readonly readonlyModifier: Token | null }): ClassMethodDeclaration | null {
    this.host.reportClassMemberReadonly(modifiers.readonlyModifier, "field", "VEL2021");
    if (this.host.match("pass")) {
      this.host.expectStatementEnd();
      return null;
    }
    const keywordGuidance = this.host.check("identifier") && this.host.peekKind(1) === "identifier"
      ? declarationKeywordGuidance(this.host.current().value)
      : null;
    if (keywordGuidance) {
      const shape = this.host.peekKind(2);
      if (keywordGuidance.keyword === "def" && (shape === "leftParen" || shape === "less")) {
        this.host.diagnostics.push(recoveredDiagnostic("VEL2026", keywordGuidance.message, this.host.current().span,
          mechanicalFix(this.host.current().span, keywordGuidance.keyword, `Use '${keywordGuidance.keyword}'`)));
        this.host.advance();
        return this.parseClassMethod(methodStart, modifiers.asynchronous, modifiers.abstract, modifiers.override, modifiers.static, modifiers.private);
      }
      this.host.diagnostics.push(diagnostic("VEL2026", keywordGuidance.message, this.host.current().span));
      this.host.skipMistypedDeclaration();
      return null;
    }
    this.host.diagnostics.push(diagnostic("VEL2007", "Class bodies contain const/let fields, one constructor, get properties, methods, or 'pass'", this.host.current().span));
    this.host.synchronize();
    return null;
  }

  private parseClassGetter(
    start: number,
    abstract: boolean,
    override: boolean,
    static_: boolean,
    private_: boolean,
    asynchronous: boolean,
  ): ClassGetterDeclaration {
    const name = this.host.expectMemberName("Expected a getter name");
    if (this.host.check("less")) {
      this.host.parseTypeParameters();
      this.host.diagnostics.push(diagnostic("VEL2023", "A getter cannot declare type parameters", name.span));
    }
    this.host.expect("leftParen", "Expected '(' after a getter name");
    if (!this.host.check("rightParen")) {
      this.host.diagnostics.push(diagnostic("VEL2023", "A getter cannot accept parameters", this.host.current().span));
      while (!this.host.check("rightParen") && !this.host.check("newline") && !this.host.check("eof")) this.host.advance();
    }
    this.host.expect("rightParen", "Expected ')' after a getter name");
    let returnType: TypeReference;
    if (this.host.match("arrow")) {
      returnType = this.host.parseTypeReference();
    } else {
      this.host.diagnostics.push(diagnostic("VEL2023", "A getter requires an explicit result type", name.span));
      returnType = { syntax: { kind: "NamedTypeSyntax", name: "unknown", span: name.span }, span: name.span };
    }
    if (asynchronous) {
      this.host.diagnostics.push(diagnostic("VEL2023", "A getter cannot be async; expose an ordinary async method instead", span(start, returnType.span.end)));
    }
    if (abstract) {
      this.host.expectStatementEnd();
      return {
        kind: "FunctionDeclaration",
        exported: false,
        asynchronous: false,
        accessor: true,
        abstract,
        override,
        static: static_,
        private: private_,
        name: name.value,
        parameters: [],
        returnType,
        signatureSpan: span(start, returnType.span.end),
        body: [],
        span: span(start, returnType.span.end),
      };
    }
    const body = this.host.parseBlock();
    return {
      kind: "FunctionDeclaration",
      exported: false,
      asynchronous: false,
      accessor: true,
      abstract,
      override,
      static: static_,
      private: private_,
      name: name.value,
      parameters: [],
      returnType,
      signatureSpan: span(start, returnType.span.end),
      body,
      span: span(start, body.at(-1)?.span.end ?? returnType.span.end),
    };
  }

  private parseClassMethod(
    start: number,
    asynchronous: boolean,
    abstract: boolean,
    override: boolean,
    static_: boolean,
    private_: boolean,
  ): ClassMethodDeclaration {
    const name = this.host.expectMemberName("Expected a method name");
    const typeParameters = this.host.parseTypeParameters();
    const parameters = this.host.parseParameters();
    const parameterListEnd = this.host.previous().span.end;
    const returnType = this.host.match("arrow") ? this.host.parseTypeReference() : null;
    if (abstract) {
      this.host.expectStatementEnd();
      return {
        kind: "FunctionDeclaration",
        exported: false,
        asynchronous,
        abstract,
        override,
        static: static_,
        private: private_,
        name: name.value,
        ...(typeParameters ? { typeParameters } : {}),
        parameters,
        returnType,
        signatureSpan: span(start, returnType?.span.end ?? parameterListEnd),
        body: [],
        span: span(start, returnType?.span.end ?? name.span.end),
      };
    }
    const body = this.host.parseBlock();
    return {
      kind: "FunctionDeclaration",
      exported: false,
      asynchronous,
      abstract,
      override,
      static: static_,
      private: private_,
      name: name.value,
      ...(typeParameters ? { typeParameters } : {}),
      parameters,
      returnType,
      ...(returnType ? { resultAnnotationSpan: span(parameterListEnd, returnType.span.end) } : {}),
      signatureSpan: span(start, returnType?.span.end ?? parameterListEnd),
      body,
      span: span(start, body.at(-1)?.span.end ?? returnType?.span.end ?? name.span.end),
    };
  }

  private parseClassConstructorParameters(): readonly ClassParameter[] {
    this.host.expect("leftParen", "Expected '('");
    const parameters: ClassParameter[] = [];
    let sawDefault = false;
    if (!this.host.check("rightParen")) {
      do {
        const rest = this.host.match("ellipsis");
        let private_ = this.host.match("private");
        const invalidStatic = this.host.match("static") ? this.host.previous() : null;
        if (!private_) private_ = this.host.match("private");
        const binding = this.host.match("const") ? "const" : this.host.match("let") ? "let" : null;
        const name = this.host.expectBindingName("Expected a constructor parameter name", "parameter name");
        const type = this.host.match("colon") ? this.host.parseTypeReference() : null;
        const defaultValue = this.host.match("assign") ? this.host.parseExpression() : null;
        const parameterSpan = span(name.span.start, defaultValue?.span.end ?? type?.span.end ?? name.span.end);
        if (invalidStatic) {
          this.host.diagnostics.push(diagnostic("VEL2021", "Constructor parameters cannot be static", invalidStatic.span));
        }
        if (private_ && !binding) {
          this.host.diagnostics.push(diagnostic("VEL2021", "A private constructor parameter must declare a field with 'const' or 'let'", parameterSpan));
        }
        if (binding && !type) {
          this.host.diagnostics.push(diagnostic("VEL2021", "Constructor parameter fields require an explicit type", parameterSpan));
        }
        // Source constructors lower to `constructor(...)` parameter lists that
        // the class shape counts as fixed arity, so a rest spelling is either
        // uncallable or silently wrong at runtime. Extern class declarations
        // keep rest support: they describe existing JavaScript constructors.
        if (rest) {
          this.host.diagnostics.push(diagnostic("VEL2016", "Class constructors do not support rest parameters", name.span));
        }
        if (!rest && !defaultValue && sawDefault) {
          this.host.diagnostics.push(diagnostic("VEL2016", "A required parameter cannot follow a parameter with a default value", parameterSpan));
        }
        parameters.push({
          name: name.value,
          type,
          defaultValue,
          rest,
          binding,
          private: private_ && binding !== null,
          span: parameterSpan,
        });
        if (!rest && defaultValue) sawDefault = true;
      } while (this.host.match("comma") && !this.host.check("rightParen"));
    }
    this.host.expect("rightParen", "Expected ')' after constructor parameters");
    return parameters;
  }

  parseExternClass(start: number): ExternClassDeclaration {
    const { name, base } = this.parseExternClassHead();
    let parameters: ClassParameter[] = [];
    const fields: ExternClassFieldDeclaration[] = [];
    const getters: ExternClassGetterDeclaration[] = [];
    const methods: ExternClassMethodDeclaration[] = [];
    let constructorSeen = false;
    this.host.consumeNewlines();

    while (!this.host.check("dedent") && !this.host.check("eof")) {
      const memberStart = this.host.current().span.start;
      if (this.host.match("pass")) {
        this.host.expectStatementEnd();
        this.host.consumeNewlines();
        continue;
      }
      if (this.host.checkWord(CORE_WORDS.constructor)) {
        this.host.advance();
        const constructorParameters = this.host.parseParameters();
        this.host.reportUntypedExternParameters(constructorParameters);
        if (constructorSeen) {
          this.host.diagnostics.push(diagnostic("VEL2022", `Extern class '${name.value}' has more than one constructor`, span(memberStart, this.host.previous().span.end)));
        } else {
          parameters = constructorParameters.map((parameter) => ({ ...parameter, binding: null, private: false }));
          constructorSeen = true;
        }
        this.host.expectStatementEnd();
        this.host.consumeNewlines();
        continue;
      }
      let static_ = false;
      let asynchronous = false;
      let scanningModifiers = true;
      // CLS-I5: reported once the member kind is known — see the source class
      // body; an extern getter or method has no read-only contract either.
      let readonlyModifier: Token | null = null;
      while (scanningModifiers) {
        if (this.host.match("static")) static_ = true;
        else if (this.host.match("async")) asynchronous = true;
        else if (this.host.checkWord(CORE_WORDS.readonly)) readonlyModifier = this.host.advance();
        else scanningModifiers = false;
      }
      const mutable = this.host.match("let");
      const readonly = !mutable && this.host.match("const");
      if (mutable || readonly) {
        this.host.reportClassMemberReadonly(readonlyModifier, "field", "VEL2010");
        if (asynchronous) this.host.diagnostics.push(diagnostic("VEL2010", "Extern class fields cannot be async", this.host.previous().span));
        const fieldName = this.host.expectMemberName("Expected an extern class field name");
        this.host.expect("colon", "Expected ':' after an extern class field name");
        const type = this.host.parseTypeReference();
        fields.push({ static: static_, mutable, name: fieldName.value, type, span: span(memberStart, type.span.end) });
        this.host.expectStatementEnd();
        this.host.consumeNewlines();
        continue;
      }
      if (this.host.checkWord(CORE_WORDS.get)) {
        this.host.advance();
        this.host.reportClassMemberReadonly(readonlyModifier, "executable", "VEL2010");
        const getterName = this.host.expectMemberName("Expected an extern class getter name");
        this.host.expect("leftParen", "Expected '(' after an extern getter name");
        if (!this.host.check("rightParen")) {
          this.host.diagnostics.push(diagnostic("VEL2023", "An extern getter cannot accept parameters", this.host.current().span));
          while (!this.host.check("rightParen") && !this.host.check("newline") && !this.host.check("eof")) this.host.advance();
        }
        this.host.expect("rightParen", "Expected ')' after an extern getter name");
        let type: TypeReference;
        if (this.host.match("arrow")) {
          type = this.host.parseTypeReference();
        } else {
          this.host.diagnostics.push(diagnostic("VEL4023", `Extern getter '${getterName.value}' requires an explicit result annotation`, getterName.span));
          type = { syntax: { kind: "NamedTypeSyntax", name: "unknown", span: getterName.span }, span: getterName.span };
        }
        if (asynchronous) this.host.diagnostics.push(diagnostic("VEL2023", "An extern getter cannot be async; expose an ordinary async method instead", span(memberStart, type.span.end)));
        getters.push({ static: static_, name: getterName.value, type, span: span(memberStart, type.span.end) });
        this.host.expectStatementEnd();
        this.host.consumeNewlines();
        continue;
      }
      if (this.host.match("def")) {
        this.host.reportClassMemberReadonly(readonlyModifier, "executable", "VEL2010");
        const methodName = this.host.expectMemberName("Expected an extern class method name");
        const typeParameters = this.host.parseTypeParameters();
        const methodParameters = this.host.parseParameters();
        this.host.reportUntypedExternParameters(methodParameters);
        const parameterListEnd = this.host.previous().span.end;
        const returnType = this.host.match("arrow") ? this.host.parseTypeReference() : null;
        methods.push({
          static: static_,
          asynchronous,
          name: methodName.value,
          ...(typeParameters ? { typeParameters } : {}),
          parameters: methodParameters,
          returnType,
          signatureSpan: span(memberStart, returnType?.span.end ?? parameterListEnd),
          span: span(memberStart, returnType?.span.end ?? this.host.previous().span.end),
        });
        if (this.host.reportExternDeclarationBody()) {
          this.host.consumeNewlines();
          continue;
        }
        this.host.expectStatementEnd();
        this.host.consumeNewlines();
        continue;
      }
      this.host.diagnostics.push(diagnostic("VEL2010", "Extern class bodies declare fields with const/let, one constructor signature, getters with get, methods with def, or 'pass'", this.host.current().span));
      this.host.synchronize();
      this.host.consumeNewlines();
    }
    const close = this.host.expect("dedent", "Expected the end of an extern class body");
    return { name: name.value, parameters, base, fields, getters, methods, span: span(start, Math.max(fields.at(-1)?.span.end ?? start, getters.at(-1)?.span.end ?? start, methods.at(-1)?.span.end ?? start, close.span.end)) };
  }

  /**
   * An extern class's head: its name, the two shapes it is refused for (type
   * parameters, and a constructor written as a parameter list rather than as a
   * `constructor(...)` member), its base, and the block opener.
   */
  private parseExternClassHead(): { readonly name: Token; readonly base: string | null } {
    const name = this.host.expect("identifier", "Expected an extern class name");
    // BRG-U6: a generic extern class gets the same polite rejection as a
    // source class instead of a bare parse cascade; generic extern `def`
    // members remain the generic surface.
    if (this.host.check("less")) {
      this.host.diagnostics.push(diagnostic(
        "VEL2025",
        `Extern class '${name.value}' cannot declare type parameters; declare the class without them and use generic 'def' members or 'unknown' where the type varies`,
        this.host.current().span,
      ));
      this.host.parseTypeParameters();
    }
    if (this.host.check("leftParen")) {
      this.host.diagnostics.push(diagnostic("VEL2022", `Extern class '${name.value}' declares its constructor in the class body with 'constructor(...)'`, this.host.current().span));
      this.parseExternClassParameters();
    }
    const base = this.host.match("extends") ? this.host.expect("identifier", "Expected an extern base class name after 'extends'").value : null;
    this.host.expect("colon", "Expected ':' before an extern class body");
    this.host.expect("newline", "Expected a newline before an extern class body");
    this.host.consumeNewlines();
    this.host.expect("indent", "Expected an indented extern class body");
    return { name, base };
  }

  private parseExternClassParameters(): readonly ClassParameter[] {
    this.host.expect("leftParen", "Expected '('");
    const parameters: ClassParameter[] = [];
    let sawRest = false;
    let sawDefault = false;
    if (!this.host.check("rightParen")) {
      do {
        const rest = this.host.match("ellipsis");
        const binding = this.host.match("const") ? "const" : this.host.match("let") ? "let" : null;
        const name = this.host.expectBindingName("Expected an extern class parameter name", "parameter name");
        const type = this.host.match("colon") ? this.host.parseTypeReference() : null;
        const defaultValue = this.host.match("assign") ? this.host.parseExpression() : null;
        const parameterSpan = span(name.span.start, defaultValue?.span.end ?? type?.span.end ?? name.span.end);
        if (sawRest) this.host.diagnostics.push(diagnostic("VEL2016", "A rest parameter must be the final parameter", parameterSpan));
        if (rest && !type) this.host.diagnostics.push(diagnostic("VEL2016", REST_PARAMETER_ELEMENT_TYPE_MESSAGE, parameterSpan));
        if (rest && defaultValue) this.host.diagnostics.push(diagnostic("VEL2016", "A rest parameter cannot have a default value", parameterSpan));
        if (rest && binding) this.host.diagnostics.push(diagnostic("VEL2016", "A rest parameter cannot declare a class field", parameterSpan));
        if (!rest && !defaultValue && sawDefault && !sawRest) {
          this.host.diagnostics.push(diagnostic("VEL2016", "A required parameter cannot follow a parameter with a default value", parameterSpan));
        }
        parameters.push({ name: name.value, binding, private: false, type, defaultValue, rest, span: parameterSpan });
        if (!rest && defaultValue) sawDefault = true;
        sawRest ||= rest;
      } while (this.host.match("comma") && !this.host.check("rightParen"));
    }
    this.host.expect("rightParen", "Expected ')' after extern class parameters");
    return parameters;
  }
}
