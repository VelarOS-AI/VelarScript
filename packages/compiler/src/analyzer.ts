import type {
  ArrowFunctionExpression,
  AssignmentStatement,
  BindingPattern,
  ClassDeclaration,
  Expression,
  ExternClassDeclaration,
  ExternFunctionDeclaration,
  ExternConstantDeclaration,
  FunctionDeclaration,
  MatchPattern,
  MatchValue,
  Program,
  Statement,
  TypeDeclaration,
  TypeAliasDeclaration,
  TypeReference,
  TypeSyntax,
} from "./ast.ts";
import { diagnostic, type Diagnostic } from "./diagnostic.ts";
import type { CompilerAnalysisExtension } from "./extension.ts";
import { collectionMemberGuidance, type CollectionKind } from "./language-guidance.ts";
import { spanIdentity, type Span } from "./source.ts";
import {
  anyType,
  boolType,
  describeType,
  invalidType,
  isInvalidType,
  isAssignable,
  mergeTypes,
  nullType,
  nonOptional,
  numberType,
  optionalOf,
  resolveTypeReference,
  resolvedAsyncType,
  semanticTypeIdentity,
  sameType,
  stringType,
  unionOf,
  unknownType,
  type EnumInfo,
  type TypeEnvironment,
  type ValueType,
} from "./types.ts";

interface Binding {
  readonly mutable: boolean;
  readonly effectMutable: boolean;
  type: ValueType;
  declaredType: ValueType;
  readonly span: Span;
  narrowingFrame: number | null;
}

interface CollectionInferenceGroup {
  readonly type: ValueType;
  readonly bindings: Map<Binding, string>;
  open: boolean;
}

interface MemberNarrowing {
  readonly type: ValueType;
  readonly frame: number;
}

interface FlowFactsSnapshot {
  readonly bindings: ReadonlyMap<Binding, {
    readonly type: ValueType;
    readonly frame: number | null;
  }>;
  readonly members: readonly ReadonlyMap<string, MemberNarrowing>[];
}

interface FlowFactInvalidations {
  readonly bindings: ReadonlySet<Binding>;
  readonly members: ReadonlyMap<number, ReadonlySet<string>>;
}

interface AnalyzableFunctionDeclaration {
  readonly kind: string;
  readonly name: string;
  readonly parameters: FunctionDeclaration["parameters"];
  readonly returnType: FunctionDeclaration["returnType"];
  readonly body: FunctionDeclaration["body"];
  readonly span: Span;
  readonly asynchronous?: boolean;
}

function continuesOptionalChain(expression: Expression): boolean {
  if (expression.kind === "MemberExpression") {
    return expression.optional || continuesOptionalChain(expression.object);
  }
  if (expression.kind === "IndexExpression") {
    return expression.optional || continuesOptionalChain(expression.object);
  }
  if (expression.kind === "CallExpression") {
    return continuesOptionalChain(expression.callee);
  }
  return false;
}

export interface ClassField {
  readonly mutable: boolean;
  readonly type: ValueType;
}

export interface ClassInfo {
  readonly identity?: string;
  readonly parameters: readonly ValueType[];
  readonly parameterNames?: readonly string[];
  readonly requiredParameters: number;
  readonly constructorRest?: ValueType;
  readonly base: string | null;
  readonly abstract: boolean;
  readonly fields: ReadonlyMap<string, ClassField>;
  readonly getters: ReadonlySet<string>;
  readonly abstractGetters: ReadonlySet<string>;
  readonly methods: ReadonlyMap<string, ValueType>;
  readonly abstractMethods: ReadonlySet<string>;
  readonly staticFields: ReadonlyMap<string, ClassField>;
  readonly staticGetters: ReadonlySet<string>;
  readonly staticMethods: ReadonlyMap<string, ValueType>;
}

export type CollectionOperation = "get" | "slice" | "listAppend" | "listExtend" | "listInsert" | "listRemove" | "listPop" | "listCopy" | "listCount" | "listIndex" | "listFind" | "listSome" | "listEvery" | "listMap" | "listFilter" | "listReduce" | "listJoin" | "listSorted" | "listReversed" | "setAdd" | "setUpdate" | "setCopy" | "mapSet" | "mapUpdate" | "mapCopy" | "has" | "remove" | "clear" | "keys" | "values" | "entries";

const listCollectionOperations = new Map<string, CollectionOperation>([
  ["get", "get"], ["slice", "slice"], ["append", "listAppend"], ["extend", "listExtend"],
  ["insert", "listInsert"], ["remove", "listRemove"], ["pop", "listPop"],
  ["clear", "clear"], ["copy", "listCopy"], ["has", "has"], ["count", "listCount"],
  ["index", "listIndex"], ["find", "listFind"], ["some", "listSome"], ["every", "listEvery"],
  ["map", "listMap"], ["filter", "listFilter"], ["reduce", "listReduce"], ["join", "listJoin"],
  ["sorted", "listSorted"], ["reversed", "listReversed"],
]);
const mapCollectionOperations = new Map<string, CollectionOperation>([
  ["get", "get"], ["set", "mapSet"], ["update", "mapUpdate"], ["has", "has"],
  ["remove", "remove"], ["clear", "clear"], ["copy", "mapCopy"],
  ["keys", "keys"], ["values", "values"], ["entries", "entries"],
]);
const setCollectionOperations = new Map<string, CollectionOperation>([
  ["add", "setAdd"], ["update", "setUpdate"], ["has", "has"], ["remove", "remove"],
  ["clear", "clear"], ["copy", "setCopy"], ["values", "values"],
]);
export interface FormReadField {
  readonly name: string;
  readonly kind: "string" | "number" | "bool" | "enum" | "strings";
  readonly optional: boolean;
  readonly enumValues?: readonly string[];
}

export interface LoweringHints {
  readonly collectionCalls: ReadonlyMap<number, CollectionOperation>;
  readonly collectionSizes: ReadonlySet<number>;
  readonly constructorCalls: ReadonlySet<string>;
  readonly classChecks: ReadonlySet<string>;
  readonly privateMembers: ReadonlySet<string>;
  readonly classNames: ReadonlySet<string>;
  readonly enumNames: ReadonlySet<string>;
  readonly optionalMembers: ReadonlySet<string>;
  readonly optionalCalls: ReadonlySet<string>;
  readonly optionalIndexes: ReadonlySet<string>;
  readonly optionalCallees: ReadonlySet<string>;
  readonly presenceConditions: ReadonlySet<string>;
  readonly optionalNegations: ReadonlySet<string>;
  readonly normalizedNullResults: ReadonlySet<string>;
  readonly normalizedPromiseValues: ReadonlySet<string>;
  readonly normalizedUndefinedExpressions: ReadonlySet<string>;
  readonly optionalBindingEntries: ReadonlySet<number>;
  readonly reactiveBindings: ReadonlyMap<string, "state" | "computed">;
  readonly enumValueBindings: ReadonlyMap<number, string>;
  readonly exhaustiveMatches: ReadonlySet<number>;
  readonly formReads: ReadonlyMap<string, readonly FormReadField[]>;
  readonly namedArgumentOrders: ReadonlyMap<string, readonly number[]>;
  readonly extensionLiterals: ReadonlyMap<string, string>;
  readonly extensionCalls: ReadonlyMap<string, string>;
}

export interface AnalysisContext {
  readonly imports?: ReadonlyMap<string, ValueType>;
  readonly effectfulImports?: ReadonlySet<string>;
  readonly dynamicImports?: ReadonlyMap<string, ValueType>;
  readonly reactiveImports?: ReadonlyMap<string, "state" | "computed">;
  readonly namedTypes?: ReadonlyMap<string, ReadonlyMap<string, ValueType>>;
  readonly namedTypeIdentities?: ReadonlyMap<string, string>;
  readonly typeAliases?: ReadonlyMap<string, ValueType>;
  readonly enums?: ReadonlyMap<string, EnumInfo>;
  readonly classes?: ReadonlyMap<string, ClassInfo>;
  readonly extensionImports?: ReadonlyMap<string, ReadonlyMap<string, unknown>>;
  readonly extensionModules?: ReadonlyMap<string, readonly unknown[]>;
  readonly resources?: ReadonlyMap<string, string>;
}

const corePrimitiveNames = new Set(["string", "number", "bool", "null", "unknown"]);
const reservedBindings = new Set([
  "Array", "Boolean", "Error", "JSON", "Map", "Math", "Number", "Object", "Promise", "RangeError", "Reflect", "Set", "String",
  "Symbol", "TypeError", "WeakMap", "WeakSet", "console", "document", "globalThis", "number", "print", "queueMicrotask", "self", "str",
]);
const memberNarrowingPrefix = "\u0000member:";
const coreGlobalGuidance = new Map([
  ["console", "Use print(value) or an explicit JavaScript boundary instead of the console global"],
  ["JSON", "Use velar/json instead of the JSON global"],
  ["Math", "Use velar/math instead of the Math global"],
  ["Date", "Use velar/time instead of the Date global"],
  ["Boolean", "Use an explicit boolean comparison; VelarScript does not expose JavaScript truthiness conversion"],
  ["Number", "Use number(text), typed forms, or validated data instead of JavaScript Number coercion"],
  ["String", "Use str(value) instead of the JavaScript String global"],
]);

export class Analyzer implements TypeEnvironment {
  protected readonly diagnostics: Diagnostic[] = [];
  private readonly scopes: Map<string, Binding>[] = [new Map()];
  private readonly memberNarrowings: Map<string, MemberNarrowing>[] = [new Map()];
  private readonly namedTypes = new Map<string, ReadonlyMap<string, ValueType>>();
  private readonly namedTypeIdentities = new Map<string, string>();
  private readonly typeAliases = new Map<string, ValueType>();
  private readonly invalidDeclaredTypes = new Set<string>();
  private readonly typeReferenceValidity = new WeakMap<TypeReference, boolean>();
  private readonly invalidExternTypeReferences = new WeakSet<TypeReference>();
  private readonly enums = new Map<string, EnumInfo>();
  private readonly classes = new Map<string, ClassInfo>();
  private readonly classDisplayNames = new Map<string, string>();
  private readonly externModules = new Map<string, ReadonlyMap<string, ValueType>>();
  private readonly externTypeImports = new Map<string, ValueType>();
  private readonly returnTypes: ValueType[] = [];
  private readonly asynchronousFunctions: boolean[] = [];
  private readonly collectionCalls = new Map<number, CollectionOperation>();
  private readonly collectionSizes = new Set<number>();
  private readonly constructorCalls = new Set<string>();
  private readonly classChecks = new Set<string>();
  private readonly privateMembers = new Set<string>();
  private readonly optionalMembers = new Set<string>();
  private readonly optionalCalls = new Set<string>();
  private readonly optionalIndexes = new Set<string>();
  private readonly optionalCallees = new Set<string>();
  private readonly constructorFieldInitializations = new Set<number>();
  private readonly presenceConditions = new Set<string>();
  private readonly optionalNegations = new Set<string>();
  private readonly normalizedNullResults = new Set<string>();
  private readonly normalizedPromiseValues = new Set<string>();
  private readonly normalizedUndefinedExpressions = new Set<string>();
  private readonly optionalBindingEntries = new Set<number>();
  protected readonly reactiveBindings = new Map<string, "state" | "computed">();
  protected readonly enumValueBindings = new Map<number, string>();
  private readonly exhaustiveMatches = new Set<number>();
  private readonly formReads = new Map<string, readonly FormReadField[]>();
  private readonly namedArgumentOrders = new Map<string, readonly number[]>();
  protected readonly extensionLiterals = new Map<string, string>();
  protected readonly extensionCalls = new Map<string, string>();
  private readonly semanticBindingTypes = new Map<string, ValueType>();
  private readonly semanticBindingMembers = new Map<string, ReadonlyMap<string, ValueType>>();
  private readonly semanticMemberCache = new Map<string, ReadonlyMap<string, ValueType>>();
  private readonly semanticExpressionTypes = new Map<string, ValueType>();
  private readonly semanticExpressionMembers = new Map<string, ReadonlyMap<string, ValueType>>();
  private readonly semanticExpressionOwners = new Map<string, ValueType>();
  private readonly semanticObjectPropertyOwners = new Map<string, ValueType>();
  private readonly semanticBindingEntryOwners = new Map<string, ValueType>();
  protected readonly semanticJsxAttributeOwners = new Map<string, ValueType>();
  private readonly semanticExpressionContexts = new Map<string, ValueType>();
  private readonly semanticExpressionContextMembers = new Map<string, ReadonlyMap<string, ValueType>>();
  private readonly contextualAssignments = new Map<string, ValueType>();
  private readonly inferredExpressionTypes = new Map<string, ValueType>();
  private readonly logicalConditionNarrowings = new Map<string, {
    readonly truthy: ReadonlyMap<string, ValueType>;
    readonly falsy: ReadonlyMap<string, ValueType>;
  }>();
  private readonly collectionInferenceGroups = new WeakMap<Binding, CollectionInferenceGroup>();
  private readonly collectionInferenceTypes = new WeakMap<object, CollectionInferenceGroup>();
  private readonly privateFields = new Map<string, Map<string, ClassField>>();
  private readonly privateGetters = new Map<string, Set<string>>();
  private readonly privateMethods = new Map<string, Map<string, ValueType>>();
  private readonly privateStaticFields = new Map<string, Map<string, ClassField>>();
  private readonly privateStaticGetters = new Map<string, Set<string>>();
  private readonly privateStaticMethods = new Map<string, Map<string, ValueType>>();
  private readonly predeclared = new WeakSet<object>();
  private functionDepth = 0;
  private parameterDefaultDepth = 0;
  private loopDepth = 0;
  private finallyLoopDepths: number[] = [];
  private currentClass: string | null = null;
  private classFieldInitializerDepth = 0;
  protected constructorDepth = 0;
  protected flowFrameDepth = 0;
  private readonly primitiveNames = new Set(corePrimitiveNames);
  private readonly extensionGlobals = new Map<string, ValueType>();
  private readonly extensionReservedBindings = new Set<string>();
  private readonly globalGuidance = new Map(coreGlobalGuidance);
  private readonly analysisExtensions: readonly CompilerAnalysisExtension[];

  constructor(context: AnalysisContext = {}, extensions: readonly CompilerAnalysisExtension[] = []) {
    this.analysisExtensions = extensions;
    this.classes.set("Error", {
      parameters: [stringType],
      requiredParameters: 0,
      base: null,
      abstract: false,
      fields: new Map([
        ["name", { mutable: false, type: stringType }],
        ["message", { mutable: false, type: stringType }],
        ["stack", { mutable: false, type: optionalOf(stringType) }],
      ]),
      getters: new Set(),
      abstractGetters: new Set(),
      methods: new Map(),
      abstractMethods: new Set(),
      staticFields: new Map(),
      staticGetters: new Set(),
      staticMethods: new Map(),
    });
    this.importBindings = new Map(context.imports);
    this.effectfulImports = new Set(context.effectfulImports);
    this.dynamicImports = new Map(context.dynamicImports);
    for (const [name, kind] of context.reactiveImports ?? []) this.reactiveBindings.set(name, kind);
    for (const [name, fields] of context.namedTypes ?? []) this.namedTypes.set(name, fields);
    for (const [name, identity] of context.namedTypeIdentities ?? []) this.namedTypeIdentities.set(name, identity);
    for (const [name, type] of context.typeAliases ?? []) this.typeAliases.set(name, type);
    for (const [name, members] of context.enums ?? []) this.enums.set(name, members);
    for (const [name, info] of context.classes ?? []) this.classes.set(name, info);
    for (const extension of extensions) {
      for (const name of extension.primitiveTypes ?? []) this.primitiveNames.add(name);
      for (const [name, type] of extension.globals ?? []) this.extensionGlobals.set(name, type);
      for (const name of extension.reservedBindings ?? []) this.extensionReservedBindings.add(name);
      for (const [name, guidance] of extension.globalGuidance ?? []) this.globalGuidance.set(name, guidance);
    }
  }

  private readonly importBindings: ReadonlyMap<string, ValueType>;
  private readonly effectfulImports: ReadonlySet<string>;
  private readonly dynamicImports: ReadonlyMap<string, ValueType>;

  analyze(program: Program): readonly Diagnostic[] {
    this.registerEnumShapes(program);
    this.registerAliasShapes(program);
    // Class identities must exist before record fields are resolved. Otherwise a
    // record field annotated with a class is frozen as a structural named type.
    this.registerClassNames(program);
    this.registerExternTypeImports(program);
    this.registerTypeShapes(program);
    this.validateDataTypeDeclarations(program);
    this.validateCoreDeclarationSignatures(program);
    this.registerClassShapes(program);
    this.rejectUnproductiveRecursiveTypes(program);
    this.validateExternDeclarations(program);
    this.registerExternModules(program);
    this.predeclareTopLevel(program);
    for (const statement of program.body) {
      this.analyzeStatement(statement);
    }
    return this.diagnostics;
  }

  private registerExternTypeImports(program: Program): void {
    const classesBySource = new Map<string, ReadonlySet<string>>();
    for (const statement of program.body) {
      if (statement.kind !== "ExternModuleDeclaration" || classesBySource.has(statement.source)) continue;
      classesBySource.set(statement.source, new Set(statement.classes.map((declaration) => declaration.name)));
    }
    for (const statement of program.body) {
      if (statement.kind !== "ImportDeclaration" || !statement.javascript || statement.unsafe) continue;
      const classNames = classesBySource.get(statement.source);
      if (!classNames) continue;
      for (const specifier of statement.specifiers) {
        if (specifier.namespace || !classNames.has(specifier.imported)) continue;
        this.externTypeImports.set(specifier.local, {
          kind: "class",
          name: specifier.local,
          identity: this.externClassIdentity(statement.source, specifier.imported),
        });
      }
    }
  }

  private validateDataTypeDeclarations(program: Program): void {
    const declarations = program.body.filter((statement): statement is TypeDeclaration | TypeAliasDeclaration =>
      statement.kind === "TypeDeclaration" || statement.kind === "TypeAliasDeclaration");
    for (const declaration of declarations) {
      const valid = declaration.kind === "TypeAliasDeclaration"
        ? this.validateTypeReference(declaration.target)
        : declaration.fields.map((field) => this.validateTypeReference(field.type)).every(Boolean);
      if (!valid) this.invalidDeclaredTypes.add(declaration.name);
    }

    let changed = true;
    while (changed) {
      changed = false;
      for (const declaration of declarations) {
        if (this.invalidDeclaredTypes.has(declaration.name)) continue;
        const syntaxes = declaration.kind === "TypeAliasDeclaration"
          ? [declaration.target.syntax]
          : declaration.fields.map((field) => field.type.syntax);
        if (!syntaxes.some((syntax) => this.typeSyntaxReferencesInvalidDeclaration(syntax))) continue;
        this.invalidDeclaredTypes.add(declaration.name);
        changed = true;
      }
    }
  }

  private validateCoreDeclarationSignatures(program: Program): void {
    const validateFunction = (statement: Pick<FunctionDeclaration, "parameters" | "returnType">): void => {
      for (const parameter of statement.parameters) {
        if (parameter.type) this.validateTypeReference(parameter.type);
      }
      if (statement.returnType) this.validateTypeReference(statement.returnType);
    };
    for (const statement of program.body) {
      if (statement.kind === "VariableDeclaration") {
        if (statement.type) this.validateTypeReference(statement.type);
      } else if (statement.kind === "FunctionDeclaration") {
        validateFunction(statement);
      } else if (statement.kind === "ClassDeclaration") {
        for (const parameter of statement.parameters) {
          if (parameter.type) this.validateTypeReference(parameter.type);
        }
        for (const field of statement.fields) this.validateTypeReference(field.type);
        for (const getter of statement.getters) validateFunction(getter);
        for (const method of statement.methods) validateFunction(method);
      }
    }
  }

  private typeSyntaxReferencesInvalidDeclaration(syntax: TypeSyntax): boolean {
    switch (syntax.kind) {
      case "NamedTypeSyntax":
        return this.invalidDeclaredTypes.has(syntax.name);
      case "GenericTypeSyntax":
        return syntax.arguments.some((argument) => this.typeSyntaxReferencesInvalidDeclaration(argument));
      case "OptionalTypeSyntax":
        return this.typeSyntaxReferencesInvalidDeclaration(syntax.inner);
      case "UnionTypeSyntax":
        return syntax.members.some((member) => this.typeSyntaxReferencesInvalidDeclaration(member));
      case "FunctionTypeSyntax":
        return syntax.parameters.some((parameter) => this.typeSyntaxReferencesInvalidDeclaration(parameter.type))
          || this.typeSyntaxReferencesInvalidDeclaration(syntax.result);
    }
  }

  private rejectUnproductiveRecursiveTypes(program: Program): void {
    const declarations = new Map(program.body
      .filter((statement) => statement.kind === "TypeDeclaration")
      .map((statement) => [statement.name, statement]));
    const productive = new Set<string>();
    const typeIsProductive = (source: ValueType): boolean => {
      const type = this.expandAliases(source);
      if (type.kind === "named") return !declarations.has(type.name) || productive.has(type.name);
      if (type.kind === "union") return type.members.some(typeIsProductive);
      if (type.kind === "object") return [...type.fields.values()].every(typeIsProductive);
      if (type.kind === "optional" || type.kind === "list" || type.kind === "set" || type.kind === "map" || type.kind === "promise") return true;
      return true;
    };
    let changed = true;
    while (changed) {
      changed = false;
      for (const [name] of declarations) {
        if (productive.has(name)) continue;
        const fields = this.namedTypes.get(name);
        if (fields && [...fields.values()].every(typeIsProductive)) {
          productive.add(name);
          changed = true;
        }
      }
    }
    for (const [name, declaration] of declarations) {
      if (!productive.has(name)) this.diagnostics.push(diagnostic("VEL4009", `Recursive type '${name}' cannot construct a finite value; add an optional, collection, or terminating union path`, declaration.span));
    }
  }

  private predeclareTopLevel(program: Program): void {
    for (const statement of program.body) {
      if (statement.kind === "ImportDeclaration") {
        for (const specifier of statement.specifiers) {
          this.declareBinding(
            specifier.local,
            false,
            this.importType(statement, specifier.local, specifier.imported, specifier.namespace),
            specifier.span,
            false,
            this.effectfulImports.has(specifier.local),
          );
        }
        this.predeclared.add(statement);
      } else if (statement.kind === "TypeDeclaration" || statement.kind === "TypeAliasDeclaration") {
        this.declareBinding(statement.name, false, { kind: "typeObject", name: statement.name }, statement.span);
        this.predeclared.add(statement);
      } else if (statement.kind === "EnumDeclaration") {
        const info = this.enums.get(statement.name) ?? { identity: statement.name, members: new Set(statement.members.map((member) => member.name)) };
        this.declareBinding(statement.name, false, { kind: "enumObject", name: statement.name, identity: info.identity, members: info.members }, statement.span);
        this.predeclared.add(statement);
      } else if (statement.kind === "ClassDeclaration") {
        this.declareBinding(statement.name, false, { kind: "classConstructor", name: statement.name }, statement.span);
        this.predeclared.add(statement);
      } else if (statement.kind === "FunctionDeclaration") {
        this.declareBinding(statement.name, false, this.functionType(statement), statement.span);
        this.predeclared.add(statement);
      } else if (this.predeclareExtensionStatement(statement)) {
        this.predeclared.add(statement);
      }
    }
  }

  private validateExternDeclarations(program: Program): void {
    for (const statement of program.body) {
      if (statement.kind !== "ExternModuleDeclaration") continue;
      const classNames = new Set(statement.classes.map((declaration) => declaration.name));
      const validate = (reference: TypeReference | null): boolean => {
        if (!reference) return true;
        const valid = this.validateTypeReference(reference, (value) => this.resolveExternAnnotation(value, statement.source, classNames));
        if (!valid) this.invalidExternTypeReferences.add(reference);
        return valid;
      };
      for (const declaration of statement.classes) {
        for (const parameter of declaration.parameters) validate(parameter.type);
        for (const field of declaration.fields) validate(field.type);
        for (const method of declaration.methods) {
          for (const parameter of method.parameters) validate(parameter.type);
          validate(method.returnType);
        }
      }
      for (const declaration of statement.functions) {
        for (const parameter of declaration.parameters) validate(parameter.type);
        validate(declaration.returnType);
      }
      for (const declaration of statement.constants) validate(declaration.type);
    }
  }

  private registerExternModules(program: Program): void {
    for (const statement of program.body) {
      if (statement.kind !== "ExternModuleDeclaration") continue;
      if (this.externModules.has(statement.source)) {
        this.diagnostics.push(diagnostic("VEL4005", `Extern module '${statement.source}' is declared more than once`, statement.span));
        continue;
      }
      const exports = new Map<string, ValueType>();
      const classNames = new Set(statement.classes.map((declaration) => declaration.name));
      for (const declaration of statement.classes) {
        if (exports.has(declaration.name)) {
          this.diagnostics.push(diagnostic("VEL4005", `Extern export '${declaration.name}' is declared more than once`, declaration.span));
          continue;
        }
        const identity = this.externClassIdentity(statement.source, declaration.name);
        const fields = new Map<string, ClassField>();
        const staticFields = new Map<string, ClassField>();
        for (const parameter of declaration.parameters) {
          if (parameter.binding) fields.set(parameter.name, {
            mutable: parameter.binding === "let",
            type: this.markExternalAggregate(this.resolveValidatedExternAnnotation(parameter.type, statement.source, classNames)),
          });
        }
        for (const field of declaration.fields) {
          (field.static ? staticFields : fields).set(field.name, {
            mutable: field.mutable,
            type: this.markExternalAggregate(this.resolveValidatedExternAnnotation(field.type, statement.source, classNames)),
          });
        }
        const methods = new Map<string, ValueType>();
        const staticMethods = new Map<string, ValueType>();
        for (const method of declaration.methods) {
          (method.static ? staticMethods : methods).set(method.name, this.externFunctionType(
            method,
            (reference) => this.resolveValidatedExternAnnotation(reference, statement.source, classNames),
          ));
        }
        const rest = declaration.parameters.find((parameter) => parameter.rest);
        this.classes.set(identity, {
          identity,
          parameters: declaration.parameters.filter((parameter) => !parameter.rest).map((parameter) => this.resolveValidatedExternAnnotation(parameter.type, statement.source, classNames)),
          requiredParameters: declaration.parameters.filter((parameter) => !parameter.rest && !parameter.defaultValue).length,
          ...(rest ? { constructorRest: this.resolveValidatedExternAnnotation(rest.type, statement.source, classNames) } : {}),
          base: declaration.base ? this.externClassIdentity(statement.source, declaration.base) : null,
          abstract: false,
          fields,
          getters: new Set(),
          abstractGetters: new Set(),
          methods,
          abstractMethods: new Set(),
          staticFields,
          staticGetters: new Set(),
          staticMethods,
        });
        exports.set(declaration.name, { kind: "classConstructor", name: declaration.name, identity });
      }
      for (const declaration of [...statement.functions, ...statement.constants]) {
        if (exports.has(declaration.name)) {
          this.diagnostics.push(diagnostic("VEL4005", `Extern export '${declaration.name}' is declared more than once`, declaration.span));
        }
        exports.set(declaration.name, "parameters" in declaration
          ? this.externFunctionType(declaration, (reference) => this.resolveValidatedExternAnnotation(reference, statement.source, classNames))
          : this.markExternalAggregate(this.resolveValidatedExternAnnotation(declaration.type, statement.source, classNames)));
      }
      this.externModules.set(statement.source, exports);
    }
  }

  loweringHints(): LoweringHints {
    return {
      collectionCalls: this.collectionCalls,
      collectionSizes: this.collectionSizes,
      constructorCalls: this.constructorCalls,
      classChecks: this.classChecks,
      privateMembers: this.privateMembers,
      classNames: new Set([...this.classes.keys(), ...this.classDisplayNames.values()]),
      enumNames: new Set(this.enums.keys()),
      optionalMembers: this.optionalMembers,
      optionalCalls: this.optionalCalls,
      optionalIndexes: this.optionalIndexes,
      optionalCallees: this.optionalCallees,
      presenceConditions: this.presenceConditions,
      optionalNegations: this.optionalNegations,
      normalizedNullResults: this.normalizedNullResults,
      normalizedPromiseValues: this.normalizedPromiseValues,
      normalizedUndefinedExpressions: this.normalizedUndefinedExpressions,
      optionalBindingEntries: this.optionalBindingEntries,
      reactiveBindings: this.reactiveBindings,
      enumValueBindings: this.enumValueBindings,
      exhaustiveMatches: this.exhaustiveMatches,
      formReads: this.formReads,
      namedArgumentOrders: this.namedArgumentOrders,
      extensionLiterals: this.extensionLiterals,
      extensionCalls: this.extensionCalls,
    };
  }

  semanticTypes(): ReadonlyMap<string, ValueType> {
    return this.semanticBindingTypes;
  }

  semanticMembers(): ReadonlyMap<string, ReadonlyMap<string, ValueType>> {
    return this.semanticBindingMembers;
  }

  semanticExpressions(): {
    readonly types: ReadonlyMap<string, ValueType>;
    readonly members: ReadonlyMap<string, ReadonlyMap<string, ValueType>>;
    readonly owners: ReadonlyMap<string, ValueType>;
    readonly objectPropertyOwners: ReadonlyMap<string, ValueType>;
    readonly bindingEntryOwners: ReadonlyMap<string, ValueType>;
    readonly jsxAttributeOwners: ReadonlyMap<string, ValueType>;
    readonly contexts: ReadonlyMap<string, ValueType>;
    readonly contextMembers: ReadonlyMap<string, ReadonlyMap<string, ValueType>>;
  } {
    return {
      types: this.semanticExpressionTypes,
      members: this.semanticExpressionMembers,
      owners: this.semanticExpressionOwners,
      objectPropertyOwners: this.semanticObjectPropertyOwners,
      bindingEntryOwners: this.semanticBindingEntryOwners,
      jsxAttributeOwners: this.semanticJsxAttributeOwners,
      contexts: this.semanticExpressionContexts,
      contextMembers: this.semanticExpressionContextMembers,
    };
  }

  fieldsOf(identity: string): ReadonlyMap<string, ValueType> | null {
    return this.namedTypes.get(identity) ?? this.extensionFieldsOf(identity);
  }

  protected predeclareExtensionStatement(_statement: Statement): boolean {
    return false;
  }

  protected analyzeExtensionStatement(_statement: Statement): boolean {
    return false;
  }

  protected inferExtensionExpression(_expression: Expression, _contextualType: ValueType): ValueType | undefined {
    return undefined;
  }

  protected extensionFieldsOf(_name: string): ReadonlyMap<string, ValueType> | null {
    return null;
  }

  protected invalidExtensionAwaitContext(): boolean {
    return false;
  }

  protected isTopLevelScope(): boolean {
    return this.scopes.length === 1;
  }

  protected isPredeclared(statement: object): boolean {
    return this.predeclared.has(statement);
  }

  isSubclassOf(actual: string, expected: string): boolean {
    let current: string | null = actual;
    const visited = new Set<string>();
    while (current && !visited.has(current)) {
      if (current === expected) return true;
      visited.add(current);
      const info = this.classes.get(current);
      if (info?.identity === expected) return true;
      current = info?.base ?? null;
    }
    return false;
  }

