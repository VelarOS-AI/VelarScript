/**
 * Expression emission: every `Expression` kind's JavaScript, the comparison
 * chain that evaluates each operand once, and the runtime-helper names the
 * lowered forms call (collection, binary, primitive and index helpers).
 *
 * D114 R1c: `emitExpression` is still declared on `JavaScriptEmitter` — it is
 * one of the 32 `protected` members Web and Node override — and forwards here.
 */
import type { Expression, TypeReference } from "../ast.ts";
import { formatTypeReference, resolveTypeReference, type BinaryStorageKind, type ValueType } from "../types.ts";
import { type LoweringHints } from "../contracts.ts";
import { spanIdentity } from "../source.ts";
import { javaScriptNodeMarker, requiredValueDescription } from "./javascript.ts";

export interface ExpressionEmitterHost {
  binaryHelper(expression: Extract<Expression, { kind: "MemberExpression" }>): string | null;
  binaryIndexHelper(kind: BinaryStorageKind): string;
  collectionHelper(expression: Extract<Expression, { kind: "MemberExpression" }>): string | null;
  collectionSizeHelper(kind: "list" | "map" | "set" | "record"): string;
  primitiveHelper(expression: Extract<Expression, { kind: "MemberExpression" }>): string | null;
  builtinErrorRuntimeName(name: string): string | null;
  emitCondition(expression: Expression): string;
  emitIsCheck(type: ValueType, value: string): string;
  emitMappedExpression(expression: Expression, normalizeNull?: boolean): string;
  emitObjectKey(name: string): string;
  emitParameter(name: string, defaultValue: Expression | null, rest?: boolean): string;
  expressionContainsDirectAwait(expression: Expression): boolean;
  readonly hints: LoweringHints;
  needsAssertionErrorClass: boolean;
  needsBinaryHelpers: boolean;
  needsBitwiseHelpers: boolean;
  needsCollectionHelpers: boolean;
  needsErrorCodeHelper: boolean;
  needsIndexHelpers: boolean;
  needsIntegrityFailureHelper: boolean;
  needsNumberHelper: boolean;
  needsPrimitiveHelpers: boolean;
  needsRecordHelpers: boolean;
  needsRequiredValueHelper: boolean;
  needsThrownValueHelper: boolean;
}

export class ExpressionEmitter {
  private readonly host: ExpressionEmitterHost;

  constructor(host: ExpressionEmitterHost) {
    this.host = host;
  }

  emitExpression(expression: Expression): string {
    if (expression.kind === "ExtensionExpression:core:duration") {
      return JSON.stringify((expression as Expression & { readonly raw: string }).raw);
    }
    if (expression.kind === "UnaryExpression" && (expression.operator === "+" || expression.operator === "-")
      && this.host.hints.extensionCalls.get(spanIdentity(expression.span)) === "core.duration-arithmetic") {
      return `__velarDurationUnary(${JSON.stringify(expression.operator)}, ${this.host.emitMappedExpression(expression.operand)})`;
    }
    if (expression.kind === "BinaryExpression"
      && this.host.hints.extensionCalls.get(spanIdentity(expression.span)) === "core.duration-arithmetic") {
      return `__velarDurationMath(${JSON.stringify(expression.operator)}, ${this.host.emitMappedExpression(expression.left)}, ${this.host.emitMappedExpression(expression.right)})`;
    }
    switch (expression.kind) {
      case "LiteralExpression":
      case "FStringExpression":
      case "IdentifierExpression":
      case "SuperExpression":
      case "DynamicImportExpression":
      case "ListExpression":
      case "ObjectExpression":
      case "SpreadExpression":
      case "RequiredExpression":
      case "TryExpression":
        return this.emitLiteralExpression(expression);
      case "UnaryExpression":
      case "BinaryExpression":
      case "ComparisonChainExpression":
      case "ConditionalExpression":
      case "IsExpression":
      case "ArrowFunctionExpression":
        return this.emitOperatorExpression(expression);
      case "CallExpression":
        return this.emitCallExpression(expression);
      case "MemberExpression":
      case "IndexExpression":
        return this.emitAccessExpression(expression);
      default:
        return "null";
    }
  }

