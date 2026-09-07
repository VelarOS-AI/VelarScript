/**
 * The two pattern languages: the binding patterns `const`, `let` and `for`
 * destructure with, and the match patterns a `match` case is written in.
 *
 * They are separate grammars on purpose — a binding always succeeds and names
 * things, a match pattern asks a question — so neither refers to the other.
 */
import type { Span } from "../../source.ts";
import type { LiteralExpression, MemberExpression } from "./expressions.ts";
import type { TypeReference } from "./types.ts";

export type BindingPattern = NameBindingPattern | ObjectBindingPattern | ListBindingPattern;

export interface NameBindingPattern {
  readonly kind: "NameBindingPattern";
  readonly name: string;
  readonly span: Span;
}

export interface ObjectBindingPattern {
  readonly kind: "ObjectBindingPattern";
  readonly entries: readonly ObjectBindingEntry[];
  readonly rest: NameBindingPattern | null;
  readonly span: Span;
}

export interface ObjectBindingEntry {
  readonly property: string;
  readonly pattern: BindingPattern;
  readonly span: Span;
}

export interface ListBindingPattern {
  readonly kind: "ListBindingPattern";
  readonly elements: readonly (BindingPattern | null)[];
  readonly rest: NameBindingPattern | null;
  readonly span: Span;
}

export type MatchPattern =
  | MatchValuePattern
  | MatchTypePattern
  | MatchObjectPattern
  | MatchListPattern
  | MatchWildcardPattern
  | MatchCapturePattern
  | MatchAsPattern;

export interface MatchValuePattern {
  readonly kind: "MatchValuePattern";
  readonly values: readonly MatchValue[];
  readonly span: Span;
}

export interface MatchTypePattern {
  readonly kind: "MatchTypePattern";
  readonly type: TypeReference;
  readonly span: Span;
}

export interface MatchObjectPattern {
  readonly kind: "MatchObjectPattern";
  readonly entries: readonly MatchObjectEntry[];
  readonly rest: MatchBinding | null;
  readonly span: Span;
}

export interface MatchObjectEntry {
  readonly property: string;
  readonly pattern: MatchPattern;
  readonly span: Span;
}

export interface MatchListPattern {
  readonly kind: "MatchListPattern";
  readonly elements: readonly MatchPattern[];
  readonly rest: MatchBinding | null;
  readonly span: Span;
}

export interface MatchWildcardPattern {
  readonly kind: "MatchWildcardPattern";
  readonly span: Span;
}

export interface MatchCapturePattern {
  readonly kind: "MatchCapturePattern";
  readonly binding: MatchBinding;
  readonly span: Span;
}

export interface MatchAsPattern {
  readonly kind: "MatchAsPattern";
  readonly pattern: MatchPattern;
  readonly binding: MatchBinding;
  readonly span: Span;
}

export interface MatchBinding {
  readonly name: string;
  readonly span: Span;
}

export type MatchValue = LiteralExpression | MemberExpression;
