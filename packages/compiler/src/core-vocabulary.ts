/**
 * D57 rules 134/135: the one roster of Core's own vocabulary — the permanent
 * (resident) namespaces and the prelude names that need no import.
 *
 * Every place that has to know the whole vocabulary derives it from here: the
 * analyzer's builtin table is keyed by these names, and `source-names.ts`
 * refuses them as binding spellings by reading this roster rather than by
 * restating it. Before that, the refusal list was a hand-kept copy of the
 * JavaScript globals, so `Math` was protected only because it happens to be a
 * JavaScript global too, while `Json`, `Promise`, `Text`, `equals`, and
 * `range` were not protected at all. Adding a namespace or a prelude name
 * here is now the whole change; nothing downstream can stay behind.
 *
 * This module deliberately holds names only — no types, no imports — so the
 * lexer-facing `source-names.ts` and the analyzer can both read it without a
 * cycle between them.
 */

/** The namespaces that are always in scope and are not values (D51 rule 106). */
export const PERMANENT_NAMESPACE_NAMES = ["Json", "Promise", "Text", "Math"] as const;

/** The prelude functions that need no import (D47 rule 81, D50 rule 90). */
export const CORE_PRELUDE_NAMES = ["number", "str", "print", "equals", "range"] as const;

export type PermanentNamespaceName = (typeof PERMANENT_NAMESPACE_NAMES)[number];
export type CorePreludeName = (typeof CORE_PRELUDE_NAMES)[number];
export type CoreVocabularyName = PermanentNamespaceName | CorePreludeName;

/** The full Core vocabulary: no binding may spell one of these (D57 rule 135). */
export const CORE_VOCABULARY_NAMES: readonly CoreVocabularyName[] = [
  ...PERMANENT_NAMESPACE_NAMES,
  ...CORE_PRELUDE_NAMES,
];

export function isPermanentNamespaceName(name: string): name is PermanentNamespaceName {
  return (PERMANENT_NAMESPACE_NAMES as readonly string[]).includes(name);
}
