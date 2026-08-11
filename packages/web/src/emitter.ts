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
import { JavaScriptEmitter, spanIdentity, VELAR_ERROR_NORMALIZATION_MODULE } from "@velarscript/compiler/extension";
import { WEB_RUNTIME_FOUNDATION, WEB_RUNTIME_FOUNDATION_SHARED_ERROR } from "./runtime-foundation.ts";

type AssignmentStatement = Extract<Statement, { readonly kind: "AssignmentStatement" }>;
type ComponentDeclaration = Extract<Statement, { readonly kind: "ComponentDeclaration" }>;
type JSXElementExpression = Extract<Expression, { readonly kind: "JSXElementExpression" }>;
type JSXAttribute = JSXElementExpression["attributes"][number];
type LookExpression = Extract<Expression, { readonly kind: "LookExpression" }>;
type LookEntry = LookExpression["entries"][number];

interface LookStaticAtom {
  readonly kind: "hook" | "media" | "scheme";
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
      if (type.name === "Event" || type.name === "KeyboardEvent" || type.name === "PointerEvent" || type.name === "InputEvent") {
        return `(typeof ${type.name} !== "undefined" && ${value} instanceof ${type.name})`;
      }
      if (type.name === "Element") return `(typeof Element !== "undefined" && ${value} instanceof Element)`;
      if (type.name === "CanvasElement") return `(typeof HTMLCanvasElement !== "undefined" && ${value} instanceof HTMLCanvasElement)`;
      if (type.name === "DialogElement") return `(typeof HTMLDialogElement !== "undefined" && ${value} instanceof HTMLDialogElement)`;
      if (type.name === "InputElement") {
        return `((typeof HTMLInputElement !== "undefined" && ${value} instanceof HTMLInputElement) || (typeof HTMLSelectElement !== "undefined" && ${value} instanceof HTMLSelectElement) || (typeof HTMLTextAreaElement !== "undefined" && ${value} instanceof HTMLTextAreaElement))`;
      }
      if (type.name === "Blob") return `(typeof Blob !== "undefined" && ${value} instanceof Blob)`;
      if (type.name === "File") {
        this.needsFileTypeHelper = true;
        return `__velarFileTypeIs(${value})`;
      }
    }
    return super.emitTypeCheck(type, value, state);
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
      `import { errorApply as __velarErrorApply, isError as __velarIsError, normalizeError as __velarNormalizeError } from ${JSON.stringify(VELAR_ERROR_NORMALIZATION_MODULE)};`,
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

  protected override visitExtensionRuntimeExpression(expression: Expression, visitExpression: (expression: Expression) => void): boolean {
    if (expression.kind === "UnitLiteralExpression") return true;
    if (expression.kind === "LookExpression") {
      visitLookExpressions(expression.entries, visitExpression);
      return true;
    }
    if (expression.kind !== "JSXElementExpression") return false;
    expression.attributes.forEach((attribute) => {
      if (typeof attribute.value !== "string" && attribute.value) visitExpression(attribute.value);
    });
    expression.children.forEach((child) => {
      if (child.kind === "JSXExpressionChild") visitExpression(child.expression);
      else if (child.kind === "JSXElementExpression") visitExpression(child);
    });
    return true;
  }

  protected override visitExtensionRuntimeStatement(
    statement: Statement,
    visitExpression: (expression: Expression) => void,
    visitStatement: (statement: Statement) => void,
  ): boolean {
    if (statement.kind === "UnsafeCssImportDeclaration") return true;
    if (statement.kind === "StateDeclaration" || statement.kind === "ResourceDeclaration") {
      visitExpression(statement.initializer);
      return true;
    }
    if (statement.kind === "ActionDeclaration") {
      statement.parameters.forEach((parameter) => { if (parameter.defaultValue) visitExpression(parameter.defaultValue); });
      statement.body.forEach(visitStatement);
      return true;
    }
    if (statement.kind === "WatchDeclaration") {
      visitExpression(statement.expression);
      statement.body.forEach(visitStatement);
      return true;
    }
    if (statement.kind !== "ComponentDeclaration") return false;
    statement.parameters.forEach((parameter) => { if (parameter.defaultValue) visitExpression(parameter.defaultValue); });
    statement.body.forEach((item) => {
      if (item.kind === "StateDeclaration" || item.kind === "ResourceDeclaration") visitExpression(item.initializer);
      else if (item.kind === "ActionDeclaration") {
        item.parameters.forEach((parameter) => { if (parameter.defaultValue) visitExpression(parameter.defaultValue); });
        item.body.forEach(visitStatement);
      } else if (item.kind === "WatchDeclaration") {
        visitExpression(item.expression);
        item.body.forEach(visitStatement);
      } else if (item.kind === "MountedBlock" || item.kind === "CleanupBlock") item.body.forEach(visitStatement);
      else visitStatement(item);
    });
    return true;
  }

  protected override extensionExpressionContainsDirectAwait(expression: Expression): boolean | undefined {
    if (expression.kind === "UnitLiteralExpression") return false;
    if (expression.kind === "LookExpression") return lookExpressions(expression.entries).some((value) => this.expressionContainsDirectAwait(value));
    if (expression.kind !== "JSXElementExpression") return undefined;
    return expression.attributes.some((attribute) => typeof attribute.value !== "string"
      && attribute.value !== null
      && this.expressionContainsDirectAwait(attribute.value))
      || expression.children.some((child) => child.kind === "JSXExpressionChild"
        ? this.expressionContainsDirectAwait(child.expression)
        : child.kind === "JSXElementExpression" && this.expressionContainsDirectAwait(child));
  }

  protected override emitStatement(statement: Statement, depth: number): string {
    if (statement.kind === "UnsafeCssImportDeclaration") return "";
    if (statement.kind === "ComponentDeclaration") return this.emitComponent(statement, depth);
    if (statement.kind === "StateDeclaration") {
      const indentation = "  ".repeat(depth);
      return `${indentation}${statement.exported ? "export " : ""}const ${statement.name} = __velarState(${this.emitMappedExpression(statement.initializer)});`;
    }
    if (statement.kind === "ResourceDeclaration") return "";
    if (statement.kind === "ActionDeclaration") {
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
    if (statement.kind === "WatchDeclaration") {
      const indentation = "  ".repeat(depth);
      const parameters = [statement.currentName, statement.previousName].filter((name): name is string => name !== null).join(", ");
      const body = statement.body.map((child) => this.emitMappedStatement(child, depth + 1)).filter(Boolean).join("\n");
      return `${indentation}__velarWatch(() => ${this.emitMappedExpression(statement.expression)}, (${parameters}) => {${body ? `\n${body}\n${indentation}` : ""}}, __velarGlobalScope);`;
    }
    if (statement.kind === "AssignmentStatement") {
      const reactive = this.emitReactiveAssignment(statement, depth);
      if (reactive) return reactive;
    }
    return super.emitStatement(statement, depth);
  }

  protected override emitExpression(expression: Expression): string {
    if (expression.kind === "UnitLiteralExpression") return JSON.stringify(expression.raw);
    if (expression.kind === "UnaryExpression" && (expression.operator === "+" || expression.operator === "-")
      && (expression.operand.kind === "UnitLiteralExpression"
        || this.hints.extensionCalls.get(spanIdentity(expression.span)) === LOOK_ARITHMETIC_HINT)) {
      if (expression.operand.kind === "UnitLiteralExpression") {
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
    if (expression.kind === "LookHookExpression") return "false";
    if (expression.kind === "LookExpression") return this.emitLook(expression);
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
    if (expression.kind === "JSXElementExpression") {
      return this.emitJsx(expression, this.currentScope ?? "__velarGlobalScope", this.currentScope !== null, this.currentJsxNamespace, false);
    }
    if (expression.kind === "CallExpression" && expression.callee.kind === "IdentifierExpression"
      && expression.callee.name === "mount" && expression.arguments.length === 2) {
      const sourceArguments = expression.arguments.map((argument) => this.emitMappedExpression(argument));
      const namedOrder = this.hints.namedArgumentOrders.get(spanIdentity(expression.span));
      const arguments_ = namedOrder
        ? namedOrder.map((source) => source === -1 ? "undefined" : `__namedArguments[${source}]`)
        : sourceArguments;
      const evaluated = namedOrder
        ? `((__namedArguments) => [${arguments_.join(", ")}])([${sourceArguments.join(", ")}])`
        : `[${arguments_.join(", ")}]`;
      const targetSource = namedOrder?.[1] ?? 1;
      const target = targetSource >= 0 ? expression.arguments[targetSource] : null;
      const fallbackTarget = target?.kind === "LiteralExpression" && typeof target.value === "string"
        ? JSON.stringify(target.value)
        : "null";
      return `__velarMount(() => ${evaluated}, ${fallbackTarget})`;
    }
    const emitted = super.emitExpression(expression);
    if (this.webOutput && emitted.includes("__velarListPop(")) return emitted.replace("__velarListPop(", "__velarWebListPop(");
    return emitted;
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
    this.currentScope = "__scope";
    this.currentJsxNamespace = "__namespace";
    // Props are live reactive inputs: every parameter becomes a read-only
    // handle over the per-instance props store, so prop reads lower through
    // .get() exactly like state reads do.
    const lines: string[] = [];
    for (const parameter of statement.parameters) {
      if (parameter.defaultValue) {
        lines.push(`${bodyIndent}const ${parameter.name} = __velarProp(__props, ${JSON.stringify(parameter.name)}, () => (${this.emitMappedExpression(parameter.defaultValue)}));`);
      } else {
        lines.push(`${bodyIndent}const ${parameter.name} = __velarRequiredProp(__props, ${JSON.stringify(parameter.name)}, ${JSON.stringify(statement.name)});`);
      }
    }
    let render: Expression | null = null;
    let mountedBody: readonly Statement[] = [];
    let cleanupBody: readonly Statement[] = [];
    for (const item of statement.body) {
      if (item.kind === "StateDeclaration") {
        lines.push(`${bodyIndent}const ${item.name} = __velarState(${this.emitMappedExpression(item.initializer)});`);
      } else if (item.kind === "ResourceDeclaration") {
        lines.push(`${bodyIndent}const ${item.name} = __velarResource(() => ${this.emitMappedExpression(item.initializer)}, __scope, ${JSON.stringify(item.name)});`);
      } else if (item.kind === "ActionDeclaration") {
        const parameters = item.parameters.map((parameter) => this.emitParameter(parameter.name, parameter.defaultValue, parameter.rest)).join(", ");
        const actionLines = item.body.map((child) => this.emitMappedStatement(child, depth + 3)).filter(Boolean);
        if (!this.blockAlwaysReturns(item.body)) actionLines.push(`${"  ".repeat(depth + 3)}return null;`);
        const actionBody = actionLines.join("\n");
        lines.push(`${bodyIndent}const ${item.name} = __velarAction(async (${parameters}) => {${actionBody ? `\n${actionBody}\n${bodyIndent}` : ""}}, __scope, ${JSON.stringify(item.name)});`);
      } else if (item.kind === "WatchDeclaration") {
        const parameters = [item.currentName, item.previousName].filter((name): name is string => name !== null).join(", ");
        const watchLines = item.body.map((child) => this.emitMappedStatement(child, depth + 3)).filter(Boolean).join("\n");
        lines.push(`${bodyIndent}__velarWatch(() => ${this.emitMappedExpression(item.expression)}, (${parameters}) => {${watchLines ? `\n${watchLines}\n${bodyIndent}` : ""}}, __scope);`);
      } else if (item.kind === "MountedBlock") {
        mountedBody = item.body;
      } else if (item.kind === "CleanupBlock") {
        cleanupBody = item.body;
      } else if (item.kind === "ReturnStatement") {
        render = item.value;
      } else {
        lines.push(this.emitMappedStatement(item, depth + 2));
      }
    }

    // A component-root render delegates through the same stable child path as
    // any other component element; emitExpression already routes JSX through
    // __velarChild with the current scope, so no dynamic wrapper is needed.
    const renderedRoot = render ? this.emitMappedExpression(render) : "__velarDomCreateComment(\"missing render\")";
    lines.push(`${bodyIndent}const __root = ${renderedRoot};`);
    lines.push(`${bodyIndent}if (__props.class !== undefined) __velarClassBindRoot(__root, () => __props.class, __scope);`);
    lines.push(`${bodyIndent}if (__props.look !== undefined) __velarLookBindRoot(__root, () => __props.look, __scope);`);
    const mounted = mountedBody.map((child) => this.emitMappedStatement(child, depth + 3)).filter(Boolean).join("\n");
    const cleanup = cleanupBody.map((child) => {
      if (["VariableDeclaration", "FunctionDeclaration", "ClassDeclaration", "TypeDeclaration", "EnumDeclaration"].includes(child.kind)) {
        return this.emitMappedStatement(child, depth + 3);
      }
      const inner = this.emitMappedStatement(child, depth + 4);
      if (!inner) return "";
      const cleanupIndent = "  ".repeat(depth + 3);
      return `${cleanupIndent}__velarCleanupStep(() => {\n${inner}\n${cleanupIndent}}, __scope);`;
    }).filter(Boolean).join("\n");
    const cleanupBodyText = `() => {${cleanup ? `\n${cleanup}\n${bodyIndent}` : ""}}`;
    const functionLines = [
      `${outerIndent}const __scope = __velarScope(${JSON.stringify(statement.name)});`,
      `${outerIndent}let __constructionCleanup = () => {};`,
      `${outerIndent}try {`,
      `${bodyIndent}__constructionCleanup = ${cleanupBodyText};`,
      ...lines,
      `${bodyIndent}return __velarComponent(__root, __scope, async () => {${mounted ? `\n${mounted}\n${bodyIndent}` : ""}}, __constructionCleanup);`,
      `${outerIndent}} catch (__constructionError) {`,
      `${bodyIndent}try { __constructionCleanup(); } catch (__cleanupError) { __velarReport(__cleanupError, "cleanup", __scope); }`,
      `${bodyIndent}__velarDestroyScope(__scope);`,
      `${bodyIndent}throw __constructionError;`,
      `${outerIndent}}`,
    ];

    this.currentScope = previousScope;
    this.currentJsxNamespace = previousJsxNamespace;
    return `${indentation}${statement.exported ? "export " : ""}function ${statement.name}(__props = {}, __namespace = "html") {\n${functionLines.filter(Boolean).join("\n")}\n${indentation}}`;
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
      // Component identity at a JSX position is stable: props are passed as
      // thunks that the runtime turns into per-prop observers feeding a live
      // props store, so a reactive prop update reaches the existing instance
      // instead of re-creating it. Children render once per instance.
      const properties = expression.attributes
        .filter((attribute) => attribute.name !== "key" && attribute.name !== "look" && !attribute.name.startsWith("look:"))
        .map((attribute) => this.emitMappedJavaScript(
          attribute.span,
          () => `${this.emitObjectKey(attribute.name)}: () => (${this.emitJsxAttributeValue(attribute)})`,
        ));
      const lookValue = this.emitJsxLookValue(expression);
      const lookAttribute = expression.attributes.find((attribute) => attribute.name === "look" || attribute.name.startsWith("look:"));
      if (lookValue && lookAttribute) {
        properties.push(this.emitMappedJavaScript(lookAttribute.span, () => `look: () => (${lookValue})`));
      }
      // Children stay a thunk so the charter's evaluation order holds at the
      // runtime boundary: props left to right, then children, then the
      // component function.
      const children = hasMeaningfulChildren(expression.children)
        ? `() => (${this.emitJsxChildren(expression.children, scope, namespace)})`
        : "undefined";
      const arguments_ = `${expression.tag}, { ${properties.join(", ")} }, ${children}, ${scope}, ${namespace}`;
      return asChild ? `__velarChild(${arguments_})` : `__velarInstantiate(${arguments_})`;
    }

    const id = ++this.jsxId;
    const element = `__el${id}`;
    const elementNamespace = expression.tag === "svg" ? '"svg"' : namespace;
    const childNamespace = expression.tag === "foreignObject" ? '"html"' : elementNamespace;
    const lines = [expression.tag
      ? `const ${element} = __velarCreateElement(${JSON.stringify(expression.tag)}, ${elementNamespace});`
      : `const ${element} = __velarDomCreateFragment();`];
    let emittedLook = false;
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
      lines.push(this.emitMappedJavaScript(attribute.span, () => {
        const value = attribute.value;
        if (attribute.name === "ref" && value && typeof value !== "string" && value.kind === "IdentifierExpression") {
          return `${value.name} = ${element}; ${scope}.cleanups.push(() => { if (${value.name} === ${element}) ${value.name} = null; });`;
        }
        if (attribute.name.startsWith("on:") && value && typeof value !== "string") {
          const [event, ...modifiers] = attribute.name.slice(3).split(".");
          return `__velarOn(${element}, ${JSON.stringify(event)}, () => (${this.emitMappedExpression(value)}), ${scope}, ${JSON.stringify(modifiers)});`;
        }
        if (attribute.name === "bind:value" && value && typeof value !== "string" && value.kind === "IdentifierExpression") {
          const numeric = expression.tag === "input" && expression.attributes.some((item) => item.name === "type" && item.value === "number");
          const enumName = this.hints.enumValueBindings.get(attribute.span.start);
          return `__velarBindValue(${element}, ${value.name}, ${scope}, ${numeric}${enumName ? `, ${enumName}.parse` : ""});`;
        }
        if (attribute.name === "bind:checked" && value && typeof value !== "string" && value.kind === "IdentifierExpression") {
          return `__velarBindChecked(${element}, ${value.name}, ${scope});`;
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
      } else if (child.kind === "JSXElementExpression") {
        lines.push(this.emitMappedJavaScript(child.span, () => `__velarAppend(${element}, ${this.emitJsx(child, scope, true, childNamespace)});`));
      } else {
        lines.push(this.emitMappedJavaScript(child.expression.span, () => this.emitDynamicChild(element, child.expression, scope, childNamespace)));
      }
    }
    lines.push(`return ${element};`);
    return `(() => { ${lines.join(" ")} })()`;
  }

  private emitJsxChildren(children: JSXElementExpression["children"], scope: string, namespace: string): string {
    const fragment: JSXElementExpression = { kind: "JSXElementExpression", tag: "", attributes: [], children, span: children[0]?.span ?? { start: 0, end: 0 } };
    return this.emitJsx(fragment, scope, true, namespace);
  }

  private emitDynamicChild(parent: string, expression: Expression, scope: string, namespace: string): string {
    const leaves = dynamicChildLeaves(expression);
    const previousScope = this.currentScope;
    const previousJsxNamespace = this.currentJsxNamespace;
    this.currentScope = "__childScope";
    this.currentJsxNamespace = namespace;
    // A conditional splits into one region per branch leaf only when a keyed
    // list is somewhere among them; each region gates itself on the shared
    // branch conditions, so at most one region renders content at a time and
    // the keyed list keeps identity-preserving children across the branch flip.
    // Without a keyed leaf the interpolation stays one dynamic region.
    const statements = leaves.some((leaf) => leaf.list?.key)
      ? leaves.map((leaf) => this.emitDynamicChildLeaf(parent, leaf, scope, namespace))
      : [`__velarDynamic(${parent}, (__childScope) => ${this.emitMappedExpression(expression)}, ${scope});`];
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
      const render = this.emitJsx(list.arrow.body, "__childScope", true, namespace);
      return `__velarKeyed(${parent}, () => ${source}, (${parameter}) => ${key}, (${parameter}, __childScope) => ${render}, ${scope});`;
    }
    const value = this.emitGuardedExpression(leaf.guards, this.emitMappedExpression(leaf.expression), "null");
    return `__velarDynamic(${parent}, (__childScope) => ${value}, ${scope});`;
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

  private prepareLooks(program: Program): void {
    const rules = new Map<string, LookRule>();
    const visit = (value: unknown): void => {
      if (!value || typeof value !== "object") return;
      const record = value as Record<string, unknown>;
      if (record.kind === "JSXElementExpression") {
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
      if (record.kind === "LookExpression") {
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
      for (const child of Object.values(record)) {
        if (Array.isArray(child)) child.forEach(visit);
        else visit(child);
      }
    };
    visit(program);

    const lookCss: string[] = [];
    for (const rule of rules.values()) {
      const hookAtoms = rule.staticAtoms.filter((atom) => atom.kind === "hook");
      const mediaAtoms = rule.staticAtoms.filter((atom) => atom.kind === "media" || atom.kind === "scheme");
      const base = `[data-velar-look~=${JSON.stringify(rule.token)}]${rule.staticAtoms.length > 0 ? "[data-velar-look]" : ""}`;
      const selectors = lookSelectors(base, hookAtoms, rule.target);
      const css = `${selectors.join(",")}{${lookDeclaration(rule.token, rule.property)}}`;
      const query = mediaAtoms.map(lookMediaQuery).join(" and ");
      lookCss.push(query ? `@media ${query}{${css}}` : css);
    }

    const before: string[] = [];
    const after: string[] = [];
    for (const statement of program.body) {
      if (statement.kind !== "UnsafeCssImportDeclaration") continue;
      const source = this.resourceContents.get(statement.source) ?? "";
      (statement.placement === "after" ? after : before).push(source.trim());
    }
    this.cssSegments = {
      before: before.filter(Boolean).join("\n\n"),
      controlled: lookCss.filter(Boolean).join("\n\n"),
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
  if (!callback || callback.kind !== "ArrowFunctionExpression" || callback.asynchronous || callback.parameters.length !== 1 || callback.body.kind !== "JSXElementExpression") return null;
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
  if (expression.kind === "LookHookExpression") {
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
  if (expression.kind !== "MemberExpression" || expression.object.kind !== "IdentifierExpression" || expression.object.name !== "scheme") return null;
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

function visitLookExpressions(entries: Extract<Expression, { kind: "LookExpression" }>["entries"], visit: (expression: Expression) => void): void {
  for (const entry of entries) {
    if (entry.kind === "LookProperty" || entry.kind === "LookSpread") visit(entry.value);
    else if (entry.kind === "LookIf") {
      visit(entry.condition);
      visitLookExpressions(entry.thenEntries, visit);
      visitLookExpressions(entry.elseEntries, visit);
    } else visitLookExpressions(entry.entries, visit);
  }
}

function lookExpressions(entries: Extract<Expression, { kind: "LookExpression" }>["entries"]): readonly Expression[] {
  const output: Expression[] = [];
  visitLookExpressions(entries, (expression) => output.push(expression));
  return output;
}

function containsUnitLiteral(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  if (record.kind === "UnitLiteralExpression") return true;
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
  if (record.kind === "ComponentDeclaration" || record.kind === "UnsafeCssImportDeclaration" || record.kind === "LookExpression" || record.kind === "JSXElementExpression"
    || record.kind === "StateDeclaration" || record.kind === "ResourceDeclaration" || record.kind === "ActionDeclaration" || record.kind === "WatchDeclaration") return true;
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

const __velarEventReflectApply = Object.getOwnPropertyDescriptor(Reflect, "apply")?.value;
const __velarEventConstructorDescriptor = Object.getOwnPropertyDescriptor(globalThis, "Event");
const __velarEventConstructor = __velarEventConstructorDescriptor && "value" in __velarEventConstructorDescriptor ? __velarEventConstructorDescriptor.value : null;
const __velarEventPrototype = typeof __velarEventConstructor === "function" ? Object.getOwnPropertyDescriptor(__velarEventConstructor, "prototype")?.value : null;
const __velarEventTargetGetter = __velarEventPrototype && Object.getOwnPropertyDescriptor(__velarEventPrototype, "target")?.get;
const __velarEventPreventDefault = __velarEventPrototype && Object.getOwnPropertyDescriptor(__velarEventPrototype, "preventDefault")?.value;
const __velarEventStopPropagation = __velarEventPrototype && Object.getOwnPropertyDescriptor(__velarEventPrototype, "stopPropagation")?.value;
const __velarEventMissingField = Object.freeze({});
function __velarEventField(value, name, nativeGetter) {
  if (typeof nativeGetter === "function" && typeof __velarEventReflectApply === "function") {
    try { return __velarEventReflectApply(nativeGetter, value, []); } catch {}
  }
  if (value === null || (typeof value !== "object" && typeof value !== "function")) return __velarEventMissingField;
  const descriptor = Object.getOwnPropertyDescriptor(value, name);
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

function __velarSchedule(observer) {
  const queue = observer.mode === "watch" ? __velarRuntime.watchQueue : __velarRuntime.domQueue;
  if (!__velarGraphSetContains(queue, observer) && __velarGraphSetCount(queue) >= 100000) throw new RangeError("VelarScript reactive queues cannot exceed 100000 observers");
  __velarGraphSetInsert(queue, observer);
  if (!__velarRuntime.flushPending) {
    __velarRuntime.flushPending = true;
    __velarEnqueue(__velarFlush);
  }
}

function __velarFlush() {
  __velarRuntime.flushPending = false;
  for (const observer of __velarGraphSetItems(__velarRuntime.domQueue)) { __velarGraphSetRemove(__velarRuntime.domQueue, observer); observer.run(); }
  for (const observer of __velarGraphSetItems(__velarRuntime.watchQueue)) { __velarGraphSetRemove(__velarRuntime.watchQueue, observer); observer.run(); }
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
      catch (error) { __velarReport(error, mode === "watch" ? "watch" : "render", scope); }
      finally { observer.running = false; }
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
  scope.cleanups.push(() => observer.stop());
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

function __velarResource(load, scope, name) {
  const value = __velarState(null);
  const loading = __velarState(true);
  const ready = __velarState(false);
  const error = __velarState(null);
  let generation = 0;
  let started = false;
  let disposed = false;

  const reload = () => {
    if (disposed) return Promise.resolve(null);
    started = true;
    const current = ++generation;
    loading.set(true);
    error.set(null);
    return Promise.resolve().then(load).then(
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

  scope.mounts.push(() => started ? null : reload());
  scope.cleanups.push(() => { disposed = true; generation += 1; });
  return Object.freeze({
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
    if (disposed) return Promise.reject(new Error(
      "Action '" + name + "' cannot run after its component is destroyed",
    ));
    const current = ++generation;
    active += 1;
    pending.set(true);
    error.set(null);
    return Promise.resolve().then(() => execute(...arguments_)).then(
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
          if (current === generation) {
            const report = __velarRuntime.report(failure, { phase: "action", detail: name, component: scope.component, unhandled: false });
            error.set(report.error);
            actionError = report.error;
            __velarGraphWeakSetInsert(__velarRuntime.actionFailures, actionError);
          }
        }
        throw actionError;
      },
    );
  };

  Object.defineProperties(run, {
    pending: { enumerable: true, get: () => pending.get() },
    error: { enumerable: true, get: () => error.get() },
  });
  scope.cleanups.push(() => { disposed = true; generation += 1; });
  return Object.freeze(run);
}

function __velarScope(component = "") {
  return { cleanups: [], mounts: [], mounted: false, component };
}

const __velarGlobalScope = __velarScope();

function __velarMountScope(scope) {
  if (scope.mounted) return;
  scope.mounted = true;
  for (const mount of scope.mounts) {
    try {
      const result = mount();
      __velarObservePromise(result, (error) => __velarReport(error, "mounted", scope));
    } catch (error) { __velarReport(error, "mounted", scope); }
  }
}

function __velarDestroyScope(scope) {
  for (const cleanup of [...scope.cleanups].reverse()) {
    try {
      const result = cleanup();
      __velarObservePromise(result, (error) => __velarReport(error, "cleanup", scope));
    } catch (error) { __velarReport(error, "cleanup", scope); }
  }
  scope.cleanups.length = 0;
}

function __velarCleanupStep(run, scope) {
  try {
    const result = run();
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

function __velarComponent(node, scope, mounted, cleanup) {
  let destroyed = false;
  const ownedNodes = node && __velarDomNodeType(node) === 11 ? __velarDomChildNodes(node) : [node];
  if (mounted) scope.mounts.push(mounted);
  return {
    __velarComponent: true,
    node,
    mount(target, before = null) {
      if (destroyed) throw new Error("Cannot mount a destroyed VelarScript component");
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
      if (cleanup) {
        try {
          const result = cleanup();
          __velarObservePromise(result, (error) => __velarReport(error, "cleanup", scope));
        } catch (error) { __velarReport(error, "cleanup", scope); }
      }
      __velarDestroyScope(scope);
      if (remove) for (const owned of ownedNodes) __velarDomRemove(owned);
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
    for (const child of __velarDomChildNodes(node)) if (__velarDomNodeType(child) === 1) __velarDomSetAttribute(child, attribute, "");
  }
}

function __velarUseComponent(instance, scope, parentStyleScope = "") {
  __velarScopeComponentRoot(instance.node, parentStyleScope);
  scope.mounts.push(() => instance.__mount());
  scope.cleanups.push(() => instance.destroy(false));
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
  if (!parent) throw new Error("VelarScript mount target was not found");
  try {
    if (value && value.__velarComponent) {
      const result = value.mount(parent);
      if (Array.isArray(globalThis.__velarHotDisposers)) globalThis.__velarHotDisposers.push(() => value.destroy());
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
  __velarRuntime.collectionRead(value, Symbol.for("velar.reactive.iterate.v1"), undefined);
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
      for (const item of values) __velarAppend(parent, item, state);
    } finally {
      state.depth -= 1;
      __velarDomSetRemove(state.active, value);
    }
    return;
  }
  throw new TypeError("JSX can render only text, finite numbers, bool, enums, WebNode values, and Lists of those values");
}

function __velarDynamic(parent, read, scope) {
  const start = __velarDomCreateComment("velar:start");
  const end = __velarDomCreateComment("velar:end");
  __velarDomAppend(parent, start, end);
  let nodes = [];
  let childScope = null;
  scope.mounts.push(() => { if (childScope) __velarMountScope(childScope); });
  __velarObserver(() => {
    const nextScope = __velarScope(scope.component);
    const fragment = __velarDomCreateFragment();
    try { __velarAppend(fragment, read(nextScope)); }
    catch (error) { __velarDestroyScope(nextScope); throw error; }
    const nextNodes = __velarDomChildNodes(fragment);
    if (childScope) __velarDestroyScope(childScope);
    for (const node of nodes) __velarDomRemove(node);
    __velarDomBefore(end, fragment);
    childScope = nextScope;
    nodes = nextNodes;
    if (scope.mounted) __velarMountScope(nextScope);
  }, "dom", scope);
  scope.cleanups.push(() => { if (childScope) __velarDestroyScope(childScope); });
}

function __velarKeyed(parent, read, keyOf, render, scope) {
  const start = __velarDomCreateComment("velar:keyed-start");
  const end = __velarDomCreateComment("velar:keyed-end");
  __velarDomAppend(parent, start, end);
  let entries = new Map();
  scope.mounts.push(() => { for (const entry of entries.values()) __velarMountScope(entry.scope); });
  __velarObserver(() => {
    const source = __velarToRaw(read() ?? []);
    const values = __velarListSnapshot(source, "Keyed JSX");
    const next = new Map();
    const created = [];
    try {
      for (const value of values) {
        const rawValue = __velarToRaw(value);
        // The keyed source may be a fresh derived List on every render. A row
        // is observed directly by its child scope, so linking it to that
        // ephemeral container only retains dead Lists and slows later writes.
        const trackedValue = __velarReactive(rawValue);
        const key = __velarKey(keyOf(trackedValue));
        if (next.has(key)) throw new Error("Duplicate JSX key '" + (typeof key === "string" ? key : String(key)) + "'");
        let entry = entries.get(key);
        if (entry && !__velarGraphSame(entry.value, rawValue)) entry = null;
        if (!entry) {
          const childScope = __velarScope(scope.component);
          const fragment = __velarDomCreateFragment();
          try { __velarAppend(fragment, render(trackedValue, childScope)); }
          catch (error) { __velarDestroyScope(childScope); throw error; }
          entry = { value: rawValue, scope: childScope, nodes: __velarDomChildNodes(fragment), fragment };
          created.push(entry);
        }
        next.set(key, entry);
      }
    } catch (error) {
      for (const entry of created) __velarDestroyScope(entry.scope);
      throw error;
    }
    for (const [key, entry] of entries) {
      if (next.get(key) === entry) continue;
      __velarDestroyScope(entry.scope);
      for (const node of entry.nodes) __velarDomRemove(node);
    }
    for (const entry of next.values()) {
      if (entry.fragment) {
        __velarDomBefore(end, entry.fragment);
        entry.fragment = null;
        if (scope.mounted) __velarMountScope(entry.scope);
      } else {
        for (const node of entry.nodes) __velarDomBefore(end, node);
      }
    }
    entries = next;
  }, "dom", scope);
  scope.cleanups.push(() => {
    for (const entry of entries.values()) __velarDestroyScope(entry.scope);
    entries.clear();
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
    if (!Number.isFinite(value)) throw new TypeError("JSX attribute '" + name + "' requires a finite number");
    return String(value);
  }
  if (typeof value !== "string") throw new TypeError("JSX attribute '" + name + "' requires text, a finite number, bool, an enum, or null");
  if (value.length > 1024 * 1024) throw new RangeError("JSX attribute '" + name + "' cannot exceed 1 MiB");
  return value;
}

function __velarKey(value) {
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("A JSX key number must be finite");
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

function __velarLook(parts) {
  const rules = Object.create(null);
  const add = (part) => {
    if (part == null || part === false) return;
    if (Array.isArray(part)) { for (const child of part) add(child); return; }
    if (part.__velarLook === true) {
      for (const [token, value] of Object.entries(part.rules)) {
        if (value == null) delete rules[token];
        else rules[token] = value;
      }
      return;
    }
    if (part.rules && typeof part.rules === "object") {
      for (const [token, value] of Object.entries(part.rules)) {
        if (value == null) delete rules[token];
        else rules[token] = value;
      }
      return;
    }
    throw new TypeError("look composition accepts only Look, Look?, or lists of Look values");
  };
  add(parts);
  return Object.freeze({ __velarLook: true, rules: Object.freeze(rules) });
}

function __velarLookVariable(token) {
  return "--velar-look-" + token.replace(/[^A-Za-z0-9_-]+/g, "-");
}

function __velarLookValue(token, value) {
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("Look properties require finite numbers");
    return String(value);
  }
  if (typeof value !== "string") throw new TypeError("Look properties require text, finite numbers, typed visual values, or null");
  if (value.length > 1024 * 1024) throw new RangeError("A Look property value cannot exceed 1 MiB");
  if (token.endsWith(":content") && typeof value === "string" && value !== "none" && value !== "normal") return JSON.stringify(value);
  return value;
}

function __velarApplyLooks(element) {
  const sources = __velarRuntime.lookSources.get(element);
  const merged = Object.create(null);
  if (sources) {
    for (const source of sources) {
      for (const [token, value] of Object.entries(source.rules)) merged[token] = value;
    }
  }
  const previous = element.__velarLookTokens || new Set();
  const next = new Set(Object.keys(merged));
  for (const token of previous) if (!next.has(token)) element.style.removeProperty(__velarLookVariable(token));
  for (const [token, value] of Object.entries(merged)) {
    if (value == null) element.style.removeProperty(__velarLookVariable(token));
    else element.style.setProperty(__velarLookVariable(token), __velarLookValue(token, value));
  }
  if (next.size > 0) element.setAttribute("data-velar-look", [...next].join(" "));
  else element.removeAttribute("data-velar-look");
  element.__velarLookTokens = next;
}

function __velarLookBind(element, read, scope) {
  const source = { rules: Object.create(null) };
  let sources = __velarRuntime.lookSources.get(element);
  if (!sources) { sources = new Set(); __velarRuntime.lookSources.set(element, sources); }
  sources.add(source);
  __velarObserver(() => {
    source.rules = __velarLook([read()]).rules;
    __velarApplyLooks(element);
  }, "dom", scope);
  scope.cleanups.push(() => {
    sources.delete(source);
    if (sources.size === 0) __velarRuntime.lookSources.delete(element);
    __velarApplyLooks(element);
  });
}

function __velarApplyExternalLook(element, value) {
  const source = { rules: __velarLook([value]).rules };
  let sources = __velarRuntime.lookSources.get(element);
  if (!sources) { sources = new Set(); __velarRuntime.lookSources.set(element, sources); }
  sources.add(source);
  __velarApplyLooks(element);
  return () => {
    sources.delete(source);
    if (sources.size === 0) __velarRuntime.lookSources.delete(element);
    __velarApplyLooks(element);
  };
}

__velarRuntime.installLook(__velarApplyExternalLook);

function __velarRootHost(root, capability) {
  if (root?.nodeType === 1) return root;
  const elements = [...(root?.childNodes || [])].filter((node) => node.nodeType === 1);
  const explicit = elements.flatMap((element) => [element, ...element.querySelectorAll("*")]).filter((element) => element.__velarHost === true);
  if (explicit.length === 1) return explicit[0];
  if (explicit.length > 1) throw new TypeError("A component can declare only one host element");
  if (elements.length === 1) return elements[0];
  throw new TypeError("A component with multiple roots must mark exactly one native element with 'host'");
}

function __velarLookBindRoot(root, read, scope) {
  __velarLookBind(__velarRootHost(root, "look"), read, scope);
}

function __velarClassBindRoot(root, read, scope) {
  __velarClassBind(__velarRootHost(root, "class"), read, scope);
}

function __velarClassNames(value) {
  if (value == null || value === false) return [];
  if (Array.isArray(value)) return value.flatMap(__velarClassNames);
  if (typeof value !== "string") throw new TypeError("class accepts strings, string?, or lists of strings");
  return value.split(/\s+/).filter(Boolean);
}

function __velarApplyClasses(element) {
  const sources = __velarRuntime.classSources.get(element);
  const next = new Set();
  if (sources) for (const source of sources) for (const name of source.names) next.add(name);
  const base = element.__velarBaseClasses ??= new Set(element.classList);
  const previous = element.__velarManagedClasses ?? new Set();
  for (const name of previous) if (!next.has(name) && !base.has(name)) element.classList.remove(name);
  for (const name of next) element.classList.add(name);
  element.__velarManagedClasses = next;
}

function __velarClassBind(element, read, scope) {
  const source = { names: [] };
  let sources = __velarRuntime.classSources.get(element);
  if (!sources) { sources = new Set(); __velarRuntime.classSources.set(element, sources); }
  sources.add(source);
  __velarObserver(() => {
    source.names = __velarClassNames(read());
    __velarApplyClasses(element);
  }, "dom", scope);
  scope.cleanups.push(() => {
    sources.delete(source);
    if (sources.size === 0) __velarRuntime.classSources.delete(element);
    __velarApplyClasses(element);
  });
}

function __velarHtml(element, read, scope) {
  __velarObserver(() => {
    const value = read();
    if (value != null && typeof value !== "string") throw new TypeError("unsafe:html requires string or null");
    if (value?.length > 16 * 1024 * 1024) throw new RangeError("unsafe:html cannot exceed 16 MiB");
    element.innerHTML = value ?? "";
  }, "dom", scope);
}

function __velarOn(element, event, read, scope, modifiers = []) {
  if (typeof __velarUntracked(read) !== "function") throw new TypeError("Event '" + event + "' requires a function");
  const capture = modifiers.includes("capture");
  const options = { capture, once: modifiers.includes("once") };
  const listener = (value) => {
    try {
      if (modifiers.includes("self")) {
        const target = __velarEventField(value, "target", __velarEventTargetGetter);
        if (target === __velarEventMissingField) throw new TypeError("DOM event does not expose a native target");
        if (target !== element) return;
      }
      if (modifiers.includes("prevent")) __velarEventCall(value, "preventDefault", __velarEventPreventDefault);
      if (modifiers.includes("stop")) __velarEventCall(value, "stopPropagation", __velarEventStopPropagation);
      // The handler expression is re-read per dispatch so handlers routed
      // through live props always see the current value.
      const handler = __velarUntracked(read);
      if (typeof handler !== "function") throw new TypeError("Event '" + event + "' requires a function");
      const result = handler(value);
      __velarObservePromise(result, (error) => __velarReportEvent(error, scope, event));
    } catch (error) { __velarReportEvent(error, scope, event); }
  };
  element.addEventListener(event, listener, options);
  scope.cleanups.push(() => element.removeEventListener(event, listener, capture));
}

function __velarBindValue(element, state, scope, numeric = false, parse = null) {
  __velarObserver(() => {
    const value = state.get();
    if (value == null) element.value = "";
    else if (numeric) {
      if (typeof value !== "number" || !Number.isFinite(value)) throw new TypeError("Numeric bind:value requires a finite number");
      element.value = String(value);
    } else {
      if (typeof value !== "string") throw new TypeError("bind:value requires text");
      element.value = value;
    }
  }, "dom", scope);
  const update = () => state.set(numeric ? element.valueAsNumber : parse ? parse(element.value) : element.value);
  element.addEventListener("input", update);
  scope.cleanups.push(() => element.removeEventListener("input", update));
}

function __velarBindChecked(element, state, scope) {
  __velarObserver(() => {
    const value = state.get();
    if (typeof value !== "boolean") throw new TypeError("bind:checked requires bool");
    element.checked = value;
  }, "dom", scope);
  const update = () => state.set(element.checked);
  element.addEventListener("change", update);
  scope.cleanups.push(() => element.removeEventListener("change", update));
}

// Prop handles give a component body live reads over its props store. The
// component function still runs exactly once per instance; only reads race
// ahead, so state initializers can never re-run on a prop update.
function __velarRequiredProp(props, name, component) {
  if (__velarUntracked(() => props[name]) === undefined) throw new TypeError("Component " + component + " requires prop " + name);
  return Object.freeze({
    get() {
      const value = props[name];
      if (value === undefined) throw new TypeError("Component " + component + " requires prop " + name);
      return value;
    },
  });
}

function __velarProp(props, name, fallback) {
  const fallbackValue = __velarUntracked(() => props[name]) === undefined ? fallback() : undefined;
  return Object.freeze({
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
function __velarInstantiate(component, thunks, children, scope, namespace) {
  if (component != null && component.__velarSnapshotProps === true) {
    // Runtime-implemented components (Head, Router, Link, NavLink) consume a
    // one-time plain snapshot so their strict record validation still holds.
    const snapshot = {};
    for (const name of Object.getOwnPropertyNames(thunks)) snapshot[name] = __velarUntracked(thunks[name]);
    if (children !== undefined) snapshot.children = __velarUntracked(children);
    return __velarUntracked(() => component(snapshot, namespace));
  }
  const props = {};
  for (const name of Object.getOwnPropertyNames(thunks)) {
    const read = thunks[name];
    const cell = __velarState(undefined);
    __velarObserver(() => cell.set(read()), "dom", scope);
    Object.defineProperty(props, name, { enumerable: true, get: () => cell.get() });
  }
  if (children !== undefined) Object.defineProperty(props, "children", { enumerable: true, value: __velarUntracked(children) });
  return __velarUntracked(() => component(props, namespace));
}

// A component element in child position: one stable instance whose prop
// observers live in a dedicated scope, destroyed only when the position
// itself unmounts. Construction failures stay contained to the position.
function __velarChild(component, thunks, children, scope, namespace) {
  const childScope = __velarScope(scope.component);
  let constructed = false;
  scope.mounts.push(() => { if (constructed) __velarMountScope(childScope); });
  scope.cleanups.push(() => { if (constructed) __velarDestroyScope(childScope); });
  try {
    const node = __velarUseComponent(__velarInstantiate(component, thunks, children, childScope, namespace), childScope);
    constructed = true;
    return node;
  } catch (error) {
    __velarDestroyScope(childScope);
    __velarReport(error, "render", scope);
    return __velarDomCreateComment("velar:component-error");
  }
}

function __velarTick() {
  return new Promise((resolve) => __velarEnqueue(resolve));
}
`.trim();

function webRuntime(foundation: string): string {
  return `${foundation}\n${WEB_RUNTIME_BODY}`;
}
