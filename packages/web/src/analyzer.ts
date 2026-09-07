import { type Diagnostic, type Span } from "@velarscript/compiler";
import {
  Analyzer,
  isAssignable,
  unknownType,
  type AnalysisContext,
  type CompilerAnalysisExtension,
  type Expression,
  type Program,
  type Statement,
  type TypeReference,
  type ValueType,
} from "@velarscript/compiler/extension";
import { isLookStaticValue, type LookStaticScope, type LookStaticValue } from "./look-static.ts";
import { declaredPublicConfig } from "./analysis/public-config.ts";
import {
  isWebJsx,
  isWebKeyframes,
  isWebLook,
  isWebStatement,
  type WebJsxAttribute as JSXAttribute,
  type WebJsxElementExpression as JSXElementExpression,
  type WebLookExpression,
} from "./ast.ts";
import { isWebComputedExport } from "./types.ts";
import { inferWebIntrinsic } from "./analysis/calls/intrinsics.ts";
import { normalizeComponentContracts } from "./analysis/components/contracts.ts";
import { analyzeComponent } from "./analysis/components/declaration.ts";
import { type ComponentAnalysisHost } from "./analysis/components/host.ts";
import { extensionOwnsFunctionlessReturn, invalidExtensionAwaitContext, invalidExtensionAwaitMessage } from "./analysis/components/lifecycle.ts";
import { ownershipScopeRejection, rejectStatefulWebNodeFunction, rejectUnownedComponentElement } from "./analysis/components/ownership.ts";
import {
  analyzeActionDeclaration,
  analyzeComputedDeclaration,
  analyzeResourceDeclaration,
  analyzeStateDeclaration,
  analyzeUnsafeCssDeclaration,
  componentType,
  markWebBindingReactive,
  webScopeDeclaration,
} from "./analysis/declarations.ts";
import {
  answeredBeforeInference,
  foldedWebLength,
  inferWebExtensionCall,
  reportInferredWebCall,
  validateWebExtensionTypeSyntax,
  webExpressionShapeRefusals,
  webExtensionValueType,
  type InferenceHost,
} from "./analysis/inference.ts";
import { inferJsx } from "./analysis/jsx/elements.ts";
import { type JsxAnalysisHost } from "./analysis/jsx/host.ts";
import { recordKeyedListRebuild, type FunctionDeclarationStatement, type KeyedListRebuild } from "./analysis/keyed-rebuild.ts";
import { analyzeKeyframes } from "./analysis/keyframes-analysis.ts";
import { type LookImportSite } from "./analysis/look-sites.ts";
import { analyzeLookEntries } from "./analysis/look/entries.ts";
import { analyzeWebProgram, type ProgramPassHost } from "./analysis/program-passes.ts";
import { directReadonlyPropMutation, restateReadonlyPropMutation, writableStateName } from "./analysis/reactivity/bindings.ts";
import { derivedReactiveRead, rejectComputedAssignment } from "./analysis/reactivity/derived.ts";
import { recordRetiredAccessorDeclaration, type RetiredAccessorDeclaration } from "./analysis/reactivity/retired-accessors.ts";
import { isClassInput, isJsxAttributeValue, isJsxRenderable, isLookInput, isOptionalString, isScalarTextType, type RenderableHost } from "./analysis/renderable.ts";
import { checkWebRouteComponent, checkWebRouteRecords, type WebRouteHost } from "./analysis/routes.ts";
import { rejectFrozenWatchSubject, rejectWatchCycle, type ReactiveWriterDeclaration } from "./analysis/watch-cycles.ts";
import { diagnostic, routeContextIdentity, webTypeFields } from "./analysis/web-types.ts";

// D115 P4 R3a: the 1,660 lines that stood outside this class — the Look
// vocabulary and its conditions, the URL-scheme rule, the route and JSX
// readings, the watch-subject reconstruction, the keyed-rebuild advisory's
// evidence, the Web type tables and 'inferWebIntrinsic' — moved to
// './analysis/'. The two names this module published besides the analyzer are
// re-exported here, so an existing 'from "./analyzer.ts"' import of either
// keeps working unchanged.
export { inferWebIntrinsic, routeContextIdentity };

