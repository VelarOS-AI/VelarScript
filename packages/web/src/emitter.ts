import type {
  CompilerStyleSegments,
  CompilerEmitterOptions,
  Expression,
  Program,
  Statement,
  LoweringHints,
  ValueType,
} from "@velarscript/compiler/extension";
import { cssPropertyName, LOOK_ARITHMETIC_HINT, LOOK_MEDIA_LENGTH_UNITS, LOOK_PROPERTIES, LOOK_PROPERTY_KEYWORDS, LOOK_PROPERTY_VALUE_KINDS } from "./look.ts";
import { isCssDeclarationValue } from "./css-tokens.ts";
import { collectLookStaticValues, evaluateLookStaticExpression, isLookStaticValue, lookStaticCss, type LookStaticValue } from "./look-static.ts";
import { keyframeCssValue, keyframesCanonical, keyframesName } from "./keyframes.ts";
import { JavaScriptEmitter, spanIdentity, VELAR_ERROR_NORMALIZATION_MODULE, VELAR_RUNTIME_REGISTRY_KEY } from "@velarscript/compiler/extension";
import {
  CSS_STRING_RUNTIME_BODY, LOOK_ARITHMETIC_RUNTIME, WEB_FILE_TYPE_RUNTIME,
  WEB_LOCAL_REACTIVE_BRIDGE_RUNTIME, WEB_LOCAL_REACTIVE_COLLECTION_BRIDGE_RUNTIME,
  WEB_RUNTIME_BODY, WEB_RUNTIME_FOUNDATION, WEB_RUNTIME_FOUNDATION_SHARED_ERROR,
} from "./runtime-sources.generated.ts";
import {
  isWebExpression,
  isWebJsx,
  isWebKeyframes,
  isWebLook,
  isWebStatement,
  isWebUnit,
  webExpressionContainsDirectAwait,
  webStatementContainsDirectAwait,
  webWatchSubjectLabel,
  type WebComponentDeclaration as ComponentDeclaration,
  type WebJsxAttribute as JSXAttribute,
  type WebJsxElementExpression as JSXElementExpression,
  type WebKeyframesExpression as KeyframesExpression,
  type WebLookEntry as LookEntry,
  type WebLookExpression as LookExpression,
} from "./ast.ts";

type AssignmentStatement = Extract<Statement, { readonly kind: "AssignmentStatement" }>;

interface LookStaticAtom {
  readonly kind: "hook" | "media" | "scheme" | "motion";
  readonly name: string;
  readonly operator?: "<" | "<=" | ">" | ">=";
  readonly value?: string;
  readonly negated: boolean;
}

interface LookRuntimeAtom {
  readonly expression: Expression;
  readonly negated: boolean;
}

interface LookConditionTerm {
  readonly staticAtoms: readonly LookStaticAtom[];
  readonly runtimeAtoms: readonly LookRuntimeAtom[];
}

interface LookRule {
  readonly token: string;
  readonly property: string;
  readonly target: string;
  readonly staticAtoms: readonly LookStaticAtom[];
  /** Declaration order of the token's first appearance, the last tie-break. */
  readonly sequence: number;
}

/**
 * Statements whose body is not module evaluation. A `def`, a class method, and
 * a `test` run when something calls them, and reach that caller's failure
 * transaction rather than the module's; a `try` is the author claiming the
 * failure himself. `@main` is deliberately absent — it is the module's own
 * final region and evaluates with the rest of the module.
 */
const DEFERRED_BODY_STATEMENT_KINDS: ReadonlySet<Statement["kind"]> = new Set<Statement["kind"]>([
  "FunctionDeclaration",
  "ClassDeclaration",
  "TestDeclaration",
  "TryStatement",
]);

export class WebJavaScriptEmitter extends JavaScriptEmitter {
  private currentScope: string | null = null;
  /**
   * Whether the statement being emitted runs while the module evaluates, with
   * nothing standing between its failure and the module's own. It starts true
   * at the module's top level, stays true through the `@main` region, which is
   * the same evaluation, and is cleared for every body that runs later or under
   * an owner of its own: a `def`, a class, a `test`, an arrow, a derived or
   * watched expression, a `try` the author wrote, and the root argument of
   * `mount`, whose failure `__velarMount` already owns.
   *
   * Only a component element read here answers an instance nobody has caught,
   * which is the one construction whose throw used to take the whole page with
   * it; see `__velarModuleInstantiate`.
   */
  private moduleEvaluation = true;
  private currentJsxNamespace = '"html"';
  private readonly resourceContents: ReadonlyMap<string, string>;
  private cssOutput = "";
  private cssSegments: CompilerStyleSegments = { before: "", controlled: "", after: "" };
  private webOutput = false;
  private needsFileTypeHelper = false;
  private needsLookArithmeticRuntime = false;
  private readonly importedLookStaticValues: ReadonlyMap<string, LookStaticValue>;
  private lookStaticValues: ReadonlyMap<string, LookStaticValue> = new Map();
  /** CSS names of the closed-keyword properties this module styles, for the runtime guard. */
  private readonly lookKeywordProperties = new Set<string>();
  private jsxId = 0;
  private readonly keyframeNames = new Map<string, string>();

  constructor(
    hints: LoweringHints,
    forcedFunctionExports: ReadonlySet<string> = new Set(),
    resourceContents: ReadonlyMap<string, string> = new Map(),
    extensionImports: ReadonlyMap<string, ReadonlyMap<string, unknown>> = new Map(),
    options: CompilerEmitterOptions = {},
  ) {
    super(hints, forcedFunctionExports, options);
    this.resourceContents = resourceContents;
    this.importedLookStaticValues = new Map(
      [...(extensionImports.get("@velarscript/web") ?? [])]
        .filter((entry): entry is [string, LookStaticValue] => isLookStaticValue(entry[1])),
    );
  }

  override emit(program: Program): string {
    this.lookStaticValues = collectLookStaticValues(program, this.importedLookStaticValues);
    this.prepareLooks(program);
    this.webOutput = containsWebSyntax(program);
    this.needsFileTypeHelper = false;
    this.needsLookArithmeticRuntime = [...this.hints.extensionCalls.values()].includes(LOOK_ARITHMETIC_HINT);
    this.moduleEvaluation = true;
    return super.emit(program);
  }

  /** Emits `render` with module evaluation switched off, for a body that runs under an owner of its own. */
  private outsideModuleEvaluation<T>(render: () => T): T {
    const previous = this.moduleEvaluation;
    this.moduleEvaluation = false;
    try {
      return render();
    } finally {
      this.moduleEvaluation = previous;
    }
  }

  css(): string {
    return this.cssOutput;
  }

  styleSegments(): CompilerStyleSegments {
    return this.cssSegments;
  }

  web(): boolean {
    return this.webOutput;
  }

  protected override emitTypeCheck(type: ValueType, value: string, state = "undefined"): string {
    if (type.kind === "named") {
      if (type.name === "Event" || type.name === "KeyboardEvent" || type.name === "PointerEvent" || type.name === "InputEvent" || type.name === "CompositionEvent" || type.name === "ClipboardEvent") {
        return `(typeof ${type.name} !== "undefined" && ${value} instanceof ${type.name})`;
      }
      if (type.name === "Element") return `(typeof Element !== "undefined" && ${value} instanceof Element)`;
      if (type.name === "CanvasElement") return `(typeof HTMLCanvasElement !== "undefined" && ${value} instanceof HTMLCanvasElement)`;
      if (type.name === "DialogElement") return `(typeof HTMLDialogElement !== "undefined" && ${value} instanceof HTMLDialogElement)`;
      if (type.name === "InputElement") {
        return `((typeof HTMLInputElement !== "undefined" && ${value} instanceof HTMLInputElement) || (typeof HTMLSelectElement !== "undefined" && ${value} instanceof HTMLSelectElement) || (typeof HTMLTextAreaElement !== "undefined" && ${value} instanceof HTMLTextAreaElement))`;
      }
      if (type.name === "TextAreaElement") return `(typeof HTMLTextAreaElement !== "undefined" && ${value} instanceof HTMLTextAreaElement)`;
      if (type.name === "Blob") return `(typeof Blob !== "undefined" && ${value} instanceof Blob)`;
      if (type.name === "File") {
        this.needsFileTypeHelper = true;
        return `__velarFileTypeIs(${value})`;
      }
    }
    return super.emitTypeCheck(type, value, state);
  }

  protected override emitIsCheck(type: ValueType, value: string): string {
    if (type.kind === "named" && (
      type.name === "Event"
      || type.name === "KeyboardEvent"
      || type.name === "PointerEvent"
      || type.name === "InputEvent"
      || type.name === "CompositionEvent"
      || type.name === "ClipboardEvent"
      || type.name === "Element"
      || type.name === "CanvasElement"
      || type.name === "DialogElement"
      || type.name === "InputElement"
      || type.name === "TextAreaElement"
      || type.name === "Blob"
      || type.name === "File"
    )) return this.emitTypeCheck(type, value);
    return super.emitIsCheck(type, value);
  }

