/**
 * Combining two types: the merge that answers "what covers both", and the
 * generic unifier that solves a signature's type parameters against an
 * argument, substitutes the solution back in, and binds parameters by name.
 *
 * `mergeTypes` is here because it is the operation the unifier is built on —
 * `unifyInto` merges each new solution into the binding it already has — and
 * because merging two types is the same question unification asks, one
 * parameter at a time.
 */
import { classApplicationType, genericApplicationType } from "./display.ts";
import { invalidType, isInvalidType, optionalOf, runtimeTypeValue, sameType, unionOf, unknownType, type CallableType, type GenericApplication, type ValueType } from "./model.ts";
import { isReadonlyView, mutableViewOf, readonlyViewOf } from "./readonly.ts";

export function mergeTypes(left: ValueType, right: ValueType): ValueType {
  if (isInvalidType(left) || isInvalidType(right)) {
    return invalidType;
  }
  // A written `unknown` is data nobody has checked yet, so a merge may not
  // absorb it: absorbing retyped `raw ?? { ... }` as the record's own type and
  // shipped an unvalidated value as a checked one, while the direct assignment
  // `const c: Config = raw` was refused all along. Falling through leaves
  // `unknown | T`, which is assignable to nothing until the value is
  // validated, so the merge is now as fail-closed as `unionOf` already is. The
  // inference seed keeps its absorption — it means "nothing known yet", not
  // "known to be unchecked" — and `restricted`, the recursion placeholder,
  // keeps the exclusion it was given for this same reason.
  if (left.kind === "unknown" && !left.restricted && !left.boundary) {
    return right;
  }
  if (right.kind === "unknown" && !right.restricted && !right.boundary) {
    return left;
  }
  if (sameType(left, right)) {
    return left;
  }
  if ((isReadonlyView(left) || isReadonlyView(right))
    && sameType(mutableViewOf(left), mutableViewOf(right))) {
    return readonlyViewOf(isReadonlyView(left) ? left : right);
  }
  if (left.kind === "optional" && sameType(left.inner, right)) {
    return left;
  }
  if (right.kind === "optional" && sameType(right.inner, left)) {
    return right;
  }
  if (left.kind === "null") {
    return optionalOf(right);
  }
  if (right.kind === "null") {
    return optionalOf(left);
  }
  return unionOf([left, right]);
}

export function typeContainsParameter(
  type: ValueType,
  matches: (parameter: Extract<ValueType, { kind: "parameter" }>) => boolean = () => true,
): boolean {
  switch (type.kind) {
    case "parameter":
      return matches(type);
    case "optional":
      return typeContainsParameter(type.inner, matches);
    case "list":
    case "set":
      return typeContainsParameter(type.element, matches);
    case "map":
      return typeContainsParameter(type.key, matches) || typeContainsParameter(type.value, matches);
    case "record":
      return typeContainsParameter(type.value, matches);
    case "promise":
    case "runtimeType":
      return typeContainsParameter(type.value, matches);
    case "object":
      return [...type.fields.values()].some((field) => typeContainsParameter(field, matches));
    // D55 rule 121: `Box<T>` mentions T as surely as `List<T>` does, so every
    // rule phrased over "does this type still mention a parameter" — erasure
    // refusals, generic-callable unification — sees it without being told.
    case "named":
    case "class":
      return (type.application?.arguments ?? []).some((argument) => typeContainsParameter(argument, matches));
    case "extension":
      return [...type.properties.values(), ...type.arguments].some((value) => typeContainsParameter(value, matches));
    case "function":
    case "action":
    case "intrinsic":
      // A generic callable owns its parameter indexes; they are not free here.
      if (type.typeParameterNames?.length) return false;
      return type.parameters.some((parameter) => typeContainsParameter(parameter, matches))
        || (type.rest ? typeContainsParameter(type.rest, matches) : false)
        || typeContainsParameter(type.result, matches);
    case "union":
      return type.members.some((member) => typeContainsParameter(member, matches));
    default:
      return false;
  }
}

