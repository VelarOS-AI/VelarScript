/**
 * The predicate a runtime `Type` is: what one value must satisfy to be that
 * type, the generic instance a `Type<T>` is applied at, and the traversal guard
 * a recursive declaration needs so a checker cannot loop.
 *
 * D114 R1c: `emitTypeCheck`, `emitIsCheck` and `emitNarrowingCheck` are still
 * declared on `JavaScriptEmitter` — Web overrides the first two — and forward
 * here.
 */
import type { TypeAliasDeclaration, TypeDeclaration, TypeSyntax, TypeReference } from "../ast.ts";
import {
  describeType,
  formatTypeSyntax,
  mapNestedTypes,
  resolveTypeReference,
  semanticTypeIdentity,
  typeContainsParameter,
  type GenericApplication,
  type ValueType,
} from "../types.ts";
import { type LoweringHints } from "../contracts.ts";
import { VELAR_HOST_ERROR_NAMES } from "../error-runtime.ts";
import { builtinErrorRuntimeNames, javaScriptMemberAccess, maximumStructuralFieldDepth } from "./javascript.ts";

export interface TypeCheckEmitterHost {
  genericTypeBinding(name: string): boolean;
  genericTypeParameters: readonly string[] | null;
  readonly hints: LoweringHints;
  readonly hoistedGenericInstances: Map<string, string>;
  needsAssertionErrorClass: boolean;
  needsCollectionHelpers: boolean;
  needsNarrowingErrorClass: boolean;
  needsRuntimeTypeHelpers: boolean;
  nominalRuntimeReceiver(type: Extract<ValueType, { readonly kind: "class" | "enum" | "enumMember" }>): string | null;
  readonly requiredHostErrorClasses: Set<string>;
  runtimeTypeBinding(name: string): boolean;
  readonly runtimeTypeTraversalGuards: Map<string, boolean>;
  readonly structuralFieldChecks: Set<ValueType>;
  readonly typeDeclarations: Map<string, TypeDeclaration | TypeAliasDeclaration>;
}

export class TypeCheckEmitter {
  private readonly host: TypeCheckEmitterHost;

  constructor(host: TypeCheckEmitterHost) {
    this.host = host;
  }

