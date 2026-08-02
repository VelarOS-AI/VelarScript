import type {
  ActionDeclaration,
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
  ComponentDeclaration,
  ComponentItem,
  ComputedDeclaration,
  CleanupBlock,
  EnumDeclaration,
  Expression,
  ExternClassDeclaration,
  ExternClassFieldDeclaration,
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
  JSXAttribute,
  JSXChild,
  JSXElementExpression,
  MountedBlock,
  MemberExpression,
  MatchStatement,
  ObjectProperty,
  Parameter,
  Program,
  ResourceDeclaration,
  Statement,
  TypeDeclaration,
  TypeAliasDeclaration,
  TypeField,
  TypeReference,
  VariableDeclaration,
  WatchDeclaration,
  StateDeclaration,
} from "./ast.ts";
import { diagnostic, type Diagnostic } from "./diagnostic.ts";
import { Lexer } from "./lexer.ts";
import { span } from "./source.ts";
import { keywordKinds, type Token, type TokenKind } from "./token.ts";

const memberNameKinds = new Set<TokenKind>(["identifier", ...Object.values(keywordKinds)]);

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
  private readonly diagnostics: Diagnostic[] = [];
  private index = 0;

  constructor(tokens: readonly Token[]) {
    this.tokens = tokens;
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
    const expression = this.parseExpression();
    this.consumeNewlines();
    if (!this.check("eof")) {
      this.diagnostics.push(diagnostic("VEL2006", "Unexpected tokens in interpolated expression", this.current().span));
    }
    return { expression, diagnostics: this.diagnostics };
  }

  private parseStatement(): Statement | null {
    const start = this.current().span.start;

    if (this.check("import") && this.tokens[this.index + 1]?.kind !== "leftParen") {
      this.advance();
      return this.parseImport(start);
    }

    if (this.match("extern")) {
      return this.parseExternModule(start);
    }

    const exported = this.match("export");
    const abstract = this.match("abstract");
    const asynchronous = this.match("async");

    if (this.match("component")) {
      if (abstract) this.diagnostics.push(diagnostic("VEL2013", "Only classes can be declared with 'abstract'", this.previous().span));
      if (asynchronous) this.diagnostics.push(diagnostic("VEL2013", "Components are not declared with 'async'", this.previous().span));
      return this.parseComponent(start, exported);
    }

    if (this.match("def")) {
      if (abstract) this.diagnostics.push(diagnostic("VEL2013", "Only class methods can be declared with 'abstract'", this.previous().span));
      return this.parseFunction(start, exported, asynchronous);
    }

    if (asynchronous) {
      this.diagnostics.push(diagnostic("VEL2001", "'async' must be followed by 'def'", this.previous().span));
      return null;
    }

    if (abstract && !this.check("class")) {
      this.diagnostics.push(diagnostic("VEL2001", "'abstract' must be followed by 'class'", this.previous().span));
      return null;
    }

    if (this.match("state")) {
      return this.parseStateDeclaration(start, exported);
    }

    if (this.match("computed")) {
      return this.parseComputedDeclaration(start, exported);
    }

    if (this.match("resource")) {
      if (exported) this.diagnostics.push(diagnostic("VEL2018", "A resource is component-owned and cannot be exported", this.previous().span));
      return this.parseResourceDeclaration(start, exported);
    }

    if (this.match("action")) {
      if (exported) this.diagnostics.push(diagnostic("VEL2019", "An action is component-owned and cannot be exported", this.previous().span));
      return this.parseActionDeclaration(start, exported);
    }

    if (this.match("watch")) {
      if (exported) this.diagnostics.push(diagnostic("VEL2001", "A watch block cannot be exported", this.previous().span));
      return this.parseWatchDeclaration(start);
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
      if (this.match("comma")) {
        if (this.atStatementEnd()) {
          this.diagnostics.push(diagnostic("VEL2017", "'assert' requires a message after ','", this.previous().span));
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
      const pattern = this.parseBindingPattern();
      this.expect("in", "Expected 'in' after loop binding");
      const iterable = this.parseExpression();
      const body = this.parseBlock();
      return { kind: "ForStatement", pattern, iterable, body, span: span(start, body.at(-1)?.span.end ?? iterable.span.end) };
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

  private parseImport(start: number): ImportDeclaration {
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
    const source = this.expect("string", "Expected a module path string");
    return { kind: "ImportDeclaration", source: source.value, javascript, unsafe, specifiers, span: span(start, source.span.end) };
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
        this.diagnostics.push(diagnostic("VEL2010", "Extern modules declare functions with 'export def' or read-only values with 'export const name: Type'", this.current().span));
        this.synchronize();
        this.consumeNewlines();
        continue;
      }
      const name = this.expect("identifier", "Expected an extern function name");
      const parameters = this.parseParameters();
      const returnType = this.match("arrow") ? this.parseTypeReference() : null;
      functions.push({
        asynchronous,
        name: name.value,
        parameters,
        returnType,
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
    const parameters = this.check("leftParen") ? this.parseExternClassParameters() : [];
    const base = this.match("extends") ? this.expect("identifier", "Expected an extern base class name after 'extends'").value : null;
    this.expect("colon", "Expected ':' before an extern class body");
    this.expect("newline", "Expected a newline before an extern class body");
    this.consumeNewlines();
    this.expect("indent", "Expected an indented extern class body");
    const fields: ExternClassFieldDeclaration[] = [];
    const methods: ExternClassMethodDeclaration[] = [];
    this.consumeNewlines();

    while (!this.check("dedent") && !this.check("eof")) {
      const memberStart = this.current().span.start;
      if (this.match("pass")) {
        this.expectStatementEnd();
        this.consumeNewlines();
        continue;
      }
      const static_ = this.match("static");
      const asynchronous = this.match("async");
      const mutable = this.match("let");
      const readonly = !mutable && this.match("const");
      if (mutable || readonly) {
        if (asynchronous) this.diagnostics.push(diagnostic("VEL2010", "Extern class fields cannot be async", this.previous().span));
        const fieldName = this.expect("identifier", "Expected an extern class field name");
        this.expect("colon", "Expected ':' after an extern class field name");
        const type = this.parseTypeReference();
        fields.push({ static: static_, mutable, name: fieldName.value, type, span: span(memberStart, type.span.end) });
        this.expectStatementEnd();
        this.consumeNewlines();
        continue;
      }
      if (this.match("def")) {
        const methodName = this.expect("identifier", "Expected an extern class method name");
        const methodParameters = this.parseParameters();
        const returnType = this.match("arrow") ? this.parseTypeReference() : null;
        methods.push({
          static: static_,
          asynchronous,
          name: methodName.value,
          parameters: methodParameters,
          returnType,
          span: span(memberStart, returnType?.span.end ?? this.previous().span.end),
        });
        this.expectStatementEnd();
        this.consumeNewlines();
        continue;
      }
      this.diagnostics.push(diagnostic("VEL2010", "Extern class bodies declare fields with const/let, methods with def, or 'pass'", this.current().span));
      this.synchronize();
      this.consumeNewlines();
    }
    const close = this.expect("dedent", "Expected the end of an extern class body");
    return { name: name.value, parameters, base, fields, methods, span: span(start, Math.max(fields.at(-1)?.span.end ?? start, methods.at(-1)?.span.end ?? start, close.span.end)) };
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

  private parseStateDeclaration(start: number, exported: boolean): StateDeclaration {
    const name = this.expect("identifier", "Expected a state name");
    const type = this.match("colon") ? this.parseTypeReference() : null;
    this.expect("assign", "Expected '=' after state name");
    const initializer = this.parseExpression();
    return { kind: "StateDeclaration", exported, name: name.value, type, initializer, span: span(start, initializer.span.end) };
  }

  private parseComputedDeclaration(start: number, exported: boolean): ComputedDeclaration {
    const name = this.expect("identifier", "Expected a computed name");
    const type = this.match("colon") ? this.parseTypeReference() : null;
    this.expect("assign", "Expected '=' after computed name");
    const initializer = this.parseExpression();
    return { kind: "ComputedDeclaration", exported, name: name.value, type, initializer, span: span(start, initializer.span.end) };
  }

  private parseResourceDeclaration(start: number, exported: boolean): ResourceDeclaration {
    const name = this.expect("identifier", "Expected a resource name");
    const type = this.match("colon") ? this.parseTypeReference() : null;
    this.expect("assign", "Expected '=' after resource name");
    const initializer = this.parseExpression();
    return { kind: "ResourceDeclaration", exported, name: name.value, type, initializer, span: span(start, initializer.span.end) };
  }

  private parseActionDeclaration(start: number, exported: boolean): ActionDeclaration {
    const name = this.expect("identifier", "Expected an action name");
    const parameters = this.parseParameters();
    const returnType = this.match("arrow") ? this.parseTypeReference() : null;
    const body = this.parseBlock();
    const end = body.at(-1)?.span.end ?? returnType?.span.end ?? name.span.end;
    return { kind: "ActionDeclaration", exported, name: name.value, parameters, returnType, body, span: span(start, end) };
  }

  private parseWatchDeclaration(start: number): WatchDeclaration {
    const expression = this.parseExpression();
    let currentName: string | null = null;
    let previousName: string | null = null;
    if (this.match("as")) {
      currentName = this.expect("identifier", "Expected the current watch value name").value;
      this.expect("comma", "Expected ',' between watch value names");
      previousName = this.expect("identifier", "Expected the previous watch value name").value;
    }
    const body = this.parseBlock();
    return { kind: "WatchDeclaration", expression, currentName, previousName, body, span: span(start, body.at(-1)?.span.end ?? expression.span.end) };
  }

  private parseComponent(start: number, exported: boolean): ComponentDeclaration {
    const name = this.expect("identifier", "Expected a component name");
    const parameters = this.check("leftParen") ? this.parseParameters() : [];
    for (const parameter of parameters) {
      if (parameter.rest) {
        this.diagnostics.push(diagnostic("VEL2016", "Components use named props and do not support rest parameters", parameter.span));
      }
    }
    this.expect("colon", "Expected ':' before component body");
    this.expect("newline", "Expected a newline before component body");
    this.consumeNewlines();
    this.expect("indent", "Expected an indented component body");
    const body: ComponentItem[] = [];
    this.consumeNewlines();

    while (!this.check("dedent") && !this.check("eof")) {
      const itemStart = this.current().span.start;
      let item: ComponentItem | null = null;
      if (this.match("state")) {
        item = this.parseStateDeclaration(itemStart, false);
      } else if (this.match("computed")) {
        item = this.parseComputedDeclaration(itemStart, false);
      } else if (this.match("resource")) {
        item = this.parseResourceDeclaration(itemStart, false);
      } else if (this.match("action")) {
        item = this.parseActionDeclaration(itemStart, false);
      } else if (this.match("watch")) {
        item = this.parseWatchDeclaration(itemStart);
      } else if (this.match("mounted")) {
        const mountedBody = this.parseBlock();
        item = { kind: "MountedBlock", body: mountedBody, span: span(itemStart, mountedBody.at(-1)?.span.end ?? itemStart) } satisfies MountedBlock;
      } else if (this.match("cleanup")) {
        const cleanupBody = this.parseBlock();
        item = { kind: "CleanupBlock", body: cleanupBody, span: span(itemStart, cleanupBody.at(-1)?.span.end ?? itemStart) } satisfies CleanupBlock;
      } else if (this.match("style")) {
        const global = this.match("global");
        this.expect("colon", "Expected ':' after style");
        this.expect("newline", "Expected a newline before component CSS");
        this.consumeNewlines();
        this.expect("indent", "Expected indented component CSS");
        const css = this.expect("css", "Expected component CSS");
        this.consumeNewlines();
        this.expect("dedent", "Expected the end of component CSS");
        item = { kind: "StyleBlock", global, css: css.value, span: span(itemStart, css.span.end) };
      } else {
        item = this.parseStatement();
      }
      if (item) body.push(item);
      if (this.previous().kind !== "dedent") this.expectStatementEnd();
      this.consumeNewlines();
    }
    const close = this.expect("dedent", "Expected the end of component body");
    return { kind: "ComponentDeclaration", exported, name: name.value, parameters, body, span: span(start, body.at(-1)?.span.end ?? close.span.end) };
  }

  private parseBindingPattern(): BindingPattern {
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
        const property = this.expect("identifier", "Expected an object binding name");
        const pattern = this.match("colon") ? this.parseBindingPattern() : { kind: "NameBindingPattern", name: property.value, span: property.span } satisfies BindingPattern;
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
    const parameters = this.parseParameters();
    const returnType = this.match("arrow") ? this.parseTypeReference() : null;
    const body = this.parseBlock();
    const end = body.at(-1)?.span.end ?? returnType?.span.end ?? name.span.end;

    return {
      kind: "FunctionDeclaration",
      exported,
      asynchronous,
      name: name.value,
      parameters,
      returnType,
      body,
      span: span(start, end),
    };
  }

  private parseParameters(): readonly Parameter[] {
    this.expect("leftParen", "Expected '('");
    const parameters: Parameter[] = [];
    let sawRest = false;
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
        parameters.push({ name: name.value, type, defaultValue, rest, span: parameterSpan });
        sawRest ||= rest;
      } while (this.match("comma") && !this.check("rightParen"));
    }
    this.expect("rightParen", "Expected ')' after parameters");
    return parameters;
  }

  private parseExternClassParameters(): readonly ClassParameter[] {
    this.expect("leftParen", "Expected '('");
    const parameters: ClassParameter[] = [];
    let sawRest = false;
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
        parameters.push({ name: name.value, binding, private: false, type, defaultValue, rest, span: parameterSpan });
        sawRest ||= rest;
      } while (this.match("comma") && !this.check("rightParen"));
    }
    this.expect("rightParen", "Expected ')' after extern class parameters");
    return parameters;
  }

  private parseTypeDefinition(start: number, exported: boolean): TypeDeclaration | TypeAliasDeclaration {
    const name = this.expect("identifier", "Expected a type name");
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
      const fieldName = this.expectMemberName("Expected a field name");
      this.expect("colon", "Expected ':' after field name");
      const type = this.parseTypeReference();
      fields.push({ name: fieldName.value, type, span: span(fieldName.span.start, type.span.end) });
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
      const member = this.expectMemberName("Expected an enum member name");
      if (member.value) members.push({ name: member.value, span: member.span });
      this.expectStatementEnd();
      this.consumeNewlines();
    }
    const close = this.expect("dedent", "Expected the end of enum members");
    if (members.length === 0) {
      this.diagnostics.push(diagnostic("VEL2017", `Enum '${name.value}' requires at least one member`, span(start, close.span.end)));
    }
    return { kind: "EnumDeclaration", exported, name: name.value, members, span: span(start, members.at(-1)?.span.end ?? close.span.end) };
  }

  private parseClassDeclaration(start: number, exported: boolean, abstract: boolean): ClassDeclaration {
    const name = this.expect("identifier", "Expected a class name");
    const parameters: ClassParameter[] = [];
    if (this.match("leftParen")) {
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
        else if (this.match("async")) asynchronous = true;
        else scanningModifiers = false;
      }
      if (this.check("identifier") && this.current().value === "init") {
        this.advance();
        if (methodAbstract || methodOverride || methodStatic || methodPrivate || asynchronous) {
          this.diagnostics.push(diagnostic("VEL2022", "A class init block does not accept modifiers", span(methodStart, this.previous().span.end)));
        }
        const initBody = this.parseBlock();
        const block = {
          kind: "ClassInitBlock",
          body: initBody,
          span: span(methodStart, initBody.at(-1)?.span.end ?? this.previous().span.end),
        } satisfies ClassInitBlock;
        if (initialization) {
          this.diagnostics.push(diagnostic("VEL2022", `Class '${name.value}' has more than one init block`, block.span));
        } else {
          initialization = block;
        }
        this.consumeNewlines();
        continue;
      }
      if (this.check("const") || this.check("let")) {
        const binding = this.advance().kind as "const" | "let";
        if (methodAbstract || methodOverride || asynchronous) {
          this.diagnostics.push(diagnostic("VEL2021", "Class fields support only the 'private' and 'static' modifiers", this.previous().span));
        }
        const fieldName = this.expectMemberName("Expected a class field name");
        let type: TypeReference;
        if (this.match("colon")) {
          type = this.parseTypeReference();
        } else {
          this.diagnostics.push(diagnostic("VEL2021", "Class fields require an explicit type", fieldName.span));
          type = { text: "unknown", span: fieldName.span };
        }
        this.expect("assign", "Expected '=' before the class field initializer");
        const initializer = this.parseExpression();
        fields.push({
          binding,
          static: methodStatic,
          private: methodPrivate,
          name: fieldName.value,
          type,
          initializer,
          span: span(methodStart, initializer.span.end),
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
        this.diagnostics.push(diagnostic("VEL2007", "Class bodies contain const/let fields, get properties, one init block, methods, or 'pass'", this.current().span));
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
      returnType = { text: "unknown", span: name.span };
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
    const parameters = this.parseParameters();
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
        parameters,
        returnType,
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
      parameters,
      returnType,
      body,
      span: span(start, body.at(-1)?.span.end ?? returnType?.span.end ?? name.span.end),
    };
  }

  private parseIf(start: number): IfStatement {
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
    let elseBody: readonly Statement[] | null = null;
    this.consumeNewlines();
    while (!this.check("dedent") && !this.check("eof")) {
      const branchStart = this.current().span.start;
      if (this.match("case")) {
        if (elseBody) {
          this.diagnostics.push(diagnostic("VEL2015", "A match case cannot follow else", this.previous().span));
        }
        const values: MatchStatement["cases"][number]["values"][number][] = [];
        if (this.check("colon")) {
          this.diagnostics.push(diagnostic("VEL2015", "A match case requires at least one literal value", this.current().span));
        } else {
          do {
            const value = this.parseMatchValue();
            if (value) values.push(value);
          } while (this.match("comma") && !this.check("colon"));
        }
        const body = this.parseBlock();
        cases.push({ values, body, span: span(branchStart, body.at(-1)?.span.end ?? this.previous().span.end) });
      } else if (this.match("else")) {
        if (elseBody) {
          this.diagnostics.push(diagnostic("VEL2015", "A match block can contain only one else branch", this.previous().span));
        }
        const body = this.parseBlock();
        if (!elseBody) elseBody = body;
      } else {
        this.diagnostics.push(diagnostic("VEL2015", "A match block accepts only case or else branches", this.current().span));
        this.synchronize();
      }
      this.consumeNewlines();
    }
    const close = this.expect("dedent", "Expected the end of a match block");
    if (cases.length === 0) {
      this.diagnostics.push(diagnostic("VEL2015", "A match block requires at least one case", span(start, close.span.end)));
    }
    const end = elseBody?.at(-1)?.span.end ?? cases.at(-1)?.span.end ?? value.span.end;
    return { kind: "MatchStatement", value, cases, elseBody, span: span(start, end) };
  }

  private parseMatchValue(): MatchStatement["cases"][number]["values"][number] | null {
    const negative = this.match("minus");
    const start = negative ? this.previous().span.start : this.current().span.start;
    const token = this.current();
    if (negative) {
      const number = this.expect("number", "A negative match case requires a numeric literal");
      if (!number.value) return null;
      return { kind: "LiteralExpression", value: -Number(number.value), raw: `-${number.value}`, span: span(start, number.span.end) };
    }
    if (token.kind === "identifier" && this.peekKind(1) === "dot") {
      const object = this.advance();
      this.advance();
      const property = this.expect("identifier", "Expected an enum member after '.'");
      return {
        kind: "MemberExpression",
        object: { kind: "IdentifierExpression", name: object.value, span: object.span },
        property: property.value,
        optional: false,
        span: span(object.span.start, property.span.end),
      };
    }
    this.advance();
    switch (token.kind) {
      case "number": return { kind: "LiteralExpression", value: Number(token.value), raw: token.value, span: token.span };
      case "string": return { kind: "LiteralExpression", value: token.value, raw: token.value, span: token.span };
      case "true": return { kind: "LiteralExpression", value: true, raw: "true", span: token.span };
      case "false": return { kind: "LiteralExpression", value: false, raw: "false", span: token.span };
      case "none": return { kind: "LiteralExpression", value: null, raw: "none", span: token.span };
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

  private parseBlock(): readonly Statement[] {
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
      if (this.previous().kind !== "dedent") this.expectStatementEnd();
      this.consumeNewlines();
    }
    this.expect("dedent", "Expected the end of an indented block");
    return statements;
  }

  private parseTypeReference(): TypeReference {
    const start = this.current().span.start;
    let text = this.parseSingleTypeReference();
    while (this.match("pipe")) {
      text += ` | ${this.parseSingleTypeReference()}`;
    }
    return { text, span: span(start, this.previous().span.end) };
  }

  private parseSingleTypeReference(): string {
    if (this.check("leftParen") && !this.isFunctionTypeParenthesis()) {
      this.advance();
      const grouped = this.parseTypeReference();
      this.expect("rightParen", "Expected ')' after grouped type");
      return `(${grouped.text})${this.match("question") ? "?" : ""}`;
    }
    if (this.match("leftParen")) {
      const parameters: string[] = [];
      let sawRest = false;
      if (!this.check("rightParen")) {
        do {
          const rest = this.match("ellipsis");
          if (sawRest) this.diagnostics.push(diagnostic("VEL2016", "A rest function type parameter must be final", this.current().span));
          const type = this.parseTypeReference();
          parameters.push(`${rest ? "..." : ""}${type.text}`);
          if (rest) sawRest = true;
        } while (this.match("comma") && !this.check("rightParen"));
      }
      this.expect("rightParen", "Expected ')' after function type parameters");
      this.expect("arrow", "Expected '->' after function type parameters");
      const result = this.parseTypeReference();
      return `(${parameters.join(", ")}) -> ${result.text}`;
    }
    const name = this.check("none") ? this.advance() : this.expect("identifier", "Expected a type name");
    let text = name.value;
    if (this.match("less")) {
      const arguments_: string[] = [];
      do {
        arguments_.push(this.parseTypeReference().text);
      } while (this.match("comma") && !this.check("greater"));
      this.expect("greater", "Expected '>' after type arguments");
      const expectedArguments = name.value === "Map" ? 2 : name.value === "List" || name.value === "Set" || name.value === "Promise" ? 1 : null;
      if (expectedArguments !== null && arguments_.length !== expectedArguments) {
        this.diagnostics.push(diagnostic("VEL2012", `Type '${name.value}' expects ${expectedArguments} type argument${expectedArguments === 1 ? "" : "s"}`, name.span));
      }
      text += `<${arguments_.join(", ")}>`;
    }
    if (this.match("question")) {
      text += "?";
    }
    return text;
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

  private parseExpression(minimumPrecedence = 0): Expression {
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
      const precedence = binaryPrecedence[this.current().kind];
      if (precedence === undefined || precedence < minimumPrecedence) {
        break;
      }

      const operator = this.advance();
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
      if (operator.kind === "is") {
        const type = this.parseTypeReference();
        left = { kind: "IsExpression", value: left, type, span: span(left.span.start, type.span.end) };
        continue;
      }

      const right = this.parseExpression(precedence + 1);
      left = {
        kind: "BinaryExpression",
        left,
        operator: this.binaryOperator(operator),
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

    return left;
  }

  private parseArrowExpression(start: number, asynchronous: boolean): ArrowFunctionExpression {
    if (this.check("leftParen")) {
      const parameters = this.parseParameters();
      this.expect("fatArrow", "Expected '=>' after arrow parameters");
      const body = this.parseExpression();
      return { kind: "ArrowFunctionExpression", asynchronous, parameters, body, span: span(start, body.span.end) };
    }
    const parameterToken = this.expect("identifier", "Expected an arrow parameter");
    this.expect("fatArrow", "Expected '=>' after arrow parameter");
    const body = this.parseExpression();
    const parameter: Parameter = { name: parameterToken.value, type: null, defaultValue: null, rest: false, span: parameterToken.span };
    return { kind: "ArrowFunctionExpression", asynchronous, parameters: [parameter], body, span: span(start, body.span.end) };
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
    if (this.match("not") || this.match("plus") || this.match("minus")) {
      const operator = this.previous();
      const operand = this.parseUnary();
      return {
        kind: "UnaryExpression",
        operator: operator.kind === "not" ? "not" : operator.kind === "plus" ? "+" : "-",
        operand,
        span: span(operator.span.start, operand.span.end),
      };
    }
    return this.parsePower();
  }

  private parsePower(): Expression {
    const left = this.parsePowerBase();
    if (!this.match("starStar")) return left;
    const operator = this.previous();
    const right = this.parseUnary();
    return {
      kind: "BinaryExpression",
      operator: "**",
      left,
      right,
      span: span(left.span.start, right.span.end),
    };
  }

  private parsePowerBase(): Expression {
    if (!this.match("await")) return this.parsePostfix();
    const operator = this.previous();
    const operand = this.check("not") || this.check("plus") || this.check("minus")
      ? this.parseUnary()
      : this.parsePowerBase();
    return {
      kind: "UnaryExpression",
      operator: "await",
      operand,
      span: span(operator.span.start, operand.span.end),
    };
  }

  private parsePostfix(): Expression {
    let expression = this.parsePrimary();

    while (true) {
      if (this.match("leftParen")) {
        const arguments_: Expression[] = [];
        if (!this.check("rightParen")) {
          do {
            arguments_.push(this.parseSpreadExpression());
          } while (this.match("comma") && !this.check("rightParen"));
        }
        const close = this.expect("rightParen", "Expected ')' after arguments");
        expression = { kind: "CallExpression", callee: expression, arguments: arguments_, span: span(expression.span.start, close.span.end) };
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
        expression = { kind: "IndexExpression", object: expression, index, span: span(expression.span.start, close.span.end) };
        continue;
      }

      break;
    }

    return expression;
  }

  private parsePrimary(): Expression {
    const token = this.advance();
    switch (token.kind) {
      case "number":
        return { kind: "LiteralExpression", value: Number(token.value), raw: token.value, span: token.span };
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
      case "jsx":
        return this.parseJsx(token);
      case "true":
        return { kind: "LiteralExpression", value: true, raw: token.value, span: token.span };
      case "false":
        return { kind: "LiteralExpression", value: false, raw: token.value, span: token.span };
      case "none":
        return { kind: "LiteralExpression", value: null, raw: token.value, span: token.span };
      case "identifier":
        return { kind: "IdentifierExpression", name: token.value, span: token.span };
      case "super":
        return { kind: "SuperExpression", span: token.span };
      case "leftParen": {
        const expression = this.parseExpression();
        this.expect("rightParen", "Expected ')' after expression");
        return expression;
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
                : { kind: "LiteralExpression", value: null, raw: "none", span: name.span } satisfies Expression;
            properties.push({ kind: "ObjectProperty", name: name.value, value, span: span(name.span.start, value.span.end) });
          } while (this.match("comma") && !this.check("rightBrace"));
        }
        const close = this.expect("rightBrace", "Expected '}' after object fields");
        return { kind: "ObjectExpression", properties, span: span(token.span.start, close.span.end) };
      }
      default:
        this.diagnostics.push(diagnostic("VEL2002", "Expected an expression", token.span));
        return { kind: "LiteralExpression", value: null, raw: "none", span: token.span };
    }
  }

  private parseSpreadExpression(): Expression {
    if (!this.match("ellipsis")) return this.parseExpression();
    const start = this.previous().span.start;
    const value = this.parseExpression();
    return { kind: "SpreadExpression", value, span: span(start, value.span.end) };
  }

  private parseFString(token: Token): Expression {
    const parts: FStringPart[] = [];
    let textStart = 0;
    let index = 0;

    while (index < token.value.length) {
      if (token.value[index] === "{" && token.value[index + 1] === "{") {
        index += 2;
        continue;
      }
      if (token.value[index] !== "{") {
        index += 1;
        continue;
      }

      if (index > textStart) {
        parts.push({ kind: "text", value: token.value.slice(textStart, index).replaceAll("{{", "{").replaceAll("}}", "}") });
      }

      const close = token.value.indexOf("}", index + 1);
      if (close === -1) {
        this.diagnostics.push(diagnostic("VEL2009", "Unclosed expression in interpolated string", token.span));
        parts.push({ kind: "text", value: token.value.slice(index) });
        textStart = token.value.length;
        break;
      }

      const fragment = token.value.slice(index + 1, close).trim();
      const lexed = new Lexer(fragment).lex();
      const offset = token.span.start + 2 + index + 1;
      const shiftedTokens = lexed.tokens.map((item) => ({ ...item, span: span(item.span.start + offset, item.span.end + offset) }));
      const shiftedDiagnostics = lexed.diagnostics.map((item) => ({ ...item, span: span(item.span.start + offset, item.span.end + offset) }));
      const parsed = new Parser(shiftedTokens).parseExpressionFragment();
      this.diagnostics.push(...shiftedDiagnostics, ...parsed.diagnostics);
      parts.push({ kind: "expression", value: parsed.expression });
      index = close + 1;
      textStart = index;
    }

    if (textStart < token.value.length) {
      parts.push({ kind: "text", value: token.value.slice(textStart).replaceAll("{{", "{").replaceAll("}}", "}") });
    }

    return { kind: "FStringExpression", parts, span: token.span };
  }

  private parseJsx(token: Token): JSXElementExpression {
    const parser = new JsxSourceParser(
      token.value,
      token.span.start,
      (text, offset) => this.parseEmbeddedExpression(text, offset),
      (item) => this.diagnostics.push(item),
    );
    return parser.parse();
  }

  private parseEmbeddedExpression(fragment: string, offset: number): Expression {
    const lexed = new Lexer(fragment).lex();
    const shiftedTokens = lexed.tokens.map((item) => ({ ...item, span: span(item.span.start + offset, item.span.end + offset) }));
    const shiftedDiagnostics = lexed.diagnostics.map((item) => ({ ...item, span: span(item.span.start + offset, item.span.end + offset) }));
    const parsed = new Parser(shiftedTokens).parseExpressionFragment();
    this.diagnostics.push(...shiftedDiagnostics, ...parsed.diagnostics);
    return parsed.expression;
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

  private atStatementEnd(): boolean {
    return this.check("newline") || this.check("dedent") || this.check("eof");
  }

  private expectStatementEnd(): void {
    if (!this.atStatementEnd()) {
      this.diagnostics.push(diagnostic("VEL2003", "Expected the end of a statement", this.current().span));
      this.synchronize();
    }
  }

  private synchronize(): void {
    while (!this.check("eof") && !this.check("newline") && !this.check("dedent")) {
      this.advance();
    }
  }

  private consumeNewlines(): void {
    while (this.match("newline")) {
      // Intentionally empty.
    }
  }

  private expect(kind: TokenKind, message: string): Token {
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

  private match(kind: TokenKind): boolean {
    if (!this.check(kind)) {
      return false;
    }
    this.advance();
    return true;
  }

  private check(kind: TokenKind): boolean {
    return this.current().kind === kind;
  }

  private peekKind(distance: number): TokenKind {
    return this.tokens[this.index + distance]?.kind ?? "eof";
  }

  private advance(): Token {
    const token = this.current();
    if (token.kind !== "eof") {
      this.index += 1;
    }
    return token;
  }

  private current(): Token {
    return this.tokens[this.index] ?? this.tokens[this.tokens.length - 1]!;
  }

  private previous(): Token {
    return this.tokens[Math.max(0, this.index - 1)] ?? this.current();
  }
}

class JsxSourceParser {
  private index = 0;
  private readonly voidTags = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"]);
  private readonly text: string;
  private readonly offset: number;
  private readonly parseExpression: (text: string, offset: number) => Expression;
  private readonly report: (item: Diagnostic) => void;

  constructor(
    text: string,
    offset: number,
    parseExpression: (text: string, offset: number) => Expression,
    report: (item: Diagnostic) => void,
  ) {
    this.text = text;
    this.offset = offset;
    this.parseExpression = parseExpression;
    this.report = report;
  }

  parse(): JSXElementExpression {
    this.skipWhitespace();
    return this.parseElement();
  }

  private parseElement(): JSXElementExpression {
    const start = this.index;
    this.expectCharacter("<", "Expected '<' to start JSX");
    const tag = this.readName();
    const fragment = !tag && this.peek() === ">";
    if (!tag && !fragment) this.report(diagnostic("VEL5001", "Expected a JSX tag name or fragment", this.absoluteSpan(start, this.index)));
    const attributes: JSXAttribute[] = [];
    let selfClosing = false;

    while (this.index < this.text.length) {
      this.skipWhitespace();
      if (this.text.startsWith("/>", this.index)) {
        this.index += 2;
        selfClosing = true;
        break;
      }
      if (this.peek() === ">") {
        this.index += 1;
        break;
      }
      const attributeStart = this.index;
      const name = this.readAttributeName();
      if (!name) {
        this.report(diagnostic("VEL5002", "Expected a JSX attribute", this.absoluteSpan(this.index, this.index + 1)));
        this.index += 1;
        continue;
      }
      this.skipWhitespace();
      let value: string | Expression | null = null;
      if (this.peek() === "=") {
        this.index += 1;
        this.skipWhitespace();
        if (this.peek() === '"' || this.peek() === "'") {
          value = this.readQuoted();
        } else if (this.peek() === "{") {
          const embedded = this.readEmbedded();
          value = this.parseExpression(embedded.text, this.offset + embedded.start);
        } else {
          this.report(diagnostic("VEL5003", "JSX attribute values use quotes or '{...}'", this.absoluteSpan(this.index, this.index + 1)));
        }
      }
      attributes.push({ name, value, span: this.absoluteSpan(attributeStart, this.index) });
    }

    const children: JSXChild[] = [];
    if (!selfClosing && !(tag === tag.toLowerCase() && this.voidTags.has(tag))) {
      while (this.index < this.text.length && !this.text.startsWith("</", this.index)) {
        if (this.peek() === "<") {
          children.push(this.parseElement());
        } else if (this.peek() === "{") {
          const childStart = this.index;
          const embedded = this.readEmbedded();
          children.push({
            kind: "JSXExpressionChild",
            expression: this.parseExpression(embedded.text, this.offset + embedded.start),
            span: this.absoluteSpan(childStart, this.index),
          });
        } else {
          const textStart = this.index;
          while (this.index < this.text.length && this.peek() !== "<" && this.peek() !== "{") this.index += 1;
          children.push({ kind: "JSXText", value: this.text.slice(textStart, this.index), span: this.absoluteSpan(textStart, this.index) });
        }
      }
      if (!this.text.startsWith("</", this.index)) {
        this.report(diagnostic("VEL5004", `JSX ${fragment ? "fragment" : `element '<${tag}>'`} is not closed`, this.absoluteSpan(start, this.index)));
      } else {
        this.index += 2;
        const closing = this.readName();
        if (closing !== tag) this.report(diagnostic("VEL5005", fragment ? "Expected '</>' to close the JSX fragment" : `Expected '</${tag}>' but received '</${closing}>'`, this.absoluteSpan(this.index - closing.length, this.index)));
        this.skipWhitespace();
        this.expectCharacter(">", "Expected '>' after JSX closing tag");
      }
    }

    return { kind: "JSXElementExpression", tag, attributes, children, span: this.absoluteSpan(start, this.index) };
  }

  private readEmbedded(): { text: string; start: number } {
    this.expectCharacter("{", "Expected '{'");
    const start = this.index;
    let depth = 1;
    let quote = "";
    while (this.index < this.text.length) {
      const character = this.text[this.index++]!;
      if (quote) {
        if (character === "\\") this.index += 1;
        else if (character === quote) quote = "";
      } else if (character === '"' || character === "'" || character === "`") {
        quote = character;
      } else if (character === "{") {
        depth += 1;
      } else if (character === "}") {
        depth -= 1;
        if (depth === 0) return { text: this.text.slice(start, this.index - 1), start };
      }
    }
    this.report(diagnostic("VEL5006", "Unclosed JSX expression", this.absoluteSpan(start - 1, this.index)));
    return { text: this.text.slice(start), start };
  }

  private readQuoted(): string {
    const quote = this.text[this.index++]!;
    let value = "";
    while (this.index < this.text.length) {
      const character = this.text[this.index++]!;
      if (character === quote) return value;
      if (character === "\\" && this.index < this.text.length) value += this.text[this.index++]!;
      else value += character;
    }
    this.report(diagnostic("VEL5007", "Unclosed JSX attribute string", this.absoluteSpan(this.index, this.index)));
    return value;
  }

  private readName(): string {
    const start = this.index;
    while (/[A-Za-z0-9_.:-]/u.test(this.peek())) this.index += 1;
    return this.text.slice(start, this.index);
  }

  private readAttributeName(): string {
    const start = this.index;
    while (/[A-Za-z0-9_.:-]/u.test(this.peek())) this.index += 1;
    return this.text.slice(start, this.index);
  }

  private skipWhitespace(): void {
    while (/\s/u.test(this.peek())) this.index += 1;
  }

  private expectCharacter(character: string, message: string): void {
    if (this.peek() === character) this.index += 1;
    else this.report(diagnostic("VEL5001", message, this.absoluteSpan(this.index, this.index + 1)));
  }

  private peek(): string {
    return this.text[this.index] ?? "\0";
  }

  private absoluteSpan(start: number, end: number): ReturnType<typeof span> {
    return span(this.offset + start, this.offset + end);
  }
}
