import type {
  AssignmentStatement,
  ContextMarker,
  Expression,
  IdentifierExpression,
  MemberExpression,
  Parameter,
  Program,
  Statement,
  TypeParameterDeclaration,
  TypeReference,
  TestDeclaration,
  TypeSyntax,
} from "./ast.ts";
import type { AdvisorySuppression } from "./advisory-suppression.ts";
import { statementOwnsBlock } from "./ast.ts";
import { CORE_COMPILER_CONTEXTUAL_NAMES, CORE_WORDS } from "./core-vocabulary.ts";
import { diagnostic, mechanicalEdits, mechanicalFix, recoveredDiagnostic, type Advisory, type Diagnostic, type DiagnosticFix } from "./diagnostic.ts";
import type { CompilerLexicalExtension } from "./extension.ts";
import { declarationKeywordGuidance, sourceTypeNameGuidance, REST_PARAMETER_ELEMENT_TYPE_MESSAGE } from "./language-guidance.ts";
import { Lexer } from "./lexer.ts";
import { memberNameKinds } from "./parser/tokens.ts";
import { OperatorParser, type OperatorParserHost } from "./parser/expressions/operators.ts";
import { PostfixParser, type PostfixParserHost } from "./parser/expressions/postfix.ts";
import { PrimaryParser, type PrimaryParserHost } from "./parser/expressions/primary.ts";
import { PatternParser, type PatternParserHost } from "./parser/patterns.ts";
import { ClassParser, type ClassParserHost } from "./parser/statements/classes.ts";
import { ControlFlowParser, type ControlFlowParserHost } from "./parser/statements/control-flow.ts";
import { DeclarationParser, type DeclarationParserHost } from "./parser/statements/declarations.ts";
import { ModuleParser, type ModuleParserHost } from "./parser/statements/modules.ts";
import { TypeSyntaxParser, type TypeSyntaxParserHost } from "./parser/type-syntax.ts";
import { span, type Span } from "./source.ts";
import { keywordKinds, type Token, type TokenKind } from "./token.ts";

// A generic close that runs into the next operator lexes as one token: `>>`,
// `>>>`, and — where a default value or an assignment follows the annotation —
// `>=`, `>>=`, `>>>=`. Each maps to what is left after one `>` is taken for
// the close, so `List<number>=[1]` reads as the annotation and the `=` the
// author wrote. The lexer keeps emitting the compound operators, so the
// expression grammar is untouched.
const typeGreaterRemainderKinds = new Map<TokenKind, TokenKind>([
  ["rightShift", "greater"],
  ["unsignedRightShift", "rightShift"],
  ["greaterEqual", "assign"],
  ["rightShiftAssign", "greaterEqual"],
  ["unsignedRightShiftAssign", "rightShiftAssign"],
]);
// 一层语法嵌套要花掉八个左右的 JavaScript 栈帧（parseExpression → … →
// parsePrimary → parseExpression），实测冷启动的 V8 在 400–500 层之间就已经把
// Node 主线程的栈用完了 —— 也就是说 512 这个预算根本来不及生效，同一份源码是编译
// 通过还是报「嵌套过深」，取决于 JIT 有没有热身、宿主的线程栈有多大。预算必须低到
// 永远抢在栈前面才算数，所以取 256：它比真实语料里最深的模块（13 层）高一个数量级
// 以上，又给栈更小的宿主（浏览器 worker）留了一倍余量。index.ts 的 AST 深度门取
// 同一个数。
const MAX_PARSE_DEPTH = 256;
// An interpolation re-enters the compiler — a fresh lex and a fresh parse of
// the fragment — so one nest holds far more JavaScript stack than one ordinary
// expression level. Charging it a block of the budget keeps
// PARSER_COMPLEXITY_FAILURE ahead of the stack, which is what turns a
// pathological f-string into one diagnostic instead of seconds of work ended
// by a stack overflow. 32 nested interpolations remain available, which is
// orders of magnitude past any spelling a reader can follow.
const NESTED_EXPRESSION_PARSE_COST = 8;
const PARSER_COMPLEXITY_FAILURE = Object.freeze({ kind: "VelarParserComplexityFailure" });

export function isParserComplexityFailure(value: unknown): boolean {
  return value === PARSER_COMPLEXITY_FAILURE;
}

export interface ParseResult {
  readonly program: Program;
  readonly diagnostics: readonly Diagnostic[];
  /** D89: the advisory channel, accumulated beside the diagnostics and never merged into them. */
  readonly advisories: readonly Advisory[];
  /**
   * D103: the `velar-allow` suppressions carried by comments the module lexer
   * never saw, because they sit inside a region an extension scanner claimed
   * whole — a `look:` block, a `keyframes:` block, an f-string interpolation.
   * Those regions are lexed again by `parseNestedExpression`, and its lexer's
   * suppressions used to be dropped on the floor: a `velar-allow` written on a
   * Look entry silenced nothing and a stale one was never reported, so a
   * suppression could rot in place there — the exact failure the charter's
   * third suppression rule exists to prevent.
   */
  readonly suppressions: readonly AdvisorySuppression[];
}

export interface ExpressionParseResult {
  readonly expression: Expression;
  readonly diagnostics: readonly Diagnostic[];
  readonly advisories: readonly Advisory[];
  readonly suppressions: readonly AdvisorySuppression[];
}



// An extension's contextual keyword directly followed by ':' opens an
// indentation-owned extension block whose capture depends on physical lines; a
// bracket fragment containing one keeps line-sensitive form.
function containsExtensionBlockStart(tokens: readonly Token[], words: ReadonlySet<string>): boolean {
  return tokens.some((token, index) => token.kind === "identifier" && words.has(token.value) && tokens[index + 1]?.kind === "colon");
}

// Statement-boundary guidance names the leftover token as the author typed it.
// Long literals are clipped so one runaway string cannot swamp the message.
function describeStatementToken(token: Token): string {
  const text = token.value;
  if (!text) return token.kind;
  return text.length > 24 ? `${text.slice(0, 24)}…` : text;
}


/**
 * Why a word cannot name a `type`, `class`, or `enum`, when it cannot; `null`
 * when it can. The three reasons are one rule: a type position cannot spell the
 * name as itself, so a declaration under it would be unreachable from every
 * annotation.
 *
 * A reserved word reads as its keyword or literal everywhere. `readonly` reads
 * as the read-only view modifier, which `parseSingleTypeReference` takes before
 * it reads a name at all. A guided spelling with a replacement is rewritten to
 * that replacement in every type position, so the declaration and its uses
 * would name two different types.
 */
function refusedDeclarationName(token: Token): { readonly because: string; readonly instead: string } | null {
  if (token.kind !== "identifier") {
    if (!Object.hasOwn(keywordKinds, token.value)) return null;
    const literal = token.value === "true" || token.value === "false" || token.value === "null";
    return { because: "is a reserved word", instead: literal ? "the literal" : "the keyword" };
  }
  if (token.value === CORE_WORDS.readonly) return { because: "is the read-only view modifier", instead: "the modifier" };
  // A guidance entry without a replacement leaves the name meaning the
  // declaration, so it is still a name; only a redirected spelling is refused.
  const replacement = sourceTypeNameGuidance(token.value)?.replacement ?? null;
  if (replacement === null) return null;
  return { because: `is guided to '${replacement}' in every type position`, instead: `'${replacement}'` };
}


const assignmentOperators: Partial<Record<TokenKind, AssignmentStatement["operator"]>> = {
  assign: "=",
  plusAssign: "+=",
  minusAssign: "-=",
  starAssign: "*=",
  slashAssign: "/=",
  percentAssign: "%=",
  bitOrAssign: "|=",
  bitAndAssign: "&=",
  bitXorAssign: "^=",
  leftShiftAssign: "<<=",
  rightShiftAssign: ">>=",
  unsignedRightShiftAssign: ">>>=",
};

