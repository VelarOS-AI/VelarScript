import type {
  ArrowFunctionExpression,
  AssignmentStatement,
  BinaryExpression,
  BindingPattern,
  ClassDeclaration,
  ClassFieldDeclaration,
  ClassGetterDeclaration,
  ClassInitBlock,
  ClassMethodDeclaration,
  ClassParameter,
  ComparisonChainExpression,
  EnumDeclaration,
  Expression,
  ExternClassDeclaration,
  ExternClassFieldDeclaration,
  ExternClassGetterDeclaration,
  ExternClassMethodDeclaration,
  ExternConstantDeclaration,
  ExternFunctionDeclaration,
  ExternModuleDeclaration,
  FStringPart,
  FunctionDeclaration,
  IdentifierExpression,
  IfStatement,
  ImportDeclaration,
  ImportSpecifier,
  MemberExpression,
  MatchStatement,
  ObjectProperty,
  Parameter,
  Program,
  ReExportDeclaration,
  ReExportSpecifier,
  Statement,
  TypeDeclaration,
  TypeAliasDeclaration,
  TypeField,
  TypeParameterDeclaration,
  TypeReference,
  TypeSyntax,
  VariableDeclaration,
} from "./ast.ts";
import { diagnostic, recoveredDiagnostic, type Diagnostic } from "./diagnostic.ts";
import type { CompilerLexicalExtension } from "./extension.ts";
import { findInterpolatedExpressionEnd, scanStringLiteral, type StringTokenPayload } from "./interpolated-string.ts";
import { declarationKeywordGuidance, sourceTypeNameGuidance } from "./language-guidance.ts";
import { Lexer } from "./lexer.ts";
import { span, type Span } from "./source.ts";
import { keywordKinds, type Token, type TokenKind } from "./token.ts";

const memberNameKinds = new Set<TokenKind>(["identifier", "extensionKeyword", ...Object.values(keywordKinds)]);
// Token kinds that begin a statement but can never begin a record field or
// appear inside a record literal's field list. A keyword followed by ':' is a
// keyword-named field, so it never counts as statement evidence.
const statementStarterKinds = new Set<TokenKind>([
  "const", "let", "def", "return", "throw", "assert", "if", "match", "for", "while", "break", "continue", "try", "pass",
]);
// Token kinds that legally appear at the top level of a record literal's
// field list: field names, shorthand entries, and their separators.
const recordFieldLevelKinds = new Set<TokenKind>(["identifier", "extensionKeyword", "string", "comma", ...Object.values(keywordKinds)]);
const MAX_PARSE_DEPTH = 512;
const PARSER_COMPLEXITY_FAILURE = Object.freeze({ kind: "VelarParserComplexityFailure" });

export function isParserComplexityFailure(value: unknown): boolean {
  return value === PARSER_COMPLEXITY_FAILURE;
}

export interface ParseResult {
  readonly program: Program;
  readonly diagnostics: readonly Diagnostic[];
}

export interface ExpressionParseResult {
  readonly expression: Expression;
  readonly diagnostics: readonly Diagnostic[];
}

const binaryPrecedence: Partial<Record<TokenKind, number>> = {
  nullish: 1,
  or: 2,
  and: 3,
  equal: 4,
  notEqual: 4,
  is: 4,
  in: 4,
  less: 4,
  lessEqual: 4,
  greater: 4,
  greaterEqual: 4,
  plus: 6,
  minus: 6,
  star: 7,
  slash: 7,
  percent: 7,
};

const comparisonOperators: Partial<Record<TokenKind, ComparisonChainExpression["operators"][number]>> = {
  equal: "==",
  notEqual: "!=",
  less: "<",
  lessEqual: "<=",
  greater: ">",
  greaterEqual: ">=",
};

// An extension keyword directly followed by ':' opens an indentation-owned
// extension block whose capture depends on
// physical lines; a bracket fragment containing one keeps line-sensitive form.
function containsExtensionBlockStart(tokens: readonly Token[]): boolean {
  return tokens.some((token, index) => token.kind === "extensionKeyword" && tokens[index + 1]?.kind === "colon");
}

// Statement-boundary guidance names the leftover token as the author typed it.
// Long literals are clipped so one runaway string cannot swamp the message.
function describeStatementToken(token: Token): string {
  const text = token.value;
  if (!text) return token.kind;
  return text.length > 24 ? `${text.slice(0, 24)}…` : text;
}

const assignmentOperators: Partial<Record<TokenKind, AssignmentStatement["operator"]>> = {
  assign: "=",
  plusAssign: "+=",
  minusAssign: "-=",
  starAssign: "*=",
  slashAssign: "/=",
  percentAssign: "%=",
};

export class Parser {
  private readonly tokens: readonly Token[];
  protected readonly lexicalExtensions: readonly CompilerLexicalExtension[];
  protected readonly diagnostics: Diagnostic[] = [];
  private readonly genericCallableNames = new Set<string>();
  private index = 0;
  private parseDepth = 0;

  constructor(tokens: readonly Token[], lexicalExtensions: readonly CompilerLexicalExtension[] = []) {
    this.tokens = tokens;
    this.lexicalExtensions = lexicalExtensions;
    for (let index = 0; index + 2 < tokens.length; index += 1) {
      if (tokens[index]?.kind === "def" && tokens[index + 1]?.kind === "identifier" && tokens[index + 2]?.kind === "less") {
        this.genericCallableNames.add(tokens[index + 1]!.value);
      }
    }
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
      if (this.previous().kind !== "dedent") this.expectStatementBoundary();
      this.consumeNewlines();
    }