  protected override additionalHelpers(_program: Program): readonly string[] {
    return [
      ...(this.needsLookArithmeticRuntime ? [LOOK_ARITHMETIC_RUNTIME] : []),
      ...(this.webOutput ? this.webRuntimeHelpers() : []),
      ...(this.needsFileTypeHelper ? [WEB_FILE_TYPE_RUNTIME] : []),
    ];
  }

  private webRuntimeHelpers(): readonly string[] {
    if (!this.usesSharedRuntimeModules()) return [webRuntime(WEB_RUNTIME_FOUNDATION, this.lookKeywordTable())];
    this.requireRuntimeModule(VELAR_ERROR_NORMALIZATION_MODULE);
    return [
      `import { errorApply as __velarErrorApply, errorCode as __velarErrorCode, isError as __velarIsError, normalizeError as __velarNormalizeError } from ${JSON.stringify(VELAR_ERROR_NORMALIZATION_MODULE)};`,
      webRuntime(WEB_RUNTIME_FOUNDATION_SHARED_ERROR, this.lookKeywordTable()),
    ];
  }

  /**
   * The closed keyword sets of the properties this module styles, so a value
   * the compiler could not read is still checked before it reaches the DOM.
   * Only the properties written here ship: the whole table is 17 KiB, and a
   * module pays for the properties it uses.
   */
  private lookKeywordTable(): string {
    const entries = [...this.lookKeywordProperties].sort()
      .map((name) => `  ${JSON.stringify(cssPropertyName(name))}: ${JSON.stringify([...LOOK_PROPERTY_KEYWORDS.get(name) ?? []])},`);
    return entries.length === 0
      ? "const __velarLookKeywords = { __proto__: null };"
      : `const __velarLookKeywords = {\n  __proto__: null,\n${entries.join("\n")}\n};`;
  }

  protected override reactiveBridgeHelpers(
    needsJavaScriptCallBoundary: boolean,
    needsCollections: boolean,
    usedIdentifiers: ReadonlySet<string> = new Set(),
  ): readonly string[] {
    if (this.usesSharedRuntimeModules()) return super.reactiveBridgeHelpers(needsJavaScriptCallBoundary, needsCollections, usedIdentifiers);
    if (!this.webOutput) return super.reactiveBridgeHelpers(needsJavaScriptCallBoundary, needsCollections, usedIdentifiers);
    if (!needsJavaScriptCallBoundary && !needsCollections) return [];
    return [WEB_LOCAL_REACTIVE_BRIDGE_RUNTIME, ...(needsCollections ? [WEB_LOCAL_REACTIVE_COLLECTION_BRIDGE_RUNTIME] : [])];
  }

  protected override includesErrorNormalizationRuntime(): boolean {
    return this.webOutput;
  }

  // Web detached tasks report through the velar/app error chain with the
  // distinct "detached" phase. The runtime registry is looked up at report
  // time (module-level tasks can finish before or after the application
  // runtime installs); the captured microtask throw keeps a failure loud when
  // no runtime exists yet, and 'unhandled: true' keeps it loud when no
  // onError handler is installed. Host operations are captured at module
  // initialization, matching the owned-callback discipline.
  protected override detachedTaskHelpers(): readonly string[] {
    // A module with no Web syntax emits no Web runtime, so it must keep Core's
    // host reporting: the browser path would route a detached failure through a
    // runtime registry that never gets installed and end in a microtask throw,
    // which under `velar test` kills the whole Node test process.
    if (!this.webOutput) return super.detachedTaskHelpers();
    return [[
      `const __velarDetachedRegistryKey = Symbol.for(${JSON.stringify(VELAR_RUNTIME_REGISTRY_KEY)});`,
      "const __velarDetachedPromiseThen = globalThis.Promise.prototype.then;",
      "const __velarDetachedApply = Reflect.apply;",
      "const __velarDetachedEnqueue = queueMicrotask;",
      "function __velarDetachedReport(failure) {",
      "  const error = __velarNormalizeError(failure);",
      "  const runtime = globalThis[__velarDetachedRegistryKey];",
      "  if (runtime && typeof runtime.report === \"function\") {",
      "    // An action reports its own failure once, in the action phase with",
      "    // the action's name as detail. The detached observer of that same",
      "    // rejection must not report it a second time.",
      "    try {",
      "      if (__velarIsError(failure) && __velarGraphWeakSetRemove(runtime.actionFailures, failure)) return;",
      "    } catch {}",
      "    runtime.report(error, { phase: \"detached\", detail: \"\", unhandled: true });",
      "    return;",
      "  }",
      "  __velarDetachedApply(__velarDetachedEnqueue, globalThis, [() => { throw error; }]);",
      "}",
      "function __velarDetachedTask(task) {",
      // D114 W2: the one place a detached Promise enters the Web runtime, and
      // so the one place the reactive window can be told that an observer run
      // started asynchronous work. The runtime foundation decides whether a run
      // is in progress; this site only reports the fact.
      "  __velarNoteAsyncWork();",
      "  __velarDetachedApply(__velarDetachedPromiseThen, task, [null, __velarDetachedReport]);",
      "  return null;",
      "}",
    ].join("\n")];
  }

  protected override visitExtensionRuntimeExpression(expression: Expression, visitExpression: (expression: Expression) => void): boolean {
    if (isWebUnit(expression)) return true;
    if (isWebKeyframes(expression)) {
      for (const stop of expression.stops) for (const entry of stop.entries) visitExpression(entry.value);
      return true;
    }
    if (isWebLook(expression)) {
      visitLookExpressions(expression.entries, visitExpression);
      return true;
    }
    if (!isWebJsx(expression)) return false;
    expression.attributes.forEach((attribute) => {
      if (typeof attribute.value !== "string" && attribute.value) visitExpression(attribute.value);
    });
    expression.children.forEach((child) => {
      if (child.kind === "JSXExpressionChild") visitExpression(child.expression);
      else if (child.kind === "ExtensionExpression:web:jsx") visitExpression(child);
    });
    return true;
  }

  protected override visitExtensionRuntimeStatement(
    statement: Statement,
    visitExpression: (expression: Expression) => void,
    visitStatement: (statement: Statement) => void,
  ): boolean {
    if (!isWebStatement(statement)) return false;
    if (statement.kind === "ExtensionStatement:web:unsafe-css") return true;
    if (statement.kind === "ExtensionStatement:web:state" || statement.kind === "ExtensionStatement:web:computed"
      || statement.kind === "ExtensionStatement:web:resource") {
      visitExpression(statement.initializer);
      return true;
    }
    if (statement.kind === "ExtensionStatement:web:action") {
      statement.parameters.forEach((parameter) => { if (parameter.defaultValue) visitExpression(parameter.defaultValue); });
      statement.body.forEach(visitStatement);
      return true;
    }
    if (statement.kind === "ExtensionStatement:web:watch") {
      visitExpression(statement.expression);
      statement.body.forEach(visitStatement);
      return true;
    }
    if (statement.kind !== "ExtensionStatement:web:component") return false;
    statement.parameters.forEach((parameter) => { if (parameter.defaultValue) visitExpression(parameter.defaultValue); });
    statement.body.forEach((item) => {
      if (item.kind === "ExtensionStatement:web:state" || item.kind === "ExtensionStatement:web:computed"
        || item.kind === "ExtensionStatement:web:resource") visitExpression(item.initializer);
      else if (item.kind === "ExtensionStatement:web:action") {
        item.parameters.forEach((parameter) => { if (parameter.defaultValue) visitExpression(parameter.defaultValue); });
        item.body.forEach(visitStatement);
      } else if (item.kind === "ExtensionStatement:web:watch") {
        visitExpression(item.expression);
        item.body.forEach(visitStatement);
      } else if (item.kind === "ExtensionStatement:web:expose") visitExpression(item.value);
      else if (item.kind === "ExtensionStatement:web:mounted" || item.kind === "ExtensionStatement:web:cleanup") item.body.forEach(visitStatement);
      else visitStatement(item);
    });
    return true;
  }

  protected override extensionExpressionContainsDirectAwait(
    expression: Expression,
    contains: (expression: Expression) => boolean,
  ): boolean | undefined {
    return webExpressionContainsDirectAwait(expression, contains);
  }

  protected override extensionStatementContainsDirectAwait(
    statement: Statement,
    containsExpression: (expression: Expression) => boolean,
    containsBlock: (statements: readonly Statement[]) => boolean,
  ): boolean | undefined {
    return webStatementContainsDirectAwait(statement, containsExpression, containsBlock);
  }