  /**
   * The value-shaped expressions: literals and f-strings, a name, `super`, a
   * dynamic import, the collection and record literals, a spread, the required
   * unwrap `!`, and `try` as an expression.
   */
  private emitLiteralExpression(expression: Extract<Expression, { kind: "LiteralExpression" | "FStringExpression" | "IdentifierExpression" | "SuperExpression" | "DynamicImportExpression" | "ListExpression" | "ObjectExpression" | "SpreadExpression" | "RequiredExpression" | "TryExpression" }>): string {
    switch (expression.kind) {
      case "LiteralExpression":
        return expression.value === null ? "null" : typeof expression.value === "string" ? JSON.stringify(expression.value) : String(expression.value);
      case "FStringExpression":
        return `\`${expression.parts.map((part) => part.kind === "text" ? this.escapeTemplateText(part.value) : `\${${this.host.emitMappedExpression(part.value)}}`).join("")}\``;
      case "IdentifierExpression":
        {
          const builtin = this.host.hints.builtinValueReferences.get(spanIdentity(expression.span));
          if (builtin === "Json") return "__velarJsonNamespace";
          if (builtin === "Promise") return "__velarPromiseNamespace";
          if (builtin === "Text") return "__velarTextNamespace";
          if (builtin === "Math") return "__velarMathNamespace";
          if (builtin === "range") return "__velarRange";
        }
        if (expression.name === "number") {
          this.host.needsNumberHelper = true;
          return "__velarNumber";
        }
        return expression.name === "str" ? "String"
          : expression.name === "print" ? "console.log"
            : this.host.builtinErrorRuntimeName(expression.name) ?? expression.name;
      case "SuperExpression":
        return "super";
      case "DynamicImportExpression": {
        const source = expression.source.endsWith(".vel") ? `${expression.source.slice(0, -4)}.js` : expression.source;
        return `import(${JSON.stringify(source)})`;
      }
      case "ListExpression":
        if (expression.elements.some((element) => element.kind === "SpreadExpression")) {
          this.host.needsCollectionHelpers = true;
          const asynchronous = expression.elements.some((element) => this.host.expressionContainsDirectAwait(element));
          const parts = expression.elements.map((element) => {
            const directAwait = this.host.expressionContainsDirectAwait(element);
            const value = element.kind === "SpreadExpression" ? element.value : element;
            const read = `${directAwait ? "async " : ""}() => (${this.host.emitMappedExpression(value)})`;
            return asynchronous ? `[${element.kind === "SpreadExpression"}, ${directAwait}, ${read}]` : `[${element.kind === "SpreadExpression"}, ${read}]`;
          });
          return `${asynchronous ? "await __velarCreateListAsync" : "__velarCreateList"}([${parts.join(", ")}])`;
        }
        if (expression.elements.length === 0) {
          // COL-P1: an empty List literal is the one array the runtime cannot
          // tell from an array JavaScript handed over empty, and the difference
          // decides whether every later element read re-proves its slot. The
          // compiler knows which one this is, so it is the compiler that says
          // so; a `[]` that arrives from the host is never adopted.
          this.host.needsCollectionHelpers = true;
          return "__velarAdoptList([])";
        }
        return `[${expression.elements.map((element) => this.host.emitMappedExpression(element)).join(", ")}]`;
      case "ObjectExpression": {
        const needsControlledConstruction = expression.properties.some((property) => property.kind === "ObjectSpread"
          || property.name === "__proto__");
        if (!needsControlledConstruction) {
          return `{ ${expression.properties.map((property) => property.kind === "ObjectProperty"
            ? `${this.host.emitObjectKey(property.name)}: ${this.host.emitMappedExpression(property.value)}`
            : "").join(", ")} }`;
        }
        this.host.needsCollectionHelpers = true;
        this.host.needsRecordHelpers = true;
        const asynchronous = expression.properties.some((property) => this.host.expressionContainsDirectAwait(property.value));
        const parts = expression.properties.map((property) => {
          const directAwait = this.host.expressionContainsDirectAwait(property.value);
          const read = `${directAwait ? "async " : ""}() => (${this.host.emitMappedExpression(property.value)})`;
          const name = property.kind === "ObjectProperty" ? JSON.stringify(property.name) : "null";
          return asynchronous
            ? `[${property.kind === "ObjectSpread"}, ${name}, ${directAwait}, ${read}]`
            : `[${property.kind === "ObjectSpread"}, ${name}, ${read}]`;
        });
        return `${asynchronous ? "await __velarCreateRecordAsync" : "__velarCreateRecord"}([${parts.join(", ")}])`;
      }
      case "SpreadExpression":
        this.host.needsCollectionHelpers = true;
        return `...__velarCopyList(${this.host.emitMappedExpression(expression.value)}, "Call spread")`;
      // D86 rule 212: the unwrap evaluates its value once and raises where the
      // absence is, not ten lines later where the `undefined` would surface.
      case "RequiredExpression": {
        this.host.needsRequiredValueHelper = true;
        this.host.needsAssertionErrorClass = true;
        const description = JSON.stringify(requiredValueDescription(expression.value));
        return `__velarRequired(${this.host.emitMappedExpression(expression.value)}, ${description}, ${expression.span.start})`;
      }
      // D39 item 51: the attempt runs in its own frame so any failure inside
      // the whole chain becomes null, and nothing else in the surrounding
      // expression is skipped.
      case "TryExpression": {
        // D51 rule 103: `try` turns an *expected* failure into an optional.
        // AssertionError, NarrowingError, and IndexError are the language
        // saying "your program has a bug", so they pass straight through
        // instead of arriving as a `null` that reads like "not found". A
        // `catch` block still catches all three — that one is explicit.
        this.host.needsIntegrityFailureHelper = true;
        const asynchronous = this.host.expressionContainsDirectAwait(expression.value);
        const failure = `__velarTryFailure${expression.span.start}`;
        const attempt = `{ try { return ${this.host.emitMappedExpression(expression.value)}; } `
          + `catch (${failure}) { if (__velarIsIntegrityFailure(${failure})) throw ${failure}; return null; } }`;
        return `${asynchronous ? "await " : ""}(${asynchronous ? "async " : ""}() => ${attempt})()`;
      }
    }
  }

