import { CORE_VOCABULARY_NAMES } from "./core-vocabulary.ts";
import { VELAR_HOST_ERROR_NAMES } from "./error-runtime.ts";
import { keywordKinds, type TokenKind } from "./token.ts";

export interface ForbiddenSourceIdentifierRule {
  readonly guidance: string;
  /** Tokens used only to recover after reporting the source spelling. */
  readonly recovery: readonly { readonly kind: TokenKind; readonly value: string }[] | null;
  /**
   * D38 §48: the source text that replaces this spelling, registered only where
   * the guidance names exactly one successor. `null` keeps the rule advice —
   * 'var' offers 'let' or 'const', which is the author's choice to make.
   */
  readonly fix: string | null;
  /**
   * D90 (compiler-front-9): the spelling is refused as a binding, a parameter
   * and a type, but is an ordinary member name and record key. The charter's
   * reserved-spelling paragraph already promises this of the words JavaScript
   * reserves — external data and Web APIs do not need renamed fields — and
   * `int` (velar/random owns `Random.int(...)`) and `with`
   * (`Array.prototype.with`, `Temporal.PlainDate.prototype.with`, and every
   * builder API spelled that way) are the two rules here that answer to it.
   * Execution-capability spellings such as `eval` deliberately do not: the
   * charter keeps them unavailable through direct member syntax.
   */
  readonly memberLegal: boolean;
}

function forbidden(
  guidance: string,
  recovery: ForbiddenSourceIdentifierRule["recovery"],
  fix: string | null = null,
  memberLegal = false,
): ForbiddenSourceIdentifierRule {
  return { guidance, recovery, fix, memberLegal };
}

/**
 * Source spellings rejected before they can acquire ordinary VelarScript
 * semantics. Some rules emit recovery tokens for additional diagnostics.
 * Keep this compiler-owned so editor refactors cannot create rejected source.
 */
export const forbiddenSourceIdentifiers: ReadonlyMap<string, ForbiddenSourceIdentifierRule> = new Map([
  ["var", forbidden("Use 'let' or 'const'; VelarScript does not expose 'var'", [{ kind: "let", value: "let" }])],
  ["undefined", forbidden("Use 'null'; VelarScript does not expose 'undefined'", [{ kind: "null", value: "null" }], "null")],
  ["none", forbidden("Use 'null'; VelarScript uses the Web-native empty value spelling", [{ kind: "null", value: "null" }], "null", true)],
  ["None", forbidden("Use 'null'; VelarScript keywords are lowercase and Web-native", [{ kind: "null", value: "null" }], "null")],
  ["True", forbidden("Use 'true'; VelarScript keywords are lowercase", [{ kind: "true", value: "true" }], "true")],
  ["False", forbidden("Use 'false'; VelarScript keywords are lowercase", [{ kind: "false", value: "false" }], "false")],
  ["elif", forbidden("Use 'else if'; VelarScript keeps ordinary readable if chains", [{ kind: "else", value: "else" }, { kind: "if", value: "if" }], "else if")],
  ["int", forbidden("Use 'number'; VelarScript has one JavaScript numeric type", [{ kind: "identifier", value: "number" }], "number", true)],
  ["float", forbidden("Use 'number'; VelarScript has one JavaScript numeric type", [{ kind: "identifier", value: "number" }], "number")],
  ["switch", forbidden("Use 'match' for strict pattern dispatch", [{ kind: "identifier", value: "match" }], "match")],
  ["this", forbidden("Use explicit 'self' inside methods; VelarScript does not expose dynamic 'this'", [{ kind: "identifier", value: "self" }], "self")],
  ["new", forbidden("Call a class directly; VelarScript does not expose 'new'", [], "")],  ["eval", forbidden("VelarScript does not expose 'eval'", null)],
  // D89 (message correction): the author who writes 'with' is writing Python's
  // context manager, not a record update. 'using name = expression' owns the
  // value and releases it when the scope ends, which is the whole of what
  // 'with X as y:' does.
  // D90 (compiler-front-9): the ban is on the infix record-update spelling and
  // on any binding named 'with'. `value.with(...)`, `{with: 1}` and a member
  // declared `with` are ordinary code, so `Array.prototype.with` and the
  // builder APIs spelled that way stay callable.
  ["with", forbidden("Use 'using name = expression'; it owns the value and releases it when the scope ends, and VelarScript does not expose 'with'", null, null, true)],
  // D90 (coherence): the last Python statement reflex in this curated list.
  // `const f = lambda x: x` used to land on the newline diagnostic — a
  // sentence about statement layout for a spelling that is simply the wrong
  // word. It carries no fix: rewriting `lambda x: x` into `x => x` means
  // reading the parameter list and the colon, which is judgment rather than a
  // mechanical substitution, and a fix that guesses is worse than none.
  // `memberLegal` for the same reason `int` carries it: a rate or a
  // regularization weight arrives from external data spelled `lambda`, and a
  // record key is never the Python statement.
  ["lambda", forbidden("Use an arrow — 'value => expression'; VelarScript does not expose 'lambda'", null, null, true)],
]);