/**
 * The one object every `analysis/` collaborator reads this analyzer through.
 *
 * D115 P4 R3c: an intersection of the faces each group declares rather than one
 * interface, because two groups legitimately say different things about the
 * same table — a `computed` declaration writes `computedBindingSpans` and the
 * name rules only read it; the program pass replaces `moduleFunctions` and the
 * rebuild advisory only reads it. An intersection lets every face keep
 * declaring exactly what its own group does with a table, where an `extends`
 * chain would force one width on all of them.
 *
 * The hierarchy inside it: `JsxAnalysisHost extends LookAnalysisHost`;
 * `WatchCycleHost extends ReactiveNamesHost`; `DeclarationAnalysisHost extends
 * KeyedRebuildHost`; `ComponentAnalysisHost = ComponentBodyHost &
 * DeclarationAnalysisHost & WatchCycleHost`; `InferenceHost =
 * ExpressionInferenceHost & LookAnalysisHost & ReactiveNamesHost &
 * RetiredAccessorHost`; `ProgramPassHost = ProgramTableHost & KeyedRebuildHost &
 * RetiredAccessorHost`; `RenderableHost` and `WebRouteHost` stand alone.
 */
type WebAnalysisHost = ComponentAnalysisHost & InferenceHost & JsxAnalysisHost
  & ProgramPassHost & RenderableHost & WebRouteHost;

/** The operations half of {@link WebAnalysisHost}: every member of it that is a function. */
type AnalyzerOperations = Pick<WebAnalysisHost, {
  readonly [Name in keyof WebAnalysisHost]-?: WebAnalysisHost[Name] extends (...parameters: never[]) => unknown ? Name : never;
}[keyof WebAnalysisHost]>;

