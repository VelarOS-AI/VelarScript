/**
 * The sentences a refusal ends with: what the author should write instead, or
 * why the thing they wrote cannot be what they meant.
 *
 * D115 §三: these were eleven private methods of `Analyzer`, called from
 * assignability, from `is`, from an index, from a condition and from a member
 * read. None of them decides anything — every one takes types and spans and
 * answers a string or null — so they are one file, and the file that holds
 * them is the one place a wording is changed.
 */
import { type Expression } from "../../ast.ts";
import { type ClassInfo } from "../../contracts.ts";
import { type Span } from "../../source.ts";
import { type ValueType, describeType } from "../../types.ts";
import { type Binding, type MutableCellTarget } from "../scopes.ts";

/** What the guidance family asks of the analyzer that hosts it, and nothing more. */
export interface ExpressionGuidanceHost {
  readonly classFieldInitializerDepth: number;
  readonly classes: Map<string, ClassInfo>;
  readonly currentClass: string | null;
  expandAliases(type: ValueType, seen?: ReadonlySet<string>): ValueType;
  fieldsOf(identity: string): ReadonlyMap<string, ValueType> | null;
  findGetter(className: string, name: string): { readonly owner: string; readonly type: ValueType; readonly abstract: boolean } | null;
  findMethod(className: string, name: string): { readonly owner: string; readonly type: ValueType; readonly abstract: boolean } | null;
  isAssignableHere(actual: ValueType, expected: ValueType): boolean;
  lookup(name: string): Binding | null;
  readonlyDataViewOf(type: ValueType): ValueType;
  readonly sourceText: string;
  readonly superMemberContext: "instance" | "static" | null;
}

export class ExpressionGuidance {
  private readonly host: ExpressionGuidanceHost;

  constructor(host: ExpressionGuidanceHost) {
    this.host = host;
  }

  /**
   * CLS-I1: the positions where `self` does not exist, and why. A field
   * initializer runs while the instance is still being assembled, so there is
   * no complete `self` to read; a static member belongs to the class and has
   * no instance at all. Outside a class the word is simply an unknown name and
   * keeps the ordinary message.
   */
  unavailableSelfGuidance(): string | null {
    // A static field initializer is both positions at once; "no instance" is
    // the reason that keeps being true no matter when the initializer runs.
    if (this.host.superMemberContext === "static" && this.host.currentClass) {
      return `'self' is available in constructor, method, and getter bodies; a static member has no instance — reach class-owned members through the class name, as in '${this.host.currentClass}.member'`;
    }
    if (this.host.classFieldInitializerDepth > 0) {
      return "'self' is available in constructor, method, and getter bodies; a field initializer runs before the instance is complete, so assign this field in the constructor instead";
    }
    return null;
  }

  /**
   * D90 R17: the author's own spelling of a boundary value, for the
   * diagnostics that teach `Type.parse`. Identifier and member paths render
   * exactly, a simple call renders as `name(...)`, and anything else answers
   * null so the caller falls back to the word `value`.
   */
  boundaryReceiverText(expression: Expression): string | null {
    if (expression.kind === "IdentifierExpression") return expression.name;
    if (expression.kind === "MemberExpression" && !expression.optional) {
      const owner = this.boundaryReceiverText(expression.object);
      return owner === null ? null : `${owner}.${expression.property}`;
    }
    if (expression.kind === "CallExpression") {
      const callee = this.boundaryReceiverText(expression.callee);
      return callee === null ? null : `${callee}(...)`;
    }
    return null;
  }

  /** A type name suggested from the receiver's last name segment, or 'X' when none reads naturally. */
  private boundaryTypeNameSuggestion(receiver: string | null): string {
    const segment = receiver?.replace(/\(\.\.\.\)$/u, "").split(".").at(-1) ?? "";
    return /^[a-zA-Z]/u.test(segment) ? segment[0]!.toUpperCase() + segment.slice(1) : "X";
  }

  /**
   * D90 R17: an undeclared foreign value arrives as unknown, and the way into
   * the typed world is `Type.parse` at the edge. Every refusal on an unknown
   * teaches that ritual with the author's own expression spelled into it.
   */
  boundaryValidationGuidance(expression: Expression | null, property: string | null): string {
    const receiver = expression ? this.boundaryReceiverText(expression) : null;
    const name = this.boundaryTypeNameSuggestion(receiver);
    const spelled = receiver ?? "value";
    const declared = property === null
      ? `declare a type naming the shape you rely on — 'type ${name}:'`
      : `declare a type naming the fields you rely on — 'type ${name}:' with the '${property}' field`;
    const read = property === null ? "use 'checked' from there" : `read 'checked.${property}'`;
    return `; ${declared} — then validate first: 'const checked = ${name}.parse(${spelled})' and ${read}`;
  }