export class Parser {
  // Keep a private mutable token view so a run of adjacent `>` characters can
  // be consumed one close at a time while parsing nested generic types. The
  // lexer must still emit `>>` and `>>>` as shift operators in expressions;
  // splitting them here is contextual and therefore preserves both grammars.
  private readonly tokens: Token[];
  protected readonly lexicalExtensions: readonly CompilerLexicalExtension[];
  protected readonly diagnostics: Diagnostic[] = [];
  protected readonly advisories: Advisory[] = [];
  protected readonly suppressions: AdvisorySuppression[] = [];
  private readonly genericCallableNames = new Set<string>();
  private readonly contextMarkers: ContextMarker[] = [];
  /** Extension-owned contextual keywords: names until a shape claims them. */
  protected readonly contextualKeywords: ReadonlySet<string>;
  private index = 0;
  private parseDepth = 0;
  private statementBlockDepth = 0;
  private recoveredImportDelimiterBoundary = false;
  /**
   * D65 rule 170: non-zero while `parseParameters` is reading an arrow's
   * parameter list — the one list a contextual function type can still type.
   * It is a field rather than an argument because `packages/web` overrides
   * `parseParameters()` and forwards to `super.parseParameters()`, so an added
   * argument would be silently dropped for every arrow inside a web module.
   */
  private contextualParameterDepth = 0;

  // D114 R1c: the nine syntax families the parser owns as collaborators rather
  // than as more of itself. `Parser` stays the class Web and Node subclass —
  // every `protected` member is still declared here — and each collaborator
  // reaches back through the interface it declared, which is the exact record
  // of what that family depends on.
  private readonly typeSyntax: TypeSyntaxParser;
  private readonly patterns: PatternParser;
  private readonly declarations: DeclarationParser;
  private readonly classSyntax: ClassParser;
  private readonly controlFlow: ControlFlowParser;
  private readonly modules: ModuleParser;
  private readonly operators: OperatorParser;
  private readonly postfix: PostfixParser;
  private readonly primary: PrimaryParser;

  /**
   * The one object every collaborator is handed. Its properties are live reads
   * of the parser: the token cursor moves under the collaborators, so `index`,
   * `current()` and the diagnostics array must be the parser's own and not a
   * snapshot taken when the collaborator was built.
   */
  private parserHost(): TypeSyntaxParserHost
    & PatternParserHost
    & DeclarationParserHost
    & ClassParserHost
    & ControlFlowParserHost
    & ModuleParserHost
    & OperatorParserHost
    & PostfixParserHost
    & PrimaryParserHost {
    const parser = this;
    return {
      advance: () => parser.advance(),
      check: (kind) => parser.check(kind),
      checkExactIntegerLiteral: (text, written, literalSpan, negative) => parser.primary.checkExactIntegerLiteral(text, written, literalSpan, negative),
      checkTypeGreater: () => parser.checkTypeGreater(),
      checkWord: (value) => parser.checkWord(value),
      consumeNewlines: () => parser.consumeNewlines(),
      get contextMarkers() { return parser.contextMarkers; },
      get contextualKeywords() { return parser.contextualKeywords; },
      get contextualParameterDepth() { return parser.contextualParameterDepth; },
      set contextualParameterDepth(value) { parser.contextualParameterDepth = value; },
      current: () => parser.current(),
      get diagnostics() { return parser.diagnostics; },
      expect: (kind, message) => parser.expect(kind, message),
      expectBindingName: (message, noun) => parser.expectBindingName(message, noun),
      expectMemberName: (message) => parser.expectMemberName(message),
      expectStatementEnd: () => parser.expectStatementEnd(),
      expectTypeGreater: (message) => parser.expectTypeGreater(message),
      expectWord: (value, message) => parser.expectWord(value, message),
      get genericCallableNames() { return parser.genericCallableNames; },
      get index() { return parser.index; },
      set index(value) { parser.index = value; },
      match: (kind) => parser.match(kind),
      matchWord: (value) => parser.matchWord(value),
      numberLiteral: (token, negative, literalSpan) => parser.primary.numberLiteral(token, negative, literalSpan),
      parseBindingPattern: () => parser.patterns.parseBindingPattern(),
      parseBlock: () => parser.parseBlock(),
      parseDeclarationName: (noun) => parser.parseDeclarationName(noun),
      parseExpression: (minimumPrecedence) => parser.parseExpression(minimumPrecedence),
      parseExtensionExpression: (_token) => parser.parseExtensionExpression(_token),
      parseExtensionNumericLiteral: (token, value, unit) => parser.parseExtensionNumericLiteral(token, value, unit),
      parseExternClass: (start) => parser.classSyntax.parseExternClass(start),
      parseMatchPattern: (root) => parser.patterns.parseMatchPattern(root),
      parseNestedExpression: (fragment, offset, bracketFragment, sourceOffsets) => parser.parseNestedExpression(fragment, offset, bracketFragment, sourceOffsets),
      parseParameters: () => parser.parseParameters(),
      parsePostfix: () => parser.postfix.parsePostfix(),
      parsePrimary: () => parser.primary.parsePrimary(),
      parseSpreadExpression: () => parser.primary.parseSpreadExpression(),
      parseStatement: () => parser.parseStatement(),
      parseTypeArgumentList: () => parser.parseTypeArgumentList(),
      parseTypeParameters: () => parser.parseTypeParameters(),
      parseTypeReference: (allowTrailingOptional) => parser.parseTypeReference(allowTrailingOptional),
      peekKind: (distance) => parser.peekKind(distance),
      peekValue: (distance) => parser.peekValue(distance),
      previous: () => parser.previous(),
      recoverExpressionAssignment: (expression) => parser.recoverExpressionAssignment(expression),
      get recoveredImportDelimiterBoundary() { return parser.recoveredImportDelimiterBoundary; },
      set recoveredImportDelimiterBoundary(value) { parser.recoveredImportDelimiterBoundary = value; },
      reportClassMemberReadonly: (modifier, member, code) => parser.reportClassMemberReadonly(modifier, member, code),
      reportExternDeclarationBody: () => parser.reportExternDeclarationBody(),
      reportPrefixBang: (bang) => parser.reportPrefixBang(bang),
      reportUntypedExternParameters: (parameters) => parser.reportUntypedExternParameters(parameters),
      reservedWordMessage: (noun) => parser.reservedWordMessage(noun),
      reservedWordMessageFor: (token, noun) => parser.reservedWordMessageFor(token, noun),
      skipMistypedDeclaration: () => parser.skipMistypedDeclaration(),
      get statementBlockDepth() { return parser.statementBlockDepth; },
      synchronize: () => parser.synchronize(),
      get tokens() { return parser.tokens; },
      validateExtensionTypeArguments: (_name, _arguments, _nameSpan) => parser.validateExtensionTypeArguments(_name, _arguments, _nameSpan),
      withParseDepth: <T>(parse: () => T) => parser.withParseDepth(parse),
    };
  }

  constructor(tokens: readonly Token[], lexicalExtensions: readonly CompilerLexicalExtension[] = []) {
    this.tokens = [...tokens];
    this.lexicalExtensions = lexicalExtensions;
    this.contextualKeywords = new Set(lexicalExtensions.flatMap((extension) => [...extension.contextualKeywords ?? []]));
    for (let index = 0; index + 2 < tokens.length; index += 1) {
      if (tokens[index]?.kind === "def" && tokens[index + 1]?.kind === "identifier" && tokens[index + 2]?.kind === "less") {
        this.genericCallableNames.add(tokens[index + 1]!.value);
      }
    }
    const host = this.parserHost();
    this.typeSyntax = new TypeSyntaxParser(host);
    this.patterns = new PatternParser(host);
    this.declarations = new DeclarationParser(host);
    this.classSyntax = new ClassParser(host);
    this.controlFlow = new ControlFlowParser(host);
    this.modules = new ModuleParser(host);
    this.operators = new OperatorParser(host);
    this.postfix = new PostfixParser(host);
    this.primary = new PrimaryParser(host);
  }

