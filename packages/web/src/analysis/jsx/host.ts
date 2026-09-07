/**
 * What the JSX rules ask of the analyzer that hosts them: the JSX walk's own
 * state, and the analyzer operations a JSX rule performs.
 *
 * D115 P4 R3b. It extends `LookAnalysisHost` because the visual attributes are
 * Look values in a JSX position — `look:` and `style:` route to the Look entry
 * walk and its number-without-unit rule, and `look=` collisions read the
 * module's Look declarations — so one object serves both families and the JSX
 * side is the wider face of it.
 */
import { type Span } from "@velarscript/compiler";
import { type Expression, type ValueType } from "@velarscript/compiler/extension";
import { type WebJsxAttribute as JSXAttribute, type WebJsxElementExpression as JSXElementExpression, type WebLookExpression } from "../../ast.ts";
import { type LookAnalysisHost } from "../look/host.ts";

export interface JsxAnalysisHost extends LookAnalysisHost {
  /** How deep the walk stands inside JSX. `inferJsx` moves it; the ownership and reactivity rules read it. */
  jsxDepth: number;
  /** The elements whose `key` the keyed fast path will actually read. */
  readonly honoredJsxKeys: Set<JSXElementExpression>;
  /** D89 A4: the declaration spans of the lists a keyed position renders by identity. */
  readonly keyedListSources: Set<string>;
  /** The module's `look` declarations, which is what a side-by-side collision is judged against. Replaced per program. */
  readonly lookDeclarations: ReadonlyMap<string, WebLookExpression | null>;
  /** Elements already answered for an ineffective key, so the whole-program pass does not repeat one. */
  readonly reportedJsxKeys: Set<JSXElementExpression>;
  /** Every `key` written on a statically placed element, judged once the walk has ended. */
  readonly staticJsxKeys: { readonly element: JSXElementExpression; readonly attribute: JSXAttribute }[];
  /** The module's source, which is what a mechanical rewrite copies its replacement text out of. */
  readonly webSourceText: string;

  readonly enumValueBindings: Map<number, string>;
  readonly extensionCalls: Map<string, string>;
  readonly semanticJsxAttributeOwners: Map<string, ValueType>;
  checkWebRouteComponent(type: ValueType, sourceSpan: Span, subject: string): void;
  checkWebRouteRecords(expression: Expression): void;
  fieldsOf(identity: string): ReadonlyMap<string, ValueType> | null;
  inferredExpressionType(expression: Expression): ValueType;
  /**
   * Assignability judged against the analyzer as the type environment, which is
   * the whole of what a component ref and an event parameter ask of it. Asking
   * for the answer rather than for the environment keeps `TypeEnvironment` out
   * of this face.
   */
  isAssignableHere(actual: ValueType, expected: ValueType): boolean;
  isClassInput(type: ValueType): boolean;
  isJsxAttributeValue(type: ValueType): boolean;
  isJsxRenderable(type: ValueType): boolean;
  isLookInput(type: ValueType): boolean;
  isOptionalString(type: ValueType): boolean;
  isScalarTextType(type: ValueType): boolean;
  lookup(name: string): { readonly declaredType: ValueType; readonly mutable: boolean; readonly span: Span; readonly type: ValueType } | null;
  writableStateName(name: string): boolean;
}
