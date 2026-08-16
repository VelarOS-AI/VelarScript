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

export function keyframesCanonical(expression: WebKeyframesExpression, values: KeyframeStaticValues = NO_STATIC_VALUES): string {
  return [...expression.stops]
    .sort((left, right) => Math.min(...left.offsets) - Math.min(...right.offsets))
    .map((stop) => `${[...stop.offsets].sort((left, right) => left - right).join(",")}{${stop.entries
      .map((entry) => `${entry.name}:${keyframeCssValue(entry.value, values) ?? "?"}`)
      .join(";")}}`)
    .join("|");
}

export function keyframesName(canonical: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < canonical.length; index += 1) {
    hash ^= canonical.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `velar-kf-${hash.toString(16).padStart(8, "0")}`;
}