    const end = this.current().span.end;
    return {
      program: { kind: "Program", body, span: span(0, end) },
      diagnostics: this.diagnostics,
    };
  }

  parseExpressionFragment(): ExpressionParseResult {
    this.consumeNewlines();
    const expression = this.recoverExpressionAssignment(this.parseExpression());
    this.consumeNewlines();
    if (!this.check("eof")) {
      this.diagnostics.push(diagnostic("VEL2006", "Unexpected tokens in interpolated expression", this.current().span));
    }
    return { expression, diagnostics: this.diagnostics };
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
    if (expression.kind !== "IdentifierExpression" && expression.kind !== "MemberExpression" && expression.kind !== "IndexExpression") {
      this.diagnostics.push(diagnostic("VEL2005", "Assignment target must be a name, member, or index", expression.span));
    }
    const value = this.recoverExpressionAssignment(this.parseExpression());
    return { kind: "AssignmentExpression", target: expression, operator, value, span: span(expression.span.start, value.span.end) };
  }

  protected parseStatement(): Statement | null {
    return this.withParseDepth(() => this.parseStatementBody());
  }

  private parseStatementBody(): Statement | null {
    const start = this.current().span.start;

    if (this.check("import") && this.tokens[this.index + 1]?.kind !== "leftParen") {
      this.advance();
      const extensionImport = this.parseExtensionImport(start);
      if (extensionImport !== undefined) return extensionImport;
      return this.parseImport(start);
    }

    if (this.match("extern")) {
      return this.parseExternModule(start);
    }

    const exported = this.match("export");
    if (exported && (this.check("leftBrace") || this.check("star"))) {
      return this.parseReExport(start);
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
    const abstract = this.match("abstract");
    const asynchronous = this.match("async");

    const extensionStatement = this.parseExtensionStatement(start, { exported, abstract, asynchronous });
    if (extensionStatement !== undefined) return extensionStatement;

    if (this.match("def")) {
      if (abstract) this.diagnostics.push(diagnostic("VEL2013", "Only class methods can be declared with 'abstract'", this.previous().span));
      return this.parseFunction(start, exported, asynchronous);
    }

    if (asynchronous && this.match("for")) {
      if (exported) this.diagnostics.push(diagnostic("VEL2001", "An async for loop cannot be exported", this.previous().span));
      if (abstract) this.diagnostics.push(diagnostic("VEL2001", "'abstract' cannot prefix an async for loop", this.previous().span));
      return this.parseForStatement(start, true);
    }

    if (asynchronous) {
      // The detached-execution statement: 'async <expression>'. 'def' and
      // 'for' consumed their spellings above, so any remaining continuation
      // is the expression form; the analyzer requires its checked type to be
      // Promise<null>.
      if (exported) this.diagnostics.push(diagnostic("VEL2001", "An 'async' statement cannot be exported", this.previous().span));
      if (abstract) this.diagnostics.push(diagnostic("VEL2001", "'abstract' cannot prefix an 'async' statement", this.previous().span));
      if (this.check("newline") || this.check("dedent") || this.check("eof")) {
        this.diagnostics.push(diagnostic("VEL2001", "'async' must be followed by 'def', 'for', or a call to run detached", this.previous().span));
        return null;
      }
      const expression = this.parseExpression();
      return { kind: "AsyncStatement", expression, span: span(start, expression.span.end) };
    }

    if (abstract && !this.check("class")) {
      this.diagnostics.push(diagnostic("VEL2001", "'abstract' must be followed by 'class'", this.previous().span));
      return null;
    }

    if (this.match("type")) {
      return this.parseTypeDefinition(start, exported);
    }

    if (this.match("enum")) {
      return this.parseEnumDeclaration(start, exported);
    }

    if (this.match("class")) {
      return this.parseClassDeclaration(start, exported, abstract);
    }

    if (this.check("const") || this.check("let")) {
      return this.parseVariable(start, exported);
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
          this.diagnostics.push(recoveredDiagnostic("VEL2026", guidance.message, first.span));
          this.advance();
          return this.parseFunction(start, exported, asynchronous);
        }
        if (guidance.keyword === "type" && (shape === "colon" || shape === "assign")) {
          this.diagnostics.push(recoveredDiagnostic("VEL2026", guidance.message, first.span));
          this.advance();
          return this.parseTypeDefinition(start, exported);
        }
        this.diagnostics.push(diagnostic("VEL2026", guidance.message, first.span));
        this.skipMistypedDeclaration();
        return { kind: "PassStatement", span: first.span };
      }
      const following = this.peekKind(2);
      if (following === "leftParen" || following === "colon") {
        this.diagnostics.push(diagnostic(
          "VEL2026",
          `Unknown declaration keyword '${first.value}'; VelarScript declarations start with 'def', 'type', 'enum', 'class', 'const', or 'let'`,
          first.span,
        ));
        this.skipMistypedDeclaration();
        return { kind: "PassStatement", span: first.span };
      }
    }

    if (exported) {
      this.diagnostics.push(diagnostic("VEL2001", "'export' must be followed by a declaration", this.previous().span));
      return null;
    }

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
      return this.parseIf(start);
    }

    if (this.match("match")) {
      return this.parseMatch(start);
    }

    if (this.match("for")) {
      let asynchronousLoop = false;
      if (this.match("await")) {
        asynchronousLoop = true;
        this.diagnostics.push(recoveredDiagnostic(
          "VEL2017",
          "Use 'async for value in source'; the async marker precedes the loop",
          this.previous().span,
        ));
      }
      return this.parseForStatement(start, asynchronousLoop);
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

    if (this.match("try")) {
      return this.parseTry(start);
    }

    if (this.match("pass")) {
      return { kind: "PassStatement", span: this.previous().span };
    }

    if (this.check("else") || this.check("case") || this.check("catch") || this.check("finally")) {
      this.diagnostics.push(diagnostic("VEL2001", `'${this.current().value}' does not follow a matching block`, this.current().span));
      return null;
    }

    const expression = this.parseExpression();
    const operator = assignmentOperators[this.current().kind];
    if (operator) {
      this.advance();
      if (expression.kind !== "IdentifierExpression" && expression.kind !== "MemberExpression" && expression.kind !== "IndexExpression") {
        this.diagnostics.push(diagnostic("VEL2005", "Assignment target must be a name, member, or index", expression.span));
      }
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

  private parseForStatement(start: number, asynchronous: boolean): Statement {
    const pattern = this.parseBindingPattern();
    const secondPattern = this.match("comma") ? this.parseBindingPattern() : null;
    if (secondPattern && this.match("comma")) {
      const third = this.parseBindingPattern();
      this.diagnostics.push(diagnostic(
        "VEL2017",
        "A for loop accepts one binding or two slots; use 'for [a, b] in ...' to destructure one item",
        third.span,
      ));
    }
    this.expect("in", "Expected 'in' after loop binding");
    const iterable = this.parseExpression();
    const body = this.parseBlock();
    return { kind: "ForStatement", asynchronous, pattern, secondPattern, iterable, body, span: span(start, body.at(-1)?.span.end ?? iterable.span.end) };
  }

  private parseImport(start: number): ImportDeclaration | null {
    const javascript = this.match("js");
    const unsafe = javascript && this.match("unsafe");
    const specifiers: ImportSpecifier[] = [];

    if (this.match("star")) {
      const star = this.previous();
      this.expect("as", "Expected 'as' after namespace import");
      const local = this.expect("identifier", "Expected a namespace name");
      specifiers.push({ imported: "*", local: local.value, namespace: true, span: span(star.span.start, local.span.end) });
    } else if (this.match("leftBrace")) {
      if (!this.check("rightBrace")) {
        do {
          const imported = this.expect("identifier", "Expected an imported name");
          const local = this.match("as") ? this.expect("identifier", "Expected a local import name") : imported;
          specifiers.push({ imported: imported.value, local: local.value, namespace: false, span: span(imported.span.start, local.span.end) });
        } while (this.match("comma") && !this.check("rightBrace"));
      }
      this.expect("rightBrace", "Expected '}' after imports");
    } else {
      const local = this.expect("identifier", "Expected a default import name");
      specifiers.push({ imported: "default", local: local.value, namespace: false, span: local.span });
    }

    this.expect("from", "Expected 'from' after imports");
    // MOD-I1 / BRG-D1: a recovered import must never fabricate a dependency.
    // The synthesized empty-source token used to flow into module resolution
    // as `''`, whose nonsense "invalid package name" failure buried this
    // parser's own diagnostics for the same line.
    const hadSource = this.check("string");
    const source = this.expect("string", "Expected a module path string");
    if (!hadSource) {
      this.synchronize();
      return null;
    }
    if (source.value === "") {
      this.diagnostics.push(diagnostic("VEL2001", "A module path cannot be empty", source.span));
      return null;
    }
    return { kind: "ImportDeclaration", source: source.value, sourceSpan: source.span, javascript, unsafe, specifiers, span: span(start, source.span.end) };
  }

  private parseReExport(start: number): ReExportDeclaration | null {
    if (this.match("star")) {
      const star = this.previous();
      if (this.match("as")) this.match("identifier");
      if (this.match("from")) this.match("string");
      this.diagnostics.push(diagnostic(
        "VEL2029",
        "Namespace re-export 'export * from' is not supported; re-export each name explicitly with export {name, other as alias} from \"./module.vel\"",
        star.span,
      ));
      return null;
    }
    this.expect("leftBrace", "Expected '{' after 'export'");
    const specifiers: ReExportSpecifier[] = [];
    if (!this.check("rightBrace")) {
      do {
        const imported = this.expect("identifier", "Expected a re-exported name");
        const alias = this.match("as") ? this.expect("identifier", "Expected a re-export alias") : imported;
        specifiers.push({ imported: imported.value, exported: alias.value, span: span(imported.span.start, alias.span.end) });
      } while (this.match("comma") && !this.check("rightBrace"));
    }
    this.expect("rightBrace", "Expected '}' after re-exported names");
    this.expect("from", "Expected 'from' after re-exported names; VelarScript modules export declarations directly and re-export other modules' names with export {name} from \"./module.vel\"");
    // MOD-I1 / BRG-D1: like parseImport, a recovered re-export never
    // fabricates an empty-source dependency.
    const hadSource = this.check("string");
    const source = this.expect("string", "Expected a module path string");
    if (!hadSource) {
      this.synchronize();
      return null;
    }
    if (source.value === "") {
      this.diagnostics.push(diagnostic("VEL2001", "A module path cannot be empty", source.span));
      return null;
    }
    if (specifiers.length === 0) {
      this.diagnostics.push(diagnostic("VEL2029", "A re-export must name at least one export", span(start, source.span.end)));
    }
    return { kind: "ReExportDeclaration", source: source.value, sourceSpan: source.span, specifiers, span: span(start, source.span.end) };
  }

  private parseExternModule(start: number): ExternModuleDeclaration {
    this.expect("module", "Expected 'module' after 'extern'");
    const source = this.expect("string", "Expected a module name string");
    this.expect("colon", "Expected ':' after extern module name");
    this.expect("newline", "Expected a newline before extern declarations");
    this.consumeNewlines();
    this.expect("indent", "Expected indented extern declarations");
    const functions: ExternFunctionDeclaration[] = [];
    const constants: ExternConstantDeclaration[] = [];
    const classes: ExternClassDeclaration[] = [];
    this.consumeNewlines();

    while (!this.check("dedent") && !this.check("eof")) {
      const declarationStart = this.current().span.start;
      if (!this.match("export")) {
        this.diagnostics.push(diagnostic("VEL2010", "Extern declarations must be exported", this.current().span));
        this.synchronize();
        this.consumeNewlines();
        continue;
      }
      if (this.match("class")) {
        classes.push(this.parseExternClass(declarationStart));
        this.consumeNewlines();
        continue;
      }
      const asynchronous = this.match("async");
      if (!asynchronous && this.match("const")) {
        const name = this.expect("identifier", "Expected an extern constant name");
        this.expect("colon", "Expected ':' after an extern constant name");
        const type = this.parseTypeReference();
        constants.push({ name: name.value, type, span: span(declarationStart, type.span.end) });
        this.expectStatementEnd();
        this.consumeNewlines();
        continue;
      }
      if (!this.match("def")) {
        // BRG-N2: the legal member list names all three forms.
        this.diagnostics.push(diagnostic("VEL2010", "Extern modules declare functions with 'export def', read-only values with 'export const name: Type', or classes with 'export class Name:'", this.current().span));
        this.synchronize();
        this.consumeNewlines();
        continue;
      }
      const name = this.expect("identifier", "Expected an extern function name");
      const typeParameters = this.parseTypeParameters();
      const parameters = this.parseParameters();
      const parameterListEnd = this.previous().span.end;
      const returnType = this.match("arrow") ? this.parseTypeReference() : null;
      functions.push({
        asynchronous,
        name: name.value,
        ...(typeParameters ? { typeParameters } : {}),
        parameters,
        returnType,
        signatureSpan: span(declarationStart, returnType?.span.end ?? parameterListEnd),
        span: span(declarationStart, returnType?.span.end ?? this.previous().span.end),
      });
      this.expectStatementEnd();
      this.consumeNewlines();
    }
    const close = this.expect("dedent", "Expected the end of extern declarations");
    return {
      kind: "ExternModuleDeclaration",
      source: source.value,
      functions,
      constants,
      classes,
      span: span(start, Math.max(functions.at(-1)?.span.end ?? start, constants.at(-1)?.span.end ?? start, classes.at(-1)?.span.end ?? start, close.span.end)),
    };
  }

  private parseExternClass(start: number): ExternClassDeclaration {
    const name = this.expect("identifier", "Expected an extern class name");
    // BRG-U6: a generic extern class gets the same polite rejection as a
    // source class instead of a bare parse cascade; generic extern `def`
    // members remain the generic surface.
    if (this.check("less")) {
      this.diagnostics.push(diagnostic(
        "VEL2025",
        `Extern class '${name.value}' cannot declare type parameters; declare the class without them and use generic 'def' members or 'unknown' where the type varies`,
        this.current().span,
      ));
      this.parseTypeParameters();
    }
    let parameters: ClassParameter[] = [];
    if (this.check("leftParen")) {
      this.diagnostics.push(diagnostic("VEL2022", `Extern class '${name.value}' declares its constructor in the class body with 'constructor(...)'`, this.current().span));
      this.parseExternClassParameters();
    }
    const base = this.match("extends") ? this.expect("identifier", "Expected an extern base class name after 'extends'").value : null;
    this.expect("colon", "Expected ':' before an extern class body");
    this.expect("newline", "Expected a newline before an extern class body");
    this.consumeNewlines();
    this.expect("indent", "Expected an indented extern class body");
    const fields: ExternClassFieldDeclaration[] = [];
    const getters: ExternClassGetterDeclaration[] = [];
    const methods: ExternClassMethodDeclaration[] = [];
    let constructorSeen = false;
    this.consumeNewlines();

    while (!this.check("dedent") && !this.check("eof")) {
      const memberStart = this.current().span.start;
      if (this.match("pass")) {
        this.expectStatementEnd();
        this.consumeNewlines();
        continue;
      }
      if (this.check("identifier") && this.current().value === "constructor") {
        this.advance();
        const constructorParameters = this.parseParameters();
        if (constructorSeen) {
          this.diagnostics.push(diagnostic("VEL2022", `Extern class '${name.value}' has more than one constructor`, span(memberStart, this.previous().span.end)));
        } else {
          parameters = constructorParameters.map((parameter) => ({ ...parameter, binding: null, private: false }));
          constructorSeen = true;
        }
        this.expectStatementEnd();
        this.consumeNewlines();
        continue;
      }
      let static_ = false;
      let asynchronous = false;
      let scanningModifiers = true;
      while (scanningModifiers) {
        if (this.match("static")) static_ = true;
        else if (this.match("async")) asynchronous = true;
        else if (this.check("identifier") && this.current().value === "readonly") {
          const modifier = this.advance();
          this.diagnostics.push(diagnostic("VEL2010", "'readonly' is a data-type modifier, not a class member modifier; use 'const' for a read-only field", modifier.span));
        } else scanningModifiers = false;
      }
      const mutable = this.match("let");
      const readonly = !mutable && this.match("const");
      if (mutable || readonly) {
        if (asynchronous) this.diagnostics.push(diagnostic("VEL2010", "Extern class fields cannot be async", this.previous().span));
        const fieldName = this.expectMemberName("Expected an extern class field name");
        this.expect("colon", "Expected ':' after an extern class field name");
        const type = this.parseTypeReference();
        fields.push({ static: static_, mutable, name: fieldName.value, type, span: span(memberStart, type.span.end) });
        this.expectStatementEnd();
        this.consumeNewlines();
        continue;
      }
      if (this.check("identifier") && this.current().value === "get") {
        this.advance();
        const getterName = this.expectMemberName("Expected an extern class getter name");
        this.expect("leftParen", "Expected '(' after an extern getter name");
        if (!this.check("rightParen")) {
          this.diagnostics.push(diagnostic("VEL2023", "An extern getter cannot accept parameters", this.current().span));
          while (!this.check("rightParen") && !this.check("newline") && !this.check("eof")) this.advance();
        }
        this.expect("rightParen", "Expected ')' after an extern getter name");
        let type: TypeReference;
        if (this.match("arrow")) {
          type = this.parseTypeReference();
        } else {
          this.diagnostics.push(diagnostic("VEL4023", `Extern getter '${getterName.value}' requires an explicit result annotation`, getterName.span));
          type = { syntax: { kind: "NamedTypeSyntax", name: "unknown", span: getterName.span }, span: getterName.span };
        }
        if (asynchronous) this.diagnostics.push(diagnostic("VEL2023", "An extern getter cannot be async; expose an ordinary async method instead", span(memberStart, type.span.end)));
        getters.push({ static: static_, name: getterName.value, type, span: span(memberStart, type.span.end) });
        this.expectStatementEnd();
        this.consumeNewlines();
        continue;
      }
      if (this.match("def")) {
        const methodName = this.expectMemberName("Expected an extern class method name");
        const typeParameters = this.parseTypeParameters();
        const methodParameters = this.parseParameters();
        const parameterListEnd = this.previous().span.end;
        const returnType = this.match("arrow") ? this.parseTypeReference() : null;
        methods.push({
          static: static_,
          asynchronous,
          name: methodName.value,
          ...(typeParameters ? { typeParameters } : {}),
          parameters: methodParameters,
          returnType,
          signatureSpan: span(memberStart, returnType?.span.end ?? parameterListEnd),
          span: span(memberStart, returnType?.span.end ?? this.previous().span.end),
        });
        this.expectStatementEnd();
        this.consumeNewlines();
        continue;
      }
      this.diagnostics.push(diagnostic("VEL2010", "Extern class bodies declare fields with const/let, one constructor signature, getters with get, methods with def, or 'pass'", this.current().span));
      this.synchronize();
      this.consumeNewlines();
    }
    const close = this.expect("dedent", "Expected the end of an extern class body");
    return { name: name.value, parameters, base, fields, getters, methods, span: span(start, Math.max(fields.at(-1)?.span.end ?? start, getters.at(-1)?.span.end ?? start, methods.at(-1)?.span.end ?? start, close.span.end)) };
  }

  protected parseExtensionStatement(
    _start: number,
    _modifiers: { readonly exported: boolean; readonly abstract: boolean; readonly asynchronous: boolean },
  ): Statement | null | undefined {
    return undefined;
  }

  protected parseExtensionImport(_start: number): Statement | null | undefined {
    return undefined;
  }

  private parseVariable(start: number, exported: boolean): VariableDeclaration {
    const bindingToken = this.advance();
    const pattern = this.parseBindingPattern();
    const type = this.match("colon") ? this.parseTypeReference() : null;
    this.expect("assign", "Expected '=' after binding pattern");
    const initializer = this.parseExpression();

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

  private parseBindingPattern(): BindingPattern {
    return this.withParseDepth(() => this.parseBindingPatternBody());
  }

  private parseBindingPatternBody(): BindingPattern {
    if (this.match("identifier")) {
      const name = this.previous();
      return { kind: "NameBindingPattern", name: name.value, span: name.span };
    }
    if (this.match("leftBrace")) {
      const open = this.previous();
      const entries: Extract<BindingPattern, { kind: "ObjectBindingPattern" }>["entries"][number][] = [];
      let rest: Extract<BindingPattern, { kind: "NameBindingPattern" }> | null = null;
      while (!this.check("rightBrace") && !this.check("eof")) {
        if (this.match("ellipsis")) {
          const name = this.expect("identifier", "Expected a name after '...'");
          rest = { kind: "NameBindingPattern", name: name.value, span: name.span };
          if (!this.check("rightBrace")) this.diagnostics.push(diagnostic("VEL2011", "A rest binding must be last", name.span));
          break;
        }
        const property = this.expectMemberName("Expected an object binding field name");
        const renamed = this.match("colon");
        if (!renamed && property.kind !== "identifier") {
          this.diagnostics.push(diagnostic(
            "VEL2011",
            `Keyword-named field '${property.value}' requires ': name' in an object binding pattern`,
            property.span,
          ));
        }
        const pattern = renamed
          ? this.parseBindingPattern()
          : { kind: "NameBindingPattern", name: property.kind === "identifier" ? property.value : "_invalid", span: property.span } satisfies BindingPattern;
        entries.push({ property: property.value, pattern, span: span(property.span.start, pattern.span.end) });
        if (!this.match("comma")) break;
      }
      const close = this.expect("rightBrace", "Expected '}' after object binding");
      return { kind: "ObjectBindingPattern", entries, rest, span: span(open.span.start, close.span.end) };
    }
    if (this.match("leftBracket")) {
      const open = this.previous();
      const elements: (BindingPattern | null)[] = [];
      let rest: Extract<BindingPattern, { kind: "NameBindingPattern" }> | null = null;
      while (!this.check("rightBracket") && !this.check("eof")) {
        if (this.match("comma")) {
          elements.push(null);
          continue;
        }
        if (this.match("ellipsis")) {
          const name = this.expect("identifier", "Expected a name after '...'");
          rest = { kind: "NameBindingPattern", name: name.value, span: name.span };
          if (!this.check("rightBracket")) this.diagnostics.push(diagnostic("VEL2011", "A rest binding must be last", name.span));
          break;
        }
        elements.push(this.parseBindingPattern());
        if (!this.match("comma")) break;
      }
      const close = this.expect("rightBracket", "Expected ']' after list binding");
      return { kind: "ListBindingPattern", elements, rest, span: span(open.span.start, close.span.end) };
    }
    const token = this.current();
    this.diagnostics.push(diagnostic("VEL2011", "Expected a binding name or destructuring pattern", token.span));
    this.advance();
    return { kind: "NameBindingPattern", name: "_invalid", span: token.span };
  }

  private parseFunction(start: number, exported: boolean, asynchronous: boolean): FunctionDeclaration {
    const name = this.expect("identifier", "Expected a function name");
    const typeParameters = this.parseTypeParameters();
    const parameters = this.parseParameters();
    const parameterListEnd = this.previous().span.end;
    const returnType = this.match("arrow") ? this.parseTypeReference() : null;
    const body = this.parseBlock();
    const end = body.at(-1)?.span.end ?? returnType?.span.end ?? name.span.end;

    return {
      kind: "FunctionDeclaration",
      exported,
      asynchronous,
      name: name.value,
      ...(typeParameters ? { typeParameters } : {}),
      parameters,
      returnType,
      signatureSpan: span(start, returnType?.span.end ?? parameterListEnd),
      body,
      span: span(start, end),
    };
  }

  protected parseTypeParameters(): readonly TypeParameterDeclaration[] | null {
    if (!this.match("less")) return null;
    const open = this.previous();
    const parameters: TypeParameterDeclaration[] = [];
    if (!this.check("greater")) {
      do {
        const name = this.expect("identifier", "Expected a type parameter name");
        if (name.value) parameters.push({ name: name.value, span: name.span });
      } while (this.match("comma") && !this.check("greater"));
    }
    const close = this.expect("greater", "Expected '>' after type parameters");
    if (parameters.length === 0) {
      this.diagnostics.push(diagnostic("VEL2025", "A type parameter list requires at least one name", span(open.span.start, close.span.end)));
    }
    return parameters;
  }

  protected parseParameters(): readonly Parameter[] {
    this.expect("leftParen", "Expected '('");
    const parameters: Parameter[] = [];
    let sawRest = false;
    let sawDefault = false;
    if (!this.check("rightParen")) {
      do {
        const rest = this.match("ellipsis");
        const name = this.expect("identifier", "Expected a parameter name");
        const type = this.match("colon") ? this.parseTypeReference() : null;
        const defaultValue = this.match("assign") ? this.parseExpression() : null;
        const parameterSpan = span(name.span.start, defaultValue?.span.end ?? type?.span.end ?? name.span.end);
        if (sawRest) {
          this.diagnostics.push(diagnostic("VEL2016", "A rest parameter must be the final parameter", parameterSpan));
        }
        if (rest && !type) {
          this.diagnostics.push(diagnostic("VEL2016", "A rest parameter requires an element type", parameterSpan));
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

  private parseClassConstructorParameters(): readonly ClassParameter[] {
    this.expect("leftParen", "Expected '('");
    const parameters: ClassParameter[] = [];
    let sawDefault = false;
    if (!this.check("rightParen")) {
      do {
        const rest = this.match("ellipsis");
        let private_ = this.match("private");
        const invalidStatic = this.match("static") ? this.previous() : null;
        if (!private_) private_ = this.match("private");
        const binding = this.match("const") ? "const" : this.match("let") ? "let" : null;
        const name = this.expect("identifier", "Expected a constructor parameter name");
        const type = this.match("colon") ? this.parseTypeReference() : null;
        const defaultValue = this.match("assign") ? this.parseExpression() : null;
        const parameterSpan = span(name.span.start, defaultValue?.span.end ?? type?.span.end ?? name.span.end);
        if (invalidStatic) {
          this.diagnostics.push(diagnostic("VEL2021", "Constructor parameters cannot be static", invalidStatic.span));
        }
        if (private_ && !binding) {
          this.diagnostics.push(diagnostic("VEL2021", "A private constructor parameter must declare a field with 'const' or 'let'", parameterSpan));
        }
        if (binding && !type) {
          this.diagnostics.push(diagnostic("VEL2021", "Constructor parameter fields require an explicit type", parameterSpan));
        }
        // Source constructors lower to `constructor(...)` parameter lists that
        // the class shape counts as fixed arity, so a rest spelling is either
        // uncallable or silently wrong at runtime. Extern class declarations
        // keep rest support: they describe existing JavaScript constructors.
        if (rest) {
          this.diagnostics.push(diagnostic("VEL2016", "Class constructors do not support rest parameters", name.span));
        }
        if (!rest && !defaultValue && sawDefault) {
          this.diagnostics.push(diagnostic("VEL2016", "A required parameter cannot follow a parameter with a default value", parameterSpan));
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
      } while (this.match("comma") && !this.check("rightParen"));
    }
    this.expect("rightParen", "Expected ')' after constructor parameters");
    return parameters;
  }

  private parseExternClassParameters(): readonly ClassParameter[] {
    this.expect("leftParen", "Expected '('");
    const parameters: ClassParameter[] = [];
    let sawRest = false;
    let sawDefault = false;
    if (!this.check("rightParen")) {
      do {
        const rest = this.match("ellipsis");
        const binding = this.match("const") ? "const" : this.match("let") ? "let" : null;
        const name = this.expect("identifier", "Expected an extern class parameter name");
        const type = this.match("colon") ? this.parseTypeReference() : null;
        const defaultValue = this.match("assign") ? this.parseExpression() : null;
        const parameterSpan = span(name.span.start, defaultValue?.span.end ?? type?.span.end ?? name.span.end);
        if (sawRest) this.diagnostics.push(diagnostic("VEL2016", "A rest parameter must be the final parameter", parameterSpan));
        if (rest && !type) this.diagnostics.push(diagnostic("VEL2016", "A rest parameter requires an element type", parameterSpan));
        if (rest && defaultValue) this.diagnostics.push(diagnostic("VEL2016", "A rest parameter cannot have a default value", parameterSpan));
        if (rest && binding) this.diagnostics.push(diagnostic("VEL2016", "A rest parameter cannot declare a class field", parameterSpan));
        if (!rest && !defaultValue && sawDefault && !sawRest) {
          this.diagnostics.push(diagnostic("VEL2016", "A required parameter cannot follow a parameter with a default value", parameterSpan));
        }
        parameters.push({ name: name.value, binding, private: false, type, defaultValue, rest, span: parameterSpan });
        if (!rest && defaultValue) sawDefault = true;
        sawRest ||= rest;
      } while (this.match("comma") && !this.check("rightParen"));
    }
    this.expect("rightParen", "Expected ')' after extern class parameters");
    return parameters;
  }

  private parseTypeDefinition(start: number, exported: boolean): TypeDeclaration | TypeAliasDeclaration {
    const name = this.expect("identifier", "Expected a type name");
    if (this.check("less")) {
      this.parseTypeParameters();
      this.diagnostics.push(diagnostic("VEL2025", `Type '${name.value}' cannot declare type parameters; only 'def' functions take '<T>'`, name.span));
    }
    if (this.match("assign")) {
      const target = this.parseTypeReference();
      return { kind: "TypeAliasDeclaration", exported, name: name.value, target, span: span(start, target.span.end) };
    }
    this.expect("colon", "Expected ':' after type name");
    this.expect("newline", "Expected a newline before type fields");
    this.consumeNewlines();
    this.expect("indent", "Expected indented type fields");
    const fields: TypeField[] = [];
    this.consumeNewlines();

    while (!this.check("dedent") && !this.check("eof")) {
      const readonly = this.check("identifier") && this.current().value === "readonly";
      const fieldStart = readonly ? this.advance().span.start : this.current().span.start;
      const fieldName = this.expectMemberName("Expected a field name");
      this.expect("colon", "Expected ':' after field name");
      const type = this.parseTypeReference();
      if (this.check("assign")) {
        // ENM-U5: record fields carry no defaults — a record is data, so
        // every construction site states its values.
        this.diagnostics.push(diagnostic(
          "VEL2017",
          `Record fields do not take default values; make the field optional ('${fieldName.value}: ...?') or set the value where the record is built`,
          this.current().span,
        ));
        this.advance();
        this.parseExpression();
      }
      fields.push({ readonly, name: fieldName.value, type, span: span(fieldStart, type.span.end) });
      this.expectStatementEnd();
      this.consumeNewlines();
    }
    const close = this.expect("dedent", "Expected the end of type fields");
    return { kind: "TypeDeclaration", exported, name: name.value, fields, span: span(start, fields.at(-1)?.span.end ?? close.span.end) };
  }

  private parseEnumDeclaration(start: number, exported: boolean): EnumDeclaration {
    const name = this.expect("identifier", "Expected an enum name");
    this.expect("colon", "Expected ':' after enum name");
    this.expect("newline", "Expected a newline before enum members");
    this.consumeNewlines();
    this.expect("indent", "Expected indented enum members");
    const members: EnumDeclaration["members"][number][] = [];
    this.consumeNewlines();

    while (!this.check("dedent") && !this.check("eof")) {
      // ENM-I8: a bare `pass` line is the placeholder statement here exactly
      // as in a class body — never a member named 'pass'. An enum whose body
      // is only `pass` then falls through to the existing "requires at least
      // one member" rule, and 'pass' becomes the one undeclarable member name.
      if (this.check("pass")) {
        const keyword = this.advance();
        if (this.check("assign")) {
          this.diagnostics.push(diagnostic(
            "VEL2017",
            "'pass' is the placeholder line and cannot be declared as an enum member; pick another member name",
            keyword.span,
          ));
          this.synchronize();
        } else {
          this.expectStatementEnd();
        }
        this.consumeNewlines();
        continue;
      }
      const member = this.expectMemberName("Expected an enum member name");
      let value = member.value;
      let valueSpan: Span | undefined;
      if (this.match("assign")) {
        if (this.check("string")) {
          const serialized = this.advance();
          const payload = serialized.payload as StringTokenPayload | undefined;
          if (payload?.layout) {
            this.diagnostics.push(diagnostic("VEL2017", "An enum member value must be an inline string", serialized.span));
          }
          value = serialized.value;
          valueSpan = serialized.span;
        } else if (this.check("fstring")) {
          const serialized = this.advance();
          this.diagnostics.push(diagnostic(
            "VEL2017",
            "An enum member value is static; use an inline quoted string without interpolation",
            serialized.span,
          ));
          valueSpan = serialized.span;
        } else {
          this.diagnostics.push(diagnostic("VEL2001", "Expected an inline string value after '=' in an enum member", this.current().span));
          this.synchronize();
        }
      }
      if (member.value) members.push({ name: member.value, value, ...(valueSpan ? { valueSpan } : {}), span: member.span });
      this.expectStatementEnd();
      this.consumeNewlines();
    }
    const close = this.expect("dedent", "Expected the end of enum members");
    if (members.length === 0) {
      this.diagnostics.push(diagnostic("VEL2017", `Enum '${name.value}' requires at least one member`, span(start, close.span.end)));
    }
    const last = members.at(-1);
    return { kind: "EnumDeclaration", exported, name: name.value, members, span: span(start, last?.valueSpan?.end ?? last?.span.end ?? close.span.end) };
  }

  private parseClassDeclaration(start: number, exported: boolean, abstract: boolean): ClassDeclaration {
    const name = this.expect("identifier", "Expected a class name");
    if (this.check("less")) {
      this.parseTypeParameters();
      this.diagnostics.push(diagnostic("VEL2025", `Class '${name.value}' cannot declare type parameters; only 'def' functions take '<T>'`, name.span));
    }
    let parameters: ClassParameter[] = [];
    if (this.match("leftParen")) {
      this.diagnostics.push(diagnostic("VEL2022", `Class '${name.value}' declares its constructor in the class body with 'constructor(...)'`, this.previous().span));
      if (!this.check("rightParen")) {
        do {
          const rest = this.match("ellipsis");
          let private_ = false;
          if (this.check("private") && (this.peekKind(1) === "const" || this.peekKind(1) === "let")) {
            this.advance();
            private_ = true;
          }
          const binding = this.match("const") ? "const" : this.match("let") ? "let" : null;
          const parameterName = this.expect("identifier", "Expected a class parameter name");
          const type = this.match("colon") ? this.parseTypeReference() : null;
          const defaultValue = this.match("assign") ? this.parseExpression() : null;
          if (rest) {
            this.diagnostics.push(diagnostic("VEL2016", "Class constructors do not support rest parameters", parameterName.span));
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
        } while (this.match("comma") && !this.check("rightParen"));
      }
      this.expect("rightParen", "Expected ')' after class parameters");
    }

    let base: ClassDeclaration["base"] = null;
    if (this.match("extends")) {
      const baseName = this.expect("identifier", "Expected a base class name after 'extends'");
      const arguments_: Expression[] = [];
      let end = baseName.span.end;
      if (this.match("leftParen")) {
        this.diagnostics.push(diagnostic("VEL2022", "Pass base constructor arguments with an explicit 'super(...)' call inside the constructor", this.previous().span));
        if (!this.check("rightParen")) {
          do {
            arguments_.push(this.parseSpreadExpression());
          } while (this.match("comma") && !this.check("rightParen"));
        }
        end = this.expect("rightParen", "Expected ')' after base constructor arguments").span.end;
      }
      base = { name: baseName.value, arguments: arguments_, span: span(baseName.span.start, end) };
    }
    this.expect("colon", "Expected ':' before class body");
    this.expect("newline", "Expected a newline before class body");
    this.consumeNewlines();
    this.expect("indent", "Expected an indented class body");
    const fields: ClassFieldDeclaration[] = [];
    let initialization: ClassInitBlock | null = null;
    const getters: ClassGetterDeclaration[] = [];
    const methods: ClassMethodDeclaration[] = [];
    this.consumeNewlines();

    while (!this.check("dedent") && !this.check("eof")) {
      const methodStart = this.current().span.start;
      let methodAbstract = false;
      let methodOverride = false;
      let methodStatic = false;
      let methodPrivate = false;
      let asynchronous = false;
      let scanningModifiers = true;
      while (scanningModifiers) {
        if (this.match("abstract")) methodAbstract = true;
        else if (this.match("override")) methodOverride = true;
        else if (this.match("static")) methodStatic = true;
        else if (this.match("private")) methodPrivate = true;
        else if (this.check("identifier") && this.current().value === "readonly") {
          const modifier = this.advance();
          this.diagnostics.push(diagnostic("VEL2021", "'readonly' is a data-type modifier, not a class member modifier; use 'const' for a read-only field", modifier.span));
        }
        else if (this.match("async")) asynchronous = true;
        else scanningModifiers = false;
      }
      if (this.check("identifier") && (this.current().value === "constructor" || this.current().value === "init")) {
        const constructorName = this.current();
        this.advance();
        if (constructorName.value === "init") {
          this.diagnostics.push(diagnostic("VEL2022", "Use 'constructor(...)' for class construction; the separate 'init:' block was removed", constructorName.span));
        }
        if (methodAbstract || methodOverride || methodStatic || methodPrivate || asynchronous) {
          this.diagnostics.push(diagnostic("VEL2022", "A constructor does not accept method modifiers", span(methodStart, this.previous().span.end)));
        }
        parameters = constructorName.value === "constructor" ? [...this.parseClassConstructorParameters()] : [];
        const initBody = this.parseBlock();
        const block = {
          kind: "ClassInitBlock",
          body: initBody,
          span: span(methodStart, initBody.at(-1)?.span.end ?? this.previous().span.end),
        } satisfies ClassInitBlock;
        if (initialization) {
          this.diagnostics.push(diagnostic("VEL2022", `Class '${name.value}' has more than one constructor`, block.span));
        } else {
          initialization = block;
        }
        this.consumeNewlines();
        continue;
      }
      if (this.check("const") || this.check("let")) {
        const binding = this.advance().kind as "const" | "let";
        if (methodAbstract || methodOverride || asynchronous) {
          this.diagnostics.push(diagnostic("VEL2021", "Class fields support only the 'private' and 'static' modifiers; use 'const' for a read-only field", this.previous().span));
        }
        const fieldName = this.expectMemberName("Expected a class field name");
        let type: TypeReference;
        if (this.match("colon")) {
          type = this.parseTypeReference();
        } else {
          this.diagnostics.push(diagnostic("VEL2021", "Class fields require an explicit type", fieldName.span));
          type = { syntax: { kind: "NamedTypeSyntax", name: "unknown", span: fieldName.span }, span: fieldName.span };
        }
        const initializer = this.match("assign") ? this.parseExpression() : null;
        fields.push({
          binding,
          static: methodStatic,
          private: methodPrivate,
          name: fieldName.value,
          type,
          initializer,
          span: span(methodStart, initializer?.span.end ?? type.span.end),
        });
        this.expectStatementEnd();
        this.consumeNewlines();
        continue;
      }
      if (this.check("identifier") && this.current().value === "get") {
        this.advance();
        getters.push(this.parseClassGetter(methodStart, methodAbstract, methodOverride, methodStatic, methodPrivate, asynchronous));
        this.consumeNewlines();
        continue;
      }
      if (!this.match("def")) {
        if (this.match("pass")) {
          this.expectStatementEnd();
          this.consumeNewlines();
          continue;
        }
        const keywordGuidance = this.check("identifier") && this.peekKind(1) === "identifier"
          ? declarationKeywordGuidance(this.current().value)
          : null;
        if (keywordGuidance) {
          const shape = this.peekKind(2);
          if (keywordGuidance.keyword === "def" && (shape === "leftParen" || shape === "less")) {
            this.diagnostics.push(recoveredDiagnostic("VEL2026", keywordGuidance.message, this.current().span));
            this.advance();
            methods.push(this.parseClassMethod(methodStart, asynchronous, methodAbstract, methodOverride, methodStatic, methodPrivate));
            this.consumeNewlines();
            continue;
          }
          this.diagnostics.push(diagnostic("VEL2026", keywordGuidance.message, this.current().span));
          this.skipMistypedDeclaration();
          this.consumeNewlines();
          continue;
        }
        this.diagnostics.push(diagnostic("VEL2007", "Class bodies contain const/let fields, one constructor, get properties, methods, or 'pass'", this.current().span));
        this.synchronize();
        this.consumeNewlines();
        continue;
      }
      const method = this.parseClassMethod(methodStart, asynchronous, methodAbstract, methodOverride, methodStatic, methodPrivate);
      methods.push(method);
      this.consumeNewlines();
    }
    const close = this.expect("dedent", "Expected the end of class body");
    return {
      kind: "ClassDeclaration",
      exported,
      abstract,
      name: name.value,
      parameters,
      base,
      fields,
      initialization,
      getters,
      methods,
      span: span(start, Math.max(methods.at(-1)?.span.end ?? 0, getters.at(-1)?.span.end ?? 0, fields.at(-1)?.span.end ?? 0, initialization?.span.end ?? 0, close.span.end)),
    };
  }

  private parseClassGetter(
    start: number,
    abstract: boolean,
    override: boolean,
    static_: boolean,
    private_: boolean,
    asynchronous: boolean,
  ): ClassGetterDeclaration {
    const name = this.expectMemberName("Expected a getter name");
    if (this.check("less")) {
      this.parseTypeParameters();
      this.diagnostics.push(diagnostic("VEL2023", "A getter cannot declare type parameters", name.span));
    }
    this.expect("leftParen", "Expected '(' after a getter name");
    if (!this.check("rightParen")) {
      this.diagnostics.push(diagnostic("VEL2023", "A getter cannot accept parameters", this.current().span));
      while (!this.check("rightParen") && !this.check("newline") && !this.check("eof")) this.advance();
    }
    this.expect("rightParen", "Expected ')' after a getter name");
    let returnType: TypeReference;
    if (this.match("arrow")) {
      returnType = this.parseTypeReference();
    } else {
      this.diagnostics.push(diagnostic("VEL2023", "A getter requires an explicit result type", name.span));
      returnType = { syntax: { kind: "NamedTypeSyntax", name: "unknown", span: name.span }, span: name.span };
    }
    if (asynchronous) {
      this.diagnostics.push(diagnostic("VEL2023", "A getter cannot be async; expose an ordinary async method instead", span(start, returnType.span.end)));
    }
    if (abstract) {
      this.expectStatementEnd();
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
    const body = this.parseBlock();
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
    const name = this.expectMemberName("Expected a method name");
    const typeParameters = this.parseTypeParameters();
    const parameters = this.parseParameters();
    const parameterListEnd = this.previous().span.end;
    const returnType = this.match("arrow") ? this.parseTypeReference() : null;
    if (abstract) {
      this.expectStatementEnd();
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
    const body = this.parseBlock();
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
      body,
      span: span(start, body.at(-1)?.span.end ?? returnType?.span.end ?? name.span.end),
    };
  }

  private parseIf(start: number): IfStatement {
    return this.withParseDepth(() => this.parseIfBody(start));
  }

  private parseIfBody(start: number): IfStatement {
    const condition = this.parseExpression();
    const thenBody = this.parseBlock();
    this.consumeNewlines();

    let elseBody: readonly Statement[] | null = null;
    if (this.match("else")) {
      if (this.match("if")) {
        elseBody = [this.parseIf(this.previous().span.start)];
      } else {
        elseBody = this.parseBlock();
      }
    }

    const end = elseBody?.at(-1)?.span.end ?? thenBody.at(-1)?.span.end ?? condition.span.end;
    return { kind: "IfStatement", condition, thenBody, elseBody, span: span(start, end) };
  }

  private parseMatch(start: number): MatchStatement {
    const value = this.parseExpression();
    this.expect("colon", "Expected ':' before match cases");
    this.expect("newline", "Expected a newline before match cases");
    this.consumeNewlines();
    this.expect("indent", "Expected indented match cases");

    const cases: MatchStatement["cases"][number][] = [];
    this.consumeNewlines();
    while (!this.check("dedent") && !this.check("eof")) {
      const branchStart = this.current().span.start;
      if (this.match("case")) {
        const pattern = this.parseMatchPattern(true);
        const guard = this.match("if") ? this.parseExpression() : null;
        const body = this.parseBlock();
        cases.push({ pattern, guard, body, span: span(branchStart, body.at(-1)?.span.end ?? this.previous().span.end) });
      } else if (this.match("else")) {
        // D28 item 4: 'case _:' is the only fallback spelling. The removed
        // 'else:' clause recovers as a wildcard case so exhaustiveness and
        // the rest of the block keep analyzing without cascades.
        const keyword = this.previous();
        this.diagnostics.push(recoveredDiagnostic(
          "VEL2035",
          "Use 'case _:' for the fallback case; 'match' has no 'else' clause",
          keyword.span,
        ));
        const body = this.parseBlock();
        cases.push({
          pattern: { kind: "MatchWildcardPattern", span: keyword.span },
          guard: null,
          body,
          span: span(branchStart, body.at(-1)?.span.end ?? this.previous().span.end),
        });
      } else {
        this.diagnostics.push(diagnostic("VEL2015", "A match block accepts only case branches", this.current().span));
        this.synchronize();
      }
      this.consumeNewlines();
    }
    const close = this.expect("dedent", "Expected the end of a match block");
    if (cases.length === 0) {
      this.diagnostics.push(diagnostic("VEL2015", "A match block requires at least one case", span(start, close.span.end)));
    }
    const end = cases.at(-1)?.span.end ?? value.span.end;
    return { kind: "MatchStatement", value, cases, span: span(start, end) };
  }

  private startsMatchValue(): boolean {
    const kind = this.current().kind;
    return kind === "minus"
      || kind === "number"
      || kind === "string"
      || kind === "true"
      || kind === "false"
      || kind === "null"
      || (kind === "identifier" && this.peekKind(1) === "dot");
  }

  private parseMatchPattern(root: boolean): MatchStatement["cases"][number]["pattern"] {
    return this.withParseDepth(() => this.parseMatchPatternBody(root));
  }

  private parseMatchPatternBody(root: boolean): MatchStatement["cases"][number]["pattern"] {
    const start = this.current().span.start;
    let pattern: MatchStatement["cases"][number]["pattern"];

    if (this.match("leftBrace")) {
      const entries: Extract<MatchStatement["cases"][number]["pattern"], { kind: "MatchObjectPattern" }>["entries"][number][] = [];
      let rest: Extract<MatchStatement["cases"][number]["pattern"], { kind: "MatchObjectPattern" }>["rest"] = null;
      while (!this.check("rightBrace") && !this.check("eof")) {
        if (this.match("ellipsis")) {
          const binding = this.expect("identifier", "Expected an object rest binding after '...'");
          rest = { name: binding.value, span: binding.span };
          if (this.match("comma") && !this.check("rightBrace")) {
            this.diagnostics.push(diagnostic("VEL2015", "An object rest pattern must be last", this.current().span));
          }
          break;
        }
        const property = this.expectMemberName("Expected a field name in an object pattern");
        const renamed = this.match("colon");
        if (!renamed && property.kind !== "identifier") {
          this.diagnostics.push(diagnostic(
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
        if (!this.match("comma")) break;
      }
      const close = this.expect("rightBrace", "Expected '}' after an object pattern");
      pattern = { kind: "MatchObjectPattern", entries, rest, span: span(start, close.span.end) };
    } else if (this.match("leftBracket")) {
      const elements: Extract<MatchStatement["cases"][number]["pattern"], { kind: "MatchListPattern" }>["elements"][number][] = [];
      let rest: Extract<MatchStatement["cases"][number]["pattern"], { kind: "MatchListPattern" }>["rest"] = null;
      while (!this.check("rightBracket") && !this.check("eof")) {
        if (this.match("ellipsis")) {
          const binding = this.expect("identifier", "Expected a List rest binding after '...'");
          rest = { name: binding.value, span: binding.span };
          if (this.match("comma") && !this.check("rightBracket")) {
            this.diagnostics.push(diagnostic("VEL2015", "A List rest pattern must be last", this.current().span));
          }
          break;
        }
        elements.push(this.parseMatchPattern(false));
        if (!this.match("comma")) break;
      }
      const close = this.expect("rightBracket", "Expected ']' after a List pattern");
      pattern = { kind: "MatchListPattern", elements, rest, span: span(start, close.span.end) };
    } else if (this.check("identifier") && this.current().value === "_") {
      const wildcard = this.advance();
      pattern = { kind: "MatchWildcardPattern", span: wildcard.span };
    } else if (this.startsMatchValue()) {
      const values: Extract<MatchStatement["cases"][number]["pattern"], { kind: "MatchValuePattern" }>["values"][number][] = [];
      do {
        const value = this.parseMatchValue();
        if (value) values.push(value);
      } while (root && this.match("comma") && !this.check("as") && !this.check("if") && !this.check("colon"));
      pattern = {
        kind: "MatchValuePattern",
        values,
        span: span(start, values.at(-1)?.span.end ?? this.current().span.start),
      };
    } else if (!root && this.check("identifier")) {
      const binding = this.advance();
      pattern = {
        kind: "MatchCapturePattern",
        binding: { name: binding.value, span: binding.span },
        span: binding.span,
      };
    } else {
      const type = this.parseTypeReference();
      pattern = { kind: "MatchTypePattern", type, span: span(start, type.span.end) };
    }

    // ENM-U3: `case a | b:` reads naturally to authors from either parent
    // language, but alternatives are spelled with a comma; '|' joins types
    // only inside type annotations. One diagnostic, and the alternatives are
    // consumed so the rest of the match parses cleanly.
    if (root && this.check("pipe")) {
      this.diagnostics.push(diagnostic(
        "VEL2015",
        "Combine match alternatives with a comma — 'case a, b:'; '|' joins types only in type annotations",
        this.current().span,
      ));
      while (this.match("pipe") && !this.check("colon") && !this.check("newline") && !this.check("eof")) {
        if (this.startsMatchValue()) this.parseMatchValue();
        else this.parseMatchPattern(false);
      }
    }

    if (this.match("as")) {
      const binding = this.expect("identifier", "Expected a binding name after 'as'");
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
    const negative = this.match("minus");
    const start = negative ? this.previous().span.start : this.current().span.start;
    const token = this.current();
    if (negative) {
      const number = this.expect("number", "A negative match case requires a numeric literal");
      if (!number.value) return null;
      return this.numberLiteral(number, true, span(start, number.span.end));
    }
    if (token.kind === "identifier" && this.peekKind(1) === "dot") {
      // ENM-U2: a dotted path is a value pattern at any depth — the same rule
      // the father language uses (dotted = value, bare name = binding).
      const object = this.advance();
      let expression: Expression = { kind: "IdentifierExpression", name: object.value, span: object.span };
      while (this.match("dot")) {
        // ENM-I7: keyword member names follow the member-access grammar, so
        // `case S.null:` parses. `pass` stays out: it is the placeholder line
        // and the one name an enum can never declare (ENM-I8).
        if (this.check("pass")) {
          this.diagnostics.push(diagnostic(
            "VEL2015",
            "'pass' is the placeholder line, and the one name an enum never declares; no member spells it",
            this.current().span,
          ));
          this.advance();
          return null;
        }
        const property = this.expectMemberName("Expected an enum member after '.'");
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
    this.advance();
    switch (token.kind) {
      case "number": return this.numberLiteral(token);
      case "string": return { kind: "LiteralExpression", value: token.value, raw: token.value, span: token.span };
      case "true": return { kind: "LiteralExpression", value: true, raw: "true", span: token.span };
      case "false": return { kind: "LiteralExpression", value: false, raw: "false", span: token.span };
      case "null": return { kind: "LiteralExpression", value: null, raw: "null", span: token.span };
      default:
        this.diagnostics.push(diagnostic("VEL2015", "Match cases accept literals or qualified enum members", token.span));
        return null;
    }
  }

  private parseTry(start: number): Statement {
    const tryBody = this.parseBlock();
    this.consumeNewlines();
    let catchName: string | null = null;
    let catchBody: readonly Statement[] | null = null;
    let finallyBody: readonly Statement[] | null = null;

    if (this.match("catch")) {
      catchName = this.check("identifier") ? this.advance().value : "error";
      catchBody = this.parseBlock();
      this.consumeNewlines();
    }

    if (this.match("finally")) {
      finallyBody = this.parseBlock();
    }

    if (!catchBody && !finallyBody) {
      this.diagnostics.push(diagnostic("VEL2008", "A try block requires catch or finally", span(start, tryBody.at(-1)?.span.end ?? start)));
    }

    const end = finallyBody?.at(-1)?.span.end ?? catchBody?.at(-1)?.span.end ?? tryBody.at(-1)?.span.end ?? start;
    return { kind: "TryStatement", tryBody, catchName, catchBody, finallyBody, span: span(start, end) };
  }

  protected parseBlock(): readonly Statement[] {
    this.expect("colon", "Expected ':' before an indented block");
    this.expect("newline", "Expected a newline before an indented block");
    this.consumeNewlines();
    this.expect("indent", "Expected an indented block");

    const statements: Statement[] = [];
    this.consumeNewlines();
    while (!this.check("dedent") && !this.check("eof")) {
      const statement = this.parseStatement();
      if (statement) {
        statements.push(statement);
      } else {
        this.synchronize();
      }
      if (this.previous().kind !== "dedent") this.expectStatementBoundary();
      this.consumeNewlines();
    }
    this.expect("dedent", "Expected the end of an indented block");
    return statements;
  }

  protected parseTypeReference(allowTrailingOptional = true): TypeReference {
    return this.withParseDepth(() => this.parseTypeReferenceBody(allowTrailingOptional));
  }

  private parseTypeReferenceBody(allowTrailingOptional: boolean): TypeReference {
    const start = this.current().span.start;
    const members: TypeSyntax[] = [this.parseSingleTypeReference(allowTrailingOptional)];
    while (this.match("pipe")) {
      members.push(this.parseSingleTypeReference(allowTrailingOptional));
    }
    const referenceSpan = span(start, this.previous().span.end);
    return {
      syntax: members.length === 1 ? members[0]! : { kind: "UnionTypeSyntax", members, span: referenceSpan },
      span: referenceSpan,
    };
  }

  private parseSingleTypeReference(allowTrailingOptional = true): TypeSyntax {
    if (this.check("identifier") && this.current().value === "readonly") {
      const keyword = this.advance();
      const inner = this.parseSingleTypeReference(allowTrailingOptional);
      return { kind: "ReadonlyTypeSyntax", inner, span: span(keyword.span.start, inner.span.end) };
    }
    if (this.check("leftParen") && !this.isFunctionTypeParenthesis()) {
      const open = this.advance();
      const grouped = this.parseTypeReference();
      const close = this.expect("rightParen", "Expected ')' after grouped type");
      if (!allowTrailingOptional || !this.match("question")) return grouped.syntax;
      return this.makeOptionalTypeSyntax(grouped.syntax, span(open.span.start, this.previous().span.end));
    }
    if (this.match("leftParen")) {
      const open = this.previous();
      const parameters: Extract<TypeSyntax, { kind: "FunctionTypeSyntax" }>["parameters"][number][] = [];
      let sawRest = false;
      let sawOptional = false;
      if (!this.check("rightParen")) {
        do {
          const parameterStart = this.current().span.start;
          const rest = this.match("ellipsis");
          if (sawRest) this.diagnostics.push(diagnostic("VEL2016", "A rest function type parameter must be final", this.current().span));
          const named = this.check("identifier")
            && (this.peekKind(1) === "colon" || (this.peekKind(1) === "question" && this.peekKind(2) === "colon"));
          const parameterName = named ? this.advance().value : null;
          const optional = parameterName !== null && this.match("question");
          if (parameterName) this.expect("colon", "Expected ':' after a function type parameter name");
          const type = this.parseTypeReference();
          if (rest && optional) this.diagnostics.push(diagnostic("VEL2016", "A rest function type parameter cannot be optional", span(parameterStart, type.span.end)));
          if (!optional && sawOptional && !rest) {
            this.diagnostics.push(diagnostic("VEL2016", "A required function type parameter cannot follow an optional parameter", span(parameterStart, type.span.end)));
          }
          parameters.push({ name: parameterName, type: type.syntax, rest, optional, span: span(parameterStart, type.span.end) });
          if (optional) sawOptional = true;
          if (rest) sawRest = true;
        } while (this.match("comma") && !this.check("rightParen"));
      }
      this.expect("rightParen", "Expected ')' after function type parameters");
      this.expect("arrow", "Expected '->' after function type parameters");
      const result = this.parseTypeReference();
      return { kind: "FunctionTypeSyntax", parameters, result: result.syntax, span: span(open.span.start, result.span.end) };
    }
    const name = this.check("null") ? this.advance() : this.expect("identifier", "Expected a type name");
    const nameGuidance = sourceTypeNameGuidance(name.value);
    if (nameGuidance) {
      // A guidance spelling with a replacement recovers as the guided type
      // name so semantic analysis still runs and reports its own guidance.
      this.diagnostics.push(nameGuidance.replacement
        ? recoveredDiagnostic("VEL2012", nameGuidance.message, name.span)
        : diagnostic("VEL2012", nameGuidance.message, name.span));
    }
    const typeName = nameGuidance?.replacement ?? name.value;
    if (this.match("dot")) {
      const member = this.expect("identifier", "Expected an enum member after '.' in a singleton type");
      const syntax: TypeSyntax = {
        kind: "EnumMemberTypeSyntax",
        enumName: typeName,
        enumNameSpan: name.span,
        member: member.value,
        memberSpan: member.span,
        span: span(name.span.start, member.span.end),
      };
      return this.finishTypeReferenceSuffix(syntax, allowTrailingOptional);
    }
    let syntax: TypeSyntax = { kind: "NamedTypeSyntax", name: typeName, span: name.span };
    const angleArguments = this.match("less");
    const squareArguments = !angleArguments && this.match("leftBracket");
    if (angleArguments || squareArguments) {
      const open = this.previous();
      const closeKind = squareArguments ? "rightBracket" : "greater";
      const arguments_: TypeSyntax[] = [];
      if (!this.check(closeKind)) {
        do {
          arguments_.push(this.parseTypeReference().syntax);
        } while (this.match("comma") && !this.check(closeKind));
      }
      const close = this.expect(closeKind, squareArguments ? "Expected ']' after type arguments" : "Expected '>' after type arguments");
      if (squareArguments && arguments_.length === 0) {
        // A postfix 'Name[]' array annotation guides straight to the List
        // spelling and recovers as 'List<Name>'.
        this.diagnostics.push(recoveredDiagnostic(
          "VEL2012",
          `Use 'List<${name.value}>' for ordered collections; VelarScript has no postfix '[]' array types`,
          span(name.span.start, close.span.end),
        ));
        return this.finishTypeReferenceSuffix({
          kind: "GenericTypeSyntax",
          name: "List",
          nameSpan: name.span,
          arguments: [syntax],
          span: span(name.span.start, close.span.end),
        }, allowTrailingOptional);
      }
      if (squareArguments) {
        this.diagnostics.push(recoveredDiagnostic("VEL2012", "Generic type arguments use '<...>', not '[...]'", span(open.span.start, close.span.end)));
      }
      const expectedArguments = typeName === "Map" ? 2 : typeName === "List" || typeName === "Set" || typeName === "Record" || typeName === "Promise" || typeName === "Type" ? 1 : null;
      if (this.validateExtensionTypeArguments(typeName, arguments_, name.span)) {
        // The owning extension validates its own generic surface.
      } else if (typeName === "Function" && arguments_.length === 0) {
        this.diagnostics.push(diagnostic("VEL2012", "Write bare 'Function' for () -> null, or provide at least one type argument whose final type is the result", name.span));
      } else if (expectedArguments !== null && arguments_.length !== expectedArguments) {
        this.diagnostics.push(diagnostic("VEL2012", `Type '${typeName}' expects ${expectedArguments} type argument${expectedArguments === 1 ? "" : "s"}`, name.span));
      }
      syntax = { kind: "GenericTypeSyntax", name: typeName, nameSpan: name.span, arguments: arguments_, span: span(name.span.start, close.span.end) };
    }
    return this.finishTypeReferenceSuffix(syntax, allowTrailingOptional);
  }

  protected validateExtensionTypeArguments(_name: string, _arguments: readonly TypeSyntax[], _nameSpan: Span): boolean {
    return false;
  }

  private finishTypeReferenceSuffix(syntax: TypeSyntax, allowTrailingOptional = true): TypeSyntax {
    if (allowTrailingOptional && this.match("question")) {
      return this.makeOptionalTypeSyntax(syntax, span(syntax.span.start, this.previous().span.end));
    }
    return syntax;
  }

  private makeOptionalTypeSyntax(inner: TypeSyntax, optionalSpan: Span): TypeSyntax {
    if (inner.kind === "NamedTypeSyntax" && inner.name === "null") {
      this.diagnostics.push(recoveredDiagnostic("VEL2012", "'null?' is redundant; use 'null'", optionalSpan));
      return { ...inner, span: optionalSpan };
    }
    return { kind: "OptionalTypeSyntax", inner, span: optionalSpan };
  }

  private isFunctionTypeParenthesis(): boolean {
    let depth = 0;
    for (let offset = 0; this.index + offset < this.tokens.length; offset += 1) {
      const kind = this.tokens[this.index + offset]!.kind;
      if (kind === "leftParen") depth += 1;
      else if (kind === "rightParen" && --depth === 0) return this.tokens[this.index + offset + 1]?.kind === "arrow";
      else if (kind === "newline" || kind === "eof") return false;
    }
    return false;
  }

  protected parseExpression(minimumPrecedence = 0): Expression {
    return this.withParseDepth(() => this.parseExpressionBody(minimumPrecedence));
  }

  private parseExpressionBody(minimumPrecedence = 0): Expression {
    const asynchronousArrow = minimumPrecedence === 0
      && this.check("async")
      && ((this.peekKind(1) === "leftParen" && this.isParenthesizedArrow(1))
        || (this.peekKind(1) === "identifier" && this.peekKind(2) === "fatArrow"));
    if (asynchronousArrow) {
      const start = this.advance().span.start;
      return this.parseArrowExpression(start, true);
    }
    if (minimumPrecedence === 0 && this.check("leftParen") && this.isParenthesizedArrow()) {
      return this.parseArrowExpression(this.current().span.start, false);
    }
    if (minimumPrecedence === 0 && this.check("identifier") && this.peekKind(1) === "fatArrow") {
      return this.parseArrowExpression(this.current().span.start, false);
    }

    let left = this.parseUnary();

    while (true) {
      // '|' never operates on values — the union spelling lives in type
      // annotations — and the author reaching for it here almost always
      // means 'or'. Recovery reads it that way under one diagnostic.
      if (this.check("pipe") && binaryPrecedence.or! >= minimumPrecedence) {
        const operator = this.advance();
        this.diagnostics.push(recoveredDiagnostic(
          "VEL2031",
          "'|' joins types only in type annotations; combine conditions with 'or'",
          operator.span,
        ));
        const right = this.parseExpression(binaryPrecedence.or! + 1);
        left = {
          kind: "BinaryExpression",
          left,
          operator: "or",
          right,
          span: span(left.span.start, right.span.end),
        } satisfies BinaryExpression;
        continue;
      }
      const javaScriptInstanceof = this.check("identifier") && this.current().value === "instanceof";
      const compoundNotIn = this.check("not") && this.peekKind(1) === "in";
      const precedence = javaScriptInstanceof
        ? binaryPrecedence.is
        : compoundNotIn
          ? binaryPrecedence.in
          : binaryPrecedence[this.current().kind];
      if (precedence === undefined || precedence < minimumPrecedence) {
        break;
      }

      const operator = this.advance();
      if (compoundNotIn) this.advance();
      const comparisonOperator = comparisonOperators[operator.kind];
      if (comparisonOperator) {
        const operands: Expression[] = [left];
        const operators: ComparisonChainExpression["operators"][number][] = [];
        let nextOperator: ComparisonChainExpression["operators"][number] | undefined = comparisonOperator;
        while (nextOperator) {
          operators.push(nextOperator);
          operands.push(this.parseExpression(precedence + 1));
          nextOperator = comparisonOperators[this.current().kind];
          if (nextOperator) this.advance();
        }
        left = operators.length === 1
          ? {
              kind: "BinaryExpression",
              left: operands[0]!,
              operator: operators[0]!,
              right: operands[1]!,
              span: span(operands[0]!.span.start, operands[1]!.span.end),
            } satisfies BinaryExpression
          : {
              kind: "ComparisonChainExpression",
              operands,
              operators,
              span: span(operands[0]!.span.start, operands.at(-1)!.span.end),
            } satisfies ComparisonChainExpression;
        continue;
      }
      if (operator.kind === "is" || javaScriptInstanceof) {
        if (javaScriptInstanceof) {
          this.diagnostics.push(recoveredDiagnostic(
            "VEL2031",
            "Use 'is' for a type test; VelarScript does not expose JavaScript 'instanceof'",
            operator.span,
          ));
        }
        const negated = this.match("not");
        // 'is' tests runtime types and 'null' is a value, so 'is [not] null'
        // is the removed spelling of the equality test. Recovery builds the
        // '== null' / '!= null' comparison itself, so narrowing and every
        // later stage still run, and a '?' after the test keeps meaning '?:'
        // instead of being read as an optional-type marker.
        if (this.check("null") && this.peekKind(1) !== "pipe" && this.peekKind(1) !== "dot") {
          const nullToken = this.advance();
          // 'null?' spells the same removed test; consume the '?' only when it
          // ends the test (an optional-type marker), never when it opens a
          // conditional expression.
          const question = this.check("question") && !this.questionContinuesExpression() ? this.advance() : null;
          const end = question?.span.end ?? nullToken.span.end;
          this.diagnostics.push(recoveredDiagnostic(
            "VEL2033",
            negated
              ? "Use '!= null' to test for a value; 'is' tests runtime types"
              : "Use '== null' to test for a value; 'is' tests runtime types",
            span(operator.span.start, end),
          ));
          left = {
            kind: "BinaryExpression",
            left,
            operator: negated ? "!=" : "==",
            right: { kind: "LiteralExpression", value: null, raw: "null", span: nullToken.span },
            span: span(left.span.start, end),
          } satisfies BinaryExpression;
          continue;
        }
        const conditionalTypeTest = this.typeTestHasConditionalQuestion();
        const type = this.parseTypeReference(!conditionalTypeTest);
        if (conditionalTypeTest) {
          this.diagnostics.push(recoveredDiagnostic(
            "VEL2031",
            "Parenthesize the type test before a conditional: '(value is Type) ? then : else'; '?' immediately after a type can also mean an optional type",
            span(left.span.start, this.current().span.end),
          ));
        }
        left = {
          kind: "IsExpression",
          value: left,
          operator: negated ? "is not" : "is",
          type,
          span: span(left.span.start, type.span.end),
        };
        continue;
      }

      const right = this.parseExpression(precedence + 1);
      const spelledOperator = compoundNotIn ? "not in" : this.binaryOperator(operator);
      this.checkNullishBooleanMixing(spelledOperator, left, right, operator.span);
      left = {
        kind: "BinaryExpression",
        left,
        operator: spelledOperator,
        right,
        span: span(left.span.start, right.span.end),
      } satisfies BinaryExpression;
    }

    if (minimumPrecedence === 0 && this.match("question")) {
      const thenValue = this.parseExpression();
      this.expect("colon", "Expected ':' in conditional expression");
      const elseValue = this.parseExpression();
      return { kind: "ConditionalExpression", condition: left, thenValue, elseValue, span: span(left.span.start, elseValue.span.end) };
    }

    if (minimumPrecedence === 0 && this.check("if") && this.hasPythonConditionalElse()) {
      // 'x if cond else y' guides to the '?:' spelling and recovers as the
      // equivalent conditional expression so deeper guidance still surfaces.
      this.diagnostics.push(recoveredDiagnostic(
        "VEL2027",
        "Use 'cond ? x : y'; VelarScript writes conditional expressions with '?:', not 'x if cond else y'",
        this.current().span,
      ));
      this.advance();
      const condition = this.parseExpression();
      this.expect("else", "Expected 'else' in a conditional expression");
      const elseValue = this.parseExpression();
      return { kind: "ConditionalExpression", condition, thenValue: left, elseValue, span: span(left.span.start, elseValue.span.end) };
    }

    return left;
  }

  // True when an expression is followed by Python's 'x if cond else y'
  // conditional shape: an 'if' whose matching 'else' appears at the same
  // bracket depth before the expression context can end. Statement-level if
  // blocks never reach this check, and 'for x in xs if cond:' style filters
  // (no 'else') are left to ordinary parse errors.
  private hasPythonConditionalElse(): boolean {
    let depth = 0;
    for (let offset = 1; this.index + offset < this.tokens.length; offset += 1) {
      const kind = this.peekKind(offset);
      if (kind === "leftParen" || kind === "leftBracket" || kind === "leftBrace") depth += 1;
      else if (kind === "rightParen" || kind === "rightBracket" || kind === "rightBrace") {
        if (depth === 0) return false;
        depth -= 1;
      } else if (depth === 0 && kind === "else") return true;
      else if (depth === 0 && (kind === "colon" || kind === "comma")) return false;
      else if (kind === "newline" || kind === "indent" || kind === "dedent" || kind === "eof") return false;
    }
    return false;
  }

  private parseArrowExpression(start: number, asynchronous: boolean): ArrowFunctionExpression {
    if (this.check("leftParen")) {
      const parameters = this.parseParameters();
      this.expect("fatArrow", "Expected '=>' after arrow parameters");
      const body = this.parseArrowBody();
      return { kind: "ArrowFunctionExpression", asynchronous, parameters, body, span: span(start, body.span.end) };
    }
    const parameterToken = this.expect("identifier", "Expected an arrow parameter");
    this.expect("fatArrow", "Expected '=>' after arrow parameter");
    const body = this.parseArrowBody();
    const parameter: Parameter = { name: parameterToken.value, type: null, defaultValue: null, rest: false, span: parameterToken.span };
    return { kind: "ArrowFunctionExpression", asynchronous, parameters: [parameter], body, span: span(start, body.span.end) };
  }

  // An arrow body is one expression by design (charter §7): '{' after '=>'
  // opens a record literal, never a JavaScript statement block. When the
  // braces clearly hold statements, one targeted diagnostic replaces the
  // record-literal error cascade and the braces are skipped whole. Record
  // shapes — '{...t, done: true}', '{id: value}', '{a, b}' — parse normally.
  private parseArrowBody(): Expression {
    if (this.check("leftBrace") && this.arrowBraceHoldsStatements()) {
      const open = this.advance();
      let end = open.span.end;
      let depth = 1;
      while (depth > 0) {
        const kind = this.current().kind;
        if (kind === "eof" || kind === "newline" || kind === "indent" || kind === "dedent") break;
        if (kind === "leftBrace") depth += 1;
        else if (kind === "rightBrace") depth -= 1;
        end = this.advance().span.end;
      }
      this.diagnostics.push(diagnostic(
        "VEL2030",
        "An arrow body is a single expression; write the expression directly or move multi-statement logic into a named 'def'",
        span(open.span.start, end),
      ));
      return { kind: "LiteralExpression", value: null, raw: "null", span: span(open.span.start, end) };
    }
    return this.recoverExpressionAssignment(this.parseExpression());
  }

  // Scans the braces after '=>' without consuming tokens. Statement keywords
  // that cannot open a record field decide first; a top-level ':' or '...'
  // decides for a record; otherwise any token that cannot sit in a record
  // field list (call parentheses, operators, literals) marks statements.
  private arrowBraceHoldsStatements(): boolean {
    let depth = 0;
    let sawNonRecordToken = false;
    for (let offset = 0; this.index + offset < this.tokens.length; offset += 1) {
      const token = this.tokens[this.index + offset]!;
      const kind = token.kind;
      if (kind === "eof" || kind === "newline" || kind === "indent" || kind === "dedent") break;
      if (kind === "leftBrace" || kind === "leftParen" || kind === "leftBracket") {
        if (depth === 1) sawNonRecordToken = true;
        depth += 1;
        continue;
      }
      if (kind === "rightBrace" || kind === "rightParen" || kind === "rightBracket") {
        depth -= 1;
        if (depth === 0) break;
        continue;
      }
      if (depth !== 1) continue;
      if (statementStarterKinds.has(kind) && this.tokens[this.index + offset + 1]?.kind !== "colon") return true;
      if (kind === "colon" || kind === "ellipsis") return false;
      if (!recordFieldLevelKinds.has(kind)) sawNonRecordToken = true;
    }
    return sawNonRecordToken;
  }

  private isParenthesizedArrow(initialOffset = 0): boolean {
    let depth = 0;
    for (let offset = initialOffset; this.index + offset < this.tokens.length; offset += 1) {
      const kind = this.tokens[this.index + offset]!.kind;
      if (kind === "leftParen") depth += 1;
      else if (kind === "rightParen") {
        depth -= 1;
        if (depth === 0) return this.tokens[this.index + offset + 1]?.kind === "fatArrow";
      }
      if (kind === "newline" || kind === "eof") return false;
    }
    return false;
  }

  private parseUnary(): Expression {
    if (this.check("identifier") && (this.current().value === "delete" || this.current().value === "typeof")
      && !["rightParen", "rightBracket", "rightBrace", "comma", "colon", "newline", "dedent", "eof"].includes(this.peekKind(1))) {
      const operator = this.advance();
      this.diagnostics.push(recoveredDiagnostic(
        "VEL2031",
        operator.value === "delete"
          ? "VelarScript does not expose JavaScript 'delete'; use a collection remove operation or construct updated data explicitly"
          : "Use 'is' or a declared type; VelarScript does not expose JavaScript 'typeof'",
        operator.span,
      ));
      return this.withParseDepth(() => this.parseUnary());
    }
    if ((this.check("plus") || this.check("minus")) && this.peekKind(1) === this.current().kind
      && this.current().span.end === this.tokens[this.index + 1]!.span.start) {
      // GRM-D2: '++value' parses as '+(+value)' — a legal silent no-op — so
      // the stacked-operator spelling is taught directly.
      const first = this.current();
      const operator = first.kind === "plus" ? "+" : "-";
      const target = this.tokens[this.index + 2];
      const name = target?.kind === "identifier" ? target.value : "name";
      this.diagnostics.push(recoveredDiagnostic(
        "VEL2031",
        `VelarScript has no '${operator}${operator}'; write '${name} ${operator}= 1'`,
        span(first.span.start, this.tokens[this.index + 1]!.span.end),
      ));
      this.advance();
      this.advance();
      return this.withParseDepth(() => this.parseUnary());
    }
    if (this.match("not") || this.match("plus") || this.match("minus")) {
      const operator = this.previous();
      return this.withParseDepth(() => {
        const operand = this.parseUnary();
        return {
          kind: "UnaryExpression",
          operator: operator.kind === "not" ? "not" : operator.kind === "plus" ? "+" : "-",
          operand,
          span: span(operator.span.start, operand.span.end),
        };
      });
    }
    return this.parsePower();
  }

  private parsePower(): Expression {
    const left = this.parsePowerBase();
    if (!this.match("starStar")) return left;
    const operator = this.previous();
    return this.withParseDepth(() => {
      const right = this.parseUnary();
      return {
        kind: "BinaryExpression",
        operator: "**",
        left,
        right,
        span: span(left.span.start, right.span.end),
      };
    });
  }

  private parsePowerBase(): Expression {
    if (!this.match("await")) return this.parsePostfix();
    const operator = this.previous();
    return this.withParseDepth(() => {
      const operand = this.check("not") || this.check("plus") || this.check("minus")
        ? this.parseUnary()
        : this.parsePowerBase();
      return {
        kind: "UnaryExpression",
        operator: "await",
        operand,
        span: span(operator.span.start, operand.span.end),
      };
    });
  }

  private parsePostfix(): Expression {
    let expression = this.parsePrimary();

    while (true) {
      const explicitTypeArgumentsEnd = this.explicitTypeArgumentsEnd(expression);
      if (explicitTypeArgumentsEnd !== null) {
        const start = this.current().span.start;
        while (this.index <= explicitTypeArgumentsEnd) this.advance();
        const name = expression.kind === "IdentifierExpression" ? expression.name
          : expression.kind === "MemberExpression" ? expression.property
            : "function";
        this.diagnostics.push(recoveredDiagnostic(
          "VEL2031",
          `Type arguments are inferred at each call site; write '${name}(...)' without '<...>'`,
          span(start, this.previous().span.end),
        ));
        continue;
      }
      let call = false;
      let optionalCall = false;
      if (this.match("leftParen")) {
        call = true;
      } else if (this.check("optionalDot") && this.peekKind(1) === "leftParen") {
        this.advance();
        this.advance();
        call = true;
        optionalCall = true;
      }
      if (call) {
        const arguments_: Expression[] = [];
        const argumentNames: (string | null)[] = [];
        let sawNamed = false;
        let sawSpread = false;
        if (!this.check("rightParen")) {
          do {
            if ((this.check("identifier") || this.check("from")) && this.peekKind(1) === "colon") {
              const name = this.advance();
              this.advance();
              this.diagnostics.push(diagnostic("VEL2024", `Write '=' between the name and value for named argument '${name.value}': ${name.value} = value`, name.span));
              if (sawSpread) this.diagnostics.push(diagnostic("VEL2024", "Named arguments cannot be combined with a call spread", name.span));
              sawNamed = true;
              argumentNames.push(name.value);
              arguments_.push(this.parseExpression());
              this.recoverChainedNamedArgument();
            } else if ((this.check("identifier") || this.check("from")) && this.peekKind(1) === "assign") {
              const name = this.advance();
              this.advance();
              if (sawSpread) this.diagnostics.push(diagnostic("VEL2024", "Named arguments cannot be combined with a call spread", name.span));
              sawNamed = true;
              argumentNames.push(name.value);
              arguments_.push(this.parseExpression());
              this.recoverChainedNamedArgument();
            } else {
              const argument = this.parseSpreadExpression();
              if (sawNamed) this.diagnostics.push(diagnostic("VEL2024", "Positional arguments must appear before named arguments", argument.span));
              if (argument.kind === "SpreadExpression") sawSpread = true;
              argumentNames.push(null);
              arguments_.push(argument);
            }
          } while (this.match("comma") && !this.check("rightParen"));
        }
        const close = this.expect("rightParen", "Expected ')' after arguments");
        expression = {
          kind: "CallExpression",
          callee: expression,
          arguments: arguments_,
          ...(sawNamed ? { argumentNames } : {}),
          optional: optionalCall,
          span: span(expression.span.start, close.span.end),
        };
        continue;
      }

      if (this.check("optionalDot") && this.peekKind(1) === "leftBracket") {
        this.advance();
        this.advance();
        const index = this.parseExpression();
        const close = this.expect("rightBracket", "Expected ']' after optional index");
        expression = { kind: "IndexExpression", object: expression, index, optional: true, span: span(expression.span.start, close.span.end) };
        continue;
      }

      if (this.match("dot") || this.match("optionalDot")) {
        const optional = this.previous().kind === "optionalDot";
        const property = this.expectMemberName();
        expression = { kind: "MemberExpression", object: expression, property: property.value, optional, span: span(expression.span.start, property.span.end) };
        continue;
      }

      if (this.match("leftBracket")) {
        const index = this.parseExpression();
        const close = this.expect("rightBracket", "Expected ']' after index");
        expression = { kind: "IndexExpression", object: expression, index, optional: false, span: span(expression.span.start, close.span.end) };
        continue;
      }

      break;
    }

    return expression;
  }

  private explicitTypeArgumentsEnd(expression: Expression): number | null {
    const callableName = expression.kind === "IdentifierExpression" ? expression.name
      : expression.kind === "MemberExpression" ? expression.property
        : null;
    if (callableName === null || !this.check("less") || this.current().span.start !== expression.span.end) return null;
    // Beyond the same-file generic-name list, the recovery extends to any
    // callee — imported generics and methods — when the angle content carries
    // type evidence: a builtin type name, a capitalized name, optional or
    // union syntax, or nested generics. Without that evidence the comparison
    // reading wins, so `a<b>(c)` over three numbers stays a chain (rule #41).
    const knownGeneric = this.genericCallableNames.has(callableName);
    const typeEvidence = (token: Token): boolean => {
      if (token.kind === "question" || token.kind === "pipe" || token.kind === "arrow") return true;
      if (token.kind !== "identifier") return false;
      if (["string", "number", "bool", "null", "unknown", "any", "List", "Set", "Map", "Record", "Promise", "Function", "Type", "readonly"].includes(token.value)) return true;
      const first = token.value[0] ?? "";
      return first >= "A" && first <= "Z";
    };
    let sawTypeEvidence = false;
    let depth = 0;
    for (let index = this.index; index < this.tokens.length; index += 1) {
      const token = this.tokens[index]!;
      if (token.kind === "newline" || token.kind === "eof") return null;
      if (token.kind === "less") {
        depth += 1;
        if (depth >= 2) sawTypeEvidence = true;
      } else if (token.kind === "greater") {
        depth -= 1;
        if (depth === 0) {
          const call = this.tokens[index + 1];
          if (call?.kind !== "leftParen" || call.span.start !== token.span.end) return null;
          return knownGeneric || sawTypeEvidence ? index : null;
        }
      } else if (typeEvidence(token)) {
        sawTypeEvidence = true;
      }
    }
    return null;
  }

  // True when the '?' at the current position opens a conditional expression:
  // more of the expression follows on the logical line. A '?' that ends the
  // line is an optional-type marker. This is the same reading
  // typeTestHasConditionalQuestion applies to a '?' directly after a type.
  private questionContinuesExpression(): boolean {
    const next = this.peekKind(1);
    return next !== "newline" && next !== "dedent" && next !== "eof";
  }

  private typeTestHasConditionalQuestion(): boolean {
    let angles = 0;
    let parentheses = 0;
    let brackets = 0;
    for (let offset = 0; this.index + offset < this.tokens.length; offset += 1) {
      const token = this.tokens[this.index + offset]!;
      if (token.kind === "newline" || token.kind === "dedent" || token.kind === "eof") return false;
      if (token.kind === "less") angles += 1;
      else if (token.kind === "greater") angles = Math.max(0, angles - 1);
      else if (token.kind === "leftParen") parentheses += 1;
      else if (token.kind === "rightParen") {
        if (parentheses === 0) return false;
        parentheses -= 1;
      }
      else if (token.kind === "leftBracket") brackets += 1;
      else if (token.kind === "rightBracket") {
        if (brackets === 0) return false;
        brackets -= 1;
      }
      else if (token.kind === "question" && angles === 0 && parentheses === 0 && brackets === 0) {
        const next = this.tokens[this.index + offset + 1]?.kind;
        return next !== undefined && next !== "newline" && next !== "dedent" && next !== "eof";
      }
    }
    return false;
  }

  private parsePrimary(): Expression {
    const token = this.advance();
    switch (token.kind) {
      case "number":
        return this.numberLiteral(token);
      case "unitNumber": {
        const match = /^(\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)([A-Za-z%]+)$/u.exec(token.value);
        if (!match) {
          this.diagnostics.push(diagnostic("VEL2002", "Invalid unit literal", token.span));
          return { kind: "LiteralExpression", value: 0, raw: "0", span: token.span };
        }
        const value = Number(match[1]);
        if (!Number.isFinite(value)) this.diagnostics.push(diagnostic("VEL2017", "Numeric literals must be finite", token.span));
        const extensionExpression = this.parseExtensionNumericLiteral(
          token,
          Number.isFinite(value) ? value : 0,
          match[2]!,
        );
        if (extensionExpression) return extensionExpression;
        this.diagnostics.push(diagnostic("VEL2002", `No compiler extension accepts numeric suffix '${match[2]}'`, token.span));
        return { kind: "LiteralExpression", value: 0, raw: "0", span: token.span };
      }
      case "string":
        return { kind: "LiteralExpression", value: token.value, raw: token.value, span: token.span };
      case "import": {
        this.expect("leftParen", "Expected '(' after 'import'");
        const source = this.expect("string", "Dynamic imports require a literal relative .vel path");
        const close = this.expect("rightParen", "Expected ')' after dynamic import path");
        if ((!source.value.startsWith("./") && !source.value.startsWith("../")) || !source.value.endsWith(".vel")) {
          this.diagnostics.push(diagnostic(
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
        const extensionExpression = this.parseExtensionExpression(token);
        if (extensionExpression) return extensionExpression;
        this.diagnostics.push(diagnostic("VEL2002", "No compiler extension accepts this embedded expression", token.span));
        return { kind: "LiteralExpression", value: null, raw: "null", span: token.span };
      }
      case "extensionKeyword": {
        const extensionExpression = this.parseExtensionExpression(token);
        if (extensionExpression) return extensionExpression;
        this.diagnostics.push(diagnostic("VEL2002", `Extension keyword '${token.value}' is not valid in this expression`, token.span));
        return { kind: "LiteralExpression", value: null, raw: "null", span: token.span };
      }
      case "true":
        return { kind: "LiteralExpression", value: true, raw: token.value, span: token.span };
      case "false":
        return { kind: "LiteralExpression", value: false, raw: token.value, span: token.span };
      case "null":
        return { kind: "LiteralExpression", value: null, raw: token.value, span: token.span };
      case "identifier":
        if (token.value === "function" && (this.check("leftParen") || (this.check("identifier") && this.peekKind(1) === "leftParen"))) {
          this.diagnostics.push(diagnostic(
            "VEL2031",
            "VelarScript has no 'function' expressions; declare 'def name(...)' or write an arrow '(x) => value'",
            token.span,
          ));
          this.synchronize();
          return { kind: "LiteralExpression", value: null, raw: "null", span: token.span };
        }
        return { kind: "IdentifierExpression", name: token.value, span: token.span };
      case "super":
        return { kind: "SuperExpression", span: token.span };
      case "leftParen": {
        const expression = this.parseExpression();
        this.expect("rightParen", "Expected ')' after expression");
        // Explicit parentheses are the author's grouping decision. Binary
        // nodes carry that fact so the '??' / 'and' / 'or' mixing rule can
        // tell a deliberate grouping from a bare chain.
        return expression.kind === "BinaryExpression" ? { ...expression, parenthesized: true } : expression;
      }
      case "leftBracket": {
        const elements: Expression[] = [];
        if (!this.check("rightBracket")) {
          do {
            elements.push(this.parseSpreadExpression());
          } while (this.match("comma") && !this.check("rightBracket"));
        }
        const close = this.expect("rightBracket", "Expected ']' after list elements");
        return { kind: "ListExpression", elements, span: span(token.span.start, close.span.end) };
      }
      case "leftBrace": {
        const properties: Extract<Expression, { kind: "ObjectExpression" }>["properties"][number][] = [];
        if (!this.check("rightBrace")) {
          do {
            if (this.match("ellipsis")) {
              const spread = this.previous();
              const value = this.parseExpression();
              properties.push({ kind: "ObjectSpread", value, span: span(spread.span.start, value.span.end) });
              continue;
            }
            const name = memberNameKinds.has(this.current().kind) || this.check("string")
              ? this.advance()
              : this.expect("identifier", "Expected an object field name");
            const hasValue = this.match("colon");
            if (!hasValue && name.kind !== "identifier") {
              this.diagnostics.push(diagnostic("VEL2020", "A keyword or quoted object field requires ':' and a value", name.span));
            }
            const value = hasValue
              ? this.parseExpression()
              : name.kind === "identifier"
                ? { kind: "IdentifierExpression", name: name.value, span: name.span } satisfies IdentifierExpression
                : { kind: "LiteralExpression", value: null, raw: "null", span: name.span } satisfies Expression;
            properties.push({ kind: "ObjectProperty", name: name.value, value, span: span(name.span.start, value.span.end) });
          } while (this.match("comma") && !this.check("rightBrace"));
        }
        const close = this.expect("rightBrace", "Expected '}' after object fields");
        return { kind: "ObjectExpression", properties, span: span(token.span.start, close.span.end) };
      }
      default:
        if (token.kind === "indent") {
          // GRM-A5's sibling shape: a line indented under a complete
          // statement continues nothing. One diagnostic owns the whole
          // orphan block so its lines do not cascade.
          this.diagnostics.push(diagnostic(
            "VEL2002",
            "A statement ends at its newline; this indented line continues nothing — parenthesize an expression to span lines, or align the line with its block",
            token.span,
          ));
          let blocks = 1;
          while (blocks > 0 && !this.check("eof")) {
            if (this.check("indent")) blocks += 1;
            else if (this.check("dedent")) blocks -= 1;
            this.advance();
          }
          return { kind: "LiteralExpression", value: null, raw: "null", span: token.span };
        }
        if (token.kind === "newline" || token.kind === "dedent" || token.kind === "eof") {
          // GRM-A5: an operator dangling at the line end leaves the parser at
          // the statement boundary. GRM-D2's postfix shape lands here too
          // (`i++` parses as `i + +<nothing>`), so it gets its own teaching.
          const beforeBoundary = this.tokens[this.index - 2];
          const stacked = this.tokens[this.index - 3];
          const increment = beforeBoundary && stacked
            && beforeBoundary.kind === stacked.kind
            && (beforeBoundary.kind === "plus" || beforeBoundary.kind === "minus")
            && stacked.span.end === beforeBoundary.span.start;
          if (increment) {
            const operator = beforeBoundary.kind === "plus" ? "+" : "-";
            const target = this.tokens[this.index - 4];
            const name = target?.kind === "identifier" ? target.value : "name";
            this.diagnostics.push(diagnostic(
              "VEL2031",
              `VelarScript has no '${operator}${operator}'; write '${name} ${operator}= 1'`,
              span(stacked.span.start, beforeBoundary.span.end),
            ));
          } else {
            this.diagnostics.push(diagnostic(
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
            while (this.peekKind(ahead) === "newline") ahead += 1;
            if (this.peekKind(ahead) === "indent") {
              while (ahead > 0) {
                this.advance();
                ahead -= 1;
              }
              this.advance();
              let blocks = 1;
              while (blocks > 0 && !this.check("eof")) {
                if (this.check("indent")) blocks += 1;
                else if (this.check("dedent")) blocks -= 1;
                this.advance();
              }
            } else {
              this.index -= 1;
            }
          } else if (token.kind === "dedent") {
            this.index -= 1;
          }
          return { kind: "LiteralExpression", value: null, raw: "null", span: token.span };
        }
        this.diagnostics.push(diagnostic("VEL2002", "Expected an expression", token.span));
        return { kind: "LiteralExpression", value: null, raw: "null", span: token.span };
    }
  }

  // GRM-T1: `f(x=y=2)` chains a second '=' after the named value; the whole
  // chain is consumed under one diagnostic so ')' recovery does not cascade.
  private recoverChainedNamedArgument(): void {
    while (this.check("assign")) {
      this.diagnostics.push(diagnostic("VEL2024", "A named argument takes one value; remove the extra '='", this.current().span));
      this.advance();
      this.parseExpression();
    }
  }

  private parseSpreadExpression(): Expression {
    if (!this.match("ellipsis")) return this.parseExpression();
    const start = this.previous().span.start;
    const value = this.parseExpression();
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
        index += Math.min(2, token.value.length - index);
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
        this.diagnostics.push(diagnostic("VEL2009", "Unmatched '}' in interpolated string", span(offset, offset + 1)));
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
        this.diagnostics.push(diagnostic("VEL2009", "Unclosed expression in interpolated string", span(offset, token.span.end)));
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
        this.diagnostics.push(diagnostic(
          "VEL2009",
          "An interpolation holds one expression; VelarScript has no ':' format specs. Format the value first — value.toFixed(2) for fixed decimals, str(value).padStart(size) for width",
          span(colonOffset, sourceOffset(close)),
        ));
        fragment = fragment.slice(0, specColon).trimEnd();
      }
      const offset = sourceOffset(fragmentStart);
      const fragmentOffsets = payload?.contentOffsets?.slice(fragmentStart, fragmentStart + fragment.length + 1);
      parts.push({ kind: "expression", value: this.parseNestedExpression(fragment, offset, false, fragmentOffsets) });
      index = close + 1;
      textStart = index;
    }

    if (textStart < token.value.length) {
      parts.push({ kind: "text", value: this.decodeFStringText(token.value.slice(textStart), payload) });
    }

    return { kind: "FStringExpression", parts, span: token.span };
  }

  private numberLiteral(token: Token, negative = false, literalSpan: Span = token.span): Extract<Expression, { kind: "LiteralExpression" }> {
    const value = Number(token.value) * (negative ? -1 : 1);
    if (!Number.isFinite(value)) this.diagnostics.push(diagnostic("VEL2017", "Numeric literals must be finite", literalSpan));
    return {
      kind: "LiteralExpression",
      value: Number.isFinite(value) ? value : 0,
      raw: `${negative ? "-" : ""}${token.value}`,
      span: literalSpan,
    };
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
        decoded += next === "n" ? "\n" : next === "r" ? "\r" : next === "t" ? "\t" : next;
        index += 1;
      } else if ((character === "{" && next === "{") || (character === "}" && next === "}")) {
        decoded += character;
        index += 1;
      } else {
        decoded += character;
      }
    }
    return decoded;
  }

  protected parseExtensionExpression(_token: Token): Expression | undefined {
    return undefined;
  }

  protected parseExtensionNumericLiteral(_token: Token, _value: number, _unit: string): Expression | undefined {
    return undefined;
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
    let lexed = bracketFragment ? new Lexer(fragment, this.lexicalExtensions, { bracketFragment: true }).lex() : null;
    if (!lexed || containsExtensionBlockStart(lexed.tokens)) {
      lexed = new Lexer(fragment, this.lexicalExtensions).lex();
    }
    const mappedSpan = (local: Span): Span => sourceOffsets
      ? span(sourceOffsets[local.start] ?? offset, sourceOffsets[local.end] ?? sourceOffsets.at(-1) ?? offset)
      : span(local.start + offset, local.end + offset);
    const shiftedTokens = lexed.tokens.map((item) => ({ ...item, span: mappedSpan(item.span) }));
    const shiftedDiagnostics = lexed.diagnostics.map((item) => ({ ...item, span: mappedSpan(item.span) }));
    const parsed = this.createNestedParser(shiftedTokens).parseExpressionFragment();
    this.diagnostics.push(...shiftedDiagnostics, ...parsed.diagnostics);
    return parsed.expression;
  }

  protected createNestedParser(tokens: readonly Token[]): Parser {
    return new Parser(tokens, this.lexicalExtensions);
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

  private binaryOperator(token: Token): BinaryExpression["operator"] {
    const operators: Partial<Record<TokenKind, BinaryExpression["operator"]>> = {
      nullish: "??",
      or: "or",
      and: "and",
      in: "in",
      equal: "==",
      notEqual: "!=",
      less: "<",
      lessEqual: "<=",
      greater: ">",
      greaterEqual: ">=",
      plus: "+",
      minus: "-",
      star: "*",
      starStar: "**",
      slash: "/",
      percent: "%",
    };
    return operators[token.kind] ?? "+";
  }

  // '??' never shares a bare binary chain with 'and'/'or': the two groupings
  // read differently, so the mix requires explicit parentheses. '??' binds
  // loosest, so every unparenthesized mix surfaces as an 'and'/'or' node
  // becoming a direct operand of a '??' node; the symmetric test also covers
  // recovered shapes. One diagnostic marks each mixing operator, and the node
  // is still built with the current grouping so later stages keep running.
  private checkNullishBooleanMixing(
    operator: BinaryExpression["operator"],
    left: Expression,
    right: Expression,
    operatorSpan: Span,
  ): void {
    const nullish = operator === "??";
    const boolean = operator === "and" || operator === "or";
    if (!nullish && !boolean) return;
    const conflicting = (operand: Expression): BinaryExpression["operator"] | null =>
      operand.kind === "BinaryExpression" && !operand.parenthesized
        && (nullish ? operand.operator === "and" || operand.operator === "or" : operand.operator === "??")
        ? operand.operator
        : null;
    const adjacent = conflicting(left) ?? conflicting(right);
    if (!adjacent) return;
    const booleanOperator = nullish ? adjacent : operator;
    this.diagnostics.push(recoveredDiagnostic(
      "VEL2034",
      `Parenthesize the mix of '??' and '${booleanOperator}'; the two groupings read differently`,
      operatorSpan,
    ));
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

  private synchronize(): void {
    while (!this.check("eof") && !this.check("newline") && !this.check("dedent")) {
      this.advance();
    }
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
    if (this.current().kind !== "extensionKeyword" || this.current().value !== value) return false;
    this.advance();
    return true;
  }

  protected check(kind: TokenKind): boolean {
    return this.current().kind === kind;
  }

  protected peekKind(distance: number): TokenKind {
    return this.tokens[this.index + distance]?.kind ?? "eof";
  }

  protected advance(): Token {
    const token = this.current();
    if (token.kind !== "eof") {
      this.index += 1;
    }
    return token;
  }

  protected current(): Token {
    return this.tokens[this.index] ?? this.tokens[this.tokens.length - 1]!;
  }

  protected previous(): Token {
    return this.tokens[Math.max(0, this.index - 1)] ?? this.current();
  }
}