export class VelarWebAnalyzer extends Analyzer {
  private componentStates: Set<string> | null = null;
  private mountedDepth = 0;
  private cleanupDepth = 0;
  /** D51 (audit 12): a component `watch` body runs on a change and ends, exactly as a module `watch` body does. */
  private watchBodyDepth = 0;
  /** D89 A4: the binding identity of every list a keyed `.map(...)` interpolation renders. */
  private readonly keyedListSources = new Set<string>();
  /** D89 A4: every row rebuild of this module — assigned or derived — in source order. */
  private readonly keyedListRebuilds: KeyedListRebuild[] = [];
  /** D89 A4: this module's `def` bodies by name, so a `computed` that calls one can be read through. */
  private moduleFunctions: ReadonlyMap<string, FunctionDeclarationStatement | null> = new Map();
  private synchronousReactiveDepth = 0;
  private jsxDepth = 0;
  /** VEL5075: how many component bodies enclose the declaration being analyzed. */
  private componentBodyDepth = 0;
  private readonly resources: ReadonlyMap<string, string>;
  private readonly unsafeCssImports = new Set<string>();
  private readonly probedOperandTypes = new Map<string, ValueType>();
  private readonly importedLookStaticValues: ReadonlyMap<string, LookStaticValue>;
  private lookStatic: LookStaticScope = { values: new Map(), sites: new Map() };
  private readonly lookEntryScopes = new Map<string, Set<string>>();
  private readonly derivedReactiveNames = new Set<string>();
  private readonly checkedBuilderCalls = new Set<string>();
  private readonly staticJsxKeys: { readonly element: JSXElementExpression; readonly attribute: JSXAttribute }[] = [];
  private readonly honoredJsxKeys = new Set<JSXElementExpression>();
  private readonly reportedJsxKeys = new Set<JSXElementExpression>();
  private lookBuilderNames: ReadonlyMap<string, string> = new Map();
  /**
   * D103: the module's `velar/look` import, so the migration off
   * `color("var(--x)")` can write the `token` import it needs in the same
   * rewrite. A migration that only changed the call would leave the module
   * naming a builder it never imported, which is not a mechanical fix.
   */
  private lookImport: LookImportSite | null = null;
  private lookDeclarations: ReadonlyMap<string, WebLookExpression | null> = new Map();
  private lookLiteralDepth = 0;
  /**
   * D71 rule 182: the declaration spans of every `computed` binding in scope.
   * A binding's span survives narrowing, so it identifies the declaration a
   * name resolves to even where a narrowed copy answers the lookup.
   */
  private readonly computedBindingSpans = new Set<string>();
  /**
   * D114 W: the declaration spans of every `resource` in scope, kept the way
   * `computedBindingSpans` keeps derived values — the question is asked of the
   * binding a name resolves to, so a local shadow of a resource's name is not
   * one.
   */
  private readonly resourceBindingSpans = new Set<string>();
  /** D114 W A2(b): this module's `action` and `async def` bodies by name. */
  private reactiveWriters: ReadonlyMap<string, ReactiveWriterDeclaration | null> = new Map();
  /** D114 P6 item 6 (ST-U2): each same-module `computed` and the names it reads on every evaluation. */
  private reactiveDerivations: ReadonlyMap<string, ReadonlySet<string> | null> = new Map();
  /** Each `state` this module declares, false where the name is declared twice. */
  private reactiveStateNames: ReadonlyMap<string, boolean> = new Map();
  /** Local names bound to an imported `export computed`, from the Web interface. */
  private readonly importedComputedNames: ReadonlySet<string>;
  /** The resolved spans of those imports, so a local shadow of the name is not one. */
  private readonly importedComputedSpans = new Set<string>();
  /** D71 migration state: `const x = computed(...)` sites, their reads, and every other reference to the name. */
  private readonly retiredAccessorDeclarations = new Map<string, RetiredAccessorDeclaration>();
  private readonly retiredAccessorReads = new Map<string, Span[]>();
  private readonly retiredComputedReferences = new Map<string, { readonly name: string; readonly span: Span }>();
  private readonly migratedComputedCallees = new Set<string>();
  /** Callee span identity -> call span, for every zero-argument call of a plain name. */
  private readonly plainCallSpans = new Map<string, Span>();
  /** D57 rule 138: `velar/web-test` is legal only where the browser runner looks. */
  private readonly webModulePath: string | null;
  /** The source coordinates used by mechanical JSX attribute rewrites. */
  private readonly webSourceText: string;
  /** D74: only props whose authors wrote a readonly contract receive prop-specific guidance. */
  private explicitReadonlyPropBindings: ReadonlyMap<string, number> = new Map();
  /** D114 0.29.0 LC-D1: the manifest's `web.publicConfig`, or null when this compile read no project manifest — an empty section is a claim the compile may check, and no manifest is no claim at all. */
  private readonly webPublicConfig: Readonly<Record<string, unknown>> | null;
  private publicConfigNames: ReadonlySet<string> = new Set();
  /** velar/look builder calls this compile refused on their own arguments (D114 0.29.0 LK-I2). */
  private readonly refusedBuilderCalls: Span[] = [];

  /** The one object every `analysis/` collaborator reads this analyzer through. */
  private readonly host: WebAnalysisHost;

  constructor(context: AnalysisContext = {}, extensions: readonly CompilerAnalysisExtension[] = []) {
    super(context, extensions);
    this.webModulePath = context.path ?? null;
    this.webSourceText = context.sourceText ?? "";
    this.resources = context.resources ?? new Map();
    this.webPublicConfig = declaredPublicConfig(context.extensionProjectConfig?.get("@velarscript/web"));
    const webImports = [...(context.extensionImports?.get("@velarscript/web") ?? [])];
    this.importedLookStaticValues = new Map(
      webImports.filter((entry): entry is [string, LookStaticValue] => isLookStaticValue(entry[1])),
    );
    this.importedComputedNames = new Set(
      webImports.filter(([, value]) => isWebComputedExport(value)).map(([name]) => name),
    );
    this.host = this.analysisHost();
  }

  override analyze(program: Program): readonly Diagnostic[] {
    return analyzeWebProgram(this.host, program, (body) => { super.analyze(body); });
  }

  protected override predeclareExtensionStatement(statement: Statement): boolean {
    if (!isWebStatement(statement)) return false;
    if (statement.kind === "ExtensionStatement:web:unsafe-css") return true;
    if (statement.kind !== "ExtensionStatement:web:component") return false;
    this.declareBinding(statement.name, false, componentType(this.host, statement), statement.span);
    return true;
  }

