/**
 * Which Look properties write the same CSS declaration (D104 rule 2): the direct
 * containments, the closure over them, and what a refusal offers instead.
 */
import { LOOK_PROPERTIES } from "./properties.ts";
// ── D104 rule 2: which Look properties write the same CSS declaration ─────────
// A Look block reads like a rule, and it is not one. Every entry lowers to its
// own single-declaration rule at equal specificity — `[data-velar-look~="base:
// padding"]{padding:var(--…)}` — and those rules are sorted by condition rank
// first and by *first appearance anywhere in the module* second. So between two
// entries of equal rank the stylesheet's winner is decided by unrelated code:
// a look earlier in the file that happened to mention `paddingTop` puts
// `padding-top` ahead of `padding` for every look in the module, and a block
// that writes `padding` and then `paddingTop` gets the opposite of what it
// reads like. The order LOK-U8 pinned for conditions was never available
// between a shorthand and a longhand it writes.
//
// CSS resolves this with source order. Look cannot, because the rule for a
// property is shared by every look that uses it, so there is no per-block order
// to honour. That leaves one honest answer: two entries in one scope that write
// the same CSS longhand have no winner the author chose, which is exactly the
// defect VEL5039 already refuses when the two entries have the same name. This
// table is what makes the wider case decidable.
//
// Only *direct* containment is written; the closure below derives the rest, so
// `border` reaching `borderTopWidth` through `borderWidth` is not a third place
// to keep in step (D57 rule 134). Logical and physical boxes stay separate
// families: CSS cascades `inset-inline-start` and `left` independently, and
// pretending otherwise would refuse a pair the browser resolves by writing
// mode.
const lookDirectShorthands: readonly (readonly [string, readonly string[]])[] = [
  ["overflow", ["overflowX", "overflowY"]],
  ["overscrollBehavior", ["overscrollBehaviorX", "overscrollBehaviorY"]],
  ["flex", ["flexGrow", "flexShrink", "flexBasis"]],
  ["gap", ["rowGap", "columnGap"]],
  ["placeItems", ["alignItems", "justifyItems"]],
  ["placeContent", ["alignContent", "justifyContent"]],
  ["placeSelf", ["alignSelf", "justifySelf"]],
  ["inset", ["top", "right", "bottom", "left"]],
  ["insetInline", ["insetInlineStart", "insetInlineEnd"]],
  ["insetBlock", ["insetBlockStart", "insetBlockEnd"]],
  ["padding", ["paddingTop", "paddingRight", "paddingBottom", "paddingLeft"]],
  ["paddingInline", ["paddingInlineStart", "paddingInlineEnd"]],
  ["paddingBlock", ["paddingBlockStart", "paddingBlockEnd"]],
  ["margin", ["marginTop", "marginRight", "marginBottom", "marginLeft"]],
  ["marginInline", ["marginInlineStart", "marginInlineEnd"]],
  ["marginBlock", ["marginBlockStart", "marginBlockEnd"]],
  ["scrollMargin", ["scrollMarginTop", "scrollMarginRight", "scrollMarginBottom", "scrollMarginLeft"]],
  ["scrollPadding", ["scrollPaddingTop", "scrollPaddingRight", "scrollPaddingBottom", "scrollPaddingLeft"]],
  ["background", ["backgroundColor", "backgroundImage", "backgroundPosition", "backgroundSize", "backgroundRepeat", "backgroundAttachment", "backgroundOrigin", "backgroundClip"]],
  ["border", ["borderWidth", "borderStyle", "borderColor", "borderTop", "borderRight", "borderBottom", "borderLeft"]],
  ["borderWidth", ["borderTopWidth", "borderRightWidth", "borderBottomWidth", "borderLeftWidth"]],
  ["borderStyle", ["borderTopStyle", "borderRightStyle", "borderBottomStyle", "borderLeftStyle"]],
  ["borderColor", ["borderTopColor", "borderRightColor", "borderBottomColor", "borderLeftColor"]],
  ["borderTop", ["borderTopWidth", "borderTopStyle", "borderTopColor"]],
  ["borderRight", ["borderRightWidth", "borderRightStyle", "borderRightColor"]],
  ["borderBottom", ["borderBottomWidth", "borderBottomStyle", "borderBottomColor"]],
  ["borderLeft", ["borderLeftWidth", "borderLeftStyle", "borderLeftColor"]],
  // `outline` writes the three parts and leaves outlineOffset alone.
  ["outline", ["outlineWidth", "outlineStyle", "outlineColor"]],
  ["borderRadius", ["borderTopLeftRadius", "borderTopRightRadius", "borderBottomRightRadius", "borderBottomLeftRadius"]],
  ["textDecoration", ["textDecorationLine", "textDecorationStyle", "textDecorationColor", "textDecorationThickness"]],
  ["listStyle", ["listStyleType", "listStylePosition", "listStyleImage"]],
  ["transition", ["transitionProperty", "transitionDuration", "transitionTimingFunction", "transitionDelay"]],
  ["gridColumn", ["gridColumnStart", "gridColumnEnd"]],
  ["gridRow", ["gridRowStart", "gridRowEnd"]],
  ["gridArea", ["gridRow", "gridColumn"]],
];

