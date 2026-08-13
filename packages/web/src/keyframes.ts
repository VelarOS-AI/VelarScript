import type { Expression } from "@velarscript/compiler/extension";
import { isWebUnit, type WebKeyframesExpression } from "./ast.ts";

function finite(value: unknown): string | null {
  return typeof value === "number" && Number.isFinite(value) ? String(Object.is(value, -0) ? 0 : value) : null;
}

function literalArgument(expression: Expression | undefined): string | null {
  return expression ? keyframeCssValue(expression) : null;
}

/** Static CSS spelling accepted inside a generated @keyframes rule. */
export function keyframeCssValue(expression: Expression): string | null {
  if (isWebUnit(expression)) return expression.raw;
  if (expression.kind === "LiteralExpression") {
    if (typeof expression.value === "string") return expression.value;
    return finite(expression.value);
  }
  if (expression.kind === "UnaryExpression" && (expression.operator === "+" || expression.operator === "-")) {
    const value = keyframeCssValue(expression.operand);
    if (value === null) return null;
    return expression.operator === "+" ? value : `calc(-1 * (${value}))`;
  }
  if (expression.kind === "BinaryExpression" && ["+", "-", "*", "/"].includes(expression.operator)) {
    const left = keyframeCssValue(expression.left);
    const right = keyframeCssValue(expression.right);
    return left === null || right === null ? null : `calc(${left} ${expression.operator} ${right})`;
  }
  if (expression.kind !== "CallExpression" || expression.callee.kind !== "IdentifierExpression"
    || expression.argumentNames?.some((name) => name !== null)) return null;
  const name = expression.callee.name;
  const values = expression.arguments.map(keyframeCssValue);
  if (values.some((value) => value === null)) return null;
  const args = values as string[];
  if (name === "color" && args.length === 1) return args[0]!;
  if (name === "rgb" && args.length === 3) return `rgb(${args.join(" ")})`;
  if (name === "rgba" && args.length === 4) return `rgb(${args.slice(0, 3).join(" ")} / ${args[3]})`;
  if (name === "hsl" && args.length === 3) return `hsl(${args[0]} ${args[1]}% ${args[2]}%)`;
  if (name === "alpha" && args.length === 2) return `color-mix(in srgb, ${args[0]} ${Number(args[1]) * 100}%, transparent)`;
  if (name === "lighten" && args.length === 2) return `color-mix(in srgb, ${args[0]}, white ${Number(args[1]) * 100}%)`;
  if (name === "darken" && args.length === 2) return `color-mix(in srgb, ${args[0]}, black ${Number(args[1]) * 100}%)`;
  if (name === "border" && (args.length === 2 || args.length === 3)) return `${args[0]} ${args[2] ?? "solid"} ${args[1]}`;
  if (name === "shadow" && args.length >= 4 && args.length <= 6) {
    const inset = expression.arguments[5];
    const prefix = inset?.kind === "LiteralExpression" && inset.value === true ? "inset " : "";
    return `${prefix}${args[0]} ${args[1]} ${args[2]} ${args[4] ?? "0px"} ${args[3]}`;
  }
  if (name === "linearGradient" && args.length === 3) return `linear-gradient(${args.join(", ")})`;
  if (name === "asset" && expression.arguments[0]?.kind === "LiteralExpression" && typeof expression.arguments[0].value === "string") {
    return `url(${JSON.stringify(expression.arguments[0].value)})`;
  }
  if (name === "minmax" && args.length === 2) return `minmax(${args.join(", ")})`;
  if (name === "repeat" && args.length === 2) return `repeat(${args.join(", ")})`;
  if (name === "tracks" && args.length > 0) return args.join(" ");
  if (name === "spacing" && args.length > 0 && args.length <= 4) return args.join(" ");
  if ((name === "min" || name === "max") && args.length === 2) return `${name}(${args.join(", ")})`;
  if (name === "clamp" && args.length === 3) return `clamp(${args.join(", ")})`;
  return literalArgument(undefined);
}

export function keyframesCanonical(expression: WebKeyframesExpression): string {
  return [...expression.stops]
    .sort((left, right) => Math.min(...left.offsets) - Math.min(...right.offsets))
    .map((stop) => `${[...stop.offsets].sort((left, right) => left - right).join(",")}{${stop.entries
      .map((entry) => `${entry.name}:${keyframeCssValue(entry.value) ?? "?"}`)
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
