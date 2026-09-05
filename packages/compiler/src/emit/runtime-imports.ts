/**
 * What the emitted module needs from the runtime: the walk that records which
 * helpers a program actually uses, and the helper sources the module carries
 * when it does not import them from a shared runtime module.
 *
 * D114 R1c: the five helper producers are `protected` members Web overrides,
 * so they stay declared on `JavaScriptEmitter` and forward here.
 */
import type {
  AssignmentStatement,
  ClassDeclaration,
  EmbeddedJavaScriptDeclaration,
  EnumDeclaration,
  Expression,
  ImportDeclaration,
  MatchPattern,
  Program,
  Statement,
  TypeAliasDeclaration,
  TestDeclaration,
  TypeDeclaration,
  UsingDeclaration,
} from "../ast.ts";
import { resolveTypeReference, type ValueType } from "../types.ts";
import { type LoweringHints } from "../contracts.ts";
import { VELAR_NON_REACTIVE_BRIDGE_RUNTIME, VELAR_NON_REACTIVE_COLLECTION_BRIDGE_RUNTIME, VELAR_REACTIVE_BRIDGE_MODULE } from "../reactive-bridge-runtime.ts";
import { spanIdentity } from "../source.ts";

export interface RuntimeImportEmitterHost {
  binaryHelper(expression: Extract<Expression, { kind: "MemberExpression" }>): string | null;
  collectionHelper(expression: Extract<Expression, { kind: "MemberExpression" }>): string | null;
  readonly executeMain: boolean;
  readonly hints: LoweringHints;
  markRuntimeNarrowingType(type: ValueType, structural?: Set<ValueType>): void;
  markRuntimeType(type: ValueType): void;
  needsBinaryHelpers: boolean;
  needsCollectionHelpers: boolean;
  needsDetachedTaskHelper: boolean;
  needsDisposalHelper: boolean;
  needsIndexHelpers: boolean;
  needsThrownValueHelper: boolean;
  readonly requiredRuntimeModules: Set<string>;
  readonly sharedRuntimeModules: boolean;
  readonly typeDeclarations: Map<string, TypeDeclaration | TypeAliasDeclaration>;
  visitExtensionRuntimeExpression(_expression: Expression, _visitExpression: (expression: Expression) => void): boolean;
  visitExtensionRuntimeStatement(
    _statement: Statement,
    _visitExpression: (expression: Expression) => void,
    _visitStatement: (statement: Statement) => void,
  ): boolean;
}

/** The three mutually recursive walks that record what a program's lowering uses. */
interface RuntimeUseVisitors {
  readonly expression: (expression: Expression) => void;
  readonly statement: (statement: Statement) => void;
  readonly matchPattern: (pattern: MatchPattern) => void;
}

export class RuntimeImportEmitter {
  private readonly host: RuntimeImportEmitterHost;

  constructor(host: RuntimeImportEmitterHost) {
    this.host = host;
  }

  collectRuntimeUses(program: Program): void {
    for (const guard of this.host.hints.runtimeNarrowings.values()) this.host.markRuntimeNarrowingType(guard.expected);
    const visit: RuntimeUseVisitors = {
      expression: (expression) => this.visitRuntimeExpression(expression, visit),
      statement: (statement) => this.visitRuntimeStatement(statement, visit),
      matchPattern: (pattern) => this.visitRuntimeMatchPattern(pattern, visit),
    };

    program.body.forEach(visit.statement);
  }

