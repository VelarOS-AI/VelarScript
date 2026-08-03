import { Analyzer, type AnalysisContext, type ClassInfo } from "./analyzer.ts";
import type { BindingPattern, Expression, FunctionDeclaration, Program, Statement, TypeReference } from "./ast.ts";
import { diagnostic, type Diagnostic } from "./diagnostic.ts";
import { JavaScriptEmitter } from "./emitter.ts";
import type { CompilerEmitter, CompilerExtension, ModuleInterface } from "./extension.ts";
import { Lexer } from "./lexer.ts";
import { Parser } from "./parser.ts";
import { SourceText } from "./source.ts";
import { buildSemanticIndex, type SemanticIndex } from "./semantic.ts";
import { MAX_VELAR_SOURCE_CODE_UNITS } from "./limits.ts";
import {
  boolType,
  mergeTypes,
  noneType,
  numberType,
  parseType,
  resolvedAsyncType,
  stringType,
  unknownType,
  type EnumInfo,
  type ValueType,
} from "./types.ts";

export { formatDiagnostic, type Diagnostic } from "./diagnostic.ts";
export { formatSource } from "./formatter.ts";
export { SourceText, type Span } from "./source.ts";
export { MAX_VELAR_SOURCE_CODE_UNITS } from "./limits.ts";
export type { CompilerAnalysisExtension, CompilerAnalyzerFactory, CompilerDependencyContext, CompilerEditorCompletion, CompilerEditorExtension, CompilerEmitter, CompilerExtension, CompilerInspectionExtension, CompilerInterfaceContext, CompilerIntrinsicAnalysisContext, CompilerLexicalExtension, CompilerModuleExtension, CompilerParserFactory, CompilerProjectEditorCompletion, CompilerProjectEditorCompletionContext, CompilerProjectEditorCompletionResult, CompilerProjectEditorExtension, CompilerProjectEditorRenameContext, ModuleInterface } from "./extension.ts";
export { semanticImportAt, semanticModuleReferenceAt, semanticSymbolAt, semanticVisibleSymbolsAt, type CompilerSemanticExtension, type SemanticDeclareOptions, type SemanticExpression, type SemanticExtensionContext, type SemanticFunctionLike, type SemanticImport, type SemanticIndex, type SemanticMember, type SemanticMemberReference, type SemanticModuleReference, type SemanticReference, type SemanticScope, type SemanticSymbol, type SemanticSymbolKind } from "./semantic.ts";
export { describeType, type EnumInfo, type ValueType } from "./types.ts";
export type { AnalysisContext, ClassField, ClassInfo } from "./analyzer.ts";

export interface CompileOptions {
  readonly path?: string;
  readonly analysis?: AnalysisContext;
  readonly exportFunctions?: ReadonlySet<string>;
  readonly extensions?: readonly CompilerExtension[];
}

export interface CompileResult {
  readonly code: string | null;
  readonly sourceMap: string | null;
  readonly css: string | null;
  readonly extensions: readonly string[];
  readonly diagnostics: readonly Diagnostic[];
  readonly source: SourceText;
  readonly dependencies: readonly ModuleDependency[];
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
  const analyzer = analyzerExtensions[0]?.analyzer?.create(options.analysis ?? {}, analysisExtensions)
    ?? new Analyzer(options.analysis, analysisExtensions);
  if (diagnostics.length === 0) {
    diagnostics.push(...analyzer.analyze(parsed.program));
  }

  diagnostics.sort((left, right) => left.span.start - right.span.start || left.code.localeCompare(right.code));
  const emitterExtensions = extensions.filter((extension) => extension.createEmitter);
  if (emitterExtensions.length > 1) throw new Error("Only one compiler extension may own JavaScript emission");
  const emitter: CompilerEmitter = emitterExtensions[0]?.createEmitter?.(analyzer.loweringHints(), options.exportFunctions ?? new Set())
    ?? new JavaScriptEmitter(analyzer.loweringHints(), options.exportFunctions);
  const code = diagnostics.length === 0 ? emitter.emit(parsed.program) : null;
  const sourceMap = code === null ? null : emitter.sourceMap(parsed.source);
  const css = code === null ? null : emitter.css?.() ?? null;
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
    extensions: extensions.map((extension) => extension.id),
    diagnostics,
    source: parsed.source,
    dependencies: dependenciesOf(parsed.program, extensions),
    moduleInterface: interfaceOf(parsed.program, parsed.source.path, extensions),
    semanticIndex,
  };
}

