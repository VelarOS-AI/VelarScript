/**
 * What 'velar/forms' calls answer: a form read is typed by the record it fills,
 * and the fields of that record become the descriptors the emitter reads.
 *
 * D115 P4 R3a: one family of 'inferWebIntrinsic', in the module that family
 * names.
 */
import { type CompilerIntrinsicAnalysisContext, type FormReadField, type ValueType } from "@velarscript/compiler/extension";

export function inferFormsIntrinsic(context: CompilerIntrinsicAnalysisContext): ValueType | undefined {
  const { intrinsic, argumentAt, callSpan, arity, inferAt, runtimeTypeAt } = context;
  switch (intrinsic.name) {
    case "forms.read": {
      arity(2, 2);
      inferAt(0, { kind: "named", name: "Element" });
      const parsed = runtimeTypeAt(1);
      if (parsed.kind === "any" || parsed.kind === "unknown") return parsed;
      const expanded = context.expandAliases(parsed);
      const fields = expanded.kind === "named" ? context.declaredFieldsOf(expanded.identity ?? expanded.name) : null;
      if (!fields) {
        context.typeError("Form reading requires a record declared with 'type Name:'", argumentAt(1)?.span ?? callSpan);
        return parsed;
      }
      const descriptors: FormReadField[] = [];
      for (const [name, field] of fields) {
        const descriptor = context.formReadField(name, field, argumentAt(1)?.span ?? callSpan);
        if (descriptor) descriptors.push(descriptor);
      }
      if (descriptors.length === fields.size) context.recordFormRead(callSpan, descriptors);
      return parsed;
    }
    default:
      return undefined;
  }
}
