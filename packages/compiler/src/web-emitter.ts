import type {
  AssignmentStatement,
  ComponentDeclaration,
  Expression,
  JSXAttribute,
  JSXElementExpression,
  Program,
  Statement,
} from "./ast.ts";
import type { LoweringHints } from "./analyzer.ts";
import { JavaScriptEmitter } from "./emitter.ts";

export class WebJavaScriptEmitter extends JavaScriptEmitter {
  private readonly reactive = new Map<string, "state" | "computed">();
  private currentScope: string | null = null;
  private currentStyleScope: string | null = null;
  private currentJsxNamespace = '"html"';
  private readonly componentScopes = new Map<string, string>();
  private cssOutput = "";
  private webOutput = false;
  private jsxId = 0;

  constructor(hints: LoweringHints, forcedFunctionExports: ReadonlySet<string> = new Set()) {
    super(hints, forcedFunctionExports);
  }

  override emit(program: Program): string {
    this.reactive.clear();
    for (const [name, kind] of this.hints.reactiveBindings) this.reactive.set(name, kind);
    this.prepareStyles(program);
    this.webOutput = containsWebSyntax(program);
    return super.emit(program);
  }

  css(): string {
    return this.cssOutput;
  }

  web(): boolean {
    return this.webOutput;
  }

  protected override additionalHelpers(program: Program): readonly string[] {
    return this.webOutput ? [WEB_RUNTIME] : [];
  }

  protected override emitStatement(statement: Statement, depth: number): string {
    if (statement.kind === "ComponentDeclaration") return this.emitComponent(statement, depth);
    if (statement.kind === "StateDeclaration") {
      const indentation = "  ".repeat(depth);
      return `${indentation}${statement.exported ? "export " : ""}const ${statement.name} = __velarState(${this.emitExpression(statement.initializer)});`;
    }
    if (statement.kind === "ComputedDeclaration") {
      const indentation = "  ".repeat(depth);
      return `${indentation}${statement.exported ? "export " : ""}const ${statement.name} = __velarComputed(() => ${this.emitExpression(statement.initializer)}, __velarGlobalScope);`;
    }
    if (statement.kind === "ResourceDeclaration" || statement.kind === "ActionDeclaration") return "";
    if (statement.kind === "WatchDeclaration") {
      const indentation = "  ".repeat(depth);
      const parameters = [statement.currentName, statement.previousName].filter((name): name is string => name !== null).join(", ");
      const body = statement.body.map((child) => this.emitStatement(child, depth + 1)).filter(Boolean).join("\n");
      return `${indentation}__velarWatch(() => ${this.emitExpression(statement.expression)}, (${parameters}) => {${body ? `\n${body}\n${indentation}` : ""}}, __velarGlobalScope);`;
    }
    if (statement.kind === "AssignmentStatement") {
      const reactive = this.emitReactiveAssignment(statement, depth);
      if (reactive) return reactive;
    }
    return super.emitStatement(statement, depth);
  }

  protected override emitExpression(expression: Expression): string {
    if (expression.kind === "IdentifierExpression") {
      if (this.reactive.has(expression.name)) return `${expression.name}.get()`;
      if (expression.name === "mount") return "__velarMount";
      if (expression.name === "tick") return "__velarTick";
    }
    if (expression.kind === "JSXElementExpression") {
      return this.emitJsx(expression, this.currentScope ?? "__velarGlobalScope", this.currentScope !== null, this.currentJsxNamespace);
    }
    if (expression.kind === "CallExpression" && expression.callee.kind === "IdentifierExpression"
      && expression.callee.name === "mount" && expression.arguments.length === 2) {
      return `__velarMount(() => ${this.emitExpression(expression.arguments[0]!)}, ${this.emitExpression(expression.arguments[1]!)})`;
    }
    if (expression.kind === "CallExpression" && expression.callee.kind === "MemberExpression"
      && expression.callee.object.kind === "IdentifierExpression"
      && this.reactive.get(expression.callee.object.name) === "state"
      && ["append", "extend", "set", "remove", "clear"].includes(expression.callee.property)) {
      const state = expression.callee.object.name;
      const helper = collectionMutationHelper(expression.callee.property);
      const arguments_ = expression.arguments.map((argument) => this.emitExpression(argument));
      return `${state}.mutate((__value) => ${helper}(__value${arguments_.length > 0 ? `, ${arguments_.join(", ")}` : ""}))`;
    }
    return super.emitExpression(expression);
  }