  parse(): ParseResult {
    const body: Statement[] = [];
    this.consumeNewlines();

    while (!this.check("eof")) {
      if (this.match("dedent")) {
        this.diagnostics.push(diagnostic("VEL2004", "Unexpected end of an indented block", this.previous().span));
        continue;
      }

      const statement = this.parseStatement();
      if (statement) {
        body.push(statement);
      } else {
        this.synchronize();
      }
      this.finishStatementBoundary();
      this.consumeNewlines();
    }

    this.declarations.validateMainBlocks(body);

    const end = this.current().span.end;
    return {
      program: {
        kind: "Program",
        body,
        ...(this.contextMarkers.length > 0 ? { contextMarkers: this.contextMarkers } : {}),
        span: span(0, end),
      },
      diagnostics: this.diagnostics,
      advisories: this.advisories,
      suppressions: this.suppressions,
    };
  }

  parseExpressionFragment(): ExpressionParseResult {
    this.consumeNewlines();
    const expression = this.recoverExpressionAssignment(this.parseExpression());
    this.consumeNewlines();
    if (!this.check("eof")) {
      this.diagnostics.push(diagnostic("VEL2006", "Unexpected tokens in interpolated expression", this.current().span));
    }
    return { expression, diagnostics: this.diagnostics, advisories: this.advisories, suppressions: this.suppressions };
  }

  // An assignment written where only an expression is valid (an interpolated
  // fragment or an arrow body) receives directive guidance and recovers as an
  // AssignmentExpression node, so later stages can report their own guidance
  // for the same code instead of a bare unexpected-token cascade.
  private recoverExpressionAssignment(expression: Expression): Expression {
    const operator = assignmentOperators[this.current().kind];
    if (!operator) return expression;
    const operatorToken = this.advance();
    this.diagnostics.push(recoveredDiagnostic(
      "VEL2028",
      "Assignment is a statement, not an expression; write it on its own line inside a function, action, or handler body",
      operatorToken.span,
    ));
    this.reportInvalidAssignmentTarget(expression);
    const value = this.recoverExpressionAssignment(this.parseExpression());
    return { kind: "AssignmentExpression", target: expression, operator, value, span: span(expression.span.start, value.span.end) };
  }

  protected parseStatement(): Statement | null {
    return this.withParseDepth(() => this.parseStatementBody());
  }

  /**
   * The statement dispatcher. Each phase below answers for one family of
   * statement heads and returns `undefined` when it did not claim the
   * statement, so the order the phases run in is the order the grammar reads
   * them — the same order this method read them as one 402-line chain.
   */
  private parseStatementBody(): Statement | null {
    const start = this.current().span.start;
    const moduleStatement = this.parseModuleStatement(start);
    if (moduleStatement !== undefined) return moduleStatement;
    const exported = this.match("export");
    const exportedStatement = this.parseExportedStatement(start, exported);
    if (exportedStatement !== undefined) return exportedStatement;
    const abstract = this.match("abstract");
    const asynchronous = this.match("async");
    const asyncToken = asynchronous ? this.previous() : null;
    const modifiedStatement = this.parseModifiedStatement(start, exported, abstract, asynchronous, asyncToken);
    if (modifiedStatement !== undefined) return modifiedStatement;
    const contextualKeywordStatement = this.parseContextualKeywordStatement(start, exported);
    if (contextualKeywordStatement !== undefined) return contextualKeywordStatement;
    const retiredStatementSpelling = this.parseRetiredStatementSpelling(start, exported, asynchronous);
    if (retiredStatementSpelling !== undefined) return retiredStatementSpelling;

    if (exported) {
      this.diagnostics.push(diagnostic("VEL2001", "'export' must be followed by a declaration", this.previous().span));
      return null;
    }
    const controlStatement = this.parseControlStatement(start);
    if (controlStatement !== undefined) return controlStatement;

    const expression = this.parseExpression();
    const operator = assignmentOperators[this.current().kind];
    if (operator) {
      this.advance();
      this.reportInvalidAssignmentTarget(expression);
      const value = this.parseExpression();
      return {
        kind: "AssignmentStatement",
        target: expression as AssignmentStatement["target"],
        operator,
        value,
        span: span(expression.span.start, value.span.end),
      };
    }

    return { kind: "ExpressionStatement", expression, span: expression.span };
  }

  /**
   * The four statement heads that are decided before any modifier: the
   * `@context(...)` marker, `import`, `extern`, and `unsafe`. `undefined` means
   * no rule here claimed the statement and the next phase gets it.
   */
  private parseModuleStatement(start: number): Statement | null | undefined {
    if (this.check("at") && this.peekKind(1) === "identifier"
      && this.peekValue(1) === CORE_COMPILER_CONTEXTUAL_NAMES.declaration[0]) {
      return this.declarations.parseContextMarkedDeclaration(start);
    }

    if (this.check("import") && this.tokens[this.index + 1]?.kind !== "leftParen") {
      this.advance();
      const extensionImport = this.parseExtensionImport(start);
      if (extensionImport !== undefined) return extensionImport;
      return this.modules.parseImport(start);
    }

    if (this.match("extern")) {
      if (this.match("js")) return this.modules.parseEmbeddedJavaScript(start, false);
      return this.modules.parseExternModule(start);
    }

    if (this.match("unsafe")) {
      const extensionStatement = this.parseUnsafeExtensionStatement(start);
      if (extensionStatement !== undefined) return extensionStatement;
      this.expect("js", "Expected 'js' after 'unsafe', or an unsafe block owned by an installed extension");
      return this.modules.parseEmbeddedJavaScript(start, true);
    }
    return undefined;
  }

  /**
   * What `export` can be followed by that is not an ordinary declaration: the
   * re-export forms, the JavaScript `export default` habit, a `readonly type`,
   * and the compiler-owned `@main` region, which is refused an export.
   */
  private parseExportedStatement(start: number, exported: boolean): Statement | null | undefined {
    // D50 rule 100: `export type {Name} from "..."` is the re-export half of the
    // TypeScript habit, recognized so it can be taught; `export type Name:` is
    // still an ordinary exported type declaration.
    if (exported && (this.check("leftBrace") || this.check("star")
      || (this.checkWord(CORE_WORDS.type) && (this.peekKind(1) === "leftBrace" || this.peekKind(1) === "star")))) {
      return this.modules.parseReExport(start);
    }
    // MOD-U2: `export default` is the JavaScript habit; VelarScript modules
    // have no default export, so the spelling gets one directed answer
    // instead of the generic export cascade.
    if (exported && this.check("identifier") && this.current().value === "default") {
      this.diagnostics.push(diagnostic(
        "VEL2001",
        "VelarScript modules have no default export; export the declaration by name — export const name = ..., export def name(...)",
        this.current().span,
      ));
      this.skipMistypedDeclaration();
      return { kind: "PassStatement", span: this.previous().span };
    }
    if (this.declarations.readonlyTypeDeclarationAhead()) {
      this.advance();
      this.advance();
      return this.declarations.parseTypeDefinition(start, exported, true);
    }
    // Core's module entry wins before a target extension examines other
    // contextual `@name` roles. This keeps `@main` available in Node/Web
    // entries while leaving route and lifecycle diagnostics with their owner.
    if (this.check("at") && this.peekKind(1) === "identifier"
      && this.peekValue(1) === CORE_COMPILER_CONTEXTUAL_NAMES.module[0]) {
      if (exported) {
        this.diagnostics.push(diagnostic(
          "VEL2022",
          "'@main' is a compiler-owned entry region and cannot be exported",
          span(start, this.current().span.end),
        ));
      }
      return this.declarations.parseCompilerOwnedModuleBlock(start);
    }
    return undefined;
  }

