/**
 * The module interface: what one compiled module publishes to the modules that
 * import it — its exports and their types, its records, aliases, enums and
 * classes under the identities they keep across the boundary, its re-exports,
 * its tests, and whatever a target extension contributes.
 *
 * D115 §三: this was `interfaceOf` (404 lines) and its four helpers at the tail
 * of `index.ts`, which is the package's public API facade and should hold
 * `compile`, `inspectModule`, the result types and the re-exports. The assembly
 * is analysis, not API: it reads the AST and the analyzer's own tables and
 * decides what crosses a module boundary, so it belongs beside the file that
 * decides what crosses it in the other direction (`../imports.ts`) and the one
 * that checks what a module says it exports (`../exports.ts`).
 *
 * `interfaceOf` is an orchestration now. Its sections run in the order the one
 * function ran them — identities, then the resolvers, then the draft tables and
 * the extensions' module data, then the type aliases, then the declarations,
 * then the exports, then the re-exports — because each one writes tables the
 * next reads.
 */
import type { CompilerExtension, CompilerInterfaceContext, ModuleInterface, ModuleTest } from "../../../extension.ts";
import type { Expression, Program, Statement, TypeReference } from "../../../ast.ts";
import { type ClassInfo } from "../../../contracts.ts";
import { inferredResultPlaceholderType } from "../../functions.ts";
import {
  optionalOf,
  readonlyViewOf,
  resolveTypeReference,
  unknownType,
  type EnumInfo,
  type GenericTypeInfo,
  type ValueType,
} from "../../../types.ts";
import { collectDeclarations, collectExports } from "./declarations.ts";
import {
  inferPublicExpression,
  resolveNominals,
  type AnalyzedModule,
  type InterfaceDraft,
  type InterfaceResolution,
  type ModuleIdentities,
} from "./tables.ts";

export function interfaceOf(
  program: Program,
  path: string,
  extensions: readonly CompilerExtension[],
  analyzedBindings: ReadonlyMap<string, ValueType> = new Map(),
  analyzedClasses: ReadonlyMap<string, ClassInfo> = new Map(),
  analyzedNamedTypes: ReadonlyMap<string, ReadonlyMap<string, ValueType>> = new Map(),
  analyzedNamedTypeReadonlyFields: ReadonlyMap<string, ReadonlySet<string>> = new Map(),
  analyzedNamedTypeBases: ReadonlyMap<string, ValueType> = new Map(),
  analyzedGenericTypes: ReadonlyMap<string, GenericTypeInfo> = new Map(),
): ModuleInterface {
  const identities = moduleIdentities(program, path);
  const analyzedModule: AnalyzedModule = {
    classes: analyzedClasses,
    namedTypes: analyzedNamedTypes,
    namedTypeReadonlyFields: analyzedNamedTypeReadonlyFields,
    namedTypeBases: analyzedNamedTypeBases,
    genericTypes: analyzedGenericTypes,
  };
  const resolution = interfaceResolution(extensions, identities, analyzedBindings);
  const draft = interfaceDraft(program, path, extensions, resolution);
  const { namedTypeIdentities, aliasDeclarations } = identities;
  const { resolve } = resolution;
  const {
    namedTypes, namedTypeReadonlyFields, namedTypeBases, genericTypes, typeAliases, enums, classes,
    exports, hoistedExports, mutableExports, reactiveExports, tests, extensionExports, extensionData,
  } = draft;

  for (const [name, declaration] of aliasDeclarations) typeAliases.set(name, resolve(declaration.target));

  collectDeclarations(program, identities, resolution, analyzedModule, draft);

  collectExports(program, extensions, identities, resolution, draft);
  const reExports = new Map<string, { readonly source: string; readonly imported: string }>();
  for (const statement of program.body) {
    if (statement.kind !== "ReExportDeclaration") continue;
    for (const specifier of statement.specifiers) {
      reExports.set(specifier.exported, { source: statement.source, imported: specifier.imported });
    }
  }
  return {
    exports,
    hoistedExports,
    mutableExports,
    reactiveExports,
    reExports,
    namedTypes,
    namedTypeReadonlyFields,
    namedTypeIdentities,
    ...(namedTypeBases.size > 0 ? { namedTypeBases } : {}),
    ...(genericTypes.size > 0 ? { genericTypes } : {}),
    typeAliases,
    enums,
    classes,
    tests,
    extensionExports: new Map([...extensionExports].filter(([, values]) => values.size > 0)),
    extensionData,
  };
}