  protected override analyzeExtensionStatement(statement: Statement): boolean {
    // Two core statement shapes are answered here before the core sees them:
    // a write to a derived name, which the const message would describe wrongly,
    // and a `const x = computed(...)` declaration, whose migration needs the
    // declaration recorded before its reads are walked.
    if (statement.kind === "AssignmentStatement" && rejectComputedAssignment(this.host, statement)) return true;
    if (statement.kind === "VariableDeclaration") {
      recordRetiredAccessorDeclaration(this.host, statement);
    }
    if (statement.kind === "FunctionDeclaration") {
      rejectStatefulWebNodeFunction(this.host, statement);
      rejectUnownedComponentElement(this.host, statement);
    }
    if (!isWebStatement(statement)) return false;
    switch (statement.kind) {
      case "ExtensionStatement:web:component":
        // A component body renders after module evaluation, so its reads are
        // deferred for the module-initialization-cycle classification even
        // though component analysis itself runs without a function frame.
        this.deferredExecutionDepth += 1;
        try {
          analyzeComponent(this.host, statement);
        } finally {
          this.deferredExecutionDepth -= 1;
        }
        return true;
      case "ExtensionStatement:web:state":
        analyzeStateDeclaration(this.host, statement);
        return true;
      case "ExtensionStatement:web:computed":
        analyzeComputedDeclaration(this.host, statement);
        return true;
      case "ExtensionStatement:web:resource":
        this.diagnostics.push(diagnostic("VEL3012", "'resource' is only valid at component scope; a module-scope async operation belongs in a module 'action'", statement.span));
        analyzeResourceDeclaration(this.host, statement);
        return true;
      case "ExtensionStatement:web:action":
        // A module-scope action behaves exactly like a component action —
        // reactive pending/error fields with rejection semantics preserved —
        // but its lifetime is the module, so it never registers disposal.
        if (!this.isTopLevelScope()) {
          this.diagnostics.push(diagnostic("VEL3013", "'action' is only valid at module or component scope", statement.span));
        }
        analyzeActionDeclaration(this.host, statement);
        return true;
      case "ExtensionStatement:web:watch":
        if (!this.isTopLevelScope()) {
          this.diagnostics.push(diagnostic("VEL3010", "'watch' is only valid at module or component scope", statement.span));
          return true;
        }
        this.flowFrameDepth += 1;
        this.synchronousReactiveDepth += 1;
        {
          // The watched expression evaluates while the module initializes;
          // the body only runs on a later change, so its reads are deferred
          // for the module-initialization-cycle classification.
          const watched = this.inferExpression(statement.expression);
          if (rejectFrozenWatchSubject(this.host, statement.expression, watched, statement.currentName, statement.previousName)) {
            rejectWatchCycle(this.host, statement.expression, watched, statement.body);
          }
          this.enterScope();
          if (statement.currentName) this.declareBinding(statement.currentName, false, watched, statement.span);
          if (statement.previousName) this.declareBinding(statement.previousName, false, watched, statement.span);
          this.deferredExecutionDepth += 1;
          try {
            this.analyzeStatements(statement.body);
          } finally {
            this.deferredExecutionDepth -= 1;
          }
          this.exitScope();
        }
        this.synchronousReactiveDepth -= 1;
        this.flowFrameDepth -= 1;
        return true;
      case "ExtensionStatement:web:unsafe-css":
        analyzeUnsafeCssDeclaration(this.host, statement);
        return true;
      default:
        return false;
    }
  }

  protected override analyzeStatement(statement: Statement): void {
    const readonlyProp = directReadonlyPropMutation(this.host, statement);
    recordKeyedListRebuild(this.host, statement);
    const firstDiagnostic = this.diagnostics.length;
    super.analyzeStatement(statement);
    restateReadonlyPropMutation(this.host, firstDiagnostic, readonlyProp);
  }

  protected override prescanExtensionScopeDeclaration(statement: Statement): { readonly name: string; readonly span: Span } | null {
    return webScopeDeclaration(statement);
  }