  protected override emitStatement(statement: Statement, depth: number): string {
    // Everything a `def`, class, `test` or `try` holds runs under an owner of
    // its own: a called body reaches whoever called it, and a `try` the author
    // wrote is the author claiming the failure. Neither is module evaluation,
    // even when the call happens to be made while the module evaluates.
    if (DEFERRED_BODY_STATEMENT_KINDS.has(statement.kind) && this.moduleEvaluation) {
      return this.outsideModuleEvaluation(() => this.emitStatement(statement, depth));
    }
    if (isWebStatement(statement)) {
      if (statement.kind === "ExtensionStatement:web:unsafe-css") return "";
      if (statement.kind === "ExtensionStatement:web:component") return this.emitComponent(statement, depth);
      if (statement.kind === "ExtensionStatement:web:state") {
        const indentation = "  ".repeat(depth);
        return `${indentation}${statement.exported ? "export " : ""}const ${statement.name} = __velarState(${this.emitMappedExpression(statement.initializer)}, ${JSON.stringify(statement.name)});`;
      }
      if (statement.kind === "ExtensionStatement:web:computed") {
        const indentation = "  ".repeat(depth);
        const initializer = this.outsideModuleEvaluation(() => this.emitMappedExpression(statement.initializer));
        return `${indentation}${statement.exported ? "export " : ""}const ${statement.name} = __velarComputed(() => (${initializer}));`;
      }
      if (statement.kind === "ExtensionStatement:web:resource") return "";
      if (statement.kind === "ExtensionStatement:web:action") {
        // A module action wires the same reactive pending/error cells as a
        // component action, but it lives in the never-destroyed global scope, so
        // its lifetime is the module and no component disposal applies.
        const indentation = "  ".repeat(depth);
        const parameters = statement.parameters.map((parameter) => this.emitParameter(parameter.name, parameter.defaultValue, parameter.rest)).join(", ");
        const actionLines = this.outsideModuleEvaluation(() => [...this.emitStatementLines(statement.body, depth + 1)]);
        if (!this.blockAlwaysReturns(statement.body)) actionLines.push(`${"  ".repeat(depth + 1)}return null;`);
        const actionBody = actionLines.join("\n");
        return `${indentation}${statement.exported ? "export " : ""}const ${statement.name} = __velarAction(async (${parameters}) => {${actionBody ? `\n${actionBody}\n${indentation}` : ""}}, __velarGlobalScope, ${JSON.stringify(statement.name)});`;
      }
      if (statement.kind === "ExtensionStatement:web:watch") {
        const indentation = "  ".repeat(depth);
        const parameters = [statement.currentName, statement.previousName].filter((name): name is string => name !== null).join(", ");
        const watched = this.outsideModuleEvaluation(() => {
          const written = this.emitStatementLines(statement.body, depth + 1).join("\n");
          return { body: written, subject: this.emitMappedExpression(statement.expression) };
        });
        const body = watched.body;
        return `${indentation}__velarWatch(() => ${watched.subject}, (${parameters}) => {${body ? `\n${body}\n${indentation}` : ""}}, __velarGlobalScope, ${JSON.stringify(webWatchSubjectLabel(statement.expression))});`;
      }
    }
    if (statement.kind === "AssignmentStatement") {
      const reactive = this.emitReactiveAssignment(statement, depth);
      if (reactive) return reactive;
    }
    return super.emitStatement(statement, depth);
  }

  protected override emitExpression(expression: Expression): string {
    // A function value written at module level is a body that runs when it is
    // called, wherever that is, so its component elements are not the module's
    // to catch.
    if (expression.kind === "ArrowFunctionExpression" && this.moduleEvaluation) {
      return this.outsideModuleEvaluation(() => this.emitExpression(expression));
    }
    if (isWebUnit(expression)) return JSON.stringify(expression.raw);
    if (isWebKeyframes(expression)) {
      const name = this.keyframeNames.get(spanIdentity(expression.span)) ?? keyframesName(keyframesCanonical(expression, this.lookStaticValues));
      return `__velarKeyframesValue(${JSON.stringify(name)})`;
    }
    if (expression.kind === "UnaryExpression" && (expression.operator === "+" || expression.operator === "-")
      && (isWebUnit(expression.operand)
        || this.hints.extensionCalls.get(spanIdentity(expression.span)) === LOOK_ARITHMETIC_HINT)) {
      if (isWebUnit(expression.operand)) {
        const value = expression.operator === "-" ? -expression.operand.value : expression.operand.value;
        return JSON.stringify(`${Object.is(value, -0) ? 0 : value}${expression.operand.unit}`);
      }
      return `__velarLookUnary(${JSON.stringify(expression.operator)}, ${this.emitMappedExpression(expression.operand)})`;
    }
    if (expression.kind === "BinaryExpression" && ["+", "-", "*", "/"].includes(expression.operator)
      && (containsUnitLiteral(expression)
        || this.hints.extensionCalls.get(spanIdentity(expression.span)) === LOOK_ARITHMETIC_HINT)) {
      return this.emitLookArithmetic(expression);
    }
    if (isWebExpression(expression) && expression.kind === "ExtensionExpression:web:look-hook") return "false";
    if (isWebLook(expression)) return this.emitLook(expression);
    if (expression.kind === "CallExpression") {
      // D103 rule 2: a checked design token reference is compile-time text. The
      // analyzer proved the name is a literal custom property identifier and
      // stamped the CSS it lowers to, so the module carries `"var(--name)"`
      // rather than a call the browser makes on every load — the same place
      // `keyframes:` has always folded its builder calls to.
      const folded = this.hints.extensionLiterals.get(spanIdentity(expression.span));
      if (folded !== undefined) return JSON.stringify(folded);
    }
    if (expression.kind === "IdentifierExpression") {
      if (this.hints.reactiveReferences.has(spanIdentity(expression.span))) {
        return `${expression.name}.get()`;
      }
      if (expression.name === "mount") return "__velarMount";
      if (expression.name === "tick") return "__velarTick";
      const controlled = this.hints.extensionLiterals.get(spanIdentity(expression.span));
      if (controlled !== undefined) return JSON.stringify(controlled);
    }
    if (isWebJsx(expression)) {
      return this.emitJsx(expression, this.currentScope ?? "__velarGlobalScope", this.currentScope !== null, this.currentJsxNamespace, false);
    }
    if (expression.kind === "CallExpression" && expression.callee.kind === "IdentifierExpression"
      && expression.callee.name === "mount" && expression.arguments.length === 2) {
      // The root is built inside the thunk `__velarMount` runs, so its failure
      // is already owned by the mount transaction and must keep reaching it as
      // a throw rather than being turned into a deferred module failure.
      const sourceArguments = this.outsideModuleEvaluation(
        () => expression.arguments.map((argument) => this.emitMappedExpression(argument)),
      );
      const namedOrder = this.hints.namedArgumentOrders.get(spanIdentity(expression.span));
      const arguments_ = namedOrder
        ? namedOrder.map((source) => source === -1 ? "undefined" : `__velarNamedArguments[${source}]`)
        : sourceArguments;
      const evaluated = namedOrder
        ? `((__velarNamedArguments) => [${arguments_.join(", ")}])([${sourceArguments.join(", ")}])`
        : `[${arguments_.join(", ")}]`;
      const targetSource = namedOrder?.[1] ?? 1;
      const target = targetSource >= 0 ? expression.arguments[targetSource] : null;
      const fallbackTarget = target?.kind === "LiteralExpression" && typeof target.value === "string"
        ? JSON.stringify(target.value)
        : "null";
      return `__velarMount(() => ${evaluated}, ${fallbackTarget})`;
    }
    const emitted = super.emitExpression(expression);
    if (!this.webOutput) return emitted;
    // One expression can lower to more than one pop, so the reactive wrapper
    // has to reach every occurrence rather than the first match.
    if (!emitted.includes("__velarListPop(")) return emitted;
    return emitted.replaceAll("__velarListPop(", "__velarWebListPop(");
  }

  private emitLook(expression: LookExpression): string {
    return `__velarLook([${this.emitLookEntries(expression.entries, [EMPTY_LOOK_TERM], "").join(", ")}])`;
  }

  private emitLookEntries(entries: readonly LookEntry[], contexts: readonly LookConditionTerm[], target: string): readonly string[] {
    const parts: string[] = [];
    for (const entry of entries) {
      if (entry.kind === "LookSpread") {
        parts.push(this.emitMappedExpression(entry.value));
        continue;
      }
      if (entry.kind === "LookIf") {
        const thenContexts = combineLookTerms(contexts, lookConditionTerms(entry.condition, false, this.lookStaticValues));
        const elseContexts = combineLookTerms(contexts, lookConditionTerms(entry.condition, true, this.lookStaticValues));
        parts.push(...this.emitLookEntries(entry.thenEntries, thenContexts, target));
        parts.push(...this.emitLookEntries(entry.elseEntries, elseContexts, target));
        continue;
      }
      if (entry.kind === "LookTarget") {
        parts.push(...this.emitLookEntries(entry.entries, contexts, entry.name));
        continue;
      }
      const property = cssPropertyName(entry.name);
      for (const context of contexts) {
        const token = lookToken(context.staticAtoms, target, property);
        const rule = `{ rules: { ${JSON.stringify(token)}: ${this.emitLookValue(entry.value)} } }`;
        const runtime = context.runtimeAtoms.map((atom) => {
          const value = this.emitCondition(atom.expression);
          return atom.negated ? `!(${value})` : `(${value})`;
        }).join(" && ");
        parts.push(runtime ? `(${runtime} ? ${rule} : null)` : rule);
      }
    }
    return parts;
  }

  private emitLookValue(expression: Expression): string {
    return this.emitMappedExpression(expression);
  }

  private emitLookArithmetic(expression: Extract<Expression, { readonly kind: "BinaryExpression" }>): string {
    return `__velarLookMath(${JSON.stringify(expression.operator)}, ${this.emitMappedExpression(expression.left)}, ${this.emitMappedExpression(expression.right)})`;
  }