const coreReservedBindings = new Set([
  // D57 rule 135: Core's own vocabulary is *derived* from its roster, never
  // restated here. The list below is only the JavaScript spellings a generated
  // module reaches for; when it also carried the Vel names, `Math` was
  // protected purely because it is a JavaScript global too and
  // `Json`/`Promise`/`Text`/`equals`/`range` were not protected at all.
  ...CORE_VOCABULARY_NAMES,
  "Array", "Boolean", "Error", "IndexError", "JSON", "Map", "NarrowingError", "Number", "Object", "RangeError", "Reflect", "Set", "String",
  "Symbol", "TypeError", "ValidationError", "WeakMap", "WeakSet", "console", "document", "globalThis", "queueMicrotask", "self",
  // D50 rule 89: the capability error classes are nameable everywhere a
  // `catch` can see them, so a bare reference is always the builtin.
  ...VELAR_HOST_ERROR_NAMES,
]);

// Spellings JavaScript reserves that VelarScript does not turn into a keyword
// token. They are ordinary identifiers to the lexer — legal as record fields and
// member names, which JavaScript also permits — but no binding may spell one,
// because generated modules must remain valid JavaScript. `case` is here rather
// than among the contextual keywords for exactly that reason: D30 item 16
// softened it as a Vel word, and JavaScript still refuses `const case = ...`.
const javaScriptReservedBindings = new Set([
  "arguments", "case", "debugger", "default", "delete", "do", "function", "implements", "instanceof", "interface", "package", "protected", "public", "typeof", "void", "yield",
]);

const forbiddenPrototypeMembers = new Set(["prototype", "__proto__"]);
const sourceIdentifierPattern = /^[A-Za-z_$][A-Za-z0-9_$]*$/u;

export type BindingNameRestriction = "invalid" | "keyword" | "source" | "javascript" | "compiler" | "core" | "extension";
export type MemberNameRestriction = "invalid" | "source" | "prototype" | "constructor" | "enum-runtime";

export function isValidSourceIdentifier(name: string): boolean {
  return sourceIdentifierPattern.test(name);
}

export function isSourceIdentifierStart(character: string): boolean {
  return /^[A-Za-z_$]$/u.test(character);
}

export function isSourceIdentifierPart(character: string): boolean {
  return /^[A-Za-z0-9_$]$/u.test(character);
}

export function bindingNameRestriction(
  name: string,
  extensionReservedBindings: ReadonlySet<string> = new Set(),
): BindingNameRestriction | null {
  if (!isValidSourceIdentifier(name)) return "invalid";
  // D30 item 16: an extension's contextual keywords are ordinary names, so only
  // the hard-reserved spellings are refused here.
  if (Object.hasOwn(keywordKinds, name)) return "keyword";
  if (forbiddenSourceIdentifiers.has(name)) return "source";
  if (javaScriptReservedBindings.has(name)) return "javascript";
  if (name.toLowerCase().startsWith("__velar")) return "compiler";
  if (coreReservedBindings.has(name)) return "core";
  if (extensionReservedBindings.has(name)) return "extension";
  return null;
}

export function memberNameRestriction(name: string, owner: "class" | "enum" | "data"): MemberNameRestriction | null {
  if (!isValidSourceIdentifier(name)) return "invalid";
  // A rule that is legal in member position declares as well as it reads:
  // refusing `def with(...)` while accepting `q.with(...)` would leave an
  // extern declaration unable to describe the API it is there to describe.
  if (forbiddenSourceIdentifiers.get(name)?.memberLegal === false) return "source";
  if (forbiddenPrototypeMembers.has(name)) return "prototype";
  if (owner === "class" && name === "constructor") return "constructor";
  if (owner === "enum" && (name === "is" || name === "parse" || name === "values")) return "enum-runtime";
  return null;
}

export function isCoreReservedBinding(name: string): boolean {
  return coreReservedBindings.has(name);
}

export function isJavaScriptReservedBinding(name: string): boolean {
  return javaScriptReservedBindings.has(name);
}

export function isForbiddenPrototypeMember(name: string): boolean {
  return forbiddenPrototypeMembers.has(name);
}

/**
 * D90 (compiler-front-15): whether a name standing between `<` and `>` is
 * evidence that the pair is a type argument list rather than a comparison.
 * `<` and `>` are comparison operators everywhere the grammar can tell, so the
 * only names that tip the reading are the ones a type argument list is made of:
 * a builtin type spelling, or a capitalized name, which is how VelarScript
 * writes every type it declares.
 *
 * Two readers ask this question and both must answer it identically — the
 * parser, deciding which grammar `Map<string, number>()` is, and the formatter,
 * deciding whether to space those brackets as operators. When they disagreed,
 * `velar format` rewrote the line into the spelling of the *other* reading.
 */
export function isTypeEvidenceName(value: string): boolean {
  if (builtinTypeEvidenceNames.has(value)) return true;
  const first = value[0] ?? "";
  return first >= "A" && first <= "Z";
}

const builtinTypeEvidenceNames = new Set([
  "string", "number", "bool", "null", "unknown", "any",
  "List", "Set", "Map", "Record", "Promise", "Function", "Type", "readonly",
]);