  private emitComponent(statement: ComponentDeclaration, depth: number): string {
    const indentation = "  ".repeat(depth);
    const outerIndent = "  ".repeat(depth + 1);
    const bodyIndent = "  ".repeat(depth + 2);
    const previousReactive = new Map(this.reactive);
    const previousScope = this.currentScope;
    const previousStyleScope = this.currentStyleScope;
    const previousJsxNamespace = this.currentJsxNamespace;
    this.currentScope = "__scope";
    this.currentStyleScope = this.componentScopes.get(statement.name) ?? null;
    this.currentJsxNamespace = "__namespace";
    for (const parameter of statement.parameters) this.reactive.delete(parameter.name);
    for (const item of statement.body) {
      if (item.kind === "StateDeclaration") this.reactive.set(item.name, "state");
      else if (item.kind === "ComputedDeclaration") this.reactive.set(item.name, "computed");
    }

    const lines: string[] = [];
    for (const parameter of statement.parameters) {
      if (parameter.defaultValue) {
        lines.push(`${bodyIndent}const ${parameter.name} = __props.${parameter.name} === undefined ? ${this.emitExpression(parameter.defaultValue)} : __props.${parameter.name};`);
      } else {
        lines.push(`${bodyIndent}const ${parameter.name} = __velarRequiredProp(__props, ${JSON.stringify(parameter.name)}, ${JSON.stringify(statement.name)});`);
      }
    }

    let render: Expression | null = null;
    let mountedBody: readonly Statement[] = [];
    let cleanupBody: readonly Statement[] = [];
    for (const item of statement.body) {
      if (item.kind === "StateDeclaration") {
        lines.push(`${bodyIndent}const ${item.name} = __velarState(${this.emitExpression(item.initializer)});`);
      } else if (item.kind === "ComputedDeclaration") {
        lines.push(`${bodyIndent}const ${item.name} = __velarComputed(() => ${this.emitExpression(item.initializer)}, __scope);`);
      } else if (item.kind === "ResourceDeclaration") {
        lines.push(`${bodyIndent}const ${item.name} = __velarResource(() => ${this.emitExpression(item.initializer)}, __scope, ${JSON.stringify(item.name)});`);
      } else if (item.kind === "ActionDeclaration") {
        const parameters = item.parameters.map((parameter) => this.emitParameter(parameter.name, parameter.defaultValue, parameter.rest)).join(", ");
        const actionLines = item.body.map((child) => this.emitStatement(child, depth + 3)).filter(Boolean);
        if (!this.blockAlwaysReturns(item.body)) actionLines.push(`${"  ".repeat(depth + 3)}return null;`);
        const actionBody = actionLines.join("\n");
        lines.push(`${bodyIndent}const ${item.name} = __velarAction(async (${parameters}) => {${actionBody ? `\n${actionBody}\n${bodyIndent}` : ""}}, __scope, ${JSON.stringify(item.name)});`);
      } else if (item.kind === "WatchDeclaration") {
        const parameters = [item.currentName, item.previousName].filter((name): name is string => name !== null).join(", ");
        const watchLines = item.body.map((child) => this.emitStatement(child, depth + 3)).filter(Boolean).join("\n");
        lines.push(`${bodyIndent}__velarWatch(() => ${this.emitExpression(item.expression)}, (${parameters}) => {${watchLines ? `\n${watchLines}\n${bodyIndent}` : ""}}, __scope);`);
      } else if (item.kind === "MountedBlock") {
        mountedBody = item.body;
      } else if (item.kind === "CleanupBlock") {
        cleanupBody = item.body;
      } else if (item.kind === "StyleBlock") {
        // CSS is emitted by the style asset pass.
      } else if (item.kind === "ReturnStatement") {
        render = item.value;
      } else {
        lines.push(this.emitStatement(item, depth + 2));
      }
    }

    const renderedRoot = render?.kind === "JSXElementExpression" && /^[A-Z]/u.test(render.tag)
      ? `(() => { const __rootFragment = document.createDocumentFragment(); __velarDynamic(__rootFragment, (__childScope) => ${this.emitJsx(render, "__childScope", true, "__namespace")}, __scope); return __rootFragment; })()`
      : render ? this.emitExpression(render) : "document.createComment(\"missing render\")";
    lines.push(`${bodyIndent}const __root = ${renderedRoot};`);
    const mounted = mountedBody.map((child) => this.emitStatement(child, depth + 3)).filter(Boolean).join("\n");
    const cleanup = cleanupBody.map((child) => {
      if (["VariableDeclaration", "FunctionDeclaration", "ClassDeclaration", "TypeDeclaration", "EnumDeclaration"].includes(child.kind)) {
        return this.emitStatement(child, depth + 3);
      }
      const inner = this.emitStatement(child, depth + 4);
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
    this.currentStyleScope = previousStyleScope;
    this.currentJsxNamespace = previousJsxNamespace;
    return `${indentation}${statement.exported ? "export " : ""}function ${statement.name}(__props = {}, __namespace = "html") {\n${functionLines.filter(Boolean).join("\n")}\n${indentation}}`;
  }

  private emitReactiveAssignment(statement: AssignmentStatement, depth: number): string | null {
    const indentation = "  ".repeat(depth);
    if (statement.target.kind === "IdentifierExpression" && this.reactive.get(statement.target.name) === "state") {
      const state = statement.target.name;
      const value = this.emitExpression(statement.value);
      if (statement.operator === "=") return `${indentation}${state}.set(${value});`;
      return `${indentation}${state}.set(${state}.get() ${statement.operator.slice(0, -1)} ${value});`;
    }
    if (statement.target.kind === "MemberExpression" && statement.target.object.kind === "IdentifierExpression"
      && this.reactive.get(statement.target.object.name) === "state") {
      const state = statement.target.object.name;
      const property = JSON.stringify(statement.target.property);
      const value = this.emitExpression(statement.value);
      const next = statement.operator === "=" ? value : `__value[${property}] ${statement.operator.slice(0, -1)} ${value}`;
      return `${indentation}${state}.mutate((__value) => (__value[${property}] = ${next}));`;
    }
    if (statement.target.kind === "IndexExpression" && statement.target.object.kind === "IdentifierExpression"
      && this.reactive.get(statement.target.object.name) === "state") {
      const state = statement.target.object.name;
      const index = this.emitExpression(statement.target.index);
      const value = this.emitExpression(statement.value);
      const next = statement.operator === "=" ? value : `__velarIndex(__value, ${index}) ${statement.operator.slice(0, -1)} ${value}`;
      return `${indentation}${state}.mutate((__value) => __velarSetIndex(__value, ${index}, ${next}));`;
    }
    return null;
  }

  private emitJsx(expression: JSXElementExpression, scope: string, asChild: boolean, namespace: string): string {
    if (/^[A-Z]/u.test(expression.tag)) {
      const properties = expression.attributes
        .filter((attribute) => attribute.name !== "key" && !isJsxControlAttribute(attribute))
        .map((attribute) => `${this.emitObjectKey(attribute.name)}: ${this.emitJsxAttributeValue(attribute)}`);
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
    if (expression.tag && this.currentStyleScope) lines.push(`${element}.setAttribute(${JSON.stringify(this.currentStyleScope)}, "");`);
    for (const attribute of expression.attributes) {
      const value = attribute.value;
      if (attribute.name === "key" || isJsxControlAttribute(attribute)) continue;
      if (attribute.name === "ref" && value && typeof value !== "string" && value.kind === "IdentifierExpression") {
        lines.push(`${value.name} = ${element}; ${scope}.cleanups.push(() => { if (${value.name} === ${element}) ${value.name} = null; });`);
      } else if (attribute.name.startsWith("on:") && value && typeof value !== "string") {
        const [event, ...modifiers] = attribute.name.slice(3).split(".");
        lines.push(`__velarOn(${element}, ${JSON.stringify(event)}, ${this.emitExpression(value)}, ${scope}, ${JSON.stringify(modifiers)});`);
      } else if (attribute.name === "bind:value" && value && typeof value !== "string" && value.kind === "IdentifierExpression") {
        const numeric = expression.tag === "input" && expression.attributes.some((item) => item.name === "type" && item.value === "number");
        const enumName = this.hints.enumValueBindings.get(attribute.span.start);
        lines.push(`__velarBindValue(${element}, ${value.name}, ${scope}, ${numeric}${enumName ? `, ${enumName}.parse` : ""});`);
      } else if (attribute.name === "bind:checked" && value && typeof value !== "string" && value.kind === "IdentifierExpression") {
        lines.push(`__velarBindChecked(${element}, ${value.name}, ${scope});`);
      } else if (attribute.name.startsWith("class:") && value && typeof value !== "string") {
        lines.push(`__velarClass(${element}, ${JSON.stringify(attribute.name.slice(6))}, () => ${this.emitExpression(value)}, ${scope});`);
      } else if (attribute.name.startsWith("style:") && value && typeof value !== "string") {
        lines.push(`__velarStyle(${element}, ${JSON.stringify(attribute.name.slice(6))}, () => ${this.emitExpression(value)}, ${scope});`);
      } else if (attribute.name === "unsafe:html" && value && typeof value !== "string") {
        lines.push(`__velarHtml(${element}, () => ${this.emitExpression(value)}, ${scope});`);
      } else if (typeof value === "string" || value === null) {
        lines.push(`__velarStaticAttr(${element}, ${JSON.stringify(attribute.name)}, ${value === null ? "true" : JSON.stringify(value)});`);
      } else {
        lines.push(`__velarAttr(${element}, ${JSON.stringify(attribute.name)}, () => ${this.emitExpression(value)}, ${scope});`);
      }
    }
    for (let index = 0; index < expression.children.length;) {
      const child = expression.children[index]!;
      if (child.kind === "JSXText") {
        const text = normalizeJsxText(child.value);
        if (text) lines.push(`${element}.append(document.createTextNode(${JSON.stringify(text)}));`);
        index += 1;
      } else if (child.kind === "JSXElementExpression") {
        const control = child.attributes.find(isJsxControlAttribute);
        if (control?.name === "if") {
          const branches: { element: JSXElementExpression; control: JSXAttribute }[] = [{ element: child, control }];
          let cursor = index + 1;
          let sawElse = false;
          while (cursor < expression.children.length) {
            const next = expression.children[cursor]!;
            if (next.kind === "JSXText" && next.value.trim().length === 0) {
              cursor += 1;
              continue;
            }
            if (next.kind !== "JSXElementExpression") break;
            const nextControl = next.attributes.find(isJsxControlAttribute);
            if (!nextControl || (nextControl.name !== "else-if" && nextControl.name !== "else") || sawElse) break;
            branches.push({ element: next, control: nextControl });
            sawElse = nextControl.name === "else";
            cursor += 1;
          }
          lines.push(this.emitJsxConditionalBranches(element, branches, scope, childNamespace));
          index = cursor;
        } else if (/^[A-Z]/u.test(child.tag)) {
          lines.push(`__velarDynamic(${element}, (__childScope) => ${this.emitJsx(child, "__childScope", true, childNamespace)}, ${scope});`);
          index += 1;
        } else {
          lines.push(`__velarAppend(${element}, ${this.emitJsx(child, scope, true, childNamespace)});`);
          index += 1;
        }
      } else {
        lines.push(this.emitDynamicChild(element, child.expression, scope, childNamespace));
        index += 1;
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
      const source = this.emitExpression(keyed.source);
      const parameter = keyed.arrow.parameters[0]!.name;
      const key = this.emitJsxAttributeValue(keyed.key);
      const render = this.emitJsx(keyed.arrow.body, "__childScope", true, namespace);
      this.currentScope = previousScope;
      this.currentJsxNamespace = previousJsxNamespace;
      return `__velarKeyed(${parent}, () => ${source}, (${parameter}) => ${key}, (${parameter}, __childScope) => ${render}, ${scope});`;
    }
    const value = this.emitExpression(expression);
    this.currentScope = previousScope;
    this.currentJsxNamespace = previousJsxNamespace;
    return `__velarDynamic(${parent}, (__childScope) => ${value}, ${scope});`;
  }

  private emitJsxConditionalBranches(
    parent: string,
    branches: readonly { element: JSXElementExpression; control: JSXAttribute }[],
    scope: string,
    namespace: string,
  ): string {
    const previousScope = this.currentScope;
    const previousJsxNamespace = this.currentJsxNamespace;
    this.currentScope = "__childScope";
    this.currentJsxNamespace = namespace;
    let selection = "null";
    for (let index = branches.length - 1; index >= 0; index -= 1) {
      const branch = branches[index]!;
      const rendered = this.emitJsx(branch.element, "__childScope", true, namespace);
      if (branch.control.name === "else") {
        selection = rendered;
      } else if (branch.control.value && typeof branch.control.value !== "string") {
        selection = `(${this.emitCondition(branch.control.value)} ? ${rendered} : ${selection})`;
      }
    }
    this.currentScope = previousScope;
    this.currentJsxNamespace = previousJsxNamespace;
    return `__velarDynamic(${parent}, (__childScope) => ${selection}, ${scope});`;
  }

  private emitJsxAttributeValue(attribute: JSXAttribute): string {
    if (attribute.value === null) return "true";
    if (typeof attribute.value === "string") return JSON.stringify(attribute.value);
    return this.emitExpression(attribute.value);
  }

  private prepareStyles(program: Program): void {
    this.componentScopes.clear();
    const output: string[] = [];
    for (const statement of program.body) {
      if (statement.kind !== "ComponentDeclaration") continue;
      const blocks = statement.body.filter((item) => item.kind === "StyleBlock");
      const scoped = blocks.filter((block) => !block.global);
      if (scoped.length > 0) {
        const attribute = `data-velar-${stableHash(`${statement.name}\0${scoped.map((block) => block.css).join("\0")}`)}`;
        this.componentScopes.set(statement.name, attribute);
        for (const block of scoped) output.push(scopeCss(block.css, attribute));
      }
      for (const block of blocks) if (block.global) output.push(block.css);
    }
    this.cssOutput = output.filter(Boolean).join("\n\n");
    if (this.cssOutput) this.cssOutput += "\n";
  }
}

function collectionMutationHelper(property: string): string {
  if (property === "append") return "__velarCollectionAppend";
  if (property === "extend") return "__velarCollectionExtend";
  if (property === "set") return "__velarCollectionSet";
  if (property === "remove") return "__velarCollectionRemove";
  return "__velarCollectionClear";
}

function normalizeJsxText(value: string): string {
  const normalized = value.replace(/\s+/gu, " ");
  if (!value.includes("\n")) return normalized;
  return (/^\s*\n/u.test(value) ? normalized.trimStart() : normalized).replace(/\n\s*$/u.test(value) ? /\s+$/u : /$^/u, "");
}

function hasMeaningfulChildren(children: JSXElementExpression["children"]): boolean {
  return children.some((child) => child.kind !== "JSXText" || child.value.trim().length > 0);
}

function isJsxControlAttribute(attribute: JSXAttribute): boolean {
  return attribute.name === "if" || attribute.name === "else-if" || attribute.name === "else";
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

function stableHash(value: string): string {
  let hash = 2_166_136_261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return (hash >>> 0).toString(36);
}

function scopeCss(css: string, attribute: string): string {
  let output = "";
  let cursor = 0;
  while (cursor < css.length) {
    const open = findNextCssBrace(css, cursor);
    if (open === -1) return output + css.slice(cursor);
    const close = findMatchingCssBrace(css, open);
    if (close === -1) return output + css.slice(cursor);
    const header = css.slice(cursor, open);
    const body = css.slice(open + 1, close);
    const trimmed = header.trim();
    if (/^@(?:-webkit-)?keyframes\b/iu.test(trimmed) || /^@(?:font-face|page|property|counter-style)\b/iu.test(trimmed)) {
      output += `${header}{${body}}`;
    } else if (/^@(?:media|supports|container|layer|document)\b/iu.test(trimmed)) {
      output += `${header}{${scopeCss(body, attribute)}}`;
    } else if (trimmed.startsWith("@")) {
      output += `${header}{${body}}`;
    } else {
      output += `${scopeSelectors(header, attribute)}{${body}}`;
    }
    cursor = close + 1;
  }
  return output;
}

function scopeSelectors(selectorText: string, attribute: string): string {
  return selectorText.split(",").map((selector) => selector.split(/(\s+|[>+~])/u).map((part) => {
    if (!part || /^\s+$|^[>+~]$/u.test(part)) return part;
    const pseudo = part.search(/:{1,2}[A-Za-z-]/u);
    return pseudo === -1 ? `${part}[${attribute}]` : `${part.slice(0, pseudo)}[${attribute}]${part.slice(pseudo)}`;
  }).join("")).join(",");
}

function findNextCssBrace(css: string, start: number): number {
  let quote = "";
  let comment = false;
  for (let index = start; index < css.length; index += 1) {
    if (comment) {
      if (css.startsWith("*/", index)) { comment = false; index += 1; }
      continue;
    }
    if (!quote && css.startsWith("/*", index)) { comment = true; index += 1; continue; }
    const character = css[index]!;
    if (quote) {
      if (character === "\\") index += 1;
      else if (character === quote) quote = "";
    } else if (character === '"' || character === "'") quote = character;
    else if (character === "{") return index;
  }
  return -1;
}

function findMatchingCssBrace(css: string, open: number): number {
  let depth = 1;
  let quote = "";
  let comment = false;
  for (let index = open + 1; index < css.length; index += 1) {
    if (comment) {
      if (css.startsWith("*/", index)) { comment = false; index += 1; }
      continue;
    }
    if (!quote && css.startsWith("/*", index)) { comment = true; index += 1; continue; }
    const character = css[index]!;
    if (quote) {
      if (character === "\\") index += 1;
      else if (character === quote) quote = "";
      continue;
    }
    if (character === '"' || character === "'") quote = character;
    else if (character === "{") depth += 1;
    else if (character === "}" && --depth === 0) return index;
  }
  return -1;
}

function containsWebSyntax(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  if (record.kind === "ComponentDeclaration" || record.kind === "JSXElementExpression"
    || record.kind === "StateDeclaration" || record.kind === "ComputedDeclaration" || record.kind === "ResourceDeclaration" || record.kind === "ActionDeclaration" || record.kind === "WatchDeclaration") return true;
  if (record.kind === "IdentifierExpression" && (record.name === "mount" || record.name === "tick")) return true;
  return Object.values(record).some((child) => Array.isArray(child) ? child.some(containsWebSyntax) : containsWebSyntax(child));
}

const WEB_RUNTIME = String.raw`
const __velarRuntimeKey = Symbol.for("velar.runtime.v1");
const __velarRuntime = globalThis[__velarRuntimeKey] ??= {};
__velarRuntime.domQueue ??= new Set();
__velarRuntime.watchQueue ??= new Set();
__velarRuntime.flushPending ??= false;
__velarRuntime.activeObserver ??= null;
__velarRuntime.errorHandlers ??= new Set();
__velarRuntime.report ??= (value, options = {}) => {
  const error = value instanceof Error ? value : new Error(String(value), { cause: value });
  const report = Object.freeze({
    error,
    phase: String(options.phase || "runtime"),
    detail: String(options.detail || ""),
    component: String(options.component || ""),
    timestamp: Date.now(),
  });
  let handled = false;
  for (const handler of __velarRuntime.errorHandlers) {
    handled = true;
    try {
      const result = handler(report);
      if (result && typeof result.then === "function") result.catch((failure) => queueMicrotask(() => { throw failure; }));
    } catch (failure) { queueMicrotask(() => { throw failure; }); }
  }
  if (options.unhandled && !handled) queueMicrotask(() => { throw error; });
  return report;
};

function __velarReport(value, phase, scope = null, detail = "", unhandled = true) {
  return __velarRuntime.report(value, { phase, detail, component: scope?.component || "", unhandled });
}

function __velarSchedule(observer) {
  const queue = observer.mode === "watch" ? __velarRuntime.watchQueue : __velarRuntime.domQueue;
  if (!queue.has(observer) && queue.size >= 100000) throw new RangeError("Velar reactive queues cannot exceed 100000 observers");
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
    mutate(change) {
      const result = change(value);
      for (const observer of [...subscribers]) observer.notify();
      return result;
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
    if (disposed) return Promise.resolve(null);
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
        if (!disposed) {
          pending.set(active > 0);
          if (current === generation) {
            const report = __velarRuntime.report(failure, { phase: "action", detail: String(name || ""), component: scope.component || "", unhandled: false });
            error.set(report.error);
          }
        }
        return null;
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
      if (destroyed) throw new Error("Cannot mount a destroyed Velar component");
      const parent = typeof target === "string" ? document.querySelector(target) : target;
      if (!parent) throw new Error("Velar mount target was not found");
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

function __velarUseComponent(instance, scope) {
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
  if (!parent) throw new Error("Velar mount target was not found");
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
  parent.append(value instanceof Node ? value : document.createTextNode(String(value)));
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
  __velarObserver(() => element.classList.toggle(name, Boolean(read())), "dom", scope);
}

function __velarStyle(element, name, read, scope) {
  __velarObserver(() => {
    const value = read();
    if (value == null) element.style.removeProperty(name);
    else element.style.setProperty(name, String(value));
  }, "dom", scope);
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
      if (result && typeof result.then === "function") result.catch((error) => __velarReport(error, "event", scope, event));
    } catch (error) { __velarReport(error, "event", scope, event); }
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