export function substituteTypeParameters(type: ValueType, bindings: readonly (ValueType | null)[]): ValueType {
  switch (type.kind) {
    case "parameter":
      return bindings[type.index] ?? unknownType;
    case "optional":
      return optionalOf(substituteTypeParameters(type.inner, bindings));
    case "list":
    case "set": {
      const element = substituteTypeParameters(type.element, bindings);
      return element === type.element ? type : { ...type, element };
    }
    case "map": {
      const key = substituteTypeParameters(type.key, bindings);
      const value = substituteTypeParameters(type.value, bindings);
      return key === type.key && value === type.value ? type : { ...type, key, value };
    }
    case "record": {
      const value = substituteTypeParameters(type.value, bindings);
      return value === type.value ? type : { ...type, value };
    }
    case "promise": {
      const value = substituteTypeParameters(type.value, bindings);
      return value === type.value ? type : { kind: "promise", value };
    }
    case "runtimeType": {
      const value = substituteTypeParameters(type.value, bindings);
      return value === type.value ? type : { kind: "runtimeType", value };
    }
    case "object":
      return { ...type, fields: new Map([...type.fields].map(([name, value]) => [name, substituteTypeParameters(value, bindings)])) };
    // D55 rule 121: substituting inside an application rebuilds it through the
    // one constructor, so the identity a generic `def` produces for `Box<T>`
    // with `T := string` is the identity the analyzer registered for a written
    // `Box<string>`. Two spellings of one instantiation cannot drift apart.
    case "named": {
      if (!type.application) return type;
      const arguments_ = type.application.arguments.map((argument) => substituteTypeParameters(argument, bindings));
      if (arguments_.every((argument, index) => argument === type.application!.arguments[index])) return type;
      return genericApplicationType(type.application.declaration, type.application.name, arguments_, type.readonlyView === true);
    }
    // D55 rule 120 layer two: the same rebuild for a class instantiation, so
    // `Stack<T>` written inside a generic `def` and `Stack<string>` written as
    // an annotation reach the identity step already agreeing.
    case "class": {
      if (!type.application) return type;
      const arguments_ = type.application.arguments.map((argument) => substituteTypeParameters(argument, bindings));
      if (arguments_.every((argument, index) => argument === type.application!.arguments[index])) return type;
      return classApplicationType(type.application.declaration, type.application.name, arguments_);
    }
    case "extension":
      return {
        ...type,
        properties: new Map([...type.properties].map(([name, value]) => [name, substituteTypeParameters(value, bindings)])),
        arguments: type.arguments.map((argument) => substituteTypeParameters(argument, bindings)),
      };
    case "function":
    case "action":
    case "intrinsic":
      if (type.typeParameterNames?.length) return type;
      return {
        ...type,
        parameters: type.parameters.map((parameter) => substituteTypeParameters(parameter, bindings)),
        ...(type.rest ? { rest: substituteTypeParameters(type.rest, bindings) } : {}),
        result: substituteTypeParameters(type.result, bindings),
      };
    case "union":
      return unionOf(type.members.map((member) => substituteTypeParameters(member, bindings)));
    default:
      return type;
  }
}

