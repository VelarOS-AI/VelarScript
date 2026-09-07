/**
 * The walk over a Look literal's entries: composition, conditions, targets, and
 * the ordinary `property = value` pairs, plus the two rules that read a scope
 * rather than one entry — duplicate properties and shorthand overlap.
 *
 * D115 P4 R3b. LOK-D1 also lives here: a Look literal is constructed once where
 * it is written, so a reactive read inside one is a snapshot and is rejected
 * with the two spellings that stay live.
 */
import { type Span } from "@velarscript/compiler";
import { type Expression, stringType } from "@velarscript/compiler/extension";
import { type WebJsxElementExpression as JSXElementExpression, type WebLookExpression } from "../../ast.ts";
import { LOOK_EXCLUDED_PROPERTIES, LOOK_HOOKS, LOOK_PROPERTIES, LOOK_TARGETS, lookShorthandOverlap, nearestLookName } from "../../look.ts";
import { LOOK_CONDITION_TERM_LIMIT, lookConditionKey } from "../look-conditions.ts";
import { lookConditionTermCount, lookLiteralZero, type LookValueSite, mentionsLookUnitType } from "../look-sites.ts";
import { lookShorthandOverlapMessage, lookShorthandStringGuidance } from "../look-vocabulary-guidance.ts";
import { diagnostic, LOOK_PROPERTY_TYPES } from "../web-types.ts";
import { inferLookCondition } from "./conditions.ts";
import { type LookAnalysisHost } from "./host.ts";
import { adviseLookTokenSpelling, isLookTokenCall } from "./tokens.ts";
import { adviseLookFilterSpelling, reportLookNumberWithoutUnit, validateLookStringVocabulary } from "./values.ts";

export function analyzeLookEntries(
  host: LookAnalysisHost,
  entries: WebLookExpression["entries"],
  insideTarget: boolean,
  nested: boolean,
  inheritedTerms: number,
  scopeKey = "",
): void {
  for (const entry of entries) {
    if (entry.kind === "LookSpread") {
      const type = host.inferExpression(entry.value, { kind: "named", name: "Look" });
      host.requireAssignable(type, { kind: "named", name: "Look" }, entry.value.span);
      reportLookSnapshotReads(host, entry.value);
      if (nested) host.diagnostics.push(diagnostic("VEL5044", "Look composition is only valid at the outer level; compose first, then place the result in a condition or target", entry.span));
      continue;
    }
    if (entry.kind === "LookIf") {
      inferLookCondition(host, entry.condition);
      reportLookSnapshotReads(host, entry.condition);
      const thenTerms = lookConditionTermCount(entry.condition);
      const elseTerms = lookConditionTermCount(entry.condition, true);
      if (inheritedTerms * Math.max(thenTerms, elseTerms) > LOOK_CONDITION_TERM_LIMIT) {
        host.diagnostics.push(diagnostic("VEL5045", `A Look condition may expand to at most ${LOOK_CONDITION_TERM_LIMIT} selector/runtime terms; split this visual decision into ordinary values`, entry.condition.span));
      }
      const thenKey = lookConditionKey(entry.condition, false, host.lookStatic.values);
      const elseKey = lookConditionKey(entry.condition, true, host.lookStatic.values);
      analyzeLookEntries(host, entry.thenEntries, insideTarget, true, Math.min(LOOK_CONDITION_TERM_LIMIT, inheritedTerms * thenTerms), `${scopeKey}&${thenKey}`);
      analyzeLookEntries(host, entry.elseEntries, insideTarget, true, Math.min(LOOK_CONDITION_TERM_LIMIT, inheritedTerms * elseTerms), `${scopeKey}&${elseKey}`);
      continue;
    }
    if (entry.kind === "LookTarget") {
      if (!LOOK_TARGETS.has(entry.name)) {
        const nearest = nearestLookName(entry.name, LOOK_TARGETS);
        host.diagnostics.push(diagnostic("VEL5038", LOOK_HOOKS.has(entry.name)
          ? `Use 'if @${entry.name}:'; '@${entry.name}' is an element state condition, not a pseudo-element target`
          : nearest
            ? `Unknown Look target '@${entry.name}'; did you mean '@${nearest}'?`
            : `Unknown Look target '@${entry.name}'; Look targets are ${[...LOOK_TARGETS].map((name) => `@${name}`).join(", ")}`, entry.span));
      }
      if (insideTarget) host.diagnostics.push(diagnostic("VEL5038", "Look targets cannot be nested", entry.span));
      // A repeated target is reported once; its body then gets a private scope
      // so the properties inside are not reported a second time as duplicates.
      const repeated = !recordLookEntry(host, `${scopeKey}#target`, entry.name);
      if (repeated) host.diagnostics.push(diagnostic("VEL5039", `Look target '@${entry.name}' is defined more than once in the same scope`, entry.span));
      analyzeLookEntries(host, entry.entries, true, true, inheritedTerms, repeated ? `${scopeKey}@${entry.name}#${entry.span.start}` : `${scopeKey}@${entry.name}`);
      continue;
    }
    reportLookShorthandOverlap(host, scopeKey, entry.name, entry.span);
    if (!recordLookEntry(host, scopeKey, entry.name)) {
      host.diagnostics.push(diagnostic("VEL5039", `Look property '${entry.name}' is defined more than once in the same scope`, entry.span));
    }
    if (!analyzeLookValue(host, entry.name, entry.value, entry.span, null)) continue;
    const expected = LOOK_PROPERTY_TYPES.get(entry.name) ?? stringType;
    const actual = host.inferExpression(entry.value, expected);
    reportLookSnapshotReads(host, entry.value);
    // Zero is the one unitless CSS length, so `padding = 0` stays legal while
    // every other bare number is answered with the unit it needs (LOK-D3).
    if (mentionsLookUnitType(expected) && lookLiteralZero(entry.value)) continue;
    if (reportLookNumberWithoutUnit(host, entry.name, actual, expected, entry.value.span)) continue;
    if (actual.kind !== "null" && expected.kind !== "unknown") host.requireAssignable(actual, expected, entry.value.span);
  }
}