  private registerAliasShapes(program: Program): void {
    const declarations = new Map<string, TypeAliasDeclaration>();
    for (const statement of program.body) {
      if (statement.kind !== "TypeAliasDeclaration") continue;
      this.typeAliases.delete(statement.name);
      if (declarations.has(statement.name)) {
        this.diagnostics.push(diagnostic("VEL4004", `Type '${statement.name}' is declared more than once`, statement.span));
      }
      declarations.set(statement.name, statement);
    }
    const resolving = new Set<string>();
    const reported = new Set<string>();
    const expand = (type: ValueType): ValueType => {
      if (type.kind === "named") {
        const declaration = declarations.get(type.name);
        if (!declaration) return this.typeAliases.get(type.name) ?? type;
        const cached = this.typeAliases.get(type.name);
        if (cached && !resolving.has(type.name)) return cached;
        if (resolving.has(type.name)) {
          if (!reported.has(type.name)) {
            this.diagnostics.push(diagnostic("VEL4017", `Type alias '${type.name}' is recursive`, declaration.span));
            reported.add(type.name);
          }
          return unknownType;
        }
        resolving.add(type.name);
        const resolved = expand(resolveTypeReference(declaration.target));
        resolving.delete(type.name);
        this.typeAliases.set(type.name, resolved);
        return resolved;
      }
      if (type.kind === "optional") return optionalOf(expand(type.inner));
      if (type.kind === "list") return { ...type, element: expand(type.element) };
      if (type.kind === "set") return { kind: "set", element: expand(type.element) };
      if (type.kind === "map") return { kind: "map", key: expand(type.key), value: expand(type.value) };
      if (type.kind === "promise") return { kind: "promise", value: expand(type.value) };
      if (type.kind === "object") return { ...type, fields: new Map([...type.fields].map(([name, value]) => [name, expand(value)])) };
      if (type.kind === "function" || type.kind === "action" || type.kind === "intrinsic") return {
        ...type,
        parameters: type.parameters.map(expand),
        ...(type.rest ? { rest: expand(type.rest) } : {}),
        result: expand(type.result),
      };
      if (type.kind === "union") return { kind: "union", members: type.members.map(expand) };
      return type;
    };
    for (const name of declarations.keys()) expand({ kind: "named", name });
  }

  protected expandAliases(type: ValueType, seen: ReadonlySet<string> = new Set()): ValueType {
    if (type.kind === "named" && this.typeAliases.has(type.name)) {
      if (seen.has(type.name)) return unknownType;
      return this.expandAliases(this.typeAliases.get(type.name)!, new Set([...seen, type.name]));
    }
    if (type.kind === "optional") {
      const inner = this.expandAliases(type.inner, seen);
      return inner === type.inner ? type : optionalOf(inner);
    }
    if (type.kind === "list" || type.kind === "set") {
      const element = this.expandAliases(type.element, seen);
      return element === type.element ? type : { ...type, element };
    }
    if (type.kind === "map") {
      const key = this.expandAliases(type.key, seen);
      const value = this.expandAliases(type.value, seen);
      return key === type.key && value === type.value ? type : { kind: "map", key, value };
    }
    if (type.kind === "promise") {
      const value = this.expandAliases(type.value, seen);
      return value === type.value ? type : { kind: "promise", value };
    }
    if (type.kind === "object") {
      let changed = false;
      const fields = new Map([...type.fields].map(([name, value]) => {
        const expanded = this.expandAliases(value, seen);
        changed ||= expanded !== value;
        return [name, expanded] as const;
      }));
      return changed ? { ...type, fields } : type;
    }
    if (type.kind === "function" || type.kind === "action" || type.kind === "intrinsic") {
      const parameters = type.parameters.map((parameter) => this.expandAliases(parameter, seen));
      const rest = type.rest ? this.expandAliases(type.rest, seen) : undefined;
      const result = this.expandAliases(type.result, seen);
      return parameters.every((parameter, index) => parameter === type.parameters[index]) && rest === type.rest && result === type.result
        ? type
        : { ...type, parameters, ...(rest ? { rest } : {}), result };
    }
    if (type.kind === "union") {
      const members = type.members.map((member) => this.expandAliases(member, seen));
      return members.every((member, index) => member === type.members[index]) ? type : { kind: "union", members };
    }
    return type;
  }

  private registerTypeShapes(program: Program): void {
    for (const statement of program.body) {
      if (statement.kind !== "TypeDeclaration") {
        continue;
      }
      const fields = new Map<string, ValueType>();
      for (const field of statement.fields) {
        fields.set(field.name, this.resolveAnnotation(field.type));
      }
      this.namedTypes.set(statement.name, fields);
    }
  }

  private registerEnumShapes(program: Program): void {
    for (const statement of program.body) {
      if (statement.kind !== "EnumDeclaration") continue;
      this.enums.set(statement.name, { identity: statement.name, members: new Set(statement.members.map((member) => member.name)) });
    }
  }

  private registerClassNames(program: Program): void {
    for (const statement of program.body) {
      if (statement.kind !== "ClassDeclaration" || this.classes.has(statement.name)) continue;
      this.classes.set(statement.name, {
        parameters: [],
        requiredParameters: 0,
        base: statement.base?.name ?? null,
        abstract: statement.abstract,
        fields: new Map(),
        getters: new Set(),
        abstractGetters: new Set(),
        methods: new Map(),
        abstractMethods: new Set(),
        staticFields: new Map(),
        staticGetters: new Set(),
        staticMethods: new Map(),
      });
    }
  }

  private registerClassShapes(program: Program): void {
    for (const statement of program.body) {
      if (statement.kind !== "ClassDeclaration") {
        continue;
      }
      const fields = new Map<string, ClassField>();
      const staticFields = new Map<string, ClassField>();
      const privateFields = new Map<string, ClassField>();
      const privateStaticFields = new Map<string, ClassField>();
      const getters = new Set<string>();
      const abstractGetters = new Set<string>();
      const staticGetters = new Set<string>();
      const privateGetters = new Set<string>();
      const privateStaticGetters = new Set<string>();
      for (const parameter of statement.parameters) {
        if (parameter.binding) {
          (parameter.private ? privateFields : fields).set(parameter.name, {
            mutable: parameter.binding === "let",
            type: this.resolveValidatedAnnotation(parameter.type),
          });
        }
      }
      for (const field of statement.fields) {
        const target = field.private
          ? field.static ? privateStaticFields : privateFields
          : field.static ? staticFields : fields;
        target.set(field.name, {
          mutable: field.binding === "let",
          type: this.resolveValidatedAnnotation(field.type),
        });
      }
      for (const getter of statement.getters) {
        const target = getter.private
          ? getter.static ? privateStaticFields : privateFields
          : getter.static ? staticFields : fields;
        target.set(getter.name, { mutable: false, type: this.resolveValidatedResult(getter.returnType) });
        if (getter.private) (getter.static ? privateStaticGetters : privateGetters).add(getter.name);
        else if (getter.static) staticGetters.add(getter.name);
        else {
          getters.add(getter.name);
          if (getter.abstract) abstractGetters.add(getter.name);
        }
      }
      const methods = new Map<string, ValueType>();
      const abstractMethods = new Set<string>();
      const staticMethods = new Map<string, ValueType>();
      const privateMethods = new Map<string, ValueType>();
      const privateStaticMethods = new Map<string, ValueType>();
      for (const method of statement.methods) {
        const type = this.functionType(method);
        if (method.private) (method.static ? privateStaticMethods : privateMethods).set(method.name, type);
        else if (method.static) staticMethods.set(method.name, type);
        else {
          methods.set(method.name, type);
          if (method.abstract) abstractMethods.add(method.name);
        }
      }
      this.privateFields.set(statement.name, privateFields);
      this.privateGetters.set(statement.name, privateGetters);
      this.privateMethods.set(statement.name, privateMethods);
      this.privateStaticFields.set(statement.name, privateStaticFields);
      this.privateStaticGetters.set(statement.name, privateStaticGetters);
      this.privateStaticMethods.set(statement.name, privateStaticMethods);
      this.classes.set(statement.name, {
        parameters: statement.parameters.map((parameter) => this.resolveValidatedAnnotation(parameter.type)),
        parameterNames: statement.parameters.map((parameter) => parameter.name),
        requiredParameters: statement.parameters.filter((parameter) => !parameter.defaultValue).length,
        base: statement.base?.name ?? null,
        abstract: statement.abstract,
        fields,
        getters,
        abstractGetters,
        methods,
        abstractMethods,
        staticFields,
        staticGetters,
        staticMethods,
      });
    }
  }

  protected analyzeStatement(statement: Statement): void {
    if (this.analyzeExtensionStatement(statement)) return;
    switch (statement.kind) {
      case "ImportDeclaration":
        if (!this.predeclared.has(statement)) {
          for (const specifier of statement.specifiers) {
            this.declareBinding(
              specifier.local,
              false,
              this.importType(statement, specifier.local, specifier.imported, specifier.namespace),
              specifier.span,
              false,
              this.effectfulImports.has(specifier.local),
            );
          }
        }
        break;
      case "ExternModuleDeclaration":
        {
          const classNames = new Set(statement.classes.map((declaration) => declaration.name));
          const bases = new Map(statement.classes.map((declaration) => [declaration.name, declaration.base]));
          for (const declaration of statement.classes) {
            const members = new Set<string>();
            if (declaration.base && !classNames.has(declaration.base)) {
              this.typeError(`Unknown extern base class '${declaration.base}'`, declaration.span);
            } else if (declaration.base) {
              const visited = new Set([declaration.name]);
              let current: string | null = declaration.base;
              while (current) {
                if (visited.has(current)) {
                  this.typeError(`Extern class '${declaration.name}' has a cyclic inheritance relationship`, declaration.span);
                  break;
                }
                visited.add(current);
                current = bases.get(current) ?? null;
              }
            }
            for (const parameter of declaration.parameters) {
              const type = this.resolveValidatedExternAnnotation(parameter.type, statement.source, classNames);
              const valid = !parameter.type || !this.invalidExternTypeReferences.has(parameter.type);
              if (parameter.defaultValue && valid) this.requireAssignable(this.inferParameterDefault(parameter.defaultValue, type), type, parameter.defaultValue.span);
              if (parameter.binding) members.add(`instance:${parameter.name}`);
            }
            for (const field of declaration.fields) {
              const key = `${field.static ? "static" : "instance"}:${field.name}`;
              if (members.has(key)) this.typeError(`Extern class '${declaration.name}' declares member '${field.name}' more than once`, field.span);
              members.add(key);
            }
            for (const method of declaration.methods) {
              const key = `${method.static ? "static" : "instance"}:${method.name}`;
              if (members.has(key)) this.typeError(`Extern class '${declaration.name}' declares member '${method.name}' more than once`, method.span);
              members.add(key);
              for (const parameter of method.parameters) {
                const type = this.resolveValidatedExternAnnotation(parameter.type, statement.source, classNames);
                const valid = !parameter.type || !this.invalidExternTypeReferences.has(parameter.type);
                if (parameter.defaultValue && valid) this.requireAssignable(this.inferParameterDefault(parameter.defaultValue, type), type, parameter.defaultValue.span);
              }
              if (method.returnType) {
                const result = this.resolveValidatedExternAnnotation(method.returnType, statement.source, classNames);
                if (!this.invalidExternTypeReferences.has(method.returnType) && method.asynchronous && this.asyncResultContainsPromise(result)) {
                  this.diagnostics.push(diagnostic("VEL4018", "An async result annotation names the resolved value; write '-> T', not '-> Promise<T>'", method.returnType.span));
                }
              }
            }
            if (declaration.base && classNames.has(declaration.base)) {
              const base = this.externClassIdentity(statement.source, declaration.base);
              const ownFields = [
                ...declaration.parameters.filter((parameter) => parameter.binding).map((parameter) => ({
                  name: parameter.name,
                  mutable: parameter.binding === "let",
                  type: this.resolveValidatedExternAnnotation(parameter.type, statement.source, classNames),
                  span: parameter.span,
                })),
                ...declaration.fields.filter((field) => !field.static).map((field) => ({
                  name: field.name,
                  mutable: field.mutable,
                  type: this.resolveValidatedExternAnnotation(field.type, statement.source, classNames),
                  span: field.span,
                })),
              ];
              for (const field of ownFields) {
                if (this.findMethod(base, field.name)) this.typeError(`Extern field '${field.name}' conflicts with an inherited method`, field.span);
                const inherited = this.findField(base, field.name);
                if (inherited && (inherited.mutable !== field.mutable || !sameType(inherited.type, field.type))) {
                  this.typeError(`Inherited extern field '${field.name}' must keep its ${inherited.mutable ? "let" : "const"} ${describeType(inherited.type)} contract`, field.span);
                }
              }
              for (const method of declaration.methods.filter((item) => !item.static)) {
                if (this.findField(base, method.name)) this.typeError(`Extern method '${method.name}' conflicts with an inherited field`, method.span);
                const inherited = this.findMethod(base, method.name);
                const own = this.externFunctionType(method, (reference) => this.resolveValidatedExternAnnotation(reference, statement.source, classNames));
                if (inherited && !sameType(inherited.type, own)) {
                  this.typeError(`Extern override '${method.name}' must keep the base method signature ${describeType(inherited.type)}`, method.span);
                }
              }
            }
          }
        }
        for (const declaration of statement.functions) {
          for (const parameter of declaration.parameters) {
            const classNames = new Set(statement.classes.map((item) => item.name));
            const type = this.resolveValidatedExternAnnotation(parameter.type, statement.source, classNames);
            const valid = !parameter.type || !this.invalidExternTypeReferences.has(parameter.type);
            if (parameter.defaultValue && valid) this.requireAssignable(this.inferParameterDefault(parameter.defaultValue, type), type, parameter.defaultValue.span);
          }
          const classNames = new Set(statement.classes.map((item) => item.name));
          const result = this.resolveValidatedExternAnnotation(declaration.returnType, statement.source, classNames);
          if (declaration.returnType) {
            const valid = !this.invalidExternTypeReferences.has(declaration.returnType);
            if (valid && declaration.asynchronous && this.asyncResultContainsPromise(result)) {
              this.diagnostics.push(diagnostic("VEL4018", "An async result annotation names the resolved value; write '-> T', not '-> Promise<T>'", declaration.returnType.span));
            }
          }
        }
        break;
      case "TypeDeclaration":
        this.analyzeTypeDeclaration(statement);
        break;
      case "TypeAliasDeclaration":
        this.analyzeTypeAliasDeclaration(statement);
        break;
      case "EnumDeclaration": {
        if (this.scopes.length !== 1) {
          this.diagnostics.push(diagnostic("VEL3011", "Enums can only be declared at module scope", statement.span));
        }
        const seen = new Set<string>();
        for (const member of statement.members) {
          if (member.name === "is" || member.name === "parse") {
            this.diagnostics.push(diagnostic("VEL4014", `Enum member '${member.name}' is reserved for runtime validation`, member.span));
          }
          if (seen.has(member.name)) {
            this.diagnostics.push(diagnostic("VEL4014", `Enum member '${member.name}' is declared more than once`, member.span));
          }
          seen.add(member.name);
        }
        break;
      }
      case "ClassDeclaration":
        this.analyzeClassDeclaration(statement);
        break;
      case "VariableDeclaration": {
        const annotated = statement.type ? this.resolveAnnotation(statement.type) : null;
        const annotationValid = statement.type ? this.validateTypeReference(statement.type) : true;
        const aliasedBinding = !annotated && statement.initializer.kind === "IdentifierExpression"
          ? this.lookup(statement.initializer.name)
          : null;
        const actual = this.inferExpression(statement.initializer, annotationValid ? annotated ?? unknownType : invalidType);
        const declared = annotationValid ? annotated ?? actual : invalidType;
        if (annotationValid) this.requireAssignable(actual, declared, statement.initializer.span);
        if (this.bindingPatternReflectionMayExecute(statement.pattern, actual)) this.invalidateEffectfulFlowFacts();
        this.declarePattern(statement.pattern, statement.binding === "let", declared);
        this.validateKnownBindingShape(statement.pattern, statement.initializer);
        if (!annotated && statement.pattern.kind === "NameBindingPattern") {
          const binding = this.scopes.at(-1)?.get(statement.pattern.name);
          if (binding?.span.start === statement.pattern.span.start && binding.span.end === statement.pattern.span.end) {
            const aliasedGroup = aliasedBinding ? this.collectionInferenceGroups.get(aliasedBinding) : null;
            if (aliasedGroup) this.joinCollectionInference(statement.pattern.name, binding, aliasedGroup);
            else if (this.isFreshUnresolvedCollection(statement.initializer, declared)) {
              this.joinCollectionInference(statement.pattern.name, binding, this.createCollectionInference(declared));
            }
          }
        }
        break;
      }
      case "FunctionDeclaration":
        this.analyzeFunctionDeclaration(statement, null);
        break;
      case "ReturnStatement": {
        if (this.constructorDepth > 0) {
          this.diagnostics.push(diagnostic("VEL3014", "'return' cannot be used directly in a constructor", statement.span));
          break;
        }
        if (this.functionDepth === 0) {
          this.diagnostics.push(diagnostic("VEL3003", "'return' can only be used inside a function", statement.span));
          break;
        }
        if (this.finallyLoopDepths.length > 0) {
          this.diagnostics.push(diagnostic("VEL3015", "'return' cannot leave a finally block; assign a result before finally and return afterward", statement.span));
        }
        const expected = this.returnTypes.at(-1) ?? unknownType;
        const actual = statement.value ? this.inferExpression(statement.value, expected) : nullType;
        const returned = this.asynchronousFunctions.at(-1) ? this.resolvedAsyncResult(actual) : actual;
        this.requireAssignable(returned, expected, statement.value?.span ?? statement.span);
        break;
      }
      case "ThrowStatement": {
        const thrown = this.inferExpression(statement.value);
        const throwable = (type: ValueType): boolean => type.kind === "class"
          ? this.isSubclassOf(type.identity ?? type.name, "Error")
          : type.kind === "union" && type.members.every(throwable);
        if (!throwable(thrown) && !isInvalidType(thrown)) {
          this.typeError(`Only Error values can be thrown, received ${describeType(thrown)}`, statement.value.span);
        }
        break;
      }
      case "AssertStatement": {
        const condition = this.inferExpression(statement.condition);
        this.requireCondition(condition, statement.condition);
        if (statement.message) {
          const baseline = this.snapshotFlowFacts();
          this.analyzeIsolatedFlow(baseline, () => {
            const message = this.inferNarrowedExpression(
              statement.message!,
              this.negativeNarrowingFor(statement.condition, condition),
              stringType,
            );
            this.requireAssignable(message, stringType, statement.message!.span);
          });
        }
        this.persistNarrowings(this.narrowingFor(statement.condition, condition));
        break;
      }
      case "IfStatement": {
        const condition = this.inferExpression(statement.condition);
        this.requireCondition(condition, statement.condition);
        const truthy = this.narrowingFor(statement.condition, condition);
        const falsy = this.negativeNarrowingFor(statement.condition, condition);
        const baseline = this.snapshotFlowFacts();
        const continuingInvalidations: FlowFactInvalidations[] = [];
        let thenFacts: ReadonlyMap<string, ValueType> = new Map();
        const thenInvalidations = this.analyzeIsolatedFlow(baseline, () => {
          thenFacts = this.analyzeBlock(statement.thenBody, truthy);
        });
        const thenReturns = this.blockAlwaysReturns(statement.thenBody);
        if (!thenReturns) continuingInvalidations.push(thenInvalidations);
        let elseFacts: ReadonlyMap<string, ValueType> = new Map();
        let elseReturns = false;
        if (statement.elseBody) {
          const elseInvalidations = this.analyzeIsolatedFlow(baseline, () => {
            elseFacts = this.analyzeBlock(statement.elseBody!, falsy);
          });
          elseReturns = this.blockAlwaysReturns(statement.elseBody);
          if (!elseReturns) continuingInvalidations.push(elseInvalidations);
        }
        this.applyFlowInvalidations(continuingInvalidations);
        if (!statement.elseBody && thenReturns) this.persistNarrowings(falsy);
        else if (statement.elseBody && thenReturns && !elseReturns) this.persistNarrowings(elseFacts);
        else if (statement.elseBody && elseReturns && !thenReturns) this.persistNarrowings(thenFacts);
        else if (statement.elseBody && !thenReturns && !elseReturns) {
          this.persistNarrowings(this.commonNarrowings([thenFacts, elseFacts]));
        }
        break;
      }
      case "MatchStatement": {
        const matched = this.inferExpression(statement.value);
        if (matched.kind === "unknown" && !isInvalidType(matched)) {
          this.typeError("Validate an unknown value before matching it", statement.value.span);
        }
        const flowBaseline = this.snapshotFlowFacts();
        const visibleAtMatch = this.visibleBindings();
        const continuingInvalidations: FlowFactInvalidations[] = [];
        const continuingFacts: ReadonlyMap<string, ValueType>[] = [];
        const fallthroughInvalidations: FlowFactInvalidations[] = [];
        const coveredValues = new Set<string>();
        const coveredEnumMembers = new Set<string>();
        const coveredTypes: ValueType[] = [];
        const coveredListLengths = new Set<number>();
        let coveredListMinimum: number | null = null;
        let universalCovered = false;
        let fallthroughType = matched;
        let fallthroughNarrowings = this.matchLocationNarrowing(statement.value, matched);
        for (const branch of statement.cases) {
          const branchReachable = !universalCovered;
          if (!branchReachable) {
            this.diagnostics.push(diagnostic("VEL4014", "This match branch is already covered", branch.pattern.span));
          }
          const bindings = new Map<string, { readonly type: ValueType; readonly span: Span }>();
          let patternNarrowings: ReadonlyMap<string, ValueType> = new Map();
          let patternSurviving: ReadonlyMap<string, ValueType> = new Map();
          const patternBaseline = this.flowSnapshotAfterInvalidations(flowBaseline, fallthroughInvalidations);
          const patternInvalidations = this.analyzeIsolatedFlow(patternBaseline, () => {
            this.enterScope();
            try {
              this.applyNarrowings(fallthroughNarrowings, branch.pattern.span);
              if (this.matchPatternReflectionMayExecute(branch.pattern, fallthroughType)) this.invalidateEffectfulFlowFacts();
              const narrowedMatch = this.analyzeMatchPattern(branch.pattern, fallthroughType, bindings);
              patternSurviving = this.survivingNarrowings(fallthroughNarrowings);
              patternNarrowings = this.retargetNarrowings(patternSurviving, narrowedMatch);
            } finally {
              this.exitScope();
            }
          });
          if (branchReachable) fallthroughInvalidations.push(patternInvalidations);
          const rootPattern = this.unwrapMatchAs(branch.pattern);
          if (rootPattern.kind === "MatchValuePattern") {
            for (const value of rootPattern.values) {
              const key = this.matchValueKey(value);
              if (!branch.guard && coveredValues.has(key)) {
                this.diagnostics.push(diagnostic("VEL4013", `Match value '${key}' is declared more than once`, value.span));
              }
              if (!branch.guard) coveredValues.add(key);
              if (!branch.guard && matched.kind === "enum" && value.kind === "MemberExpression") {
                coveredEnumMembers.add(value.property);
              }
            }
          } else if (rootPattern.kind === "MatchTypePattern") {
            const checked = this.resolveAnnotation(rootPattern.type);
            if (!branch.guard) {
              if (coveredTypes.some((covered) => isAssignable(checked, covered, this))) {
                this.diagnostics.push(diagnostic("VEL4014", `Type pattern ${describeType(checked)} is already covered`, rootPattern.span));
              }
              coveredTypes.push(checked);
              if (isAssignable(matched, checked, this)) universalCovered = true;
            }
          } else if (rootPattern.kind === "MatchWildcardPattern" && !branch.guard) {
            universalCovered = true;
          } else if (rootPattern.kind === "MatchListPattern" && !branch.guard
            && rootPattern.elements.every((element) => this.matchPatternIsIrrefutable(element))) {
            if (rootPattern.rest) {
              coveredListMinimum = coveredListMinimum === null
                ? rootPattern.elements.length
                : Math.min(coveredListMinimum, rootPattern.elements.length);
            } else {
              coveredListLengths.add(rootPattern.elements.length);
            }
          } else if (rootPattern.kind === "MatchObjectPattern" && !branch.guard) {
            for (const candidate of this.matchObjectCandidates(matched)) {
              if (candidate.kind !== "any" && this.matchPatternCoversType(rootPattern, candidate)
                && !coveredTypes.some((covered) => sameType(covered, candidate))) {
                coveredTypes.push(candidate);
              }
            }
          }
          if (!branch.guard && !universalCovered && this.matchTypeFullyCovered(
            matched,
            coveredTypes,
            coveredValues,
            coveredEnumMembers,
            coveredListLengths,
            coveredListMinimum,
          )) {
            universalCovered = true;
          }

          let guardNarrowings: ReadonlyMap<string, ValueType> = new Map();
          let guardFallthroughNarrowings: ReadonlyMap<string, ValueType> = patternSurviving;
          if (branch.guard) {
            const guardBaseline = this.flowSnapshotAfterInvalidations(flowBaseline, fallthroughInvalidations);
            const guardInvalidations = this.analyzeIsolatedFlow(guardBaseline, () => {
              this.enterScope();
              try {
                for (const [name, binding] of bindings) {
                  this.declareBinding(name, false, binding.type, binding.span);
                }
                const guard = this.inferConditionWithNarrowings(branch.guard!, patternNarrowings);
                guardNarrowings = this.combineNarrowings(guard.surviving, guard.truthy);
                guardFallthroughNarrowings = this.retargetNarrowings(guard.surviving, fallthroughType);
              } finally {
                this.exitScope();
              }
            });
            if (branchReachable) fallthroughInvalidations.push(guardInvalidations);
          }

          const bodyBaseline = this.flowSnapshotAfterInvalidations(flowBaseline, fallthroughInvalidations);
          let branchFacts: ReadonlyMap<string, ValueType> = new Map();
          const branchInvalidations = this.analyzeIsolatedFlow(bodyBaseline, () => {
            this.enterScope();
            try {
              for (const [name, binding] of bindings) {
                this.declareBinding(name, false, binding.type, binding.span);
              }
              this.applyNarrowings(branch.guard ? guardNarrowings : patternNarrowings, branch.body[0]?.span ?? branch.span);
              this.analyzeStatements(branch.body);
              branchFacts = this.narrowingsForVisibleBindings(visibleAtMatch);
            } finally {
              this.exitScope();
            }
          });
          if (branchReachable && !this.blockAlwaysReturns(branch.body)) {
            continuingInvalidations.push(...fallthroughInvalidations, branchInvalidations);
            continuingFacts.push(branchFacts);
          }
          if (branchReachable) {
            if (branch.guard) {
              fallthroughNarrowings = guardFallthroughNarrowings;
            } else {
              fallthroughType = this.matchFallthroughType(fallthroughType, rootPattern);
              fallthroughNarrowings = this.retargetNarrowings(patternSurviving, fallthroughType);
            }
          }
        }
        if (statement.elseBody) {
          if (universalCovered) {
            this.diagnostics.push(diagnostic("VEL4014", "The match else branch is already covered", statement.elseBody[0]?.span ?? statement.span));
          }
          const elseBaseline = this.flowSnapshotAfterInvalidations(flowBaseline, fallthroughInvalidations);
          let elseFacts: ReadonlyMap<string, ValueType> = new Map();
          const elseInvalidations = this.analyzeIsolatedFlow(elseBaseline, () => {
            elseFacts = this.analyzeBlock(statement.elseBody!, fallthroughNarrowings);
          });
          if (!universalCovered && !this.blockAlwaysReturns(statement.elseBody)) {
            continuingInvalidations.push(...fallthroughInvalidations, elseInvalidations);
            continuingFacts.push(elseFacts);
          }
        }
        const exhaustive = Boolean(statement.elseBody) || universalCovered || this.matchTypeFullyCovered(
          matched,
          coveredTypes,
          coveredValues,
          coveredEnumMembers,
          coveredListLengths,
          coveredListMinimum,
        );
        if (exhaustive) {
          this.exhaustiveMatches.add(statement.span.start);
        } else if (matched.kind === "enum") {
          const missing = [...(this.enums.get(matched.identity)?.members ?? this.enums.get(matched.name)?.members ?? [])]
            .filter((member) => !coveredEnumMembers.has(member));
          if (missing.length > 0) {
            this.diagnostics.push(diagnostic("VEL4015", `Match on ${matched.name} is missing: ${missing.join(", ")}`, statement.span));
          }
        }
        if (!exhaustive) {
          const unmatched = this.flowSnapshotAfterInvalidations(flowBaseline, fallthroughInvalidations);
          continuingInvalidations.push(...fallthroughInvalidations);
          continuingFacts.push(this.combineNarrowings(
            this.narrowingsInSnapshot(unmatched, visibleAtMatch, flowBaseline),
            fallthroughNarrowings,
          ));
        }
        this.restoreFlowFacts(flowBaseline);
        this.applyFlowInvalidations(continuingInvalidations);
        if (continuingFacts.length > 0) {
          this.persistNarrowings(this.commonNarrowings(continuingFacts));
        }
        break;
      }
      case "ForStatement": {
        const iterable = this.inferExpression(statement.iterable);
        if (this.listReflectionMayExecute(iterable)) this.invalidateEffectfulFlowFacts();
        const element = iterable.kind === "list" || iterable.kind === "set"
          ? iterable.element
          : iterable.kind === "map" ? iterable.key : iterable.kind === "string" ? stringType : unknownType;
        if (iterable.kind !== "list" && iterable.kind !== "set" && iterable.kind !== "map" && iterable.kind !== "string" && iterable.kind !== "any") {
          this.typeError(`Cannot iterate over ${describeType(iterable)}`, statement.iterable.span);
        }
        const baseline = this.snapshotFlowFacts();
        const bodyInvalidations = this.analyzeIsolatedFlow(baseline, () => {
          this.enterScope();
          try {
            if (this.bindingPatternReflectionMayExecute(statement.pattern, element)) this.invalidateEffectfulFlowFacts();
            this.declarePattern(statement.pattern, false, element);
            if (statement.iterable.kind === "ListExpression"
              && statement.iterable.elements.every((item) => item.kind !== "SpreadExpression")) {
              for (const item of statement.iterable.elements) {
                this.validateKnownBindingShape(statement.pattern, item);
              }
            }
            this.loopDepth += 1;
            this.analyzeStatements(statement.body);
            this.loopDepth -= 1;
          } finally {
            this.exitScope();
          }
        });
        if (!this.blockAlwaysReturns(statement.body)) this.applyFlowInvalidations([bodyInvalidations]);
        break;
      }
      case "WhileStatement": {
        const condition = this.inferExpression(statement.condition);
        this.requireCondition(condition, statement.condition);
        const truthy = this.narrowingFor(statement.condition, condition);
        const falsy = this.negativeNarrowingFor(statement.condition, condition);
        const baseline = this.snapshotFlowFacts();
        const bodyInvalidations = this.analyzeIsolatedFlow(baseline, () => {
          this.loopDepth += 1;
          this.analyzeBlock(statement.body, truthy);
          this.loopDepth -= 1;
        });
        if (this.blockAlwaysReturns(statement.body)) this.persistNarrowings(falsy);
        else this.applyFlowInvalidations([bodyInvalidations]);
        break;
      }
      case "BreakStatement":
      case "ContinueStatement":
        if (this.loopDepth === 0) {
          this.diagnostics.push(diagnostic("VEL3005", `'${statement.kind === "BreakStatement" ? "break" : "continue"}' can only be used in a loop`, statement.span));
        } else if (this.finallyLoopDepths.some((depth) => this.loopDepth <= depth)) {
          this.diagnostics.push(diagnostic("VEL3015", `'${statement.kind === "BreakStatement" ? "break" : "continue"}' cannot leave a finally block`, statement.span));
        }
        break;
      case "TryStatement": {
        const baseline = this.snapshotFlowFacts();
        let tryFacts: ReadonlyMap<string, ValueType> = new Map();
        const tryInvalidations = this.analyzeIsolatedFlow(baseline, () => {
          tryFacts = this.analyzeBlock(statement.tryBody);
        });
        const continuingInvalidations: FlowFactInvalidations[][] = [];
        const continuingFacts: ReadonlyMap<string, ValueType>[] = [];
        if (!this.blockAlwaysReturns(statement.tryBody)) {
          continuingInvalidations.push([tryInvalidations]);
          continuingFacts.push(tryFacts);
        }

        let catchInvalidations: FlowFactInvalidations | null = null;
        if (statement.catchBody) {
          const catchBaseline = this.flowSnapshotAfterInvalidations(baseline, [tryInvalidations]);
          let catchFacts: ReadonlyMap<string, ValueType> = new Map();
          catchInvalidations = this.analyzeIsolatedFlow(catchBaseline, () => {
            const visible = this.visibleBindings();
            this.enterScope();
            try {
              if (statement.catchName) {
                this.declareBinding(statement.catchName, false, { kind: "class", name: "Error" }, statement.span);
              }
              this.analyzeStatements(statement.catchBody!);
              catchFacts = this.narrowingsForVisibleBindings(visible);
            } finally {
              this.exitScope();
            }
          });
          if (!this.blockAlwaysReturns(statement.catchBody)) {
            continuingInvalidations.push([tryInvalidations, catchInvalidations]);
            continuingFacts.push(catchFacts);
          }
        }

        if (statement.finallyBody) {
          const beforeFinally = this.flowSnapshotAfterInvalidations(
            baseline,
            catchInvalidations ? [tryInvalidations, catchInvalidations] : [tryInvalidations],
          );
          let finallyFacts: ReadonlyMap<string, ValueType> = new Map();
          const finallyInvalidations = this.analyzeIsolatedFlow(beforeFinally, () => {
            this.finallyLoopDepths.push(this.loopDepth);
            try {
              finallyFacts = this.analyzeBlock(statement.finallyBody!);
            } finally {
              this.finallyLoopDepths.pop();
            }
          });
          if (!this.blockAlwaysReturns(statement.finallyBody) && continuingFacts.length > 0) {
            this.restoreFlowFacts(beforeFinally);
            this.applyFlowInvalidations([finallyInvalidations]);
            this.persistNarrowings(finallyFacts);
          } else {
            this.restoreFlowFacts(baseline);
          }
        } else {
          this.restoreFlowFacts(baseline);
          this.applyFlowInvalidations(continuingInvalidations.flat());
          if (continuingFacts.length > 0) {
            this.persistNarrowings(this.commonNarrowings(continuingFacts));
          }
        }
        break;
      }
      case "PassStatement":
        break;
      case "AssignmentStatement":
        this.analyzeAssignment(statement);
        break;
      case "ExpressionStatement":
        this.inferExpression(statement.expression);
        break;
    }
  }

