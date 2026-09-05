/**
 * One module's semantic index, built in one walk over the program.
 *
 * D115 §一.1 / D114 R1f: `buildSemanticIndex` was one 830-line closure with
 * twenty-six inner arrows. Each of those is a method here — the class is the
 * closure, the fields are its `const`s, and `build()` is the three loops and
 * the index it returned, in the order they ran. Three families that never walk
 * a statement moved out to `declarations.ts`, `references.ts` and
 * `documentation.ts`; this module is the walk.
 */
import type {
  BindingPattern,
  ContextMarker,
  Expression,
  FunctionDeclaration,
  MatchPattern,
  Program,
  Statement,
} from "../ast.ts";
import { spanIdentity, type SourceText, type Span } from "../source.ts";
import { type Token } from "../token.ts";
import { describeType, formatTypeReference, type ValueType } from "../types.ts";
import { declaredTypeParameters, SemanticDeclarations, type SemanticDeclarationsHost } from "./declarations.ts";
import { SemanticSyntaxLog, type SemanticSyntaxLogHost } from "./documentation.ts";
import { SemanticReferences, type SemanticReferencesHost } from "./references.ts";
import {
  HARD_KEYWORD_TOKEN_KINDS,
  type CompilerSemanticExtension,
  type Scope,
  type SemanticExpression,
  type SemanticExtensionContext,
  type SemanticImport,
  type SemanticIndex,
  type SemanticMember,
  type SemanticMemberReference,
  type SemanticModuleReference,
  type SemanticReference,
  type SemanticFunctionLike,
  type SemanticSymbol,
  type SemanticSymbolKind,
  type SemanticSyntaxDocumentation,
  type SemanticSyntaxToken,
} from "./symbols.ts";

/**
 * One module's semantic index, built in one walk. Every piece of the walk is a
 * method here rather than a closure inside one 830-line function, so a reader
 * is sent to the arm that answers for the declaration in front of them.
 *
 * D115 §一.1 / D114 R1f: the closure `buildSemanticIndex` was became this class
 * unchanged — each `const name = (…) => …` is the method of the same name, each
 * `const name = value` is the field of the same name, and the three loops and
 * the returned index are `build()`, in the order they ran.
 */
export class SemanticIndexBuilder {
  private readonly program: Program;
  private readonly source: SourceText;
  private readonly bindingTypes: ReadonlyMap<string, ValueType>;
  private readonly bindingMembers: ReadonlyMap<string, ReadonlyMap<string, ValueType>>;
  private readonly expressionTypes: ReadonlyMap<string, ValueType>;
  private readonly expressionMembers: ReadonlyMap<string, ReadonlyMap<string, ValueType>>;
  private readonly expressionOwners: ReadonlyMap<string, ValueType>;
  private readonly objectPropertyOwners: ReadonlyMap<string, ValueType>;
  private readonly bindingEntryOwners: ReadonlyMap<string, ValueType>;
  private readonly jsxAttributeOwners: ReadonlyMap<string, ValueType>;
  private readonly expressionContexts: ReadonlyMap<string, ValueType>;
  private readonly expressionContextMembers: ReadonlyMap<string, ReadonlyMap<string, ValueType>>;
  private readonly semanticExtensions: readonly CompilerSemanticExtension[];
  private readonly lexicalTokens: readonly Token[];