  private emitComponent(statement: ComponentDeclaration, depth: number): string {
    const indentation = "  ".repeat(depth);
    const outerIndent = "  ".repeat(depth + 1);
    const bodyIndent = "  ".repeat(depth + 2);
    const previousScope = this.currentScope;
    const previousJsxNamespace = this.currentJsxNamespace;
    this.currentScope = "__velarComponentScope";
    this.currentJsxNamespace = "__velarNamespace";
    // Props are live reactive inputs: every parameter becomes a read-only
    // handle over the per-instance props store, so prop reads lower through
    // .get() exactly like state reads do.
    const lines: string[] = [];
    for (const parameter of statement.parameters) {
      if (parameter.defaultValue) {
        lines.push(`${bodyIndent}const ${parameter.name} = __velarProp(__velarProps, ${JSON.stringify(parameter.name)}, () => (${this.emitMappedExpression(parameter.defaultValue)}));`);
      } else {
        lines.push(`${bodyIndent}const ${parameter.name} = __velarRequiredProp(__velarProps, ${JSON.stringify(parameter.name)}, ${JSON.stringify(statement.name)});`);
      }
    }
    let render: Expression | null = null;
    let expose: Expression | null = null;
    let mountedBody: readonly Statement[] = [];
    let cleanupBody: readonly Statement[] = [];
    for (const item of statement.body) {
      if (item.kind === "ExtensionStatement:web:state") {
        lines.push(`${bodyIndent}const ${item.name} = __velarState(${this.emitMappedExpression(item.initializer)}, ${JSON.stringify(item.name)});`);
      } else if (item.kind === "ExtensionStatement:web:computed") {
        lines.push(`${bodyIndent}const ${item.name} = __velarComputed(() => (${this.emitMappedExpression(item.initializer)}));`);
      } else if (item.kind === "ExtensionStatement:web:resource") {
        lines.push(`${bodyIndent}const ${item.name} = __velarResource(() => ${this.emitMappedExpression(item.initializer)}, __velarComponentScope, ${JSON.stringify(item.name)});`);
      } else if (item.kind === "ExtensionStatement:web:action") {
        const parameters = item.parameters.map((parameter) => this.emitParameter(parameter.name, parameter.defaultValue, parameter.rest)).join(", ");
        const actionLines = [...this.emitStatementLines(item.body, depth + 3)];
        if (!this.blockAlwaysReturns(item.body)) actionLines.push(`${"  ".repeat(depth + 3)}return null;`);
        const actionBody = actionLines.join("\n");
        lines.push(`${bodyIndent}const ${item.name} = __velarAction(async (${parameters}) => {${actionBody ? `\n${actionBody}\n${bodyIndent}` : ""}}, __velarComponentScope, ${JSON.stringify(item.name)});`);
      } else if (item.kind === "ExtensionStatement:web:watch") {
        const parameters = [item.currentName, item.previousName].filter((name): name is string => name !== null).join(", ");
        const watchLines = this.emitStatementLines(item.body, depth + 3).join("\n");
        lines.push(`${bodyIndent}__velarWatch(() => ${this.emitMappedExpression(item.expression)}, (${parameters}) => {${watchLines ? `\n${watchLines}\n${bodyIndent}` : ""}}, __velarComponentScope, ${JSON.stringify(webWatchSubjectLabel(item.expression))});`);
      } else if (item.kind === "ExtensionStatement:web:expose") {
        expose ??= item.value;
      } else if (item.kind === "ExtensionStatement:web:mounted") {
        mountedBody = item.body;
      } else if (item.kind === "ExtensionStatement:web:cleanup") {
        cleanupBody = item.body;
      } else if (item.kind === "ReturnStatement") {
        render = item.value;
      } else {
        lines.push(this.emitMappedStatement(item, depth + 2));
      }
    }

    // A direct JSX root owns its own attribute/child observers and keeps a
    // stable host. Every other WebNode expression is a live root position:
    // evaluate it inside a dedicated child scope so conditions and helper
    // calls can replace the root without rerunning component setup.
    let renderedRoot = "__velarDomCreateComment(\"missing render\")";
    if (render) {
      if (isWebJsx(render)) renderedRoot = this.emitMappedExpression(render);
      else {
        const rootScope = this.currentScope;
        this.currentScope = "__velarDynamicScope";
        try {
          renderedRoot = `__velarDynamicComponent((__velarDynamicScope) => ${this.emitMappedExpression(render)}, __velarComponentScope)`;
        } finally {
          this.currentScope = rootScope;
        }
      }
    }
    lines.push(`${bodyIndent}const __velarRoot = ${renderedRoot};`);
    lines.push(`${bodyIndent}const __velarHandle = ${expose ? `__velarComponentHandle(${this.emitMappedExpression(expose)}, ${JSON.stringify(statement.name)})` : "null"};`);
    lines.push(`${bodyIndent}if (__velarProps.class !== undefined) __velarClassBindRoot(__velarRoot, () => __velarProps.class, __velarComponentScope);`);
    lines.push(`${bodyIndent}if (__velarProps.look !== undefined) __velarLookBindRoot(__velarRoot, () => __velarProps.look, __velarComponentScope);`);
    // 'class' and 'look' are fields a component may declare and read, so they
    // arrive as props. The 'style:' slot is not: it is bound to the instance
    // root by whoever wrote it, at the instantiation site, for every component
    // alike -- see __velarInstantiate.
    const mounted = this.emitStatementLines(mountedBody, depth + 3).join("\n");    const cleanup = cleanupBody.map((child) => {
      if (["VariableDeclaration", "FunctionDeclaration", "ClassDeclaration", "TypeDeclaration", "EnumDeclaration"].includes(child.kind)) {
        return this.emitMappedStatement(child, depth + 3);
      }
      const inner = this.emitMappedStatement(child, depth + 4);
      if (!inner) return "";
      const cleanupIndent = "  ".repeat(depth + 3);
      return `${cleanupIndent}__velarCleanupStep(() => {\n${inner}\n${cleanupIndent}}, __velarComponentScope);`;
    }).filter(Boolean).join("\n");
    const cleanupBodyText = `() => {${cleanup ? `\n${cleanup}\n${bodyIndent}` : ""}}`;
    const functionLines = [
      `${outerIndent}const __velarComponentScope = __velarSetupBegin(__velarScope(${JSON.stringify(statement.name)}));`,
      `${outerIndent}let __velarConstructionCleanup = () => {};`,
      `${outerIndent}try {`,
      `${bodyIndent}__velarConstructionCleanup = ${cleanupBodyText};`,
      ...lines,
      `${bodyIndent}return __velarSetupEnd(__velarComponent(__velarRoot, __velarComponentScope, async () => {${mounted ? `\n${mounted}\n${bodyIndent}` : ""}}, __velarConstructionCleanup, __velarHandle));`,
      `${outerIndent}} catch (__velarConstructionError) {`,
      `${bodyIndent}__velarSetupEnd(null);`,
      `${bodyIndent}try { __velarConstructionCleanup(); } catch (__velarCleanupError) { __velarReport(__velarCleanupError, "cleanup", __velarComponentScope); }`,
      `${bodyIndent}__velarDestroyScope(__velarComponentScope);`,
      `${bodyIndent}throw __velarConstructionError;`,
      `${outerIndent}}`,
    ];

    this.currentScope = previousScope;
    this.currentJsxNamespace = previousJsxNamespace;
    return `${indentation}${statement.exported ? "export " : ""}function ${statement.name}(__velarProps = {}, __velarNamespace = "html") {\n${functionLines.filter(Boolean).join("\n")}\n${indentation}}`;
  }

  private emitReactiveAssignment(statement: AssignmentStatement, depth: number): string | null {
    const indentation = "  ".repeat(depth);
    if (statement.target.kind === "IdentifierExpression"
      && this.hints.reactiveReferences.get(spanIdentity(statement.target.span)) === "state") {
      const state = statement.target.name;
      const value = this.emitMappedExpression(statement.value);
      if (statement.operator === "=") return `${indentation}${state}.set(${value});`;
      return `${indentation}${state}.set(${state}.get() ${statement.operator.slice(0, -1)} ${value});`;
    }
    return null;
  }

  private emitJsx(expression: JSXElementExpression, scope: string, asChild: boolean, namespace: string, mapped = true): string {
    const render = (): string => this.emitJsxCode(expression, scope, asChild, namespace);
    return mapped ? this.emitMappedJavaScript(expression.span, render) : render();
  }

