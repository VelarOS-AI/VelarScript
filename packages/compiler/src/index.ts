import { Analyzer, isCorePrimitiveName, isCoreReservedBinding, type AnalysisContext, type ClassInfo } from "./analyzer.ts";
import type { BindingPattern, Expression, FunctionDeclaration, MatchPattern, Program, Statement, TypeReference } from "./ast.ts";
import { diagnostic, type Diagnostic } from "./diagnostic.ts";
import { JavaScriptEmitter } from "./emitter.ts";
import type { CompilerEmitter, CompilerExtension, CompilerResourceDependency, CompilerStyleSegments, ModuleInterface } from "./extension.ts";
import { Lexer } from "./lexer.ts";
import { isParserComplexityFailure, Parser } from "./parser.ts";
import { SourceText } from "./source.ts";
import { buildSemanticIndex, type SemanticIndex } from "./semantic.ts";
import { MAX_VELAR_SOURCE_CODE_UNITS } from "./limits.ts";
import {
  bindNamedTypeParameters,
  boolType,
  mergeTypes,
  nullType,
  numberType,
  optionalOf,
  resolveTypeReference,
  resolvedAsyncType,
  stringType,
  unknownType,
  type EnumInfo,
  type ValueType,
} from "./types.ts";

export { formatDiagnostic, type Diagnostic } from "./diagnostic.ts";
export { formatSource } from "./formatter.ts";
export { collectionMemberGuidance, sourceTypeNameGuidance, type CollectionKind, type CollectionMemberGuidance, type SourceTypeGuidance } from "./language-guidance.ts";
export { SourceText, type Span } from "./source.ts";
export { MAX_VELAR_SOURCE_CODE_UNITS } from "./limits.ts";
export type { CompilerAnalysisExtension, CompilerAnalyzerFactory, CompilerDependencyContext, CompilerEditorCompletion, CompilerEditorExtension, CompilerEmitter, CompilerExtension, CompilerInspectionExtension, CompilerInterfaceContext, CompilerIntrinsicAnalysisContext, CompilerLexicalExtension, CompilerLexicalScanContext, CompilerLexicalScanResult, CompilerModuleExtension, CompilerParserFactory, CompilerProjectEditorCompletion, CompilerProjectEditorCompletionContext, CompilerProjectEditorCompletionResult, CompilerProjectEditorExtension, CompilerProjectEditorRenameContext, CompilerResourceDependency, CompilerStyleSegments, ModuleInterface } from "./extension.ts";
export { semanticImportAt, semanticModuleReferenceAt, semanticSymbolAt, semanticVisibleSymbolsAt, type CompilerSemanticExtension, type SemanticDeclareOptions, type SemanticExpression, type SemanticExtensionContext, type SemanticFunctionLike, type SemanticImport, type SemanticIndex, type SemanticMember, type SemanticMemberReference, type SemanticModuleReference, type SemanticReference, type SemanticScope, type SemanticSymbol, type SemanticSymbolKind } from "./semantic.ts";
export { analysisTypeIdentity, describeType, optionalOf, semanticTypeIdentity, type EnumInfo, type ValueType } from "./types.ts";
export type { AnalysisContext, ClassField, ClassInfo } from "./analyzer.ts";

export interface CompileOptions {
  readonly path?: string;
  readonly analysis?: AnalysisContext;
  readonly exportFunctions?: ReadonlySet<string>;
  readonly extensions?: readonly CompilerExtension[];
  readonly resourceContents?: ReadonlyMap<string, string>;
}

export interface CompileResult {
  readonly code: string | null;
  readonly sourceMap: string | null;
  readonly css: string | null;
  readonly styleSegments: CompilerStyleSegments | null;
  readonly extensions: readonly string[];
  readonly diagnostics: readonly Diagnostic[];
  readonly source: SourceText;
  readonly dependencies: readonly ModuleDependency[];
  readonly resources: readonly CompilerResourceDependency[];
  readonly moduleInterface: ModuleInterface;
  readonly semanticIndex: SemanticIndex;
}

export interface ModuleDependencySpecifier {
  readonly imported: string;
  readonly local: string;
  readonly namespace: boolean;
}

export interface ModuleDependency {
  readonly source: string;
  readonly javascript: boolean;
  readonly unsafe: boolean;
  readonly dynamic: boolean;
  readonly specifiers: readonly ModuleDependencySpecifier[];
}

export interface ModuleInspection {
  readonly diagnostics: readonly Diagnostic[];
  readonly source: SourceText;
  readonly dependencies: readonly ModuleDependency[];
  readonly resources: readonly CompilerResourceDependency[];
  readonly moduleInterface: ModuleInterface;
  readonly semanticIndex: SemanticIndex;
}

