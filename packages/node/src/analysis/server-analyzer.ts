/**
 * The Node analyzer: the composition root its collaborators read it through.
 *
 * D115 P4 R4a. What is left here is state — eleven tables the walk fills — the
 * four `protected` seams Core enters this extension by, the module scan
 * `analyze` performs before the walk, and the one host object the `analysis/`
 * collaborators receive. The rules themselves are in `analysis/routes.ts`,
 * `analysis/handlers.ts` and `analysis/composition.ts`; a private member cannot
 * be read outside the class it is declared in, so the host that publishes those
 * tables is built here and nowhere else (D114 line 512, TS2341).
 */
import {
  type AnalysisContext,
  type CompilerAnalysisExtension,
  type Expression,
  type Parameter,
  type Program,
  type Span,
  type Statement,
  type ValueType,
} from "@velarscript/compiler/extension";
import { serveCombinators, type ServeCombinator, type ServerAlias } from "../contracts.ts";
import { collectRoutePatternValues, isRoutePatternStaticValue, type CompiledRoutePattern, type RoutePatternStaticValue } from "../route-pattern.ts";
import { VelarNodeProblemAnalyzer } from "../serve-problem-analysis.ts";
import { isNodeServerStatement, type NodeRouteDeclaration, type NodeServerDeclaration } from "../server-ast.ts";
import { isNodeRouteInputType, nodeRouteInputValue, routePatternType, serveAppType, type NodeRouteInputType } from "../server-types.ts";
import { analyzeServer, moduleServerAlias, type ServerCompositionHost } from "./composition.ts";
import { boundRoutePathType, recordRouteCaptureHint, routeCaptureType, staticPattern } from "./routes.ts";

export class VelarNodeAnalyzer extends VelarNodeProblemAnalyzer {
  private readonly contextualRouteParameters = new Map<string, ValueType>();
  private readonly routeInputs = new Map<string, NodeRouteInputType>();
  /** Servers declared by the module under analysis, the only spread targets this analyzer can resolve. */
  private readonly moduleServers = new Map<string, NodeServerDeclaration>();
  /** Module-level `const alias = name` and `let alias = name` bindings, so a spread of an alias resolves to the server it names. */
  private readonly moduleServerAliases = new Map<string, ServerAlias>();
  /** Local names imported from velar/serve that name a path-preserving combinator, so a spread of a call resolves through it. */
  private readonly moduleServeCombinators = new Map<string, {readonly imported: ServeCombinator; readonly span: Span}>();
  /** One answer per `let` alias name to "was this binding ever reassigned?", because the predicate walks the whole program. */
  private readonly stableAliases = new Map<string, boolean>();
  /** The program under analysis, held for the alias-stability walk. */
  private moduleProgram: Program | null = null;
  /** 当前模块可静态解析的路由目录，包含通过接口注解导入的常量。 */
  private routePatternValues: ReadonlyMap<string, RoutePatternStaticValue> = new Map();
  private readonly importedRoutePatternValues: ReadonlyMap<string, RoutePatternStaticValue>;
  /** 每条路由最终采用的编译期模板；碰撞检查和形参类型都读取这里。 */
  private readonly routePatterns = new Map<string, CompiledRoutePattern>();
  private readonly nodeModulePath: string | null;

  /** The one object every `analysis/` collaborator reads this analyzer through. */
  private readonly host: ServerCompositionHost;

  constructor(context: AnalysisContext = {}, extensions: readonly CompilerAnalysisExtension[] = []) {
    super(context, extensions);
    this.nodeModulePath = context.path ?? null;
    this.importedRoutePatternValues = new Map(
      [...(context.extensionImports?.get("@velarscript/node") ?? [])]
        .filter((entry): entry is [string, RoutePatternStaticValue] => isRoutePatternStaticValue(entry[1])),
    );
    this.host = this.compositionHost();
  }

  override analyze(program: Program) {
    this.moduleServers.clear();
    this.moduleServerAliases.clear();
    this.moduleServeCombinators.clear();
    this.stableAliases.clear();
    this.moduleProgram = program;
    this.routePatternValues = collectRoutePatternValues(program, this.importedRoutePatternValues);
    this.routePatterns.clear();
    for (const statement of program.body) {
      if (isNodeServerStatement(statement)) {
        if (!this.moduleServers.has(statement.name)) this.moduleServers.set(statement.name, statement);
        continue;
      }
      if (statement.kind === "ImportDeclaration" && statement.source === "velar/serve") {
        for (const specifier of statement.specifiers) {
          if (specifier.namespace || !serveCombinators.has(specifier.imported)) continue;
          if (!this.moduleServeCombinators.has(specifier.local)) {
            this.moduleServeCombinators.set(specifier.local, {imported: specifier.imported as ServeCombinator, span: specifier.span});
          }
        }
        continue;
      }
      const alias = moduleServerAlias(statement);
      if (alias && !this.moduleServerAliases.has(alias.name)) this.moduleServerAliases.set(alias.name, alias);
    }
    if (!(this.nodeModulePath ?? "").endsWith(".test.vel")) {
      for (const statement of program.body) {
        if ((statement.kind === "ImportDeclaration" || statement.kind === "ReExportDeclaration") && statement.source === "velar/server-test") {
          this.typeError("'velar/server-test' is an in-process test capability; import it only from a '*.test.vel' module", statement.sourceSpan);
        }
      }
    }
    return super.analyze(program);
  }

