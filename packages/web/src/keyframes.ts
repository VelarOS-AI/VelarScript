import type { Expression } from "@velarscript/compiler/extension";
import type { WebKeyframesExpression } from "./ast.ts";
import { lookStaticCssValue, type LookStaticValue } from "./look-static.ts";

/** The const bindings a stop may name: this module's, plus imported ones. */
export type KeyframeStaticValues = ReadonlyMap<string, LookStaticValue>;

const NO_STATIC_VALUES: KeyframeStaticValues = new Map();

/**
 * Static CSS spelling accepted inside a generated `@keyframes` rule. Charter
 * section 17 promises a stop reuses the Look property and value checker, so
 * this is that checker (`lookStaticCssValue`) rather than a second, narrower
 * grammar: the same literals, unit values, arithmetic, builder calls, named
 * arguments, and const design tokens a Look property accepts.
 */
export function keyframeCssValue(expression: Expression, values: KeyframeStaticValues = NO_STATIC_VALUES): string | null {
  return lookStaticCssValue(expression, values);
}

/**
 * The identity of a keyframes structure: equal structures produce equal text
 * and different structures never do. Injectivity is the whole job, so the
 * form is JSON rather than a delimiter-joined string. Joining raw values with
 * `:`, `;`, `{`, `}`, and `|` let one stop's value forge another structure's
 * spelling — `transform = "a}|100{transform:b"` canonicalized exactly as a
 * two-stop animation did, so both received one name, one rule was emitted, and
 * the second animation silently played the first (LOK-U11). JSON escapes the
 * delimiters inside a value, which is what makes the mapping one to one.
 */
export function keyframesCanonical(expression: WebKeyframesExpression, values: KeyframeStaticValues = NO_STATIC_VALUES): string {
  return JSON.stringify([...expression.stops]
    .sort((left, right) => Math.min(...left.offsets) - Math.min(...right.offsets))
    .map((stop) => [
      [...stop.offsets].sort((left, right) => left - right),
      stop.entries.map((entry) => [entry.name, keyframeCssValue(entry.value, values)]),
    ]));
}

const FNV_OFFSET = 0x6c62272e07bb014262b821756295c58dn;
const FNV_PRIME = 0x0000000001000000000000000000013bn;
const FNV_MASK = (1n << 128n) - 1n;

/**
 * A 128-bit FNV-1a over the canonical form, written as 32 hex digits. The
 * name is a promise that equal structures share one rule, which a 32-bit hash
 * could not keep: two unrelated animations in one application collide by
 * accident often enough to matter, and a collision here is not a build error
 * but a component playing another component's motion.
 */
export function keyframesName(canonical: string): string {
  let hash = FNV_OFFSET;
  for (let index = 0; index < canonical.length; index += 1) {
    hash = ((hash ^ BigInt(canonical.charCodeAt(index))) * FNV_PRIME) & FNV_MASK;
  }
  return `velar-kf-${hash.toString(16).padStart(32, "0")}`;
}