  /**
   * The declarations the `abstract` / `async` modifiers reach, and the two
   * statements that are spelled with a modifier word — `detach` and the retired
   * bare `async`. An installed extension is offered the statement first.
   */
  private parseModifiedStatement(start: number, exported: boolean, abstract: boolean, asynchronous: boolean, asyncToken: Token | null): Statement | null | undefined {
    if (!asynchronous && this.match("detach")) {
      const detachToken = this.previous();
      if (exported) this.diagnostics.push(diagnostic("VEL2001", "A 'detach' statement cannot be exported", detachToken.span));
      if (abstract) this.diagnostics.push(diagnostic("VEL2001", "'abstract' cannot prefix a 'detach' statement", detachToken.span));
      if (this.check("newline") || this.check("dedent") || this.check("eof")) {
        this.diagnostics.push(diagnostic("VEL2001", "'detach' must be followed by a Promise<null> expression", detachToken.span));
        return null;
      }
      const expression = this.parseExpression();
      return { kind: "DetachStatement", expression, span: span(start, expression.span.end) };
    }

    const extensionStatement = this.parseExtensionStatement(start, { exported, abstract, asynchronous });
    if (extensionStatement !== undefined) return extensionStatement;

    // No installed extension claimed this role, so the remaining `@name`
    // belongs to Core's closed module namespace and receives its vocabulary.
    if (this.check("at")) return this.declarations.parseCompilerOwnedModuleBlock(start);

    if (this.match("def")) {
      if (abstract) this.diagnostics.push(diagnostic("VEL2013", "Only class methods can be declared with 'abstract'", this.previous().span));
      return this.declarations.parseFunction(start, exported, asynchronous);
    }

    if (asynchronous && this.match("for")) {
      if (exported) this.diagnostics.push(diagnostic("VEL2001", "An async for loop cannot be exported", this.previous().span));
      if (abstract) this.diagnostics.push(diagnostic("VEL2001", "'abstract' cannot prefix an async for loop", this.previous().span));
      return this.controlFlow.parseForStatement(start, true);
    }

    if (asynchronous) {
      // `async` only declares asynchronous work. Detached execution has its
      // own verb, so the retired spelling gets one mechanical migration and
      // never remains a second legal form of the same operation.
      if (exported) this.diagnostics.push(diagnostic("VEL2001", "A detached statement cannot be exported", asyncToken!.span));
      if (abstract) this.diagnostics.push(diagnostic("VEL2001", "'abstract' cannot prefix a detached statement", asyncToken!.span));
      if (this.check("newline") || this.check("dedent") || this.check("eof")) {
        this.diagnostics.push(diagnostic("VEL2001", "'async' must be followed by 'def' or 'for'; use 'detach expression' for detached work", asyncToken!.span,
          mechanicalFix(asyncToken!.span, "detach", "Use 'detach' for detached work")));
        return null;
      }
      this.diagnostics.push(diagnostic("VEL2001", "'async' only declares 'async def' and 'async for'; use 'detach expression' for detached work", asyncToken!.span,
        mechanicalFix(asyncToken!.span, "detach", "Use 'detach' for detached work")));
      const expression = this.parseExpression();
      return { kind: "DetachStatement", expression, span: span(start, expression.span.end) };
    }

    if (abstract && !this.check("class")) {
      this.diagnostics.push(diagnostic("VEL2001", "'abstract' must be followed by 'class'", this.previous().span));
      return null;
    }

    if (this.declarations.typeDeclarationAhead()) {
      this.advance();
      return this.declarations.parseTypeDefinition(start, exported);
    }

    if (this.match("enum")) {
      return this.declarations.parseEnumDeclaration(start, exported);
    }

    if (this.match("class")) {
      return this.classSyntax.parseClassDeclaration(start, exported, abstract);
    }

    if (this.check("const") || this.check("let")) {
      return this.declarations.parseVariable(start, exported);
    }
    return undefined;
  }

  /**
   * The three contextual keywords whose statement shape no expression can have:
   * `match value:` above an indented `case`, `test "name":`, and `using x = …`.
   * Every other spelling of those words stays an ordinary name.
   */
  private parseContextualKeywordStatement(start: number, exported: boolean): Statement | null | undefined {
    // D30 item 16: `match` is a contextual keyword, recognized only by the
    // shape no expression can have — a header line ending in ':' whose
    // indented block opens with `case`. Every other `match` is a name, so
    // `match(value)` calls a function and `match = 1` assigns a binding. The
    // decision happens here, ahead of the unknown-declaration guidance, because
    // `match value:` is otherwise two adjacent identifiers.
    if (this.controlFlow.matchStatementAhead()) {
      if (exported) this.diagnostics.push(diagnostic("VEL2001", "A match statement cannot be exported", this.current().span));
      this.advance();
      return this.controlFlow.parseMatch(start);
    }

    // D39 item 53: `test "name":` is a contextual keyword — statement head, a
    // string literal, then a block. `test` stays an ordinary name everywhere
    // else, including `test(...)` and `const test = ...`.
    if (this.checkWord(CORE_WORDS.test)
      && this.peekKind(1) === "string" && this.peekKind(2) === "colon") {
      const keyword = this.advance();
      if (exported) this.diagnostics.push(diagnostic("VEL2001", "A test is discovered by the runner and is not exported", keyword.span));
      const title = this.advance();
      const body = this.parseBlock();
      return {
        kind: "TestDeclaration",
        title: title.value,
        titleSpan: title.span,
        body,
        span: span(start, body.at(-1)?.span.end ?? title.span.end),
      };
    }

    // D43 item 69: `using` is a contextual keyword — statement head, an
    // identifier, then `=`. Everywhere else `using` stays an ordinary name.
    if (this.checkWord(CORE_WORDS.using) && this.peekKind(1) === "identifier") {
      if (this.peekKind(2) === "assign") {
        const keyword = this.advance();
        if (exported) this.diagnostics.push(diagnostic("VEL2001", "A 'using' binding cannot be exported; it is released when its scope ends", keyword.span));
        return this.declarations.parseUsing(keyword.span.start);
      }
      if (this.peekKind(2) === "colon") {
        const keyword = this.current();
        const end = this.tokens[this.index + 2]?.span.end ?? keyword.span.end;
        this.diagnostics.push(diagnostic(
          "VEL2036",
          "A 'using' binding takes its type from the initializer; write 'using name = expression'",
          span(keyword.span.start, end),
        ));
        this.synchronize();
        return { kind: "PassStatement", span: keyword.span };
      }    }
    return undefined;
  }

