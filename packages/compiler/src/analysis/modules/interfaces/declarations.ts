/**
 * What one module's declarations and exports publish: the five declaration
 * kinds, and the statements that carry an `export`.
 *
 * D115 §三: these were the two loops in the middle of `interfaceOf`, 226 lines
 * between them. Each kind writes disjoint tables, so the order between them is
 * the order of the statements and nothing else; within a kind, what is written
 * as declared is written first and whatever the analysis knows better replaces
 * it, exactly as the one function did it. The only edit the split required was
 * a `continue` becoming a `return` where a loop branch became a function.
 */
import { blockContainsDirectAwait, testFunctionName } from "../../../ast.ts";
import type { BindingPattern, Expression, Program, Statement } from "../../../ast.ts";
import { type ClassField } from "../../../contracts.ts";
import type { CompilerExtension, CompilerInterfaceContext } from "../../../extension.ts";
import { inferredResultPlaceholderType } from "../../functions.ts";
import {
  bindNamedTypeParameters,
  genericApplicationIdentity,
  isTypeParameterBound,
  optionalOf,
  unknownType,
  type ValueType,
} from "../../../types.ts";
import {
  functionSignature,
  inferPublicExpression,
  type AnalyzedModule,
  type InterfaceDraft,
  type InterfaceResolution,
  type ModuleIdentities,
} from "./tables.ts";

/**
 * Every declaration this module makes, in source order. The five kinds write
 * disjoint tables, so the order between them is the order of the statements and
 * nothing else.
 */
export function collectDeclarations(
  program: Program,
  identities: ModuleIdentities,
  resolution: InterfaceResolution,
  analyzedModule: AnalyzedModule,
  draft: InterfaceDraft,
): void {
  const { enumNames } = identities;
  const { enums, tests } = draft;
  for (const statement of program.body) {
    if (statement.kind === "TypeDeclaration") {
      collectTypeDeclaration(statement, identities, resolution, analyzedModule, draft);
    } else if (statement.kind === "EnumDeclaration") {
      enums.set(statement.name, enumNames.get(statement.name)!);
    } else if (statement.kind === "ClassDeclaration") {
      collectClassDeclaration(statement, identities, resolution, analyzedModule, draft);
    } else if (statement.kind === "ExternModuleDeclaration") {
      collectExternClasses(statement, resolution, analyzedModule, draft);
    } else if (statement.kind === "TestDeclaration") {
      tests.push({ name: testFunctionName(statement), title: statement.title });
    }
  }
}

/** One `type` record: its read-only fields, its base, and its fields or its template. */
function collectTypeDeclaration(
  statement: Extract<Statement, { kind: "TypeDeclaration" }>,
  identities: ModuleIdentities,
  resolution: InterfaceResolution,
  analyzedModule: AnalyzedModule,
  draft: InterfaceDraft,
): void {
  const { namedTypeIdentities } = identities;
  const { resolve, resolveAnalyzed } = resolution;
  const {
    namedTypes: analyzedNamedTypes,
    namedTypeReadonlyFields: analyzedNamedTypeReadonlyFields,
    namedTypeBases: analyzedNamedTypeBases,
    genericTypes: analyzedGenericTypes,
  } = analyzedModule;
  const { namedTypes, namedTypeReadonlyFields, namedTypeBases, genericTypes } = draft;
  const readonlyFields = new Set(analyzedNamedTypeReadonlyFields.get(statement.name)
    ?? statement.fields.filter((field) => field.readonly).map((field) => field.name));
  if (statement.base) {
    namedTypeBases.set(statement.name, resolveAnalyzed(
      analyzedNamedTypeBases.get(statement.name) ?? resolve(statement.base),
    ));
  }
  // D55 rule 120: a generic record crosses the boundary as a template. Its
  // field table still has the `parameter` kinds in it, which is what lets a
  // dependent instantiate it with an argument this module never named.
  if (statement.typeParameters?.length) {
    const frame = new Map<string, ValueType>(statement.typeParameters
      .map((parameter, index) => [parameter.name, { kind: "parameter", name: parameter.name, index }] as const));
    const analyzed = analyzedGenericTypes.get(statement.name);
    genericTypes.set(statement.name, {
      identity: namedTypeIdentities.get(statement.name)!,
      name: statement.name,
      parameterNames: statement.typeParameters.map((parameter) => parameter.name),
      parameterBounds: statement.typeParameters.map((parameter) =>
        parameter.bound && isTypeParameterBound(parameter.bound) ? parameter.bound : null),
      fields: analyzed
        ? new Map([...analyzed.fields].map(([name, type]) => [name, resolveAnalyzed(type)]))
        : new Map(statement.fields.map((field) => [field.name, bindNamedTypeParameters(resolve(field.type), frame)])),
      ...(readonlyFields.size > 0 ? { readonlyFields } : {}),
    });
    return;
  }
  const analyzed = analyzedNamedTypes.get(statement.name);
  namedTypes.set(statement.name, analyzed
    ? new Map([...analyzed].map(([name, type]) => [name, resolveAnalyzed(type)]))
    : new Map(statement.fields.map((field) => [field.name, resolve(field.type)])));
  if (readonlyFields.size > 0) namedTypeReadonlyFields.set(statement.name, readonlyFields);
}