export function inspectModule(text: string, options: Pick<CompileOptions, "path" | "extensions"> = {}): ModuleInspection {
  const extensions = normalizedExtensions(options.extensions ?? []);
  const parsed = parseModule(text, options.path ?? "<source>", extensions);
  return {
    diagnostics: parsed.diagnostics,
    source: parsed.source,
    dependencies: dependenciesOf(parsed.program, extensions),
    resources: resourcesOf(parsed.program, extensions),
    moduleInterface: interfaceOf(parsed.program, parsed.source.path, extensions),
    semanticIndex: buildSemanticIndex(parsed.program, parsed.source, new Map(), new Map(), new Map(), new Map(), new Map(), new Map(), new Map(), new Map(), new Map(), new Map(), extensions.flatMap((extension) => extension.semantic ? [extension.semantic] : [])),
  };
}

export function compile(text: string, options: CompileOptions = {}): CompileResult {
  const extensions = normalizedExtensions(options.extensions ?? []);
  const parsed = parseModule(text, options.path ?? "<source>", extensions);
  const diagnostics = [...parsed.diagnostics];
  const analysisExtensions = extensions.flatMap((extension) => extension.analysis ? [extension.analysis] : []);
  const analyzerExtensions = extensions.filter((extension) => extension.analyzer);
  if (analyzerExtensions.length > 1) throw new Error("Only one compiler extension may own semantic analysis");
  const analysisResources = options.resourceContents ?? options.analysis?.resources;
  const analysisContext: AnalysisContext = { ...options.analysis, ...(analysisResources ? { resources: analysisResources } : {}) };
  const analyzer = analyzerExtensions[0]?.analyzer?.create(analysisContext, analysisExtensions)
    ?? new Analyzer(analysisContext, analysisExtensions);
  if (diagnostics.length === 0) {
    diagnostics.push(...analyzer.analyze(parsed.program));
  }

  diagnostics.sort((left, right) => left.span.start - right.span.start || left.code.localeCompare(right.code));
  const emitterExtensions = extensions.filter((extension) => extension.createEmitter);
  if (emitterExtensions.length > 1) throw new Error("Only one compiler extension may own JavaScript emission");
  const emitter: CompilerEmitter = emitterExtensions[0]?.createEmitter?.(
    analyzer.loweringHints(),
    options.exportFunctions ?? new Set(),
    options.resourceContents ?? new Map(),
    options.analysis?.extensionImports ?? new Map(),
  )
    ?? new JavaScriptEmitter(analyzer.loweringHints(), options.exportFunctions);
  const code = diagnostics.length === 0 ? emitter.emit(parsed.program) : null;
  const sourceMap = code === null ? null : emitter.sourceMap(parsed.source);
  const css = code === null ? null : emitter.css?.() ?? null;
  const styleSegments = code === null ? null : emitter.styleSegments?.() ?? null;
  const semanticExpressions = analyzer.semanticExpressions();
  const semanticIndex = buildSemanticIndex(
    parsed.program,
    parsed.source,
    analyzer.semanticTypes(),
    analyzer.semanticMembers(),
    semanticExpressions.types,
    semanticExpressions.members,
    semanticExpressions.owners,
    semanticExpressions.objectPropertyOwners,
    semanticExpressions.bindingEntryOwners,
    semanticExpressions.jsxAttributeOwners,
    semanticExpressions.contexts,
    semanticExpressions.contextMembers,
    extensions.flatMap((extension) => extension.semantic ? [extension.semantic] : []),
  );
  return {
    code,
    sourceMap,
    css,
    styleSegments,
    extensions: extensions.map((extension) => extension.id),
    diagnostics,
    source: parsed.source,
    dependencies: dependenciesOf(parsed.program, extensions),
    resources: resourcesOf(parsed.program, extensions),
    moduleInterface: interfaceOf(
      parsed.program,
      parsed.source.path,
      extensions,
      analyzer.semanticTypes(),
      analyzer.analyzedClasses(),
    ),
    semanticIndex,
  };
}

function resourcesOf(program: Program, extensions: readonly CompilerExtension[]): readonly CompilerResourceDependency[] {
  const output: CompilerResourceDependency[] = [];
  const seen = new Set<string>();
  for (const extension of extensions) {
    for (const resource of extension.inspection?.resources?.(program) ?? []) {
      const key = `${resource.kind}\0${resource.source}`;
      if (seen.has(key)) continue;
      seen.add(key);
      output.push(resource);
    }
  }
  return output;
}