function parseModule(text: string, path: string, extensions: readonly CompilerExtension[]): { source: SourceText; program: Program; diagnostics: readonly Diagnostic[] } {
  if (text.length > MAX_VELAR_SOURCE_CODE_UNITS) {
    const source = new SourceText(path, text, false);
    return {
      source,
      program: { kind: "Program", body: [], span: { start: 0, end: 0 } },
      diagnostics: [diagnostic(
        "VEL1003",
        `A Velar source module cannot exceed ${MAX_VELAR_SOURCE_CODE_UNITS / 1024 / 1024} MiB`,
        { start: 0, end: Math.min(1, text.length) },
      )],
    };
  }
  const source = new SourceText(path, text);
  try {
    const lexicalExtensions = extensions.flatMap((extension) => extension.lexical ? [extension.lexical] : []);
    const lexed = new Lexer(text, lexicalExtensions).lex();
    const parserExtensions = extensions.filter((extension) => extension.parser);
    if (parserExtensions.length > 1) throw new Error("Only one compiler extension may own syntax parsing");
    const parser = parserExtensions[0]?.parser?.create(lexed.tokens, lexicalExtensions)
      ?? new Parser(lexed.tokens, lexicalExtensions);
    const parsed = parser.parse();
    return { source, program: parsed.program, diagnostics: [...lexed.diagnostics, ...parsed.diagnostics] };
  } catch (error) {
    if (!(error instanceof RangeError)) throw error;
    return {
      source,
      program: { kind: "Program", body: [], span: { start: 0, end: 0 } },
      diagnostics: [diagnostic("VEL2008", "Velar source nesting is too complex to parse safely", { start: 0, end: Math.min(1, text.length) })],
    };
  }
}

function normalizedExtensions(extensions: readonly CompilerExtension[]): readonly CompilerExtension[] {
  const seen = new Set<string>();
  const capabilities = new Set<string>();
  for (const extension of extensions) {
    if (!extension.id || seen.has(extension.id)) throw new Error(`Compiler extension '${extension.id}' is invalid or duplicated`);
    seen.add(extension.id);
    for (const capability of extension.capabilities ?? []) {
      if (!/^[a-z][a-z0-9-]*$/u.test(capability) || capabilities.has(capability)) {
        throw new Error(`Compiler capability '${capability}' is invalid or has more than one owner`);
      }
      capabilities.add(capability);
    }
  }
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
  const visitStatement = (statement: Statement): void => {
    for (const extension of dependencyExtensions) if (extension.visitDependencyStatement?.(statement, dependencyContext)) return;
    switch (statement.kind) {
      case "ClassDeclaration":
        if (statement.base) for (const argument of statement.base.arguments) visitExpression(argument);
        for (const parameter of statement.parameters) if (parameter.defaultValue) visitExpression(parameter.defaultValue);
        for (const field of statement.fields) visitExpression(field.initializer);
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
        for (const branch of statement.cases) visitBlock(branch.body);
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

function interfaceOf(program: Program, path: string, extensions: readonly CompilerExtension[]): ModuleInterface {
  const classIdentities = new Map<string, string>([["Error", "Error"]]);
  for (const statement of program.body) {
    if (statement.kind === "ClassDeclaration") classIdentities.set(statement.name, `velar:${path}#${statement.name}`);
  }
  const enumNames = new Map(program.body
    .filter((statement) => statement.kind === "EnumDeclaration")
    .map((statement) => [statement.name, { identity: `${path}#enum:${statement.name}`, members: new Set(statement.members.map((member) => member.name)) }] satisfies [string, EnumInfo]));
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
      const expanded = expandAliases(parseType(declaration.target.text), new Set([...seen, type.name]));
      aliasCache.set(type.name, expanded);
      return expanded;
    }
    if (type.kind === "optional") return { kind: "optional", inner: expandAliases(type.inner, seen) };
    if (type.kind === "list") return { kind: "list", element: expandAliases(type.element, seen) };
    if (type.kind === "set") return { kind: "set", element: expandAliases(type.element, seen) };
    if (type.kind === "map") return { kind: "map", key: expandAliases(type.key, seen), value: expandAliases(type.value, seen) };
    if (type.kind === "promise") return { kind: "promise", value: expandAliases(type.value, seen) };
    if (type.kind === "object") return { kind: "object", fields: new Map([...type.fields].map(([name, value]) => [name, expandAliases(value, seen)])) };
    if (type.kind === "function" || type.kind === "action" || type.kind === "intrinsic") return {
      ...type,
      parameters: type.parameters.map((parameter) => expandAliases(parameter, seen)),
      ...(type.rest ? { rest: expandAliases(type.rest, seen) } : {}),
      result: expandAliases(type.result, seen),
    };
    if (type.kind === "union") return { kind: "union", members: type.members.map((member) => expandAliases(member, seen)) };
    return type;
  };
  const resolve = (reference: TypeReference | null): ValueType => resolveNominals(expandAliases(reference ? parseType(reference.text) : unknownType), classIdentities, enumNames);
  const namedTypes = new Map<string, ReadonlyMap<string, ValueType>>();
  const typeAliases = new Map<string, ValueType>();
  const enums = new Map<string, EnumInfo>();
  const classes = new Map<string, ClassInfo>();
  const exports = new Map<string, ValueType>();
  const reactiveExports = new Map<string, "state" | "computed">();
  const inspectionExtensions = extensions.flatMap((extension) => extension.inspection ? [extension.inspection] : []);
  const testFunctions: string[] = [];

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
      exports.set(statement.name, functionSignature(statement, resolve));
    } else if (statement.kind === "VariableDeclaration") {
      exportPattern(statement.pattern, statement.type ? resolve(statement.type) : inferPublicExpression(statement.initializer, inspectionExtensions), exports, namedTypes);
    } else {
      const context = {
        exports,
        reactiveExports,
        resolve,
        inferPublicExpression: (expression: Expression) => inferPublicExpression(expression, inspectionExtensions),
      };
      for (const extension of inspectionExtensions) if (extension.contributeInterface?.(statement, context)) break;
    }
  }
  return { exports, reactiveExports, namedTypes, typeAliases, enums, classes, testFunctions };
}