/** One `class`: what it publishes as written, then whatever the analysis knows better. */
function collectClassDeclaration(
  statement: Extract<Statement, { kind: "ClassDeclaration" }>,
  identities: ModuleIdentities,
  resolution: InterfaceResolution,
  analyzedModule: AnalyzedModule,
  draft: InterfaceDraft,
): void {
  const { classIdentities } = identities;
  const { resolve, resolveAnalyzed, directAwaitExpression, directAwaitStatement } = resolution;
  const { classes: analyzedClasses } = analyzedModule;
  const { classes } = draft;
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
    // D43 item 69: the release contract crosses the module boundary with
    // the class, so an imported handle stays usable with `using`.
    ...(statement.dispose ? {
      dispose: blockContainsDirectAwait(statement.dispose.body, directAwaitExpression, directAwaitStatement) ? "async" : "sync",
    } as const : {}),
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
    const analyzedBaseApplication = analyzed.baseApplication
      ? {
        ...analyzed.baseApplication,
        declaration: classIdentities.get(analyzed.baseApplication.declaration) ?? analyzed.baseApplication.declaration,
        arguments: analyzed.baseApplication.arguments.map(resolveAnalyzed),
      }
      : undefined;
    classes.set(statement.name, {
      ...analyzed,
      identity,
      parameters: analyzed.parameters.map(resolveAnalyzed),
      ...(analyzed.constructorRest ? { constructorRest: resolveAnalyzed(analyzed.constructorRest) } : {}),
      // D68 rule 177: the iteration contract crosses the module boundary
      // with the class, so an imported Bag iterates in the importing module
      // exactly as it does in its own.
      ...(analyzed.iterate ? { iterate: resolveAnalyzed(analyzed.iterate) } : {}),
      // D55 rule 120 layer two: a generic base crosses as its parts, and its
      // key is recomputed from them — `Stack<number>` is a function of the
      // declaration identity and the arguments, not a name any table holds.
      ...(analyzedBaseApplication ? { baseApplication: analyzedBaseApplication } : {}),
      base: analyzedBaseApplication
        ? genericApplicationIdentity(analyzedBaseApplication.declaration, analyzedBaseApplication.arguments)
        : analyzed.base ? classIdentities.get(analyzed.base) ?? analyzed.base : null,
      fields: new Map([...analyzed.fields].map(([name, field]) => [name, { ...field, type: resolveAnalyzed(field.type) }])),
      methods: new Map([...analyzed.methods].map(([name, type]) => [name, resolveAnalyzed(type)])),
      staticFields: new Map([...analyzed.staticFields].map(([name, field]) => [name, { ...field, type: resolveAnalyzed(field.type) }])),
      staticMethods: new Map([...analyzed.staticMethods].map(([name, type]) => [name, resolveAnalyzed(type)])),
    });
  }
}

/**
 * Extern classes travel with the interface under their identity so a dependent
 * module that declares the same class for the same source can verify that both
 * declarations agree on one contract.
 */