  /**
   * The shapes that are a removed statement or another language's habit: the
   * `invert x` toggle, Python's `raise`, and a declaration written with the
   * wrong keyword. Each is claimed only by the exact shape it had, so
   * `invert(...)`, `raise.field` and `value name` keep their own meanings.
   */
  private parseRetiredStatementSpelling(start: number, exported: boolean, asynchronous: boolean): Statement | null | undefined {
    // MIG-4: 'invert x' was the removed toggle statement, and its leftover
    // operand otherwise falls into the generic statement-boundary message,
    // which never names the assignment that replaced it. 'invert' stayed an
    // ordinary identifier, so only the removed statement's own shape — the
    // bare word followed by a value name — is claimed here; 'invert(...)',
    // 'invert.field', and 'invert = ...' keep their ordinary meanings.
    if (this.check("identifier") && this.current().value === "invert" && this.peekKind(1) === "identifier") {
      const keyword = this.current();
      const target = this.describeInvertTarget(this.index + 1);
      this.synchronize();
      const removed = span(keyword.span.start, this.previous().span.end);
      this.diagnostics.push(diagnostic(
        "VEL2033",
        `Use '${target} = not ${target}'; the 'invert' statement was removed`,
        removed,
      ));
      return { kind: "PassStatement", span: removed };
    }

    // D89 (message correction): 'raise E(...)' is Python's spelling of the
    // statement VelarScript writes with 'throw'. Left alone it falls into the
    // unknown-declaration-keyword message below, which lists 'def', 'type',
    // 'enum', 'class', 'const', and 'let' and never names the one word that
    // was wrong. 'raise' stayed an ordinary identifier, so only the Python
    // statement's own shape — the bare word followed by the error value — is
    // claimed here; 'raise(...)', 'raise.field', and 'raise = ...' keep their
    // ordinary meanings. The recovery parses the rest as the throw it meant,
    // so the thrown value is checked in the same compile.
    if (this.check("identifier") && this.current().value === "raise" && this.peekKind(1) === "identifier") {
      const keyword = this.current();
      this.diagnostics.push(recoveredDiagnostic(
        "VEL2026",
        "Use 'throw'; VelarScript raises an error with 'throw value'",
        keyword.span,
        mechanicalFix(keyword.span, "throw", "Use 'throw'"),
      ));
      this.advance();
      const value = this.parseExpression();
      return { kind: "ThrowStatement", value, span: span(keyword.span.start, value.span.end) };
    }

    if (this.check("identifier") && this.peekKind(1) === "identifier") {
      const first = this.current();
      const guidance = declarationKeywordGuidance(first.value);
      if (guidance) {
        // Parse the remainder as the guided declaration whenever it has the
        // guided shape, so body-level and semantic-level guidance surfaces in
        // the same compile instead of hiding behind the skipped block.
        const shape = this.peekKind(2);
        if (guidance.keyword === "def" && (shape === "leftParen" || shape === "less")) {
          this.diagnostics.push(recoveredDiagnostic("VEL2026", guidance.message, first.span,
            mechanicalFix(first.span, guidance.keyword, `Use '${guidance.keyword}'`)));
          this.advance();
          return this.declarations.parseFunction(start, exported, asynchronous);
        }
        if (guidance.keyword === "type" && (shape === "colon" || shape === "assign")) {
          this.diagnostics.push(recoveredDiagnostic("VEL2026", guidance.message, first.span,
            mechanicalFix(first.span, guidance.keyword, `Use '${guidance.keyword}'`)));
          this.advance();
          return this.declarations.parseTypeDefinition(start, exported);
        }
        this.diagnostics.push(diagnostic("VEL2026", guidance.message, first.span));
        this.skipMistypedDeclaration();
        return { kind: "PassStatement", span: first.span };
      }
      const following = this.peekKind(2);
      if (following === "leftParen" || following === "colon") {
        // D51 (audit 12): `test` is a real declaration head, so calling it
        // unknown was false. What is wrong is the name's shape: a test name is
        // the sentence a report prints, so it is a string, not an identifier.
        this.diagnostics.push(diagnostic(
          "VEL2026",
          first.value === CORE_WORDS.test && following === "colon"
            ? `A test name is the sentence a report prints, so it is written as a string — 'test "${this.peekValue(1)}":'`
            : `Unknown declaration keyword '${first.value}'; VelarScript declarations start with 'def', 'type', 'enum', 'class', 'const', or 'let'`,
          first.span,
        ));
        this.skipMistypedDeclaration();
        return { kind: "PassStatement", span: first.span };
      }
    }
    return undefined;
  }

  /**
   * The statements that carry a value or a block and take no modifier: `return`,
   * `throw`, `assert`, `if`, `for`, `while`, `break`, `continue`, `try`, `pass`,
   * and the refusal for a clause with no block above it.
   */
  private parseControlStatement(start: number): Statement | null | undefined {
    if (this.match("return")) {
      const keyword = this.previous();
      const value = this.atStatementEnd() ? null : this.parseExpression();
      return { kind: "ReturnStatement", value, span: span(keyword.span.start, value?.span.end ?? keyword.span.end) };
    }

    if (this.match("throw")) {
      const keyword = this.previous();
      if (this.atStatementEnd()) {
        this.diagnostics.push(diagnostic("VEL2009", "'throw' requires an Error value", keyword.span));
        return null;
      }
      const value = this.parseExpression();
      return { kind: "ThrowStatement", value, span: span(keyword.span.start, value.span.end) };
    }

    if (this.match("assert")) {
      const keyword = this.previous();
      if (this.atStatementEnd()) {
        this.diagnostics.push(diagnostic("VEL2017", "'assert' requires a condition", keyword.span));
        return null;
      }
      const condition = this.parseExpression();
      let message = null;
      if (this.match("else")) {
        if (this.atStatementEnd()) {
          this.diagnostics.push(diagnostic("VEL2017", "'assert' requires a message after 'else'", this.previous().span));
        } else {
          message = this.parseExpression();
        }
      } else if (this.match("comma")) {
        const separator = this.previous();
        this.diagnostics.push(recoveredDiagnostic(
          "VEL2017",
          "Use 'assert condition else message'; an assertion message belongs to the failing branch",
          separator.span,
          // The next token's start absorbs whatever spacing followed the comma.
          this.atStatementEnd() ? undefined : mechanicalFix(span(separator.span.start, this.current().span.start), " else ", "Use 'assert condition else message'"),
        ));
        if (this.atStatementEnd()) {
          this.diagnostics.push(diagnostic("VEL2017", "'assert' requires a message after 'else'", separator.span));
        } else {
          message = this.parseExpression();
        }
      }
      return { kind: "AssertStatement", condition, message, span: span(keyword.span.start, message?.span.end ?? condition.span.end) };
    }

    if (this.match("if")) {
      return this.controlFlow.parseIf(start);
    }


    if (this.match("for")) {
      let asynchronousLoop = false;
      const forKeyword = this.previous();
      if (this.match("await")) {
        asynchronousLoop = true;
        this.diagnostics.push(recoveredDiagnostic(
          "VEL2017",
          "Use 'async for value in source'; the async marker precedes the loop",
          this.previous().span,
          mechanicalEdits([
            { span: span(forKeyword.span.start, forKeyword.span.start), text: "async " },
            { span: span(this.previous().span.start, this.current().span.start), text: "" },
          ], "Use 'async for value in source'"),
        ));
      }
      return this.controlFlow.parseForStatement(start, asynchronousLoop);
    }

    if (this.match("while")) {
      const condition = this.parseExpression();
      const body = this.parseBlock();
      return { kind: "WhileStatement", condition, body, span: span(start, body.at(-1)?.span.end ?? condition.span.end) };
    }

    if (this.match("break")) {
      return { kind: "BreakStatement", span: this.previous().span };
    }

    if (this.match("continue")) {
      return { kind: "ContinueStatement", span: this.previous().span };
    }

    // D39 item 51: the statement-head `try` is the block form only when a
    // block follows it. Anything else is the expression form, which reaches
    // the expression parser below and must be consumed by something.
    if (this.check("try") && this.peekKind(1) === "colon") {
      this.advance();
      return this.controlFlow.parseTry(start);
    }

    if (this.match("pass")) {
      return { kind: "PassStatement", span: this.previous().span };
    }

    if (this.check("else") || this.check("catch") || this.check("finally") || this.controlFlow.orphanCaseClauseAhead()) {
      this.diagnostics.push(diagnostic("VEL2001", `'${this.current().value}' does not follow a matching block`, this.current().span));
      return null;
    }
    return undefined;
  }

  protected parseExtensionStatement(
    _start: number,
    _modifiers: { readonly exported: boolean; readonly abstract: boolean; readonly asynchronous: boolean },
  ): Statement | null | undefined {
    return undefined;
  }

  /** Lets an extension claim its own `unsafe <shape>` before Core requires `js`. */
  protected parseUnsafeExtensionStatement(_start: number): Statement | null | undefined {
    return undefined;
  }

  protected parseExtensionImport(_start: number): Statement | null | undefined {
    return undefined;
  }

  protected parseTypeParameters(): readonly TypeParameterDeclaration[] | null {
    if (!this.match("less")) return null;
    const open = this.previous();
    const parameters: TypeParameterDeclaration[] = [];
    if (!this.check("greater")) {
      do {
        const name = this.expect("identifier", "Expected a type parameter name");
        // D41 item 61: `<T: Bound>` names one word from the compiler's closed
        // bound vocabulary. The name is taken here and judged by the analyzer,
        // so an unknown word gets a directed diagnostic instead of a parse
        // cascade.
        const bound = this.match("colon")
          ? this.expect("identifier", "Expected a type parameter bound name after ':'")
          : null;
        if (name.value) {
          parameters.push({
            name: name.value,
            ...(bound?.value ? { bound: bound.value, boundSpan: bound.span } : {}),
            span: name.span,
          });
        }
      } while (this.match("comma") && !this.check("greater"));
    }
    const close = this.expect("greater", "Expected '>' after type parameters");
    if (parameters.length === 0) {
      this.diagnostics.push(diagnostic("VEL2025", "A type parameter list requires at least one name", span(open.span.start, close.span.end)));
    }
    return parameters;
  }

