/**
 * What the editor is told about a program: the type at every expression, the
 * type and members of every binding, and the member roster a completion offers
 * for a receiver.
 *
 * D115 §三: these were five private and protected methods of `Analyzer` writing
 * six side tables. They are not type checking — nothing here can refuse a
 * program — so they are their own collaborator, and `analyzer.ts` keeps only
 * the accessors the compiler's semantic index reads them back through.
 */
import { type AdvisoryRecordShape } from "./advisories.ts";
import { type Expression } from "../ast.ts";
import { type ClassField, type ClassInfo } from "../contracts.ts";
import { span, spanIdentity } from "../source.ts";
import {
  type ValueType,
  boolType,
  nonOptional,
  optionalOf,
  semanticTypeIdentity,
  unionOf,
  unknownType,
} from "../types.ts";

/** What the semantic recorder asks of the analyzer that hosts it, and nothing more. */
export interface SemanticIndexRecorderHost {
  classInfo(key: string): ClassInfo | undefined;
  readonly currentClass: string | null;
  displayExternalClasses(type: ValueType): ValueType;
  expandAliases(type: ValueType, seen?: ReadonlySet<string>): ValueType;
  fieldsOf(identity: string): ReadonlyMap<string, ValueType> | null;
  isSubclassOf(actual: string, expected: string): boolean;
  listMember(list: Extract<ValueType, { kind: "list" }>, property: string): ValueType | null;
  mapMember(map: Extract<ValueType, { kind: "map" }>, property: string): ValueType | null;
  numberMember(property: string): ValueType | null;
  readonly privateFields: Map<string, Map<string, ClassField>>;
  readonly privateMethods: Map<string, Map<string, ValueType>>;
  readonly privateStaticFields: Map<string, Map<string, ClassField>>;
  readonly privateStaticMethods: Map<string, Map<string, ValueType>>;
  readonlyDataViewOf(type: ValueType): ValueType;
  readonlyFieldsOf(identity: string): ReadonlySet<string> | null;
  recordMember(record: Extract<ValueType, { kind: "record" }>, property: string): ValueType | null;
  recordProjectionShape(type: ValueType): AdvisoryRecordShape | null;
  runtimeTypeObjectValue(type: Extract<ValueType, { kind: "typeObject" }>): ValueType;
  readonly semanticBindingMembers: Map<string, ReadonlyMap<string, ValueType>>;
  readonly semanticBindingTypes: Map<string, ValueType>;
  readonly semanticExpressionContexts: Map<string, ValueType>;
  readonly semanticExpressionMembers: Map<string, ReadonlyMap<string, ValueType>>;
  readonly semanticExpressionTypes: Map<string, ValueType>;
  readonly semanticMemberCache: Map<string, ReadonlyMap<string, ValueType>>;
  setMember(set: Extract<ValueType, { kind: "set" }>, property: string): ValueType | null;
  stringMember(property: string): ValueType | null;
}

export class SemanticIndexRecorder {
  private readonly host: SemanticIndexRecorderHost;

  constructor(host: SemanticIndexRecorderHost) {
    this.host = host;
  }

  recordSemanticExpression(expression: Expression, type: ValueType): void {
    const indexable = (expression.kind !== "IdentifierExpression"
      || expression.name === "self"
      || this.privateSemanticContext(type) !== null)
      && expression.kind !== "LiteralExpression"
      && expression.kind !== "SuperExpression";
    if (indexable) {
      const members = this.semanticMembersOf(type);
      const callable = type.kind === "function" || type.kind === "intrinsic" || type.kind === "action";
      if (members.size > 0 || callable || expression.kind === "MemberExpression"
        || this.host.semanticExpressionContexts.has(spanIdentity(expression.span))) {
        const key = spanIdentity(expression.span);
        this.host.semanticExpressionTypes.set(key, type);
        this.host.semanticExpressionMembers.set(key, members);
      }
    }
  }

