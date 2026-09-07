/**
 * Written type syntax: the reference a declaration carries, every form the
 * reference may take, and the type-parameter list `def`, `type` and `class`
 * all share.
 *
 * This is syntax, not meaning — what the analyzer makes of it is
 * `types/from-syntax.ts` and the `ValueType` model beside it. Nothing here
 * reads another AST family, so this file is the one part of `ast/nodes` that
 * stands alone.
 */
import type { Span } from "../../source.ts";

export interface TypeParameterDeclaration {
  readonly name: string;
  /** The bound written as `<T: Text>`; always a name from the closed vocabulary. */
  readonly bound?: string;
  readonly boundSpan?: Span;
  readonly span: Span;
}

export interface TypeReference {
  readonly syntax: TypeSyntax;
  readonly span: Span;
}

export type TypeSyntax = NamedTypeSyntax | EnumMemberTypeSyntax | GenericTypeSyntax | ReadonlyTypeSyntax | OptionalTypeSyntax | UnionTypeSyntax | FunctionTypeSyntax;

export interface NamedTypeSyntax {
  readonly kind: "NamedTypeSyntax";
  readonly name: string;
  readonly span: Span;
}

/** One dotted segment of a type reference path. */
export interface TypeNameSegment {
  readonly name: string;
  readonly span: Span;
}

/**
 * A dotted type reference. It was introduced for the enum singleton type
 * `Status.pending` and carries the namespace-qualified spelling `library.Box`
 * as well, which the analyzer refuses with the import-by-name guidance
 * (ENM-I9).
 */
export interface EnumMemberTypeSyntax {
  readonly kind: "EnumMemberTypeSyntax";
  /**
   * The segments written before `enumName`, outermost first, absent for the
   * two-segment path. A namespace-imported enum is spelled with three —
   * `library.Status.pending` — and it reaches the analyzer whole so it earns
   * the same one refusal `library.Status` earns.
   */
  readonly qualifiers?: readonly TypeNameSegment[];
  readonly enumName: string;
  readonly enumNameSpan: Span;
  readonly member: string;
  readonly memberSpan: Span;
  /**
   * The type-argument list written after the path, absent when none was
   * written. A member path takes its arguments from the same grammar a bare
   * name does, so `library.Box<string>` reaches the analyzer as one reference
   * that earns one refusal instead of stopping the statement at the `<`.
   */
  readonly arguments?: readonly TypeSyntax[];
  readonly span: Span;
}

export interface GenericTypeSyntax {
  readonly kind: "GenericTypeSyntax";
  readonly name: string;
  readonly nameSpan: Span;
  readonly arguments: readonly TypeSyntax[];
  readonly span: Span;
}

export interface ReadonlyTypeSyntax {
  readonly kind: "ReadonlyTypeSyntax";
  readonly inner: TypeSyntax;
  readonly span: Span;
}

export interface OptionalTypeSyntax {
  readonly kind: "OptionalTypeSyntax";
  readonly inner: TypeSyntax;
  readonly span: Span;
}

export interface UnionTypeSyntax {
  readonly kind: "UnionTypeSyntax";
  readonly members: readonly TypeSyntax[];
  readonly span: Span;
}

export interface FunctionTypeSyntax {
  readonly kind: "FunctionTypeSyntax";
  readonly parameters: readonly FunctionTypeParameterSyntax[];
  readonly result: TypeSyntax;
  readonly span: Span;
}

export interface FunctionTypeParameterSyntax {
  readonly name: string | null;
  readonly type: TypeSyntax;
  readonly rest: boolean;
  readonly optional: boolean;
  readonly span: Span;
}