  // Presence guidance names the exact spelling to write whenever the condition
  // is a plain name or a plain member path; anything else is taught the
  // operator without inventing source text for it.
  conditionSubjectText(condition: Expression): string | null {
    if (condition.kind === "IdentifierExpression") return condition.name;
    if (condition.kind === "MemberExpression" && !condition.optional) {
      const owner = this.conditionSubjectText(condition.object);
      return owner === null ? null : `${owner}.${condition.property}`;
    }
    return null;
  }

  /**
   * A mutable cell declared without an annotation takes the exact member its
   * initializer named, so the second member ever stored into it is refused
   * against the first — `Cannot assign Locale to Locale.zhCN`, reported at the
   * assignment while the line that has to change is the declaration. The
   * refusal is right; naming the annotation is what turns it into one edit.
   */
  enumSingletonCellGuidance(
    actual: ValueType,
    expected: ValueType,
    target: MutableCellTarget | null,
  ): string | null {
    if (target === null || expected.kind !== "enumMember") return null;
    if (actual.kind !== "enum" && actual.kind !== "enumMember") return null;
    if ((actual.identity ?? actual.name) !== (expected.identity ?? expected.name)) return null;
    if (actual.kind === "enumMember" && actual.member === expected.member) return null;
    return `'${target.name}' has no annotation, so it took the one member its initializer named; declare the enum to hold any of them — '${target.keyword} ${target.name}: ${expected.name} = ...'`;
  }

  /**
   * D114 S7: the one idiom that carries a class's behavior into a structural
   * contract. A record type whose fields are function types is what a caller
   * states when it wants behavior rather than a nominal type; a class instance
   * does not satisfy it (section 12), and a class name is not a value
   * (section 10). What passes is a record of *bound methods* —
   * `{close: terminal.close}` — where each method value binds its receiver
   * once at the reference site (section 18).
   *
   * The guidance is built from the names actually in front of the compiler:
   * the target's own function-typed fields that the class answers with a
   * method or a getter, in the target's declaration order, at most three
   * before the ellipsis. Nothing here changes assignability; the refusal is
   * the same refusal, and the message is the whole change.
   */
  boundMethodRecordGuidance(actual: ValueType, expected: ValueType, valueSpan: Span): string | null {
    // An extern class is registered under its bridged identity rather than its
    // written name, and it reaches the idiom the same way a VelarScript class
    // does: reading its method as a value binds the receiver (section 18).
    let className: string | null = null;
    if (actual.kind === "class") {
      const identity = actual.identity ?? actual.name;
      className = this.host.classes.has(identity) ? identity : this.host.classes.has(actual.name) ? actual.name : null;
    } else if (actual.kind === "named" && this.host.classes.has(actual.name)) {
      className = actual.name;
    }
    if (className === null) return null;

    const fields = expected.kind === "object" ? expected.fields
      : expected.kind === "named" ? this.host.fieldsOf(expected.identity ?? expected.name)
        : null;
    if (!fields || fields.size === 0) return null;

    const matched: string[] = [];
    for (const [name, type] of fields) {
      if (this.host.expandAliases(type).kind !== "function") continue;
      if (this.host.findMethod(className, name) || this.host.findGetter(className, name)) matched.push(name);
    }
    if (matched.length === 0) return null;

    const receiver = this.simpleBindingSpelling(valueSpan) ?? "value";
    const shown = matched.slice(0, 3);
    const ellipsis = shown.length < fields.size ? ", …" : "";
    const spelling = `{${shown.map((name) => `${name}: ${receiver}.${name}`).join(", ")}${ellipsis}}`;
    return `a class instance never satisfies a record contract; pass its behavior as bound methods — '${spelling}' — each of which binds its receiver once where it is read`;
  }

  /** The written value when it is one ordinary binding name, for a message that reads it back. */
  private simpleBindingSpelling(valueSpan: Span): string | null {
    const written = this.host.sourceText.slice(valueSpan.start, valueSpan.end);
    if (!/^[A-Za-z_$][A-Za-z0-9_$]*$/u.test(written)) return null;
    return this.host.lookup(written) ? written : null;
  }