  private analyzeTypeDeclaration(statement: TypeDeclaration): void {
    if (!this.predeclared.has(statement)) this.declareBinding(statement.name, false, { kind: "typeObject", name: statement.name }, statement.span);
    const seen = new Set<string>();
    for (const field of statement.fields) {
      if (seen.has(field.name)) {
        this.diagnostics.push(diagnostic("VEL4004", `Type '${statement.name}' declares '${field.name}' more than once`, field.span));
      }
      seen.add(field.name);
    }
  }

  private analyzeTypeAliasDeclaration(statement: TypeAliasDeclaration): void {
    if (!this.predeclared.has(statement)) this.declareBinding(statement.name, false, { kind: "typeObject", name: statement.name }, statement.span);
  }

  private analyzeClassDeclaration(statement: ClassDeclaration): void {
    const outerConstructorDepth = this.constructorDepth;
    const outerClass = this.currentClass;
    this.constructorDepth = 0;
    this.currentClass = statement.name;
    if (!this.predeclared.has(statement)) this.declareBinding(statement.name, false, { kind: "classConstructor", name: statement.name }, statement.span);
    const baseName = statement.base?.name ?? null;
    if (baseName) {
      const baseBinding = this.lookup(baseName) ?? this.builtin(baseName);
      if (baseBinding?.type.kind !== "classConstructor" || !this.classes.has(baseName)) {
        this.typeError(`Unknown base class '${baseName}'`, statement.base!.span);
      } else if (baseName === statement.name || this.isSubclassOf(baseName, statement.name)) {
        this.typeError(`Class '${statement.name}' has a cyclic inheritance relationship`, statement.base!.span);
      }
    }

    this.enterScope();
    this.flowFrameDepth += 1;
    for (const parameter of statement.parameters) {
      const type = this.resolveAnnotation(parameter.type);
      const valid = parameter.type ? this.validateTypeReference(parameter.type) : true;
      if (parameter.defaultValue && valid) {
        this.requireAssignable(this.inferParameterDefault(parameter.defaultValue, type), type, parameter.defaultValue.span);
      }
      const declared = valid ? type : invalidType;
      this.declareBinding(parameter.name, false, parameter.rest ? { kind: "list", element: declared } : declared, parameter.span);
    }
    if (statement.base?.arguments.length) {
      this.typeError("Base constructor arguments belong in 'super(...)' inside the constructor", statement.base.span);
    }
    for (const field of statement.fields) {
      if (field.static) continue;
      const declared = this.resolveAnnotation(field.type);
      const valid = this.validateTypeReference(field.type);
      if (field.initializer) {
        this.classFieldInitializerDepth += 1;
        const actual = this.inferExpression(field.initializer, valid ? declared : invalidType);
        this.classFieldInitializerDepth -= 1;
        if (valid) this.requireAssignable(actual, declared, field.initializer.span);
      }
    }
    this.validateConstructorShape(statement);
    if (statement.initialization) this.analyzeClassInitialization(statement);
    this.flowFrameDepth -= 1;
    this.exitScope();

    for (const field of statement.fields) {
      if (!field.static) continue;
      const declared = this.resolveAnnotation(field.type);
      const valid = this.validateTypeReference(field.type);
      if (!field.initializer) {
        this.typeError(`Static field '${field.name}' requires an initializer`, field.span);
        continue;
      }
      this.classFieldInitializerDepth += 1;
      const actual = this.inferExpression(field.initializer, valid ? declared : invalidType);
      this.classFieldInitializerDepth -= 1;
      if (valid) this.requireAssignable(actual, declared, field.initializer.span);
    }

    const ownFields = new Set<string>();
    const instanceFields = [
      ...statement.parameters.filter((parameter) => parameter.binding).map((parameter) => ({
        name: parameter.name,
        mutable: parameter.binding === "let",
        type: this.resolveAnnotation(parameter.type),
        span: parameter.span,
        private: parameter.private,
      })),
      ...statement.fields.filter((field) => !field.static).map((field) => ({
        name: field.name,
        mutable: field.binding === "let",
        type: this.resolveAnnotation(field.type),
        span: field.span,
        private: field.private,
      })),
    ];
    for (const field of instanceFields) {
      if (ownFields.has(field.name)) this.typeError(`Class '${statement.name}' declares field '${field.name}' more than once`, field.span);
      ownFields.add(field.name);
      const inheritedField = baseName ? this.findField(baseName, field.name) : null;
      const inheritedGetter = baseName ? this.findGetter(baseName, field.name) : null;
      const inheritedMethod = baseName ? this.findMethod(baseName, field.name) : null;
      if (field.private && (inheritedField || inheritedGetter || inheritedMethod)) {
        this.typeError(`Private field '${field.name}' conflicts with an inherited public member`, field.span);
        continue;
      }
      if (inheritedGetter || inheritedMethod) {
        this.typeError(`Field '${field.name}' conflicts with an inherited ${inheritedGetter ? "getter" : "method"}`, field.span);
      }
      if (inheritedField) {
        if (inheritedField.mutable !== field.mutable || !sameType(inheritedField.type, field.type)) {
          this.typeError(`Inherited field '${field.name}' must keep its ${inheritedField.mutable ? "let" : "const"} ${describeType(inheritedField.type)} contract`, field.span);
        }
      }
    }

    const ownStaticFields = new Set<string>();
    for (const field of statement.fields.filter((candidate) => candidate.static)) {
      if (ownStaticFields.has(field.name)) this.typeError(`Class '${statement.name}' declares static field '${field.name}' more than once`, field.span);
      ownStaticFields.add(field.name);
      const inheritedMethod = baseName ? this.findStaticMethod(baseName, field.name) : null;
      const inheritedGetter = baseName ? this.findStaticGetter(baseName, field.name) : null;
      const inheritedField = baseName ? this.findStaticField(baseName, field.name) : null;
      if (field.private && (inheritedField || inheritedGetter || inheritedMethod)) {
        this.typeError(`Private static field '${field.name}' conflicts with an inherited public static member`, field.span);
        continue;
      }
      if (inheritedGetter || inheritedMethod) this.typeError(`Static field '${field.name}' conflicts with an inherited static ${inheritedGetter ? "getter" : "method"}`, field.span);
    }

    const privateNames = new Set<string>();
    for (const member of [
      ...statement.parameters.filter((parameter) => parameter.private),
      ...statement.fields.filter((field) => field.private),
      ...statement.getters.filter((getter) => getter.private),
      ...statement.methods.filter((method) => method.private),
    ]) {
      if (privateNames.has(member.name)) {
        this.typeError(`Class '${statement.name}' declares private member '${member.name}' more than once`, member.span);
      }
      privateNames.add(member.name);
    }

    const ownGetterNames = new Set<string>();
    for (const getter of statement.getters) {
      const key = `${getter.static ? "static:" : "instance:"}${getter.name}`;
      if (ownGetterNames.has(key)) this.typeError(`Class '${statement.name}' declares getter '${getter.name}' more than once`, getter.span);
      ownGetterNames.add(key);
      if ((!getter.static && ownFields.has(getter.name)) || (getter.static && ownStaticFields.has(getter.name))) {
        this.typeError(`${getter.static ? "Static g" : "G"}etter '${getter.name}' conflicts with a field declared by class '${statement.name}'`, getter.span);
      }
      if (statement.methods.some((method) => method.name === getter.name && method.static === getter.static)) {
        this.typeError(`${getter.static ? "Static g" : "G"}etter '${getter.name}' conflicts with a method declared by class '${statement.name}'`, getter.span);
      }
      const inheritedField = baseName ? (getter.static ? this.findStaticField(baseName, getter.name) : this.findField(baseName, getter.name)) : null;
      const inheritedMethod = baseName ? (getter.static ? this.findStaticMethod(baseName, getter.name) : this.findMethod(baseName, getter.name)) : null;
      const inheritedGetter = baseName ? (getter.static
        ? this.findStaticGetter(baseName, getter.name)
        : this.findGetter(baseName, getter.name)) : null;
      if (getter.private && (inheritedField || inheritedMethod || inheritedGetter)) {
        this.typeError(`Private${getter.static ? " static" : ""} getter '${getter.name}' conflicts with an inherited public member`, getter.span);
      }
      if (!getter.private && (inheritedField || inheritedMethod)) {
        this.typeError(`Getter '${getter.name}' conflicts with an inherited ${inheritedField ? "field" : "method"}`, getter.span);
      }
      if (getter.abstract && !statement.abstract) {
        this.typeError(`Concrete class '${statement.name}' cannot declare abstract getter '${getter.name}'`, getter.span);
      }
      if (getter.abstract && getter.static) this.typeError(`Abstract getter '${getter.name}' cannot be static`, getter.span);
      if (getter.abstract && getter.override) this.typeError(`Abstract getter '${getter.name}' cannot also be an override`, getter.span);
      if (getter.private && getter.abstract) this.typeError(`Private getter '${getter.name}' cannot be abstract`, getter.span);
      if (getter.private && getter.override) this.typeError(`Private getter '${getter.name}' cannot use 'override'`, getter.span);
      if (getter.static && getter.override) this.typeError(`Static getter '${getter.name}' cannot use 'override'`, getter.span);
      if (getter.static && !getter.private && inheritedGetter) {
        this.typeError(`Static getter '${getter.name}' conflicts with an inherited static getter`, getter.span);
      }
      if (!getter.static && !getter.private) {
        const inheritedInstanceGetter = baseName ? this.findGetter(baseName, getter.name) : null;
        if (getter.override && !inheritedInstanceGetter) {
          this.typeError(`Getter '${getter.name}' uses 'override' but no base getter exists`, getter.span);
        } else if (!getter.override && inheritedInstanceGetter && !getter.abstract) {
          this.typeError(`Getter '${getter.name}' overrides a base getter and must use 'override'`, getter.span);
        }
        if (getter.override && inheritedInstanceGetter && !sameType(this.resolveResult(getter.returnType), inheritedInstanceGetter.type)) {
          this.typeError(`Getter override '${getter.name}' must keep the base result ${describeType(inheritedInstanceGetter.type)}`, getter.span);
        }
      }
      if (getter.abstract) this.validateMethodSignature(getter);
      else this.analyzeFunctionDeclaration(getter, statement.name, true, !getter.static);
    }

    const ownMethods = new Set<string>();
    for (const method of statement.methods) {
      if (!method.static && ownFields.has(method.name)) {
        this.typeError(`Method '${method.name}' conflicts with a field declared by class '${statement.name}'`, method.span);
      }
      if (method.static && ownStaticFields.has(method.name)) {
        this.typeError(`Static method '${method.name}' conflicts with a static field declared by class '${statement.name}'`, method.span);
      }
      if (!method.static && baseName && (this.findField(baseName, method.name) || this.findGetter(baseName, method.name))) {
        this.typeError(`Method '${method.name}' conflicts with an inherited field or getter`, method.span);
      }
      if (method.private && baseName && (method.static
        ? this.findStaticField(baseName, method.name) || this.findStaticMethod(baseName, method.name)
        : this.findField(baseName, method.name) || this.findGetter(baseName, method.name) || this.findMethod(baseName, method.name))) {
        this.typeError(`Private${method.static ? " static" : ""} method '${method.name}' conflicts with an inherited public member`, method.span);
      }
      if (ownMethods.has(`${method.static ? "static:" : "instance:"}${method.name}`)) {
        this.typeError(`Class '${statement.name}' declares method '${method.name}' more than once`, method.span);
      }
      ownMethods.add(`${method.static ? "static:" : "instance:"}${method.name}`);
      if (method.abstract && !statement.abstract) {
        this.typeError(`Concrete class '${statement.name}' cannot declare abstract method '${method.name}'`, method.span);
      }
      if (method.abstract && method.static) {
        this.typeError(`Abstract method '${method.name}' cannot be static`, method.span);
      }
      if (method.abstract && method.override) {
        this.typeError(`Abstract method '${method.name}' cannot also be an override`, method.span);
      }
      if (method.private && method.abstract) {
        this.typeError(`Private method '${method.name}' cannot be abstract`, method.span);
      }
      if (method.private && method.override) {
        this.typeError(`Private method '${method.name}' cannot use 'override'`, method.span);
      }
      if (method.static && method.override) {
        this.typeError(`Static method '${method.name}' cannot use 'override'`, method.span);
      }
      const inherited = baseName && !method.static && !method.private ? this.findMethod(baseName, method.name) : null;
      if (method.override && !inherited) {
        this.typeError(`Method '${method.name}' uses 'override' but no base method exists`, method.span);
      } else if (!method.override && inherited && !method.abstract) {
        this.typeError(`Method '${method.name}' overrides a base method and must use 'override'`, method.span);
      }
      if (method.override && inherited && !sameType(this.functionType(method), inherited.type)) {
        this.typeError(`Override '${method.name}' must keep the base method signature ${describeType(inherited.type)}`, method.span);
      }
      if (method.abstract) this.validateMethodSignature(method);
      else this.analyzeFunctionDeclaration(method, statement.name, true, !method.static);
    }

    if (!statement.abstract) {
      const missing = this.unimplementedAbstractMethods(statement.name);
      if (missing.length > 0) {
        this.typeError(`Concrete class '${statement.name}' must implement abstract method${missing.length === 1 ? "" : "s"}: ${missing.join(", ")}`, statement.span);
      }
    }
    this.constructorDepth = outerConstructorDepth;
    this.currentClass = outerClass;
  }

  private analyzeClassInitialization(statement: ClassDeclaration): void {
    const initialization = statement.initialization;
    if (!initialization) return;
    this.enterScope();
    this.flowFrameDepth += 1;
    this.functionDepth += 1;
    const previousLoopDepth = this.loopDepth;
    this.loopDepth = 0;
    const previousFinallyLoopDepths = this.finallyLoopDepths;
    this.finallyLoopDepths = [];
    const previousClass = this.currentClass;
    this.currentClass = statement.name;
    this.asynchronousFunctions.push(false);
    this.returnTypes.push(nullType);
    this.constructorDepth += 1;
    this.declareBinding("self", false, { kind: "class", name: statement.name }, initialization.span, true);
    this.analyzeStatements(initialization.body);
    this.constructorDepth -= 1;
    this.returnTypes.pop();
    this.asynchronousFunctions.pop();
    this.currentClass = previousClass;
    this.loopDepth = previousLoopDepth;
    this.finallyLoopDepths = previousFinallyLoopDepths;
    this.functionDepth -= 1;
    this.flowFrameDepth -= 1;
    this.exitScope();
  }

  private validateConstructorShape(statement: ClassDeclaration): void {
    const body = statement.initialization?.body ?? [];
    const isSuperCall = (item: Statement | undefined): boolean => item?.kind === "ExpressionStatement"
      && item.expression.kind === "CallExpression"
      && item.expression.callee.kind === "SuperExpression";
    if (statement.base && statement.initialization && !isSuperCall(body[0])) {
      this.typeError(`Derived constructor for '${statement.name}' must call 'super(...)' first`, statement.initialization.span);
    }
    if (statement.base && !statement.initialization) {
      const base = this.classes.get(statement.base.name);
      if ((base?.requiredParameters ?? 0) > 0) {
        this.typeError(`Class '${statement.name}' requires a constructor that calls 'super(...)'`, statement.span);
      }
    }
    if (!statement.base && isSuperCall(body[0])) {
      this.typeError(`Base class '${statement.name}' cannot call 'super(...)'`, body[0]!.span);
    }
    const initialized = new Set<string>();
    for (const item of body.slice(statement.base ? 1 : 0)) {
      if (item.kind !== "AssignmentStatement" || item.operator !== "=" || item.target.kind !== "MemberExpression"
        || item.target.object.kind !== "IdentifierExpression" || item.target.object.name !== "self") continue;
      if (initialized.has(item.target.property)) {
        this.typeError(`Constructor initializes field '${item.target.property}' more than once`, item.target.span);
        continue;
      }
      initialized.add(item.target.property);
      this.constructorFieldInitializations.add(item.target.span.start);
    }
    for (const field of statement.fields) {
      if (!field.static && !field.initializer && !initialized.has(field.name)) {
        this.typeError(`Field '${field.name}' requires an initializer or one direct 'self.${field.name} = ...' constructor assignment`, field.span);
      }
    }
  }

  private validateMethodSignature(method: ClassDeclaration["methods"][number]): void {
    for (const parameter of method.parameters) {
      const type = this.resolveAnnotation(parameter.type);
      const valid = parameter.type ? this.validateTypeReference(parameter.type) : true;
      if (parameter.defaultValue && valid) this.requireAssignable(this.inferParameterDefault(parameter.defaultValue, type), type, parameter.defaultValue.span);
    }
    if (method.returnType) {
      const result = this.resolveAnnotation(method.returnType);
      const valid = this.validateTypeReference(method.returnType);
      if (valid && method.asynchronous && this.asyncResultContainsPromise(result)) {
        this.diagnostics.push(diagnostic("VEL4018", "An async result annotation names the resolved value; write '-> T', not '-> Promise<T>'", method.returnType.span));
      }
    }
  }

  private findField(className: string, name: string): ClassField | null {
    let current: string | null = className;
    const visited = new Set<string>();
    while (current && !visited.has(current)) {
      visited.add(current);
      const info = this.classes.get(current);
      const field = info?.getters.has(name) ? null : info?.fields.get(name);
      if (field) return field;
      current = info?.base ?? null;
    }
    return null;
  }

  private findGetter(className: string, name: string): { readonly owner: string; readonly type: ValueType; readonly abstract: boolean } | null {
    let current: string | null = className;
    const visited = new Set<string>();
    while (current && !visited.has(current)) {
      visited.add(current);
      const info = this.classes.get(current);
      const getter = info?.getters.has(name) ? info.fields.get(name) : null;
      if (getter) return { owner: current, type: getter.type, abstract: info?.abstractGetters.has(name) ?? false };
      current = info?.base ?? null;
    }
    return null;
  }

  private findMethod(className: string, name: string): { readonly owner: string; readonly type: ValueType; readonly abstract: boolean } | null {
    let current: string | null = className;
    const visited = new Set<string>();
    while (current && !visited.has(current)) {
      visited.add(current);
      const info = this.classes.get(current);
      const method = info?.methods.get(name);
      if (method) return { owner: current, type: method, abstract: info?.abstractMethods.has(name) ?? false };
      current = info?.base ?? null;
    }
    return null;
  }

  private findStaticField(className: string, name: string): ClassField | null {
    let current: string | null = className;
    const visited = new Set<string>();
    while (current && !visited.has(current)) {
      visited.add(current);
      const info = this.classes.get(current);
      const field = info?.staticGetters.has(name) ? null : info?.staticFields.get(name);
      if (field) return field;
      current = info?.base ?? null;
    }
    return null;
  }

  private findStaticGetter(className: string, name: string): ValueType | null {
    let current: string | null = className;
    const visited = new Set<string>();
    while (current && !visited.has(current)) {
      visited.add(current);
      const info = this.classes.get(current);
      const getter = info?.staticGetters.has(name) ? info.staticFields.get(name) : null;
      if (getter) return getter.type;
      current = info?.base ?? null;
    }
    return null;
  }

  private findStaticMethod(className: string, name: string): ValueType | null {
    let current: string | null = className;
    const visited = new Set<string>();
    while (current && !visited.has(current)) {
      visited.add(current);
      const info = this.classes.get(current);
      const method = info?.staticMethods.get(name);
      if (method) return method;
      current = info?.base ?? null;
    }
    return null;
  }

  private privateFieldForAccess(className: string, name: string, staticMember: boolean): ClassField | null {
    if (!this.currentClass) return null;
    const accessible = staticMember
      ? className === this.currentClass
      : this.isSubclassOf(className, this.currentClass);
    if (!accessible) return null;
    return (staticMember ? this.privateStaticFields : this.privateFields).get(this.currentClass)?.get(name) ?? null;
  }

  private privateMethodForAccess(className: string, name: string, staticMember: boolean): ValueType | null {
    if (!this.currentClass) return null;
    const accessible = staticMember
      ? className === this.currentClass
      : this.isSubclassOf(className, this.currentClass);
    if (!accessible) return null;
    return (staticMember ? this.privateStaticMethods : this.privateMethods).get(this.currentClass)?.get(name) ?? null;
  }

  private declaresPrivateMember(className: string, name: string, staticMember: boolean): boolean {
    const fields = (staticMember ? this.privateStaticFields : this.privateFields).get(className);
    const methods = (staticMember ? this.privateStaticMethods : this.privateMethods).get(className);
    return fields?.has(name) === true || methods?.has(name) === true;
  }

  private unimplementedAbstractMethods(className: string): string[] {
    const chain: ClassInfo[] = [];
    let current: string | null = className;
    const visited = new Set<string>();
    while (current && !visited.has(current)) {
      visited.add(current);
      const info = this.classes.get(current);
      if (!info) break;
      chain.unshift(info);
      current = info.base;
    }
    const missing = new Set<string>();
    for (const info of chain) {
      for (const name of info.abstractMethods) missing.add(name);
      for (const name of info.methods.keys()) if (!info.abstractMethods.has(name)) missing.delete(name);
      for (const name of info.abstractGetters) missing.add(name);
      for (const name of info.getters) if (!info.abstractGetters.has(name)) missing.delete(name);
    }
    return [...missing].sort();
  }

  protected analyzeFunctionDeclaration(
    statement: AnalyzableFunctionDeclaration,
    className: string | null,
    method = false,
    declareSelf = Boolean(className),
    forceAsynchronous = false,
    declarationKind = "accessor" in statement ? "Getter" : "Function",
  ): void {
    const outerConstructorDepth = this.constructorDepth;
    if (!method && !className && !this.predeclared.has(statement)) {
      this.declareBinding(statement.name, false, this.functionType(statement as FunctionDeclaration), statement.span);
    }
    this.enterScope();
    this.flowFrameDepth += 1;
    this.functionDepth += 1;
    const previousLoopDepth = this.loopDepth;
    this.loopDepth = 0;
    const previousFinallyLoopDepths = this.finallyLoopDepths;
    this.finallyLoopDepths = [];
    const previousClass = this.currentClass;
    this.currentClass = className ?? previousClass;
    const asynchronous = forceAsynchronous || statement.asynchronous === true;
    this.asynchronousFunctions.push(asynchronous);
    const declaredReturn = this.resolveResult(statement.returnType);
    const returnValid = statement.returnType ? this.validateTypeReference(statement.returnType) : true;
    if (asynchronous && statement.returnType && returnValid && this.asyncResultContainsPromise(declaredReturn)) {
      this.diagnostics.push(diagnostic("VEL4018", "An async result annotation names the resolved value; write '-> T', not '-> Promise<T>'", statement.returnType.span));
    }
    const expectedReturn = returnValid
      ? asynchronous ? this.resolvedAsyncResult(declaredReturn) : declaredReturn
      : invalidType;
    this.returnTypes.push(expectedReturn);
    if (className && declareSelf) {
      this.declareBinding("self", false, { kind: "class", name: className }, statement.span, true);
    }
    for (const parameter of statement.parameters) {
      const type = this.resolveAnnotation(parameter.type);
      const valid = parameter.type ? this.validateTypeReference(parameter.type) : true;
      if (parameter.defaultValue && valid) {
        this.requireAssignable(this.inferParameterDefault(parameter.defaultValue, type), type, parameter.defaultValue.span);
      }
      const declared = valid ? type : invalidType;
      this.declareBinding(parameter.name, false, parameter.rest ? { kind: "list", element: declared } : declared, parameter.span);
    }
    this.constructorDepth = 0;
    this.analyzeStatements(statement.body);
    if (statement.returnType && returnValid && expectedReturn.kind !== "null" && !this.blockAlwaysReturns(statement.body)) {
      this.diagnostics.push(diagnostic("VEL4006", `${declarationKind} '${statement.name}' can finish without returning ${describeType(expectedReturn)}`, statement.span));
    }
    this.returnTypes.pop();
    this.asynchronousFunctions.pop();
    this.currentClass = previousClass;
    this.loopDepth = previousLoopDepth;
    this.finallyLoopDepths = previousFinallyLoopDepths;
    this.functionDepth -= 1;
    this.flowFrameDepth -= 1;
    this.exitScope();
    this.constructorDepth = outerConstructorDepth;
  }

  protected analyzeBlock(
    statements: readonly Statement[],
    narrowed: ReadonlyMap<string, ValueType> = new Map(),
  ): ReadonlyMap<string, ValueType> {
    const visible = this.visibleBindings();
    this.enterScope();
    this.applyNarrowings(narrowed, statements[0]?.span ?? { start: 0, end: 0 });
    this.analyzeStatements(statements);
    const surviving = this.narrowingsForVisibleBindings(visible);
    this.exitScope();
    return surviving;
  }

  private survivingNarrowings(narrowed: ReadonlyMap<string, ValueType>): ReadonlyMap<string, ValueType> {
    const surviving = new Map<string, ValueType>();
    const scope = this.scopes.at(-1)!;
    const memberScope = this.memberNarrowings.at(-1)!;
    for (const [key, type] of narrowed) {
      if (key.startsWith(memberNarrowingPrefix)) {
        const current = memberScope.get(key.slice(memberNarrowingPrefix.length));
        if (current?.frame === this.flowFrameDepth && sameType(current.type, type)) surviving.set(key, type);
      } else {
        const current = scope.get(key);
        if (current?.narrowingFrame === this.flowFrameDepth && sameType(current.type, type)) surviving.set(key, type);
      }
    }
    return surviving;
  }

  protected analyzeStatements(statements: readonly Statement[]): void {
    let completedFlow: FlowFactsSnapshot | null = null;
    for (const statement of statements) {
      this.analyzeStatement(statement);
      if (!completedFlow && this.statementAlwaysExitsBlock(statement)) {
        completedFlow = this.snapshotFlowFacts();
      }
    }
    if (completedFlow) this.restoreFlowFacts(completedFlow);
  }

