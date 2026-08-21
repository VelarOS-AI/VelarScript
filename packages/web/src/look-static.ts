import type { Expression, Program } from "@velarscript/compiler/extension";
import { LOOK_BORDER_STYLE_NAMES, LOOK_BUILDER_NUMERIC_RANGES, LOOK_BUILDER_SIGNATURES, LOOK_UNIT_TYPES } from "./look.ts";
import { isWebUnit } from "./ast.ts";
import { cssString } from "./css-string.ts";
import { isCssDeclarationValue } from "./css-tokens.ts";

export type LookStaticValue =
  | { readonly kind: "number"; readonly value: number }
  | { readonly kind: "unit"; readonly value: number; readonly unit: string }
  | { readonly kind: "css"; readonly value: string }
  | { readonly kind: "object"; readonly properties: Readonly<Record<string, LookStaticValue>> };

function finite(value: number): number | null {
  return Number.isFinite(value) ? (Object.is(value, -0) ? 0 : value) : null;
}

function staticNumber(value: number): LookStaticValue | null {
  const normalized = finite(value);
  return normalized === null ? null : { kind: "number", value: normalized };
}

function staticUnit(value: number, unit: string): LookStaticValue | null {
  const normalized = finite(value);
  return normalized === null || !LOOK_UNIT_TYPES.has(unit) ? null : { kind: "unit", value: normalized, unit };
}

function negate(value: LookStaticValue): LookStaticValue | null {
  if (value.kind === "number") return staticNumber(-value.value);
  if (value.kind === "unit") return staticUnit(-value.value, value.unit);
  return null;
}

function staticArithmetic(
  operator: "+" | "-" | "*" | "/",
  left: LookStaticValue,
  right: LookStaticValue,
): LookStaticValue | null {
  if (left.kind === "number" && right.kind === "number") {
    if (operator === "/" && right.value === 0) return null;
    return staticNumber(operator === "+" ? left.value + right.value
      : operator === "-" ? left.value - right.value
        : operator === "*" ? left.value * right.value
          : left.value / right.value);
  }
  if ((operator === "+" || operator === "-") && left.kind === "unit" && right.kind === "unit" && left.unit === right.unit) {
    return staticUnit(operator === "+" ? left.value + right.value : left.value - right.value, left.unit);
  }
  if (operator === "*" && left.kind === "unit" && right.kind === "number") return staticUnit(left.value * right.value, left.unit);
  if (operator === "*" && left.kind === "number" && right.kind === "unit") return staticUnit(left.value * right.value, right.unit);
  if (operator === "/" && left.kind === "unit" && right.kind === "number" && right.value !== 0) return staticUnit(left.value / right.value, left.unit);
  return null;
}

export function isLookStaticValue(value: unknown): value is LookStaticValue {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  if (record.kind === "number") return typeof record.value === "number" && Number.isFinite(record.value);
  if (record.kind === "css") return typeof record.value === "string";
  if (record.kind === "unit") {
    return typeof record.value === "number" && Number.isFinite(record.value)
      && typeof record.unit === "string" && LOOK_UNIT_TYPES.has(record.unit);
  }
  if (record.kind !== "object" || !record.properties || typeof record.properties !== "object" || Array.isArray(record.properties)) return false;
  return Object.values(record.properties as Record<string, unknown>).every(isLookStaticValue);
}

/**
 * Places a call's arguments at their declared positions, so a named argument
 * lowers exactly like the positional spelling of the same call. A position that
 * was not supplied stays a hole, which the builder rules below read as "use the
 * default". Answers null when a name is not a parameter of this builder, when
 * one position is written twice, or when a required position is missing —
 * every one of which the analyzer reports on its own.
 */
function builderArguments(
  expression: Extract<Expression, { kind: "CallExpression" }>,
  signature: { readonly parameters: readonly string[]; readonly required: number; readonly rest?: boolean },
): readonly (Expression | undefined)[] | null {
  const names = expression.argumentNames;
  if (!names || names.every((entry) => entry === null)) return expression.arguments;
  if (signature.rest) return null;
  const slots: (Expression | undefined)[] = [];
  for (const [index, argument] of expression.arguments.entries()) {
    const name: string | null = names[index] ?? null;
    const position = name === null ? index : signature.parameters.indexOf(name);
    if (position < 0 || slots[position] !== undefined) return null;
    slots[position] = argument;
  }
  for (let index = 0; index < signature.required; index += 1) if (slots[index] === undefined) return null;
  return slots;
}

