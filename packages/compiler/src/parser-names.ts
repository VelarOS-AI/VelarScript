/**
 * The two name questions the parser answers before the analyzer sees a
 * declaration: which words a declaring position cannot spell as themselves, and
 * which names in a type reference the author did not write.
 *
 * D115 §一.1: these live beside `parser.ts` rather than in it, whose recorded
 * ceiling the file budget holds at what it measured.
 */
import { type TypeSyntax } from "./ast.ts";
import { CORE_WORDS } from "./core-vocabulary.ts";
import { markGuidedTypeName, refusedAnyDeclarationMessage, sourceTypeNameGuidance } from "./language-guidance.ts";
import { keywordKinds, type Token } from "./token.ts";

/**
 * Why a word cannot name a `type`, `class`, or `enum`, when it cannot; `null`
 * when it can. The three reasons are one rule: a type position cannot spell the
 * name as itself, so a declaration under it would be unreachable from every
 * annotation.
 *
 * A reserved word reads as its keyword or literal everywhere. `readonly` reads
 * as the read-only view modifier, which `parseSingleTypeReference` takes before
 * it reads a name at all. A guided spelling with a replacement is rewritten to
 * that replacement in every type position, so the declaration and its uses
 * would name two different types.
 */
export function refusedDeclarationName(token: Token): { readonly because: string; readonly instead: string } | null {
  if (token.kind !== "identifier") {
    if (!Object.hasOwn(keywordKinds, token.value)) return null;
    const literal = token.value === "true" || token.value === "false" || token.value === "null";
    return { because: "is a reserved word", instead: literal ? "the literal" : "the keyword" };
  }
  if (token.value === CORE_WORDS.readonly) return { because: "is the read-only view modifier", instead: "the modifier" };
  // A guidance entry without a replacement leaves the name meaning the
  // declaration, so it is still a name; only a redirected spelling is refused.
  const replacement = sourceTypeNameGuidance(token.value)?.replacement ?? null;
  if (replacement === null) return null;
  return { because: `is guided to '${replacement}' in every type position`, instead: `'${replacement}'` };
}

const tokensByStart = new WeakMap<readonly Token[], Map<number, Token>>();

/** The token that opened each span in one parse, indexed once. */
function tokenIndex(tokens: readonly Token[]): Map<number, Token> {
  let index = tokensByStart.get(tokens);
  if (!index) {
    // Later entries win, so reversing leaves the earliest token at each start.
    index = new Map(tokens.map((token) => [token.span.start, token] as const).reverse());
    tokensByStart.set(tokens, index);
  }
  return index;
}

/**
 * RE-I4: flags every name in one type reference that the author did not
 * write. A guided spelling is reported where it stands and then recovered as
 * the name it is guided to, so `const value: Array` leaves a node spelled
 * `List` over a span spelling `Array`. The token that opened the span is the
 * evidence, and this is the one funnel every type reference passes through —
 * an argument list, a union member and a function type all reach their parts
 * through `parseTypeReference` or through the body it calls.
 *
 * Only names are flagged: an application (`Array<string>`) already recovers
 * as a complete `List<string>`, and its own arity question is answered where
 * it is written.
 */
export function markGuidedTypeNames(syntax: TypeSyntax, tokens: readonly Token[]): void {
  switch (syntax.kind) {
    case "NamedTypeSyntax": {
      const written = tokenIndex(tokens).get(syntax.span.start);
      if (written !== undefined && written.value !== syntax.name) markGuidedTypeName(syntax);
      return;
    }
    case "UnionTypeSyntax":
      for (const member of syntax.members) markGuidedTypeNames(member, tokens);
      return;
    case "GenericTypeSyntax":
      for (const argument of syntax.arguments) markGuidedTypeNames(argument, tokens);
      return;
    case "ReadonlyTypeSyntax":
    case "OptionalTypeSyntax":
      markGuidedTypeNames(syntax.inner, tokens);
      return;
    case "FunctionTypeSyntax":
      for (const parameter of syntax.parameters) markGuidedTypeNames(parameter.type, tokens);
      markGuidedTypeNames(syntax.result, tokens);
      return;
    case "EnumMemberTypeSyntax":
      return;
  }
}

/**
 * RE-C2 / RE-I6: why a word cannot name a type parameter, when it cannot.
 *
 * A type parameter is a name only an annotation can reach, which is exactly
 * charter §5's criterion for a spelling a declaring position must refuse.
 * `def identity<str>` used to declare a parameter every annotation then rewrote
 * to `string`, `type Box<readonly>:` one every annotation answered with
 * "Expected a type name", and `<null>` answered with two parse errors that
 * never named the rule — the "declaration writable, every use refused" shape
 * the refusal exists to prevent. The Core type names and the three bounds are
 * the analyzer's half of this position; this is the same sentence over the two
 * rosters the parser owns, under the same code.
 */
export function refusedTypeParameterName(token: Token): string | null {
  // RE-I5: `any` names no type in any position, so it names no type parameter
  // either; the built-in roster it used to be refused by no longer holds it.
  if (token.kind === "identifier" && token.value === "any") return refusedAnyDeclarationMessage("type parameter");
  const refused = refusedDeclarationName(token);
  if (!refused) return null;
  return `'${token.value}' ${refused.because}, so it cannot name a type parameter`
    + `; every use of it would read as ${refused.instead}`;
}
