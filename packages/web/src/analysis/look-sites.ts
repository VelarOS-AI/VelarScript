/**
 * Where a module's Look values and Look imports are written, and the small
 * readings of one written value a check needs: the builder names in scope, a
 * condition's term count, the first relative CSS asset an unsafe stylesheet
 * addresses, and whether a declared domain mentions a spelled visual unit.
 *
 * D115 P4 R3a: each is a question about a program or a node rather than about
 * the analyzer, so they read as a module.
 */
import { semanticTypeIdentity, type Span } from "@velarscript/compiler";
import { type Expression, type Program, type ValueType } from "@velarscript/compiler/extension";
import { isWebUnit } from "../ast.ts";
import { cssTokens } from "../css-tokens.ts";
import { LOOK_BUILDERS, LOOK_NUMERIC_TYPE_NAMES } from "../look.ts";
import { LOOK_CONDITION_TERM_LIMIT } from "./look-conditions.ts";
import { lookAdditiveType } from "./look-values.ts";

/**
 * D103: where one Look value was written — which property it sets, the span of
 * the whole entry, and the directive spelling if it is one. A migration needs
 * all three, because a `look:property="text"` attribute and a
 * `property = "text"` block entry are rewritten differently.
 */
export interface LookValueSite {
  readonly property: string;
  readonly entrySpan: Span;
  readonly directive: "look" | "style" | null;
}

/**
 * D103: where a migration writes a `velar/look` import. `declaration` is the
 * module's existing import of that module when it has one, so the rewrite grows
 * that line rather than adding a second import of the same module; `insertAt`
 * is where a first one goes otherwise — after the last import, or before the
 * first statement of a module with none.
 */
export interface LookImportSite {
  readonly declaration: { readonly span: Span; readonly specifiers: readonly { readonly imported: string; readonly local: string }[] } | null;
  readonly insertAt: number;
  readonly leadingBlankLine: boolean;
}

export function collectLookImportSite(program: Program): LookImportSite {
  let lastImportEnd: number | null = null;
  for (const statement of program.body) {
    if (statement.kind !== "ImportDeclaration") continue;
    lastImportEnd = statement.span.end;
    if (statement.source !== "velar/look" || statement.javascript || statement.specifiers.some((specifier) => specifier.namespace)) continue;
    return {
      declaration: {
        span: statement.span,
        specifiers: statement.specifiers.map((specifier) => ({ imported: specifier.imported, local: specifier.local })),
      },
      insertAt: statement.span.end,
      leadingBlankLine: false,
    };
  }
  return lastImportEnd === null
    ? { declaration: null, insertAt: program.body[0]?.span.start ?? 0, leadingBlankLine: true }
    : { declaration: null, insertAt: lastImportEnd, leadingBlankLine: false };
}

/** Local names bound to a velar/look builder, including aliased imports. */
export function collectLookBuilderNames(program: Program): ReadonlyMap<string, string> {
  const names = new Map<string, string>();
  for (const statement of program.body) {
    if (statement.kind !== "ImportDeclaration" || statement.source !== "velar/look" || statement.javascript) continue;
    for (const specifier of statement.specifiers) {
      if (specifier.namespace || !LOOK_BUILDERS.has(specifier.imported)) continue;
      names.set(specifier.local, specifier.imported);
    }
  }
  return names;
}

export function lookConditionTermCount(expression: Expression, negated = false): number {
  if (expression.kind === "UnaryExpression" && expression.operator === "not") return lookConditionTermCount(expression.operand, !negated);
  if (expression.kind === "BinaryExpression" && (expression.operator === "and" || expression.operator === "or")) {
    const conjunction = (expression.operator === "and") !== negated;
    const left = lookConditionTermCount(expression.left, negated);
    const right = lookConditionTermCount(expression.right, negated);
    const total = conjunction ? left * right : left + right;
    return Math.min(LOOK_CONDITION_TERM_LIMIT + 1, total);
  }
  return 1;
}

export function firstRelativeCssAssetAddress(source: string): { readonly value: string; readonly syntax: string } | null {
  for (const token of cssTokens(source)) {
    if (token.kind !== "url" && token.kind !== "asset-address") continue;
    // A URL parser drops leading and trailing spaces, and an empty url() names
    // the document itself rather than an asset.
    const value = token.value.trim();
    if (value === "") continue;
    if (value.startsWith("/") || value.startsWith("#") || /^[a-z][a-z0-9+.-]*:/iu.test(value)) continue;
    return { value, syntax: token.kind === "url" ? "url" : token.syntax };
  }
  return null;
}

/** True when a property's declared domain includes a spelled visual unit type. */
export function mentionsLookUnitType(type: ValueType): boolean {
  if (type.kind === "named") return LOOK_NUMERIC_TYPE_NAMES.has(type.name) || type.name === "Spacing" || type.name === "TrackList" || type.name === "Track";
  if (type.kind === "union") return type.members.some(mentionsLookUnitType);
  if (type.kind === "optional") return mentionsLookUnitType(type.inner);
  return false;
}

export function lookLiteralZero(expression: Expression): boolean {
  if (expression.kind === "LiteralExpression") return expression.value === 0;
  if (expression.kind === "UnaryExpression" && (expression.operator === "-" || expression.operator === "+")) return lookLiteralZero(expression.operand);
  return isWebUnit(expression) && expression.value === 0;
}

export const lookJoin = (left: ValueType, right: ValueType): ValueType | null =>
  lookAdditiveType(left, right, semanticTypeIdentity(left) === semanticTypeIdentity(right));

export function containsCssImport(source: string): boolean {
  for (const token of cssTokens(source)) {
    if (token.kind === "at-keyword" && token.name.toLowerCase() === "import") return true;
  }
  return false;
}
