import { type Diagnostic, type Span } from "@velarscript/compiler";
import {
  Analyzer,
  anyType,
  boolType,
  describeType,
  expressionContainsDirectAwait,
  invalidType,
  isInvalidType,
  isAssignable,
  isReadonlyView,
  nullType,
  nonOptional,
  optionalOf,
  spanIdentity,
  stringType,
  unknownType,
  type AnalysisContext,
  type CompilerAnalysisExtension,
  type Expression,
  type Program,
  type Statement,
  type TypeReference,
  type ValueType,
} from "@velarscript/compiler/extension";
import { BROWSER_TEST_MODULE, BROWSER_TEST_SOURCE_SUFFIX, browserTestImportGuidance } from "./browser-test.ts";
import { LOOK_ARITHMETIC_HINT, LOOK_UNIT_TYPES } from "./look.ts";
import { collectLookStaticScope, isLookStaticValue, type LookStaticScope, type LookStaticValue } from "./look-static.ts";
import { componentCallRefusal, componentSectionCountDiagnostics, watchedResourceSurfaceRefusal } from "./analysis/component-guidance.ts";
import { foldedLengthPercentage, isLookNumericType } from "./analysis/look-values.ts";
import { collectPublicConfigNames, declaredPublicConfig, publicConfigDiagnostic } from "./analysis/public-config.ts";
import { collectDerivedReactiveNames, collectReactiveDerivations, collectReactiveStateNames, isRetiredAccessorName } from "./analysis/reactive-names.ts";
import {
  isWebExpression,
  isWebJsx,
  isWebKeyframes,
  isWebLook,
  isWebStatement,
  isWebUnit,
  type WebActionDeclaration as ActionDeclaration,
  type WebComponentDeclaration as ComponentDeclaration,
  type WebComputedDeclaration as ComputedDeclaration,
  type WebJsxAttribute as JSXAttribute,
  type WebJsxElementExpression as JSXElementExpression,
  type WebLookExpression,
  type WebResourceDeclaration as ResourceDeclaration,
} from "./ast.ts";
import { isWebComponentType, isWebComputedExport, isWebNodeType, normalizeWebComponentType, webComponentConstructor, webComponentName, webNodeType, WEB_OWNED_TYPE_NAMES } from "./types.ts";
import {
  collectionMutators,
  collectReactiveWriters,
  finallySelfWrite,
  reactivePathOf,
  reactivePathRoot,
  watchDerivedSourceWrite,
  statementBindsName,
  topLevelCall,
  watchSelfWrite,
  writerWritesPath,
  type ReactivePathStep,
  type ReactiveWriterDeclaration,
} from "./analysis/watch-cycles.ts";
import { inferWebIntrinsic } from "./analysis/calls/intrinsics.ts";
import { bodyReturnsJsx, carriesWebNode, componentSpelling, firstReactiveDeclaration, returnedMarkupRoots } from "./analysis/jsx-detection.ts";
import { inferJsx } from "./analysis/jsx/elements.ts";
import { type JsxAnalysisHost } from "./analysis/jsx/host.ts";
import { buildsFreshRecords, collectModuleFunctions, keyedRebuiltRecord, type FunctionDeclarationStatement, type KeyedListRebuild } from "./analysis/keyed-rebuild.ts";
import { analyzeKeyframes } from "./analysis/keyframes-analysis.ts";
import { collectLookDeclarations } from "./analysis/look-conditions.ts";
import { collectLookBuilderNames, collectLookImportSite, containsCssImport, firstRelativeCssAssetAddress, lookJoin, lookLiteralZero, type LookImportSite } from "./analysis/look-sites.ts";
import { checkLookBuilderCall } from "./analysis/look/builders.ts";
import { analyzeLookEntries } from "./analysis/look/entries.ts";
import { lookSourceOf } from "./analysis/media-conditions.ts";
import { RETIRED_ACCESSOR_TYPE, type RetiredAccessorDeclaration } from "./analysis/retired-accessors.ts";
import { checkRoutePath } from "./analysis/routes.ts";
import { renderWatchSubject, watchSubjectPath } from "./analysis/watch-subject.ts";
import { diagnostic, routeContextIdentity, textualWebPrimitiveNames, webEventDeadFields, webEventTypeNames, webTypeFields } from "./analysis/web-types.ts";