export function bindNamedTypeParameters(type: ValueType, parameters: ReadonlyMap<string, ValueType>): ValueType {
  switch (type.kind) {
    case "named": {
      const bound = !type.identity ? parameters.get(type.name) : undefined;
      if (bound) return bound;
      // D55 rule 121: `Box<T>` inside a signature binds T exactly as a bare `T`
      // does; without this the argument stayed a free name and the interface
      // published a different type than the body was checked against.
      return type.application
        ? { ...type, application: { ...type.application, arguments: type.application.arguments.map((argument) => bindNamedTypeParameters(argument, parameters)) } }
        : type;
    }
    case "class":
      return type.application
        ? classApplicationType(
          type.application.declaration,
          type.application.name,
          type.application.arguments.map((argument) => bindNamedTypeParameters(argument, parameters)),
        )
        : type;
    case "optional":
      return optionalOf(bindNamedTypeParameters(type.inner, parameters));
    case "list":
    case "set": {
      const element = bindNamedTypeParameters(type.element, parameters);
      return element === type.element ? type : { ...type, element };
    }
    case "map":
      return { ...type, key: bindNamedTypeParameters(type.key, parameters), value: bindNamedTypeParameters(type.value, parameters) };
    case "record":
      return { ...type, value: bindNamedTypeParameters(type.value, parameters) };
    case "promise":
      return { kind: "promise", value: bindNamedTypeParameters(type.value, parameters) };
    case "runtimeType":
      return { kind: "runtimeType", value: bindNamedTypeParameters(type.value, parameters) };
    case "object":
      return { ...type, fields: new Map([...type.fields].map(([name, value]) => [name, bindNamedTypeParameters(value, parameters)])) };
    case "extension":
      return {
        ...type,
        properties: new Map([...type.properties].map(([name, value]) => [name, bindNamedTypeParameters(value, parameters)])),
        arguments: type.arguments.map((argument) => bindNamedTypeParameters(argument, parameters)),
      };
    case "function":
    case "action":
    case "intrinsic":
      if (type.typeParameterNames?.length) return type;
      return {
        ...type,
        parameters: type.parameters.map((parameter) => bindNamedTypeParameters(parameter, parameters)),
        ...(type.rest ? { rest: bindNamedTypeParameters(type.rest, parameters) } : {}),
        result: bindNamedTypeParameters(type.result, parameters),
      };
    case "union":
      return { kind: "union", members: type.members.map((member) => bindNamedTypeParameters(member, parameters)) };
    default:
      return type;
  }
}

/**
 * D51 item NEW-D3: `unknown` never *binds* a parameter — merging it would erase
 * every concrete actual at the other positions — but the site must still be
 * remembered. A bounded parameter that only `unknown` ever reached is solved to
 * `unknown`, which satisfies no bound; dropping the site silently let `unknown`
 * through every bound and on into the implicit-conversion the bound forbids.
 * Callers that check bounds pass this sink; the rest may ignore it.
 */
export function unifyTypeParameters(
  pattern: ValueType,
  actual: ValueType,
  bindings: (ValueType | null)[],
  fieldsOf: (identity: string) => ReadonlyMap<string, ValueType> | null = () => null,
  unknownParameters?: Set<number>,
  expandAliases: (type: ValueType) => ValueType = (type) => type,
): void {
  unifyInto(pattern, actual, bindings, fieldsOf, unknownParameters, expandAliases);
}

/**
 * `readonlyProjection` is the same projection `isAssignable` performs when it
 * checks a readonly container (`readonlyViewOf` on the element), carried down
 * to the site that solves a type parameter. Without it `def first<T>(items:
 * readonly List<T>)` over a `readonly List<List<Check>>` solved `T` to the raw
 * mutable element and handed the caller write authority through a read-only
 * view — the widening the concrete, non-generic spelling is refused for. D44
 * keeps the signature legal (an opaque element offers no member to mutate);
 * this makes the call site agree with it.
 */
