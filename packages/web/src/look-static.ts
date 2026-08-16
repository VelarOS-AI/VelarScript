import type { Expression, Program } from "@velarscript/compiler/extension";
import { LOOK_BUILDER_SIGNATURES, LOOK_UNIT_TYPES } from "./look.ts";
import { isWebUnit } from "./ast.ts";

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
    const value = lookStaticCssValue(expression.operand, values);
    if (value === null) return null;
    return expression.operator === "+" ? value : `calc(-1 * (${value}))`;
  }
  if (expression.kind === "BinaryExpression" && ["+", "-", "*", "/"].includes(expression.operator)) {
    const left = lookStaticCssValue(expression.left, values);
    const right = lookStaticCssValue(expression.right, values);
    return left === null || right === null ? null : `calc(${left} ${expression.operator} ${right})`;
  }
  if (expression.kind !== "CallExpression" || expression.callee.kind !== "IdentifierExpression") return null;
  const name = expression.callee.name;
  const signature = LOOK_BUILDER_SIGNATURES.get(name);
  if (!signature) return null;
  const slots = builderArguments(expression, signature);
  if (slots === null) return null;
  // shadow's sixth parameter is a bool flag, not a CSS value, so it is read
  // below rather than lowered.
  const lowered = slots.map((slot, index) => slot === undefined || (name === "shadow" && index === 5)
    ? undefined
    : lookStaticCssValue(slot, values));
  if (lowered.some((value) => value === null)) return null;
  const args = lowered as readonly (string | undefined)[];
  const positional = args as readonly string[];
  if (name === "color" && args.length === 1) return positional[0]!;
  if (name === "rgb" && args.length === 3) return `rgb(${positional.join(" ")})`;
  if (name === "rgba" && args.length === 4) return `rgb(${positional.slice(0, 3).join(" ")} / ${positional[3]})`;
  if (name === "hsl" && args.length === 3) return `hsl(${positional[0]} ${positional[1]}% ${positional[2]}%)`;
  if (name === "alpha" && args.length === 2) return `color-mix(in srgb, ${positional[0]} ${Number(positional[1]) * 100}%, transparent)`;
  if (name === "lighten" && args.length === 2) return `color-mix(in srgb, ${positional[0]}, white ${Number(positional[1]) * 100}%)`;
  if (name === "darken" && args.length === 2) return `color-mix(in srgb, ${positional[0]}, black ${Number(positional[1]) * 100}%)`;
  if (name === "border" && (args.length === 2 || args.length === 3)) return `${positional[0]} ${args[2] ?? "solid"} ${positional[1]}`;
  if (name === "shadow" && args.length >= 4 && args.length <= 6) {
    const inset = slots[5];
    const prefix = inset?.kind === "LiteralExpression" && inset.value === true ? "inset " : "";
    return `${prefix}${positional[0]} ${positional[1]} ${positional[2]} ${args[4] ?? "0px"} ${positional[3]}`;
  }
  if (name === "linearGradient" && args.length === 3) return `linear-gradient(${positional.join(", ")})`;
  if (name === "asset" && args.length === 1) return `url(${JSON.stringify(positional[0])})`;
  if (name === "minmax" && args.length === 2) return `minmax(${positional.join(", ")})`;
  if (name === "repeat" && args.length === 2) return `repeat(${positional.join(", ")})`;
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