/**
 * LOK-D1: a `look:` literal is constructed once, where it is written. Its
 * conditions and its values are snapshot positions — a reactive read inside
 * one compiles cleanly and then never updates, which is the quietest trap in
 * the visual language. The two spellings that stay live are the JSX
 * expression position and the `look:property` directive, so the read is
 * rejected here and both are taught.
 */
export function reportLookSnapshotReads(host: LookAnalysisHost, expression: Expression): void {
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }
    if (!value || typeof value !== "object") return;
    const record = value as Record<string, unknown>;
    if (record.kind === "IdentifierExpression" && typeof record.name === "string") {
      const name = record.name;
      const reactive = host.reactiveBindingKind(name) !== null || host.derivedReactiveRead(name);
      if (reactive) {
        host.diagnostics.push(diagnostic(
          "VEL5058",
          `A Look literal is built once where it is written, so '${name}' is read as a snapshot and the visual never follows it. Put the reactive decision on the element instead: 'look={${name} ? oneLook : otherLook}' chooses a whole Look, and 'look:property={...}' sets one property`,
          record.span as Span,
        ));
      }
      return;
    }
    for (const [key, child] of Object.entries(record)) if (key !== "span") visit(child);
  };
  visit(expression);
}

/**
 * Records one entry in its lowered scope (condition signature plus target) so
 * two sibling blocks with the same condition report the property they both
 * set. Returns false when the entry repeats. LOK-I4: the charter's duplicate
 * promise used to hold only inside a single indented scope.
 */
export function recordLookEntry(host: LookAnalysisHost, scopeKey: string, name: string): boolean {
  const seen = host.lookEntryScopes.get(scopeKey) ?? new Set<string>();
  host.lookEntryScopes.set(scopeKey, seen);
  if (seen.has(name)) return false;
  seen.add(name);
  return true;
}

/**
 * The vocabulary checks a Look property shares between the block spelling and
 * the `look:`/`style:` directives. Returns false when the entry is already
 * reported and its value needs no further checking. LOK-I1: an unrecognized
 * property no longer co-reports a `stringType` fallback assignment error.
 */