  /**
   * The operators: unary and binary — including every lowering a binary can
   * take, from string concatenation to a collection operation — the comparison
   * chain, the conditional, `is`, and an arrow function.
   */
  private emitOperatorExpression(expression: Extract<Expression, { kind: "UnaryExpression" | "BinaryExpression" | "ComparisonChainExpression" | "ConditionalExpression" | "IsExpression" | "ArrowFunctionExpression" }>): string {
    switch (expression.kind) {
      case "UnaryExpression":
        if (expression.operator === "await") {
          return `await ${this.host.emitMappedExpression(expression.operand)}`;
        }
        if (expression.operator === "~") {
          this.host.needsBitwiseHelpers = true;
          return `__velarBitwiseUnary(${this.host.emitMappedExpression(expression.operand)})`;
        }
        return expression.operator === "not"
          ? `!(${this.host.emitCondition(expression.operand)})`
          : `${expression.operator}(${this.host.emitMappedExpression(expression.operand)})`;
      case "BinaryExpression": {
        if (expression.operator === "and" || expression.operator === "or") {
          const operator = expression.operator === "and" ? "&&" : "||";
          return `(${this.host.emitCondition(expression.left)} ${operator} ${this.host.emitCondition(expression.right)})`;
        }
        if (expression.operator === "in" || expression.operator === "not in") {
          this.host.needsCollectionHelpers = true;
          const kind = this.host.hints.collectionMemberships.get(spanIdentity(expression.span));
          const left = this.host.emitMappedExpression(expression.left);
          const right = this.host.emitMappedExpression(expression.right);
          const helper = kind === "list" ? "__velarListContains"
            : kind === "map" ? "__velarMapContains"
              : kind === "set" ? "__velarSetContains"
                : kind === "record" ? "__velarRecordContains"
                  : null;
          const membership = helper ? `${helper}(${left}, ${right})` : `__velarContains(${left}, ${right})`;
          return expression.operator === "not in" ? `!(${membership})` : membership;
        }
        if (["&", "|", "^", "<<", ">>", ">>>"].includes(expression.operator)) {
          this.host.needsBitwiseHelpers = true;
          return `__velarBitwiseBinary(${this.host.emitMappedExpression(expression.left)}, ${JSON.stringify(expression.operator)}, ${this.host.emitMappedExpression(expression.right)})`;
        }
        // D36 item 41: `==`/`!=` are SameValueZero. The analyzer proves which
        // comparisons can actually meet two NaN operands; everything else
        // elides the repair and stays plain strict equality.
        if ((expression.operator === "==" || expression.operator === "!=")
          && this.host.hints.sameValueZeroEqualities.has(spanIdentity(expression.span))) {
          this.host.needsCollectionHelpers = true;
          const equality = `__velarSameValueZero(${this.emitBinaryOperand(expression.left)}, ${this.emitBinaryOperand(expression.right)})`;
          return expression.operator === "==" ? equality : `!${equality}`;
        }
        // TXT-D1: string orderings compare by code point everywhere; the
        // analyzer marks exactly the ordered comparisons whose operands are
        // strings, so numbers keep the plain operator.
        if (["<", "<=", ">", ">="].includes(expression.operator)
          && this.host.hints.stringOrderings.has(spanIdentity(expression.span))) {
          this.host.needsPrimitiveHelpers = true;
          return `(__velarStringCompare(${this.emitBinaryOperand(expression.left)}, ${this.emitBinaryOperand(expression.right)}) ${expression.operator} 0)`;
        }
        // D41 item 61: a comparison between Comparable-bounded parameters
        // dispatches on the runtime category instead of guessing one.
        if (["<", "<=", ">", ">="].includes(expression.operator)
          && this.host.hints.dynamicOrderings.has(spanIdentity(expression.span))) {
          this.host.needsPrimitiveHelpers = true;
          return `(__velarOrderCompare(${this.emitBinaryOperand(expression.left)}, ${this.emitBinaryOperand(expression.right)}) ${expression.operator} 0)`;
        }
        const operator = expression.operator === "==" ? "===" : expression.operator === "!=" ? "!==" : expression.operator;
        const left = expression.operator === "**" && expression.left.kind === "UnaryExpression"
          ? `(${this.host.emitMappedExpression(expression.left)})`
          : this.emitBinaryOperand(expression.left);
        return `(${left} ${operator} ${this.emitBinaryOperand(expression.right)})`;
      }
      case "ComparisonChainExpression":
        return this.emitComparisonChain(expression);
      case "ConditionalExpression":
        return `(${this.host.emitCondition(expression.condition)} ? ${this.host.emitMappedExpression(expression.thenValue)} : ${this.host.emitMappedExpression(expression.elseValue)})`;
      case "IsExpression":
        {
          const value = `__velarIs${expression.span.start}`;
          const checked = resolveTypeReference(expression.type);
          const classCheck = this.host.hints.classChecks.has(spanIdentity(expression.span));
          const test = classCheck
            ? `${value} instanceof ${this.typeRuntimeName(expression.type)}`
            : this.host.emitIsCheck(checked, value);
          const emittedValue = this.host.emitMappedExpression(expression.value);
          // Keep the common one-read checks direct. Union, optional, and
          // structural checks that reference the value more than once capture
          // it first so an arbitrary source expression still runs exactly once.
          const uses = test.split(value).length - 1;
          // GRM-D1: a nested `is` (or unary) operand spliced into the direct
          // check would rebind under the generated operator — `typeof typeof
          // x` — so those operands keep explicit parentheses.
          const operand = expression.value.kind === "IsExpression" || expression.value.kind === "UnaryExpression"
            ? `(${emittedValue})`
            : emittedValue;
          const result = uses === 1
            ? classCheck
              ? `${operand} instanceof ${this.typeRuntimeName(expression.type)}`
              : this.host.emitIsCheck(checked, operand)
            : `(${value} => ${test})(${emittedValue})`;
          return expression.operator === "is not" ? `!(${result})` : result;
        }
      case "ArrowFunctionExpression": {
        const body = this.host.emitMappedExpression(expression.body);
        const resolvedBody = this.host.hints.asyncResolvedValues.has(spanIdentity(expression.body.span)) ? `__velarAsyncResolvedValue(${body})` : body;
        const emittedBody = expression.body.kind === "ObjectExpression" ? `(${resolvedBody})` : resolvedBody;
        return `${expression.asynchronous ? "async " : ""}${expression.parameters.length === 1 && !expression.parameters[0]!.rest && !expression.parameters[0]!.defaultValue
          ? expression.parameters[0]!.name
          : `(${expression.parameters.map((parameter) => this.host.emitParameter(parameter.name, parameter.defaultValue, parameter.rest)).join(", ")})`} => ${emittedBody}`;
      }
    }
  }

