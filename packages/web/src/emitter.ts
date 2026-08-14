import type {
  CompilerStyleSegments,
  CompilerEmitterOptions,
  Expression,
  Program,
  Statement,
  LoweringHints,
  ValueType,
} from "@velarscript/compiler/extension";
import { cssPropertyName, LOOK_ARITHMETIC_HINT, LOOK_MEDIA_LENGTH_UNITS, LOOK_PROPERTIES } from "./look.ts";
import { collectLookStaticValues, evaluateLookStaticExpression, isLookStaticValue, lookStaticCss, type LookStaticValue } from "./look-static.ts";
import { keyframeCssValue, keyframesCanonical, keyframesName } from "./keyframes.ts";
import { JavaScriptEmitter, spanIdentity, VELAR_ERROR_NORMALIZATION_MODULE, VELAR_RUNTIME_REGISTRY_KEY } from "@velarscript/compiler/extension";
import { WEB_RUNTIME_FOUNDATION, WEB_RUNTIME_FOUNDATION_SHARED_ERROR } from "./runtime-foundation.ts";
import {
  isWebExpression,
  isWebJsx,
  isWebKeyframes,
  isWebLook,
  isWebStatement,
  isWebUnit,
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
}

const FILE_TYPE_RUNTIME = String.raw`
function __velarFileTypeIs(value) {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, Symbol.for("velar.file.registry.v1"));
  if (!descriptor || !("value" in descriptor) || descriptor.configurable || descriptor.enumerable || descriptor.writable) return false;
  try { return WeakMap.prototype.has.call(descriptor.value, value); }
  catch { return false; }
}
`.trimStart();

const WEB_LOCAL_REACTIVE_BRIDGE_RUNTIME = String.raw`
const __velarReactiveRaw = __velarToRaw;
function __velarHostRaw(value) { return __velarToRaw(value); }
`.trimStart();

const WEB_LOCAL_REACTIVE_COLLECTION_BRIDGE_RUNTIME = String.raw`
const __velarReactiveIterateKey = Symbol.for("velar.reactive.iterate.v1");
const __velarReactiveStructureKey = Symbol.for("velar.reactive.structure.v1");
const __velarReactiveCollectionReadOperation = __velarRuntime.collectionRead;
const __velarReactiveCollectionTriggerOperation = __velarRuntime.collectionTrigger;
const __velarReactiveCollectionUnlinkOperation = __velarRuntime.collectionUnlink;
const __velarReactiveOperation = __velarRuntime.reactive;
const __velarReactiveTrackOperation = __velarRuntime.track;
function __velarReactiveCollectionRead(value, key, child) { return __velarReactiveCollectionReadOperation(value, key, child === undefined ? null : child); }
function __velarReactiveCollectionTrack(value, key = __velarReactiveIterateKey) { __velarReactiveTrackOperation(__velarToRaw(value), key); }
function __velarReactiveCollectionLink(value, child) { __velarReactiveOperation(child, __velarToRaw(value)); }
function __velarReactiveCollectionTrigger(value, key, iterate = true, structure = false, indexFrom = null, allKeys = false) { __velarReactiveCollectionTriggerOperation(value, key, iterate, structure, indexFrom, allKeys); }
function __velarReactiveCollectionUnlink(value, child) { __velarReactiveCollectionUnlinkOperation(value, child); }
`.trimStart();

