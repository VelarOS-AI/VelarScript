/**
 * What the Web extension adds to expression inference, either side of the core
 * walk: the shapes it refuses before the core sees them, the answers it has
 * already computed and hands back instead of walking again, the Look length a
 * builder call folds to, and the two reports a call earns once its type is
 * known. The extension's own call and type-syntax rules — a component element
 * called like a function, and `Component<Props, Handle>` — are here too.
 *
 * D115 P4 R3c. The dispatch itself stays on the analyzer: `inferExpression` and
 * `inferExtensionExpression` are seams the core owns, and what they hand to the
 * JSX, keyframes and Look walks is the one thing that is genuinely a dispatch.
 * Everything on either side of it is a rule, and rules live here.
 */
import { type Span } from "@velarscript/compiler";
import {
  boolType,
  describeType,
  expressionContainsDirectAwait,
  invalidType,
  spanIdentity,
  unknownType,
  type Expression,
  type ExtensionValueType,
  type TypeReference,
  type TypeSyntax,
  type ValueType,
} from "@velarscript/compiler/extension";
import { isWebExpression, isWebJsx, isWebUnit } from "../ast.ts";
import { LOOK_ARITHMETIC_HINT, LOOK_UNIT_TYPES } from "../look.ts";
import { isWebComponentType, isWebNodeType, webComponentName, webNodeType } from "../types.ts";
import { componentCallRefusal } from "./component-guidance.ts";
import { checkLookBuilderCall } from "./look/builders.ts";
import { type LookAnalysisHost } from "./look/host.ts";
import { foldedLengthPercentage, isLookNumericType } from "./look-values.ts";
import { lookJoin, lookLiteralZero } from "./look-sites.ts";
import { lookSourceOf } from "./media-conditions.ts";
import { publicConfigDiagnostic } from "./public-config.ts";
import { calledComputedBinding } from "./reactivity/derived.ts";
import { type ReactiveNamesHost } from "./reactivity/host.ts";
import { recordRetiredAccessorRead, RETIRED_ACCESSOR_TYPE, type RetiredAccessorHost } from "./reactivity/retired-accessors.ts";
import { diagnostic, webEventDeadFields, webEventTypeNames } from "./web-types.ts";

/** The state the inference rules own: the probe cache, and the two module inputs a call is proved against. */
export interface ExpressionInferenceHost {
  constantValue(expression: Expression): string | number | boolean | null | undefined;
  importedMemberOf(name: string): { readonly source: string; readonly imported: string | null } | null;
  resolvedCallArgument(expression: Extract<Expression, { kind: "CallExpression" }>, index: number): Expression | null;
  /** The Look-arithmetic hints this walk records for the emitter, keyed by expression span. */
  readonly extensionCalls: Map<string, string>;
  /**
   * Operands probed for Look arithmetic. The core analyzer re-requests one
   * immediately after the probe declines, so the answer is parked here and
   * consumed once — that is what keeps operand analysis single-run and operand
   * diagnostics unrepeated.
   */
  readonly probedOperandTypes: Map<string, ValueType>;
  /** The names this module declares as public configuration, from the program's own reading. Replaced per program. */
  readonly publicConfigNames: ReadonlySet<string>;
  /** D114 0.29.0 LC-D1: the manifest's `web.publicConfig`, or null when this compile read no project manifest. */
  readonly webPublicConfig: Readonly<Record<string, unknown>> | null;
  /** The module's source, which is what a component-call refusal quotes the arguments out of. */
  readonly webSourceText: string;

  fieldsOf(identity: string): ReadonlyMap<string, ValueType> | null;
  typeError(message: string, errorSpan: Span): void;
}

/**
 * The one face the inference rules read. It is an intersection because the
 * rules on either side of the core walk really do reach three other groups: a
 * call is checked as a Look builder call, a zero-argument call of a derived
 * name is refused, and an identifier read is recorded for the D71 migration.
 */
export type InferenceHost = ExpressionInferenceHost & LookAnalysisHost & ReactiveNamesHost & RetiredAccessorHost;

