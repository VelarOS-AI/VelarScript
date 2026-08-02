import type {
  ActionDeclaration,
  ArrowFunctionExpression,
  AssignmentStatement,
  BindingPattern,
  ClassDeclaration,
  ComponentDeclaration,
  ComponentItem,
  Expression,
  ExternClassDeclaration,
  ExternFunctionDeclaration,
  ExternConstantDeclaration,
  FunctionDeclaration,
  Program,
  Statement,
  TypeDeclaration,
  TypeAliasDeclaration,
  TypeReference,
} from "./ast.ts";
import { diagnostic, type Diagnostic } from "./diagnostic.ts";
import type { Span } from "./source.ts";
import {
  anyType,
  boolType,
  describeType,
  isAssignable,
  mergeTypes,
  noneType,
  nonOptional,
  numberType,
  optionalOf,
  parseType,
  resolvedAsyncType,
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
  type: ValueType;
  readonly declaredType: ValueType;
  readonly span: Span;
  narrowingFrame: number | null;
}

interface MemberNarrowing {
  readonly type: ValueType;
  readonly frame: number;
}

function jsxMapExpression(expression: Expression): (Extract<Expression, { kind: "ArrowFunctionExpression" }> & { readonly body: Extract<Expression, { kind: "JSXElementExpression" }> }) | null {
  if (expression.kind !== "CallExpression" || expression.callee.kind !== "MemberExpression" || expression.callee.property !== "map") return null;
  const callback = expression.arguments[0];
  return callback?.kind === "ArrowFunctionExpression" && !callback.asynchronous && callback.body.kind === "JSXElementExpression"
    ? callback as typeof callback & { readonly body: Extract<Expression, { kind: "JSXElementExpression" }> }
    : null;
}

function containsPromise(type: ValueType): boolean {
  if (type.kind === "promise") return true;
  if (type.kind === "optional") return containsPromise(type.inner);
  if (type.kind === "list" || type.kind === "set") return containsPromise(type.element);
  if (type.kind === "map") return containsPromise(type.key) || containsPromise(type.value);
  if (type.kind === "union") return type.members.some(containsPromise);
  return false;
}

function continuesOptionalChain(expression: Expression): boolean {
  if (expression.kind === "MemberExpression") {
    return expression.optional || continuesOptionalChain(expression.object);
  }
  if (expression.kind === "IndexExpression") {
    return continuesOptionalChain(expression.object);
  }
  if (expression.kind === "CallExpression") {
    return continuesOptionalChain(expression.callee);
  }
  return false;
}

function hasAccessibleJsxContent(expression: Extract<Expression, { kind: "JSXElementExpression" }>): boolean {
  return expression.children.some((child) => {
    if (child.kind === "JSXText") return child.value.trim().length > 0;
    if (child.kind === "JSXExpressionChild") return true;
    return hasAccessibleJsxContent(child) || child.tag.length > 0;
  });
}

function hasAccessibleSvgName(expression: Extract<Expression, { kind: "JSXElementExpression" }>): boolean {
  const named = expression.attributes.some((attribute) => {
    if (attribute.name !== "aria-label" && attribute.name !== "aria-labelledby") return false;
    if (attribute.value === null) return false;
    return typeof attribute.value !== "string" || attribute.value.trim().length > 0;
  });
  if (named) return true;
  const hidden = expression.attributes.find((attribute) => attribute.name === "aria-hidden");
  if (hidden?.value === "true" || (hidden?.value && typeof hidden.value !== "string"
    && hidden.value.kind === "LiteralExpression" && hidden.value.value === true)) return true;
  return expression.children.some((child) => child.kind === "JSXElementExpression"
    && child.tag === "title" && hasAccessibleJsxContent(child));
}

export interface ClassField {
  readonly mutable: boolean;
  readonly type: ValueType;
}

export interface ClassInfo {
  readonly identity?: string;
  readonly parameters: readonly ValueType[];
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

export type CollectionOperation = "get" | "slice" | "append" | "extend" | "add" | "set" | "remove" | "clear" | "keys" | "values" | "entries";

export interface FormReadField {
  readonly name: string;
  readonly kind: "string" | "number" | "bool" | "enum" | "strings";
  readonly optional: boolean;
  readonly enumValues?: readonly string[];
}

export interface LoweringHints {
  readonly collectionCalls: ReadonlyMap<number, CollectionOperation>;
  readonly mapLoops: ReadonlySet<number>;
  readonly constructorCalls: ReadonlySet<string>;
  readonly classChecks: ReadonlySet<number>;
  readonly privateMembers: ReadonlySet<number>;
  readonly classNames: ReadonlySet<string>;
  readonly enumNames: ReadonlySet<string>;
  readonly optionalMembers: ReadonlySet<number>;
  readonly optionalCalls: ReadonlySet<number>;
  readonly optionalChainMembers: ReadonlySet<number>;
  readonly optionalIndexes: ReadonlySet<number>;
  readonly optionalCallees: ReadonlySet<number>;
  readonly presenceConditions: ReadonlySet<number>;
  readonly optionalNegations: ReadonlySet<number>;
  readonly reactiveBindings: ReadonlyMap<string, "state" | "computed">;
  readonly enumValueBindings: ReadonlyMap<number, string>;
  readonly exhaustiveMatches: ReadonlySet<number>;
  readonly membershipChecks: ReadonlyMap<number, "includes" | "has">;
  readonly formReads: ReadonlyMap<number, readonly FormReadField[]>;
}

export interface AnalysisContext {
  readonly imports?: ReadonlyMap<string, ValueType>;
  readonly dynamicImports?: ReadonlyMap<string, ValueType>;
  readonly reactiveImports?: ReadonlyMap<string, "state" | "computed">;
  readonly namedTypes?: ReadonlyMap<string, ReadonlyMap<string, ValueType>>;
  readonly typeAliases?: ReadonlyMap<string, ValueType>;
  readonly enums?: ReadonlyMap<string, EnumInfo>;
  readonly classes?: ReadonlyMap<string, ClassInfo>;
}

const primitiveNames = new Set(["string", "number", "bool", "none", "unknown", "WebNode", "Element", "InputElement", "CanvasElement", "DialogElement", "Event", "KeyboardEvent", "PointerEvent", "InputEvent"]);
const reservedBindings = new Set(["Map", "Set", "Error", "number", "print", "self", "str"]);
const jsxControlAttributes = new Set(["if", "else-if", "else"]);
const memberNarrowingPrefix = "\u0000member:";
const wrappedGlobalGuidance = new Map([
  ["console", "Use print(value) or an explicit JavaScript boundary instead of the console global"],
  ["document", "Use JSX, refs, and velar/browser instead of the untyped document global"],
  ["window", "Use velar/browser or an explicit JavaScript boundary instead of the untyped window global"],
  ["navigator", "Use velar/browser instead of the navigator global"],
  ["location", "Use velar/browser location() or velar/web navigation instead of the location global"],
  ["history", "Use velar/web navigation instead of the history global"],
  ["fetch", "Use velar/http instead of the raw fetch global"],
  ["JSON", "Use velar/json instead of the JSON global"],
  ["Math", "Use velar/math instead of the Math global"],
  ["Date", "Use velar/time instead of the Date global"],
  ["Boolean", "Use an explicit boolean comparison; Velar does not expose JavaScript truthiness conversion"],
  ["Number", "Use number(text), typed forms, or validated data instead of JavaScript Number coercion"],
  ["String", "Use str(value) instead of the JavaScript String global"],
]);

export class Analyzer implements TypeEnvironment {
  private readonly diagnostics: Diagnostic[] = [];
  private readonly scopes: Map<string, Binding>[] = [new Map()];
  private readonly memberNarrowings: Map<string, MemberNarrowing>[] = [new Map()];
  private readonly namedTypes = new Map<string, ReadonlyMap<string, ValueType>>();
  private readonly typeAliases = new Map<string, ValueType>();
  private readonly enums = new Map<string, EnumInfo>();
  private readonly classes = new Map<string, ClassInfo>();
  private readonly classDisplayNames = new Map<string, string>();
  private readonly externModules = new Map<string, ReadonlyMap<string, ValueType>>();
  private readonly returnTypes: ValueType[] = [];
  private readonly asynchronousFunctions: boolean[] = [];
  private readonly collectionCalls = new Map<number, CollectionOperation>();
  private readonly mapLoops = new Set<number>();
  private readonly constructorCalls = new Set<string>();
  private readonly classChecks = new Set<number>();
  private readonly privateMembers = new Set<number>();
  private readonly optionalMembers = new Set<number>();
  private readonly optionalCalls = new Set<number>();
  private readonly optionalChainMembers = new Set<number>();
  private readonly optionalIndexes = new Set<number>();
  private readonly optionalCallees = new Set<number>();
  private readonly presenceConditions = new Set<number>();
  private readonly optionalNegations = new Set<number>();
  private readonly reactiveBindings = new Map<string, "state" | "computed">();
  private readonly enumValueBindings = new Map<number, string>();
  private readonly exhaustiveMatches = new Set<number>();
  private readonly membershipChecks = new Map<number, "includes" | "has">();
  private readonly formReads = new Map<number, readonly FormReadField[]>();
  private readonly semanticBindingTypes = new Map<string, ValueType>();
  private readonly semanticBindingMembers = new Map<string, ReadonlyMap<string, ValueType>>();
  private readonly semanticMemberCache = new Map<string, ReadonlyMap<string, ValueType>>();
  private readonly semanticExpressionTypes = new Map<string, ValueType>();
  private readonly semanticExpressionMembers = new Map<string, ReadonlyMap<string, ValueType>>();
  private readonly semanticExpressionOwners = new Map<string, ValueType>();
  private readonly semanticObjectPropertyOwners = new Map<string, ValueType>();
  private readonly semanticBindingEntryOwners = new Map<string, ValueType>();
  private readonly semanticJsxAttributeOwners = new Map<string, ValueType>();
  private readonly semanticExpressionContexts = new Map<string, ValueType>();
  private readonly semanticExpressionContextMembers = new Map<string, ReadonlyMap<string, ValueType>>();
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
  private currentClass: string | null = null;
  private componentStates: Set<string> | null = null;
  private mountedDepth = 0;
  private classFieldInitializerDepth = 0;
  private classInitDepth = 0;
  private flowFrameDepth = 0;

  constructor(context: AnalysisContext = {}) {
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
    this.dynamicImports = new Map(context.dynamicImports);
    for (const [name, kind] of context.reactiveImports ?? []) this.reactiveBindings.set(name, kind);
    for (const [name, fields] of context.namedTypes ?? []) this.namedTypes.set(name, fields);
    for (const [name, type] of context.typeAliases ?? []) this.typeAliases.set(name, type);
    for (const [name, members] of context.enums ?? []) this.enums.set(name, members);
    for (const [name, info] of context.classes ?? []) this.classes.set(name, info);
  }

  private readonly importBindings: ReadonlyMap<string, ValueType>;
  private readonly dynamicImports: ReadonlyMap<string, ValueType>;