  /**
   * A call. What it lowers to is decided by what the callee is: a construction,
   * an intrinsic, a collection or primitive member, an extern JavaScript value,
   * or an ordinary function, plus the named-argument reordering all of them
   * share.
   */
  private emitCallExpression(expression: Extract<Expression, { kind: "CallExpression" }>): string {
    switch (expression.kind) {
      case "CallExpression": {
        const recordProjection = this.emitRecordProjectionCall(expression);
        if (recordProjection !== null) return recordProjection;
        const memberCall = this.emitMemberCall(expression);
        if (memberCall !== null) return memberCall;
        const hostBoundary = this.host.hints.javaScriptCallBoundaries.has(spanIdentity(expression.span));
        const sourceArguments = expression.arguments.map((argument) => {
          const emitted = this.host.emitMappedExpression(argument);
          return hostBoundary && argument.kind !== "SpreadExpression" ? `__velarHostRaw(${emitted})` : emitted;
        });
        const namedOrder = this.host.hints.namedArgumentOrders.get(spanIdentity(expression.span));
        const arguments_ = namedOrder
          ? namedOrder.map((source) => source === -1 ? "undefined" : `__velarNamedArguments[${source}]`)
          : sourceArguments;
        const emitArguments = (): string => namedOrder
          ? `...((__velarNamedArguments) => [${arguments_.join(", ")}])([${sourceArguments.join(", ")}])`
          : arguments_.join(", ");
        if (this.host.hints.optionalCallees.has(spanIdentity(expression.span))) {
          const call = expression.callee.kind === "MemberExpression"
            ? `${this.emitPostfixReceiver(expression.callee.object)}${expression.callee.optional ? "?." : "."}${expression.callee.property}?.(${emitArguments()})`
            : `${this.emitPostfixReceiver(expression.callee)}?.(${emitArguments()})`;
          return `(${call} ?? null)`;
        }
        if (expression.callee.kind === "MemberExpression" && expression.callee.optional) {
          const call = `${this.emitPostfixReceiver(expression.callee.object)}?.${expression.callee.property}(${emitArguments()})`;
          return `(${call} ?? null)`;
        }
        let callee: string;
        if (expression.callee.kind === "IdentifierExpression" && (expression.callee.name === "Map" || expression.callee.name === "Set")) {
          this.host.needsCollectionHelpers = true;
          callee = expression.callee.name === "Map" ? "__velarCreateMap" : "__velarCreateSet";
        } else if (expression.callee.kind === "IdentifierExpression" && this.host.hints.equalsCalls.has(spanIdentity(expression.span))) {
          this.host.needsCollectionHelpers = true;
          callee = "__velarEquals";
        } else {
          if (this.host.hints.constructorCalls.has(spanIdentity(expression.span))) {
            // A callee that is not a plain name path may be wrapped (for
            // example by a narrowing recheck IIFE), and `new (arrow)(x)(args)`
            // binds `(x)` as the construction arguments — the wrapper, not
            // the class, gets constructed. Parentheses restore the callee
            // boundary; plain name paths skip them to keep output readable.
            // Source-map markers are invisible in final output and ignored.
            const constructed = this.host.emitMappedExpression(expression.callee);
            callee = /^[A-Za-z_$][A-Za-z0-9_$]*(?:\.[A-Za-z0-9_$]+)*$/u.test(constructed.replaceAll(javaScriptNodeMarker, ""))
              ? `new ${constructed}`
              : `new (${constructed})`;
          } else {
            callee = this.emitPostfixReceiver(expression.callee);
          }
        }
        const formRead = this.host.hints.formReads.get(spanIdentity(expression.span));
        if (formRead) arguments_.push(JSON.stringify(formRead));
        const call = `${callee}(${emitArguments()})`;
        const result = this.host.hints.optionalCalls.has(spanIdentity(expression.span)) ? `(${call} ?? null)` : call;
        // BRG-U10: a synchronous non-Error throw from an extern call during
        // module initialization would reach the host raw (no catch, no
        // rejection path); rethrowing through the owned normalization keeps
        // the last bridge failure shape on the Error channel. Calls whose
        // arguments await are already rejection-owned and stay unwrapped.
        if (hostBoundary
          && this.host.hints.moduleTopLevelHostCalls.has(spanIdentity(expression.span))
          && !this.host.expressionContainsDirectAwait(expression)) {
          this.host.needsThrownValueHelper = true;
          return `(() => { try { return ${result}; } catch (__velarThrown) { throw __velarNormalizeError(__velarThrown); } })()`;
        }
        return result;
      }
    }
  }