  private analyzeAssignment(statement: AssignmentStatement): void {
    let targetType = unknownType;
    let targetBinding: Binding | null = null;
    let targetWritable = true;
    let effectfulMemberWrite = false;
    let effectfulIndexWrite = false;

    if (statement.target.kind !== "IdentifierExpression" && continuesOptionalChain(statement.target)) {
      this.diagnostics.push(diagnostic("VEL3002", "Optional chains cannot be assignment targets", statement.target.span));
      targetWritable = false;
    }

    if (statement.target.kind === "IdentifierExpression") {
      const binding = this.lookup(statement.target.name);
      if (!binding) {
        this.diagnostics.push(diagnostic("VEL3001", `Unknown name '${statement.target.name}'`, statement.target.span));
        return;
      }
      if (!binding.mutable) {
        this.diagnostics.push(diagnostic("VEL3002", `Cannot assign to const binding '${statement.target.name}'`, statement.target.span));
        targetWritable = false;
      }
      targetBinding = binding;
      targetType = statement.operator === "=" ? binding.declaredType : binding.type;
    } else if (statement.target.kind === "MemberExpression") {
      targetType = this.inferMember(
        statement.target.object,
        statement.target.property,
        statement.target.optional,
        statement.target.span,
        statement.operator !== "=",
        statement.operator !== "=",
      );
      const owner = nonOptional(this.expandAliases(this.inferredOrAnalyze(statement.target.object)));
      effectfulMemberWrite = owner.kind === "any"
        || (owner.kind === "object" || owner.kind === "named") && owner.external === true
        || owner.kind === "class" && (owner.external === true || (owner.identity ?? owner.name).startsWith("js:"))
        || owner.kind === "classConstructor" && (owner.identity ?? owner.name).startsWith("js:");
      if (owner.kind === "class") {
        const key = owner.identity ?? owner.name;
        const info = this.classes.get(key) ?? this.classes.get(owner.name);
        const privateField = this.privateFieldForAccess(key, statement.target.property, false);
        const privateMethod = this.privateMethodForAccess(key, statement.target.property, false);
        const field = this.findField(key, statement.target.property);
        const getter = this.findGetter(key, statement.target.property);
        const method = this.findMethod(key, statement.target.property);
        if (privateField && (this.privateGetters.get(this.currentClass ?? "")?.has(statement.target.property) ?? false)) {
          this.diagnostics.push(diagnostic("VEL3002", `Cannot assign to private getter '${statement.target.property}'`, statement.target.span));
          targetWritable = false;
        } else if (privateField && !privateField.mutable && !this.constructorFieldInitializations.has(statement.target.span.start)) {
          this.diagnostics.push(diagnostic("VEL3002", `Cannot assign to private const field '${statement.target.property}'`, statement.target.span));
          targetWritable = false;
        } else if (privateMethod) {
          this.diagnostics.push(diagnostic("VEL3002", `Cannot assign to private method '${statement.target.property}'`, statement.target.span));
          targetWritable = false;
        } else if (field && !field.mutable && !this.constructorFieldInitializations.has(statement.target.span.start)) {
          const label = info?.identity ? "read-only member" : "const field";
          this.diagnostics.push(diagnostic("VEL3002", `Cannot assign to ${label} '${statement.target.property}'`, statement.target.span));
          targetWritable = false;
        } else if (getter) {
          const label = info?.identity?.startsWith("js:") ? "read-only member" : "getter";
          this.diagnostics.push(diagnostic("VEL3002", `Cannot assign to ${label} '${statement.target.property}'`, statement.target.span));
          targetWritable = false;
        } else if (method) {
          this.diagnostics.push(diagnostic("VEL3002", `Cannot assign to read-only member '${statement.target.property}'`, statement.target.span));
          targetWritable = false;
        }
      } else if (owner.kind === "classConstructor") {
        const key = owner.identity ?? owner.name;
        const privateField = this.privateFieldForAccess(key, statement.target.property, true);
        const privateMethod = this.privateMethodForAccess(key, statement.target.property, true);
        const field = this.findStaticField(key, statement.target.property);
        const getter = this.findStaticGetter(key, statement.target.property);
        const method = this.findStaticMethod(key, statement.target.property);
        if ((privateField && !privateField.mutable) || privateMethod) {
          this.diagnostics.push(diagnostic("VEL3002", `Cannot assign to private static member '${statement.target.property}'`, statement.target.span));
          targetWritable = false;
        } else if ((field && !field.mutable) || getter || method) {
          this.diagnostics.push(diagnostic("VEL3002", `Cannot assign to read-only static member '${statement.target.property}'`, statement.target.span));
          targetWritable = false;
        }
      } else if (owner.kind === "object" && owner.readonlyFields?.has(statement.target.property)) {
        this.diagnostics.push(diagnostic("VEL3002", `Cannot assign to read-only field '${statement.target.property}'`, statement.target.span));
        targetWritable = false;
      } else if (owner.kind === "object" && owner.optionalFields?.has(statement.target.property)) {
        targetType = owner.fields.get(statement.target.property) ?? targetType;
      }
    } else {
      const objectType = this.inferExpression(statement.target.object);
      const indexType = this.inferExpression(statement.target.index);
      if (objectType.kind === "list") {
        this.requireAssignable(indexType, numberType, statement.target.index.span);
        targetType = objectType.element;
        effectfulIndexWrite = objectType.external === true;
        if (effectfulIndexWrite && statement.operator !== "=") this.invalidateEffectfulFlowFacts();
      } else if (objectType.kind === "map") {
        this.typeError("Use Map.set(key, value) instead of bracket assignment", statement.target.span);
        targetWritable = false;
      } else {
        this.typeError(`Cannot index-assign ${describeType(objectType)}`, statement.target.span);
        targetWritable = false;
      }
    }

    const valueType = this.inferExpression(statement.value, statement.operator === "=" ? targetType : unknownType);

    if (statement.operator !== "=" && targetType.kind !== "number" && !(statement.operator === "+=" && targetType.kind === "string")) {
      this.typeError(`Operator '${statement.operator}' is not valid for ${describeType(targetType)}`, statement.span);
    }
    const assignmentValid = this.contextuallyAssignable(valueType, targetType, statement.value.span);
    this.requireAssignable(valueType, targetType, statement.value.span);
    if (targetWritable && assignmentValid) {
      if (statement.target.kind === "MemberExpression") {
        if (effectfulMemberWrite) this.invalidateEffectfulFlowFacts();
        else this.invalidateCurrentMemberNarrowings();
      } else if (statement.target.kind === "IndexExpression" && effectfulIndexWrite) {
        this.invalidateEffectfulFlowFacts();
      } else if (statement.operator === "=") {
        this.invalidateAssignmentNarrowings(statement.target, targetBinding);
        if (targetBinding?.mutable) {
          this.rebindCollectionInference(statement.target.kind === "IdentifierExpression" ? statement.target.name : "", targetBinding, statement.value, valueType);
        }
      }
    }
  }

  protected inferExpression(expression: Expression, contextualType: ValueType = unknownType): ValueType {
    const type = this.inferExpressionType(expression, contextualType);
    this.inferredExpressionTypes.set(spanIdentity(expression.span), type);
    const expanded = this.expandAliases(type);
    if (expanded.kind === "promise" && this.hasNullishContract(this.expandAliases(expanded.value))) {
      this.normalizedPromiseValues.add(spanIdentity(expression.span));
    } else if (this.shouldNormalizeNullish(expression, expanded)) {
      this.normalizedUndefinedExpressions.add(spanIdentity(expression.span));
    }
    this.recordSemanticExpression(expression, type);
    return type;
  }

  private inferredOrAnalyze(expression: Expression): ValueType {
    return this.inferredExpressionTypes.get(spanIdentity(expression.span)) ?? this.inferExpression(expression);
  }

  private hasNullishContract(type: ValueType): boolean {
    return type.kind === "null" || type.kind === "optional" || type.kind === "unknown"
      || type.kind === "union" && type.members.some((member) => this.hasNullishContract(this.expandAliases(member)));
  }

  private expressionAlreadyNormalizesUndefined(expression: Expression): boolean {
    if (expression.kind === "UnaryExpression" && expression.operator === "await") {
      return this.normalizedPromiseValues.has(spanIdentity(expression.operand.span));
    }
    if (expression.kind === "CallExpression") {
      return this.optionalCalls.has(spanIdentity(expression.span))
        || this.optionalCallees.has(spanIdentity(expression.span));
    }
    if (expression.kind === "IndexExpression") return this.optionalIndexes.has(spanIdentity(expression.span));
    return expression.kind === "MemberExpression" && this.optionalMembers.has(spanIdentity(expression.span));
  }

  private shouldNormalizeNullish(expression: Expression, type: ValueType): boolean {
    if (!this.hasNullishContract(type) || this.expressionAlreadyNormalizesUndefined(expression)) return false;
    return expression.kind !== "LiteralExpression";
  }

  private recordSemanticExpression(expression: Expression, type: ValueType): void {
    const indexable = (expression.kind !== "IdentifierExpression"
      || expression.name === "self"
      || this.privateSemanticContext(type) !== null)
      && expression.kind !== "LiteralExpression"
      && expression.kind !== "SuperExpression";
    if (indexable) {
      const members = this.semanticMembersOf(type);
      const callable = type.kind === "function" || type.kind === "intrinsic" || type.kind === "action";
      if (members.size > 0 || callable || expression.kind === "MemberExpression"
        || this.semanticExpressionContexts.has(spanIdentity(expression.span))) {
        const key = spanIdentity(expression.span);
        this.semanticExpressionTypes.set(key, type);
        this.semanticExpressionMembers.set(key, members);
      }
    }
  }

  private inferExpressionType(expression: Expression, contextualType: ValueType = unknownType): ValueType {
    const extensionType = this.inferExtensionExpression(expression, contextualType);
    if (extensionType) return extensionType;
    switch (expression.kind) {
      case "LiteralExpression":
        return expression.value === null ? nullType : typeof expression.value === "string" ? stringType : typeof expression.value === "number" ? numberType : boolType;
      case "FStringExpression":
        for (const part of expression.parts) {
          if (part.kind === "expression") {
            const value = this.inferExpression(part.value);
            if (this.stringCoercionMayExecute(value)) this.invalidateEffectfulFlowFacts();
          }
        }
        return stringType;
      case "IdentifierExpression": {
        const binding = this.lookup(expression.name) ?? this.builtin(expression.name);
        if (!binding) {
          const guidance = this.globalGuidance.get(expression.name);
          this.diagnostics.push(diagnostic(guidance ? "VEL3008" : "VEL3001", guidance ?? `Unknown name '${expression.name}'`, expression.span));
          return unknownType;
        }
        return binding.type;
      }
      case "SuperExpression":
        this.typeError("'super' must be followed by a base method name", expression.span);
        return unknownType;
      case "DynamicImportExpression":
        return { kind: "promise", value: this.dynamicImports.get(expression.source) ?? unknownType };
      case "ListExpression": {
        const collectionContext = this.contextualCollectionType(contextualType);
        let element = unknownType;
        const expectedElement = collectionContext?.kind === "list" ? collectionContext.element : unknownType;
        let matchesContext = collectionContext?.kind === "list";
        for (const item of expression.elements) {
          const itemType = this.inferExpression(item, expectedElement);
          if (item.kind === "SpreadExpression") {
            if (this.listReflectionMayExecute(itemType)) this.invalidateEffectfulFlowFacts();
            if (itemType.kind === "list") {
              element = mergeTypes(element, itemType.element);
              if (expectedElement.kind !== "unknown") {
                if (!isAssignable(itemType.element, expectedElement, this)) matchesContext = false;
                this.requireAssignable(itemType.element, expectedElement, item.span);
              }
            }
            else if (itemType.kind !== "any") this.typeError(`Cannot spread ${describeType(itemType)} into a list`, item.span);
          } else {
            element = mergeTypes(element, itemType);
            if (expectedElement.kind !== "unknown") {
              if (!isAssignable(itemType, expectedElement, this)) matchesContext = false;
              this.requireAssignable(itemType, expectedElement, item.span);
            }
          }
        }
        if (matchesContext && collectionContext?.kind === "list") return collectionContext;
        return { kind: "list", element };
      }
      case "ObjectExpression": {
        const objectContext = this.contextualObjectType(contextualType);
        if (objectContext?.kind === "named") {
          const contextKey = spanIdentity(expression.span);
          this.semanticExpressionContexts.set(contextKey, objectContext);
          this.semanticExpressionContextMembers.set(contextKey, this.semanticMembersOf(objectContext));
        }
        const fields = new Map<string, ValueType>();
        const optionalFields = new Set<string>();
        const explicitFields = new Set<string>();
        let containsSpread = false;
        const expectedFields = objectContext?.kind === "object"
          ? objectContext.fields
          : objectContext?.kind === "named" ? this.fieldsOf(objectContext.identity ?? objectContext.name) : null;
        const expectedOptionalFields = objectContext?.kind === "object" ? objectContext.optionalFields : undefined;
        for (const property of expression.properties) {
          if (property.kind === "ObjectProperty") {
            if (explicitFields.has(property.name)) {
              this.diagnostics.push(diagnostic("VEL4004", `Object field '${property.name}' is declared more than once`, property.span));
            }
            explicitFields.add(property.name);
            optionalFields.delete(property.name);
            if (objectContext?.kind === "named" && expectedFields?.has(property.name)) {
              this.semanticObjectPropertyOwners.set(`${property.span.start}:${property.name}`, objectContext);
            }
            const expected = expectedFields?.get(property.name) ?? unknownType;
            const actual = this.inferExpression(property.value, expected.kind === "optional" ? expected.inner : expected);
            fields.set(property.name, actual);
            if (expected.kind !== "unknown") this.requireAssignable(actual, expected, property.value.span);
          } else {
            containsSpread = true;
            const spread = this.inferExpression(property.value);
            if (this.recordReflectionMayExecute(spread)) this.invalidateEffectfulFlowFacts();
            const spreadFields = spread.kind === "object" ? spread.fields : spread.kind === "named" ? this.fieldsOf(spread.identity ?? spread.name) : null;
            if (spreadFields) {
              for (const [name, type] of spreadFields) {
                const alreadyRequired = fields.has(name) && !optionalFields.has(name);
                fields.set(name, type);
                if (!alreadyRequired && spread.kind === "object" && spread.optionalFields?.has(name)) optionalFields.add(name);
                else optionalFields.delete(name);
              }
            } else if (spread.kind !== "any") {
              this.typeError(`Cannot spread ${describeType(spread)} into an object`, property.span);
            }
          }
        }
        if (expectedFields && !containsSpread) {
          for (const [name, expected] of expectedFields) {
            if (!explicitFields.has(name) && expected.kind !== "optional" && !expectedOptionalFields?.has(name)) {
              this.typeError(`Object is missing required field '${name}'`, expression.span);
            }
          }
          this.contextualAssignments.set(spanIdentity(expression.span), contextualType);
        }
        return { kind: "object", fields, ...(optionalFields.size > 0 ? { optionalFields } : {}) };
      }
      case "SpreadExpression":
        return this.inferExpression(expression.value);
      case "UnaryExpression": {
        const operand = this.inferExpression(expression.operand);
        if (expression.operator === "await") {
          if (this.parameterDefaultDepth > 0) {
            this.diagnostics.push(diagnostic("VEL4007", "'await' cannot be used in a parameter default value", expression.span));
          } else if (this.classFieldInitializerDepth > 0) {
            this.diagnostics.push(diagnostic("VEL4007", "'await' cannot be used in a class field initializer", expression.span));
          } else if (this.constructorDepth > 0) {
            this.diagnostics.push(diagnostic("VEL4007", "'await' cannot be used directly in a constructor", expression.span));
          }
          const invalidFunctionAwait = this.functionDepth > 0 && !this.asynchronousFunctions.at(-1);
          const invalidExtensionAwait = this.functionDepth === 0 && this.invalidExtensionAwaitContext();
          if (this.parameterDefaultDepth === 0 && this.constructorDepth === 0 && (invalidFunctionAwait || invalidExtensionAwait)) {
            this.diagnostics.push(diagnostic("VEL4007", "'await' can only be used in an async function, mounted block, or at module scope", expression.span));
          }
          const awaited = this.expandAliases(operand);
          this.invalidateEffectfulFlowFacts();
          if (isInvalidType(awaited)) return invalidType;
          if (awaited.kind === "promise") {
            const result = resolvedAsyncType(awaited.value);
            if (result.kind === "null" && !this.normalizedPromiseValues.has(spanIdentity(expression.operand.span))) {
              this.normalizedNullResults.add(spanIdentity(expression.span));
            }
            return result;
          }
          if (awaited.kind !== "any") {
            this.typeError(`Cannot await ${describeType(operand)}`, expression.span);
          }
          return awaited.kind === "any" ? anyType : unknownType;
        }
        if (isInvalidType(operand)) return invalidType;
        if (expression.operator === "not") {
          if (operand.kind === "optional") this.optionalNegations.add(spanIdentity(expression.span));
          else this.requireAssignable(operand, boolType, expression.operand.span);
          return boolType;
        }
        this.requireAssignable(operand, numberType, expression.operand.span);
        return numberType;
      }
      case "BinaryExpression":
        return this.inferBinary(expression.left, expression.operator, expression.right, expression.span, contextualType);
      case "ComparisonChainExpression": {
        const types: ValueType[] = [this.inferExpression(expression.operands[0]!)];
        let successful = new Map<string, ValueType>();
        for (let index = 0; index < expression.operators.length; index += 1) {
          const left = expression.operands[index]!;
          const right = expression.operands[index + 1]!;
          const operator = expression.operators[index]!;
          this.enterScope();
          try {
            this.applyNarrowings(successful, right.span);
            const rightType = this.inferExpression(right);
            types.push(rightType);
            const surviving = this.survivingNarrowings(successful);
            if (operator !== "==" && operator !== "!=") {
              this.requireOrderedComparison(types[index]!, rightType, left, right, expression.span);
            }
            const link: Expression = {
              kind: "BinaryExpression",
              left,
              operator,
              right,
              span: { start: left.span.start, end: right.span.end },
            };
            successful = new Map([...surviving, ...this.narrowingFor(link, boolType)]);
          } finally {
            this.exitScope();
          }
        }
        this.logicalConditionNarrowings.set(spanIdentity(expression.span), { truthy: successful, falsy: new Map() });
        return types.some(isInvalidType) ? invalidType : boolType;
      }
      case "ConditionalExpression":
        {
          const condition = this.inferExpression(expression.condition);
          this.requireCondition(condition, expression.condition);
          const baseline = this.snapshotFlowFacts();
          let thenType = unknownType;
          const thenInvalidations = this.analyzeIsolatedFlow(baseline, () => {
            thenType = this.inferNarrowedExpression(
              expression.thenValue,
              this.narrowingFor(expression.condition, condition),
              contextualType,
            );
          });
          let elseType = unknownType;
          const elseInvalidations = this.analyzeIsolatedFlow(baseline, () => {
            elseType = this.inferNarrowedExpression(
              expression.elseValue,
              this.negativeNarrowingFor(expression.condition, condition),
              contextualType,
            );
          });
          this.applyFlowInvalidations([thenInvalidations, elseInvalidations]);
          if (this.contextualObjectType(contextualType)
            && this.contextuallyAssignable(thenType, contextualType, expression.thenValue.span)
            && this.contextuallyAssignable(elseType, contextualType, expression.elseValue.span)) {
            this.contextualAssignments.set(spanIdentity(expression.span), contextualType);
          }
          return mergeTypes(thenType, elseType);
        }
      case "IsExpression": {
        this.inferExpression(expression.value);
        const checked = this.resolveAnnotation(expression.type);
        const valid = this.validateTypeReference(expression.type);
        if (valid && checked.kind === "class") {
          this.classChecks.add(spanIdentity(expression.span));
          if ((checked.identity ?? checked.name).startsWith("js:")) this.invalidateEffectfulFlowFacts();
        }
        return valid ? boolType : invalidType;
      }
      case "ArrowFunctionExpression":
        return this.inferArrow(expression, contextualType);
      case "CallExpression": {
        const result = this.inferCall(expression.callee, expression.arguments, expression.argumentNames, expression.span, contextualType, expression.optional);
        this.invalidateEffectfulFlowFacts();
        if (this.expandAliases(result).kind === "null") this.normalizedNullResults.add(spanIdentity(expression.span));
        return result;
      }
      case "MemberExpression":
        return this.inferMember(expression.object, expression.property, expression.optional, expression.span);
      case "IndexExpression": {
        const original = this.expandAliases(this.inferExpression(expression.object));
        const guarded = expression.optional && (original.kind === "optional" || original.kind === "null");
        if (!expression.optional && original.kind === "optional") {
          this.typeError(`Use optional index '?.[...]' for ${describeType(original)}`, expression.span);
        }
        if (original.kind === "null" && expression.optional) {
          const baseline = this.snapshotFlowFacts();
          this.analyzeIsolatedFlow(baseline, () => {
            this.inferExpression(expression.index);
          });
          this.optionalIndexes.add(spanIdentity(expression.span));
          return optionalOf(unknownType);
        }
        const object = guarded && original.kind === "optional" ? original.inner : original;
        const index = guarded
          ? this.withTemporaryNarrowings(
            this.optionalExecutionNarrowings(expression.object),
            expression.index.span,
            () => this.inferExpression(expression.index),
          )
          : this.inferExpression(expression.index);
        if (isInvalidType(object)) return invalidType;
        if (object.kind === "list") {
          this.requireAssignable(index, numberType, expression.index.span);
          if (this.listReflectionMayExecute(object)) this.invalidateEffectfulFlowFacts();
          if (guarded) {
            this.optionalIndexes.add(spanIdentity(expression.span));
            return optionalOf(object.element);
          }
          return object.element;
        }
        if (object.kind === "map") {
          this.typeError("Use Map.get(key) instead of bracket access", expression.span);
          return object.value;
        }
        if (object.kind !== "any") {
          this.typeError(`Cannot index ${describeType(object)}`, expression.span);
        }
        if (object.kind === "any") this.invalidateEffectfulFlowFacts();
        return object.kind === "any" ? anyType : unknownType;
      }
      default:
        return unknownType;
    }
  }

  private inferBinary(
    leftExpression: Expression,
    operator: string,
    rightExpression: Expression,
    operationSpan: Span,
    contextualType: ValueType,
  ): ValueType {
    const left = this.inferExpression(leftExpression);
    if (operator === "and" || operator === "or") {
      this.requireCondition(left, leftExpression);
      const leftTruthy = this.narrowingFor(leftExpression, left);
      const leftFalsy = this.negativeNarrowingFor(leftExpression, left);
      const rightContext = operator === "and" ? leftTruthy : leftFalsy;
      const rightCondition = this.inferConditionWithNarrowings(rightExpression, rightContext);
      this.logicalConditionNarrowings.set(spanIdentity(operationSpan), {
        truthy: operator === "and" ? this.combineNarrowings(rightCondition.surviving, rightCondition.truthy) : new Map(),
        falsy: operator === "or" ? this.combineNarrowings(rightCondition.surviving, rightCondition.falsy) : new Map(),
      });
      return isInvalidType(left) || isInvalidType(rightCondition.type) ? invalidType : boolType;
    }
    if (operator === "??") {
      const expandedLeft = this.expandAliases(left);
      const fallbackContext = this.coalescingFallbackContext(expandedLeft, contextualType);
      const right = this.inferNarrowedExpression(
        rightExpression,
        this.negativeNarrowingFor(leftExpression, left),
        fallbackContext,
      );
      if (isInvalidType(left) || isInvalidType(right)) return invalidType;
      if (expandedLeft.kind !== "optional" && expandedLeft.kind !== "null" && expandedLeft.kind !== "any") {
        this.typeError(`Left side of '??' is not optional: ${describeType(left)}`, leftExpression.span);
      }
      return mergeTypes(nonOptional(expandedLeft), right);
    }
    const right = this.inferExpression(rightExpression);
    if (isInvalidType(left) || isInvalidType(right)) return invalidType;
    if (operator === "in") {
      if (right.kind === "list" || right.kind === "set") {
        this.requireAssignable(left, right.element, leftExpression.span);
      } else if (right.kind === "map") {
        this.requireAssignable(left, right.key, leftExpression.span);
      } else if (right.kind === "string") {
        this.requireAssignable(left, stringType, leftExpression.span);
      } else if (right.kind !== "any") {
        this.typeError(`Membership requires a List, Set, Map, or string, received ${describeType(right)}`, rightExpression.span);
      }
      return boolType;
    }
    if (operator === "==" || operator === "!=") {
      return boolType;
    }
    if (["<", "<=", ">", ">="].includes(operator)) {
      this.requireOrderedComparison(left, right, leftExpression, rightExpression, operationSpan);
      return boolType;
    }
    if (operator === "+" && (left.kind === "string" || right.kind === "string")) {
      if (left.kind === "string" && right.kind === "string") return stringType;
      this.typeError(
        `String concatenation requires two strings; use an f-string or str(value), received ${describeType(left)} and ${describeType(right)}`,
        operationSpan,
      );
      return stringType;
    }
    this.requireAssignable(left, numberType, leftExpression.span);
    this.requireAssignable(right, numberType, rightExpression.span);
    return numberType;
  }

  private coalescingFallbackContext(left: ValueType, contextualType: ValueType): ValueType {
    const expandedContext = this.expandAliases(contextualType);
    if (expandedContext.kind !== "unknown" && !isInvalidType(expandedContext)) return contextualType;
    return left.kind === "optional" ? left.inner : unknownType;
  }

  private requireOrderedComparison(
    leftType: ValueType,
    rightType: ValueType,
    leftExpression: Expression,
    rightExpression: Expression,
    operationSpan: Span,
  ): void {
    const left = this.expandAliases(leftType);
    const right = this.expandAliases(rightType);
    if (isInvalidType(left) || isInvalidType(right)) return;
    if (left.kind === "any" || right.kind === "any") return;
    if ((left.kind === "number" && right.kind === "number")
      || (left.kind === "string" && right.kind === "string")) return;
    this.typeError(
      `Ordered comparison requires two numbers or two strings, received ${describeType(leftType)} and ${describeType(rightType)}`,
      { start: leftExpression.span.start, end: Math.max(rightExpression.span.end, operationSpan.end) },
    );
  }

  protected inferParameterDefault(expression: Expression, contextualType: ValueType = unknownType): ValueType {
    this.parameterDefaultDepth += 1;
    const result = this.inferExpression(expression, contextualType);
    this.parameterDefaultDepth -= 1;
    return result;
  }

  protected resolvedAsyncResult(type: ValueType): ValueType {
    const expanded = this.expandAliases(type);
    const resolved = resolvedAsyncType(expanded);
    return sameType(expanded, resolved) ? type : resolved;
  }

  private asyncResultContainsPromise(type: ValueType): boolean {
    const expanded = this.expandAliases(type);
    return !sameType(expanded, resolvedAsyncType(expanded));
  }

  private inferArrow(expression: ArrowFunctionExpression, contextualType: ValueType): ValueType {
    const expandedContext = this.expandAliases(contextualType);
    const expected = expandedContext.kind === "function"
      ? expandedContext
      : expandedContext.kind === "optional" && expandedContext.inner.kind === "function"
        ? expandedContext.inner
        : null;
    this.enterScope();
    this.flowFrameDepth += 1;
    this.functionDepth += 1;
    const previousFinallyLoopDepths = this.finallyLoopDepths;
    this.finallyLoopDepths = [];
    this.asynchronousFunctions.push(expression.asynchronous);
    const parameterTypes: ValueType[] = [];
    let rest: ValueType | undefined;
    let fixedIndex = 0;
    for (const parameter of expression.parameters) {
      const contextualParameter = parameter.rest ? expected?.rest : expected?.parameters[fixedIndex];
      const annotated = parameter.type ? this.resolveAnnotation(parameter.type) : null;
      const annotationValid = parameter.type ? this.validateTypeReference(parameter.type) : true;
      const defaultType = !annotated && !contextualParameter && parameter.defaultValue
        ? this.inferParameterDefault(parameter.defaultValue)
        : null;
      const type = annotationValid ? annotated ?? contextualParameter ?? defaultType ?? unknownType : invalidType;
      if (parameter.defaultValue && !defaultType && annotationValid) {
        const actualDefault = this.inferParameterDefault(parameter.defaultValue, type);
        this.requireAssignable(actualDefault, type, parameter.defaultValue.span);
      }
      this.declareBinding(parameter.name, false, parameter.rest ? { kind: "list", element: type } : type, parameter.span);
      if (parameter.rest) rest = type;
      else {
        parameterTypes.push(type);
        fixedIndex += 1;
      }
    }
    const expectedResult = expected?.result ?? unknownType;
    const expandedExpectedResult = this.expandAliases(expectedResult);
    const contextualResult = expression.asynchronous && expandedExpectedResult.kind === "promise"
      ? resolvedAsyncType(expandedExpectedResult.value)
      : expectedResult;
    const outerParameterDefaultDepth = this.parameterDefaultDepth;
    const outerConstructorDepth = this.constructorDepth;
    this.parameterDefaultDepth = 0;
    this.constructorDepth = 0;
    const bodyResult = this.inferExpression(expression.body, contextualResult);
    this.parameterDefaultDepth = outerParameterDefaultDepth;
    this.constructorDepth = outerConstructorDepth;
    const checkedBodyResult = expected
      && expandedExpectedResult.kind !== "unknown"
      && expandedExpectedResult.kind !== "any"
      && this.contextuallyAssignable(bodyResult, contextualResult, expression.body.span)
      ? contextualResult
      : bodyResult;
    const result = expression.asynchronous
      ? { kind: "promise", value: this.resolvedAsyncResult(checkedBodyResult) } satisfies ValueType
      : checkedBodyResult;
    this.asynchronousFunctions.pop();
    this.finallyLoopDepths = previousFinallyLoopDepths;
    this.functionDepth -= 1;
    this.flowFrameDepth -= 1;
    this.exitScope();
    return {
      kind: "function",
      parameters: parameterTypes,
      parameterNames: expression.parameters.filter((parameter) => !parameter.rest).map((parameter) => parameter.name),
      requiredParameters: expression.parameters.filter((parameter) => !parameter.rest && !parameter.defaultValue).length,
      ...(rest ? { rest } : {}),
      result,
    };
  }

