/**
 * What a Web declaration means and what analyzing one does: the types a
 * `component` and an `action` publish, the four reactive declarations
 * (`state`, `computed`, `resource`, `action`), the module-level `import css
 * unsafe`, the scope prescan's answer, and the demotion an imported derived
 * name receives.
 *
 * D115 P4 R3c. Every one of these is reached from the analyzer's statement
 * seams, which stay on the root as the dispatch over statement kinds; the arms
 * themselves live here. `analyzeComponent` calls the same four declaration
 * analyzers from a component body, which is why they are a module both the root
 * and `components/` can call and why the import runs one way only:
 * `components/` reads this module, and this module never reads `components/`.
 */
import { type Diagnostic, type Span } from "@velarscript/compiler";
import {
  anyType,
  boolType,
  describeType,
  isInvalidType,
  nullType,
  optionalOf,
  spanIdentity,
  stringType,
  unknownType,
  type Expression,
  type Statement,
  type TypeReference,
  type ValueType,
} from "@velarscript/compiler/extension";
import {
  isWebStatement,
  type WebActionDeclaration as ActionDeclaration,
  type WebComponentDeclaration as ComponentDeclaration,
  type WebComputedDeclaration as ComputedDeclaration,
  type WebResourceDeclaration as ResourceDeclaration,
  type WebStateDeclaration as StateDeclaration,
  type WebUnsafeCssDeclaration as UnsafeCssDeclaration,
} from "../ast.ts";
import { webComponentConstructor } from "../types.ts";
import { recordDerivedKeyedListRebuild, type KeyedRebuildHost } from "./keyed-rebuild.ts";
import { containsCssImport, firstRelativeCssAssetAddress } from "./look-sites.ts";
import { diagnostic } from "./web-types.ts";

/**
 * What the declaration analyzers ask of the analyzer that hosts them: the four
 * span tables a declaration records itself in, the module's unsafe-CSS and
 * resource inputs, and the base-analyzer operations declaring a name performs.
 *
 * It extends `KeyedRebuildHost` because a `computed` declaration is one of the
 * two places a keyed-list rebuild is recorded, so analyzing a declaration
 * really does need everything that advisory needs.
 */
export interface DeclarationAnalysisHost extends KeyedRebuildHost {
  /** D71 rule 182: the declaration spans of every `computed` binding in scope. */
  readonly computedBindingSpans: Set<string>;
  /** Local names bound to an imported `export computed`, from the Web interface. */
  readonly importedComputedNames: ReadonlySet<string>;
  /** The resolved spans of those imports, so a local shadow of the name is not one. */
  readonly importedComputedSpans: Set<string>;
  /** The project resources this compile read, which is where an external unsafe stylesheet's text comes from. */
  readonly resources: ReadonlyMap<string, string>;
  /** D114 W: the declaration spans of every `resource` in scope. */
  readonly resourceBindingSpans: Set<string>;
  /** Each external stylesheet already given an order position, which is how a second import of one is recognised. */
  readonly unsafeCssImports: Set<string>;
  /** How many synchronous reactive bodies enclose the expression being inferred; a `computed` initializer is one. */
  synchronousReactiveDepth: number;

  readonly diagnostics: Diagnostic[];
  analyzeFunctionDeclaration(
    statement: ActionDeclaration,
    className: null,
    method: boolean,
    declareSelf: boolean,
    forceAsynchronous: boolean,
    declarationKind: string,
  ): void;
  declareBinding(name: string, mutable: boolean, type: ValueType, declarationSpan: Span): void;
  inferExpression(expression: Expression, contextualType?: ValueType): ValueType;
  inferredFunctionResult(statement: ActionDeclaration): ValueType;
  isTopLevelScope(): boolean;
  markDeclaredBindingReactive(name: string, kind: "state" | "prop"): void;
  requireAssignable(actual: ValueType, expected: ValueType, valueSpan: Span): void;
  requireSettledCollectionElement(initializer: Expression, declared: ValueType, annotated: boolean): void;
  resolveAnnotation(reference: TypeReference | null): ValueType;
  resolveValidatedAnnotation(reference: TypeReference | null): ValueType;
  resolvedAsyncResult(type: ValueType): ValueType;
  validateTypeReference(reference: TypeReference): boolean;
}