  private readonly symbols: SemanticSymbol[] = [];
  private readonly references: SemanticReference[] = [];
  private readonly memberReferences: SemanticMemberReference[] = [];
  private readonly imports: SemanticImport[] = [];
  private readonly moduleReferences: SemanticModuleReference[] = [];
  private readonly expressions: SemanticExpression[] = [];
  private readonly syntaxTokens: SemanticSyntaxToken[] = [];
  private readonly syntaxDocumentation: SemanticSyntaxDocumentation[] = [];
  private readonly syntaxTokenIdentities = new Set<string>();
  private readonly syntaxDocumentationIdentities = new Set<string>();
  private readonly expressionKeys = new Set<string>();
  private readonly describedMemberCache = new Map<ReadonlyMap<string, ValueType>, readonly SemanticMember[]>();
  private readonly declarations = new WeakMap<object, SemanticSymbol>();
  private readonly rootScope: Scope;
  private readonly scopes: Scope[];
  private readonly allScopes: Scope[];
  private readonly contextMarkersBySpecificity: readonly ContextMarker[];
  private extensionContext!: SemanticExtensionContext;
  private nextScopeId = 1;
  private readonly names: SemanticDeclarations;
  private readonly reads: SemanticReferences;
  private readonly syntax: SemanticSyntaxLog;
  constructor(
    program: Program,
    source: SourceText,
    bindingTypes: ReadonlyMap<string, ValueType>,
    bindingMembers: ReadonlyMap<string, ReadonlyMap<string, ValueType>>,
    expressionTypes: ReadonlyMap<string, ValueType>,
    expressionMembers: ReadonlyMap<string, ReadonlyMap<string, ValueType>>,
    expressionOwners: ReadonlyMap<string, ValueType>,
    objectPropertyOwners: ReadonlyMap<string, ValueType>,
    bindingEntryOwners: ReadonlyMap<string, ValueType>,
    jsxAttributeOwners: ReadonlyMap<string, ValueType>,
    expressionContexts: ReadonlyMap<string, ValueType>,
    expressionContextMembers: ReadonlyMap<string, ReadonlyMap<string, ValueType>>,
    semanticExtensions: readonly CompilerSemanticExtension[],
    lexicalTokens: readonly Token[],
  ) {
    this.program = program;
    this.source = source;
    this.bindingTypes = bindingTypes;
    this.bindingMembers = bindingMembers;
    this.expressionTypes = expressionTypes;
    this.expressionMembers = expressionMembers;
    this.expressionOwners = expressionOwners;
    this.objectPropertyOwners = objectPropertyOwners;
    this.bindingEntryOwners = bindingEntryOwners;
    this.jsxAttributeOwners = jsxAttributeOwners;
    this.expressionContexts = expressionContexts;
    this.expressionContextMembers = expressionContextMembers;
    this.semanticExtensions = semanticExtensions;
    this.lexicalTokens = lexicalTokens;
    this.rootScope = { id: 0, parentId: null, span: { start: 0, end: source.text.length }, bindings: new Map() };
    this.scopes = [this.rootScope];
    this.allScopes = [this.rootScope];
    this.contextMarkersBySpecificity = [...(this.program.contextMarkers ?? [])].sort((left, right) =>
    (left.targetSpan.end - left.targetSpan.start) - (right.targetSpan.end - right.targetSpan.start));
    const host = this.indexHost();
    this.names = new SemanticDeclarations(host);
    this.reads = new SemanticReferences(host);
    this.syntax = new SemanticSyntaxLog(host);
  }

  /**
   * The one object the three halves of the index are handed. Every property is
   * a live read of this builder: the scope stack grows and shrinks and the
   * symbol arrays are appended to while a half is running, so none of it can be
   * a value captured when the halves were built.
   */
  private indexHost(): SemanticDeclarationsHost & SemanticReferencesHost & SemanticSyntaxLogHost {
    const builder = this;
    return {
      get allScopes() { return builder.allScopes; },
      get bindingMembers() { return builder.bindingMembers; },
      get bindingTypes() { return builder.bindingTypes; },
      callable: (type) => builder.reads.callable(type),
      get contextMarkersBySpecificity() { return builder.contextMarkersBySpecificity; },
      get declarations() { return builder.declarations; },
      describeMembers: (memberTypes) => builder.reads.describeMembers(memberTypes),
      get describedMemberCache() { return builder.describedMemberCache; },
      get imports() { return builder.imports; },
      get memberReferences() { return builder.memberReferences; },
      get moduleReferences() { return builder.moduleReferences; },
      moduleSourceSpan: (valueSpan) => builder.reads.moduleSourceSpan(valueSpan),
      get nextScopeId() { return builder.nextScopeId; },
      set nextScopeId(value) { builder.nextScopeId = value; },
      get references() { return builder.references; },
      get scopes() { return builder.scopes; },
      semanticIdentity: (type) => builder.reads.semanticIdentity(type),
      get source() { return builder.source; },
      get symbols() { return builder.symbols; },
      get syntaxDocumentation() { return builder.syntaxDocumentation; },
      get syntaxDocumentationIdentities() { return builder.syntaxDocumentationIdentities; },
      get syntaxTokenIdentities() { return builder.syntaxTokenIdentities; },
      get syntaxTokens() { return builder.syntaxTokens; },
    };
  }