export class WebJavaScriptEmitter extends JavaScriptEmitter {
  private currentScope: string | null = null;
  private currentJsxNamespace = '"html"';
  private readonly resourceContents: ReadonlyMap<string, string>;
  private cssOutput = "";
  private cssSegments: CompilerStyleSegments = { before: "", controlled: "", after: "" };
  private webOutput = false;
  private needsFileTypeHelper = false;
  private needsLookArithmeticRuntime = false;
  private readonly importedLookStaticValues: ReadonlyMap<string, LookStaticValue>;
  private lookStaticValues: ReadonlyMap<string, LookStaticValue> = new Map();
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
    return super.emit(program);
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
      ...(this.needsFileTypeHelper ? [FILE_TYPE_RUNTIME] : []),
    ];
  }

  private webRuntimeHelpers(): readonly string[] {
    if (!this.usesSharedRuntimeModules()) return [webRuntime(WEB_RUNTIME_FOUNDATION)];
    this.requireRuntimeModule(VELAR_ERROR_NORMALIZATION_MODULE);
    return [
      `import { errorApply as __velarErrorApply, errorCode as __velarErrorCode, isError as __velarIsError, normalizeError as __velarNormalizeError } from ${JSON.stringify(VELAR_ERROR_NORMALIZATION_MODULE)};`,
      webRuntime(WEB_RUNTIME_FOUNDATION_SHARED_ERROR),
    ];
  }

  protected override reactiveBridgeHelpers(needsJavaScriptCallBoundary: boolean, needsCollections: boolean): readonly string[] {
    if (this.usesSharedRuntimeModules()) return super.reactiveBridgeHelpers(needsJavaScriptCallBoundary, needsCollections);
    if (!this.webOutput) return super.reactiveBridgeHelpers(needsJavaScriptCallBoundary, needsCollections);
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
    if (statement.kind === "ExtensionStatement:web:state" || statement.kind === "ExtensionStatement:web:resource") {
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
      if (item.kind === "ExtensionStatement:web:state" || item.kind === "ExtensionStatement:web:resource") visitExpression(item.initializer);
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

  protected override extensionExpressionContainsDirectAwait(expression: Expression): boolean | undefined {
    if (isWebUnit(expression)) return false;
    if (isWebKeyframes(expression)) return expression.stops.some((stop) => stop.entries.some((entry) => this.expressionContainsDirectAwait(entry.value)));
    if (isWebLook(expression)) return lookExpressions(expression.entries).some((value) => this.expressionContainsDirectAwait(value));
    if (!isWebJsx(expression)) return undefined;
    return expression.attributes.some((attribute) => typeof attribute.value !== "string"
      && attribute.value !== null
      && this.expressionContainsDirectAwait(attribute.value))
      || expression.children.some((child) => child.kind === "JSXExpressionChild"
        ? this.expressionContainsDirectAwait(child.expression)
        : child.kind === "ExtensionExpression:web:jsx" && this.expressionContainsDirectAwait(child));
  }

  protected override emitStatement(statement: Statement, depth: number): string {
    if (isWebStatement(statement)) {
      if (statement.kind === "ExtensionStatement:web:unsafe-css") return "";
      if (statement.kind === "ExtensionStatement:web:component") return this.emitComponent(statement, depth);
      if (statement.kind === "ExtensionStatement:web:state") {
        const indentation = "  ".repeat(depth);
        return `${indentation}${statement.exported ? "export " : ""}const ${statement.name} = __velarState(${this.emitMappedExpression(statement.initializer)});`;
      }
      if (statement.kind === "ExtensionStatement:web:resource") return "";
      if (statement.kind === "ExtensionStatement:web:action") {
        // A module action wires the same reactive pending/error cells as a
        // component action, but it lives in the never-destroyed global scope, so
        // its lifetime is the module and no component disposal applies.
        const indentation = "  ".repeat(depth);
        const parameters = statement.parameters.map((parameter) => this.emitParameter(parameter.name, parameter.defaultValue, parameter.rest)).join(", ");
        const actionLines = statement.body.map((child) => this.emitMappedStatement(child, depth + 1)).filter(Boolean);
        if (!this.blockAlwaysReturns(statement.body)) actionLines.push(`${"  ".repeat(depth + 1)}return null;`);
        const actionBody = actionLines.join("\n");
        return `${indentation}${statement.exported ? "export " : ""}const ${statement.name} = __velarAction(async (${parameters}) => {${actionBody ? `\n${actionBody}\n${indentation}` : ""}}, __velarGlobalScope, ${JSON.stringify(statement.name)});`;
      }
      if (statement.kind === "ExtensionStatement:web:watch") {
        const indentation = "  ".repeat(depth);
        const parameters = [statement.currentName, statement.previousName].filter((name): name is string => name !== null).join(", ");
        const body = statement.body.map((child) => this.emitMappedStatement(child, depth + 1)).filter(Boolean).join("\n");
        return `${indentation}__velarWatch(() => ${this.emitMappedExpression(statement.expression)}, (${parameters}) => {${body ? `\n${body}\n${indentation}` : ""}}, __velarGlobalScope);`;
      }
    }
    if (statement.kind === "AssignmentStatement") {
      const reactive = this.emitReactiveAssignment(statement, depth);
      if (reactive) return reactive;
    }
    return super.emitStatement(statement, depth);
  }

  protected override emitExpression(expression: Expression): string {
    if (isWebUnit(expression)) return JSON.stringify(expression.raw);
    if (isWebKeyframes(expression)) {
      const name = this.keyframeNames.get(spanIdentity(expression.span)) ?? keyframesName(keyframesCanonical(expression));
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
    if (expression.kind === "IdentifierExpression") {
      if (this.hints.reactiveReferences.has(spanIdentity(expression.span))) {
        return `${expression.name}.get()`;
      }
      if (expression.name === "mount") return "__velarMount";
      if (expression.name === "tick") return "__velarTick";
      if (expression.name === "computed") return "__velarRuntime.computed";
      const controlled = this.hints.extensionLiterals.get(spanIdentity(expression.span));
      if (controlled !== undefined) return JSON.stringify(controlled);
    }
    if (isWebJsx(expression)) {
      return this.emitJsx(expression, this.currentScope ?? "__velarGlobalScope", this.currentScope !== null, this.currentJsxNamespace, false);
    }
    if (expression.kind === "CallExpression" && expression.callee.kind === "IdentifierExpression"
      && expression.callee.name === "mount" && expression.arguments.length === 2) {
      const sourceArguments = expression.arguments.map((argument) => this.emitMappedExpression(argument));
      const namedOrder = this.hints.namedArgumentOrders.get(spanIdentity(expression.span));
      const arguments_ = namedOrder
        ? namedOrder.map((source) => source === -1 ? "undefined" : `$velarNamedArguments[${source}]`)
        : sourceArguments;
      const evaluated = namedOrder
        ? `(($velarNamedArguments) => [${arguments_.join(", ")}])([${sourceArguments.join(", ")}])`
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
    this.currentScope = "$velarScope";
    this.currentJsxNamespace = "$velarNamespace";
    // Props are live reactive inputs: every parameter becomes a read-only
    // handle over the per-instance props store, so prop reads lower through
    // .get() exactly like state reads do.
    const lines: string[] = [];
    for (const parameter of statement.parameters) {
      if (parameter.defaultValue) {
        lines.push(`${bodyIndent}const ${parameter.name} = __velarProp($velarProps, ${JSON.stringify(parameter.name)}, () => (${this.emitMappedExpression(parameter.defaultValue)}));`);
      } else {
        lines.push(`${bodyIndent}const ${parameter.name} = __velarRequiredProp($velarProps, ${JSON.stringify(parameter.name)}, ${JSON.stringify(statement.name)});`);
      }
    }
    let render: Expression | null = null;
    let expose: Expression | null = null;
    let mountedBody: readonly Statement[] = [];
    let cleanupBody: readonly Statement[] = [];
    for (const item of statement.body) {
      if (item.kind === "ExtensionStatement:web:state") {
        lines.push(`${bodyIndent}const ${item.name} = __velarState(${this.emitMappedExpression(item.initializer)});`);
      } else if (item.kind === "ExtensionStatement:web:resource") {
        lines.push(`${bodyIndent}const ${item.name} = __velarResource(() => ${this.emitMappedExpression(item.initializer)}, $velarScope, ${JSON.stringify(item.name)});`);
      } else if (item.kind === "ExtensionStatement:web:action") {
        const parameters = item.parameters.map((parameter) => this.emitParameter(parameter.name, parameter.defaultValue, parameter.rest)).join(", ");
        const actionLines = item.body.map((child) => this.emitMappedStatement(child, depth + 3)).filter(Boolean);
        if (!this.blockAlwaysReturns(item.body)) actionLines.push(`${"  ".repeat(depth + 3)}return null;`);
        const actionBody = actionLines.join("\n");
        lines.push(`${bodyIndent}const ${item.name} = __velarAction(async (${parameters}) => {${actionBody ? `\n${actionBody}\n${bodyIndent}` : ""}}, $velarScope, ${JSON.stringify(item.name)});`);
      } else if (item.kind === "ExtensionStatement:web:watch") {
        const parameters = [item.currentName, item.previousName].filter((name): name is string => name !== null).join(", ");
        const watchLines = item.body.map((child) => this.emitMappedStatement(child, depth + 3)).filter(Boolean).join("\n");
        lines.push(`${bodyIndent}__velarWatch(() => ${this.emitMappedExpression(item.expression)}, (${parameters}) => {${watchLines ? `\n${watchLines}\n${bodyIndent}` : ""}}, $velarScope);`);
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
        this.currentScope = "$velarDynamicScope";
        try {
          renderedRoot = `__velarDynamicComponent(($velarDynamicScope) => ${this.emitMappedExpression(render)}, $velarScope)`;
        } finally {
          this.currentScope = rootScope;
        }
      }
    }
    lines.push(`${bodyIndent}const $velarRoot = ${renderedRoot};`);
    lines.push(`${bodyIndent}const $velarHandle = ${expose ? `__velarComponentHandle(${this.emitMappedExpression(expose)}, ${JSON.stringify(statement.name)})` : "null"};`);
    lines.push(`${bodyIndent}if ($velarProps.class !== undefined) __velarClassBindRoot($velarRoot, () => $velarProps.class, $velarScope);`);
    lines.push(`${bodyIndent}if ($velarProps.look !== undefined) __velarLookBindRoot($velarRoot, () => $velarProps.look, $velarScope);`);
    lines.push(`${bodyIndent}if ($velarProps.__velarStyle !== undefined) __velarStyleBindRoot($velarRoot, () => $velarProps.__velarStyle, $velarScope);`);
    const mounted = mountedBody.map((child) => this.emitMappedStatement(child, depth + 3)).filter(Boolean).join("\n");
    const cleanup = cleanupBody.map((child) => {
      if (["VariableDeclaration", "FunctionDeclaration", "ClassDeclaration", "TypeDeclaration", "EnumDeclaration"].includes(child.kind)) {
        return this.emitMappedStatement(child, depth + 3);
      }
      const inner = this.emitMappedStatement(child, depth + 4);
      if (!inner) return "";
      const cleanupIndent = "  ".repeat(depth + 3);
      return `${cleanupIndent}__velarCleanupStep(() => {\n${inner}\n${cleanupIndent}}, $velarScope);`;
    }).filter(Boolean).join("\n");
    const cleanupBodyText = `() => {${cleanup ? `\n${cleanup}\n${bodyIndent}` : ""}}`;
    const functionLines = [
      `${outerIndent}const $velarScope = __velarScope(${JSON.stringify(statement.name)});`,
      `${outerIndent}let $velarConstructionCleanup = () => {};`,
      `${outerIndent}try {`,
      `${bodyIndent}$velarConstructionCleanup = ${cleanupBodyText};`,
      ...lines,
      `${bodyIndent}return __velarComponent($velarRoot, $velarScope, async () => {${mounted ? `\n${mounted}\n${bodyIndent}` : ""}}, $velarConstructionCleanup, $velarHandle);`,
      `${outerIndent}} catch ($velarConstructionError) {`,
      `${bodyIndent}try { $velarConstructionCleanup(); } catch ($velarCleanupError) { __velarReport($velarCleanupError, "cleanup", $velarScope); }`,
      `${bodyIndent}__velarDestroyScope($velarScope);`,
      `${bodyIndent}throw $velarConstructionError;`,
      `${outerIndent}}`,
    ];

    this.currentScope = previousScope;
    this.currentJsxNamespace = previousJsxNamespace;
    return `${indentation}${statement.exported ? "export " : ""}function ${statement.name}($velarProps = {}, $velarNamespace = "html") {\n${functionLines.filter(Boolean).join("\n")}\n${indentation}}`;
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
      const componentScope = reactiveComponent ? "$velarDynamicScope" : scope;
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
        // component function.
        const children = hasMeaningfulChildren(expression.children)
          ? `() => (${this.emitJsxChildren(expression.children, componentScope, namespace)})`
          : "undefined";
        const ref = expression.attributes.find((attribute) => attribute.name === "ref")?.value;
        const refSetter = ref && typeof ref !== "string" && ref.kind === "IdentifierExpression"
          ? `(next, previous) => { if (previous === undefined || ${ref.name} === previous) ${ref.name} = next; }`
          : null;
        const component = reactiveComponent ? `${expression.tag}.get()` : expression.tag;
        const arguments_ = `${component}, { ${properties.join(", ")} }, ${children}, ${componentScope}, ${namespace}${refSetter ? `, ${refSetter}` : ""}`;
        if (reactiveComponent) {
          return `__velarDynamicComponent(($velarDynamicScope) => __velarChild(${arguments_}), ${scope})`;
        }
        return asChild ? `__velarChild(${arguments_})` : `__velarInstantiate(${arguments_})`;
      } finally {
        this.currentScope = previousScope;
      }
    }

    const id = ++this.jsxId;
    const element = `$velarElement${id}`;
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

  private emitDynamicChild(parent: string, expression: Expression, scope: string, namespace: string): string {
    const leaves = dynamicChildLeaves(expression);
    const previousScope = this.currentScope;
    const previousJsxNamespace = this.currentJsxNamespace;
    this.currentScope = "$velarChildScope";
    this.currentJsxNamespace = namespace;
    // A conditional splits into one region per branch leaf only when a keyed
    // list is somewhere among them; each region gates itself on the shared
    // branch conditions, so at most one region renders content at a time and
    // the keyed list keeps identity-preserving children across the branch flip.
    // Without a keyed leaf the interpolation stays one dynamic region.
    const statements = leaves.some((leaf) => leaf.list?.key)
      ? leaves.map((leaf) => this.emitDynamicChildLeaf(parent, leaf, scope, namespace))
      : [`__velarDynamic(${parent}, ($velarChildScope) => ${this.emitMappedExpression(expression)}, ${scope});`];
    this.currentScope = previousScope;
    this.currentJsxNamespace = previousJsxNamespace;
    return statements.join(" ");
  }

  private emitDynamicChildLeaf(parent: string, leaf: DynamicChildLeaf, scope: string, namespace: string): string {
    const list = leaf.list;
    if (list?.key) {
      const source = this.emitGuardedExpression(leaf.guards, this.emitMappedExpression(list.source), "[]");
      const parameter = list.arrow.parameters[0]!.name;
      const key = this.emitJsxAttributeValue(list.key);
      const render = this.emitJsx(list.arrow.body, "$velarChildScope", true, namespace);
      return `__velarKeyed(${parent}, () => ${source}, (${parameter}) => ${key}, (${parameter}, $velarChildScope) => ${render}, ${scope});`;
    }
    const value = this.emitGuardedExpression(leaf.guards, this.emitMappedExpression(leaf.expression), "null");
    return `__velarDynamic(${parent}, ($velarChildScope) => ${value}, ${scope});`;
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
    const next: Expression = { kind: "IdentifierExpression", name: "$velarBindNext", span: value.span };
    const read = this.emitMappedExpression(value);
    const assignment = { kind: "AssignmentStatement", target: value, value: next, operator: "=", span: value.span } as unknown as Statement;
    const write = this.emitStatement(assignment, 0).trim();
    return `{ get: () => (${read}), set: ($velarBindNext) => { ${write} } }`;
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
    this.keyframeNames.clear();
    const visit = (value: unknown): void => {
      if (!value || typeof value !== "object") return;
      const record = value as Record<string, unknown>;
      if (record.kind === "ExtensionExpression:web:jsx") {
        const element = record as unknown as JSXElementExpression;
        for (const attribute of element.attributes) {
          if (!attribute.name.startsWith("look:")) continue;
          const name = attribute.name.slice("look:".length);
          if (!LOOK_PROPERTIES.has(name)) continue;
          const property = cssPropertyName(name);
          const token = lookToken([], "", property);
          rules.set(token, { token, property, target: "", staticAtoms: [] });
        }
      }
      if (record.kind === "ExtensionExpression:web:look") {
        const collect = (entries: readonly LookEntry[], contexts: readonly LookConditionTerm[] = [EMPTY_LOOK_TERM], target = ""): void => {
          for (const entry of entries) {
            if (entry.kind === "LookProperty") {
              const property = cssPropertyName(entry.name);
              for (const context of contexts) {
                const token = lookToken(context.staticAtoms, target, property);
                rules.set(token, { token, property, target, staticAtoms: context.staticAtoms });
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
        const canonical = keyframesCanonical(expression);
        const name = keyframesName(canonical);
        this.keyframeNames.set(spanIdentity(expression.span), name);
        if (!keyframeRules.has(name)) {
          const stops = [...expression.stops]
            .sort((left, right) => Math.min(...left.offsets) - Math.min(...right.offsets))
            .map((stop) => {
              const selectors = [...stop.offsets].sort((left, right) => left - right)
                .map((offset) => offset === 0 ? "from" : offset === 100 ? "to" : `${offset}%`)
                .join(",");
              const declarations = stop.entries.map((entry) => {
                const css = keyframeCssValue(entry.value);
                return css === null ? "" : `${cssPropertyName(entry.name)}:${css}`;
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

    const lookCss: string[] = [];
    for (const rule of rules.values()) {
      const hookAtoms = rule.staticAtoms.filter((atom) => atom.kind === "hook");
      const mediaAtoms = rule.staticAtoms.filter((atom) => atom.kind === "media" || atom.kind === "scheme" || atom.kind === "motion");
      const base = `[data-velar-look~=${JSON.stringify(rule.token)}]${rule.staticAtoms.length > 0 ? "[data-velar-look]" : ""}`;
      const selectors = lookSelectors(base, hookAtoms, rule.target);
      const css = `${selectors.join(",")}{${lookDeclaration(rule.token, rule.property)}}`;
      const query = mediaAtoms.map(lookMediaQuery).join(" and ");
      lookCss.push(query ? `@media ${query}{${css}}` : css);
    }

    const before: string[] = [];
    const after: string[] = [];
    for (const statement of program.body) {
      if (!isWebStatement(statement) || statement.kind !== "ExtensionStatement:web:unsafe-css") continue;
      const source = this.resourceContents.get(statement.source) ?? "";
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

function viewportAtom(expression: Expression, negated: boolean, staticValues: ReadonlyMap<string, LookStaticValue>): LookStaticAtom | null {
  if (expression.kind !== "BinaryExpression" || !["<", "<=", ">", ">="].includes(expression.operator)) return null;
  if (expression.left.kind !== "MemberExpression" || expression.left.object.kind !== "IdentifierExpression" || expression.left.object.name !== "viewport") return null;
  if (expression.left.property !== "width" && expression.left.property !== "height") return null;
  const threshold = evaluateLookStaticExpression(expression.right, staticValues);
  if (threshold?.kind !== "unit" || !LOOK_MEDIA_LENGTH_UNITS.has(threshold.unit)) return null;
  return {
    kind: "media",
    name: expression.left.property,
    operator: expression.operator as "<" | "<=" | ">" | ">=",
    value: lookStaticCss(threshold)!,
    negated,
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
    return `viewport-${atom.name}-${atom.negated ? "not-" : ""}${lookOperatorName(atom.operator!)}-${atom.value}`;
  }).sort();
  const prefix = [target ? kebab(target) : "", conditions.length > 0 ? conditions.join("+") : "base"].filter(Boolean).join(":");
  return `${prefix}:${property}`;
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
  const operator = atom.negated
    ? atom.operator === "<" ? ">=" : atom.operator === "<=" ? ">" : atom.operator === ">" ? "<=" : "<"
    : atom.operator!;
  return `(${atom.name} ${operator} ${atom.value})`;
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

function lookExpressions(entries: readonly LookEntry[]): readonly Expression[] {
  const output: Expression[] = [];
  visitLookExpressions(entries, (expression) => output.push(expression));
  return output;
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
    || record.kind === "ExtensionStatement:web:state" || record.kind === "ExtensionStatement:web:resource" || record.kind === "ExtensionStatement:web:action" || record.kind === "ExtensionStatement:web:watch") return true;
  if (record.kind === "IdentifierExpression" && (record.name === "mount" || record.name === "tick" || record.name === "computed")) return true;
  return Object.values(record).some((child) => Array.isArray(child) ? child.some(containsWebSyntax) : containsWebSyntax(child));
}

const LOOK_ARITHMETIC_RUNTIME = String.raw`
function __velarLookDimension(value) {
  if (typeof value !== "string") return null;
  const match = /^([+-]?(?:\d+(?:\.\d+)?|\.\d+))(px|rem|em|vw|vh|vmin|vmax|%|fr|ms|s|deg|turn)$/.exec(value);
  if (!match) return null;
  const number = Number(match[1]);
  return Number.isFinite(number) ? { number, unit: match[2] } : null;
}

function __velarLookNumber(value, label) {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new TypeError(label + " must be a finite number");
  return value;
}

function __velarLookDimensionResult(number, unit) {
  if (!Number.isFinite(number)) throw new RangeError("Look arithmetic must produce a finite value");
  return String(Object.is(number, -0) ? 0 : number) + unit;
}

function __velarLookConvertibleDimension(value) {
  if (value.unit === "s") return { number: value.number * 1000, unit: "ms" };
  if (value.unit === "turn") return { number: value.number * 360, unit: "deg" };
  return value;
}

function __velarLookUnary(operator, value) {
  if (typeof value === "number") return operator === "-" ? -__velarLookNumber(value, "Look operand") : __velarLookNumber(value, "Look operand");
  if (typeof value !== "string") throw new TypeError("Look unit arithmetic requires a number or typed visual value");
  if (operator === "+") return value;
  const dimension = __velarLookDimension(value);
  if (dimension) return __velarLookDimensionResult(-dimension.number, dimension.unit);
  return "calc(-1 * (" + value + "))";
}

function __velarLookMath(operator, left, right) {
  if (typeof left === "number" && typeof right === "number") {
    const first = __velarLookNumber(left, "Left Look operand");
    const second = __velarLookNumber(right, "Right Look operand");
    if (operator === "/" && second === 0) throw new RangeError("Look division cannot use zero");
    const result = operator === "+" ? first + second : operator === "-" ? first - second : operator === "*" ? first * second : first / second;
    return __velarLookNumber(result, "Look arithmetic result");
  }
  const leftDimension = __velarLookDimension(left);
  const rightDimension = __velarLookDimension(right);
  if ((operator === "+" || operator === "-") && leftDimension && rightDimension) {
    const first = __velarLookConvertibleDimension(leftDimension);
    const second = __velarLookConvertibleDimension(rightDimension);
    if (first.unit === second.unit) {
      return __velarLookDimensionResult(operator === "+" ? first.number + second.number : first.number - second.number, first.unit);
    }
  }
  if (operator === "*" && leftDimension && typeof right === "number") {
    return __velarLookDimensionResult(leftDimension.number * __velarLookNumber(right, "Right Look operand"), leftDimension.unit);
  }
  if (operator === "*" && typeof left === "number" && rightDimension) {
    return __velarLookDimensionResult(__velarLookNumber(left, "Left Look operand") * rightDimension.number, rightDimension.unit);
  }
  if (operator === "/" && leftDimension && typeof right === "number") {
    const divisor = __velarLookNumber(right, "Right Look operand");
    if (divisor === 0) throw new RangeError("Look unit division cannot use zero");
    return __velarLookDimensionResult(leftDimension.number / divisor, leftDimension.unit);
  }
  if ((typeof left !== "string" && typeof left !== "number") || (typeof right !== "string" && typeof right !== "number")) {
    throw new TypeError("Look unit arithmetic requires numbers or typed visual values");
  }
  return "calc(" + left + " " + operator + " " + right + ")";
}
`.trimStart();

const WEB_RUNTIME_BODY = String.raw`
function __velarReport(value, phase, scope = null, detail = "", unhandled = true) {
  return __velarRuntime.report(value, { phase, detail, component: scope ? scope.component : "", unhandled });
}

function __velarReportEvent(value, scope, detail) {
  if (__velarIsError(value) && __velarGraphWeakSetRemove(__velarRuntime.actionFailures, value)) return null;
  return __velarReport(value, "event", scope, detail);
}

const __velarWebIterateKey = Symbol.for("velar.reactive.iterate.v1");
const __velarWebNativeJson = globalThis.JSON;
const __velarWebJsonText = Object.getOwnPropertyDescriptor(__velarWebNativeJson, "stringify")?.value;
const __velarEventReflectApply = Object.getOwnPropertyDescriptor(Reflect, "apply")?.value;
const __velarEventConstructorDescriptor = Object.getOwnPropertyDescriptor(globalThis, "Event");
const __velarEventConstructor = __velarEventConstructorDescriptor && "value" in __velarEventConstructorDescriptor ? __velarEventConstructorDescriptor.value : null;
const __velarEventPrototype = typeof __velarEventConstructor === "function" ? Object.getOwnPropertyDescriptor(__velarEventConstructor, "prototype")?.value : null;
const __velarEventTargetGetter = __velarEventPrototype && Object.getOwnPropertyDescriptor(__velarEventPrototype, "target")?.get;
const __velarEventPreventDefault = __velarEventPrototype && Object.getOwnPropertyDescriptor(__velarEventPrototype, "preventDefault")?.value;
const __velarEventStopPropagation = __velarEventPrototype && Object.getOwnPropertyDescriptor(__velarEventPrototype, "stopPropagation")?.value;
const __velarEventMissingField = __velarGraphFreeze({});
function __velarQuotedText(value) {
  return __velarGraphApply(__velarWebJsonText, __velarWebNativeJson, [value], "JSON.stringify");
}
function __velarAppendOwned(values, value) {
  values[values.length] = value;
  return value;
}
function __velarHasName(values, name) {
  for (let index = 0; index < values.length; index += 1) if (values[index] === name) return true;
  return false;
}
function __velarEventField(value, name, nativeGetter) {
  if (typeof nativeGetter === "function" && typeof __velarEventReflectApply === "function") {
    try { return __velarEventReflectApply(nativeGetter, value, []); } catch {}
  }
  if (value === null || (typeof value !== "object" && typeof value !== "function")) return __velarEventMissingField;
  const descriptor = __velarGraphOwnDescriptor(value, name);
  return descriptor?.enumerable && "value" in descriptor ? descriptor.value : __velarEventMissingField;
}
function __velarEventCall(value, name, nativeMethod) {
  if (typeof nativeMethod === "function" && typeof __velarEventReflectApply === "function") {
    try { return __velarEventReflectApply(nativeMethod, value, []); } catch {}
  }
  const method = __velarEventField(value, name, null);
  if (typeof method !== "function" || typeof __velarEventReflectApply !== "function") throw new TypeError("DOM event does not expose native " + name);
  return __velarEventReflectApply(method, value, []);
}

// This scheduler has a twin inside the runtime registry (runtime.schedule in
// packages/web/src/runtime-foundation.ts) so registry-owned computed
// observers schedule correctly no matter which module stamped the registry.
// Both sides drain the same shared queues under the shared flushPending flag;
// their budgets and overflow behavior must stay identical.
function __velarSchedule(observer) {
  const queue = observer.mode === "watch" ? __velarRuntime.watchQueue : __velarRuntime.domQueue;
  if (!__velarGraphSetContains(queue, observer) && __velarGraphSetCount(queue) >= 100000) throw new RangeError("VelarScript reactive queues cannot exceed 100000 observers");
  __velarGraphSetInsert(queue, observer);
  if (!__velarRuntime.flushPending) {
    __velarRuntime.flushPending = true;
    __velarEnqueue(__velarFlush);
  }
}

// Both queues are drained live: an observer that re-schedules itself or another
// observer is picked up by the same walk. Two observers that invalidate each
// other therefore never leave this function, which froze the page with nothing
// on the error channel. The per-flush budget gives that case the same owned
// ending as the single-observer cap: stop the observers still queued, report
// once through velar/app, and let the turn finish.
function __velarFlushOverflow() {
  const stalled = [];
  for (const observer of __velarGraphSetItems(__velarRuntime.domQueue)) stalled[stalled.length] = observer;
  for (const observer of __velarGraphSetItems(__velarRuntime.watchQueue)) stalled[stalled.length] = observer;
  __velarGraphSetEmpty(__velarRuntime.domQueue);
  __velarGraphSetEmpty(__velarRuntime.watchQueue);
  for (let index = 0; index < stalled.length; index += 1) {
    const observer = stalled[index];
    if (typeof observer.stop === "function") observer.stop();
    else observer.stopped = true;
  }
  __velarReport(new RangeError("Reactive updates cannot run more than 100000 observers in one flush"), "update", null);
}

function __velarFlush() {
  __velarRuntime.flushPending = false;
  let budget = 100000;
  for (const observer of __velarGraphSetItems(__velarRuntime.domQueue)) {
    __velarGraphSetRemove(__velarRuntime.domQueue, observer);
    if ((budget -= 1) < 0) { __velarFlushOverflow(); return; }
    observer.run();
  }
  for (const observer of __velarGraphSetItems(__velarRuntime.watchQueue)) {
    __velarGraphSetRemove(__velarRuntime.watchQueue, observer);
    if ((budget -= 1) < 0) { __velarFlushOverflow(); return; }
    observer.run();
  }
  if (__velarGraphSetCount(__velarRuntime.domQueue) || __velarGraphSetCount(__velarRuntime.watchQueue)) __velarScheduleFlush();
}

function __velarScheduleFlush() {
  if (!__velarRuntime.flushPending) { __velarRuntime.flushPending = true; __velarEnqueue(__velarFlush); }
}

function __velarTrack(subscribers) {
  __velarRuntime.trackSubscribers(subscribers);
}

function __velarToRaw(value) { return __velarRuntime.toRaw(value); }
function __velarReactive(value, parent = null) { return __velarRuntime.reactive(value, parent); }

function __velarWebListPop(value, requested = -1) {
  return __velarReactive(__velarListPop(value, requested));
}

function __velarUntracked(read) {
  const previous = __velarRuntime.activeObserver;
  __velarRuntime.activeObserver = null;
  try { return read(); } finally { __velarRuntime.activeObserver = previous; }
}

function __velarCleanupObserver(observer) {
  __velarRuntime.cleanupObserver(observer);
}

function __velarObserver(read, mode, scope) {
  // The first run of a DOM observer executes while its JSX position is being
  // constructed, and construction is transactional: the failure must reach
  // the surrounding owner (the mount transaction at the root, the containing
  // child position otherwise) so the promised fatal state or contained
  // placeholder appears instead of a silently empty region. Later runs are
  // updates; their failures are reported and the last valid DOM survives.
  let initial = mode === "dom";
  const observer = {
    mode,
    stopped: false,
    running: false,
    selfInvalidations: 0,
    dependencies: __velarGraphCreateSet(),
    run() {
      if (observer.stopped) return;
      observer.running = true;
      try { __velarRuntime.runTracked(observer, read); }
      catch (error) {
        if (initial) throw error;
        __velarReport(error, mode === "watch" ? "watch" : "render", scope);
      }
      finally {
        observer.running = false;
        initial = false;
      }
    },
    notify() {
      if (observer.stopped) return;
      if (observer.running) {
        observer.selfInvalidations += 1;
        if (observer.selfInvalidations > 100) {
          observer.stop();
          __velarReport(new RangeError("A reactive render cannot invalidate itself more than 100 times"), mode === "watch" ? "watch" : "render", scope);
          return;
        }
      } else {
        observer.selfInvalidations = 0;
      }
      __velarSchedule(observer);
    },
    stop() { observer.stopped = true; __velarCleanupObserver(observer); },
  };
  __velarAppendOwned(scope.cleanups, () => observer.stop());
  observer.run();
  return observer;
}

function __velarState(initial) {
  let value = __velarToRaw(initial);
  const subscribers = __velarGraphCreateSet();
  const cell = {
    get() { __velarTrack(subscribers); return __velarReactive(value, cell); },
    set(next) {
      next = __velarToRaw(next);
      if (__velarGraphSame(value, next)) return next;
      const previous = value;
      value = next;
      // Keep deep-change bubbling attached only to the value currently owned
      // by this cell. Otherwise every replaced object remains linked to the
      // state cell and continues to occupy the parent graph indefinitely.
      __velarRuntime.collectionUnlink(cell, previous);
      __velarReactive(value, cell);
      for (const observer of __velarGraphSetItems(subscribers)) observer.notify();
      return next;
    },
  };
  __velarReactive(value, cell);
  return cell;
}

const __velarManagedAsyncNativePromise = globalThis.Promise;
const __velarManagedAsyncPromisePrototype = __velarGraphOwnDescriptor(__velarManagedAsyncNativePromise, "prototype")?.value;
const __velarManagedAsyncResolveOperation = __velarGraphOwnDescriptor(__velarManagedAsyncNativePromise, "resolve")?.value;
const __velarManagedAsyncRejectOperation = __velarGraphOwnDescriptor(__velarManagedAsyncNativePromise, "reject")?.value;
const __velarManagedAsyncThenOperation = __velarManagedAsyncPromisePrototype
  ? __velarGraphOwnDescriptor(__velarManagedAsyncPromisePrototype, "then")?.value
  : null;
function __velarManagedAsyncResolve(value) {
  return __velarGraphApply(__velarManagedAsyncResolveOperation, __velarManagedAsyncNativePromise, [value], "Promise.resolve");
}
function __velarManagedAsyncReject(error) {
  return __velarGraphApply(__velarManagedAsyncRejectOperation, __velarManagedAsyncNativePromise, [error], "Promise.reject");
}
function __velarManagedAsyncThen(value, fulfilled, rejected) {
  return __velarGraphApply(__velarManagedAsyncThenOperation, value, [fulfilled, rejected], "Promise.then");
}
function __velarManagedAsyncCreate(executor) {
  if (typeof __velarManagedAsyncNativePromise !== "function") throw new TypeError("The JavaScript Promise API is unavailable");
  return new __velarManagedAsyncNativePromise(executor);
}

function __velarResource(load, scope, name) {
  const value = __velarState(null);
  const loading = __velarState(true);
  const ready = __velarState(false);
  const error = __velarState(null);
  let generation = 0;
  let started = false;
  let disposed = false;

  const reload = () => {
    if (disposed) return __velarManagedAsyncResolve(null);
    started = true;
    const current = ++generation;
    loading.set(true);
    error.set(null);
    return __velarManagedAsyncThen(__velarManagedAsyncThen(__velarManagedAsyncResolve(), load),
      (next) => {
        if (disposed || current !== generation) return null;
        value.set(next);
        ready.set(true);
        loading.set(false);
        return null;
      },
      (failure) => {
        if (disposed || current !== generation) return null;
        const report = __velarRuntime.report(failure, { phase: "resource", detail: name, component: scope.component, unhandled: false });
        error.set(report.error);
        ready.set(true);
        loading.set(false);
        return null;
      },
    );
  };

  __velarAppendOwned(scope.mounts, () => started ? null : reload());
  __velarAppendOwned(scope.cleanups, () => { disposed = true; generation += 1; });
  return __velarGraphFreeze({
    get value() { return value.get(); },
    get loading() { return loading.get(); },
    get ready() { return ready.get(); },
    get error() { return error.get(); },
    reload,
  });
}

function __velarAction(execute, scope, name) {
  const pending = __velarState(false);
  const error = __velarState(null);
  let active = 0;
  let generation = 0;
  let disposed = false;

  const run = (...arguments_) => {
    if (disposed) return __velarManagedAsyncReject(__velarNormalizeError(
      "Action '" + name + "' cannot run after its component is destroyed",
    ));
    const current = ++generation;
    active += 1;
    pending.set(true);
    error.set(null);
    return __velarManagedAsyncThen(__velarManagedAsyncThen(__velarManagedAsyncResolve(), () => __velarGraphApply(execute, null, arguments_, "action body")),
      (value) => {
        active -= 1;
        if (!disposed) pending.set(active > 0);
        return value;
      },
      (failure) => {
        active -= 1;
        let actionError = __velarNormalizeError(failure);
        if (!disposed) {
          pending.set(active > 0);
          // Every action failure reports exactly once, through the action
          // phase, carrying the action's name as its detail -- including a
          // failure superseded by a newer call. Only the newest generation
          // owns the public error field. The actionFailures mark lets the
          // event and detached observers of the same rejection skip an
          // already-reported failure instead of reporting it a second time.
          const report = __velarRuntime.report(failure, { phase: "action", detail: name, component: scope.component, unhandled: false });
          actionError = report.error;
          __velarGraphWeakSetInsert(__velarRuntime.actionFailures, actionError);
          if (current === generation) error.set(report.error);
        }
        throw actionError;
      },
    );
  };

  __velarGraphDefine(run, "pending", { enumerable: true, get: () => pending.get() });
  __velarGraphDefine(run, "error", { enumerable: true, get: () => error.get() });
  __velarAppendOwned(scope.cleanups, () => { disposed = true; generation += 1; });
  return __velarGraphFreeze(run);
}

function __velarScope(component = "") {
  return { cleanups: [], mounts: [], mounted: false, component };
}

const __velarGlobalScope = __velarScope();

function __velarMountScope(scope) {
  if (scope.mounted) return;
  scope.mounted = true;
  for (let index = 0; index < scope.mounts.length; index += 1) {
    try {
      const result = __velarUntracked(scope.mounts[index]);
      __velarObservePromise(result, (error) => __velarReport(error, "mounted", scope));
    } catch (error) { __velarReport(error, "mounted", scope); }
  }
}

function __velarDestroyScope(scope) {
  for (let index = scope.cleanups.length - 1; index >= 0; index -= 1) {
    // A reentrant destroy can empty the list underneath this walk; a missing
    // slot means the step already ran and must not run again.
    const cleanup = scope.cleanups[index];
    if (typeof cleanup !== "function") continue;
    try {
      const result = __velarUntracked(cleanup);
      __velarObservePromise(result, (error) => __velarReport(error, "cleanup", scope));
    } catch (error) { __velarReport(error, "cleanup", scope); }
  }
  scope.cleanups.length = 0;
}

function __velarCleanupStep(run, scope) {
  try {
    const result = __velarUntracked(run);
    __velarObservePromise(result, (error) => __velarReport(error, "cleanup", scope));
  } catch (error) { __velarReport(error, "cleanup", scope); }
}

function __velarWatch(read, callback, scope) {
  let current;
  let currentVersion = 0;
  let initialized = false;
  __velarObserver(() => {
    const next = read();
    __velarRuntime.trackDeep(next);
    const nextVersion = __velarRuntime.versionOf(next);
    if (initialized && (!__velarGraphSame(next, current) || nextVersion !== currentVersion)) callback(next, current);
    current = next;
    currentVersion = nextVersion;
    initialized = true;
  }, "watch", scope);
}

function __velarComponentHandle(value, componentName) {
  if (value === null || typeof value !== "object") throw new TypeError("Component " + componentName + " must expose an ordinary Handle record");
  const prototype = __velarGraphPrototype(value);
  if (prototype !== __velarGraphPrototype({}) && prototype !== null) throw new TypeError("Component " + componentName + " must expose an ordinary Handle record");
  const output = {};
  let active = true;
  const names = __velarGraphOwnNames(value);
  for (let index = 0; index < names.length; index += 1) {
    const name = names[index];
    const descriptor = __velarGraphOwnDescriptor(value, name);
    if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) throw new TypeError("Component " + componentName + " Handle fields must be enumerable data values");
    const member = typeof descriptor.value === "function"
      ? (...arguments_) => {
        if (!active) throw new Error("Component " + componentName + " Handle is no longer active");
        return __velarGraphApply(descriptor.value, null, arguments_, "component Handle method");
      }
      : descriptor.value;
    __velarGraphDefine(output, name, { enumerable: true, value: member });
  }
  return __velarGraphFreeze({
    value: __velarGraphFreeze(output),
    revoke() { active = false; },
  });
}

function __velarComponent(node, scope, mounted, cleanup, handleState) {
  let destroyed = false;
  const refCleanups = [];
  const ownedNodes = node && __velarDomNodeType(node) === 11 ? __velarDomChildNodes(node) : [node];
  if (mounted) __velarAppendOwned(scope.mounts, mounted);
  return {
    __velarComponent: true,
    node,
    __bindRef(setRef) {
      if (!handleState) throw new TypeError("This component does not expose a Handle");
      const handle = handleState.value;
      let bound = true;
      setRef(handle, undefined);
      __velarAppendOwned(refCleanups, () => {
        if (!bound) return;
        bound = false;
        setRef(null, handle);
      });
      return null;
    },
    mount(target, before = null) {
      if (destroyed) throw new Error("Cannot mount a destroyed VelarScript component");
      if (scope.mounted) throw new Error("Cannot mount a VelarScript component more than once");
      const parent = typeof target === "string" ? __velarDomQuerySelector(target) : target;
      if (!parent) throw new Error("VelarScript mount target was not found");
      __velarDomInsertBefore(parent, node, before);
      __velarMountScope(scope);
      return null;
    },
    __mount() { if (!destroyed) __velarMountScope(scope); },
    destroy(remove = true) {
      if (destroyed) return null;
      destroyed = true;
      for (let index = refCleanups.length - 1; index >= 0; index -= 1) refCleanups[index]();
      refCleanups.length = 0;
      if (handleState) handleState.revoke();
      if (cleanup) {
        try {
          const result = __velarUntracked(cleanup);
          __velarObservePromise(result, (error) => __velarReport(error, "cleanup", scope));
        } catch (error) { __velarReport(error, "cleanup", scope); }
      }
      __velarDestroyScope(scope);
      if (remove) for (let index = 0; index < ownedNodes.length; index += 1) __velarDomRemove(ownedNodes[index]);
      return null;
    },
  };
}

function __velarScopeComponentRoot(node, attribute) {
  if (!attribute || !node) return;
  if (__velarDomNodeType(node) === 1) {
    __velarDomSetAttribute(node, attribute, "");
    return;
  }
  if (__velarDomNodeType(node) === 11) {
    const children = __velarDomChildNodes(node);
    for (let index = 0; index < children.length; index += 1) {
      if (__velarDomNodeType(children[index]) === 1) __velarDomSetAttribute(children[index], attribute, "");
    }
  }
}

function __velarUseComponent(instance, scope, parentStyleScope = "") {
  __velarScopeComponentRoot(instance.node, parentStyleScope);
  __velarAppendOwned(scope.mounts, () => instance.__mount());
  __velarAppendOwned(scope.cleanups, () => instance.destroy(false));
  return instance.node;
}

function __velarFatal(parent, error) {
  const fallback = __velarDomCreateElement("section");
  __velarDomSetAttribute(fallback, "role", "alert");
  __velarDomSetAttribute(fallback, "data-velar-fatal", "");
  __velarDomSetText(fallback, "The application could not start: " + error.message);
  __velarDomReplaceChildren(parent, fallback);
}

function __velarMount(evaluate, fallbackTarget = null) {
  let values;
  try {
    values = evaluate();
  } catch (failure) {
    const report = __velarReport(failure, "mount", null);
    if (fallbackTarget !== null) {
      try {
        const fallback = __velarDomQuerySelector(fallbackTarget);
        if (fallback) __velarFatal(fallback, report.error);
      } catch {}
    }
    return null;
  }
  const value = values[0];
  const target = values[1];
  const parent = typeof target === "string" ? __velarDomQuerySelector(target) : target;
  if (!parent) {
    // A missing mount target must keep the no-blank-page promise in every
    // build: the failure is reported through velar/app and the fatal state
    // renders into the document body, since the requested target is exactly
    // what does not exist.
    const report = __velarReport(new Error("VelarScript mount target was not found"), "mount", null);
    try {
      const body = __velarDomQuerySelector("body");
      if (body) __velarFatal(body, report.error);
    } catch {}
    return null;
  }
  try {
    if (value && value.__velarComponent) {
      const result = value.mount(parent);
      if (__velarGraphIsList(globalThis.__velarHotDisposers)) __velarAppendOwned(globalThis.__velarHotDisposers, () => value.destroy());
      return result;
    }
    __velarAppend(parent, value);
    __velarMountScope(__velarGlobalScope);
    return null;
  } catch (failure) {
    const report = __velarReport(failure, "mount", null);
    __velarFatal(parent, report.error);
    return null;
  }
}

const __velarSvgNamespace = "http://www.w3.org/2000/svg";
const __velarXlinkNamespace = "http://www.w3.org/1999/xlink";
const __velarXmlNamespace = "http://www.w3.org/XML/1998/namespace";

function __velarCreateElement(tag, namespace) {
  return namespace === "svg" || tag === "svg"
    ? __velarDomCreateElementNS(__velarSvgNamespace, tag)
    : __velarDomCreateElement(tag);
}

function __velarListSnapshot(value, name) {
  value = __velarToRaw(value);
  __velarRuntime.collectionRead(value, __velarWebIterateKey, undefined);
  return __velarDomListSnapshot(value, name);
}

function __velarAppend(parent, value, state = null) {
  state ??= { active: __velarDomCreateSet(), depth: 0, values: 0, text: 0 };
  if (value == null || value === false || value === true) return;
  state.values += 1;
  if (state.values > 1000000) throw new RangeError("JSX cannot render more than 1000000 values");
  if (typeof value === "string") {
    state.text += value.length;
    if (state.text > 16 * 1024 * 1024) throw new RangeError("JSX text cannot exceed 16 MiB");
    __velarDomAppend(parent, __velarDomCreateTextNode(value));
    return;
  }
  if (typeof value === "number") {
    if (!__velarDomIsFinite(value)) throw new TypeError("JSX numbers must be finite");
    __velarDomAppend(parent, __velarDomCreateTextNode(__velarDomString(value)));
    return;
  }
  if (__velarDomIsNode(value)) { __velarDomAppend(parent, value); return; }
  if (__velarDomIsArray(value)) {
    if (state.depth >= 128) throw new RangeError("JSX Lists cannot exceed 128 nested levels");
    if (__velarDomSetContains(state.active, value)) throw new TypeError("JSX cannot render a cyclic List");
    const values = __velarListSnapshot(value, "JSX children");
    __velarDomSetInsert(state.active, value);
    state.depth += 1;
    try {
      for (let index = 0; index < values.length; index += 1) __velarAppend(parent, values[index], state);
    } finally {
      state.depth -= 1;
      __velarDomSetRemove(state.active, value);
    }
    return;
  }
  throw new TypeError("JSX can render only text, finite numbers, bool, enums, WebNode values, and Lists of those values");
}

function __velarDynamic(parent, read, scope, rootState = null) {
  const start = __velarDomCreateComment("velar:start");
  const end = __velarDomCreateComment("velar:end");
  __velarDomAppend(parent, start, end);
  let nodes = [];
  let childScope = null;
  __velarAppendOwned(scope.mounts, () => { if (childScope) __velarMountScope(childScope); });
  __velarObserver(() => {
    const nextScope = __velarScope(scope.component);
    const fragment = __velarDomCreateFragment();
    let nextHost = null;
    try {
      __velarAppend(fragment, read(nextScope));
      if (rootState) nextHost = __velarRootHost(fragment, "dynamic component");
    }
    catch (error) { __velarDestroyScope(nextScope); throw error; }
    const nextNodes = __velarDomChildNodes(fragment);
    if (childScope) __velarDestroyScope(childScope);
    for (let index = 0; index < nodes.length; index += 1) __velarDomRemove(nodes[index]);
    __velarDomBefore(end, fragment);
    childScope = nextScope;
    nodes = nextNodes;
    if (rootState) {
      rootState.host = nextHost;
      for (const listener of __velarGraphSetItems(rootState.listeners)) listener(nextHost);
    }
    if (scope.mounted) __velarMountScope(nextScope);
  }, "dom", scope);
  __velarAppendOwned(scope.cleanups, () => {
    if (childScope) __velarDestroyScope(childScope);
    for (let index = 0; index < nodes.length; index += 1) __velarDomRemove(nodes[index]);
    nodes = [];
    if (rootState) {
      rootState.host = null;
      for (const listener of __velarGraphSetItems(rootState.listeners)) listener(null);
    }
  });
}

function __velarDynamicComponent(read, scope) {
  const fragment = __velarDomCreateFragment();
  const rootState = { host: null, listeners: __velarGraphCreateSet() };
  __velarGraphDefine(fragment, "__velarDynamicRoot", { value: rootState });
  __velarDynamic(fragment, read, scope, rootState);
  return fragment;
}

function __velarKeyed(parent, read, keyOf, render, scope) {
  const start = __velarDomCreateComment("velar:keyed-start");
  const end = __velarDomCreateComment("velar:keyed-end");
  __velarDomAppend(parent, start, end);
  let entries = __velarGraphCreateMap();
  __velarAppendOwned(scope.mounts, () => { for (const entry of __velarGraphMapItems(entries)) __velarMountScope(entry.scope); });
  __velarObserver(() => {
    const source = __velarToRaw(read() ?? []);
    const values = __velarListSnapshot(source, "Keyed JSX");
    const next = __velarGraphCreateMap();
    const created = [];
    try {
      for (let index = 0; index < values.length; index += 1) {
        const rawValue = __velarToRaw(values[index]);
        // The keyed source may be a fresh derived List on every render. A row
        // is observed directly by its child scope, so linking it to that
        // ephemeral container only retains dead Lists and slows later writes.
        const trackedValue = __velarReactive(rawValue);
        const key = __velarKey(keyOf(trackedValue));
        if (__velarGraphMapContains(next, key)) throw new Error("Duplicate JSX key '" + (typeof key === "string" ? key : __velarDomString(key)) + "'");
        let entry = __velarGraphMapRead(entries, key);
        if (entry && !__velarGraphSame(entry.value, rawValue)) entry = undefined;
        if (!entry) {
          const childScope = __velarScope(scope.component);
          const fragment = __velarDomCreateFragment();
          try { __velarAppend(fragment, render(trackedValue, childScope)); }
          catch (error) { __velarDestroyScope(childScope); throw error; }
          entry = { value: rawValue, scope: childScope, nodes: __velarDomChildNodes(fragment), fragment };
          created[created.length] = entry;
        }
        __velarGraphMapWrite(next, key, entry);
      }
    } catch (error) {
      for (let index = 0; index < created.length; index += 1) __velarDestroyScope(created[index].scope);
      throw error;
    }
    for (const key of __velarGraphMapKeyItems(entries)) {
      const entry = __velarGraphMapRead(entries, key);
      if (__velarGraphMapRead(next, key) === entry) continue;
      __velarDestroyScope(entry.scope);
      for (let index = 0; index < entry.nodes.length; index += 1) __velarDomRemove(entry.nodes[index]);
    }
    // A row already standing in its final position must not be detached and
    // reattached: that moves focus off a live <input>, ends IME composition,
    // and resets transient subtree state. The cursor walks the surviving nodes
    // in order and only moves a node that is not already where it belongs.
    let cursor = __velarDomNextSibling(start);
    for (const entry of __velarGraphMapItems(next)) {
      if (entry.fragment) {
        __velarDomBefore(cursor === null ? end : cursor, entry.fragment);
        entry.fragment = null;
        if (scope.mounted) __velarMountScope(entry.scope);
        continue;
      }
      for (let index = 0; index < entry.nodes.length; index += 1) {
        const node = entry.nodes[index];
        if (node === cursor) cursor = __velarDomNextSibling(cursor);
        else __velarDomBefore(cursor === null ? end : cursor, node);
      }
    }
    entries = next;
  }, "dom", scope);
  __velarAppendOwned(scope.cleanups, () => {
    for (const entry of __velarGraphMapItems(entries)) __velarDestroyScope(entry.scope);
    __velarGraphMapEmpty(entries);
  });
}

function __velarStaticAttr(element, name, value) {
  if (value === false || value == null) return;
  __velarSetAttribute(element, name, __velarAttributeValue(value, name));
}

function __velarAttr(element, name, read, scope) {
  __velarObserver(() => {
    const value = read();
    if (value == null || value === false) __velarRemoveAttribute(element, name);
    else __velarSetAttribute(element, name, __velarAttributeValue(value, name));
  }, "dom", scope);
}

function __velarAttributeValue(value, name) {
  if (value === true) return "";
  if (typeof value === "number") {
    if (!__velarDomIsFinite(value)) throw new TypeError("JSX attribute '" + name + "' requires a finite number");
    return __velarDomString(value);
  }
  if (typeof value !== "string") throw new TypeError("JSX attribute '" + name + "' requires text, a finite number, bool, an enum, or null");
  if (value.length > 1024 * 1024) throw new RangeError("JSX attribute '" + name + "' cannot exceed 1 MiB");
  return value;
}

function __velarKey(value) {
  if (typeof value === "number") {
    if (!__velarDomIsFinite(value)) throw new TypeError("A JSX key number must be finite");
    return value;
  }
  if (typeof value !== "string") throw new TypeError("A JSX key must be a string, string-backed enum, or finite number");
  if (value.length > 65536) throw new RangeError("A JSX key cannot exceed 65536 characters");
  return value;
}

function __velarSetAttribute(element, name, value) {
  if (name.startsWith("xlink:")) __velarDomSetAttributeNS(element, __velarXlinkNamespace, name, value);
  else if (name.startsWith("xml:")) __velarDomSetAttributeNS(element, __velarXmlNamespace, name, value);
  else __velarDomSetAttribute(element, name, value);
}

function __velarRemoveAttribute(element, name) {
  if (name.startsWith("xlink:")) __velarDomRemoveAttributeNS(element, __velarXlinkNamespace, name.slice(6));
  else if (name.startsWith("xml:")) __velarDomRemoveAttributeNS(element, __velarXmlNamespace, name.slice(4));
  else __velarDomRemoveAttribute(element, name);
}

function __velarClass(element, name, read, scope) {
  __velarClassBind(element, () => read() ? name : null, scope);
}

function __velarMergeRules(rules, source) {
  const names = __velarGraphOwnNames(source);
  for (let index = 0; index < names.length; index += 1) {
    const descriptor = __velarGraphOwnDescriptor(source, names[index]);
    if (!descriptor || !("value" in descriptor)) continue;
    if (descriptor.value == null) delete rules[names[index]];
    else rules[names[index]] = descriptor.value;
  }
}

function __velarLook(parts) {
  const rules = __velarGraphCreateRecord();
  const add = (part) => {
    if (part == null || part === false) return;
    if (__velarGraphIsList(part)) { for (let index = 0; index < part.length; index += 1) add(part[index]); return; }
    if (part.__velarLook === true || (part.rules && typeof part.rules === "object")) {
      __velarMergeRules(rules, part.rules);
      return;
    }
    throw new TypeError("look composition accepts only Look, Look?, or lists of Look values");
  };
  add(parts);
  return __velarGraphFreeze({ __velarLook: true, rules: __velarGraphFreeze(rules) });
}

function __velarKeyframesValue(name) {
  if (typeof name !== "string" || !/^velar-kf-[0-9a-f]{8}$/.test(name)) throw new TypeError("Generated keyframes name is invalid");
  return __velarGraphFreeze({ __velarKeyframes: true, name });
}

function __velarLookVariable(token) {
  return "--velar-look-" + token.replace(/[^A-Za-z0-9_-]+/g, "-");
}

function __velarLookValue(token, value) {
  if (token.endsWith(":animation")) return __velarAnimationLookValue(value);
  if (typeof value === "number") {
    if (!__velarDomIsFinite(value)) throw new TypeError("Look properties require finite numbers");
    return __velarDomString(value);
  }
  if (typeof value !== "string") throw new TypeError("Look properties require text, finite numbers, typed visual values, or null");
  if (value.length > 1024 * 1024) throw new RangeError("A Look property value cannot exceed 1 MiB");
  if (token.endsWith(":content") && typeof value === "string" && value !== "none" && value !== "normal") return __velarQuotedText(value);
  return value;
}

function __velarAnimationLookValue(value) {
  const parts = [];
  const add = (item) => {
    if (__velarGraphIsList(item)) {
      for (let index = 0; index < item.length; index += 1) add(item[index]);
      return;
    }
    const marker = item && (typeof item === "object" || typeof item === "function")
      ? __velarGraphOwnDescriptor(item, "__velarAnimation") : null;
    const css = item && (typeof item === "object" || typeof item === "function")
      ? __velarGraphOwnDescriptor(item, "css") : null;
    if (!marker || !("value" in marker) || marker.value !== true || !css || !("value" in css) || typeof css.value !== "string") {
      throw new TypeError("Look animation requires Animation or a List of Animation values from animate()");
    }
    __velarAppendOwned(parts, css.value);
  };
  add(value);
  if (parts.length === 0) throw new TypeError("A Look animation list cannot be empty");
  let output = parts[0];
  for (let index = 1; index < parts.length; index += 1) output += ", " + parts[index];
  return output;
}

const __velarInlineStyleProperties = __velarGraphCreateSet(${JSON.stringify([...LOOK_PROPERTIES].map(cssPropertyName))});

function __velarStyleDeclarations(value) {
  if (!value || typeof value !== "object" || __velarGraphIsList(value)
    || (__velarGraphPrototype(value) !== __velarGraphNativeObject.prototype && __velarGraphPrototype(value) !== null)
    || __velarWebErrorOwnSymbols(value).length > 0) {
    throw new TypeError("style:* requires compiler-owned inline declarations");
  }
  const names = __velarGraphOwnNames(value);
  if (names.length > ${LOOK_PROPERTIES.size}) throw new RangeError("An inline Style has too many properties");
  const output = {};
  for (let index = 0; index < names.length; index += 1) {
    const property = names[index];
    if (!__velarGraphSetContains(__velarInlineStyleProperties, property)) throw new TypeError("Unknown inline Style property '" + property + "'");
    const descriptor = __velarGraphOwnDescriptor(value, property);
    if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) throw new TypeError("Inline Style declarations cannot use accessors");
    __velarGraphDefine(output, property, { value: descriptor.value, enumerable: true, configurable: false, writable: false });
  }
  return __velarGraphFreeze(output);
}

function __velarInlineStyleState(element) {
  const current = __velarGraphOwnDescriptor(element, "__velarInlineStyleState");
  if (current) {
    if (!("value" in current) || current.enumerable || current.configurable || current.writable
      || !current.value || typeof current.value !== "object") throw new TypeError("Inline Style ownership is invalid");
    return current.value;
  }
  const state = __velarGraphFreeze({ base: __velarGraphCreateMap(), managed: __velarGraphCreateSet() });
  __velarGraphDefine(element, "__velarInlineStyleState", { value: state });
  return state;
}

function __velarAttachSource(registry, element, source) {
  let sources = __velarGraphWeakMapRead(registry, element);
  if (!sources) { sources = __velarGraphCreateSet(); __velarGraphWeakMapWrite(registry, element, sources); }
  __velarGraphSetInsert(sources, source);
  return sources;
}

function __velarDetachSource(registry, element, source) {
  const sources = __velarGraphWeakMapRead(registry, element);
  if (!sources) return;
  __velarGraphSetRemove(sources, source);
  if (__velarGraphSetCount(sources) === 0) __velarGraphWeakMapRemove(registry, element);
}

function __velarApplyStyles(element) {
  const sources = __velarGraphWeakMapRead(__velarRuntime.lookSources, element);
  const merged = __velarGraphCreateMap();
  if (sources) {
    for (const source of __velarGraphSetItems(sources)) {
      if (!source.styles) continue;
      const names = __velarGraphOwnNames(source.styles);
      for (let index = 0; index < names.length; index += 1) {
        __velarGraphMapWrite(merged, names[index], __velarGraphOwnDescriptor(source.styles, names[index]).value);
      }
    }
  }
  const state = __velarInlineStyleState(element);
  const next = __velarGraphCreateSet(__velarGraphMapKeyItems(merged));
  for (const property of __velarGraphSetItems(next)) {
    if (__velarGraphSetContains(state.managed, property)) continue;
    __velarGraphMapWrite(state.base, property, {
      value: __velarDomStyleValue(element, property),
      priority: __velarDomStylePriority(element, property),
    });
  }
  for (const property of __velarGraphSetItems(state.managed)) {
    if (__velarGraphSetContains(next, property)) continue;
    const base = __velarGraphMapRead(state.base, property);
    if (!base || (base.value === "" && base.priority === "")) __velarDomStyleClear(element, property);
    else __velarDomStyleWrite(element, property, base.value, base.priority);
    __velarGraphMapRemove(state.base, property);
  }
  for (const property of __velarGraphSetItems(next)) {
    const value = __velarGraphMapRead(merged, property);
    if (value == null) __velarDomStyleClear(element, property);
    else __velarDomStyleWrite(element, property, __velarLookValue("base:" + property, value));
  }
  __velarGraphSetEmpty(state.managed);
  for (const property of __velarGraphSetItems(next)) __velarGraphSetInsert(state.managed, property);
}

function __velarStyleBind(element, read, scope) {
  const source = { rules: __velarGraphCreateRecord(), styles: {} };
  __velarAttachSource(__velarRuntime.lookSources, element, source);
  __velarObserver(() => {
    source.styles = __velarStyleDeclarations(read());
    __velarApplyStyles(element);
  }, "dom", scope);
  __velarAppendOwned(scope.cleanups, () => {
    __velarDetachSource(__velarRuntime.lookSources, element, source);
    __velarApplyStyles(element);
  });
}

function __velarMoveStyleSource(source, previous, next) {
  if (previous) {
    __velarDetachSource(__velarRuntime.lookSources, previous, source);
    __velarApplyStyles(previous);
  }
  if (next) {
    __velarAttachSource(__velarRuntime.lookSources, next, source);
    __velarApplyStyles(next);
  }
}

// The dynamic-root marker sits on a fragment the emitter created, but the
// fragment is still a host object: a planted prototype getter would otherwise
// hand look/class/style application a forged host element.
function __velarDynamicRootState(root) {
  if (root === null || root === undefined) return null;
  const descriptor = __velarGraphOwnDescriptor(root, "__velarDynamicRoot");
  return descriptor && "value" in descriptor && descriptor.value && typeof descriptor.value === "object"
    ? descriptor.value
    : null;
}

function __velarStyleBindRoot(root, read, scope) {
  const dynamic = __velarDynamicRootState(root);
  if (!dynamic) {
    __velarStyleBind(__velarRootHost(root, "style"), read, scope);
    return;
  }
  const source = { rules: __velarGraphCreateRecord(), styles: {} };
  let host = null;
  const move = (next) => {
    __velarMoveStyleSource(source, host, next);
    host = next;
  };
  __velarGraphSetInsert(dynamic.listeners, move);
  move(dynamic.host);
  __velarObserver(() => {
    source.styles = __velarStyleDeclarations(read());
    if (host) __velarApplyStyles(host);
  }, "dom", scope);
  __velarAppendOwned(scope.cleanups, () => {
    __velarGraphSetRemove(dynamic.listeners, move);
    move(null);
  });
}

// Look and class ownership lives in one non-enumerable, non-configurable data
// property per element, discovered through the captured descriptor ABI exactly
// like inline style ownership. An ambient expando read would let a hostile
// prototype hand the framework a forged token set.
function __velarElementState(element, name, create) {
  const current = __velarGraphOwnDescriptor(element, name);
  if (current) {
    if (!("value" in current) || current.enumerable || current.configurable || current.writable
      || !current.value || typeof current.value !== "object") throw new TypeError("VelarScript element ownership is invalid");
    return current.value;
  }
  const state = create();
  __velarGraphDefine(element, name, { value: state });
  return state;
}

function __velarApplyLooks(element) {
  const sources = __velarGraphWeakMapRead(__velarRuntime.lookSources, element);
  const merged = __velarGraphCreateRecord();
  if (sources) {
    // A null rule keeps its token: the token drives the generated selector and
    // only the custom property behind it disappears.
    for (const source of __velarGraphSetItems(sources)) {
      const names = __velarGraphOwnNames(source.rules);
      for (let index = 0; index < names.length; index += 1) {
        const descriptor = __velarGraphOwnDescriptor(source.rules, names[index]);
        if (descriptor && "value" in descriptor) merged[names[index]] = descriptor.value;
      }
    }
  }
  const state = __velarElementState(element, "__velarLookTokens", () => __velarGraphFreeze({ tokens: __velarGraphCreateSet() }));
  const tokens = __velarGraphOwnNames(merged);
  const next = __velarGraphCreateSet(tokens);
  for (const token of __velarGraphSetItems(state.tokens)) {
    if (!__velarGraphSetContains(next, token)) __velarDomStyleClear(element, __velarLookVariable(token));
  }
  let attribute = "";
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    const value = __velarGraphOwnDescriptor(merged, token)?.value;
    if (value == null) __velarDomStyleClear(element, __velarLookVariable(token));
    else __velarDomStyleWrite(element, __velarLookVariable(token), __velarLookValue(token, value));
    attribute = attribute === "" ? token : attribute + " " + token;
  }
  if (tokens.length > 0) __velarDomSetAttribute(element, "data-velar-look", attribute);
  else __velarDomRemoveAttribute(element, "data-velar-look");
  __velarGraphSetEmpty(state.tokens);
  for (let index = 0; index < tokens.length; index += 1) __velarGraphSetInsert(state.tokens, tokens[index]);
}

function __velarLookBind(element, read, scope) {
  const source = { rules: __velarGraphCreateRecord() };
  __velarAttachSource(__velarRuntime.lookSources, element, source);
  __velarObserver(() => {
    source.rules = __velarLook([read()]).rules;
    __velarApplyLooks(element);
  }, "dom", scope);
  __velarAppendOwned(scope.cleanups, () => {
    __velarDetachSource(__velarRuntime.lookSources, element, source);
    __velarApplyLooks(element);
  });
}

function __velarMoveLookSource(source, previous, next) {
  if (previous) {
    __velarDetachSource(__velarRuntime.lookSources, previous, source);
    __velarApplyLooks(previous);
  }
  if (next) {
    __velarAttachSource(__velarRuntime.lookSources, next, source);
    __velarApplyLooks(next);
  }
}

function __velarApplyExternalLook(element, value) {
  const source = { rules: __velarLook([value]).rules };
  __velarAttachSource(__velarRuntime.lookSources, element, source);
  __velarApplyLooks(element);
  return () => {
    __velarDetachSource(__velarRuntime.lookSources, element, source);
    __velarApplyLooks(element);
  };
}

__velarRuntime.installLook(__velarApplyExternalLook);

function __velarRootHost(root, capability) {
  if (root == null) throw new TypeError("A component with multiple roots must mark exactly one native element with 'host'");
  if (__velarDomNodeType(root) === 1) return root;
  const elements = [];
  const children = __velarDomChildNodes(root);
  for (let index = 0; index < children.length; index += 1) {
    if (__velarDomNodeType(children[index]) === 1) __velarAppendOwned(elements, children[index]);
  }
  const explicit = [];
  for (let index = 0; index < elements.length; index += 1) {
    const element = elements[index];
    if (__velarDomOwnData(element, "__velarHost") === true) __velarAppendOwned(explicit, element);
    const descendants = __velarDomCollectionSnapshot(__velarDomQuerySelectorAll(element, "*"), "Element.querySelectorAll");
    for (let child = 0; child < descendants.length; child += 1) {
      if (__velarDomOwnData(descendants[child], "__velarHost") === true) __velarAppendOwned(explicit, descendants[child]);
    }
  }
  if (explicit.length === 1) return explicit[0];
  if (explicit.length > 1) throw new TypeError("A component can declare only one host element");
  if (elements.length === 1) return elements[0];
  throw new TypeError("A component with multiple roots must mark exactly one native element with 'host'");
}

function __velarLookBindRoot(root, read, scope) {
  const dynamic = __velarDynamicRootState(root);
  if (!dynamic) {
    __velarLookBind(__velarRootHost(root, "look"), read, scope);
    return;
  }
  const source = { rules: __velarGraphCreateRecord() };
  let host = null;
  const move = (next) => {
    __velarMoveLookSource(source, host, next);
    host = next;
  };
  __velarGraphSetInsert(dynamic.listeners, move);
  move(dynamic.host);
  __velarObserver(() => {
    source.rules = __velarLook([read()]).rules;
    if (host) __velarApplyLooks(host);
  }, "dom", scope);
  __velarAppendOwned(scope.cleanups, () => {
    __velarGraphSetRemove(dynamic.listeners, move);
    move(null);
  });
}

function __velarClassBindRoot(root, read, scope) {
  const dynamic = __velarDynamicRootState(root);
  if (!dynamic) {
    __velarClassBind(__velarRootHost(root, "class"), read, scope);
    return;
  }
  const source = { names: [] };
  let host = null;
  const move = (next) => {
    __velarMoveClassSource(source, host, next);
    host = next;
  };
  __velarGraphSetInsert(dynamic.listeners, move);
  move(dynamic.host);
  __velarObserver(() => {
    source.names = __velarClassNames(read());
    if (host) __velarApplyClasses(host);
  }, "dom", scope);
  __velarAppendOwned(scope.cleanups, () => {
    __velarGraphSetRemove(dynamic.listeners, move);
    move(null);
  });
}

function __velarClassNames(value, output = []) {
  if (value == null || value === false) return output;
  if (__velarGraphIsList(value)) {
    for (let index = 0; index < value.length; index += 1) __velarClassNames(value[index], output);
    return output;
  }
  if (typeof value !== "string") throw new TypeError("class accepts strings, string?, or lists of strings");
  let name = "";
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (character === " " || character === "\t" || character === "\n" || character === "\r" || character === "\f" || character === "\v") {
      if (name !== "") __velarAppendOwned(output, name);
      name = "";
      continue;
    }
    name += character;
  }
  if (name !== "") __velarAppendOwned(output, name);
  return output;
}

function __velarApplyClasses(element) {
  const sources = __velarGraphWeakMapRead(__velarRuntime.classSources, element);
  const next = __velarGraphCreateSet();
  if (sources) {
    for (const source of __velarGraphSetItems(sources)) {
      for (let index = 0; index < source.names.length; index += 1) __velarGraphSetInsert(next, source.names[index]);
    }
  }
  const state = __velarElementState(element, "__velarClassState", () => __velarGraphFreeze({
    base: __velarGraphCreateSet(__velarDomClassNames(element)),
    managed: __velarGraphCreateSet(),
  }));
  for (const name of __velarGraphSetItems(state.managed)) {
    if (!__velarGraphSetContains(next, name) && !__velarGraphSetContains(state.base, name)) __velarDomClassRemove(element, name);
  }
  for (const name of __velarGraphSetItems(next)) __velarDomClassInsert(element, name);
  __velarGraphSetEmpty(state.managed);
  for (const name of __velarGraphSetItems(next)) __velarGraphSetInsert(state.managed, name);
}

function __velarMoveClassSource(source, previous, next) {
  if (previous) {
    __velarDetachSource(__velarRuntime.classSources, previous, source);
    __velarApplyClasses(previous);
  }
  if (next) {
    __velarAttachSource(__velarRuntime.classSources, next, source);
    __velarApplyClasses(next);
  }
}

function __velarClassBind(element, read, scope) {
  const source = { names: [] };
  __velarAttachSource(__velarRuntime.classSources, element, source);
  __velarObserver(() => {
    source.names = __velarClassNames(read());
    __velarApplyClasses(element);
  }, "dom", scope);
  __velarAppendOwned(scope.cleanups, () => {
    __velarDetachSource(__velarRuntime.classSources, element, source);
    __velarApplyClasses(element);
  });
}

function __velarHtml(element, read, scope) {
  __velarObserver(() => {
    const value = read();
    if (value != null && typeof value !== "string") throw new TypeError("unsafe:html requires string or null");
    if (value?.length > 16 * 1024 * 1024) throw new RangeError("unsafe:html cannot exceed 16 MiB");
    __velarDomSetHtml(element, value ?? "");
  }, "dom", scope);
}

function __velarOn(element, event, read, scope, modifiers = []) {
  if (typeof __velarUntracked(read) !== "function") throw new TypeError("Event '" + event + "' requires a function");
  const capture = __velarHasName(modifiers, "capture");
  const options = { capture, once: __velarHasName(modifiers, "once") };
  const listener = (value) => {
    try {
      if (__velarHasName(modifiers, "self")) {
        const target = __velarEventField(value, "target", __velarEventTargetGetter);
        if (target === __velarEventMissingField) throw new TypeError("DOM event does not expose a native target");
        if (target !== element) return;
      }
      if (__velarHasName(modifiers, "prevent")) __velarEventCall(value, "preventDefault", __velarEventPreventDefault);
      if (__velarHasName(modifiers, "stop")) __velarEventCall(value, "stopPropagation", __velarEventStopPropagation);
      // The handler expression is re-read per dispatch so handlers routed
      // through live props always see the current value.
      const handler = __velarUntracked(read);
      if (typeof handler !== "function") throw new TypeError("Event '" + event + "' requires a function");
      const result = __velarUntracked(() => handler(value));
      __velarObservePromise(result, (error) => __velarReportEvent(error, scope, event));
    } catch (error) { __velarReportEvent(error, scope, event); }
  };
  __velarDomAddListener(element, event, listener, options);
  __velarAppendOwned(scope.cleanups, () => __velarDomRemoveListener(element, event, listener, capture));
}

function __velarBindValue(element, state, scope, numeric = false, parse = null) {
  __velarObserver(() => {
    const value = state.get();
    if (value == null) __velarDomSetFieldValue(element, "");
    else if (numeric) {
      if (typeof value !== "number" || !__velarDomIsFinite(value)) throw new TypeError("Numeric bind:value requires a finite number");
      __velarDomSetFieldValue(element, __velarDomString(value));
    } else {
      if (typeof value !== "string") throw new TypeError("bind:value requires text");
      __velarDomSetFieldValue(element, value);
    }
  }, "dom", scope);
  const update = () => state.set(numeric ? __velarDomFieldNumber(element) : parse ? parse(__velarDomFieldValue(element)) : __velarDomFieldValue(element));
  __velarDomAddListener(element, "input", update, false);
  __velarAppendOwned(scope.cleanups, () => __velarDomRemoveListener(element, "input", update, false));
}

function __velarBindGroupValues(state, own) {
  const value = __velarUntracked(() => state.get());
  const values = __velarListSnapshot(value, "bind:group state");
  const output = new __velarDomNativeArray(values.length);
  let count = 0;
  for (let index = 0; index < values.length; index += 1) {
    const item = values[index];
    if (typeof item !== "string") throw new TypeError("bind:group on a checkbox requires List<string> state");
    if (item !== own) { output[count] = item; count += 1; }
  }
  output.length = count;
  return output;
}

function __velarBindGroup(element, state, scope, multiple = false, parse = null) {
  __velarObserver(() => {
    const own = __velarDomFieldValue(element);
    const value = state.get();
    if (!multiple) {
      if (value != null && typeof value !== "string") throw new TypeError("bind:group requires text state");
      __velarDomSetFieldChecked(element, value === own);
      return;
    }
    const values = __velarListSnapshot(value, "bind:group state");
    let present = false;
    for (let index = 0; index < values.length; index += 1) if (values[index] === own) present = true;
    __velarDomSetFieldChecked(element, present);
  }, "dom", scope);
  const update = () => {
    const own = __velarDomFieldValue(element);
    if (!multiple) {
      if (__velarDomFieldChecked(element)) state.set(parse ? parse(own) : own);
      return;
    }
    const remaining = __velarBindGroupValues(state, own);
    if (__velarDomFieldChecked(element)) remaining[remaining.length] = own;
    state.set(remaining);
  };
  __velarDomAddListener(element, "change", update, false);
  __velarAppendOwned(scope.cleanups, () => __velarDomRemoveListener(element, "change", update, false));
}

function __velarBindChecked(element, state, scope) {
  __velarObserver(() => {
    const value = state.get();
    if (typeof value !== "boolean") throw new TypeError("bind:checked requires bool");
    __velarDomSetFieldChecked(element, value);
  }, "dom", scope);
  const update = () => state.set(__velarDomFieldChecked(element));
  __velarDomAddListener(element, "change", update, false);
  __velarAppendOwned(scope.cleanups, () => __velarDomRemoveListener(element, "change", update, false));
}

// Prop handles give a component body live reads over its props store. The
// component function still runs exactly once per instance; only reads race
// ahead, so state initializers can never re-run on a prop update.
function __velarRequiredProp(props, name, component) {
  if (__velarUntracked(() => props[name]) === undefined) throw new TypeError("Component " + component + " requires prop " + name);
  return __velarGraphFreeze({
    get() {
      const value = props[name];
      if (value === undefined) throw new TypeError("Component " + component + " requires prop " + name);
      return value;
    },
  });
}

function __velarProp(props, name, fallback) {
  const fallbackValue = __velarUntracked(() => props[name]) === undefined ? fallback() : undefined;
  return __velarGraphFreeze({
    get() {
      const value = props[name];
      return value === undefined ? fallbackValue : value;
    },
  });
}

// Instantiates a component with a live props store: each prop thunk runs in
// its own observer that writes a reactive cell, and the props object exposes
// tracked getters over those cells. The component call itself is untracked so
// construction can never subscribe an enclosing dynamic region to prop reads.
function __velarBindComponentRef(instance, setRef) {
  if (setRef === undefined) return instance;
  if (!instance || typeof instance.__bindRef !== "function") throw new TypeError("This component does not expose a Handle");
  instance.__bindRef(setRef);
  return instance;
}

function __velarInstantiate(component, thunks, children, scope, namespace, setRef) {
  if (component != null && component.__velarSnapshotProps === true) {
    // Runtime-implemented components (Head, Router, Link, NavLink) consume a
    // one-time plain snapshot so their strict record validation still holds.
    const snapshot = {};
    const styleRead = thunks.__velarStyle;
    const snapshotNames = __velarGraphOwnNames(thunks);
    for (let index = 0; index < snapshotNames.length; index += 1) {
      if (snapshotNames[index] !== "__velarStyle") snapshot[snapshotNames[index]] = __velarUntracked(thunks[snapshotNames[index]]);
    }
    if (children !== undefined) snapshot.children = __velarUntracked(children);
    const instance = __velarUntracked(() => component(snapshot, namespace));
    if (styleRead !== undefined) __velarStyleBindRoot(instance.node, styleRead, scope);
    return __velarBindComponentRef(instance, setRef);
  }
  const props = {};
  const propNames = __velarGraphOwnNames(thunks);
  for (let index = 0; index < propNames.length; index += 1) {
    const name = propNames[index];
    const read = thunks[name];
    const cell = __velarState(undefined);
    __velarObserver(() => cell.set(read()), "dom", scope);
    __velarGraphDefine(props, name, { enumerable: true, get: () => cell.get() });
  }
  if (children !== undefined) __velarGraphDefine(props, "children", { enumerable: true, value: __velarUntracked(children) });
  return __velarBindComponentRef(__velarUntracked(() => component(props, namespace)), setRef);
}

// A component element in child position: one stable instance whose prop
// observers live in a dedicated scope, destroyed only when the position
// itself unmounts. Construction failures stay contained to the position.
function __velarChild(component, thunks, children, scope, namespace, setRef) {
  const childScope = __velarScope(scope.component);
  let constructed = false;
  __velarAppendOwned(scope.mounts, () => { if (constructed) __velarMountScope(childScope); });
  __velarAppendOwned(scope.cleanups, () => { if (constructed) __velarDestroyScope(childScope); });
  try {
    const node = __velarUseComponent(__velarInstantiate(component, thunks, children, childScope, namespace, setRef), childScope);
    constructed = true;
    return node;
  } catch (error) {
    __velarDestroyScope(childScope);
    __velarReport(error, "render", scope);
    return __velarDomCreateComment("velar:component-error");
  }
}

function __velarSettled() {
  return __velarManagedAsyncCreate((resolve) => __velarEnqueue(resolve));
}

function __velarTakeUnhandledFailure() {
  for (const failure of __velarGraphSetItems(__velarRuntime.unhandledFailures)) {
    __velarGraphSetRemove(__velarRuntime.unhandledFailures, failure);
    return failure;
  }
  return null;
}

// In a non-browser host an unhandled report cannot throw from a microtask
// without ending the whole process, so the runtime parks it. tick() is where
// an awaiting caller meets the reactive queue, which makes it the owned place
// for that parked failure to surface: the test that awaited the flush fails
// with the real error and the process -- the test runner -- continues.
function __velarTick() {
  return __velarManagedAsyncThen(__velarSettled(), () => {
    const failure = __velarTakeUnhandledFailure();
    if (failure !== null) throw failure;
    return null;
  });
}
`.trim();

function webRuntime(foundation: string): string {
  return `${foundation}\n${WEB_RUNTIME_BODY}`;
}