  emitTypeCheck(type: ValueType, value: string, state = "undefined"): string {
    switch (type.kind) {
      case "unknown":
      case "any":
        return "true";
      case "null":
        return `${value} == null`;
      case "string":
      case "number":
      case "bool":
        return `typeof ${value} === ${JSON.stringify(type.kind === "bool" ? "boolean" : type.kind)}`;
      case "optional":
        return `(${value} == null || ${this.emitTypeCheck(type.inner, value, state)})`;
      case "list":
        return `__velarListTypeIs(${value}, (item) => ${this.emitTypeCheck(type.element, "item", state)})`;
      case "set":
        return `__velarSetTypeIs(${value}, (item) => ${this.emitTypeCheck(type.element, "item", state)})`;
      case "map":
        return `__velarMapTypeIs(${value}, (key, item) => ${this.emitTypeCheck(type.key, "key", state)} && ${this.emitTypeCheck(type.value, "item", state)})`;
      case "record":
        return `__velarRecordTypeIs(${value}, (item) => ${this.emitTypeCheck(type.value, "item", state)})`;
      case "promise":
        return `__velarValidationIsPromise(${value})`;
      case "named":
        // D55 rule 121: an instantiation's validator is the declaration's,
        // supplied with this application's argument predicates. The factory
        // memoizes, so the object is built once however many times it is asked
        // for — and a recursive record's reference to itself is a memo hit.
        if (type.application && this.host.genericTypeBinding(type.application.name)) {
          this.host.needsRuntimeTypeHelpers = true;
          return `${this.genericInstanceExpression(type.application)}.is(${value}, ${state})`;
        }
        // D77 rule 194 item 2: a class instantiation reaching this branch is a
        // field annotated `Stack<number>`, read out of the declaration syntax
        // before the analyzer canonicalized it. Its check is the class's own,
        // because the arguments are erased — the same answer the `class` branch
        // below gives the canonical form.
        if (type.application && this.host.hints.classNames.has(type.application.name)) {
          return `__velarValidationIsInstance(${value}, ${this.builtinErrorRuntimeName(type.application.name) ?? type.application.name})`;
        }
        if (type.name === "Duration") return `typeof ${value} === "string" && /^[+-]?(?:\\d+(?:\\.\\d+)?|\\.\\d+)(?:ms|s)$/.test(${value})`;
        if (this.host.hints.enumNames.has(type.name)) return `${type.name}.is(${value})`;
        if (this.host.hints.classNames.has(type.name)) {
          return `__velarValidationIsInstance(${value}, ${this.builtinErrorRuntimeName(type.name) ?? type.name})`;
        }
        // An alias of an enum is lowered as the enum object itself, so its
        // check delegates the same way a direct enum name does (ENM-I4).
        if (this.enumAliasTarget(type.name) !== null) return `${type.name}.is(${value})`;
        // `type Alias = RecordType` also lives in typeDeclarations so the
        // emitter can produce its runtime Type binding, but only an actual
        // record declaration owns a `__velarTypeCheck_Name` helper. Aliases
        // delegate through their emitted Type object (`Alias.is`) below.
        if (this.host.typeDeclarations.get(type.name)?.kind === "TypeDeclaration") {
          const check = this.runtimeTypeCheckName(type.name);
          return this.runtimeTypeNeedsTraversalGuard(type.name) ? `${check}(${value}, ${state})` : `${check}(${value})`;
        }
        // D60 rule 148: only a name that actually binds a runtime Type object
        // may be written into the output. See `runtimeTypeBinding`.
        return this.host.runtimeTypeBinding(type.name) ? `${type.name}.is(${value}, ${state})` : "false";
      // D60 rule 148 reaches the nominal kinds too: `class`, `enum`, and
      // `enumMember` carry a display name exactly as `named` does, so a module
      // that never bound the name may not write it. See `nominalRuntimeReceiver`.
      case "class": {
        const receiver = this.host.nominalRuntimeReceiver(type);
        return receiver === null ? "false" : `__velarValidationIsInstance(${value}, ${receiver})`;
      }
      case "enum": {
        const receiver = this.host.nominalRuntimeReceiver(type);
        return receiver === null ? "false" : `${receiver}.is(${value})`;
      }
      case "enumMember": {
        const receiver = this.host.nominalRuntimeReceiver(type);
        return receiver === null ? "false" : `${value} === ${receiver}.${type.member}`;
      }
      case "union":
        return `(${type.members.map((member) => this.emitTypeCheck(member, value, state)).join(" || ")})`;
      case "object":
        return this.emitObjectTypeCheck(type, value, (field, read) => this.emitTypeCheck(field, read, state));
      case "function":
      case "action":
      case "intrinsic":
        return `typeof ${value} === "function"`;
      // D55 rule 121: inside a generic record's own validator a type parameter
      // is not unknowable — the instantiation handed in the predicate for it.
      case "parameter":
        return this.host.genericTypeParameters?.length
          ? `__velarArguments.checks[${type.index}](${value}, ${state === "undefined" ? "__velarValidationState()" : state})`
          : "false";
      case "typeObject":
      case "runtimeType":
      case "enumObject":
      case "classConstructor":
      case "extension":
        // Static Type<T> carriers are erased; the analyzer rejects them in any
        // recursively runtime-checked position before emission can happen.
        return "false";
    }
  }

  emitIsCheck(type: ValueType, value: string): string {
    if (type.kind === "named" && type.name === "Duration") return `typeof ${value} === "string" && /^[+-]?(?:\\d+(?:\\.\\d+)?|\\.\\d+)(?:ms|s)$/.test(${value})`;
    // D60 rule 148: a name with no runtime Type object behind it is not a
    // callable receiver, so the check falls through to the structural form
    // instead of naming a binding that does not exist.
    return type.kind === "named" && this.host.runtimeTypeBinding(type.name)
      ? `${type.name}.is(${value})`
      : this.emitTypeCheck(type, value);
  }