function functionSignature(statement: FunctionDeclaration, resolve: (reference: TypeReference | null) => ValueType): ValueType {
  const result = statement.returnType ? resolve(statement.returnType) : noneType;
  const rest = statement.parameters.find((parameter) => parameter.rest);
  return {
    kind: "function",
    parameters: statement.parameters.filter((parameter) => !parameter.rest).map((parameter) => resolve(parameter.type)),
    requiredParameters: statement.parameters.filter((parameter) => !parameter.rest && !parameter.defaultValue).length,
    ...(rest ? { rest: resolve(rest.type) } : {}),
    result: statement.asynchronous ? { kind: "promise", value: resolvedAsyncType(result) } : result,
  };
}

function resolveNominals(type: ValueType, classIdentities: ReadonlyMap<string, string>, enumNames: ReadonlyMap<string, EnumInfo>): ValueType {
  if (type.kind === "named" && classIdentities.has(type.name)) {
    const identity = classIdentities.get(type.name)!;
    return { kind: "class", name: type.name, ...(identity === type.name ? {} : { identity }) };
  }
  if (type.kind === "named" && enumNames.has(type.name)) return { kind: "enum", name: type.name, identity: enumNames.get(type.name)!.identity };
  if (type.kind === "optional") return { kind: "optional", inner: resolveNominals(type.inner, classIdentities, enumNames) };
  if (type.kind === "list") return { kind: "list", element: resolveNominals(type.element, classIdentities, enumNames) };
  if (type.kind === "set") return { kind: "set", element: resolveNominals(type.element, classIdentities, enumNames) };
  if (type.kind === "map") return { kind: "map", key: resolveNominals(type.key, classIdentities, enumNames), value: resolveNominals(type.value, classIdentities, enumNames) };
  if (type.kind === "promise") return { kind: "promise", value: resolveNominals(type.value, classIdentities, enumNames) };
  if (type.kind === "function" || type.kind === "action" || type.kind === "intrinsic") return {
    ...type,
    parameters: type.parameters.map((parameter) => resolveNominals(parameter, classIdentities, enumNames)),
    ...(type.rest ? { rest: resolveNominals(type.rest, classIdentities, enumNames) } : {}),
    result: resolveNominals(type.result, classIdentities, enumNames),
  };
  if (type.kind === "union") return { kind: "union", members: type.members.map((member) => resolveNominals(member, classIdentities, enumNames)) };
  return type;
}

function inferPublicExpression(expression: Expression, extensions: readonly NonNullable<CompilerExtension["inspection"]>[]): ValueType {
  for (const extension of extensions) {
    const inferred = extension.inferPublicExpression?.(expression);
    if (inferred) return inferred;
  }
  switch (expression.kind) {
    case "LiteralExpression":
      return expression.value === null ? noneType : typeof expression.value === "string" ? stringType : typeof expression.value === "number" ? numberType : boolType;
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
      for (const property of expression.properties) {
        if (property.kind === "ObjectProperty") fields.set(property.name, inferPublicExpression(property.value, extensions));
        else {
          const spread = inferPublicExpression(property.value, extensions);
          if (spread.kind === "object") for (const [name, type] of spread.fields) fields.set(name, type);
        }
      }
      return { kind: "object", fields };
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
  namedTypes: ReadonlyMap<string, ReadonlyMap<string, ValueType>>,
): void {
  if (pattern.kind === "NameBindingPattern") {
    exports.set(pattern.name, type);
    return;
  }
  if (pattern.kind === "ListBindingPattern") {
    const element = type.kind === "list" ? type.element : unknownType;
    for (const child of pattern.elements) if (child) exportPattern(child, element, exports, namedTypes);
    if (pattern.rest) exports.set(pattern.rest.name, { kind: "list", element });
    return;
  }
  const fields = type.kind === "object" ? type.fields : type.kind === "named" ? namedTypes.get(type.name) : null;
  const selected = new Set(pattern.entries.map((entry) => entry.property));
  for (const entry of pattern.entries) exportPattern(entry.pattern, fields?.get(entry.property) ?? unknownType, exports, namedTypes);
  if (pattern.rest) exports.set(pattern.rest.name, {
    kind: "object",
    fields: new Map([...(fields ?? [])].filter(([name]) => !selected.has(name))),
  });
}
