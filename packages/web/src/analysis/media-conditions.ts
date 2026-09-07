/**
 * The Look condition atoms that lower to a media query — 'viewport.width',
 * 'scheme.dark', 'motion.reduced' — read as shapes over the written expression,
 * plus the renderings a refusal about one quotes back.
 *
 * D115 P4 R3a: 'is this expression a viewport comparison' is a question about a
 * node, not about the analyzer, so it reads as a module.
 */
import { type Expression } from "@velarscript/compiler/extension";
import { isWebExpression, isWebUnit } from "../ast.ts";
import { LOOK_MEDIA_SUBJECTS } from "../look.ts";

export function isViewportComparison(expression: Expression): boolean {
  if (expression.kind !== "BinaryExpression" || !["<", "<=", ">", ">="].includes(expression.operator)) return false;
  if (expression.left.kind !== "MemberExpression" || expression.left.object.kind !== "IdentifierExpression" || expression.left.object.name !== "viewport") return false;
  if (expression.left.property !== "width" && expression.left.property !== "height") return false;
  return true;
}

// LOK-I2: '720px >= viewport.width' means the same breakpoint as
// 'viewport.width <= 720px', but only the viewport-on-the-left spelling lowers
// to a media query. The flipped spelling is recognized so it teaches the
// supported order instead of reporting the subject as an unknown name.
const flippedComparisons: ReadonlyMap<string, string> = new Map([["<", ">"], ["<=", ">="], [">", "<"], [">=", "<="]]);

export function flippedViewportComparison(expression: Expression): { readonly property: string; readonly operator: string; readonly threshold: Expression } | null {
  if (expression.kind !== "BinaryExpression" || !flippedComparisons.has(expression.operator)) return null;
  const subject = mediaSubjectShape(expression.right);
  if (subject?.subject !== "viewport" || (subject.feature !== "width" && subject.feature !== "height")) return null;
  return { property: subject.feature, operator: flippedComparisons.get(expression.operator)!, threshold: expression.left };
}

// 'scheme.dark'/'scheme.light' and 'motion.reduced' are Look condition subjects
// that lower to prefers-color-scheme and prefers-reduced-motion media queries,
// mirroring the viewport.* media atoms.
export function isSchemeCondition(expression: Expression): boolean {
  if (expression.kind !== "MemberExpression" || expression.object.kind !== "IdentifierExpression") return false;
  const subject = expression.object.name;
  if (subject === "viewport") return false;
  return (LOOK_MEDIA_SUBJECTS.get(subject)?.has(expression.property)) ?? false;
}

/** The subject name of a `subject.feature` shape, whether or not it is a Look subject. */
export function mediaSubjectShape(expression: Expression): { readonly subject: string; readonly feature: string } | null {
  if (expression.kind !== "MemberExpression" || expression.optional || expression.object.kind !== "IdentifierExpression") return null;
  return { subject: expression.object.name, feature: expression.property };
}

export function lookMediaVocabulary(): string {
  return [...LOOK_MEDIA_SUBJECTS].flatMap(([subject, features]) => [...features].map((feature) => `${subject}.${feature}`)).join(", ");
}

/** A readable rendering of a breakpoint threshold for diagnostic guidance. */
export function lookSourceOf(expression: Expression): string {
  if (isWebUnit(expression)) return expression.raw;
  if (expression.kind === "IdentifierExpression") return expression.name;
  if (expression.kind === "LiteralExpression") return expression.raw;
  if (expression.kind === "MemberExpression") return `${lookSourceOf(expression.object)}.${expression.property}`;
  return "breakpoint";
}

/**
 * A syntactic rendering of one condition operand, used for the part of a Look
 * condition that does not lower to a selector or a media query: a runtime term
 * keeps its own scope, because two different runtime conditions really are two
 * different scopes.
 */
export function lookRuntimeSignature(expression: Expression): string {
  if (isWebExpression(expression) && expression.kind === "ExtensionExpression:web:look-hook") return `@${expression.name}`;
  if (expression.kind === "UnaryExpression" && expression.operator === "not") return `!(${lookRuntimeSignature(expression.operand)})`;
  if (expression.kind === "BinaryExpression") return `(${lookRuntimeSignature(expression.left)}${expression.operator}${lookRuntimeSignature(expression.right)})`;
  if (expression.kind === "MemberExpression") return `${lookRuntimeSignature(expression.object)}.${expression.property}`;
  if (expression.kind === "IdentifierExpression") return `id:${expression.name}`;
  if (isWebUnit(expression)) return `${expression.value}${expression.unit}`;
  if (expression.kind === "LiteralExpression") return `lit:${expression.raw}`;
  return `span:${expression.span.start}`;
}

export function lookKebab(value: string): string {
  return value.replace(/[A-Z]/gu, (character) => `-${character.toLowerCase()}`);
}