  private inferCall(
    calleeExpression: Expression,
    arguments_: readonly Expression[],
    argumentNames: readonly (string | null)[] | undefined,
    callSpan: Span,
    contextualType: ValueType = unknownType,
    optionalCall = false,
  ): ValueType {
    const hasNamed = argumentNames?.some((name) => name !== null) ?? false;
    if (calleeExpression.kind === "SuperExpression") {
      if (optionalCall) this.typeError("A base constructor call cannot be optional", callSpan);
      const baseName = this.currentClass ? this.classes.get(this.currentClass)?.base ?? null : null;
      if (this.constructorDepth === 0 || !baseName) {
        this.typeError("'super(...)' is only available as the first statement of a derived constructor", callSpan);
        for (const argument of arguments_) this.inferExpression(argument);
        return nullType;
      }
      const base = this.classes.get(baseName);
      this.checkArguments(arguments_, base?.parameters ?? [], callSpan, base?.requiredParameters, base?.constructorRest, argumentNames, base?.parameterNames);
      return nullType;
    }
    if (optionalCall) {
      const original = this.inferExpression(calleeExpression);
      const callee = original.kind === "optional" ? original.inner : original;
      if (isInvalidType(callee)) return invalidType;
      if (callee.kind === "function" || callee.kind === "action") {
        this.withTemporaryNarrowings(this.optionalExecutionNarrowings(calleeExpression), callSpan, () => {
          this.checkArguments(arguments_, callee.parameters, callSpan, callee.requiredParameters, callee.rest, argumentNames, callee.parameterNames);
        });
        this.optionalCallees.add(spanIdentity(callSpan));
        return optionalOf(callee.result);
      }
      if (callee.kind === "any") {
        this.withTemporaryNarrowings(this.optionalExecutionNarrowings(calleeExpression), callSpan, () => {
          for (const argument of arguments_) this.inferExpression(argument);
        });
        this.optionalCallees.add(spanIdentity(callSpan));
        return anyType;
      }
      this.typeError(`Optional call requires a function, received ${describeType(original)}`, callSpan);
      for (const argument of arguments_) this.inferExpression(argument);
      return unknownType;
    }
    if (calleeExpression.kind === "IdentifierExpression" && calleeExpression.name === "Map") {
      const collectionContext = this.contextualCollectionType(contextualType);
      if (hasNamed) this.typeError("Map construction does not accept named arguments", callSpan);
      if (arguments_.length > 1) this.typeError(`Expected 0-1 arguments but received ${arguments_.length}`, callSpan);
      if (!arguments_[0]) return collectionContext?.kind === "map" ? collectionContext : { kind: "map", key: unknownType, value: unknownType };
      const source = this.inferExpression(arguments_[0], collectionContext?.kind === "map" ? collectionContext : unknownType);
      for (const argument of arguments_.slice(1)) this.inferExpression(argument);
      if (source.kind === "map") return source;
      if (source.kind === "any") return { kind: "map", key: anyType, value: anyType };
      this.typeError(`Map construction requires another Map, received ${describeType(source)}`, arguments_[0].span);
      return { kind: "map", key: unknownType, value: unknownType };
    }
    if (calleeExpression.kind === "IdentifierExpression" && calleeExpression.name === "Set") {
      const collectionContext = this.contextualCollectionType(contextualType);
      if (hasNamed) this.typeError("Set construction does not accept named arguments", callSpan);
      if (arguments_.length > 1) this.typeError(`Expected 0-1 arguments but received ${arguments_.length}`, callSpan);
      if (!arguments_[0]) return collectionContext?.kind === "set" ? collectionContext : { kind: "set", element: unknownType };
      const source = this.inferExpression(arguments_[0], collectionContext?.kind === "set" ? { kind: "list", element: collectionContext.element } : unknownType);
      for (const argument of arguments_.slice(1)) this.inferExpression(argument);
      if (source.kind === "list" || source.kind === "set") return { kind: "set", element: source.element };
      if (source.kind === "any") return { kind: "set", element: anyType };
      this.typeError(`Set construction requires a List or Set, received ${describeType(source)}`, arguments_[0].span);
      return { kind: "set", element: unknownType };
    }

    if (calleeExpression.kind === "MemberExpression" && calleeExpression.object.kind !== "SuperExpression") {
      const collectionResult = this.inferCollectionCall(calleeExpression, arguments_, callSpan);
      if (collectionResult) {
        if (hasNamed) this.typeError("Collection methods do not expose named parameters", callSpan);
        return collectionResult;
      }
    }

    const diagnosticsBeforeCallee = this.diagnostics.length;
    const callee = this.inferExpression(calleeExpression);
    const calleeAlreadyDiagnosed = this.diagnostics.length > diagnosticsBeforeCallee;
    if (callee.kind === "classConstructor") {
      this.constructorCalls.add(spanIdentity(callSpan));
      const info = this.classes.get(callee.identity ?? callee.name) ?? this.classes.get(callee.name);
      if (info?.abstract) this.typeError(`Cannot instantiate abstract class '${callee.name}'`, callSpan);
      this.checkArguments(arguments_, info?.parameters ?? [], callSpan, info?.requiredParameters, info?.constructorRest, argumentNames, info?.parameterNames);
      return {
        kind: "class",
        name: callee.name,
        ...(callee.identity ? { identity: callee.identity } : {}),
        ...((callee.identity ?? callee.name).startsWith("js:") ? { external: true } : {}),
      };
    }
    if (callee.kind === "intrinsic") {
      const ordered = this.orderNamedArguments(arguments_, argumentNames, callee.parameters, callee.parameterNames, callee.requiredParameters, callSpan, callee.rest);
      return this.inferIntrinsicCall(callee, ordered ?? arguments_, callSpan);
    }
    if (callee.kind === "componentConstructor") {
      this.typeError(`Render component '${callee.name}' with JSX`, callSpan);
      if (hasNamed) this.typeError("Components use JSX props rather than named call arguments", callSpan);
      for (const argument of arguments_) this.inferExpression(argument);
      return { kind: "node" };
    }
    if (callee.kind === "function" || callee.kind === "action") {
      if (calleeExpression.kind === "MemberExpression" && calleeExpression.property === "parse"
        && arguments_[0]?.kind === "ObjectExpression" && callee.result.kind === "named") {
        this.recordRuntimeObjectShape(arguments_[0], callee.result);
      }
      this.checkArguments(arguments_, callee.parameters, callSpan, callee.requiredParameters, callee.rest, argumentNames, callee.parameterNames);
      if (callee.result.kind === "optional") this.optionalCalls.add(spanIdentity(callSpan));
      if (calleeExpression.kind === "MemberExpression" && calleeExpression.property === "parse"
        && this.expandAliases(
          this.inferredExpressionTypes.get(spanIdentity(calleeExpression.object.span)) ?? unknownType,
        ).kind === "typeObject"
        && arguments_[0] && this.runtimeValidationMayRetainHostOrigin(
          this.inferredExpressionTypes.get(spanIdentity(arguments_[0].span)) ?? unknownType,
        )) {
        return this.markExternalAggregate(callee.result);
      }
      return callee.result;
    }
    if (callee.kind === "optional" && (callee.inner.kind === "function" || callee.inner.kind === "action")) {
      const inner = callee.inner;
      this.withTemporaryNarrowings(this.optionalExecutionNarrowings(calleeExpression), callSpan, () => {
        this.checkArguments(arguments_, inner.parameters, callSpan, inner.requiredParameters, inner.rest, argumentNames, inner.parameterNames);
      });
      if (!continuesOptionalChain(calleeExpression)) {
        this.typeError("Use a presence check or an optional access chain before calling an optional function", calleeExpression.span);
      }
      this.optionalCalls.add(spanIdentity(callSpan));
      this.optionalCallees.add(spanIdentity(callSpan));
      return optionalOf(inner.result);
    }
    if (callee.kind === "any") {
      if (hasNamed) this.typeError("Named arguments require a statically known callable signature", callSpan);
      for (const argument of arguments_) {
        this.inferExpression(argument);
      }
      return anyType;
    }
    if (callee.kind === "unknown") {
      if (isInvalidType(callee)) return invalidType;
      if (!calleeAlreadyDiagnosed) {
        if (hasNamed) this.typeError("Named arguments require a statically known callable signature", callSpan);
        for (const argument of arguments_) {
          this.inferExpression(argument);
        }
        this.typeError("Cannot call an unknown JavaScript value without a declaration or validation", callSpan);
      }
      return unknownType;
    }
    for (const argument of arguments_) {
      this.inferExpression(argument);
    }
    this.typeError(`${describeType(callee)} is not callable`, callSpan);
    return unknownType;
  }

  private inferIntrinsicCall(
    intrinsic: Extract<ValueType, { kind: "intrinsic" }>,
    arguments_: readonly Expression[],
    callSpan: Span,
  ): ValueType {
    const arity = (minimum = intrinsic.requiredParameters, maximum = intrinsic.parameters.length): void => {
      if (arguments_.length < minimum || arguments_.length > maximum) {
        const expected = maximum === Number.POSITIVE_INFINITY
          ? `at least ${minimum}`
          : minimum === maximum ? String(minimum) : `${minimum}-${maximum}`;
        this.typeError(`Expected ${expected} arguments but received ${arguments_.length}`, callSpan);
      }
    };
    const inferAt = (index: number, expected: ValueType = unknownType): ValueType => {
      const argument = arguments_[index];
      if (!argument) return unknownType;
      if (argument.kind === "IdentifierExpression" && argument.name === "\u0000omitted-named-argument") return unknownType;
      const actual = this.inferExpression(argument, expected);
      if (expected.kind !== "unknown") this.requireAssignable(actual, expected, argument.span);
      return actual;
    };
    const arrayAt = (index: number): { readonly type: ValueType; readonly element: ValueType } => {
      const type = inferAt(index);
      if (type.kind === "list") return { type, element: type.element };
      if (type.kind === "any") return { type, element: anyType };
      if (arguments_[index]) this.typeError(`Expected a List, received ${describeType(type)}`, arguments_[index]!.span);
      return { type, element: unknownType };
    };
    const callbackAt = (index: number, parameters: readonly ValueType[], result: ValueType): ValueType => {
      const expected: ValueType = { kind: "function", parameters, requiredParameters: parameters.length, result };
      return inferAt(index, expected);
    };
    const callbackResult = (type: ValueType): ValueType => type.kind === "function" || type.kind === "action" || type.kind === "intrinsic" ? type.result : type.kind === "any" ? anyType : unknownType;
    const promiseValue = (type: ValueType, index: number): ValueType => {
      if (type.kind === "promise") return type.value;
      if (type.kind === "any") return anyType;
      if (arguments_[index]) this.typeError(`Expected a Promise, received ${describeType(type)}`, arguments_[index]!.span);
      return unknownType;
    };
    const runtimeTypeAt = (index: number): ValueType => {
      const type = inferAt(index);
      if (type.kind === "typeObject") return { kind: "named", name: type.name };
      if (type.kind === "enumObject") return { kind: "enum", name: type.name, identity: type.identity };
      if (type.kind === "any") return anyType;
      if (arguments_[index]) this.typeError("Runtime parsing requires a VelarScript runtime type", arguments_[index]!.span);
      return unknownType;
    };

    for (const extension of this.analysisExtensions) {
      const result = extension.inferIntrinsic?.({
        intrinsic,
        arguments: arguments_,
        callSpan,
        arity,
        inferAt,
        callbackAt,
        runtimeTypeAt,
        typeError: (message, errorSpan) => this.typeError(message, errorSpan),
        isAssignable: (actual, expected) => isAssignable(actual, expected, this),
        expandAliases: (type) => this.expandAliases(type),
        jsonSerializable: (type) => this.jsonSerializable(type),
        isHttpFormBody: (type) => this.isHttpFormBody(type),
        declaredFieldsOf: (name) => this.namedTypes.get(name) ?? null,
        formReadField: (name, type, fieldSpan) => this.formReadField(name, type, fieldSpan),
        recordFormRead: (sourceSpan, fields) => this.formReads.set(spanIdentity(sourceSpan), fields),
      });
      if (result) return result;
    }

    switch (intrinsic.name) {
      case "collections.enumerate": {
        arity(1, 2);
        const { element } = arrayAt(0);
        inferAt(1, numberType);
        return { kind: "list", element: { kind: "object", fields: new Map([["index", numberType], ["value", element]]) } };
      }
      case "collections.zip": {
        arity(2, 2);
        const left = arrayAt(0).element;
        const right = arrayAt(1).element;
        return { kind: "list", element: { kind: "object", fields: new Map([["first", left], ["second", right]]) } };
      }
      case "collections.unique":
      case "collections.reversed":
      case "collections.compact": {
        arity(1, 1);
        const { element } = arrayAt(0);
        return { kind: "list", element: intrinsic.name === "collections.compact" ? nonOptional(element) : element };
      }
      case "collections.repeat": {
        arity(2, 2);
        const element = inferAt(0);
        inferAt(1, numberType);
        return { kind: "list", element };
      }
      case "collections.has":
      case "collections.count": {
        arity(2, 2);
        const element = arrayAt(0).element;
        inferAt(1, element);
        return intrinsic.name === "collections.has" ? boolType : numberType;
      }
      case "collections.take":
      case "collections.drop": {
        arity(2, 2);
        const { element } = arrayAt(0);
        inferAt(1, numberType);
        return { kind: "list", element };
      }
      case "collections.chunk": {
        arity(2, 2);
        const { element } = arrayAt(0);
        inferAt(1, numberType);
        return { kind: "list", element: { kind: "list", element } };
      }
      case "collections.flatten": {
        arity(1, 1);
        const outer = arrayAt(0).element;
        if (outer.kind === "list") return outer;
        if (outer.kind === "any") return { kind: "list", element: anyType };
        if (arguments_[0]) this.typeError(`flatten expects a List of Lists, received List<${describeType(outer)}>`, arguments_[0]!.span);
        return { kind: "list", element: unknownType };
      }
      case "collections.groupBy":
      case "collections.keyBy":
      case "collections.countBy": {
        arity(2, 2);
        const element = arrayAt(0).element;
        const key = callbackResult(callbackAt(1, [element], unknownType));
        if (intrinsic.name === "collections.groupBy") return { kind: "map", key, value: { kind: "list", element } };
        if (intrinsic.name === "collections.countBy") return { kind: "map", key, value: numberType };
        return { kind: "map", key, value: element };
      }
      case "collections.sortBy": {
        arity(2, 3);
        const element = arrayAt(0).element;
        const key = callbackResult(callbackAt(1, [element], unknownType));
        if (!this.isCollectionOrderKey(key) && arguments_[1]) {
          this.typeError(`sortBy key must return only string or only number, received ${describeType(key)}`, arguments_[1]!.span);
        }
        inferAt(2, boolType);
        return { kind: "list", element };
      }
      case "collections.partition": {
        arity(2, 2);
        const element = arrayAt(0).element;
        callbackAt(1, [element], boolType);
        const list: ValueType = { kind: "list", element };
        return { kind: "object", fields: new Map([["matches", list], ["rest", list]]) };
      }
      case "collections.find": {
        arity(2, 2);
        const element = arrayAt(0).element;
        callbackAt(1, [element], boolType);
        return optionalOf(element);
      }
      case "collections.some":
      case "collections.every": {
        arity(2, 2);
        const element = arrayAt(0).element;
        callbackAt(1, [element], boolType);
        return boolType;
      }
      case "collections.index": {
        arity(2, 2);
        const element = arrayAt(0).element;
        inferAt(1, element);
        return optionalOf(numberType);
      }
      case "collections.first":
      case "collections.last": {
        arity(1, 1);
        return optionalOf(arrayAt(0).element);
      }
      case "collections.minBy":
      case "collections.maxBy": {
        arity(2, 2);
        const element = arrayAt(0).element;
        const key = callbackResult(callbackAt(1, [element], unknownType));
        if (!this.isCollectionOrderKey(key) && arguments_[1]) {
          this.typeError(`${intrinsic.name === "collections.minBy" ? "minBy" : "maxBy"} key must return only string or only number, received ${describeType(key)}`, arguments_[1]!.span);
        }
        return optionalOf(element);
      }
      case "collections.sum": {
        arity(1, 1);
        const element = arrayAt(0).element;
        if (!isAssignable(element, numberType, this) && element.kind !== "any") {
          this.typeError(`sum expects List<number>, received List<${describeType(element)}>`, arguments_[0]?.span ?? callSpan);
        }
        return numberType;
      }
      case "collections.join": {
        arity(1, 2);
        const element = arrayAt(0).element;
        if (!isAssignable(element, stringType, this) && element.kind !== "any") {
          this.typeError(`join expects List<string>, received List<${describeType(element)}>`, arguments_[0]?.span ?? callSpan);
        }
        inferAt(1, stringType);
        return stringType;
      }
      case "json.parse": {
        arity(1, 2);
        inferAt(0, stringType);
        return arguments_[1] ? runtimeTypeAt(1) : unknownType;
      }
      case "json.tryParse": {
        arity(1, 3);
        inferAt(0, stringType);
        const parsed = arguments_[1] ? runtimeTypeAt(1) : unknownType;
        if (arguments_[2]) {
          inferAt(2, parsed);
          return parsed;
        }
        return optionalOf(parsed);
      }
      case "json.stringify":
      case "json.stableStringify": {
        arity(1, 2);
        const value = inferAt(0);
        const serializable = this.jsonSerializable(value);
        if (serializable === false && arguments_[0]) {
          this.typeError(`JSON accepts only records, Lists, enums, primitives, and optionals; received ${describeType(value)}`, arguments_[0]!.span);
        }
        inferAt(1, { kind: "union", members: [boolType, numberType] });
        return stringType;
      }
      case "json.clone": {
        arity(1, 2);
        const original = inferAt(0);
        if (this.jsonSerializable(original) === false && arguments_[0]) {
          this.typeError(`JSON accepts only records, Lists, enums, primitives, and optionals; received ${describeType(original)}`, arguments_[0]!.span);
        }
        return arguments_[1] ? runtimeTypeAt(1) : original;
      }
      case "async.all":
      case "async.race": {
        arity(1, 1);
        const value = arrayAt(0).element;
        const resolved = value.kind === "promise" ? value.value : value.kind === "any" ? anyType : unknownType;
        if (value.kind !== "promise" && value.kind !== "any") this.typeError(`Expected a List of Promises, received List<${describeType(value)}>`, arguments_[0]?.span ?? callSpan);
        return { kind: "promise", value: intrinsic.name === "async.all" ? { kind: "list", element: resolved } : resolved };
      }
      case "async.timeout": {
        arity(2, 3);
        const value = promiseValue(inferAt(0), 0);
        inferAt(1, numberType);
        inferAt(2, stringType);
        return { kind: "promise", value };
      }
      case "async.retry": {
        arity(1, 2);
        const task = callbackAt(0, [], unknownType);
        inferAt(1, numberType);
        const result = callbackResult(task);
        return { kind: "promise", value: result.kind === "promise" ? result.value : result };
      }
      case "async.map": {
        arity(2, 3);
        const element = arrayAt(0).element;
        const worker = callbackAt(1, [element], unknownType);
        inferAt(2, numberType);
        const result = callbackResult(worker);
        return { kind: "promise", value: { kind: "list", element: result.kind === "promise" ? result.value : result } };
      }
      case "async.series": {
        arity(1, 1);
        const task = arrayAt(0).element;
        if (task.kind !== "function" && task.kind !== "intrinsic" && task.kind !== "any") {
          this.typeError(`series expects a List of functions, received List<${describeType(task)}>`, arguments_[0]?.span ?? callSpan);
        }
        const result = callbackResult(task);
        return { kind: "promise", value: { kind: "list", element: result.kind === "promise" ? result.value : result } };
      }
      case "url.join": {
        arity(1, Number.POSITIVE_INFINITY);
        for (let index = 0; index < arguments_.length; index += 1) inferAt(index, stringType);
        return stringType;
      }
      case "math.min":
      case "math.max": {
        arity(1, Number.POSITIVE_INFINITY);
        for (let index = 0; index < arguments_.length; index += 1) inferAt(index, numberType);
        return numberType;
      }
      case "test.expect": {
        arity(1, 1);
        const actual = inferAt(0);
        const matched = this.expandAliases(actual);
        const dynamic = matched.kind === "any" || matched.kind === "unknown";
        const fields = new Map<string, ValueType>([
          ["toBe", { kind: "function", parameters: [actual], requiredParameters: 1, result: nullType }],
          ["toEqual", { kind: "function", parameters: [actual], requiredParameters: 1, result: nullType }],
        ]);
        if (matched.kind === "bool" || dynamic) {
          fields.set("toBeTruthy", { kind: "function", parameters: [], requiredParameters: 0, result: nullType });
          fields.set("toBeFalsy", { kind: "function", parameters: [], requiredParameters: 0, result: nullType });
        }
        if (matched.kind === "list" || matched.kind === "string" || dynamic) {
          const contained = matched.kind === "list" ? matched.element : matched.kind === "string" ? stringType : anyType;
          fields.set("toContain", { kind: "function", parameters: [contained], requiredParameters: 1, result: nullType });
          fields.set("toHaveLength", { kind: "function", parameters: [numberType], requiredParameters: 1, result: nullType });
        }
        if (matched.kind === "string" || dynamic) {
          fields.set("toMatch", { kind: "function", parameters: [stringType], requiredParameters: 1, result: nullType });
        }
        const callable = matched.kind === "function" || matched.kind === "intrinsic" || matched.kind === "action";
        if (callable || dynamic) fields.set("toThrow", { kind: "function", parameters: [], requiredParameters: 0, result: nullType });
        if (matched.kind === "promise" || dynamic || (callable && matched.result.kind === "promise")) {
          fields.set("toReject", { kind: "function", parameters: [], requiredParameters: 0, result: { kind: "promise", value: nullType } });
        }
        return { kind: "object", fields };
      }
      default:
        this.checkArguments(arguments_, intrinsic.parameters, callSpan, intrinsic.requiredParameters, intrinsic.rest);
        return intrinsic.result;
    }
  }

  private inferCollectionCall(member: Extract<Expression, { kind: "MemberExpression" }>, arguments_: readonly Expression[], callSpan: Span): ValueType | null {
    const object = this.inferExpression(member.object);
    if (object.kind !== "list" && object.kind !== "map" && object.kind !== "set") return null;
    this.semanticExpressionOwners.set(`${member.span.start}:${member.span.end}`, nonOptional(object));
    const memberType = object.kind === "list" ? this.listMember(object, member.property)
      : object.kind === "map" ? this.mapMember(object, member.property)
        : object.kind === "set" ? this.setMember(object, member.property)
          : unknownType;
    this.recordSemanticExpression(member, memberType ?? unknownType);
    const lowered = object.kind === "list"
      ? ["get", "slice", "append", "extend", "insert", "remove", "pop", "clear", "copy", "has", "count", "index", "find", "some", "every", "map", "filter", "reduce", "join", "sorted", "reversed"].includes(member.property)
      : object.kind === "map" ? ["get", "set", "update", "has", "remove", "clear", "copy", "keys", "values", "entries"].includes(member.property)
        : object.kind === "set" ? ["add", "update", "has", "remove", "clear", "copy", "values"].includes(member.property) : false;
    if (lowered && arguments_.some((argument) => argument.kind === "SpreadExpression")) {
      this.typeError(`Spread arguments are not supported by ${describeType(object)}.${member.property}`, callSpan);
    }
    if (object.kind === "list") {
      if (member.property === "map") {
        this.collectionCalls.set(member.span.end, "listMap");
        const callbackExpected: ValueType = { kind: "function", parameters: [object.element], requiredParameters: 1, result: unknownType };
        const callback = arguments_[0] ? this.inferExpression(arguments_[0], callbackExpected) : unknownType;
        const result = callback.kind === "function" ? callback.result : unknownType;
        if (arguments_.length !== 1) this.typeError(`Expected 1 argument but received ${arguments_.length}`, callSpan);
        return { kind: "list", element: result };
      }
      if (member.property === "filter") {
        this.collectionCalls.set(member.span.end, "listFilter");
        const callbackExpected: ValueType = { kind: "function", parameters: [object.element], requiredParameters: 1, result: boolType };
        if (arguments_[0]) {
          const callback = this.inferExpression(arguments_[0], callbackExpected);
          this.requireAssignable(callback, callbackExpected, arguments_[0].span);
        }
        if (arguments_.length !== 1) this.typeError(`Expected 1 argument but received ${arguments_.length}`, callSpan);
        return { kind: "list", element: object.element };
      }
      if (member.property === "reduce") {
        this.collectionCalls.set(member.span.end, "listReduce");
        const callbackArgument = arguments_[0];
        const deferredArrow = callbackArgument?.kind === "ArrowFunctionExpression";
        let callback = callbackArgument && !deferredArrow ? this.inferExpression(callbackArgument) : unknownType;
        const initial = arguments_[1] ? this.inferExpression(arguments_[1]) : unknownType;
        const callbackExpected: ValueType = { kind: "function", parameters: [initial, object.element], requiredParameters: 2, result: initial };
        if (callbackArgument) {
          if (deferredArrow) callback = this.inferExpression(callbackArgument, callbackExpected);
          this.requireAssignable(callback, callbackExpected, callbackArgument.span);
        }
        if (arguments_.length !== 2) this.typeError(`Expected 2 arguments but received ${arguments_.length}`, callSpan);
        return initial;
      }
      if (member.property === "append") {
        this.collectionCalls.set(member.span.end, "listAppend");
        const argument = arguments_[0];
        const value = argument ? this.inferExpression(argument, object.element) : unknownType;
        if (argument && object.element.kind === "unknown") {
          if (!this.refineCollectionInference(object, { kind: "list", element: value })) this.requireAssignable(value, object.element, argument.span);
        } else if (argument) this.requireAssignable(value, object.element, argument.span);
        if (arguments_.length !== 1) this.typeError(`Expected 1 argument but received ${arguments_.length}`, callSpan);
        return nullType;
      }
      if (member.property === "extend") {
        this.collectionCalls.set(member.span.end, "listExtend");
        const argument = arguments_[0];
        const source = argument ? this.expandAliases(this.inferExpression(argument)) : unknownType;
        let inferred = false;
        if (argument && source.kind === "list" && object.element.kind === "unknown") {
          inferred = this.refineCollectionInference(object, source);
        }
        if (argument && !inferred) this.requireAssignable(source, object, argument.span);
        if (arguments_.length !== 1) this.typeError(`Expected 1 argument but received ${arguments_.length}`, callSpan);
        return nullType;
      }
      if (member.property === "insert") {
        this.collectionCalls.set(member.span.end, "listInsert");
        if (arguments_[0]) this.requireAssignable(this.inferExpression(arguments_[0], numberType), numberType, arguments_[0].span);
        const argument = arguments_[1];
        const value = argument ? this.inferExpression(argument, object.element) : unknownType;
        if (argument && object.element.kind === "unknown") {
          if (!this.refineCollectionInference(object, { kind: "list", element: value })) this.requireAssignable(value, object.element, argument.span);
        } else if (argument) this.requireAssignable(value, object.element, argument.span);
        if (arguments_.length !== 2) this.typeError(`Expected 2 arguments but received ${arguments_.length}`, callSpan);
        return nullType;
      }
      if (member.property === "remove") {
        this.collectionCalls.set(member.span.end, "listRemove");
        this.checkArguments(arguments_, [object.element], callSpan);
        return boolType;
      }
      if (member.property === "pop") {
        this.collectionCalls.set(member.span.end, "listPop");
        this.checkArguments(arguments_, [numberType], callSpan, 0);
        return optionalOf(object.element);
      }
      if (member.property === "clear" || member.property === "copy" || member.property === "reversed") {
        this.collectionCalls.set(member.span.end, member.property === "clear" ? "clear" : member.property === "copy" ? "listCopy" : "listReversed");
        this.checkArguments(arguments_, [], callSpan);
        return member.property === "clear" ? nullType : { kind: "list", element: object.element };
      }
      if (member.property === "has" || member.property === "count") {
        this.collectionCalls.set(member.span.end, member.property === "has" ? "has" : "listCount");
        this.checkArguments(arguments_, [object.element], callSpan);
        return member.property === "has" ? boolType : numberType;
      }
      if (member.property === "sorted") {
        this.collectionCalls.set(member.span.end, "listSorted");
        const comparator: ValueType = { kind: "function", parameters: [object.element, object.element], requiredParameters: 2, result: numberType };
        this.checkArguments(arguments_, [comparator], callSpan, 0);
        if (arguments_.length === 0 && !this.defaultSortableType(object.element)) {
          this.typeError(`List<${describeType(object.element)}>.sorted() requires an explicit comparator`, callSpan);
        }
        return { kind: "list", element: object.element };
      }
      if (["some", "every", "find"].includes(member.property)) {
        const callbackExpected: ValueType = { kind: "function", parameters: [object.element], requiredParameters: 1, result: boolType };
        if (arguments_[0]) {
          const callback = this.inferExpression(arguments_[0], callbackExpected);
          this.requireAssignable(callback, callbackExpected, arguments_[0].span);
        }
        if (arguments_.length !== 1) this.typeError(`Expected 1 argument but received ${arguments_.length}`, callSpan);
        if (member.property === "find") {
          this.collectionCalls.set(member.span.end, "listFind");
          return optionalOf(object.element);
        }
        this.collectionCalls.set(member.span.end, member.property === "some" ? "listSome" : "listEvery");
        return boolType;
      }
      if (member.property === "index") {
        this.collectionCalls.set(member.span.end, "listIndex");
        this.checkArguments(arguments_, [object.element], callSpan);
        return optionalOf(numberType);
      }
      if (member.property === "join") {
        this.collectionCalls.set(member.span.end, "listJoin");
        this.checkArguments(arguments_, [stringType], callSpan, 0);
        if (object.element.kind !== "any" && object.element.kind !== "unknown" && !isAssignable(object.element, stringType, this)) {
          this.typeError(`List.join requires List<string>, received ${describeType(object)}`, member.span);
        }
        return stringType;
      }
      if (member.property === "get") {
        this.collectionCalls.set(member.span.end, "get");
        this.checkArguments(arguments_, [numberType], callSpan);
        return optionalOf(object.element);
      }
      if (member.property === "slice") {
        this.collectionCalls.set(member.span.end, "slice");
        this.checkArguments(arguments_, [numberType, numberType], callSpan, 0);
        return { kind: "list", element: object.element };
      }
    }

    if (object.kind === "map") {
      if (member.property === "set") {
        this.collectionCalls.set(member.span.end, "mapSet");
        const key = arguments_[0] ? this.inferExpression(arguments_[0]) : unknownType;
        const value = arguments_[1] ? this.inferExpression(arguments_[1]) : unknownType;
        if (object.key.kind === "unknown" && object.value.kind === "unknown") {
          this.refineCollectionInference(object, { kind: "map", key, value });
        }
        if (arguments_[0]) this.requireAssignable(key, object.key, arguments_[0].span);
        if (arguments_[1]) this.requireAssignable(value, object.value, arguments_[1].span);
        if (arguments_.length !== 2) this.typeError(`Expected 2 arguments but received ${arguments_.length}`, callSpan);
        return nullType;
      }
      if (member.property === "update") {
        this.collectionCalls.set(member.span.end, "mapUpdate");
        const argument = arguments_[0];
        const source = argument ? this.expandAliases(this.inferExpression(argument)) : unknownType;
        let inferred = false;
        if (argument && source.kind === "map" && object.key.kind === "unknown" && object.value.kind === "unknown") {
          inferred = this.refineCollectionInference(object, source);
        }
        if (argument && !inferred) this.requireAssignable(source, object, argument.span);
        if (arguments_.length !== 1) this.typeError(`Expected 1 argument but received ${arguments_.length}`, callSpan);
        return nullType;
      }
      if (member.property === "get") {
        this.collectionCalls.set(member.span.end, "get");
        this.checkArguments(arguments_, [object.key], callSpan);
        return optionalOf(object.value);
      }
      if (member.property === "keys") {
        this.collectionCalls.set(member.span.end, "keys");
        this.checkArguments(arguments_, [], callSpan);
        return { kind: "list", element: object.key };
      }
      if (member.property === "values") {
        this.collectionCalls.set(member.span.end, "values");
        this.checkArguments(arguments_, [], callSpan);
        return { kind: "list", element: object.value };
      }
      if (member.property === "entries") {
        this.collectionCalls.set(member.span.end, "entries");
        this.checkArguments(arguments_, [], callSpan);
        return { kind: "list", element: { kind: "object", fields: new Map([["key", object.key], ["value", object.value]]) } };
      }
      if (member.property === "has") {
        this.collectionCalls.set(member.span.end, "has");
        this.checkArguments(arguments_, [object.key], callSpan);
        return boolType;
      }
      if (member.property === "remove") {
        this.collectionCalls.set(member.span.end, "remove");
        this.checkArguments(arguments_, [object.key], callSpan);
        return boolType;
      }
      if (member.property === "clear") {
        this.collectionCalls.set(member.span.end, "clear");
        this.checkArguments(arguments_, [], callSpan);
        return nullType;
      }
      if (member.property === "copy") {
        this.collectionCalls.set(member.span.end, "mapCopy");
        this.checkArguments(arguments_, [], callSpan);
        return object;
      }
    }
    if (object.kind === "set") {
      if (member.property === "add") {
        this.collectionCalls.set(member.span.end, "setAdd");
        const value = arguments_[0] ? this.inferExpression(arguments_[0], object.element) : unknownType;
        if (arguments_.length !== 1) this.typeError(`Expected 1 argument but received ${arguments_.length}`, callSpan);
        if (arguments_[0] && object.element.kind === "unknown") {
          if (!this.refineCollectionInference(object, { kind: "set", element: value })) this.requireAssignable(value, object.element, arguments_[0].span);
        } else if (arguments_[0]) this.requireAssignable(value, object.element, arguments_[0].span);
        return nullType;
      }
      if (member.property === "update") {
        this.collectionCalls.set(member.span.end, "setUpdate");
        const argument = arguments_[0];
        const source = argument ? this.expandAliases(this.inferExpression(argument)) : unknownType;
        let inferred = false;
        if (argument && (source.kind === "set" || source.kind === "list") && object.element.kind === "unknown") {
          inferred = this.refineCollectionInference(object, { kind: "set", element: source.element });
        }
        if (argument && !inferred) {
          this.requireAssignable(source, { kind: "union", members: [object, { kind: "list", element: object.element }] }, argument.span);
        }
        if (arguments_.length !== 1) this.typeError(`Expected 1 argument but received ${arguments_.length}`, callSpan);
        return nullType;
      }
      if (member.property === "has") {
        this.collectionCalls.set(member.span.end, "has");
        this.checkArguments(arguments_, [object.element], callSpan);
        return boolType;
      }
      if (member.property === "remove") {
        this.collectionCalls.set(member.span.end, "remove");
        this.checkArguments(arguments_, [object.element], callSpan);
        return boolType;
      }
      if (member.property === "clear") {
        this.collectionCalls.set(member.span.end, "clear");
        this.checkArguments(arguments_, [], callSpan);
        return nullType;
      }
      if (member.property === "values") {
        this.collectionCalls.set(member.span.end, "values");
        this.checkArguments(arguments_, [], callSpan);
        return { kind: "list", element: object.element };
      }
      if (member.property === "copy") {
        this.collectionCalls.set(member.span.end, "setCopy");
        this.checkArguments(arguments_, [], callSpan);
        return object;
      }
    }
    return null;
  }

