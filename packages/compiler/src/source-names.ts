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
}

function forbidden(
  guidance: string,
  recovery: ForbiddenSourceIdentifierRule["recovery"],
  fix: string | null = null,
): ForbiddenSourceIdentifierRule {
  return { guidance, recovery, fix };
}

/**
 * Source spellings rejected before they can acquire ordinary VelarScript
 * semantics. Some rules emit recovery tokens for additional diagnostics.
 * Keep this compiler-owned so editor refactors cannot create rejected source.
 */
export const forbiddenSourceIdentifiers: ReadonlyMap<string, ForbiddenSourceIdentifierRule> = new Map([
  ["var", forbidden("Use 'let' or 'const'; VelarScript does not expose 'var'", [{ kind: "let", value: "let" }])],
  ["undefined", forbidden("Use 'null'; VelarScript does not expose 'undefined'", [{ kind: "null", value: "null" }], "null")],
  ["none", forbidden("Use 'null'; VelarScript uses the Web-native empty value spelling", [{ kind: "null", value: "null" }], "null")],
  ["None", forbidden("Use 'null'; VelarScript keywords are lowercase and Web-native", [{ kind: "null", value: "null" }], "null")],
  ["True", forbidden("Use 'true'; VelarScript keywords are lowercase", [{ kind: "true", value: "true" }], "true")],
  ["False", forbidden("Use 'false'; VelarScript keywords are lowercase", [{ kind: "false", value: "false" }], "false")],
  ["elif", forbidden("Use 'else if'; VelarScript keeps ordinary readable if chains", [{ kind: "else", value: "else" }, { kind: "if", value: "if" }], "else if")],
  ["int", forbidden("Use 'number'; VelarScript has one JavaScript numeric type", [{ kind: "identifier", value: "number" }], "number")],
  ["float", forbidden("Use 'number'; VelarScript has one JavaScript numeric type", [{ kind: "identifier", value: "number" }], "number")],
  ["switch", forbidden("Use 'match' for strict pattern dispatch", [{ kind: "identifier", value: "match" }], "match")],
  ["this", forbidden("Use explicit 'self' inside methods; VelarScript does not expose dynamic 'this'", [{ kind: "identifier", value: "self" }], "self")],
  ["new", forbidden("Call a class directly; VelarScript does not expose 'new'", [], "")],  ["eval", forbidden("VelarScript does not expose 'eval'", null)],
  ["with", forbidden("Use a record spread such as '{...value, field: next}' to build an updated record; VelarScript does not expose 'with'", null)],
]);

const coreReservedBindings = new Set([
  "Array", "Boolean", "Error", "IndexError", "JSON", "Map", "Math", "NarrowingError", "Number", "Object", "RangeError", "Reflect", "Set", "String",
  "Symbol", "TypeError", "ValidationError", "WeakMap", "WeakSet", "console", "document", "globalThis", "number", "print", "queueMicrotask", "self", "str",
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
  if (forbiddenSourceIdentifiers.has(name)) return "source";
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
