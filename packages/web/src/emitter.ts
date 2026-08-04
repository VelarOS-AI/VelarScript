import type {
  CompilerStyleSegments,
  Expression,
  Program,
  Statement,
  LoweringHints,
} from "@velarscript/compiler/extension";
import { cssPropertyName } from "./look.ts";
import { JavaScriptEmitter, VELAR_ERROR_NORMALIZATION_RUNTIME } from "@velarscript/compiler/extension";

type AssignmentStatement = Extract<Statement, { readonly kind: "AssignmentStatement" }>;
type ComponentDeclaration = Extract<Statement, { readonly kind: "ComponentDeclaration" }>;
type JSXElementExpression = Extract<Expression, { readonly kind: "JSXElementExpression" }>;
type JSXAttribute = JSXElementExpression["attributes"][number];
type LookExpression = Extract<Expression, { readonly kind: "LookExpression" }>;
type LookEntry = LookExpression["entries"][number];

interface LookStaticAtom {
  readonly kind: "hook" | "media";
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

export class WebJavaScriptEmitter extends JavaScriptEmitter {
  private readonly reactive = new Map<string, "state" | "computed">();
  private currentScope: string | null = null;
  private currentJsxNamespace = '"html"';
  private readonly resourceContents: ReadonlyMap<string, string>;
  private cssOutput = "";
  private cssSegments: CompilerStyleSegments = { before: "", controlled: "", after: "" };
  private webOutput = false;
  private jsxId = 0;

  constructor(
    hints: LoweringHints,
    forcedFunctionExports: ReadonlySet<string> = new Set(),
    resourceContents: ReadonlyMap<string, string> = new Map(),
    _extensionImports: ReadonlyMap<string, ReadonlyMap<string, unknown>> = new Map(),
  ) {
    super(hints, forcedFunctionExports);
    this.resourceContents = resourceContents;
  }