  private inferMember(
    objectExpression: Expression,
    property: string,
    optional: boolean,
    memberSpan: Span,
    useNarrowing = true,
    readValue = true,
  ): ValueType {
    if (objectExpression.kind === "SuperExpression") {
      if (optional) this.typeError("Optional access is not valid on 'super'", memberSpan);
      const base = this.currentClass ? this.classes.get(this.currentClass)?.base ?? null : null;
      if (!base) {
        this.typeError("'super' is only available inside a derived instance method", objectExpression.span);
        return unknownType;
      }
      const method = this.findMethod(base, property);
      const getter = this.findGetter(base, property);
      if (!method && !getter) {
        this.typeError(`Base class '${base}' has no method or getter '${property}'`, memberSpan);
        return unknownType;
      }
      this.semanticExpressionOwners.set(`${memberSpan.start}:${memberSpan.end}`, { kind: "class", name: base });
      if (getter) this.invalidateEffectfulFlowFacts();
      return method?.type ?? getter!.type;
    }
    const original = this.inferredOrAnalyze(objectExpression);
    this.semanticExpressionOwners.set(`${memberSpan.start}:${memberSpan.end}`, nonOptional(original));
    const resolvedOriginal = this.expandAliases(original);
    const object = nonOptional(resolvedOriginal);
    const guardedCollectionOperation = object.kind === "list"
      ? listCollectionOperations.get(property) ?? null
      : object.kind === "map"
        ? mapCollectionOperations.get(property) ?? null
        : object.kind === "set"
          ? setCollectionOperations.get(property) ?? null
          : null;
    if (resolvedOriginal.kind === "optional" && optional && guardedCollectionOperation) {
      this.collectionCalls.set(memberSpan.end, guardedCollectionOperation);
    }
    const basePath = this.stableMemberAccessPath(objectExpression);
    const narrowedMember = basePath ? this.lookupMemberNarrowing(`${basePath}.${property}`) : null;
    let result = unknownType;
    let effectfulRead = object.kind === "any"
      || (object.kind === "object" || object.kind === "named" || object.kind === "list") && object.external === true;

    if (object.kind === "any") {
      result = anyType;
    } else if (object.kind === "unknown") {
      if (isInvalidType(object)) result = invalidType;
      else this.typeError(`Cannot access '${property}' on unknown without validation`, memberSpan);
    } else if (object.kind === "string" && property === "length") {
      result = numberType;
    } else if (object.kind === "list") {
      result = this.listMember(object, property) ?? unknownType;
      if (property === "size") this.collectionSizes.add(memberSpan.end);
      if (result.kind === "unknown") this.typeError(this.collectionMemberError("List", property), memberSpan);
    } else if (object.kind === "set") {
      result = this.setMember(object, property) ?? unknownType;
      if (property === "size") this.collectionSizes.add(memberSpan.end);
      if (result.kind === "unknown") this.typeError(this.collectionMemberError("Set", property), memberSpan);
    } else if (object.kind === "map") {
      result = this.mapMember(object, property) ?? unknownType;
      if (property === "size") this.collectionSizes.add(memberSpan.end);
      if (result.kind === "unknown") this.typeError(this.collectionMemberError("Map", property), memberSpan);
    } else if (object.kind === "action") {
      if (property === "pending") result = boolType;
      else if (property === "error") result = optionalOf({ kind: "class", name: "Error" });
      else this.typeError(`Action has no member '${property}'`, memberSpan);
    } else if (object.kind === "object") {
      result = object.fields.get(property) ?? unknownType;
      if (object.optionalFields?.has(property) && result.kind !== "unknown") result = optionalOf(result);
      if (!object.fields.has(property)) {
        this.typeError(`Object has no field '${property}'`, memberSpan);
      }
      if (object.external) result = this.markExternalAggregate(result);
    } else if (object.kind === "named") {
      const fields = this.fieldsOf(object.identity ?? object.name);
      result = fields?.get(property) ?? unknownType;
      if (!fields?.has(property)) {
        this.typeError(`Type '${object.name}' has no field '${property}'`, memberSpan);
      }
      if (object.external) result = this.markExternalAggregate(result);
    } else if (object.kind === "class") {
      const classKey = object.identity ?? object.name;
      const privateField = this.privateFieldForAccess(classKey, property, false);
      const privateMethod = this.privateMethodForAccess(classKey, property, false);
      const field = this.findField(classKey, property);
      const getter = this.findGetter(classKey, property);
      const method = this.findMethod(classKey, property);
      result = privateField?.type ?? privateMethod ?? field?.type ?? getter?.type ?? method?.type ?? unknownType;
      effectfulRead = object.external === true || Boolean(getter
        || privateField && (this.privateGetters.get(this.currentClass ?? "")?.has(property) ?? false)
        || classKey.startsWith("js:") && !privateMethod && !method && (privateField || field));
      if (privateField || privateMethod) {
        this.privateMembers.add(spanIdentity(memberSpan));
      } else if (!field && !getter && !method && this.declaresPrivateMember(classKey, property, false)) {
        this.typeError(`Member '${property}' is private to class '${object.name}'`, memberSpan);
      } else if (!field && !getter && !method) {
        this.typeError(`Class '${object.name}' has no member '${property}'`, memberSpan);
      }
      if (object.external) result = this.markExternalAggregate(result);
    } else if (object.kind === "classConstructor") {
      const key = object.identity ?? object.name;
      const privateField = this.privateFieldForAccess(key, property, true);
      const privateMethod = this.privateMethodForAccess(key, property, true);
      const field = this.findStaticField(key, property);
      const getter = this.findStaticGetter(key, property);
      const method = this.findStaticMethod(key, property);
      result = privateField?.type ?? privateMethod ?? field?.type ?? getter ?? method ?? unknownType;
      effectfulRead = Boolean(getter
        || privateField && (this.privateStaticGetters.get(this.currentClass ?? "")?.has(property) ?? false)
        || key.startsWith("js:") && !privateMethod && !method && (privateField || field));
      if (privateField || privateMethod) {
        this.privateMembers.add(spanIdentity(memberSpan));
      } else if (!field && !getter && !method && this.declaresPrivateMember(key, property, true)) {
        this.typeError(`Static member '${property}' is private to class '${object.name}'`, memberSpan);
      } else if (!field && !getter && !method) {
        this.typeError(`Class '${object.name}' has no static member '${property}'`, memberSpan);
      }
    } else if (object.kind === "enumObject") {
      if (object.members.has(property)) {
        result = { kind: "enum", name: object.name, identity: object.identity };
      } else if (property === "is") {
        result = { kind: "function", parameters: [unknownType], requiredParameters: 1, result: boolType };
      } else if (property === "parse") {
        result = { kind: "function", parameters: [unknownType], requiredParameters: 1, result: { kind: "enum", name: object.name, identity: object.identity } };
      } else {
        this.typeError(`Enum '${object.name}' has no member '${property}'`, memberSpan);
      }
    } else if (object.kind === "typeObject") {
      if (property === "parse") {
        result = {
          kind: "function",
          parameters: [unknownType],
          requiredParameters: 1,
          result: this.invalidDeclaredTypes.has(object.name)
            ? invalidType
            : this.typeAliases.get(object.name) ?? { kind: "named", name: object.name },
        };
      } else {
        this.typeError(`Type '${object.name}' has no runtime member '${property}'`, memberSpan);
      }
    } else {
      this.typeError(`${describeType(object)} has no member '${property}'`, memberSpan);
    }

    result = this.displayExternalClasses(result);
    if (useNarrowing && narrowedMember) result = narrowedMember;
    if (readValue && effectfulRead) this.invalidateEffectfulFlowFacts();

    if (optional) {
      const finalType = resolvedOriginal.kind === "optional" || resolvedOriginal.kind === "null" ? optionalOf(result) : result;
      if (finalType.kind === "optional") this.optionalMembers.add(spanIdentity(memberSpan));
      return finalType;
    }
    if (resolvedOriginal.kind === "optional") {
      this.typeError(`Use optional access '?.' for ${describeType(original)}`, memberSpan);
    }
    if (result.kind === "optional") this.optionalMembers.add(spanIdentity(memberSpan));
    return result;
  }

  private recordRuntimeObjectShape(expression: Extract<Expression, { kind: "ObjectExpression" }>, owner: Extract<ValueType, { kind: "named" }>): void {
    const fields = this.fieldsOf(owner.identity ?? owner.name);
    if (!fields) return;
    for (const property of expression.properties) {
      if (property.kind !== "ObjectProperty") continue;
      const field = fields.get(property.name);
      if (!field) continue;
      this.semanticObjectPropertyOwners.set(`${property.span.start}:${property.name}`, owner);
      const nested = nonOptional(field);
      if (property.value.kind === "ObjectExpression" && nested.kind === "named") {
        this.recordRuntimeObjectShape(property.value, nested);
      }
    }
  }

  private listMember(list: Extract<ValueType, { kind: "list" }>, property: string): ValueType | null {
    const owned: ValueType = { kind: "list", element: list.element };
    switch (property) {
      case "size":
        return numberType;
      case "get":
        return { kind: "function", parameters: [numberType], requiredParameters: 1, result: optionalOf(list.element) };
      case "slice":
        return { kind: "function", parameters: [numberType, numberType], requiredParameters: 0, result: owned };
      case "append":
        return { kind: "function", parameters: [list.element], requiredParameters: 1, result: nullType };
      case "extend":
        return { kind: "function", parameters: [list], requiredParameters: 1, result: nullType };
      case "insert":
        return { kind: "function", parameters: [numberType, list.element], requiredParameters: 2, result: nullType };
      case "remove":
        return { kind: "function", parameters: [list.element], requiredParameters: 1, result: boolType };
      case "pop":
        return { kind: "function", parameters: [numberType], requiredParameters: 0, result: optionalOf(list.element) };
      case "clear":
        return { kind: "function", parameters: [], requiredParameters: 0, result: nullType };
      case "copy":
      case "reversed":
        return { kind: "function", parameters: [], requiredParameters: 0, result: owned };
      case "has":
        return { kind: "function", parameters: [list.element], requiredParameters: 1, result: boolType };
      case "count":
        return { kind: "function", parameters: [list.element], requiredParameters: 1, result: numberType };
      case "sorted":
        return { kind: "function", parameters: [{ kind: "function", parameters: [list.element, list.element], requiredParameters: 2, result: numberType }], requiredParameters: 0, result: owned };
      case "map":
        return { kind: "function", parameters: [{ kind: "function", parameters: [list.element], requiredParameters: 1, result: unknownType }], requiredParameters: 1, result: { kind: "list", element: unknownType } };
      case "filter":
        return { kind: "function", parameters: [{ kind: "function", parameters: [list.element], requiredParameters: 1, result: boolType }], requiredParameters: 1, result: owned };
      case "reduce":
        return { kind: "function", parameters: [unknownType, unknownType], requiredParameters: 2, result: unknownType };
      case "some":
      case "every":
        return { kind: "function", parameters: [{ kind: "function", parameters: [list.element], requiredParameters: 1, result: boolType }], requiredParameters: 1, result: boolType };
      case "find":
        return { kind: "function", parameters: [{ kind: "function", parameters: [list.element], requiredParameters: 1, result: boolType }], requiredParameters: 1, result: optionalOf(list.element) };
      case "index":
        return { kind: "function", parameters: [list.element], requiredParameters: 1, result: optionalOf(numberType) };
      case "join":
        return { kind: "function", parameters: [stringType], requiredParameters: 0, result: stringType };
      default:
        return null;
    }
  }

  private collectionMemberError(kind: CollectionKind, property: string): string {
    const guidance = collectionMemberGuidance(kind, property);
    return `${kind} has no member '${property}'${guidance ? `; ${guidance.message}` : ""}`;
  }

  private mapMember(map: Extract<ValueType, { kind: "map" }>, property: string): ValueType | null {
    switch (property) {
      case "size":
        return numberType;
      case "get":
        return { kind: "function", parameters: [map.key], requiredParameters: 1, result: optionalOf(map.value) };
      case "set":
        return { kind: "function", parameters: [map.key, map.value], requiredParameters: 2, result: nullType };
      case "update":
        return { kind: "function", parameters: [map], requiredParameters: 1, result: nullType };
      case "has":
      case "remove":
        return { kind: "function", parameters: [map.key], requiredParameters: 1, result: boolType };
      case "clear":
        return { kind: "function", parameters: [], requiredParameters: 0, result: nullType };
      case "copy":
        return { kind: "function", parameters: [], requiredParameters: 0, result: map };
      case "keys":
        return { kind: "function", parameters: [], requiredParameters: 0, result: { kind: "list", element: map.key } };
      case "values":
        return { kind: "function", parameters: [], requiredParameters: 0, result: { kind: "list", element: map.value } };
      case "entries":
        return { kind: "function", parameters: [], requiredParameters: 0, result: { kind: "list", element: { kind: "object", fields: new Map([["key", map.key], ["value", map.value]]) } } };
      default:
        return null;
    }
  }

  private setMember(set: Extract<ValueType, { kind: "set" }>, property: string): ValueType | null {
    switch (property) {
      case "size":
        return numberType;
      case "add":
        return { kind: "function", parameters: [set.element], requiredParameters: 1, result: nullType };
      case "update":
        return { kind: "function", parameters: [{ kind: "union", members: [set, { kind: "list", element: set.element }] }], requiredParameters: 1, result: nullType };
      case "has":
      case "remove":
        return { kind: "function", parameters: [set.element], requiredParameters: 1, result: boolType };
      case "clear":
        return { kind: "function", parameters: [], requiredParameters: 0, result: nullType };
      case "copy":
        return { kind: "function", parameters: [], requiredParameters: 0, result: set };
      case "values":
        return { kind: "function", parameters: [], requiredParameters: 0, result: { kind: "list", element: set.element } };
      default:
        return null;
    }
  }

  private checkArguments(
    arguments_: readonly Expression[],
    parameters: readonly ValueType[],
    callSpan: Span,
    requiredParameters = parameters.length,
    rest?: ValueType,
    argumentNames?: readonly (string | null)[],
    parameterNames?: readonly string[],
  ): void {
    if (argumentNames?.some((name) => name !== null)) {
      this.orderNamedArguments(arguments_, argumentNames, parameters, parameterNames, requiredParameters, callSpan, rest);
      return;
    }
    const firstSpread = arguments_.findIndex((argument) => argument.kind === "SpreadExpression");
    if (firstSpread >= 0) {
      let fixedIndex = 0;
      let sawSpread = false;
      for (const argument of arguments_) {
        if (argument.kind === "SpreadExpression") {
          sawSpread = true;
          const type = this.inferExpression(argument.value);
          if (this.listReflectionMayExecute(type)) this.invalidateEffectfulFlowFacts();
          if (!rest) this.typeError("Call spread requires a callable with a rest parameter", argument.span);
          else if (fixedIndex < parameters.length) {
            this.typeError(`Provide all ${parameters.length} fixed argument${parameters.length === 1 ? "" : "s"} before a call spread`, argument.span);
          } else if (type.kind === "list") this.requireAssignable(type.element, rest, argument.span);
          if (type.kind !== "list" && type.kind !== "any") {
            this.typeError(`Call spread requires a List, received ${describeType(type)}`, argument.span);
          }
          fixedIndex = parameters.length;
          continue;
        }

        const expected = sawSpread ? rest : parameters[fixedIndex] ?? rest;
        const actual = this.inferExpression(argument, expected ?? unknownType);
        if (expected) this.requireAssignable(actual, expected, argument.span);
        else this.typeError("This fixed-arity call has no position for another argument", argument.span);
        if (!sawSpread && fixedIndex < parameters.length) fixedIndex += 1;
      }
      return;
    }

    if (arguments_.length < requiredParameters || (!rest && arguments_.length > parameters.length)) {
      const expected = rest
        ? `at least ${requiredParameters}`
        : requiredParameters === parameters.length ? String(parameters.length) : `${requiredParameters}-${parameters.length}`;
      this.typeError(`Expected ${expected} arguments but received ${arguments_.length}`, callSpan);
    }
    for (let index = 0; index < arguments_.length; index += 1) {
      const expected = parameters[index] ?? rest ?? unknownType;
      const actual = this.inferExpression(arguments_[index]!, expected);
      this.requireAssignable(actual, expected, arguments_[index]!.span);
    }
  }

  private orderNamedArguments(
    arguments_: readonly Expression[],
    argumentNames: readonly (string | null)[] | undefined,
    parameters: readonly ValueType[],
    parameterNames: readonly string[] | undefined,
    requiredParameters: number,
    callSpan: Span,
    rest?: ValueType,
  ): readonly Expression[] | null {
    if (!argumentNames?.some((name) => name !== null)) return null;
    if (!parameterNames || parameterNames.length !== parameters.length || parameterNames.some((name) => !name)) {
      for (const argument of arguments_) this.inferExpression(argument);
      this.typeError("This callable does not expose stable parameter names", callSpan);
      return null;
    }
    if (arguments_.some((argument) => argument.kind === "SpreadExpression")) {
      for (const argument of arguments_) this.inferExpression(argument.kind === "SpreadExpression" ? argument.value : argument);
      this.typeError("Named arguments cannot be combined with a call spread", callSpan);
      return null;
    }

    const sources = Array<number>(parameters.length).fill(-1);
    let nextPositional = 0;
    for (let sourceIndex = 0; sourceIndex < arguments_.length; sourceIndex += 1) {
      const name = argumentNames[sourceIndex] ?? null;
      let targetIndex: number;
      if (name === null) {
        while (nextPositional < parameters.length && sources[nextPositional] !== -1) nextPositional += 1;
        targetIndex = nextPositional;
        nextPositional += 1;
      } else {
        targetIndex = parameterNames.indexOf(name);
        if (targetIndex === -1) {
          this.inferExpression(arguments_[sourceIndex]!);
          this.typeError(`Unknown named argument '${name}'`, arguments_[sourceIndex]!.span);
          continue;
        }
      }
      if (targetIndex >= parameters.length) {
        this.inferExpression(arguments_[sourceIndex]!, rest ?? unknownType);
        this.typeError("Named calls cannot pass values to a rest parameter", arguments_[sourceIndex]!.span);
        continue;
      }
      if (sources[targetIndex] !== -1) {
        this.inferExpression(arguments_[sourceIndex]!, parameters[targetIndex]);
        this.typeError(`Parameter '${parameterNames[targetIndex]}' is provided more than once`, arguments_[sourceIndex]!.span);
        continue;
      }
      sources[targetIndex] = sourceIndex;
      const actual = this.inferExpression(arguments_[sourceIndex]!, parameters[targetIndex]);
      this.requireAssignable(actual, parameters[targetIndex]!, arguments_[sourceIndex]!.span);
    }

    const missing = parameterNames.filter((_, index) => index < requiredParameters && sources[index] === -1);
    if (missing.length > 0) this.typeError(`Missing required named argument${missing.length === 1 ? "" : "s"}: ${missing.join(", ")}`, callSpan);
    this.namedArgumentOrders.set(spanIdentity(callSpan), sources);
    return sources.map((source, index) => source === -1
      ? { kind: "IdentifierExpression", name: "\u0000omitted-named-argument", span: callSpan } satisfies Expression
      : arguments_[source]!);
  }

  private functionType(statement: FunctionDeclaration): ValueType {
    const result = this.resolveValidatedResult(statement.returnType);
    const rest = statement.parameters.find((parameter) => parameter.rest);
    return {
      kind: "function",
      parameters: statement.parameters.filter((parameter) => !parameter.rest).map((parameter) => this.resolveValidatedAnnotation(parameter.type)),
      parameterNames: statement.parameters.filter((parameter) => !parameter.rest).map((parameter) => parameter.name),
      requiredParameters: statement.parameters.filter((parameter) => !parameter.rest && !parameter.defaultValue).length,
      ...(rest ? { rest: this.resolveValidatedAnnotation(rest.type) } : {}),
      result: statement.asynchronous ? { kind: "promise", value: this.resolvedAsyncResult(result) } : result,
    };
  }

  private externFunctionType(
    statement: ExternFunctionDeclaration,
    resolve: (reference: TypeReference | null) => ValueType = (reference) => this.resolveAnnotation(reference),
  ): ValueType {
    const result = this.markExternalAggregate(statement.returnType ? resolve(statement.returnType) : nullType);
    const rest = statement.parameters.find((parameter) => parameter.rest);
    return {
      kind: "function",
      parameters: statement.parameters.filter((parameter) => !parameter.rest).map((parameter) => resolve(parameter.type)),
      parameterNames: statement.parameters.filter((parameter) => !parameter.rest).map((parameter) => parameter.name),
      requiredParameters: statement.parameters.filter((parameter) => !parameter.rest && !parameter.defaultValue).length,
      ...(rest ? { rest: resolve(rest.type) } : {}),
      result: statement.asynchronous ? { kind: "promise", value: this.resolvedAsyncResult(result) } : result,
    };
  }

  private externConstantType(statement: ExternConstantDeclaration): ValueType {
    return this.resolveAnnotation(statement.type);
  }

  private markExternalAggregate(type: ValueType): ValueType {
    if (type.kind === "named") return { ...type, external: true };
    if (type.kind === "class") return { ...type, external: true };
    if (type.kind === "object") return {
      ...type,
      external: true,
      fields: new Map([...type.fields].map(([name, field]) => [name, this.markExternalAggregate(field)])),
    };
    if (type.kind === "list") return { ...type, external: true, element: this.markExternalAggregate(type.element) };
    if (type.kind === "set") return { ...type, element: this.markExternalAggregate(type.element) };
    if (type.kind === "map") return {
      ...type,
      key: this.markExternalAggregate(type.key),
      value: this.markExternalAggregate(type.value),
    };
    if (type.kind === "optional") return optionalOf(this.markExternalAggregate(type.inner));
    if (type.kind === "promise") return { kind: "promise", value: this.markExternalAggregate(type.value) };
    if (type.kind === "union") return unionOf(type.members.map((member) => this.markExternalAggregate(member)));
    if (type.kind === "function" || type.kind === "action" || type.kind === "intrinsic") {
      return { ...type, result: this.markExternalAggregate(type.result) };
    }
    return type;
  }

  private externClassIdentity(source: string, name: string): string {
    return `js:${source}#${name}`;
  }

  private resolveExternAnnotation(reference: TypeReference | null, source: string, classNames: ReadonlySet<string>): ValueType {
    const resolve = (type: ValueType): ValueType => {
      if (type.kind === "named" && classNames.has(type.name)) {
        return { kind: "class", name: type.name, identity: this.externClassIdentity(source, type.name) };
      }
      if (type.kind === "optional") return optionalOf(resolve(type.inner));
      if (type.kind === "list") return { ...type, element: resolve(type.element) };
      if (type.kind === "set") return { kind: "set", element: resolve(type.element) };
      if (type.kind === "map") return { kind: "map", key: resolve(type.key), value: resolve(type.value) };
      if (type.kind === "promise") return { kind: "promise", value: resolve(type.value) };
      if (type.kind === "object") return { ...type, fields: new Map([...type.fields].map(([name, value]) => [name, resolve(value)])) };
      if (type.kind === "function" || type.kind === "action" || type.kind === "intrinsic") return {
        ...type,
        parameters: type.parameters.map(resolve),
        ...(type.rest ? { rest: resolve(type.rest) } : {}),
        result: resolve(type.result),
      };
      if (type.kind === "union") return { kind: "union", members: type.members.map(resolve) };
      return this.resolveNamedClasses(type);
    };
    return reference ? resolve(this.expandAliases(resolveTypeReference(reference))) : unknownType;
  }

  private resolveValidatedExternAnnotation(reference: TypeReference | null, source: string, classNames: ReadonlySet<string>): ValueType {
    if (!reference) return unknownType;
    return this.invalidExternTypeReferences.has(reference)
      ? invalidType
      : this.resolveExternAnnotation(reference, source, classNames);
  }

  private importType(statement: Extract<Statement, { kind: "ImportDeclaration" }>, local: string, imported: string, namespace: boolean): ValueType {
    if (!statement.javascript) {
      const type = this.importBindings.get(local) ?? unknownType;
      if (type.kind === "classConstructor" && type.identity) this.classDisplayNames.set(type.identity, local);
      return type;
    }
    if (statement.unsafe) return anyType;
    const declarations = this.externModules.get(statement.source);
    if (namespace) return declarations
      ? { kind: "object", fields: declarations, readonlyFields: new Set(declarations.keys()), external: true }
      : this.importBindings.get(local) ?? unknownType;
    const type = declarations?.get(imported) ?? this.importBindings.get(local) ?? unknownType;
    if (type.kind === "classConstructor" && type.identity) {
      this.classDisplayNames.set(type.identity, local);
      return { ...type, name: local };
    }
    return type;
  }

  protected narrowingFor(expression: Expression, knownType?: ValueType): ReadonlyMap<string, ValueType> {
    return this.conditionNarrowing(expression, true, knownType);
  }

  protected negativeNarrowingFor(expression: Expression, knownType?: ValueType): ReadonlyMap<string, ValueType> {
    return this.conditionNarrowing(expression, false, knownType);
  }

  private conditionNarrowing(expression: Expression, truthy: boolean, knownType?: ValueType): ReadonlyMap<string, ValueType> {
    const logical = this.logicalConditionNarrowings.get(spanIdentity(expression.span));
    if (logical) return truthy ? logical.truthy : logical.falsy;
    const narrowed = new Map<string, ValueType>();
    if (expression.kind === "UnaryExpression" && expression.operator === "not") {
      return this.conditionNarrowing(expression.operand, !truthy);
    }
    if (expression.kind === "BinaryExpression" && (expression.operator === "==" || expression.operator === "!=")) {
      const leftIsNone = expression.left.kind === "LiteralExpression" && expression.left.value === null;
      const rightIsNone = expression.right.kind === "LiteralExpression" && expression.right.value === null;
      if (leftIsNone !== rightIsNone) {
        const candidate = leftIsNone ? expression.right : expression.left;
        const candidateType = this.inferredExpressionTypes.get(spanIdentity(candidate.span));
        if (candidateType?.kind === "optional") {
          const equalToNone = expression.operator === "==" ? truthy : !truthy;
          this.addLocationNarrowing(narrowed, candidate, equalToNone ? nullType : candidateType.inner);
        }
      }
      return narrowed;
    }
    if (expression.kind === "IdentifierExpression") {
      const type = this.lookup(expression.name)?.type;
      if (type?.kind === "optional") {
        narrowed.set(expression.name, truthy ? type.inner : nullType);
      }
    } else if (expression.kind === "MemberExpression" && !expression.optional) {
      const path = this.stableMemberAccessPath(expression);
      const type = knownType ?? this.inferredExpressionTypes.get(spanIdentity(expression.span));
      if (path && type?.kind === "optional") narrowed.set(`${memberNarrowingPrefix}${path}`, truthy ? type.inner : nullType);
    } else if (expression.kind === "IsExpression") {
      const checked = this.resolveAnnotation(expression.type);
      if (truthy) {
        const current = this.inferredExpressionTypes.get(spanIdentity(expression.value.span)) ?? unknownType;
        this.addLocationNarrowing(narrowed, expression.value, this.runtimeCheckedType(current, checked));
      } else {
        const current = this.inferredExpressionTypes.get(spanIdentity(expression.value.span));
        const remaining = current ? this.excludeCheckedType(current, checked) : null;
        if (remaining) this.addLocationNarrowing(narrowed, expression.value, remaining);
      }
    }
    return narrowed;
  }

  private excludeCheckedType(current: ValueType, checked: ValueType): ValueType | null {
    if (current.kind === "optional") {
      const innerExcluded = isAssignable(current.inner, checked, this);
      const noneExcluded = isAssignable(nullType, checked, this);
      if (innerExcluded && !noneExcluded) return nullType;
      if (noneExcluded && !innerExcluded) return current.inner;
      return null;
    }
    if (current.kind !== "union") return null;
    const remaining = current.members.filter((member) => !isAssignable(member, checked, this));
    return remaining.length > 0 && remaining.length < current.members.length ? unionOf(remaining) : null;
  }

  private addLocationNarrowing(target: Map<string, ValueType>, expression: Expression, type: ValueType): void {
    if (expression.kind === "IdentifierExpression") {
      if (this.lookup(expression.name)) target.set(expression.name, type);
      return;
    }
    const path = this.stableMemberAccessPath(expression);
    if (path) target.set(`${memberNarrowingPrefix}${path}`, type);
  }

  private inferNarrowedExpression(
    expression: Expression,
    narrowed: ReadonlyMap<string, ValueType>,
    contextualType: ValueType,
  ): ValueType {
    return this.withTemporaryNarrowings(narrowed, expression.span, () => this.inferExpression(expression, contextualType));
  }

  private withTemporaryNarrowings<T>(
    narrowed: ReadonlyMap<string, ValueType>,
    narrowingSpan: Span,
    analyze: () => T,
  ): T {
    if (narrowed.size === 0) return analyze();
    this.enterScope();
    try {
      this.applyNarrowings(narrowed, narrowingSpan);
      return analyze();
    } finally {
      this.exitScope();
    }
  }

  private optionalExecutionNarrowings(expression: Expression): ReadonlyMap<string, ValueType> {
    const narrowed = new Map<string, ValueType>();
    const visit = (candidate: Expression): void => {
      const known = this.inferredExpressionTypes.get(spanIdentity(candidate.span));
      const expanded = known ? this.expandAliases(known) : null;
      if (expanded?.kind === "optional") {
        if (candidate.kind === "IdentifierExpression" && this.lookup(candidate.name)) {
          narrowed.set(candidate.name, expanded.inner);
        } else if (candidate.kind === "MemberExpression") {
          const path = this.stableOptionalMemberAccessPath(candidate);
          if (path) narrowed.set(`${memberNarrowingPrefix}${path}`, expanded.inner);
        }
      }
      if (candidate.kind === "MemberExpression" || candidate.kind === "IndexExpression") {
        visit(candidate.object);
      } else if (candidate.kind === "CallExpression") {
        visit(candidate.callee);
      }
    };
    visit(expression);
    return narrowed;
  }

