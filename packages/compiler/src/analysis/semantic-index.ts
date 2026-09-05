/**
 * What the editor is told about a program: the type at every expression, the
 * type and members of every binding, and the member roster a completion offers
 * for a receiver.
 *
 * D115 §三: these were five private and protected methods of `Analyzer` writing
 * six side tables. They are not type checking — nothing here can refuse a
 * program — so they are their own collaborator, and `analyzer.ts` keeps only
 * the accessors the compiler's semantic index reads them back through.
 *
 * D114 F4: the roster itself is not decided here. It was, once — with its own
 * member lists, its own class-chain walk, and its own enum and `Type<T>` member
 * construction — and it disagreed with the checker about the List pipeline
 * members, about a private field read through an applied receiver, and about a
 * `type` alias of an enum. `PublishedMembers` answers both questions now, so
 * what the editor offers is what a read of it would resolve.
 */
import { type Expression } from "../ast.ts";
import { type PublishedMembers } from "./published-members.ts";
import { spanIdentity } from "../source.ts";
import {
  type ValueType,
  nonOptional,
  semanticTypeIdentity,
} from "../types.ts";

/** What the semantic recorder asks of the analyzer that hosts it, and nothing more. */
export interface SemanticIndexRecorderHost {
  readonly currentClass: string | null;
  expandAliases(type: ValueType, seen?: ReadonlySet<string>): ValueType;
  isSubclassOf(actual: string, expected: string): boolean;
  /**
   * The one answer to "what does this receiver publish", shared with the type
   * checker. The editor's roster is that answer enumerated, never a second
   * reading of the same declarations.
   */
  readonly published: PublishedMembers;
  readonly semanticBindingMembers: Map<string, ReadonlyMap<string, ValueType>>;
  readonly semanticBindingTypes: Map<string, ValueType>;
  readonly semanticExpressionContexts: Map<string, ValueType>;
  readonly semanticExpressionMembers: Map<string, ReadonlyMap<string, ValueType>>;
  readonly semanticExpressionTypes: Map<string, ValueType>;
  readonly semanticMemberCache: Map<string, ReadonlyMap<string, ValueType>>;
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

  /**
   * The members a receiver publishes, cached per type. The private half of the
   * key is the class under analysis: a private member is published to a read
   * inside its own class and to nothing else, so one receiver has two answers
   * and they must not share a cache entry.
   */
  semanticMembersOf(original: ValueType): ReadonlyMap<string, ValueType> {
    const privateContext = this.privateSemanticContext(original);
    const key = `${semanticTypeIdentity(original)}:private:${privateContext ?? ""}`;
    const cached = this.host.semanticMemberCache.get(key);
    if (cached) return cached;
    const members = this.host.published.roster(original);
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
}