  private predeclareTopLevel(): void {
    for (const statement of this.program.body) {
      switch (statement.kind) {
        case "ImportDeclaration": this.names.declareImport(statement); break;
        case "ReExportDeclaration": this.names.declareReExport(statement); break;
        case "TypeDeclaration": this.names.declare(statement, statement.name, "type", statement.span, this.reads.nameSpan(statement.span, statement.name), statement.exported, false, true, undefined, declaredTypeParameters(statement.name, statement.typeParameters)); break;
        case "TypeAliasDeclaration": this.names.declare(
          statement,
          statement.name,
          "type",
          statement.span,
          this.reads.nameSpan(statement.span, statement.name),
          statement.exported,
          false,
          true,
          undefined,
          formatTypeReference(statement.target),
          false,
          { ...(statement.target.syntax.kind === "NamedTypeSyntax" ? { typeTarget: statement.target.syntax.name } : {}) },
        ); break;
        case "EnumDeclaration": {
          this.names.declare(statement, statement.name, "enum", statement.span, this.reads.nameSpan(statement.span, statement.name), statement.exported);
          for (const member of statement.members) {
            this.names.declare(member, member.name, "enum-member", member.span, member.span, false, false, false, statement.name, `${statement.name}.${member.name}`);
          }
          break;
        }
        case "ClassDeclaration": this.names.declare(
          statement,
          statement.name,
          "class",
          statement.span,
          this.reads.nameSpan(statement.span, statement.name),
          statement.exported,
          false,
          true,
          undefined,
          declaredTypeParameters(statement.name, statement.typeParameters),
        ); break;
        case "FunctionDeclaration": this.names.declare(statement, statement.name, "function", statement.span, this.reads.nameSpan(statement.span, statement.name), statement.exported, false, true, undefined, undefined, false, { boundedTypeParameters: true }); break;
        default:
          for (const extension of this.semanticExtensions) if (extension.predeclare?.(statement, this.extensionContext)) break;
          break;
      }
    }
  }

  private visitPattern(
    pattern: BindingPattern,
    kind: SemanticSymbolKind,
    declarationSpan: Span,
    mutable: boolean,
    exported: boolean,
    documentationStart?: number,
  ): void {
    if (pattern.kind === "NameBindingPattern") {
      this.names.declare(
        pattern,
        pattern.name,
        kind,
        declarationSpan.start === pattern.span.start ? pattern.span : declarationSpan,
        pattern.span,
        exported,
        mutable,
        true,
        undefined,
        undefined,
        false,
        { ...(documentationStart === undefined ? {} : { documentationStart }) },
      );
    } else if (pattern.kind === "ListBindingPattern") {
      for (const element of pattern.elements) if (element) this.visitPattern(element, kind, element.span, mutable, exported, documentationStart);
      if (pattern.rest) this.visitPattern(pattern.rest, kind, pattern.rest.span, mutable, exported, documentationStart);
    } else {
      for (const entry of pattern.entries) {
        const owner = this.bindingEntryOwners.get(`${entry.span.start}:${entry.property}`);
        if (owner) {
          const shorthand = entry.pattern.kind === "NameBindingPattern"
            && entry.pattern.name === entry.property
            && entry.pattern.span.start === entry.span.start;
          this.reads.recordMemberReference(entry.property, this.reads.nameSpan(entry.span, entry.property), owner, "binding-key", shorthand);
        }
        this.visitPattern(entry.pattern, kind, entry.pattern.span, mutable, exported, documentationStart);
      }
      if (pattern.rest) this.visitPattern(pattern.rest, kind, pattern.rest.span, mutable, exported, documentationStart);
    }
  }

