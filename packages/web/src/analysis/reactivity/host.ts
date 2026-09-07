/**
 * What the reactive-name rules ask of the analyzer that hosts them: the span
 * tables that say which declaration a name resolves to, and the analyzer
 * operations those rules perform.
 *
 * D115 P4 R3c. The tables are `private` on the analyzer, so the object
 * satisfying this interface is built inside that class and nowhere else
 * (TS2341, D114 line 512). The retired-accessor migration declares its own
 * `RetiredAccessorHost` beside its rules, because the tables it reads are the
 * ones it fills itself and it shares none of these.
 */
import { type Diagnostic, type Span } from "@velarscript/compiler";
import { type Expression, type ValueType } from "@velarscript/compiler/extension";

export interface ReactiveNamesHost {
  /**
   * D71 rule 182: the declaration spans of every `computed` binding in scope.
   * A binding's span survives narrowing, so it identifies the declaration a
   * name resolves to even where a narrowed copy answers the lookup.
   */
  readonly computedBindingSpans: ReadonlySet<string>;
  /** Every name in this module whose read is reactive without the binding being a state/prop reference. */
  readonly derivedReactiveNames: ReadonlySet<string>;
  /** D74: only props whose authors wrote a readonly contract receive prop-specific guidance. Replaced per component. */
  readonly explicitReadonlyPropBindings: ReadonlyMap<string, number>;
  /** The resolved spans of imported `export computed` bindings, so a local shadow of the name is not one. */
  readonly importedComputedSpans: ReadonlySet<string>;
  /** D114 W: the declaration spans of every `resource` in scope, kept the way `computedBindingSpans` is. */
  readonly resourceBindingSpans: ReadonlySet<string>;

  readonly diagnostics: Diagnostic[];
  expandAliases(type: ValueType): ValueType;
  inferExpression(expression: Expression, contextualType?: ValueType): ValueType;
  lookup(name: string): { readonly span: Span; readonly type: ValueType } | null;
  reactiveBindingKind(name: string): "state" | "prop" | null;
}
