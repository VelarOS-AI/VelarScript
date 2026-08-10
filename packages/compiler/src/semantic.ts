import type {
  BindingPattern,
  Expression,
  FunctionDeclaration,
  ImportDeclaration,
  MatchPattern,
  Program,
  ReExportDeclaration,
  Statement,
  TypeReference,
  TypeSyntax,
} from "./ast.ts";
import { spanIdentity, type SourceText, type Span } from "./source.ts";
import { describeType, formatTypeReference, type ValueType } from "./types.ts";

export type SemanticSymbolKind =
  | "import"
  | "type"
  | "enum"
  | "enum-member"
  | "class"
  | "component"
  | "style"
  | "function"
  | "state"
  | "computed"
  | "resource"
  | "action"
  | "variable"
  | "parameter"
  | "field"
  | "method"
  | "watch-value"
  | "catch";

export interface SemanticSymbol {
  readonly id: string;
  readonly name: string;
  readonly kind: SemanticSymbolKind;
  readonly path: string;
  readonly span: Span;
  readonly selectionSpan: Span;
  readonly scopeId: number;
  readonly exported: boolean;
  readonly mutable: boolean;
  readonly private: boolean;
  readonly type: string | null;
  readonly documentation: string | null;
  readonly members: readonly SemanticMember[];
  readonly callable?: true;
  readonly typeTarget?: string;
  readonly container?: string;
  readonly static?: boolean;
}

export interface SemanticMember {
  readonly name: string;
  readonly kind: "field" | "method";
  readonly type: string;
}

export interface SemanticExpression {
  readonly span: Span;
  readonly type: string;
  readonly members: readonly SemanticMember[];
  readonly callable?: true;
  readonly memberName?: string;
  readonly selectionSpan?: Span;
  readonly ownerType?: string;
  readonly ownerKind?: ValueType["kind"];
  readonly contextType?: string;
  readonly contextMembers?: readonly SemanticMember[];
}

export interface SemanticReference {
  readonly name: string;
  readonly path: string;
  readonly span: Span;
  readonly symbolId: string | null;
  readonly write: boolean;
}

export interface SemanticMemberReference {
  readonly name: string;
  readonly path: string;
  readonly span: Span;
  readonly ownerType: string;
  readonly ownerKind: ValueType["kind"];
  readonly ownerIdentity?: string;
  readonly syntax: "access" | "object-key" | "binding-key" | "jsx-prop";
  readonly shorthand: boolean;
}

export interface SemanticImport {
  readonly source: string;
  readonly imported: string;
  readonly importedSpan: Span;
  readonly local: string;
  readonly localSpan: Span;
  readonly localSymbolId: string;
  readonly namespace: boolean;
}

export interface SemanticModuleReference {
  readonly source: string;
  readonly span: Span;
  readonly dynamic: boolean;
}

export interface SemanticScope {
  readonly id: number;
  readonly parentId: number | null;
  readonly span: Span;
}

export interface SemanticIndex {
  readonly path: string;
  readonly symbols: readonly SemanticSymbol[];
  readonly references: readonly SemanticReference[];
  readonly memberReferences: readonly SemanticMemberReference[];
  readonly imports: readonly SemanticImport[];
  readonly moduleReferences: readonly SemanticModuleReference[];
  readonly scopes: readonly SemanticScope[];
  readonly expressions: readonly SemanticExpression[];
}

export interface SemanticDeclareOptions {
  readonly exported?: boolean;
  readonly mutable?: boolean;
  readonly lexical?: boolean;
  readonly container?: string;
  readonly explicitType?: string;
  readonly typeTarget?: string;
  readonly static?: boolean;
  readonly documentationStart?: number;
  readonly private?: boolean;
}

export interface SemanticFunctionLike {
  readonly name: string;
  readonly parameters: FunctionDeclaration["parameters"];
  readonly returnType: FunctionDeclaration["returnType"];
  readonly body: FunctionDeclaration["body"];
  readonly span: Span;
}

export interface SemanticExtensionContext {
  readonly declare: (owner: object, name: string, kind: SemanticSymbolKind, declarationSpan: Span, selectionSpan: Span, options?: SemanticDeclareOptions) => SemanticSymbol;
  readonly hasDeclaration: (owner: object) => boolean;
  readonly nameSpan: (span: Span, name: string, from?: number) => Span;
  readonly typeReferences: (type: TypeReference | null) => void;
  readonly reference: (name: string, span: Span, write?: boolean) => void;
  readonly recordMemberReference: (name: string, span: Span, owner: ValueType, syntax: SemanticMemberReference["syntax"], shorthand?: boolean) => void;
  readonly jsxAttributeOwner: (span: Span, name: string) => ValueType | undefined;
  readonly enterScope: (span: Span) => void;
  readonly exitScope: () => void;
  readonly visitExpression: (expression: Expression) => void;
  readonly visitStatement: (statement: Statement) => void;
  readonly visitBlock: (body: readonly Statement[], fallbackSpan: Span) => void;
  readonly visitFunction: (statement: SemanticFunctionLike) => void;
}