  private visitMatchPattern(pattern: MatchPattern): void {
    switch (pattern.kind) {
      case "MatchValuePattern":
        for (const value of pattern.values) this.visitExpression(value);
        break;
      case "MatchTypePattern":
        this.reads.typeReferences(pattern.type);
        break;
      case "MatchWildcardPattern":
        break;
      case "MatchCapturePattern":
        if (pattern.binding.name !== "_") {
          this.names.declare(pattern.binding, pattern.binding.name, "variable", pattern.binding.span, pattern.binding.span);
        }
        break;
      case "MatchAsPattern":
        this.visitMatchPattern(pattern.pattern);
        if (pattern.binding.name !== "_") {
          this.names.declare(pattern.binding, pattern.binding.name, "variable", pattern.binding.span, pattern.binding.span);
        }
        break;
      case "MatchListPattern":
        for (const element of pattern.elements) this.visitMatchPattern(element);
        if (pattern.rest && pattern.rest.name !== "_") {
          this.names.declare(pattern.rest, pattern.rest.name, "variable", pattern.rest.span, pattern.rest.span);
        }
        break;
      case "MatchObjectPattern":
        for (const entry of pattern.entries) {
          const owner = this.bindingEntryOwners.get(`${entry.span.start}:${entry.property}`);
          if (owner) {
            const shorthand = entry.pattern.kind === "MatchCapturePattern"
              && entry.pattern.binding.name === entry.property
              && entry.pattern.span.start === entry.span.start;
            this.reads.recordMemberReference(entry.property, this.reads.nameSpan(entry.span, entry.property), owner, "binding-key", shorthand);
          }
          this.visitMatchPattern(entry.pattern);
        }
        if (pattern.rest && pattern.rest.name !== "_") {
          this.names.declare(pattern.rest, pattern.rest.name, "variable", pattern.rest.span, pattern.rest.span);
        }
        break;
    }
  }

  private visitExpression(expression: Expression, write = false): void {
    const expressionKey = spanIdentity(expression.span);
    const expressionType = this.expressionTypes.get(expressionKey);
    const expressionOwner = this.expressionOwners.get(expressionKey);
    const expressionContext = this.expressionContexts.get(expressionKey);
    const describedContextMembers = expressionContext
      ? this.reads.describeMembers(this.expressionContextMembers.get(expressionKey) ?? new Map())
      : [];
    const describedExpressionMembers = this.reads.describeMembers(this.expressionMembers.get(expressionKey) ?? new Map());
    const callableExpression = this.reads.callable(expressionType);
    const expressionOwnerIdentity = this.reads.semanticIdentity(expressionOwner);
    const indexableExpression = (expression.kind !== "IdentifierExpression" || expressionType !== undefined)
      && expression.kind !== "LiteralExpression" && expression.kind !== "SuperExpression";
    if (expressionType && indexableExpression
      && (describedExpressionMembers.length > 0 || callableExpression || expression.kind === "MemberExpression" || expressionContext)
      && !this.expressionKeys.has(expressionKey)) {
      this.expressionKeys.add(expressionKey);
      this.expressions.push({
        span: expression.span,
        type: describeType(expressionType),
        members: describedExpressionMembers,
        ...(callableExpression ? { callable: true as const } : {}),
        ...(expressionContext ? { contextType: describeType(expressionContext), contextMembers: describedContextMembers } : {}),
        ...(expression.kind === "MemberExpression" ? {
          memberName: expression.property,
          selectionSpan: { start: expression.span.end - expression.property.length, end: expression.span.end },
          ...(expressionOwner ? {
            ownerType: expressionOwner.kind === "extension" && expressionOwner.nominal
              ? expressionOwner.nominal
              : describeType(expressionOwner),
            ownerKind: expressionOwner.kind,
            ...(expressionOwner.kind === "extension" && expressionOwner.metadata?.semanticSymbolKind
              ? { ownerSymbolKind: expressionOwner.metadata.semanticSymbolKind as SemanticSymbolKind }
              : {}),
            ...(expressionOwnerIdentity ? { ownerIdentity: expressionOwnerIdentity } : {}),
          } : {}),
        } : {}),
      });
    }
    for (const extension of this.semanticExtensions) if (extension.visitExpression?.(expression, this.extensionContext)) return;
    switch (expression.kind) {
      case "IdentifierExpression": this.reads.reference(expression.name, expression.span, write); break;
      case "SuperExpression": break;
      case "DynamicImportExpression":
        this.moduleReferences.push({ source: expression.source, span: this.reads.moduleSourceSpan(expression.sourceSpan), dynamic: true });
        break;
      case "FStringExpression": for (const part of expression.parts) if (part.kind === "expression") this.visitExpression(part.value); break;
      case "ListExpression": for (const element of expression.elements) this.visitExpression(element); break;
      case "ObjectExpression":
        for (const property of expression.properties) {
          if (property.kind === "ObjectProperty") {
            const owner = this.objectPropertyOwners.get(`${property.span.start}:${property.name}`);
            if (owner) {
              const shorthand = property.value.kind === "IdentifierExpression"
                && property.value.name === property.name
                && property.value.span.start === property.span.start;
              this.reads.recordMemberReference(property.name, this.reads.nameSpan(property.span, property.name), owner, "object-key", shorthand);
            }
          }
          this.visitExpression(property.value);
        }
        break;
      case "SpreadExpression": this.visitExpression(expression.value); break;
      case "UnaryExpression": this.visitExpression(expression.operand); break;
      case "TryExpression": this.visitExpression(expression.value); break;
      case "RequiredExpression": this.visitExpression(expression.value); break;
      case "BinaryExpression": this.visitExpression(expression.left); this.visitExpression(expression.right); break;
      case "AssignmentExpression": this.visitExpression(expression.target); this.visitExpression(expression.value); break;
      case "ComparisonChainExpression": for (const operand of expression.operands) this.visitExpression(operand); break;
      case "ConditionalExpression": this.visitExpression(expression.condition); this.visitExpression(expression.thenValue); this.visitExpression(expression.elseValue); break;
      case "IsExpression": this.visitExpression(expression.value); this.reads.typeReferences(expression.type); break;
      case "ArrowFunctionExpression":
        this.names.enterScope(expression.span);
        for (const parameter of expression.parameters) {
          if (parameter.defaultValue) this.visitExpression(parameter.defaultValue);
          this.reads.typeReferences(parameter.type);
          this.names.declare(parameter, parameter.name, "parameter", parameter.span, { start: parameter.span.start, end: parameter.span.start + parameter.name.length });
        }
        this.visitExpression(expression.body);
        this.names.exitScope();
        break;
      case "CallExpression":
        if (expression.callee.kind === "IdentifierExpression") this.reads.reference(expression.callee.name, expression.callee.span, false, true);
        else this.visitExpression(expression.callee);
        for (const argument of expression.arguments) this.visitExpression(argument);
        break;
      case "MemberExpression": {
        if (expressionOwner) {
          this.reads.recordMemberReference(
            expression.property,
            { start: expression.span.end - expression.property.length, end: expression.span.end },
            expressionOwner,
            "access",
          );
        }
        this.visitExpression(expression.object);
        if (expression.object.kind === "IdentifierExpression") {
          const owner = this.reads.lookup(expression.object.name);
          const member = owner?.kind === "enum"
            ? this.symbols.find((symbol) => symbol.kind === "enum-member" && symbol.container === owner.name && symbol.name === expression.property)
            : null;
          if (member) {
            const end = expression.span.end;
            this.references.push({ name: expression.property, path: this.source.path, span: { start: end - expression.property.length, end }, symbolId: member.id, write: false });
          }
        }
        break;
      }
      case "IndexExpression": this.visitExpression(expression.object); this.visitExpression(expression.index); break;
      case "LiteralExpression": break;
    }
  }