  /**
   * Reading a member or an index off a value, with the guard each receiver kind
   * needs — an optional chain, a static or private field, a collection or
   * binary index.
   */
  private emitAccessExpression(expression: Extract<Expression, { kind: "MemberExpression" | "IndexExpression" }>): string {
    switch (expression.kind) {
      case "MemberExpression": {
        const loweredRead = this.emitLoweredMemberRead(expression);
        if (loweredRead !== null) return loweredRead;
        const staticFieldOwnerDepth = this.host.hints.staticFieldReads.get(spanIdentity(expression.span));
        if (staticFieldOwnerDepth !== undefined) {
          const object = this.host.emitMappedExpression(expression.object);
          const read = `__velarReadStaticField(__velarValue, ${JSON.stringify(expression.property)}, ${staticFieldOwnerDepth})`;
          return expression.optional
            ? `(__velarValue => __velarValue == null ? null : ${read})(${object})`
            : `__velarReadStaticField(${object}, ${JSON.stringify(expression.property)}, ${staticFieldOwnerDepth})`;
        }
        if (this.host.hints.errorCodeReads.has(spanIdentity(expression.span))) {
          this.host.needsErrorCodeHelper = true;
          const object = this.host.emitMappedExpression(expression.object);
          return expression.optional
            ? `($velarValue => $velarValue == null ? null : __velarErrorCode($velarValue))(${object})`
            : `__velarErrorCode(${object})`;
        }
        if (this.host.hints.instanceFieldReads.has(spanIdentity(expression.span))) {
          const object = this.host.emitMappedExpression(expression.object);
          const read = `__velarReadInstanceField(__velarValue, ${JSON.stringify(expression.property)})`;
          return expression.optional
            ? `(__velarValue => __velarValue == null ? null : ${read})(${object})`
            : `__velarReadInstanceField(${object}, ${JSON.stringify(expression.property)})`;
        }
        if (this.host.hints.privateInstanceFieldReads.has(spanIdentity(expression.span))) {
          if (expression.optional) {
            const object = this.host.emitMappedExpression(expression.object);
            const read = `__velarReadPrivateField(__velarValue.#${expression.property}, ${JSON.stringify(expression.property)})`;
            return `(__velarValue => __velarValue == null ? null : ${read})(${object})`;
          }
          return `__velarReadPrivateField(${this.emitPostfixReceiver(expression.object)}.#${expression.property}, ${JSON.stringify(expression.property)})`;
        }
        if (this.host.hints.classMethodReferences.has(spanIdentity(expression.span))) {
          // Methods live on the prototype, so a method read as a value
          // evaluates its receiver once and binds at the reference site —
          // the collection-method rule of charter section 8. `super` cannot
          // be captured by a temporary; it binds `this` directly.
          const property = `${this.host.hints.privateMembers.has(spanIdentity(expression.span)) ? "#" : ""}${expression.property}`;
          if (expression.object.kind === "SuperExpression") {
            return `super.${property}.bind(this)`;
          }
          const object = this.host.emitMappedExpression(expression.object);
          const bound = `__velarValue.${property}.bind(__velarValue)`;
          return expression.optional
            ? `(__velarValue => __velarValue == null ? null : ${bound})(${object})`
            : `(__velarValue => ${bound})(${object})`;
        }
        const publicProperty = expression.property;
        const property = `${this.host.hints.privateMembers.has(spanIdentity(expression.span)) ? "#" : ""}${publicProperty}`;
        const access = `${this.emitPostfixReceiver(expression.object)}${expression.optional ? "?." : "."}${property}`;
        return this.host.hints.optionalMembers.has(spanIdentity(expression.span)) ? `(${access} ?? null)` : access;
      }
      case "IndexExpression":
        {
          const binaryKind = this.host.hints.binaryIndexes.get(spanIdentity(expression.span));
          if (binaryKind) {
            this.host.needsBinaryHelpers = true;
            const helper = this.host.binaryIndexHelper(binaryKind);
            const object = this.host.emitMappedExpression(expression.object);
            if (this.host.hints.optionalIndexes.has(spanIdentity(expression.span))) {
              return `(__velarValue => __velarValue == null ? null : __velarBinaryRuntime.${helper}(__velarValue, ${this.host.emitMappedExpression(expression.index)}))(${object})`;
            }
            return `__velarBinaryRuntime.${helper}(${object}, ${this.host.emitMappedExpression(expression.index)})`;
          }
          const collectionKind = this.host.hints.collectionIndexes.get(spanIdentity(expression.span));
          if (collectionKind) {
            this.host.needsIndexHelpers = true;
            this.host.needsCollectionHelpers = true;
            const helper = collectionKind === "list" ? "__velarListIndexGet" : "__velarRecordIndexGet";
            const object = this.host.emitMappedExpression(expression.object);
            if (this.host.hints.optionalIndexes.has(spanIdentity(expression.span))) {
              return `(__velarValue => __velarValue == null ? null : ${helper}(__velarValue, ${this.host.emitMappedExpression(expression.index)}))(${object})`;
            }
            return `${helper}(${object}, ${this.host.emitMappedExpression(expression.index)})`;
          }
        }
        this.host.needsIndexHelpers = true;
        this.host.needsCollectionHelpers = true;
        return this.host.hints.optionalIndexes.has(spanIdentity(expression.span))
          ? `__velarOptionalIndex(${this.host.emitMappedExpression(expression.object)}, () => ${this.host.emitMappedExpression(expression.index)})`
          : `__velarIndex(${this.host.emitMappedExpression(expression.object)}, ${this.host.emitMappedExpression(expression.index)})`;
    }
  }

