/**
 * A Look condition as the emitter will key it: the lowered atom each term
 * becomes, the scope key a whole condition folds to, and what a module's Look
 * declarations contribute to a property once every branch is read.
 *
 * D115 P4 R3a: the duplicate-property scope and the cascade both ask this, and
 * neither asks it of the analyzer's state, so it is written once here.
 */
import { type Expression, type Program, type Statement } from "@velarscript/compiler/extension";
import { isWebExpression, isWebLook, type WebLookExpression } from "../ast.ts";
import { evaluateLookStaticExpression, lookStaticCss, type LookStaticValue } from "../look-static.ts";
import { LOOK_MEDIA_LENGTH_UNITS } from "../look.ts";
import { isViewportComparison, lookKebab, lookRuntimeSignature } from "./media-conditions.ts";

/**
 * VEL5045: the selector/runtime terms one Look condition may expand to. A
 * conjunction multiplies its two sides, so nesting is what the cap is against.
 * Both readings of a condition stop there — the terms folded below, and the
 * count `look-sites.ts` takes — so neither can run away on a written nesting.
 */
export const LOOK_CONDITION_TERM_LIMIT = 32;

const lookOperatorNames: ReadonlyMap<string, string> = new Map([["<", "lt"], ["<=", "lte"], [">", "gt"], [">=", "gte"]]);
const lookNegatedOperators: ReadonlyMap<string, string> = new Map([["<", ">="], ["<=", ">"], [">", "<="], [">=", "<"]]);

/**
 * LOK-I5: the duplicate-property scope used to key on the *written* condition,
 * while the emitter keys its rules on the *lowered* one. `if scheme.dark:` and
 * `if not scheme.light:` are the same condition by the charter's own words, so
 * one silently overwrote the other and the loser was never reported. These
 * atoms mirror the emitter's lowering exactly — a scheme and a reduced-motion
 * negation name the other side of the query, and a negated breakpoint flips its
 * operator — so the scope key is the token the rule ends up carrying.
 */
function lookConditionAtom(
  expression: Expression,
  negated: boolean,
  staticValues: ReadonlyMap<string, LookStaticValue>,
): string | null {
  if (isWebExpression(expression) && expression.kind === "ExtensionExpression:web:look-hook") {
    return `${negated ? "not-" : ""}${lookKebab(expression.name)}`;
  }
  if (expression.kind === "MemberExpression" && expression.object.kind === "IdentifierExpression") {
    if (expression.object.name === "motion") {
      return expression.property === "reduced" ? `motion-${negated ? "no-preference" : "reduce"}` : null;
    }
    if (expression.object.name === "scheme" && (expression.property === "dark" || expression.property === "light")) {
      return `scheme-${negated ? (expression.property === "dark" ? "light" : "dark") : expression.property}`;
    }
    return null;
  }
  if (!isViewportComparison(expression)) return null;
  const comparison = expression as Extract<Expression, { kind: "BinaryExpression" }>;
  const threshold = evaluateLookStaticExpression(comparison.right, staticValues);
  if (threshold?.kind !== "unit" || !LOOK_MEDIA_LENGTH_UNITS.has(threshold.unit)) return null;
  const property = (comparison.left as Extract<Expression, { kind: "MemberExpression" }>).property;
  const operator = negated ? lookNegatedOperators.get(comparison.operator)! : comparison.operator;
  return `viewport-${property}-${lookOperatorNames.get(operator)!}-${lookStaticCss(threshold)!}`;
}

/**
 * One Look condition as the set of alternatives it lowers to, each alternative
 * being the sorted atoms that must hold together. Two conditions share a
 * duplicate-detection scope exactly when this rendering matches, so a condition
 * written the other way round, negated into its complement, or spelled with its
 * operands swapped lands in the scope its rule will actually occupy.
 */
export function lookConditionKey(
  expression: Expression,
  negated: boolean,
  staticValues: ReadonlyMap<string, LookStaticValue>,
): string {
  const terms = lookConditionTerms(expression, negated, staticValues);
  return terms.map((term) => [...term].sort().join("+")).sort().join("|");
}

