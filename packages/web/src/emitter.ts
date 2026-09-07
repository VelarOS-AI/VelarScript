import type {
  CompilerStyleSegments,
  CompilerEmitterOptions,
  Expression,
  Program,
  Statement,
  LoweringHints,
  ValueType,
} from "@velarscript/compiler/extension";
import { JavaScriptEmitter, spanIdentity } from "@velarscript/compiler/extension";
import { LOOK_ARITHMETIC_HINT } from "./look.ts";
import { isLookStaticValue, type LookStaticValue } from "./look-static.ts";
import { keyframesCanonical, keyframesName } from "./keyframes.ts";
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
} from "./ast.ts";
import { emitComponent, emitReactiveAssignment, type ComponentEmitHost } from "./emit/components.ts";
import { emitJsx, type JsxEmitHost } from "./emit/jsx.ts";
import { emitLook, emitLookArithmetic, prepareLooks, type LookEmitHost } from "./emit/look.ts";
import {
  additionalHelpers,
  containsUnitLiteral,
  containsWebSyntax,
  detachedTaskHelpers,
  emitIsCheck,
  emitTypeCheck,
  includesErrorNormalizationRuntime,
  reactiveBridgeHelpers,
  visitLookExpressions,
  type RuntimeImportHost,
} from "./emit/runtime-imports.ts";

// D115 P4 R3d: the JSX recognizers and the scalar-text hint are the emitter's
// vocabulary, shared with the analyzer that diagnoses what emission demotes.
// They live with the lowering that defines them and reach their existing
// importers from here, so no import path moves.
export {
  dynamicChildLeaves,
  jsxKeyedList,
  JSX_SCALAR_TEXT_HINT,
  type DynamicChildGuard,
  type DynamicChildLeaf,
  type JsxKeyedList,
} from "./emit/jsx.ts";

/**
 * Every face the emission families ask this emitter for. It is the intersection
 * of the four collaborator hosts, so adding a member to any one of them is a
 * compile error in `emitHost` until the emitter supplies it.
 */
type WebEmitHost = ComponentEmitHost & JsxEmitHost & LookEmitHost & RuntimeImportHost;

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

  /**
   * D115 P4 R3d: the four emission families this emitter owns as collaborators
   * rather than as more of itself, and the one host object they reach it
   * through. Every `protected` seam is still declared on this class, forwarding
   * to the family that owns its body, so the base emitter reaches the same seam
   * it always did.
   */
  private readonly host: WebEmitHost;

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
    this.host = this.emitHost();
  }

  override emit(program: Program): string {
    prepareLooks(this.host, program);
    this.webOutput = containsWebSyntax(program);
    this.needsFileTypeHelper = false;
    this.needsLookArithmeticRuntime = [...this.hints.extensionCalls.values()].includes(LOOK_ARITHMETIC_HINT);
    this.moduleEvaluation = true;
    return super.emit(program);
  }

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
    return emitTypeCheck(this.host, type, value, state);
  }

  protected override emitIsCheck(type: ValueType, value: string): string {
    return emitIsCheck(this.host, type, value);
  }

  protected override additionalHelpers(_program: Program): readonly string[] {
    return additionalHelpers(this.host);
  }

  protected override reactiveBridgeHelpers(
    needsJavaScriptCallBoundary: boolean,
    needsCollections: boolean,
    usedIdentifiers: ReadonlySet<string> = new Set(),
  ): readonly string[] {
    return reactiveBridgeHelpers(this.host, needsJavaScriptCallBoundary, needsCollections, usedIdentifiers);
  }

  protected override includesErrorNormalizationRuntime(): boolean {
    return includesErrorNormalizationRuntime(this.host);
  }

  protected override detachedTaskHelpers(): readonly string[] {
    return detachedTaskHelpers(this.host);
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
      if (statement.kind === "ExtensionStatement:web:component") return emitComponent(this.host, statement, depth);
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
      const reactive = emitReactiveAssignment(this.host, statement, depth);
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
      return emitLookArithmetic(this.host, expression);
    }
    if (isWebExpression(expression) && expression.kind === "ExtensionExpression:web:look-hook") return "false";
    if (isWebLook(expression)) return emitLook(this.host, expression);
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
      return emitJsx(this.host, expression, this.currentScope ?? "__velarGlobalScope", this.currentScope !== null, this.currentJsxNamespace, false);
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

  /**
   * The one object every family is handed. Its properties are live reads and
   * writes of this emitter: a family that records "this module needs the
   * file-type helper" or assigns the stylesheet must set the emitter's own
   * field, because `emit()`, `css()` and `styleSegments()` read them after
   * every family has run.
   */
  private emitHost(): WebEmitHost {
    const emitter = this;
    return {
      get currentJsxNamespace() { return emitter.currentJsxNamespace; },
      set currentJsxNamespace(value) { emitter.currentJsxNamespace = value; },
      get currentScope() { return emitter.currentScope; },
      set currentScope(value) { emitter.currentScope = value; },
      get cssOutput() { return emitter.cssOutput; },
      set cssOutput(value) { emitter.cssOutput = value; },
      get cssSegments() { return emitter.cssSegments; },
      set cssSegments(value) { emitter.cssSegments = value; },
      get hints() { return emitter.hints; },
      get importedLookStaticValues() { return emitter.importedLookStaticValues; },
      get jsxId() { return emitter.jsxId; },
      set jsxId(value) { emitter.jsxId = value; },
      get keyframeNames() { return emitter.keyframeNames; },
      get lookKeywordProperties() { return emitter.lookKeywordProperties; },
      get lookStaticValues() { return emitter.lookStaticValues; },
      set lookStaticValues(value) { emitter.lookStaticValues = value; },
      get moduleEvaluation() { return emitter.moduleEvaluation; },
      get needsFileTypeHelper() { return emitter.needsFileTypeHelper; },
      set needsFileTypeHelper(value) { emitter.needsFileTypeHelper = value; },
      get needsLookArithmeticRuntime() { return emitter.needsLookArithmeticRuntime; },
      get resourceContents() { return emitter.resourceContents; },
      get webOutput() { return emitter.webOutput; },
      baseDetachedTaskHelpers: () => super.detachedTaskHelpers(),
      baseIsCheck: (type, value) => super.emitIsCheck(type, value),
      baseReactiveBridgeHelpers: (needsJavaScriptCallBoundary, needsCollections, usedIdentifiers) =>
        super.reactiveBridgeHelpers(needsJavaScriptCallBoundary, needsCollections, usedIdentifiers),
      baseTypeCheck: (type, value, state) => super.emitTypeCheck(type, value, state),
      blockAlwaysReturns: (statements) => emitter.blockAlwaysReturns(statements),
      emitCondition: (expression) => emitter.emitCondition(expression),
      emitMappedExpression: (expression) => emitter.emitMappedExpression(expression),
      emitMappedJavaScript: (sourceSpan, render) => emitter.emitMappedJavaScript(sourceSpan, render),
      emitMappedStatement: (statement, depth) => emitter.emitMappedStatement(statement, depth),
      emitObjectKey: (name) => emitter.emitObjectKey(name),
      emitParameter: (name, defaultValue, rest) => emitter.emitParameter(name, defaultValue, rest),
      emitStatement: (statement, depth) => emitter.emitStatement(statement, depth),
      emitStatementLines: (statements, depth) => emitter.emitStatementLines(statements, depth),
      requireRuntimeModule: (source) => emitter.requireRuntimeModule(source),
      usesSharedRuntimeModules: () => emitter.usesSharedRuntimeModules(),
    };
  }
}