  /**
   * A member access the analyzer proved is a lowered read rather than a
   * property: a binary or collection size, or a member that is really a
   * runtime operation and is therefore reached through its helper. `null`
   * when the access is an ordinary property read.
   */
  private emitLoweredMemberRead(expression: Extract<Expression, { kind: "MemberExpression" }>): string | null {
const binaryHelper = this.host.binaryHelper(expression);
if (binaryHelper) {
  this.host.needsBinaryHelpers = true;
  const object = this.host.emitMappedExpression(expression.object);
  const bound = `(...__velarArguments) => ${binaryHelper}(__velarValue, ...__velarArguments)`;
  return expression.optional
    ? `(__velarValue => __velarValue == null ? null : ${bound})(${object})`
    : `(__velarValue => ${bound})(${object})`;
}
if (this.host.hints.binarySizes.has(expression.span.end)) {
  this.host.needsBinaryHelpers = true;
  const object = this.host.emitMappedExpression(expression.object);
  return expression.optional
    ? `(__velarValue => __velarValue == null ? null : __velarBinaryRuntime.__velarSize(__velarValue))(${object})`
    : `__velarBinaryRuntime.__velarSize(${object})`;
}
const primitiveHelper = this.host.primitiveHelper(expression);
if (primitiveHelper) {
  this.host.needsPrimitiveHelpers = true;
  const object = this.host.emitMappedExpression(expression.object);
  const bound = `(...__velarArguments) => ${primitiveHelper}(__velarValue, ...__velarArguments)`;
  return expression.optional
    ? `(__velarValue => __velarValue == null ? null : ${bound})(${object})`
    : `(__velarValue => ${bound})(${object})`;
}
if (this.host.hints.stringSizes.has(expression.span.end)) {
  this.host.needsPrimitiveHelpers = true;
  const object = this.host.emitMappedExpression(expression.object);
  return expression.optional
    ? `(__velarValue => __velarValue == null ? null : __velarStringSize(__velarValue))(${object})`
    : `__velarStringSize(${object})`;
}
const collectionHelper = this.host.collectionHelper(expression);
if (collectionHelper) {
  this.host.needsCollectionHelpers = true;
  const object = this.host.emitMappedExpression(expression.object);
  const bound = `(...__velarArguments) => ${collectionHelper}(__velarValue, ...__velarArguments)`;
  return expression.optional
    ? `(__velarValue => __velarValue == null ? null : ${bound})(${object})`
    : `(__velarValue => ${bound})(${object})`;
}
const collectionSizeKind = this.host.hints.collectionSizes.get(expression.span.end);
if (collectionSizeKind) {
  this.host.needsCollectionHelpers = true;
  const object = this.host.emitMappedExpression(expression.object);
  const helper = this.host.collectionSizeHelper(collectionSizeKind);
  return expression.optional
    ? `(__velarOptionalCollection(${object}, ${helper}) ?? null)`
    : `${helper}(${object})`;
}
    return null;
  }

