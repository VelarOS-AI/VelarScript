/**
 * Every read the index records: a name read, a member read, and the type
 * references a written annotation names. Also the two lookups a read needs —
 * which symbol a name resolves to, and where inside a declaration's span the
 * name itself is written.
 *
 * D115 §三 / D114 R1f: the reference half of `semantic.ts`. Nothing here walks
 * a statement, so the walk depends on this module and not the other way round.
 */
import { type TypeReference, type TypeSyntax } from "../ast.ts";
import { type SourceText, type Span } from "../source.ts";
import { describeType, type ValueType } from "../types.ts";
import {
  MAX_SEMANTIC_MEMBERS,
  semanticBindingKey,
  type Scope,
  type SemanticMember,
  type SemanticMemberReference,
  type SemanticReference,
  type SemanticSymbol,
  type SemanticSymbolKind,
} from "./symbols.ts";

/** What the reference recorder asks of the index that hosts it, and nothing more. */
export interface SemanticReferencesHost {
  readonly bindingTypes: ReadonlyMap<string, ValueType>;
  readonly describedMemberCache: Map<ReadonlyMap<string, ValueType>, readonly SemanticMember[]>;
  readonly memberReferences: SemanticMemberReference[];
  readonly references: SemanticReference[];
  readonly scopes: Scope[];
  readonly source: SourceText;
  readonly symbols: SemanticSymbol[];
}

export class SemanticReferences {
  private readonly host: SemanticReferencesHost;

  constructor(host: SemanticReferencesHost) {
    this.host = host;
  }

  describeMembers(memberTypes: ReadonlyMap<string, ValueType>): readonly SemanticMember[] {
    const cached = this.host.describedMemberCache.get(memberTypes);
    if (cached) return cached;
    const described = [...memberTypes].slice(0, MAX_SEMANTIC_MEMBERS).map(([memberName, memberType]) => ({
      name: memberName,
      kind: memberType.kind === "function" || memberType.kind === "intrinsic" || memberType.kind === "action" ? "method" as const : "field" as const,
      type: describeType(memberType),
    }));
    this.host.describedMemberCache.set(memberTypes, described);
    return described;
  }

  callable(type: ValueType | undefined): boolean {
    return type?.kind === "function" || type?.kind === "intrinsic" || type?.kind === "action";
  }

  semanticIdentity(type: ValueType | undefined): string | null {
    if (type?.kind === "extension" && type.nominal) {
      return `${type.extensionId}:${type.family}:${type.nominal}`;
    }
    if (!type || !("identity" in type) || typeof type.identity !== "string") return null;
    return type.identity;
  }

  lookup(name: string): SemanticSymbol | null {
    for (let index = this.host.scopes.length - 1; index >= 0; index -= 1) {
      const found = this.host.scopes[index]!.bindings.get(name);
      if (found) return found;
    }
    return null;
  }

  reference(name: string, valueSpan: Span, write = false, call = false): void {
    this.host.references.push({ name, path: this.host.source.path, span: valueSpan, symbolId: this.lookup(name)?.id ?? null, write, ...(call ? { call: true as const } : {}) });
  }

