/**
 * What a module's `look:` values become: the runtime value a `look:` expression
 * evaluates to, and the stylesheet the module ships beside its JavaScript.
 *
 * D115 P4 R3d: the family owns both halves because they are one lowering read
 * twice — `emitLook` writes the token a rule is addressed by, and `prepareLooks`
 * writes the rule that token selects. `emit/look-css.ts` holds the token itself,
 * so neither half can drift from the other.
 */
import type { CompilerStyleSegments, Expression, Program } from "@velarscript/compiler/extension";
import { spanIdentity } from "@velarscript/compiler/extension";
import {
  isWebStatement,
  type WebJsxElementExpression as JSXElementExpression,
  type WebKeyframesExpression as KeyframesExpression,
  type WebLookEntry as LookEntry,
  type WebLookExpression as LookExpression,
} from "../ast.ts";
import { isCssDeclarationValue } from "../css-tokens.ts";
import { keyframeCssValue, keyframesCanonical, keyframesName } from "../keyframes.ts";
import { collectLookStaticValues, type LookStaticValue } from "../look-static.ts";
import { cssPropertyName, LOOK_PROPERTIES, LOOK_PROPERTY_VALUE_KINDS } from "../look.ts";
import {
  combineLookTerms,
  EMPTY_LOOK_TERM,
  lookConditionDepth,
  lookConditionTerms,
  lookDeclaration,
  lookMediaQuery,
  lookSelectors,
  lookToken,
  type LookConditionTerm,
  type LookRule,
  type LookStaticAtom,
} from "./look-css.ts";

/**
 * What Look emission reads and writes on the emitter. `lookStaticValues`,
 * `cssSegments` and `cssOutput` are live: `prepareLooks` assigns them and the
 * emitter's `css()` / `styleSegments()` answer with what it assigned.
 */
export interface LookEmitHost {
  cssOutput: string;
  cssSegments: CompilerStyleSegments;
  readonly importedLookStaticValues: ReadonlyMap<string, LookStaticValue>;
  readonly keyframeNames: Map<string, string>;
  readonly lookKeywordProperties: Set<string>;
  lookStaticValues: ReadonlyMap<string, LookStaticValue>;
  readonly resourceContents: ReadonlyMap<string, string>;
  emitCondition(expression: Expression): string;
  emitMappedExpression(expression: Expression): string;
}

/** The rules and keyframe blocks one program declares. */
interface LookRuleCollection {
  readonly rules: ReadonlyMap<string, LookRule>;
  readonly keyframeRules: ReadonlyMap<string, string>;
}

/** The author-owned CSS a module places before and after the compiler's own. */
interface UnsafeCssSegments {
  readonly before: string;
  readonly after: string;
}

export function emitLook(host: LookEmitHost, expression: LookExpression): string {
  return `__velarLook([${emitLookEntries(host, expression.entries, [EMPTY_LOOK_TERM], "").join(", ")}])`;
}

function emitLookEntries(host: LookEmitHost, entries: readonly LookEntry[], contexts: readonly LookConditionTerm[], target: string): readonly string[] {
  const parts: string[] = [];
  for (const entry of entries) {
    if (entry.kind === "LookSpread") {
      parts.push(host.emitMappedExpression(entry.value));
      continue;
    }
    if (entry.kind === "LookIf") {
      const thenContexts = combineLookTerms(contexts, lookConditionTerms(entry.condition, false, host.lookStaticValues));
      const elseContexts = combineLookTerms(contexts, lookConditionTerms(entry.condition, true, host.lookStaticValues));
      parts.push(...emitLookEntries(host, entry.thenEntries, thenContexts, target));
      parts.push(...emitLookEntries(host, entry.elseEntries, elseContexts, target));
      continue;
    }
    if (entry.kind === "LookTarget") {
      parts.push(...emitLookEntries(host, entry.entries, contexts, entry.name));
      continue;
    }
    const property = cssPropertyName(entry.name);
    for (const context of contexts) {
      const token = lookToken(context.staticAtoms, target, property);
      const rule = `{ rules: { ${JSON.stringify(token)}: ${emitLookValue(host, entry.value)} } }`;
      const runtime = context.runtimeAtoms.map((atom) => {
        const value = host.emitCondition(atom.expression);
        return atom.negated ? `!(${value})` : `(${value})`;
      }).join(" && ");
      parts.push(runtime ? `(${runtime} ? ${rule} : null)` : rule);
    }
  }
  return parts;
}

