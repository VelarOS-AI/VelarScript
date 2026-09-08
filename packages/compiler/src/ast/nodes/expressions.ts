/**
 * Every expression node Core's grammar produces, together with the small
 * unions written entirely out of them — an object entry, an f-string part, the
 * three things an assignment may target.
 *
 * The roster of these kinds is `ast/constructs.ts`; the union they form,
 * along with the opaque extension node, is `nodes/base.ts`.
 */
import type { Span } from "../../source.ts";
import type { Expression, Parameter } from "./base.ts";
import type { AssignmentStatement } from "./statements.ts";
import type { TypeReference } from "./types.ts";

/** D79 rule 199: Core's duration literal is a declared AST node, not a cast. */
export interface CoreDurationExpression {
  readonly kind: "ExtensionExpression:core:duration";
  readonly value: number;
  readonly unit: "ms" | "s";
  readonly raw: string;
  readonly span: Span;
}

export interface LiteralExpression {
  readonly kind: "LiteralExpression";
  readonly value: string | number | boolean | null;
  readonly raw: string;
  readonly span: Span;
}

export interface FStringExpression {
  readonly kind: "FStringExpression";
  readonly parts: readonly FStringPart[];
  readonly span: Span;
}

export type FStringPart =
  | { readonly kind: "text"; readonly value: string }
  | { readonly kind: "expression"; readonly value: Expression };

export interface IdentifierExpression {
  readonly kind: "IdentifierExpression";
  readonly name: string;
  readonly span: Span;
}

export interface SuperExpression {
  readonly kind: "SuperExpression";
  readonly span: Span;
}

export interface DynamicImportExpression {
  readonly kind: "DynamicImportExpression";
  readonly source: string;
  readonly sourceSpan: Span;
  readonly span: Span;
}

export interface ListExpression {
  readonly kind: "ListExpression";
  readonly elements: readonly Expression[];
  readonly span: Span;
}

export interface ObjectExpression {
  readonly kind: "ObjectExpression";
  readonly properties: readonly ObjectEntry[];
  readonly span: Span;
}

export type ObjectEntry = ObjectProperty | ObjectSpread;

export interface ObjectProperty {
  readonly kind: "ObjectProperty";
  readonly name: string;
  readonly value: Expression;
  /** Written as `{name}`: the field name and the binding it reads are one word. */
  readonly shorthand?: boolean;
  /** Written explicitly as `{name: name}` with ordinary identifier tokens on both sides. */
  readonly sameNameIdentifierValue?: boolean;
  readonly span: Span;
}

export interface ObjectSpread {
  readonly kind: "ObjectSpread";
  readonly value: Expression;
  readonly span: Span;
}

export interface SpreadExpression {
  readonly kind: "SpreadExpression";
  readonly value: Expression;
  readonly span: Span;
}

export interface UnaryExpression {
  readonly kind: "UnaryExpression";
  readonly operator: "not" | "+" | "-" | "~" | "await";
  readonly operand: Expression;
  readonly span: Span;
}

/**
 * D86 rule 212: `value!` is the required-value unwrap — `T?` in, `T` out, and
 * an `AssertionError` at the moment the value turns out to be absent. It is
 * the expression-position counterpart of `assert value != null`, which stays
 * the spelling for a contract that carries its own message.
 */
export interface RequiredExpression {
  readonly kind: "RequiredExpression";
  readonly value: Expression;
  readonly span: Span;
}

/**
 * D39 item 51: `try <postfix-expression>` turns an expected failure into
 * `null`. It carries the same reach as `await` — the whole postfix chain — and
 * its result must be consumed, so a swallowed failure is always visible where
 * it is handled.
 */
export interface TryExpression {
  readonly kind: "TryExpression";
  readonly value: Expression;
  readonly span: Span;
}

export interface BinaryExpression {
  readonly kind: "BinaryExpression";
  readonly left: Expression;
  readonly operator: "??" | "or" | "and" | "in" | "not in" | "==" | "!=" | "<" | "<=" | ">" | ">=" | "|" | "^" | "&" | "<<" | ">>" | ">>>" | "+" | "-" | "*" | "**" | "/" | "%";
  readonly right: Expression;
  /**
   * Present when the author wrote explicit parentheses around this binary
   * expression. The parser uses it to tell a deliberate grouping from a bare
   * chain when `??` mixes with `and`/`or`; emission is unaffected.
   */
  readonly parenthesized?: true;
  readonly span: Span;
}

/**
 * A parse recovery for an assignment written where an expression is required
 * (an interpolated fragment or an arrow body). The parser reports directive
 * guidance and keeps the assignment shape so later stages can add their own
 * guidance; it never reaches code generation.
 */
export interface AssignmentExpression {
  readonly kind: "AssignmentExpression";
  readonly target: Expression;
  readonly operator: AssignmentStatement["operator"];
  readonly value: Expression;
  readonly span: Span;
}

export interface ComparisonChainExpression {
  readonly kind: "ComparisonChainExpression";
  readonly operands: readonly Expression[];
  readonly operators: readonly ("==" | "!=" | "<" | "<=" | ">" | ">=")[];
  readonly parenthesized?: true;
  readonly span: Span;
}

export interface ConditionalExpression {
  readonly kind: "ConditionalExpression";
  readonly condition: Expression;
  readonly thenValue: Expression;
  readonly elseValue: Expression;
  readonly span: Span;
}

export interface IsExpression {
  readonly kind: "IsExpression";
  readonly value: Expression;
  readonly operator: "is" | "is not";
  readonly type: TypeReference;
  readonly parenthesized?: true;
  readonly span: Span;
}

export interface ArrowFunctionExpression {
  readonly kind: "ArrowFunctionExpression";
  readonly asynchronous: boolean;
  readonly parameters: readonly Parameter[];
  readonly body: Expression;
  readonly span: Span;
}

export interface CallExpression {
  readonly kind: "CallExpression";
  readonly callee: Expression;
  readonly arguments: readonly Expression[];
  readonly argumentNames?: readonly (string | null)[];
  /** The written labels, independent of whitespace or comments before values. */
  readonly argumentNameSpans?: readonly (Span | null)[];
  readonly optional: boolean;
  /**
   * The call was written with explicit type arguments, which VEL2031 removed
   * as it recovered. The author did name the types, so a later rule that
   * reports a missing one stays quiet rather than reporting the same mistake
   * a second time.
   */
  readonly typeArgumentsRemoved?: boolean;
  readonly span: Span;
}

export interface MemberExpression {
  readonly kind: "MemberExpression";
  readonly object: Expression;
  readonly property: string;
  readonly optional: boolean;
  readonly span: Span;
}

export interface IndexExpression {
  readonly kind: "IndexExpression";
  readonly object: Expression;
  readonly index: Expression;
  readonly optional: boolean;
  readonly span: Span;
}

export type AssignmentTarget = IdentifierExpression | MemberExpression | IndexExpression;
