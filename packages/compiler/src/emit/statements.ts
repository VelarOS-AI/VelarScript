/**
 * Statement emission: every `Statement` kind's JavaScript, the `using` scope
 * that releases its bindings on the way out, module imports and the extern and
 * embedded JavaScript that arrive beside them.
 *
 * D114 R1c: `emitStatement` is still declared on `JavaScriptEmitter` — it is
 * one of the 32 `protected` members Web and Node override — and forwards here.
 */
import type {
  AssignmentStatement,
  ClassDeclaration,
  BindingPattern,
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
import { testFunctionName } from "../ast.ts";
import { type BinaryStorageKind } from "../types.ts";
import { iterateAsyncMemberKey, type LoweringHints } from "../contracts.ts";
import { embeddedJavaScriptSpecifier } from "../embedded-module.ts";
import { spanIdentity, type Span } from "../source.ts";
import { contractExportNames, emitCheckedEmbeddedJavaScript, mappedSource, type PreparedEmbeddedJavaScriptModule } from "./javascript.ts";

export interface StatementEmitterHost {
  binaryIndexHelper(kind: BinaryStorageKind): string;
  binarySetIndexHelper(kind: Exclude<BinaryStorageKind, "bytes">): string;
  blockAlwaysReturns(statements: readonly Statement[]): boolean;
  collectionIteratorHelper(kind: "list" | "map" | "set" | "record" | "string" | "binary", pair: boolean): string;
  readonly embeddedJavaScript: Map<EmbeddedJavaScriptDeclaration, PreparedEmbeddedJavaScriptModule>;
  emitBindingPatternStatements(
    pattern: BindingPattern,
    value: string,
    binding: "const" | "let",
    exported: boolean,
    depth: number,
    label: string,
  ): readonly string[];
  emitClass(statement: ClassDeclaration, depth: number): string;
  emitCondition(expression: Expression): string;
  emitEnumDeclaration(statement: EnumDeclaration, depth: number): string;
  emitMappedAssignmentTarget(expression: Extract<Expression, { kind: "IdentifierExpression" | "MemberExpression" }>): string;
  emitMappedExpression(expression: Expression, normalizeNull?: boolean): string;
  emitMappedJavaScript(sourceSpan: Span, render: () => string): string;
  emitMappedStatement(statement: Statement, depth: number): string;
  emitMatchPatternAttempt(
    pattern: MatchPattern,
    valueName: string,
    indentation: string,
  ): {
    readonly lines: readonly string[];
    readonly bindings: readonly { readonly name: string; readonly value: string }[];
  };
  emitParameter(name: string, defaultValue: Expression | null, rest?: boolean): string;
  emitStatementLines(statements: readonly Statement[], depth: number): readonly string[];
  emitTypeAliasDeclaration(statement: TypeAliasDeclaration, depth: number): string;
  emitTypeDeclaration(statement: TypeDeclaration, depth: number): string;
  readonly executeMain: boolean;
  readonly externModuleExports: Map<string, ReadonlySet<string>>;
  readonly forcedFunctionExports: ReadonlySet<string>;
  readonly hints: LoweringHints;
  needsAssertionErrorClass: boolean;
  needsBinaryHelpers: boolean;
  needsBitwiseHelpers: boolean;
  needsCollectionHelpers: boolean;
  needsDisposalHelper: boolean;
  needsExternExportHelper: boolean;
  needsIndexHelpers: boolean;
  needsThrownValueHelper: boolean;
  readonly runtimeTypes: Set<string>;
  readonly sourcePath: string;
}

export class StatementEmitter {
  private readonly host: StatementEmitterHost;

  constructor(host: StatementEmitterHost) {
    this.host = host;
  }

  emitStatement(statement: Statement, depth: number): string {
    const indentation = "  ".repeat(depth);
    switch (statement.kind) {
      case "ImportDeclaration":
      case "ReExportDeclaration":
      case "ExternModuleDeclaration":
      case "EmbeddedJavaScriptDeclaration":
      case "TypeDeclaration":
      case "TypeAliasDeclaration":
      case "EnumDeclaration":
      case "ClassDeclaration":
      case "VariableDeclaration":
      case "MainBlock":
      case "TestDeclaration":
      case "FunctionDeclaration":
        return this.emitDeclarationStatement(statement, depth, indentation);
      case "ReturnStatement":
      case "ThrowStatement":
      case "AssertStatement":
      case "IfStatement":
      case "MatchStatement":
        return this.emitBranchStatement(statement, depth, indentation);
      case "ForStatement":
      case "WhileStatement":
      case "BreakStatement":
      case "ContinueStatement":
      case "PassStatement":
      case "TryStatement":
        return this.emitLoopStatement(statement, depth, indentation);
      case "AssignmentStatement":
        return this.emitAssignmentStatement(statement, depth, indentation);
      case "ExpressionStatement":
        return `${indentation}${this.host.emitMappedExpression(statement.expression, false)};`;
      case "DetachStatement":
        // Detached execution never floats: the compiler-owned observer
        // adopts the Promise, normalizes rejection to Error, and reports it
        // through the host error channel (see docs/contributing/runtime-boundary.md,
        // B-DETACHED-TASK). The expression takes the same Promise
        // normalization every other Promise consumer applies, so a foreign
        // thenable or an `undefined` from an extern boundary fails as an owned
        // 'Expected an actual Promise' instead of a host-voiced
        // 'Promise.prototype.then called on incompatible receiver'.
        return `${indentation}__velarDetachedTask(${this.host.emitMappedExpression(statement.expression)});`;
      default:
        return "";
    }
  }

  /**
   * Declarations: the module boundary an import or re-export becomes, the two
   * embedded-JavaScript forms, the runtime `Type` a type or enum declaration
   * compiles to, a class, a binding, `@main`, a test, and a function.
   */
  private emitDeclarationStatement(statement: Extract<Statement, { kind: "ImportDeclaration" | "ReExportDeclaration" | "ExternModuleDeclaration" | "EmbeddedJavaScriptDeclaration" | "TypeDeclaration" | "TypeAliasDeclaration" | "EnumDeclaration" | "ClassDeclaration" | "VariableDeclaration" | "MainBlock" | "TestDeclaration" | "FunctionDeclaration" }>, depth: number, indentation: string): string {
    switch (statement.kind) {
      case "ImportDeclaration":
        return this.emitImport(statement, indentation);
      case "ReExportDeclaration": {
        const emittedSource = statement.source.endsWith(".vel") ? `${statement.source.slice(0, -4)}.js` : statement.source;
        const names = statement.specifiers
          .map((specifier) => specifier.imported === specifier.exported ? specifier.imported : `${specifier.imported} as ${specifier.exported}`)
          .join(", ");
        return `${indentation}export {${names.length > 0 ? ` ${names} ` : ""}} from ${JSON.stringify(emittedSource)};`;
      }
      case "ExternModuleDeclaration":
        return "";
      case "EmbeddedJavaScriptDeclaration":
        return this.emitEmbeddedJavaScript(statement, indentation);
      case "TypeDeclaration":
        return this.host.runtimeTypes.has(statement.name) ? this.host.emitTypeDeclaration(statement, depth) : "";
      case "TypeAliasDeclaration":
        return this.host.runtimeTypes.has(statement.name) ? this.host.emitTypeAliasDeclaration(statement, depth) : "";
      case "EnumDeclaration":
        return this.host.emitEnumDeclaration(statement, depth);
      case "ClassDeclaration":
        return this.host.emitClass(statement, depth);
      case "VariableDeclaration": {
        const initializer = this.host.emitMappedExpression(statement.initializer);
        if (statement.pattern.kind === "NameBindingPattern") {
          return `${indentation}${statement.exported ? "export " : ""}${statement.binding} ${statement.pattern.name} = ${initializer};`;
        }
        const valueName = `__velarBindingValue${statement.pattern.span.start}`;
        return [
          `${indentation}const ${valueName} = ${initializer};`,
          ...this.host.emitBindingPatternStatements(
            statement.pattern,
            valueName,
            statement.binding,
            statement.exported,
            depth,
            "Variable",
          ),
        ].join("\n");
      }
      case "MainBlock": {
        if (!this.host.executeMain) return "";
        const body = this.host.emitStatementLines(statement.body, depth + 1).join("\n");
        return `${indentation}{${body.length > 0 ? `\n${body}\n${indentation}` : ""}}`;
      }
      // D39 item 53: a test is an exported async function the runner calls by
      // its generated name; the author's name travels in the module interface
      // so the reporter can quote it verbatim.
      case "TestDeclaration": {
        const lines = [
          ...this.host.emitStatementLines(statement.body, depth + 1),
          `${"  ".repeat(depth + 1)}return null;`,
        ];
        return `${indentation}export async function ${testFunctionName(statement)}() {\n${lines.join("\n")}\n${indentation}}`;
      }
      case "FunctionDeclaration": {
        const prefix = `${statement.exported || this.host.forcedFunctionExports.has(statement.name) ? "export " : ""}${statement.asynchronous ? "async " : ""}function`;
        const parameters = statement.parameters.map((parameter) => this.host.emitParameter(parameter.name, parameter.defaultValue, parameter.rest)).join(", ");
        const lines = [...this.host.emitStatementLines(statement.body, depth + 1)];
        if (!this.host.blockAlwaysReturns(statement.body)) lines.push(`${"  ".repeat(depth + 1)}return null;`);
        const body = lines.join("\n");
        return `${indentation}${prefix} ${statement.name}(${parameters}) {${body.length > 0 ? `\n${body}\n${indentation}` : ""}}`;
      }
    }
  }

  /**
   * The statements that leave or branch: `return`, `throw`, `assert`, `if` and
   * `match`.
   */
  private emitBranchStatement(statement: Extract<Statement, { kind: "ReturnStatement" | "ThrowStatement" | "AssertStatement" | "IfStatement" | "MatchStatement" }>, depth: number, indentation: string): string {
    switch (statement.kind) {
      case "ReturnStatement": {
        if (!statement.value) return `${indentation}return null;`;
        const value = this.host.emitMappedExpression(statement.value);
        return `${indentation}return ${this.host.hints.asyncResolvedValues.has(spanIdentity(statement.value.span)) ? `__velarAsyncResolvedValue(${value})` : value};`;
      }
      case "ThrowStatement":
        return `${indentation}throw ${this.host.emitMappedExpression(statement.value)};`;
      case "AssertStatement": {
        this.host.needsAssertionErrorClass = true;
        const message = statement.message ? this.host.emitMappedExpression(statement.message) : JSON.stringify("Assertion failed");
        return [
          `${indentation}if (!(${this.host.emitCondition(statement.condition)})) {`,
          `${indentation}  throw new __VelarAssertionError(${message});`,
          `${indentation}}`,
        ].join("\n");
      }
      case "IfStatement": {
        const thenBody = this.host.emitStatementLines(statement.thenBody, depth + 1).join("\n");
        let output = `${indentation}if (${this.host.emitCondition(statement.condition)}) {${thenBody.length > 0 ? `\n${thenBody}\n${indentation}` : ""}}`;
        if (statement.elseBody) {
          const chained = statement.elseBody.length === 1 && statement.elseBody[0]?.kind === "IfStatement"
            ? this.host.emitMappedStatement(statement.elseBody[0], 0)
            : null;
          if (chained) {
            output += ` else ${chained}`;
          } else {
            const elseBody = this.host.emitStatementLines(statement.elseBody, depth + 1).join("\n");
            output += ` else {${elseBody.length > 0 ? `\n${elseBody}\n${indentation}` : ""}}`;
          }
        }
        return output;
      }
      case "MatchStatement": {
        const suffix = statement.span.start;
        const valueName = `__velarMatchValue${suffix}`;
        const matchedName = `__velarMatchDone${suffix}`;
        const lines = [
          `${indentation}{`,
          `${indentation}  const ${valueName} = ${this.host.emitMappedExpression(statement.value)};`,
          `${indentation}  let ${matchedName} = false;`,
        ];
        for (const branch of statement.cases) {
          const attemptName = `__velarMatchCase${branch.pattern.span.start}`;
          const attempt = this.host.emitMatchPatternAttempt(branch.pattern, valueName, `${indentation}      `);
          lines.push(`${indentation}  let ${attemptName} = null;`);
          lines.push(`${indentation}  if (!${matchedName} && (${attemptName} = (() => {`);
          lines.push(...attempt.lines);
          lines.push(`${indentation}      return [${attempt.bindings.map((binding) => binding.value).join(", ")}];`);
          lines.push(`${indentation}    })()) !== null) {`);
          attempt.bindings.forEach((binding, index) => {
            lines.push(`${indentation}    const ${binding.name} = ${attemptName}[${index}];`);
          });
          if (branch.guard) {
            lines.push(`${indentation}    if (${this.host.emitCondition(branch.guard)}) {`);
            lines.push(`${indentation}      ${matchedName} = true;`);
            lines.push(...this.host.emitStatementLines(branch.body, depth + 3));
            lines.push(`${indentation}    }`);
          } else {
            lines.push(`${indentation}    ${matchedName} = true;`);
            lines.push(...this.host.emitStatementLines(branch.body, depth + 2));
          }
          lines.push(`${indentation}  }`);
        }
        lines.push(`${indentation}}`);
        return lines.join("\n");
      }
    }
  }

  /**
   * The statements that repeat or unwind: `for` in both its forms, `while`,
   * `break`, `continue`, `pass` and `try`.
   */
  private emitLoopStatement(statement: Extract<Statement, { kind: "ForStatement" | "WhileStatement" | "BreakStatement" | "ContinueStatement" | "PassStatement" | "TryStatement" }>, depth: number, indentation: string): string {
    switch (statement.kind) {
      case "ForStatement": {
        if (statement.asynchronous) {
          const suffix = statement.span.start;
          const sourceName = `__velarAsyncForSource${suffix}`;
          const nextName = `__velarAsyncForNext${suffix}`;
          const valueName = `__velarAsyncForValue${suffix}`;
          const indexName = `__velarAsyncForIndex${suffix}`;
          const bodyDepth = depth + 2;
          // D90 R18: a source whose class declares the asynchronous
          // `@iterate:` form is pulled through the declared member — no
          // structural `next` capture, because the contract is a declaration,
          // not a resemblance.
          const declared = this.host.hints.asyncIterationStatements.has(statement.span.start);
          const lines = [
            `${indentation}{`,
            `${"  ".repeat(depth + 1)}const ${sourceName} = ${this.host.emitMappedExpression(statement.iterable)};`,
            ...(declared ? [] : [`${"  ".repeat(depth + 1)}const ${nextName} = __velarAsyncPullNext(${sourceName});`]),
            `${"  ".repeat(depth + 1)}let ${indexName} = 0;`,
            `${"  ".repeat(depth + 1)}while (true) {`,
            `${"  ".repeat(bodyDepth)}const ${valueName} = await __velarNormalizePromiseValue(${declared ? `${sourceName}[${JSON.stringify(iterateAsyncMemberKey)}]()` : `__velarAsyncPullCall(${sourceName}, ${nextName})`});`,
            `${"  ".repeat(bodyDepth)}if (${valueName} === null) break;`,
            ...this.host.emitBindingPatternStatements(statement.pattern, valueName, "const", false, bodyDepth, "Async for"),
            ...(statement.secondPattern
              ? this.host.emitBindingPatternStatements(statement.secondPattern, indexName, "const", false, bodyDepth, "Async for second slot")
              : []),
            `${"  ".repeat(bodyDepth)}${indexName} += 1;`,
            ...this.host.emitStatementLines(statement.body, bodyDepth),
            `${"  ".repeat(depth + 1)}}`,
            `${indentation}}`,
          ];
          return lines.join("\n");
        }
        if (this.host.hints.nativeRangeForStatements.has(statement.span.start)
          && statement.iterable.kind === "CallExpression"
          && statement.pattern.kind === "NameBindingPattern") {
          const call = statement.iterable;
          const sourceArguments = call.arguments.map((argument) => this.host.emitMappedExpression(argument));
          const namedOrder = this.host.hints.namedArgumentOrders.get(spanIdentity(call.span));
          const arguments_ = namedOrder
            ? namedOrder.map((source) => source === -1 ? "undefined" : `__velarNamedArguments[${source}]`)
            : sourceArguments;
          const emittedArguments = namedOrder
            ? `...((__velarNamedArguments) => [${arguments_.join(", ")}])([${sourceArguments.join(", ")}])`
            : arguments_.join(", ");
          const suffix = statement.span.start;
          const boundsName = `__velarRangeBounds${suffix}`;
          const counterName = `__velarRangeCounter${suffix}`;
          const endName = `__velarRangeEnd${suffix}`;
          const stepName = `__velarRangeStep${suffix}`;
          const valueName = statement.pattern.name;
          const body = this.host.emitStatementLines(statement.body, depth + 2).join("\n");
          return [
            `${indentation}{`,
            `${indentation}  const ${boundsName} = __velarCountedRangeOwner.__velarCounted(${emittedArguments});`,
            `${indentation}  let ${counterName} = ${boundsName}[0];`,
            `${indentation}  const ${endName} = ${boundsName}[1];`,
            `${indentation}  const ${stepName} = ${boundsName}[2];`,
            `${indentation}  for (; ${stepName} > 0 ? ${counterName} < ${endName} : ${counterName} > ${endName}; ${counterName} += ${stepName}) {`,
            `${indentation}    const ${valueName} = ${counterName};${body.length > 0 ? `\n${body}` : ""}`,
            `${indentation}  }`,
            `${indentation}}`,
          ].join("\n");
        }
        const iterable = this.host.emitMappedExpression(statement.iterable);
        const collectionKind = this.host.hints.collectionIterations.get(statement.span.start);
        if (collectionKind === "binary") this.host.needsBinaryHelpers = true;
        else this.host.needsCollectionHelpers = true;
        const iteratorHelper = collectionKind ? this.host.collectionIteratorHelper(collectionKind, false) : "__velarCollectionIterator";
        if (!statement.secondPattern && statement.pattern.kind === "NameBindingPattern") {
          const body = this.host.emitStatementLines(statement.body, depth + 1).join("\n");
          return `${indentation}for (const ${statement.pattern.name} of ${iteratorHelper}(${iterable})) {${body.length > 0 ? `\n${body}\n${indentation}` : ""}}`;
        }
        if (statement.secondPattern) {
          const pairName = `__velarForPair${statement.pattern.span.start}`;
          const pairIteratorHelper = collectionKind ? this.host.collectionIteratorHelper(collectionKind, true) : "__velarCollectionPairIterator";
          const lines = [
            ...this.host.emitBindingPatternStatements(statement.pattern, `${pairName}[0]`, "const", false, depth + 1, "For first slot"),
            ...this.host.emitBindingPatternStatements(statement.secondPattern, `${pairName}[1]`, "const", false, depth + 1, "For second slot"),
            ...this.host.emitStatementLines(statement.body, depth + 1),
          ];
          return `${indentation}for (const ${pairName} of ${pairIteratorHelper}(${iterable})) {${lines.length > 0 ? `\n${lines.join("\n")}\n${indentation}` : ""}}`;
        }
        const valueName = `__velarForValue${statement.pattern.span.start}`;
        const lines = [
          ...this.host.emitBindingPatternStatements(statement.pattern, valueName, "const", false, depth + 1, "For"),
          ...this.host.emitStatementLines(statement.body, depth + 1),
        ];
        return `${indentation}for (const ${valueName} of ${iteratorHelper}(${iterable})) {${lines.length > 0 ? `\n${lines.join("\n")}\n${indentation}` : ""}}`;
      }
      case "WhileStatement": {
        const body = this.host.emitStatementLines(statement.body, depth + 1).join("\n");
        return `${indentation}while (${this.host.emitCondition(statement.condition)}) {${body.length > 0 ? `\n${body}\n${indentation}` : ""}}`;
      }
      case "BreakStatement":
        return `${indentation}break;`;
      case "ContinueStatement":
        return `${indentation}continue;`;
      case "PassStatement":
        return "";
      case "TryStatement": {
        const tryBody = this.host.emitStatementLines(statement.tryBody, depth + 1).join("\n");
        let output = `${indentation}try {${tryBody.length > 0 ? `\n${tryBody}\n${indentation}` : ""}}`;
        if (statement.catchBody) {
          this.host.needsThrownValueHelper = true;
          const catchBody = this.host.emitStatementLines(statement.catchBody, depth + 1).join("\n");
          const catchName = statement.catchName ?? "error";
          const normalization = `${"  ".repeat(depth + 1)}${catchName} = __velarNormalizeError(${catchName});`;
          output += ` catch (${catchName}) {\n${normalization}${catchBody.length > 0 ? `\n${catchBody}` : ""}\n${indentation}}`;
        }
        if (statement.finallyBody) {
          const finallyBody = this.host.emitStatementLines(statement.finallyBody, depth + 1).join("\n");
          output += ` finally {${finallyBody.length > 0 ? `\n${finallyBody}\n${indentation}` : ""}}`;
        }
        return output;
      }
    }
  }

  /**
   * An assignment. The target decides the shape: an index assignment lowers
   * through the collection or binary helper for its receiver, a compound
   * assignment to a guarded field reads through the same guard it writes, and
   * everything else is the plain JavaScript assignment.
   */
  private emitAssignmentStatement(statement: Extract<Statement, { kind: "AssignmentStatement" }>, depth: number, indentation: string): string {
      if (statement.target.kind === "IndexExpression") {
        const binaryKind = this.host.hints.binaryIndexes.get(spanIdentity(statement.target.span));
        const collectionKind = this.host.hints.collectionIndexes.get(spanIdentity(statement.target.span));
        if (binaryKind) this.host.needsBinaryHelpers = true;
        else {
          this.host.needsIndexHelpers = true;
          this.host.needsCollectionHelpers = true;
        }
        const object = this.host.emitMappedExpression(statement.target.object);
        const index = this.host.emitMappedExpression(statement.target.index);
        if (binaryKind === "bytes") {
          return `${indentation}__velarBinaryRuntime.__velarSetIndex(${object}, ${index}, ${this.host.emitMappedExpression(statement.value)});`;
        }
        if (binaryKind) {
          const setHelper = this.host.binarySetIndexHelper(binaryKind);
          const getHelper = this.host.binaryIndexHelper(binaryKind);
          if (statement.operator === "=") {
            return `${indentation}__velarBinaryRuntime.${setHelper}(${object}, ${index}, ${this.host.emitMappedExpression(statement.value)});`;
          }
          const suffix = statement.span.start;
          const objectName = `__velarIndexObject${suffix}`;
          const keyName = `__velarIndexKey${suffix}`;
          const value = this.host.emitMappedExpression(statement.value);
          return [
            `${indentation}{`,
            `${indentation}  const ${objectName} = ${object};`,
            `${indentation}  const ${keyName} = ${index};`,
            `${indentation}  __velarBinaryRuntime.${setHelper}(${objectName}, ${keyName}, ${this.emitCompoundOperation(`__velarBinaryRuntime.${getHelper}(${objectName}, ${keyName})`, statement.operator, value)});`,
            `${indentation}}`,
          ].join("\n");
        }
        const collectionSetHelper = collectionKind === "list" ? "__velarListIndexSet"
          : collectionKind === "record" ? "__velarRecordIndexSet"
            : "__velarSetIndex";
        const collectionGetHelper = collectionKind === "list" ? "__velarListIndexGet"
          : collectionKind === "record" ? "__velarRecordIndexGet"
            : "__velarIndex";
        if (statement.operator === "=") {
          return `${indentation}${collectionSetHelper}(${object}, ${index}, ${this.host.emitMappedExpression(statement.value)});`;
        }
        const suffix = statement.span.start;
        const objectName = `__velarIndexObject${suffix}`;
        const keyName = `__velarIndexKey${suffix}`;
        const value = this.host.emitMappedExpression(statement.value);
        return [
          `${indentation}{`,
          `${indentation}  const ${objectName} = ${object};`,
          `${indentation}  const ${keyName} = ${index};`,
          `${indentation}  ${collectionSetHelper}(${objectName}, ${keyName}, ${this.emitCompoundOperation(`${collectionGetHelper}(${objectName}, ${keyName})`, statement.operator, value)});`,
          `${indentation}}`,
        ].join("\n");
      }
      if (statement.operator !== "=" && statement.target.kind === "MemberExpression") {
        const key = spanIdentity(statement.target.span);
        const staticFieldOwnerDepth = this.host.hints.staticFieldReads.get(key);
        const guardedInstanceField = this.host.hints.instanceFieldReads.has(key);
        const guardedPrivateField = this.host.hints.privateInstanceFieldReads.has(key);
        if (staticFieldOwnerDepth !== undefined || guardedInstanceField || guardedPrivateField) {
          const suffix = statement.span.start;
          const objectName = `__velarMemberObject${suffix}`;
          const privateProperty = this.host.hints.privateMembers.has(key);
          const property = `${privateProperty ? "#" : ""}${statement.target.property}`;
          const read = staticFieldOwnerDepth !== undefined
            ? `__velarReadStaticField(${objectName}, ${JSON.stringify(statement.target.property)}, ${staticFieldOwnerDepth})`
            : guardedPrivateField
              ? `__velarReadPrivateField(${objectName}.${property}, ${JSON.stringify(statement.target.property)})`
              : `__velarReadInstanceField(${objectName}, ${JSON.stringify(statement.target.property)})`;
          const operation = this.emitCompoundOperation(read, statement.operator, this.host.emitMappedExpression(statement.value));
          return [
            `${indentation}{`,
            `${indentation}  const ${objectName} = ${this.host.emitMappedExpression(statement.target.object)};`,
            `${indentation}  ${objectName}.${property} = ${operation};`,
            `${indentation}}`,
          ].join("\n");
        }
        if (this.bitwiseAssignmentOperator(statement.operator)) {
          const suffix = statement.span.start;
          const objectName = `__velarMemberObject${suffix}`;
          const privateProperty = this.host.hints.privateMembers.has(key);
          const property = `${privateProperty ? "#" : ""}${statement.target.property}`;
          const value = this.host.emitMappedExpression(statement.value);
          return [
            `${indentation}{`,
            `${indentation}  const ${objectName} = ${this.host.emitMappedExpression(statement.target.object)};`,
            `${indentation}  ${objectName}.${property} = ${this.emitCompoundOperation(`${objectName}.${property}`, statement.operator, value)};`,
            `${indentation}}`,
          ].join("\n");
        }
      }
      {
        const target = this.host.emitMappedAssignmentTarget(statement.target);
        const value = this.host.emitMappedExpression(statement.value);
        if (statement.operator !== "=" && this.bitwiseAssignmentOperator(statement.operator)) {
          return `${indentation}${target} = ${this.emitCompoundOperation(target, statement.operator, value)};`;
        }
        return `${indentation}${target} ${statement.operator} ${value};`;
      }
  }

  emitUsingScope(statement: UsingDeclaration, rest: readonly Statement[], depth: number): readonly string[] {
    const indentation = "  ".repeat(depth);
    const contract = this.host.hints.usingDisposals.get(spanIdentity(statement.span));
    const initializer = this.host.emitMappedJavaScript(statement.span, () => `const ${statement.name} = ${this.host.emitMappedExpression(statement.initializer)};`);
    // A value with no resolved contract was already diagnosed; emitting the
    // binding alone keeps the rest of the block readable in a failed compile.
    if (!contract) return [`${indentation}${initializer}`, ...this.host.emitStatementLines(rest, depth)];
    const body = this.host.emitStatementLines(rest, depth + 1);
    this.host.needsDisposalHelper = true;
    const suffix = statement.span.start;
    const member = contract.owner === "class" ? `[${JSON.stringify(contract.member)}]` : `.${contract.member}`;
    const call = `${contract.asynchronous ? "await " : ""}${statement.name}${member}()`;
    const released = `__velarReleased${suffix}`;
    const failure = `__velarUsingFailure${suffix}`;
    return [
      `${indentation}${initializer}`,
      `${indentation}let ${released} = false;`,
      `${indentation}try {`,
      ...body,
      // An error already in flight owns the failure: the release still runs,
      // but its own failure is reported to the host instead of replacing the
      // error the author is about to see (D43 item 69 rule 8).
      `${indentation}} catch (${failure}) {`,
      `${indentation}  ${released} = true;`,
      `${indentation}  try { ${call}; } catch (__velarDisposeFailure${suffix}) { __velarDisposalReport(__velarDisposeFailure${suffix}); }`,
      `${indentation}  throw ${failure};`,
      `${indentation}} finally {`,
      // Normal completion, `return`, `break`, and `continue` all arrive here,
      // and a release failure on those paths throws normally.
      `${indentation}  if (!${released}) ${call};`,
      `${indentation}}`,
    ];
  }

  emitImport(statement: ImportDeclaration, indentation: string): string {
    const source = statement.source;
    if (statement.resource === "json") {
      const local = statement.specifiers[0]?.local ?? "resource";
      const emittedResource = source.startsWith(".") ? `${source}.js` : source;
      return `${indentation}import ${local} from ${JSON.stringify(emittedResource)};`;
    }
    const emittedSource = source.endsWith(".vel") ? `${source.slice(0, -4)}.js` : source;
    const first = statement.specifiers[0];
    if (first?.namespace) {
      const declared = statement.javascript && !statement.unsafe
        ? this.host.externModuleExports.get(source)
        : undefined;
      if (!declared) return `${indentation}import * as ${first.local} from ${JSON.stringify(emittedSource)};`;
      this.host.needsExternExportHelper = true;
      return [
        `${indentation}import * as ${first.local} from ${JSON.stringify(emittedSource)};`,
        ...[...declared].sort().map((name) => (
          `${indentation}__velarExternExport(${first.local}, ${JSON.stringify(name)}, ${JSON.stringify(source)});`
        )),
      ].join("\n");
    }
    // W-22: names governed by an extern module declaration import through the
    // module namespace so a declared-but-missing export fails at this import
    // site with a velar-voiced error instead of linking to undefined (bundled
    // CommonJS interop) or a host-voiced link refusal. Only the genuinely
    // imported declared names are checked; specifiers the declaration does not
    // name keep the native import form.
    const declared = statement.javascript && !statement.unsafe
      ? this.host.externModuleExports.get(source)
      : undefined;
    const checked = declared ? statement.specifiers.filter((specifier) => declared.has(specifier.imported)) : [];
    const native = declared ? statement.specifiers.filter((specifier) => !declared.has(specifier.imported)) : statement.specifiers;
    const lines: string[] = [];
    if (native.length === 1 && native[0]!.imported === "default") {
      lines.push(`${indentation}import ${native[0]!.local} from ${JSON.stringify(emittedSource)};`);
    } else if (native.length > 0 || checked.length === 0) {
      const names = native.map((specifier) => specifier.imported === specifier.local ? specifier.imported : `${specifier.imported} as ${specifier.local}`).join(", ");
      lines.push(`${indentation}import { ${names} } from ${JSON.stringify(emittedSource)};`);
    }
    if (checked.length > 0) {
      this.host.needsExternExportHelper = true;
      // Charter section 12, line 2737: "an `export let` remains a live
      // ES-module value: the exporting module can reassign it between reads".
      // So the name binds through a real `import` and the presence probe runs
      // beside it as its own statement. Reading the namespace *into* a `const`
      // would have frozen the foreign binding at its initial value, which is
      // neither what `import js * as`, nor `unsafe js`, nor JavaScript itself
      // does with the same declaration.
      //
      // W-22's probe survives as the interop backstop rather than the primary
      // check: a host that link-checks named imports refuses a missing export
      // before any statement runs, and where the name links to `undefined`
      // instead — bundled CommonJS interop — the probe beside it is what
      // reports, in the velar voice.
      const names = checked
        .map((specifier) => specifier.imported === specifier.local ? specifier.imported : `${specifier.imported} as ${specifier.local}`)
        .join(", ");
      const namespaceName = `__velarExternModule${statement.span.start}`;
      lines.push(`${indentation}import { ${names} } from ${JSON.stringify(emittedSource)};`);
      lines.push(`${indentation}import * as ${namespaceName} from ${JSON.stringify(emittedSource)};`);
      for (const specifier of checked) {
        lines.push(`${indentation}__velarExternExport(${namespaceName}, ${JSON.stringify(specifier.imported)}, ${JSON.stringify(source)});`);
      }
    }
    return lines.join("\n");
  }

  prepareEmbeddedJavaScript(program: Program): void {
    this.host.embeddedJavaScript.clear();
    let ordinal = 0;
    for (const statement of program.body) {
      if (statement.kind !== "EmbeddedJavaScriptDeclaration") continue;
      const specifier = embeddedJavaScriptSpecifier(this.host.sourcePath, ordinal);
      const occupiedJavaScriptNames = new Set(statement.bindings.map((binding) => binding.name));
      // A factory exists to hand the block its captures. With no captures
      // there is nothing to hand over, so the block stays a real ES module and
      // its exports stay live bindings — see `emitEmbeddedJavaScript`.
      const needsFactory = statement.contract !== null && statement.captures.length > 0;
      let factoryName = needsFactory ? `__velarEmbeddedFactory_${ordinal}` : null;
      while (factoryName && occupiedJavaScriptNames.has(factoryName)) factoryName += "_";
      const localFactoryName = needsFactory ? `__velarEmbeddedFactoryBinding_${ordinal}` : null;
      const generated = factoryName
        ? emitCheckedEmbeddedJavaScript(statement, factoryName)
        : mappedSource(statement.source, statement.sourceSpan.start);
      this.host.embeddedJavaScript.set(statement, {
        statement,
        specifier,
        factoryName,
        localFactoryName,
        code: generated.code,
        mappings: generated.mappings,
      });
      ordinal += 1;
    }
  }

  private emitEmbeddedJavaScript(statement: EmbeddedJavaScriptDeclaration, indentation: string): string {
    const prepared = this.host.embeddedJavaScript.get(statement);
    if (!prepared) throw new Error("An embedded JavaScript declaration has no prepared sibling module");
    if (!prepared.factoryName) {
      // Charter section 12, line 2737: an `export let` the block reassigns is
      // a live ES-module value. A block with no captures needs no factory to
      // receive them, so its sibling module keeps its own `export`
      // declarations and the names arrive here as real imported bindings —
      // the same value `unsafe js` and `import js * as` observe. A contract changes what the
      // compiler proves about a block, never what the program observes.
      const declared = statement.contract ? contractExportNames(statement.contract) : null;
      const exported = declared
        ? statement.exports.filter((item) => declared.has(item.name))
        : statement.exports;
      const imported: ImportDeclaration = {
        kind: "ImportDeclaration",
        source: prepared.specifier,
        sourceSpan: statement.sourceSpan,
        javascript: true,
        unsafe: true,
        specifiers: exported.map((item) => ({
          imported: item.name,
          local: item.name,
          namespace: false,
          span: item.nameSpan,
        })),
        span: statement.span,
      };
      return this.emitImport(imported, indentation);
    }
    // A factory only exists for a checked block, and only when it has captures.
    const names = statement.contract ? [...contractExportNames(statement.contract)] : [];
    const captureValues = statement.captures.map((capture) => this.host.emitMappedExpression({
      kind: "IdentifierExpression",
      name: capture.name,
      span: capture.nameSpan,
    })).join(", ");
    const call = `${prepared.localFactoryName}(${captureValues})`;
    return [
      `${indentation}import { ${prepared.factoryName} as ${prepared.localFactoryName} } from ${JSON.stringify(prepared.specifier)};`,
      names.length > 0
        ? `${indentation}const { ${names.join(", ")} } = ${call};`
        : `${indentation}${call};`,
    ].join("\n");
  }

  private emitCompoundOperation(read: string, operator: AssignmentStatement["operator"], value: string): string {
    const bitwise = this.bitwiseAssignmentOperator(operator);
    if (bitwise) {
      this.host.needsBitwiseHelpers = true;
      return `__velarBitwiseBinary(${read}, ${JSON.stringify(bitwise)}, ${value})`;
    }
    return `${read} ${operator.slice(0, -1)} ${value}`;
  }

  private bitwiseAssignmentOperator(operator: AssignmentStatement["operator"]): "&" | "|" | "^" | "<<" | ">>" | ">>>" | null {
    return operator === "&=" || operator === "|=" || operator === "^=" || operator === "<<=" || operator === ">>=" || operator === ">>>="
      ? operator.slice(0, -1) as "&" | "|" | "^" | "<<" | ">>" | ">>>"
      : null;
  }
}
