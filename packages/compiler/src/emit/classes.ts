/**
 * Class emission: the JavaScript class a `class` declaration becomes, its
 * constructor and field initializers, and the `@dispose` chain a derived class
 * runs through its base.
 */
import type { ClassDeclaration, Expression, Statement } from "../ast.ts";
import { blockContainsDirectAwait } from "../ast.ts";
import { disposeMemberKey, iterateAsyncMemberKey, iterateMemberKey, type LoweringHints } from "../contracts.ts";
import { spanIdentity } from "../source.ts";

export interface ClassEmitterHost {
  blockAlwaysReturns(statements: readonly Statement[]): boolean;
  emitMappedExpression(expression: Expression, normalizeNull?: boolean): string;
  emitMappedStatement(statement: Statement, depth: number): string;
  emitParameter(name: string, defaultValue: Expression | null, rest?: boolean): string;
  emitStatementLines(statements: readonly Statement[], depth: number): readonly string[];
  extensionExpressionContainsDirectAwait(
    _expression: Expression,
    _contains: (expression: Expression) => boolean,
  ): boolean | undefined;
  extensionStatementContainsDirectAwait(
    _statement: Statement,
    _containsExpression: (expression: Expression) => boolean,
    _containsBlock: (statements: readonly Statement[]) => boolean,
  ): boolean | undefined;
  readonly hints: LoweringHints;
  needsDisposalHelper: boolean;
  needsThrownValueHelper: boolean;
}

export class ClassEmitter {
  private readonly host: ClassEmitterHost;

  constructor(host: ClassEmitterHost) {
    this.host = host;
  }