  /**
   * `Target.from(source, {overrides})` and `Target.mapFrom(source, transform)`:
   * the two exact record projections the analyzer proved, lowered to the field
   * list it recorded. `null` when this call is neither.
   */
  private emitRecordProjectionCall(expression: Extract<Expression, { kind: "CallExpression" }>): string | null {
const recordFrom = this.host.hints.recordFromCalls.get(spanIdentity(expression.span));
if (recordFrom) {
  this.host.needsCollectionHelpers = true;
  this.host.needsRecordHelpers = true;
  const sourceArguments = expression.arguments.map((argument) => this.host.emitMappedExpression(argument));
  const namedOrder = this.host.hints.namedArgumentOrders.get(spanIdentity(expression.span));
  if (namedOrder) {
    const source = namedOrder[0] === undefined || namedOrder[0] === -1
      ? "undefined"
      : `__velarNamedArguments[${namedOrder[0]}]`;
    const overrides = namedOrder[1] === undefined || namedOrder[1] === -1
      ? "null"
      : `__velarNamedArguments[${namedOrder[1]}]`;
    return `((__velarNamedArguments) => __velarRecordFrom(${source}, ${overrides}, ${JSON.stringify(recordFrom.fields.map((field) => [field.name, field.optional]))}, ${JSON.stringify(recordFrom.target)}))([${sourceArguments.join(", ")}])`;
  }
  return `__velarRecordFrom(${sourceArguments[0]}, ${sourceArguments[1] ?? "null"}, ${JSON.stringify(recordFrom.fields.map((field) => [field.name, field.optional]))}, ${JSON.stringify(recordFrom.target)})`;
}
const recordMapFrom = this.host.hints.recordMapFromCalls.get(spanIdentity(expression.span));
if (recordMapFrom) {
  this.host.needsCollectionHelpers = true;
  this.host.needsRecordHelpers = true;
  const sourceArguments = expression.arguments.map((argument) => this.host.emitMappedExpression(argument));
  const namedOrder = this.host.hints.namedArgumentOrders.get(spanIdentity(expression.span));
  if (namedOrder) {
    const source = namedOrder[0] === undefined || namedOrder[0] === -1
      ? "undefined"
      : `__velarNamedArguments[${namedOrder[0]}]`;
    const transform = namedOrder[1] === undefined || namedOrder[1] === -1
      ? "undefined"
      : `__velarNamedArguments[${namedOrder[1]}]`;
    return `((__velarNamedArguments) => __velarRecordMapFrom(${source}, ${transform}, ${JSON.stringify(recordMapFrom.fields.map((field) => [field.name, field.optional]))}, ${JSON.stringify(recordMapFrom.target)}))([${sourceArguments.join(", ")}])`;
  }
  return `__velarRecordMapFrom(${sourceArguments[0]}, ${sourceArguments[1]}, ${JSON.stringify(recordMapFrom.fields.map((field) => [field.name, field.optional]))}, ${JSON.stringify(recordMapFrom.target)})`;
}
    return null;
  }

  /**
   * A call whose callee is a member access, when the analyzer proved the
   * member is a collection, binary or primitive operation: the call lowers to
   * that runtime helper with the receiver as its first argument. `null` when
   * the member is an ordinary method and the call is an ordinary call.
   */
  private emitMemberCall(expression: Extract<Expression, { kind: "CallExpression" }>): string | null {
    if (expression.callee.kind !== "MemberExpression") return null;
  const binaryHelper = this.host.binaryHelper(expression.callee);
  if (binaryHelper) {
    this.host.needsBinaryHelpers = true;
    const object = this.host.emitMappedExpression(expression.callee.object);
    const sourceArguments = expression.arguments.map((argument) => this.host.emitMappedExpression(argument));
    const namedOrder = this.host.hints.namedArgumentOrders.get(spanIdentity(expression.span));
    const arguments_ = namedOrder
      ? namedOrder.map((source) => source === -1 ? "undefined" : `__velarNamedArguments[${source}]`)
      : sourceArguments;
    const emittedArguments = namedOrder
      ? `...((__velarNamedArguments) => [${arguments_.join(", ")}])([${sourceArguments.join(", ")}])`
      : arguments_.join(", ");
    const suffix = arguments_.length > 0 ? `, ${emittedArguments}` : "";
    const invocation = `${binaryHelper}(__velarValue${suffix})`;
    return this.host.hints.optionalCallees.has(spanIdentity(expression.span))
      ? `(__velarValue => __velarValue == null ? null : ${invocation})(${object})`
      : `${binaryHelper}(${object}${suffix})`;
  }
  const primitiveHelper = this.host.primitiveHelper(expression.callee);
  if (primitiveHelper) {
    this.host.needsPrimitiveHelpers = true;
    const object = this.host.emitMappedExpression(expression.callee.object);
    const sourceArguments = expression.arguments.map((argument) => this.host.emitMappedExpression(argument));
    const namedOrder = this.host.hints.namedArgumentOrders.get(spanIdentity(expression.span));
    const arguments_ = namedOrder
      ? namedOrder.map((source) => source === -1 ? "undefined" : `__velarNamedArguments[${source}]`)
      : sourceArguments;
    const emittedArguments = namedOrder
      ? `...((__velarNamedArguments) => [${arguments_.join(", ")}])([${sourceArguments.join(", ")}])`
      : arguments_.join(", ");
    const suffix = arguments_.length > 0 ? `, ${emittedArguments}` : "";
    const invocation = `${primitiveHelper}(__velarValue${suffix})`;
    return this.host.hints.optionalCallees.has(spanIdentity(expression.span))
      ? `(__velarValue => __velarValue == null ? null : ${invocation})(${object})`
      : `${primitiveHelper}(${object}${suffix})`;
  }
  const helper = this.host.collectionHelper(expression.callee);
  if (helper) {
    this.host.needsCollectionHelpers = true;
    const object = this.host.emitMappedExpression(expression.callee.object);
    const sourceArguments = expression.arguments.map((argument) => this.host.emitMappedExpression(argument));
    const namedOrder = this.host.hints.namedArgumentOrders.get(spanIdentity(expression.span));
    const arguments_ = namedOrder
      ? namedOrder.map((source) => source === -1 ? "undefined" : `__velarNamedArguments[${source}]`)
      : sourceArguments;
    const emitArguments = (): string => namedOrder
      ? `...((__velarNamedArguments) => [${arguments_.join(", ")}])([${sourceArguments.join(", ")}])`
      : arguments_.join(", ");
    const suffix = arguments_.length > 0 ? `, ${emitArguments()}` : "";
    if (this.host.hints.optionalCallees.has(spanIdentity(expression.span))) {
      const invocation = `${helper}(__velarValue${suffix})`;
      return `(__velarOptionalCollection(${object}, __velarValue => ${invocation}) ?? null)`;
    }
    return `${helper}(${object}${suffix})`;
  }
    return null;
  }