  protected override markDeclaredBindingReactive(name: string, kind: "state" | "prop" = "state"): void {
    markWebBindingReactive(this.host, name, kind, (bindingName, bindingKind) => {
      super.markDeclaredBindingReactive(bindingName, bindingKind);
    });
  }

  protected override inferExtensionExpression(expression: Expression, _contextualType: ValueType): ValueType | undefined {
    const refused = webExpressionShapeRefusals(this.host, expression);
    if (refused !== undefined) return refused;
    if (isWebJsx(expression)) return inferJsx(this.host, expression);
    if (isWebKeyframes(expression)) {
      analyzeKeyframes(this.host, expression);
      return { kind: "named", name: "Keyframes" };
    }
    if (isWebLook(expression)) {
      this.lookLiteralDepth += 1;
      try {
        analyzeLookEntries(this.host, expression.entries, false, false, 1, `look:${expression.span.start}`);
      } finally {
        this.lookLiteralDepth -= 1;
      }
      return { kind: "named", name: "Look" };
    }
    return webExtensionValueType(this.host, expression);
  }

  protected override inferExpression(expression: Expression, contextualType: ValueType = unknownType): ValueType {
    const answered = answeredBeforeInference(this.host, expression);
    if (answered !== null) return answered;
    const folded = foldedWebLength(this.host, expression);
    const result = super.inferExpression(expression, contextualType);
    reportInferredWebCall(this.host, expression, result);
    return folded ?? result;
  }

  protected override extensionFieldsOf(name: string): ReadonlyMap<string, ValueType> | null {
    return webTypeFields(name);
  }

  protected override inferExtensionCall(
    callee: import("@velarscript/compiler/extension").ExtensionValueType,
    arguments_: readonly Expression[],
    argumentNames: readonly (string | null)[] | undefined,
    callSpan: Span,
  ): ValueType | undefined {
    return inferWebExtensionCall(this.host, callee, arguments_, argumentNames, callSpan);
  }

  protected override validateExtensionTypeSyntax(
    syntax: import("@velarscript/compiler/extension").TypeSyntax,
    validate: (syntax: import("@velarscript/compiler/extension").TypeSyntax) => boolean,
    resolve: (reference: TypeReference) => ValueType,
  ): boolean | undefined {
    return validateWebExtensionTypeSyntax(this.host, syntax, validate, resolve);
  }

  protected override ownershipScopeRejection(): string | null {
    return ownershipScopeRejection(this.host) ?? super.ownershipScopeRejection();
  }

  protected override extensionOwnsFunctionlessReturn(): boolean {
    return extensionOwnsFunctionlessReturn(this.host);
  }

  protected override invalidExtensionAwaitContext(): boolean {
    return invalidExtensionAwaitContext(this.host);
  }

  protected override invalidExtensionAwaitMessage(): string | null {
    return invalidExtensionAwaitMessage(this.host);
  }

  protected override resolveAnnotation(reference: TypeReference | null): ValueType {
    return normalizeComponentContracts(super.resolveAnnotation(reference));
  }