  /**
   * D55 rule 120 layer two: the `<...>` that follows a name in a *type*
   * position — `extends Stack<number>` is the one place a type application is
   * written outside `parseTypeReference`, and it reads the arguments through
   * the same `checkTypeGreater`/`expectTypeGreater` pair so a nested
   * `Stack<List<T>>` closes the way every annotation does.
   */
  protected parseTypeArgumentList(): readonly TypeSyntax[] {
    this.expect("less", "Expected '<' before type arguments");
    const arguments_: TypeSyntax[] = [];
    if (!this.checkTypeGreater()) {
      do {
        arguments_.push(this.parseTypeReference().syntax);
      } while (this.match("comma") && !this.checkTypeGreater());
    }
    this.expectTypeGreater("Expected '>' after type arguments");
    return arguments_;
  }

  protected parseParameters(): readonly Parameter[] {
    this.expect("leftParen", "Expected '('");
    const parameters: Parameter[] = [];
    let sawRest = false;
    let sawDefault = false;
    if (!this.check("rightParen")) {
      do {
        const rest = this.match("ellipsis");
        const name = this.expectBindingName("Expected a parameter name", "parameter name");
        const type = this.match("colon") ? this.parseTypeReference() : null;
        const defaultValue = this.match("assign") ? this.parseExpression() : null;
        const parameterSpan = span(name.span.start, defaultValue?.span.end ?? type?.span.end ?? name.span.end);
        if (sawRest) {
          this.diagnostics.push(diagnostic("VEL2016", "A rest parameter must be the final parameter", parameterSpan));
        }
        // D65 rule 170: in a parameter list that can be contextually typed —
        // an arrow's — the missing element type may still arrive from the
        // contextual function type's own rest, exactly as a fixed parameter's
        // type does, so the refusal waits for the analyzer, which is the only
        // place that knows whether the context supplied one. Every other
        // parameter list is a declaration with no context by construction, and
        // is refused here where it always was.
        if (rest && !type && this.contextualParameterDepth === 0) {
          this.diagnostics.push(diagnostic("VEL2016", REST_PARAMETER_ELEMENT_TYPE_MESSAGE, parameterSpan));
        }
        if (rest && defaultValue) {
          this.diagnostics.push(diagnostic("VEL2016", "A rest parameter cannot have a default value", parameterSpan));
        }
        if (!rest && !defaultValue && sawDefault && !sawRest) {
          this.diagnostics.push(diagnostic("VEL2016", "A required parameter cannot follow a parameter with a default value", parameterSpan));
        }
        parameters.push({ name: name.value, type, defaultValue, rest, span: parameterSpan });
        if (!rest && defaultValue) sawDefault = true;
        sawRest ||= rest;
      } while (this.match("comma") && !this.check("rightParen"));
    }
    this.expect("rightParen", "Expected ')' after parameters");
    return parameters;
  }

  protected parseBlock(): readonly Statement[] {
    const hasColon = this.check("colon");
    const colon = this.expect("colon", "Expected ':' before an indented block");
    if (hasColon && !this.atStatementEnd()) {
      this.statementBlockDepth += 1;
      const statement = this.parseStatement();
      this.statementBlockDepth -= 1;
      if (!statement) {
        this.synchronize();
        return [];
      }
      if (statementOwnsBlock(statement)) {
        this.diagnostics.push(diagnostic(
          "VEL2001",
          "An inline suite accepts one non-block statement; move this block header to the next indented line",
          span(colon.span.end, statement.span.end),
        ));
      }
      this.finishStatementBoundary();
      return [statement];
    }
    this.expect("newline", "Expected a newline before an indented block");
    this.consumeNewlines();
    this.expect("indent", "Expected an indented block");

    const statements: Statement[] = [];
    this.consumeNewlines();
    while (!this.check("dedent") && !this.check("eof")) {
      this.statementBlockDepth += 1;
      const statement = this.parseStatement();
      this.statementBlockDepth -= 1;
      if (statement) {
        statements.push(statement);
      } else {
        this.synchronize();
      }
      this.finishStatementBoundary();
      this.consumeNewlines();
    }
    this.expect("dedent", "Expected the end of an indented block");
    return statements;
  }

  protected parseTypeReference(allowTrailingOptional = true): TypeReference {
    return this.withParseDepth(() => this.typeSyntax.parseTypeReferenceBody(allowTrailingOptional));
  }

  protected validateExtensionTypeArguments(_name: string, _arguments: readonly TypeSyntax[], _nameSpan: Span): boolean {
    return false;
  }

  protected parseExpression(minimumPrecedence = 0): Expression {
    return this.withParseDepth(() => this.operators.parseExpressionBody(minimumPrecedence));
  }

  protected parseExtensionExpression(_token: Token): Expression | undefined {
    return undefined;
  }

  protected parseExtensionNumericLiteral(token: Token, value: number, unit: string): Expression | undefined {
    if (unit !== "ms" && unit !== "s") return undefined;
    return {
      kind: "ExtensionExpression:core:duration",
      value,
      unit,
      raw: token.value,
      span: token.span,
    };
  }

  // An extension-owned bracket fragment lexes with insignificant
  // newlines, matching ordinary bracket continuation. An indentation-owning
  // extension expression inside the fragment — an extension keyword followed
  // by ':' — still needs physical lines, so that
  // fragment falls back to the ordinary line-sensitive lex.
  protected parseNestedExpression(
    fragment: string,
    offset: number,
    bracketFragment = false,
    sourceOffsets?: readonly number[],
  ): Expression {
    let lexed = bracketFragment ? new Lexer(fragment, this.lexicalExtensions, { bracketFragment: true, scanSourceHygiene: false }).lex() : null;
    if (!lexed || containsExtensionBlockStart(lexed.tokens, this.contextualKeywords)) {
      lexed = new Lexer(fragment, this.lexicalExtensions, { scanSourceHygiene: false }).lex();
    }
    const mappedSpan = (local: Span): Span => sourceOffsets
      ? span(sourceOffsets[local.start] ?? offset, sourceOffsets[local.end] ?? sourceOffsets.at(-1) ?? offset)
      : span(local.start + offset, local.end + offset);
    // A report carries two coordinate systems: its own span and the spans of
    // the rewrite it names. Both are fragment-local here, so both are mapped;
    // mapping only the span leaves `velar fix` splicing an interpolation
    // offset into module text, which rewrites whatever happens to sit there.
    const mappedFix = <T extends { readonly fix?: DiagnosticFix }>(item: T): T => item.fix
      ? { ...item, fix: { ...item.fix, edits: item.fix.edits.map((edit) => ({ ...edit, span: mappedSpan(edit.span) })) } }
      : item;
    const shiftedTokens = lexed.tokens.map((item) => ({ ...item, span: mappedSpan(item.span) }));
    const shiftedDiagnostics = lexed.diagnostics.map((item) => mappedFix({ ...item, span: mappedSpan(item.span) }));
    const shiftedAdvisories = lexed.advisories.map((item) => mappedFix({ ...item, span: mappedSpan(item.span) }));
    // A suppression carries two spans of its own — the clause it names and the
    // text a stale-suppression fix deletes — and both are fragment-local here
    // for the same reason a fix's edits are.
    const shiftedSuppressions = lexed.suppressions.map((item) => ({
      ...item,
      span: mappedSpan(item.span),
      removal: mappedSpan(item.removal),
    }));
    const nested = this.createNestedParser(shiftedTokens);
    nested.inheritParseBudget(this);
    const parsed = nested.parseExpressionFragment();
    this.diagnostics.push(...shiftedDiagnostics, ...parsed.diagnostics);
    this.advisories.push(...shiftedAdvisories, ...parsed.advisories);
    this.suppressions.push(...shiftedSuppressions, ...parsed.suppressions);
    return parsed.expression;
  }

