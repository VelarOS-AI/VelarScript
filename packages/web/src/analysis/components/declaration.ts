/**
 * One `component` declaration analyzed: the prologue that opens the body's
 * scope and declares its props, the per-section dispatch over the items a body
 * may hold, and the epilogue that counts the sections and closes everything the
 * prologue opened.
 *
 * D115 P4 R3c. The three are named rather than one 122-line method because they
 * are three different things: the prologue and the epilogue are a matched pair
 * that has to stay balanced, and the loop between them is a dispatch whose arms
 * are the reactive declarations `analysis/declarations.ts` already owns.
 */
import { nullType, unknownType, type Expression, type Statement, type ValueType } from "@velarscript/compiler/extension";
import { isWebJsx, type WebComponentDeclaration as ComponentDeclaration, type WebComponentItem } from "../../ast.ts";
import { isWebNodeType } from "../../types.ts";
import { componentSectionCountDiagnostics } from "../component-guidance.ts";
import {
  analyzeActionDeclaration,
  analyzeComputedDeclaration,
  analyzeResourceDeclaration,
  analyzeStateDeclaration,
  componentType,
} from "../declarations.ts";
import { rejectFrozenWatchSubject, rejectWatchCycle } from "../watch-cycles.ts";
import { diagnostic } from "../web-types.ts";
import { containsReadonlyView, validateComponentHandleType, validateComponentHost } from "./contracts.ts";
import { type ComponentAnalysisHost } from "./host.ts";

/** What the prologue opened and the epilogue has to put back, plus the Handle the sections are checked against. */
interface ComponentFrame {
  readonly handleType: ValueType | null;
  readonly handleTypeValid: boolean;
  readonly outerConstructorDepth: number;
  readonly previousExplicitReadonlyProps: ReadonlyMap<string, number>;
  readonly previousStates: Set<string> | null;
}

/** The sections a body declared, counted while the loop runs and judged once it ends. */
interface ComponentSections {
  cleanup: number;
  exposes: number;
  mounted: number;
  renders: number;
  renderValue: Expression | null;
}

export function analyzeComponent(host: ComponentAnalysisHost, statement: ComponentDeclaration): void {
  const frame = beginComponentBody(host, statement);
  const sections: ComponentSections = { cleanup: 0, exposes: 0, mounted: 0, renders: 0, renderValue: null };
  for (const item of statement.body) analyzeComponentItem(host, statement, item, frame, sections);
  endComponentBody(host, statement, frame, sections);
}

function beginComponentBody(host: ComponentAnalysisHost, statement: ComponentDeclaration): ComponentFrame {
  const outerConstructorDepth = host.constructorDepth;
  if (!host.isPredeclared(statement)) host.declareBinding(statement.name, false, componentType(host, statement), statement.span);
  // VEL5075: a `def` written from here to the matching decrement lowers
  // through this component's scope, so its component elements are children.
  host.componentBodyDepth += 1;
  host.enterScope();
  host.flowFrameDepth += 1;
  const previousStates = host.componentStates;
  host.componentStates = new Set(statement.body.filter((item) => item.kind === "ExtensionStatement:web:state").map((item) => item.name));
  const previousExplicitReadonlyProps = host.explicitReadonlyPropBindings;
  const explicitReadonlyProps = new Map<string, number>();
  // Component items are analyzed one by one rather than through
  // analyzeStatements, so the shadow prescan runs here — before the
  // parameters, whose defaults are emitted as closures inside the component
  // body where a later item's shadow would capture them.
  host.prescanScopeDeclarations(statement.body.filter((item) =>
    item.kind !== "ExtensionStatement:web:mounted" && item.kind !== "ExtensionStatement:web:cleanup" && item.kind !== "ExtensionStatement:web:expose") as readonly Statement[]);
  for (const parameter of statement.parameters) {
    const type = host.resolveAnnotation(parameter.type);
    const valid = parameter.type ? host.validateTypeReference(parameter.type) : true;
    if (parameter.defaultValue && valid) host.requireAssignable(host.inferParameterDefault(parameter.defaultValue, type), type, parameter.defaultValue.span);
    const declared = valid ? type : host.resolveValidatedAnnotation(parameter.type);
    host.declareBinding(parameter.name, false, declared, parameter.span);
    if (valid && containsReadonlyView(host, declared)) explicitReadonlyProps.set(parameter.name, parameter.span.start);
    host.markDeclaredBindingReactive(parameter.name, "prop");
    if (parameter.name === "ref") host.diagnostics.push(diagnostic("VEL5056", "'ref' is a compiler-owned JSX directive and cannot be declared as a component prop", parameter.span));
  }
  host.explicitReadonlyPropBindings = explicitReadonlyProps;
  const handleType = statement.handleType ? host.resolveAnnotation(statement.handleType) : null;
  const handleTypeValid = statement.handleType ? host.validateTypeReference(statement.handleType) : true;
  if (handleType && handleTypeValid) validateComponentHandleType(host, handleType, statement.handleType!.span);
  host.constructorDepth = 0;
  return { handleType, handleTypeValid, outerConstructorDepth, previousExplicitReadonlyProps, previousStates };
}

