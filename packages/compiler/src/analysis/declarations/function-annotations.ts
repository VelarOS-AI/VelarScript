/** A retired bare Function annotation has no contract to check its value against. */
import { type TypeReference } from "../../ast.ts";
import { mechanicalFix, recoveredDiagnostic, type Diagnostic } from "../../diagnostic.ts";
import { retiredFunctionShorthandMessage } from "../../language-guidance.ts";
import { describeType, type ValueType } from "../../types.ts";

/** Supply the inferred callable when an initializer exists; otherwise teach the shape. */
export function retiredFunctionAnnotationDiagnostic(annotation: TypeReference, actual: ValueType): Diagnostic {
  const spelling = actual.kind === "function" || actual.kind === "action" ? describeType(actual) : null;
  return recoveredDiagnostic("VEL2012", retiredFunctionShorthandMessage("Function", spelling), annotation.span,
    spelling === null ? undefined : mechanicalFix(annotation.span, spelling, `Use '${spelling}'`));
}