  /**
   * The one host the `analysis/` collaborators read this analyzer through,
   * built here because a `private` member cannot be read outside the class it is
   * declared in (TS2341, D114 line 512). Every table the walk replaces once per
   * program and every depth a collaborator moves arrives as an accessor pair, so
   * a collaborator reads the live value and keeps its own `host.jsxDepth += 1`
   * text.
   */
  private analysisHost(): WebAnalysisHost {
    const analyzer = this;
    return {
      checkedBuilderCalls: this.checkedBuilderCalls,
      computedBindingSpans: this.computedBindingSpans,
      derivedReactiveNames: this.derivedReactiveNames,
      diagnostics: this.diagnostics,
      enumValueBindings: this.enumValueBindings,
      extensionCalls: this.extensionCalls,
      extensionLiterals: this.extensionLiterals,
      honoredJsxKeys: this.honoredJsxKeys,
      importedComputedNames: this.importedComputedNames,
      importedComputedSpans: this.importedComputedSpans,
      importedLookStaticValues: this.importedLookStaticValues,
      keyedListRebuilds: this.keyedListRebuilds,
      keyedListSources: this.keyedListSources,
      lookEntryScopes: this.lookEntryScopes,
      migratedComputedCallees: this.migratedComputedCallees,
      plainCallSpans: this.plainCallSpans,
      probedOperandTypes: this.probedOperandTypes,
      refusedBuilderCalls: this.refusedBuilderCalls,
      reportedJsxKeys: this.reportedJsxKeys,
      resourceBindingSpans: this.resourceBindingSpans,
      resources: this.resources,
      retiredAccessorDeclarations: this.retiredAccessorDeclarations,
      retiredAccessorReads: this.retiredAccessorReads,
      retiredComputedReferences: this.retiredComputedReferences,
      semanticJsxAttributeOwners: this.semanticJsxAttributeOwners,
      staticJsxKeys: this.staticJsxKeys,
      unsafeCssImports: this.unsafeCssImports,
      webModulePath: this.webModulePath,
      webPublicConfig: this.webPublicConfig,
      webSourceText: this.webSourceText,
      get cleanupDepth() { return analyzer.cleanupDepth; },
      set cleanupDepth(depth: number) { analyzer.cleanupDepth = depth; },
      get componentBodyDepth() { return analyzer.componentBodyDepth; },
      set componentBodyDepth(depth: number) { analyzer.componentBodyDepth = depth; },
      get componentStates() { return analyzer.componentStates; },
      set componentStates(states: Set<string> | null) { analyzer.componentStates = states; },
      get constructorDepth() { return analyzer.constructorDepth; },
      set constructorDepth(depth: number) { analyzer.constructorDepth = depth; },
      get explicitReadonlyPropBindings() { return analyzer.explicitReadonlyPropBindings; },
      set explicitReadonlyPropBindings(bindings: ReadonlyMap<string, number>) { analyzer.explicitReadonlyPropBindings = bindings; },
      get flowFrameDepth() { return analyzer.flowFrameDepth; },
      set flowFrameDepth(depth: number) { analyzer.flowFrameDepth = depth; },
      get jsxDepth() { return analyzer.jsxDepth; },
      set jsxDepth(depth: number) { analyzer.jsxDepth = depth; },
      get lookBuilderNames() { return analyzer.lookBuilderNames; },
      set lookBuilderNames(names: ReadonlyMap<string, string>) { analyzer.lookBuilderNames = names; },
      get lookDeclarations() { return analyzer.lookDeclarations; },
      set lookDeclarations(declarations: ReadonlyMap<string, WebLookExpression | null>) { analyzer.lookDeclarations = declarations; },
      get lookImport() { return analyzer.lookImport; },
      set lookImport(site: LookImportSite | null) { analyzer.lookImport = site; },
      get lookStatic() { return analyzer.lookStatic; },
      set lookStatic(scope: LookStaticScope) { analyzer.lookStatic = scope; },
      get moduleFunctions() { return analyzer.moduleFunctions; },
      set moduleFunctions(functions: ReadonlyMap<string, FunctionDeclarationStatement | null>) { analyzer.moduleFunctions = functions; },
      get mountedDepth() { return analyzer.mountedDepth; },
      set mountedDepth(depth: number) { analyzer.mountedDepth = depth; },
      get publicConfigNames() { return analyzer.publicConfigNames; },
      set publicConfigNames(names: ReadonlySet<string>) { analyzer.publicConfigNames = names; },
      get reactiveDerivations() { return analyzer.reactiveDerivations; },
      set reactiveDerivations(derivations: ReadonlyMap<string, ReadonlySet<string> | null>) { analyzer.reactiveDerivations = derivations; },
      get reactiveStateNames() { return analyzer.reactiveStateNames; },
      set reactiveStateNames(names: ReadonlyMap<string, boolean>) { analyzer.reactiveStateNames = names; },
      get reactiveWriters() { return analyzer.reactiveWriters; },
      set reactiveWriters(writers: ReadonlyMap<string, ReactiveWriterDeclaration | null>) { analyzer.reactiveWriters = writers; },
      get synchronousReactiveDepth() { return analyzer.synchronousReactiveDepth; },
      set synchronousReactiveDepth(depth: number) { analyzer.synchronousReactiveDepth = depth; },
      get watchBodyDepth() { return analyzer.watchBodyDepth; },
      set watchBodyDepth(depth: number) { analyzer.watchBodyDepth = depth; },
      ...this.analyzerOperations(),
    };
  }