  emitNarrowingCheck(type: ValueType, value: string, state = "undefined"): string {
    switch (type.kind) {
      case "optional":
        return `(${value} == null || ${this.emitNarrowingCheck(type.inner, value, state)})`;
      case "list":
        return `__velarListTypeIs(${value}, (item) => ${this.emitNarrowingCheck(type.element, "item", state)})`;
      case "set":
        return `__velarSetTypeIs(${value}, (item) => ${this.emitNarrowingCheck(type.element, "item", state)})`;
      case "map":
        return `__velarMapTypeIs(${value}, (key, item) => ${this.emitNarrowingCheck(type.key, "key", state)} && ${this.emitNarrowingCheck(type.value, "item", state)})`;
      case "record":
        return `__velarRecordTypeIs(${value}, (item) => ${this.emitNarrowingCheck(type.value, "item", state)})`;
      case "union":
        return `(${type.members.map((member) => this.emitNarrowingCheck(member, value, state)).join(" || ")})`;
      case "named":
        // FLW-U1: an imported record type (or alias) is not in this module's
        // typeDeclarations, but its runtime Type object is an in-scope
        // binding, so the recheck routes through `Name.is(value)` exactly as
        // `is` tests already do. Only names with no runtime Type binding at
        // all — extension host types such as DOM interfaces — degrade to the
        // presence-only check.
        if (type.application && this.host.genericTypeBinding(type.application.name)) return this.emitTypeCheck(type, value, state);
        if (type.application && this.host.hints.classNames.has(type.application.name)) return this.emitTypeCheck(type, value, state);
        if (!this.host.runtimeTypeBinding(type.name)) return `${value} != null`;
        return this.emitTypeCheck(type, value, state);
      // The same degradation for the nominal kinds. A recheck the module cannot
      // spell is presence-only rather than a refusal, because a narrowing
      // recheck is the caller's own recursion (`emitTypeCheck` would answer
      // "false" and turn a correct program into a NarrowingError). The reported
      // type text is unaffected: `__velarNarrow` is handed a string literal,
      // not a binding.
      case "class":
      case "enum":
      case "enumMember":
        return this.host.nominalRuntimeReceiver(type) === null ? `${value} != null` : this.emitTypeCheck(type, value, state);
      case "object":
        return this.emitObjectTypeCheck(type, value, (field, read) => this.emitNarrowingCheck(field, read, state));
      case "parameter":
      case "typeObject":
      case "runtimeType":
      case "enumObject":
      case "classConstructor":
      case "extension":
        return `${value} != null`;
      default:
        return this.emitTypeCheck(type, value, state);
    }
  }

  /**
   * Charter section 5: a record proves its fields, not merely its presence. A
   * declared record answers through the deep validator its declaration emits;
   * a structural one has no declaration to hang a function on, so the same
   * evidence is spelled inline as one expression over the field table the type
   * already carries. `check` is the caller's own recursion, so a narrowing
   * recheck keeps degrading a field it cannot prove rather than refusing it.
   *
   * The expansion is bounded, because an expression cannot recurse the way a
   * generated function can: a structural type already being expanded, or one
   * nested deeper than `maximumStructuralFieldDepth`, falls back to the
   * presence test — the same evidence charter line 1006 allows an erased
   * position. A field whose own check is a constant is dropped from the
   * conjunction for the same reason: `false` there would refuse a value the
   * language cannot inspect, and `true` proves nothing worth emitting.
   */
  private emitObjectTypeCheck(
    type: Extract<ValueType, { readonly kind: "object" }>,
    value: string,
    check: (field: ValueType, read: string) => string,
  ): string {
    const presence = `${value} !== null && typeof ${value} === "object"`;
    if (type.fields.size === 0 || this.host.structuralFieldChecks.has(type)
      || this.host.structuralFieldChecks.size >= maximumStructuralFieldDepth) {
      return presence;
    }
    this.host.structuralFieldChecks.add(type);
    try {
      const fields: string[] = [];
      for (const [name, field] of type.fields) {
        const read = `${value}${javaScriptMemberAccess(name)}`;
        const proof = check(field, read);
        if (proof === "true" || proof === "false") continue;
        fields.push(type.optionalFields?.has(name) ? `(${read} === undefined || ${proof})` : proof);
      }
      return fields.length === 0 ? presence : `(${presence} && ${fields.join(" && ")})`;
    } finally {
      this.host.structuralFieldChecks.delete(type);
    }
  }

  runtimeTypeCheckName(name: string): string {
    return `__velarTypeCheck_${name}`;
  }

  /** The instantiation a `named` application stands for, as a JavaScript expression. */
  genericInstanceExpression(application: GenericApplication): string {
    const keys = application.arguments.map((argument) => this.genericArgumentExpression(argument, "key"));
    const texts = application.arguments.map((argument) => this.genericArgumentExpression(argument, "text"));
    const checks = application.arguments.map((argument) => `(value, __state) => ${this.emitTypeCheck(argument, "value", "__state")}`);
    const expression = `${application.name}.of([${keys.join(", ")}], [${texts.join(", ")}], [${checks.join(", ")}])`;
    // Outside a generic body the arguments are closed, so the whole
    // instantiation is hoisted into one memoized function: a `function`
    // declaration, which hoists past the temporal dead zone a `const` would
    // create for `type Boxed = Box<string>` written above the declaration.
    if (this.host.genericTypeParameters?.length) return expression;
    const hoisted = this.host.hoistedGenericInstances.get(expression)
      ?? `__velarTypeOf${this.host.hoistedGenericInstances.size}`;
    this.host.hoistedGenericInstances.set(expression, hoisted);
    return `${hoisted}()`;
  }