  private inferConditionWithNarrowings(
    expression: Expression,
    narrowed: ReadonlyMap<string, ValueType>,
  ): {
    readonly type: ValueType;
    readonly truthy: ReadonlyMap<string, ValueType>;
    readonly falsy: ReadonlyMap<string, ValueType>;
    readonly surviving: ReadonlyMap<string, ValueType>;
  } {
    if (narrowed.size === 0) {
      const type = this.inferExpression(expression);
      this.requireCondition(type, expression);
      return {
        type,
        truthy: this.narrowingFor(expression, type),
        falsy: this.negativeNarrowingFor(expression, type),
        surviving: new Map(),
      };
    }
    this.enterScope();
    try {
      this.applyNarrowings(narrowed, expression.span);
      const type = this.inferExpression(expression);
      this.requireCondition(type, expression);
      return {
        type,
        truthy: this.narrowingFor(expression, type),
        falsy: this.negativeNarrowingFor(expression, type),
        surviving: this.survivingNarrowings(narrowed),
      };
    } finally {
      this.exitScope();
    }
  }

  private combineNarrowings(
    first: ReadonlyMap<string, ValueType>,
    second: ReadonlyMap<string, ValueType>,
  ): ReadonlyMap<string, ValueType> {
    return new Map([...first, ...second]);
  }

  protected requireCondition(type: ValueType, condition: Expression): void {
    if (isInvalidType(type)) return;
    if (type.kind === "optional") this.presenceConditions.add(spanIdentity(condition.span));
    if (type.kind !== "bool" && type.kind !== "optional" && type.kind !== "any") {
      this.typeError(`Condition must be bool or optional, received ${describeType(type)}`, condition.span);
    }
  }

  protected requireAssignable(actual: ValueType, expected: ValueType, valueSpan: Span): void {
    if (this.contextuallyAssignable(actual, expected, valueSpan)) {
      this.freezeEscapedCollectionInference(actual, expected);
      return;
    }
    this.typeError(`Cannot assign ${describeType(actual)} to ${describeType(expected)}`, valueSpan);
  }

  private freezeEscapedCollectionInference(actual: ValueType, expected: ValueType, seen: WeakMap<object, WeakSet<object>> = new WeakMap()): void {
    const inference = this.collectionInferenceTypes.get(actual);
    const expectedInference = this.collectionInferenceTypes.get(expected);
    if (inference && actual !== expected && !expectedInference) inference.open = false;

    const expandedActual = this.expandAliases(actual);
    const expandedExpected = this.expandAliases(expected);
    const expectedSeen = seen.get(expandedActual) ?? new WeakSet<object>();
    if (expectedSeen.has(expandedExpected)) return;
    expectedSeen.add(expandedExpected);
    seen.set(expandedActual, expectedSeen);

    if (expandedExpected.kind === "optional") {
      if (expandedActual.kind === "optional") this.freezeEscapedCollectionInference(expandedActual.inner, expandedExpected.inner, seen);
      else if (expandedActual.kind !== "null") this.freezeEscapedCollectionInference(expandedActual, expandedExpected.inner, seen);
      return;
    }
    if (expandedExpected.kind === "union") {
      const target = expandedExpected.members.find((member) => isAssignable(expandedActual, member, this));
      if (target) this.freezeEscapedCollectionInference(expandedActual, target, seen);
      return;
    }
    if (expandedActual.kind === "union") {
      for (const member of expandedActual.members) this.freezeEscapedCollectionInference(member, expandedExpected, seen);
      return;
    }
    if ((expandedActual.kind === "list" && expandedExpected.kind === "list")
      || (expandedActual.kind === "set" && expandedExpected.kind === "set")) {
      this.freezeEscapedCollectionInference(expandedActual.element, expandedExpected.element, seen);
      return;
    }
    if (expandedActual.kind === "map" && expandedExpected.kind === "map") {
      this.freezeEscapedCollectionInference(expandedActual.key, expandedExpected.key, seen);
      this.freezeEscapedCollectionInference(expandedActual.value, expandedExpected.value, seen);
      return;
    }
    const actualFields = expandedActual.kind === "object" ? expandedActual.fields
      : expandedActual.kind === "named" ? this.fieldsOf(expandedActual.identity ?? expandedActual.name)
        : null;
    const expectedFields = expandedExpected.kind === "object" ? expandedExpected.fields
      : expandedExpected.kind === "named" ? this.fieldsOf(expandedExpected.identity ?? expandedExpected.name)
        : null;
    if (actualFields && expectedFields) {
      for (const [name, expectedField] of expectedFields) {
        const actualField = actualFields.get(name);
        if (actualField) this.freezeEscapedCollectionInference(actualField, expectedField, seen);
      }
    }
  }

  private contextuallyAssignable(actual: ValueType, expected: ValueType, valueSpan: Span): boolean {
    if (isAssignable(actual, expected, this)) return true;
    const contextual = this.contextualAssignments.get(spanIdentity(valueSpan));
    return Boolean(contextual && isAssignable(this.expandAliases(contextual), this.expandAliases(expected), this));
  }

  private contextualObjectType(type: ValueType): Extract<ValueType, { kind: "named" | "object" }> | null {
    const expanded = this.expandAliases(type);
    if (expanded.kind === "named" || expanded.kind === "object") return expanded;
    if (expanded.kind === "optional") return this.contextualObjectType(expanded.inner);
    if (expanded.kind === "union") {
      const candidates = expanded.members
        .map((member) => this.contextualObjectType(member))
        .filter((member): member is Extract<ValueType, { kind: "named" | "object" }> => member !== null);
      return candidates.length === 1 ? candidates[0]! : null;
    }
    return null;
  }

  private contextualCollectionType(type: ValueType): Extract<ValueType, { kind: "list" | "map" | "set" }> | null {
    const expanded = this.expandAliases(type);
    if (expanded.kind === "list" || expanded.kind === "map" || expanded.kind === "set") return expanded;
    if (expanded.kind === "optional") return this.contextualCollectionType(expanded.inner);
    return null;
  }

  private formReadField(name: string, source: ValueType, fieldSpan: Span): FormReadField | null {
    const expanded = this.expandAliases(source);
    const optional = expanded.kind === "optional";
    const type = optional ? expanded.inner : expanded;
    if (type.kind === "string" || type.kind === "number") {
      return { name, kind: type.kind, optional };
    }
    if (type.kind === "bool" && !optional) {
      return { name, kind: "bool", optional: false };
    }
    if (type.kind === "enum") {
      const values = this.enums.get(type.identity)?.members ?? this.enums.get(type.name)?.members;
      if (values) return { name, kind: "enum", optional, enumValues: [...values] };
    }
    if (type.kind === "list" && type.element.kind === "string" && !optional) {
      return { name, kind: "strings", optional: false };
    }
    this.typeError(`Form field '${name}' cannot decode ${describeType(expanded)}; use string, number, bool, an enum, an optional scalar, or List<string>`, fieldSpan);
    return null;
  }

  private jsonSerializable(source: ValueType, seen: ReadonlySet<string> = new Set()): boolean | null {
    const type = this.resolveNamedClasses(this.expandAliases(source));
    if (type.kind === "unknown" || type.kind === "any") return null;
    if (type.kind === "null" || type.kind === "string" || type.kind === "number" || type.kind === "bool" || type.kind === "enum") return true;
    if (type.kind === "optional") return this.jsonSerializable(type.inner, seen);
    if (type.kind === "list") return this.jsonSerializable(type.element, seen);
    if (type.kind === "union") return this.combineJsonStatuses(type.members.map((member) => this.jsonSerializable(member, seen)));
    if (type.kind === "object") return this.combineJsonStatuses([...type.fields.values()].map((field) => this.jsonSerializable(field, seen)));
    if (type.kind === "named") {
      const identity = type.identity ?? type.name;
      if (seen.has(identity)) return true;
      const fields = this.fieldsOf(identity);
      if (!fields) return false;
      const next = new Set([...seen, identity]);
      return this.combineJsonStatuses([...fields.values()].map((field) => this.jsonSerializable(field, next)));
    }
    return false;
  }

  private isHttpFormBody(source: ValueType): boolean {
    const type = this.resolveNamedClasses(this.expandAliases(source));
    return type.kind === "object"
      && ["field", "file", "files", "remove", "has", "names"].every((name) => type.fields.has(name));
  }

  private isCollectionOrderKey(source: ValueType): boolean {
    const type = this.resolveNamedClasses(this.expandAliases(source));
    if (type.kind === "any" || type.kind === "unknown" || type.kind === "string" || type.kind === "number" || type.kind === "enum") return true;
    if (type.kind !== "union" || type.members.length === 0) return false;
    const categories = new Set(type.members.map((member) => {
      const value = this.resolveNamedClasses(this.expandAliases(member));
      return value.kind === "string" || value.kind === "enum" ? "string" : value.kind === "number" ? "number" : "invalid";
    }));
    return !categories.has("invalid") && categories.size === 1;
  }

  private combineJsonStatuses(statuses: readonly (boolean | null)[]): boolean | null {
    if (statuses.some((status) => status === false)) return false;
    return statuses.some((status) => status === null) ? null : true;
  }

  protected resolveAnnotation(reference: TypeReference | null): ValueType {
    return reference ? this.resolveNamedClasses(this.expandAliases(resolveTypeReference(reference))) : unknownType;
  }

  protected resolveValidatedAnnotation(reference: TypeReference | null): ValueType {
    if (!reference) return unknownType;
    return this.validateTypeReference(reference) ? this.resolveAnnotation(reference) : invalidType;
  }

  protected resolveResult(reference: TypeReference | null): ValueType {
    return reference ? this.resolveAnnotation(reference) : nullType;
  }

  protected resolveValidatedResult(reference: TypeReference | null): ValueType {
    return reference ? this.resolveValidatedAnnotation(reference) : nullType;
  }

  private resolveNamedClasses(type: ValueType): ValueType {
    if (type.kind === "named" && this.enums.has(type.name)) {
      return { kind: "enum", name: type.name, identity: this.enums.get(type.name)!.identity };
    }
    if (type.kind === "named") {
      const imported = this.lookup(type.name)?.type ?? this.importBindings.get(type.name) ?? this.externTypeImports.get(type.name);
      if (imported?.kind === "classConstructor") {
        return {
          kind: "class",
          name: type.name,
          ...(imported.identity ? { identity: imported.identity } : {}),
          ...(type.external ? { external: true } : {}),
        };
      }
    }
    if (type.kind === "named" && this.classes.has(type.name)) {
      const info = this.classes.get(type.name);
      return {
        kind: "class",
        name: type.name,
        ...(info?.identity ? { identity: info.identity } : {}),
        ...(type.external ? { external: true } : {}),
      };
    }
    if (type.kind === "named" && !type.identity && this.namedTypeIdentities.has(type.name)) {
      return { ...type, identity: this.namedTypeIdentities.get(type.name)! };
    }
    if (type.kind === "optional") {
      return optionalOf(this.resolveNamedClasses(type.inner));
    }
    if (type.kind === "list") {
      return { ...type, element: this.resolveNamedClasses(type.element) };
    }
    if (type.kind === "set") {
      return { kind: "set", element: this.resolveNamedClasses(type.element) };
    }
    if (type.kind === "map") {
      return { kind: "map", key: this.resolveNamedClasses(type.key), value: this.resolveNamedClasses(type.value) };
    }
    if (type.kind === "promise") {
      return { kind: "promise", value: this.resolveNamedClasses(type.value) };
    }
    if (type.kind === "function" || type.kind === "action" || type.kind === "intrinsic") {
      return {
        ...type,
        parameters: type.parameters.map((parameter) => this.resolveNamedClasses(parameter)),
        ...(type.rest ? { rest: this.resolveNamedClasses(type.rest) } : {}),
        result: this.resolveNamedClasses(type.result),
      };
    }
    if (type.kind === "union") {
      return { kind: "union", members: type.members.map((member) => this.resolveNamedClasses(member)) };
    }
    return type;
  }

  protected validateTypeReference(
    reference: TypeReference,
    resolve?: (reference: TypeReference) => ValueType,
  ): boolean {
    if (!resolve) {
      const cached = this.typeReferenceValidity.get(reference);
      if (cached !== undefined) return cached;
    }
    const resolver = resolve ?? ((value: TypeReference) => this.resolveAnnotation(value));
    const validate = (syntax: TypeSyntax): boolean => {
      switch (syntax.kind) {
        case "NamedTypeSyntax": {
          if (syntax.name === "any") {
            this.typeError("'any' is reserved for explicit unsafe JavaScript boundaries; use 'unknown' in VelarScript", syntax.span);
            return false;
          }
          if (this.invalidDeclaredTypes.has(syntax.name)) return false;
          if (this.primitiveNames.has(syntax.name)
            || this.namedTypes.has(syntax.name)
            || this.namedTypeIdentities.has(syntax.name)
            || this.typeAliases.has(syntax.name)
            || this.classes.has(syntax.name)
            || this.enums.has(syntax.name)
            || this.externTypeImports.has(syntax.name)) return true;
          const resolved = resolver({ syntax, span: syntax.span });
          if (resolved.kind !== "named"
            || (resolved.identity && this.namedTypes.has(resolved.identity))) return true;
          this.typeError(`Unknown type '${syntax.name}'`, syntax.span);
          return false;
        }
        case "GenericTypeSyntax": {
          let valid = true;
          if (syntax.name !== "List" && syntax.name !== "Set" && syntax.name !== "Map" && syntax.name !== "Promise") {
            const resolved = resolver({ syntax, span: syntax.span });
            if (resolved.kind === "named") {
              this.typeError(`Unknown type '${syntax.name}'`, syntax.nameSpan);
              valid = false;
            }
          }
          const argumentsValid = syntax.arguments.map(validate).every(Boolean);
          return valid && argumentsValid;
        }
        case "OptionalTypeSyntax":
          return validate(syntax.inner);
        case "UnionTypeSyntax":
          return syntax.members.map(validate).every(Boolean);
        case "FunctionTypeSyntax": {
          const parametersValid = syntax.parameters.map((parameter) => validate(parameter.type)).every(Boolean);
          const resultValid = validate(syntax.result);
          return parametersValid && resultValid;
        }
      }
    };
    const valid = validate(reference.syntax);
    if (!resolve) this.typeReferenceValidity.set(reference, valid);
    return valid;
  }

  protected typeError(message: string, errorSpan: Span): void {
    this.diagnostics.push(diagnostic("VEL4001", message, errorSpan));
  }

  private analyzeMatchPattern(
    pattern: MatchPattern,
    input: ValueType,
    bindings: Map<string, { readonly type: ValueType; readonly span: Span }>,
  ): ValueType {
    switch (pattern.kind) {
      case "MatchAsPattern": {
        const narrowed = this.analyzeMatchPattern(pattern.pattern, input, bindings);
        this.addMatchBinding(bindings, pattern.binding.name, narrowed, pattern.binding.span);
        return narrowed;
      }
      case "MatchWildcardPattern":
        return input;
      case "MatchCapturePattern":
        this.addMatchBinding(bindings, pattern.binding.name, input, pattern.binding.span);
        return input;
      case "MatchValuePattern": {
        const values: ValueType[] = [];
        for (const value of pattern.values) {
          const literal = this.inferExpression(value);
          values.push(literal);
          if (input.kind !== "unknown" && !this.matchLiteralCompatible(this.expandAliases(input), literal)) {
            this.typeError(`Cannot match ${describeType(input)} against ${describeType(literal)}`, value.span);
          }
        }
        return values.length > 0 ? unionOf(values) : unknownType;
      }
      case "MatchTypePattern": {
        const checked = this.resolveAnnotation(pattern.type);
        const valid = this.validateTypeReference(pattern.type);
        if (valid && checked.kind === "class"
          && (checked.identity ?? checked.name).startsWith("js:")) this.invalidateEffectfulFlowFacts();
        if (valid && input.kind !== "unknown" && !this.matchTypesOverlap(this.expandAliases(input), checked)) {
          this.typeError(`Type pattern ${describeType(checked)} can never match ${describeType(input)}`, pattern.span);
        }
        return valid ? this.narrowMatchType(input, checked) : invalidType;
      }
      case "MatchListPattern": {
        const candidates = this.matchListCandidates(input);
        if (candidates.length === 0) {
          this.typeError(`A List pattern can never match ${describeType(input)}`, pattern.span);
        }
        const elementTypes = candidates.map((candidate) => candidate.kind === "list" ? candidate.element : anyType);
        const element = elementTypes.length > 0 ? unionOf(elementTypes) : unknownType;
        for (const child of pattern.elements) this.analyzeMatchPattern(child, element, bindings);
        if (pattern.rest) {
          this.addMatchBinding(bindings, pattern.rest.name, { kind: "list", element }, pattern.rest.span);
        }
        return candidates.length > 0 ? unionOf(candidates) : unknownType;
      }
      case "MatchObjectPattern": {
        const candidates = this.matchObjectCandidates(input);
        if (candidates.length === 0) {
          this.typeError(`An object pattern can never match ${describeType(input)}`, pattern.span);
        }
        const seen = new Set<string>();
        const eligible = candidates.filter((candidate) => candidate.kind === "any"
          || pattern.entries.every((entry) => this.matchObjectField(candidate, entry.property) !== null));
        if (candidates.length > 0 && eligible.length === 0) {
          this.typeError(`Object pattern fields cannot occur together on ${describeType(input)}`, pattern.span);
        }
        for (const entry of pattern.entries) {
          if (seen.has(entry.property)) {
            this.diagnostics.push(diagnostic("VEL4019", `Object pattern field '${entry.property}' is declared more than once`, entry.span));
          }
          seen.add(entry.property);
          const fieldCandidates = eligible
            .map((candidate) => this.matchObjectField(candidate, entry.property))
            .filter((field): field is ValueType => field !== null);
          if (fieldCandidates.length === 0 && candidates.length > 0
            && !candidates.some((candidate) => this.matchObjectField(candidate, entry.property) !== null)) {
            this.typeError(`Object pattern field '${entry.property}' does not exist on ${describeType(input)}`, entry.span);
          }
          const owners = eligible.filter((candidate): candidate is Extract<ValueType, { kind: "named" }> => candidate.kind === "named"
            && this.matchObjectField(candidate, entry.property) !== null);
          if (owners.length === 1) {
            this.semanticBindingEntryOwners.set(`${entry.span.start}:${entry.property}`, owners[0]!);
          }
          this.analyzeMatchPattern(
            entry.pattern,
            fieldCandidates.length > 0 ? unionOf(fieldCandidates) : unknownType,
            bindings,
          );
        }
        if (pattern.rest) {
          this.addMatchBinding(bindings, pattern.rest.name, this.matchObjectRestType(eligible, seen), pattern.rest.span);
        }
        return eligible.length > 0 ? unionOf(eligible) : unknownType;
      }
    }
  }

  private matchLocationNarrowing(expression: Expression, type: ValueType): ReadonlyMap<string, ValueType> {
    const narrowed = new Map<string, ValueType>();
    this.addLocationNarrowing(narrowed, expression, type);
    return narrowed;
  }

  private retargetNarrowings(source: ReadonlyMap<string, ValueType>, type: ValueType): ReadonlyMap<string, ValueType> {
    return new Map([...source.keys()].map((key) => [key, type]));
  }

  private matchFallthroughType(input: ValueType, pattern: MatchPattern): ValueType {
    const source = this.expandAliases(input);
    const members = source.kind === "union" ? source.members
      : source.kind === "optional" ? [source.inner, nullType]
        : null;
    if (!members) return input;
    const remaining = members.filter((member) => !this.matchPatternCoversWholeType(pattern, member));
    return remaining.length > 0 && remaining.length < members.length ? unionOf(remaining) : input;
  }

  private matchPatternCoversWholeType(pattern: MatchPattern, input: ValueType): boolean {
    if (pattern.kind === "MatchAsPattern") return this.matchPatternCoversWholeType(pattern.pattern, input);
    if (pattern.kind === "MatchWildcardPattern" || pattern.kind === "MatchCapturePattern") return true;
    if (pattern.kind === "MatchTypePattern") {
      return isAssignable(input, this.resolveAnnotation(pattern.type), this);
    }
    if (pattern.kind === "MatchValuePattern") {
      if (input.kind === "null") {
        return pattern.values.some((value) => value.kind === "LiteralExpression" && value.value === null);
      }
      if (input.kind === "bool") {
        const values = new Set<boolean>();
        for (const value of pattern.values) {
          if (value.kind === "LiteralExpression" && typeof value.value === "boolean") values.add(value.value);
        }
        return values.has(true) && values.has(false);
      }
      return false;
    }
    return this.matchPatternCoversType(pattern, input);
  }

  private unwrapMatchAs(pattern: MatchPattern): MatchPattern {
    return pattern.kind === "MatchAsPattern" ? this.unwrapMatchAs(pattern.pattern) : pattern;
  }

  private matchPatternIsIrrefutable(pattern: MatchPattern): boolean {
    if (pattern.kind === "MatchWildcardPattern" || pattern.kind === "MatchCapturePattern") return true;
    return pattern.kind === "MatchAsPattern" && this.matchPatternIsIrrefutable(pattern.pattern);
  }

  private matchPatternCoversType(pattern: MatchPattern, input: ValueType): boolean {
    if (pattern.kind === "MatchWildcardPattern" || pattern.kind === "MatchCapturePattern") return true;
    if (pattern.kind === "MatchAsPattern") return this.matchPatternCoversType(pattern.pattern, input);
    const type = this.expandAliases(input);
    if (type.kind === "union") return type.members.every((member) => this.matchPatternCoversType(pattern, member));
    if (pattern.kind === "MatchTypePattern") {
      return isAssignable(type, this.resolveAnnotation(pattern.type), this);
    }
    if (pattern.kind === "MatchListPattern") {
      return type.kind === "list" && pattern.rest !== null && pattern.elements.length === 0;
    }
    if (pattern.kind !== "MatchObjectPattern") return false;
    const fields = type.kind === "object"
      ? type.fields
      : type.kind === "named" ? this.fieldsOf(type.identity ?? type.name) : null;
    if (!fields) return false;
    return pattern.entries.every((entry) => {
      if (type.kind === "object" && type.optionalFields?.has(entry.property)) return false;
      const field = fields.get(entry.property);
      return Boolean(field && field.kind !== "optional" && this.matchPatternCoversType(entry.pattern, field));
    });
  }

  private addMatchBinding(
    bindings: Map<string, { readonly type: ValueType; readonly span: Span }>,
    name: string,
    type: ValueType,
    bindingSpan: Span,
  ): void {
    if (name === "_") return;
    if (bindings.has(name)) {
      this.diagnostics.push(diagnostic("VEL4019", `Match binding '${name}' is declared more than once`, bindingSpan));
      return;
    }
    bindings.set(name, { type, span: bindingSpan });
  }

  private matchListCandidates(input: ValueType): ValueType[] {
    const type = this.expandAliases(input);
    if (type.kind === "union") return type.members.flatMap((member) => this.matchListCandidates(member));
    if (type.kind === "optional") return this.matchListCandidates(type.inner);
    return type.kind === "list" || type.kind === "any" ? [type] : [];
  }

  private matchObjectCandidates(input: ValueType): ValueType[] {
    const type = this.expandAliases(input);
    if (type.kind === "union") return type.members.flatMap((member) => this.matchObjectCandidates(member));
    if (type.kind === "optional") return this.matchObjectCandidates(type.inner);
    if (type.kind === "object" || type.kind === "any") return [type];
    return type.kind === "named" && this.fieldsOf(type.identity ?? type.name) ? [type] : [];
  }

  private matchObjectField(candidate: ValueType, property: string): ValueType | null {
    if (candidate.kind === "any") return anyType;
    const fields = candidate.kind === "object"
      ? candidate.fields
      : candidate.kind === "named" ? this.fieldsOf(candidate.identity ?? candidate.name) : null;
    const field = fields?.get(property) ?? null;
    const external = (candidate.kind === "object" || candidate.kind === "named") && candidate.external;
    return field && external ? this.markExternalAggregate(field) : field;
  }

  private matchObjectRestType(candidates: readonly ValueType[], selected: ReadonlySet<string>): ValueType {
    if (candidates.some((candidate) => candidate.kind === "any")) return anyType;
    const rests = candidates.map((candidate): ValueType => {
      const fields = candidate.kind === "object"
        ? candidate.fields
        : candidate.kind === "named" ? this.fieldsOf(candidate.identity ?? candidate.name) : null;
      const remaining = new Map([...(fields ?? [])].filter(([name]) => !selected.has(name)));
      const optionalFields = candidate.kind === "object"
        ? new Set([...(candidate.optionalFields ?? [])].filter((name) => !selected.has(name)))
        : new Set<string>();
      return {
        kind: "object",
        fields: remaining,
        ...(optionalFields.size > 0 ? { optionalFields } : {}),
      };
    });
    return rests.length > 0 ? unionOf(rests) : { kind: "object", fields: new Map() };
  }

  private narrowMatchType(input: ValueType, checked: ValueType): ValueType {
    const source = this.expandAliases(input);
    if (source.kind === "any" || source.kind === "unknown") return this.markExternalAggregate(checked);
    if (source.kind === "union") {
      const members = source.members
        .filter((member) => this.matchTypesOverlap(member, checked))
        .map((member) => this.narrowMatchType(member, checked));
      return members.length > 0 ? unionOf(members) : checked;
    }
    if (source.kind === "optional") {
      const members = [source.inner, nullType]
        .filter((member) => this.matchTypesOverlap(member, checked))
        .map((member) => this.narrowMatchType(member, checked));
      return members.length > 0 ? unionOf(members) : checked;
    }
    if (isAssignable(source, checked, this)) return source;
    return checked;
  }

  private matchLiteralCompatible(matched: ValueType, literal: ValueType): boolean {
    if (matched.kind === "any") return true;
    if (matched.kind === "union") return matched.members.some((member) => this.matchLiteralCompatible(member, literal));
    if (matched.kind === "optional") {
      return literal.kind === "null" || this.matchLiteralCompatible(matched.inner, literal);
    }
    if (matched.kind === "enum") return literal.kind === "enum" && matched.identity === literal.identity;
    return matched.kind === literal.kind
      && (matched.kind === "string" || matched.kind === "number" || matched.kind === "bool" || matched.kind === "null");
  }

  private matchValueKey(value: MatchValue): string {
    return value.kind === "LiteralExpression"
      ? value.value === null ? "null" : `${typeof value.value}:${String(value.value)}`
      : `${value.object.kind === "IdentifierExpression" ? value.object.name : "?"}.${value.property}`;
  }

  private matchTypesOverlap(left: ValueType, right: ValueType): boolean {
    if (left.kind === "any" || right.kind === "any" || right.kind === "unknown") return true;
    if (left.kind === "unknown") return false;
    if (left.kind === "union") return left.members.some((member) => this.matchTypesOverlap(member, right));
    if (right.kind === "union") return right.members.some((member) => this.matchTypesOverlap(left, member));
    if (left.kind === "optional") return this.matchTypesOverlap(left.inner, right) || this.matchTypesOverlap(nullType, right);
    if (right.kind === "optional") return this.matchTypesOverlap(left, right.inner) || this.matchTypesOverlap(left, nullType);
    return isAssignable(left, right, this) || isAssignable(right, left, this);
  }

  private defaultSortableType(original: ValueType): boolean {
    const type = this.expandAliases(original);
    if (type.kind === "string" || type.kind === "number" || type.kind === "enum" || type.kind === "any" || type.kind === "unknown") return true;
    return type.kind === "union" && type.members.every((member) => this.defaultSortableType(member));
  }

  private matchTypeFullyCovered(
    target: ValueType,
    coveredTypes: readonly ValueType[],
    coveredValues: ReadonlySet<string>,
    coveredEnumMembers: ReadonlySet<string>,
    coveredListLengths: ReadonlySet<number>,
    coveredListMinimum: number | null,
  ): boolean {
    if (coveredTypes.some((covered) => isAssignable(target, covered, this))) return true;
    if (target.kind === "union") {
      return target.members.every((member) => this.matchTypeFullyCovered(
        member,
        coveredTypes,
        coveredValues,
        coveredEnumMembers,
        coveredListLengths,
        coveredListMinimum,
      ));
    }
    if (target.kind === "optional") {
      return this.matchTypeFullyCovered(target.inner, coveredTypes, coveredValues, coveredEnumMembers, coveredListLengths, coveredListMinimum)
        && this.matchTypeFullyCovered(nullType, coveredTypes, coveredValues, coveredEnumMembers, coveredListLengths, coveredListMinimum);
    }
    if (target.kind === "enum") {
      const members = this.enums.get(target.identity)?.members ?? this.enums.get(target.name)?.members ?? new Set<string>();
      return [...members].every((member) => coveredEnumMembers.has(member));
    }
    if (target.kind === "bool") return coveredValues.has("boolean:true") && coveredValues.has("boolean:false");
    if (target.kind === "null") return coveredValues.has("null");
    if (target.kind === "list" && coveredListMinimum !== null) {
      for (let length = 0; length < coveredListMinimum; length += 1) {
        if (!coveredListLengths.has(length)) return false;
      }
      return true;
    }
    return false;
  }

  private blockAlwaysReturns(statements: readonly Statement[]): boolean {
    for (const statement of statements) {
      if (statement.kind === "ReturnStatement" || statement.kind === "ThrowStatement") return true;
      if (statement.kind === "IfStatement" && statement.elseBody
        && this.blockAlwaysReturns(statement.thenBody) && this.blockAlwaysReturns(statement.elseBody)) return true;
      if (statement.kind === "MatchStatement" && (statement.elseBody || this.exhaustiveMatches.has(statement.span.start))
        && statement.cases.every((branch) => this.blockAlwaysReturns(branch.body))
        && (!statement.elseBody || this.blockAlwaysReturns(statement.elseBody))) return true;
      if (statement.kind === "TryStatement") {
        if (statement.finallyBody && this.blockAlwaysReturns(statement.finallyBody)) return true;
        if (statement.catchBody && this.blockAlwaysReturns(statement.tryBody) && this.blockAlwaysReturns(statement.catchBody)) return true;
      }
    }
    return false;
  }

  private statementAlwaysExitsBlock(statement: Statement): boolean {
    if (statement.kind === "ReturnStatement" || statement.kind === "ThrowStatement"
      || statement.kind === "BreakStatement" || statement.kind === "ContinueStatement") return true;
    if (statement.kind === "IfStatement" && statement.elseBody) {
      return this.blockAlwaysExits(statement.thenBody) && this.blockAlwaysExits(statement.elseBody);
    }
    if (statement.kind === "MatchStatement" && (statement.elseBody || this.exhaustiveMatches.has(statement.span.start))) {
      return statement.cases.every((branch) => this.blockAlwaysExits(branch.body))
        && (!statement.elseBody || this.blockAlwaysExits(statement.elseBody));
    }
    if (statement.kind !== "TryStatement") return false;
    if (statement.finallyBody && this.blockAlwaysExits(statement.finallyBody)) return true;
    return Boolean(statement.catchBody
      && this.blockAlwaysExits(statement.tryBody)
      && this.blockAlwaysExits(statement.catchBody));
  }