  private emitJsxCode(expression: JSXElementExpression, scope: string, asChild: boolean, namespace: string): string {
    if (/^[A-Z]/u.test(expression.tag)) {
      const reactiveComponent = this.hints.reactiveReferences.has(spanIdentity(expression.tagSpan));
      const componentScope = reactiveComponent ? "__velarDynamicScope" : scope;
      const previousScope = this.currentScope;
      if (reactiveComponent) this.currentScope = componentScope;
      try {
        // Static component identity keeps the existing stable child fast path.
        // A reactive Component value owns a dynamic region that remounts only
        // when the constructor identity itself changes; ordinary prop updates
        // continue through the child's live prop cells.
        const properties = expression.attributes
          .filter((attribute) => attribute.name !== "key" && attribute.name !== "ref" && attribute.name !== "look" && !attribute.name.startsWith("look:")
            && attribute.name !== "style" && !attribute.name.startsWith("style:"))
          .map((attribute) => this.emitMappedJavaScript(
            attribute.span,
            () => `${this.emitObjectKey(attribute.name)}: () => (${this.emitJsxAttributeValue(attribute)})`,
          ));
        const lookValue = this.emitJsxLookValue(expression);
        const lookAttribute = expression.attributes.find((attribute) => attribute.name === "look" || attribute.name.startsWith("look:"));
        if (lookValue && lookAttribute) {
          properties.push(this.emitMappedJavaScript(lookAttribute.span, () => `look: () => (${lookValue})`));
        }
        const styleValue = this.emitJsxStyleValue(expression);
        const styleAttribute = expression.attributes.find((attribute) => attribute.name.startsWith("style:"));
        if (styleValue && styleAttribute) {
          properties.push(this.emitMappedJavaScript(styleAttribute.span, () => `__velarStyle: () => (${styleValue})`));
        }
        // Children stay a thunk so the charter's evaluation order holds at
        // the runtime boundary: props left to right, then children, then the
        // component function. The thunk takes the scope to build into, so the
        // position that shows the slot owns what it built and destroys it when
        // it stops showing it.
        const children = hasMeaningfulChildren(expression.children)
          ? `(__velarChildrenScope = ${componentScope}) => (${this.emitJsxChildrenCode(expression.children, namespace)})`
          : "undefined";
        const ref = expression.attributes.find((attribute) => attribute.name === "ref")?.value;
        const refSetter = ref && typeof ref !== "string" && ref.kind === "IdentifierExpression"
          ? `(next, previous) => { if (previous === undefined || ${ref.name} === previous) ${ref.name} = next; }`
          : null;
        const component = reactiveComponent ? `${expression.tag}.get()` : expression.tag;
        const arguments_ = `${component}, { ${properties.join(", ")} }, ${children}, ${componentScope}, ${namespace}${refSetter ? `, ${refSetter}` : ""}`;
        if (reactiveComponent) {
          return `__velarDynamicComponent((__velarDynamicScope) => __velarChild(${arguments_}), ${scope})`;
        }
        if (asChild) return `__velarChild(${arguments_})`;
        // D90 R4-b's designed site: `const root = <App />` builds its instance
        // while the module evaluates, which is outside every transaction the
        // runtime owns. The site stays legal and eager; only its failure moves,
        // from an uncaught module-evaluation throw to the same no-blank-page
        // machinery `mount` has always run.
        return `${this.moduleEvaluation ? "__velarModuleInstantiate" : "__velarInstantiate"}(${arguments_})`;
      } finally {
        this.currentScope = previousScope;
      }
    }

    const id = ++this.jsxId;
    const element = `__velarElement${id}`;
    const elementNamespace = expression.tag === "svg" ? '"svg"' : namespace;
    const childNamespace = expression.tag === "foreignObject" ? '"html"' : elementNamespace;
    const lines = [expression.tag
      ? `const ${element} = __velarCreateElement(${JSON.stringify(expression.tag)}, ${elementNamespace});`
      : `const ${element} = __velarDomCreateFragment();`];
    let emittedLook = false;
    let emittedStyle = false;
    for (const attribute of expression.attributes) {
      if (attribute.name === "key") continue;
      if (attribute.name === "look" || attribute.name.startsWith("look:")) {
        if (!emittedLook) {
          emittedLook = true;
          const lookValue = this.emitJsxLookValue(expression);
          if (lookValue) lines.push(this.emitMappedJavaScript(attribute.span, () => `__velarLookBind(${element}, () => ${lookValue}, ${scope});`));
        }
        continue;
      }
      if (attribute.name.startsWith("style:")) {
        if (!emittedStyle) {
          emittedStyle = true;
          const styleValue = this.emitJsxStyleValue(expression);
          if (styleValue) lines.push(this.emitMappedJavaScript(attribute.span, () => `__velarStyleBind(${element}, () => (${styleValue}), ${scope});`));
        }
        continue;
      }
      if (attribute.name === "style") continue;
      lines.push(this.emitMappedJavaScript(attribute.span, () => {
        const value = attribute.value;
        if (attribute.name === "ref" && value && typeof value !== "string" && value.kind === "IdentifierExpression") {
          return `${value.name} = ${element}; __velarAppendOwned(${scope}.cleanups, () => { if (${value.name} === ${element}) ${value.name} = null; });`;
        }
        if (attribute.name.startsWith("on:") && value && typeof value !== "string") {
          const [event, ...modifiers] = attribute.name.slice(3).split(".");
          return `__velarOn(${element}, ${JSON.stringify(event)}, () => (${this.emitMappedExpression(value)}), ${scope}, ${JSON.stringify(modifiers)});`;
        }
        if (attribute.name === "bind:value" && value && typeof value !== "string") {
          const numeric = expression.tag === "input" && expression.attributes.some((item) => item.name === "type" && item.value === "number");
          const enumName = this.hints.enumValueBindings.get(attribute.span.start);
          return `__velarBindValue(${element}, ${this.emitBindTarget(value)}, ${scope}, ${numeric}${enumName ? `, ${enumName}.parse` : ""});`;
        }
        if (attribute.name === "bind:checked" && value && typeof value !== "string") {
          return `__velarBindChecked(${element}, ${this.emitBindTarget(value)}, ${scope});`;
        }
        if (attribute.name === "bind:group" && value && typeof value !== "string") {
          const multiple = expression.attributes.some((item) => item.name === "type" && item.value === "checkbox");
          const enumName = this.hints.enumValueBindings.get(attribute.span.start);
          return `__velarBindGroup(${element}, ${this.emitBindTarget(value)}, ${scope}, ${multiple}${enumName ? `, ${enumName}.parse` : ""});`;
        }
        if (attribute.name.startsWith("class:") && value && typeof value !== "string") {
          return `__velarClass(${element}, ${JSON.stringify(attribute.name.slice(6))}, () => ${this.emitMappedExpression(value)}, ${scope});`;
        }
        if (attribute.name === "host") return `${element}.__velarHost = true;`;
        if (attribute.name === "class" && value && typeof value !== "string") {
          return `__velarClassBind(${element}, () => ${this.emitMappedExpression(value)}, ${scope});`;
        }
        if (attribute.name === "unsafe:html") {
          const html = typeof value === "string" ? JSON.stringify(value) : value === null ? '""' : this.emitMappedExpression(value);
          return `__velarHtml(${element}, () => ${html}, ${scope});`;
        }
        if (typeof value === "string" || value === null) {
          return `__velarStaticAttr(${element}, ${JSON.stringify(attribute.name)}, ${value === null ? "true" : JSON.stringify(value)});`;
        }
        return `__velarAttr(${element}, ${JSON.stringify(attribute.name)}, () => ${this.emitMappedExpression(value)}, ${scope});`;
      }));
    }
    for (const child of expression.children) {
      if (child.kind === "JSXText") {
        const text = normalizeJsxText(child.value);
        if (text) lines.push(this.emitMappedJavaScript(child.span, () => `__velarDomAppend(${element}, __velarDomCreateTextNode(${JSON.stringify(text)}));`));
      } else if (child.kind === "ExtensionExpression:web:jsx") {
        lines.push(this.emitMappedJavaScript(child.span, () => `__velarAppend(${element}, ${this.emitJsx(child, scope, true, childNamespace)});`));
      } else {
        lines.push(this.emitMappedJavaScript(child.expression.span, () => this.emitDynamicChild(element, child.expression, scope, childNamespace)));
      }
    }
    lines.push(`return ${element};`);
    return `(() => { ${lines.join(" ")} })()`;
  }

  private emitJsxChildren(children: JSXElementExpression["children"], scope: string, namespace: string): string {
    const fragmentSpan = children[0]?.span ?? { start: 0, end: 0 };
    const fragment: JSXElementExpression = { kind: "ExtensionExpression:web:jsx", tag: "", tagSpan: { start: fragmentSpan.start, end: fragmentSpan.start }, attributes: [], children, span: fragmentSpan };
    return this.emitJsx(fragment, scope, true, namespace);
  }

  // The slot body builds into whichever scope the consuming position hands it,
  // so every observer, ref and cleanup it registers dies with that position
  // rather than accumulating on the caller for the component's whole lifetime.
  private emitJsxChildrenCode(children: JSXElementExpression["children"], namespace: string): string {
    const previousScope = this.currentScope;
    this.currentScope = "__velarChildrenScope";
    try {
      return this.emitJsxChildren(children, "__velarChildrenScope", namespace);
    } finally {
      this.currentScope = previousScope;
    }
  }