  /**
   * A type argument's memo key or display text. Both are plain strings when the
   * argument is closed; inside a generic body a mention of the enclosing
   * parameters reads them off the arguments the instantiation supplied, so
   * `type Wrapper<T>: inner: Box<List<T>>` keys and prints correctly at every
   * instantiation without the emitter having seen one.
   */
  private genericArgumentExpression(type: ValueType, mode: "key" | "text"): string {
    const parameters = this.host.genericTypeParameters;
    if (!parameters?.length || !typeContainsParameter(type)) {
      return JSON.stringify(mode === "key" ? semanticTypeIdentity(type) : describeType(type));
    }
    const nested = (value: ValueType): string => this.genericArgumentExpression(value, mode);
    const wrap = (prefix: string, parts: readonly string[], suffix: string): string =>
      [JSON.stringify(prefix), ...parts.flatMap((part, index) => index === 0 ? [part] : [JSON.stringify(mode === "key" ? "," : ", "), part]), JSON.stringify(suffix)].join(" + ");
    switch (type.kind) {
      case "parameter":
        return `__velarArguments.${mode === "key" ? "keys" : "texts"}[${type.index}]`;
      case "optional":
        return `${nested(type.inner)} + ${JSON.stringify("?")}`;
      case "list":
        return wrap("List<", [nested(type.element)], ">");
      case "set":
        return wrap("Set<", [nested(type.element)], ">");
      case "map":
        return wrap("Map<", [nested(type.key), nested(type.value)], ">");
      case "record":
        return wrap("Record<", [nested(type.value)], ">");
      case "promise":
        return wrap("Promise<", [nested(type.value)], ">");
      case "named":
        return type.application
          ? wrap(`${type.application.name}<`, type.application.arguments.map(nested), ">")
          : JSON.stringify(mode === "key" ? semanticTypeIdentity(type) : describeType(type));
      case "union":
        return type.members.map(nested).join(` + ${JSON.stringify(mode === "key" ? "|" : " | ")} + `);
      default:
        return JSON.stringify(mode === "key" ? semanticTypeIdentity(type) : describeType(type));
    }
  }

  /**
   * The display text of a field's declared type, as a JavaScript expression.
   * A generic record's `parse` failure names the type the caller instantiated
   * — `field 'value' does not match string`, not `does not match T`.
   */
  typeTextExpression(type: ValueType, syntax: TypeSyntax | null): string {
    return this.host.genericTypeParameters?.length
      ? this.genericArgumentExpression(type, "text")
      : JSON.stringify(syntax ? formatTypeSyntax(syntax) : describeType(type));
  }

  /**
   * A declared type inside a generic record's body. The emitter has no analyzer
   * frame, so the declaration's own parameter names are turned into `parameter`
   * kinds here — the one place the emitter learns that `T` is erased rather
   * than unknown.
   */
  resolveDeclarationType(reference: TypeReference): ValueType {
    const parameters = this.host.genericTypeParameters;
    const resolved = resolveTypeReference(reference);
    if (!parameters?.length) return resolved;
    const bindParameters = (type: ValueType): ValueType => {
      if (type.kind === "named" && !type.application) {
        const index = parameters.indexOf(type.name);
        if (index >= 0) return { kind: "parameter", name: type.name, index };
      }
      return mapNestedTypes(type, bindParameters);
    };
    return bindParameters(resolved);
  }

  /** The Type object expression for a source-visible record name or application. */
  runtimeTypeObjectExpression(type: ValueType): string | null {
    if (type.kind !== "named") return null;
    if (type.application && this.host.genericTypeBinding(type.application.name)) {
      return this.genericInstanceExpression(type.application);
    }
    return this.host.runtimeTypeBinding(type.name) ? type.name : null;
  }

  /**
   * Acyclic declared type graphs have a statically bounded walk, even when the
   * JavaScript data itself contains a cycle: every recursive check consumes one
   * layer of the finite type. Only a declaration cycle, an erased generic, or
   * an imported runtime Type needs the shared WeakMap/Set traversal guard.
   */
  runtimeTypeNeedsTraversalGuard(name: string): boolean {
    const cached = this.host.runtimeTypeTraversalGuards.get(name);
    if (cached !== undefined) return cached;
    const guarded = this.declarationNeedsTraversalGuard(name, []);
    this.host.runtimeTypeTraversalGuards.set(name, guarded);
    return guarded;
  }