  typeSyntaxReferences(syntax: TypeSyntax): void {
    switch (syntax.kind) {
      case "NamedTypeSyntax":
        if (this.lookup(syntax.name)) this.reference(syntax.name, syntax.span);
        break;
      case "EnumMemberTypeSyntax":
        // A qualified path — `library.Status.pending` — names its owner through
        // a namespace, which the analyzer refuses; the head is the binding the
        // index records, and the segments behind it name nothing local.
        if (syntax.qualifiers?.length) {
          const head = syntax.qualifiers[0]!;
          if (this.lookup(head.name)) this.reference(head.name, head.span);
          for (const argument of syntax.arguments ?? []) this.typeSyntaxReferences(argument);
          break;
        }
        if (this.lookup(syntax.enumName)) this.reference(syntax.enumName, syntax.enumNameSpan);
        {
          const owner = this.lookup(syntax.enumName);
          const bindingType = owner ? this.host.bindingTypes.get(semanticBindingKey(owner.span, owner.name)) : null;
          const identity = bindingType?.kind === "enumObject" ? bindingType.identity : syntax.enumName;
          const localMember = owner?.kind === "enum"
            ? this.host.symbols.find((symbol) => symbol.kind === "enum-member" && symbol.container === owner.name && symbol.name === syntax.member)
            : null;
          if (localMember) {
            this.host.references.push({ name: syntax.member, path: this.host.source.path, span: syntax.memberSpan, symbolId: localMember.id, write: false });
          }
        this.host.memberReferences.push({
          name: syntax.member,
          path: this.host.source.path,
          span: syntax.memberSpan,
          ownerType: syntax.enumName,
          ownerKind: "enum",
          ownerIdentity: identity,
          syntax: "access",
          shorthand: false,
        });
        }
        // A path may carry its own argument list, and the names inside it are
        // ordinary type this.host.references — the same walk `GenericTypeSyntax` makes.
        for (const argument of syntax.arguments ?? []) this.typeSyntaxReferences(argument);
        break;
      case "GenericTypeSyntax":
        if (this.lookup(syntax.name)) this.reference(syntax.name, syntax.nameSpan);
        for (const argument of syntax.arguments) this.typeSyntaxReferences(argument);
        break;
      case "ReadonlyTypeSyntax":
      case "OptionalTypeSyntax":
        this.typeSyntaxReferences(syntax.inner);
        break;
      case "UnionTypeSyntax":
        for (const member of syntax.members) this.typeSyntaxReferences(member);
        break;
      case "FunctionTypeSyntax":
        for (const parameter of syntax.parameters) this.typeSyntaxReferences(parameter.type);
        this.typeSyntaxReferences(syntax.result);
        break;
    }
  }

  typeReferences(type: TypeReference | null): void {
    if (type) this.typeSyntaxReferences(type.syntax);
  }

  nameSpan(span: Span, name: string, from = span.start): Span {
    return findNameSpan(this.host.source.text, span, name, from);
  }

  recordMemberReference(
    name: string,
    referenceSpan: Span,
    owner: ValueType,
    syntax: SemanticMemberReference["syntax"],
    shorthand = false,
  ): void {
    const extensionOwner = owner.kind === "extension" ? owner : null;
    const ownerIdentity = this.semanticIdentity(owner);
    this.host.memberReferences.push({
      name,
      path: this.host.source.path,
      span: referenceSpan,
      ownerType: extensionOwner?.nominal ?? ("name" in owner ? owner.name : describeType(owner)),
      ownerKind: owner.kind,
      ...(ownerIdentity ? { ownerIdentity } : {}),
      ...(extensionOwner?.metadata?.semanticSymbolKind
        ? { ownerSymbolKind: extensionOwner.metadata.semanticSymbolKind as SemanticSymbolKind }
        : {}),
      syntax,
      shorthand,
    });
  }

  moduleSourceSpan(valueSpan: Span): Span {
    return valueSpan.end - valueSpan.start >= 2
    ? { start: valueSpan.start + 1, end: valueSpan.end - 1 }
    : valueSpan;
  }
}

export function wordSpans(text: string, valueSpan: Span): Span[] {
  const value = text.slice(valueSpan.start, valueSpan.end);
  return [...value.matchAll(/[A-Za-z_$][A-Za-z0-9_$]*/gu)].map((match) => {
    const start = valueSpan.start + (match.index ?? 0);
    return { start, end: start + match[0].length };
  });
}

function findNameSpan(text: string, valueSpan: Span, name: string, from: number): Span {
  const startAt = Math.max(valueSpan.start, from);
  const value = text.slice(startAt, valueSpan.end);
  const pattern = new RegExp(`(?:^|[^A-Za-z0-9_$])(${escapeRegExp(name)})(?![A-Za-z0-9_$])`, "u");
  const match = pattern.exec(value);
  if (!match) return { start: startAt, end: Math.min(valueSpan.end, startAt + name.length) };
  const prefix = match[0].length - match[1]!.length;
  const start = startAt + match.index + prefix;
  return { start, end: start + name.length };
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}
