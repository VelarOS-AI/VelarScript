/**
 * What the Look rules and the keyframes analysis ask of the analyzer that
 * hosts them: the module-wide Look tables its walk fills, and the analyzer
 * operations those rules perform.
 *
 * D115 P4 R3b. The tables are `private` on the analyzer, so the object
 * satisfying this interface is built inside that class and nowhere else
 * (TS2341, D114 line 512). The four the walk replaces once per program arrive
 * through getters, so a collaborator reading one mid-walk reads the live table
 * rather than the one that existed when the host was made.
 */
import { type Diagnostic, type DiagnosticFix, type Span } from "@velarscript/compiler";
import { type Expression, type ValueType } from "@velarscript/compiler/extension";
import { type LookStaticScope } from "../../look-static.ts";
import { type LookImportSite } from "../look-sites.ts";

export interface LookAnalysisHost {
  /** Every builder call whose arguments have been checked, so one call is checked once however often the walk reaches it. */
  readonly checkedBuilderCalls: Set<string>;
  /** Local name → the velar/look builder it names. Replaced per program. */
  readonly lookBuilderNames: ReadonlyMap<string, string>;
  /** Scope key → the property names already written in that scope, which is how a repeat is recognised. */
  readonly lookEntryScopes: Map<string, Set<string>>;
  /** Where this module imports velar/look, so an import edit knows what to extend. Replaced per program. */
  readonly lookImport: LookImportSite | null;
  /** The module's compile-time Look values and the sites that wrote them. Replaced per program. */
  readonly lookStatic: LookStaticScope;
  /** The spans of builder calls whose own arguments were refused, so a `keyframes:` stop drops the consequence. */
  readonly refusedBuilderCalls: Span[];

  readonly diagnostics: Diagnostic[];
  readonly extensionLiterals: Map<string, string>;
  advise(code: string, message: string, adviceSpan: Span, fix?: DiagnosticFix): void;
  /**
   * A name that both belongs to a derived reactive declaration and still
   * resolves to one here. The reading belongs to the analyzer's reactive-name
   * group; the two snapshot rules ask it about a name they found in a Look.
   */
  derivedReactiveRead(name: string): boolean;
  expandAliases(type: ValueType): ValueType;
  inferExpression(expression: Expression, contextualType?: ValueType): ValueType;
  lookup(name: string): { readonly type: ValueType } | null;
  reactiveBindingKind(name: string): "state" | "prop" | null;
  requireAssignable(actual: ValueType, expected: ValueType, valueSpan: Span): void;
  requireCondition(type: ValueType, condition: Expression): void;
}