  /**
   * Every runtime helper one expression's lowering will need, recorded on the
   * emitter before a line is emitted so `emit()` knows what to import.
   */
  private visitRuntimeExpression(expression: Expression, visit: RuntimeUseVisitors): void {
    if (this.host.visitExtensionRuntimeExpression(expression, visit.expression)) return;
    switch (expression.kind) {
      case "FStringExpression":
        for (const part of expression.parts) {
          if (part.kind === "expression") visit.expression(part.value);
        }
        break;
      case "ListExpression":
        expression.elements.forEach(visit.expression);
        break;
      case "ObjectExpression":
        expression.properties.forEach((property) => visit.expression(property.value));
        break;
      case "SpreadExpression":
        visit.expression(expression.value);
        break;
      case "UnaryExpression":
        visit.expression(expression.operand);
        break;
      case "TryExpression":
        visit.expression(expression.value);
        break;
      case "RequiredExpression":
        visit.expression(expression.value);
        break;
      case "BinaryExpression":
        visit.expression(expression.left);
        visit.expression(expression.right);
        break;
      case "ComparisonChainExpression":
        expression.operands.forEach(visit.expression);
        break;
      case "ConditionalExpression":
        visit.expression(expression.condition);
        visit.expression(expression.thenValue);
        visit.expression(expression.elseValue);
        break;
      case "IsExpression":
        this.host.markRuntimeType(resolveTypeReference(expression.type));
        visit.expression(expression.value);
        break;
      case "ArrowFunctionExpression":
        visit.expression(expression.body);
        break;
      case "CallExpression":
        if (expression.callee.kind === "MemberExpression"
          && expression.callee.object.kind === "IdentifierExpression"
          && expression.callee.property === "parse"
          && this.host.typeDeclarations.has(expression.callee.object.name)) {
          this.host.markRuntimeType({ kind: "named", name: expression.callee.object.name });
        }
        if (expression.callee.kind === "MemberExpression"
          && this.host.collectionHelper(expression.callee)) {
          this.host.needsCollectionHelpers = true;
        }
        if (expression.callee.kind === "MemberExpression"
          && this.host.binaryHelper(expression.callee)) {
          this.host.needsBinaryHelpers = true;
        }
        visit.expression(expression.callee);
        expression.arguments.forEach(visit.expression);
        break;
      case "MemberExpression":
        if (this.host.binaryHelper(expression) || this.host.hints.binarySizes.has(expression.span.end)) {
          this.host.needsBinaryHelpers = true;
        }
        visit.expression(expression.object);
        break;
      case "IndexExpression":
        if (this.host.hints.binaryIndexes.has(spanIdentity(expression.span))) this.host.needsBinaryHelpers = true;
        else this.host.needsIndexHelpers = true;
        visit.expression(expression.object);
        visit.expression(expression.index);
        break;
      case "LiteralExpression":
        break;
      case "IdentifierExpression":
        if (this.host.typeDeclarations.has(expression.name)) {
          this.host.markRuntimeType({ kind: "named", name: expression.name });
        }
        break;
      case "SuperExpression":
      case "DynamicImportExpression":
        break;
    }
  }

  /**
   * The same walk over a statement, including the declarations whose runtime
   * `Type` has to be built.
   */
  private visitRuntimeStatement(statement: Statement, visit: RuntimeUseVisitors): void {
    if (this.host.visitExtensionRuntimeStatement(statement, visit.expression, visit.statement)) return;
    switch (statement.kind) {
      case "VariableDeclaration": visit.expression(statement.initializer); break;
      case "MainBlock":
        if (this.host.executeMain) statement.body.forEach(visit.statement);
        break;
      case "TestDeclaration": statement.body.forEach(visit.statement); break;
      case "UsingDeclaration":
        // Releasing a resource reports its own failure through the host
        // channel, which carries the error-normalization runtime with it.
        this.host.needsDisposalHelper = true;
        this.host.needsThrownValueHelper = true;
        visit.expression(statement.initializer);
        break;
      case "FunctionDeclaration": statement.parameters.forEach((parameter) => { if (parameter.defaultValue) visit.expression(parameter.defaultValue); }); statement.body.forEach(visit.statement); break;
      case "ClassDeclaration":
        statement.parameters.forEach((parameter) => { if (parameter.defaultValue) visit.expression(parameter.defaultValue); });
        statement.base?.arguments.forEach(visit.expression);
        statement.fields.forEach((field) => { if (field.initializer) visit.expression(field.initializer); });
        statement.initialization?.body.forEach(visit.statement);
        statement.getters.forEach(visit.statement);
        statement.methods.forEach(visit.statement);
        statement.dispose?.body.forEach(visit.statement);
        statement.iterate?.body.forEach(visit.statement);
        break;
      case "ReturnStatement": if (statement.value) visit.expression(statement.value); break;
      case "ThrowStatement": visit.expression(statement.value); break;
      case "AssertStatement": visit.expression(statement.condition); if (statement.message) visit.expression(statement.message); break;
      case "IfStatement": visit.expression(statement.condition); statement.thenBody.forEach(visit.statement); statement.elseBody?.forEach(visit.statement); break;
      case "MatchStatement":
        visit.expression(statement.value);
        statement.cases.forEach((branch) => {
          visit.matchPattern(branch.pattern);
          if (branch.guard) visit.expression(branch.guard);
          branch.body.forEach(visit.statement);
        });
        break;
      case "ForStatement":
        if (this.host.hints.collectionIterations.get(statement.span.start) === "binary") this.host.needsBinaryHelpers = true;
        visit.expression(statement.iterable);
        statement.body.forEach(visit.statement);
        break;
      case "WhileStatement": visit.expression(statement.condition); statement.body.forEach(visit.statement); break;
      case "TryStatement": statement.tryBody.forEach(visit.statement); statement.catchBody?.forEach(visit.statement); statement.finallyBody?.forEach(visit.statement); break;
      case "AssignmentStatement": visit.expression(statement.target); visit.expression(statement.value); break;
      case "ExpressionStatement": visit.expression(statement.expression); break;
      case "DetachStatement":
        // The detached-task observer normalizes rejection values, so the
        // error-normalization runtime travels with it.
        this.host.needsDetachedTaskHelper = true;
        this.host.needsThrownValueHelper = true;
        visit.expression(statement.expression);
        break;
      case "EmbeddedJavaScriptDeclaration":
        statement.captures.forEach((capture) => visit.expression({
          kind: "IdentifierExpression",
          name: capture.name,
          span: capture.nameSpan,
        }));
        break;
      case "ImportDeclaration":
      case "ReExportDeclaration":
      case "ExternModuleDeclaration":
      case "TypeDeclaration":
      case "TypeAliasDeclaration":
      case "EnumDeclaration":
      case "BreakStatement":
      case "ContinueStatement":
      case "PassStatement":
        break;
    }
  }