function unifyInto(
  pattern: ValueType,
  actual: ValueType,
  bindings: (ValueType | null)[],
  fieldsOf: (identity: string) => ReadonlyMap<string, ValueType> | null,
  unknownParameters: Set<number> | undefined,
  expandAliases: (type: ValueType) => ValueType,
  readonlyProjection = false,
): void {
  const unifyTypeParameters = (nextPattern: ValueType, nextActual: ValueType, nextReadonly = readonlyProjection): void =>
    unifyInto(nextPattern, nextActual, bindings, fieldsOf, unknownParameters, expandAliases, nextReadonly);
  const through = (container: ValueType): boolean => readonlyProjection || isReadonlyView(container);
  if (isInvalidType(actual)) return;
  if (pattern.kind === "parameter") {
    if (actual.kind === "unknown") {
      unknownParameters?.add(pattern.index);
      return;
    }
    // D55 rule 121: a solved type argument is the same type argument an
    // annotation writes, and `expandAliases` already canonicalizes those — so
    // `Box<Id>` and `Box<string>` "reach the identity step already agreeing".
    // A binding solved through a `Type<T>` argument is the one that does not
    // arrive pre-expanded: `channel(Answer, capacity=1)` solves T from the
    // runtime-type value `Answer`, which is a `named` alias, not the `string`
    // an annotation would have resolved to. Left unexpanded it made the
    // resulting `Channel<Answer>` nominally distinct from the `Channel<string>`
    // every annotation spelling resolves to — so BOTH spellings were refused
    // and only inference could name the type. Expanding here also keeps the
    // merge honest: `Answer` merged with `string` produced the phantom union
    // `Answer | string` rather than plain `string`.
    const solved = expandAliases(readonlyProjection ? readonlyViewOf(actual) : actual);
    const existing = bindings[pattern.index];
    bindings[pattern.index] = existing ? mergeTypes(existing, solved) : solved;
    return;
  }
  if (pattern.kind === "optional") {
    if (actual.kind === "null") return;
    if (actual.kind === "optional") return unifyTypeParameters(pattern.inner, actual.inner);
    if (actual.kind === "union") {
      const remaining = actual.members.filter((member) => member.kind !== "null");
      if (remaining.length === 0) return;
      return unifyTypeParameters(pattern.inner, unionOf(remaining));
    }
    return unifyTypeParameters(pattern.inner, actual);
  }
  if (pattern.kind === "union") {
    const concrete = pattern.members.filter((member) => !typeContainsParameter(member));
    const actualMembers = actual.kind === "union" ? actual.members : [actual];
    const remaining = actualMembers.filter((member) => !concrete.some((covered) => sameType(covered, member)));
    if (remaining.length === 0) return;
    for (const member of pattern.members) {
      if (typeContainsParameter(member)) unifyTypeParameters(member, unionOf(remaining));
    }
    return;
  }
  if ((pattern.kind === "list" && actual.kind === "list") || (pattern.kind === "set" && actual.kind === "set")) {
    return unifyTypeParameters(pattern.element, actual.element, through(pattern));
  }
  if (pattern.kind === "map" && actual.kind === "map") {
    unifyTypeParameters(pattern.key, actual.key, through(pattern));
    unifyTypeParameters(pattern.value, actual.value, through(pattern));
    return;
  }
  if (pattern.kind === "record" && actual.kind === "record") {
    return unifyTypeParameters(pattern.value, actual.value, through(pattern));
  }
  if (pattern.kind === "promise" && actual.kind === "promise") {
    return unifyTypeParameters(pattern.value, actual.value);
  }
  if (pattern.kind === "runtimeType") {
    const value = runtimeTypeValue(actual);
    if (value) return unifyTypeParameters(pattern.value, value);
  }
  // D55 rule 120 layer two: `def top<T>(stack: Stack<T>) -> T?` solves T from
  // the applied argument, and the position seeds a construction's `T` the same
  // way. A class is nominal and invariant, so two applications pair only when
  // they apply the same declaration — no base chain is walked here, because a
  // subclass instantiation is a different type, not a wider one.
  if (pattern.kind === "class" && pattern.application) {
    if (actual.kind === "class" && actual.application
      && pattern.application.declaration === actual.application.declaration) {
      for (let index = 0; index < pattern.application.arguments.length; index += 1) {
        const provided = actual.application.arguments[index];
        if (provided) unifyTypeParameters(pattern.application.arguments[index]!, provided);
      }
    }
    return;
  }
  // D55 rule 121: a generic record application, or the record literal that
  // stands in for one; see `unifyNamedPattern`.
  if (pattern.kind === "named" && pattern.application) {
    unifyNamedPattern(pattern, pattern.application, actual, fieldsOf, unifyTypeParameters, through);
    return;
  }
  if (pattern.kind === "object") {
    unifyObjectPattern(pattern, actual, fieldsOf, unifyTypeParameters, through);
    return;
  }
  if (pattern.kind === "extension" && actual.kind === "extension"
    && pattern.extensionId === actual.extensionId && pattern.family === actual.family) {
    unifyExtensionPattern(pattern, actual, unifyTypeParameters);
    return;
  }
  if ((pattern.kind === "function" || pattern.kind === "action" || pattern.kind === "intrinsic")
    && (actual.kind === "function" || actual.kind === "action" || actual.kind === "intrinsic")) {
    unifyCallablePattern(pattern, actual, unifyTypeParameters);
  }
}

