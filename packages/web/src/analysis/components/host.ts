/**
 * What the component rules ask of the analyzer that hosts them: the six depths
 * that say where in a component body the walk stands, the set of states the
 * body declares, and the base-analyzer operations a body's sections perform.
 *
 * D115 P4 R3c. `ComponentAnalysisHost` is an intersection rather than an
 * `extends` chain because a component body *runs* the declaration analyzers and
 * the watch refusals: it needs everything those two groups need, and the two
 * declare some of the same tables at different widths — `computedBindingSpans`
 * is written by a `computed` declaration and only read by the name rules. An
 * intersection lets each face keep saying exactly what its own group does with
 * a table.
 *
 * Every depth is an accessor pair, so the moved bodies keep their original
 * `host.flowFrameDepth += 1` / `-= 1` text and the analyzer's own field is what
 * moves.
 */
import { type Diagnostic, type Span } from "@velarscript/compiler";
import { type Expression, type Statement, type TypeReference, type ValueType } from "@velarscript/compiler/extension";
import { type DeclarationAnalysisHost } from "../declarations.ts";
import { type WatchCycleHost } from "../watch-cycles.ts";

export interface ComponentBodyHost {
  /** D51 (audit 12): how many `@cleanup` hooks enclose the walk — an ordinary scope with an exit. */
  cleanupDepth: number;
  /** VEL5075: how many component bodies enclose the declaration being analyzed. */
  componentBodyDepth: number;
  /** The `state` names this component body declares, or null outside every component. */
  componentStates: Set<string> | null;
  /** The base analyzer's constructor depth, saved and restored around a component body. */
  constructorDepth: number;
  /** D74: the props of this component whose authors wrote a readonly contract. Replaced per component. */
  explicitReadonlyPropBindings: ReadonlyMap<string, number>;
  flowFrameDepth: number;
  /** How deep the walk stands inside JSX; an `await` there has no synchronous position to run in. */
  jsxDepth: number;
  mountedDepth: number;
  /** D51 (audit 12): a component `watch` body runs on a change and ends, exactly as a module `watch` body does. */
  watchBodyDepth: number;

  readonly diagnostics: Diagnostic[];
  analyzeBlock(statements: readonly Statement[]): void;
  analyzeStatement(statement: Statement): void;
  analyzeStatements(statements: readonly Statement[]): void;
  enterScope(): void;
  exitScope(): void;
  expandAliases(type: ValueType): ValueType;
  fieldsOf(identity: string): ReadonlyMap<string, ValueType> | null;
  inComponentSetupPosition(): boolean;
  inferExpression(expression: Expression, contextualType?: ValueType): ValueType;
  inferParameterDefault(expression: Expression, contextualType: ValueType): ValueType;
  isPredeclared(statement: object): boolean;
  prescanScopeDeclarations(statements: readonly Statement[]): void;
  resolveAnnotation(reference: TypeReference | null): ValueType;
  typeError(message: string, errorSpan: Span): void;
}

/**
 * The one face the `analysis/components/` collaborators read: what a component
 * body itself needs, plus the declaration analyzers its sections run and the
 * watch refusals its `watch` section asks.
 */
export type ComponentAnalysisHost = ComponentBodyHost & DeclarationAnalysisHost & WatchCycleHost;