  /**
   * A `case` pattern's own uses: the values it compares against and the runtime
   * `Type` a type pattern checks.
   */
  private visitRuntimeMatchPattern(pattern: MatchPattern, visit: RuntimeUseVisitors): void {
    switch (pattern.kind) {
      case "MatchValuePattern": pattern.values.forEach(visit.expression); break;
      case "MatchTypePattern": this.host.markRuntimeType(resolveTypeReference(pattern.type)); break;
      case "MatchAsPattern": visit.matchPattern(pattern.pattern); break;
      case "MatchObjectPattern": pattern.entries.forEach((entry) => visit.matchPattern(entry.pattern)); break;
      case "MatchListPattern": pattern.elements.forEach(visit.matchPattern); break;
      case "MatchWildcardPattern":
      case "MatchCapturePattern":
        break;
    }
  }

  reactiveBridgeHelpers(
    needsJavaScriptCallBoundary: boolean,
    needsCollections: boolean,
    usedIdentifiers: ReadonlySet<string> = new Set(),
  ): readonly string[] {
    if (!needsJavaScriptCallBoundary && !needsCollections) return [];
    if (this.host.sharedRuntimeModules) {
      const imports = [
        ["reactiveRaw", "__velarReactiveRaw"],
        ["hostRaw", "__velarHostRaw"],
        ["reactiveIterateKey", "__velarReactiveIterateKey"],
        ["reactiveStructureKey", "__velarReactiveStructureKey"],
        ["reactiveCollectionRead", "__velarReactiveCollectionRead"],
        ["reactiveCollectionTrack", "__velarReactiveCollectionTrack"],
        ["reactiveCollectionLink", "__velarReactiveCollectionLink"],
        ["reactiveCollectionTrigger", "__velarReactiveCollectionTrigger"],
        ["reactiveCollectionUnlink", "__velarReactiveCollectionUnlink"],
      ].filter(([, local]) => usedIdentifiers.has(local!))
        .map(([exported, local]) => `${exported} as ${local}`);
      if (imports.length === 0) return [];
      this.host.requiredRuntimeModules.add(VELAR_REACTIVE_BRIDGE_MODULE);
      return [`import { ${imports.join(", ")} } from ${JSON.stringify(VELAR_REACTIVE_BRIDGE_MODULE)};`];
    }
    return [VELAR_NON_REACTIVE_BRIDGE_RUNTIME, ...(needsCollections ? [VELAR_NON_REACTIVE_COLLECTION_BRIDGE_RUNTIME] : [])];
  }

  // The compiler-owned observer behind the 'detach <expression>' statement
  // (docs/contributing/runtime-boundary.md, B-DETACHED-TASK). The Promise and Reflect
  // operations and the console channel are captured at module initialization;
  // rejection is normalized to Error and reported on the host error channel
  // without ending the process. Hosts with their own error chain override
  // this (the Web emitter routes the report through the velar/app chain).
  //
  // The reporter itself must never fail outward: a rejection value carries a
  // foreign error object whose 'stack' or 'message' may be a throwing getter,
  // and a throw inside a rejection handler becomes an unhandled rejection that
  // ends the Node process — the exact program termination this boundary
  // forbids. Every foreign read is therefore guarded, and the Promise derived
  // from adopting the task is observed rather than discarded.
  detachedTaskHelpers(): readonly string[] {
    return [[
      "const __velarDetachedPromiseThen = globalThis.Promise.prototype.then;",
      "const __velarDetachedApply = Reflect.apply;",
      "const __velarDetachedConsole = globalThis.console;",
      "const __velarDetachedConsoleError = __velarDetachedConsole ? __velarDetachedConsole.error : null;",
      "function __velarDetachedTrace(error) {",
      "  try { const trace = error.stack; if (typeof trace === \"string\" && trace !== \"\") return trace; } catch {}",
      "  try { const message = error.message; if (typeof message === \"string\" && message !== \"\") return message; } catch {}",
      "  return \"A detached task failed\";",
      "}",
      "function __velarDetachedReport(failure) {",
      "  try {",
      "    if (typeof __velarDetachedConsoleError !== \"function\") return null;",
      "    let error = null;",
      "    try { error = __velarNormalizeError(failure); } catch {}",
      "    const trace = error === null ? \"A detached task failed\" : __velarDetachedTrace(error);",
      "    __velarDetachedApply(__velarDetachedConsoleError, __velarDetachedConsole, [\"Detached task failed: \" + trace]);",
      "  } catch {}",
      "  return null;",
      "}",
      "function __velarDetachedTask(task) {",
      "  try {",
      "    const observed = __velarDetachedApply(__velarDetachedPromiseThen, task, [null, __velarDetachedReport]);",
      "    __velarDetachedApply(__velarDetachedPromiseThen, observed, [null, __velarDetachedReport]);",
      "  } catch (failure) {",
      "    __velarDetachedReport(failure);",
      "  }",
      "  return null;",
      "}",
    ].join("\n")];
  }

