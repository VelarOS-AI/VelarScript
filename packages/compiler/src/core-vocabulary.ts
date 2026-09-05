/**
 * D57 rules 134/135 and D62 rules 157/158: the one roster of Core's own
 * vocabulary — the permanent (resident) namespaces, the prelude names that
 * need no import, the contextual keywords, and the numeric suffixes.
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
 * The contextual keywords arrived the same way and worse: D62 rule 157 found
 * four partial copies (`parser.ts` knew one word by table and the rest as
 * inline literals, `formatter.ts` knew two, `language-server.ts` knew six) and
 * **no original at all**, so charter §3's cross-cutting claim — that each of
 * these words is an ordinary name in seven positions — named a set nothing
 * could enumerate. It is enumerable here now.
 *
 * This module deliberately holds names and plain data — no imports — so the
 * lexer-facing `source-names.ts`, the lexer, the parser, the formatter and the
 * analyzer can all read it without a cycle between them.
 */

/**
 * D110 rule 3 — the Core surface version. Core is the one surface that had no
 * version identity at all: Web, Node, Server and Desktop each carried a
 * `VELAR_*_API_VERSION` while the language itself was described only by the npm
 * version every package steps together, so "desktop 0.25.0" and "core 0.25.0"
 * said the same thing about two surfaces that had not moved together in months.
 *
 * Counting started at `0.1` in 0.25.0 and history is deliberately not
 * recomputed: `N` is how many times this surface has changed *since counting
 * began*, never a maturity grade. Core reading lower than an extension says
 * only that Core started counting last.
 *
 * It lives beside the vocabulary rather than beside the standard library
 * because the Core surface spans both halves — the words in this file, the
 * types, the statement constructs, and `packages/core`'s standard modules — and
 * this module is the one both halves can read. It is *not*
 * `VELAR_STANDARD_API_VERSION`, which versions the standard-module API report
 * alone; `scripts/check-surface-versions.mjs` computes the whole Core surface's
 * digest and refuses a change that leaves this number behind.
 */
export const VELAR_CORE_API_VERSION = "0.6";

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

/**
 * D62 rule 157: one entry per word the lexer emits as an ordinary identifier
 * and the Core parser claims as syntax in one shape and nowhere else.
 *
 * Membership is decided by *live* syntax. A word the parser recognizes only in
 * order to reject it is not here: `init` (the removed `init:` block), `set`
 * (VelarScript has no setters), `default` (no default export), and `invert`
 * (the removed toggle statement) are spellings the language does not have, and
 * requiring a tour or an editor to offer them would resurrect them. `dispose`
 * is not here either — it is only ever read after `@`, which selects the
 * separate closed compiler-owned vocabulary of the current syntax context.
 */
export interface CoreContextualKeyword {
  /** The spelling, as the lexer emits it. */
  readonly word: string;
  /** The one shape the parser claims it in, for the reader of this file. */
  readonly shape: string;
  /**
   * Whether, at the head of a statement line, what follows the word opens a
   * fresh expression rather than being applied to it. This is the question the
   * formatter's spacing and the arrow-brace statement scan both ask, and the
   * answer is not "is it a keyword": `constructor(name: string):` occupies a
   * declaration's *name* slot, so its `(` binds tight exactly as `def f(`
   * does, while `match (value):` and `case -1:` keep the separating space.
   */
  readonly statementSubjectFollows: boolean;
}

export const CORE_CONTEXTUAL_KEYWORDS = [
  { word: "as", shape: "an import alias and a match binding: 'import {a as b}', 'case Shape.circle as c:'", statementSubjectFollows: false },
  { word: "case", shape: "a match branch: 'case Status.done:'", statementSubjectFollows: true },
  { word: "constructor", shape: "a class's construction member: 'constructor(name: string):'", statementSubjectFollows: false },
  { word: "from", shape: "the module an import or a re-export reads: 'import {a} from \"./m.vel\"'", statementSubjectFollows: false },
  { word: "get", shape: "a class getter: 'get empty() -> bool:'", statementSubjectFollows: false },
  { word: "json", shape: "a checked JSON resource import: 'import json data from \"package/data\"'", statementSubjectFollows: false },
  { word: "match", shape: "a match statement: 'match value:'", statementSubjectFollows: true },
  { word: "readonly", shape: "a read-only record field, record declaration, or type view: 'readonly tags: List<string>', 'readonly type Snapshot:', 'readonly Snapshot'", statementSubjectFollows: false },
  { word: "test", shape: "a test declaration: 'test \"a name\":'", statementSubjectFollows: false },
  { word: "type", shape: "a record type or a type alias: 'type User:', 'type Id = string'", statementSubjectFollows: false },
  { word: "using", shape: "a scoped resource binding: 'using file = open(path)'", statementSubjectFollows: false },
] as const satisfies readonly CoreContextualKeyword[];