export function componentType(host: DeclarationAnalysisHost, statement: ComponentDeclaration): ValueType {
  const props = new Map(statement.parameters.map((parameter) => [parameter.name, host.resolveValidatedAnnotation(parameter.type)]));
  if (!props.has("class")) props.set("class", optionalOf(stringType));
  if (!props.has("look")) props.set("look", optionalOf({ kind: "named", name: "Look" }));
  return webComponentConstructor(
    statement.name,
    props,
    new Set(statement.parameters.filter((parameter) => !parameter.defaultValue).map((parameter) => parameter.name)),
    statement.handleType ? host.resolveValidatedAnnotation(statement.handleType) : null,
  );
}

/**
 * A `state` declaration, at module scope and in a component body alike: the two
 * arms are the same eight lines, so they are written once here.
 */
export function analyzeStateDeclaration(host: DeclarationAnalysisHost, statement: StateDeclaration): void {
  const annotationValid = statement.type ? host.validateTypeReference(statement.type) : true;
  const annotationContext = statement.type ? host.resolveValidatedAnnotation(statement.type) : null;
  const actual = host.inferExpression(statement.initializer, annotationContext ?? unknownType);
  const declared = annotationContext ?? actual;
  if (annotationValid) host.requireAssignable(actual, declared, statement.initializer.span);
  host.requireSettledCollectionElement(statement.initializer, declared, annotationContext !== null);
  host.declareBinding(statement.name, true, declared, statement.span);
  host.markDeclaredBindingReactive(statement.name, "state");
}

/**
 * D71 rule 182: a derived value is reactive and read-only, which is exactly
 * the reactive identity a component prop already carries — a bare read lowers
 * through `.get()`, and nothing may write it. Registering that identity
 * rather than `state` is what keeps `bind={doubled}` and every other writable
 * position refusing a derived name for free.
 */
export function analyzeComputedDeclaration(host: DeclarationAnalysisHost, statement: ComputedDeclaration): void {
  const annotationValid = statement.type ? host.validateTypeReference(statement.type) : true;
  const annotationContext = statement.type ? host.resolveValidatedAnnotation(statement.type) : null;
  // The initializer re-runs on every dependency change, so it is a deferred
  // read for the module-initialization-cycle classification, exactly like a
  // watch subject.
  host.synchronousReactiveDepth += 1;
  const actual = host.inferExpression(statement.initializer, annotationContext ?? unknownType);
  host.synchronousReactiveDepth -= 1;
  const declared = annotationContext ?? actual;
  if (annotationValid) host.requireAssignable(actual, declared, statement.initializer.span);
  host.declareBinding(statement.name, false, declared, statement.span);
  host.markDeclaredBindingReactive(statement.name, "prop");
  host.computedBindingSpans.add(spanIdentity(statement.span));
  recordDerivedKeyedListRebuild(host, statement);
}

export function analyzeResourceDeclaration(host: DeclarationAnalysisHost, statement: ResourceDeclaration): void {
  const annotated = statement.type ? host.resolveAnnotation(statement.type) : null;
  const annotationValid = statement.type ? host.validateTypeReference(statement.type) : true;
  const annotationContext = statement.type ? host.resolveValidatedAnnotation(statement.type) : null;
  const expected: ValueType = annotationContext ? { kind: "promise", value: annotationContext } : unknownType;
  const actual = host.inferExpression(statement.initializer, expected);
  let value = annotationContext ?? unknownType;
  if (actual.kind === "promise") {
    if (annotated && annotationValid) host.requireAssignable(actual.value, annotated, statement.initializer.span);
    else if (!statement.type) value = actual.value;
  } else if (actual.kind === "any") {
    value = annotationContext ?? anyType;
  } else if (!isInvalidType(actual)) {
    host.diagnostics.push(diagnostic("VEL4016", `A resource initializer must return Promise<T>, received ${describeType(actual)}`, statement.initializer.span));
  }
  const fields = new Map<string, ValueType>([
    ["value", value.kind === "null" ? nullType : optionalOf(value)],
    ["loading", boolType],
    ["ready", boolType],
    ["error", optionalOf({ kind: "class", name: "Error" })],
    ["reload", { kind: "function", parameters: [], requiredParameters: 0, result: { kind: "promise", value: nullType } }],
  ]);
  host.declareBinding(statement.name, false, { kind: "object", fields }, statement.span);
  host.resourceBindingSpans.add(spanIdentity(statement.span));
}