  private declarationNeedsTraversalGuard(name: string, visiting: readonly string[]): boolean {
    if (visiting.includes(name)) return true;
    const declaration = this.host.typeDeclarations.get(name);
    if (!declaration) return true;
    if (declaration.kind === "TypeDeclaration" && (declaration.typeParameters?.length ?? 0) > 0) return true;
    const path = [...visiting, name];
    let guarded: boolean;
    if (declaration.kind === "TypeAliasDeclaration") {
      guarded = this.typeNeedsTraversalGuard(resolveTypeReference(declaration.target), path);
    } else {
      const baseGuarded = declaration.base
        ? this.typeNeedsTraversalGuard(resolveTypeReference(declaration.base), path)
        : false;
      const ownFields = new Map(declaration.fields.map((field) => [field.name, resolveTypeReference(field.type)]));
      const fields = this.host.hints.typeDeclarationFields.get(declaration.span.start)
        ?? declaration.fields.map((field) => ({ name: field.name, type: resolveTypeReference(field.type) }));
      guarded = baseGuarded
        || fields.some((field) => this.typeNeedsTraversalGuard(ownFields.get(field.name) ?? field.type, path));
    }
    return guarded;
  }

  private typeNeedsTraversalGuard(type: ValueType, visiting: readonly string[]): boolean {
    switch (type.kind) {
      case "optional": return this.typeNeedsTraversalGuard(type.inner, visiting);
      case "list":
      case "set": return this.typeNeedsTraversalGuard(type.element, visiting);
      case "map": return this.typeNeedsTraversalGuard(type.key, visiting) || this.typeNeedsTraversalGuard(type.value, visiting);
      case "record": return this.typeNeedsTraversalGuard(type.value, visiting);
      case "union": return type.members.some((member) => this.typeNeedsTraversalGuard(member, visiting));
      case "parameter": return true;
      case "named":
        // D77 rule 194 item 2: a class application is a leaf here for the same
        // reason a bare class name is — the check is one instance test, and the
        // erased arguments carry no graph to walk into.
        if (type.application) return !this.host.hints.classNames.has(type.application.name);
        if (type.name === "Duration" || this.host.hints.enumNames.has(type.name) || this.host.hints.classNames.has(type.name)
          || this.enumAliasTarget(type.name) !== null) return false;
        if (this.host.typeDeclarations.has(type.name)) return this.declarationNeedsTraversalGuard(type.name, visiting);
        return this.host.runtimeTypeBinding(type.name);
      case "unknown":
      case "any":
      case "null":
      case "string":
      case "number":
      case "bool":
      case "promise":
      case "object":
      case "class":
      case "enum":
      case "enumMember":
      case "enumObject":
      case "typeObject":
      case "runtimeType":
      case "classConstructor":
      case "function":
      case "action":
      case "intrinsic":
      case "extension":
        return false;
    }
  }

  /** The runtime class behind a nameable builtin error type, marking the runtime it needs. */
  builtinErrorRuntimeName(name: string): string | null {
    if ((VELAR_HOST_ERROR_NAMES as readonly string[]).includes(name)) {
      this.host.requiredHostErrorClasses.add(name);
      return `__Velar${name}`;
    }
    const runtime = builtinErrorRuntimeNames.get(name);
    if (!runtime) return null;
    if (name === "ValidationError") this.host.needsRuntimeTypeHelpers = true;
    else if (name === "AssertionError") this.host.needsAssertionErrorClass = true;
    else if (name === "NarrowingError") this.host.needsNarrowingErrorClass = true;
    else this.host.needsCollectionHelpers = true;
    return runtime;
  }

  /** The enum an alias (or alias chain) resolves to, or null when the name is not an alias of an enum. */
  enumAliasTarget(name: string, seen: readonly string[] = []): string | null {
    if (seen.includes(name)) return null;
    const declaration = this.host.typeDeclarations.get(name);
    if (!declaration || declaration.kind !== "TypeAliasDeclaration") return null;
    const target = resolveTypeReference(declaration.target);
    if (target.kind !== "named") return null;
    if (this.host.hints.enumNames.has(target.name)) return target.name;
    return this.enumAliasTarget(target.name, [...seen, name]);
  }
}