  protected createNestedParser(tokens: readonly Token[]): Parser {
    return new Parser(tokens, this.lexicalExtensions);
  }

  /**
   * An interpolation is parsed by a nested parser, so the nest continues the
   * budget rather than restarting it: without this, `MAX_PARSE_DEPTH` resets
   * at every level and only a JavaScript stack overflow ends a deeply nested
   * f-string, after the superlinear work is already paid. It is a method
   * rather than a constructor argument because `packages/web` and
   * `packages/node` override `createNestedParser`, so an added argument would
   * be silently dropped for exactly the modules that build one.
   */
  protected inheritParseBudget(parent: Parser): void {
    this.parseDepth = parent.parseDepth + NESTED_EXPRESSION_PARSE_COST;
  }

  private withParseDepth<T>(parse: () => T): T {
    this.parseDepth += 1;
    if (this.parseDepth > MAX_PARSE_DEPTH) {
      this.parseDepth -= 1;
      throw PARSER_COMPLEXITY_FAILURE;
    }
    try {
      return parse();
    } finally {
      this.parseDepth -= 1;
    }
  }

  private atStatementEnd(): boolean {
    return this.check("newline") || this.check("dedent") || this.check("eof");
  }

  protected expectStatementEnd(): void {
    if (!this.atStatementEnd()) {
      this.diagnostics.push(diagnostic("VEL2003", "Expected the end of a statement", this.current().span));
      this.synchronize();
    }
  }

  // A statement owns exactly one logical line. Once it is complete the next
  // token must end that line, so a leftover token cannot silently open a
  // second statement whose value is discarded. Recovery consumes the rest of
  // the line, so one bad line reports once and every following line still
  // parses on its own.
  protected expectStatementBoundary(): void {
    if (this.atStatementEnd()) return;
    const token = this.current();
    this.diagnostics.push(diagnostic("VEL2032", this.statementBoundaryMessage(token), token.span));
    this.synchronize();
  }

  private finishStatementBoundary(): void {
    if (this.recoveredImportDelimiterBoundary) {
      this.recoveredImportDelimiterBoundary = false;
      return;
    }
    if (this.previous().kind !== "dedent") this.expectStatementBoundary();
  }

  // A numeric unit suffix binds tighter than any operator, so '10%3' lexes as
  // the percentage '10%' followed by a stray '3'. That reads as modulo, so the
  // spelling difference is named directly instead of reported as a generic
  // leftover token.
  private statementBoundaryMessage(token: Token): string {
    const previous = this.previous();
    if (previous.kind === "unitNumber" && previous.value.endsWith("%") && previous.span.end === token.span.start) {
      const amount = previous.value.slice(0, -1);
      return `'${previous.value}' is a percentage literal, so '${token.value}' starts a second statement; write '${amount} % ${token.value}' with spaces for the remainder operator`;
    }
    // '|' spells a union only inside type annotations; at value level the
    // author almost always means 'or' (or a comma between match values).
    if (token.kind === "pipe") {
      return "'|' joins types only in type annotations; combine conditions with 'or'";
    }
    // GRM-A5: structural tokens have no source text, so they need prose —
    // 'move indent to its own line' taught nothing.
    if (token.kind === "indent") {
      return "A statement ends at its newline; this line is indented as a continuation, but only parenthesized expressions span lines — parenthesize, or align the line with its block";
    }
    if (token.kind === "dedent" || token.kind === "newline" || token.kind === "eof") {
      return "A statement ends at its newline; parenthesize an expression to continue it across lines";
    }
    return `A statement ends at its newline; move '${describeStatementToken(token)}' to its own line, or join it to the value before it with an operator`;
  }

  // The removed 'invert' statement's replacement names the value the author
  // wrote, so a plain name or member path is rendered from its own tokens
  // (identifier and dot tokens carry their exact source text). Any other
  // operand shape keeps a copyable generic spelling rather than a guess.
  private describeInvertTarget(start: number): string {
    if (this.tokens[start]?.kind !== "identifier") return "x";
    let text = this.tokens[start]!.value;
    let index = start + 1;
    while (this.tokens[index]?.kind === "dot" && this.tokens[index + 1]?.kind === "identifier") {
      text += `.${this.tokens[index + 1]!.value}`;
      index += 2;
    }
    const end = this.tokens[index]?.kind;
    if (end !== "newline" && end !== "dedent" && end !== "eof") return "x";
    return text;
  }

  private synchronize(): void {
    while (!this.check("eof") && !this.check("newline") && !this.check("dedent")) {
      this.advance();
    }
  }

  /**
   * D38 rule 47 (BRG-D2): an extern signature is the entire contract — there
   * is no body to infer from — so a parameter without a type used to degrade
   * to `unknown` and accept every argument silently. The escape hatch may
   * never lose air quietly: the missing type is reported at the parameter
   * itself, and the member keeps its place in the module contract so the use
   * site is not blamed for a declaration defect.
   */
  protected reportUntypedExternParameters(parameters: readonly Parameter[]): void {
    for (const parameter of parameters) {
      if (parameter.type) continue;
      this.diagnostics.push(diagnostic(
        "VEL2010",
        `Extern parameter '${parameter.name}' requires an explicit type; there is no body to infer from`,
        parameter.span,
      ));
    }
  }

  /**
   * D38 rule 47, second half: the rejection of a body on an extern declaration
   * lands in the right place already, but "Expected the end of a statement"
   * never said why a body cannot be there.
   */
  protected reportExternDeclarationBody(): boolean {
    // Both spellings of "here comes a body" reach here: the VelarScript block
    // colon, and the brace a TypeScript declaration habit produces. Neither can
    // legally follow an extern signature.
    if (!this.check("colon") && !this.check("leftBrace")) return false;
    this.diagnostics.push(diagnostic(
      "VEL2010",
      "Extern declarations have no body; the JavaScript package provides it",
      this.current().span,
    ));
    if (this.check("leftBrace")) {
      let depth = 0;
      do {
        if (this.check("leftBrace")) depth += 1;
        else if (this.check("rightBrace")) depth -= 1;
        this.advance();
      } while (depth > 0 && !this.check("eof"));
      return true;
    }
    this.skipMistypedDeclaration();
    return true;
  }

  /**
   * CLS-I5: `readonly` marks a data type, never a class member. A field's
   * read-only spelling is `const`; a method, getter, or constructor is
   * executable, so there is no read-only contract for the modifier to state
   * and pointing the author at `const` was advice they cannot take.
   */
  protected reportClassMemberReadonly(modifier: Token | null, member: "field" | "executable", code: string): void {
    if (!modifier) return;
    this.diagnostics.push(diagnostic(code, member === "field"
      ? "'readonly' is a data-type modifier, not a class member modifier; use 'const' for a read-only field"
      : "'readonly' is a data-type modifier, not a class member modifier; a method, getter, or constructor is executable and has no readonly contract — mark the data it works with, as in 'readonly List<number>'",
      modifier.span));
  }

