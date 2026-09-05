/**
 * The vocabulary every cluster needs when it meets a function declaration: the
 * shape a declaration has to have to be analyzable, the frame a body's returns
 * are collected into, and the placeholder that stands for a result still being
 * inferred.
 *
 * D114 R1d: these were top-level declarations of `analyzer.ts`, read by the
 * class cluster (a method is a function declaration), by the module cluster (an
 * exported `def` is one) and by the analyzer's own dispatch. They move here so
 * none of those has to import the facade it is part of.
 * `inferredResultPlaceholderType` is a published name of
 * `@velarscript/compiler`, so `analyzer.ts` re-exports it.
 */
import { type FunctionDeclaration, type TypeParameterDeclaration } from "../ast.ts";
import { type Span } from "../source.ts";
import { sameType, type ValueType } from "../types.ts";

export interface ReturnContext {
  readonly expected: ValueType;
  readonly inferredReturns: ValueType[] | null;
  /**
   * D58 correction 2: the results a body returns while an annotation is
   * written, collected only where that annotation is the `-> null` rule 139
   * refuses. `inferredReturns` is null in that case — the declared result is
   * the contract — so the deletion's precondition needs its own observation.
   */
  readonly observedReturns: ValueType[] | null;
  readonly declarationKind: string;
  /**
   * D85 rule 209: a `return []` that VEL4039 already reported contributes
   * `invalidType` so no caller reports the same hole again. That makes the
   * collected result invalid, which is otherwise a convergence failure — but
   * here the author has already been told exactly what to write, so VEL4025
   * would be the second report of one mistake.
   */
  unsettledResult?: boolean;
  /**
   * D85 rule 209: the result keys of the local functions this body returns the
   * result of. A callee's hole can be reported after its caller is analyzed,
   * so a call contributes a cause here and the whole module decides.
   */
  resultHoleCauses?: Set<string>;
}

export interface AnalyzableFunctionDeclaration {
  readonly kind: string;
  readonly name: string;
  readonly typeParameters?: readonly TypeParameterDeclaration[];
  readonly parameters: FunctionDeclaration["parameters"];
  readonly returnType: FunctionDeclaration["returnType"];
  readonly resultAnnotationSpan?: FunctionDeclaration["resultAnnotationSpan"];
  readonly signatureSpan: FunctionDeclaration["signatureSpan"];
  readonly body: FunctionDeclaration["body"];
  readonly span: Span;
  readonly asynchronous?: boolean;
  // Optional because only a module-level declaration can carry it. A method
  // never does — which is why D90 R12 goes through `recordExportedAny` rather
  // than reading this flag: a public member of a class this module publishes
  // leaves the module just as an exported `def` does, with no keyword of its
  // own.
  readonly exported?: boolean;
  // Class members only. A `private` member is module-internal, and R12 leaves
  // module-internal `any` legal.
  readonly private?: boolean;
}

// A distinct unknown-like value lets recursive result inference remain
// fail-closed without confusing an unresolved call with an explicitly unknown
// result. It may cross an in-memory module interface during project SCC passes.
export const inferredResultPlaceholderType: ValueType = Object.freeze({ kind: "unknown", restricted: true });

export function containsInferredResultPlaceholder(type: ValueType): boolean {
  if (type === inferredResultPlaceholderType) return true;
  switch (type.kind) {
    case "optional": return containsInferredResultPlaceholder(type.inner);
    case "list":
    case "set": return containsInferredResultPlaceholder(type.element);
    case "map": return containsInferredResultPlaceholder(type.key) || containsInferredResultPlaceholder(type.value);
    case "record":
    case "promise":
    case "runtimeType": return containsInferredResultPlaceholder(type.value);
    case "object": return [...type.fields.values()].some(containsInferredResultPlaceholder);
    case "function":
    case "action":
    case "intrinsic":
      return type.parameters.some(containsInferredResultPlaceholder)
        || Boolean(type.rest && containsInferredResultPlaceholder(type.rest))
        || containsInferredResultPlaceholder(type.result);
    case "union": return type.members.some(containsInferredResultPlaceholder);
    default: return false;
  }
}

export function sameInferredResult(left: ValueType, right: ValueType): boolean {
  if (containsInferredResultPlaceholder(left) !== containsInferredResultPlaceholder(right)) return false;
  return sameType(left, right);
}

/**
 * D64 rule 163: the scope in this sentence is load-bearing, and it is also why
 * the sentence is written once instead of in each of the four declaration
 * positions that report it. A *declaration* carries `async`, so its result
 * annotation names the resolved value; a function *type* carries no `async`
 * and describes the value the call hands back, which is a Promise. Stated
 * without "in a declaration" this reads as a rule about the whole language,
 * and an author who obeys it in a function type is refused by VEL4001 for
 * doing what it said — `asyncResultSpellingGuidance` is the other half.
 */
export const asyncResultAnnotationMessage =
  "An async result annotation in a declaration names the resolved value; write '-> T', not '-> Promise<T>'";

// The structural contract of an extern class declaration, canonicalized so
// that declarations of the same JavaScript class from different modules can
// be compared for agreement. Parameter names are intentionally excluded:
// extern constructors take positional arguments only.
/**
 * A class declared in an `extern module` block carries the `js:` identity
 * scheme; a VelarScript class carries `velar:`. The prefix is the only thing
 * that separates "this name is not a class" from "this class lives on the
 * other side of the bridge" (CLS-I4).
 */
export function isExternClassIdentity(identity: string | null): boolean {
  return identity !== null && identity.startsWith("js:");
}