/**
 * The Web shapes refused before the core analyzer sees the expression, in the
 * order they are asked. `undefined` means nothing here claimed the expression
 * and the extension dispatch continues.
 */
export function webExpressionShapeRefusals(host: InferenceHost, expression: Expression): ValueType | undefined {
  if (expression.kind === "CallExpression" && expression.callee.kind === "IdentifierExpression"
    && expression.callee.name === "mount") {
    const namedNode = expression.argumentNames?.findIndex((name) => name === "node") ?? -1;
    const node = expression.arguments[namedNode >= 0 ? namedNode : 0];
    if (node && expressionContainsDirectAwait(node, (value) => value.kind === "ExtensionExpression:web:jsx" ? false : undefined)) {
      host.diagnostics.push(diagnostic(
        "VEL4007",
        "mount constructs its root synchronously; await the root in a separate module binding before calling mount",
        node.span,
      ));
    }
  }
  if (expression.kind === "UnaryExpression" && (expression.operator === "+" || expression.operator === "-")) {
    const operand = host.inferExpression(expression.operand);
    if (isLookNumericType(operand)) {
      host.extensionCalls.set(spanIdentity(expression.span), LOOK_ARITHMETIC_HINT);
      return operand;
    }
    host.probedOperandTypes.set(spanIdentity(expression.operand.span), operand);
  }
  // WEB-U15 / GRM-A3: '&&' rendering is the React habit. The lexer now starts
  // JSX after 'and'/'or' so the shape parses and this rejection names the
  // conditional-rendering spelling instead of leaking a bool type error.
  if (expression.kind === "BinaryExpression" && (expression.operator === "and" || expression.operator === "or")
    && (isWebJsx(expression.left) || isWebJsx(expression.right))) {
    const rightIsElement = isWebJsx(expression.right);
    const tag = rightIsElement ? expression.right.tag : isWebJsx(expression.left) ? expression.left.tag : "";
    const condition = lookSourceOf(rightIsElement ? expression.left : expression.right);
    host.inferExpression(expression.left);
    host.inferExpression(expression.right);
    host.diagnostics.push(diagnostic(
      "VEL5029",
      `'${expression.operator}' combines bool values and cannot yield an element; render conditionally with '{${condition} ? <${tag || ">"} ... : null}'`,
      expression.span,
    ));
    return invalidType;
  }
  if (expression.kind === "BinaryExpression" && ["+", "-", "*", "/"].includes(expression.operator)) {
    const left = host.inferExpression(expression.left);
    const right = host.inferExpression(expression.right);
    if (!isLookNumericType(left) && !isLookNumericType(right)) {
      host.probedOperandTypes.set(spanIdentity(expression.left.span), left);
      host.probedOperandTypes.set(spanIdentity(expression.right.span), right);
    } else {
      const additive = expression.operator === "+" || expression.operator === "-" ? lookJoin(left, right) : null;
      const result = additive
        ?? ((expression.operator === "*" || expression.operator === "/") && isLookNumericType(left) && right.kind === "number" ? left : null)
        ?? (expression.operator === "*" && left.kind === "number" && isLookNumericType(right) ? right : null);
      if (result) {
        // LOK-U8: dividing a visual value by a literal zero produces a
        // non-finite length that the runtime rejects on first construction.
        if (expression.operator === "/" && lookLiteralZero(expression.right)) {
          host.diagnostics.push(diagnostic("VEL5042", "Look unit arithmetic cannot divide by zero", expression.span));
          return invalidType;
        }
        host.extensionCalls.set(spanIdentity(expression.span), LOOK_ARITHMETIC_HINT);
        return result;
      }
      // The rejection is final: returning the invalid type keeps the Look
      // property's own assignment error from co-reporting a union dump on the
      // very expression that was already named (LOK-I1).
      host.diagnostics.push(diagnostic("VEL5042", `Look unit arithmetic cannot apply '${expression.operator}' to ${describeType(left)} and ${describeType(right)}`, expression.span));
      return invalidType;
    }
  }
  // WEB-N2 / D47 rule 84: the event object is typed down to event semantics
  // and deliberately carries no target, so `event.target.value` is a dead end
  // that used to cascade into three unknown-access errors. The read is where
  // the author wanted two-way binding, so it names that spelling and stops.
  if (expression.kind === "MemberExpression" && !expression.optional && webEventDeadFields.has(expression.property)
    && expression.object.kind === "IdentifierExpression") {
    const binding = host.lookup(expression.object.name);
    const expanded = binding ? host.expandAliases(binding.type) : null;
    if (expanded?.kind === "named" && webEventTypeNames.has(expanded.name)) {
      host.diagnostics.push(diagnostic(
        "VEL5019",
        `A VelarScript event object carries typed event fields only and has no '${expression.property}': read the element's value through a two-way binding instead — 'bind:value={name}' binds a state name, and 'bind:value={form.field}' or 'bind:value={items[0]}' binds a writable path inside state`,
        expression.span,
      ));
      return invalidType;
    }
  }
  return undefined;
}

