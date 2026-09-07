/**
 * The condition half of a Look literal: `if @hover:`, `if viewport.width >
 * 40rem`, and the media subjects the language publishes.
 *
 * D115 P4 R3b. A viewport breakpoint has to resolve at compile time — it
 * becomes a media query, and a media query has no run time — so the threshold
 * check reads the module's static Look scope rather than the inferred type.
 */
import { boolType, type Expression, type ValueType } from "@velarscript/compiler/extension";
import { isWebExpression } from "../../ast.ts";
import { evaluateLookStaticExpression } from "../../look-static.ts";
import { LOOK_ABSENT_MEDIA_SUBJECTS, LOOK_HOOKS, LOOK_MEDIA_LENGTH_UNITS, LOOK_MEDIA_SUBJECTS, LOOK_TARGETS, nearestLookName } from "../../look.ts";
import { flippedViewportComparison, isSchemeCondition, isViewportComparison, lookMediaVocabulary, lookSourceOf, mediaSubjectShape } from "../media-conditions.ts";
import { diagnostic, lookLength } from "../web-types.ts";
import { type LookAnalysisHost } from "./host.ts";

export function inferLookCondition(host: LookAnalysisHost, expression: Expression): ValueType {
  if (isWebExpression(expression) && expression.kind === "ExtensionExpression:web:look-hook") {
    if (!LOOK_HOOKS.has(expression.name)) {
      // LOK-I2: the target position redirects a hook to 'if @hook:', so the
      // condition position redirects a target to its block spelling.
      const nearest = nearestLookName(expression.name, LOOK_HOOKS);
      host.diagnostics.push(diagnostic("VEL5038", LOOK_TARGETS.has(expression.name)
        ? `Use '@${expression.name}:' as a target block; '@${expression.name}' is a pseudo-element target, not an element state condition`
        : nearest
          ? `Unknown Look hook '@${expression.name}'; did you mean '@${nearest}'?`
          : `Unknown Look hook '@${expression.name}'; Look hooks are ${[...LOOK_HOOKS].map((name) => `@${name}`).join(", ")}`, expression.span));
    }
    return boolType;
  }
  if (expression.kind === "UnaryExpression" && expression.operator === "not") {
    const value = inferLookCondition(host, expression.operand);
    host.requireCondition(value, expression.operand);
    return boolType;
  }
  if (expression.kind === "BinaryExpression" && (expression.operator === "and" || expression.operator === "or")) {
    const left = inferLookCondition(host, expression.left);
    const right = inferLookCondition(host, expression.right);
    host.requireCondition(left, expression.left);
    host.requireCondition(right, expression.right);
    return boolType;
  }
  if (isViewportComparison(expression)) {
    const comparison = expression as Extract<Expression, { kind: "BinaryExpression" }>;
    host.inferExpression(comparison.right, lookLength);
    checkViewportThreshold(host, comparison.right);
    return boolType;
  }
  const flipped = flippedViewportComparison(expression);
  if (flipped) {
    host.inferExpression(flipped.threshold, lookLength);
    host.diagnostics.push(diagnostic(
      "VEL5052",
      `Write the viewport on the left of a breakpoint: 'viewport.${flipped.property} ${flipped.operator} ${lookSourceOf(flipped.threshold)}'`,
      expression.span,
    ));
    checkViewportThreshold(host, flipped.threshold);
    return boolType;
  }
  if (isSchemeCondition(expression)) return boolType;
  // LOK-U3: the media-subject set is closed. A subject the reader reached for
  // and Look does not carry names the whole set instead of reporting the
  // subject as an unknown Core name. A comparison carries its subject on
  // either side, so both operands are examined.
  const operands = expression.kind === "BinaryExpression" ? [expression.left, expression.right] : [expression];
  for (const operand of operands) {
    const subject = mediaSubjectShape(operand);
    if (!subject || host.lookup(subject.subject)) continue;
    if (!LOOK_MEDIA_SUBJECTS.has(subject.subject) && !LOOK_ABSENT_MEDIA_SUBJECTS.has(subject.subject)) continue;
    host.diagnostics.push(diagnostic(
      "VEL5038",
      `Look media conditions are ${lookMediaVocabulary()}; '${subject.subject}.${subject.feature}' is not one of them`,
      expression.span,
    ));
    return boolType;
  }
  const type = host.inferExpression(expression);
  host.requireCondition(type, expression);
  return boolType;
}

export function checkViewportThreshold(host: LookAnalysisHost, value: Expression): void {
  const threshold = evaluateLookStaticExpression(value, host.lookStatic.values);
  if (threshold?.kind !== "unit") {
    host.diagnostics.push(diagnostic(
      "VEL5052",
      "A viewport breakpoint must resolve at compile time to a px, rem, or em value; use a const unit token or an imported const unit token",
      value.span,
    ));
  } else if (!LOOK_MEDIA_LENGTH_UNITS.has(threshold.unit)) {
    host.diagnostics.push(diagnostic("VEL5052", `Viewport breakpoints do not support '${threshold.unit}'; use px, rem, or em`, value.span));
  }
}
