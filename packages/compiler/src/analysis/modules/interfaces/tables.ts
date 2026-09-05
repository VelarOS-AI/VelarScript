/**
 * The records the module-interface assembly threads through its sections, and
 * the three mappings every section applies to a type on its way out of the
 * module.
 *
 * D115 §三: `resolveNominals`, `functionSignature` and `inferPublicExpression`
 * were three helpers at the tail of `index.ts`, read by both halves of the
 * assembly. They are the leaf of this directory: nothing here reads a draft or
 * writes one, so `./assembly.ts` and `./declarations.ts` both depend on it and
 * it depends on neither.
 */
import type { Expression, FunctionDeclaration, Statement, TypeReference } from "../../../ast.ts";
import { type ClassInfo } from "../../../contracts.ts";
import type { CompilerExtension, ModuleTest } from "../../../extension.ts";
import { inferredResultPlaceholderType } from "../../functions.ts";
import {
  bindNamedTypeParameters,
  boolType,
  classApplicationType,
  genericApplicationType,
  invalidType,
  isTypeParameterBound,
  mergeTypes,
  nullType,
  numberType,
  optionalOf,
  readonlyViewOf,
  resolvedAsyncType,
  stringType,
  unknownType,
  type EnumInfo,
  type GenericTypeInfo,
  type TypeParameterBound,
  type ValueType,
} from "../../../types.ts";

/** The nominal identities a module publishes its own declarations under. */
export interface ModuleIdentities {
  readonly classIdentities: Map<string, string>;
  readonly enumNames: Map<string, EnumInfo>;
  readonly namedTypeIdentities: Map<string, string>;
  readonly aliasDeclarations: Map<string, Extract<Statement, { kind: "TypeAliasDeclaration" }>>;
}

/**
 * The resolvers every section reads a type through: `resolve` for a written
 * type reference, `resolveAnalyzed` for a type the analyzer already produced,
 * and the two await probes a class's `@dispose:` is classified with. They close
 * over one alias cache, so they are built once and shared rather than rebuilt
 * per declaration.
 */
export interface InterfaceResolution {
  readonly resolve: (reference: TypeReference | null) => ValueType;
  readonly resolveAnalyzed: (type: ValueType) => ValueType;
  readonly resolvedAnalyzedBindings: Map<string, ValueType>;
  readonly directAwaitExpression: (
    expression: Expression,
    contains: (expression: Expression) => boolean,
  ) => boolean | undefined;
  readonly directAwaitStatement: (
    statement: Statement,
    containsExpression: (expression: Expression) => boolean,
    containsBlock: (statements: readonly Statement[]) => boolean,
  ) => boolean | undefined;
}

/** The tables the assembly fills in, in the order the one function filled them. */
export interface InterfaceDraft {
  readonly namedTypes: Map<string, ReadonlyMap<string, ValueType>>;
  readonly namedTypeReadonlyFields: Map<string, ReadonlySet<string>>;
  readonly namedTypeBases: Map<string, ValueType>;
  readonly genericTypes: Map<string, GenericTypeInfo>;
  readonly typeAliases: Map<string, ValueType>;
  readonly enums: Map<string, EnumInfo>;
  readonly classes: Map<string, ClassInfo>;
  readonly exports: Map<string, ValueType>;
  readonly hoistedExports: Set<string>;
  readonly mutableExports: Set<string>;
  readonly reactiveExports: Map<string, "state">;
  readonly inspectionExtensions: readonly NonNullable<CompilerExtension["inspection"]>[];
  readonly tests: ModuleTest[];
  readonly extensionExports: Map<string, Map<string, unknown>>;
  readonly extensionData: Map<string, unknown>;
}

/**
 * What the analyzer already worked out for this module, when it ran. An
 * interface built without an analysis (`inspectModule`) passes empty tables and
 * every section falls back to what the declaration itself says.
 */
export interface AnalyzedModule {
  readonly classes: ReadonlyMap<string, ClassInfo>;
  readonly namedTypes: ReadonlyMap<string, ReadonlyMap<string, ValueType>>;
  readonly namedTypeReadonlyFields: ReadonlyMap<string, ReadonlySet<string>>;
  readonly namedTypeBases: ReadonlyMap<string, ValueType>;
  readonly genericTypes: ReadonlyMap<string, GenericTypeInfo>;
}