export type CoreContextualKeywordWord = (typeof CORE_CONTEXTUAL_KEYWORDS)[number]["word"];

/**
 * The roster keyed by its own spellings, so a consumer names a word instead of
 * restating it: `CORE_WORDS.type` stops compiling the moment `type` leaves the
 * roster, which is what makes the derivation hold in both directions.
 */
export const CORE_WORDS: { readonly [Word in CoreContextualKeywordWord]: Word } = Object.freeze(
  Object.fromEntries(CORE_CONTEXTUAL_KEYWORDS.map((entry) => [entry.word, entry.word])),
) as { readonly [Word in CoreContextualKeywordWord]: Word };

/** The roster as bare spellings, for the consumers that need only the set. */
export const CORE_CONTEXTUAL_KEYWORD_WORDS: readonly CoreContextualKeywordWord[] =
  CORE_CONTEXTUAL_KEYWORDS.map((entry) => entry.word);

/**
 * Core 拥有的 `@name` 封闭词表，按名字出现的语法上下文分区。
 *
 * `@` 不是装饰器入口；解析器只能从这里列出的角色中选择。把模块与类放在同一个
 * 事实源中，可以保证新增角色时未知名字诊断、解析行为和编辑器文档不会各自猜测
 * 一份词表。扩展包继续拥有各自上下文的独立封闭词表。
 */
export const CORE_COMPILER_CONTEXTUAL_NAMES = Object.freeze({
  module: ["main"],
  declaration: ["context"],
  class: ["dispose", "iterate"],
} as const);

export type CoreCompilerContext = keyof typeof CORE_COMPILER_CONTEXTUAL_NAMES;
export type CoreCompilerContextualName<Context extends CoreCompilerContext> =
  (typeof CORE_COMPILER_CONTEXTUAL_NAMES)[Context][number];

/**
 * The words that stand where a keyword stands at the head of a statement line.
 * The formatter's spacing and the parser's arrow-brace scan both read this,
 * rather than each keeping the two-word copy D62 rule 157 found in them.
 */
export const CORE_STATEMENT_HEAD_KEYWORDS: readonly CoreContextualKeywordWord[] = CORE_CONTEXTUAL_KEYWORDS
  .filter((entry) => entry.statementSubjectFollows)
  .map((entry) => entry.word);

/**
 * D39-52 and D62 rule 158: the numeric suffixes Core owns on its own. Both are
 * Duration literals — `250ms`, `3s`. Extensions add visual units on top, and
 * the Web extension happens to republish these two through `LOOK_UNIT_TYPES`,
 * which is the only reason the coverage gate could see them at all before this
 * roster existed; a Core-only checkout checked neither.
 */
export const CORE_NUMERIC_SUFFIXES = ["ms", "s"] as const;
export type CoreNumericSuffix = (typeof CORE_NUMERIC_SUFFIXES)[number];

/**
 * D55 rule 120: the declaration forms that take `<T>`, as one roster. Every
 * refusal aimed at a form that does not take one names this list rather than
 * spelling its own copy — the copies are what made "only 'def' functions take
 * '<T>'" outlive the ruling that stopped being true. The tour-coverage gate
 * reads the same roster, so a form added here without an example goes red.
 */
export const TYPE_PARAMETER_DECLARATION_FORMS = ["def", "type", "class"] as const;
export type TypeParameterDeclarationForm = (typeof TYPE_PARAMETER_DECLARATION_FORMS)[number];

/** "'def' functions, 'type' records and 'class' declarations" — the one phrasing of the roster above. */
export function typeParameterDeclarationFormsPhrase(): string {
  const described: Record<TypeParameterDeclarationForm, string> = {
    def: "'def' functions",
    type: "'type' records",
    class: "'class' declarations",
  };
  const forms = TYPE_PARAMETER_DECLARATION_FORMS.map((form) => described[form]);
  return forms.length <= 1 ? forms.join("") : `${forms.slice(0, -1).join(", ")} and ${forms.at(-1)}`;
}