  emitClass(statement: ClassDeclaration, depth: number): string {
    const indentation = "  ".repeat(depth);
    const parameters = statement.parameters.map((parameter) => this.host.emitParameter(parameter.name, parameter.defaultValue, parameter.rest)).join(", ");
    const constructorLines: string[] = [];
    const constructorBody = [...(statement.initialization?.body ?? [])];
    const explicitSuper = constructorBody[0]?.kind === "ExpressionStatement"
      && constructorBody[0].expression.kind === "CallExpression"
      && constructorBody[0].expression.callee.kind === "SuperExpression";
    if (statement.base) {
      constructorLines.push(explicitSuper
        ? this.host.emitMappedStatement(constructorBody.shift()!, depth + 2)
        : `${indentation}    super();`);
    }
    // Error subclasses report under their declared name — the JavaScript
    // default leaves `.name` at "Error", which mislabels every report header
    // (audit 4's micro-ruling).
    if (statement.base && this.host.hints.errorSubclassNames.has(statement.name)) {
      constructorLines.push(`${indentation}    this.name = ${JSON.stringify(statement.name)};`);
    }
    for (const parameter of statement.parameters) {
      if (parameter.binding) {
        constructorLines.push(`${indentation}    this.${parameter.private ? "#" : ""}${parameter.name} = ${parameter.name};`);
      }
    }
    for (const field of statement.fields) {
      if (!field.static && field.initializer) constructorLines.push(`${indentation}    this.${field.private ? "#" : ""}${field.name} = ${this.host.emitMappedExpression(field.initializer)};`);
    }
    if (statement.initialization) {
      constructorLines.push(`${indentation}    const self = this;`);
      constructorLines.push(...this.host.emitStatementLines(constructorBody, depth + 2));
    }
    const constructor = [
      `${indentation}  constructor(${parameters}) {`,
      ...constructorLines,
      `${indentation}  }`,
    ].join("\n");
    const methodBody = (method: ClassDeclaration["methods"][number] | ClassDeclaration["getters"][number], methodDepth: number): string[] => {
      const lines = method.abstract
        ? [`${"  ".repeat(methodDepth)}throw new Error(${JSON.stringify(`Abstract ${"accessor" in method ? "getter" : "method"} ${statement.name}.${method.name}${"accessor" in method ? "" : "()"} must be implemented`)});`]
        : [
          ...(method.static ? [] : [`${"  ".repeat(methodDepth)}const self = this;`]),
          ...this.host.emitStatementLines(method.body, methodDepth),
        ];
      if (!method.abstract && !this.host.blockAlwaysReturns(method.body)) lines.push(`${"  ".repeat(methodDepth)}return null;`);
      return lines;
    };
    // Methods — public, static, and private alike — live on the class body as
    // native (private) methods, so instances carry data fields only and one
    // method object serves every instance (charter section 18).
    const methods = statement.methods.map((method) => {
      const methodParameters = method.parameters.map((parameter) => this.host.emitParameter(parameter.name, parameter.defaultValue, parameter.rest)).join(", ");
      const lines = methodBody(method, depth + 2);
      const body = lines.join("\n");
      return `${indentation}  ${method.static ? "static " : ""}${method.asynchronous ? "async " : ""}${method.private ? "#" : ""}${method.name}(${methodParameters}) {${body.length > 0 ? `\n${body}\n${indentation}  ` : ""}}`;
    });
    const getters = statement.getters.map((getter) => {
      const lines = methodBody(getter, depth + 2);
      const body = lines.join("\n");
      return `${indentation}  ${getter.static ? "static " : ""}get ${getter.private ? "#" : ""}${getter.name}() {${body.length > 0 ? `\n${body}\n${indentation}  ` : ""}}`;
    });
    const privateFields = [
      ...statement.parameters.filter((parameter) => parameter.private).map((parameter) => parameter.name),
      ...statement.fields.filter((field) => field.private && !field.static).map((field) => field.name),
    ].map((name) => `${indentation}  #${name};`);
    const staticFields = statement.fields
      .filter((field) => field.static)
      .map((field) => `${indentation}  static ${field.private ? "#" : ""}${field.name} = ${field.initializer ? this.host.emitMappedExpression(field.initializer) : "null"};`);
    // D43 item 69: `@dispose:` becomes one prototype member under a key no
    // source member name can spell, so the release contract cannot be called
    // from source and cannot collide with a member the author declares.
    const dispose: string[] = [];
    if (statement.dispose) {
      // D51 rule 102: a derived `@dispose:` adds to the base's, it does not
      // replace it. The compiler composes the contract because `@dispose` is
      // not callable from source (D43 item 69), so an author could not forward
      // it by hand even if every author remembered to.
      const chained = this.host.hints.classDisposeChains.get(spanIdentity(statement.span)) ?? null;
      const disposeDepth = depth + (chained ? 3 : 2);
      const indent = "  ".repeat(disposeDepth);
      const asynchronous = chained === "async"
        || blockContainsDirectAwait(
          statement.dispose.body,
          (value, contains) => this.host.extensionExpressionContainsDirectAwait(value, contains),
          (owned, containsExpression, containsBlock) => this.host.extensionStatementContainsDirectAwait(owned, containsExpression, containsBlock),
        );
      const body = [
        `${indent}const self = this;`,
        ...this.host.emitStatementLines(statement.dispose.body, disposeDepth),
        `${indent}return null;`,
      ];
      const lines = chained ? this.chainedDisposeLines(body, chained, statement.span.start, depth + 2) : body;
      dispose.push(`${indentation}  ${asynchronous ? "async " : ""}[${JSON.stringify(disposeMemberKey)}]() {\n${lines.join("\n")}\n${indentation}  }`);
    }
    // D68 rule 177: `@iterate:` lands the same way, under its own unspellable
    // key. It is a plain prototype member, so a derived block simply shadows
    // the base's — overriding replaces, which is what "one answer" means.
    // D90 R18: the asynchronous pull form is an async method under its own
    // key — `async for` calls it once per element, and the trailing
    // `return null` makes falling off the end mean exhaustion.
    const iterate: string[] = [];
    if (statement.iterate) {
      const asynchronous = this.host.hints.asyncIterateBlocks.has(spanIdentity(statement.iterate.keywordSpan));
      const iterateDepth = depth + 2;
      const indent = "  ".repeat(iterateDepth);
      const body = [
        `${indent}const self = this;`,
        ...this.host.emitStatementLines(statement.iterate.body, iterateDepth),
        `${indent}return null;`,
      ];
      iterate.push(`${indentation}  ${asynchronous ? "async " : ""}[${JSON.stringify(asynchronous ? iterateAsyncMemberKey : iterateMemberKey)}]() {\n${body.join("\n")}\n${indentation}  }`);
    }
    const extension = statement.base ? ` extends ${statement.base.name}` : "";
    return `${indentation}${statement.exported ? "export " : ""}class ${statement.name}${extension} {\n${[...privateFields, ...staticFields, constructor, ...getters, ...methods, ...dispose, ...iterate].join("\n\n")}\n${indentation}}`;
  }

  /**
   * D51 rule 102: derived first, base after — construction order reversed, the
   * same intuition LIFO release already has. The base runs on every exit from
   * the derived body, including a `return`, and when the derived part already
   * failed the base failure is reported to the host instead of replacing the
   * error in flight, exactly as rule 8 of D43 item 69 decides for `using`.
   */
  private chainedDisposeLines(
    body: readonly string[],
    inherited: "sync" | "async",
    suffix: number,
    depth: number,
  ): readonly string[] {
    const indentation = "  ".repeat(depth);
    this.host.needsDisposalHelper = true;
    this.host.needsThrownValueHelper = true;
    const call = `${inherited === "async" ? "await " : ""}super[${JSON.stringify(disposeMemberKey)}]()`;
    const released = `__velarBaseReleased${suffix}`;
    const failure = `__velarDisposeChainFailure${suffix}`;
    return [
      `${indentation}let ${released} = false;`,
      `${indentation}try {`,
      ...body,
      `${indentation}} catch (${failure}) {`,
      `${indentation}  ${released} = true;`,
      `${indentation}  try { ${call}; } catch (__velarBaseDisposeFailure${suffix}) { __velarDisposalReport(__velarBaseDisposeFailure${suffix}); }`,
      `${indentation}  throw ${failure};`,
      `${indentation}} finally {`,
      `${indentation}  if (!${released}) ${call};`,
      `${indentation}}`,
    ];
  }
}