  /**
   * D43 item 69 rule 8: a release that fails while an error is already in
   * flight must not replace it. The original error keeps the throw; the release
   * failure is normalized and reported through the host channel. The reporter
   * itself never fails outward, for the same reason the detached-task reporter
   * does not — a throw inside it would end the process.
   */
  disposalHelpers(): readonly string[] {
    return [[
      "const __velarDisposalApply = Reflect.apply;",
      "const __velarDisposalConsole = globalThis.console;",
      "const __velarDisposalConsoleError = __velarDisposalConsole ? __velarDisposalConsole.error : null;",
      "function __velarDisposalTrace(error) {",
      "  try { const trace = error.stack; if (typeof trace === \"string\" && trace !== \"\") return trace; } catch {}",
      "  try { const message = error.message; if (typeof message === \"string\" && message !== \"\") return message; } catch {}",
      "  return \"A resource release failed\";",
      "}",
      "function __velarDisposalReport(failure) {",
      "  try {",
      "    if (typeof __velarDisposalConsoleError !== \"function\") return null;",
      "    let error = null;",
      "    try { error = __velarNormalizeError(failure); } catch {}",
      "    const trace = error === null ? \"A resource release failed\" : __velarDisposalTrace(error);",
      "    __velarDisposalApply(__velarDisposalConsoleError, __velarDisposalConsole, [\"Resource release failed while another error was in flight: \" + trace]);",
      "  } catch {}",
      "  return null;",
      "}",
    ].join("\n")];
  }

  /**
   * D51 rule 103: the three failures that mean "this program has a bug", by the
   * one name each of them stamps on itself. A forged name can only make a
   * failure propagate instead of becoming `null`, which is the safe direction:
   * `try` never hides a guard, and `catch` still receives everything.
   */
  integrityFailureHelpers(): readonly string[] {
    return [[
      "const __velarIntegrityDescriptor = Object.getOwnPropertyDescriptor;",
      "const __velarIntegrityPrototypeOf = Object.getPrototypeOf;",
      "function __velarIsIntegrityFailure(value) {",
      "  if (value === null || (typeof value !== \"object\" && typeof value !== \"function\")) return false;",
      "  const descriptor = __velarIntegrityDescriptor(value, \"name\");",
      "  if (!descriptor || !(\"value\" in descriptor)) return false;",
      "  const name = descriptor.value;",
      "  if (name !== \"AssertionError\" && name !== \"NarrowingError\" && name !== \"IndexError\") return false;",
      // D51 rule 107: the class a value was constructed from is what decides
      // here, exactly as it decides `code`. A relabelled host error carries
      // the name but no class declaring it, and must not pass through `try`
      // as though the language had raised it. The comparison is on the
      // declared name rather than on the class object because a module that
      // inlines its runtime holds its own copy of each class, and a failure
      // raised inside another module is still the same language failure.
      "  const prototype = __velarIntegrityPrototypeOf(value);",
      "  const constructor = prototype === null ? null : __velarIntegrityDescriptor(prototype, \"constructor\");",
      "  if (!constructor || !(\"value\" in constructor) || typeof constructor.value !== \"function\") return false;",
      "  const declared = __velarIntegrityDescriptor(constructor.value, \"name\");",
      "  return !!declared && \"value\" in declared && declared.value === name;",
      "}",
    ].join("\n")];
  }

  /**
   * D86 rule 212: `value!` raises the same `AssertionError` an
   * `assert value != null` raises, so the integrity check above keeps letting
   * it through `try` — a broken assertion is a bug, never a "not found".
   */
  requiredValueHelpers(): readonly string[] {
    return [[
      "function __velarRequired(value, description, offset) {",
      "  if (value === null || value === undefined) {",
      "    throw new __VelarAssertionError(\"Required value \" + description + \" is absent at source offset \" + offset);",
      "  }",
      "  return value;",
      "}",
    ].join("\n")];
  }
}
