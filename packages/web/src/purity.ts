import type { Expression, Program, Statement } from "@velarscript/compiler/extension";

type FunctionDeclaration = Extract<Statement, { readonly kind: "FunctionDeclaration" }>;
type VariableDeclaration = Extract<Statement, { readonly kind: "VariableDeclaration" }>;
type ArrowFunctionExpression = Extract<Expression, { readonly kind: "ArrowFunctionExpression" }>;
type Parameter = FunctionDeclaration["parameters"][number];
type BindingPattern = VariableDeclaration["pattern"];
type MatchStatement = Extract<Statement, { readonly kind: "MatchStatement" }>;
type MatchPattern = MatchStatement["cases"][number]["pattern"];

/**
 * The extension-exports marker for a function the framework may memoize
 * automatically at importing call sites: pure-enough (see below) and callable
 * with exactly one positional argument. The marker value doubles as its own
 * interface identity, so purity changes invalidate dependent modules.
 */
export const PURE_UNARY_DERIVATION_EXPORT = "pure-unary-derivation";

/** The compiler-extension id that owns the purity markers. */
export const WEB_EXTENSION_ID = "@velarscript/web";

/**
 * "Pure-enough" for automatic memoization means: given the same argument
 * identity, the function returns an equivalent result, and skipping a call
 * is unobservable. Concretely a function qualifies only when its body (and
 * parameter defaults) provably
 *
 * - never reads or writes a reactive binding (module or component `state`,
 *   `computed`, `resource`, `action`, or component props),
 * - never reads a mutable outer binding (`let`) or any outer `const` that
 *   could hold mutable data — only literal-initialized module consts, enum
 *   members, type objects, and other pure functions are readable,
 * - never assigns to anything but its own locals (no member or index
 *   assignment at all, so arguments are never mutated),
 * - calls only: module-level functions that pass this same test
 *   (transitively, cycles allowed), imports that carry the cross-module
 *   purity marker, whitelisted pure standard-library functions, the pure
 *   core builtins (`str`, `number`, `Map`, `Set`, `Error`), and — by decree —
 *   `print`, whose diagnostic output is treated as non-semantic,
 * - performs collection method calls only where the analyzer proved the
 *   receiver is a built-in collection and the operation is read-only
 *   (available emitter-side only; interface marking has no analyzer hints
 *   and therefore rejects every method call),
 * - contains no `await`, JSX, Look values, dynamic imports, classes, or
 *   calls through arbitrary expressions.
 *
 * Anything not positively recognized is impure. Correctness over coverage.
 */
export interface PurityOptions {
  /** Module bindings that are reactive (state or computed) per analysis. */
  readonly reactiveNames?: ReadonlySet<string>;
  /** Imported local names that carry the cross-module purity marker. */
  readonly importedPure?: ReadonlySet<string>;
  /** Analyzer-proved collection operations, keyed by member-expression span end. */
  readonly collectionCalls?: ReadonlyMap<number, string>;
}

export interface PureFunctionInfo {
  /** Callable with exactly one positional argument. */
  readonly unaryCallable: boolean;
  /** The body contains at least one call (used as the filter-profitability signal). */
  readonly delegates: boolean;
}

/** Collection operations that read without mutating their receiver. */
const READ_ONLY_COLLECTION_OPERATIONS = new Set([
  "get", "slice", "has", "keys", "values", "entries",
  "listCopy", "listCount", "listIndex", "listFind", "listSome", "listEvery",
  "listMap", "listFilter", "listReduce", "listJoin", "listSorted", "listReversed",
  "setCopy", "mapCopy",
]);

/**
 * Standard-library functions that are pure given pure function arguments.
 * Callback arguments are ordinary expressions and analyzed on their own, so
 * an impure callback disqualifies the surrounding body anyway.
 */
const PURE_STANDARD_IMPORTS = new Map<string, ReadonlySet<string> | "*">([
  ["velar/text", "*"],
  ["velar/collections", "*"],
  ["velar/math", new Set([
    "pi", "e", "tau", "infinity", "abs", "min", "max", "clamp", "sign", "round", "floor", "ceil",
    "trunc", "sqrt", "cbrt", "pow", "exp", "log", "log2", "log10", "sin", "cos", "tan", "asin",
    "acos", "atan", "atan2", "degrees", "radians", "hypot", "isFinite", "isInteger", "gcd", "lcm",
  ])],
]);

/** Core globals that are pure to call (creation and conversion only). */
const PURE_CORE_CALLEES = new Set(["str", "number", "Map", "Set", "Error"]);