  private emitDynamicChild(parent: string, expression: Expression, scope: string, namespace: string): string {
    const leaves = dynamicChildLeaves(expression);
    const previousScope = this.currentScope;
    const previousJsxNamespace = this.currentJsxNamespace;
    this.currentScope = "__velarChildScope";
    this.currentJsxNamespace = namespace;
    // A conditional splits into one region per branch leaf only when a keyed
    // list is somewhere among them; each region gates itself on the shared
    // branch conditions, so at most one region renders content at a time and
    // the keyed list keeps identity-preserving children across the branch flip.
    // Without a keyed leaf the interpolation stays one dynamic region -- unless
    // its checked type can only ever be one text node, which is the whole tree
    // of a conversation surface and is answered by one text node instead (F1).
    const keyed = leaves.some((leaf) => leaf.list?.key);
    const scalarText = !keyed && this.isScalarTextChild(expression);
    // A scalar region owns no child scope, so nothing inside it may address
    // one; the guard above proves nothing does.
    if (scalarText) this.currentScope = scope;
    const statements = keyed
      ? leaves.map((leaf) => this.emitDynamicChildLeaf(parent, leaf, scope, namespace))
      : scalarText
        ? [`__velarText(${parent}, () => ${this.emitMappedExpression(expression)}, ${scope});`]
        : [`__velarDynamic(${parent}, (__velarChildScope) => ${this.emitMappedExpression(expression)}, ${scope});`];
    this.currentScope = previousScope;
    this.currentJsxNamespace = previousJsxNamespace;
    return statements.join(" ");
  }

  /**
   * The two conditions for the scalar-text fast path, both of which must hold:
   * the analyzer proved the checked type renders as exactly one text node, and
   * the expression builds no JSX of its own. Everything else keeps the full
   * dynamic region, so a widening of the type rule can only ever be a
   * deliberate edit to `VelarWebAnalyzer.isScalarTextType`.
   */
  private isScalarTextChild(expression: Expression): boolean {
    return this.hints.extensionCalls.get(spanIdentity(expression.span)) === JSX_SCALAR_TEXT_HINT
      && !containsJsxExpression(expression);
  }

  private emitDynamicChildLeaf(parent: string, leaf: DynamicChildLeaf, scope: string, namespace: string): string {
    const list = leaf.list;
    if (list?.key) {
      const source = this.emitGuardedExpression(leaf.guards, this.emitMappedExpression(list.source), "[]");
      const parameter = list.arrow.parameters[0]!.name;
      const key = this.emitJsxAttributeValue(list.key);
      const render = this.emitJsx(list.arrow.body, "__velarChildScope", true, namespace);
      return `__velarKeyed(${parent}, () => ${source}, (${parameter}) => ${key}, (${parameter}, __velarChildScope) => ${render}, ${scope});`;
    }
    const value = this.emitGuardedExpression(leaf.guards, this.emitMappedExpression(leaf.expression), "null");
    return `__velarDynamic(${parent}, (__velarChildScope) => ${value}, ${scope});`;
  }

  // Wraps a leaf's expression in its branch conditions, innermost last, so the
  // leaf evaluates only while its branch is active and yields the inactive
  // placeholder ('[]' for keyed reads, 'null' for dynamic regions) otherwise.
  private emitGuardedExpression(guards: readonly DynamicChildGuard[], inner: string, inactive: string): string {
    let output = inner;
    for (let index = guards.length - 1; index >= 0; index -= 1) {
      const guard = guards[index]!;
      const condition = this.emitMappedExpression(guard.condition);
      output = guard.thenBranch
        ? `(${condition}) ? (${output}) : ${inactive}`
        : `(${condition}) ? ${inactive} : (${output})`;
    }
    return output;
  }

  /**
   * D47 rule 84(A): a bind target is a state cell, or a writable reactive
   * location inside one. A member/index path lowers to the get/set pair the
   * binding helpers already expect, so a field of state reads and writes through
   * exactly the same statements the author would have written by hand.
   */
  private emitBindTarget(value: Expression): string {
    if (value.kind === "IdentifierExpression") return value.name;
    const next: Expression = { kind: "IdentifierExpression", name: "__velarBindNext", span: value.span };
    const read = this.emitMappedExpression(value);
    const assignment = { kind: "AssignmentStatement", target: value, value: next, operator: "=", span: value.span } as unknown as Statement;
    const write = this.emitStatement(assignment, 0).trim();
    return `{ get: () => (${read}), set: (__velarBindNext) => { ${write} } }`;
  }

  private emitJsxAttributeValue(attribute: JSXAttribute): string {
    if (attribute.value === null) return "true";
    if (typeof attribute.value === "string") return JSON.stringify(attribute.value);
    return this.emitMappedExpression(attribute.value);
  }

  private emitJsxLookValue(expression: JSXElementExpression): string | null {
    const base = expression.attributes.find((attribute) => attribute.name === "look");
    const inline = expression.attributes.filter((attribute) => attribute.name.startsWith("look:"));
    const baseValue = base?.value && typeof base.value !== "string" ? this.emitMappedExpression(base.value) : null;
    if (inline.length === 0) return baseValue;
    const rules = inline.map((attribute) => {
      const property = cssPropertyName(attribute.name.slice("look:".length));
      const token = lookToken([], "", property);
      const value = attribute.value === null ? "null"
        : typeof attribute.value === "string" ? JSON.stringify(attribute.value)
          : this.emitMappedExpression(attribute.value);
      return `${JSON.stringify(token)}: ${value}`;
    });
    const anonymous = `{ rules: { ${rules.join(", ")} } }`;
    return `__velarLook([${[baseValue, anonymous].filter(Boolean).join(", ")}])`;
  }

  private emitJsxStyleValue(expression: JSXElementExpression): string | null {
    const inline = expression.attributes.filter((attribute) => attribute.name.startsWith("style:"));
    if (inline.length === 0) return null;
    const properties = inline.map((attribute) => {
      const property = cssPropertyName(attribute.name.slice("style:".length));
      const value = attribute.value === null ? "null"
        : typeof attribute.value === "string" ? JSON.stringify(attribute.value)
          : this.emitMappedExpression(attribute.value);
      return `${JSON.stringify(property)}: ${value}`;
    });
    return `{ ${properties.join(", ")} }`;
  }

  private prepareLooks(program: Program): void {
    const rules = new Map<string, LookRule>();
    const keyframeRules = new Map<string, string>();
    const keyframeCanonicals = new Map<string, string>();
    this.keyframeNames.clear();
    this.lookKeywordProperties.clear();
    // A token's stylesheet position used to be wherever it first appeared
    // anywhere in the module, because a Map keeps first-insertion order. The
    // sequence records that first appearance explicitly so emission can sort by
    // condition rank first and fall back to declaration order, rather than
    // letting an unrelated earlier look decide a later one's winner (LOK-U8).
    let sequence = 0;
    const addRule = (token: string, property: string, target: string, staticAtoms: readonly LookStaticAtom[]): void => {
      if (rules.has(token)) return;
      rules.set(token, { token, property, target, staticAtoms, sequence: sequence += 1 });
    };
    const noteKeywordProperty = (name: string): void => {
      if (LOOK_PROPERTY_VALUE_KINDS.get(name) === "keyword") this.lookKeywordProperties.add(name);
    };
    const visit = (value: unknown): void => {
      if (!value || typeof value !== "object") return;
      const record = value as Record<string, unknown>;
      if (record.kind === "ExtensionExpression:web:jsx") {
        const element = record as unknown as JSXElementExpression;
        for (const attribute of element.attributes) {
          if (!attribute.name.startsWith("look:") && !attribute.name.startsWith("style:")) continue;
          const name = attribute.name.slice(attribute.name.indexOf(":") + 1);
          if (!LOOK_PROPERTIES.has(name)) continue;
          noteKeywordProperty(name);
          if (!attribute.name.startsWith("look:")) continue;
          const property = cssPropertyName(name);
          addRule(lookToken([], "", property), property, "", []);
        }
      }
      if (record.kind === "ExtensionExpression:web:look") {
        const collect = (entries: readonly LookEntry[], contexts: readonly LookConditionTerm[] = [EMPTY_LOOK_TERM], target = ""): void => {
          for (const entry of entries) {
            if (entry.kind === "LookProperty") {
              const property = cssPropertyName(entry.name);
              noteKeywordProperty(entry.name);
              for (const context of contexts) {
                addRule(lookToken(context.staticAtoms, target, property), property, target, context.staticAtoms);
              }
            } else if (entry.kind === "LookIf") {
              collect(entry.thenEntries, combineLookTerms(contexts, lookConditionTerms(entry.condition, false, this.lookStaticValues)), target);
              collect(entry.elseEntries, combineLookTerms(contexts, lookConditionTerms(entry.condition, true, this.lookStaticValues)), target);
            } else if (entry.kind === "LookTarget") {
              collect(entry.entries, contexts, entry.name);
            }
          }
        };
        collect(record.entries as LookExpression["entries"]);
      }
      if (record.kind === "ExtensionExpression:web:keyframes") {
        const expression = record as unknown as KeyframesExpression;
        const canonical = keyframesCanonical(expression, this.lookStaticValues);
        const name = keyframesName(canonical);
        this.keyframeNames.set(spanIdentity(expression.span), name);
        const reused = keyframeCanonicals.get(name);
        // The name is a promise that equal structures share one rule. Reusing
        // it for a structure that is not equal would make one animation play
        // another's motion, so the reuse path proves the identity rather than
        // trusting the digest (LOK-U11).
        if (reused !== undefined && reused !== canonical) {
          throw new Error(`Generated keyframes name ${name} collides between two different keyframe structures`);
        }
        if (reused === undefined) {
          keyframeCanonicals.set(name, canonical);
          const stops = [...expression.stops]
            .sort((left, right) => Math.min(...left.offsets) - Math.min(...right.offsets))
            .map((stop) => {
              const selectors = [...stop.offsets].sort((left, right) => left - right)
                .map((offset) => offset === 0 ? "from" : offset === 100 ? "to" : `${offset}%`)
                .join(",");
              const declarations = stop.entries.map((entry) => {
                const css = keyframeCssValue(entry.value, this.lookStaticValues);
                // A value the lowering could not prove is one balanced
                // declaration never reaches the concatenation: `}` in a stop
                // closed the at-rule and turned the rest into author-owned CSS
                // in the compiler-owned segment (LOK-U9). The analyzer already
                // reports the same null as a diagnostic, so emission only has
                // to stay structurally incapable of writing the escape.
                return css === null || !isCssDeclarationValue(css) ? "" : `${cssPropertyName(entry.name)}:${css}`;
              }).filter(Boolean).join(";");
              return `${selectors}{${declarations}}`;
            }).join("");
          keyframeRules.set(name, `@keyframes ${name}{${stops}}`);
        }
      }
      for (const child of Object.values(record)) {
        if (Array.isArray(child)) child.forEach(visit);
        else visit(child);
      }
    };
    visit(program);

    const lookCss: string[] = [...rules.values()]
      .map((rule) => ({ rule, depth: lookConditionDepth(rule.staticAtoms) }))
      // Rank decides, and declaration order only separates rules that share a
      // rank. Emission used to follow the Map, so the sheet's byte order — and
      // through it the per-module concatenation order the CLI sorts by
      // filename — could pick the winner of a tie (LOK-U8, LOK-U10).
      .sort((left, right) => left.depth - right.depth || left.rule.sequence - right.rule.sequence)
      .map(({ rule, depth }) => {
        const hookAtoms = rule.staticAtoms.filter((atom) => atom.kind === "hook");
        const mediaAtoms = rule.staticAtoms.filter((atom) => atom.kind === "media" || atom.kind === "scheme" || atom.kind === "motion");
        const base = `[data-velar-look~=${JSON.stringify(rule.token)}]${"[data-velar-look]".repeat(depth)}`;
        const selectors = lookSelectors(base, hookAtoms, rule.target);
        const css = `${selectors.join(",")}{${lookDeclaration(rule.token, rule.property)}}`;
        const query = mediaAtoms.map(lookMediaQuery).join(" and ");
        return query ? `@media ${query}{${css}}` : css;
      });

    const before: string[] = [];
    const after: string[] = [];
    for (const statement of program.body) {
      if (!isWebStatement(statement) || statement.kind !== "ExtensionStatement:web:unsafe-css") continue;
      const source = statement.source.kind === "inline"
        ? statement.source.css
        : this.resourceContents.get(statement.source.path) ?? "";
      (statement.placement === "after" ? after : before).push(source.trim());
    }
    this.cssSegments = {
      before: before.filter(Boolean).join("\n\n"),
      controlled: [...keyframeRules.values(), ...lookCss].filter(Boolean).join("\n\n"),
      after: after.filter(Boolean).join("\n\n"),
    };
    this.cssOutput = [this.cssSegments.before, this.cssSegments.controlled, this.cssSegments.after].filter(Boolean).join("\n\n");
    if (this.cssOutput) this.cssOutput += "\n";
  }
}