function parseModule(text: string, path: string, extensions: readonly CompilerExtension[]): { source: SourceText; program: Program; diagnostics: readonly Diagnostic[] } {
  if (text.length > MAX_VELAR_SOURCE_CODE_UNITS) {
    const source = new SourceText(path, text, false);
    return {
      source,
      program: { kind: "Program", body: [], span: { start: 0, end: 0 } },
      diagnostics: [diagnostic(
        "VEL1003",
        `A VelarScript source module cannot exceed ${MAX_VELAR_SOURCE_CODE_UNITS / 1024 / 1024} MiB`,
        { start: 0, end: Math.min(1, text.length) },
      )],
    };
  }
  const source = new SourceText(path, text);
  try {
    const lexicalExtensions = extensions.flatMap((extension) => extension.lexical ? [extension.lexical] : []);
    const lexed = new Lexer(text, lexicalExtensions).lex();
    if (lexed.diagnostics.some((item) => item.code === "VEL1005" || item.code === "VEL1006")) {
      return {
        source,
        program: { kind: "Program", body: [], span: { start: 0, end: text.length } },
        diagnostics: lexed.diagnostics,
      };
    }
    const parserExtensions = extensions.filter((extension) => extension.parser);
    if (parserExtensions.length > 1) throw new Error("Only one compiler extension may own syntax parsing");
    const parser = parserExtensions[0]?.parser?.create(lexed.tokens, lexicalExtensions)
      ?? new Parser(lexed.tokens, lexicalExtensions);
    const parsed = parser.parse();
    return { source, program: parsed.program, diagnostics: [...lexed.diagnostics, ...parsed.diagnostics] };
  } catch (error) {
    if (!isParserComplexityFailure(error)) throw error;
    return {
      source,
      program: { kind: "Program", body: [], span: { start: 0, end: 0 } },
      diagnostics: [diagnostic("VEL2008", "VelarScript source nesting is too complex to parse safely", { start: 0, end: Math.min(1, text.length) })],
    };
  }
}

function normalizedExtensions(extensions: readonly CompilerExtension[]): readonly CompilerExtension[] {
  const seen = new Set<string>();
  const capabilities = new Set<string>();
  const primitiveOwners = new Map<string, string>();
  const globalOwners = new Map<string, string>();
  for (const extension of extensions) {
    if (!extension.id || seen.has(extension.id)) throw new Error(`Compiler extension '${extension.id}' is invalid or duplicated`);
    seen.add(extension.id);
    for (const capability of extension.capabilities ?? []) {
      if (!/^[a-z][a-z0-9-]*$/u.test(capability) || capabilities.has(capability)) {
        throw new Error(`Compiler capability '${capability}' is invalid or has more than one owner`);
      }
      capabilities.add(capability);
    }
    for (const name of extension.analysis?.primitiveTypes ?? []) {
      const owner = primitiveOwners.get(name);
      if (isCorePrimitiveName(name)) throw new Error(`Compiler extension '${extension.id}' cannot replace Core primitive '${name}'`);
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/u.test(name) || owner) {
        throw new Error(`Compiler primitive '${name}' is invalid or has more than one owner${owner ? ` (${owner}, ${extension.id})` : ""}`);
      }
      primitiveOwners.set(name, extension.id);
    }
    for (const name of extension.analysis?.globals?.keys() ?? []) {
      if (isCoreReservedBinding(name)) throw new Error(`Compiler extension '${extension.id}' cannot replace reserved Core binding '${name}'`);
      const owner = globalOwners.get(name);
      if (owner) throw new Error(`Compiler global '${name}' has more than one owner (${owner}, ${extension.id})`);
      globalOwners.set(name, extension.id);
    }
  }

  const parents = new Map<string, Set<string>>();
  for (const extension of extensions) {
    for (const [name, values] of extension.analysis?.primitiveParents ?? []) {
      if (primitiveOwners.get(name) !== extension.id) {
        throw new Error(`Compiler extension '${extension.id}' cannot define parents for primitive '${name}' that it does not own`);
      }
      const collected = parents.get(name) ?? new Set<string>();
      for (const parent of values) {
        if (!primitiveOwners.has(parent)) throw new Error(`Compiler primitive '${name}' has unknown parent '${parent}'`);
        collected.add(parent);
      }
      parents.set(name, collected);
    }
    for (const [name, fields] of extension.analysis?.primitiveMutableFields ?? []) {
      if (primitiveOwners.get(name) !== extension.id) {
        throw new Error(`Compiler extension '${extension.id}' cannot make fields writable on primitive '${name}' that it does not own`);
      }
      for (const field of fields) {
        if (!/^[A-Za-z_][A-Za-z0-9_]*$/u.test(field)) throw new Error(`Compiler primitive '${name}' has invalid writable field '${field}'`);
      }
    }
  }

  const completed = new Set<string>();
  const active = new Set<string>();
  const visit = (name: string): void => {
    if (completed.has(name)) return;
    if (active.has(name)) throw new Error(`Compiler primitive inheritance contains a cycle at '${name}'`);
    active.add(name);
    for (const parent of parents.get(name) ?? []) visit(parent);
    active.delete(name);
    completed.add(name);
  };
  for (const name of primitiveOwners.keys()) visit(name);
  return extensions;
}