function emitLookValue(host: LookEmitHost, expression: Expression): string {
  return host.emitMappedExpression(expression);
}

export function emitLookArithmetic(host: LookEmitHost, expression: Extract<Expression, { readonly kind: "BinaryExpression" }>): string {
  return `__velarLookMath(${JSON.stringify(expression.operator)}, ${host.emitMappedExpression(expression.left)}, ${host.emitMappedExpression(expression.right)})`;
}

/**
 * Every Look rule and `@keyframes` block this module declares, in one walk of
 * the program. The walk also records the two facts later phases need: the
 * generated name each `keyframes:` expression compiles to, and the closed
 * keyword sets the runtime guard has to carry.
 */
function collectLookRules(host: LookEmitHost, program: Program): LookRuleCollection {
  const rules = new Map<string, LookRule>();
  const keyframeRules = new Map<string, string>();
  const keyframeCanonicals = new Map<string, string>();
  host.keyframeNames.clear();
  host.lookKeywordProperties.clear();
  // A token's stylesheet position used to be wherever it first appeared
  // anywhere in the module, because a Map keeps first-insertion order. The
  // sequence records that first appearance explicitly so emission can sort by
  // condition rank first and fall back to declaration order, rather than
  // letting an unrelated earlier look decide a later one's winner (LOK-U8).
  let sequence = 0;
  const addRule = (token: string, property: string, target: string, staticAtoms: readonly LookStaticAtom[]): void => {
    if (rules.has(token)) return;
    rules.set(token, { token, property, target, staticAtoms, sequence: sequence += 1 });
  };
  const noteKeywordProperty = (name: string): void => {
    if (LOOK_PROPERTY_VALUE_KINDS.get(name) === "keyword") host.lookKeywordProperties.add(name);
  };
  const visit = (value: unknown): void => {
    if (!value || typeof value !== "object") return;
    const record = value as Record<string, unknown>;
    if (record.kind === "ExtensionExpression:web:jsx") {
      const element = record as unknown as JSXElementExpression;
      for (const attribute of element.attributes) {
        if (!attribute.name.startsWith("look:") && !attribute.name.startsWith("style:")) continue;
        const name = attribute.name.slice(attribute.name.indexOf(":") + 1);
        if (!LOOK_PROPERTIES.has(name)) continue;
        noteKeywordProperty(name);
        if (!attribute.name.startsWith("look:")) continue;
        const property = cssPropertyName(name);
        addRule(lookToken([], "", property), property, "", []);
      }
    }
    if (record.kind === "ExtensionExpression:web:look") {
      const collect = (entries: readonly LookEntry[], contexts: readonly LookConditionTerm[] = [EMPTY_LOOK_TERM], target = ""): void => {
        for (const entry of entries) {
          if (entry.kind === "LookProperty") {
            const property = cssPropertyName(entry.name);
            noteKeywordProperty(entry.name);
            for (const context of contexts) {
              addRule(lookToken(context.staticAtoms, target, property), property, target, context.staticAtoms);
            }
          } else if (entry.kind === "LookIf") {
            collect(entry.thenEntries, combineLookTerms(contexts, lookConditionTerms(entry.condition, false, host.lookStaticValues)), target);
            collect(entry.elseEntries, combineLookTerms(contexts, lookConditionTerms(entry.condition, true, host.lookStaticValues)), target);
          } else if (entry.kind === "LookTarget") {
            collect(entry.entries, contexts, entry.name);
          }
        }
      };
      collect(record.entries as LookExpression["entries"]);
    }
    if (record.kind === "ExtensionExpression:web:keyframes") {
      const expression = record as unknown as KeyframesExpression;
      const canonical = keyframesCanonical(expression, host.lookStaticValues);
      const name = keyframesName(canonical);
      host.keyframeNames.set(spanIdentity(expression.span), name);
      const reused = keyframeCanonicals.get(name);
      // The name is a promise that equal structures share one rule. Reusing
      // it for a structure that is not equal would make one animation play
      // another's motion, so the reuse path proves the identity rather than
      // trusting the digest (LOK-U11).
      if (reused !== undefined && reused !== canonical) {
        throw new Error(`Generated keyframes name ${name} collides between two different keyframe structures`);
      }
      if (reused === undefined) {
        keyframeCanonicals.set(name, canonical);
        const stops = [...expression.stops]
          .sort((left, right) => Math.min(...left.offsets) - Math.min(...right.offsets))
          .map((stop) => {
            const selectors = [...stop.offsets].sort((left, right) => left - right)
              .map((offset) => offset === 0 ? "from" : offset === 100 ? "to" : `${offset}%`)
              .join(",");
            const declarations = stop.entries.map((entry) => {
              const css = keyframeCssValue(entry.value, host.lookStaticValues);
              // A value the lowering could not prove is one balanced
              // declaration never reaches the concatenation: `}` in a stop
              // closed the at-rule and turned the rest into author-owned CSS
              // in the compiler-owned segment (LOK-U9). The analyzer already
              // reports the same null as a diagnostic, so emission only has
              // to stay structurally incapable of writing the escape.
              return css === null || !isCssDeclarationValue(css) ? "" : `${cssPropertyName(entry.name)}:${css}`;
            }).filter(Boolean).join(";");
            return `${selectors}{${declarations}}`;
          }).join("");
        keyframeRules.set(name, `@keyframes ${name}{${stops}}`);
      }
    }
    for (const child of Object.values(record)) {
      if (Array.isArray(child)) child.forEach(visit);
      else visit(child);
    }
  };
  visit(program);

  return { rules, keyframeRules };
}

