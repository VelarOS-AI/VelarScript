/**
 * The retired 'computed(...)' accessor: the intrinsic a call around it is still
 * typed by, and the shape of one declaration held for the migration message.
 *
 * D115 P4 R3a: a frozen table and a record shape, read by the analyzer and by
 * the intrinsic that types the call, so they read as a module.
 */
import { type Span } from "@velarscript/compiler";
import { unknownType, type ValueType } from "@velarscript/compiler/extension";

/**
 * `computed(...)` the function is answered with the signature it always had, so
 * a call written around it still type-checks instead of collapsing into an
 * unknown one — that is what keeps the one message about the declaration form
 * the only thing the author reads. `reactive.computed` itself is gone; this one
 * derives no reactivity and is never emitted, because every site that produces
 * it also produces an error. It stays an intrinsic only so the reader it
 * returns carries the callback's own result: an annotated declaration —
 * `const one: () -> number = computed(() => 1)` — would otherwise read a
 * second, spurious assignability error on top of it.
 */
export const RETIRED_ACCESSOR_INTRINSIC = "reactive.retired-accessor";
const retiredAccessorReaderType: ValueType = Object.freeze({ kind: "function", parameters: [], requiredParameters: 0, result: unknownType });
export const RETIRED_ACCESSOR_TYPE: ValueType = Object.freeze({
  kind: "intrinsic",
  name: RETIRED_ACCESSOR_INTRINSIC,
  parameterNames: ["read"],
  parameters: [retiredAccessorReaderType],
  requiredParameters: 1,
  result: retiredAccessorReaderType,
});

export interface RetiredAccessorDeclaration {
  readonly name: string;
  readonly exported: boolean;
  /** The named function the argument reads through, when it is one — `computed(readA)`. */
  readonly readName: string | null;
  readonly declarationSpan: Span;
  readonly callSpan: Span;
  /** The `() => E` body span, or null when the argument is not that shape. */
  readonly bodySpan: Span | null;
}
