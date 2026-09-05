/**
 * Written type syntax to a `ValueType`, and back to the text a reader wrote.
 *
 * `typeFromSyntax` is the one door from the parser's `TypeSyntax` into the type
 * model; an extension resolver gets first refusal on a name Core does not own.
 * `formatTypeSyntax` is its inverse for diagnostics: it renders the syntax as
 * authored, which is not `describeType` — that one describes a resolved type.
 */
import type { TypeReference, TypeSyntax } from "../ast.ts";
import { anyType, boolType, boundaryUnknownType, nullType, numberType, optionalOf, stringType, unionOf, unknownType, type ValueType } from "./model.ts";
import { readonlyViewOf } from "./readonly.ts";

export type ExtensionTypeSyntaxResolver = (
  syntax: TypeSyntax,
  resolve: (syntax: TypeSyntax) => ValueType,
) => ValueType | undefined;

export function resolveTypeReference(reference: TypeReference, extension?: ExtensionTypeSyntaxResolver): ValueType {
  return typeFromSyntax(reference.syntax, extension);
}

export function typeFromSyntax(syntax: TypeSyntax, extension?: ExtensionTypeSyntaxResolver): ValueType {
  const nested = (value: TypeSyntax): ValueType => typeFromSyntax(value, extension);
  const owned = extension?.(syntax, nested);
  if (owned) return owned;
  switch (syntax.kind) {
    case "NamedTypeSyntax":
      switch (syntax.name) {
        case "string": return stringType;
        case "number": return numberType;
        case "bool": return boolType;
        case "null": return nullType;
        case "unknown": return boundaryUnknownType;
        case "any": return anyType;
        case "Promise": return { kind: "promise", value: nullType };
        default: return { kind: "named", name: syntax.name };
      }
    case "EnumMemberTypeSyntax":
      return { kind: "enumMember", name: syntax.enumName, identity: syntax.enumName, member: syntax.member };
    case "GenericTypeSyntax": {
      const arguments_ = syntax.arguments.map(nested);
      if (syntax.name === "List") return { kind: "list", element: arguments_[0] ?? unknownType };
      if (syntax.name === "Set") return { kind: "set", element: arguments_[0] ?? unknownType };
      if (syntax.name === "Map") return { kind: "map", key: arguments_[0] ?? unknownType, value: arguments_[1] ?? unknownType };
      if (syntax.name === "Record") return { kind: "record", value: arguments_[0] ?? unknownType };
      if (syntax.name === "Promise") return { kind: "promise", value: arguments_[0] ?? unknownType };
      if (syntax.name === "Type") return { kind: "runtimeType", value: arguments_[0] ?? unknownType };
      // D114 ③: `Function<...>` is not resolved here. The parser recovers the
      // retired shorthand as the arrow function type it meant, so no
      // `Function` type syntax reaches this switch — one spelling, resolved in
      // one place.
      // D55 rule 121: a name core does not own is either an extension family
      // (claimed above) or a user generic record. The arguments ride along
      // unresolved so the one stage that knows the declarations — the analyzer,
      // or a module interface being built — can canonicalize the application;
      // until then the display name stays exactly the source text it always was.
      return { kind: "named", name: formatTypeSyntax(syntax), application: { declaration: syntax.name, name: syntax.name, arguments: arguments_ } };
    }
    case "ReadonlyTypeSyntax":
      return readonlyViewOf(nested(syntax.inner));
    case "OptionalTypeSyntax":
      return optionalOf(nested(syntax.inner));
    case "UnionTypeSyntax":
      return unionOf(syntax.members.map(nested));
    case "FunctionTypeSyntax": {
      const fixed = syntax.parameters.filter((parameter) => !parameter.rest);
      const rest = syntax.parameters.find((parameter) => parameter.rest);
      return {
        kind: "function",
        parameters: fixed.map((parameter) => nested(parameter.type)),
        ...(fixed.some((parameter) => parameter.name) ? { parameterNames: fixed.map((parameter) => parameter.name ?? "") } : {}),
        requiredParameters: fixed.filter((parameter) => !parameter.optional).length,
        ...(rest ? { rest: nested(rest.type) } : {}),
        result: nested(syntax.result),
      };
    }
  }
}

export function formatTypeReference(reference: TypeReference): string {
  return formatTypeSyntax(reference.syntax);
}

export function formatTypeSyntax(syntax: TypeSyntax): string {
  switch (syntax.kind) {
    case "NamedTypeSyntax": return syntax.name;
    case "EnumMemberTypeSyntax":
      return [...(syntax.qualifiers ?? []).map((segment) => segment.name), syntax.enumName, syntax.member].join(".")
        + (syntax.arguments ? `<${syntax.arguments.map(formatTypeSyntax).join(", ")}>` : "");
    case "GenericTypeSyntax": return `${syntax.name}<${syntax.arguments.map(formatTypeSyntax).join(", ")}>`;
    case "ReadonlyTypeSyntax": return `readonly ${syntax.inner.kind === "UnionTypeSyntax" || syntax.inner.kind === "FunctionTypeSyntax" ? `(${formatTypeSyntax(syntax.inner)})` : formatTypeSyntax(syntax.inner)}`;
    case "OptionalTypeSyntax": return `${syntax.inner.kind === "UnionTypeSyntax" || syntax.inner.kind === "FunctionTypeSyntax" ? `(${formatTypeSyntax(syntax.inner)})` : formatTypeSyntax(syntax.inner)}?`;
    case "UnionTypeSyntax": return syntax.members.map(formatTypeSyntax).join(" | ");
    case "FunctionTypeSyntax": return `(${syntax.parameters.map((parameter) => `${parameter.rest ? "..." : ""}${parameter.name ? `${parameter.name}${parameter.optional ? "?" : ""}: ` : ""}${formatTypeSyntax(parameter.type)}`).join(", ")}) -> ${formatTypeSyntax(syntax.result)}`;
  }
}