  override emit(program: Program): string {
    this.reactive.clear();
    for (const [name, kind] of this.hints.reactiveBindings) this.reactive.set(name, kind);
    this.prepareLooks(program);
    this.webOutput = containsWebSyntax(program);
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

  protected override additionalHelpers(program: Program): readonly string[] {
    return this.webOutput ? [WEB_RUNTIME] : [];
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
    if (statement.kind === "StateDeclaration" || statement.kind === "ComputedDeclaration" || statement.kind === "ResourceDeclaration") {
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
      if (item.kind === "StateDeclaration" || item.kind === "ComputedDeclaration" || item.kind === "ResourceDeclaration") visitExpression(item.initializer);
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
    if (statement.kind === "ComputedDeclaration") {
      const indentation = "  ".repeat(depth);
      return `${indentation}${statement.exported ? "export " : ""}const ${statement.name} = __velarComputed(() => ${this.emitMappedExpression(statement.initializer)}, __velarGlobalScope);`;
    }
    if (statement.kind === "ResourceDeclaration" || statement.kind === "ActionDeclaration") return "";
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
      && expression.operand.kind === "UnitLiteralExpression") {
      return JSON.stringify(`${expression.operator}${expression.operand.raw}`);
    }
    if (expression.kind === "BinaryExpression" && ["+", "-", "*", "/"].includes(expression.operator)
      && containsUnitLiteral(expression)) {
      return this.emitLookArithmetic(expression);
    }
    if (expression.kind === "LookHookExpression") return "false";
    if (expression.kind === "LookExpression") return this.emitLook(expression);
    if (expression.kind === "IdentifierExpression") {
      if (this.reactive.has(expression.name)) return `${expression.name}.get()`;
      if (expression.name === "mount") return "__velarMount";
      if (expression.name === "tick") return "__velarTick";
      const controlled = this.hints.extensionLiterals.get(expression.span.start);
      if (controlled !== undefined) return JSON.stringify(controlled);
    }
    if (expression.kind === "JSXElementExpression") {
      return this.emitJsx(expression, this.currentScope ?? "__velarGlobalScope", this.currentScope !== null, this.currentJsxNamespace, false);
    }
    if (expression.kind === "CallExpression" && expression.callee.kind === "IdentifierExpression"
      && expression.callee.name === "mount" && expression.arguments.length === 2) {
      return `__velarMount(() => ${this.emitMappedExpression(expression.arguments[0]!)}, ${this.emitMappedExpression(expression.arguments[1]!)})`;
    }
    const controlledCall = expression.kind === "CallExpression" ? this.hints.extensionCalls.get(expression.span.start) : undefined;
    if (controlledCall !== undefined && expression.kind === "CallExpression" && expression.callee.kind === "IdentifierExpression") {
      const sourceArguments = expression.arguments.map((argument) => this.emitMappedExpression(argument));
      const namedOrder = this.hints.namedArgumentOrders.get(expression.span.start);
      const arguments_ = namedOrder
        ? namedOrder.map((source) => source === -1 ? "undefined" : `__namedArguments[${source}]`)
        : sourceArguments;
      const call = `__velarLookCall(${JSON.stringify(controlledCall)}, [${arguments_.join(", ")}])`;
      return namedOrder ? `((__namedArguments) => ${call})([${sourceArguments.join(", ")}])` : call;
    }
    return super.emitExpression(expression);
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
        const thenContexts = combineLookTerms(contexts, lookConditionTerms(entry.condition));
        const elseContexts = combineLookTerms(contexts, lookConditionTerms(entry.condition, true));
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
    if (expression.kind === "UnaryExpression" && (expression.operator === "+" || expression.operator === "-")
      && expression.operand.kind === "UnitLiteralExpression") {
      return this.emitMappedExpression(expression);
    }
    if (expression.kind === "UnaryExpression" && (expression.operator === "+" || expression.operator === "-")) {
      return `__velarLookUnary(${JSON.stringify(expression.operator)}, ${this.emitMappedExpression(expression.operand)})`;
    }
    if (expression.kind === "BinaryExpression" && ["+", "-", "*", "/"].includes(expression.operator)) {
      return this.emitLookArithmetic(expression);
    }
    return this.emitMappedExpression(expression);
  }

  private emitLookArithmetic(expression: Extract<Expression, { readonly kind: "BinaryExpression" }>): string {
    return `__velarLookMath(${JSON.stringify(expression.operator)}, ${this.emitMappedExpression(expression.left)}, ${this.emitMappedExpression(expression.right)})`;
  }

  private emitComponent(statement: ComponentDeclaration, depth: number): string {
    const indentation = "  ".repeat(depth);
    const outerIndent = "  ".repeat(depth + 1);
    const bodyIndent = "  ".repeat(depth + 2);
    const previousReactive = new Map(this.reactive);
    const previousScope = this.currentScope;
    const previousJsxNamespace = this.currentJsxNamespace;
    this.currentScope = "__scope";
    this.currentJsxNamespace = "__namespace";
    for (const parameter of statement.parameters) this.reactive.delete(parameter.name);
    for (const item of statement.body) {
      if (item.kind === "StateDeclaration") this.reactive.set(item.name, "state");
      else if (item.kind === "ComputedDeclaration") this.reactive.set(item.name, "computed");
    }

    const lines: string[] = [];
    for (const parameter of statement.parameters) {
      if (parameter.defaultValue) {
        lines.push(`${bodyIndent}const ${parameter.name} = __props.${parameter.name} === undefined ? ${this.emitMappedExpression(parameter.defaultValue)} : __props.${parameter.name};`);
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
      } else if (item.kind === "ComputedDeclaration") {
        lines.push(`${bodyIndent}const ${item.name} = __velarComputed(() => ${this.emitMappedExpression(item.initializer)}, __scope);`);
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

    const renderedRoot = render?.kind === "JSXElementExpression" && /^[A-Z]/u.test(render.tag)
      ? `(() => { const __rootFragment = document.createDocumentFragment(); __velarDynamic(__rootFragment, (__childScope) => ${this.emitJsx(render, "__childScope", true, "__namespace")}, __scope); return __rootFragment; })()`
      : render ? this.emitMappedExpression(render) : "document.createComment(\"missing render\")";
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

    this.reactive.clear();
    for (const [name, kind] of previousReactive) this.reactive.set(name, kind);
    this.currentScope = previousScope;
    this.currentJsxNamespace = previousJsxNamespace;
    return `${indentation}${statement.exported ? "export " : ""}function ${statement.name}(__props = {}, __namespace = "html") {\n${functionLines.filter(Boolean).join("\n")}\n${indentation}}`;
  }

  private emitReactiveAssignment(statement: AssignmentStatement, depth: number): string | null {
    const indentation = "  ".repeat(depth);
    if (statement.target.kind === "IdentifierExpression" && this.reactive.get(statement.target.name) === "state") {
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
      const properties = expression.attributes
        .filter((attribute) => attribute.name !== "key")
        .map((attribute) => this.emitMappedJavaScript(
          attribute.span,
          () => `${this.emitObjectKey(attribute.name)}: ${this.emitJsxAttributeValue(attribute)}`,
        ));
      if (hasMeaningfulChildren(expression.children)) properties.push(`children: ${this.emitJsxChildren(expression.children, scope, namespace)}`);
      const props = properties.join(", ");
      const component = `${expression.tag}({ ${props} }, ${namespace})`;
      return asChild ? `__velarUseComponent(${component}, ${scope})` : component;
    }

    const id = ++this.jsxId;
    const element = `__el${id}`;
    const elementNamespace = expression.tag === "svg" ? '"svg"' : namespace;
    const childNamespace = expression.tag === "foreignObject" ? '"html"' : elementNamespace;
    const lines = [expression.tag
      ? `const ${element} = __velarCreateElement(${JSON.stringify(expression.tag)}, ${elementNamespace});`
      : `const ${element} = document.createDocumentFragment();`];
    for (const attribute of expression.attributes) {
      if (attribute.name === "key") continue;
      lines.push(this.emitMappedJavaScript(attribute.span, () => {
        const value = attribute.value;
        if (attribute.name === "ref" && value && typeof value !== "string" && value.kind === "IdentifierExpression") {
          return `${value.name} = ${element}; ${scope}.cleanups.push(() => { if (${value.name} === ${element}) ${value.name} = null; });`;
        }
        if (attribute.name.startsWith("on:") && value && typeof value !== "string") {
          const [event, ...modifiers] = attribute.name.slice(3).split(".");
          return `__velarOn(${element}, ${JSON.stringify(event)}, ${this.emitMappedExpression(value)}, ${scope}, ${JSON.stringify(modifiers)});`;
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
        if (attribute.name === "look" && value && typeof value !== "string") {
          return `__velarLookBind(${element}, () => ${this.emitMappedExpression(value)}, ${scope});`;
        }
        if (attribute.name === "class" && value && typeof value !== "string") {
          return `__velarClassBind(${element}, () => ${this.emitMappedExpression(value)}, ${scope});`;
        }
        if (attribute.name === "unsafe:html" && value && typeof value !== "string") {
          return `__velarHtml(${element}, () => ${this.emitMappedExpression(value)}, ${scope});`;
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
        if (text) lines.push(this.emitMappedJavaScript(child.span, () => `${element}.append(document.createTextNode(${JSON.stringify(text)}));`));
      } else if (child.kind === "JSXElementExpression") {
        lines.push(this.emitMappedJavaScript(child.span, () => /^[A-Z]/u.test(child.tag)
          ? `__velarDynamic(${element}, (__childScope) => ${this.emitJsx(child, "__childScope", true, childNamespace)}, ${scope});`
          : `__velarAppend(${element}, ${this.emitJsx(child, scope, true, childNamespace)});`));
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
    const keyed = keyedListExpression(expression);
    const previousScope = this.currentScope;
    const previousJsxNamespace = this.currentJsxNamespace;
    this.currentScope = "__childScope";
    this.currentJsxNamespace = namespace;
    if (keyed) {
      const source = this.emitMappedExpression(keyed.source);
      const parameter = keyed.arrow.parameters[0]!.name;
      const key = this.emitJsxAttributeValue(keyed.key);
      const render = this.emitJsx(keyed.arrow.body, "__childScope", true, namespace);
      this.currentScope = previousScope;
      this.currentJsxNamespace = previousJsxNamespace;
      return `__velarKeyed(${parent}, () => ${source}, (${parameter}) => ${key}, (${parameter}, __childScope) => ${render}, ${scope});`;
    }
    const value = this.emitMappedExpression(expression);
    this.currentScope = previousScope;
    this.currentJsxNamespace = previousJsxNamespace;
    return `__velarDynamic(${parent}, (__childScope) => ${value}, ${scope});`;
  }

  private emitJsxAttributeValue(attribute: JSXAttribute): string {
    if (attribute.value === null) return "true";
    if (typeof attribute.value === "string") return JSON.stringify(attribute.value);
    return this.emitMappedExpression(attribute.value);
  }

  private prepareLooks(program: Program): void {
    const rules = new Map<string, LookRule>();
    const visit = (value: unknown): void => {
      if (!value || typeof value !== "object") return;
      const record = value as Record<string, unknown>;
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
              collect(entry.thenEntries, combineLookTerms(contexts, lookConditionTerms(entry.condition)), target);
              collect(entry.elseEntries, combineLookTerms(contexts, lookConditionTerms(entry.condition, true)), target);
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
      const mediaAtoms = rule.staticAtoms.filter((atom) => atom.kind === "media");
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

function keyedListExpression(expression: Expression): {
  readonly source: Expression;
  readonly arrow: Extract<Expression, { kind: "ArrowFunctionExpression" }> & { readonly body: JSXElementExpression };
  readonly key: JSXAttribute;
} | null {
  if (expression.kind !== "CallExpression" || expression.callee.kind !== "MemberExpression" || expression.callee.property !== "map") return null;
  const callback = expression.arguments[0];
  if (!callback || callback.kind !== "ArrowFunctionExpression" || callback.asynchronous || callback.parameters.length !== 1 || callback.body.kind !== "JSXElementExpression") return null;
  const key = callback.body.attributes.find((attribute) => attribute.name === "key");
  return key ? { source: expression.callee.object, arrow: callback as typeof callback & { readonly body: JSXElementExpression }, key } : null;
}

const EMPTY_LOOK_TERM: LookConditionTerm = Object.freeze({ staticAtoms: [], runtimeAtoms: [] });
const LOOK_CONDITION_TERM_LIMIT = 32;

function lookConditionTerms(expression: Expression, negated = false): readonly LookConditionTerm[] {
  if (expression.kind === "UnaryExpression" && expression.operator === "not") return lookConditionTerms(expression.operand, !negated);
  if (expression.kind === "BinaryExpression" && (expression.operator === "and" || expression.operator === "or")) {
    const conjunction = (expression.operator === "and") !== negated;
    const left = lookConditionTerms(expression.left, negated);
    const right = lookConditionTerms(expression.right, negated);
    return conjunction ? combineLookTerms(left, right) : [...left, ...right].slice(0, LOOK_CONDITION_TERM_LIMIT);
  }
  if (expression.kind === "LookHookExpression") {
    return [{ staticAtoms: [{ kind: "hook", name: expression.name, negated }], runtimeAtoms: [] }];
  }
  const media = viewportAtom(expression, negated);
  if (media) return [{ staticAtoms: [media], runtimeAtoms: [] }];
  return [{ staticAtoms: [], runtimeAtoms: [{ expression, negated }] }];
}

function viewportAtom(expression: Expression, negated: boolean): LookStaticAtom | null {
  if (expression.kind !== "BinaryExpression" || !["<", "<=", ">", ">="].includes(expression.operator)) return null;
  if (expression.left.kind !== "MemberExpression" || expression.left.object.kind !== "IdentifierExpression" || expression.left.object.name !== "viewport") return null;
  if ((expression.left.property !== "width" && expression.left.property !== "height") || expression.right.kind !== "UnitLiteralExpression") return null;
  return { kind: "media", name: expression.left.property, operator: expression.operator as "<" | "<=" | ">" | ">=", value: expression.right.raw, negated };
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
    || record.kind === "StateDeclaration" || record.kind === "ComputedDeclaration" || record.kind === "ResourceDeclaration" || record.kind === "ActionDeclaration" || record.kind === "WatchDeclaration") return true;
  if (record.kind === "IdentifierExpression" && (record.name === "mount" || record.name === "tick")) return true;
  return Object.values(record).some((child) => Array.isArray(child) ? child.some(containsWebSyntax) : containsWebSyntax(child));
}

const WEB_RUNTIME = String.raw`
${VELAR_ERROR_NORMALIZATION_RUNTIME}
const __velarRuntimeKey = Symbol.for("velar.runtime.v1");
const __velarRuntime = globalThis[__velarRuntimeKey] ??= {};
__velarRuntime.domQueue ??= new Set();
__velarRuntime.watchQueue ??= new Set();
__velarRuntime.flushPending ??= false;
__velarRuntime.activeObserver ??= null;
__velarRuntime.errorHandlers ??= new Set();
__velarRuntime.actionFailures ??= new WeakSet();
__velarRuntime.lookSources ??= new WeakMap();
__velarRuntime.classSources ??= new WeakMap();
try { WeakSet.prototype.has.call(__velarRuntime.actionFailures, __velarRuntime.actionFailures); }
catch { throw new TypeError("VelarScript action failure registry is invalid"); }
__velarRuntime.report ??= (value, options = {}) => {
  const error = __velarNormalizeError(value);
  const report = Object.freeze({
    error,
    phase: String(options.phase || "runtime"),
    detail: String(options.detail || ""),
    component: String(options.component || ""),
    timestamp: globalThis.Date.now(),
  });
  let handled = false;
  for (const handler of __velarRuntime.errorHandlers) {
    handled = true;
    try {
      const result = handler(report);
      if (result && typeof result.then === "function") result.catch((failure) => queueMicrotask(() => { throw __velarNormalizeError(failure); }));
    } catch (failure) { queueMicrotask(() => { throw __velarNormalizeError(failure); }); }
  }
  if (options.unhandled && !handled) queueMicrotask(() => { throw error; });
  return report;
};

function __velarReport(value, phase, scope = null, detail = "", unhandled = true) {
  return __velarRuntime.report(value, { phase, detail, component: scope?.component || "", unhandled });
}

function __velarReportEvent(value, scope, detail) {
  if (Error.isError(value) && WeakSet.prototype.delete.call(__velarRuntime.actionFailures, value)) return null;
  return __velarReport(value, "event", scope, detail);
}

function __velarSchedule(observer) {
  const queue = observer.mode === "watch" ? __velarRuntime.watchQueue : __velarRuntime.domQueue;
  if (!queue.has(observer) && queue.size >= 100000) throw new RangeError("VelarScript reactive queues cannot exceed 100000 observers");
  queue.add(observer);
  if (!__velarRuntime.flushPending) {
    __velarRuntime.flushPending = true;
    queueMicrotask(__velarFlush);
  }
}

function __velarFlush() {
  __velarRuntime.flushPending = false;
  for (const observer of [...__velarRuntime.domQueue]) { __velarRuntime.domQueue.delete(observer); observer.run(); }
  for (const observer of [...__velarRuntime.watchQueue]) { __velarRuntime.watchQueue.delete(observer); observer.run(); }
  if (__velarRuntime.domQueue.size || __velarRuntime.watchQueue.size) __velarScheduleFlush();
}

function __velarScheduleFlush() {
  if (!__velarRuntime.flushPending) { __velarRuntime.flushPending = true; queueMicrotask(__velarFlush); }
}

function __velarTrack(subscribers) {
  if (!__velarRuntime.activeObserver || __velarRuntime.activeObserver.stopped) return;
  subscribers.add(__velarRuntime.activeObserver);
  __velarRuntime.activeObserver.dependencies.add(subscribers);
}

function __velarCleanupObserver(observer) {
  for (const subscribers of observer.dependencies) subscribers.delete(observer);
  observer.dependencies.clear();
}

function __velarObserver(read, mode, scope) {
  const observer = {
    mode,
    stopped: false,
    dependencies: new Set(),
    run() {
      if (observer.stopped) return;
      __velarCleanupObserver(observer);
      const previous = __velarRuntime.activeObserver;
      __velarRuntime.activeObserver = observer;
      try { read(); }
      catch (error) { __velarReport(error, mode === "watch" ? "watch" : "render", scope); }
      finally { __velarRuntime.activeObserver = previous; }
    },
    notify() { if (!observer.stopped) __velarSchedule(observer); },
    stop() { observer.stopped = true; __velarCleanupObserver(observer); },
  };
  scope.cleanups.push(() => observer.stop());
  observer.run();
  return observer;
}

function __velarState(initial) {
  let value = initial;
  const subscribers = new Set();
  return {
    get() { __velarTrack(subscribers); return value; },
    set(next) {
      if (Object.is(value, next)) return next;
      value = next;
      for (const observer of [...subscribers]) observer.notify();
      return next;
    },
  };
}

function __velarComputed(read, scope) {
  let dirty = true;
  let value;
  const subscribers = new Set();
  const observer = {
    stopped: false,
    dependencies: new Set(),
    notify() {
      if (dirty) return;
      dirty = true;
      for (const dependent of [...subscribers]) dependent.notify();
    },
    stop() { observer.stopped = true; __velarCleanupObserver(observer); subscribers.clear(); },
  };
  scope.cleanups.push(() => observer.stop());
  return {
    get() {
      __velarTrack(subscribers);
      if (dirty) {
        __velarCleanupObserver(observer);
        const previous = __velarRuntime.activeObserver;
        __velarRuntime.activeObserver = observer;
        try { value = read(); dirty = false; } finally { __velarRuntime.activeObserver = previous; }
      }
      return value;
    },
  };
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
        const report = __velarRuntime.report(failure, { phase: "resource", detail: String(name || ""), component: scope.component || "", unhandled: false });
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
      "Action '" + String(name || "anonymous") + "' cannot run after its component is destroyed",
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
            const report = __velarRuntime.report(failure, { phase: "action", detail: String(name || ""), component: scope.component || "", unhandled: false });
            error.set(report.error);
            actionError = report.error;
            WeakSet.prototype.add.call(__velarRuntime.actionFailures, actionError);
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
      if (result && typeof result.then === "function") result.catch((error) => __velarReport(error, "mounted", scope));
    } catch (error) { __velarReport(error, "mounted", scope); }
  }
}

function __velarDestroyScope(scope) {
  for (const cleanup of [...scope.cleanups].reverse()) {
    try {
      const result = cleanup();
      if (result && typeof result.then === "function") result.catch((error) => __velarReport(error, "cleanup", scope));
    } catch (error) { __velarReport(error, "cleanup", scope); }
  }
  scope.cleanups.length = 0;
}

function __velarCleanupStep(run, scope) {
  try {
    const result = run();
    if (result && typeof result.then === "function") result.catch((error) => __velarReport(error, "cleanup", scope));
  } catch (error) { __velarReport(error, "cleanup", scope); }
}

function __velarWatch(read, callback, scope) {
  let current;
  let initialized = false;
  __velarObserver(() => {
    const next = read();
    if (initialized && !Object.is(next, current)) callback(next, current);
    current = next;
    initialized = true;
  }, "watch", scope);
}

function __velarComponent(node, scope, mounted, cleanup) {
  let destroyed = false;
  const ownedNodes = node && node.nodeType === 11 ? [...node.childNodes] : [node];
  if (mounted) scope.mounts.push(mounted);
  return {
    __velarComponent: true,
    node,
    mount(target, before = null) {
      if (destroyed) throw new Error("Cannot mount a destroyed VelarScript component");
      const parent = typeof target === "string" ? document.querySelector(target) : target;
      if (!parent) throw new Error("VelarScript mount target was not found");
      parent.insertBefore(node, before);
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
          if (result && typeof result.then === "function") result.catch((error) => __velarReport(error, "cleanup", scope));
        } catch (error) { __velarReport(error, "cleanup", scope); }
      }
      __velarDestroyScope(scope);
      if (remove) for (const owned of ownedNodes) owned.remove();
      return null;
    },
  };
}

function __velarScopeComponentRoot(node, attribute) {
  if (!attribute || !node) return;
  if (node.nodeType === 1) {
    node.setAttribute(attribute, "");
    return;
  }
  if (node.nodeType === 11) {
    for (const child of node.childNodes) if (child.nodeType === 1) child.setAttribute(attribute, "");
  }
}

function __velarUseComponent(instance, scope, parentStyleScope = "") {
  __velarScopeComponentRoot(instance.node, parentStyleScope);
  scope.mounts.push(() => instance.__mount());
  scope.cleanups.push(() => instance.destroy(false));
  return instance.node;
}

function __velarFatal(parent, error) {
  const fallback = document.createElement("section");
  fallback.setAttribute("role", "alert");
  fallback.setAttribute("data-velar-fatal", "");
  fallback.textContent = "The application could not start: " + error.message;
  parent.replaceChildren(fallback);
}

function __velarMount(create, target) {
  const parent = typeof target === "string" ? document.querySelector(target) : target;
  if (!parent) throw new Error("VelarScript mount target was not found");
  let value;
  try {
    value = typeof create === "function" ? create() : create;
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
    ? document.createElementNS(__velarSvgNamespace, tag)
    : document.createElement(tag);
}

function __velarAppend(parent, value) {
  if (value == null || value === false || value === true) return;
  if (Array.isArray(value)) { for (const item of value) __velarAppend(parent, item); return; }
  parent.append(value instanceof globalThis.Node ? value : document.createTextNode(String(value)));
}

function __velarDynamic(parent, read, scope) {
  const start = document.createComment("velar:start");
  const end = document.createComment("velar:end");
  parent.append(start, end);
  let nodes = [];
  let childScope = null;
  scope.mounts.push(() => { if (childScope) __velarMountScope(childScope); });
  __velarObserver(() => {
    const nextScope = __velarScope(scope.component);
    const fragment = document.createDocumentFragment();
    try { __velarAppend(fragment, read(nextScope)); }
    catch (error) { __velarDestroyScope(nextScope); throw error; }
    const nextNodes = [...fragment.childNodes];
    if (childScope) __velarDestroyScope(childScope);
    for (const node of nodes) node.remove();
    end.before(fragment);
    childScope = nextScope;
    nodes = nextNodes;
    if (scope.mounted) __velarMountScope(nextScope);
  }, "dom", scope);
  scope.cleanups.push(() => { if (childScope) __velarDestroyScope(childScope); });
}

function __velarKeyed(parent, read, keyOf, render, scope) {
  const start = document.createComment("velar:keyed-start");
  const end = document.createComment("velar:keyed-end");
  parent.append(start, end);
  let entries = new Map();
  scope.mounts.push(() => { for (const entry of entries.values()) __velarMountScope(entry.scope); });
  __velarObserver(() => {
    const values = read() ?? [];
    const next = new Map();
    const created = [];
    try {
      for (const value of values) {
        const key = keyOf(value);
        if (next.has(key)) throw new Error("Duplicate JSX key '" + String(key) + "'");
        let entry = entries.get(key);
        if (entry && !Object.is(entry.value, value)) entry = null;
        if (!entry) {
          const childScope = __velarScope(scope.component);
          const fragment = document.createDocumentFragment();
          try { __velarAppend(fragment, render(value, childScope)); }
          catch (error) { __velarDestroyScope(childScope); throw error; }
          entry = { value, scope: childScope, nodes: [...fragment.childNodes], fragment };
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
      for (const node of entry.nodes) node.remove();
    }
    for (const entry of next.values()) {
      if (entry.fragment) {
        end.before(entry.fragment);
        entry.fragment = null;
        if (scope.mounted) __velarMountScope(entry.scope);
      } else {
        for (const node of entry.nodes) end.before(node);
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
  __velarSetAttribute(element, name, value === true ? "" : String(value));
}

function __velarAttr(element, name, read, scope) {
  __velarObserver(() => {
    const value = read();
    if (value == null || value === false) __velarRemoveAttribute(element, name);
    else __velarSetAttribute(element, name, value === true ? "" : String(value));
  }, "dom", scope);
}

function __velarSetAttribute(element, name, value) {
  if (name.startsWith("xlink:")) element.setAttributeNS(__velarXlinkNamespace, name, value);
  else if (name.startsWith("xml:")) element.setAttributeNS(__velarXmlNamespace, name, value);
  else element.setAttribute(name, value);
}

function __velarRemoveAttribute(element, name) {
  if (name.startsWith("xlink:")) element.removeAttributeNS(__velarXlinkNamespace, name.slice(6));
  else if (name.startsWith("xml:")) element.removeAttributeNS(__velarXmlNamespace, name.slice(4));
  else element.removeAttribute(name);
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
  if (token.endsWith(":content") && typeof value === "string" && value !== "none" && value !== "normal") return JSON.stringify(value);
  return String(value);
}

function __velarLookDimension(value) {
  if (typeof value !== "string") return null;
  const match = /^([+-]?(?:\d+(?:\.\d+)?|\.\d+))([A-Za-z%]+)$/.exec(value);
  if (!match) return null;
  const number = Number(match[1]);
  return Number.isFinite(number) ? { number, unit: match[2] } : null;
}

function __velarLookNumber(value, label) {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new TypeError(label + " must be a finite number");
  return value;
}

function __velarLookUnary(operator, value) {
  if (typeof value === "number") return operator === "-" ? -__velarLookNumber(value, "Look operand") : __velarLookNumber(value, "Look operand");
  if (typeof value !== "string") throw new TypeError("Look unit arithmetic requires a number or typed visual value");
  if (operator === "+") return value;
  const dimension = __velarLookDimension(value);
  if (dimension) return String(-dimension.number) + dimension.unit;
  return "calc(-1 * (" + value + "))";
}

function __velarLookMath(operator, left, right) {
  if (typeof left === "number" && typeof right === "number") {
    const first = __velarLookNumber(left, "Left Look operand");
    const second = __velarLookNumber(right, "Right Look operand");
    const result = operator === "+" ? first + second : operator === "-" ? first - second : operator === "*" ? first * second : first / second;
    if (!Number.isFinite(result)) throw new RangeError("Look arithmetic must produce a finite value");
    return result;
  }
  const leftDimension = __velarLookDimension(left);
  const rightDimension = __velarLookDimension(right);
  if ((operator === "+" || operator === "-") && leftDimension && rightDimension && leftDimension.unit === rightDimension.unit) {
    const result = operator === "+" ? leftDimension.number + rightDimension.number : leftDimension.number - rightDimension.number;
    if (!Number.isFinite(result)) throw new RangeError("Look arithmetic must produce a finite value");
    return String(result) + leftDimension.unit;
  }
  if (operator === "*" && leftDimension && typeof right === "number") {
    return String(leftDimension.number * __velarLookNumber(right, "Right Look operand")) + leftDimension.unit;
  }
  if (operator === "*" && typeof left === "number" && rightDimension) {
    return String(__velarLookNumber(left, "Left Look operand") * rightDimension.number) + rightDimension.unit;
  }
  if (operator === "/" && leftDimension && typeof right === "number") {
    const divisor = __velarLookNumber(right, "Right Look operand");
    if (divisor === 0) throw new RangeError("Look unit division cannot use zero");
    return String(leftDimension.number / divisor) + leftDimension.unit;
  }
  if ((typeof left !== "string" && typeof left !== "number") || (typeof right !== "string" && typeof right !== "number")) {
    throw new TypeError("Look unit arithmetic requires numbers or typed visual values");
  }
  return "calc(" + left + " " + operator + " " + right + ")";
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
  for (const [token, value] of Object.entries(merged)) element.style.setProperty(__velarLookVariable(token), __velarLookValue(token, value));
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

__velarRuntime.applyLook ??= __velarApplyExternalLook;

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

function __velarLookCall(name, args) {
  if (name === "color") return String(args[0]);
  if (name === "rgb") return "rgb(" + args.slice(0, 3).join(" ") + ")";
  if (name === "rgba") return "rgb(" + args.slice(0, 3).join(" ") + " / " + args[3] + ")";
  if (name === "hsl") return "hsl(" + args[0] + " " + args[1] + "% " + args[2] + "%)";
  if (name === "alpha") return "color-mix(in srgb, " + args[0] + " " + Number(args[1]) * 100 + "%, transparent)";
  if (name === "lighten") return "color-mix(in srgb, " + args[0] + ", white " + Number(args[1]) * 100 + "%)";
  if (name === "darken") return "color-mix(in srgb, " + args[0] + ", black " + Number(args[1]) * 100 + "%)";
  if (name === "border") return args[0] + " " + (args[2] ?? "solid") + " " + args[1];
  if (name === "shadow") {
    const spread = args[4] ?? "0px";
    return (args[5] ? "inset " : "") + args[0] + " " + args[1] + " " + args[2] + " " + spread + " " + args[3];
  }
  if (name === "linearGradient") return "linear-gradient(" + args[0] + ", " + args[1] + ", " + args[2] + ")";
  if (name === "asset") return "url(" + JSON.stringify(args[0]) + ")";
  if (name === "minmax") return "minmax(" + args[0] + ", " + args[1] + ")";
  if (name === "repeat") return "repeat(" + args[0] + ", " + args[1] + ")";
  if (name === "tracks") return args.join(" ");
  if (name === "transition") return args[0] + " " + args[1] + " " + (args[2] ?? "ease") + (args[3] ? " " + args[3] : "");
  if (name === "spacing") return args.filter((value) => value !== undefined).join(" ");
  if (name === "min" || name === "max" || name === "clamp") return name + "(" + args.join(", ") + ")";
  throw new TypeError("Unknown Look builder " + name);
}

function __velarHtml(element, read, scope) {
  __velarObserver(() => { element.innerHTML = String(read() ?? ""); }, "dom", scope);
}

function __velarOn(element, event, handler, scope, modifiers = []) {
  const capture = modifiers.includes("capture");
  const options = { capture, once: modifiers.includes("once") };
  const listener = (value) => {
    if (modifiers.includes("self") && value.target !== element) return;
    if (modifiers.includes("prevent")) value.preventDefault();
    if (modifiers.includes("stop")) value.stopPropagation();
    try {
      const result = handler(value);
      if (result && typeof result.then === "function") result.catch((error) => __velarReportEvent(error, scope, event));
    } catch (error) { __velarReportEvent(error, scope, event); }
  };
  element.addEventListener(event, listener, options);
  scope.cleanups.push(() => element.removeEventListener(event, listener, capture));
}

function __velarBindValue(element, state, scope, numeric = false, parse = null) {
  __velarObserver(() => { const value = state.get(); element.value = value == null ? "" : String(value); }, "dom", scope);
  const update = () => state.set(numeric ? element.valueAsNumber : parse ? parse(element.value) : element.value);
  element.addEventListener("input", update);
  scope.cleanups.push(() => element.removeEventListener("input", update));
}

function __velarBindChecked(element, state, scope) {
  __velarObserver(() => { element.checked = Boolean(state.get()); }, "dom", scope);
  const update = () => state.set(element.checked);
  element.addEventListener("change", update);
  scope.cleanups.push(() => element.removeEventListener("change", update));
}

function __velarRequiredProp(props, name, component) {
  if (props[name] === undefined) throw new TypeError("Component " + component + " requires prop " + name);
  return props[name];
}

function __velarTick() {
  return new Promise((resolve) => queueMicrotask(resolve));
}
`.trim();