  private visitFunction(
    statement: SemanticFunctionLike,
    method = false,
    container?: string,
    memberKind: "field" | "method" = "method",
    explicitType?: string,
  ): void {
    if (method) this.names.declare(
      statement,
      statement.name,
      memberKind,
      statement.span,
      this.reads.nameSpan(statement.span, statement.name),
      false,
      false,
      false,
      container,
      explicitType,
      "static" in statement && statement.static === true,
      { ...("private" in statement && statement.private ? { private: true } : {}) },
    );
    this.names.enterScope(statement.span);
    for (const parameter of statement.parameters) {
      if (parameter.defaultValue) this.visitExpression(parameter.defaultValue);
      this.reads.typeReferences(parameter.type);
      this.names.declare(parameter, parameter.name, "parameter", parameter.span, { start: parameter.span.start, end: parameter.span.start + parameter.name.length });
    }
    this.reads.typeReferences(statement.returnType);
    for (const child of statement.body) this.visitStatement(child);
    this.names.exitScope();
  }

  private visitBlock(body: readonly Statement[], fallbackSpan: Span): void {
    const scopeSpan = body.length > 0
      ? { start: body[0]!.span.start, end: body.at(-1)!.span.end }
      : fallbackSpan;
    this.names.enterScope(scopeSpan);
    for (const child of body) this.visitStatement(child);
    this.names.exitScope();
  }