export interface CompilerSemanticExtension {
  readonly predeclare?: (statement: Statement, context: SemanticExtensionContext) => boolean;
  readonly visitExpression?: (expression: Expression, context: SemanticExtensionContext) => boolean;
  readonly visitStatement?: (statement: Statement, context: SemanticExtensionContext) => boolean;
}

interface Scope extends SemanticScope {
  readonly bindings: Map<string, SemanticSymbol>;
}

const MAX_SEMANTIC_MEMBERS = 10_000;

export function semanticBindingKey(span: Span, name: string): string {
  return `${span.start}:${name}`;
}

export function buildSemanticIndex(
  program: Program,
  source: SourceText,
  bindingTypes: ReadonlyMap<string, ValueType> = new Map(),
  bindingMembers: ReadonlyMap<string, ReadonlyMap<string, ValueType>> = new Map(),
  expressionTypes: ReadonlyMap<string, ValueType> = new Map(),
  expressionMembers: ReadonlyMap<string, ReadonlyMap<string, ValueType>> = new Map(),
  expressionOwners: ReadonlyMap<string, ValueType> = new Map(),
  objectPropertyOwners: ReadonlyMap<string, ValueType> = new Map(),
  bindingEntryOwners: ReadonlyMap<string, ValueType> = new Map(),
  jsxAttributeOwners: ReadonlyMap<string, ValueType> = new Map(),
  expressionContexts: ReadonlyMap<string, ValueType> = new Map(),
  expressionContextMembers: ReadonlyMap<string, ReadonlyMap<string, ValueType>> = new Map(),
  semanticExtensions: readonly CompilerSemanticExtension[] = [],
): SemanticIndex {
  const symbols: SemanticSymbol[] = [];
  const references: SemanticReference[] = [];
  const memberReferences: SemanticMemberReference[] = [];
  const imports: SemanticImport[] = [];
  const moduleReferences: SemanticModuleReference[] = [];
  const expressions: SemanticExpression[] = [];
  const expressionKeys = new Set<string>();
  const rootScope: Scope = { id: 0, parentId: null, span: { start: 0, end: source.text.length }, bindings: new Map() };
  const scopes: Scope[] = [rootScope];
  const allScopes: Scope[] = [rootScope];
  const describedMemberCache = new Map<ReadonlyMap<string, ValueType>, readonly SemanticMember[]>();
  const describeMembers = (memberTypes: ReadonlyMap<string, ValueType>): readonly SemanticMember[] => {
    const cached = describedMemberCache.get(memberTypes);
    if (cached) return cached;
    const described = [...memberTypes].slice(0, MAX_SEMANTIC_MEMBERS).map(([memberName, memberType]) => ({
      name: memberName,
      kind: memberType.kind === "function" || memberType.kind === "intrinsic" || memberType.kind === "action" ? "method" as const : "field" as const,
      type: describeType(memberType),
    }));
    describedMemberCache.set(memberTypes, described);
    return described;
  };
  const declarations = new WeakMap<object, SemanticSymbol>();
  let extensionContext: SemanticExtensionContext;
  let nextScopeId = 1;

  const callable = (type: ValueType | undefined): boolean => type?.kind === "function" || type?.kind === "intrinsic" || type?.kind === "action";

  const currentScope = (): Scope => scopes.at(-1)!;
  const enterScope = (scopeSpan: Span): void => {
    const scope = { id: nextScopeId++, parentId: currentScope().id, span: scopeSpan, bindings: new Map<string, SemanticSymbol>() };
    scopes.push(scope);
    allScopes.push(scope);
  };
  const exitScope = (): void => { scopes.pop(); };
  const lookup = (name: string): SemanticSymbol | null => {
    for (let index = scopes.length - 1; index >= 0; index -= 1) {
      const found = scopes[index]!.bindings.get(name);
      if (found) return found;
    }
    return null;
  };
  const declare = (
    owner: object,
    name: string,
    kind: SemanticSymbolKind,
    declarationSpan: Span,
    selectionSpan: Span,
    exported = false,
    mutable = false,
    lexical = true,
    container?: string,
    explicitType?: string,
    staticMember = false,
    options: { readonly documentationStart?: number; readonly private?: boolean; readonly typeTarget?: string } = {},
  ): SemanticSymbol => {
    const existing = declarations.get(owner);
    if (existing) return existing;
    const key = semanticBindingKey(declarationSpan, name);
    const type = bindingTypes.get(key);
    const memberTypes = bindingMembers.get(key) ?? new Map<string, ValueType>();
    const members = describeMembers(memberTypes);
    const symbol: SemanticSymbol = {
      id: `${source.path}#${selectionSpan.start}:${name}`,
      name,
      kind,
      path: source.path,
      span: declarationSpan,
      selectionSpan,
      scopeId: currentScope().id,
      exported,
      mutable,
      private: options.private ?? false,
      type: explicitType ?? (type ? describeType(type) : null),
      documentation: documentationBefore(source, options.documentationStart ?? declarationSpan.start),
      members,
      ...(callable(type) ? { callable: true as const } : {}),
      ...(options.typeTarget ? { typeTarget: options.typeTarget } : {}),
      ...(container ? { container } : {}),
      ...(kind === "method" || kind === "field" ? { static: staticMember } : {}),
    };
    symbols.push(symbol);
    if (lexical) currentScope().bindings.set(name, symbol);
    declarations.set(owner, symbol);
    return symbol;
  };
  const reference = (name: string, valueSpan: Span, write = false): void => {
    references.push({ name, path: source.path, span: valueSpan, symbolId: lookup(name)?.id ?? null, write });
  };
  const typeSyntaxReferences = (syntax: TypeSyntax): void => {
    switch (syntax.kind) {
      case "NamedTypeSyntax":
        if (lookup(syntax.name)) reference(syntax.name, syntax.span);
        break;
      case "EnumMemberTypeSyntax":
        if (lookup(syntax.enumName)) reference(syntax.enumName, syntax.enumNameSpan);
        {
          const owner = lookup(syntax.enumName);
          const bindingType = owner ? bindingTypes.get(semanticBindingKey(owner.span, owner.name)) : null;
          const identity = bindingType?.kind === "enumObject" ? bindingType.identity : syntax.enumName;
          const localMember = owner?.kind === "enum"
            ? symbols.find((symbol) => symbol.kind === "enum-member" && symbol.container === owner.name && symbol.name === syntax.member)
            : null;
          if (localMember) {
            references.push({ name: syntax.member, path: source.path, span: syntax.memberSpan, symbolId: localMember.id, write: false });
          }
        memberReferences.push({
          name: syntax.member,
          path: source.path,
          span: syntax.memberSpan,
          ownerType: syntax.enumName,
          ownerKind: "enum",
          ownerIdentity: identity,
          syntax: "access",
          shorthand: false,
        });
        }
        break;
      case "GenericTypeSyntax":
        if (lookup(syntax.name)) reference(syntax.name, syntax.nameSpan);
        for (const argument of syntax.arguments) typeSyntaxReferences(argument);
        break;
      case "ReadonlyTypeSyntax":
      case "OptionalTypeSyntax":
        typeSyntaxReferences(syntax.inner);
        break;
      case "UnionTypeSyntax":
        for (const member of syntax.members) typeSyntaxReferences(member);
        break;
      case "FunctionTypeSyntax":
        for (const parameter of syntax.parameters) typeSyntaxReferences(parameter.type);
        typeSyntaxReferences(syntax.result);
        break;
    }
  };
  const typeReferences = (type: TypeReference | null): void => {
    if (type) typeSyntaxReferences(type.syntax);
  };
  const nameSpan = (span: Span, name: string, from = span.start): Span => findNameSpan(source.text, span, name, from);
  const recordMemberReference = (
    name: string,
    referenceSpan: Span,
    owner: ValueType,
    syntax: SemanticMemberReference["syntax"],
    shorthand = false,
  ): void => {
    memberReferences.push({
      name,
      path: source.path,
      span: referenceSpan,
      ownerType: "name" in owner ? owner.name : describeType(owner),
      ownerKind: owner.kind,
      ...("identity" in owner && owner.identity ? { ownerIdentity: owner.identity } : {}),
      syntax,
      shorthand,
    });
  };
  const moduleSourceSpan = (valueSpan: Span): Span => valueSpan.end - valueSpan.start >= 2
    ? { start: valueSpan.start + 1, end: valueSpan.end - 1 }
    : valueSpan;

  const declareImport = (statement: ImportDeclaration): void => {
    moduleReferences.push({ source: statement.source, span: moduleSourceSpan(statement.sourceSpan), dynamic: false });
    for (const specifier of statement.specifiers) {
      const words = wordSpans(source.text, specifier.span);
      const importedSpan = specifier.namespace
        ? words[0] ?? specifier.span
        : words.find((word) => source.text.slice(word.start, word.end) === specifier.imported) ?? words[0] ?? specifier.span;
      const localSpan = [...words].reverse().find((word) => source.text.slice(word.start, word.end) === specifier.local) ?? importedSpan;
      const symbol = declare(specifier, specifier.local, "import", specifier.span, localSpan);
      imports.push({
        source: statement.source,
        imported: specifier.imported,
        importedSpan,
        local: specifier.local,
        localSpan,
        localSymbolId: symbol.id,
        namespace: specifier.namespace,
      });
    }
  };

  const declareReExport = (statement: ReExportDeclaration): void => {
    moduleReferences.push({ source: statement.source, span: moduleSourceSpan(statement.sourceSpan), dynamic: false });
    for (const specifier of statement.specifiers) {
      const words = wordSpans(source.text, specifier.span);
      const importedSpan = words.find((word) => source.text.slice(word.start, word.end) === specifier.imported) ?? words[0] ?? specifier.span;
      const exportedSpan = [...words].reverse().find((word) => source.text.slice(word.start, word.end) === specifier.exported) ?? importedSpan;
      // A re-export is not a lexical binding: the exported alias is visible to
      // importers only, so the symbol stays out of the module scope chain.
      const symbol = declare(specifier, specifier.exported, "import", specifier.span, exportedSpan, true, false, false);
      imports.push({
        source: statement.source,
        imported: specifier.imported,
        importedSpan,
        local: specifier.exported,
        localSpan: exportedSpan,
        localSymbolId: symbol.id,
        namespace: false,
      });
    }
  };

  const predeclareTopLevel = (): void => {
    for (const statement of program.body) {
      switch (statement.kind) {
        case "ImportDeclaration": declareImport(statement); break;
        case "ReExportDeclaration": declareReExport(statement); break;
        case "TypeDeclaration": declare(statement, statement.name, "type", statement.span, nameSpan(statement.span, statement.name), statement.exported); break;
        case "TypeAliasDeclaration": declare(
          statement,
          statement.name,
          "type",
          statement.span,
          nameSpan(statement.span, statement.name),
          statement.exported,
          false,
          true,
          undefined,
          formatTypeReference(statement.target),
          false,
          { ...(statement.target.syntax.kind === "NamedTypeSyntax" ? { typeTarget: statement.target.syntax.name } : {}) },
        ); break;
        case "EnumDeclaration": {
          declare(statement, statement.name, "enum", statement.span, nameSpan(statement.span, statement.name), statement.exported);
          for (const member of statement.members) {
            declare(member, member.name, "enum-member", member.span, member.span, false, false, false, statement.name, `${statement.name}.${member.name}`);
          }
          break;
        }
        case "ClassDeclaration": declare(statement, statement.name, "class", statement.span, nameSpan(statement.span, statement.name), statement.exported); break;
        case "FunctionDeclaration": declare(statement, statement.name, "function", statement.span, nameSpan(statement.span, statement.name), statement.exported); break;
        default:
          for (const extension of semanticExtensions) if (extension.predeclare?.(statement, extensionContext)) break;
          break;
      }
    }
  };

  const visitPattern = (
    pattern: BindingPattern,
    kind: SemanticSymbolKind,
    declarationSpan: Span,
    mutable: boolean,
    exported: boolean,
    documentationStart?: number,
  ): void => {
    if (pattern.kind === "NameBindingPattern") {
      declare(
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
      for (const element of pattern.elements) if (element) visitPattern(element, kind, element.span, mutable, exported, documentationStart);
      if (pattern.rest) visitPattern(pattern.rest, kind, pattern.rest.span, mutable, exported, documentationStart);
    } else {
      for (const entry of pattern.entries) {
        const owner = bindingEntryOwners.get(`${entry.span.start}:${entry.property}`);
        if (owner) {
          const shorthand = entry.pattern.kind === "NameBindingPattern"
            && entry.pattern.name === entry.property
            && entry.pattern.span.start === entry.span.start;
          recordMemberReference(entry.property, nameSpan(entry.span, entry.property), owner, "binding-key", shorthand);
        }
        visitPattern(entry.pattern, kind, entry.pattern.span, mutable, exported, documentationStart);
      }
      if (pattern.rest) visitPattern(pattern.rest, kind, pattern.rest.span, mutable, exported, documentationStart);
    }
  };

  const visitMatchPattern = (pattern: MatchPattern): void => {
    switch (pattern.kind) {
      case "MatchValuePattern":
        for (const value of pattern.values) visitExpression(value);
        break;
      case "MatchTypePattern":
        typeReferences(pattern.type);
        break;
      case "MatchWildcardPattern":
        break;
      case "MatchCapturePattern":
        if (pattern.binding.name !== "_") {
          declare(pattern.binding, pattern.binding.name, "variable", pattern.binding.span, pattern.binding.span);
        }
        break;
      case "MatchAsPattern":
        visitMatchPattern(pattern.pattern);
        if (pattern.binding.name !== "_") {
          declare(pattern.binding, pattern.binding.name, "variable", pattern.binding.span, pattern.binding.span);
        }
        break;
      case "MatchListPattern":
        for (const element of pattern.elements) visitMatchPattern(element);
        if (pattern.rest && pattern.rest.name !== "_") {
          declare(pattern.rest, pattern.rest.name, "variable", pattern.rest.span, pattern.rest.span);
        }
        break;
      case "MatchObjectPattern":
        for (const entry of pattern.entries) {
          const owner = bindingEntryOwners.get(`${entry.span.start}:${entry.property}`);
          if (owner) {
            const shorthand = entry.pattern.kind === "MatchCapturePattern"
              && entry.pattern.binding.name === entry.property
              && entry.pattern.span.start === entry.span.start;
            recordMemberReference(entry.property, nameSpan(entry.span, entry.property), owner, "binding-key", shorthand);
          }
          visitMatchPattern(entry.pattern);
        }
        if (pattern.rest && pattern.rest.name !== "_") {
          declare(pattern.rest, pattern.rest.name, "variable", pattern.rest.span, pattern.rest.span);
        }
        break;
    }
  };

  const visitExpression = (expression: Expression, write = false): void => {
    const expressionKey = spanIdentity(expression.span);
    const expressionType = expressionTypes.get(expressionKey);
    const expressionOwner = expressionOwners.get(expressionKey);
    const expressionContext = expressionContexts.get(expressionKey);
    const describedContextMembers = expressionContext
      ? describeMembers(expressionContextMembers.get(expressionKey) ?? new Map())
      : [];
    const describedExpressionMembers = describeMembers(expressionMembers.get(expressionKey) ?? new Map());
    const callableExpression = callable(expressionType);
    const indexableExpression = (expression.kind !== "IdentifierExpression" || expressionType !== undefined)
      && expression.kind !== "LiteralExpression" && expression.kind !== "SuperExpression";
    if (expressionType && indexableExpression
      && (describedExpressionMembers.length > 0 || callableExpression || expression.kind === "MemberExpression" || expressionContext)
      && !expressionKeys.has(expressionKey)) {
      expressionKeys.add(expressionKey);
      expressions.push({
        span: expression.span,
        type: describeType(expressionType),
        members: describedExpressionMembers,
        ...(callableExpression ? { callable: true as const } : {}),
        ...(expressionContext ? { contextType: describeType(expressionContext), contextMembers: describedContextMembers } : {}),
        ...(expression.kind === "MemberExpression" ? {
          memberName: expression.property,
          selectionSpan: { start: expression.span.end - expression.property.length, end: expression.span.end },
          ...(expressionOwner ? { ownerType: describeType(expressionOwner), ownerKind: expressionOwner.kind } : {}),
        } : {}),
      });
    }
    for (const extension of semanticExtensions) if (extension.visitExpression?.(expression, extensionContext)) return;
    switch (expression.kind) {
      case "IdentifierExpression": reference(expression.name, expression.span, write); break;
      case "SuperExpression": break;
      case "DynamicImportExpression":
        moduleReferences.push({ source: expression.source, span: moduleSourceSpan(expression.sourceSpan), dynamic: true });
        break;
      case "FStringExpression": for (const part of expression.parts) if (part.kind === "expression") visitExpression(part.value); break;
      case "ListExpression": for (const element of expression.elements) visitExpression(element); break;
      case "ObjectExpression":
        for (const property of expression.properties) {
          if (property.kind === "ObjectProperty") {
            const owner = objectPropertyOwners.get(`${property.span.start}:${property.name}`);
            if (owner) {
              const shorthand = property.value.kind === "IdentifierExpression"
                && property.value.name === property.name
                && property.value.span.start === property.span.start;
              recordMemberReference(property.name, nameSpan(property.span, property.name), owner, "object-key", shorthand);
            }
          }
          visitExpression(property.value);
        }
        break;
      case "SpreadExpression": visitExpression(expression.value); break;
      case "UnaryExpression": visitExpression(expression.operand); break;
      case "BinaryExpression": visitExpression(expression.left); visitExpression(expression.right); break;
      case "AssignmentExpression": visitExpression(expression.target); visitExpression(expression.value); break;
      case "ComparisonChainExpression": for (const operand of expression.operands) visitExpression(operand); break;
      case "ConditionalExpression": visitExpression(expression.condition); visitExpression(expression.thenValue); visitExpression(expression.elseValue); break;
      case "IsExpression": visitExpression(expression.value); typeReferences(expression.type); break;
      case "ArrowFunctionExpression":
        enterScope(expression.span);
        for (const parameter of expression.parameters) {
          if (parameter.defaultValue) visitExpression(parameter.defaultValue);
          typeReferences(parameter.type);
          declare(parameter, parameter.name, "parameter", parameter.span, { start: parameter.span.start, end: parameter.span.start + parameter.name.length });
        }
        visitExpression(expression.body);
        exitScope();
        break;
      case "CallExpression": visitExpression(expression.callee); for (const argument of expression.arguments) visitExpression(argument); break;
      case "MemberExpression": {
        if (expressionOwner) {
          recordMemberReference(
            expression.property,
            { start: expression.span.end - expression.property.length, end: expression.span.end },
            expressionOwner,
            "access",
          );
        }
        visitExpression(expression.object);
        if (expression.object.kind === "IdentifierExpression") {
          const owner = lookup(expression.object.name);
          const member = owner?.kind === "enum"
            ? symbols.find((symbol) => symbol.kind === "enum-member" && symbol.container === owner.name && symbol.name === expression.property)
            : null;
          if (member) {
            const end = expression.span.end;
            references.push({ name: expression.property, path: source.path, span: { start: end - expression.property.length, end }, symbolId: member.id, write: false });
          }
        }
        break;
      }
      case "IndexExpression": visitExpression(expression.object); visitExpression(expression.index); break;
      case "LiteralExpression": break;
    }
  };

  const visitFunction = (
    statement: SemanticFunctionLike,
    method = false,
    container?: string,
    memberKind: "field" | "method" = "method",
    explicitType?: string,
  ): void => {
    if (method) declare(
      statement,
      statement.name,
      memberKind,
      statement.span,
      nameSpan(statement.span, statement.name),
      false,
      false,
      false,
      container,
      explicitType,
      "static" in statement && statement.static === true,
      { ...("private" in statement && statement.private ? { private: true } : {}) },
    );
    enterScope(statement.span);
    for (const parameter of statement.parameters) {
      if (parameter.defaultValue) visitExpression(parameter.defaultValue);
      typeReferences(parameter.type);
      declare(parameter, parameter.name, "parameter", parameter.span, { start: parameter.span.start, end: parameter.span.start + parameter.name.length });
    }
    typeReferences(statement.returnType);
    for (const child of statement.body) visitStatement(child);
    exitScope();
  };

  const visitBlock = (body: readonly Statement[], fallbackSpan: Span): void => {
    const scopeSpan = body.length > 0
      ? { start: body[0]!.span.start, end: body.at(-1)!.span.end }
      : fallbackSpan;
    enterScope(scopeSpan);
    for (const child of body) visitStatement(child);
    exitScope();
  };

  const visitStatement = (statement: Statement): void => {
    for (const extension of semanticExtensions) if (extension.visitStatement?.(statement, extensionContext)) return;
    switch (statement.kind) {
      case "ImportDeclaration": break;
      case "ReExportDeclaration": break;
      case "ExternModuleDeclaration":
        for (const declaration of statement.functions) {
          const selection = nameSpan(declaration.span, declaration.name);
          declare(declaration, declaration.name, "function", declaration.span, selection, true, false, false);
          for (const parameter of declaration.parameters) typeReferences(parameter.type);
          typeReferences(declaration.returnType);
        }
        for (const declaration of statement.constants) {
          const selection = nameSpan(declaration.span, declaration.name);
          declare(declaration, declaration.name, "variable", declaration.span, selection, true, false, true, undefined, formatTypeReference(declaration.type));
          typeReferences(declaration.type);
        }
        for (const declaration of statement.classes) {
          declare(declaration, declaration.name, "class", declaration.span, nameSpan(declaration.span, declaration.name), true);
          for (const parameter of declaration.parameters) {
            if (parameter.binding) {
              declare(parameter, parameter.name, "field", parameter.span, nameSpan(parameter.span, parameter.name), false, parameter.binding === "let", false, declaration.name);
            }
            typeReferences(parameter.type);
          }
          for (const field of declaration.fields) {
            declare(field, field.name, "field", field.span, nameSpan(field.span, field.name), false, field.mutable, false, declaration.name, undefined, field.static);
            typeReferences(field.type);
          }
          for (const getter of declaration.getters) {
            declare(getter, getter.name, "field", getter.span, nameSpan(getter.span, getter.name), false, false, false, declaration.name, formatTypeReference(getter.type), getter.static);
            typeReferences(getter.type);
          }
          for (const method of declaration.methods) {
            declare(method, method.name, "method", method.span, nameSpan(method.span, method.name), false, false, false, declaration.name);
            for (const parameter of method.parameters) typeReferences(parameter.type);
            typeReferences(method.returnType);
          }
        }
        break;
      case "TypeDeclaration":
        for (const field of statement.fields) {
          const selection = nameSpan(field.span, field.name);
          declare(field, field.name, "field", field.span, selection, false, false, false, statement.name);
          typeReferences(field.type);
        }
        break;
      case "TypeAliasDeclaration":
        typeReferences(statement.target);
        break;
      case "EnumDeclaration":
        break;
      case "ClassDeclaration":
        if (statement.base) {
          reference(statement.base.name, { start: statement.base.span.start, end: statement.base.span.start + statement.base.name.length });
        }
        enterScope(statement.span);
        for (const parameter of statement.parameters) {
          if (parameter.defaultValue) visitExpression(parameter.defaultValue);
          typeReferences(parameter.type);
          const selection = { start: parameter.span.start, end: parameter.span.start + parameter.name.length };
          const symbol = parameter.binding
            ? declare(
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
            : declare(parameter, parameter.name, "parameter", parameter.span, selection);
          currentScope().bindings.set(parameter.name, symbol);
        }
        if (statement.base) for (const argument of statement.base.arguments) visitExpression(argument);
        for (const field of statement.fields) {
          declare(
            field,
            field.name,
            "field",
            field.span,
            nameSpan(field.span, field.name),
            false,
            field.binding === "let",
            false,
            statement.name,
            formatTypeReference(field.type),
            field.static,
            { ...(field.private ? { private: true } : {}) },
          );
          typeReferences(field.type);
          if (!field.static && field.initializer) visitExpression(field.initializer);
        }
        if (statement.initialization) visitBlock(statement.initialization.body, statement.initialization.span);
        exitScope();
        for (const field of statement.fields) if (field.static && field.initializer) visitExpression(field.initializer);
        for (const getter of statement.getters) visitFunction(getter, true, statement.name, "field", getter.returnType ? formatTypeReference(getter.returnType) : undefined);
        for (const method of statement.methods) visitFunction(method, true, statement.name);
        break;
      case "VariableDeclaration":
        visitExpression(statement.initializer);
        typeReferences(statement.type);
        visitPattern(statement.pattern, "variable", statement.pattern.span, statement.binding === "let", statement.exported, statement.span.start);
        break;
      case "FunctionDeclaration":
        if (!declarations.has(statement)) declare(statement, statement.name, "function", statement.span, nameSpan(statement.span, statement.name), statement.exported);
        visitFunction(statement);
        break;
      case "ReturnStatement": if (statement.value) visitExpression(statement.value); break;
      case "ThrowStatement": visitExpression(statement.value); break;
      case "AssertStatement": visitExpression(statement.condition); if (statement.message) visitExpression(statement.message); break;
      case "IfStatement": visitExpression(statement.condition); visitBlock(statement.thenBody, statement.span); if (statement.elseBody) visitBlock(statement.elseBody, statement.span); break;
      case "MatchStatement":
        visitExpression(statement.value);
        for (const branch of statement.cases) {
          enterScope(branch.span);
          visitMatchPattern(branch.pattern);
          if (branch.guard) visitExpression(branch.guard);
          for (const child of branch.body) visitStatement(child);
          exitScope();
        }
        if (statement.elseBody) visitBlock(statement.elseBody, statement.span);
        break;
      case "ForStatement":
        visitExpression(statement.iterable);
        enterScope(statement.span);
        visitPattern(statement.pattern, "variable", statement.pattern.span, false, false);
        if (statement.secondPattern) visitPattern(statement.secondPattern, "variable", statement.secondPattern.span, false, false);
        for (const child of statement.body) visitStatement(child);
        exitScope();
        break;
      case "WhileStatement": visitExpression(statement.condition); visitBlock(statement.body, statement.span); break;
      case "TryStatement":
        visitBlock(statement.tryBody, statement.span);
        if (statement.catchBody) {
          const catchSpan = statement.catchBody.length > 0
            ? { start: statement.catchBody[0]!.span.start, end: statement.catchBody.at(-1)!.span.end }
            : statement.span;
          enterScope(catchSpan);
          if (statement.catchName) {
            const selection = nameSpan(statement.span, statement.catchName, statement.tryBody.at(-1)?.span.end ?? statement.span.start);
            declare({ statement, role: "catch" }, statement.catchName, "catch", statement.span, selection);
          }
          for (const child of statement.catchBody) visitStatement(child);
          exitScope();
        }
        if (statement.finallyBody) visitBlock(statement.finallyBody, statement.span);
        break;
      case "AssignmentStatement": visitExpression(statement.target, true); visitExpression(statement.value); break;
      case "ExpressionStatement": visitExpression(statement.expression); break;
      case "BreakStatement":
      case "ContinueStatement":
      case "PassStatement": break;
    }
  };

  extensionContext = {
    declare(owner, name, kind, declarationSpan, selectionSpan, options = {}) {
      return declare(
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
        },
      );
    },
    hasDeclaration: (owner) => declarations.has(owner),
    nameSpan,
    typeReferences,
    reference,
    recordMemberReference,
    jsxAttributeOwner: (attributeSpan, name) => jsxAttributeOwners.get(`${attributeSpan.start}:${name}`),
    enterScope,
    exitScope,
    visitExpression: (expression) => visitExpression(expression),
    visitStatement,
    visitBlock,
    visitFunction: (statement) => visitFunction(statement),
  };

  predeclareTopLevel();
  for (const statement of program.body) visitStatement(statement);
  return {
    path: source.path,
    symbols,
    references,
    memberReferences,
    imports,
    moduleReferences,
    scopes: allScopes.map(({ id, parentId, span: scopeSpan }) => ({ id, parentId, span: scopeSpan })),
    expressions,
  };
}

const MAX_DOCUMENTATION_CHARS = 16_384;

function documentationBefore(source: SourceText, declarationStart: number): string | null {
  const location = source.location(declarationStart);
  const lineStart = source.lineStarts[location.line - 1] ?? 0;
  const indentation = source.text.slice(lineStart, declarationStart);
  if (!/^[ \t]*$/u.test(indentation)) return null;
  const lines: string[] = [];
  for (let lineNumber = location.line - 1; lineNumber > 0; lineNumber -= 1) {
    const line = source.lineText(lineNumber);
    if (!line.startsWith(`${indentation}///`)) break;
    const suffix = line.slice(indentation.length + 3);
    lines.unshift(suffix.startsWith(" ") ? suffix.slice(1) : suffix);
  }
  while (lines[0] === "") lines.shift();
  while (lines.at(-1) === "") lines.pop();
  if (lines.length === 0) return null;
  const documentation = lines.join("\n");
  return documentation.length <= MAX_DOCUMENTATION_CHARS
    ? documentation
    : `${documentation.slice(0, MAX_DOCUMENTATION_CHARS - 1)}…`;
}

export function semanticVisibleSymbolsAt(index: SemanticIndex, offset: number): readonly SemanticSymbol[] {
  const scopesById = new Map(index.scopes.map((scope) => [scope.id, scope]));
  const depths = new Map<number, number>();
  const depthOf = (scope: SemanticScope): number => {
    const cached = depths.get(scope.id);
    if (cached !== undefined) return cached;
    const parent = scope.parentId === null ? null : scopesById.get(scope.parentId) ?? null;
    const depth = parent ? depthOf(parent) + 1 : 0;
    depths.set(scope.id, depth);
    return depth;
  };
  let active = scopesById.get(0);
  let activeDepth = active ? depthOf(active) : -1;
  for (const scope of index.scopes) {
    if (offset < scope.span.start || offset > scope.span.end) continue;
    const depth = depthOf(scope);
    if (depth > activeDepth) {
      active = scope;
      activeDepth = depth;
    }
  }
  if (!active) return [];

  const activeScopeIds: number[] = [];
  for (let scope: SemanticScope | undefined = active; scope;) {
    activeScopeIds.push(scope.id);
    scope = scope.parentId === null ? undefined : scopesById.get(scope.parentId);
  }

  const lexicalKinds = new Set<SemanticSymbolKind>([
    "import", "type", "enum", "class", "component", "function", "state", "computed",
    "resource", "action", "variable", "parameter", "watch-value", "catch",
  ]);
  const rootHoistedKinds = new Set<SemanticSymbolKind>(["import", "type", "enum", "class", "component", "function"]);
  const names = new Set<string>();
  const output: SemanticSymbol[] = [];
  const activeSet = new Set(activeScopeIds);
  const symbolsByScope = new Map<number, SemanticSymbol[]>();
  for (const symbol of index.symbols) {
    if (!activeSet.has(symbol.scopeId)) continue;
    const bucket = symbolsByScope.get(symbol.scopeId) ?? [];
    bucket.push(symbol);
    symbolsByScope.set(symbol.scopeId, bucket);
  }
  for (const scopeId of activeScopeIds) {
    for (const symbol of symbolsByScope.get(scopeId) ?? []) {
      if (!lexicalKinds.has(symbol.kind) || names.has(symbol.name)) continue;
      if (symbol.selectionSpan.start > offset && !(scopeId === 0 && rootHoistedKinds.has(symbol.kind))) continue;
      names.add(symbol.name);
      output.push(symbol);
    }
  }
  return output;
}

export function semanticSymbolAt(index: SemanticIndex, offset: number): SemanticSymbol | null {
  const declaration = index.symbols.find((symbol) => contains(symbol.selectionSpan, offset));
  if (declaration) return declaration;
  const reference = index.references.find((item) => contains(item.span, offset));
  return reference?.symbolId ? index.symbols.find((symbol) => symbol.id === reference.symbolId) ?? null : null;
}

export function semanticImportAt(index: SemanticIndex, offset: number): SemanticImport | null {
  return index.imports.find((item) => contains(item.importedSpan, offset) || contains(item.localSpan, offset)) ?? null;
}

export function semanticModuleReferenceAt(index: SemanticIndex, offset: number): SemanticModuleReference | null {
  return index.moduleReferences.find((item) => contains(item.span, offset)) ?? null;
}

function contains(span: Span, offset: number): boolean {
  return offset >= span.start && offset < span.end;
}

function wordSpans(text: string, valueSpan: Span): Span[] {
  const value = text.slice(valueSpan.start, valueSpan.end);
  return [...value.matchAll(/[A-Za-z_][A-Za-z0-9_]*/gu)].map((match) => {
    const start = valueSpan.start + (match.index ?? 0);
    return { start, end: start + match[0].length };
  });
}

function findNameSpan(text: string, valueSpan: Span, name: string, from: number): Span {
  const startAt = Math.max(valueSpan.start, from);
  const value = text.slice(startAt, valueSpan.end);
  const pattern = new RegExp(`(?:^|[^A-Za-z0-9_])(${escapeRegExp(name)})(?![A-Za-z0-9_])`, "u");
  const match = pattern.exec(value);
  if (!match) return { start: startAt, end: Math.min(valueSpan.end, startAt + name.length) };
  const prefix = match[0].length - match[1]!.length;
  const start = startAt + match.index + prefix;
  return { start, end: start + name.length };
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}