  private emitBinaryOperand(expression: Expression): string {
    const emitted = this.host.emitMappedExpression(expression);
    return expression.kind === "ArrowFunctionExpression" ? `(${emitted})` : emitted;
  }

  emitPostfixReceiver(expression: Expression): string {
    const emitted = this.host.emitMappedExpression(expression);
    if (expression.kind === "ArrowFunctionExpression"
      || expression.kind === "UnaryExpression"
      || expression.kind === "IsExpression"
      || (expression.kind === "LiteralExpression" && typeof expression.value === "number")) {
      return `(${emitted})`;
    }
    return emitted;
  }

  private emitComparisonChain(expression: Extract<Expression, { kind: "ComparisonChainExpression" }>): string {
    const prefix = `__velarCompare${expression.span.start}`;
    const body = [`const ${prefix}_0 = ${this.host.emitMappedExpression(expression.operands[0]!)};`];
    for (let index = 1; index < expression.operands.length; index += 1) {
      body.push(`const ${prefix}_${index} = ${this.host.emitMappedExpression(expression.operands[index]!)};`);
      const sourceOperator = expression.operators[index - 1]!;
      const linkSpan = spanIdentity({
        start: expression.operands[index - 1]!.span.start,
        end: expression.operands[index]!.span.end,
      });
      if ((sourceOperator === "==" || sourceOperator === "!=") && this.host.hints.sameValueZeroEqualities.has(linkSpan)) {
        // Chain operands are already captured once, so the SameValueZero
        // repair inlines as its short-circuit shape (D36 item 41).
        const left = `${prefix}_${index - 1}`;
        const right = `${prefix}_${index}`;
        const equality = `${left} === ${right} || (${left} !== ${left} && ${right} !== ${right})`;
        body.push(sourceOperator === "=="
          ? `if (!(${equality})) return false;`
          : `if (${equality}) return false;`);
        continue;
      }
      // TXT-D1: string chain links compare by code point too.
      if (["<", "<=", ">", ">="].includes(sourceOperator) && this.host.hints.stringOrderings.has(linkSpan)) {
        this.host.needsPrimitiveHelpers = true;
        body.push(`if (!(__velarStringCompare(${prefix}_${index - 1}, ${prefix}_${index}) ${sourceOperator} 0)) return false;`);
        continue;
      }
      if (["<", "<=", ">", ">="].includes(sourceOperator) && this.host.hints.dynamicOrderings.has(linkSpan)) {
        this.host.needsPrimitiveHelpers = true;
        body.push(`if (!(__velarOrderCompare(${prefix}_${index - 1}, ${prefix}_${index}) ${sourceOperator} 0)) return false;`);
        continue;
      }
      const operator = sourceOperator === "==" ? "===" : sourceOperator === "!=" ? "!==" : sourceOperator;
      body.push(`if (!(${prefix}_${index - 1} ${operator} ${prefix}_${index})) return false;`);
    }
    const asynchronous = expression.operands.some((operand) => this.host.expressionContainsDirectAwait(operand));
    return `${asynchronous ? "await " : ""}(${asynchronous ? "async " : ""}() => { ${body.join(" ")} return true; })()`;
  }

  private escapeTemplateText(value: string): string {
    return value.replaceAll("\\", "\\\\").replaceAll("\r", "\\r").replaceAll("`", "\\`").replaceAll("${", "\\${")
      // `\u{0}` is a sanctioned source spelling, so a C0 control reaches here
      // as a raw byte. U+0000 delimits this emitter's own source-map markers
      // (see `javaScriptNodeMarker`), so author text could otherwise spell a
      // marker the renderer would delete out of the program. Every C0 control
      // leaves as an escape sequence instead of a byte, which no scan of the
      // generated text can mistake for emitter metadata.
      .replaceAll(/[\u0000-\u001F]/gu, (control) => `\\u${control.codePointAt(0)!.toString(16).padStart(4, "0")}`);
  }

  private typeRuntimeName(reference: TypeReference): string {
    const type = resolveTypeReference(reference);
    if (type.kind === "named") return this.host.builtinErrorRuntimeName(type.name) ?? type.name;
    return formatTypeReference(reference);
  }
}