  /**
   * `extern module`: every function, constant and class it declares, and the
   * type references each of them names.
   *
   * D115 §一.1 / D114 R1f: one arm of `visitStatement`, moved out unchanged so
   * both fit in one screen.
   */
  private visitExternModuleDeclaration(statement: Extract<Statement, { kind: "ExternModuleDeclaration" }>): void {
    for (const declaration of statement.functions) {
      const selection = this.reads.nameSpan(declaration.span, declaration.name);
      this.names.declare(declaration, declaration.name, "function", declaration.span, selection, true, false, false);
      for (const parameter of declaration.parameters) this.reads.typeReferences(parameter.type);
      this.reads.typeReferences(declaration.returnType);
    }
    for (const declaration of statement.constants) {
      const selection = this.reads.nameSpan(declaration.span, declaration.name);
      this.names.declare(declaration, declaration.name, "variable", declaration.span, selection, true, false, true, undefined, formatTypeReference(declaration.type));
      this.reads.typeReferences(declaration.type);
    }
    for (const declaration of statement.classes) {
      this.names.declare(declaration, declaration.name, "class", declaration.span, this.reads.nameSpan(declaration.span, declaration.name), true);
      for (const parameter of declaration.parameters) {
        if (parameter.binding) {
          this.names.declare(parameter, parameter.name, "field", parameter.span, this.reads.nameSpan(parameter.span, parameter.name), false, parameter.binding === "let", false, declaration.name);
        }
        this.reads.typeReferences(parameter.type);
      }
      for (const field of declaration.fields) {
        this.names.declare(field, field.name, "field", field.span, this.reads.nameSpan(field.span, field.name), false, field.mutable, false, declaration.name, undefined, field.static);
        this.reads.typeReferences(field.type);
      }
      for (const getter of declaration.getters) {
        this.names.declare(getter, getter.name, "field", getter.span, this.reads.nameSpan(getter.span, getter.name), false, false, false, declaration.name, formatTypeReference(getter.type), getter.static);
        this.reads.typeReferences(getter.type);
      }
      for (const method of declaration.methods) {
        this.names.declare(method, method.name, "method", method.span, this.reads.nameSpan(method.span, method.name), false, false, false, declaration.name);
        for (const parameter of method.parameters) this.reads.typeReferences(parameter.type);
        this.reads.typeReferences(method.returnType);
      }
    }
  }

  /**
   * A class body: its base, its parameters and fields, the three compiler-owned
   * blocks (`initialization`, `@dispose`, `@iterate`), and the getters and
   * methods that are visited after the class scope closes.
   *
   * D115 §一.1 / D114 R1f: one arm of `visitStatement`, moved out unchanged.
   */
  private visitClassDeclaration(statement: Extract<Statement, { kind: "ClassDeclaration" }>): void {
    if (statement.base) {
      this.reads.reference(statement.base.name, { start: statement.base.span.start, end: statement.base.span.start + statement.base.name.length });
    }
    this.names.enterScope(statement.span);
    for (const parameter of statement.parameters) {
      if (parameter.defaultValue) this.visitExpression(parameter.defaultValue);
      this.reads.typeReferences(parameter.type);
      const selection = { start: parameter.span.start, end: parameter.span.start + parameter.name.length };
      const symbol = parameter.binding
        ? this.names.declare(
          parameter,
          parameter.name,
          "field",
          parameter.span,
          selection,
          false,
          parameter.binding === "let",
          false,
          statement.name,
          undefined,
          false,
          { ...(parameter.private ? { private: true } : {}) },
        )
        : this.names.declare(parameter, parameter.name, "parameter", parameter.span, selection);
      this.names.currentScope().bindings.set(parameter.name, symbol);
    }
    if (statement.base) for (const argument of statement.base.arguments) this.visitExpression(argument);
    for (const field of statement.fields) {
      this.names.declare(
        field,
        field.name,
        "field",
        field.span,
        this.reads.nameSpan(field.span, field.name),
        false,
        field.binding === "let",
        false,
        statement.name,
        formatTypeReference(field.type),
        field.static,
        { ...(field.private ? { private: true } : {}) },
      );
      this.reads.typeReferences(field.type);
      if (!field.static && field.initializer) this.visitExpression(field.initializer);
    }
    if (statement.initialization) this.visitBlock(statement.initialization.body, statement.initialization.span);
    if (statement.dispose) {
      this.syntax.syntaxToken(statement.dispose.keywordSpan, "decorator");
      this.syntax.documentSyntax(statement.dispose.keywordSpan, "@dispose");
      this.visitBlock(statement.dispose.body, statement.dispose.span);
    }
    if (statement.iterate) {
      this.syntax.syntaxToken(statement.iterate.keywordSpan, "decorator");
      this.syntax.documentSyntax(statement.iterate.keywordSpan, "@iterate");
      this.visitBlock(statement.iterate.body, statement.iterate.span);
    }
    this.names.exitScope();
    for (const field of statement.fields) if (field.static && field.initializer) this.visitExpression(field.initializer);
    for (const getter of statement.getters) this.visitFunction(getter, true, statement.name, "field", getter.returnType ? formatTypeReference(getter.returnType) : undefined);
    for (const method of statement.methods) this.visitFunction(method, true, statement.name);
  }