function lookConditionTerms(
  expression: Expression,
  negated: boolean,
  staticValues: ReadonlyMap<string, LookStaticValue>,
): readonly (readonly string[])[] {
  if (expression.kind === "UnaryExpression" && expression.operator === "not") {
    return lookConditionTerms(expression.operand, !negated, staticValues);
  }
  if (expression.kind === "BinaryExpression" && (expression.operator === "and" || expression.operator === "or")) {
    const conjunction = (expression.operator === "and") !== negated;
    const left = lookConditionTerms(expression.left, negated, staticValues);
    const right = lookConditionTerms(expression.right, negated, staticValues);
    if (!conjunction) return [...left, ...right].slice(0, LOOK_CONDITION_TERM_LIMIT);
    const combined: (readonly string[])[] = [];
    for (const first of left) {
      for (const second of right) {
        combined.push([...first, ...second]);
        if (combined.length >= LOOK_CONDITION_TERM_LIMIT) return combined;
      }
    }
    return combined;
  }
  const atom = lookConditionAtom(expression, negated, staticValues);
  return [[atom ?? `rt:${negated ? "!" : ""}${lookRuntimeSignature(expression)}`]];
}

/**
 * Every `const name = look:` in the module, wherever it is written. A name
 * declared twice maps to null: two different Look literals under one name make
 * the composition question unanswerable, so the check that reads this map
 * declines rather than guessing which one an element received.
 */
export function collectLookDeclarations(program: Program): ReadonlyMap<string, WebLookExpression | null> {
  const looks = new Map<string, WebLookExpression | null>();
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }
    if (!value || typeof value !== "object") return;
    const record = value as Record<string, unknown>;
    if (record.kind === "VariableDeclaration") {
      const declaration = record as unknown as Extract<Statement, { kind: "VariableDeclaration" }>;
      if (declaration.binding === "const" && declaration.pattern.kind === "NameBindingPattern" && isWebLook(declaration.initializer)) {
        looks.set(declaration.pattern.name, looks.has(declaration.pattern.name) ? null : declaration.initializer);
      }
    }
    for (const [key, child] of Object.entries(record)) if (key !== "span") visit(child);
  };
  visit(program.body);
  return looks;
}

/**
 * The properties one Look sets, each keyed by the target it sets them on so a
 * `@before:` colour and an element colour stay two different decisions. The
 * condition is deliberately not part of the key: two looks that set one
 * property under conditions that can both hold are exactly the ambiguity this
 * serves. A `...spread` of another look is followed, and the names followed are
 * reported back, because composing is what makes two looks ordered rather than
 * independent.
 */
export function lookContributions(
  look: WebLookExpression,
  looks: ReadonlyMap<string, WebLookExpression | null>,
  visited: ReadonlySet<string> = new Set(),
): { readonly properties: ReadonlySet<string>; readonly composed: ReadonlySet<string> } {
  const properties = new Set<string>();
  const composed = new Set<string>();
  const walk = (entries: WebLookExpression["entries"], target: string): void => {
    for (const entry of entries) {
      if (entry.kind === "LookProperty") properties.add(`${target}:${entry.name}`);
      else if (entry.kind === "LookIf") {
        walk(entry.thenEntries, target);
        walk(entry.elseEntries, target);
      } else if (entry.kind === "LookTarget") walk(entry.entries, entry.name);
      else if (entry.kind === "LookSpread" && entry.value.kind === "IdentifierExpression" && !visited.has(entry.value.name)) {
        const source = looks.get(entry.value.name);
        composed.add(entry.value.name);
        if (!source) continue;
        const inner = lookContributions(source, looks, new Set([...visited, entry.value.name]));
        for (const property of inner.properties) properties.add(property);
        for (const name of inner.composed) composed.add(name);
      }
    }
  };
  walk(look.entries, "");
  return { properties, composed };
}