  /**
   * D44 rule 72's readonly view refuses exactly one shape of assignment: the
   * value is the target type with readonly added. Component props arrive that
   * way — the body of `component List(items: List<Item>)` sees a readonly
   * projection — so the helper that would accept the value has a signature the
   * author never wrote, and the diagnostic is the only place to hand it over.
   * The return shape matters as much as the parameter: a List built from a
   * readonly List carries readonly elements.
   */
  readonlyProjectionGuidance(
    actual: ValueType,
    expected: ValueType,
    expandedExpected: ValueType,
    expectedCore: ValueType,
  ): string | null {
    if (describeType(this.host.readonlyDataViewOf(expandedExpected)) !== describeType(actual)) return null;
    const parameter = describeType(this.host.readonlyDataViewOf(expected));
    const family = expectedCore.kind === "list" ? "List" : expectedCore.kind === "set" ? "Set" : null;
    let built = "";
    if (family !== null && (expectedCore.kind === "list" || expectedCore.kind === "set")) {
      const element = describeType(expectedCore.element);
      const projected = describeType(this.host.readonlyDataViewOf(expectedCore.element));
      if (projected !== element) built = `, and a ${family} built from it is '${family}<${projected}>'`;
    }
    return `a readonly projection stays readonly through every hop, so the value never widens — declare the receiving parameter as '${parameter}'${built}`;
  }

  /**
   * D64 rule 163: the async result annotation is spelled two ways in two
   * positions, and both are right. A *declaration* annotates the resolved
   * value — `async def load(id: string) -> string` — because the `async` is
   * standing right there; VEL4018 refuses `-> Promise<T>` for that reason. A
   * function *type* has no `async` on it and describes the value the call
   * hands back, which is a Promise, so `-> Promise<T>` is the spelling there.
   *
   * An author who has just been taught VEL4018 therefore writes `-> string` in
   * the type position and is refused for obeying it. Naming only the mismatch
   * leaves that author with two diagnostics that contradict each other, so the
   * refusal names the spelling the type position wants. The check is exact:
   * the mismatch has to disappear when the result is wrapped, which is what
   * makes the named spelling a fact rather than a guess.
   */
  asyncResultSpellingGuidance(actual: ValueType, expectedCore: ValueType): string | null {
    if (actual.kind !== "function" && actual.kind !== "action" && actual.kind !== "intrinsic") return null;
    if (expectedCore.kind !== "function" && expectedCore.kind !== "action" && expectedCore.kind !== "intrinsic") return null;
    if (this.host.expandAliases(actual.result).kind !== "promise") return null;
    const expectedResult = this.host.expandAliases(expectedCore.result);
    if (expectedResult.kind === "promise" || expectedResult.kind === "unknown" || expectedResult.kind === "any") return null;
    const wrapped: ValueType = { ...expectedCore, result: { kind: "promise", value: expectedCore.result } };
    // The guidance is only true when the result spelling is the whole quarrel,
    // so the wrapped target has to accept the value outright.
    if (!this.host.isAssignableHere(actual, wrapped)) return null;
    return `an async function's type describes the value the call produces, so its result is a Promise — write '-> ${describeType(wrapped.result)}' here, and '-> ${describeType(expectedCore.result)}' on the 'async def' declaration itself`;
  }

  // COL-U10: the collection families never assign across each other; each
  // rejected pair has one blessed bridge spelling worth naming.
  collectionBridgeGuidance(actual: ValueType, expectedCore: ValueType): string | null {
    if (expectedCore.kind === "list") {
      if (actual.kind === "set") return "Set.values() returns the members as a List";
      if (actual.kind === "map") return "Map.keys(), Map.values(), or Map.entries() return the entries as Lists";
      if (actual.kind === "record") return "Record.keys(), Record.values(), or Record.entries() return the fields as Lists";
    }
    if (expectedCore.kind === "set" && (actual.kind === "list")) return "Set(values) builds a Set from a List";
    if (expectedCore.kind === "map") {
      if (actual.kind === "record") return "Map(record) builds a string-keyed Map from a record";
      if (actual.kind === "list") return "Map(entries) builds a Map from a List of [key, value] Lists";
    }
    return null;
  }
}