  private visitStatement(statement: Statement): void {
    for (const extension of this.semanticExtensions) if (extension.visitStatement?.(statement, this.extensionContext)) return;
    switch (statement.kind) {
      case "ImportDeclaration": break;
      case "ReExportDeclaration": break;
      case "EmbeddedJavaScriptDeclaration":
        for (const capture of statement.captures) {
          this.reads.typeReferences(capture.type);
          this.reads.reference(capture.name, capture.nameSpan);
        }
        break;
      case "ExternModuleDeclaration":
        this.visitExternModuleDeclaration(statement);
        break;
      case "TypeDeclaration":
        if (statement.base) this.reads.typeReferences(statement.base);
        for (const field of statement.fields) {
          const selection = this.reads.nameSpan(field.span, field.name);
          this.names.declare(field, field.name, "field", field.span, selection, false, false, false, statement.name);
          this.reads.typeReferences(field.type);
        }
        break;
      case "TypeAliasDeclaration":
        this.reads.typeReferences(statement.target);
        break;
      case "EnumDeclaration":
        break;
      case "ClassDeclaration":
        this.visitClassDeclaration(statement);
        break;
      case "VariableDeclaration":
        this.visitExpression(statement.initializer);
        this.reads.typeReferences(statement.type);
        this.visitPattern(statement.pattern, "variable", statement.pattern.span, statement.binding === "let", statement.exported, statement.span.start);
        break;
      case "MainBlock":
        // `@main` 是模块级编译器角色而不是用户符号：编辑器把它标成角色，并为
        // 正文建立独立局部作用域，但不会把名为 main 的声明塞进模块符号表。
        this.syntax.syntaxToken(statement.keywordSpan, "decorator");
        this.syntax.documentSyntax(statement.keywordSpan, "@main");
        this.visitBlock(statement.body, statement.span);
        break;
      case "TestDeclaration":
        // A test body is an ordinary block for navigation and rename.
        this.visitBlock(statement.body, statement.span);
        break;
      case "UsingDeclaration":
        // D43 item 69: an owned resource is an ordinary immutable binding as
        // far as navigation and rename are concerned.
        this.visitExpression(statement.initializer);
        this.names.declare(statement, statement.name, "variable", statement.span, statement.nameSpan, false);
        break;
      case "FunctionDeclaration":
        if (!this.declarations.has(statement)) this.names.declare(statement, statement.name, "function", statement.span, this.reads.nameSpan(statement.span, statement.name), statement.exported, false, true, undefined, undefined, false, { boundedTypeParameters: true });
        this.visitFunction(statement);
        break;
      case "ReturnStatement": if (statement.value) this.visitExpression(statement.value); break;
      case "ThrowStatement": this.visitExpression(statement.value); break;
      case "AssertStatement": this.visitExpression(statement.condition); if (statement.message) this.visitExpression(statement.message); break;
      case "IfStatement": this.visitExpression(statement.condition); this.visitBlock(statement.thenBody, statement.span); if (statement.elseBody) this.visitBlock(statement.elseBody, statement.span); break;
      case "MatchStatement":
        this.visitExpression(statement.value);
        for (const branch of statement.cases) {
          this.names.enterScope(branch.span);
          this.visitMatchPattern(branch.pattern);
          if (branch.guard) this.visitExpression(branch.guard);
          for (const child of branch.body) this.visitStatement(child);
          this.names.exitScope();
        }
        break;
      case "ForStatement":
        this.visitExpression(statement.iterable);
        this.names.enterScope(statement.span);
        this.visitPattern(statement.pattern, "variable", statement.pattern.span, false, false);
        if (statement.secondPattern) this.visitPattern(statement.secondPattern, "variable", statement.secondPattern.span, false, false);
        for (const child of statement.body) this.visitStatement(child);
        this.names.exitScope();
        break;
      case "WhileStatement": this.visitExpression(statement.condition); this.visitBlock(statement.body, statement.span); break;
      case "TryStatement":
        this.visitBlock(statement.tryBody, statement.span);
        if (statement.catchBody) {
          const catchSpan = statement.catchBody.length > 0
            ? { start: statement.catchBody[0]!.span.start, end: statement.catchBody.at(-1)!.span.end }
            : statement.span;
          this.names.enterScope(catchSpan);
          if (statement.catchName) {
            const selection = this.reads.nameSpan(statement.span, statement.catchName, statement.tryBody.at(-1)?.span.end ?? statement.span.start);
            this.names.declare({ statement, role: "catch" }, statement.catchName, "catch", statement.span, selection);
          }
          for (const child of statement.catchBody) this.visitStatement(child);
          this.names.exitScope();
        }
        if (statement.finallyBody) this.visitBlock(statement.finallyBody, statement.span);
        break;
      case "AssignmentStatement": this.visitExpression(statement.target, true); this.visitExpression(statement.value); break;
      case "ExpressionStatement": this.visitExpression(statement.expression); break;
      case "DetachStatement": this.visitExpression(statement.expression); break;
      case "BreakStatement":
      case "ContinueStatement":
      case "PassStatement": break;
    }
  }

