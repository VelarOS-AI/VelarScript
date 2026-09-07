/**
 * The analysis half of `keyframes:` — the stops, their offsets, and the Look
 * values each stop carries.
 *
 * D115 P4 R3b. It reads the same `LookAnalysisHost` the `look/` family does,
 * because a keyframe stop is a Look value in a position that has no run time:
 * every builder call in it is folded at compile time, so a call the builder
 * check already refused drops its consequence here rather than reporting twice.
 * Named apart from `../keyframes.ts`, which is the CSS lowering.
 */
import { type Span } from "@velarscript/compiler";
import { type Expression, stringType } from "@velarscript/compiler/extension";
import { type WebKeyframesExpression } from "../ast.ts";
import { keyframeCssValue } from "../keyframes.ts";
import { LOOK_NON_ANIMATABLE_PROPERTIES } from "../look.ts";
import { lookLiteralZero, mentionsLookUnitType } from "./look-sites.ts";
import { refusedBuilderCallWithin } from "./look/builders.ts";
import { analyzeLookValue } from "./look/entries.ts";
import { type LookAnalysisHost } from "./look/host.ts";
import { reportLookNumberWithoutUnit } from "./look/values.ts";
import { diagnostic, LOOK_PROPERTY_TYPES } from "./web-types.ts";

export function analyzeKeyframes(host: LookAnalysisHost, expression: WebKeyframesExpression): void {
  for (const stop of expression.stops) {
    const properties = new Set<string>();
    for (const entry of stop.entries) {
      if (properties.has(entry.name)) {
        host.diagnostics.push(diagnostic("VEL5039", `Keyframe property '${entry.name}' is defined more than once at the same stop`, entry.span));
        continue;
      }
      properties.add(entry.name);
      if (LOOK_NON_ANIMATABLE_PROPERTIES.has(entry.name)) {
        host.diagnostics.push(diagnostic("VEL5060", `Look property '${entry.name}' does not participate in animation interpolation`, entry.span));
        host.inferExpression(entry.value);
        continue;
      }
      if (!analyzeLookValue(host, entry.name, entry.value, entry.span, null)) continue;
      const expected = LOOK_PROPERTY_TYPES.get(entry.name) ?? stringType;
      const actual = host.inferExpression(entry.value, expected);
      reportKeyframeSnapshotReads(host, entry.value);
      // LK-I2: a builder that failed its own argument check has already been told what
      // is wrong with it, and "does not resolve to static CSS" is only the consequence —
      // a sentence that sends its author looking for a rule against named arguments in
      // a stop, which there is not (`spread=2px` in range compiles).
      if (keyframeCssValue(entry.value, host.lookStatic.values) === null && !refusedBuilderCallWithin(host, entry.value.span)) {
        host.diagnostics.push(diagnostic(
          "VEL5060",
          "A keyframe value must resolve to static CSS from literals, unit values, arithmetic, velar/look builders, or const bindings — local or imported — that hold any of those, and the text it resolves to must read as one declaration value: no ';', '{', '}', or '@' outside a string, with parentheses, strings, and comments all closed",
          entry.value.span,
        ));
      }
      if (mentionsLookUnitType(expected) && lookLiteralZero(entry.value)) continue;
      if (reportLookNumberWithoutUnit(host, entry.name, actual, expected, entry.value.span)) continue;
      if (actual.kind !== "null" && expected.kind !== "unknown") host.requireAssignable(actual, expected, entry.value.span);
    }
  }
}

export function reportKeyframeSnapshotReads(host: LookAnalysisHost, expression: Expression): void {
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) { value.forEach(visit); return; }
    if (!value || typeof value !== "object") return;
    const record = value as Record<string, unknown>;
    if (record.kind === "IdentifierExpression" && typeof record.name === "string") {
      const name = record.name;
      if (host.reactiveBindingKind(name) !== null || host.derivedReactiveRead(name)) {
        host.diagnostics.push(diagnostic(
          "VEL5060",
          `Keyframes generate static CSS, so reactive '${name}' cannot be read inside a stop; make animation presence dynamic with look:animation={condition ? animate(frames, 1s) : null}`,
          record.span as Span,
        ));
      }
      return;
    }
    for (const [key, child] of Object.entries(record)) if (key !== "span") visit(child);
  };
  visit(expression);
}
