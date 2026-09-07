/**
 * A `component` declaration, and the assignment to a state cell that lowers to
 * a `set` rather than a store.
 *
 * D115 P4 R3d: the family owns the two statements whose lowering is the
 * component instance itself — everything a component's body declares becomes
 * one setup function, and the reactive assignment is the only statement whose
 * meaning depends on what that body declared.
 */
import type { Expression, LoweringHints, Statement } from "@velarscript/compiler/extension";
import { spanIdentity } from "@velarscript/compiler/extension";
import {
  isWebJsx,
  webWatchSubjectLabel,
  type WebComponentDeclaration as ComponentDeclaration,
} from "../ast.ts";

type AssignmentStatement = Extract<Statement, { readonly kind: "AssignmentStatement" }>;

/**
 * What component emission reads and writes on the emitter. `currentScope` and
 * `currentJsxNamespace` are live: the body's JSX is emitted while they name the
 * instance's scope, and every path restores what it found.
 */
export interface ComponentEmitHost {
  currentJsxNamespace: string;
  currentScope: string | null;
  readonly hints: LoweringHints;
  blockAlwaysReturns(statements: readonly Statement[]): boolean;
  emitMappedExpression(expression: Expression): string;
  emitMappedStatement(statement: Statement, depth: number): string;
  emitParameter(name: string, defaultValue: Expression | null, rest?: boolean): string;
  emitStatementLines(statements: readonly Statement[], depth: number): readonly string[];
}