export function functionSignature(
  statement: Pick<FunctionDeclaration, "typeParameters" | "parameters" | "returnType" | "asynchronous">,
  resolve: (reference: TypeReference | null) => ValueType,
): ValueType {
  const frame = new Map<string, ValueType>();
  // D41 item 61 risk 4: this is the cross-module export interface. A bound
  // dropped here would silently disappear from every imported generic.
  const bounds: (TypeParameterBound | null)[] = [];
  for (const declaration of statement.typeParameters ?? []) {
    if (frame.has(declaration.name)) continue;
    frame.set(declaration.name, { kind: "parameter", name: declaration.name, index: frame.size });
    bounds.push(declaration.bound && isTypeParameterBound(declaration.bound) ? declaration.bound : null);
  }
  const boundVector = bounds.some((bound) => bound !== null) ? bounds : null;
  const resolveBound = (reference: TypeReference | null): ValueType =>
    frame.size === 0 ? resolve(reference) : bindNamedTypeParameters(resolve(reference), frame);
  const result = statement.returnType
    ? resolveBound(statement.returnType)
    : "abstract" in statement && statement.abstract === true ? invalidType : inferredResultPlaceholderType;
  const rest = statement.parameters.find((parameter) => parameter.rest);
  return {
    kind: "function",
    ...(frame.size > 0 ? { typeParameterNames: [...frame.keys()] } : {}),
    ...(frame.size > 0 && boundVector ? { typeParameterBounds: boundVector } : {}),
    parameters: statement.parameters.filter((parameter) => !parameter.rest).map((parameter) => resolveBound(parameter.type)),
    parameterNames: statement.parameters.filter((parameter) => !parameter.rest).map((parameter) => parameter.name),
    requiredParameters: statement.parameters.filter((parameter) => !parameter.rest && !parameter.defaultValue).length,
    ...(rest ? { rest: resolveBound(rest.type) } : {}),
    result: statement.asynchronous ? { kind: "promise", value: resolvedAsyncType(result) } : result,
  };
}

export function resolveNominals(
  type: ValueType,
  classIdentities: ReadonlyMap<string, string>,
  enumNames: ReadonlyMap<string, EnumInfo>,
  namedTypeIdentities: ReadonlyMap<string, string>,
): ValueType {
  // D55 rule 121: the interface is where a module's local names become the
  // identities its dependents see, and an application has to make that crossing
  // whole — the declaration *and* every argument — or the two sides of the
  // boundary would compute two different instantiation identities for one type.
  if (type.kind === "named" && type.application) {
    const arguments_ = type.application.arguments.map((argument) => resolveNominals(argument, classIdentities, enumNames, namedTypeIdentities));
    const declaration = namedTypeIdentities.get(type.application.name) ?? type.application.declaration;
    return genericApplicationType(declaration, type.application.name, arguments_, type.readonlyView === true);
  }
  // D55 rule 120 layer two: a class application makes the same crossing a
  // record application makes — declaration identity and every argument — so the
  // two sides of the boundary compute one instantiation identity for it.
  if (type.kind === "class" && type.application) {
    const arguments_ = type.application.arguments.map((argument) => resolveNominals(argument, classIdentities, enumNames, namedTypeIdentities));
    const declaration = classIdentities.get(type.application.name) ?? type.application.declaration;
    return classApplicationType(declaration, type.application.name, arguments_);
  }
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
  if ((type.kind === "enum" || type.kind === "enumMember" || type.kind === "enumObject") && enumNames.has(type.name)
    && type.identity === type.name) {
    return { ...type, identity: enumNames.get(type.name)!.identity };
  }
  if (type.kind === "optional") return optionalOf(resolveNominals(type.inner, classIdentities, enumNames, namedTypeIdentities));
  if (type.kind === "list") return { ...type, element: resolveNominals(type.element, classIdentities, enumNames, namedTypeIdentities) };
  if (type.kind === "set") return { ...type, element: resolveNominals(type.element, classIdentities, enumNames, namedTypeIdentities) };
  if (type.kind === "map") return { ...type, key: resolveNominals(type.key, classIdentities, enumNames, namedTypeIdentities), value: resolveNominals(type.value, classIdentities, enumNames, namedTypeIdentities) };
  if (type.kind === "record") return { ...type, value: resolveNominals(type.value, classIdentities, enumNames, namedTypeIdentities) };
  if (type.kind === "promise") return { kind: "promise", value: resolveNominals(type.value, classIdentities, enumNames, namedTypeIdentities) };
  if (type.kind === "runtimeType") return { kind: "runtimeType", value: resolveNominals(type.value, classIdentities, enumNames, namedTypeIdentities) };
  if (type.kind === "typeObject") return type.value
    ? { ...type, value: resolveNominals(type.value, classIdentities, enumNames, namedTypeIdentities) }
    : type;
  if (type.kind === "object") return { ...type, fields: new Map([...type.fields].map(([name, value]) => [name, resolveNominals(value, classIdentities, enumNames, namedTypeIdentities)])) };
  if (type.kind === "function" || type.kind === "action" || type.kind === "intrinsic") return {
    ...type,
    parameters: type.parameters.map((parameter) => resolveNominals(parameter, classIdentities, enumNames, namedTypeIdentities)),
    ...(type.rest ? { rest: resolveNominals(type.rest, classIdentities, enumNames, namedTypeIdentities) } : {}),
    result: resolveNominals(type.result, classIdentities, enumNames, namedTypeIdentities),
  };
  if (type.kind === "union") return { kind: "union", members: type.members.map((member) => resolveNominals(member, classIdentities, enumNames, namedTypeIdentities)) };
  if (type.kind === "extension") return {
    ...type,
    properties: new Map([...type.properties].map(([name, value]) => [name, resolveNominals(value, classIdentities, enumNames, namedTypeIdentities)])),
    arguments: type.arguments.map((argument) => resolveNominals(argument, classIdentities, enumNames, namedTypeIdentities)),
  };
  return type;
}

export function inferPublicExpression(expression: Expression, extensions: readonly NonNullable<CompilerExtension["inspection"]>[]): ValueType {
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