function dependenciesOf(program: Program, extensions: readonly CompilerExtension[]): readonly ModuleDependency[] {
  const dependencies: ModuleDependency[] = program.body
    .filter((statement) => statement.kind === "ImportDeclaration")
    .map((statement) => ({
      source: statement.source,
      javascript: statement.javascript,
      unsafe: statement.unsafe,
      dynamic: false,
      specifiers: statement.specifiers.map((specifier) => ({
        imported: specifier.imported,
        local: specifier.local,
        namespace: specifier.namespace,
      })),
    }));

  const dynamicSources = new Set<string>();
  const dependencyExtensions = extensions.flatMap((extension) => extension.inspection ? [extension.inspection] : []);
  const dependencyContext = {
    visitExpression: (expression: Expression) => visitExpression(expression),
    visitStatement: (statement: Statement) => visitStatement(statement),
    visitBlock: (body: readonly Statement[]) => visitBlock(body),
  };
  const visitExpression = (expression: Expression): void => {
    for (const extension of dependencyExtensions) if (extension.visitDependencyExpression?.(expression, dependencyContext)) return;
    switch (expression.kind) {
      case "DynamicImportExpression":
        if (!dynamicSources.has(expression.source)) {
          dynamicSources.add(expression.source);
          dependencies.push({
            source: expression.source,
            javascript: false,
            unsafe: false,
            dynamic: true,
            specifiers: [],
          });
        }
        break;
      case "FStringExpression":
        for (const part of expression.parts) if (part.kind === "expression") visitExpression(part.value);
        break;
      case "ListExpression":
        for (const element of expression.elements) visitExpression(element);
        break;
      case "ObjectExpression":
        for (const property of expression.properties) visitExpression(property.value);
        break;
      case "SpreadExpression": visitExpression(expression.value); break;
      case "UnaryExpression": visitExpression(expression.operand); break;
      case "BinaryExpression": visitExpression(expression.left); visitExpression(expression.right); break;
      case "ComparisonChainExpression": for (const operand of expression.operands) visitExpression(operand); break;
      case "ConditionalExpression": visitExpression(expression.condition); visitExpression(expression.thenValue); visitExpression(expression.elseValue); break;
      case "IsExpression": visitExpression(expression.value); break;
      case "ArrowFunctionExpression":
        for (const parameter of expression.parameters) if (parameter.defaultValue) visitExpression(parameter.defaultValue);
        visitExpression(expression.body);
        break;
      case "CallExpression": visitExpression(expression.callee); for (const argument of expression.arguments) visitExpression(argument); break;
      case "MemberExpression": visitExpression(expression.object); break;
      case "IndexExpression": visitExpression(expression.object); visitExpression(expression.index); break;
      case "LiteralExpression":
      case "IdentifierExpression":
      case "SuperExpression":
        break;
    }
  };
  const visitBlock = (body: readonly Statement[]): void => { for (const statement of body) visitStatement(statement); };
  const visitMatchPattern = (pattern: MatchPattern): void => {
    switch (pattern.kind) {
      case "MatchValuePattern": for (const value of pattern.values) visitExpression(value); break;
      case "MatchAsPattern": visitMatchPattern(pattern.pattern); break;
      case "MatchObjectPattern": for (const entry of pattern.entries) visitMatchPattern(entry.pattern); break;
      case "MatchListPattern": for (const element of pattern.elements) visitMatchPattern(element); break;
      case "MatchTypePattern":
      case "MatchWildcardPattern":
      case "MatchCapturePattern":
        break;
    }
  };
  const visitStatement = (statement: Statement): void => {
    for (const extension of dependencyExtensions) if (extension.visitDependencyStatement?.(statement, dependencyContext)) return;
    switch (statement.kind) {
      case "ClassDeclaration":
        if (statement.base) for (const argument of statement.base.arguments) visitExpression(argument);
        for (const parameter of statement.parameters) if (parameter.defaultValue) visitExpression(parameter.defaultValue);
        for (const field of statement.fields) if (field.initializer) visitExpression(field.initializer);
        if (statement.initialization) visitBlock(statement.initialization.body);
        for (const method of statement.methods) {
          for (const parameter of method.parameters) if (parameter.defaultValue) visitExpression(parameter.defaultValue);
          visitBlock(method.body);
        }
        break;
      case "VariableDeclaration": visitExpression(statement.initializer); break;
      case "FunctionDeclaration":
        for (const parameter of statement.parameters) if (parameter.defaultValue) visitExpression(parameter.defaultValue);
        visitBlock(statement.body);
        break;
      case "ReturnStatement": if (statement.value) visitExpression(statement.value); break;
      case "ThrowStatement": visitExpression(statement.value); break;
      case "AssertStatement": visitExpression(statement.condition); if (statement.message) visitExpression(statement.message); break;
      case "IfStatement": visitExpression(statement.condition); visitBlock(statement.thenBody); if (statement.elseBody) visitBlock(statement.elseBody); break;
      case "MatchStatement":
        visitExpression(statement.value);
        for (const branch of statement.cases) {
          visitMatchPattern(branch.pattern);
          if (branch.guard) visitExpression(branch.guard);
          visitBlock(branch.body);
        }
        if (statement.elseBody) visitBlock(statement.elseBody);
        break;
      case "ForStatement": visitExpression(statement.iterable); visitBlock(statement.body); break;
      case "WhileStatement": visitExpression(statement.condition); visitBlock(statement.body); break;
      case "TryStatement": visitBlock(statement.tryBody); if (statement.catchBody) visitBlock(statement.catchBody); if (statement.finallyBody) visitBlock(statement.finallyBody); break;
      case "AssignmentStatement": visitExpression(statement.target); visitExpression(statement.value); break;
      case "ExpressionStatement": visitExpression(statement.expression); break;
      case "ImportDeclaration":
      case "ExternModuleDeclaration":
      case "TypeDeclaration":
      case "TypeAliasDeclaration":
      case "EnumDeclaration":
      case "BreakStatement":
      case "ContinueStatement":
      case "PassStatement":
        break;
    }
  };
  visitBlock(program.body);
  return dependencies;
}