  private blockAlwaysExits(statements: readonly Statement[]): boolean {
    return statements.some((statement) => this.statementAlwaysExitsBlock(statement));
  }

  private builtin(name: string): Binding | null {
    const functions = new Map<string, ValueType>([
      ["number", { kind: "function", parameters: [stringType], requiredParameters: 1, result: optionalOf(numberType) }],
      ["str", { kind: "function", parameters: [anyType], requiredParameters: 1, result: stringType }],
      ["print", { kind: "function", parameters: [anyType], requiredParameters: 1, result: nullType }],
    ]);
    const type = this.extensionGlobals.get(name) ?? functions.get(name)
      ?? (name === "Error" ? { kind: "classConstructor", name: "Error" } satisfies ValueType : null)
      ?? (name === "Map" || name === "Set" ? anyType : null);
    return type ? { mutable: false, effectMutable: false, type, declaredType: type, span: { start: 0, end: 0 }, narrowingFrame: null } : null;
  }

  private isFreshUnresolvedCollection(expression: Expression, type: ValueType): boolean {
    const unresolved = type.kind === "list" ? type.element.kind === "unknown"
      : type.kind === "set" ? type.element.kind === "unknown"
        : type.kind === "map" ? type.key.kind === "unknown" && type.value.kind === "unknown"
          : false;
    if (!unresolved) return false;
    if (expression.kind === "ListExpression") return true;
    return expression.kind === "CallExpression"
      && expression.callee.kind === "IdentifierExpression"
      && (expression.callee.name === "Map" || expression.callee.name === "Set");
  }

  private joinCollectionInference(name: string, binding: Binding, group: CollectionInferenceGroup): void {
    group.bindings.set(binding, name);
    this.collectionInferenceGroups.set(binding, group);
  }

  private createCollectionInference(type: ValueType): CollectionInferenceGroup {
    const group = { type, bindings: new Map<Binding, string>(), open: true };
    this.collectionInferenceTypes.set(type, group);
    return group;
  }

  private refineCollectionInference(current: ValueType, next: ValueType): boolean {
    const group = this.collectionInferenceTypes.get(current);
    if (!group?.open) return false;
    if (group.type.kind === "list" && next.kind === "list") {
      (group.type as { kind: "list"; element: ValueType }).element = next.element;
    } else if (group.type.kind === "set" && next.kind === "set") {
      (group.type as { kind: "set"; element: ValueType }).element = next.element;
    } else if (group.type.kind === "map" && next.kind === "map") {
      (group.type as { kind: "map"; key: ValueType; value: ValueType }).key = next.key;
      (group.type as { kind: "map"; key: ValueType; value: ValueType }).value = next.value;
    } else return false;
    for (const [member, name] of group.bindings) {
      this.recordSemanticBinding(`${member.span.start}:${name}`, group.type);
    }
    return true;
  }

  private rebindCollectionInference(name: string, binding: Binding, value: Expression, valueType: ValueType): void {
    const previous = this.collectionInferenceGroups.get(binding);
    if (!previous) return;
    const aliasedBinding = value.kind === "IdentifierExpression" ? this.lookup(value.name) : null;
    const aliasedGroup = aliasedBinding ? this.collectionInferenceGroups.get(aliasedBinding) : null;
    if (previous === aliasedGroup && aliasedGroup) return;
    previous?.bindings.delete(binding);
    this.collectionInferenceGroups.delete(binding);
    if (aliasedGroup) {
      binding.type = aliasedGroup.type;
      binding.declaredType = aliasedGroup.type;
      this.joinCollectionInference(name, binding, aliasedGroup);
    }
    else if (this.isFreshUnresolvedCollection(value, valueType)) {
      binding.type = valueType;
      binding.declaredType = valueType;
      this.joinCollectionInference(name, binding, this.createCollectionInference(valueType));
    } else {
      binding.type = valueType;
      binding.declaredType = valueType;
    }
    this.recordSemanticBinding(`${binding.span.start}:${name}`, binding.type);
  }

  protected declareBinding(
    name: string,
    mutable: boolean,
    type: ValueType,
    declarationSpan: Span,
    internal = false,
    effectMutable = mutable,
  ): void {
    if (!internal && name.toLowerCase().startsWith("__velar")) {
      this.diagnostics.push(diagnostic("VEL3007", `'${name}' uses the reserved compiler prefix '__velar'`, declarationSpan));
      return;
    }
    if (!internal && reservedBindings.has(name)) {
      this.diagnostics.push(diagnostic("VEL3007", `'${name}' is a reserved Core binding`, declarationSpan));
      return;
    }
    if (!internal && this.extensionReservedBindings.has(name)) {
      this.diagnostics.push(diagnostic("VEL3007", `'${name}' is a reserved extension binding`, declarationSpan));
      return;
    }
    const scope = this.scopes.at(-1)!;
    if (!internal && this.scopes.length > 1 && this.reactiveBindings.has(name)) {
      this.diagnostics.push(diagnostic("VEL3004", `Name '${name}' cannot shadow a module reactive binding`, declarationSpan));
      return;
    }
    if (scope.has(name)) {
      this.diagnostics.push(diagnostic("VEL3004", `Name '${name}' is already declared in this scope`, declarationSpan));
      return;
    }
    scope.set(name, { mutable, effectMutable, type, declaredType: type, span: declarationSpan, narrowingFrame: null });
    this.recordSemanticBinding(`${declarationSpan.start}:${name}`, type);
  }

  private recordSemanticBinding(key: string, type: ValueType): void {
    this.semanticBindingTypes.set(key, type);
    this.semanticBindingMembers.set(key, this.semanticMembersOf(type));
  }

  protected semanticMembersOf(original: ValueType): ReadonlyMap<string, ValueType> {
    const privateContext = this.privateSemanticContext(original);
    const key = `${semanticTypeIdentity(original)}:private:${privateContext ?? ""}`;
    const cached = this.semanticMemberCache.get(key);
    if (cached) return cached;
    const members = this.createSemanticMembersOf(original);
    this.semanticMemberCache.set(key, members);
    return members;
  }

  private privateSemanticContext(original: ValueType): string | null {
    if (!this.currentClass) return null;
    const type = nonOptional(this.expandAliases(original));
    if (type.kind === "class") {
      const key = type.identity ?? type.name;
      return this.isSubclassOf(key, this.currentClass) ? this.currentClass : null;
    }
    if (type.kind === "classConstructor") {
      return (type.identity ?? type.name) === this.currentClass ? this.currentClass : null;
    }
    return null;
  }

  private createSemanticMembersOf(original: ValueType): ReadonlyMap<string, ValueType> {
    const type = nonOptional(this.expandAliases(original));
    if (type.kind === "string") return new Map([["length", numberType]]);
    if (type.kind === "list") return new Map(["size", "get", "slice", "append", "extend", "insert", "has", "remove", "pop", "clear", "copy", "count", "index", "sorted", "reversed", "map", "filter", "reduce", "some", "every", "find", "join"]
      .map((name) => [name, this.listMember(type, name)!]));
    if (type.kind === "map") return new Map(["size", "get", "set", "update", "has", "remove", "clear", "copy", "keys", "values", "entries"]
      .map((name) => [name, this.mapMember(type, name)!]));
    if (type.kind === "set") return new Map(["size", "add", "update", "has", "remove", "clear", "copy", "values"]
      .map((name) => [name, this.setMember(type, name)!]));
    if (type.kind === "action") return new Map([
      ["pending", boolType],
      ["error", optionalOf({ kind: "class", name: "Error" })],
    ]);
    if (type.kind === "object") return new Map([...type.fields].map(([name, value]) => [
      name,
      type.optionalFields?.has(name) ? optionalOf(value) : value,
    ]));
    if (type.kind === "componentConstructor") return type.props;
    if (type.kind === "named") return this.fieldsOf(type.identity ?? type.name) ?? new Map();
    if (type.kind === "class") {
      const members = new Map<string, ValueType>();
      let current: string | null = type.identity ?? type.name;
      const visited = new Set<string>();
      while (current && !visited.has(current)) {
        visited.add(current);
        const info = this.classes.get(current);
        for (const [name, field] of info?.fields ?? []) if (!members.has(name)) members.set(name, this.displayExternalClasses(field.type));
        for (const [name, method] of info?.methods ?? []) if (!members.has(name)) members.set(name, this.displayExternalClasses(method));
        current = info?.base ?? null;
      }
      const privateContext = this.privateSemanticContext(type);
      if (privateContext) {
        for (const [name, field] of this.privateFields.get(privateContext) ?? []) members.set(name, this.displayExternalClasses(field.type));
        for (const [name, method] of this.privateMethods.get(privateContext) ?? []) members.set(name, this.displayExternalClasses(method));
      }
      return members;
    }
    if (type.kind === "classConstructor") {
      const members = new Map<string, ValueType>();
      let current: string | null = type.identity ?? type.name;
      const visited = new Set<string>();
      while (current && !visited.has(current)) {
        visited.add(current);
        const info = this.classes.get(current);
        for (const [name, field] of info?.staticFields ?? []) if (!members.has(name)) members.set(name, this.displayExternalClasses(field.type));
        for (const [name, method] of info?.staticMethods ?? []) if (!members.has(name)) members.set(name, this.displayExternalClasses(method));
        current = info?.base ?? null;
      }
      const privateContext = this.privateSemanticContext(type);
      if (privateContext) {
        for (const [name, field] of this.privateStaticFields.get(privateContext) ?? []) members.set(name, this.displayExternalClasses(field.type));
        for (const [name, method] of this.privateStaticMethods.get(privateContext) ?? []) members.set(name, this.displayExternalClasses(method));
      }
      return members;
    }
    if (type.kind === "enumObject") {
      const members = new Map<string, ValueType>();
      for (const name of type.members) members.set(name, { kind: "enum", name: type.name, identity: type.identity });
      members.set("is", { kind: "function", parameters: [unknownType], requiredParameters: 1, result: boolType });
      members.set("parse", { kind: "function", parameters: [unknownType], requiredParameters: 1, result: { kind: "enum", name: type.name, identity: type.identity } });
      return members;
    }
    if (type.kind === "typeObject") return new Map([[
      "parse",
      { kind: "function", parameters: [unknownType], requiredParameters: 1, result: this.typeAliases.get(type.name) ?? { kind: "named", name: type.name } },
    ]]);
    return new Map();
  }

  private displayExternalClasses(type: ValueType): ValueType {
    if ((type.kind === "class" || type.kind === "classConstructor") && type.identity) {
      return { ...type, name: this.classDisplayNames.get(type.identity) ?? type.name };
    }
    if (type.kind === "optional") return optionalOf(this.displayExternalClasses(type.inner));
    if (type.kind === "list") return { ...type, element: this.displayExternalClasses(type.element) };
    if (type.kind === "set") return { kind: "set", element: this.displayExternalClasses(type.element) };
    if (type.kind === "map") return { kind: "map", key: this.displayExternalClasses(type.key), value: this.displayExternalClasses(type.value) };
    if (type.kind === "promise") return { kind: "promise", value: this.displayExternalClasses(type.value) };
    if (type.kind === "object") return { ...type, fields: new Map([...type.fields].map(([name, value]) => [name, this.displayExternalClasses(value)])) };
    if (type.kind === "function" || type.kind === "action" || type.kind === "intrinsic") return {
      ...type,
      parameters: type.parameters.map((parameter) => this.displayExternalClasses(parameter)),
      ...(type.rest ? { rest: this.displayExternalClasses(type.rest) } : {}),
      result: this.displayExternalClasses(type.result),
    };
    if (type.kind === "union") return { kind: "union", members: type.members.map((member) => this.displayExternalClasses(member)) };
    return type;
  }

  private declarePattern(pattern: BindingPattern, mutable: boolean, type: ValueType): void {
    if (pattern.kind === "NameBindingPattern") {
      this.declareBinding(pattern.name, mutable, type, pattern.span);
      return;
    }
    if (pattern.kind === "ListBindingPattern") {
      const element = type.kind === "list" ? type.element : type.kind === "any" ? anyType : unknownType;
      if (type.kind !== "list" && type.kind !== "any") {
        this.typeError(`Cannot list-destructure ${describeType(type)}`, pattern.span);
      }
      for (const child of pattern.elements) if (child) this.declarePattern(child, mutable, element);
      if (pattern.rest) this.declareBinding(pattern.rest.name, mutable, { kind: "list", element }, pattern.rest.span);
      return;
    }

    const fields = type.kind === "object" ? type.fields : type.kind === "named" ? this.fieldsOf(type.identity ?? type.name) : null;
    if (!fields && type.kind !== "any") {
      this.typeError(`Cannot object-destructure ${describeType(type)}`, pattern.span);
    }
    const selected = new Set<string>();
    for (const entry of pattern.entries) {
      if (selected.has(entry.property)) {
        this.diagnostics.push(diagnostic("VEL4019", `Object binding field '${entry.property}' is declared more than once`, entry.span));
      }
      selected.add(entry.property);
      if (type.kind === "named" && fields?.has(entry.property)) {
        this.semanticBindingEntryOwners.set(`${entry.span.start}:${entry.property}`, type);
      }
      const fieldValue = fields?.get(entry.property) ?? (type.kind === "any" ? anyType : unknownType);
      const externalFieldValue = (type.kind === "object" || type.kind === "named") && type.external
        ? this.markExternalAggregate(fieldValue)
        : fieldValue;
      const structurallyOptional = type.kind === "object" && type.optionalFields?.has(entry.property);
      const field = structurallyOptional ? optionalOf(externalFieldValue) : externalFieldValue;
      if (structurallyOptional || this.expandAliases(externalFieldValue).kind === "optional") {
        this.optionalBindingEntries.add(entry.span.start);
      }
      if (fields && !fields.has(entry.property)) this.typeError(`Object has no field '${entry.property}'`, entry.span);
      this.declarePattern(entry.pattern, mutable, field);
    }
    if (pattern.rest) {
      const remaining = new Map<string, ValueType>();
      for (const [name, field] of fields ?? []) if (!selected.has(name)) remaining.set(name, field);
      const remainingOptional = type.kind === "object"
        ? new Set([...type.optionalFields ?? []].filter((name) => !selected.has(name)))
        : new Set<string>();
      this.declareBinding(pattern.rest.name, mutable, type.kind === "any" ? anyType : {
        kind: "object",
        fields: remaining,
        ...(remainingOptional.size > 0 ? { optionalFields: remainingOptional } : {}),
      }, pattern.rest.span);
    }
  }

  private validateKnownBindingShape(pattern: BindingPattern, value: Expression): void {
    if (pattern.kind === "NameBindingPattern") return;
    if (pattern.kind === "ListBindingPattern") {
      if (value.kind !== "ListExpression" || value.elements.some((element) => element.kind === "SpreadExpression")) return;
      const valid = pattern.rest ? value.elements.length >= pattern.elements.length : value.elements.length === pattern.elements.length;
      if (!valid) {
        const expected = `${pattern.rest ? "at least " : "exactly "}${pattern.elements.length} ${pattern.elements.length === 1 ? "item" : "items"}`;
        this.diagnostics.push(diagnostic(
          "VEL4020",
          `List binding requires ${expected}, but this literal contains ${value.elements.length}`,
          pattern.span,
        ));
        return;
      }
      pattern.elements.forEach((element, index) => {
        if (element) this.validateKnownBindingShape(element, value.elements[index]!);
      });
      return;
    }
    if (value.kind !== "ObjectExpression") return;
    for (const entry of pattern.entries) {
      const property = [...value.properties].reverse().find((candidate) => candidate.kind === "ObjectProperty" && candidate.name === entry.property);
      if (property?.kind === "ObjectProperty") this.validateKnownBindingShape(entry.pattern, property.value);
    }
  }

  protected lookup(name: string): Binding | null {
    for (let index = this.scopes.length - 1; index >= 0; index -= 1) {
      const binding = this.scopes[index]?.get(name);
      if (binding) {
        return binding.narrowingFrame !== null && binding.narrowingFrame < this.flowFrameDepth
          ? { ...binding, type: binding.declaredType, narrowingFrame: null }
          : binding;
      }
    }
    return null;
  }

  protected applyNarrowings(narrowed: ReadonlyMap<string, ValueType>, narrowingSpan: Span): void {
    const memberScope = this.memberNarrowings.at(-1)!;
    for (const [key, type] of narrowed) {
      if (key.startsWith(memberNarrowingPrefix)) {
        memberScope.set(key.slice(memberNarrowingPrefix.length), { type, frame: this.flowFrameDepth });
      } else {
        const binding = this.lookup(key);
        this.scopes.at(-1)!.set(key, {
          mutable: binding?.mutable ?? false,
          effectMutable: binding?.effectMutable ?? false,
          type,
          declaredType: binding?.declaredType ?? type,
          span: binding?.span ?? narrowingSpan,
          narrowingFrame: this.flowFrameDepth,
        });
      }
    }
  }

  private persistNarrowings(narrowed: ReadonlyMap<string, ValueType>): void {
    const scope = this.scopes.at(-1)!;
    const memberScope = this.memberNarrowings.at(-1)!;
    for (const [key, type] of narrowed) {
      if (key.startsWith(memberNarrowingPrefix)) {
        memberScope.set(key.slice(memberNarrowingPrefix.length), { type, frame: this.flowFrameDepth });
        continue;
      }
      const binding = this.lookup(key);
      if (!binding) continue;
      const local = scope.get(key);
      if (local) {
        local.type = type;
        local.narrowingFrame = this.flowFrameDepth;
      } else {
        scope.set(key, {
          mutable: binding.mutable,
          effectMutable: binding.effectMutable,
          type,
          declaredType: binding.declaredType,
          span: binding.span,
          narrowingFrame: this.flowFrameDepth,
        });
      }
    }
  }

  private stableMemberAccessPath(expression: Expression): string | null {
    if (expression.kind === "IdentifierExpression") {
      const binding = this.lookup(expression.name);
      return binding ? `${binding.span.start}:${expression.name}` : null;
    }
    if (expression.kind !== "MemberExpression" || expression.optional) return null;
    const base = this.stableMemberAccessPath(expression.object);
    if (!base || !this.stableDataMember(expression.object, expression.property)) return null;
    return `${base}.${expression.property}`;
  }

  private stableOptionalMemberAccessPath(expression: Expression): string | null {
    if (expression.kind === "IdentifierExpression") {
      const binding = this.lookup(expression.name);
      return binding ? `${binding.span.start}:${expression.name}` : null;
    }
    if (expression.kind !== "MemberExpression") return null;
    const base = this.stableOptionalMemberAccessPath(expression.object);
    if (!base || !this.stableDataMember(expression.object, expression.property)) return null;
    return `${base}.${expression.property}`;
  }

  private stableDataMember(objectExpression: Expression, property: string): boolean {
    const inferred = this.inferredExpressionTypes.get(spanIdentity(objectExpression.span))
      ?? (objectExpression.kind === "IdentifierExpression" ? this.lookup(objectExpression.name)?.type : null);
    if (!inferred) return false;
    const owner = nonOptional(this.expandAliases(inferred));
    if (owner.kind === "object") return owner.external !== true && owner.fields.has(property);
    if (owner.kind === "named") return owner.external !== true
      && (this.fieldsOf(owner.identity ?? owner.name)?.has(property) ?? false);
    if (owner.kind === "class") {
      if (owner.external) return false;
      const key = owner.identity ?? owner.name;
      if (key.startsWith("js:")) return false;
      if (this.findGetter(key, property)) return false;
      if (this.privateGetters.get(this.currentClass ?? "")?.has(property)) return false;
      return Boolean(this.findField(key, property) || this.privateFieldForAccess(key, property, false));
    }
    if (owner.kind !== "classConstructor") return false;
    const key = owner.identity ?? owner.name;
    if (key.startsWith("js:")) return false;
    if (this.findStaticGetter(key, property)) return false;
    if (this.privateStaticGetters.get(this.currentClass ?? "")?.has(property)) return false;
    return Boolean(this.findStaticField(key, property) || this.privateFieldForAccess(key, property, true));
  }

  private lookupMemberNarrowing(path: string): ValueType | null {
    for (let index = this.memberNarrowings.length - 1; index >= 0; index -= 1) {
      const narrowing = this.memberNarrowings[index]?.get(path);
      if (narrowing && narrowing.frame === this.flowFrameDepth) return narrowing.type;
    }
    return null;
  }

  private invalidateAssignmentNarrowings(target: AssignmentStatement["target"], binding: Binding | null): void {
    if (target.kind === "IdentifierExpression") {
      if (binding && binding.narrowingFrame !== null) {
        binding.type = binding.declaredType;
        binding.narrowingFrame = null;
      }
      if (binding) this.invalidateMemberNarrowings(`${binding.span.start}:${target.name}`);
      return;
    }
    if (target.kind !== "MemberExpression") return;
    const path = this.stableMemberAccessPath(target);
    if (path) this.invalidateMemberNarrowings(path);
  }

  private invalidateMemberNarrowings(path: string): void {
    for (const scope of this.memberNarrowings) {
      for (const [candidate, narrowing] of scope) {
        if (narrowing.frame === this.flowFrameDepth
          && (candidate === path || candidate.startsWith(`${path}.`))) scope.delete(candidate);
      }
    }
  }

  protected invalidateEffectfulFlowFacts(): void {
    for (const scope of this.scopes) {
      for (const binding of scope.values()) {
        if (binding.effectMutable && binding.narrowingFrame === this.flowFrameDepth) {
          binding.type = binding.declaredType;
          binding.narrowingFrame = null;
        }
      }
    }
    this.invalidateCurrentMemberNarrowings();
  }

  private invalidateCurrentMemberNarrowings(): void {
    for (const scope of this.memberNarrowings) {
      for (const [path, narrowing] of scope) {
        if (narrowing.frame === this.flowFrameDepth) scope.delete(path);
      }
    }
  }

  private stringCoercionMayExecute(input: ValueType): boolean {
    const type = this.expandAliases(input);
    if (type.kind === "string" || type.kind === "number" || type.kind === "bool"
      || type.kind === "null" || type.kind === "enum") return false;
    if (type.kind === "optional") return this.stringCoercionMayExecute(type.inner);
    if (type.kind === "union") return type.members.some((member) => this.stringCoercionMayExecute(member));
    return true;
  }

  private runtimeValidationMayRetainHostOrigin(input: ValueType): boolean {
    const type = this.expandAliases(input);
    if (type.kind === "unknown" || type.kind === "any") return true;
    if (type.kind === "object" || type.kind === "named" || type.kind === "class" || type.kind === "list") {
      return type.external === true;
    }
    if (type.kind === "optional") return this.runtimeValidationMayRetainHostOrigin(type.inner);
    if (type.kind === "union") return type.members.some((member) => this.runtimeValidationMayRetainHostOrigin(member));
    return false;
  }

  private runtimeCheckedType(input: ValueType, checked: ValueType): ValueType {
    return this.runtimeValidationMayRetainHostOrigin(input) ? this.markExternalAggregate(checked) : checked;
  }

  private recordReflectionMayExecute(input: ValueType): boolean {
    const type = this.expandAliases(input);
    if (type.kind === "any") return true;
    if (type.kind === "object" || type.kind === "named") return type.external === true;
    if (type.kind === "optional") return this.recordReflectionMayExecute(type.inner);
    if (type.kind === "union") return type.members.some((member) => this.recordReflectionMayExecute(member));
    return false;
  }

  private listReflectionMayExecute(input: ValueType): boolean {
    const type = this.expandAliases(input);
    if (type.kind === "any") return true;
    if (type.kind === "list") return type.external === true;
    if (type.kind === "optional") return this.listReflectionMayExecute(type.inner);
    if (type.kind === "union") return type.members.some((member) => this.listReflectionMayExecute(member));
    return false;
  }

  private bindingPatternReflectionMayExecute(pattern: BindingPattern, input: ValueType): boolean {
    if (pattern.kind === "NameBindingPattern") return false;
    const type = this.expandAliases(input);
    if (type.kind === "union") {
      return type.members.some((member) => this.bindingPatternReflectionMayExecute(pattern, member));
    }
    if (type.kind === "optional") return this.bindingPatternReflectionMayExecute(pattern, type.inner);
    if (pattern.kind === "ListBindingPattern") {
      if (this.listReflectionMayExecute(type)) return true;
      const element = type.kind === "list" ? type.element : type.kind === "any" ? anyType : unknownType;
      return pattern.elements.some((child) => child !== null && this.bindingPatternReflectionMayExecute(child, element));
    }
    if (this.recordReflectionMayExecute(type)) return true;
    const fields = type.kind === "object" ? type.fields
      : type.kind === "named" ? this.fieldsOf(type.identity ?? type.name)
        : null;
    return pattern.entries.some((entry) => this.bindingPatternReflectionMayExecute(
      entry.pattern,
      fields?.get(entry.property) ?? (type.kind === "any" ? anyType : unknownType),
    ));
  }

  private matchPatternReflectionMayExecute(pattern: MatchPattern, input: ValueType): boolean {
    if (pattern.kind === "MatchAsPattern") return this.matchPatternReflectionMayExecute(pattern.pattern, input);
    const type = this.expandAliases(input);
    if (type.kind === "union") {
      return type.members.some((member) => this.matchPatternReflectionMayExecute(pattern, member));
    }
    if (type.kind === "optional") return this.matchPatternReflectionMayExecute(pattern, type.inner);
    if (pattern.kind === "MatchListPattern") {
      if (this.listReflectionMayExecute(type)) return true;
      const element = type.kind === "list" ? type.element : type.kind === "any" ? anyType : unknownType;
      return pattern.elements.some((child) => this.matchPatternReflectionMayExecute(child, element));
    }
    if (pattern.kind !== "MatchObjectPattern") return false;
    if (this.recordReflectionMayExecute(type)) return true;
    const fields = type.kind === "object" ? type.fields
      : type.kind === "named" ? this.fieldsOf(type.identity ?? type.name)
        : null;
    return pattern.entries.some((entry) => this.matchPatternReflectionMayExecute(
      entry.pattern,
      fields?.get(entry.property) ?? (type.kind === "any" ? anyType : unknownType),
    ));
  }

  private snapshotFlowFacts(): FlowFactsSnapshot {
    const bindings = new Map<Binding, { readonly type: ValueType; readonly frame: number | null }>();
    for (const scope of this.scopes) {
      for (const binding of scope.values()) {
        bindings.set(binding, { type: binding.type, frame: binding.narrowingFrame });
      }
    }
    return {
      bindings,
      members: this.memberNarrowings.map((scope) => new Map(scope)),
    };
  }

  private restoreFlowFacts(snapshot: FlowFactsSnapshot): void {
    for (const [binding, state] of snapshot.bindings) {
      binding.type = state.type;
      binding.narrowingFrame = state.frame;
    }
    snapshot.members.forEach((source, index) => {
      const target = this.memberNarrowings[index];
      if (!target) return;
      target.clear();
      for (const [path, narrowing] of source) target.set(path, narrowing);
    });
  }

  private analyzeIsolatedFlow(snapshot: FlowFactsSnapshot, analyze: () => void): FlowFactInvalidations {
    this.restoreFlowFacts(snapshot);
    analyze();
    const bindings = new Set<Binding>();
    for (const [binding, state] of snapshot.bindings) {
      if (state.frame !== null
        && (binding.narrowingFrame !== state.frame || !sameType(binding.type, state.type))) bindings.add(binding);
    }
    const members = new Map<number, ReadonlySet<string>>();
    snapshot.members.forEach((source, index) => {
      const current = this.memberNarrowings[index];
      const invalidated = new Set<string>();
      for (const [path, narrowing] of source) {
        const after = current?.get(path);
        if (!after || after.frame !== narrowing.frame || !sameType(after.type, narrowing.type)) invalidated.add(path);
      }
      if (invalidated.size > 0) members.set(index, invalidated);
    });
    this.restoreFlowFacts(snapshot);
    return { bindings, members };
  }

  private flowSnapshotAfterInvalidations(
    baseline: FlowFactsSnapshot,
    invalidations: readonly FlowFactInvalidations[],
  ): FlowFactsSnapshot {
    this.restoreFlowFacts(baseline);
    this.applyFlowInvalidations(invalidations);
    const result = this.snapshotFlowFacts();
    this.restoreFlowFacts(baseline);
    return result;
  }

  private visibleBindings(): ReadonlyMap<string, Binding> {
    const visible = new Map<string, Binding>();
    for (let index = this.scopes.length - 1; index >= 0; index -= 1) {
      for (const [name, binding] of this.scopes[index]!) {
        if (!visible.has(name)) visible.set(name, binding);
      }
    }
    return visible;
  }

  private narrowingsForVisibleBindings(visible: ReadonlyMap<string, Binding>): ReadonlyMap<string, ValueType> {
    const narrowed = new Map<string, ValueType>();
    const roots = new Set<string>();
    for (const [name, original] of visible) {
      roots.add(`${original.span.start}:${name}`);
      const current = this.lookup(name);
      if (current?.narrowingFrame === this.flowFrameDepth
        && current.span.start === original.span.start
        && current.span.end === original.span.end) narrowed.set(name, current.type);
    }
    for (let index = this.memberNarrowings.length - 1; index >= 0; index -= 1) {
      for (const [path, fact] of this.memberNarrowings[index]!) {
        if (fact.frame !== this.flowFrameDepth || narrowed.has(`${memberNarrowingPrefix}${path}`)) continue;
        if ([...roots].some((root) => path === root || path.startsWith(`${root}.`))) {
          narrowed.set(`${memberNarrowingPrefix}${path}`, fact.type);
        }
      }
    }
    return narrowed;
  }

  private narrowingsInSnapshot(
    snapshot: FlowFactsSnapshot,
    visible: ReadonlyMap<string, Binding>,
    restore: FlowFactsSnapshot,
  ): ReadonlyMap<string, ValueType> {
    this.restoreFlowFacts(snapshot);
    const narrowed = this.narrowingsForVisibleBindings(visible);
    this.restoreFlowFacts(restore);
    return narrowed;
  }

  private commonNarrowings(branches: readonly ReadonlyMap<string, ValueType>[]): ReadonlyMap<string, ValueType> {
    const first = branches[0];
    if (!first) return new Map();
    const common = new Map<string, ValueType>();
    for (const [key, type] of first) {
      if (branches.slice(1).every((branch) => {
        const candidate = branch.get(key);
        return candidate !== undefined && sameType(candidate, type);
      })) common.set(key, type);
    }
    return common;
  }

  private applyFlowInvalidations(branches: readonly FlowFactInvalidations[]): void {
    for (const branch of branches) {
      for (const binding of branch.bindings) {
        binding.type = binding.declaredType;
        binding.narrowingFrame = null;
      }
      for (const [index, paths] of branch.members) {
        const scope = this.memberNarrowings[index];
        if (!scope) continue;
        for (const path of paths) scope.delete(path);
      }
    }
  }

  protected enterScope(): void {
    this.scopes.push(new Map());
    this.memberNarrowings.push(new Map());
  }

  protected exitScope(): void {
    this.scopes.pop();
    this.memberNarrowings.pop();
  }
}