  analyze(program: Program): readonly Diagnostic[] {
    this.registerEnumShapes(program);
    this.registerAliasShapes(program);
    this.registerTypeShapes(program);
    this.rejectUnproductiveRecursiveTypes(program);
    this.registerClassShapes(program);
    this.registerExternModules(program);
    this.predeclareTopLevel(program);
    for (const statement of program.body) {
      this.analyzeStatement(statement);
    }
    return this.diagnostics;
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
          this.declareBinding(specifier.local, false, this.importType(statement, specifier.local, specifier.imported, specifier.namespace), specifier.span);
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
      } else if (statement.kind === "ComponentDeclaration") {
        this.declareBinding(statement.name, false, this.componentType(statement), statement.span);
        this.predeclared.add(statement);
      }
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
            type: this.resolveExternAnnotation(parameter.type, statement.source, classNames),
          });
        }
        for (const field of declaration.fields) {
          (field.static ? staticFields : fields).set(field.name, {
            mutable: field.mutable,
            type: this.resolveExternAnnotation(field.type, statement.source, classNames),
          });
        }
        const methods = new Map<string, ValueType>();
        const staticMethods = new Map<string, ValueType>();
        for (const method of declaration.methods) {
          (method.static ? staticMethods : methods).set(method.name, this.externFunctionType(
            method,
            (reference) => this.resolveExternAnnotation(reference, statement.source, classNames),
          ));
        }
        const rest = declaration.parameters.find((parameter) => parameter.rest);
        this.classes.set(identity, {
          identity,
          parameters: declaration.parameters.filter((parameter) => !parameter.rest).map((parameter) => this.resolveExternAnnotation(parameter.type, statement.source, classNames)),
          requiredParameters: declaration.parameters.filter((parameter) => !parameter.rest && !parameter.defaultValue).length,
          ...(rest ? { constructorRest: this.resolveExternAnnotation(rest.type, statement.source, classNames) } : {}),
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
          ? this.externFunctionType(declaration, (reference) => this.resolveExternAnnotation(reference, statement.source, classNames))
          : this.resolveExternAnnotation(declaration.type, statement.source, classNames));
      }
      this.externModules.set(statement.source, exports);
    }
  }

  loweringHints(): LoweringHints {
    return {
      collectionCalls: this.collectionCalls,
      mapLoops: this.mapLoops,
      constructorCalls: this.constructorCalls,
      classChecks: this.classChecks,
      privateMembers: this.privateMembers,
      classNames: new Set([...this.classes.keys(), ...this.classDisplayNames.values()]),
      enumNames: new Set(this.enums.keys()),
      optionalMembers: this.optionalMembers,
      optionalCalls: this.optionalCalls,
      optionalChainMembers: this.optionalChainMembers,
      optionalIndexes: this.optionalIndexes,
      optionalCallees: this.optionalCallees,
      presenceConditions: this.presenceConditions,
      optionalNegations: this.optionalNegations,
      reactiveBindings: this.reactiveBindings,
      enumValueBindings: this.enumValueBindings,
      exhaustiveMatches: this.exhaustiveMatches,
      membershipChecks: this.membershipChecks,
      formReads: this.formReads,
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

  fieldsOf(name: string): ReadonlyMap<string, ValueType> | null {
    return this.namedTypes.get(name) ?? webTypeFields(name);
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
        const resolved = expand(parseType(declaration.target.text));
        resolving.delete(type.name);
        this.typeAliases.set(type.name, resolved);
        return resolved;
      }
      if (type.kind === "optional") return optionalOf(expand(type.inner));
      if (type.kind === "list") return { kind: "list", element: expand(type.element) };
      if (type.kind === "set") return { kind: "set", element: expand(type.element) };
      if (type.kind === "map") return { kind: "map", key: expand(type.key), value: expand(type.value) };
      if (type.kind === "promise") return { kind: "promise", value: expand(type.value) };
      if (type.kind === "object") return { kind: "object", fields: new Map([...type.fields].map(([name, value]) => [name, expand(value)])) };
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

  private expandAliases(type: ValueType, seen: ReadonlySet<string> = new Set()): ValueType {
    if (type.kind === "named" && this.typeAliases.has(type.name)) {
      if (seen.has(type.name)) return unknownType;
      return this.expandAliases(this.typeAliases.get(type.name)!, new Set([...seen, type.name]));
    }
    if (type.kind === "optional") return optionalOf(this.expandAliases(type.inner, seen));
    if (type.kind === "list") return { kind: "list", element: this.expandAliases(type.element, seen) };
    if (type.kind === "set") return { kind: "set", element: this.expandAliases(type.element, seen) };
    if (type.kind === "map") return { kind: "map", key: this.expandAliases(type.key, seen), value: this.expandAliases(type.value, seen) };
    if (type.kind === "promise") return { kind: "promise", value: this.expandAliases(type.value, seen) };
    if (type.kind === "object") return { kind: "object", fields: new Map([...type.fields].map(([name, value]) => [name, this.expandAliases(value, seen)])) };
    if (type.kind === "function" || type.kind === "action" || type.kind === "intrinsic") return {
      ...type,
      parameters: type.parameters.map((parameter) => this.expandAliases(parameter, seen)),
      ...(type.rest ? { rest: this.expandAliases(type.rest, seen) } : {}),
      result: this.expandAliases(type.result, seen),
    };
    if (type.kind === "union") return { kind: "union", members: type.members.map((member) => this.expandAliases(member, seen)) };
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

  private registerClassShapes(program: Program): void {
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
            type: this.resolveAnnotation(parameter.type),
          });
        }
      }
      for (const field of statement.fields) {
        const target = field.private
          ? field.static ? privateStaticFields : privateFields
          : field.static ? staticFields : fields;
        target.set(field.name, {
          mutable: field.binding === "let",
          type: this.resolveAnnotation(field.type),
        });
      }
      for (const getter of statement.getters) {
        const target = getter.private
          ? getter.static ? privateStaticFields : privateFields
          : getter.static ? staticFields : fields;
        target.set(getter.name, { mutable: false, type: this.resolveResult(getter.returnType) });
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
        parameters: statement.parameters.map((parameter) => this.resolveAnnotation(parameter.type)),
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

  private analyzeStatement(statement: Statement): void {
    switch (statement.kind) {
      case "ImportDeclaration":
        if (!this.predeclared.has(statement)) {
          for (const specifier of statement.specifiers) {
            this.declareBinding(specifier.local, false, this.importType(statement, specifier.local, specifier.imported, specifier.namespace), specifier.span);
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
              const type = this.resolveExternAnnotation(parameter.type, statement.source, classNames);
              this.validateType(type, parameter.span);
              if (parameter.defaultValue) this.requireAssignable(this.inferParameterDefault(parameter.defaultValue, type), type, parameter.defaultValue.span);
              if (parameter.binding) members.add(`instance:${parameter.name}`);
            }
            for (const field of declaration.fields) {
              const key = `${field.static ? "static" : "instance"}:${field.name}`;
              if (members.has(key)) this.typeError(`Extern class '${declaration.name}' declares member '${field.name}' more than once`, field.span);
              members.add(key);
              this.validateType(this.resolveExternAnnotation(field.type, statement.source, classNames), field.span);
            }
            for (const method of declaration.methods) {
              const key = `${method.static ? "static" : "instance"}:${method.name}`;
              if (members.has(key)) this.typeError(`Extern class '${declaration.name}' declares member '${method.name}' more than once`, method.span);
              members.add(key);
              for (const parameter of method.parameters) {
                const type = this.resolveExternAnnotation(parameter.type, statement.source, classNames);
                this.validateType(type, parameter.span);
                if (parameter.defaultValue) this.requireAssignable(this.inferParameterDefault(parameter.defaultValue, type), type, parameter.defaultValue.span);
              }
              if (method.returnType) {
                const result = this.resolveExternAnnotation(method.returnType, statement.source, classNames);
                this.validateType(result, method.returnType.span);
                if (method.asynchronous && this.asyncResultContainsPromise(result)) {
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
                  type: this.resolveExternAnnotation(parameter.type, statement.source, classNames),
                  span: parameter.span,
                })),
                ...declaration.fields.filter((field) => !field.static).map((field) => ({
                  name: field.name,
                  mutable: field.mutable,
                  type: this.resolveExternAnnotation(field.type, statement.source, classNames),
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
                const own = this.externFunctionType(method, (reference) => this.resolveExternAnnotation(reference, statement.source, classNames));
                if (inherited && !sameType(inherited.type, own)) {
                  this.typeError(`Extern override '${method.name}' must keep the base method signature ${describeType(inherited.type)}`, method.span);
                }
              }
            }
          }
        }
        for (const declaration of statement.functions) {
          for (const parameter of declaration.parameters) {
            const type = this.resolveExternAnnotation(parameter.type, statement.source, new Set(statement.classes.map((item) => item.name)));
            this.validateType(type, parameter.span);
            if (parameter.defaultValue) this.requireAssignable(this.inferParameterDefault(parameter.defaultValue, type), type, parameter.defaultValue.span);
          }
          const result = this.resolveExternAnnotation(declaration.returnType, statement.source, new Set(statement.classes.map((item) => item.name)));
          this.validateType(result, declaration.span);
          if (declaration.asynchronous && declaration.returnType && this.asyncResultContainsPromise(result)) {
            this.diagnostics.push(diagnostic("VEL4018", "An async result annotation names the resolved value; write '-> T', not '-> Promise<T>'", declaration.returnType.span));
          }
        }
        for (const declaration of statement.constants) this.validateType(this.resolveExternAnnotation(declaration.type, statement.source, new Set(statement.classes.map((item) => item.name))), declaration.span);
        break;
      case "ComponentDeclaration":
        this.analyzeComponent(statement);
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
        const actual = this.inferExpression(statement.initializer, annotated ?? unknownType);
        const declared = annotated ?? actual;
        if (statement.type) this.validateType(declared, statement.type.span);
        this.requireAssignable(actual, declared, statement.initializer.span);
        this.declarePattern(statement.pattern, statement.binding === "let", declared);
        break;
      }
      case "StateDeclaration":
      case "ComputedDeclaration": {
        if (this.scopes.length !== 1) {
          this.diagnostics.push(diagnostic("VEL3010", `'${statement.kind === "StateDeclaration" ? "state" : "computed"}' is only valid at module or component scope`, statement.span));
          break;
        }
        const annotated = statement.type ? this.resolveAnnotation(statement.type) : null;
        if (statement.kind === "ComputedDeclaration") this.flowFrameDepth += 1;
        const actual = this.inferExpression(statement.initializer, annotated ?? unknownType);
        if (statement.kind === "ComputedDeclaration") this.flowFrameDepth -= 1;
        const declared = annotated ?? actual;
        if (statement.type) this.validateType(declared, statement.type.span);
        this.requireAssignable(actual, declared, statement.initializer.span);
        const kind = statement.kind === "StateDeclaration" ? "state" : "computed";
        this.declareBinding(statement.name, kind === "state", declared, statement.span);
        this.reactiveBindings.set(statement.name, kind);
        break;
      }
      case "ResourceDeclaration":
        this.diagnostics.push(diagnostic("VEL3012", "'resource' is only valid at component scope", statement.span));
        this.analyzeResourceDeclaration(statement);
        break;
      case "ActionDeclaration":
        this.diagnostics.push(diagnostic("VEL3013", "'action' is only valid at component scope", statement.span));
        this.analyzeActionDeclaration(statement);
        break;
      case "WatchDeclaration": {
        if (this.scopes.length !== 1) {
          this.diagnostics.push(diagnostic("VEL3010", "'watch' is only valid at module or component scope", statement.span));
          break;
        }
        this.flowFrameDepth += 1;
        const watched = this.inferExpression(statement.expression);
        this.enterScope();
        if (statement.currentName) this.declareBinding(statement.currentName, false, watched, statement.span);
        if (statement.previousName) this.declareBinding(statement.previousName, false, watched, statement.span);
        for (const child of statement.body) this.analyzeStatement(child);
        this.exitScope();
        this.flowFrameDepth -= 1;
        break;
      }
      case "FunctionDeclaration":
        this.analyzeFunctionDeclaration(statement, null);
        break;
      case "ReturnStatement": {
        if (this.classInitDepth > 0) {
          this.diagnostics.push(diagnostic("VEL3014", "'return' cannot be used directly in a class init block", statement.span));
          break;
        }
        if (this.functionDepth === 0) {
          this.diagnostics.push(diagnostic("VEL3003", "'return' can only be used inside a function", statement.span));
          break;
        }
        const expected = this.returnTypes.at(-1) ?? unknownType;
        const actual = statement.value ? this.inferExpression(statement.value, expected) : noneType;
        const returned = this.asynchronousFunctions.at(-1) ? this.resolvedAsyncResult(actual) : actual;
        this.requireAssignable(returned, expected, statement.span);
        break;
      }
      case "ThrowStatement": {
        const thrown = this.inferExpression(statement.value);
        const throwable = (type: ValueType): boolean => type.kind === "class"
          ? this.isSubclassOf(type.identity ?? type.name, "Error")
          : type.kind === "union" && type.members.every(throwable);
        if (!throwable(thrown)) {
          this.typeError(`Only Error values can be thrown, received ${describeType(thrown)}`, statement.value.span);
        }
        break;
      }
      case "AssertStatement": {
        const condition = this.inferExpression(statement.condition);
        this.requireCondition(condition, statement.condition);
        if (statement.message) {
          this.requireAssignable(this.inferExpression(statement.message, stringType), stringType, statement.message.span);
        }
        this.persistNarrowings(this.narrowingFor(statement.condition, condition));
        break;
      }
      case "IfStatement":
        {
          const condition = this.inferExpression(statement.condition);
          this.requireCondition(condition, statement.condition);
          this.analyzeBlock(statement.thenBody, this.narrowingFor(statement.condition, condition));
        }
        if (statement.elseBody) {
          this.analyzeBlock(statement.elseBody, this.negativeNarrowingFor(statement.condition));
        }
        break;
      case "MatchStatement": {
        const matched = this.inferExpression(statement.value);
        if (matched.kind === "unknown") {
          this.typeError("Validate an unknown value before matching it", statement.value.span);
        }
        const seen = new Set<string>();
        const coveredEnumMembers = new Set<string>();
        for (const branch of statement.cases) {
          for (const value of branch.values) {
            const literal = this.inferExpression(value);
            const key = value.kind === "LiteralExpression"
              ? value.value === null ? "none" : `${typeof value.value}:${String(value.value)}`
              : `${value.object.kind === "IdentifierExpression" ? value.object.name : "?"}.${value.property}`;
            if (seen.has(key)) {
              this.diagnostics.push(diagnostic("VEL4013", `Match value '${key}' is declared more than once`, value.span));
            }
            seen.add(key);
            if (matched.kind === "enum" && literal.kind === "enum" && value.kind === "MemberExpression") {
              coveredEnumMembers.add(value.property);
            }
            if (matched.kind !== "unknown" && !this.matchLiteralCompatible(matched, literal)) {
              this.typeError(`Cannot match ${describeType(matched)} against ${describeType(literal)}`, value.span);
            }
          }
          this.analyzeBlock(branch.body);
        }
        if (statement.elseBody) this.analyzeBlock(statement.elseBody);
        if (matched.kind === "enum") {
          if (statement.elseBody) {
            this.exhaustiveMatches.add(statement.span.start);
          } else {
            const missing = [...(this.enums.get(matched.name)?.members ?? [])].filter((member) => !coveredEnumMembers.has(member));
            if (missing.length > 0) {
              this.diagnostics.push(diagnostic("VEL4015", `Match on ${matched.name} is missing: ${missing.join(", ")}`, statement.span));
            } else {
              this.exhaustiveMatches.add(statement.span.start);
            }
          }
        }
        break;
      }
      case "ForStatement": {
        const iterable = this.inferExpression(statement.iterable);
        const element = iterable.kind === "list" || iterable.kind === "set" ? iterable.element : iterable.kind === "map" ? iterable.key : unknownType;
        if (iterable.kind !== "list" && iterable.kind !== "set" && iterable.kind !== "map" && iterable.kind !== "any") {
          this.typeError(`Cannot iterate over ${describeType(iterable)}`, statement.iterable.span);
        }
        if (iterable.kind === "map") this.mapLoops.add(statement.span.start);
        this.enterScope();
        this.declarePattern(statement.pattern, false, element);
        this.loopDepth += 1;
        for (const child of statement.body) {
          this.analyzeStatement(child);
        }
        this.loopDepth -= 1;
        this.exitScope();
        break;
      }
      case "WhileStatement":
        this.requireCondition(this.inferExpression(statement.condition), statement.condition);
        this.loopDepth += 1;
        this.analyzeBlock(statement.body);
        this.loopDepth -= 1;
        break;
      case "BreakStatement":
      case "ContinueStatement":
        if (this.loopDepth === 0) {
          this.diagnostics.push(diagnostic("VEL3005", `'${statement.kind === "BreakStatement" ? "break" : "continue"}' can only be used in a loop`, statement.span));
        }
        break;
      case "TryStatement":
        this.analyzeBlock(statement.tryBody);
        if (statement.catchBody) {
          this.enterScope();
          if (statement.catchName) {
            this.declareBinding(statement.catchName, false, { kind: "class", name: "Error" }, statement.span);
          }
          for (const child of statement.catchBody) {
            this.analyzeStatement(child);
          }
          this.exitScope();
        }
        if (statement.finallyBody) {
          this.analyzeBlock(statement.finallyBody);
        }
        break;
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
      this.validateType(this.resolveAnnotation(field.type), field.type.span);
    }
  }

  private analyzeTypeAliasDeclaration(statement: TypeAliasDeclaration): void {
    if (!this.predeclared.has(statement)) this.declareBinding(statement.name, false, { kind: "typeObject", name: statement.name }, statement.span);
    this.validateType(this.resolveAnnotation(statement.target), statement.target.span);
  }

  private analyzeClassDeclaration(statement: ClassDeclaration): void {
    const outerClassInitDepth = this.classInitDepth;
    const outerClass = this.currentClass;
    this.classInitDepth = 0;
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
      this.validateType(type, parameter.span);
      if (parameter.defaultValue) {
        this.requireAssignable(this.inferParameterDefault(parameter.defaultValue, type), type, parameter.defaultValue.span);
      }
      this.declareBinding(parameter.name, false, parameter.rest ? { kind: "list", element: type } : type, parameter.span);
    }
    if (statement.base && this.classes.has(statement.base.name)) {
      const base = this.classes.get(statement.base.name)!;
      this.checkArguments(statement.base.arguments, base.parameters, statement.base.span, base.requiredParameters);
    }
    for (const field of statement.fields) {
      if (field.static) continue;
      const declared = this.resolveAnnotation(field.type);
      this.validateType(declared, field.type.span);
      this.classFieldInitializerDepth += 1;
      const actual = this.inferExpression(field.initializer, declared);
      this.classFieldInitializerDepth -= 1;
      this.requireAssignable(actual, declared, field.initializer.span);
    }
    if (statement.initialization) this.analyzeClassInitialization(statement);
    this.flowFrameDepth -= 1;
    this.exitScope();

    for (const field of statement.fields) {
      if (!field.static) continue;
      const declared = this.resolveAnnotation(field.type);
      this.validateType(declared, field.type.span);
      this.classFieldInitializerDepth += 1;
      const actual = this.inferExpression(field.initializer, declared);
      this.classFieldInitializerDepth -= 1;
      this.requireAssignable(actual, declared, field.initializer.span);
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
      if (method.abstract) {
        this.validateMethodSignature(method);
      } else {
        this.analyzeFunctionDeclaration(method, statement.name, true, !method.static);
      }
    }

    if (!statement.abstract) {
      const missing = this.unimplementedAbstractMethods(statement.name);
      if (missing.length > 0) {
        this.typeError(`Concrete class '${statement.name}' must implement abstract method${missing.length === 1 ? "" : "s"}: ${missing.join(", ")}`, statement.span);
      }
    }
    this.classInitDepth = outerClassInitDepth;
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
    const previousClass = this.currentClass;
    this.currentClass = statement.name;
    this.asynchronousFunctions.push(false);
    this.returnTypes.push(noneType);
    this.classInitDepth += 1;
    this.declareBinding("self", false, { kind: "class", name: statement.name }, initialization.span, true);
    for (const child of initialization.body) this.analyzeStatement(child);
    this.classInitDepth -= 1;
    this.returnTypes.pop();
    this.asynchronousFunctions.pop();
    this.currentClass = previousClass;
    this.loopDepth = previousLoopDepth;
    this.functionDepth -= 1;
    this.flowFrameDepth -= 1;
    this.exitScope();
  }

  private validateMethodSignature(method: ClassDeclaration["methods"][number]): void {
    for (const parameter of method.parameters) {
      const type = this.resolveAnnotation(parameter.type);
      this.validateType(type, parameter.span);
      if (parameter.defaultValue) this.requireAssignable(this.inferParameterDefault(parameter.defaultValue, type), type, parameter.defaultValue.span);
    }
    if (method.returnType) {
      const result = this.resolveAnnotation(method.returnType);
      this.validateType(result, method.returnType.span);
      if (method.asynchronous && this.asyncResultContainsPromise(result)) {
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

  private analyzeFunctionDeclaration(
    statement: FunctionDeclaration | ActionDeclaration,
    className: string | null,
    method = false,
    declareSelf = Boolean(className),
  ): void {
    const outerClassInitDepth = this.classInitDepth;
    if (!method && !className && !this.predeclared.has(statement)) {
      this.declareBinding(statement.name, false, this.functionType(statement as FunctionDeclaration), statement.span);
    }
    this.enterScope();
    this.flowFrameDepth += 1;
    this.functionDepth += 1;
    const previousLoopDepth = this.loopDepth;
    this.loopDepth = 0;
    const previousClass = this.currentClass;
    this.currentClass = className ?? previousClass;
    const asynchronous = statement.kind === "ActionDeclaration" || statement.asynchronous;
    this.asynchronousFunctions.push(asynchronous);
    const declaredReturn = this.resolveResult(statement.returnType);
    if (statement.returnType) this.validateType(declaredReturn, statement.returnType.span);
    if (asynchronous && statement.returnType && this.asyncResultContainsPromise(declaredReturn)) {
      this.diagnostics.push(diagnostic("VEL4018", "An async result annotation names the resolved value; write '-> T', not '-> Promise<T>'", statement.returnType.span));
    }
    const expectedReturn = asynchronous ? this.resolvedAsyncResult(declaredReturn) : declaredReturn;
    this.returnTypes.push(expectedReturn);
    if (className && declareSelf) {
      this.declareBinding("self", false, { kind: "class", name: className }, statement.span, true);
    }
    for (const parameter of statement.parameters) {
      const type = this.resolveAnnotation(parameter.type);
      this.validateType(type, parameter.span);
      if (parameter.defaultValue) {
        this.requireAssignable(this.inferParameterDefault(parameter.defaultValue, type), type, parameter.defaultValue.span);
      }
      this.declareBinding(parameter.name, false, parameter.rest ? { kind: "list", element: type } : type, parameter.span);
    }
    this.classInitDepth = 0;
    for (const child of statement.body) {
      this.analyzeStatement(child);
    }
    if (statement.returnType && expectedReturn.kind !== "none" && !this.blockAlwaysReturns(statement.body)) {
      const declarationKind = statement.kind === "ActionDeclaration" ? "Action" : "accessor" in statement ? "Getter" : "Function";
      this.diagnostics.push(diagnostic("VEL4006", `${declarationKind} '${statement.name}' can finish without returning ${describeType(expectedReturn)}`, statement.span));
    }
    this.returnTypes.pop();
    this.asynchronousFunctions.pop();
    this.currentClass = previousClass;
    this.loopDepth = previousLoopDepth;
    this.functionDepth -= 1;
    this.flowFrameDepth -= 1;
    this.exitScope();
    this.classInitDepth = outerClassInitDepth;
  }

  private analyzeBlock(statements: readonly Statement[], narrowed: ReadonlyMap<string, ValueType> = new Map()): void {
    this.enterScope();
    this.applyNarrowings(narrowed, statements[0]?.span ?? { start: 0, end: 0 });
    for (const statement of statements) {
      this.analyzeStatement(statement);
    }
    this.exitScope();
  }

  private analyzeAssignment(statement: AssignmentStatement): void {
    let targetType = unknownType;

    if (statement.target.kind !== "IdentifierExpression" && continuesOptionalChain(statement.target)) {
      this.diagnostics.push(diagnostic("VEL3002", "Optional chains cannot be assignment targets", statement.target.span));
    }

    if (statement.target.kind === "IdentifierExpression") {
      const binding = this.lookup(statement.target.name);
      if (!binding) {
        this.diagnostics.push(diagnostic("VEL3001", `Unknown name '${statement.target.name}'`, statement.target.span));
        return;
      }
      if (!binding.mutable) {
        this.diagnostics.push(diagnostic("VEL3002", `Cannot assign to const binding '${statement.target.name}'`, statement.target.span));
      }
      targetType = binding.type;
    } else if (statement.target.kind === "MemberExpression") {
      targetType = this.inferMember(statement.target.object, statement.target.property, statement.target.optional, statement.target.span);
      const owner = nonOptional(this.expandAliases(this.inferExpression(statement.target.object)));
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
        } else if (privateField && !privateField.mutable) {
          this.diagnostics.push(diagnostic("VEL3002", `Cannot assign to private const field '${statement.target.property}'`, statement.target.span));
        } else if (privateMethod) {
          this.diagnostics.push(diagnostic("VEL3002", `Cannot assign to private method '${statement.target.property}'`, statement.target.span));
        } else if (field && !field.mutable) {
          const label = info?.identity ? "read-only member" : "const field";
          this.diagnostics.push(diagnostic("VEL3002", `Cannot assign to ${label} '${statement.target.property}'`, statement.target.span));
        } else if (getter) {
          const label = info?.identity?.startsWith("js:") ? "read-only member" : "getter";
          this.diagnostics.push(diagnostic("VEL3002", `Cannot assign to ${label} '${statement.target.property}'`, statement.target.span));
        } else if (method) {
          this.diagnostics.push(diagnostic("VEL3002", `Cannot assign to read-only member '${statement.target.property}'`, statement.target.span));
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
        } else if ((field && !field.mutable) || getter || method) {
          this.diagnostics.push(diagnostic("VEL3002", `Cannot assign to read-only static member '${statement.target.property}'`, statement.target.span));
        }
      }
    } else {
      const objectType = this.inferExpression(statement.target.object);
      const indexType = this.inferExpression(statement.target.index);
      if (objectType.kind === "list") {
        this.requireAssignable(indexType, numberType, statement.target.index.span);
        targetType = objectType.element;
      } else if (objectType.kind === "map") {
        this.requireAssignable(indexType, objectType.key, statement.target.index.span);
        targetType = objectType.value;
      } else {
        this.typeError(`Cannot index-assign ${describeType(objectType)}`, statement.target.span);
      }
    }

    const valueType = this.inferExpression(statement.value, statement.operator === "=" ? targetType : unknownType);

    if (statement.operator !== "=" && targetType.kind !== "number" && !(statement.operator === "+=" && targetType.kind === "string")) {
      this.typeError(`Operator '${statement.operator}' is not valid for ${describeType(targetType)}`, statement.span);
    }
    this.requireAssignable(valueType, targetType, statement.value.span);
  }

  private inferExpression(expression: Expression, contextualType: ValueType = unknownType): ValueType {
    const type = this.inferExpressionType(expression, contextualType);
    this.recordSemanticExpression(expression, type);
    return type;
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
        || this.semanticExpressionContexts.has(`${expression.span.start}:${expression.span.end}`)) {
        const key = `${expression.span.start}:${expression.span.end}`;
        this.semanticExpressionTypes.set(key, type);
        this.semanticExpressionMembers.set(key, members);
      }
    }
  }

  private inferExpressionType(expression: Expression, contextualType: ValueType = unknownType): ValueType {
    switch (expression.kind) {
      case "LiteralExpression":
        return expression.value === null ? noneType : typeof expression.value === "string" ? stringType : typeof expression.value === "number" ? numberType : boolType;
      case "FStringExpression":
        for (const part of expression.parts) {
          if (part.kind === "expression") {
            this.inferExpression(part.value);
          }
        }
        return stringType;
      case "IdentifierExpression": {
        const binding = this.lookup(expression.name) ?? this.builtin(expression.name);
        if (!binding) {
          const guidance = wrappedGlobalGuidance.get(expression.name);
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
        let element = unknownType;
        const expectedElement = contextualType.kind === "list" ? contextualType.element : unknownType;
        for (const item of expression.elements) {
          const itemType = this.inferExpression(item, expectedElement);
          if (item.kind === "SpreadExpression") {
            if (itemType.kind === "list") element = mergeTypes(element, itemType.element);
            else if (itemType.kind !== "any") this.typeError(`Cannot spread ${describeType(itemType)} into a list`, item.span);
          } else {
            element = mergeTypes(element, itemType);
          }
        }
        if (expression.elements.length === 0 && contextualType.kind === "list") return contextualType;
        return { kind: "list", element };
      }
      case "ObjectExpression": {
        if (contextualType.kind === "named") {
          const contextKey = `${expression.span.start}:${expression.span.end}`;
          this.semanticExpressionContexts.set(contextKey, contextualType);
          this.semanticExpressionContextMembers.set(contextKey, this.semanticMembersOf(contextualType));
        }
        const fields = new Map<string, ValueType>();
        const explicitFields = new Set<string>();
        const expectedFields = contextualType.kind === "object"
          ? contextualType.fields
          : contextualType.kind === "named" ? this.fieldsOf(contextualType.name) : null;
        for (const property of expression.properties) {
          if (property.kind === "ObjectProperty") {
            if (explicitFields.has(property.name)) {
              this.diagnostics.push(diagnostic("VEL4004", `Object field '${property.name}' is declared more than once`, property.span));
            }
            explicitFields.add(property.name);
            if (contextualType.kind === "named" && expectedFields?.has(property.name)) {
              this.semanticObjectPropertyOwners.set(`${property.span.start}:${property.name}`, contextualType);
            }
            const expected = expectedFields?.get(property.name) ?? unknownType;
            fields.set(property.name, this.inferExpression(property.value, expected.kind === "optional" ? expected.inner : expected));
          } else {
            const spread = this.inferExpression(property.value);
            const spreadFields = spread.kind === "object" ? spread.fields : spread.kind === "named" ? this.fieldsOf(spread.name) : null;
            if (spreadFields) {
              for (const [name, type] of spreadFields) fields.set(name, type);
            } else if (spread.kind !== "any") {
              this.typeError(`Cannot spread ${describeType(spread)} into an object`, property.span);
            }
          }
        }
        return { kind: "object", fields };
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
          } else if (this.classInitDepth > 0) {
            this.diagnostics.push(diagnostic("VEL4007", "'await' cannot be used directly in a class init block", expression.span));
          }
          const invalidFunctionAwait = this.functionDepth > 0 && !this.asynchronousFunctions.at(-1);
          const invalidComponentAwait = this.functionDepth === 0 && this.componentStates !== null && this.mountedDepth === 0;
          if (this.parameterDefaultDepth === 0 && this.classInitDepth === 0 && (invalidFunctionAwait || invalidComponentAwait)) {
            this.diagnostics.push(diagnostic("VEL4007", "'await' can only be used in an async function, mounted block, or at module scope", expression.span));
          }
          const awaited = this.expandAliases(operand);
          if (awaited.kind === "promise") {
            return resolvedAsyncType(awaited.value);
          }
          if (awaited.kind !== "any") {
            this.typeError(`Cannot await ${describeType(operand)}`, expression.span);
          }
          return awaited.kind === "any" ? anyType : unknownType;
        }
        if (expression.operator === "not") {
          if (operand.kind === "optional") this.optionalNegations.add(expression.span.start);
          else this.requireAssignable(operand, boolType, expression.operand.span);
          return boolType;
        }
        this.requireAssignable(operand, numberType, expression.operand.span);
        return numberType;
      }
      case "BinaryExpression":
        return this.inferBinary(expression.left, expression.operator, expression.right, expression.span);
      case "ComparisonChainExpression": {
        const types = expression.operands.map((operand) => this.inferExpression(operand));
        for (let index = 0; index < expression.operators.length; index += 1) {
          if (expression.operators[index] === "==" || expression.operators[index] === "!=") continue;
          this.requireOrderedComparison(
            types[index]!,
            types[index + 1]!,
            expression.operands[index]!,
            expression.operands[index + 1]!,
            expression.span,
          );
        }
        return boolType;
      }
      case "ConditionalExpression":
        {
          const condition = this.inferExpression(expression.condition);
          this.requireCondition(condition, expression.condition);
          return mergeTypes(
            this.inferNarrowedExpression(expression.thenValue, this.narrowingFor(expression.condition, condition), contextualType),
            this.inferNarrowedExpression(expression.elseValue, this.negativeNarrowingFor(expression.condition), contextualType),
          );
        }
      case "IsExpression":
        this.inferExpression(expression.value);
        {
          const checked = this.resolveAnnotation(expression.type);
          this.validateType(checked, expression.type.span);
          if (checked.kind === "class") this.classChecks.add(expression.span.start);
        }
        return boolType;
      case "ArrowFunctionExpression":
        return this.inferArrow(expression, contextualType);
      case "CallExpression":
        return this.inferCall(expression.callee, expression.arguments, expression.span, contextualType);
      case "MemberExpression":
        return this.inferMember(expression.object, expression.property, expression.optional, expression.span);
      case "IndexExpression": {
        const original = this.expandAliases(this.inferExpression(expression.object));
        const guarded = original.kind === "optional" && continuesOptionalChain(expression.object);
        const object = guarded ? original.inner : original;
        const index = this.inferExpression(expression.index);
        if (object.kind === "list") {
          this.requireAssignable(index, numberType, expression.index.span);
          if (guarded) {
            this.optionalIndexes.add(expression.span.start);
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
        return object.kind === "any" ? anyType : unknownType;
      }
      case "JSXElementExpression":
        return this.inferJsx(expression);
    }
  }

  private inferBinary(leftExpression: Expression, operator: string, rightExpression: Expression, operationSpan: Span): ValueType {
    const left = this.inferExpression(leftExpression);
    const right = this.inferExpression(rightExpression);
    if (operator === "??") {
      if (left.kind !== "optional" && left.kind !== "none" && left.kind !== "any") {
        this.typeError(`Left side of '??' is not optional: ${describeType(left)}`, leftExpression.span);
      }
      return mergeTypes(nonOptional(left), right);
    }
    if (operator === "and" || operator === "or") {
      this.requireAssignable(left, boolType, leftExpression.span);
      this.requireAssignable(right, boolType, rightExpression.span);
      return boolType;
    }
    if (operator === "in") {
      if (right.kind === "list" || right.kind === "set") {
        this.requireAssignable(left, right.element, leftExpression.span);
        this.membershipChecks.set(operationSpan.start, right.kind === "list" ? "includes" : "has");
      } else if (right.kind === "map") {
        this.requireAssignable(left, right.key, leftExpression.span);
        this.membershipChecks.set(operationSpan.start, "has");
      } else if (right.kind === "string") {
        this.requireAssignable(left, stringType, leftExpression.span);
        this.membershipChecks.set(operationSpan.start, "includes");
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

  private requireOrderedComparison(
    leftType: ValueType,
    rightType: ValueType,
    leftExpression: Expression,
    rightExpression: Expression,
    operationSpan: Span,
  ): void {
    const left = this.expandAliases(leftType);
    const right = this.expandAliases(rightType);
    if (left.kind === "any" || right.kind === "any") return;
    if ((left.kind === "number" && right.kind === "number")
      || (left.kind === "string" && right.kind === "string")) return;
    this.typeError(
      `Ordered comparison requires two numbers or two strings, received ${describeType(leftType)} and ${describeType(rightType)}`,
      { start: leftExpression.span.start, end: Math.max(rightExpression.span.end, operationSpan.end) },
    );
  }

  private inferParameterDefault(expression: Expression, contextualType: ValueType = unknownType): ValueType {
    this.parameterDefaultDepth += 1;
    const result = this.inferExpression(expression, contextualType);
    this.parameterDefaultDepth -= 1;
    return result;
  }

  private resolvedAsyncResult(type: ValueType): ValueType {
    const expanded = this.expandAliases(type);
    const resolved = resolvedAsyncType(expanded);
    return sameType(expanded, resolved) ? type : resolved;
  }

  private asyncResultContainsPromise(type: ValueType): boolean {
    const expanded = this.expandAliases(type);
    return !sameType(expanded, resolvedAsyncType(expanded));
  }

  private inferArrow(expression: ArrowFunctionExpression, contextualType: ValueType): ValueType {
    const expected = contextualType.kind === "function" ? contextualType : null;
    this.enterScope();
    this.flowFrameDepth += 1;
    this.functionDepth += 1;
    this.asynchronousFunctions.push(expression.asynchronous);
    const parameterTypes: ValueType[] = [];
    let rest: ValueType | undefined;
    let fixedIndex = 0;
    for (const parameter of expression.parameters) {
      const contextualParameter = parameter.rest ? expected?.rest : expected?.parameters[fixedIndex];
      const annotated = parameter.type ? this.resolveAnnotation(parameter.type) : null;
      const defaultType = !annotated && !contextualParameter && parameter.defaultValue
        ? this.inferParameterDefault(parameter.defaultValue)
        : null;
      const type = annotated ?? contextualParameter ?? defaultType ?? unknownType;
      if (parameter.type) this.validateType(type, parameter.type.span);
      if (parameter.defaultValue && !defaultType) {
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
    const outerClassInitDepth = this.classInitDepth;
    this.parameterDefaultDepth = 0;
    this.classInitDepth = 0;
    const bodyResult = this.inferExpression(expression.body, contextualResult);
    this.parameterDefaultDepth = outerParameterDefaultDepth;
    this.classInitDepth = outerClassInitDepth;
    const result = expression.asynchronous
      ? { kind: "promise", value: this.resolvedAsyncResult(bodyResult) } satisfies ValueType
      : bodyResult;
    this.asynchronousFunctions.pop();
    this.functionDepth -= 1;
    this.flowFrameDepth -= 1;
    this.exitScope();
    return {
      kind: "function",
      parameters: parameterTypes,
      requiredParameters: expression.parameters.filter((parameter) => !parameter.rest && !parameter.defaultValue).length,
      ...(rest ? { rest } : {}),
      result,
    };
  }

  private inferCall(calleeExpression: Expression, arguments_: readonly Expression[], callSpan: Span, contextualType: ValueType = unknownType): ValueType {
    if (calleeExpression.kind === "IdentifierExpression" && calleeExpression.name === "Map") {
      if (arguments_.length > 1) this.typeError(`Expected 0-1 arguments but received ${arguments_.length}`, callSpan);
      if (!arguments_[0]) return contextualType.kind === "map" ? contextualType : { kind: "map", key: unknownType, value: unknownType };
      const source = this.inferExpression(arguments_[0], contextualType.kind === "map" ? contextualType : unknownType);
      for (const argument of arguments_.slice(1)) this.inferExpression(argument);
      if (source.kind === "map") return source;
      if (source.kind === "any") return { kind: "map", key: anyType, value: anyType };
      this.typeError(`Map construction requires another Map, received ${describeType(source)}`, arguments_[0].span);
      return { kind: "map", key: unknownType, value: unknownType };
    }
    if (calleeExpression.kind === "IdentifierExpression" && calleeExpression.name === "Set") {
      if (arguments_.length > 1) this.typeError(`Expected 0-1 arguments but received ${arguments_.length}`, callSpan);
      if (!arguments_[0]) return contextualType.kind === "set" ? contextualType : { kind: "set", element: unknownType };
      const source = this.inferExpression(arguments_[0], contextualType.kind === "set" ? { kind: "list", element: contextualType.element } : unknownType);
      for (const argument of arguments_.slice(1)) this.inferExpression(argument);
      if (source.kind === "list" || source.kind === "set") return { kind: "set", element: source.element };
      if (source.kind === "any") return { kind: "set", element: anyType };
      this.typeError(`Set construction requires a List or Set, received ${describeType(source)}`, arguments_[0].span);
      return { kind: "set", element: unknownType };
    }

    if (calleeExpression.kind === "MemberExpression" && calleeExpression.object.kind !== "SuperExpression") {
      const collectionResult = this.inferCollectionCall(calleeExpression, arguments_, callSpan);
      if (collectionResult) {
        return collectionResult;
      }
    }

    const callee = this.inferExpression(calleeExpression);
    if (callee.kind === "classConstructor") {
      this.constructorCalls.add(`${callSpan.start}:${callSpan.end}`);
      const info = this.classes.get(callee.identity ?? callee.name) ?? this.classes.get(callee.name);
      if (info?.abstract) this.typeError(`Cannot instantiate abstract class '${callee.name}'`, callSpan);
      this.checkArguments(arguments_, info?.parameters ?? [], callSpan, info?.requiredParameters, info?.constructorRest);
      return { kind: "class", name: callee.name, ...(callee.identity ? { identity: callee.identity } : {}) };
    }
    if (callee.kind === "intrinsic") {
      return this.inferIntrinsicCall(callee, arguments_, callSpan);
    }
    if (callee.kind === "componentConstructor") {
      this.typeError(`Render component '${callee.name}' with JSX`, callSpan);
      for (const argument of arguments_) this.inferExpression(argument);
      return { kind: "node" };
    }
    if (callee.kind === "function" || callee.kind === "action") {
      if (calleeExpression.kind === "MemberExpression" && calleeExpression.property === "parse"
        && arguments_[0]?.kind === "ObjectExpression" && callee.result.kind === "named") {
        this.recordRuntimeObjectShape(arguments_[0], callee.result);
      }
      this.checkArguments(arguments_, callee.parameters, callSpan, callee.requiredParameters, callee.rest);
      if (callee.result.kind === "optional") this.optionalCalls.add(callSpan.start);
      return callee.result;
    }
    if (callee.kind === "optional" && (callee.inner.kind === "function" || callee.inner.kind === "action")) {
      this.checkArguments(arguments_, callee.inner.parameters, callSpan, callee.inner.requiredParameters, callee.inner.rest);
      if (!continuesOptionalChain(calleeExpression)) {
        this.typeError("Use a presence check or an optional access chain before calling an optional function", calleeExpression.span);
      }
      this.optionalCalls.add(callSpan.start);
      this.optionalCallees.add(callSpan.start);
      return optionalOf(callee.inner.result);
    }
    if (callee.kind === "any") {
      for (const argument of arguments_) {
        this.inferExpression(argument);
      }
      return anyType;
    }
    if (callee.kind === "unknown") {
      for (const argument of arguments_) {
        this.inferExpression(argument);
      }
      this.typeError("Cannot call an unknown JavaScript value without a declaration or validation", callSpan);
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
      const actual = this.inferExpression(argument, expected);
      if (expected.kind !== "unknown") this.requireAssignable(actual, expected, argument.span);
      return actual;
    };
    const listAt = (index: number): { readonly type: ValueType; readonly element: ValueType } => {
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
      if (arguments_[index]) this.typeError("Runtime parsing requires a Velar runtime type", arguments_[index]!.span);
      return unknownType;
    };

    switch (intrinsic.name) {
      case "web.route": {
        arity(2, 2);
        inferAt(0, stringType);
        const component = inferAt(1);
        const path = arguments_[0];
        if (path?.kind === "LiteralExpression" && typeof path.value === "string") {
          this.checkRoutePath(path.value, path.span);
        }
        this.checkRouteComponent(component, arguments_[1]?.span ?? callSpan, "A route");
        return { kind: "object", fields: new Map([["path", stringType], ["component", anyType]]) };
      }
      case "web.lazy": {
        arity(2, 4);
        const loader = inferAt(0);
        inferAt(1, stringType);
        const loadingFallback = inferAt(2);
        const failedFallback = inferAt(3);
        const loaderExpression = arguments_[0];
        if (loaderExpression?.kind !== "ArrowFunctionExpression"
          || loaderExpression.parameters.length !== 0
          || loaderExpression.body.kind !== "DynamicImportExpression") {
          this.typeError("A lazy loader must be written as () => import(\"./module.vel\")", loaderExpression?.span ?? callSpan);
          return anyType;
        }
        if (loader.kind !== "function" && loader.kind !== "any") {
          if (arguments_[0]) this.typeError(`Expected a module loader, received ${describeType(loader)}`, arguments_[0]!.span);
          return anyType;
        }
        if (loader.kind === "any") return anyType;
        if (loader.parameters.length !== 0) {
          this.typeError("A lazy module loader cannot receive parameters", arguments_[0]?.span ?? callSpan);
        }
        const moduleType = loader.result.kind === "promise" ? loader.result.value : null;
        if (!moduleType) {
          this.typeError("A lazy module loader must return import(\"./module.vel\")", arguments_[0]?.span ?? callSpan);
          return anyType;
        }
        const name = arguments_[1]?.kind === "LiteralExpression" && typeof arguments_[1].value === "string"
          ? arguments_[1].value
          : null;
        if (!name) {
          this.typeError("A lazy component export name must be a string literal", arguments_[1]?.span ?? callSpan);
          return anyType;
        }
        if (moduleType.kind !== "object") {
          this.typeError("A lazy loader must load a checked Velar module", arguments_[0]?.span ?? callSpan);
          return anyType;
        }
        const exported = moduleType.fields.get(name);
        if (!exported) {
          this.typeError(`Dynamically imported module has no export named '${name}'`, arguments_[1]?.span ?? callSpan);
          return anyType;
        }
        if (exported.kind !== "componentConstructor") {
          this.typeError(`Dynamic export '${name}' is ${describeType(exported)}, not a component`, arguments_[1]?.span ?? callSpan);
          return anyType;
        }
        if (arguments_[2] && loadingFallback.kind !== "none" && loadingFallback.kind !== "any") {
          if (loadingFallback.kind !== "componentConstructor") {
            this.typeError("A lazy loading fallback must be a component", arguments_[2]!.span);
          } else if (loadingFallback.requiredProps.size > 0) {
            this.typeError("A lazy loading fallback cannot require props", arguments_[2]!.span);
          }
        }
        if (arguments_[3] && failedFallback.kind !== "none" && failedFallback.kind !== "any") {
          if (failedFallback.kind !== "componentConstructor") {
            this.typeError("A lazy failure fallback must be a component accepting error: Error", arguments_[3]!.span);
          } else {
            const error = failedFallback.props.get("error");
            if (!error || !isAssignable({ kind: "class", name: "Error" }, error, this)
              || [...failedFallback.requiredProps].some((prop) => prop !== "error")) {
              this.typeError("A lazy failure fallback must accept error: Error and require no other props", arguments_[3]!.span);
            }
          }
        }
        return exported;
      }
      case "collections.enumerate": {
        arity(1, 2);
        const { element } = listAt(0);
        inferAt(1, numberType);
        return { kind: "list", element: { kind: "object", fields: new Map([["index", numberType], ["value", element]]) } };
      }
      case "collections.zip": {
        arity(2, 2);
        const left = listAt(0).element;
        const right = listAt(1).element;
        return { kind: "list", element: { kind: "object", fields: new Map([["first", left], ["second", right]]) } };
      }
      case "collections.unique":
      case "collections.reverse":
      case "collections.compact": {
        arity(1, 1);
        const { element } = listAt(0);
        return { kind: "list", element: intrinsic.name === "collections.compact" ? nonOptional(element) : element };
      }
      case "collections.repeat": {
        arity(2, 2);
        const element = inferAt(0);
        inferAt(1, numberType);
        return { kind: "list", element };
      }
      case "collections.contains":
      case "collections.count": {
        arity(2, 2);
        const element = listAt(0).element;
        inferAt(1, element);
        return intrinsic.name === "collections.contains" ? boolType : numberType;
      }
      case "collections.take":
      case "collections.drop": {
        arity(2, 2);
        const { element } = listAt(0);
        inferAt(1, numberType);
        return { kind: "list", element };
      }
      case "collections.chunk": {
        arity(2, 2);
        const { element } = listAt(0);
        inferAt(1, numberType);
        return { kind: "list", element: { kind: "list", element } };
      }
      case "collections.flatten": {
        arity(1, 1);
        const outer = listAt(0).element;
        if (outer.kind === "list") return outer;
        if (outer.kind === "any") return { kind: "list", element: anyType };
        if (arguments_[0]) this.typeError(`flatten expects a List of Lists, received List<${describeType(outer)}>`, arguments_[0]!.span);
        return { kind: "list", element: unknownType };
      }
      case "collections.groupBy":
      case "collections.keyBy":
      case "collections.countBy": {
        arity(2, 2);
        const element = listAt(0).element;
        const key = callbackResult(callbackAt(1, [element], unknownType));
        if (intrinsic.name === "collections.groupBy") return { kind: "map", key, value: { kind: "list", element } };
        if (intrinsic.name === "collections.countBy") return { kind: "map", key, value: numberType };
        return { kind: "map", key, value: element };
      }
      case "collections.sortBy": {
        arity(2, 3);
        const element = listAt(0).element;
        const key = callbackResult(callbackAt(1, [element], unknownType));
        if (!this.isCollectionOrderKey(key) && arguments_[1]) {
          this.typeError(`sortBy key must return only string or only number, received ${describeType(key)}`, arguments_[1]!.span);
        }
        inferAt(2, boolType);
        return { kind: "list", element };
      }
      case "collections.partition": {
        arity(2, 2);
        const element = listAt(0).element;
        callbackAt(1, [element], boolType);
        const list: ValueType = { kind: "list", element };
        return { kind: "object", fields: new Map([["matches", list], ["rest", list]]) };
      }
      case "collections.find": {
        arity(2, 2);
        const element = listAt(0).element;
        callbackAt(1, [element], boolType);
        return optionalOf(element);
      }
      case "collections.findIndex":
      case "collections.any":
      case "collections.all": {
        arity(2, 2);
        const element = listAt(0).element;
        callbackAt(1, [element], boolType);
        return intrinsic.name === "collections.findIndex" ? numberType : boolType;
      }
      case "collections.first":
      case "collections.last": {
        arity(1, 1);
        return optionalOf(listAt(0).element);
      }
      case "collections.minBy":
      case "collections.maxBy": {
        arity(2, 2);
        const element = listAt(0).element;
        const key = callbackResult(callbackAt(1, [element], unknownType));
        if (!this.isCollectionOrderKey(key) && arguments_[1]) {
          this.typeError(`${intrinsic.name === "collections.minBy" ? "minBy" : "maxBy"} key must return only string or only number, received ${describeType(key)}`, arguments_[1]!.span);
        }
        return optionalOf(element);
      }
      case "collections.sum": {
        arity(1, 1);
        const element = listAt(0).element;
        if (!isAssignable(element, numberType, this) && element.kind !== "any") {
          this.typeError(`sum expects List<number>, received List<${describeType(element)}>`, arguments_[0]?.span ?? callSpan);
        }
        return numberType;
      }
      case "collections.join": {
        arity(1, 2);
        const element = listAt(0).element;
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
      case "http.parse": {
        arity(1, 1);
        return { kind: "promise", value: runtimeTypeAt(0) };
      }
      case "http.request": {
        arity();
        let options: ValueType | null = null;
        for (const [index, expected] of intrinsic.parameters.entries()) {
          const actual = inferAt(index, expected);
          if (index === intrinsic.parameters.length - 1 && arguments_[index]) options = actual;
        }
        const fields = options?.kind === "object" ? options.fields : null;
        const body = fields?.get("body");
        if (body && !this.isHttpFormBody(body) && this.jsonSerializable(body) === false) {
          const optionsExpression = arguments_[intrinsic.parameters.length - 1];
          const bodyExpression = optionsExpression?.kind === "ObjectExpression"
            ? optionsExpression.properties.find((property) => property.kind === "ObjectProperty" && property.name === "body")?.value
            : null;
          this.typeError(`HTTP JSON bodies accept only records, Lists, enums, primitives, and optionals; received ${describeType(body)}`, bodyExpression?.span ?? optionsExpression?.span ?? callSpan);
        }
        return intrinsic.result;
      }
      case "realtime.sendJson": {
        arity(1, 1);
        const value = inferAt(0);
        if (this.jsonSerializable(value) === false && arguments_[0]) {
          this.typeError(`Realtime JSON accepts only records, Lists, enums, primitives, and optionals; received ${describeType(value)}`, arguments_[0]!.span);
        }
        return noneType;
      }
      case "config.public": {
        arity(1, 1);
        return runtimeTypeAt(0);
      }
      case "storage.get": {
        arity(2, 3);
        inferAt(0, stringType);
        const parsed = runtimeTypeAt(1);
        if (arguments_[2]) {
          inferAt(2, parsed);
          return parsed;
        }
        return optionalOf(parsed);
      }
      case "storage.databaseGet": {
        arity(2, 3);
        inferAt(0, stringType);
        const parsed = runtimeTypeAt(1);
        if (arguments_[2]) {
          inferAt(2, parsed);
          return { kind: "promise", value: parsed };
        }
        return { kind: "promise", value: optionalOf(parsed) };
      }
      case "storage.watch": {
        arity(3, 3);
        inferAt(0, stringType);
        const parsed = runtimeTypeAt(1);
        callbackAt(2, [optionalOf(parsed), optionalOf(parsed)], unknownType);
        return { kind: "function", parameters: [], requiredParameters: 0, result: noneType };
      }
      case "forms.read": {
        arity(2, 2);
        inferAt(0, { kind: "named", name: "Element" });
        const parsed = runtimeTypeAt(1);
        if (parsed.kind === "any" || parsed.kind === "unknown") return parsed;
        const expanded = this.expandAliases(parsed);
        const fields = expanded.kind === "named" ? this.namedTypes.get(expanded.name) : null;
        if (!fields) {
          this.typeError("Form reading requires a record declared with 'type Name:'", arguments_[1]?.span ?? callSpan);
          return parsed;
        }
        const descriptors: FormReadField[] = [];
        for (const [name, field] of fields) {
          const descriptor = this.formReadField(name, field, arguments_[1]?.span ?? callSpan);
          if (descriptor) descriptors.push(descriptor);
        }
        if (descriptors.length === fields.size) this.formReads.set(callSpan.start, descriptors);
        return parsed;
      }
      case "async.all":
      case "async.race": {
        arity(1, 1);
        const value = listAt(0).element;
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
        const element = listAt(0).element;
        const worker = callbackAt(1, [element], unknownType);
        inferAt(2, numberType);
        const result = callbackResult(worker);
        return { kind: "promise", value: { kind: "list", element: result.kind === "promise" ? result.value : result } };
      }
      case "async.series": {
        arity(1, 1);
        const task = listAt(0).element;
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
          ["toBe", { kind: "function", parameters: [actual], requiredParameters: 1, result: noneType }],
          ["toEqual", { kind: "function", parameters: [actual], requiredParameters: 1, result: noneType }],
        ]);
        if (matched.kind === "bool" || dynamic) {
          fields.set("toBeTruthy", { kind: "function", parameters: [], requiredParameters: 0, result: noneType });
          fields.set("toBeFalsy", { kind: "function", parameters: [], requiredParameters: 0, result: noneType });
        }
        if (matched.kind === "list" || matched.kind === "string" || dynamic) {
          const contained = matched.kind === "list" ? matched.element : matched.kind === "string" ? stringType : anyType;
          fields.set("toContain", { kind: "function", parameters: [contained], requiredParameters: 1, result: noneType });
          fields.set("toHaveLength", { kind: "function", parameters: [numberType], requiredParameters: 1, result: noneType });
        }
        if (matched.kind === "string" || dynamic) {
          fields.set("toMatch", { kind: "function", parameters: [stringType], requiredParameters: 1, result: noneType });
        }
        const callable = matched.kind === "function" || matched.kind === "intrinsic" || matched.kind === "action";
        if (callable || dynamic) fields.set("toThrow", { kind: "function", parameters: [], requiredParameters: 0, result: noneType });
        if (matched.kind === "promise" || dynamic || (callable && matched.result.kind === "promise")) {
          fields.set("toReject", { kind: "function", parameters: [], requiredParameters: 0, result: { kind: "promise", value: noneType } });
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
    this.semanticExpressionOwners.set(`${member.span.start}:${member.span.end}`, nonOptional(object));
    const memberType = object.kind === "list" ? this.listMember(object, member.property)
      : object.kind === "map" ? this.mapMember(object, member.property)
        : object.kind === "set" ? this.setMember(object, member.property)
          : unknownType;
    this.recordSemanticExpression(member, memberType);
    const lowered = object.kind === "list"
      ? ["get", "slice", "append", "extend", "remove", "clear"].includes(member.property)
      : object.kind === "map" ? ["get", "set", "remove", "clear", "keys", "values", "entries"].includes(member.property)
        : object.kind === "set" ? ["add", "remove", "clear", "values"].includes(member.property) : false;
    if (lowered && arguments_.some((argument) => argument.kind === "SpreadExpression")) {
      this.typeError(`Spread arguments are not supported by ${describeType(object)}.${member.property}`, callSpan);
    }
    if (object.kind === "list") {
      if (member.property === "map") {
        const callbackExpected: ValueType = { kind: "function", parameters: [object.element], requiredParameters: 1, result: unknownType };
        const callback = arguments_[0] ? this.inferExpression(arguments_[0], callbackExpected) : unknownType;
        const result = callback.kind === "function" ? callback.result : unknownType;
        return { kind: "list", element: result };
      }
      if (member.property === "filter") {
        const callbackExpected: ValueType = { kind: "function", parameters: [object.element], requiredParameters: 1, result: boolType };
        if (arguments_[0]) {
          const callback = this.inferExpression(arguments_[0], callbackExpected);
          this.requireAssignable(callback, callbackExpected, arguments_[0].span);
        }
        return object;
      }
      if (member.property === "reduce") {
        const initial = arguments_[1] ? this.inferExpression(arguments_[1]) : unknownType;
        const callbackExpected: ValueType = { kind: "function", parameters: [initial, object.element], requiredParameters: 2, result: initial };
        if (arguments_[0]) {
          const callback = this.inferExpression(arguments_[0], callbackExpected);
          this.requireAssignable(callback, callbackExpected, arguments_[0].span);
        }
        if (arguments_.length !== 2) this.typeError(`Expected 2 arguments but received ${arguments_.length}`, callSpan);
        return initial;
      }
      if (member.property === "append") {
        this.collectionCalls.set(member.span.start, "append");
        const argument = arguments_[0];
        const value = argument?.kind === "SpreadExpression"
          ? this.inferExpression(argument.value)
          : argument ? this.inferExpression(argument, object.element) : unknownType;
        if (arguments_.length !== 1) this.typeError(`Expected 1 argument but received ${arguments_.length}`, callSpan);
        for (const extra of arguments_.slice(1)) this.inferExpression(extra);
        if (argument && argument.kind !== "SpreadExpression" && member.object.kind === "IdentifierExpression") {
          const binding = this.lookup(member.object.name);
          if (binding?.type.kind === "list" && binding.type.element.kind === "unknown") {
            binding.type = { kind: "list", element: value };
            this.recordSemanticBinding(`${binding.span.start}:${member.object.name}`, binding.type);
          } else this.requireAssignable(value, object.element, argument.span);
        } else if (argument && argument.kind !== "SpreadExpression") this.requireAssignable(value, object.element, argument.span);
        return noneType;
      }
      if (member.property === "extend") {
        this.collectionCalls.set(member.span.start, "extend");
        const expected: ValueType = { kind: "list", element: object.element };
        const argument = arguments_[0];
        const values = argument?.kind === "SpreadExpression"
          ? this.inferExpression(argument.value)
          : argument ? this.inferExpression(argument, expected) : unknownType;
        if (arguments_.length !== 1) this.typeError(`Expected 1 argument but received ${arguments_.length}`, callSpan);
        for (const extra of arguments_.slice(1)) this.inferExpression(extra);
        if (argument && argument.kind !== "SpreadExpression" && member.object.kind === "IdentifierExpression") {
          const binding = this.lookup(member.object.name);
          if (binding?.type.kind === "list" && binding.type.element.kind === "unknown" && values.kind === "list") {
            binding.type = { kind: "list", element: values.element };
            this.recordSemanticBinding(`${binding.span.start}:${member.object.name}`, binding.type);
          } else this.requireAssignable(values, expected, argument.span);
        } else if (argument && argument.kind !== "SpreadExpression") this.requireAssignable(values, expected, argument.span);
        return noneType;
      }
      if (member.property === "remove") {
        this.collectionCalls.set(member.span.start, "remove");
        this.checkArguments(arguments_, [object.element], callSpan);
        return boolType;
      }
      if (member.property === "clear") {
        this.collectionCalls.set(member.span.start, "clear");
        this.checkArguments(arguments_, [], callSpan);
        return noneType;
      }
      if (member.property === "get") {
        this.collectionCalls.set(member.span.start, "get");
        this.checkArguments(arguments_, [numberType], callSpan);
        return optionalOf(object.element);
      }
      if (member.property === "slice") {
        this.collectionCalls.set(member.span.start, "slice");
        this.checkArguments(arguments_, [numberType, numberType], callSpan, 0);
        return object;
      }
    }

    if (object.kind === "map") {
      if (member.property === "set") {
        this.collectionCalls.set(member.span.start, "set");
        const key = arguments_[0] ? this.inferExpression(arguments_[0]) : unknownType;
        const value = arguments_[1] ? this.inferExpression(arguments_[1]) : unknownType;
        if (member.object.kind === "IdentifierExpression") {
          const binding = this.lookup(member.object.name);
          if (binding?.type.kind === "map" && binding.type.key.kind === "unknown" && binding.type.value.kind === "unknown") {
            binding.type = { kind: "map", key, value };
            this.recordSemanticBinding(`${binding.span.start}:${member.object.name}`, binding.type);
          }
        }
        return noneType;
      }
      if (member.property === "get") {
        this.collectionCalls.set(member.span.start, "get");
        this.checkArguments(arguments_, [object.key], callSpan);
        return optionalOf(object.value);
      }
      if (member.property === "keys") {
        this.collectionCalls.set(member.span.start, "keys");
        this.checkArguments(arguments_, [], callSpan);
        return { kind: "list", element: object.key };
      }
      if (member.property === "values") {
        this.collectionCalls.set(member.span.start, "values");
        this.checkArguments(arguments_, [], callSpan);
        return { kind: "list", element: object.value };
      }
      if (member.property === "entries") {
        this.collectionCalls.set(member.span.start, "entries");
        this.checkArguments(arguments_, [], callSpan);
        return { kind: "list", element: { kind: "object", fields: new Map([["key", object.key], ["value", object.value]]) } };
      }
      if (member.property === "has") {
        this.checkArguments(arguments_, [object.key], callSpan);
        return boolType;
      }
      if (member.property === "remove") {
        this.collectionCalls.set(member.span.start, "remove");
        this.checkArguments(arguments_, [object.key], callSpan);
        return boolType;
      }
      if (member.property === "clear") {
        this.collectionCalls.set(member.span.start, "clear");
        this.checkArguments(arguments_, [], callSpan);
        return noneType;
      }
    }
    if (object.kind === "set") {
      if (member.property === "add") {
        this.collectionCalls.set(member.span.start, "add");
        const value = arguments_[0] ? this.inferExpression(arguments_[0], object.element) : unknownType;
        if (arguments_.length !== 1) this.typeError(`Expected 1 argument but received ${arguments_.length}`, callSpan);
        if (member.object.kind === "IdentifierExpression") {
          const binding = this.lookup(member.object.name);
          if (binding?.type.kind === "set" && binding.type.element.kind === "unknown" && arguments_[0]) {
            binding.type = { kind: "set", element: value };
            this.recordSemanticBinding(`${binding.span.start}:${member.object.name}`, binding.type);
          } else if (arguments_[0]) this.requireAssignable(value, object.element, arguments_[0].span);
        } else if (arguments_[0]) this.requireAssignable(value, object.element, arguments_[0].span);
        return noneType;
      }
      if (member.property === "has") {
        this.checkArguments(arguments_, [object.element], callSpan);
        return boolType;
      }
      if (member.property === "remove") {
        this.collectionCalls.set(member.span.start, "remove");
        this.checkArguments(arguments_, [object.element], callSpan);
        return boolType;
      }
      if (member.property === "clear") {
        this.collectionCalls.set(member.span.start, "clear");
        this.checkArguments(arguments_, [], callSpan);
        return noneType;
      }
      if (member.property === "values") {
        this.collectionCalls.set(member.span.start, "values");
        this.checkArguments(arguments_, [], callSpan);
        return { kind: "list", element: object.element };
      }
    }
    return null;
  }

  private inferMember(objectExpression: Expression, property: string, optional: boolean, memberSpan: Span): ValueType {
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
      return method?.type ?? getter!.type;
    }
    const original = this.inferExpression(objectExpression);
    this.semanticExpressionOwners.set(`${memberSpan.start}:${memberSpan.end}`, nonOptional(original));
    const resolvedOriginal = this.expandAliases(original);
    const object = nonOptional(resolvedOriginal);
    const chainContinuation = continuesOptionalChain(objectExpression);
    const guardedCollectionOperation: CollectionOperation | null = object.kind === "list" && ["get", "slice", "append", "extend", "remove", "clear"].includes(property)
      ? property as CollectionOperation
      : object.kind === "map" && ["get", "set", "remove", "clear", "keys", "values", "entries"].includes(property)
        ? property as CollectionOperation
        : object.kind === "set" && ["add", "remove", "clear", "values"].includes(property)
          ? property as CollectionOperation
          : null;
    if (resolvedOriginal.kind === "optional" && (optional || chainContinuation) && guardedCollectionOperation) {
      this.collectionCalls.set(memberSpan.start, guardedCollectionOperation);
    }
    const basePath = this.stableMemberAccessPath(objectExpression);
    const narrowedMember = basePath ? this.lookupMemberNarrowing(`${basePath}.${property}`) : null;
    let result = unknownType;

    if (object.kind === "any") {
      result = anyType;
    } else if (object.kind === "unknown") {
      this.typeError(`Cannot access '${property}' on unknown without validation`, memberSpan);
    } else if (object.kind === "string" && property === "length") {
      result = numberType;
    } else if (object.kind === "list") {
      result = this.listMember(object, property);
    } else if (object.kind === "set") {
      result = this.setMember(object, property);
    } else if (object.kind === "map") {
      result = this.mapMember(object, property);
    } else if (object.kind === "action") {
      if (property === "pending") result = boolType;
      else if (property === "error") result = optionalOf({ kind: "class", name: "Error" });
      else this.typeError(`Action has no member '${property}'`, memberSpan);
    } else if (object.kind === "object") {
      result = object.fields.get(property) ?? unknownType;
      if (!object.fields.has(property)) {
        this.typeError(`Object has no field '${property}'`, memberSpan);
      }
    } else if (object.kind === "named") {
      const fields = this.fieldsOf(object.name);
      result = fields?.get(property) ?? unknownType;
      if (!fields?.has(property)) {
        this.typeError(`Type '${object.name}' has no field '${property}'`, memberSpan);
      }
    } else if (object.kind === "class") {
      const classKey = object.identity ?? object.name;
      const privateField = this.privateFieldForAccess(classKey, property, false);
      const privateMethod = this.privateMethodForAccess(classKey, property, false);
      const field = this.findField(classKey, property);
      const getter = this.findGetter(classKey, property);
      const method = this.findMethod(classKey, property);
      result = privateField?.type ?? privateMethod ?? field?.type ?? getter?.type ?? method?.type ?? unknownType;
      if (privateField || privateMethod) {
        this.privateMembers.add(memberSpan.start);
      } else if (!field && !getter && !method && this.declaresPrivateMember(classKey, property, false)) {
        this.typeError(`Member '${property}' is private to class '${object.name}'`, memberSpan);
      } else if (!field && !getter && !method) {
        this.typeError(`Class '${object.name}' has no member '${property}'`, memberSpan);
      }
    } else if (object.kind === "classConstructor") {
      const key = object.identity ?? object.name;
      const privateField = this.privateFieldForAccess(key, property, true);
      const privateMethod = this.privateMethodForAccess(key, property, true);
      const field = this.findStaticField(key, property);
      const getter = this.findStaticGetter(key, property);
      const method = this.findStaticMethod(key, property);
      result = privateField?.type ?? privateMethod ?? field?.type ?? getter ?? method ?? unknownType;
      if (privateField || privateMethod) {
        this.privateMembers.add(memberSpan.start);
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
          result: this.typeAliases.get(object.name) ?? { kind: "named", name: object.name },
        };
      } else {
        this.typeError(`Type '${object.name}' has no runtime member '${property}'`, memberSpan);
      }
    } else {
      this.typeError(`${describeType(object)} has no member '${property}'`, memberSpan);
    }

    result = this.displayExternalClasses(result);
    if (narrowedMember) result = narrowedMember;

    if (optional) {
      const finalType = resolvedOriginal.kind === "optional" || resolvedOriginal.kind === "none" ? optionalOf(result) : result;
      if (finalType.kind === "optional") this.optionalMembers.add(memberSpan.start);
      return finalType;
    }
    if (resolvedOriginal.kind === "optional") {
      if (chainContinuation) {
        this.optionalChainMembers.add(memberSpan.start);
        this.optionalMembers.add(memberSpan.start);
        return optionalOf(result);
      }
      this.typeError(`Use optional access '?.' for ${describeType(original)}`, memberSpan);
    }
    if (result.kind === "optional") this.optionalMembers.add(memberSpan.start);
    return result;
  }

  private recordRuntimeObjectShape(expression: Extract<Expression, { kind: "ObjectExpression" }>, owner: Extract<ValueType, { kind: "named" }>): void {
    const fields = this.fieldsOf(owner.name);
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

  private listMember(list: Extract<ValueType, { kind: "list" }>, property: string): ValueType {
    switch (property) {
      case "length":
        return numberType;
      case "get":
        return { kind: "function", parameters: [numberType], requiredParameters: 1, result: optionalOf(list.element) };
      case "slice":
        return { kind: "function", parameters: [numberType, numberType], requiredParameters: 0, result: list };
      case "append":
        return { kind: "function", parameters: [list.element], requiredParameters: 1, result: noneType };
      case "extend":
        return { kind: "function", parameters: [{ kind: "list", element: list.element }], requiredParameters: 1, result: noneType };
      case "remove":
        return { kind: "function", parameters: [list.element], requiredParameters: 1, result: boolType };
      case "clear":
        return { kind: "function", parameters: [], requiredParameters: 0, result: noneType };
      case "map":
        return { kind: "function", parameters: [{ kind: "function", parameters: [list.element], requiredParameters: 1, result: unknownType }], requiredParameters: 1, result: { kind: "list", element: unknownType } };
      case "filter":
        return { kind: "function", parameters: [{ kind: "function", parameters: [list.element], requiredParameters: 1, result: boolType }], requiredParameters: 1, result: list };
      case "reduce":
        return { kind: "function", parameters: [unknownType, unknownType], requiredParameters: 2, result: unknownType };
      default:
        return unknownType;
    }
  }

  private mapMember(map: Extract<ValueType, { kind: "map" }>, property: string): ValueType {
    switch (property) {
      case "size":
        return numberType;
      case "get":
        return { kind: "function", parameters: [map.key], requiredParameters: 1, result: optionalOf(map.value) };
      case "set":
        return { kind: "function", parameters: [map.key, map.value], requiredParameters: 2, result: noneType };
      case "has":
      case "remove":
        return { kind: "function", parameters: [map.key], requiredParameters: 1, result: boolType };
      case "clear":
        return { kind: "function", parameters: [], requiredParameters: 0, result: noneType };
      case "keys":
        return { kind: "function", parameters: [], requiredParameters: 0, result: { kind: "list", element: map.key } };
      case "values":
        return { kind: "function", parameters: [], requiredParameters: 0, result: { kind: "list", element: map.value } };
      case "entries":
        return { kind: "function", parameters: [], requiredParameters: 0, result: { kind: "list", element: { kind: "object", fields: new Map([["key", map.key], ["value", map.value]]) } } };
      default:
        return unknownType;
    }
  }

  private setMember(set: Extract<ValueType, { kind: "set" }>, property: string): ValueType {
    switch (property) {
      case "size":
        return numberType;
      case "add":
        return { kind: "function", parameters: [set.element], requiredParameters: 1, result: noneType };
      case "has":
      case "remove":
        return { kind: "function", parameters: [set.element], requiredParameters: 1, result: boolType };
      case "clear":
        return { kind: "function", parameters: [], requiredParameters: 0, result: noneType };
      case "values":
        return { kind: "function", parameters: [], requiredParameters: 0, result: { kind: "list", element: set.element } };
      default:
        return unknownType;
    }
  }

  private checkArguments(
    arguments_: readonly Expression[],
    parameters: readonly ValueType[],
    callSpan: Span,
    requiredParameters = parameters.length,
    rest?: ValueType,
  ): void {
    const firstSpread = arguments_.findIndex((argument) => argument.kind === "SpreadExpression");
    if (firstSpread >= 0) {
      let fixedIndex = 0;
      let sawSpread = false;
      for (const argument of arguments_) {
        if (argument.kind === "SpreadExpression") {
          sawSpread = true;
          const type = this.inferExpression(argument.value);
          if (fixedIndex < requiredParameters) {
            this.typeError(`Provide the ${requiredParameters} required fixed argument${requiredParameters === 1 ? "" : "s"} before a call spread`, argument.span);
          }
          if (type.kind === "list") {
            const accepted = [...parameters.slice(fixedIndex), ...(rest ? [rest] : [])];
            if (accepted.length === 0) {
              this.typeError("This fixed-arity call has no position for spread values", argument.span);
            } else {
              for (const expected of accepted) this.requireAssignable(type.element, expected, argument.span);
            }
          } else if (type.kind !== "any") {
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

  private functionType(statement: FunctionDeclaration): ValueType {
    const result = this.resolveResult(statement.returnType);
    const rest = statement.parameters.find((parameter) => parameter.rest);
    return {
      kind: "function",
      parameters: statement.parameters.filter((parameter) => !parameter.rest).map((parameter) => this.resolveAnnotation(parameter.type)),
      requiredParameters: statement.parameters.filter((parameter) => !parameter.rest && !parameter.defaultValue).length,
      ...(rest ? { rest: this.resolveAnnotation(rest.type) } : {}),
      result: statement.asynchronous ? { kind: "promise", value: this.resolvedAsyncResult(result) } : result,
    };
  }

  private componentType(statement: ComponentDeclaration): ValueType {
    return {
      kind: "componentConstructor",
      name: statement.name,
      props: new Map(statement.parameters.map((parameter) => [parameter.name, this.resolveAnnotation(parameter.type)])),
      requiredProps: new Set(statement.parameters.filter((parameter) => !parameter.defaultValue).map((parameter) => parameter.name)),
    };
  }

  private analyzeResourceDeclaration(statement: Extract<Statement, { kind: "ResourceDeclaration" }>): void {
    const annotated = statement.type ? this.resolveAnnotation(statement.type) : null;
    if (statement.type) this.validateType(annotated!, statement.type.span);
    const expected: ValueType = annotated ? { kind: "promise", value: annotated } : unknownType;
    const actual = this.inferExpression(statement.initializer, expected);
    let value = annotated ?? unknownType;
    if (actual.kind === "promise") {
      if (annotated) this.requireAssignable(actual.value, annotated, statement.initializer.span);
      else value = actual.value;
    } else if (actual.kind === "any") {
      value = annotated ?? anyType;
    } else {
      this.diagnostics.push(diagnostic("VEL4016", `A resource initializer must return Promise<T>, received ${describeType(actual)}`, statement.initializer.span));
    }
    const fields = new Map<string, ValueType>([
      ["value", value.kind === "none" ? noneType : optionalOf(value)],
      ["loading", boolType],
      ["ready", boolType],
      ["error", optionalOf({ kind: "class", name: "Error" })],
      ["reload", { kind: "function", parameters: [], requiredParameters: 0, result: { kind: "promise", value: noneType } }],
    ]);
    this.declareBinding(statement.name, false, { kind: "object", fields }, statement.span);
  }

  private actionType(statement: ActionDeclaration): ValueType {
    const declaredResult = this.resolvedAsyncResult(this.resolveResult(statement.returnType));
    const callValue = declaredResult.kind === "none" ? noneType : optionalOf(declaredResult);
    const rest = statement.parameters.find((parameter) => parameter.rest);
    return {
      kind: "action",
      parameters: statement.parameters.filter((parameter) => !parameter.rest).map((parameter) => this.resolveAnnotation(parameter.type)),
      requiredParameters: statement.parameters.filter((parameter) => !parameter.rest && !parameter.defaultValue).length,
      ...(rest ? { rest: this.resolveAnnotation(rest.type) } : {}),
      result: { kind: "promise", value: callValue },
    };
  }

  private analyzeActionDeclaration(statement: ActionDeclaration): void {
    this.declareBinding(statement.name, false, this.actionType(statement), statement.span);
    this.analyzeFunctionDeclaration(statement, null, true);
  }

  private analyzeComponent(statement: ComponentDeclaration): void {
    const outerClassInitDepth = this.classInitDepth;
    if (!this.predeclared.has(statement)) this.declareBinding(statement.name, false, this.componentType(statement), statement.span);
    this.enterScope();
    this.flowFrameDepth += 1;
    const previousStates = this.componentStates;
    this.componentStates = new Set(statement.body.filter((item) => item.kind === "StateDeclaration").map((item) => item.name));
    for (const parameter of statement.parameters) {
      const type = this.resolveAnnotation(parameter.type);
      if (parameter.type) this.validateType(type, parameter.type.span);
      if (parameter.defaultValue) this.requireAssignable(this.inferParameterDefault(parameter.defaultValue, type), type, parameter.defaultValue.span);
      this.declareBinding(parameter.name, false, type, parameter.span);
    }
    this.classInitDepth = 0;
    let renders = 0;
    let mounted = 0;
    let cleanup = 0;
    for (const item of statement.body) {
      if (item.kind === "StateDeclaration" || item.kind === "ComputedDeclaration") {
        const annotated = item.type ? this.resolveAnnotation(item.type) : null;
        if (item.kind === "ComputedDeclaration") this.flowFrameDepth += 1;
        const actual = this.inferExpression(item.initializer, annotated ?? unknownType);
        if (item.kind === "ComputedDeclaration") this.flowFrameDepth -= 1;
        const declared = annotated ?? actual;
        if (item.type) this.validateType(declared, item.type.span);
        this.requireAssignable(actual, declared, item.initializer.span);
        this.declareBinding(item.name, item.kind === "StateDeclaration", declared, item.span);
      } else if (item.kind === "ResourceDeclaration") {
        this.flowFrameDepth += 1;
        this.analyzeResourceDeclaration(item);
        this.flowFrameDepth -= 1;
      } else if (item.kind === "ActionDeclaration") {
        this.analyzeActionDeclaration(item);
      } else if (item.kind === "WatchDeclaration") {
        this.flowFrameDepth += 1;
        const watched = this.inferExpression(item.expression);
        this.enterScope();
        if (item.currentName) this.declareBinding(item.currentName, false, watched, item.span);
        if (item.previousName) this.declareBinding(item.previousName, false, watched, item.span);
        for (const child of item.body) this.analyzeStatement(child);
        this.exitScope();
        this.flowFrameDepth -= 1;
      } else if (item.kind === "MountedBlock") {
        mounted += 1;
        this.mountedDepth += 1;
        this.flowFrameDepth += 1;
        this.analyzeBlock(item.body);
        this.flowFrameDepth -= 1;
        this.mountedDepth -= 1;
      } else if (item.kind === "CleanupBlock") {
        cleanup += 1;
        this.flowFrameDepth += 1;
        this.analyzeBlock(item.body);
        this.flowFrameDepth -= 1;
      } else if (item.kind === "StyleBlock") {
        // CSS analysis is owned by the Web style pass.
      } else if (item.kind === "ReturnStatement") {
        renders += 1;
        this.flowFrameDepth += 1;
        const rendered = item.value ? this.inferExpression(item.value) : noneType;
        this.flowFrameDepth -= 1;
        if (rendered.kind !== "node" && rendered.kind !== "any") this.typeError("A component must return JSX", item.span);
      } else {
        this.analyzeStatement(item);
      }
    }
    if (renders !== 1) this.diagnostics.push(diagnostic("VEL5008", `Component '${statement.name}' must have exactly one top-level return`, statement.span));
    if (mounted > 1) this.diagnostics.push(diagnostic("VEL5009", `Component '${statement.name}' has more than one mounted block`, statement.span));
    if (cleanup > 1) this.diagnostics.push(diagnostic("VEL5010", `Component '${statement.name}' has more than one cleanup block`, statement.span));
    this.componentStates = previousStates;
    this.flowFrameDepth -= 1;
    this.exitScope();
    this.classInitDepth = outerClassInitDepth;
  }

  private inferJsx(expression: Extract<Expression, { kind: "JSXElementExpression" }>, controlHandled = false): ValueType {
    const attributes = new Map(expression.attributes.map((attribute) => [attribute.name, attribute]));
    const controls = expression.attributes.filter((attribute) => jsxControlAttributes.has(attribute.name));
    if (attributes.size !== expression.attributes.length) {
      this.diagnostics.push(diagnostic("VEL5014", `JSX element '${expression.tag}' has duplicate attributes`, expression.span));
    }
    if (controls.length > 1) {
      this.diagnostics.push(diagnostic("VEL5029", "A JSX branch can have only one of 'if', 'else-if', or 'else'", expression.span));
    }
    if (!controlHandled && controls.length > 0) {
      this.diagnostics.push(diagnostic("VEL5029", `JSX '${controls[0]!.name}' must be part of an adjacent child branch sequence`, controls[0]!.span));
    }
    if (expression.tag && !/^[A-Z]/u.test(expression.tag)) {
      for (const attribute of expression.attributes) {
        if (!jsxControlAttributes.has(attribute.name)) this.analyzeNativeJsxAttribute(expression, attribute);
      }
      if (attributes.has("unsafe:html") && expression.children.length > 0) {
        this.diagnostics.push(diagnostic("VEL5015", "unsafe:html cannot be combined with JSX children", expression.span));
      }
      if (expression.tag === "img" && !attributes.has("alt")) {
        this.diagnostics.push(diagnostic("VEL5016", "An img element requires an alt attribute", expression.span));
      }
      if (expression.tag === "button" && !attributes.has("aria-label") && !attributes.has("aria-labelledby") && !hasAccessibleJsxContent(expression)) {
        this.diagnostics.push(diagnostic("VEL5026", "A button requires text content, aria-label, or aria-labelledby", expression.span));
      }
      if (expression.tag === "svg" && !hasAccessibleSvgName(expression)) {
        this.diagnostics.push(diagnostic("VEL5030", "An svg element requires a non-empty title, aria-label, aria-labelledby, or aria-hidden='true'", expression.span));
      }
      if (expression.tag === "a" && !attributes.has("href")) {
        this.diagnostics.push(diagnostic("VEL5027", "A native anchor requires href; use a button for actions", expression.span));
      }
      const target = attributes.get("target")?.value;
      const relation = attributes.get("rel")?.value;
      if (expression.tag === "a" && target === "_blank" && (typeof relation !== "string" || !relation.split(/\s+/u).includes("noopener"))) {
        this.diagnostics.push(diagnostic("VEL5028", "An anchor with target='_blank' requires rel='noopener'", expression.span));
      }
    }
    for (let index = 0; index < expression.children.length;) {
      const child = expression.children[index]!;
      if (child.kind === "JSXExpressionChild") {
        const childType = this.inferExpression(child.expression);
        if (containsPromise(this.expandAliases(childType))) {
          this.diagnostics.push(diagnostic("VEL5031", "JSX cannot render a Promise; await it before rendering", child.expression.span));
        }
        const list = jsxMapExpression(child.expression);
        if (list && !list.body.attributes.some((attribute) => attribute.name === "key")) {
          this.diagnostics.push(diagnostic("VEL5017", "A JSX list rendered with .map() requires a key on its root element", list.body.span));
        }
        index += 1;
      }
      else if (child.kind === "JSXText") {
        index += 1;
      }
      else {
        const control = child.attributes.find((attribute) => jsxControlAttributes.has(attribute.name));
        if (control?.name === "if") {
          let rejected = this.inferJsxConditionalBranch(child, control);
          let cursor = index + 1;
          let sawElse = false;
          while (cursor < expression.children.length) {
            const next = expression.children[cursor]!;
            if (next.kind === "JSXText" && next.value.trim().length === 0) {
              cursor += 1;
              continue;
            }
            if (next.kind !== "JSXElementExpression") break;
            const nextControl = next.attributes.find((attribute) => jsxControlAttributes.has(attribute.name));
            if (!nextControl || (nextControl.name !== "else-if" && nextControl.name !== "else") || sawElse) break;
            rejected = this.inferJsxConditionalBranch(next, nextControl, rejected);
            sawElse = nextControl.name === "else";
            cursor += 1;
          }
          index = cursor;
        } else if (control) {
          this.diagnostics.push(diagnostic("VEL5029", `JSX '${control.name}' requires an adjacent preceding 'if' branch`, control.span));
          this.inferJsxConditionalBranch(child, control);
          index += 1;
        } else {
          this.inferJsx(child);
          index += 1;
        }
      }
    }
    if (/^[A-Z]/u.test(expression.tag)) {
      const binding = this.lookup(expression.tag);
      if (!binding || binding.type.kind !== "componentConstructor") {
        this.diagnostics.push(diagnostic("VEL5011", `Unknown component '${expression.tag}'`, expression.span));
        return { kind: "node" };
      }
      const provided = new Set(expression.attributes.filter((attribute) => attribute.name !== "key" && !jsxControlAttributes.has(attribute.name)).map((attribute) => attribute.name));
      const hasChildren = expression.children.some((child) => child.kind !== "JSXText" || child.value.trim().length > 0);
      if (hasChildren && provided.has("children")) {
        this.diagnostics.push(diagnostic("VEL5014", `Component '${expression.tag}' receives children both as a prop and as JSX content`, expression.span));
      } else if (hasChildren && !binding.type.props.has("children")) {
        this.diagnostics.push(diagnostic("VEL5018", `Component '${expression.tag}' does not declare JSX children`, expression.span));
      } else if (hasChildren) {
        provided.add("children");
        this.requireAssignable({ kind: "node" }, binding.type.props.get("children")!, expression.span);
      }
      for (const required of binding.type.requiredProps) if (!provided.has(required)) this.diagnostics.push(diagnostic("VEL5012", `Component '${expression.tag}' requires prop '${required}'`, expression.span));
      for (const attribute of expression.attributes) {
        if (jsxControlAttributes.has(attribute.name)) continue;
        if (attribute.name === "key") {
          const key = typeof attribute.value === "string" ? stringType : attribute.value ? this.inferExpression(attribute.value) : boolType;
          if (key.kind !== "string" && key.kind !== "number" && key.kind !== "enum" && key.kind !== "any") this.diagnostics.push(diagnostic("VEL5022", "A JSX key must be a string, string-backed enum, or number", attribute.span));
          continue;
        }
        const expected = binding.type.props.get(attribute.name);
        if (!expected) {
          this.diagnostics.push(diagnostic("VEL5013", `Component '${expression.tag}' has no prop '${attribute.name}'`, attribute.span));
          continue;
        }
        this.semanticJsxAttributeOwners.set(`${attribute.span.start}:${attribute.name}`, {
          ...binding.type,
          name: expression.tag,
        });
        const actual = typeof attribute.value === "string" ? stringType : attribute.value ? this.inferExpression(attribute.value) : boolType;
        if (binding.type.intrinsic === "web.router" && attribute.name === "fallback"
          && actual.kind !== "none" && actual.kind !== "any") {
          this.checkRouteComponent(actual, attribute.span, "A Router fallback");
        }
        this.requireAssignable(actual, expected, attribute.span);
      }
    }
    return { kind: "node" };
  }

  private checkRouteComponent(type: ValueType, span: Span, subject: string): void {
    if (type.kind !== "componentConstructor") {
      if (type.kind !== "any") this.typeError(`${subject} requires a component, received ${describeType(type)}`, span);
      return;
    }
    const unsupported = [...type.requiredProps].filter((name) => name !== "route");
    if (unsupported.length > 0) {
      this.typeError(`${subject} component cannot require props other than route: ${unsupported.join(", ")}`, span);
    }
    const routeProp = type.props.get("route");
    if (routeProp && !isAssignable({ kind: "named", name: "RouteContext" }, routeProp, this)) {
      this.typeError(`${subject} component's route prop must accept RouteContext, received ${describeType(routeProp)}`, span);
    }
  }

  private checkRoutePath(path: string, span: Span): void {
    if (!path.startsWith("/")) this.typeError("A route path must start with '/'", span);
    if (path.includes("?") || path.includes("#")) this.typeError("A route path describes only a pathname; read query and hash from RouteContext", span);
    if (path.includes("\\")) this.typeError("A route path cannot contain a backslash", span);
    if (path.length > 1 && path.endsWith("/")) this.typeError("A route path cannot end with '/'; matching already accepts one trailing slash", span);
    const segments = path.split("/").slice(1);
    const parameters = new Set<string>();
    for (const [index, segment] of segments.entries()) {
      if (segment.length === 0 && path !== "/") this.typeError("A route path cannot contain an empty segment", span);
      if (segment === "*") {
        if (index !== segments.length - 1) this.typeError("A route wildcard must be the final segment", span);
        if (parameters.has("wildcard")) this.typeError("A route parameter named 'wildcard' conflicts with the '*' capture", span);
        parameters.add("wildcard");
        continue;
      }
      if (segment.includes("*")) this.typeError("A route wildcard must occupy its whole final segment", span);
      if (!segment.startsWith(":")) continue;
      const name = segment.slice(1);
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/u.test(name)) this.typeError("A route parameter requires a valid name", span);
      else if (parameters.has(name)) this.typeError(`Route parameter '${name}' is repeated`, span);
      parameters.add(name);
    }
  }

  private inferJsxConditionalBranch(
    expression: Extract<Expression, { kind: "JSXElementExpression" }>,
    control: Extract<Expression, { kind: "JSXElementExpression" }>["attributes"][number],
    inherited: ReadonlyMap<string, ValueType> = new Map(),
  ): ReadonlyMap<string, ValueType> {
    this.enterScope();
    this.applyNarrowings(inherited, expression.span);
    if (control.name === "else") {
      if (control.value !== null) this.diagnostics.push(diagnostic("VEL5029", "JSX 'else' does not accept a value", control.span));
      this.inferJsx(expression, true);
      this.exitScope();
      return inherited;
    }
    if (control.value === null || typeof control.value === "string") {
      this.diagnostics.push(diagnostic("VEL5029", `JSX '${control.name}' requires an expression value`, control.span));
      this.inferJsx(expression, true);
      this.exitScope();
      return inherited;
    }
    const condition = this.inferExpression(control.value);
    this.requireCondition(condition, control.value);
    const narrowed = this.narrowingFor(control.value, condition);
    this.enterScope();
    this.applyNarrowings(narrowed, expression.span);
    this.inferJsx(expression, true);
    this.exitScope();
    const rejected = new Map(inherited);
    for (const [key, type] of this.negativeNarrowingFor(control.value)) rejected.set(key, type);
    this.exitScope();
    return rejected;
  }

  private analyzeNativeJsxAttribute(expression: Extract<Expression, { kind: "JSXElementExpression" }>, attribute: Extract<Expression, { kind: "JSXElementExpression" }>["attributes"][number]): void {
    const value = attribute.value;
    const eventName = attribute.name.startsWith("on:") ? attribute.name.slice(3).split(".")[0] ?? "" : "";
    const expectedEvent = eventName ? webEventType(eventName) : null;
    const eventHandlerType: ValueType | null = expectedEvent ? {
      kind: "function",
      parameters: [expectedEvent],
      requiredParameters: 1,
      result: unknownType,
    } : null;
    const inferred = typeof value === "string"
      ? stringType
      : value
        ? this.inferExpression(value, eventHandlerType ?? unknownType)
        : boolType;
    if (attribute.name === "bind:value") {
      if (!value || typeof value === "string" || value.kind !== "IdentifierExpression"
        || (!this.componentStates?.has(value.name) && this.reactiveBindings.get(value.name) !== "state")) {
        this.diagnostics.push(diagnostic("VEL5019", "bind:value requires a writable state name", attribute.span));
      } else {
        if (!["input", "textarea", "select"].includes(expression.tag)) {
          this.diagnostics.push(diagnostic("VEL5019", `bind:value is not valid on <${expression.tag}>`, attribute.span));
        }
        const numeric = expression.tag === "input" && expression.attributes.some((item) => item.name === "type" && item.value === "number");
        this.requireAssignable(inferred, numeric ? numberType : stringType, attribute.span);
        if (!numeric && inferred.kind === "enum") this.enumValueBindings.set(attribute.span.start, inferred.name);
      }
    } else if (attribute.name === "bind:checked") {
      if (!value || typeof value === "string" || value.kind !== "IdentifierExpression"
        || (!this.componentStates?.has(value.name) && this.reactiveBindings.get(value.name) !== "state")) {
        this.diagnostics.push(diagnostic("VEL5019", "bind:checked requires a writable state name", attribute.span));
      } else {
        if (expression.tag !== "input") this.diagnostics.push(diagnostic("VEL5019", `bind:checked is not valid on <${expression.tag}>`, attribute.span));
        this.requireAssignable(inferred, boolType, attribute.span);
      }
    } else if (attribute.name === "ref") {
      if (!value || typeof value === "string" || value.kind !== "IdentifierExpression" || !this.lookup(value.name)?.mutable) {
        this.diagnostics.push(diagnostic("VEL5020", "ref requires a mutable let binding", attribute.span));
      } else {
        const bindingType = this.lookup(value.name)!.type;
        const target = nonOptional(bindingType);
        const expected = expression.tag === "canvas"
          ? "CanvasElement"
          : expression.tag === "dialog"
            ? "DialogElement"
            : ["input", "select", "textarea"].includes(expression.tag)
              ? "InputElement"
              : "Element";
        if (bindingType.kind !== "any" && bindingType.kind !== "optional") {
          this.diagnostics.push(diagnostic("VEL5024", `A <${expression.tag}> ref requires ${expected}? or Element? so cleanup can restore none`, attribute.span));
        } else if (target.kind !== "any" && (target.kind !== "named" || (target.name !== expected && target.name !== "Element"))) {
          this.diagnostics.push(diagnostic("VEL5024", `A <${expression.tag}> ref requires ${expected}? or Element?`, attribute.span));
        }
      }
    } else if (attribute.name.startsWith("on:")) {
      const [event, ...modifiers] = attribute.name.slice(3).split(".");
      const supported = new Set(["prevent", "stop", "once", "capture", "self"]);
      if (!event) this.diagnostics.push(diagnostic("VEL5025", "An event directive requires an event name", attribute.span));
      for (const modifier of modifiers) {
        if (!supported.has(modifier)) this.diagnostics.push(diagnostic("VEL5025", `Unknown event modifier '${modifier}'`, attribute.span));
      }
      if (new Set(modifiers).size !== modifiers.length) this.diagnostics.push(diagnostic("VEL5025", "Event modifiers cannot be repeated", attribute.span));
      if (inferred.kind !== "function" && inferred.kind !== "action" && inferred.kind !== "intrinsic" && inferred.kind !== "any" && inferred.kind !== "unknown") {
        this.diagnostics.push(diagnostic("VEL5021", `Event '${event}' requires a function`, attribute.span));
      } else if (inferred.kind === "function" || inferred.kind === "action" || inferred.kind === "intrinsic") {
        if (inferred.rest || inferred.parameters.length > 1) {
          this.diagnostics.push(diagnostic("VEL5021", `Event '${event}' handlers accept zero parameters or one ${describeType(expectedEvent ?? { kind: "named", name: "Event" })} parameter`, attribute.span));
        } else if (inferred.parameters.length === 1 && expectedEvent && !isAssignable(expectedEvent, inferred.parameters[0]!, this)) {
          this.diagnostics.push(diagnostic("VEL5021", `Event '${event}' provides ${describeType(expectedEvent)}, not ${describeType(inferred.parameters[0]!)}`, attribute.span));
        }
      }
    } else if (attribute.name.startsWith("class:")) {
      this.requireAssignable(inferred, boolType, attribute.span);
    } else if (attribute.name === "key") {
      if (inferred.kind !== "string" && inferred.kind !== "number" && inferred.kind !== "enum" && inferred.kind !== "any") {
        this.diagnostics.push(diagnostic("VEL5022", "A JSX key must be a string, string-backed enum, or number", attribute.span));
      }
    }
    if (attribute.name.startsWith("on:click") && !["button", "a", "input", "select", "textarea", "summary"].includes(expression.tag)
      && !expression.attributes.some((item) => item.name === "role")) {
      this.diagnostics.push(diagnostic("VEL5023", `Clickable <${expression.tag}> requires an explicit role`, expression.span));
    }
  }

  private externFunctionType(
    statement: ExternFunctionDeclaration,
    resolve: (reference: TypeReference | null) => ValueType = (reference) => this.resolveAnnotation(reference),
  ): ValueType {
    const result = statement.returnType ? resolve(statement.returnType) : noneType;
    const rest = statement.parameters.find((parameter) => parameter.rest);
    return {
      kind: "function",
      parameters: statement.parameters.filter((parameter) => !parameter.rest).map((parameter) => resolve(parameter.type)),
      requiredParameters: statement.parameters.filter((parameter) => !parameter.rest && !parameter.defaultValue).length,
      ...(rest ? { rest: resolve(rest.type) } : {}),
      result: statement.asynchronous ? { kind: "promise", value: this.resolvedAsyncResult(result) } : result,
    };
  }

  private externConstantType(statement: ExternConstantDeclaration): ValueType {
    return this.resolveAnnotation(statement.type);
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
      if (type.kind === "list") return { kind: "list", element: resolve(type.element) };
      if (type.kind === "set") return { kind: "set", element: resolve(type.element) };
      if (type.kind === "map") return { kind: "map", key: resolve(type.key), value: resolve(type.value) };
      if (type.kind === "promise") return { kind: "promise", value: resolve(type.value) };
      if (type.kind === "object") return { kind: "object", fields: new Map([...type.fields].map(([name, value]) => [name, resolve(value)])) };
      if (type.kind === "function" || type.kind === "action" || type.kind === "intrinsic") return {
        ...type,
        parameters: type.parameters.map(resolve),
        ...(type.rest ? { rest: resolve(type.rest) } : {}),
        result: resolve(type.result),
      };
      if (type.kind === "union") return { kind: "union", members: type.members.map(resolve) };
      return this.resolveNamedClasses(type);
    };
    return reference ? resolve(this.expandAliases(parseType(reference.text))) : unknownType;
  }

  private importType(statement: Extract<Statement, { kind: "ImportDeclaration" }>, local: string, imported: string, namespace: boolean): ValueType {
    if (!statement.javascript) {
      const type = this.importBindings.get(local) ?? unknownType;
      if (type.kind === "classConstructor" && type.identity) this.classDisplayNames.set(type.identity, local);
      return type;
    }
    if (statement.unsafe) return anyType;
    const declarations = this.externModules.get(statement.source);
    if (namespace) return declarations ? { kind: "object", fields: declarations } : this.importBindings.get(local) ?? unknownType;
    const type = declarations?.get(imported) ?? this.importBindings.get(local) ?? unknownType;
    if (type.kind === "classConstructor" && type.identity) {
      this.classDisplayNames.set(type.identity, local);
      return { ...type, name: local };
    }
    return type;
  }

  private narrowingFor(expression: Expression, knownType?: ValueType): ReadonlyMap<string, ValueType> {
    return this.conditionNarrowing(expression, true, knownType);
  }

  private negativeNarrowingFor(expression: Expression): ReadonlyMap<string, ValueType> {
    return this.conditionNarrowing(expression, false);
  }

  private conditionNarrowing(expression: Expression, truthy: boolean, knownType?: ValueType): ReadonlyMap<string, ValueType> {
    const narrowed = new Map<string, ValueType>();
    if (expression.kind === "UnaryExpression" && expression.operator === "not") {
      return this.conditionNarrowing(expression.operand, !truthy);
    }
    if (expression.kind === "BinaryExpression" && (expression.operator === "==" || expression.operator === "!=")) {
      const leftIsNone = expression.left.kind === "LiteralExpression" && expression.left.value === null;
      const rightIsNone = expression.right.kind === "LiteralExpression" && expression.right.value === null;
      if (leftIsNone !== rightIsNone) {
        const candidate = leftIsNone ? expression.right : expression.left;
        const candidateType = this.inferExpression(candidate);
        if (candidateType.kind === "optional") {
          const equalToNone = expression.operator === "==" ? truthy : !truthy;
          this.addLocationNarrowing(narrowed, candidate, equalToNone ? noneType : candidateType.inner);
        }
      }
      return narrowed;
    }
    if (expression.kind === "IdentifierExpression") {
      const type = this.lookup(expression.name)?.type;
      if (type?.kind === "optional") {
        narrowed.set(expression.name, truthy ? type.inner : noneType);
      }
    } else if (expression.kind === "MemberExpression" && !expression.optional) {
      const path = this.stableMemberAccessPath(expression);
      const type = knownType ?? this.inferExpression(expression);
      if (path && type.kind === "optional") narrowed.set(`${memberNarrowingPrefix}${path}`, truthy ? type.inner : noneType);
    } else if (expression.kind === "IsExpression") {
      const checked = this.resolveAnnotation(expression.type);
      if (truthy) {
        this.addLocationNarrowing(narrowed, expression.value, checked);
      } else {
        const current = expression.value.kind === "IdentifierExpression"
          ? this.lookup(expression.value.name)?.type
          : this.inferExpression(expression.value);
        const remaining = current ? this.excludeCheckedType(current, checked) : null;
        if (remaining) this.addLocationNarrowing(narrowed, expression.value, remaining);
      }
    }
    return narrowed;
  }

  private excludeCheckedType(current: ValueType, checked: ValueType): ValueType | null {
    if (current.kind === "optional") {
      const innerExcluded = isAssignable(current.inner, checked, this);
      const noneExcluded = isAssignable(noneType, checked, this);
      if (innerExcluded && !noneExcluded) return noneType;
      if (noneExcluded && !innerExcluded) return current.inner;
      return null;
    }
    if (current.kind !== "union") return null;
    const remaining = current.members.filter((member) => !isAssignable(member, checked, this));
    return remaining.length > 0 && remaining.length < current.members.length ? unionOf(remaining) : null;
  }

  private addLocationNarrowing(target: Map<string, ValueType>, expression: Expression, type: ValueType): void {
    if (expression.kind === "IdentifierExpression") {
      target.set(expression.name, type);
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
    if (narrowed.size === 0) return this.inferExpression(expression, contextualType);
    this.enterScope();
    this.applyNarrowings(narrowed, expression.span);
    const result = this.inferExpression(expression, contextualType);
    this.exitScope();
    return result;
  }

  private requireCondition(type: ValueType, condition: Expression): void {
    if (type.kind === "optional") this.presenceConditions.add(condition.span.start);
    if (type.kind !== "bool" && type.kind !== "optional" && type.kind !== "any") {
      this.typeError(`Condition must be bool or optional, received ${describeType(type)}`, condition.span);
    }
  }

  private requireAssignable(actual: ValueType, expected: ValueType, valueSpan: Span): void {
    if (!isAssignable(actual, expected, this)) {
      this.typeError(`Cannot assign ${describeType(actual)} to ${describeType(expected)}`, valueSpan);
    }
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
      const values = this.enums.get(type.name)?.members;
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
    if (type.kind === "none" || type.kind === "string" || type.kind === "number" || type.kind === "bool" || type.kind === "enum") return true;
    if (type.kind === "optional") return this.jsonSerializable(type.inner, seen);
    if (type.kind === "list") return this.jsonSerializable(type.element, seen);
    if (type.kind === "union") return this.combineJsonStatuses(type.members.map((member) => this.jsonSerializable(member, seen)));
    if (type.kind === "object") return this.combineJsonStatuses([...type.fields.values()].map((field) => this.jsonSerializable(field, seen)));
    if (type.kind === "named") {
      if (seen.has(type.name)) return true;
      const fields = this.fieldsOf(type.name);
      if (!fields) return false;
      const next = new Set([...seen, type.name]);
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

  private resolveAnnotation(reference: TypeReference | null): ValueType {
    return reference ? this.resolveNamedClasses(this.expandAliases(parseType(reference.text))) : unknownType;
  }

  private resolveResult(reference: TypeReference | null): ValueType {
    return reference ? this.resolveAnnotation(reference) : noneType;
  }

  private resolveNamedClasses(type: ValueType): ValueType {
    if (type.kind === "named" && this.enums.has(type.name)) {
      return { kind: "enum", name: type.name, identity: this.enums.get(type.name)!.identity };
    }
    if (type.kind === "named") {
      const imported = this.lookup(type.name)?.type ?? this.importBindings.get(type.name);
      if (imported?.kind === "classConstructor") {
        return { kind: "class", name: type.name, ...(imported.identity ? { identity: imported.identity } : {}) };
      }
    }
    if (type.kind === "named" && this.classes.has(type.name)) {
      const info = this.classes.get(type.name);
      return { kind: "class", name: type.name, ...(info?.identity ? { identity: info.identity } : {}) };
    }
    if (type.kind === "optional") {
      return optionalOf(this.resolveNamedClasses(type.inner));
    }
    if (type.kind === "list") {
      return { kind: "list", element: this.resolveNamedClasses(type.element) };
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

  private validateType(type: ValueType, typeSpan: Span): void {
    if (type.kind === "any") {
      this.typeError("'any' is reserved for explicit unsafe JavaScript boundaries; use 'unknown' in VelarScript", typeSpan);
    } else if (type.kind === "named" && !this.namedTypes.has(type.name) && !this.classes.has(type.name) && !this.enums.has(type.name) && !primitiveNames.has(type.name)) {
      this.typeError(`Unknown type '${type.name}'`, typeSpan);
    } else if (type.kind === "optional") {
      this.validateType(type.inner, typeSpan);
    } else if (type.kind === "list") {
      this.validateType(type.element, typeSpan);
    } else if (type.kind === "set") {
      this.validateType(type.element, typeSpan);
    } else if (type.kind === "map") {
      this.validateType(type.key, typeSpan);
      this.validateType(type.value, typeSpan);
    } else if (type.kind === "promise") {
      this.validateType(type.value, typeSpan);
    } else if (type.kind === "function" || type.kind === "action" || type.kind === "intrinsic") {
      for (const parameter of type.parameters) this.validateType(parameter, typeSpan);
      if (type.rest) this.validateType(type.rest, typeSpan);
      this.validateType(type.result, typeSpan);
    } else if (type.kind === "union") {
      for (const member of type.members) {
        this.validateType(member, typeSpan);
      }
    }
  }

  private typeError(message: string, errorSpan: Span): void {
    this.diagnostics.push(diagnostic("VEL4001", message, errorSpan));
  }

  private matchLiteralCompatible(matched: ValueType, literal: ValueType): boolean {
    if (matched.kind === "any") return true;
    if (matched.kind === "union") return matched.members.some((member) => this.matchLiteralCompatible(member, literal));
    if (matched.kind === "optional") {
      return literal.kind === "none" || this.matchLiteralCompatible(matched.inner, literal);
    }
    if (matched.kind === "enum") return literal.kind === "enum" && matched.identity === literal.identity;
    return matched.kind === literal.kind
      && (matched.kind === "string" || matched.kind === "number" || matched.kind === "bool" || matched.kind === "none");
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

  private builtin(name: string): Binding | null {
    const functions = new Map<string, ValueType>([
      ["number", { kind: "function", parameters: [stringType], requiredParameters: 1, result: optionalOf(numberType) }],
      ["str", { kind: "function", parameters: [anyType], requiredParameters: 1, result: stringType }],
      ["print", { kind: "function", parameters: [anyType], requiredParameters: 1, result: noneType }],
      ["mount", { kind: "function", parameters: [{ kind: "node" }, anyType], requiredParameters: 2, result: noneType }],
      ["tick", { kind: "function", parameters: [], requiredParameters: 0, result: { kind: "promise", value: noneType } }],
    ]);
    const type = functions.get(name)
      ?? (name === "Error" ? { kind: "classConstructor", name: "Error" } satisfies ValueType : null)
      ?? (name === "Map" || name === "Set" ? anyType : null);
    return type ? { mutable: false, type, declaredType: type, span: { start: 0, end: 0 }, narrowingFrame: null } : null;
  }

  private declareBinding(name: string, mutable: boolean, type: ValueType, declarationSpan: Span, internal = false): void {
    if (!internal && reservedBindings.has(name)) {
      this.diagnostics.push(diagnostic("VEL3007", `'${name}' is a reserved Core binding`, declarationSpan));
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
    scope.set(name, { mutable, type, declaredType: type, span: declarationSpan, narrowingFrame: null });
    this.recordSemanticBinding(`${declarationSpan.start}:${name}`, type);
  }

  private recordSemanticBinding(key: string, type: ValueType): void {
    this.semanticBindingTypes.set(key, type);
    this.semanticBindingMembers.set(key, this.semanticMembersOf(type));
  }

  private semanticMembersOf(original: ValueType): ReadonlyMap<string, ValueType> {
    const privateContext = this.privateSemanticContext(original);
    const typeKey = original.kind === "class" || original.kind === "classConstructor"
      ? `${original.kind}:${original.identity ?? original.name}:private:${privateContext ?? ""}`
      : `${original.kind}:${describeType(original)}`;
    const key = `${typeKey}:private:${privateContext ?? ""}`;
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
    if (type.kind === "list") return new Map(["length", "get", "slice", "append", "extend", "remove", "clear", "map", "filter", "reduce"]
      .map((name) => [name, this.listMember(type, name)]));
    if (type.kind === "map") return new Map(["size", "get", "set", "has", "remove", "clear", "keys", "values", "entries"]
      .map((name) => [name, this.mapMember(type, name)]));
    if (type.kind === "set") return new Map(["size", "add", "has", "remove", "clear", "values"]
      .map((name) => [name, this.setMember(type, name)]));
    if (type.kind === "action") return new Map([
      ["pending", boolType],
      ["error", optionalOf({ kind: "class", name: "Error" })],
    ]);
    if (type.kind === "object") return type.fields;
    if (type.kind === "componentConstructor") return type.props;
    if (type.kind === "named") return this.fieldsOf(type.name) ?? new Map();
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
    if (type.kind === "list") return { kind: "list", element: this.displayExternalClasses(type.element) };
    if (type.kind === "set") return { kind: "set", element: this.displayExternalClasses(type.element) };
    if (type.kind === "map") return { kind: "map", key: this.displayExternalClasses(type.key), value: this.displayExternalClasses(type.value) };
    if (type.kind === "promise") return { kind: "promise", value: this.displayExternalClasses(type.value) };
    if (type.kind === "object") return { kind: "object", fields: new Map([...type.fields].map(([name, value]) => [name, this.displayExternalClasses(value)])) };
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

    const fields = type.kind === "object" ? type.fields : type.kind === "named" ? this.fieldsOf(type.name) : null;
    if (!fields && type.kind !== "any") {
      this.typeError(`Cannot object-destructure ${describeType(type)}`, pattern.span);
    }
    const selected = new Set<string>();
    for (const entry of pattern.entries) {
      selected.add(entry.property);
      if (type.kind === "named" && fields?.has(entry.property)) {
        this.semanticBindingEntryOwners.set(`${entry.span.start}:${entry.property}`, type);
      }
      const field = fields?.get(entry.property) ?? (type.kind === "any" ? anyType : unknownType);
      if (fields && !fields.has(entry.property)) this.typeError(`Object has no field '${entry.property}'`, entry.span);
      this.declarePattern(entry.pattern, mutable, field);
    }
    if (pattern.rest) {
      const remaining = new Map<string, ValueType>();
      for (const [name, field] of fields ?? []) if (!selected.has(name)) remaining.set(name, field);
      this.declareBinding(pattern.rest.name, mutable, type.kind === "any" ? anyType : { kind: "object", fields: remaining }, pattern.rest.span);
    }
  }

  private lookup(name: string): Binding | null {
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

  private applyNarrowings(narrowed: ReadonlyMap<string, ValueType>, narrowingSpan: Span): void {
    const memberScope = this.memberNarrowings.at(-1)!;
    for (const [key, type] of narrowed) {
      if (key.startsWith(memberNarrowingPrefix)) {
        memberScope.set(key.slice(memberNarrowingPrefix.length), { type, frame: this.flowFrameDepth });
      } else {
        const binding = this.lookup(key);
        this.scopes.at(-1)!.set(key, {
          mutable: binding?.mutable ?? false,
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
    return base ? `${base}.${expression.property}` : null;
  }

  private lookupMemberNarrowing(path: string): ValueType | null {
    for (let index = this.memberNarrowings.length - 1; index >= 0; index -= 1) {
      const narrowing = this.memberNarrowings[index]?.get(path);
      if (narrowing && narrowing.frame === this.flowFrameDepth) return narrowing.type;
    }
    return null;
  }

  private enterScope(): void {
    this.scopes.push(new Map());
    this.memberNarrowings.push(new Map());
  }

  private exitScope(): void {
    this.scopes.pop();
    this.memberNarrowings.pop();
  }
}

function webTypeFields(name: string): ReadonlyMap<string, ValueType> | null {
  const functionType = (parameters: readonly ValueType[], result: ValueType): ValueType => ({ kind: "function", parameters, requiredParameters: parameters.length, result });
  const eventFields = (): Map<string, ValueType> => new Map([
    ["type", stringType],
    ["defaultPrevented", boolType],
    ["preventDefault", functionType([], noneType)],
    ["stopPropagation", functionType([], noneType)],
  ]);
  if (name === "Event") return eventFields();
  if (name === "KeyboardEvent") return new Map([
    ...eventFields(),
    ["key", stringType],
    ["code", stringType],
    ["repeat", boolType],
    ["altKey", boolType],
    ["ctrlKey", boolType],
    ["metaKey", boolType],
    ["shiftKey", boolType],
  ]);
  if (name === "PointerEvent") return new Map([
    ...eventFields(),
    ["pointerId", numberType],
    ["pointerType", stringType],
    ["pressure", numberType],
    ["button", numberType],
    ["buttons", numberType],
    ["clientX", numberType],
    ["clientY", numberType],
    ["movementX", numberType],
    ["movementY", numberType],
    ["altKey", boolType],
    ["ctrlKey", boolType],
    ["metaKey", boolType],
    ["shiftKey", boolType],
  ]);
  if (name === "InputEvent") return new Map([
    ...eventFields(),
    ["data", optionalOf(stringType)],
    ["inputType", stringType],
    ["isComposing", boolType],
  ]);
  if (name === "Element" || name === "InputElement" || name === "CanvasElement" || name === "DialogElement") {
    const fields = new Map<string, ValueType>([
      ["focus", functionType([], noneType)],
      ["remove", functionType([], noneType)],
    ]);
    if (name === "InputElement") {
      fields.set("value", stringType);
      fields.set("checked", boolType);
    }
    if (name === "CanvasElement") {
      fields.set("width", numberType);
      fields.set("height", numberType);
      fields.set("getContext", functionType([stringType], anyType));
    }
    return fields;
  }
  return null;
}

function webEventType(name: string): ValueType {
  if (name === "keydown" || name === "keyup" || name === "keypress") return { kind: "named", name: "KeyboardEvent" };
  if (["click", "pointerdown", "pointerup", "pointermove", "pointercancel", "pointerover", "pointerout", "pointerenter", "pointerleave"].includes(name)) {
    return { kind: "named", name: "PointerEvent" };
  }
  if (name === "beforeinput" || name === "input") return { kind: "named", name: "InputEvent" };
  return { kind: "named", name: "Event" };
}