interface ModuleBindingTable {
  /** Module-level def and const-arrow candidates by name. */
  readonly candidates: Map<string, { readonly parameters: readonly Parameter[]; readonly body: readonly Statement[] | Expression }>;
  /** Module consts initialized with a plain literal (safe immutable reads). */
  readonly literalConsts: Set<string>;
  /** Enum, type, and type-alias names (immutable runtime objects). */
  readonly immutableTypeNames: Set<string>;
  /** Local names of whitelisted pure standard-library imports. */
  readonly pureImports: Set<string>;
  /** Local names of imports that carry the cross-module purity marker. */
  readonly markerImports: Set<string>;
  /** Every other module-scope name (impure to touch). */
  readonly opaque: Set<string>;
}

export class PurityAnalyzer {
  private readonly options: PurityOptions;
  private readonly table: ModuleBindingTable;
  private readonly parent: PurityAnalyzer | null;
  private readonly status = new Map<string, "checking" | "pure" | "impure">();
  private readonly info = new Map<string, PureFunctionInfo>();

  constructor(program: Program | readonly Statement[], options: PurityOptions = {}, parent: PurityAnalyzer | null = null) {
    this.options = options;
    this.table = collectModuleBindings(Array.isArray(program) ? program : (program as Program).body, options);
    this.parent = parent;
  }

  /**
   * A child analyzer for a component body: component-level defs and const
   * arrows become candidates, every other component-scope name (props,
   * state, computed, resources, actions) is opaque or reactive, and
   * unresolved names fall back to the module surface.
   */
  forComponent(body: readonly Statement[], reactiveNames: ReadonlySet<string>): PurityAnalyzer {
    return new PurityAnalyzer(body, { ...this.options, reactiveNames }, this);
  }

  /** Purity info for a scope-level def or const arrow, or null when impure. */
  pureFunction(name: string): PureFunctionInfo | null {
    const candidate = this.table.candidates.get(name);
    if (!candidate) {
      if (this.declaresLocally(name)) return null;
      return this.parent?.pureFunction(name) ?? null;
    }
    const state = this.status.get(name);
    if (state === "pure") return this.info.get(name) ?? null;
    if (state === "impure") return null;
    if (state === "checking") return this.info.get(name) ?? null; // optimistic on cycles
    this.status.set(name, "checking");
    const delegates = { value: false };
    this.info.set(name, {
      unaryCallable: unaryCallable(candidate.parameters),
      delegates: false,
    });
    const scope = new Set<string>();
    for (const parameter of candidate.parameters) scope.add(parameter.name);
    let pure = candidate.parameters.every((parameter) => parameter.defaultValue === null
      || this.pureExpression(parameter.defaultValue, [scope], delegates));
    if (pure) {
      pure = Array.isArray(candidate.body)
        ? this.pureBody(candidate.body as readonly Statement[], [scope], delegates)
        : this.pureExpression(candidate.body as Expression, [scope], delegates);
    }
    this.status.set(name, pure ? "pure" : "impure");
    if (!pure) {
      this.info.delete(name);
      return null;
    }
    const complete = { unaryCallable: unaryCallable(candidate.parameters), delegates: delegates.value };
    this.info.set(name, complete);
    return complete;
  }

  /** Whether an imported local name carries the cross-module purity marker. */
  importedPure(name: string): boolean {
    if (this.table.markerImports.has(name)) return true;
    if (this.declaresLocally(name)) return false;
    return this.parent?.importedPure(name) ?? false;
  }

  private declaresLocally(name: string): boolean {
    return this.table.candidates.has(name)
      || this.table.opaque.has(name)
      || this.table.literalConsts.has(name)
      || this.table.immutableTypeNames.has(name)
      || this.table.pureImports.has(name)
      || (this.options.reactiveNames?.has(name) ?? false);
  }

  /**
   * Whether a single-parameter arrow is pure-enough to memoize by element
   * identity: its body may reach only its own parameters and locals plus the
   * module-scope pure surface, so a captured enclosing-function local (whose
   * value can change between derivation runs) disqualifies it.
   */
  pureUnaryArrow(arrow: ArrowFunctionExpression): PureFunctionInfo | null {
    if (arrow.asynchronous || arrow.parameters.length !== 1 || arrow.parameters[0]!.rest) return null;
    const delegates = { value: false };
    const scope = new Set<string>([arrow.parameters[0]!.name]);
    const defaultValue = arrow.parameters[0]!.defaultValue;
    if (defaultValue && !this.pureExpression(defaultValue, [scope], delegates)) return null;
    if (!this.pureExpression(arrow.body, [scope], delegates)) return null;
    return { unaryCallable: true, delegates: delegates.value };
  }