/**
 * The static CSS a Look value lowers to at compile time: literals, unit values,
 * arithmetic over them, `velar/look` builder calls, and const bindings — local
 * or imported — that hold any of those. `keyframes:` needs the text itself
 * because a stop becomes a real `@keyframes` rule, while a Look property keeps
 * its runtime value; this is the one checker both spellings read, so a design
 * token written once works in both (D60 rule 151).
 */
export function lookStaticCssValue(
  expression: Expression,
  values: ReadonlyMap<string, LookStaticValue> = new Map(),
): string | null {
  const css = staticCssValue(expression, values);
  // LOK-U9: the value vocabulary lets `text`, `filter`, and `transform` hold
  // arbitrary strings because a Look property reaches the DOM through
  // setProperty and cannot escape. `keyframes:` reuses that vocabulary on a
  // path that concatenates into stylesheet text, where a `}` closes the
  // generated rule and everything after it becomes author-written CSS in the
  // compiler-owned segment. Lowering answers only with a value that is one
  // balanced declaration; the null becomes the diagnostic the analyzer
  // already reports for a value that does not resolve to static CSS.
  return css === null || !isCssDeclarationValue(css) ? null : css;
}

/**
 * The percentage a builder slot lowers to. This reads the folded number rather
 * than the lowered CSS text because the text is already `calc(1 - 0.4)` by the
 * time a builder rule sees it, `%` is not a suffix `calc()` wears, and
 * `Number()` of that text is NaN — which used to reach the stylesheet as a
 * literal `NaN%` and drop the colour (LOK-U7). `scale` is 100 for a 0..1 weight
 * and 1 where the number already is the percentage, as hsl's saturation and
 * lightness are. Ordinary float noise is trimmed so `1 - 0.4` reads `60%`.
 */
function staticPercentage(expression: Expression, values: ReadonlyMap<string, LookStaticValue>, scale: 1 | 100): string | null {
  const folded = evaluateLookStaticExpression(expression, values);
  if (folded === null || folded.kind !== "number") return null;
  const percent = folded.value * scale;
  return Number.isFinite(percent) ? `${Number(percent.toPrecision(12))}%` : null;
}

/**
 * The count a slot lowers to where CSS reads a literal `<integer>` rather than
 * a value: `repeat()` takes a track count, so `repeat(calc(1 + 1), 10px)` is
 * dead CSS the browser drops along with the whole declaration. Reads the folded
 * number for the same reason a percentage does (LOK-U7).
 */
function staticCount(expression: Expression, values: ReadonlyMap<string, LookStaticValue>): string | null {
  const folded = evaluateLookStaticExpression(expression, values);
  return folded === null || folded.kind !== "number" || !Number.isSafeInteger(folded.value) ? null : String(folded.value);
}

/**
 * The builders check their numeric domains at run time, and the analyzer
 * checks literal arguments while the module compiles. Neither reaches a
 * `keyframes:` stop: the call is lowered away at compile time, so no guard
 * survives to run, and `rgb(hot, 0, 0)` with a computed `hot` was never a
 * literal. Every argument on this path is statically known by construction,
 * so the same range table answers here over the folded value, wherever the
 * call appears (LOK-U10).
 */
function builderRangesHold(
  name: string,
  slots: readonly (Expression | undefined)[],
  values: ReadonlyMap<string, LookStaticValue>,
): boolean {
  const ranges = LOOK_BUILDER_NUMERIC_RANGES.get(name);
  if (!ranges) return true;
  for (const [index, range] of ranges.entries()) {
    const slot = slots[index];
    if (!range || slot === undefined) continue;
    const folded = evaluateLookStaticExpression(slot, values);
    // A non-number folds to a unit or CSS text, which is a type error the
    // analyzer reports in its own terms; only a number has a domain here.
    if (folded?.kind !== "number") continue;
    if (folded.value < range[1] || folded.value > range[2]) return false;
  }
  return true;
}