function interfaceOf(
  program: Program,
  path: string,
  extensions: readonly CompilerExtension[],
  analyzedBindings: ReadonlyMap<string, ValueType> = new Map(),
  analyzedClasses: ReadonlyMap<string, ClassInfo> = new Map(),
): ModuleInterface {
  const classIdentities = new Map<string, string>([["Error", "Error"]]);
  for (const statement of program.body) {
    if (statement.kind === "ClassDeclaration") classIdentities.set(statement.name, `velar:${path}#${statement.name}`);
  }
  const enumNames = new Map(program.body
    .filter((statement) => statement.kind === "EnumDeclaration")
    .map((statement) => [statement.name, { identity: `${path}#enum:${statement.name}`, members: new Set(statement.members.map((member) => member.name)) }] satisfies [string, EnumInfo]));
  const namedTypeIdentities = new Map(program.body
    .filter((statement) => statement.kind === "TypeDeclaration")
    .map((statement) => [statement.name, `velar:${path}#type:${statement.name}`] satisfies [string, string]));
  const aliasDeclarations = new Map<string, Extract<Statement, { kind: "TypeAliasDeclaration" }>>();
  for (const statement of program.body) {
    if (statement.kind === "TypeAliasDeclaration") aliasDeclarations.set(statement.name, statement);
  }
  const aliasCache = new Map<string, ValueType>();
  const expandAliases = (type: ValueType, seen: ReadonlySet<string> = new Set()): ValueType => {
    if (type.kind === "named" && aliasDeclarations.has(type.name)) {
      if (seen.has(type.name)) return unknownType;
      const cached = aliasCache.get(type.name);
      if (cached) return cached;
      const declaration = aliasDeclarations.get(type.name)!;
      const expanded = expandAliases(resolveTypeReference(declaration.target), new Set([...seen, type.name]));
      aliasCache.set(type.name, expanded);
      return expanded;
    }
    if (type.kind === "optional") return optionalOf(expandAliases(type.inner, seen));
    if (type.kind === "list") return { ...type, element: expandAliases(type.element, seen) };
    if (type.kind === "set") return { ...type, element: expandAliases(type.element, seen) };
    if (type.kind === "map") return { ...type, key: expandAliases(type.key, seen), value: expandAliases(type.value, seen) };
    if (type.kind === "promise") return { kind: "promise", value: expandAliases(type.value, seen) };
    if (type.kind === "object") return { ...type, fields: new Map([...type.fields].map(([name, value]) => [name, expandAliases(value, seen)])) };
    if (type.kind === "function" || type.kind === "action" || type.kind === "intrinsic") return {
      ...type,
      parameters: type.parameters.map((parameter) => expandAliases(parameter, seen)),
      ...(type.rest ? { rest: expandAliases(type.rest, seen) } : {}),
      result: expandAliases(type.result, seen),
    };
    if (type.kind === "union") return { kind: "union", members: type.members.map((member) => expandAliases(member, seen)) };
    return type;
  };
  const resolve = (reference: TypeReference | null): ValueType => resolveNominals(expandAliases(reference ? resolveTypeReference(reference) : unknownType), classIdentities, enumNames, namedTypeIdentities);
  const resolveAnalyzed = (type: ValueType): ValueType => resolveNominals(expandAliases(type), classIdentities, enumNames, namedTypeIdentities);
  const resolvedAnalyzedBindings = new Map([...analyzedBindings]
    .map(([name, type]) => [name, resolveNominals(expandAliases(type), classIdentities, enumNames, namedTypeIdentities)]));
  const namedTypes = new Map<string, ReadonlyMap<string, ValueType>>();
  const typeAliases = new Map<string, ValueType>();
  const enums = new Map<string, EnumInfo>();
  const classes = new Map<string, ClassInfo>();
  const exports = new Map<string, ValueType>();
  const mutableExports = new Set<string>();
  const reactiveExports = new Map<string, "state" | "computed">();
  const inspectionExtensions = extensions.flatMap((extension) => extension.inspection ? [extension.inspection] : []);
  const testFunctions: string[] = [];
  const extensionExports = new Map(extensions.map((extension) => [extension.id, new Map<string, unknown>()] as const));
  const extensionData = new Map<string, unknown>();
  for (const extension of extensions) {
    const data = extension.inspection?.moduleData?.(program, path);
    if (data !== undefined) extensionData.set(extension.id, data);
  }

  for (const [name, declaration] of aliasDeclarations) typeAliases.set(name, resolve(declaration.target));

  for (const statement of program.body) {
    if (statement.kind === "TypeDeclaration") {
      namedTypes.set(statement.name, new Map(statement.fields.map((field) => [field.name, resolve(field.type)])));
    } else if (statement.kind === "EnumDeclaration") {
      enums.set(statement.name, enumNames.get(statement.name)!);
    } else if (statement.kind === "ClassDeclaration") {
      const fields = new Map([
        ...statement.parameters
          .filter((parameter) => parameter.binding && !parameter.private)
          .map((parameter) => [parameter.name, { mutable: parameter.binding === "let", type: resolve(parameter.type) }] as const),
        ...statement.fields
          .filter((field) => !field.static && !field.private)
          .map((field) => [field.name, { mutable: field.binding === "let", type: resolve(field.type) }] as const),
        ...statement.getters
          .filter((getter) => !getter.static && !getter.private)
          .map((getter) => [getter.name, { mutable: false, type: resolve(getter.returnType) }] as const),
      ]);
      const staticFields = new Map(statement.fields
        .filter((field) => field.static && !field.private)
        .map((field) => [field.name, { mutable: field.binding === "let", type: resolve(field.type) }] as const));
      for (const getter of statement.getters.filter((candidate) => candidate.static && !candidate.private)) {
        staticFields.set(getter.name, { mutable: false, type: resolve(getter.returnType) });
      }
      const methods = new Map(statement.methods.filter((method) => !method.static && !method.private).map((method) => [method.name, functionSignature(method, resolve)]));
      const staticMethods = new Map(statement.methods.filter((method) => method.static && !method.private).map((method) => [method.name, functionSignature(method, resolve)]));
      const identity = classIdentities.get(statement.name)!;
      classes.set(statement.name, {
        identity,
        parameters: statement.parameters.map((parameter) => resolve(parameter.type)),
        parameterNames: statement.parameters.map((parameter) => parameter.name),
        requiredParameters: statement.parameters.filter((parameter) => !parameter.defaultValue).length,
        base: statement.base ? classIdentities.get(statement.base.name) ?? statement.base.name : null,
        abstract: statement.abstract,
        fields,
        getters: new Set(statement.getters.filter((getter) => !getter.static && !getter.private).map((getter) => getter.name)),
        abstractGetters: new Set(statement.getters.filter((getter) => getter.abstract && !getter.private).map((getter) => getter.name)),
        methods,
        abstractMethods: new Set(statement.methods.filter((method) => method.abstract && !method.private).map((method) => method.name)),
        staticFields,
        staticGetters: new Set(statement.getters.filter((getter) => getter.static && !getter.private).map((getter) => getter.name)),
        staticMethods,
      });
      const analyzed = analyzedClasses.get(statement.name);
      if (analyzed) {
        classes.set(statement.name, {
          ...analyzed,
          identity,
          parameters: analyzed.parameters.map(resolveAnalyzed),
          ...(analyzed.constructorRest ? { constructorRest: resolveAnalyzed(analyzed.constructorRest) } : {}),
          base: analyzed.base ? classIdentities.get(analyzed.base) ?? analyzed.base : null,
          fields: new Map([...analyzed.fields].map(([name, field]) => [name, { ...field, type: resolveAnalyzed(field.type) }])),
          methods: new Map([...analyzed.methods].map(([name, type]) => [name, resolveAnalyzed(type)])),
          staticFields: new Map([...analyzed.staticFields].map(([name, field]) => [name, { ...field, type: resolveAnalyzed(field.type) }])),
          staticMethods: new Map([...analyzed.staticMethods].map(([name, type]) => [name, resolveAnalyzed(type)])),
        });
      }
    } else if (statement.kind === "FunctionDeclaration" && statement.name.startsWith("test_")) {
      testFunctions.push(statement.name);
    }
  }

  for (const statement of program.body) {
    if (!("exported" in statement) || !statement.exported) continue;
    if (statement.kind === "TypeDeclaration") {
      exports.set(statement.name, { kind: "typeObject", name: statement.name });
    } else if (statement.kind === "TypeAliasDeclaration") {
      exports.set(statement.name, { kind: "typeObject", name: statement.name });
    } else if (statement.kind === "EnumDeclaration") {
      const info = enums.get(statement.name)!;
      exports.set(statement.name, { kind: "enumObject", name: statement.name, identity: info.identity, members: info.members });
    } else if (statement.kind === "ClassDeclaration") {
      exports.set(statement.name, { kind: "classConstructor", name: statement.name, identity: classIdentities.get(statement.name)! });
    } else if (statement.kind === "FunctionDeclaration") {
      exports.set(statement.name, resolvedAnalyzedBindings.get(`${statement.span.start}:${statement.name}`) ?? functionSignature(statement, resolve));
    } else if (statement.kind === "VariableDeclaration") {
      exportPattern(
        statement.pattern,
        statement.type ? resolve(statement.type) : inferPublicExpression(statement.initializer, inspectionExtensions),
        exports,
        mutableExports,
        statement.binding === "let",
        namedTypes,
        resolvedAnalyzedBindings,
      );
    } else {
      for (const extension of extensions) {
        if (!extension.inspection) continue;
        const context = {
          exports,
          reactiveExports,
          extensionExports: extensionExports.get(extension.id)!,
          resolve,
          inferPublicExpression: (expression: Expression) => inferPublicExpression(expression, inspectionExtensions),
          bindingType: (name: string, spanStart: number) => resolvedAnalyzedBindings.get(`${spanStart}:${name}`) ?? null,
        };
        if (extension.inspection.contributeInterface?.(statement, context)) break;
      }
    }
  }
  return {
    exports,
    mutableExports,
    reactiveExports,
    namedTypes,
    namedTypeIdentities,
    typeAliases,
    enums,
    classes,
    testFunctions,
    extensionExports: new Map([...extensionExports].filter(([, values]) => values.size > 0)),
    extensionData,
  };
}

