import type { Expression, Program } from "@velarscript/compiler/extension";
import { LOOK_UNIT_TYPES } from "./look.ts";

export type LookStaticValue =
  | { readonly kind: "number"; readonly value: number }
  | { readonly kind: "unit"; readonly value: number; readonly unit: string }
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
  if (record.kind === "unit") {
    return typeof record.value === "number" && Number.isFinite(record.value)
      && typeof record.unit === "string" && LOOK_UNIT_TYPES.has(record.unit);
  }
  if (record.kind !== "object" || !record.properties || typeof record.properties !== "object" || Array.isArray(record.properties)) return false;
  return Object.values(record.properties as Record<string, unknown>).every(isLookStaticValue);
}

export function evaluateLookStaticExpression(
  expression: Expression,
  values: ReadonlyMap<string, LookStaticValue>,
): LookStaticValue | null {
  if (expression.kind === "UnitLiteralExpression") return staticUnit(expression.value, expression.unit);
  if (expression.kind === "LiteralExpression" && typeof expression.value === "number") return staticNumber(expression.value);
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
  return null;
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
  if (value.kind !== "unit") return null;
  return `${value.value}${value.unit}`;
}

export function lookStaticIdentity(value: unknown): string {
  if (!isLookStaticValue(value)) throw new TypeError("Invalid Look static interface value");
  const normalized = (entry: LookStaticValue): unknown => entry.kind === "object"
    ? { kind: "object", properties: Object.fromEntries(Object.entries(entry.properties).sort(([left], [right]) => left.localeCompare(right)).map(([name, child]) => [name, normalized(child)])) }
    : entry;
  return JSON.stringify(normalized(value));
}