  /**
   * The name slot of a `type`, `class`, or `enum` declaration. Answers the
   * token that names the declaration, or `null` when the slot held a word that
   * cannot name one — the declaration is skipped in that case, so the refusal
   * is the only report the mistake earns.
   *
   * Charter §5 puts a reserved-name refusal at the declaration, "rather than at
   * the uses that would lose to it". Three spellings reached this slot without
   * it. A reserved word never reached a declaration at all: `type null:` read
   * as an expression and answered with the statement-layout recovery, and
   * `class null:` and `enum null:` answered "Expected a class name" and six
   * cascading messages after it — none of them naming the rule. `readonly`, the
   * read-only view modifier, declared a type that every annotation then
   * answered with "Expected a type name". A guided spelling — `type Array:`,
   * `type str:` — declared a name every annotation rewrites to the type it is
   * guided to, so `const value: Array` reported "Unknown type 'List'". All
   * three are the same mistake, a name a type position cannot spell as itself,
   * and all three now say so here, once.
   */
  private parseDeclarationName(noun: "type" | "class" | "enum"): Token | null {
    const token = this.current();
    const refused = refusedDeclarationName(token);
    if (!refused) return this.expect("identifier", `Expected ${noun === "enum" ? "an" : "a"} ${noun} name`);
    this.diagnostics.push(diagnostic(
      "VEL3007",
      `'${token.value}' ${refused.because}, so it cannot name ${noun === "enum" ? "an" : "a"} ${noun}`
      + `; every use of it would read as ${refused.instead}`,
      token.span,
    ));
    this.skipMistypedDeclaration();
    return null;
  }

  // After a mistyped declaration keyword is reported, consume the rest of the
  // statement line and any indented block that belongs to it so the wrong
  // spelling produces one directive diagnostic instead of a misleading cascade.
  protected skipMistypedDeclaration(): void {
    this.synchronize();
    let distance = 0;
    while (this.peekKind(distance) === "newline") distance += 1;
    if (this.peekKind(distance) !== "indent") return;
    this.consumeNewlines();
    this.advance();
    let depth = 1;
    while (depth > 0 && !this.check("eof")) {
      if (this.check("indent")) depth += 1;
      else if (this.check("dedent")) depth -= 1;
      this.advance();
    }
  }

  protected consumeNewlines(): void {
    while (this.match("newline")) {
      // Intentionally empty.
    }
  }

  protected expect(kind: TokenKind, message: string): Token {
    if (this.check(kind)) {
      return this.advance();
    }
    const token = this.current();
    this.diagnostics.push(diagnostic("VEL2001", message, token.span));
    return { kind, value: "", span: token.span };
  }

  private checkTypeGreater(): boolean {
    return typeGreaterRemainderKinds.has(this.current().kind) || this.check("greater");
  }

  /** Consume one `>` from a generic close without changing shift lexing. */
  private expectTypeGreater(message: string): Token {
    if (this.check("greater")) return this.advance();
    const token = this.current();
    const remainderKind = typeGreaterRemainderKinds.get(token.kind);
    if (remainderKind) {
      const close = { kind: "greater", value: ">", span: span(token.span.start, token.span.start + 1) } satisfies Token;
      this.tokens[this.index] = {
        kind: remainderKind,
        value: token.value.slice(1),
        span: span(token.span.start + 1, token.span.end),
      };
      return close;
    }
    this.diagnostics.push(diagnostic("VEL2001", message, token.span));
    return { kind: "greater", value: "", span: token.span };
  }

  private expectMemberName(message = "Expected a member name after '.'"): Token {
    if (memberNameKinds.has(this.current().kind)) return this.advance();
    const token = this.current();
    this.diagnostics.push(diagnostic("VEL2001", message, token.span));
    return { kind: "identifier", value: "", span: token.span };
  }

  protected match(kind: TokenKind): boolean {
    if (!this.check(kind)) {
      return false;
    }
    this.advance();
    return true;
  }

  protected matchExtensionKeyword(value: string): boolean {
    return this.matchWord(value);
  }

  /**
   * D30 item 16: a contextual keyword is an ordinary identifier token whose
   * spelling matches. `checkWord` asks the question without consuming; the
   * declaration shape decides at each statement head, and every other position
   * keeps the identifier reading.
   */
  /**
   * D30 item 16: the words that stay hard-reserved now say so. A bare
   * "Expected a binding name" never told the reader that the spelling itself
   * was the problem, which is exactly the question a reserved word raises.
   */
  protected reservedWordMessage(noun: string): string | null {
    return this.reservedWordMessageFor(this.current(), noun);
  }

  private reservedWordMessageFor(token: Token, noun: string): string | null {
    if (token.kind === "identifier" || token.kind === "string" || !/^[A-Za-z_$][A-Za-z0-9_$]*$/u.test(token.value)) return null;
    return `'${token.value}' is a VelarScript keyword and cannot be a ${noun}; choose another name`;
  }

  protected expectBindingName(message: string, noun: string): Token {
    if (this.check("identifier")) return this.advance();
    const token = this.current();
    const reserved = this.reservedWordMessage(noun);
    this.diagnostics.push(diagnostic("VEL2001", reserved ?? message, token.span));
    // A reserved word standing in a name position is a whole, well-formed
    // token; consuming it lets the rest of the list parse instead of
    // unravelling into a dozen follow-on expectations.
    if (reserved) {
      this.advance();
      return { kind: "identifier", value: token.value, span: token.span };
    }
    return { kind: "identifier", value: "", span: token.span };
  }

  protected checkWord(value: string): boolean {
    const token = this.current();
    return token.kind === "identifier" && token.value === value;
  }

  protected matchWord(value: string): boolean {
    if (!this.checkWord(value)) return false;
    this.advance();
    return true;
  }

  /**
   * Consumes a contextual keyword that a production requires — `from` in an
   * import, `as` in a namespace import — and reports it in the same voice as a
   * missing hard keyword when it is absent.
   */
  protected expectWord(value: string, message: string): Token {
    if (this.checkWord(value)) return this.advance();
    const token = this.current();
    this.diagnostics.push(diagnostic("VEL2001", message, token.span));
    return { kind: "identifier", value: "", span: token.span };
  }

  protected check(kind: TokenKind): boolean {
    return this.current().kind === kind;
  }

  protected peekKind(distance: number): TokenKind {
    return this.tokens[this.index + distance]?.kind ?? "eof";
  }

  protected peekValue(distance: number): string {
    return this.tokens[this.index + distance]?.value ?? "";
  }

  protected advance(): Token {
    const token = this.current();
    if (token.kind !== "eof") {
      this.index += 1;
    }
    return token;
  }

  /**
   * D54 rule 118 keeps prefix `!` a teaching diagnostic rather than a second
   * spelling of `not`; D86 rule 212 moved the report here because only the
   * parser knows the `!` stood before its operand. The rewrite carries the
   * spacing the word form needs, exactly as the lexer's own word-operator
   * fixes do: `!ready` becomes `not ready`, `and!ready` becomes `and not ready`.
   */
  /**
   * D86 rule 212: `value! = next` names the unwrap on the left of a write. The
   * unwrap reads a value and proves it present; a write has neither a result
   * to unwrap nor a fact to prove, and assigning `null` back into an optional
   * is legitimate — so the target is the location itself.
   */
  protected reportInvalidAssignmentTarget(expression: Expression): void {
    if (expression.kind === "IdentifierExpression" || expression.kind === "MemberExpression" || expression.kind === "IndexExpression") return;
    if (expression.kind === "RequiredExpression") {
      this.diagnostics.push(diagnostic(
        "VEL2005",
        "'!' unwraps a value that is read, so it cannot stand on an assignment target; assign to the location itself",
        expression.span,
        mechanicalFix(span(expression.span.end - 1, expression.span.end), "", "Remove the '!'"),
      ));
      return;
    }
    this.diagnostics.push(diagnostic("VEL2005", "Assignment target must be a name, member, or index", expression.span));
  }

  protected reportPrefixBang(bang: Token): void {
    const spaceBefore = this.tokens[this.index - 2]?.span.end === bang.span.start ? " " : "";
    const spaceAfter = this.current().span.start === bang.span.end ? " " : "";
    this.diagnostics.push(recoveredDiagnostic(
      "VEL1005",
      "Use 'not'; VelarScript uses readable logical operators",
      bang.span,
      mechanicalFix(bang.span, `${spaceBefore}not${spaceAfter}`, "Use readable 'not'"),
    ));
  }

  protected current(): Token {
    return this.tokens[this.index] ?? this.tokens[this.tokens.length - 1]!;
  }

  protected previous(): Token {
    return this.tokens[Math.max(0, this.index - 1)] ?? this.current();
  }
}