/**
 * The compiler-owned half of the stylesheet: one CSS rule per Look token, in
 * the order the cascade has to read them.
 */
function lookRuleCss(rules: ReadonlyMap<string, LookRule>): readonly string[] {
  return [...rules.values()]
    .map((rule) => ({ rule, depth: lookConditionDepth(rule.staticAtoms) }))
    // Rank decides, and declaration order only separates rules that share a
    // rank. Emission used to follow the Map, so the sheet's byte order — and
    // through it the per-module concatenation order the CLI sorts by
    // filename — could pick the winner of a tie (LOK-U8, LOK-U10).
    .sort((left, right) => left.depth - right.depth || left.rule.sequence - right.rule.sequence)
    .map(({ rule, depth }) => {
      const hookAtoms = rule.staticAtoms.filter((atom) => atom.kind === "hook");
      const mediaAtoms = rule.staticAtoms.filter((atom) => atom.kind === "media" || atom.kind === "scheme" || atom.kind === "motion");
      const base = `[data-velar-look~=${JSON.stringify(rule.token)}]${"[data-velar-look]".repeat(depth)}`;
      const selectors = lookSelectors(base, hookAtoms, rule.target);
      const css = `${selectors.join(",")}{${lookDeclaration(rule.token, rule.property)}}`;
      const query = mediaAtoms.map(lookMediaQuery).join(" and ");
      return query ? `@media ${query}{${css}}` : css;
    });
}

/**
 * The author-owned CSS either side of the compiler's own, in declaration order.
 */
function unsafeCssSegments(host: LookEmitHost, program: Program): UnsafeCssSegments {
  const before: string[] = [];
  const after: string[] = [];
  for (const statement of program.body) {
    if (!isWebStatement(statement) || statement.kind !== "ExtensionStatement:web:unsafe-css") continue;
    const source = statement.source.kind === "inline"
      ? statement.source.css
      : host.resourceContents.get(statement.source.path) ?? "";
    (statement.placement === "after" ? after : before).push(source.trim());
  }
  return { before: before.filter(Boolean).join("\n\n"), after: after.filter(Boolean).join("\n\n") };
}

/**
 * The module's Look state, prepared before a single statement is emitted: the
 * static values a condition may fold against, the stylesheet, and the keyframe
 * name every `keyframes:` expression will be emitted as.
 */
export function prepareLooks(host: LookEmitHost, program: Program): void {
  host.lookStaticValues = collectLookStaticValues(program, host.importedLookStaticValues);
  const { rules, keyframeRules } = collectLookRules(host, program);
  const lookCss = lookRuleCss(rules);
  const unsafe = unsafeCssSegments(host, program);
  host.cssSegments = {
    before: unsafe.before,
    controlled: [...keyframeRules.values(), ...lookCss].filter(Boolean).join("\n\n"),
    after: unsafe.after,
  };
  host.cssOutput = [host.cssSegments.before, host.cssSegments.controlled, host.cssSegments.after].filter(Boolean).join("\n\n");
  if (host.cssOutput) host.cssOutput += "\n";
}