function functionSignature(statement: FunctionDeclaration, resolve: (reference: TypeReference | null) => ValueType): ValueType {
  const frame = new Map<string, ValueType>();
  for (const declaration of statement.typeParameters ?? []) {
    if (!frame.has(declaration.name)) frame.set(declaration.name, { kind: "parameter", name: declaration.name, index: frame.size });
  }
  const resolveBound = (reference: TypeReference | null): ValueType =>
    frame.size === 0 ? resolve(reference) : bindNamedTypeParameters(resolve(reference), frame);
  const result = statement.returnType ? resolveBound(statement.returnType) : nullType;
  const rest = statement.parameters.find((parameter) => parameter.rest);
  return {
    kind: "function",
    ...(frame.size > 0 ? { typeParameterNames: [...frame.keys()] } : {}),
    parameters: statement.parameters.filter((parameter) => !parameter.rest).map((parameter) => resolveBound(parameter.type)),
    parameterNames: statement.parameters.filter((parameter) => !parameter.rest).map((parameter) => parameter.name),
    requiredParameters: statement.parameters.filter((parameter) => !parameter.rest && !parameter.defaultValue).length,
    ...(rest ? { rest: resolveBound(rest.type) } : {}),
    result: statement.asynchronous ? { kind: "promise", value: resolvedAsyncType(result) } : result,
  };
}

