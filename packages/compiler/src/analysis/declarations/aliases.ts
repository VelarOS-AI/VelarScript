/**
 * `type X = …` aliases: registering what a transparent name stands for, and
 * expanding it wherever a type is read.
 *
 * D114 R1d: `expandAliases` stays a `protected` member of `Analyzer` — Web and
 * Node subclass that class — and forwards here, which is where the rule now
 * lives beside the registration that fills the table it reads.
 */
import { type Program, type TypeAliasDeclaration, type TypeReference } from "../../ast.ts";
import { diagnostic, type Diagnostic } from "../../diagnostic.ts";

import { type Span } from "../../source.ts";
import { optionalOf, unknownType, type ValueType } from "../../types.ts";
import { type BuiltinTypeNamePosition } from "../scopes.ts";

/**
 * Everything this half of the declaration cluster asks of the analyzer that
 * hosts it. The five halves share one host object, so the interface is the
 * same shape for each and the union of them is what the analyzer builds.
 */
export interface TypeAliasesHost {
  declareTypeNameBinding(name: string, type: ValueType, declarationSpan: Span, position: BuiltinTypeNamePosition): void;
  readonly diagnostics: Diagnostic[];
  readonly predeclared: WeakSet<object>;
  readonlyDataViewOf(type: ValueType): ValueType;
  resolveGenericApplication(type: Extract<ValueType, { kind: "named" }>, resolveArgument?: (argument: ValueType) => ValueType): ValueType | null;
  resolveRawTypeReference(reference: TypeReference): ValueType;
  readonly typeAliases: Map<string, ValueType>;
}

export class TypeAliases {
  private readonly host: TypeAliasesHost;

  constructor(host: TypeAliasesHost) {
    this.host = host;
  }

  registerAliasShapes(program: Program): void {
    const declarations = new Map<string, TypeAliasDeclaration>();
    for (const statement of program.body) {
      if (statement.kind !== "TypeAliasDeclaration") continue;
      this.host.typeAliases.delete(statement.name);
      if (declarations.has(statement.name)) {
        this.host.diagnostics.push(diagnostic("VEL4004", `Type '${statement.name}' is declared more than once`, statement.span));
      }
      declarations.set(statement.name, statement);
    }
    const resolving = new Set<string>();
    const reported = new Set<string>();
    const expand = (type: ValueType): ValueType => {
      if (type.kind === "named") {
        const readonly = type.readonlyView === true;
        const declaration = declarations.get(type.name);
        if (!declaration) {
          const resolved = this.host.typeAliases.get(type.name) ?? type;
          return readonly ? this.host.readonlyDataViewOf(resolved) : resolved;
        }
        const cached = this.host.typeAliases.get(type.name);
        if (cached && !resolving.has(type.name)) return readonly ? this.host.readonlyDataViewOf(cached) : cached;
        if (resolving.has(type.name)) {
          if (!reported.has(type.name)) {
            this.host.diagnostics.push(diagnostic("VEL4017", `Type alias '${type.name}' is recursive`, declaration.span));
            reported.add(type.name);
          }
          return unknownType;
        }
        resolving.add(type.name);
        const resolved = expand(this.host.resolveRawTypeReference(declaration.target));
        resolving.delete(type.name);
        this.host.typeAliases.set(type.name, resolved);
        return readonly ? this.host.readonlyDataViewOf(resolved) : resolved;
      }
      if (type.kind === "optional") return optionalOf(expand(type.inner));
      if (type.kind === "list") return { ...type, element: expand(type.element) };
      if (type.kind === "set") return { ...type, element: expand(type.element) };
      if (type.kind === "map") return { ...type, key: expand(type.key), value: expand(type.value) };
      if (type.kind === "record") return { ...type, value: expand(type.value) };
      if (type.kind === "promise") return { kind: "promise", value: expand(type.value) };
      if (type.kind === "runtimeType") return { kind: "runtimeType", value: expand(type.value) };
      if (type.kind === "typeObject") return type.value ? { ...type, value: expand(type.value) } : type;
      if (type.kind === "object") return { ...type, fields: new Map([...type.fields].map(([name, value]) => [name, expand(value)])) };
      if (type.kind === "extension") {
        return {
          ...type,
          properties: new Map([...type.properties].map(([name, value]) => [name, expand(value)])),
          arguments: type.arguments.map(expand),
        };
      }
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

  analyzeTypeAliasDeclaration(statement: TypeAliasDeclaration): void {
    if (!this.host.predeclared.has(statement)) this.host.declareTypeNameBinding(statement.name, { kind: "typeObject", name: statement.name }, statement.span, "type");
  }

  expandAliases(type: ValueType, seen: ReadonlySet<string> = new Set()): ValueType {
    if (type.kind === "named" && this.host.typeAliases.has(type.name)) {
      if (seen.has(type.name)) return unknownType;
      const expanded = this.expandAliases(this.host.typeAliases.get(type.name)!, new Set([...seen, type.name]));
      return type.readonlyView ? this.host.readonlyDataViewOf(expanded) : expanded;
    }
    // D55 rule 121: an alias is transparent inside a type argument too, so
    // `Box<Id>` and `Box<string>` reach the identity step already agreeing.
    // Expansion also canonicalizes: an alias registered before the generic
    // declarations were read — `type Boxed = Box<string>` above `type Box<T>` —
    // stored an application with no identity, and every reader of an alias goes
    // through here.
    if (type.kind === "named" && type.application) {
      const arguments_ = type.application.arguments.map((argument) => this.expandAliases(argument, seen));
      const changed = arguments_.some((argument, index) => argument !== type.application!.arguments[index]);
      if (!changed && type.identity) return type;
      const expanded = changed ? { ...type, application: { ...type.application, arguments: arguments_ } } : type;
      return this.host.resolveGenericApplication(expanded) ?? expanded;
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
      return key === type.key && value === type.value ? type : { ...type, key, value };
    }
    if (type.kind === "record") {
      const value = this.expandAliases(type.value, seen);
      return value === type.value ? type : { ...type, value };
    }
    if (type.kind === "promise") {
      const value = this.expandAliases(type.value, seen);
      return value === type.value ? type : { kind: "promise", value };
    }
    if (type.kind === "runtimeType") {
      const value = this.expandAliases(type.value, seen);
      return value === type.value ? type : { kind: "runtimeType", value };
    }
    if (type.kind === "typeObject" && type.value) {
      const value = this.expandAliases(type.value, seen);
      return value === type.value ? type : { ...type, value };
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
    if (type.kind === "extension") {
      let changed = false;
      const properties = new Map([...type.properties].map(([name, value]) => {
        const expanded = this.expandAliases(value, seen);
        changed ||= expanded !== value;
        return [name, expanded] as const;
      }));
      const arguments_ = type.arguments.map((argument) => this.expandAliases(argument, seen));
      changed ||= arguments_.some((argument, index) => argument !== type.arguments[index]);
      return changed ? { ...type, properties, arguments: arguments_ } : type;
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

  /**
   * The `TypeEnvironment` view of alias expansion. Assignability needs it to
   * decide the text-conversion parameter domain on the expanded shape, exactly
   * as the direct `str()` check does.
   */
  expandTypeAliases(type: ValueType): ValueType {
    return this.expandAliases(type);
  }
}