function staticCssValue(
  expression: Expression,
  values: ReadonlyMap<string, LookStaticValue>,
): string | null {
  if (isWebUnit(expression)) return expression.raw;
  if (expression.kind === "LiteralExpression") {
    if (typeof expression.value === "string") return expression.value;
    if (typeof expression.value !== "number") return null;
    const normalized = finite(expression.value);
    return normalized === null ? null : String(normalized);
  }
  if (expression.kind === "IdentifierExpression" || expression.kind === "MemberExpression") {
    const value = evaluateLookStaticExpression(expression, values);
    return value === null ? null : lookStaticCss(value);
  }
  if (expression.kind === "UnaryExpression" && (expression.operator === "+" || expression.operator === "-")) {
    const value = staticCssValue(expression.operand, values);
    if (value === null) return null;
    return expression.operator === "+" ? value : `calc(-1 * (${value}))`;
  }
  if (expression.kind === "BinaryExpression" && ["+", "-", "*", "/"].includes(expression.operator)) {
    const left = staticCssValue(expression.left, values);
    const right = staticCssValue(expression.right, values);
    return left === null || right === null ? null : `calc(${left} ${expression.operator} ${right})`;
  }
  if (expression.kind !== "CallExpression" || expression.callee.kind !== "IdentifierExpression") return null;
  const name = expression.callee.name;
  const signature = LOOK_BUILDER_SIGNATURES.get(name);
  if (!signature) return null;
  const slots = builderArguments(expression, signature);
  if (slots === null) return null;
  if (!builderRangesHold(name, slots, values)) return null;
  // shadow's sixth parameter is a bool flag, not a CSS value, so it is read
  // below rather than lowered.
  const lowered = slots.map((slot, index) => slot === undefined || (name === "shadow" && index === 5)
    ? undefined
    : staticCssValue(slot, values));
  if (lowered.some((value) => value === null)) return null;
  const args = lowered as readonly (string | undefined)[];
  const positional = args as readonly string[];
  if (name === "color" && args.length === 1) return positional[0]!;
  if (name === "rgb" && args.length === 3) return `rgb(${positional.join(" ")})`;
  if (name === "rgba" && args.length === 4) return `rgb(${positional.slice(0, 3).join(" ")} / ${positional[3]})`;
  // The hue is a bare `<number>`, where `calc()` is legal, but the saturation
  // and the lightness are one `<percentage>` token each: `calc(40 + 10)%` is
  // not a percentage, so those two fold the same way a builder weight does.
  if (name === "hsl" && args.length === 3) {
    const saturation = staticPercentage(slots[1]!, values, 1);
    const lightness = staticPercentage(slots[2]!, values, 1);
    if (saturation === null || lightness === null) return null;
    return `hsl(${positional[0]} ${saturation} ${lightness})`;
  }
  if (name === "alpha" || name === "lighten" || name === "darken") {
    if (args.length !== 2) return null;
    const weight = staticPercentage(slots[1]!, values, 100);
    if (weight === null) return null;
    if (name === "alpha") return `color-mix(in srgb, ${positional[0]} ${weight}, transparent)`;
    return `color-mix(in srgb, ${positional[0]}, ${name === "lighten" ? "white" : "black"} ${weight})`;
  }
  // The width and the colour are values `calc()` may appear in; the style is a
  // `<line-style>` keyword, so the same name table the runtime builder checks
  // answers for it here (LOK-U10) rather than letting `"da" + "shed"` lower to
  // a `calc()` the browser drops.
  if (name === "border" && (args.length === 2 || args.length === 3)) {
    const style = args[2] ?? "solid";
    return LOOK_BORDER_STYLE_NAMES.has(style) ? `${positional[0]} ${style} ${positional[1]}` : null;
  }
  if (name === "shadow" && args.length >= 4 && args.length <= 6) {
    const inset = slots[5];
    // The flag is read from the literal rather than lowered, so a slot written
    // any other way has no answer here: dropping `inset` silently emits a valid
    // declaration for a shadow the author did not ask for.
    if (inset !== undefined && !(inset.kind === "LiteralExpression" && typeof inset.value === "boolean")) return null;
    const prefix = inset?.kind === "LiteralExpression" && inset.value === true ? "inset " : "";
    return `${prefix}${positional[0]} ${positional[1]} ${positional[2]} ${args[4] ?? "0px"} ${positional[3]}`;
  }
  if (name === "linearGradient" && args.length === 3) return `linear-gradient(${positional.join(", ")})`;
  // The path is quoted into the URL rather than dropped, so a slot that lowered
  // to `calc(a + .png)` addresses that text instead of failing; only a value
  // that folds to a string is a path.
  if (name === "asset" && args.length === 1) {
    const path = evaluateLookStaticExpression(slots[0]!, values);
    return path === null || path.kind !== "css" ? null : `url(${cssString(path.value)})`;
  }
  if (name === "minmax" && args.length === 2) return `minmax(${positional.join(", ")})`;
  if (name === "repeat" && args.length === 2) {
    const count = staticCount(slots[0]!, values);
    return count === null ? null : `repeat(${count}, ${positional[1]})`;
  }
  if (name === "tracks" && args.length > 0) return positional.join(" ");
  if (name === "spacing" && args.length > 0 && args.length <= 4) return positional.join(" ");
  if ((name === "min" || name === "max") && args.length === 2) return `${name}(${positional.join(", ")})`;
  if (name === "clamp" && args.length === 3) return `clamp(${positional.join(", ")})`;
  return null;
}