  build(): SemanticIndex {
    for (const token of this.lexicalTokens) {
      if (HARD_KEYWORD_TOKEN_KINDS.has(token.kind)) this.syntax.syntaxToken(token.span, "keyword");
  }
  this.extensionContext = {
    source: this.source.text,
    declare: (owner, name, kind, declarationSpan, selectionSpan, options = {}) => {
      return this.names.declare(
        owner,
        name,
        kind,
        declarationSpan,
        selectionSpan,
        options.exported ?? false,
        options.mutable ?? false,
        options.lexical ?? true,
        options.container,
        options.explicitType,
        options.static ?? false,
        {
          ...(options.documentationStart === undefined ? {} : { documentationStart: options.documentationStart }),
          ...(options.private === undefined ? {} : { private: options.private }),
          ...(options.typeTarget === undefined ? {} : { typeTarget: options.typeTarget }),
          ...(options.sourceTypeHint === undefined ? {} : { sourceTypeHint: options.sourceTypeHint }),
          ...(options.presentationKind === undefined ? {} : { presentationKind: options.presentationKind }),
        },
      );
    },
    hasDeclaration: (owner) => this.declarations.has(owner),
    nameSpan: this.reads.nameSpan.bind(this.reads),
    typeReferences: this.reads.typeReferences.bind(this.reads),
    reference: this.reads.reference.bind(this.reads),
    callReference: (name, valueSpan) => this.reads.reference(name, valueSpan, false, true),
    recordMemberReference: this.reads.recordMemberReference.bind(this.reads),
    jsxAttributeOwner: (attributeSpan, name) => this.jsxAttributeOwners.get(`${attributeSpan.start}:${name}`),
    enterScope: this.names.enterScope.bind(this.names),
    exitScope: this.names.exitScope.bind(this.names),
    visitExpression: (expression) => this.visitExpression(expression),
    visitStatement: this.visitStatement.bind(this),
    visitBlock: this.visitBlock.bind(this),
    visitFunction: (statement) => this.visitFunction(statement),
    syntaxToken: this.syntax.syntaxToken.bind(this.syntax),
    documentSyntax: this.syntax.documentSyntax.bind(this.syntax),
  };
  for (const marker of this.program.contextMarkers ?? []) {
    this.syntax.syntaxToken(marker.markerSpan, "decorator");
    this.syntax.documentSyntax(marker.markerSpan, "@context");
  }
  this.predeclareTopLevel();
  for (const statement of this.program.body) this.visitStatement(statement);
  return {
    path: this.source.path,
    symbols: this.symbols,
    references: this.references,
    memberReferences: this.memberReferences,
    imports: this.imports,
    moduleReferences: this.moduleReferences,
    scopes: this.allScopes.map(({ id, parentId, span: scopeSpan }) => ({ id, parentId, span: scopeSpan })),
    expressions: this.expressions,
    syntaxTokens: this.syntaxTokens.sort((left, right) => left.span.start - right.span.start || left.span.end - right.span.end),
    syntaxDocumentation: this.syntaxDocumentation.sort((left, right) => left.span.start - right.span.start || left.span.end - right.span.end),
  };
  }
}
