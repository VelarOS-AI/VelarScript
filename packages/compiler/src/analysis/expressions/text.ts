/**
 * What may be converted to text, and the one check that enforces it. `str(x)`
 * and an f-string hole share this contract: a value has a hook-free text form,
 * or it is refused where it is written.
 *
 * D115 §三: this was two private methods of `Analyzer`, called from the
 * f-string arm of the expression dispatcher and from `str` in the call cluster.
 * The whitelist itself is `isTextConvertibleType` in `../../types.ts`, asked
 * through the host the way assignability is: the answer crosses, not the type
 * environment it was judged against.
 */
import { type Diagnostic, diagnostic } from "../../diagnostic.ts";
import { type Span, span } from "../../source.ts";
import { type ValueType, describeType, isInvalidType } from "../../types.ts";

/** What the text conversion asks of the analyzer that hosts it, and nothing more. */
export interface TextConversionHost {
  readonly diagnostics: Diagnostic[];
  expandAliases(type: ValueType, seen?: ReadonlySet<string>): ValueType;
  extensionTextForm(type: ValueType): boolean | undefined;
  isTextConvertibleHere(type: ValueType): boolean;
}

export class TextConversion {
  private readonly host: TextConversionHost;

  constructor(host: TextConversionHost) {
    this.host = host;
  }

  // D32 item 29: the language-wide text-conversion contract (charter
  // section 14) shared by f-strings, str(), and target-owned render sites.
  // Text conversion accepts only values whose text form is total and
  // hook-free — string, number, bool, enums, and null, plus optionals and
  // unions of those. Everything else (records, collections, functions, class
  // instances, unknown, any) is rejected at compile time so a data value
  // never reaches JavaScript string coercion, which would execute 'toString'
  // conversion hooks.
  requireTextConvertible(type: ValueType, span: Span, site: "f-string" | "str"): void {
    if (isInvalidType(type) || this.isTextConvertible(type)) return;
    const lead = site === "f-string" ? "An f-string renders" : "str() converts";
    const exit = this.host.extensionTextForm(this.host.expandAliases(type)) === false
      ? "print(value) to inspect it"
      : "print(value) to inspect it, or Json.stringify(value) for data text";
    this.host.diagnostics.push(diagnostic(
      "VEL4026",
      `${lead} strings, numbers, bools, enums, null, and extension values with a declared text form; format ${describeType(type)} explicitly — ${exit}`,
      span,
    ));
  }

  isTextConvertible(type: ValueType): boolean {
    return this.host.isTextConvertibleHere(type);
  }
}