  /**
   * The base-analyzer operations the collaborators perform, bound to this
   * analyzer. They are their own object because they are plain function values:
   * spreading them into the host above copies the bindings, while an accessor
   * has to be written in the literal that becomes the host.
   */
  private analyzerOperations(): AnalyzerOperations {
    return {
      advise: (code, message, adviceSpan, fix) => { this.advise(code, message, adviceSpan, fix); },
      analyzeBlock: (statements) => { this.analyzeBlock(statements); },
      analyzeFunctionDeclaration: (statement, className, method, declareSelf, forceAsynchronous, declarationKind) => {
        this.analyzeFunctionDeclaration(statement, className, method, declareSelf, forceAsynchronous, declarationKind);
      },
      analyzeStatement: (statement) => { this.analyzeStatement(statement); },
      analyzeStatements: (statements) => { this.analyzeStatements(statements); },
      checkWebRouteComponent: (type, sourceSpan, subject) => { checkWebRouteComponent(this.host, type, sourceSpan, subject); },
      checkWebRouteRecords: (expression) => { checkWebRouteRecords(this.host, expression); },
      declareBinding: (name, mutable, type, declarationSpan) => { this.declareBinding(name, mutable, type, declarationSpan); },
      derivedReactiveRead: (name) => derivedReactiveRead(this.host, name),
      enterScope: () => { this.enterScope(); },
      exitScope: () => { this.exitScope(); },
      expandAliases: (type) => this.expandAliases(type),
      fieldsOf: (identity) => this.fieldsOf(identity),
      inComponentSetupPosition: () => this.inComponentSetupPosition(),
      inferExpression: (expression, contextualType) => this.inferExpression(expression, contextualType),
      inferParameterDefault: (expression, contextualType) => this.inferParameterDefault(expression, contextualType),
      inferredExpressionType: (expression) => this.inferredExpressionType(expression),
      inferredFunctionResult: (statement) => this.inferredFunctionResult(statement),
      isAssignableHere: (actual, expected) => isAssignable(actual, expected, this),
      isClassInput,
      isJsxAttributeValue: (type) => isJsxAttributeValue(this.host, type),
      isJsxRenderable: (type) => isJsxRenderable(this.host, type),
      isLookInput,
      isOptionalString: (type) => isOptionalString(this.host, type),
      isPredeclared: (statement) => this.isPredeclared(statement),
      isScalarTextType: (type) => isScalarTextType(this.host, type),
      isTopLevelScope: () => this.isTopLevelScope(),
      lookup: (name) => this.lookup(name),
      markDeclaredBindingReactive: (name, kind) => { this.markDeclaredBindingReactive(name, kind); },
      markTypeNameRefused: (name) => { this.markTypeNameRefused(name); },
      prescanScopeDeclarations: (statements) => { this.prescanScopeDeclarations(statements); },
      reactiveBindingKind: (name) => this.reactiveBindingKind(name),
      requireAssignable: (actual, expected, valueSpan) => { this.requireAssignable(actual, expected, valueSpan); },
      requireCondition: (type, condition) => { this.requireCondition(type, condition); },
      requireSettledCollectionElement: (initializer, declared, annotated) => { this.requireSettledCollectionElement(initializer, declared, annotated); },
      resolveAnnotation: (reference) => this.resolveAnnotation(reference),
      resolveValidatedAnnotation: (reference) => this.resolveValidatedAnnotation(reference),
      resolvedAsyncResult: (type) => this.resolvedAsyncResult(type),
      typeError: (message, errorSpan) => { this.typeError(message, errorSpan); },
      validateTypeReference: (reference) => this.validateTypeReference(reference),
      writableStateName: (name) => writableStateName(this.host, name),
    };
  }
}