function collectExternClasses(
  statement: Extract<Statement, { kind: "ExternModuleDeclaration" }>,
  resolution: InterfaceResolution,
  analyzedModule: AnalyzedModule,
  draft: InterfaceDraft,
): void {
  const { resolve, resolveAnalyzed } = resolution;
  const { classes: analyzedClasses } = analyzedModule;
  const { classes } = draft;
  // Extern classes travel with the interface under their identity so a
  // dependent module that declares the same class for the same source can
  // verify that both declarations agree on one contract.
  for (const declaration of statement.classes) {
    const identity = `js:${statement.source}#${declaration.name}`;
    const analyzed = analyzedClasses.get(identity);
    if (analyzed) {
      classes.set(identity, {
        ...analyzed,
        identity,
        parameters: analyzed.parameters.map(resolveAnalyzed),
        ...(analyzed.constructorRest ? { constructorRest: resolveAnalyzed(analyzed.constructorRest) } : {}),
        fields: new Map([...analyzed.fields].map(([name, field]) => [name, { ...field, type: resolveAnalyzed(field.type) }])),
        methods: new Map([...analyzed.methods].map(([name, type]) => [name, resolveAnalyzed(type)])),
        staticFields: new Map([...analyzed.staticFields].map(([name, field]) => [name, { ...field, type: resolveAnalyzed(field.type) }])),
        staticMethods: new Map([...analyzed.staticMethods].map(([name, type]) => [name, resolveAnalyzed(type)])),
      });
      continue;
    }
    const fields = new Map<string, ClassField>();
    const staticFields = new Map<string, ClassField>();
    for (const parameter of declaration.parameters) {
      if (parameter.binding) fields.set(parameter.name, { mutable: parameter.binding === "let", type: resolve(parameter.type) });
    }
    for (const field of declaration.fields) {
      (field.static ? staticFields : fields).set(field.name, { mutable: field.mutable, type: resolve(field.type) });
    }
    const getters = new Set<string>();
    const staticGetters = new Set<string>();
    for (const getter of declaration.getters) {
      (getter.static ? staticFields : fields).set(getter.name, { mutable: false, type: resolve(getter.type) });
      (getter.static ? staticGetters : getters).add(getter.name);
    }
    const methods = new Map<string, ValueType>();
    const staticMethods = new Map<string, ValueType>();
    for (const method of declaration.methods) {
      (method.static ? staticMethods : methods).set(method.name, functionSignature(method, resolve));
    }
    const rest = declaration.parameters.find((parameter) => parameter.rest);
    classes.set(identity, {
      identity,
      parameters: declaration.parameters.filter((parameter) => !parameter.rest).map((parameter) => resolve(parameter.type)),
      requiredParameters: declaration.parameters.filter((parameter) => !parameter.rest && !parameter.defaultValue).length,
      ...(rest ? { constructorRest: resolve(rest.type) } : {}),
      base: declaration.base ? `js:${statement.source}#${declaration.base}` : null,
      abstract: false,
      fields,
      getters,
      abstractGetters: new Set(),
      methods,
      abstractMethods: new Set(),
      staticFields,
      staticGetters,
      staticMethods,
    });
  }
}

/** Every exported statement, in source order, and what each one publishes. */
export function collectExports(
  program: Program,
  extensions: readonly CompilerExtension[],
  identities: ModuleIdentities,
  resolution: InterfaceResolution,
  draft: InterfaceDraft,
): void {
  const { classIdentities, namedTypeIdentities } = identities;
  const { resolve, resolvedAnalyzedBindings } = resolution;
  const {
    namedTypes, typeAliases, enums, exports, hoistedExports, mutableExports, reactiveExports,
    inspectionExtensions, extensionExports,
  } = draft;
  for (const statement of program.body) {
    if (!("exported" in statement) || !statement.exported) continue;
    if (statement.kind === "TypeDeclaration") {
      // D55 rule 126: a generic record's export is the instantiation factory,
      // not a Type object — it has no `is` of its own, so it carries no value
      // shape and the analyzer refuses to read it as one.
      exports.set(statement.name, statement.typeParameters?.length
        ? { kind: "typeObject", name: statement.name }
        : {
          kind: "typeObject",
          name: statement.name,
          value: {
            kind: "named",
            name: statement.name,
            identity: namedTypeIdentities.get(statement.name)!,
          },
        });
    } else if (statement.kind === "TypeAliasDeclaration") {
      exports.set(statement.name, { kind: "typeObject", name: statement.name, value: typeAliases.get(statement.name)! });
    } else if (statement.kind === "EnumDeclaration") {
      const info = enums.get(statement.name)!;
      exports.set(statement.name, { kind: "enumObject", name: statement.name, identity: info.identity, members: info.members });
    } else if (statement.kind === "ClassDeclaration") {
      exports.set(statement.name, { kind: "classConstructor", name: statement.name, identity: classIdentities.get(statement.name)! });
    } else if (statement.kind === "FunctionDeclaration") {
      exports.set(statement.name, resolvedAnalyzedBindings.get(`${statement.span.start}:${statement.name}`) ?? functionSignature(statement, resolve));
      // `def` emits a JavaScript function declaration, which the host
      // initializes at link time; `class`, `enum`, and `const`/`let` all emit
      // bindings that stay in their temporal dead zone until the module body
      // reaches them.
      hoistedExports.add(statement.name);
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
          unresolvedInferredResult: inferredResultPlaceholderType,
        };
        if (extension.inspection.contributeInterface?.(statement, context)) break;
      }
    }
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