export function evaluateLookStaticExpression(
  expression: Expression,
  values: ReadonlyMap<string, LookStaticValue>,
): LookStaticValue | null {
  if (isWebUnit(expression)) return staticUnit(expression.value, expression.unit);
  if (expression.kind === "LiteralExpression" && typeof expression.value === "number") return staticNumber(expression.value);
  // A keyword token is a design token too: `const shellDisplay = "grid"` reads
  // in a stop exactly as the literal does. The text a Look value lowers to is
  // the string itself, which is what the css kind holds.
  if (expression.kind === "LiteralExpression" && typeof expression.value === "string") return { kind: "css", value: expression.value };
  if (expression.kind === "IdentifierExpression") return values.get(expression.name) ?? null;
  if (expression.kind === "UnaryExpression" && (expression.operator === "+" || expression.operator === "-")) {
    const operand = evaluateLookStaticExpression(expression.operand, values);
    return operand ? (expression.operator === "+" ? operand : negate(operand)) : null;
  }
  if (expression.kind === "BinaryExpression" && ["+", "-", "*", "/"].includes(expression.operator)) {
    const left = evaluateLookStaticExpression(expression.left, values);
    const right = evaluateLookStaticExpression(expression.right, values);
    return left && right ? staticArithmetic(expression.operator as "+" | "-" | "*" | "/", left, right) : null;
  }
  if (expression.kind === "ObjectExpression") {
    const properties: Record<string, LookStaticValue> = Object.create(null) as Record<string, LookStaticValue>;
    for (const property of expression.properties) {
      const value = evaluateLookStaticExpression(property.value, values);
      if (!value) return null;
      if (property.kind === "ObjectSpread") {
        if (value.kind !== "object") return null;
        Object.assign(properties, value.properties);
      } else properties[property.name] = value;
    }
    return { kind: "object", properties };
  }
  if (expression.kind === "MemberExpression" && !expression.optional) {
    const owner = evaluateLookStaticExpression(expression.object, values);
    return owner?.kind === "object" ? owner.properties[expression.property] ?? null : null;
  }
  // A builder call resolves to the CSS text it produces, so `const glow =
  // rgb(120, 150, 255)` is a design token a `keyframes:` stop can name -- in
  // this module and, through the checked interface, in one that imports it.
  // Every earlier branch already answered, so only a call reaches here.
  if (expression.kind !== "CallExpression") return null;
  const css = lookStaticCssValue(expression, values);
  return css === null ? null : { kind: "css", value: css };
}

export function collectLookStaticValues(
  program: Program,
  imported: ReadonlyMap<string, LookStaticValue> = new Map(),
): ReadonlyMap<string, LookStaticValue> {
  const values = new Map(imported);
  for (const statement of program.body) {
    if (statement.kind !== "VariableDeclaration" || statement.binding !== "const" || statement.pattern.kind !== "NameBindingPattern") continue;
    const value = evaluateLookStaticExpression(statement.initializer, values);
    if (value) values.set(statement.pattern.name, value);
  }
  return values;
}

export function exportedLookStaticValues(program: Program): ReadonlyMap<string, LookStaticValue> {
  const values = collectLookStaticValues(program);
  const exported = new Map<string, LookStaticValue>();
  for (const statement of program.body) {
    if (statement.kind !== "VariableDeclaration" || statement.binding !== "const" || !statement.exported
      || statement.pattern.kind !== "NameBindingPattern") continue;
    const value = values.get(statement.pattern.name);
    if (value) exported.set(statement.pattern.name, value);
  }
  return exported;
}

export function lookStaticCss(value: LookStaticValue): string | null {
  if (value.kind === "unit") return `${value.value}${value.unit}`;
  if (value.kind === "css") return value.value;
  if (value.kind === "number") return String(value.value);
  return null;
}

export function lookStaticIdentity(value: unknown): string {
  if (!isLookStaticValue(value)) throw new TypeError("Invalid Look static interface value");
  const normalized = (entry: LookStaticValue): unknown => entry.kind === "object"
    ? { kind: "object", properties: Object.fromEntries(Object.entries(entry.properties).sort(([left], [right]) => left.localeCompare(right)).map(([name, child]) => [name, normalized(child)])) }
    : entry;
  return JSON.stringify(normalized(value));
}