  private resolveRead(name: string, scopes: readonly ReadonlySet<string>[]): "local" | "pure" | "impure" {
    for (let index = scopes.length - 1; index >= 0; index -= 1) {
      if (scopes[index]!.has(name)) return "local";
    }
    return this.resolveOuter(name);
  }

  private resolveOuter(name: string): "pure" | "impure" {
    if (this.options.reactiveNames?.has(name)) return "impure";
    if (this.table.opaque.has(name)) return "impure";
    if (this.table.candidates.has(name)) return this.pureFunction(name) ? "pure" : "impure";
    if (this.table.pureImports.has(name) || this.table.markerImports.has(name)) return "pure";
    if (this.table.literalConsts.has(name)) return "pure";
    if (this.table.immutableTypeNames.has(name)) return "pure";
    if (this.parent) return this.parent.resolveOuter(name);
    return "impure";
  }

  private pureBody(body: readonly Statement[], scopes: ReadonlySet<string>[], delegates: { value: boolean }): boolean {
    // All names declared anywhere in the block count as locals up front:
    // conservative in the safe direction — more locals means fewer reads
    // resolve to outer pure bindings, never more.
    const block = new Set<string>();
    for (const statement of body) collectDeclaredNames(statement, block);
    scopes.push(block);
    const pure = body.every((statement) => this.pureStatement(statement, scopes, delegates));
    scopes.pop();
    return pure;
  }

  private pureStatement(statement: Statement, scopes: ReadonlySet<string>[], delegates: { value: boolean }): boolean {
    switch (statement.kind) {
      case "VariableDeclaration":
        return this.pureExpression(statement.initializer, scopes, delegates);
      case "ReturnStatement":
        return statement.value === null || this.pureExpression(statement.value, scopes, delegates);
      case "ThrowStatement":
        return this.pureExpression(statement.value, scopes, delegates);
      case "AssertStatement":
        return this.pureExpression(statement.condition, scopes, delegates)
          && (statement.message === null || this.pureExpression(statement.message, scopes, delegates));
      case "IfStatement":
        return this.pureExpression(statement.condition, scopes, delegates)
          && this.pureBody(statement.thenBody, scopes, delegates)
          && (statement.elseBody === null || this.pureBody(statement.elseBody, scopes, delegates));
      case "MatchStatement":
        return this.pureExpression(statement.value, scopes, delegates)
          && statement.cases.every((case_) => {
            const bindings = new Set<string>();
            if (!this.pureMatchPattern(case_.pattern, scopes, delegates, bindings)) return false;
            scopes.push(bindings);
            const pure = (case_.guard === null || this.pureExpression(case_.guard, scopes, delegates))
              && this.pureBody(case_.body, scopes, delegates);
            scopes.pop();
            return pure;
          })
          && (statement.elseBody === null || this.pureBody(statement.elseBody, scopes, delegates));
      case "ForStatement": {
        if (!this.pureExpression(statement.iterable, scopes, delegates)) return false;
        const bindings = new Set<string>();
        collectPatternNames(statement.pattern, bindings);
        scopes.push(bindings);
        const pure = this.pureBody(statement.body, scopes, delegates);
        scopes.pop();
        return pure;
      }
      case "WhileStatement":
        return this.pureExpression(statement.condition, scopes, delegates)
          && this.pureBody(statement.body, scopes, delegates);
      case "TryStatement": {
        if (!this.pureBody(statement.tryBody, scopes, delegates)) return false;
        if (statement.catchBody) {
          const bindings = new Set<string>(statement.catchName ? [statement.catchName] : []);
          scopes.push(bindings);
          const pure = this.pureBody(statement.catchBody, scopes, delegates);
          scopes.pop();
          if (!pure) return false;
        }
        return statement.finallyBody === null || this.pureBody(statement.finallyBody, scopes, delegates);
      }
      case "BreakStatement":
      case "ContinueStatement":
      case "PassStatement":
        return true;
      case "AssignmentStatement":
        // Only a local may be reassigned; member and index assignment could
        // reach an argument or captured structure, so both are rejected.
        return statement.target.kind === "IdentifierExpression"
          && this.resolveRead(statement.target.name, scopes) === "local"
          && this.pureExpression(statement.value, scopes, delegates);
      case "ExpressionStatement":
        return this.pureExpression(statement.expression, scopes, delegates);
      default:
        // Nested function declarations, web declarations, imports, classes:
        // not analyzed — impure by default.
        return false;
    }
  }