export function analyzeLookValue(host: LookAnalysisHost, name: string, value: Expression, entrySpan: Span, directive: "look" | "style" | null): boolean {
  const inline = directive !== null;
  const label = directive === "style" ? "inline Style" : directive === "look" ? "inline Look" : "Look";
  if (name === "animation" && value.kind === "LiteralExpression" && typeof value.value === "string") {
    host.diagnostics.push(diagnostic(
      "VEL5038",
      "Look animation does not accept CSS shorthand text; declare a checked 'keyframes:' value and pass animate(frames, duration, ...) instead",
      entrySpan,
    ));
    if (!inline) host.inferExpression(value);
    return false;
  }
  // D103 rule 1 meets D49. `animation` is the one Look property whose value
  // names another rule rather than describing one: the `@keyframes` name in
  // an animation shorthand. Look owns those names — they are generated from
  // the `keyframes:` value that defines the motion — so a shorthand arriving
  // from outside this compile is a reference the compiler can check on
  // neither side, which is the surface D50 rule 92 calls worse than none. The
  // type refuses it either way; this replaces a bare union dump with the two
  // spellings that do work.
  if (name === "animation" && isLookTokenCall(host, value)) {
    host.diagnostics.push(diagnostic(
      "VEL5038",
      "Look animation is the one property a design token cannot carry: an animation value names a '@keyframes' rule, and Look generates those names from the 'keyframes:' value that defines the motion, so a shorthand from a design system names a rule this compile never emitted. Declare a checked 'keyframes:' value and pass animate(frames, duration, ...); token() is legal in every other Look property, and a module-level 'import css unsafe \"./styles.css\" before look' carries a design system's own animation when that boundary is intentional",
      entrySpan,
    ));
    if (!inline) host.inferExpression(value);
    return false;
  }
  if (!LOOK_PROPERTIES.has(name)) {
    const nearest = nearestLookName(name, LOOK_PROPERTIES);
    const exclusion = LOOK_EXCLUDED_PROPERTIES.get(name);
    host.diagnostics.push(diagnostic("VEL5038", exclusion
      ? `CSS property '${name}' is outside checked Look: ${exclusion}. Use a module-level 'import css unsafe "./styles.css" before look' when that boundary is intentional`
      : nearest
        ? `Unknown ${label} property '${name}'; did you mean '${nearest}'?`
        : `Unknown ${label} property '${name}'; ${inline ? `${directive!}:* uses the same camelCase property names as a Look block` : "Look properties use the DOM camelCase spelling of a CSS property"}`, entrySpan));
    if (!inline) host.inferExpression(value);
    return false;
  }
  const shorthandGuidance = lookShorthandStringGuidance(name, value);
  if (shorthandGuidance) {
    host.diagnostics.push(diagnostic("VEL5038", shorthandGuidance, value.span));
    return false;
  }
  const site: LookValueSite = { property: name, entrySpan, directive };
  adviseLookFilterSpelling(host, name, value, site);
  adviseLookTokenSpelling(host, name, value, site);
  if (!validateLookStringVocabulary(host, name, value, undefined, site)) return false;
  return true;
}

/**
 * D104 rule 2 — the wider half of the promise VEL5039 already made. A
 * repeated property name is refused because the second entry overwrites the
 * first and Look has no source order to settle which is meant; a shorthand
 * beside a longhand it writes is the same defect with two spellings, and it
 * is the one that hid thirty-six dead declarations in a consumer's shell.
 * Reports once against the entry that completes the pair.
 */
export function reportLookShorthandOverlap(host: LookAnalysisHost, scopeKey: string, name: string, span: Span): void {
  for (const other of host.lookEntryScopes.get(scopeKey) ?? []) {
    const overlap = lookShorthandOverlap(other, name);
    if (!overlap) continue;
    host.diagnostics.push(diagnostic("VEL5039", lookShorthandOverlapMessage(overlap.shorthand, overlap.longhand, "This Look scope"), span));
    return;
  }
}

/**
 * The same rule where the properties are written as element directives. A
 * `look:` directive lowers to exactly the rule a block entry does, so an
 * element carrying `look:padding` and `look:paddingTop` has the pair in the
 * same scope as surely as a block does. The `style:` directives are not
 * checked here: they compose one inline style object, where the browser's own
 * source order settles the pair.
 */
export function reportLookDirectiveOverlap(host: LookAnalysisHost, expression: JSXElementExpression): void {
  const written: string[] = [];
  for (const attribute of expression.attributes) {
    if (!attribute.name.startsWith("look:")) continue;
    const property = attribute.name.slice("look:".length);
    if (!LOOK_PROPERTIES.has(property)) continue;
    const overlapping = written.map((other) => lookShorthandOverlap(other, property)).find(Boolean);
    if (overlapping) {
      host.diagnostics.push(diagnostic("VEL5039", lookShorthandOverlapMessage(overlapping.shorthand, overlapping.longhand, `Element '<${expression.tag}>'`), attribute.span));
    }
    written.push(property);
  }
}