/**
 * D55 rule 121: `def unwrap<T>(box: Box<T>) -> T` solves T from the applied
 * argument. Two applications unify only when they apply the same declaration,
 * which is the nominal rule records already follow.
 */
function unifyNamedPattern(
  pattern: Extract<ValueType, { kind: "named" }>,
  application: GenericApplication,
  actual: ValueType,
  fieldsOf: (identity: string) => ReadonlyMap<string, ValueType> | null,
  recurse: (nextPattern: ValueType, nextActual: ValueType, nextReadonly?: boolean) => void,
  through: (container: ValueType) => boolean,
): void {
  if (actual.kind === "named" && actual.application
    && application.declaration === actual.application.declaration) {
    for (let index = 0; index < application.arguments.length; index += 1) {
      const provided = actual.application.arguments[index];
      if (provided) recurse(application.arguments[index]!, provided, through(pattern));
    }
    return;
  }
  // A record literal is the argument a call most often actually passes, and
  // it carries no application to pair with. The instantiation's own field
  // table still names where each parameter stands, so the literal's fields
  // solve them the same way an `object` pattern's do.
  const fields = actual.kind === "object" ? actual.fields : null;
  const declared = pattern.identity ? fieldsOf(pattern.identity) : null;
  if (!fields || !declared) return;
  for (const [name, field] of declared) {
    const provided = fields.get(name);
    if (provided) recurse(field, provided, through(pattern));
  }
  return;
}

/**
 * A record literal or a declared record standing where a structural record
 * pattern does: the pattern's own field names say where each parameter is, and
 * a declared receiver is opened through `fieldsOf` to reach them.
 */
function unifyObjectPattern(
  pattern: Extract<ValueType, { kind: "object" }>,
  actual: ValueType,
  fieldsOf: (identity: string) => ReadonlyMap<string, ValueType> | null,
  recurse: (nextPattern: ValueType, nextActual: ValueType, nextReadonly?: boolean) => void,
  through: (container: ValueType) => boolean,
): void {
  const fields = actual.kind === "object" ? actual.fields
    : actual.kind === "named" ? fieldsOf(actual.identity ?? actual.name)
      : null;
  if (!fields) return;
  for (const [name, field] of pattern.fields) {
    const provided = fields.get(name);
    if (provided) recurse(field, provided, through(pattern));
  }
  return;
}

/**
 * A target-owned type family pairs only with itself: same extension, same
 * family, then property by property and argument by argument.
 */
function unifyExtensionPattern(
  pattern: Extract<ValueType, { kind: "extension" }>,
  actual: Extract<ValueType, { kind: "extension" }>,
  recurse: (nextPattern: ValueType, nextActual: ValueType, nextReadonly?: boolean) => void,
): void {
  for (const [name, property] of pattern.properties) {
    const provided = actual.properties.get(name);
    if (provided) recurse(property, provided);
  }
  for (let index = 0; index < pattern.arguments.length; index += 1) {
    const provided = actual.arguments[index];
    if (provided) recurse(pattern.arguments[index]!, provided);
  }
  return;
}

/**
 * A callable pattern solves its parameters against the callable it is handed,
 * including through the rest element, and then its result.
 */
function unifyCallablePattern(
  pattern: CallableType,
  actual: CallableType,
  recurse: (nextPattern: ValueType, nextActual: ValueType, nextReadonly?: boolean) => void,
): void {
  // A generic callable value is sealed: its parameter indexes belong to it.
  if (actual.typeParameterNames?.length) return;
  for (let index = 0; index < pattern.parameters.length; index += 1) {
    const provided = actual.parameters[index] ?? actual.rest;
    if (provided) recurse(pattern.parameters[index]!, provided);
  }
  if (pattern.rest && actual.rest) recurse(pattern.rest, actual.rest);
  recurse(pattern.result, actual.result);
}