function resolveNominals(
  type: ValueType,
  classIdentities: ReadonlyMap<string, string>,
  enumNames: ReadonlyMap<string, EnumInfo>,
  namedTypeIdentities: ReadonlyMap<string, string>,
): ValueType {
  if (type.kind === "named" && classIdentities.has(type.name)) {
    const identity = classIdentities.get(type.name)!;
    return {
      kind: "class",
      name: type.name,
      ...(identity === type.name ? {} : { identity }),
    };
  }
  if (type.kind === "named" && enumNames.has(type.name)) return { kind: "enum", name: type.name, identity: enumNames.get(type.name)!.identity };
  if (type.kind === "named" && namedTypeIdentities.has(type.name)) {
    return { ...type, identity: namedTypeIdentities.get(type.name)! };
  }
  if ((type.kind === "class" || type.kind === "classConstructor") && classIdentities.has(type.name)
    && (!type.identity || type.identity === type.name)) {
    return { ...type, identity: classIdentities.get(type.name)! };
  }
  if ((type.kind === "enum" || type.kind === "enumObject") && enumNames.has(type.name)
    && type.identity === type.name) {
    return { ...type, identity: enumNames.get(type.name)!.identity };
  }
  if (type.kind === "optional") return optionalOf(resolveNominals(type.inner, classIdentities, enumNames, namedTypeIdentities));
  if (type.kind === "list") return { ...type, element: resolveNominals(type.element, classIdentities, enumNames, namedTypeIdentities) };
  if (type.kind === "set") return { ...type, element: resolveNominals(type.element, classIdentities, enumNames, namedTypeIdentities) };
  if (type.kind === "map") return { ...type, key: resolveNominals(type.key, classIdentities, enumNames, namedTypeIdentities), value: resolveNominals(type.value, classIdentities, enumNames, namedTypeIdentities) };
  if (type.kind === "promise") return { kind: "promise", value: resolveNominals(type.value, classIdentities, enumNames, namedTypeIdentities) };
  if (type.kind === "object") return { ...type, fields: new Map([...type.fields].map(([name, value]) => [name, resolveNominals(value, classIdentities, enumNames, namedTypeIdentities)])) };
  if (type.kind === "function" || type.kind === "action" || type.kind === "intrinsic") return {
    ...type,
    parameters: type.parameters.map((parameter) => resolveNominals(parameter, classIdentities, enumNames, namedTypeIdentities)),
    ...(type.rest ? { rest: resolveNominals(type.rest, classIdentities, enumNames, namedTypeIdentities) } : {}),
    result: resolveNominals(type.result, classIdentities, enumNames, namedTypeIdentities),
  };
  if (type.kind === "union") return { kind: "union", members: type.members.map((member) => resolveNominals(member, classIdentities, enumNames, namedTypeIdentities)) };
  if (type.kind === "componentConstructor") return {
    ...type,
    props: new Map([...type.props].map(([name, value]) => [name, resolveNominals(value, classIdentities, enumNames, namedTypeIdentities)])),
  };
  return type;
}