  recordSemanticBinding(key: string, type: ValueType): void {
    this.host.semanticBindingTypes.set(key, type);
    this.host.semanticBindingMembers.set(key, this.semanticMembersOf(type));
  }

  semanticMembersOf(original: ValueType): ReadonlyMap<string, ValueType> {
    const privateContext = this.privateSemanticContext(original);
    const key = `${semanticTypeIdentity(original)}:private:${privateContext ?? ""}`;
    const cached = this.host.semanticMemberCache.get(key);
    if (cached) return cached;
    const members = this.createSemanticMembersOf(original);
    this.host.semanticMemberCache.set(key, members);
    return members;
  }

  private privateSemanticContext(original: ValueType): string | null {
    if (!this.host.currentClass) return null;
    const type = nonOptional(this.host.expandAliases(original));
    if (type.kind === "class") {
      const key = type.identity ?? type.name;
      return this.host.isSubclassOf(key, this.host.currentClass) ? this.host.currentClass : null;
    }
    if (type.kind === "classConstructor") {
      return (type.identity ?? type.name) === this.host.currentClass ? this.host.currentClass : null;
    }
    return null;
  }

  private createSemanticMembersOf(original: ValueType): ReadonlyMap<string, ValueType> {
    const type = nonOptional(this.host.expandAliases(original));
    const available = (names: readonly string[], member: (name: string) => ValueType | null): ReadonlyMap<string, ValueType> => new Map(
      names.flatMap((name) => {
        const value = member(name);
        return value ? [[name, value] as const] : [];
      }),
    );
    if (type.kind === "union") {
      if (type.members.length === 0) return new Map();
      const memberMaps = type.members.map((member) => this.createSemanticMembersOf(member));
      const common = new Map<string, ValueType>();
      for (const [name] of memberMaps[0]!) {
        const candidates = memberMaps.map((members) => members.get(name));
        if (candidates.every((candidate): candidate is ValueType => candidate !== undefined)) {
          common.set(name, unionOf(candidates));
        }
      }
      return common;
    }
    if (type.kind === "string") return new Map(["size", "trim", "upper", "lower", "slice", "char", "has", "index", "count", "startsWith", "endsWith", "split", "replace", "replaceAll", "padStart", "padEnd", "repeat", "isBlank"]
      .map((name) => [name, this.host.stringMember(name)!]));
    if (type.kind === "number") return new Map(["abs", "round", "floor", "ceil", "sign", "trunc", "toFixed", "isInteger", "isNaN", "isFinite"]
      .map((name) => [name, this.host.numberMember(name)!]));
    if (type.kind === "list") return available(["size", "get", "slice", "append", "extend", "insert", "has", "remove", "pop", "clear", "copy", "count", "index", "sorted", "reversed", "map", "flatMap", "filter", "reduce", "some", "every", "find", "join", "sum", "min", "max"], (name) => this.host.listMember(type, name));
    if (type.kind === "map") return available(["size", "get", "set", "getOrSet", "getOrSetWith", "update", "has", "remove", "clear", "copy", "iterator", "keys", "values", "entries"], (name) => this.host.mapMember(type, name));
    if (type.kind === "record") return available(["size", "get", "set", "has", "remove", "clear", "copy", "keys", "values", "entries"], (name) => this.host.recordMember(type, name));
    if (type.kind === "set") return available(["size", "add", "update", "has", "remove", "clear", "copy", "values", "union", "intersection", "difference"], (name) => this.host.setMember(type, name));
    if (type.kind === "action") return new Map([
      ["pending", boolType],
      ["error", optionalOf({ kind: "class", name: "Error" })],
    ]);
    if (type.kind === "object") return new Map([...type.fields].map(([name, value]) => {
      const readable = type.readonlyView || type.readonlyFields?.has(name) ? this.host.readonlyDataViewOf(value) : value;
      return [name, type.optionalFields?.has(name) ? optionalOf(readable) : readable];
    }));
    if (type.kind === "extension") return type.properties;
    if (type.kind === "named") {
      const identity = type.identity ?? type.name;
      const fields = this.host.fieldsOf(identity) ?? new Map();
      const readonlyFields = this.host.readonlyFieldsOf(identity);
      return new Map([...fields].map(([name, value]) => [name, type.readonlyView || readonlyFields?.has(name) ? this.host.readonlyDataViewOf(value) : value]));
    }
    if (type.kind === "class") {
      const members = new Map<string, ValueType>();
      let current: string | null = type.identity ?? type.name;
      const visited = new Set<string>();
      while (current && !visited.has(current)) {
        visited.add(current);
        const info = this.host.classInfo(current);
        for (const [name, field] of info?.fields ?? []) if (!members.has(name)) members.set(name, this.host.displayExternalClasses(field.type));
        for (const [name, method] of info?.methods ?? []) if (!members.has(name)) members.set(name, this.host.displayExternalClasses(method));
        current = info?.base ?? null;
      }
      const privateContext = this.privateSemanticContext(type);
      if (privateContext) {
        for (const [name, field] of this.host.privateFields.get(privateContext) ?? []) members.set(name, this.host.displayExternalClasses(field.type));
        for (const [name, method] of this.host.privateMethods.get(privateContext) ?? []) members.set(name, this.host.displayExternalClasses(method));
      }
      return members;
    }
    if (type.kind === "classConstructor") {
      const members = new Map<string, ValueType>();
      let current: string | null = type.identity ?? type.name;
      const visited = new Set<string>();
      while (current && !visited.has(current)) {
        visited.add(current);
        const info = this.host.classInfo(current);
        for (const [name, field] of info?.staticFields ?? []) if (!members.has(name)) members.set(name, this.host.displayExternalClasses(field.type));
        for (const [name, method] of info?.staticMethods ?? []) if (!members.has(name)) members.set(name, this.host.displayExternalClasses(method));
        current = info?.base ?? null;
      }
      const privateContext = this.privateSemanticContext(type);
      if (privateContext) {
        for (const [name, field] of this.host.privateStaticFields.get(privateContext) ?? []) members.set(name, this.host.displayExternalClasses(field.type));
        for (const [name, method] of this.host.privateStaticMethods.get(privateContext) ?? []) members.set(name, this.host.displayExternalClasses(method));
      }
      return members;
    }
    if (type.kind === "enumObject") {
      const members = new Map<string, ValueType>();
      for (const name of type.members) members.set(name, { kind: "enumMember", name: type.name, identity: type.identity, member: name });
      members.set("is", { kind: "function", parameterNames: ["value"], parameters: [unknownType], requiredParameters: 1, result: boolType });
      members.set("parse", { kind: "function", parameterNames: ["value"], parameters: [unknownType], requiredParameters: 1, result: { kind: "enum", name: type.name, identity: type.identity } });
      members.set("values", { kind: "function", parameterNames: [], parameters: [], requiredParameters: 0, result: { kind: "list", element: { kind: "enum", name: type.name, identity: type.identity } } });
      return members;
    }
    if (type.kind === "typeObject") {
      const value = this.host.runtimeTypeObjectValue(type);
      const members = new Map<string, ValueType>([
        ["is", { kind: "function", parameterNames: ["value"], parameters: [unknownType], requiredParameters: 1, result: boolType }],
        ["parse", { kind: "function", parameterNames: ["value"], parameters: [unknownType], requiredParameters: 1, result: value }],
      ]);
      if (this.host.recordProjectionShape(value)) {
        members.set("from", {
          kind: "function",
          parameterNames: ["source", "overrides"],
          parameters: [unknownType, unknownType],
          requiredParameters: 1,
          result: value,
        });
      }
      return members;
    }
    if (type.kind === "runtimeType") return new Map([
      ["is", { kind: "function", parameterNames: ["value"], parameters: [unknownType], requiredParameters: 1, result: boolType }],
      ["parse", { kind: "function", parameterNames: ["value"], parameters: [unknownType], requiredParameters: 1, result: type.value }],
    ]);
    return new Map();
  }
}