// D115 P4 R3a: the 1,660 lines that stood outside this class — the Look
// vocabulary and its conditions, the URL-scheme rule, the route and JSX
// readings, the watch-subject reconstruction, the keyed-rebuild advisory's
// evidence, the Web type tables and 'inferWebIntrinsic' — moved to
// './analysis/'. The two names this module published besides the analyzer are
// re-exported here, so an existing 'from "./analyzer.ts"' import of either
// keeps working unchanged.
export { inferWebIntrinsic, routeContextIdentity };

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

  /** The one object every `analysis/jsx/` and `analysis/look/` collaborator reads this analyzer through. */
  private readonly host: JsxAnalysisHost;

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
    this.lookStatic = collectLookStaticScope(program, this.importedLookStaticValues);
    this.lookBuilderNames = collectLookBuilderNames(program);
    this.publicConfigNames = collectPublicConfigNames(program);
    this.lookImport = collectLookImportSite(program);
    this.lookDeclarations = collectLookDeclarations(program);
    for (const name of collectDerivedReactiveNames(program)) this.derivedReactiveNames.add(name);
    this.reportBrowserTestImports(program);
    this.rejectWebOwnedTypeNames(program);
    this.keyedListSources.clear();
    this.keyedListRebuilds.length = 0;
    this.moduleFunctions = collectModuleFunctions(program);
    this.reactiveWriters = collectReactiveWriters(program);
    this.reactiveDerivations = collectReactiveDerivations(program);
    this.reactiveStateNames = collectReactiveStateNames(program);
    super.analyze(program);
    this.reportStaticJsxKeys();
    this.reportRetiredComputedFunction();
    this.adviseKeyedListRebuilds();
    return this.diagnostics;
  }

  /**
   * D57 rule 138: `velar/web-test` only has a runtime under `velar test
   * --browser`, so an import of it anywhere else compiles a call that cannot
   * succeed. D51 rule 109 puts the refusal at the declaration rather than at the
   * eventual use, so the error lands on the `import` line — including the
   * JavaScript-bridge and re-export spellings, which reach the same runtime.
   */
  private reportBrowserTestImports(program: Program): void {
    if ((this.webModulePath ?? "").endsWith(BROWSER_TEST_SOURCE_SUFFIX)) return;
    for (const statement of program.body) {
      if (statement.kind !== "ImportDeclaration" && statement.kind !== "ReExportDeclaration") continue;
      if (statement.source !== BROWSER_TEST_MODULE) continue;
      this.diagnostics.push(diagnostic("VEL5062", browserTestImportGuidance(), statement.sourceSpan));
    }
  }

  /**
   * D72 rule 186: a Web module publishes its own type names, and a user
   * declaration of one used to be accepted at the declaration and then lose at
   * every use — `type Event:` compiled, and `describe({kind: "charge"})` was
   * told it could not assign to `Event`, naming a type the author had just
   * written. D51 rule 109 already settled where that refusal belongs: at the
   * declaration, which is the only place a rename is cheap.
   *
   * The names come from the extension's own published table, so adding a type
   * to `WEB_OWNED_TYPE_NAMES` extends this protection with it. The last time
   * this family was repaired by listing names instead of deriving them, the
   * list drifted; D57 rule 135 is the same repair on the Core roster.
   *
   * Core now says the same sentence about its own built-in type names —
   * `builtinTypeNameDeclarationMessage` in packages/compiler/src/analyzer.ts,
   * reported as VEL3007. The rosters differ; the wording is meant to read
   * alike, so a change to either sentence belongs in both.
   *
   * `Duration` is on both rosters — Core owns it as a primitive and
   * `velar/look` republishes it — so a Web module used to report it twice. This
   * refusal is the more specific of the two, because it names the surface the
   * author is writing against, so it marks the name refused and Core's stays
   * unsaid. The mark is Core's own hook, which is what lets this pass take
   * precedence without either side learning the other's roster.
   */
  private rejectWebOwnedTypeNames(program: Program): void {
    const reject = (name: string, errorSpan: Span, noun: string): void => {
      if (!WEB_OWNED_TYPE_NAMES.has(name)) return;
      this.markTypeNameRefused(name);
      this.diagnostics.push(diagnostic(
        "VEL5065",
        `'${name}' is a Web type name, so it cannot also name ${/^[aeiou]/iu.test(noun) ? "an" : "a"} ${noun}; every use of it in a Web module resolves to the built-in. Rename this declaration`,
        errorSpan,
      ));
    };
    for (const statement of program.body) {
      switch (statement.kind) {
        case "TypeDeclaration":
        case "TypeAliasDeclaration":
          reject(statement.name, statement.span, "type");
          break;
        case "ClassDeclaration":
          reject(statement.name, statement.span, "class");
          break;
        case "EnumDeclaration":
          reject(statement.name, statement.span, "enum");
          break;
        case "ExternModuleDeclaration":
          for (const declaration of statement.classes) reject(declaration.name, declaration.span, "extern class");
          break;
        case "ImportDeclaration":
          // A standard-module import of the name under itself *is* the built-in
          // — `import {Color, Length} from "velar/look"` is how a module names
          // the published types — so only a binding that would make the name
          // mean something else is refused.
          if (statement.source.startsWith("velar/")) {
            for (const specifier of statement.specifiers) {
              if (specifier.local !== specifier.imported) reject(specifier.local, statement.span, "import alias");
            }
            break;
          }
          for (const specifier of statement.specifiers) {
            reject(specifier.local, statement.span, specifier.local === specifier.imported ? "imported name" : "import alias");
          }
          break;
        default:
          break;
      }
    }
  }

  /**
   * WEB-C1: charter §14 promises that a key outside a keyed shape is a
   * diagnostic rather than a silent no-op. Interpolated positions report while
   * their interpolation is walked; static positions are collected during JSX
   * inference and reported once every keyed interpolation is known.
   */
  private reportStaticJsxKeys(): void {
    for (const { element, attribute } of this.staticJsxKeys) {
      if (this.honoredJsxKeys.has(element) || this.reportedJsxKeys.has(element)) continue;
      this.diagnostics.push(diagnostic(
        "VEL5050",
        `This JSX key has no effect: '<${element.tag}>' is rendered in a fixed position, and keys reuse children by identity only inside 'items.map(item => <Row key={item.id} />)' — remove the key, or render this element from a keyed .map()`,
        attribute.span,
      ));
    }
  }

  protected override predeclareExtensionStatement(statement: Statement): boolean {
    if (!isWebStatement(statement)) return false;
    if (statement.kind === "ExtensionStatement:web:unsafe-css") return true;
    if (statement.kind !== "ExtensionStatement:web:component") return false;
    this.declareBinding(statement.name, false, this.componentType(statement), statement.span);
    return true;
  }

  protected override analyzeExtensionStatement(statement: Statement): boolean {
    // Two core statement shapes are answered here before the core sees them:
    // a write to a derived name, which the const message would describe wrongly,
    // and a `const x = computed(...)` declaration, whose migration needs the
    // declaration recorded before its reads are walked.
    if (statement.kind === "AssignmentStatement" && this.rejectComputedAssignment(statement)) return true;
    if (statement.kind === "VariableDeclaration") {
      this.recordRetiredAccessorDeclaration(statement);
    }
    if (statement.kind === "FunctionDeclaration") {
      this.rejectStatefulWebNodeFunction(statement);
      this.rejectUnownedComponentElement(statement);
    }
    if (!isWebStatement(statement)) return false;
    switch (statement.kind) {
      case "ExtensionStatement:web:component":
        // A component body renders after module evaluation, so its reads are
        // deferred for the module-initialization-cycle classification even
        // though component analysis itself runs without a function frame.
        this.deferredExecutionDepth += 1;
        try {
          this.analyzeComponent(statement);
        } finally {
          this.deferredExecutionDepth -= 1;
        }
        return true;
      case "ExtensionStatement:web:state": {
        const annotationValid = statement.type ? this.validateTypeReference(statement.type) : true;
        const annotationContext = statement.type ? this.resolveValidatedAnnotation(statement.type) : null;
        const actual = this.inferExpression(statement.initializer, annotationContext ?? unknownType);
        const declared = annotationContext ?? actual;
        if (annotationValid) this.requireAssignable(actual, declared, statement.initializer.span);
        this.requireSettledCollectionElement(statement.initializer, declared, annotationContext !== null);
        this.declareBinding(statement.name, true, declared, statement.span);
        this.markDeclaredBindingReactive(statement.name, "state");
        return true;
      }
      case "ExtensionStatement:web:computed":
        this.analyzeComputedDeclaration(statement);
        return true;
      case "ExtensionStatement:web:resource":
        this.diagnostics.push(diagnostic("VEL3012", "'resource' is only valid at component scope; a module-scope async operation belongs in a module 'action'", statement.span));
        this.analyzeResourceDeclaration(statement);
        return true;
      case "ExtensionStatement:web:action":
        // A module-scope action behaves exactly like a component action —
        // reactive pending/error fields with rejection semantics preserved —
        // but its lifetime is the module, so it never registers disposal.
        if (!this.isTopLevelScope()) {
          this.diagnostics.push(diagnostic("VEL3013", "'action' is only valid at module or component scope", statement.span));
        }
        this.analyzeActionDeclaration(statement);
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
          if (this.rejectFrozenWatchSubject(statement.expression, watched, statement.currentName, statement.previousName)) {
            this.rejectWatchCycle(statement.expression, watched, statement.body);
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
      case "ExtensionStatement:web:unsafe-css": {
        // LOK-D2 / D53: unsafe CSS is a module-level ordering declaration,
        // whether its source is an external resource or an inline raw block.
        // Nested inside a component or a function it used to pass every check,
        // build, and then appear in no output at all.
        if (!this.isTopLevelScope()) {
          this.diagnostics.push(diagnostic("VEL5037", "Unsafe CSS is module-level; move the declaration to the top of the module so its order against Look stays visible", statement.span));
          return true;
        }
        if (statement.source.kind === "external" && this.unsafeCssImports.has(statement.source.path)) {
          this.diagnostics.push(diagnostic("VEL5037", `Unsafe CSS '${statement.source.path}' is imported more than once; each stylesheet must have one explicit order position`, statement.span));
        }
        if (statement.source.kind === "external") this.unsafeCssImports.add(statement.source.path);
        const source = statement.source.kind === "inline" ? statement.source.css : this.resources.get(statement.source.path);
        const subject = statement.source.kind === "inline" ? "Inline unsafe CSS" : `Unsafe CSS '${statement.source.path}'`;
        if (source && containsCssImport(source)) {
          this.diagnostics.push(diagnostic("VEL5037", `${subject} contains @import; declare every stylesheet with 'import css unsafe' so project order remains visible`, statement.source.span));
        }
        if (source) {
          const relativeAddress = firstRelativeCssAssetAddress(source);
          if (relativeAddress) this.diagnostics.push(diagnostic("VEL5037", `${subject} uses relative asset address ${relativeAddress.syntax}(${JSON.stringify(relativeAddress.value)}); use a project-public /path, data URL, fragment, or absolute URL so extracted asset ownership stays explicit`, statement.source.span));
        }
        return true;
      }
      default:
        return false;
    }
  }

  protected override analyzeStatement(statement: Statement): void {
    const readonlyProp = this.directReadonlyPropMutation(statement);
    this.recordKeyedListRebuild(statement);
    const firstDiagnostic = this.diagnostics.length;
    super.analyzeStatement(statement);
    if (!readonlyProp) return;
    for (let index = firstDiagnostic; index < this.diagnostics.length; index += 1) {
      const item = this.diagnostics[index]!;
      if ((item.code !== "VEL3002" && item.code !== "VEL4001") || !/read-?only|readonly/iu.test(item.message)) continue;
      this.diagnostics[index] = {
        ...item,
        message: `Cannot mutate prop '${readonlyProp}': this component's author explicitly declared it 'readonly'. ${item.message}`,
      };
    }
  }

  private directReadonlyPropMutation(statement: Statement): string | null {
    let target: Expression | null = null;
    if (statement.kind === "AssignmentStatement" && statement.target.kind !== "IdentifierExpression") {
      target = statement.target;
    } else if (statement.kind === "ExpressionStatement" && statement.expression.kind === "CallExpression"
      && statement.expression.callee.kind === "MemberExpression") {
      target = statement.expression.callee.object;
    }
    if (!target) return null;
    const name = this.rootBindingName(target);
    if (!name) return null;
    const binding = this.lookup(name);
    return binding && this.explicitReadonlyPropBindings.get(name) === binding.span.start ? name : null;
  }

  private rootBindingName(expression: Expression): string | null {
    if (expression.kind === "IdentifierExpression") return expression.name;
    if (expression.kind === "MemberExpression" || expression.kind === "IndexExpression") {
      return this.rootBindingName(expression.object);
    }
    if (expression.kind === "CallExpression" && expression.callee.kind === "MemberExpression") {
      return this.rootBindingName(expression.callee.object);
    }
    return null;
  }

  protected override prescanExtensionScopeDeclaration(statement: Statement): { readonly name: string; readonly span: Span } | null {
    if (!isWebStatement(statement)) return null;
    return statement.kind === "ExtensionStatement:web:state" || statement.kind === "ExtensionStatement:web:computed"
      || statement.kind === "ExtensionStatement:web:resource"
      ? { name: statement.name, span: statement.span }
      : null;
  }

  /**
   * D71 rule 182: a derived value is reactive and read-only, which is exactly
   * the reactive identity a component prop already carries — a bare read lowers
   * through `.get()`, and nothing may write it. Registering that identity
   * rather than `state` is what keeps `bind={doubled}` and every other writable
   * position refusing a derived name for free.
   */
  private analyzeComputedDeclaration(statement: ComputedDeclaration): void {
    const annotationValid = statement.type ? this.validateTypeReference(statement.type) : true;
    const annotationContext = statement.type ? this.resolveValidatedAnnotation(statement.type) : null;
    // The initializer re-runs on every dependency change, so it is a deferred
    // read for the module-initialization-cycle classification, exactly like a
    // watch subject.
    this.synchronousReactiveDepth += 1;
    const actual = this.inferExpression(statement.initializer, annotationContext ?? unknownType);
    this.synchronousReactiveDepth -= 1;
    const declared = annotationContext ?? actual;
    if (annotationValid) this.requireAssignable(actual, declared, statement.initializer.span);
    this.declareBinding(statement.name, false, declared, statement.span);
    this.markDeclaredBindingReactive(statement.name, "prop");
    this.computedBindingSpans.add(spanIdentity(statement.span));
    this.recordDerivedKeyedListRebuild(statement);
  }

  /**
   * True when `name` resolves to a `computed` declaration or to an imported one.
   * The question is asked of the *binding* the name resolves to, never of the
   * spelling: a local `state` may shadow an imported derived name, and that
   * shadow is writable state.
   */
  private isComputedBinding(name: string): boolean {
    const binding = this.lookup(name);
    return binding !== null && this.computedBindingSpans.has(spanIdentity(binding.span));
  }

  /**
   * True when `name` resolves to a `resource` declaration. Asked of the binding
   * rather than of the spelling, for the reason `isComputedBinding` is: a local
   * `state` may shadow a resource's name, and the shadow is not a resource.
   */
  private isResourceBinding(name: string): boolean {
    const binding = this.lookup(name);
    return binding !== null && this.resourceBindingSpans.has(spanIdentity(binding.span));
  }

  private isImportedComputedBinding(name: string): boolean {
    const binding = this.lookup(name);
    return binding !== null && this.importedComputedSpans.has(spanIdentity(binding.span));
  }

  /**
   * D71 rule 184: a cross-module `computed` travels through `reactiveExports`
   * so its bare read lowers through `.get()` like an exported `state` — but it
   * is not writable, and the imported binding must not inherit the writable
   * identity that carries `bind={...}` and `event => name = ...`. The Web
   * extension publishes which exported names are derived, so the import is
   * demoted to the read-only reactive identity here.
   */
  protected override markDeclaredBindingReactive(name: string, kind: "state" | "prop" = "state"): void {
    // Only the import itself is demoted. A local `state` of the same name in a
    // component or a block is a shadow that really is writable, and demoting it
    // would compile its assignment as a plain store into the handle.
    const imported = kind === "state" && this.isTopLevelScope() && this.importedComputedNames.has(name);
    super.markDeclaredBindingReactive(name, imported ? "prop" : kind);
    if (!imported) return;
    const binding = this.lookup(name);
    if (!binding) return;
    this.computedBindingSpans.add(spanIdentity(binding.span));
    this.importedComputedSpans.add(spanIdentity(binding.span));
  }

  protected override inferExtensionExpression(expression: Expression, _contextualType: ValueType): ValueType | undefined {
    if (expression.kind === "CallExpression" && expression.callee.kind === "IdentifierExpression"
      && expression.callee.name === "mount") {
      const namedNode = expression.argumentNames?.findIndex((name) => name === "node") ?? -1;
      const node = expression.arguments[namedNode >= 0 ? namedNode : 0];
      if (node && expressionContainsDirectAwait(node, (value) => value.kind === "ExtensionExpression:web:jsx" ? false : undefined)) {
        this.diagnostics.push(diagnostic(
          "VEL4007",
          "mount constructs its root synchronously; await the root in a separate module binding before calling mount",
          node.span,
        ));
      }
    }
    if (expression.kind === "UnaryExpression" && (expression.operator === "+" || expression.operator === "-")) {
      const operand = this.inferExpression(expression.operand);
      if (isLookNumericType(operand)) {
        this.extensionCalls.set(spanIdentity(expression.span), LOOK_ARITHMETIC_HINT);
        return operand;
      }
      this.probedOperandTypes.set(spanIdentity(expression.operand.span), operand);
    }
    // WEB-U15 / GRM-A3: '&&' rendering is the React habit. The lexer now starts
    // JSX after 'and'/'or' so the shape parses and this rejection names the
    // conditional-rendering spelling instead of leaking a bool type error.
    if (expression.kind === "BinaryExpression" && (expression.operator === "and" || expression.operator === "or")
      && (isWebJsx(expression.left) || isWebJsx(expression.right))) {
      const rightIsElement = isWebJsx(expression.right);
      const tag = rightIsElement ? expression.right.tag : isWebJsx(expression.left) ? expression.left.tag : "";
      const condition = lookSourceOf(rightIsElement ? expression.left : expression.right);
      this.inferExpression(expression.left);
      this.inferExpression(expression.right);
      this.diagnostics.push(diagnostic(
        "VEL5029",
        `'${expression.operator}' combines bool values and cannot yield an element; render conditionally with '{${condition} ? <${tag || ">"} ... : null}'`,
        expression.span,
      ));
      return invalidType;
    }
    if (expression.kind === "BinaryExpression" && ["+", "-", "*", "/"].includes(expression.operator)) {
      const left = this.inferExpression(expression.left);
      const right = this.inferExpression(expression.right);
      if (!isLookNumericType(left) && !isLookNumericType(right)) {
        this.probedOperandTypes.set(spanIdentity(expression.left.span), left);
        this.probedOperandTypes.set(spanIdentity(expression.right.span), right);
      } else {
        const additive = expression.operator === "+" || expression.operator === "-" ? lookJoin(left, right) : null;
        const result = additive
          ?? ((expression.operator === "*" || expression.operator === "/") && isLookNumericType(left) && right.kind === "number" ? left : null)
          ?? (expression.operator === "*" && left.kind === "number" && isLookNumericType(right) ? right : null);
        if (result) {
          // LOK-U8: dividing a visual value by a literal zero produces a
          // non-finite length that the runtime rejects on first construction.
          if (expression.operator === "/" && lookLiteralZero(expression.right)) {
            this.diagnostics.push(diagnostic("VEL5042", "Look unit arithmetic cannot divide by zero", expression.span));
            return invalidType;
          }
          this.extensionCalls.set(spanIdentity(expression.span), LOOK_ARITHMETIC_HINT);
          return result;
        }
        // The rejection is final: returning the invalid type keeps the Look
        // property's own assignment error from co-reporting a union dump on the
        // very expression that was already named (LOK-I1).
        this.diagnostics.push(diagnostic("VEL5042", `Look unit arithmetic cannot apply '${expression.operator}' to ${describeType(left)} and ${describeType(right)}`, expression.span));
        return invalidType;
      }
    }
    // WEB-N2 / D47 rule 84: the event object is typed down to event semantics
    // and deliberately carries no target, so `event.target.value` is a dead end
    // that used to cascade into three unknown-access errors. The read is where
    // the author wanted two-way binding, so it names that spelling and stops.
    if (expression.kind === "MemberExpression" && !expression.optional && webEventDeadFields.has(expression.property)
      && expression.object.kind === "IdentifierExpression") {
      const binding = this.lookup(expression.object.name);
      const expanded = binding ? this.expandAliases(binding.type) : null;
      if (expanded?.kind === "named" && webEventTypeNames.has(expanded.name)) {
        this.diagnostics.push(diagnostic(
          "VEL5019",
          `A VelarScript event object carries typed event fields only and has no '${expression.property}': read the element's value through a two-way binding instead — 'bind:value={name}' binds a state name, and 'bind:value={form.field}' or 'bind:value={items[0]}' binds a writable path inside state`,
          expression.span,
        ));
        return invalidType;
      }
    }
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
    if (isWebExpression(expression) && expression.kind === "ExtensionExpression:web:look-hook") {
      this.diagnostics.push(diagnostic("VEL5038", `Look hook '@${expression.name}' is only valid inside a Look condition`, expression.span));
      return boolType;
    }
    if (isWebUnit(expression)) {
      const type = LOOK_UNIT_TYPES.get(expression.unit);
      if (type) return { kind: "named", name: type };
      return unknownType;
    }
    return undefined;
  }

  protected override inferExpression(expression: Expression, contextualType: ValueType = unknownType): ValueType {
    // Operands probed for Look arithmetic are re-requested by the core analyzer immediately after the
    // probe declines; reusing the probe result (consume-once) keeps operand analysis single-run so
    // operand diagnostics are not reported twice.
    const key = spanIdentity(expression.span);
    const probed = this.probedOperandTypes.get(key);
    if (probed !== undefined) {
      this.probedOperandTypes.delete(key);
      return probed;
    }
    if (expression.kind === "CallExpression" && expression.arguments.length === 0
      && expression.callee.kind === "IdentifierExpression") {
      this.plainCallSpans.set(spanIdentity(expression.callee.span), expression.span);
      const called = this.calledComputedBinding(expression);
      if (called) return called;
    }
    if (expression.kind === "IdentifierExpression") {
      const retired = this.recordRetiredAccessorRead(expression);
      // The retired name is answered here rather than left to fall through as an
      // unknown one: the author gets its migration and nothing else, and the
      // call around it still type-checks against the signature it always had.
      if (retired) return RETIRED_ACCESSOR_TYPE;
    }
    const folded = expression.kind !== "CallExpression" ? null
      : foldedLengthPercentage(expression, (name) => this.lookBuilderNames.get(name), (argument) => this.probedSlotType(argument), lookJoin);
    const result = super.inferExpression(expression, contextualType);
    if (expression.kind === "CallExpression") {
      checkLookBuilderCall(this.host, expression);
      // D114 0.29.0 LC-D1: the manifest this build bakes in, proved against the declared type.
      const report = publicConfigDiagnostic(expression, result, this.publicConfigNames, this.webPublicConfig,
        { expandAliases: (type) => this.expandAliases(type), fieldsOf: (identity) => this.fieldsOf(identity), describeType });
      if (report) this.diagnostics.push(report);
    }
    return folded ?? result;
  }

  /** Infers one builder slot and parks the answer in the probe cache, so the call's own analysis reads it back. */
  private probedSlotType(argument: Expression): ValueType {
    const inferred = this.inferExpression(argument);
    this.probedOperandTypes.set(spanIdentity(argument.span), inferred);
    return this.expandAliases(inferred);
  }
  // A name refers to writable reactive state only when ordinary lexical lookup
  // still resolves it to the state binding; a shadowing local wins instead.
  private writableStateName(name: string): boolean {
    return this.reactiveBindingKind(name) === "state";
  }

  /**
   * P2b-5: a `def` that answers markup and answers it with a component element.
   *
   * Everything about the shape is legal one step out. A component element is a
   * legal module-level expression — `const root = <App />` is the instantiation
   * site D90 R4-b rules on, and `mount` takes exactly the instance it evaluates
   * to. A `def` answering markup is a legal markup helper — dispatch over a
   * closed vocabulary is what the P2b wave was writing. The defect is only
   * where the two meet, and it is a representation split the type does not
   * carry: a component element in a *child* position lowers to `__velarChild`,
   * which owns a scope and answers a DOM node, while the same element standing
   * alone lowers to `__velarInstantiate`, which answers an instance. Both are
   * typed `WebNode`; only one is one. Returned from a helper and handed to a
   * render, the instance reaches `__velarAppend` and takes the whole subtree
   * down with "JSX can render only text, finite numbers, bool, enums, WebNode
   * values, and Lists of those values" — the check-green, runtime-dead shape.
   *
   * The walk stops at every JSX element, which is exactly where the emitter
   * stops: inside one, every position is a child position and every component
   * element there is already correct — `return <div><Badge /></div>` and an
   * interpolated `{cond ? <Badge /> : ...}` both work today and must keep
   * working. Only a component element the returned markup *starts* with is the
   * defect, including one reached through a `.map(...)` answering a row per
   * item, which fails the same way for the same reason.
   */
  private rejectUnownedComponentElement(statement: Extract<Statement, { readonly kind: "FunctionDeclaration" }>): void {
    // A helper nested in a component body is emitted with that component's
    // scope in hand, so its component elements are `__velarChild` and answer
    // nodes. Only a helper standing outside every component body has nowhere
    // for the emitter to put them.
    if (this.componentBodyDepth > 0) return;
    const answersMarkup = statement.returnType
      ? carriesWebNode(this.resolveAnnotation(statement.returnType))
      : bodyReturnsJsx(statement.body);
    if (!answersMarkup) return;
    for (const element of returnedMarkupRoots(statement.body)) {
      if (!/^[A-Z]/u.test(element.tag)) continue;
      this.diagnostics.push(diagnostic(
        "VEL5075",
        `'${statement.name}' answers markup with the component element '<${element.tag} />', and a component element standing on its own is an instance rather than a node: it is built by the position that shows it, and a 'def' is not one, so what this returns fails the moment JSX tries to render it. Write '<${element.tag} />' where it is rendered — a component's own body, or a child position inside markup this returns such as '<div><${element.tag} ... /></div>' — and keep the helper for the native elements it builds.`,
        element.span,
      ));
    }
  }

  /**
   * The audit's seventh root cause: a `def` that declares reactive state and
   * answers `WebNode` is a component wearing a function's clothes, and calling
   * it bypasses exactly what the charter already refuses `View(...)` for. Two
   * things follow from the call, both reproduced: every call runs the `state`
   * declaration again, so the value resets on every re-render; and the
   * observers the returned markup registers bind to whatever scope the call
   * site was building — at module scope the global one, which is never
   * destroyed, so they are never cleaned up.
   *
   * Only DECLARATION is refused. A `def -> WebNode` that merely reads state or a
   * prop is a legitimate markup helper — examples/app has two — and a `def`
   * nested inside a component binds its observers to that component's scope, so
   * nothing about reading is defective.
   *
   * What answers "this `def` returns markup" is the sink, not one spelling of
   * it: `-> WebNode?` and `-> List<WebNode>` are the shapes markup travels in,
   * and a `def` may carry no return type at all — all three reached the same
   * defect with the same body while only the bare annotation was read.
   */
  private rejectStatefulWebNodeFunction(statement: Extract<Statement, { readonly kind: "FunctionDeclaration" }>): void {
    const answersMarkup = statement.returnType
      ? carriesWebNode(this.resolveAnnotation(statement.returnType))
      : bodyReturnsJsx(statement.body);
    if (!answersMarkup) return;
    const declaration = firstReactiveDeclaration(statement.body);
    if (!declaration) return;
    const component = componentSpelling(statement.name);
    this.diagnostics.push(diagnostic(
      "VEL5074",
      `'${statement.name}' declares ${declaration.label} and returns WebNode, so calling it bypasses JSX ownership, prop cells, and lifecycle: every call declares the value again, so it resets on each render, and the observers its markup registers belong to whatever scope the call site was building rather than to this value. Write it as a component — 'component ${component}(...)' rendered as '<${component} />'; a 'def' that returns WebNode is a markup helper and may only read.`,
      declaration.span,
    ));
  }

  /**
   * D71 rule 182: a declared derived value is read bare, exactly like state.
   * Calling one is the habit the retired `computed(...)` accessor taught, and it
   * is also what a half-migrated project looks like from the importing side — so
   * the answer names the one spelling and carries the edit that reaches it,
   * which is what lets `velar fix` finish a migration that crosses modules.
   */
  private calledComputedBinding(expression: Extract<Expression, { readonly kind: "CallExpression" }>): ValueType | null {
    if (expression.callee.kind !== "IdentifierExpression") return null;
    const name = expression.callee.name;
    if (!this.isComputedBinding(name)) return null;
    const type = this.inferExpression(expression.callee);
    // A derived value that *is* a function is called on purpose; only a
    // non-callable one makes the parentheses a mistake.
    const expanded = this.expandAliases(type);
    if (expanded.kind === "function" || expanded.kind === "intrinsic" || expanded.kind === "any" || isInvalidType(expanded)) return null;
    this.diagnostics.push({
      code: "VEL5063",
      message: `'${name}' is a computed value, not a reader: it is read bare like state, so write '${name}' rather than '${name}()'`,
      span: expression.span,
      fix: {
        title: `Read '${name}' bare`,
        edits: [{ span: { start: expression.callee.span.end, end: expression.span.end }, text: "" }],
      },
    });
    return type;
  }

  /**
   * D69 rule 178: a `watch` body that can never run is a block of statements
   * the compile silently drops — the same defect a bare `5` is already rejected
   * for (VEL4030), reached from a position the rule could not see.
   *
   * D90 R15(a) adds the third refusal and fixes the order the three are asked
   * in. A frozen subject is answered before the shape rule so that one shape
   * never draws two messages: a subject built only from frozen parts has no
   * reactive source at all, and telling its author to declare a `computed`
   * would only buy him a dead one. What survives both is either a path — the
   * name of a reactive binding, or a member/index read out of one — or a
   * computation, and a computation has a spelling of its own.
   *
   * The three refusals are separate because their causes are: a reader that was
   * not called names a value that never moves, a frozen value has no reactive
   * source behind it at all, and a computed subject has one but hides which.
   */
  private rejectFrozenWatchSubject(
    expression: Expression,
    watched: ValueType,
    currentName: string | null,
    previousName: string | null,
  ): boolean {
    const name = expression.kind === "IdentifierExpression" ? expression.name : null;
    if (name !== null && this.reactiveBindingKind(name) === null && this.zeroArgumentReader(watched)) {
      this.diagnostics.push(diagnostic(
        "VEL5064",
        `'${name}' is the reader itself, so watching it watches a value that never changes; declare the derived value — 'computed name = ${name}()' — then 'watch name:'`,
        expression.span,
      ));
      return false;
    }
    // ST-D1: the resource surface is answered ahead of the frozen rule, because it is a reactive value whose *own* handle never moves.
    if (name !== null && this.isResourceBinding(name)) {
      this.diagnostics.push(diagnostic("VEL5064", watchedResourceSurfaceRefusal(name), expression.span));
      return false;
    }
    if (this.frozenWatchSubject(expression)) {
      this.diagnostics.push(diagnostic(
        "VEL5064",
        `This watch subject never changes, so its body can never run${name === null ? "" : ` — '${name}' is not a reactive source`}; watch a 'state', a 'computed', a prop, or a resource field, or move these statements to where they should run`,
        expression.span,
      ));
      return false;
    }
    if (watchSubjectPath(expression)) return true;
    // D69's own shape, `watch total()`, is a called `computed`, and VEL5063 has
    // already named it with the one-character edit that makes this subject
    // legal. Stacking the shape rule on top would report one mistake twice and
    // would hand the author 'computed value = total()' — a line that reports
    // VEL5063 in its turn. The same reason the frozen rule is asked first.
    if (this.diagnostics.some((item) => item.code === "VEL5063"
      && item.span.start === expression.span.start && item.span.end === expression.span.end)) return false;
    const derived = currentName ?? "value";
    const watchLine = currentName === null
      ? `watch ${derived}:`
      : `watch ${derived} as current${previousName === null ? "" : `, ${previousName}`}:`;
    const rendered = renderWatchSubject(expression);
    this.diagnostics.push(diagnostic(
      "VEL5071",
      rendered === null
        ? `A watch subject names what to watch, not what to compute. Declare the value — 'computed ${derived} = ...' — then '${watchLine}'`
        : `A watch subject names what to watch, not what to compute: '${rendered}' computes a value. Declare it — 'computed ${derived} = ${rendered}' — then '${watchLine}'`,
      expression.span,
    ));
    return false;
  }

  /**
   * D114 W: the three watch shapes a compile can prove re-trigger the watch
   * itself. D90 R21 removed the analysis of *who writes what* across calls, and
   * nothing here brings it back: two watches writing one state are still an
   * ordinary program, a write reached through an ordinary helper is still
   * silent, and a write under `if`, `match`, a loop, `try`, a nested `def` or an
   * arrow is still the author's converging correction to make.
   *
   * What is refused is only what is decided at the top of the body, with no
   * condition to end it:
   *
   *  - **B** the body writes the watched place itself (`watch count: count =
   *    count + 1`), assignment, compound assignment, or a mutating collection
   *    call on the watched collection;
   *  - **A2(a)** the subject is a `resource` field and the body reloads that
   *    same resource — a reload writes exactly those fields, so every completed
   *    load re-triggers the watch;
   *  - **A2(b)** the body starts an `action` or an `async def` of this module
   *    whose own top level writes the watched place. One hop, one module, no
   *    condition on either end; anything further is the runtime budget's.
   *
   * One diagnostic per watch, at the first statement that earns it. A watch with
   * two of these has two mistakes, and the second is read after the first is
   * fixed, exactly as two errors on one line are.
   */
  private rejectWatchCycle(subject: Expression, watched: ValueType, body: readonly Statement[]): void {
    const root = reactivePathRoot(subject);
    if (root === null) return;
    const place = reactivePathOf(subject);
    const writes = (steps: readonly ReactivePathStep[], method: string | null): boolean =>
      this.watchSubjectWrite(watched, steps, method);
    // A resource publishes `value`, `loading`, `ready` and `error`, and
    // `reload` is the one member of the five that is not one of them. Asking it
    // that way keeps `analyzeResourceDeclaration`'s field map the only roster:
    // a field added there is a field this recognises, with nothing to update.
    const resource = subject.kind === "MemberExpression" && !subject.optional
      && subject.object.kind === "IdentifierExpression" && subject.property !== "reload"
      && this.isResourceBinding(subject.object.name)
      ? subject.object.name
      : null;
    for (const statement of body) {
      if (statementBindsName(statement, root)) return;
      const selfWrite = place === null ? null : watchSelfWrite(subject, place, statement, writes);
      if (selfWrite !== null) {
        this.diagnostics.push(diagnostic("VEL5077", selfWrite, statement.span));
        return;
      }
      const inFinally = place === null ? null : finallySelfWrite(subject, place, statement, writes, root);
      if (inFinally !== null) {
        this.diagnostics.push(diagnostic("VEL5077", inFinally.message, inFinally.span));
        return;
      }
      const hop = watchDerivedSourceWrite(subject, statement, this.reactiveDerivations, this.reactiveStateNames, (name) => this.reactiveBindingKind(name) === "state");
      if (hop !== null) {
        this.diagnostics.push(diagnostic("VEL5077", hop, statement.span));
        return;
      }
      const call = topLevelCall(statement);
      if (call === null) continue;
      if (resource !== null && call.callee.kind === "MemberExpression" && !call.callee.optional
        && call.callee.property === "reload" && call.callee.object.kind === "IdentifierExpression"
        && call.callee.object.name === resource) {
        this.diagnostics.push(diagnostic(
          "VEL5078",
          `This watch reloads '${resource}' — the resource it watches — so every completed load re-triggers it; watch the input the load reads instead, as 'watch userId:' with 'detach ${resource}.reload()' in its body`,
          call.span,
        ));
        return;
      }
      if (place === null || call.callee.kind !== "IdentifierExpression") continue;
      const writer = this.reactiveWriters.get(call.callee.name) ?? null;
      const written = writer === null ? null : writerWritesPath(writer, place, writes);
      if (written === null) continue;
      // D114 0.28.0 H-D1's other half, in the message family F1 gave VEL5077:
      // a writer that reaches a *part* of the subject names the part it wrote
      // and the subject it belongs to, because those are two different places
      // and the author has to find the one the helper touches.
      const reached = written.text === place.text
        ? `'${place.text}' — the reactive value this watch is on`
        : `'${written.text}', a part of its subject '${place.text}'`;
      this.diagnostics.push(diagnostic(
        "VEL5079",
        `This watch starts '${call.callee.name}', which writes ${reached} — so each completed run re-triggers the watch; make the write conditional, or watch the input '${call.callee.name}' reads`,
        call.span,
      ));
      return;
    }
  }

  /**
   * D114 0.28.0 H-D1: the type of the place `steps` below the watched subject,
   * or null when the walk cannot reach one.
   *
   * Only the steps the reactive graph publishes as part of the subject are
   * walked — a record field and a collection element — because those are the
   * writes a watch on the containing value is woken by. A step that leaves them
   * (a class instance, a capability handle, a field the record does not declare)
   * is not provably part of the subject, and a refusal that must be right every
   * time answers no there rather than guessing.
   */
  /**
   * Whether a write `steps` below the watched subject, made the given way, is a
   * write of the subject — the one definition both the body scan (VEL5077) and
   * the one-hop writer scan (VEL5079) read. An assignment to a place the walk
   * can reach is a write; a call is one only when the type at that depth is a
   * collection and the call is on its own mutating roster.
   */
  private watchSubjectWrite(watched: ValueType, steps: readonly ReactivePathStep[], method: string | null): boolean {
    const written = this.reactivePlaceType(watched, steps);
    if (written === null) return false;
    if (method === null) return true;
    const mutating = collectionMutators(nonOptional(this.expandAliases(written)));
    return mutating !== null && mutating.has(method);
  }

  private reactivePlaceType(subject: ValueType, steps: readonly ReactivePathStep[]): ValueType | null {
    let current = subject;
    for (const step of steps) {
      const owner = nonOptional(this.expandAliases(current));
      const next = step.kind === "field"
        ? (owner.kind === "object" ? owner.fields.get(step.name) ?? null
          : owner.kind === "record" ? owner.value
            : owner.kind === "named" ? this.fieldsOf(owner.identity ?? owner.name)?.get(step.name) ?? null
              : null)
        : (owner.kind === "list" || owner.kind === "set" ? owner.element
          : owner.kind === "map" || owner.kind === "record" ? owner.value
            : null);
      if (next === null) return null;
      current = next;
    }
    return current;
  }

  /**
   * D89 A4: records `list = list.map(item => {…})`, React's immutable update,
   * where the callback builds a new record rather than changing a field.
   *
   * D90 R2 stands — `__velarKeyed` compares identity and that does not move,
   * and the framework does not accommodate the idiom. This channel is not the
   * framework taking responsibility; it is the compiler telling the author that
   * the row he is typing into is about to be destroyed. Nothing is reported
   * yet: the advisory is owed only if the rewritten list is what a keyed list
   * renders, and the render usually sits below the update.
   */
  private recordKeyedListRebuild(statement: Statement): void {
    if (statement.kind !== "AssignmentStatement" || statement.operator !== "=") return;
    if (statement.target.kind !== "IdentifierExpression") return;
    const value = statement.value;
    if (value.kind !== "CallExpression" || value.callee.kind !== "MemberExpression" || value.callee.property !== "map") return;
    // The map has to be over the list being replaced; `rows = source.map(...)`
    // builds a new list, and a new list has no identity to preserve.
    if (value.callee.object.kind !== "IdentifierExpression" || value.callee.object.name !== statement.target.name) return;
    const callback = value.arguments[0];
    if (!callback || callback.kind !== "ArrowFunctionExpression") return;
    const [row] = callback.parameters;
    if (!row || callback.parameters.length !== 1) return;
    const rebuilt = keyedRebuiltRecord(callback.body, row.name);
    if (!rebuilt) return;
    const binding = this.lookup(statement.target.name);
    if (!binding) return;
    this.keyedListRebuilds.push({
      kind: "assignment",
      source: spanIdentity(binding.span),
      name: statement.target.name,
      field: rebuilt.field,
      span: statement.span,
    });
  }

  /**
   * D89 A4, the wider proven shape: the same churn written as a derived value.
   * `computed rows = source.map(item => {…})` and `computed rows = build(...)`
   * over a `for`/`append` builder both hand a keyed position a fresh record for
   * every row on every recompute, which is exactly what the assignment shape
   * does — the reconciliation wave compiled both and found only one of them
   * named. It is one advisory with a wider proof, not a second code: the defect,
   * the consequence, and the suppression are the same.
   *
   * A `const` in a component body is deliberately not here. It is constructed
   * once, so its records never move, and advising it would be a guess rather
   * than a proof.
   */
  private recordDerivedKeyedListRebuild(statement: ComputedDeclaration): void {
    if (!this.rebuildsRecordsPerElement(statement.initializer)) return;
    this.keyedListRebuilds.push({
      kind: "derived",
      source: spanIdentity(statement.span),
      name: statement.name,
      field: null,
      span: statement.span,
    });
  }

  /**
   * Whether a derived initializer constructs one fresh record per source
   * element. Two spellings are proven and everything else is silent: a `map`
   * whose callback answers a record literal — the same recognizer the
   * assignment shape uses — and a call to a `def` this module declares whose
   * whole answer is a list it filled with record literals.
   */
  private rebuildsRecordsPerElement(value: Expression): boolean {
    if (value.kind !== "CallExpression") return false;
    if (value.callee.kind === "MemberExpression" && value.callee.property === "map") {
      const callback = value.arguments[0];
      if (!callback || callback.kind !== "ArrowFunctionExpression" || callback.parameters.length !== 1) return false;
      const [row] = callback.parameters;
      return row !== undefined && keyedRebuiltRecord(callback.body, row.name) !== null;
    }
    if (value.callee.kind !== "IdentifierExpression") return false;
    const declaration = this.moduleFunctions.get(value.callee.name);
    return declaration !== undefined && declaration !== null && buildsFreshRecords(declaration);
  }

  /**
   * D89 A4: raises the advisory for the rebuilds whose list a keyed position
   * really renders. The advisory channel cannot reach `this.diagnostics`, so
   * nothing here fails a build, changes an emitted byte, or moves a semantic
   * rule; `// velar-allow A4: <reason>` suppresses it where building the rows is
   * the only spelling, which a `readonly` list or one API response makes it.
   */
  private adviseKeyedListRebuilds(): void {
    for (const rebuild of this.keyedListRebuilds) {
      if (!this.keyedListSources.has(rebuild.source)) continue;
      // The keys do not move; the rows do. `__velarKeyed` finds the entry under
      // the same key and then drops it because the row it holds is no longer
      // the same value, so a message blaming the key sends an author to check
      // `id`, find it unchanged, and conclude the advisory is wrong.
      // A derived value has no row to write: whatever it hands the keyed
      // position it built itself. The two ways out are to render the rows that
      // do have an identity, or to carry those same records through.
      const remedy = rebuild.kind === "derived"
        ? "A derived value cannot keep rows it builds: render the source rows and change the field on them in place, or carry the source records through instead of constructing new ones."
        : `Change the field in place instead: '${rebuild.name}[index].${rebuild.field ?? "<field>"} = ...'`;
      this.advise(
        "A4",
        `This rebuilds every row of '${rebuild.name}'${rebuild.kind === "derived" ? " on every recompute" : ""}, so every row is a new value and the keyed list that renders '${rebuild.name}' no longer recognises any of them: it destroys and rebuilds all of its children — an input being typed into loses focus. ${remedy}`,
        rebuild.span,
      );
    }
  }

  /** A value that is read by calling it and takes no arguments to do so. */
  private zeroArgumentReader(type: ValueType): boolean {
    const expanded = this.expandAliases(type);
    return (expanded.kind === "function" || expanded.kind === "intrinsic") && expanded.requiredParameters === 0;
  }

  /**
   * True only for subjects built entirely from values the compile can see are
   * frozen: literals, and non-reactive bindings whose type is a primitive, so no
   * deep-reactive object can be hiding behind the name. Every member access,
   * index, and call is excluded on purpose — `alias.done` on a const bound to a
   * reactive element does track, and a call can read anything.
   */
  private frozenWatchSubject(expression: Expression): boolean {
    switch (expression.kind) {
      case "LiteralExpression":
        return true;
      case "FStringExpression":
        return expression.parts.every((part) => part.kind === "text" || this.frozenWatchSubject(part.value));
      case "IdentifierExpression":
        return this.reactiveBindingKind(expression.name) === null
          && !this.derivedReactiveNames.has(expression.name)
          && this.frozenValueType(this.lookup(expression.name)?.type ?? unknownType);
      case "UnaryExpression":
        return expression.operator !== "await" && this.frozenWatchSubject(expression.operand);
      case "BinaryExpression":
        return this.frozenWatchSubject(expression.left) && this.frozenWatchSubject(expression.right);
      case "ComparisonChainExpression":
        return expression.operands.every((operand) => this.frozenWatchSubject(operand));
      case "ConditionalExpression":
        return this.frozenWatchSubject(expression.condition) && this.frozenWatchSubject(expression.thenValue)
          && this.frozenWatchSubject(expression.elseValue);
      case "IsExpression":
        return this.frozenWatchSubject(expression.value);
      default:
        return false;
    }
  }

  /** A primitive holds no reactive identity, so a non-reactive binding of one is a snapshot. */
  private frozenValueType(type: ValueType): boolean {
    const expanded = this.expandAliases(type);
    if (expanded.kind === "optional") return this.frozenValueType(expanded.inner);
    if (expanded.kind === "union") return expanded.members.every((member) => this.frozenValueType(member));
    return expanded.kind === "number" || expanded.kind === "string" || expanded.kind === "bool"
      || expanded.kind === "null" || expanded.kind === "enum";
  }

  /**
   * D71 rule 182: a derived value has no writable location behind it, so the
   * const message ("cannot assign to const binding") would name the wrong
   * reason. Answering here means the reader is told what a derived value is and
   * which spelling holds a value that is written.
   */
  private rejectComputedAssignment(statement: Extract<Statement, { readonly kind: "AssignmentStatement" }>): boolean {
    if (statement.target.kind !== "IdentifierExpression") return false;
    const name = statement.target.name;
    if (!this.isComputedBinding(name)) return false;
    this.diagnostics.push(diagnostic(
      "VEL5063",
      this.isImportedComputedBinding(name)
        ? `'${name}' is a computed value derived in the module it comes from, so it has no location here to assign. Export a 'state' — or an action that writes one — and change that instead`
        : `'${name}' is a computed value: it is recomputed from what it reads and is never assigned. Assign the state it reads, or declare it 'state ${name} = ...' if this value is written directly`,
      statement.target.span,
    ));
    this.inferExpression(statement.value);
    return true;
  }

  /**
   * D71 rule 183: `computed(...)` the function — the shape Vue and the signals
   * libraries teach — is not how a derived value is written here; the `computed`
   * declaration is. The declaration is recorded before the core walks the module
   * so its reads can be matched against it — the rewrite that removes the call
   * parentheses is only offered when every read is a plain `x()`.
   */
  private recordRetiredAccessorDeclaration(statement: Extract<Statement, { readonly kind: "VariableDeclaration" }>): void {
    const initializer = statement.initializer;
    if (initializer.kind !== "CallExpression" || initializer.callee.kind !== "IdentifierExpression"
      || !isRetiredAccessorName(initializer.callee.name) || this.lookup(initializer.callee.name) !== null) return;
    if (statement.binding !== "const" || statement.pattern.kind !== "NameBindingPattern") return;
    const read = initializer.arguments.length === 1 && initializer.argumentNames === undefined
      ? initializer.arguments[0]! : null;
    // Only the `() => E` shape has a body that becomes the declaration's
    // initializer verbatim. Every other argument — a named function, a partial
    // application — would need the rewriter to invent an expression, so it is
    // left to the author with the call spelled out as its only mechanical answer.
    const body = read?.kind === "ArrowFunctionExpression" && !read.asynchronous && read.parameters.length === 0
      ? read.body : null;
    this.retiredAccessorDeclarations.set(spanIdentity(statement.pattern.span), {
      name: statement.pattern.name,
      exported: statement.exported,
      readName: read?.kind === "IdentifierExpression" ? read.name : null,
      declarationSpan: statement.span,
      callSpan: initializer.span,
      bodySpan: body ? body.span : null,
    });
    this.migratedComputedCallees.add(spanIdentity(initializer.callee.span));
  }

  /** Returns true when the name is one of the retired accessor globals this pass owns. */
  private recordRetiredAccessorRead(expression: Extract<Expression, { readonly kind: "IdentifierExpression" }>): boolean {
    if (isRetiredAccessorName(expression.name)) {
      if (this.lookup(expression.name) !== null) return false;
      if (!this.migratedComputedCallees.has(spanIdentity(expression.span))) {
        this.retiredComputedReferences.set(spanIdentity(expression.span), { name: expression.name, span: expression.span });
      }
      return true;
    }
    const binding = this.lookup(expression.name);
    if (!binding) return false;
    const key = spanIdentity(binding.span);
    if (!this.retiredAccessorDeclarations.has(key)) return false;
    const reads = this.retiredAccessorReads.get(key);
    if (reads) reads.push(expression.span);
    else this.retiredAccessorReads.set(key, [expression.span]);
    return false;
  }

  /**
   * D71 migration: one message per site, and a mechanical rewrite only where
   * the compile can prove the rewrite. Where the
   * accessor is used as a value there is no second spelling left to offer, so
   * that site is told to declare the value and write an ordinary `def` where a
   * callable is what the caller wants — and it gets no edit, because moving a
   * reader out of a value position is the author's decision.
   */
  private reportRetiredComputedFunction(): void {
    for (const [key, accessor] of this.retiredAccessorDeclarations) {
      const reads = this.retiredAccessorReads.get(key) ?? [];
      const calls = reads.map((span) => this.plainCallSpans.get(spanIdentity(span)) ?? null);
      const rewritable = accessor.bodySpan !== null && calls.every((call) => call !== null);
      const edits = rewritable
        ? [
          { span: { start: accessor.declarationSpan.start, end: accessor.bodySpan!.start }, text: `${accessor.exported ? "export " : ""}computed ${accessor.name} = ` },
          { span: { start: accessor.bodySpan!.end, end: accessor.callSpan.end }, text: "" },
          ...reads.map((span, index) => ({ span: { start: span.end, end: calls[index]!.end }, text: "" })),
        ]
        : null;
      const alternative = accessor.bodySpan === null
        ? ` Where the argument is a function rather than an expression, write the call — 'computed ${accessor.name} = ${accessor.readName ?? "read"}()'`
        : ` Where the reader itself is passed on rather than read here, declare the value — 'computed ${accessor.name} = ...' — and write an ordinary 'def' where a callable is required`;
      this.diagnostics.push({
        code: "VEL5055",
        message: `A derived value is declared, not called: write 'computed ${accessor.name} = ...' and read '${accessor.name}' bare.${rewritable ? "" : alternative}`,
        span: accessor.declarationSpan,
        ...(edits ? { fix: { title: `Declare '${accessor.name}' with computed`, edits } } : {}),
      });
    }
    // There is no `fix`: the rewrite is a declaration, not a rename, and the
    // declaration form is offered above where the compile can see the whole
    // shape.
    for (const reference of this.retiredComputedReferences.values()) {
      this.diagnostics.push(diagnostic(
        "VEL5055",
        "'computed' declares a derived value — 'computed name = expression'. There is no function form, and 'computed' already caches",
        reference.span,
      ));
    }
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
    if (!isWebComponentType(callee)) return undefined;
    this.typeError(componentCallRefusal(webComponentName(callee), arguments_, argumentNames, this.webSourceText), callSpan);
    for (const argument of arguments_) this.inferExpression(argument);
    return webNodeType;
  }

  protected override validateExtensionTypeSyntax(
    syntax: import("@velarscript/compiler/extension").TypeSyntax,
    validate: (syntax: import("@velarscript/compiler/extension").TypeSyntax) => boolean,
    resolve: (reference: TypeReference) => ValueType,
  ): boolean | undefined {
    if (syntax.kind !== "GenericTypeSyntax" || syntax.name !== "Component") return undefined;
    let valid = true;
    if (syntax.arguments.length < 1 || syntax.arguments.length > 2) {
      this.typeError("Component<Props, Handle> requires a named prop signature and at most one Handle type", syntax.span);
      valid = false;
    }
    const argumentsValid = syntax.arguments.map(validate).every(Boolean);
    const signature = syntax.arguments[0];
    if (!signature) return false;
    if (signature.kind !== "FunctionTypeSyntax") {
      this.typeError("Component<Props, Handle> requires a named function signature such as Component<(title: string) -> WebNode, DialogHandle>", signature.span);
      valid = false;
    } else {
      const names = new Set<string>();
      for (const parameter of signature.parameters) {
        if (!parameter.name) {
          this.typeError("Every Component signature prop requires a name", parameter.span);
          valid = false;
        } else if (names.has(parameter.name)) {
          this.typeError(`Component signature prop '${parameter.name}' is declared more than once`, parameter.span);
          valid = false;
        } else names.add(parameter.name);
        if (parameter.rest) {
          this.typeError("Component signatures use named props and cannot declare a rest parameter", parameter.span);
          valid = false;
        }
      }
      const result = resolve({ syntax: signature.result, span: signature.result.span });
      if (!isWebNodeType(result)) {
        this.typeError(`A Component signature must return WebNode, received ${describeType(result)}`, signature.result.span);
        valid = false;
      }
    }
    const handleSyntax = syntax.arguments[1];
    if (handleSyntax && argumentsValid) {
      const handle = this.expandAliases(resolve({ syntax: handleSyntax, span: handleSyntax.span }));
      const fields = handle.kind === "object"
        ? handle.fields
        : handle.kind === "named" ? this.fieldsOf(handle.identity ?? handle.name) : null;
      if (!fields) {
        this.typeError(`A Component Handle must be a concrete record type, received ${describeType(handle)}`, handleSyntax.span);
        valid = false;
      }
    }
    return valid && argumentsValid;
  }

  /**
   * D43 item 69: a component body is a construction section, not a scope with
   * an exit — its resources live until unmount. Ownership belongs to the
   * lifecycle hook or to a function inside the component, so the setup section
   * says so instead of releasing at the wrong moment.
   */
  protected override ownershipScopeRejection(): string | null {
    if (this.componentStates !== null && this.mountedDepth === 0 && this.cleanupDepth === 0 && this.watchBodyDepth === 0
      && this.inComponentSetupPosition()) {
      return "A component body builds the component and does not end, so a 'using' here has no scope to release at; own the resource inside an action, a method, or the cleanup hook";
    }
    return super.ownershipScopeRejection();
  }

  /**
   * D114 0.29.0 JX-I2: a component body has no function frame, so a `return` nested
   * inside it — in a `match` arm, an `if`, a `for` — used to earn VEL3003 next to
   * VEL5008 ("exactly one top-level return"), two rules its author can only read as
   * contradicting each other. A lifecycle hook and a watch body are inside the same
   * component and are *not* it: neither returns anything, so a `return` there keeps
   * VEL3003.
   */
  protected override extensionOwnsFunctionlessReturn(): boolean {
    return this.componentBodyDepth > 0 && this.mountedDepth === 0 && this.cleanupDepth === 0 && this.watchBodyDepth === 0;
  }

  protected override invalidExtensionAwaitContext(): boolean {
    return this.synchronousReactiveDepth > 0 || this.jsxDepth > 0
      || (this.componentStates !== null && this.mountedDepth === 0);
  }

  protected override invalidExtensionAwaitMessage(): string | null {
    if (this.jsxDepth > 0) return "JSX rendering is synchronous; load async component data with a resource or await before constructing JSX";
    if (this.synchronousReactiveDepth > 0) return "Computed callbacks and watch blocks are synchronous; use resource, action, or mounted for async work";
    return "Component setup and cleanup are synchronous; use resource, action, or mounted for async work";
  }

  private componentType(statement: ComponentDeclaration): ValueType {
    const props = new Map(statement.parameters.map((parameter) => [parameter.name, this.resolveValidatedAnnotation(parameter.type)]));
    if (!props.has("class")) props.set("class", optionalOf(stringType));
    if (!props.has("look")) props.set("look", optionalOf({ kind: "named", name: "Look" }));
    return webComponentConstructor(
      statement.name,
      props,
      new Set(statement.parameters.filter((parameter) => !parameter.defaultValue).map((parameter) => parameter.name)),
      statement.handleType ? this.resolveValidatedAnnotation(statement.handleType) : null,
    );
  }

  private analyzeResourceDeclaration(statement: ResourceDeclaration): void {
    const annotated = statement.type ? this.resolveAnnotation(statement.type) : null;
    const annotationValid = statement.type ? this.validateTypeReference(statement.type) : true;
    const annotationContext = statement.type ? this.resolveValidatedAnnotation(statement.type) : null;
    const expected: ValueType = annotationContext ? { kind: "promise", value: annotationContext } : unknownType;
    const actual = this.inferExpression(statement.initializer, expected);
    let value = annotationContext ?? unknownType;
    if (actual.kind === "promise") {
      if (annotated && annotationValid) this.requireAssignable(actual.value, annotated, statement.initializer.span);
      else if (!statement.type) value = actual.value;
    } else if (actual.kind === "any") {
      value = annotationContext ?? anyType;
    } else if (!isInvalidType(actual)) {
      this.diagnostics.push(diagnostic("VEL4016", `A resource initializer must return Promise<T>, received ${describeType(actual)}`, statement.initializer.span));
    }
    const fields = new Map<string, ValueType>([
      ["value", value.kind === "null" ? nullType : optionalOf(value)],
      ["loading", boolType],
      ["ready", boolType],
      ["error", optionalOf({ kind: "class", name: "Error" })],
      ["reload", { kind: "function", parameters: [], requiredParameters: 0, result: { kind: "promise", value: nullType } }],
    ]);
    this.declareBinding(statement.name, false, { kind: "object", fields }, statement.span);
    this.resourceBindingSpans.add(spanIdentity(statement.span));
  }

  private actionType(statement: ActionDeclaration): ValueType {
    const declaredResult = this.resolvedAsyncResult(this.inferredFunctionResult(statement));
    const rest = statement.parameters.find((parameter) => parameter.rest);
    return {
      kind: "action",
      parameters: statement.parameters.filter((parameter) => !parameter.rest).map((parameter) => this.resolveValidatedAnnotation(parameter.type)),
      parameterNames: statement.parameters.filter((parameter) => !parameter.rest).map((parameter) => parameter.name),
      requiredParameters: statement.parameters.filter((parameter) => !parameter.rest && !parameter.defaultValue).length,
      ...(rest ? { rest: this.resolveValidatedAnnotation(rest.type) } : {}),
      result: { kind: "promise", value: declaredResult },
    };
  }

  private analyzeActionDeclaration(statement: ActionDeclaration): void {
    this.declareBinding(statement.name, false, this.actionType(statement), statement.span);
    this.analyzeFunctionDeclaration(statement, null, true, false, true, "Action");
  }

  private analyzeComponent(statement: ComponentDeclaration): void {
    const outerConstructorDepth = this.constructorDepth;
    if (!this.isPredeclared(statement)) this.declareBinding(statement.name, false, this.componentType(statement), statement.span);
    // VEL5075: a `def` written from here to the matching decrement lowers
    // through this component's scope, so its component elements are children.
    this.componentBodyDepth += 1;
    this.enterScope();
    this.flowFrameDepth += 1;
    const previousStates = this.componentStates;
    this.componentStates = new Set(statement.body.filter((item) => item.kind === "ExtensionStatement:web:state").map((item) => item.name));
    const previousExplicitReadonlyProps = this.explicitReadonlyPropBindings;
    const explicitReadonlyProps = new Map<string, number>();
    // Component items are analyzed one by one rather than through
    // analyzeStatements, so the shadow prescan runs here — before the
    // parameters, whose defaults are emitted as closures inside the component
    // body where a later item's shadow would capture them.
    this.prescanScopeDeclarations(statement.body.filter((item) =>
      item.kind !== "ExtensionStatement:web:mounted" && item.kind !== "ExtensionStatement:web:cleanup" && item.kind !== "ExtensionStatement:web:expose") as readonly Statement[]);
    for (const parameter of statement.parameters) {
      const type = this.resolveAnnotation(parameter.type);
      const valid = parameter.type ? this.validateTypeReference(parameter.type) : true;
      if (parameter.defaultValue && valid) this.requireAssignable(this.inferParameterDefault(parameter.defaultValue, type), type, parameter.defaultValue.span);
      const declared = valid ? type : this.resolveValidatedAnnotation(parameter.type);
      this.declareBinding(parameter.name, false, declared, parameter.span);
      if (valid && this.containsReadonlyView(declared)) explicitReadonlyProps.set(parameter.name, parameter.span.start);
      this.markDeclaredBindingReactive(parameter.name, "prop");
      if (parameter.name === "ref") this.diagnostics.push(diagnostic("VEL5056", "'ref' is a compiler-owned JSX directive and cannot be declared as a component prop", parameter.span));
    }
    this.explicitReadonlyPropBindings = explicitReadonlyProps;
    const handleType = statement.handleType ? this.resolveAnnotation(statement.handleType) : null;
    const handleTypeValid = statement.handleType ? this.validateTypeReference(statement.handleType) : true;
    if (handleType && handleTypeValid) this.validateComponentHandleType(handleType, statement.handleType!.span);
    this.constructorDepth = 0;
    let renders = 0;
    let renderValue: Expression | null = null;
    let mounted = 0;
    let cleanup = 0;
    let exposes = 0;
    for (const item of statement.body) {
      if (item.kind === "ExtensionStatement:web:state") {
        const annotationValid = item.type ? this.validateTypeReference(item.type) : true;
        const annotationContext = item.type ? this.resolveValidatedAnnotation(item.type) : null;
        const actual = this.inferExpression(item.initializer, annotationContext ?? unknownType);
        const declared = annotationContext ?? actual;
        if (annotationValid) this.requireAssignable(actual, declared, item.initializer.span);
        this.requireSettledCollectionElement(item.initializer, declared, annotationContext !== null);
        this.declareBinding(item.name, true, declared, item.span);
        this.markDeclaredBindingReactive(item.name, "state");
      } else if (item.kind === "ExtensionStatement:web:computed") {
        this.flowFrameDepth += 1;
        this.analyzeComputedDeclaration(item);
        this.flowFrameDepth -= 1;
      } else if (item.kind === "ExtensionStatement:web:resource") {
        this.flowFrameDepth += 1;
        this.analyzeResourceDeclaration(item);
        this.flowFrameDepth -= 1;
      } else if (item.kind === "ExtensionStatement:web:action") {
        this.analyzeActionDeclaration(item);
      } else if (item.kind === "ExtensionStatement:web:watch") {
        this.flowFrameDepth += 1;
        this.synchronousReactiveDepth += 1;
        const watched = this.inferExpression(item.expression);
        if (this.rejectFrozenWatchSubject(item.expression, watched, item.currentName, item.previousName)) {
          this.rejectWatchCycle(item.expression, watched, item.body);
        }
        this.enterScope();
        if (item.currentName) this.declareBinding(item.currentName, false, watched, item.span);
        if (item.previousName) this.declareBinding(item.previousName, false, watched, item.span);
        this.watchBodyDepth += 1;
        this.analyzeStatements(item.body);
        this.watchBodyDepth -= 1;
        this.exitScope();
        this.synchronousReactiveDepth -= 1;
        this.flowFrameDepth -= 1;
      } else if (item.kind === "ExtensionStatement:web:expose") {
        exposes += 1;
        this.flowFrameDepth += 1;
        const actual = this.inferExpression(item.value, handleType ?? unknownType);
        this.flowFrameDepth -= 1;
        if (!handleType) this.diagnostics.push(diagnostic("VEL5056", `Component '${statement.name}' uses 'expose' without declaring 'exposes HandleType'`, item.span));
        else if (handleTypeValid) this.requireAssignable(actual, handleType, item.value.span);
      } else if (item.kind === "ExtensionStatement:web:mounted") {
        mounted += 1;
        this.mountedDepth += 1;
        this.flowFrameDepth += 1;
        this.analyzeBlock(item.body);
        this.flowFrameDepth -= 1;
        this.mountedDepth -= 1;
      } else if (item.kind === "ExtensionStatement:web:cleanup") {
        cleanup += 1;
        // D51 (audit 12): a cleanup hook runs once and ends, so it is an
        // ordinary scope with an exit. It used to be counted as component
        // setup, and the rejection then named `@cleanup` as its own fix.
        this.cleanupDepth += 1;
        this.flowFrameDepth += 1;
        this.analyzeBlock(item.body);
        this.flowFrameDepth -= 1;
        this.cleanupDepth -= 1;
      } else if (item.kind === "ReturnStatement") {
        renders += 1;
        renderValue = item.value;
        this.flowFrameDepth += 1;
        const rendered = item.value ? this.inferExpression(item.value) : nullType;
        this.flowFrameDepth -= 1;
        // WEB-U15: `return null` is the React habit for "render nothing". A
        // component always has one root, so the decision belongs to the caller.
        if (rendered.kind === "null") {
          this.typeError("A component always returns one JSX root; decide at the call site with '{show ? <Card /> : null}', or return an empty element such as <span />", item.span);
        } else if (!isWebNodeType(rendered) && rendered.kind !== "any") this.typeError("A component must return JSX", item.span);
      } else {
        this.analyzeStatement(item);
      }
    }
    this.diagnostics.push(...componentSectionCountDiagnostics(statement.name, { renders, mounted, cleanup, exposes }, statement.span, statement.handleType?.span ?? null));
    if (renderValue && isWebJsx(renderValue)) this.validateComponentHost(renderValue, statement);
    this.componentStates = previousStates;
    this.explicitReadonlyPropBindings = previousExplicitReadonlyProps;
    this.flowFrameDepth -= 1;
    this.exitScope();
    this.componentBodyDepth -= 1;
    this.constructorDepth = outerConstructorDepth;
  }

  private containsReadonlyView(type: ValueType): boolean {
    const resolved = this.expandAliases(type);
    if (resolved.kind === "optional") return this.containsReadonlyView(resolved.inner);
    if (resolved.kind === "union") return resolved.members.some((member) => this.containsReadonlyView(member));
    return isReadonlyView(resolved);
  }

  private validateComponentHandleType(type: ValueType, sourceSpan: Span): void {
    const expanded = this.expandAliases(type);
    const fields = expanded.kind === "object"
      ? expanded.fields
      : expanded.kind === "named" ? this.fieldsOf(expanded.identity ?? expanded.name) : null;
    if (!fields) this.diagnostics.push(diagnostic("VEL5056", `A component Handle must be a concrete record type, received ${describeType(type)}`, sourceSpan));
  }

  protected override resolveAnnotation(reference: TypeReference | null): ValueType {
    return this.normalizeComponentContracts(super.resolveAnnotation(reference));
  }

  private normalizeComponentContracts(type: ValueType): ValueType {
    if (type.kind === "optional") return optionalOf(this.normalizeComponentContracts(type.inner));
    if (type.kind === "list" || type.kind === "set") return { ...type, element: this.normalizeComponentContracts(type.element) };
    if (type.kind === "map") return { ...type, key: this.normalizeComponentContracts(type.key), value: this.normalizeComponentContracts(type.value) };
    if (type.kind === "record") return { ...type, value: this.normalizeComponentContracts(type.value) };
    if (type.kind === "promise" || type.kind === "runtimeType") return { ...type, value: this.normalizeComponentContracts(type.value) };
    if (type.kind === "object") return { ...type, fields: new Map([...type.fields].map(([name, value]) => [name, this.normalizeComponentContracts(value)])) };
    if (type.kind === "function" || type.kind === "action" || type.kind === "intrinsic") return {
      ...type,
      parameters: type.parameters.map((parameter) => this.normalizeComponentContracts(parameter)),
      ...(type.rest ? { rest: this.normalizeComponentContracts(type.rest) } : {}),
      result: this.normalizeComponentContracts(type.result),
    };
    if (type.kind === "union") return { kind: "union", members: type.members.map((member) => this.normalizeComponentContracts(member)) };
    if (!isWebComponentType(type)) return type;
    return normalizeWebComponentType(
      type,
      (value) => this.normalizeComponentContracts(value),
      (value) => this.normalizeComponentContracts(value),
    );
  }

  private validateComponentHost(render: JSXElementExpression, component: ComponentDeclaration): void {
    const hosts: JSXAttribute[] = [];
    const visit = (element: JSXElementExpression): void => {
      if (!/^[A-Z]/u.test(element.tag)) {
        for (const attribute of element.attributes) if (attribute.name === "host") hosts.push(attribute);
      }
      for (const child of element.children) if (child.kind === "ExtensionExpression:web:jsx") visit(child);
    };
    visit(render);
    if (hosts.length > 1) this.diagnostics.push(diagnostic("VEL5043", `Component '${component.name}' declares more than one host element`, hosts[1]!.span));
    for (const host of hosts) if (host.value !== null) this.diagnostics.push(diagnostic("VEL5043", "The host directive is a valueless marker", host.span));
    const directNativeRoot = render.tag !== "" && !/^[A-Z]/u.test(render.tag);
    const delegatedComponentRoot = /^[A-Z]/u.test(render.tag);
    if (!directNativeRoot && !delegatedComponentRoot && hosts.length === 0) {
      this.diagnostics.push(diagnostic("VEL5043", `Component '${component.name}' has multiple roots and must mark exactly one native element with 'host'`, render.span));
    }
  }

  /**
   * True when a name both belongs to a derived reactive declaration and still
   * resolves to one here: a computed accessor is a zero-argument function, and a
   * resource or action handle is a record with its reactive fields. An ordinary
   * binding that happens to share the name — a function parameter, a local — is
   * not a reactive read.
   */
  private derivedReactiveRead(name: string): boolean {
    if (!this.derivedReactiveNames.has(name)) return false;
    const binding = this.lookup(name);
    if (!binding) return false;
    const type = this.expandAliases(binding.type);
    if (type.kind === "function" || type.kind === "action") return type.parameters.length === 0 && !type.rest;
    return type.kind === "object" && (type.fields.has("reload") || type.fields.has("pending"));
  }

  private isLookInput(type: ValueType): boolean {
    if (type.kind === "any" || type.kind === "null") return true;
    if (type.kind === "named") return type.name === "Look";
    if (type.kind === "optional") return this.isLookInput(type.inner);
    if (type.kind === "list") return this.isLookInput(type.element);
    if (type.kind === "union") return type.members.every((member) => this.isLookInput(member));
    return false;
  }

  private isClassInput(type: ValueType): boolean {
    if (type.kind === "any" || type.kind === "null" || type.kind === "string") return true;
    if (type.kind === "optional") return this.isClassInput(type.inner);
    if (type.kind === "list") return this.isClassInput(type.element);
    if (type.kind === "union") return type.members.every((member) => this.isClassInput(member));
    return false;
  }

  private isJsxRenderable(type: ValueType): boolean {
    const expanded = this.expandAliases(type);
    if (expanded.kind === "any" || expanded.kind === "null" || expanded.kind === "string" || expanded.kind === "number"
      || expanded.kind === "bool" || expanded.kind === "enum" || expanded.kind === "enumMember" || isWebNodeType(expanded)) return true;
    if (expanded.kind === "named") return textualWebPrimitiveNames.has(expanded.name);
    if (expanded.kind === "optional") return this.isJsxRenderable(expanded.inner);
    if (expanded.kind === "list") return this.isJsxRenderable(expanded.element);
    if (expanded.kind === "union") return expanded.members.every((member) => this.isJsxRenderable(member));
    return false;
  }

  /**
   * F1's qualifying rule, and the whole of it: the types whose rendering is
   * *exactly* one text node.
   *
   * `string` and `number` are the two. `__velarAppend` answers a string with one
   * text node carrying it — the empty string included, which is why `""` is not
   * a special case — and a number with one text node carrying `String(value)`,
   * or refuses a non-finite number. An enum member is text at runtime and is
   * assignable to `string`, so it rides the same branch it always did.
   *
   * Everything else stays on the full dynamic region, and the reason is always
   * the same one: it does not render as *one* node.
   * - `bool` renders **zero** nodes (`__velarAppend` returns on `true`/`false`),
   *   so a text node would be an added child where an element previously had
   *   none — observable to `:empty`, to `childNodes`, and to anything that
   *   walks them.
   * - An optional of either renders zero nodes when null and one when present,
   *   so it needs an anchor to come back to.
   * - `WebNode`, lists, unions, `any` and every named type can hold markup or
   *   several nodes, which is what the comment pair exists to bracket.
   *
   * Widening this set is a semantic ruling, not an optimisation: it would
   * change the node count of a rendered document.
   */
  private isScalarTextType(type: ValueType): boolean {
    const expanded = this.expandAliases(type);
    return expanded.kind === "string" || expanded.kind === "number";
  }

  private isJsxAttributeValue(type: ValueType): boolean {
    const expanded = this.expandAliases(type);
    if (expanded.kind === "any" || expanded.kind === "null" || expanded.kind === "string" || expanded.kind === "number"
      || expanded.kind === "bool" || expanded.kind === "enum" || expanded.kind === "enumMember") return true;
    if (expanded.kind === "named") return textualWebPrimitiveNames.has(expanded.name);
    if (expanded.kind === "optional") return this.isJsxAttributeValue(expanded.inner);
    if (expanded.kind === "union") return expanded.members.every((member) => this.isJsxAttributeValue(member));
    return false;
  }

  private isOptionalString(type: ValueType): boolean {
    const expanded = this.expandAliases(type);
    if (expanded.kind === "string" || expanded.kind === "null") return true;
    if (expanded.kind === "optional") return this.isOptionalString(expanded.inner);
    if (expanded.kind === "union") return expanded.members.every((member) => this.isOptionalString(member));
    return false;
  }

  /**
   * The elements of a `<Router routes={...}>` list literal, one at a time.
   *
   * A route written as `route("/a", Panel)` is checked at that call; the record
   * that call returns — `{path: "/a", component: Panel}` — is a legal spelling
   * of the same value, reaches the same runtime position, and until now was
   * checked by nothing: `{path: "no-leading-slash", component: 5}` compiled
   * clean and handed `5` to the Router as a component. Closing the sink rather
   * than the spelling means asking the same questions wherever a route arrives,
   * so this reports exactly what `route(...)` reports, word for word.
   *
   * The runtime is already the second referee (D90 R19): `routerTable`
   * validates every path and refuses a component that is not callable. Nothing
   * here changes which programs run — it moves a refusal the author would have
   * met at mount to the place the source shows the mistake.
   *
   * The `any` component slot is skipped here rather than inside
   * `checkWebRouteComponent`, which is why that method carries no `any` arm:
   * this loop and the Router `fallback` attribute are its only two callers, and
   * both filter first. An `any` reaches this slot for real — `web.lazy` answers
   * `anyType` from each of its error paths — and it arrives with the author's
   * real message already reported, so a second "received any" would be a
   * cascade. The `route(...)` twin skips it for the same reason.
   */
  private checkWebRouteRecords(expression: Expression): void {
    if (expression.kind !== "ListExpression") return;
    for (const element of expression.elements) {
      if (element.kind !== "ObjectExpression") continue;
      for (const entry of element.properties) {
        if (entry.kind !== "ObjectProperty") continue;
        if (entry.name === "path") {
          const path = entry.value;
          if (path.kind === "LiteralExpression" && typeof path.value === "string") {
            checkRoutePath(path.value, path.span, (message, span) => this.typeError(message, span));
          }
          continue;
        }
        if (entry.name !== "component") continue;
        // The attribute has already been inferred as a whole, so every
        // sub-expression here has been reported once. This second pass exists
        // only to read the component slot's type back; anything it says is a
        // repeat of what the author already has, and is dropped. Advisories
        // need no such cursor — `advise` is deduplicated by code and span
        // precisely so a re-analysis cannot raise one twice.
        const reported = this.diagnostics.length;
        const type = this.inferExpression(entry.value);
        this.diagnostics.splice(reported);
        if (type.kind === "any") continue;
        this.checkWebRouteComponent(type, entry.value.span, "A route");
      }
    }
  }

  private checkWebRouteComponent(type: ValueType, sourceSpan: Span, subject: string): void {
    if (isInvalidType(type)) return;
    if (!isWebComponentType(type)) {
      // No `any` arm, unlike the `route(...)` twin above: both callers — the
      // Router `fallback` attribute and `checkWebRouteRecords` — already filter
      // `any` out before they call here, so a branch for it could never run.
      this.typeError(`${subject} requires a component, received ${describeType(type)}`, sourceSpan);
      return;
    }
    const unsupported = [...type.requiredProperties].filter((name) => name !== "route");
    if (unsupported.length > 0) this.typeError(`${subject} component cannot require props other than route: ${unsupported.join(", ")}`, sourceSpan);
    const routeProp = type.properties.get("route");
    if (routeProp && !isAssignable({ kind: "named", name: "RouteContext", identity: routeContextIdentity }, routeProp, this)) this.typeError(`${subject} component's route prop must accept RouteContext, received ${describeType(routeProp)}`, sourceSpan);
  }

  /**
   * The one host the `analysis/jsx/` and `analysis/look/` collaborators read
   * this analyzer through, built here because a `private` member cannot be read
   * outside the class it is declared in (TS2341, D114 line 512). The tables the
   * walk replaces once per program — `lookStatic`, `lookBuilderNames`,
   * `lookImport`, `lookDeclarations` — arrive as getters so a collaborator reads
   * the live one, and `jsxDepth` carries a setter because `inferJsx` moves it.
   */
  private analysisHost(): JsxAnalysisHost {
    const analyzer = this;
    return {
      checkedBuilderCalls: this.checkedBuilderCalls,
      diagnostics: this.diagnostics,
      enumValueBindings: this.enumValueBindings,
      extensionCalls: this.extensionCalls,
      extensionLiterals: this.extensionLiterals,
      honoredJsxKeys: this.honoredJsxKeys,
      get jsxDepth() { return analyzer.jsxDepth; },
      set jsxDepth(depth: number) { analyzer.jsxDepth = depth; },
      keyedListSources: this.keyedListSources,
      get lookBuilderNames() { return analyzer.lookBuilderNames; },
      get lookDeclarations() { return analyzer.lookDeclarations; },
      lookEntryScopes: this.lookEntryScopes,
      get lookImport() { return analyzer.lookImport; },
      get lookStatic() { return analyzer.lookStatic; },
      refusedBuilderCalls: this.refusedBuilderCalls,
      reportedJsxKeys: this.reportedJsxKeys,
      semanticJsxAttributeOwners: this.semanticJsxAttributeOwners,
      staticJsxKeys: this.staticJsxKeys,
      webSourceText: this.webSourceText,
      advise: (code, message, adviceSpan, fix) => { this.advise(code, message, adviceSpan, fix); },
      checkWebRouteComponent: (type, sourceSpan, subject) => { this.checkWebRouteComponent(type, sourceSpan, subject); },
      checkWebRouteRecords: (expression) => { this.checkWebRouteRecords(expression); },
      derivedReactiveRead: (name) => this.derivedReactiveRead(name),
      expandAliases: (type) => this.expandAliases(type),
      fieldsOf: (identity) => this.fieldsOf(identity),
      inferExpression: (expression, contextualType) => this.inferExpression(expression, contextualType),
      inferredExpressionType: (expression) => this.inferredExpressionType(expression),
      isAssignableHere: (actual, expected) => isAssignable(actual, expected, this),
      isClassInput: (type) => this.isClassInput(type),
      isJsxAttributeValue: (type) => this.isJsxAttributeValue(type),
      isJsxRenderable: (type) => this.isJsxRenderable(type),
      isLookInput: (type) => this.isLookInput(type),
      isOptionalString: (type) => this.isOptionalString(type),
      isScalarTextType: (type) => this.isScalarTextType(type),
      lookup: (name) => this.lookup(name),
      reactiveBindingKind: (name) => this.reactiveBindingKind(name),
      requireAssignable: (actual, expected, valueSpan) => { this.requireAssignable(actual, expected, valueSpan); },
      requireCondition: (type, condition) => { this.requireCondition(type, condition); },
      writableStateName: (name) => this.writableStateName(name),
    };
  }
}