function lookShorthandClosure(): ReadonlyMap<string, ReadonlySet<string>> {
  const direct = new Map(lookDirectShorthands.map(([shorthand, longhands]) => [shorthand, longhands] as const));
  const closed = new Map<string, ReadonlySet<string>>();
  const expand = (shorthand: string, seen: ReadonlySet<string>): ReadonlySet<string> => {
    const cached = closed.get(shorthand);
    if (cached) return cached;
    if (seen.has(shorthand)) throw new Error(`Look shorthand '${shorthand}' contains itself`);
    const inner = new Set([...seen, shorthand]);
    const reached = new Set<string>();
    for (const longhand of direct.get(shorthand) ?? []) {
      reached.add(longhand);
      if (direct.has(longhand)) for (const nested of expand(longhand, inner)) reached.add(nested);
    }
    closed.set(shorthand, reached);
    return reached;
  };
  for (const [shorthand] of direct) expand(shorthand, new Set());
  return closed;
}

/**
 * Every Look property a shorthand writes, transitively. `border` reaches all
 * twelve side parts through the three per-side shorthands, so a block that
 * writes `border` and `borderTopColor` is caught by the same lookup as one that
 * writes `border` and `borderWidth`.
 */
export const LOOK_SHORTHAND_LONGHANDS: ReadonlyMap<string, ReadonlySet<string>> = lookShorthandClosure();

for (const [shorthand, longhands] of LOOK_SHORTHAND_LONGHANDS) {
  if (!LOOK_PROPERTIES.has(shorthand)) throw new Error(`Look shorthand '${shorthand}' is not a published Look property`);
  for (const longhand of longhands) {
    if (!LOOK_PROPERTIES.has(longhand)) throw new Error(`Look shorthand '${shorthand}' names '${longhand}', which is not a published Look property`);
  }
}

/**
 * The two properties' overlap, when one writes what the other does — the
 * shorthand first. Null when the two are independent declarations, which is
 * every pair the browser resolves on its own.
 */
export function lookShorthandOverlap(left: string, right: string): { readonly shorthand: string; readonly longhand: string } | null {
  if (LOOK_SHORTHAND_LONGHANDS.get(left)?.has(right) === true) return { shorthand: left, longhand: right };
  if (LOOK_SHORTHAND_LONGHANDS.get(right)?.has(left) === true) return { shorthand: right, longhand: left };
  return null;
}

/**
 * What a refusal offers instead of the pair: the shorthand's own longhands, so
 * the author can write the one they meant to override beside its siblings. The
 * list is the direct level rather than the closure — `border` answers with
 * borderWidth, borderStyle and borderColor rather than with all twelve side
 * parts, because that is the level a reader replaces it at.
 */
export function lookShorthandParts(shorthand: string): readonly string[] {
  return lookDirectShorthands.find(([name]) => name === shorthand)?.[1] ?? [];
}
