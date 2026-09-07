/**
 * What a Look property's value is allowed to be: the string vocabulary each
 * property publishes, the compile-time fold that answers for a `const`
 * keyword, the unit a bare number is missing, and the filter spelling that has
 * a builder behind it.
 *
 * D115 P4 R3b. `entries.ts` asks these questions of every entry it walks and
 * `builders.ts` routes the transition builder's property argument through the
 * same vocabulary, so one property has one answer wherever it is written.
 */
import { mechanicalEdits, type Span } from "@velarscript/compiler";
import { type Expression, type ValueType } from "@velarscript/compiler/extension";
import { evaluateLookStaticExpression } from "../../look-static.ts";
import { LOOK_PARTIAL_KEYWORD_PROPERTIES, LOOK_PROPERTY_KEYWORDS, LOOK_PROPERTY_VALUE_KINDS, LOOK_SHARED_METRIC_KEYWORDS, LOOK_UNITLESS_PROPERTIES, lookOwnKeywords, lookVarReferenceName } from "../../look.ts";
import { type LookValueSite, mentionsLookUnitType } from "../look-sites.ts";
import { literalStringValues, lookColorKeywords, lookCssWideKeywords, lookFilterRewrite, lookMetricKeywords, type LookValueGuidance, lookVocabularyGuidance, lookVocabularyLead } from "../look-vocabulary-guidance.ts";
import { diagnostic } from "../web-types.ts";
import { localizeLookBuilderCall, lookBuilderRewrite } from "./edits.ts";
import { type LookAnalysisHost } from "./host.ts";
import { lookTokenCallText, lookTokenRewrite } from "./tokens.ts";

/**
 * `subject` names the position in the message. It is the property itself
 * everywhere except the `transition(...)` builder, whose first argument takes
 * `transitionProperty`'s vocabulary but is not written as that property — a
 * refusal that named the longhand there would name a spelling the author
 * never wrote.
 */
export function validateLookStringVocabulary(host: LookAnalysisHost, name: string, value: Expression, subject = `Look property '${name}'`, site?: LookValueSite): boolean {
  const kind = LOOK_PROPERTY_VALUE_KINDS.get(name);
  if (!kind || kind === "text" || kind === "filter" || kind === "transform" || kind === "animation") return true;
  const values = literalStringValues(value) ?? foldedLookKeyword(host, value);
  if (values === null) return true;
  for (const text of values) {
    const normalized = text.trim();
    // D103 rule 4: this is the refusal the shell wave met — every metric,
    // shadow and transition property turned a design token reference away and
    // named `import css unsafe` as the only way out, which is how a product's
    // whole visual layer ended up outside Look. The reference is still
    // refused as free text, because free text is what it was; what changed is
    // that the refusal now names the checked spelling of the same reference
    // and rewrites to it.
    const referenced = site && lookVarReferenceName(normalized);
    if (referenced) {
      const { call } = lookTokenCallText(host, referenced);
      host.diagnostics.push(diagnostic(
        "VEL5038",
        `${subject} does not accept the text '${normalized}'; write the design token reference as ${call}, which is checked and legal in every Look property`,
        value.span,
        mechanicalEdits(lookTokenRewrite(host, value, referenced, site), `Use ${call}`),
      ));
      return false;
    }
    if (kind === "metric" && /^[+-]?(?:\d+(?:\.\d+)?|\.\d+)(?:px|rem|em|vw|vh|vmin|vmax|%|fr|ms|s|deg|turn)$/u.test(normalized)) {
      host.diagnostics.push(diagnostic(
        "VEL5038",
        `Use the unit literal ${normalized}; quoted unit values are not part of Look`,
        value.span,
      ));
      return false;
    }
    let accepted: boolean;
    // A metric property is a unit value plus a keyword half: its own CSS
    // keywords when it has a table -- `backgroundSize` takes lengths *and*
    // cover and contain, the `<position>` properties take the placement words
    // (D60 rule 150, D67 rule 172) -- and the shared sizing words when it has
    // none. The two are alternatives rather than a union, for the reason D65
    // rule 168 gave for the keyword kind: a shared list added on top of a
    // real table decides values for a property it has never heard of, so
    // `objectPosition = "min-content"` would compile and reach the browser as
    // a declaration it discards.
    const metricKeywords = LOOK_PROPERTY_KEYWORDS.get(name);
    if (kind === "metric") accepted = metricKeywords === undefined ? lookMetricKeywords.has(normalized) : metricKeywords.has(normalized);
    else if (kind === "color" || kind === "background") accepted = lookColorKeywords.has(normalized) || /^#[0-9a-f]{3,8}$/iu.test(normalized);
    else if (kind === "image") accepted = lookCssWideKeywords.has(normalized) || normalized === "none";
    // D73 rule 187: every kind that decides a string keyword reads the
    // property's own closed set, and look.ts refuses to load if one is
    // missing. The 46-word shared list this replaces both admitted values the
    // property never had and made the refusal describe a table that did not
    // exist.
    else accepted = LOOK_PROPERTY_KEYWORDS.get(name)?.has(normalized) === true;
    if (!accepted) {
      // D67 rule 174, widened by D73 rule 187: every refusal now names the
      // property's own values, because every one of these kinds has them. The
      // lead says what the non-keyword half of the property is, so a reader
      // who wanted a length, an angle or a builder is not sent looking through
      // a keyword list for it.
      const expected: LookValueGuidance = kind === "metric"
        ? lookVocabularyGuidance(name, normalized,
          metricKeywords === undefined ? LOOK_SHARED_METRIC_KEYWORDS : lookOwnKeywords(name),
          "write a unit value such as 16px, 1rem or 50%, or one of")
        : kind === "color" || kind === "background"
          ? { text: "use a checked color() or color keyword", named: false }
          : kind === "image"
            ? { text: "use a checked image builder such as linearGradient() or asset()", named: false }
            : lookVocabularyGuidance(name, normalized, lookOwnKeywords(name), lookVocabularyLead(kind));
      // D65 rule 169: a property whose CSS value space no set can hold says
      // what it left out, so the boundary is legible where it is met.
      const partial = expected.named ? undefined : LOOK_PARTIAL_KEYWORD_PROPERTIES.get(name);
      host.diagnostics.push(diagnostic("VEL5038", `${subject} does not accept '${normalized}'; ${expected.text}${partial
        ? `. ${partial}; use a module-level 'import css unsafe "./styles.css" before look' when that boundary is intentional`
        : ""}`, value.span));
      return false;
    }
  }
  return true;
}