/** The two Web expressions that are a value rather than a walk: a misplaced Look hook, and a unit literal. */
export function webExtensionValueType(host: InferenceHost, expression: Expression): ValueType | undefined {
  if (isWebExpression(expression) && expression.kind === "ExtensionExpression:web:look-hook") {
    host.diagnostics.push(diagnostic("VEL5038", `Look hook '@${expression.name}' is only valid inside a Look condition`, expression.span));
    return boolType;
  }
  if (isWebUnit(expression)) {
    const type = LOOK_UNIT_TYPES.get(expression.unit);
    if (type) return { kind: "named", name: type };
    return unknownType;
  }
  return undefined;
}

/**
 * The answers the Web extension already holds for this expression, given back
 * instead of walking it a second time. Null means the core walk should run.
 */
export function answeredBeforeInference(host: InferenceHost, expression: Expression): ValueType | null {
  // Operands probed for Look arithmetic are re-requested by the core analyzer immediately after the
  // probe declines; reusing the probe result (consume-once) keeps operand analysis single-run so
  // operand diagnostics are not reported twice.
  const key = spanIdentity(expression.span);
  const probed = host.probedOperandTypes.get(key);
  if (probed !== undefined) {
    host.probedOperandTypes.delete(key);
    return probed;
  }
  if (expression.kind === "CallExpression" && expression.arguments.length === 0
    && expression.callee.kind === "IdentifierExpression") {
    host.plainCallSpans.set(spanIdentity(expression.callee.span), expression.span);
    const called = calledComputedBinding(host, expression);
    if (called) return called;
  }
  if (expression.kind === "IdentifierExpression") {
    const retired = recordRetiredAccessorRead(host, expression);
    // The retired name is answered here rather than left to fall through as an
    // unknown one: the author gets its migration and nothing else, and the
    // call around it still type-checks against the signature it always had.
    if (retired) return RETIRED_ACCESSOR_TYPE;
  }
  return null;
}

/** The compile-time Look length a builder call folds to, or null when the call is not one. */
export function foldedWebLength(host: InferenceHost, expression: Expression): ValueType | null {
  return expression.kind !== "CallExpression" ? null
    : foldedLengthPercentage(expression, (name) => host.lookBuilderNames.get(name), (argument) => probedSlotType(host, argument), lookJoin);
}

/** Infers one builder slot and parks the answer in the probe cache, so the call's own analysis reads it back. */
export function probedSlotType(host: InferenceHost, argument: Expression): ValueType {
  const inferred = host.inferExpression(argument);
  host.probedOperandTypes.set(spanIdentity(argument.span), inferred);
  return host.expandAliases(inferred);
}

/** The two reports a call earns once the core walk has answered its type. */
export function reportInferredWebCall(host: InferenceHost, expression: Expression, result: ValueType): void {
  if (expression.kind !== "CallExpression") return;
  checkLookBuilderCall(host, expression);
  checkDomIdPrefix(host, expression);
  // D114 0.29.0 LC-D1: the manifest this build bakes in, proved against the declared type.
  const report = publicConfigDiagnostic(expression, result, host.publicConfigNames, host.webPublicConfig,
    { expandAliases: (type) => host.expandAliases(type), fieldsOf: (identity) => host.fieldsOf(identity), describeType });
  if (report) host.diagnostics.push(report);
}