  private pureMatchPattern(pattern: MatchPattern, scopes: ReadonlySet<string>[], delegates: { value: boolean }, bindings: Set<string>): boolean {
    switch (pattern.kind) {
      case "MatchWildcardPattern":
        return true;
      case "MatchCapturePattern":
        bindings.add(pattern.binding.name);
        return true;
      case "MatchAsPattern":
        bindings.add(pattern.binding.name);
        return this.pureMatchPattern(pattern.pattern, scopes, delegates, bindings);
      case "MatchValuePattern":
        return pattern.values.every((value) => this.pureExpression(value, scopes, delegates));
      case "MatchTypePattern":
        return true;
      case "MatchObjectPattern":
        return pattern.entries.every((entry) => this.pureMatchPattern(entry.pattern, scopes, delegates, bindings));
      case "MatchListPattern":
        if (pattern.rest) bindings.add(pattern.rest.name);
        return pattern.elements.every((element) => element === null
          || this.pureMatchPattern(element, scopes, delegates, bindings));
      default:
        return false;
    }
  }

  private pureExpression(expression: Expression, scopes: ReadonlySet<string>[], delegates: { value: boolean }): boolean {
    switch (expression.kind) {
      case "LiteralExpression":
      case "UnitLiteralExpression":
        return true;
      case "FStringExpression":
        return expression.parts.every((part) => part.kind === "text"
          || this.pureExpression(part.value, scopes, delegates));
      case "IdentifierExpression":
        return this.resolveRead(expression.name, scopes) !== "impure";
      case "ListExpression":
        return expression.elements.every((element) => this.pureExpression(element, scopes, delegates));
      case "ObjectExpression":
        return expression.properties.every((property) => this.pureExpression(property.value, scopes, delegates));
      case "SpreadExpression":
        return this.pureExpression(expression.value, scopes, delegates);
      case "UnaryExpression":
        return expression.operator !== "await" && this.pureExpression(expression.operand, scopes, delegates);
      case "BinaryExpression":
        return this.pureExpression(expression.left, scopes, delegates)
          && this.pureExpression(expression.right, scopes, delegates);
      case "ComparisonChainExpression":
        return expression.operands.every((operand) => this.pureExpression(operand, scopes, delegates));
      case "ConditionalExpression":
        return this.pureExpression(expression.condition, scopes, delegates)
          && this.pureExpression(expression.thenValue, scopes, delegates)
          && this.pureExpression(expression.elseValue, scopes, delegates);
      case "IsExpression":
        return this.pureExpression(expression.value, scopes, delegates);
      case "ArrowFunctionExpression": {
        if (expression.asynchronous) return false;
        const bindings = new Set<string>();
        for (const parameter of expression.parameters) {
          bindings.add(parameter.name);
          if (parameter.defaultValue && !this.pureExpression(parameter.defaultValue, scopes, delegates)) return false;
        }
        scopes.push(bindings);
        const pure = this.pureExpression(expression.body, scopes, delegates);
        scopes.pop();
        return pure;
      }
      case "CallExpression":
        return this.pureCall(expression, scopes, delegates);
      case "MemberExpression":
        // A property read; method calls route through pureCall instead.
        return this.pureExpression(expression.object, scopes, delegates);
      case "IndexExpression":
        return this.pureExpression(expression.object, scopes, delegates)
          && this.pureExpression(expression.index, scopes, delegates);
      default:
        // JSX, Look, assignments-in-expression-position, super, dynamic
        // import: impure.
        return false;
    }
  }

  private pureCall(expression: Extract<Expression, { readonly kind: "CallExpression" }>, scopes: ReadonlySet<string>[], delegates: { value: boolean }): boolean {
    const argumentsPure = (): boolean => expression.arguments.every((argument) => this.pureExpression(argument, scopes, delegates));
    if (expression.callee.kind === "IdentifierExpression") {
      const name = expression.callee.name;
      const resolution = this.resolveRead(name, scopes);
      if (resolution === "local") return false; // unknown callable
      if (resolution === "pure") {
        delegates.value = true;
        return argumentsPure();
      }
      // print is allowed by decree: its diagnostic output is non-semantic,
      // which keeps derivation-count probes representative.
      if (name === "print" || PURE_CORE_CALLEES.has(name)) return argumentsPure();
      return false;
    }
    if (expression.callee.kind === "MemberExpression") {
      const operation = this.options.collectionCalls?.get(expression.callee.span.end);
      if (operation !== undefined && READ_ONLY_COLLECTION_OPERATIONS.has(operation)) {
        delegates.value = true;
        return this.pureExpression(expression.callee.object, scopes, delegates) && argumentsPure();
      }
      return false;
    }
    return false;
  }
}