export function actionType(host: DeclarationAnalysisHost, statement: ActionDeclaration): ValueType {
  const declaredResult = host.resolvedAsyncResult(host.inferredFunctionResult(statement));
  const rest = statement.parameters.find((parameter) => parameter.rest);
  return {
    kind: "action",
    parameters: statement.parameters.filter((parameter) => !parameter.rest).map((parameter) => host.resolveValidatedAnnotation(parameter.type)),
    parameterNames: statement.parameters.filter((parameter) => !parameter.rest).map((parameter) => parameter.name),
    requiredParameters: statement.parameters.filter((parameter) => !parameter.rest && !parameter.defaultValue).length,
    ...(rest ? { rest: host.resolveValidatedAnnotation(rest.type) } : {}),
    result: { kind: "promise", value: declaredResult },
  };
}

export function analyzeActionDeclaration(host: DeclarationAnalysisHost, statement: ActionDeclaration): void {
  host.declareBinding(statement.name, false, actionType(host, statement), statement.span);
  host.analyzeFunctionDeclaration(statement, null, true, false, true, "Action");
}

/**
 * LOK-D2 / D53: unsafe CSS is a module-level ordering declaration, whether its
 * source is an external resource or an inline raw block. Nested inside a
 * component or a function it used to pass every check, build, and then appear
 * in no output at all.
 */
export function analyzeUnsafeCssDeclaration(host: DeclarationAnalysisHost, statement: UnsafeCssDeclaration): void {
  if (!host.isTopLevelScope()) {
    host.diagnostics.push(diagnostic("VEL5037", "Unsafe CSS is module-level; move the declaration to the top of the module so its order against Look stays visible", statement.span));
    return;
  }
  if (statement.source.kind === "external" && host.unsafeCssImports.has(statement.source.path)) {
    host.diagnostics.push(diagnostic("VEL5037", `Unsafe CSS '${statement.source.path}' is imported more than once; each stylesheet must have one explicit order position`, statement.span));
  }
  if (statement.source.kind === "external") host.unsafeCssImports.add(statement.source.path);
  const source = statement.source.kind === "inline" ? statement.source.css : host.resources.get(statement.source.path);
  const subject = statement.source.kind === "inline" ? "Inline unsafe CSS" : `Unsafe CSS '${statement.source.path}'`;
  if (source && containsCssImport(source)) {
    host.diagnostics.push(diagnostic("VEL5037", `${subject} contains @import; declare every stylesheet with 'import css unsafe' so project order remains visible`, statement.source.span));
  }
  if (source) {
    const relativeAddress = firstRelativeCssAssetAddress(source);
    if (relativeAddress) host.diagnostics.push(diagnostic("VEL5037", `${subject} uses relative asset address ${relativeAddress.syntax}(${JSON.stringify(relativeAddress.value)}); use a project-public /path, data URL, fragment, or absolute URL so extracted asset ownership stays explicit`, statement.source.span));
  }
}

/** The three Web declarations a scope prescan has to see, so a later shadow of one is recognised. */
export function webScopeDeclaration(statement: Statement): { readonly name: string; readonly span: Span } | null {
  if (!isWebStatement(statement)) return null;
  return statement.kind === "ExtensionStatement:web:state" || statement.kind === "ExtensionStatement:web:computed"
    || statement.kind === "ExtensionStatement:web:resource"
    ? { name: statement.name, span: statement.span }
    : null;
}

/**
 * D71 rule 184: a cross-module `computed` travels through `reactiveExports`
 * so its bare read lowers through `.get()` like an exported `state` — but it
 * is not writable, and the imported binding must not inherit the writable
 * identity that carries `bind={...}` and `event => name = ...`. The Web
 * extension publishes which exported names are derived, so the import is
 * demoted to the read-only reactive identity here.
 *
 * `markCore` is the base analyzer's own registration, which only the class can
 * reach: this rule decides which identity the name receives and then hands the
 * decision back.
 */
export function markWebBindingReactive(
  host: DeclarationAnalysisHost,
  name: string,
  kind: "state" | "prop",
  markCore: (name: string, kind: "state" | "prop") => void,
): void {
  // Only the import itself is demoted. A local `state` of the same name in a
  // component or a block is a shadow that really is writable, and demoting it
  // would compile its assignment as a plain store into the handle.
  const imported = kind === "state" && host.isTopLevelScope() && host.importedComputedNames.has(name);
  markCore(name, imported ? "prop" : kind);
  if (!imported) return;
  const binding = host.lookup(name);
  if (!binding) return;
  host.computedBindingSpans.add(spanIdentity(binding.span));
  host.importedComputedSpans.add(spanIdentity(binding.span));
}