/** A target-owned contract consuming Core's lexical scalar facts. */
function checkDomIdPrefix(host: InferenceHost, expression: Extract<Expression, { kind: "CallExpression" }>): void {
  if (expression.callee.kind !== "IdentifierExpression") return;
  const origin = host.importedMemberOf(expression.callee.name);
  if (origin?.source !== "velar/web" || origin.imported !== "domId") return;
  const argument = host.resolvedCallArgument(expression, 0);
  if (!argument) return;
  const prefix = host.constantValue(argument);
  if (typeof prefix !== "string") return;
  const message = prefix.length > 64 ? "DOM ID prefixes cannot exceed 64 characters"
    : !/^[A-Za-z][A-Za-z0-9_-]*$/u.test(prefix)
    ? "DOM ID prefixes must start with a letter and contain only letters, numbers, underscores, or hyphens"
    : null;
  if (message) host.typeError(message, argument.span);
}

export function inferWebExtensionCall(
  host: InferenceHost,
  callee: ExtensionValueType,
  arguments_: readonly Expression[],
  argumentNames: readonly (string | null)[] | undefined,
  callSpan: Span,
): ValueType | undefined {
  if (!isWebComponentType(callee)) return undefined;
  host.typeError(componentCallRefusal(webComponentName(callee), arguments_, argumentNames, host.webSourceText), callSpan);
  for (const argument of arguments_) host.inferExpression(argument);
  return webNodeType;
}

export function validateWebExtensionTypeSyntax(
  host: InferenceHost,
  syntax: TypeSyntax,
  validate: (syntax: TypeSyntax) => boolean,
  resolve: (reference: TypeReference) => ValueType,
): boolean | undefined {
  if (syntax.kind !== "GenericTypeSyntax" || syntax.name !== "Component") return undefined;
  let valid = true;
  if (syntax.arguments.length < 1 || syntax.arguments.length > 2) {
    host.typeError("Component<Props, Handle> requires a named prop signature and at most one Handle type", syntax.span);
    valid = false;
  }
  const argumentsValid = syntax.arguments.map(validate).every(Boolean);
  const signature = syntax.arguments[0];
  if (!signature) return false;
  if (signature.kind !== "FunctionTypeSyntax") {
    host.typeError("Component<Props, Handle> requires a named function signature such as Component<(title: string) -> WebNode, DialogHandle>", signature.span);
    valid = false;
  } else {
    const names = new Set<string>();
    for (const parameter of signature.parameters) {
      if (!parameter.name) {
        host.typeError("Every Component signature prop requires a name", parameter.span);
        valid = false;
      } else if (names.has(parameter.name)) {
        host.typeError(`Component signature prop '${parameter.name}' is declared more than once`, parameter.span);
        valid = false;
      } else names.add(parameter.name);
      if (parameter.rest) {
        host.typeError("Component signatures use named props and cannot declare a rest parameter", parameter.span);
        valid = false;
      }
    }
    const result = resolve({ syntax: signature.result, span: signature.result.span });
    if (!isWebNodeType(result)) {
      host.typeError(`A Component signature must return WebNode, received ${describeType(result)}`, signature.result.span);
      valid = false;
    }
  }
  const handleSyntax = syntax.arguments[1];
  if (handleSyntax && argumentsValid) {
    const handle = host.expandAliases(resolve({ syntax: handleSyntax, span: handleSyntax.span }));
    const fields = handle.kind === "object"
      ? handle.fields
      : handle.kind === "named" ? host.fieldsOf(handle.identity ?? handle.name) : null;
    if (!fields) {
      host.typeError(`A Component Handle must be a concrete record type, received ${describeType(handle)}`, handleSyntax.span);
      valid = false;
    }
  }
  return valid && argumentsValid;
}