function normalizeJsxText(value: string): string {
  const normalized = value.replace(/\s+/gu, " ");
  if (!value.includes("\n")) return normalized;
  return (/^\s*\n/u.test(value) ? normalized.trimStart() : normalized).replace(/\n\s*$/u.test(value) ? /\s+$/u : /$^/u, "");
}

function hasMeaningfulChildren(children: JSXElementExpression["children"]): boolean {
  return children.some((child) => child.kind !== "JSXText" || child.value.trim().length > 0);
}

export interface JsxKeyedList {
  readonly source: Expression;
  readonly arrow: Extract<Expression, { kind: "ArrowFunctionExpression" }> & { readonly body: JSXElementExpression };
  readonly key: JSXAttribute | null;
}

export interface DynamicChildGuard {
  readonly condition: Expression;
  readonly thenBranch: boolean;
}

export interface DynamicChildLeaf {
  readonly expression: Expression;
  readonly list: JsxKeyedList | null;
  readonly guards: readonly DynamicChildGuard[];
}

// The keyed-children fast path is syntactic: an interpolation leaf must be
// exactly `source.map(single-parameter arrow returning JSX)`, keyed when the
// arrow's root element carries a `key` attribute. The analyzer mirrors this
// recognizer through dynamicChildLeaves, so anything the emitter demotes to a
// rebuild-all dynamic region is diagnosed rather than silently forfeited.
export function jsxKeyedList(expression: Expression): JsxKeyedList | null {
  if (expression.kind !== "CallExpression" || expression.callee.kind !== "MemberExpression" || expression.callee.property !== "map") return null;
  const callback = expression.arguments[0];
  if (!callback || callback.kind !== "ArrowFunctionExpression" || callback.asynchronous || callback.parameters.length !== 1 || callback.body.kind !== "ExtensionExpression:web:jsx") return null;
  const arrow = callback as typeof callback & { readonly body: JSXElementExpression };
  const key = arrow.body.attributes.find((attribute) => attribute.name === "key") ?? null;
  return { source: expression.callee.object, arrow, key };
}

/**
 * F1: the analyzer's verdict that an interpolation's checked type renders as
 * exactly one text node. The emitter cannot re-derive it — the checked type is
 * gone by lowering time — so the analyzer stamps the child expression's span
 * and the emitter reads it back through the extension-hint channel that
 * `LOOK_ARITHMETIC_HINT` already uses.
 */
export const JSX_SCALAR_TEXT_HINT = "@velarscript/web:jsx-scalar-text";

/**
 * The one thing a scalar interpolation must not contain. `__velarText` owns no
 * child scope, so a nested element inside the expression — legal where a
 * function takes a `WebNode` and answers text — would have nothing to register
 * its observers and cleanups against. The type says one text node; this says
 * nothing was built to make it.
 */
function containsJsxExpression(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  if (record.kind === "ExtensionExpression:web:jsx") return true;
  return Object.values(record).some((child) => Array.isArray(child) ? child.some(containsJsxExpression) : containsJsxExpression(child));
}

// Flattens an interpolation into render leaves. A conditional contributes its
// branch leaves, each remembering the chain of branch conditions that keeps it
// active, so an empty-state ternary around a keyed list still reaches the
// keyed fast path instead of demoting every child to rebuild-all updates.
export function dynamicChildLeaves(expression: Expression, guards: readonly DynamicChildGuard[] = []): readonly DynamicChildLeaf[] {
  const list = jsxKeyedList(expression);
  if (list) return [{ expression, list, guards }];
  if (expression.kind === "ConditionalExpression") {
    return [
      ...dynamicChildLeaves(expression.thenValue, [...guards, { condition: expression.condition, thenBranch: true }]),
      ...dynamicChildLeaves(expression.elseValue, [...guards, { condition: expression.condition, thenBranch: false }]),
    ];
  }
  return [{ expression, list: null, guards }];
}

const EMPTY_LOOK_TERM: LookConditionTerm = Object.freeze({ staticAtoms: [], runtimeAtoms: [] });
const LOOK_CONDITION_TERM_LIMIT = 32;

function lookConditionTerms(
  expression: Expression,
  negated = false,
  staticValues: ReadonlyMap<string, LookStaticValue> = new Map(),
): readonly LookConditionTerm[] {
  if (expression.kind === "UnaryExpression" && expression.operator === "not") return lookConditionTerms(expression.operand, !negated, staticValues);
  if (expression.kind === "BinaryExpression" && (expression.operator === "and" || expression.operator === "or")) {
    const conjunction = (expression.operator === "and") !== negated;
    const left = lookConditionTerms(expression.left, negated, staticValues);
    const right = lookConditionTerms(expression.right, negated, staticValues);
    return conjunction ? combineLookTerms(left, right) : [...left, ...right].slice(0, LOOK_CONDITION_TERM_LIMIT);
  }
  if (isWebExpression(expression) && expression.kind === "ExtensionExpression:web:look-hook") {
    return [{ staticAtoms: [{ kind: "hook", name: expression.name, negated }], runtimeAtoms: [] }];
  }
  const media = viewportAtom(expression, negated, staticValues) ?? schemeAtom(expression, negated);
  if (media) return [{ staticAtoms: [media], runtimeAtoms: [] }];
  return [{ staticAtoms: [], runtimeAtoms: [{ expression, negated }] }];
}

// A breakpoint is complementary the way the schemes and the motion preference
// are: `not (width <= X)` is `width > X`, one condition with one media query.
// The atom therefore folds the negation into its operator at construction, so
// the two spellings reach `lookToken` as the same token instead of as two
// rules that tie on specificity and are separated by source order.
const LOOK_NEGATED_MEDIA_OPERATORS: ReadonlyMap<string, "<" | "<=" | ">" | ">="> = new Map([
  ["<", ">="], ["<=", ">"], [">", "<="], [">=", "<"],
]);