function inferPublicExpression(expression: Expression, extensions: readonly NonNullable<CompilerExtension["inspection"]>[]): ValueType {
  for (const extension of extensions) {
    const inferred = extension.inferPublicExpression?.(expression);
    if (inferred) return inferred;
  }
  switch (expression.kind) {
    case "LiteralExpression":
      return expression.value === null ? nullType : typeof expression.value === "string" ? stringType : typeof expression.value === "number" ? numberType : boolType;
    case "FStringExpression":
      return stringType;
    case "ListExpression": {
      let element = unknownType;
      for (const item of expression.elements) {
        const type = inferPublicExpression(item.kind === "SpreadExpression" ? item.value : item, extensions);
        element = mergeTypes(element, item.kind === "SpreadExpression" && type.kind === "list" ? type.element : type);
      }
      return { kind: "list", element };
    }
    case "ObjectExpression": {
      const fields = new Map<string, ValueType>();
      const optionalFields = new Set<string>();
      for (const property of expression.properties) {
        if (property.kind === "ObjectProperty") {
          fields.set(property.name, inferPublicExpression(property.value, extensions));
          optionalFields.delete(property.name);
        }
        else {
          const spread = inferPublicExpression(property.value, extensions);
          if (spread.kind === "object") for (const [name, type] of spread.fields) {
            const alreadyRequired = fields.has(name) && !optionalFields.has(name);
            fields.set(name, type);
            if (!alreadyRequired && spread.optionalFields?.has(name)) optionalFields.add(name);
            else optionalFields.delete(name);
          }
        }
      }
      return { kind: "object", fields, ...(optionalFields.size > 0 ? { optionalFields } : {}) };
    }
    case "SpreadExpression":
      return inferPublicExpression(expression.value, extensions);
    default:
      return unknownType;
  }
}

function exportPattern(
  pattern: BindingPattern,
  type: ValueType,
  exports: Map<string, ValueType>,
  mutableExports: Set<string>,
  mutable: boolean,
  namedTypes: ReadonlyMap<string, ReadonlyMap<string, ValueType>>,
  analyzedBindings: ReadonlyMap<string, ValueType> = new Map(),
): void {
  if (pattern.kind === "NameBindingPattern") {
    exports.set(pattern.name, analyzedBindings.get(`${pattern.span.start}:${pattern.name}`) ?? type);
    if (mutable) mutableExports.add(pattern.name);
    return;
  }
  if (pattern.kind === "ListBindingPattern") {
    const element = type.kind === "list" ? type.element : unknownType;
    for (const child of pattern.elements) if (child) {
      exportPattern(child, element, exports, mutableExports, mutable, namedTypes, analyzedBindings);
    }
    if (pattern.rest) exports.set(
      pattern.rest.name,
      analyzedBindings.get(`${pattern.rest.span.start}:${pattern.rest.name}`) ?? { kind: "list", element },
    );
    if (pattern.rest && mutable) mutableExports.add(pattern.rest.name);
    return;
  }
  const fields = type.kind === "object" ? type.fields : type.kind === "named" ? namedTypes.get(type.name) : null;
  const selected = new Set(pattern.entries.map((entry) => entry.property));
  for (const entry of pattern.entries) {
    const field = fields?.get(entry.property) ?? unknownType;
    exportPattern(
      entry.pattern,
      type.kind === "object" && type.optionalFields?.has(entry.property) ? optionalOf(field) : field,
      exports,
      mutableExports,
      mutable,
      namedTypes,
      analyzedBindings,
    );
  }
  if (pattern.rest) {
    const optionalFields = type.kind === "object"
      ? new Set([...type.optionalFields ?? []].filter((name) => !selected.has(name)))
      : new Set<string>();
    exports.set(pattern.rest.name, analyzedBindings.get(`${pattern.rest.span.start}:${pattern.rest.name}`) ?? {
      kind: "object",
      fields: new Map([...(fields ?? [])].filter(([name]) => !selected.has(name))),
      ...(optionalFields.size > 0 ? { optionalFields } : {}),
    });
    if (mutable) mutableExports.add(pattern.rest.name);
  }
}