/** The identities this module's own declarations keep across every boundary. */
function moduleIdentities(program: Program, path: string): ModuleIdentities {
  const classIdentities = new Map<string, string>([["Error", "Error"]]);
  for (const statement of program.body) {
    if (statement.kind === "ClassDeclaration") classIdentities.set(statement.name, `velar:${path}#${statement.name}`);
  }
  // Extern classes are nominal per JavaScript source and class name, so
  // signatures that mention them stay nominal across module interfaces. A
  // Velar class declaration owns its bare name if both exist in one module.
  for (const statement of program.body) {
    if (statement.kind !== "ExternModuleDeclaration") continue;
    for (const declaration of statement.classes) {
      if (!classIdentities.has(declaration.name)) classIdentities.set(declaration.name, `js:${statement.source}#${declaration.name}`);
    }
  }
  const enumNames = new Map(program.body
    .filter((statement) => statement.kind === "EnumDeclaration")
    .map((statement) => [statement.name, {
      identity: `${path}#enum:${statement.name}`,
      members: new Set(statement.members.map((member) => member.name)),
      wireValues: new Map(statement.members.map((member) => [member.name, member.value])),
    }] satisfies [string, EnumInfo]));
  const namedTypeIdentities = new Map(program.body
    .filter((statement) => statement.kind === "TypeDeclaration")
    .map((statement) => [statement.name, `velar:${path}#type:${statement.name}`] satisfies [string, string]));
  const aliasDeclarations = new Map<string, Extract<Statement, { kind: "TypeAliasDeclaration" }>>();
  for (const statement of program.body) {
    if (statement.kind === "TypeAliasDeclaration") aliasDeclarations.set(statement.name, statement);
  }
  return { classIdentities, enumNames, namedTypeIdentities, aliasDeclarations };
}

/**
 * The resolvers, built once over one alias cache. Every extension hook they
 * consult is asked in extension order, exactly as the one function asked it.
 */
function interfaceResolution(
  extensions: readonly CompilerExtension[],
  identities: ModuleIdentities,
  analyzedBindings: ReadonlyMap<string, ValueType>,
): InterfaceResolution {
  const { classIdentities, enumNames, namedTypeIdentities, aliasDeclarations } = identities;
  const analysisExtensions = extensions.flatMap((extension) => extension.analysis ? [extension.analysis] : []);
  const directAwaitExpression = (
    expression: Expression,
    contains: (expression: Expression) => boolean,
  ): boolean | undefined => {
    for (const extension of analysisExtensions) {
      const result = extension.directAwaitExpression?.(expression, contains);
      if (result !== undefined) return result;
    }
    return undefined;
  };
  const directAwaitStatement = (
    statement: Statement,
    containsExpression: (expression: Expression) => boolean,
    containsBlock: (statements: readonly Statement[]) => boolean,
  ): boolean | undefined => {
    for (const extension of analysisExtensions) {
      const result = extension.directAwaitStatement?.(statement, containsExpression, containsBlock);
      if (result !== undefined) return result;
    }
    return undefined;
  };
  const resolveRaw = (reference: TypeReference): ValueType => resolveTypeReference(reference, (syntax, nested) => {
    for (const extension of analysisExtensions) {
      const resolved = extension.resolveTypeSyntax?.(syntax, nested);
      if (resolved) return resolved;
    }
    return undefined;
  });
  const aliasCache = new Map<string, ValueType>();
  const expandAliases = (type: ValueType, seen: ReadonlySet<string> = new Set()): ValueType => {
    if (type.kind === "named" && aliasDeclarations.has(type.name)) {
      if (seen.has(type.name)) return unknownType;
      const cached = aliasCache.get(type.name);
      if (cached) return type.readonlyView ? readonlyViewOf(cached) : cached;
      const declaration = aliasDeclarations.get(type.name)!;
      const expanded = expandAliases(resolveRaw(declaration.target), new Set([...seen, type.name]));
      aliasCache.set(type.name, expanded);
      return type.readonlyView ? readonlyViewOf(expanded) : expanded;
    }
    // D55 rule 121: an alias inside a type argument is transparent here too,
    // so the interface publishes the same instantiation identity the analyzer
    // computed for the body.
    if (type.kind === "named" && type.application) {
      return { ...type, application: { ...type.application, arguments: type.application.arguments.map((argument) => expandAliases(argument, seen)) } };
    }
    if (type.kind === "optional") return optionalOf(expandAliases(type.inner, seen));
    if (type.kind === "list") return { ...type, element: expandAliases(type.element, seen) };
    if (type.kind === "set") return { ...type, element: expandAliases(type.element, seen) };
    if (type.kind === "map") return { ...type, key: expandAliases(type.key, seen), value: expandAliases(type.value, seen) };
    if (type.kind === "record") return { ...type, value: expandAliases(type.value, seen) };
    if (type.kind === "promise") return { kind: "promise", value: expandAliases(type.value, seen) };
    if (type.kind === "runtimeType") return { kind: "runtimeType", value: expandAliases(type.value, seen) };
    if (type.kind === "typeObject") return type.value ? { ...type, value: expandAliases(type.value, seen) } : type;
    if (type.kind === "object") return { ...type, fields: new Map([...type.fields].map(([name, value]) => [name, expandAliases(value, seen)])) };
    if (type.kind === "extension") {
      return {
        ...type,
        properties: new Map([...type.properties].map(([name, value]) => [name, expandAliases(value, seen)])),
        arguments: type.arguments.map((argument) => expandAliases(argument, seen)),
      };
    }
    if (type.kind === "function" || type.kind === "action" || type.kind === "intrinsic") return {
      ...type,
      parameters: type.parameters.map((parameter) => expandAliases(parameter, seen)),
      ...(type.rest ? { rest: expandAliases(type.rest, seen) } : {}),
      result: expandAliases(type.result, seen),
    };
    if (type.kind === "union") return { kind: "union", members: type.members.map((member) => expandAliases(member, seen)) };
    return type;
  };
  const resolve = (reference: TypeReference | null): ValueType => resolveNominals(expandAliases(reference ? resolveRaw(reference) : unknownType), classIdentities, enumNames, namedTypeIdentities);
  const resolveAnalyzed = (type: ValueType): ValueType => resolveNominals(expandAliases(type), classIdentities, enumNames, namedTypeIdentities);
  const resolvedAnalyzedBindings = new Map([...analyzedBindings]
    .map(([name, type]) => [name, resolveNominals(expandAliases(type), classIdentities, enumNames, namedTypeIdentities)]));
  return { resolve, resolveAnalyzed, resolvedAnalyzedBindings, directAwaitExpression, directAwaitStatement };
}