/** Callable with exactly one positional argument. */
export function unaryCallable(parameters: readonly Parameter[]): boolean {
  if (parameters.length === 0 || parameters[0]!.rest) return false;
  return parameters.every((parameter, index) => index === 0 || parameter.rest || parameter.defaultValue !== null);
}

function collectModuleBindings(statements: readonly Statement[], options: PurityOptions): ModuleBindingTable {
  const candidates = new Map<string, { readonly parameters: readonly Parameter[]; readonly body: readonly Statement[] | Expression }>();
  const literalConsts = new Set<string>();
  const immutableTypeNames = new Set<string>();
  const pureImports = new Set<string>();
  const markerImports = new Set<string>();
  const opaque = new Set<string>();
  for (const statement of statements) {
    switch (statement.kind) {
      case "ImportDeclaration": {
        for (const specifier of statement.specifiers) {
          if (statement.javascript || statement.unsafe || specifier.namespace) {
            opaque.add(specifier.local);
            continue;
          }
          const allowed = PURE_STANDARD_IMPORTS.get(statement.source);
          if (allowed === "*" || (allowed?.has(specifier.imported) ?? false)) pureImports.add(specifier.local);
          else if (options.importedPure?.has(specifier.local)) markerImports.add(specifier.local);
          else opaque.add(specifier.local);
        }
        break;
      }
      case "FunctionDeclaration":
        if (statement.asynchronous) opaque.add(statement.name);
        else candidates.set(statement.name, { parameters: statement.parameters, body: statement.body });
        break;
      case "VariableDeclaration": {
        if (statement.pattern.kind !== "NameBindingPattern") {
          collectPatternNames(statement.pattern, opaque);
          break;
        }
        const name = statement.pattern.name;
        if (statement.binding === "const" && statement.initializer.kind === "ArrowFunctionExpression"
          && !statement.initializer.asynchronous) {
          candidates.set(name, { parameters: statement.initializer.parameters, body: statement.initializer.body });
        } else if (statement.binding === "const" && statement.initializer.kind === "LiteralExpression") {
          literalConsts.add(name);
        } else {
          opaque.add(name);
        }
        break;
      }
      case "EnumDeclaration":
      case "TypeDeclaration":
      case "TypeAliasDeclaration":
        immutableTypeNames.add(statement.name);
        break;
      default:
        // State, computed, resources, actions, classes, components: any
        // declared name that is not positively recognized above is opaque, so
        // a shadowing component-scope declaration can never resolve to a
        // same-named pure module binding.
        if ("name" in statement && typeof statement.name === "string") opaque.add(statement.name);
        break;
    }
  }
  return { candidates, literalConsts, immutableTypeNames, pureImports, markerImports, opaque };
}

function collectDeclaredNames(statement: Statement, into: Set<string>): void {
  switch (statement.kind) {
    case "VariableDeclaration":
      collectPatternNames(statement.pattern, into);
      break;
    case "FunctionDeclaration":
      into.add(statement.name);
      break;
    case "ForStatement":
      collectPatternNames(statement.pattern, into);
      for (const child of statement.body) collectDeclaredNames(child, into);
      break;
    case "IfStatement":
      for (const child of statement.thenBody) collectDeclaredNames(child, into);
      for (const child of statement.elseBody ?? []) collectDeclaredNames(child, into);
      break;
    case "WhileStatement":
      for (const child of statement.body) collectDeclaredNames(child, into);
      break;
    case "MatchStatement":
      for (const case_ of statement.cases) for (const child of case_.body) collectDeclaredNames(child, into);
      for (const child of statement.elseBody ?? []) collectDeclaredNames(child, into);
      break;
    case "TryStatement":
      if (statement.catchName) into.add(statement.catchName);
      for (const child of statement.tryBody) collectDeclaredNames(child, into);
      for (const child of statement.catchBody ?? []) collectDeclaredNames(child, into);
      for (const child of statement.finallyBody ?? []) collectDeclaredNames(child, into);
      break;
    default:
      break;
  }
}

export function collectPatternNames(pattern: BindingPattern, into: Set<string>): void {
  if (pattern.kind === "NameBindingPattern") {
    into.add(pattern.name);
    return;
  }
  if (pattern.kind === "ObjectBindingPattern") {
    for (const entry of pattern.entries) collectPatternNames(entry.pattern, into);
    if (pattern.rest) into.add(pattern.rest.name);
    return;
  }
  for (const element of pattern.elements) if (element) collectPatternNames(element, into);
  if (pattern.rest) into.add(pattern.rest.name);
}
