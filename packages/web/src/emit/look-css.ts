/**
 * The CSS a `look:` value lowers to: the condition terms a Look condition
 * decomposes into, the token that names one lowered rule, and the selector,
 * media query and declaration that rule is written as.
 *
 * D115 P4 R3d: these are pure functions over the Look AST and the module's
 * static values — no emitter state reaches them — so both `emit/look.ts` (the
 * stylesheet) and `emit/jsx.ts` (an inline `look:` attribute) read the same
 * lowering rather than two spellings of it.
 */
import type { Expression } from "@velarscript/compiler/extension";
import { LOOK_MEDIA_LENGTH_UNITS } from "../look.ts";
import { evaluateLookStaticExpression, lookStaticCss, type LookStaticValue } from "../look-static.ts";
import { isWebExpression } from "../ast.ts";

export interface LookStaticAtom {
  readonly kind: "hook" | "media" | "scheme" | "motion";
  readonly name: string;
  readonly operator?: "<" | "<=" | ">" | ">=";
  readonly value?: string;
  readonly negated: boolean;
}

export interface LookRuntimeAtom {
  readonly expression: Expression;
  readonly negated: boolean;
}

export interface LookConditionTerm {
  readonly staticAtoms: readonly LookStaticAtom[];
  readonly runtimeAtoms: readonly LookRuntimeAtom[];
}

export interface LookRule {
  readonly token: string;
  readonly property: string;
  readonly target: string;
  readonly staticAtoms: readonly LookStaticAtom[];
  /** Declaration order of the token's first appearance, the last tie-break. */
  readonly sequence: number;
}

export const EMPTY_LOOK_TERM: LookConditionTerm = Object.freeze({ staticAtoms: [], runtimeAtoms: [] });
const LOOK_CONDITION_TERM_LIMIT = 32;

export function lookConditionTerms(
  expression: Expression,
  negated = false,
  staticValues: ReadonlyMap<string, LookStaticValue> = new Map(),
): readonly LookConditionTerm[] {
  if (expression.kind === "UnaryExpression" && expression.operator === "not") return lookConditionTerms(expression.operand, !negated, staticValues);
  if (expression.kind === "BinaryExpression" && (expression.operator === "and" || expression.operator === "or")) {
    const conjunction = (expression.operator === "and") !== negated;
    const left = lookConditionTerms(expression.left, negated, staticValues);
    const right = lookConditionTerms(expression.right, negated, staticValues);
    return conjunction ? combineLookTerms(left, right) : [...left, ...right].slice(0, LOOK_CONDITION_TERM_LIMIT);
  }
  if (isWebExpression(expression) && expression.kind === "ExtensionExpression:web:look-hook") {
    return [{ staticAtoms: [{ kind: "hook", name: expression.name, negated }], runtimeAtoms: [] }];
  }
  const media = viewportAtom(expression, negated, staticValues) ?? schemeAtom(expression, negated);
  if (media) return [{ staticAtoms: [media], runtimeAtoms: [] }];
  return [{ staticAtoms: [], runtimeAtoms: [{ expression, negated }] }];
}

// A breakpoint is complementary the way the schemes and the motion preference
// are: `not (width <= X)` is `width > X`, one condition with one media query.
// The atom therefore folds the negation into its operator at construction, so
// the two spellings reach `lookToken` as the same token instead of as two
// rules that tie on specificity and are separated by source order.
const LOOK_NEGATED_MEDIA_OPERATORS: ReadonlyMap<string, "<" | "<=" | ">" | ">="> = new Map([
  ["<", ">="], ["<=", ">"], [">", "<="], [">=", "<"],
]);

function viewportAtom(expression: Expression, negated: boolean, staticValues: ReadonlyMap<string, LookStaticValue>): LookStaticAtom | null {
  if (expression.kind !== "BinaryExpression" || !["<", "<=", ">", ">="].includes(expression.operator)) return null;
  if (expression.left.kind !== "MemberExpression" || expression.left.object.kind !== "IdentifierExpression" || expression.left.object.name !== "viewport") return null;
  if (expression.left.property !== "width" && expression.left.property !== "height") return null;
  const threshold = evaluateLookStaticExpression(expression.right, staticValues);
  if (threshold?.kind !== "unit" || !LOOK_MEDIA_LENGTH_UNITS.has(threshold.unit)) return null;
  const written = expression.operator as "<" | "<=" | ">" | ">=";
  return {
    kind: "media",
    name: expression.left.property,
    operator: negated ? LOOK_NEGATED_MEDIA_OPERATORS.get(written)! : written,
    value: lookStaticCss(threshold)!,
    negated: false,
  };
}

// 'scheme.dark' / 'scheme.light' lower to prefers-color-scheme media atoms.
// The two subjects are complementary, so negation flips to the other scheme
// and the atom itself stays canonical.
function schemeAtom(expression: Expression, negated: boolean): LookStaticAtom | null {
  if (expression.kind !== "MemberExpression" || expression.object.kind !== "IdentifierExpression") return null;
  // LOK-U3: 'motion.reduced' joins the media subjects. prefers-reduced-motion is
  // complementary in the same way the schemes are, so negation names the other
  // side of the query rather than wrapping it.
  if (expression.object.name === "motion") {
    return expression.property === "reduced" ? { kind: "motion", name: negated ? "no-preference" : "reduce", negated: false } : null;
  }
  if (expression.object.name !== "scheme") return null;
  if (expression.property !== "dark" && expression.property !== "light") return null;
  const scheme = negated ? (expression.property === "dark" ? "light" : "dark") : expression.property;
  return { kind: "scheme", name: scheme, negated: false };
}