function analyzeComponentItem(
  host: ComponentAnalysisHost,
  statement: ComponentDeclaration,
  item: WebComponentItem,
  frame: ComponentFrame,
  sections: ComponentSections,
): void {
  const { handleType, handleTypeValid } = frame;
  if (item.kind === "ExtensionStatement:web:state") {
    analyzeStateDeclaration(host, item);
  } else if (item.kind === "ExtensionStatement:web:computed") {
    host.flowFrameDepth += 1;
    analyzeComputedDeclaration(host, item);
    host.flowFrameDepth -= 1;
  } else if (item.kind === "ExtensionStatement:web:resource") {
    host.flowFrameDepth += 1;
    analyzeResourceDeclaration(host, item);
    host.flowFrameDepth -= 1;
  } else if (item.kind === "ExtensionStatement:web:action") {
    analyzeActionDeclaration(host, item);
  } else if (item.kind === "ExtensionStatement:web:watch") {
    host.flowFrameDepth += 1;
    host.synchronousReactiveDepth += 1;
    const watched = host.inferExpression(item.expression);
    if (rejectFrozenWatchSubject(host, item.expression, watched, item.currentName, item.previousName)) {
      rejectWatchCycle(host, item.expression, watched, item.body);
    }
    host.enterScope();
    if (item.currentName) host.declareBinding(item.currentName, false, watched, item.span);
    if (item.previousName) host.declareBinding(item.previousName, false, watched, item.span);
    host.watchBodyDepth += 1;
    host.analyzeStatements(item.body);
    host.watchBodyDepth -= 1;
    host.exitScope();
    host.synchronousReactiveDepth -= 1;
    host.flowFrameDepth -= 1;
  } else if (item.kind === "ExtensionStatement:web:expose") {
    sections.exposes += 1;
    host.flowFrameDepth += 1;
    const actual = host.inferExpression(item.value, handleType ?? unknownType);
    host.flowFrameDepth -= 1;
    if (!handleType) host.diagnostics.push(diagnostic("VEL5056", `Component '${statement.name}' uses 'expose' without declaring 'exposes HandleType'`, item.span));
    else if (handleTypeValid) host.requireAssignable(actual, handleType, item.value.span);
  } else if (item.kind === "ExtensionStatement:web:mounted") {
    sections.mounted += 1;
    host.mountedDepth += 1;
    host.flowFrameDepth += 1;
    host.analyzeBlock(item.body);
    host.flowFrameDepth -= 1;
    host.mountedDepth -= 1;
  } else if (item.kind === "ExtensionStatement:web:cleanup") {
    sections.cleanup += 1;
    // D51 (audit 12): a cleanup hook runs once and ends, so it is an
    // ordinary scope with an exit. It used to be counted as component
    // setup, and the rejection then named `@cleanup` as its own fix.
    host.cleanupDepth += 1;
    host.flowFrameDepth += 1;
    host.analyzeBlock(item.body);
    host.flowFrameDepth -= 1;
    host.cleanupDepth -= 1;
  } else if (item.kind === "ReturnStatement") {
    sections.renders += 1;
    sections.renderValue = item.value;
    host.flowFrameDepth += 1;
    const rendered = item.value ? host.inferExpression(item.value) : nullType;
    host.flowFrameDepth -= 1;
    // WEB-U15: `return null` is the React habit for "render nothing". A
    // component always has one root, so the decision belongs to the caller.
    if (rendered.kind === "null") {
      host.typeError("A component always returns one JSX root; decide at the call site with '{show ? <Card /> : null}', or return an empty element such as <span />", item.span);
    } else if (!isWebNodeType(rendered) && rendered.kind !== "any") host.typeError("A component must return JSX", item.span);
  } else {
    host.analyzeStatement(item);
  }
}

function endComponentBody(
  host: ComponentAnalysisHost,
  statement: ComponentDeclaration,
  frame: ComponentFrame,
  sections: ComponentSections,
): void {
  const { cleanup, exposes, mounted, renders, renderValue } = sections;
  host.diagnostics.push(...componentSectionCountDiagnostics(statement.name, { renders, mounted, cleanup, exposes }, statement.span, statement.handleType?.span ?? null));
  if (renderValue && isWebJsx(renderValue)) validateComponentHost(host, renderValue, statement);
  host.componentStates = frame.previousStates;
  host.explicitReadonlyPropBindings = frame.previousExplicitReadonlyProps;
  host.flowFrameDepth -= 1;
  host.exitScope();
  host.componentBodyDepth -= 1;
  host.constructorDepth = frame.outerConstructorDepth;
}