  protected override predeclareExtensionStatement(statement: Statement): boolean {
    if (!isNodeServerStatement(statement)) return false;
    this.declareBinding(statement.name, false, serveAppType, statement.span);
    return true;
  }

  protected override analyzeExtensionStatement(statement: Statement): boolean {
    if (!isNodeServerStatement(statement)) return false;
    analyzeServer(this.host, statement);
    return true;
  }

  protected override contextualFunctionParameterDefault(
    statement: { readonly kind: string },
    parameter: Parameter,
  ): ValueType | null {
    if (statement.kind !== "NodeRouteDeclaration" || !parameter.defaultValue) return null;
    const route = statement as NodeRouteDeclaration;
    if (route.routeBinding?.name === parameter.name) {
      return boundRoutePathType(this.host, staticPattern(this.host, route));
    }
    const inferred = this.expandAliases(this.inferParameterDefault(parameter.defaultValue));
    const key = `${parameter.span.start}:${parameter.span.end}`;
    if (isNodeRouteInputType(inferred)) {
      this.routeInputs.set(key, inferred);
      const value = this.expandAliases(nodeRouteInputValue(inferred));
      this.contextualRouteParameters.set(key, value);
      return value;
    }
    this.contextualRouteParameters.set(key, inferred);
    return inferred;
  }

  protected override inferExtensionExpression(expression: Expression, _contextualType: ValueType): ValueType | undefined {
    if (expression.kind !== "ExtensionExpression:node:path-pattern") return undefined;
    const pattern = (expression as typeof expression & {readonly pattern: CompiledRoutePattern}).pattern;
    for (const capture of pattern.path.concat(pattern.query)) recordRouteCaptureHint(this.host, capture, routeCaptureType(this.host, capture));
    return routePatternType;
  }

  /**
   * What this analyzer's collaborators are allowed to ask of it, and nothing
   * more. `moduleProgram` and `routePatternValues` are replaced once per
   * program, so both stay accessors; the other tables are the same objects for
   * the analyzer's whole life and are handed over as themselves.
   */
  private compositionHost(): ServerCompositionHost {
    const analyzer = this;
    return {
      contextualRouteParameters: this.contextualRouteParameters,
      extensionCalls: this.extensionCalls,
      moduleServeCombinators: this.moduleServeCombinators,
      moduleServerAliases: this.moduleServerAliases,
      moduleServers: this.moduleServers,
      get moduleProgram() { return analyzer.moduleProgram; },
      routeInputs: this.routeInputs,
      routePatterns: this.routePatterns,
      get routePatternValues() { return analyzer.routePatternValues; },
      stableAliases: this.stableAliases,
      analyzeFunctionDeclaration: (statement, className, method, declareSelf, forceAsynchronous, declarationKind) => {
        this.analyzeFunctionDeclaration(statement, className, method, declareSelf, forceAsynchronous, declarationKind);
      },
      declareBinding: (name, mutable, type, declarationSpan) => { this.declareBinding(name, mutable, type, declarationSpan); },
      enumWireValuesOf: (identity, name) => this.enumWireValuesOf(identity, name),
      expandAliases: (type) => this.expandAliases(type),
      fieldsOf: (identity) => this.fieldsOf(identity),
      inferExpression: (expression, contextualType) => this.inferExpression(expression, contextualType),
      inferredFunctionResult: (statement) => this.inferredFunctionResult(statement),
      isPredeclared: (statement) => this.isPredeclared(statement),
      isTopLevelScope: () => this.isTopLevelScope(),
      lookup: (name) => this.lookup(name),
      requireAssignable: (actual, expected, valueSpan) => { this.requireAssignable(actual, expected, valueSpan); },
      resolveValidatedAnnotation: (reference) => this.resolveValidatedAnnotation(reference),
      typeError: (message, errorSpan) => { this.typeError(message, errorSpan); },
    };
  }
}