export function emitComponent(host: ComponentEmitHost, statement: ComponentDeclaration, depth: number): string {
  const indentation = "  ".repeat(depth);
  const outerIndent = "  ".repeat(depth + 1);
  const bodyIndent = "  ".repeat(depth + 2);
  const previousScope = host.currentScope;
  const previousJsxNamespace = host.currentJsxNamespace;
  host.currentScope = "__velarComponentScope";
  host.currentJsxNamespace = "__velarNamespace";
  // Props are live reactive inputs: every parameter becomes a read-only
  // handle over the per-instance props store, so prop reads lower through
  // .get() exactly like state reads do.
  const lines: string[] = [];
  for (const parameter of statement.parameters) {
    if (parameter.defaultValue) {
      lines.push(`${bodyIndent}const ${parameter.name} = __velarProp(__velarProps, ${JSON.stringify(parameter.name)}, () => (${host.emitMappedExpression(parameter.defaultValue)}));`);
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
      lines.push(`${bodyIndent}const ${item.name} = __velarState(${host.emitMappedExpression(item.initializer)}, ${JSON.stringify(item.name)});`);
    } else if (item.kind === "ExtensionStatement:web:computed") {
      lines.push(`${bodyIndent}const ${item.name} = __velarComputed(() => (${host.emitMappedExpression(item.initializer)}));`);
    } else if (item.kind === "ExtensionStatement:web:resource") {
      lines.push(`${bodyIndent}const ${item.name} = __velarResource(() => ${host.emitMappedExpression(item.initializer)}, __velarComponentScope, ${JSON.stringify(item.name)});`);
    } else if (item.kind === "ExtensionStatement:web:action") {
      const parameters = item.parameters.map((parameter) => host.emitParameter(parameter.name, parameter.defaultValue, parameter.rest)).join(", ");
      const actionLines = [...host.emitStatementLines(item.body, depth + 3)];
      if (!host.blockAlwaysReturns(item.body)) actionLines.push(`${"  ".repeat(depth + 3)}return null;`);
      const actionBody = actionLines.join("\n");
      lines.push(`${bodyIndent}const ${item.name} = __velarAction(async (${parameters}) => {${actionBody ? `\n${actionBody}\n${bodyIndent}` : ""}}, __velarComponentScope, ${JSON.stringify(item.name)});`);
    } else if (item.kind === "ExtensionStatement:web:watch") {
      const parameters = [item.currentName, item.previousName].filter((name): name is string => name !== null).join(", ");
      const watchLines = host.emitStatementLines(item.body, depth + 3).join("\n");
      lines.push(`${bodyIndent}__velarWatch(() => ${host.emitMappedExpression(item.expression)}, (${parameters}) => {${watchLines ? `\n${watchLines}\n${bodyIndent}` : ""}}, __velarComponentScope, ${JSON.stringify(webWatchSubjectLabel(item.expression))});`);
    } else if (item.kind === "ExtensionStatement:web:expose") {
      expose ??= item.value;
    } else if (item.kind === "ExtensionStatement:web:mounted") {
      mountedBody = item.body;
    } else if (item.kind === "ExtensionStatement:web:cleanup") {
      cleanupBody = item.body;
    } else if (item.kind === "ReturnStatement") {
      render = item.value;
    } else {
      lines.push(host.emitMappedStatement(item, depth + 2));
    }
  }

  // A direct JSX root owns its own attribute/child observers and keeps a
  // stable host. Every other WebNode expression is a live root position:
  // evaluate it inside a dedicated child scope so conditions and helper
  // calls can replace the root without rerunning component setup.
  let renderedRoot = "__velarDomCreateComment(\"missing render\")";
  if (render) {
    if (isWebJsx(render)) renderedRoot = host.emitMappedExpression(render);
    else {
      const rootScope = host.currentScope;
      host.currentScope = "__velarDynamicScope";
      try {
        renderedRoot = `__velarDynamicComponent((__velarDynamicScope) => ${host.emitMappedExpression(render)}, __velarComponentScope)`;
      } finally {
        host.currentScope = rootScope;
      }
    }
  }
  lines.push(`${bodyIndent}const __velarRoot = ${renderedRoot};`);
  lines.push(`${bodyIndent}const __velarHandle = ${expose ? `__velarComponentHandle(${host.emitMappedExpression(expose)}, ${JSON.stringify(statement.name)})` : "null"};`);
  lines.push(`${bodyIndent}if (__velarProps.class !== undefined) __velarClassBindRoot(__velarRoot, () => __velarProps.class, __velarComponentScope);`);
  lines.push(`${bodyIndent}if (__velarProps.look !== undefined) __velarLookBindRoot(__velarRoot, () => __velarProps.look, __velarComponentScope);`);
  // 'class' and 'look' are fields a component may declare and read, so they
  // arrive as props. The 'style:' slot is not: it is bound to the instance
  // root by whoever wrote it, at the instantiation site, for every component
  // alike -- see __velarInstantiate.
  const mounted = host.emitStatementLines(mountedBody, depth + 3).join("\n");    const cleanup = cleanupBody.map((child) => {
    if (["VariableDeclaration", "FunctionDeclaration", "ClassDeclaration", "TypeDeclaration", "EnumDeclaration"].includes(child.kind)) {
      return host.emitMappedStatement(child, depth + 3);
    }
    const inner = host.emitMappedStatement(child, depth + 4);
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

  host.currentScope = previousScope;
  host.currentJsxNamespace = previousJsxNamespace;
  return `${indentation}${statement.exported ? "export " : ""}function ${statement.name}(__velarProps = {}, __velarNamespace = "html") {\n${functionLines.filter(Boolean).join("\n")}\n${indentation}}`;
}

export function emitReactiveAssignment(host: ComponentEmitHost, statement: AssignmentStatement, depth: number): string | null {
  const indentation = "  ".repeat(depth);
  if (statement.target.kind === "IdentifierExpression"
    && host.hints.reactiveReferences.get(spanIdentity(statement.target.span)) === "state") {
    const state = statement.target.name;
    const value = host.emitMappedExpression(statement.value);
    if (statement.operator === "=") return `${indentation}${state}.set(${value});`;
    return `${indentation}${state}.set(${state}.get() ${statement.operator.slice(0, -1)} ${value});`;
  }
  return null;
}
