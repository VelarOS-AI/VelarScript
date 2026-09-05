/**
 * `enum` declarations: the member roster a name stands for, the wire values it
 * carries, and the two ways an enum object is reached at runtime.
 *
 * D114 R1d: split out of `Analyzer` with the rest of the declaration cluster.
 */
import { type Expression, type Program } from "../../ast.ts";

import { boolType, unknownType, type EnumInfo, type ValueType } from "../../types.ts";
import { type Binding } from "../scopes.ts";

/**
 * Everything this half of the declaration cluster asks of the analyzer that
 * hosts it. The five halves share one host object, so the interface is the
 * same shape for each and the union of them is what the analyzer builds.
 */
export interface EnumDeclarationsHost {
  readonly enums: Map<string, EnumInfo>;
  expandAliases(type: ValueType, seen?: ReadonlySet<string>): ValueType;
  lookup(name: string): Binding | null;
  readonly typeAliases: Map<string, ValueType>;
}

export class EnumDeclarations {
  private readonly host: EnumDeclarationsHost;

  constructor(host: EnumDeclarationsHost) {
    this.host = host;
  }

  registerEnumShapes(program: Program): void {
    for (const statement of program.body) {
      if (statement.kind !== "EnumDeclaration") continue;
      this.host.enums.set(statement.name, {
        identity: statement.name,
        members: new Set(statement.members.map((member) => member.name)),
        wireValues: new Map(statement.members.map((member) => [member.name, member.value])),
      });
    }
  }

  /**
   * D102 ruling 1: the declared wire value of each member, by identity first
   * and local name second — `this.host.enums` is keyed by the name the module sees,
   * and an imported enum's identity is its declaring module's.
   */
  enumWireValuesOf(identity: string, name: string): ReadonlyMap<string, string | number> | null {
    return (this.host.enums.get(identity) ?? this.host.enums.get(name))?.wireValues ?? null;
  }

  enumValuesOf(identity: string): readonly (string | number)[] | null {
    const info = this.host.enums.get(identity);
    if (!info) return null;
    // OpenAPI、路由参数和其他线协议消费的是枚举真正序列化的值，不是源码成员名。
    // 按成员声明顺序读取映射，既与 Enum.values() 一致，也避免 Map 构造顺序漂移。
    return [...info.members].map((member) => info.wireValues.get(member)!);
  }

  /** The enum behind a type alias name, or null when the alias does not resolve to an enum. */
  aliasedEnumTarget(name: string): { readonly name: string; readonly identity: string; readonly members: ReadonlySet<string> } | null {
    if (!this.host.typeAliases.has(name)) return null;
    const expanded = this.host.expandAliases({ kind: "named", name });
    if (expanded.kind === "enum") {
      const info = this.host.enums.get(expanded.identity) ?? this.host.enums.get(expanded.name);
      return info ? { name: expanded.name, identity: expanded.identity, members: info.members } : null;
    }
    if (expanded.kind === "named") {
      const info = this.host.enums.get(expanded.name);
      return info ? { name: expanded.name, identity: info.identity, members: info.members } : null;
    }
    return null;
  }

  /** The runtime surface of an enum object: its members plus is, parse, and values() (ENM-U1). */
  enumRuntimeMember(name: string, identity: string, members: ReadonlySet<string>, property: string): ValueType | null {
    if (members.has(property)) return { kind: "enumMember", name, identity, member: property };
    if (property === "is") return { kind: "function", parameterNames: ["value"], parameters: [unknownType], requiredParameters: 1, result: boolType };
    if (property === "parse") return { kind: "function", parameterNames: ["value"], parameters: [unknownType], requiredParameters: 1, result: { kind: "enum", name, identity } };
    // ENM-U1 (D47-approved): values() returns the members in declaration
    // order as a fresh mutable List on every call, like split and friends.
    if (property === "values") return { kind: "function", parameterNames: [], parameters: [], requiredParameters: 0, result: { kind: "list", element: { kind: "enum", name, identity } } };
    return null;
  }

  enumTargetOfValidatorObject(object: Expression): Extract<ValueType, { kind: "enum" }> | null {
    if (object.kind !== "IdentifierExpression") return null;
    const type = this.host.lookup(object.name)?.type;
    if (!type) return null;
    if (type.kind === "enumObject") return { kind: "enum", name: type.name, identity: type.identity };
    if (type.kind === "typeObject") {
      const aliased = this.aliasedEnumTarget(type.name);
      if (aliased) return { kind: "enum", name: aliased.name, identity: aliased.identity };
    }
    return null;
  }
}