/**
 * D65 rule 168 closed the closed sets against misspelled literals, and D65
 * item 3 makes a `const` string a first-class design token — so the two have
 * to agree. A name or a record field that folds to a bare CSS keyword is
 * checked exactly as the literal spelling of it is; anything that folds to
 * composed CSS text (a builder result, a unit, a gradient) is not a keyword
 * and is left to the type and to the builder's own checks.
 */
export function foldedLookKeyword(host: LookAnalysisHost, value: Expression): readonly string[] | null {
  if (value.kind !== "IdentifierExpression" && value.kind !== "MemberExpression") return null;
  const folded = evaluateLookStaticExpression(value, host.lookStatic.values);
  if (folded?.kind !== "css" || !/^[A-Za-z][A-Za-z0-9-]*$/u.test(folded.value)) return null;
  return [folded.value];
}

/**
 * LOK-D3: a bare number on a length property reaches CSS as a declaration the
 * browser discards. The union already rejects it; this diagnostic replaces the
 * union dump with the unit the author meant to write.
 */
export function reportLookNumberWithoutUnit(host: LookAnalysisHost, name: string, actual: ValueType, expected: ValueType, valueSpan: Span): boolean {
  if (host.expandAliases(actual).kind !== "number" || LOOK_UNITLESS_PROPERTIES.has(name)) return false;
  if (!mentionsLookUnitType(expected)) return false;
  host.diagnostics.push(diagnostic(
    "VEL5038",
    `Look property '${name}' is a CSS length and requires a unit; write a unit value such as 16px, 1rem, or 50%`,
    valueSpan,
  ));
  return true;
}

/**
 * A complete CSS filter function whose arguments fit the checked Look
 * builders has one equivalent source spelling. The parser deliberately
 * stops at the first function or argument grammar it cannot prove, leaving
 * arbitrary CSS and externally defined filter functions as ordinary text.
 */
export function adviseLookFilterSpelling(host: LookAnalysisHost, name: string, value: Expression, site: LookValueSite): void {
  if (LOOK_PROPERTY_VALUE_KINDS.get(name) !== "filter") return;
  if (value.kind !== "LiteralExpression" || typeof value.value !== "string") return;
  const rewrite = lookFilterRewrite(value.value);
  if (!rewrite) return;
  const localized = localizeLookBuilderCall(host, rewrite);
  host.advise(
    "A16",
    `Look property '${name}' accepts CSS filter text, but this complete filter list has the checked equivalent ${localized.call}`,
    value.span,
    mechanicalEdits(
      lookBuilderRewrite(host, value, localized.call, site, localized.missingImports),
      `Use ${localized.call}`,
    ),
  );
}