function viewportAtom(expression: Expression, negated: boolean, staticValues: ReadonlyMap<string, LookStaticValue>): LookStaticAtom | null {
  if (expression.kind !== "BinaryExpression" || !["<", "<=", ">", ">="].includes(expression.operator)) return null;
  if (expression.left.kind !== "MemberExpression" || expression.left.object.kind !== "IdentifierExpression" || expression.left.object.name !== "viewport") return null;
  if (expression.left.property !== "width" && expression.left.property !== "height") return null;
  const threshold = evaluateLookStaticExpression(expression.right, staticValues);
  if (threshold?.kind !== "unit" || !LOOK_MEDIA_LENGTH_UNITS.has(threshold.unit)) return null;
  const written = expression.operator as "<" | "<=" | ">" | ">=";
  return {
    kind: "media",
    name: expression.left.property,
    operator: negated ? LOOK_NEGATED_MEDIA_OPERATORS.get(written)! : written,
    value: lookStaticCss(threshold)!,
    negated: false,
  };
}

// 'scheme.dark' / 'scheme.light' lower to prefers-color-scheme media atoms.
// The two subjects are complementary, so negation flips to the other scheme
// and the atom itself stays canonical.
function schemeAtom(expression: Expression, negated: boolean): LookStaticAtom | null {
  if (expression.kind !== "MemberExpression" || expression.object.kind !== "IdentifierExpression") return null;
  // LOK-U3: 'motion.reduced' joins the media subjects. prefers-reduced-motion is
  // complementary in the same way the schemes are, so negation names the other
  // side of the query rather than wrapping it.
  if (expression.object.name === "motion") {
    return expression.property === "reduced" ? { kind: "motion", name: negated ? "no-preference" : "reduce", negated: false } : null;
  }
  if (expression.object.name !== "scheme") return null;
  if (expression.property !== "dark" && expression.property !== "light") return null;
  const scheme = negated ? (expression.property === "dark" ? "light" : "dark") : expression.property;
  return { kind: "scheme", name: scheme, negated: false };
}

function combineLookTerms(left: readonly LookConditionTerm[], right: readonly LookConditionTerm[]): readonly LookConditionTerm[] {
  const combined: LookConditionTerm[] = [];
  for (const first of left) {
    for (const second of right) {
      combined.push({
        staticAtoms: [...first.staticAtoms, ...second.staticAtoms],
        runtimeAtoms: [...first.runtimeAtoms, ...second.runtimeAtoms],
      });
      if (combined.length >= LOOK_CONDITION_TERM_LIMIT) return combined;
    }
  }
  return combined;
}

function lookToken(atoms: readonly LookStaticAtom[], target: string, property: string): string {
  const conditions = atoms.map((atom) => {
    if (atom.kind === "hook") return `${atom.negated ? "not-" : ""}${kebab(atom.name)}`;
    if (atom.kind === "scheme") return `scheme-${atom.name}`;
    if (atom.kind === "motion") return `motion-${atom.name}`;
    return `viewport-${atom.name}-${lookOperatorName(atom.operator!)}-${atom.value}`;
  }).sort();
  const prefix = [target ? kebab(target) : "", conditions.length > 0 ? conditions.join("+") : "base"].filter(Boolean).join(":");
  return `${prefix}:${property}`;
}

/**
 * How many extra `[data-velar-look]` selectors a rule carries, so that the
 * winner between two Look rules is decided by the conditions they name rather
 * than by their position in the sheet.
 *
 * The bump used to be a single flat `+1` for any non-empty condition set, which
 * made every conditional rule specificity `(0,2,0)`: a state rule tied with a
 * media rule, and a two-condition refinement tied with the one-condition
 * fallback it refines. Ties then fell through to source order, and source order
 * is per-module concatenation order, which the CLI sorts by filename — so the
 * rendered colour could change when a file was renamed (LOK-U8, LOK-U10,
 * LOK-U12).
 *
 * The rank is base < media < state < media+state, and within a rank a rule that
 * names more conditions outranks one that names fewer. The per-rank span is
 * bounded so a pathological condition count cannot cross a rank boundary; rules
 * that saturate it fall back to declaration order, which is stable.
 */
const LOOK_RANK_SPAN = 3;

function lookConditionDepth(atoms: readonly LookStaticAtom[]): number {
  if (atoms.length === 0) return 0;
  const hooks = atoms.filter((atom) => atom.kind === "hook").length;
  const media = atoms.length - hooks;
  const rank = hooks > 0 ? (media > 0 ? 2 : 1) : 0;
  return rank * LOOK_RANK_SPAN + Math.min(atoms.length, LOOK_RANK_SPAN);
}

function lookVariable(token: string): string {
  return `--velar-look-${token.replace(/[^A-Za-z0-9_-]+/gu, "-")}`;
}

function lookDeclaration(token: string, property: string): string {
  const value = `var(${lookVariable(token)})`;
  return `${property}:${value}`;
}

function lookOperatorName(operator: "<" | "<=" | ">" | ">="): string {
  return operator === "<" ? "lt" : operator === "<=" ? "lte" : operator === ">" ? "gt" : "gte";
}

function lookMediaQuery(atom: LookStaticAtom): string {
  if (atom.kind === "scheme") return `(prefers-color-scheme: ${atom.name})`;
  if (atom.kind === "motion") return `(prefers-reduced-motion: ${atom.name})`;
  return `(${atom.name} ${atom.operator!} ${atom.value})`;
}

function lookSelectors(base: string, atoms: readonly LookStaticAtom[], target: string): readonly string[] {
  let selectors = [base];
  for (const atom of atoms) {
    const states = lookHookSelectors(atom.name);
    if (atom.negated) {
      const condition = states.map((state) => `:not(${state})`).join("");
      selectors = selectors.map((selector) => `${selector}:where(${condition})`);
    } else {
      selectors = selectors.flatMap((selector) => states.map((state) => `${selector}:where(${state})`));
    }
  }
  const suffix = target ? LOOK_TARGET_SELECTORS.get(target) ?? `::${kebab(target)}` : "";
  return selectors.map((selector) => `${selector}${suffix}`);
}

function lookHookSelectors(name: string): readonly string[] {
  if (name === "focusVisible") return [":focus-visible"];
  if (name === "current") return ["[aria-current=\"page\"]"];
  if (name === "disabled") return [":disabled", "[aria-disabled=\"true\"]"];
  if (name === "checked") return [":checked", "[aria-checked=\"true\"]"];
  if (name === "invalid") return [":invalid", "[aria-invalid=\"true\"]"];
  if (name === "open") return [":open", "[open]", "[aria-expanded=\"true\"]"];
  return [`:${kebab(name)}`];
}

const LOOK_TARGET_SELECTORS = new Map<string, string>([
  ["before", "::before"], ["after", "::after"], ["backdrop", "::backdrop"], ["placeholder", "::placeholder"], ["selection", "::selection"],
  ["marker", "::marker"], ["fileSelectorButton", "::file-selector-button"],
]);

function kebab(value: string): string {
  return value.replace(/[A-Z]/gu, (character) => `-${character.toLowerCase()}`);
}

function visitLookExpressions(entries: readonly LookEntry[], visit: (expression: Expression) => void): void {
  for (const entry of entries) {
    if (entry.kind === "LookProperty" || entry.kind === "LookSpread") visit(entry.value);
    else if (entry.kind === "LookIf") {
      visit(entry.condition);
      visitLookExpressions(entry.thenEntries, visit);
      visitLookExpressions(entry.elseEntries, visit);
    } else visitLookExpressions(entry.entries, visit);
  }
}

function containsUnitLiteral(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  if (record.kind === "ExtensionExpression:web:unit") return true;
  for (const child of Object.values(record)) {
    if (Array.isArray(child)) {
      if (child.some(containsUnitLiteral)) return true;
    } else if (containsUnitLiteral(child)) return true;
  }
  return false;
}

function containsWebSyntax(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  if (record.kind === "ExtensionStatement:web:component" || record.kind === "ExtensionStatement:web:expose" || record.kind === "ExtensionStatement:web:unsafe-css" || record.kind === "ExtensionExpression:web:look" || record.kind === "ExtensionExpression:web:keyframes" || record.kind === "ExtensionExpression:web:jsx"
    || record.kind === "ExtensionStatement:web:state" || record.kind === "ExtensionStatement:web:computed" || record.kind === "ExtensionStatement:web:resource" || record.kind === "ExtensionStatement:web:action" || record.kind === "ExtensionStatement:web:watch") return true;
  if (record.kind === "IdentifierExpression" && (record.name === "mount" || record.name === "tick")) return true;
  return Object.values(record).some((child) => Array.isArray(child) ? child.some(containsWebSyntax) : containsWebSyntax(child));
}

/**
 * The runtime an emitted Web program carries inside itself: the foundation it
 * installs, the CSS string serializer, the closed keyword sets of the Look
 * properties *this* module styles, and the runtime body. Only the keyword table
 * differs per compilation, which is why it is the one hole
 * `runtime/manifest.json` records as an assembly (LOK-U13 keeps the serializer
 * the one css-string.ts publishes rather than a second spelling of it).
 */
function webRuntime(foundation: string, lookKeywords: string): string {
  return `${foundation}\n${CSS_STRING_RUNTIME_BODY}${lookKeywords}\n${WEB_RUNTIME_BODY}`;
}