export function combineLookTerms(left: readonly LookConditionTerm[], right: readonly LookConditionTerm[]): readonly LookConditionTerm[] {
  const combined: LookConditionTerm[] = [];
  for (const first of left) {
    for (const second of right) {
      combined.push({
        staticAtoms: [...first.staticAtoms, ...second.staticAtoms],
        runtimeAtoms: [...first.runtimeAtoms, ...second.runtimeAtoms],
      });
      if (combined.length >= LOOK_CONDITION_TERM_LIMIT) return combined;
    }
  }
  return combined;
}

export function lookToken(atoms: readonly LookStaticAtom[], target: string, property: string): string {
  const conditions = atoms.map((atom) => {
    if (atom.kind === "hook") return `${atom.negated ? "not-" : ""}${kebab(atom.name)}`;
    if (atom.kind === "scheme") return `scheme-${atom.name}`;
    if (atom.kind === "motion") return `motion-${atom.name}`;
    return `viewport-${atom.name}-${lookOperatorName(atom.operator!)}-${atom.value}`;
  }).sort();
  const prefix = [target ? kebab(target) : "", conditions.length > 0 ? conditions.join("+") : "base"].filter(Boolean).join(":");
  return `${prefix}:${property}`;
}

/**
 * How many extra `[data-velar-look]` selectors a rule carries, so that the
 * winner between two Look rules is decided by the conditions they name rather
 * than by their position in the sheet.
 *
 * The bump used to be a single flat `+1` for any non-empty condition set, which
 * made every conditional rule specificity `(0,2,0)`: a state rule tied with a
 * media rule, and a two-condition refinement tied with the one-condition
 * fallback it refines. Ties then fell through to source order, and source order
 * is per-module concatenation order, which the CLI sorts by filename — so the
 * rendered colour could change when a file was renamed (LOK-U8, LOK-U10,
 * LOK-U12).
 *
 * The rank is base < media < state < media+state, and within a rank a rule that
 * names more conditions outranks one that names fewer. The per-rank span is
 * bounded so a pathological condition count cannot cross a rank boundary; rules
 * that saturate it fall back to declaration order, which is stable.
 */
const LOOK_RANK_SPAN = 3;

export function lookConditionDepth(atoms: readonly LookStaticAtom[]): number {
  if (atoms.length === 0) return 0;
  const hooks = atoms.filter((atom) => atom.kind === "hook").length;
  const media = atoms.length - hooks;
  const rank = hooks > 0 ? (media > 0 ? 2 : 1) : 0;
  return rank * LOOK_RANK_SPAN + Math.min(atoms.length, LOOK_RANK_SPAN);
}

function lookVariable(token: string): string {
  return `--velar-look-${token.replace(/[^A-Za-z0-9_-]+/gu, "-")}`;
}

export function lookDeclaration(token: string, property: string): string {
  const value = `var(${lookVariable(token)})`;
  return `${property}:${value}`;
}

function lookOperatorName(operator: "<" | "<=" | ">" | ">="): string {
  return operator === "<" ? "lt" : operator === "<=" ? "lte" : operator === ">" ? "gt" : "gte";
}

export function lookMediaQuery(atom: LookStaticAtom): string {
  if (atom.kind === "scheme") return `(prefers-color-scheme: ${atom.name})`;
  if (atom.kind === "motion") return `(prefers-reduced-motion: ${atom.name})`;
  return `(${atom.name} ${atom.operator!} ${atom.value})`;
}

export function lookSelectors(base: string, atoms: readonly LookStaticAtom[], target: string): readonly string[] {
  let selectors = [base];
  for (const atom of atoms) {
    const states = lookHookSelectors(atom.name);
    if (atom.negated) {
      const condition = states.map((state) => `:not(${state})`).join("");
      selectors = selectors.map((selector) => `${selector}:where(${condition})`);
    } else {
      selectors = selectors.flatMap((selector) => states.map((state) => `${selector}:where(${state})`));
    }
  }
  const suffix = target ? LOOK_TARGET_SELECTORS.get(target) ?? `::${kebab(target)}` : "";
  return selectors.map((selector) => `${selector}${suffix}`);
}

function lookHookSelectors(name: string): readonly string[] {
  if (name === "focusVisible") return [":focus-visible"];
  if (name === "current") return ["[aria-current=\"page\"]"];
  if (name === "disabled") return [":disabled", "[aria-disabled=\"true\"]"];
  if (name === "checked") return [":checked", "[aria-checked=\"true\"]"];
  if (name === "invalid") return [":invalid", "[aria-invalid=\"true\"]"];
  if (name === "open") return [":open", "[open]", "[aria-expanded=\"true\"]"];
  return [`:${kebab(name)}`];
}

const LOOK_TARGET_SELECTORS = new Map<string, string>([
  ["before", "::before"], ["after", "::after"], ["backdrop", "::backdrop"], ["placeholder", "::placeholder"], ["selection", "::selection"],
  ["marker", "::marker"], ["fileSelectorButton", "::file-selector-button"],
]);

function kebab(value: string): string {
  return value.replace(/[A-Z]/gu, (character) => `-${character.toLowerCase()}`);
}