/**
 * The empty tables, and the extensions' own module data and export
 * annotations, which are collected before any declaration is read because an
 * annotation may name an export the declaration loop is about to define.
 */
function interfaceDraft(
  program: Program,
  path: string,
  extensions: readonly CompilerExtension[],
  resolution: InterfaceResolution,
): InterfaceDraft {
  const { resolve, resolvedAnalyzedBindings } = resolution;
  const namedTypes = new Map<string, ReadonlyMap<string, ValueType>>();
  const namedTypeReadonlyFields = new Map<string, ReadonlySet<string>>();
  const namedTypeBases = new Map<string, ValueType>();
  const genericTypes = new Map<string, GenericTypeInfo>();
  const typeAliases = new Map<string, ValueType>();
  const enums = new Map<string, EnumInfo>();
  const classes = new Map<string, ClassInfo>();
  const exports = new Map<string, ValueType>();
  const hoistedExports = new Set<string>();
  const mutableExports = new Set<string>();
  const reactiveExports = new Map<string, "state">();
  const inspectionExtensions = extensions.flatMap((extension) => extension.inspection ? [extension.inspection] : []);
  const tests: ModuleTest[] = [];
  const extensionExports = new Map(extensions.map((extension) => [extension.id, new Map<string, unknown>()] as const));
  const extensionData = new Map<string, unknown>();
  for (const extension of extensions) {
    const data = extension.inspection?.moduleData?.(program, path);
    if (data !== undefined) extensionData.set(extension.id, data);
    const context: CompilerInterfaceContext = {
      exports,
      reactiveExports,
      extensionExports: extensionExports.get(extension.id)!,
      resolve,
      inferPublicExpression: (expression: Expression) => inferPublicExpression(expression, inspectionExtensions),
      bindingType: (name: string, spanStart: number) => resolvedAnalyzedBindings.get(`${spanStart}:${name}`) ?? null,
      unresolvedInferredResult: inferredResultPlaceholderType,
    };
    const annotations = extension.inspection?.exportAnnotations?.(program, context);
    if (annotations) {
      const values = extensionExports.get(extension.id)!;
      for (const [name, value] of annotations) values.set(name, value);
    }
  }
  return {
    namedTypes, namedTypeReadonlyFields, namedTypeBases, genericTypes, typeAliases, enums, classes,
    exports, hoistedExports, mutableExports, reactiveExports, inspectionExtensions, tests,
    extensionExports, extensionData,
  };
}
