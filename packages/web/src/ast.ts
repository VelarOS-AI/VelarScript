import type { CoreExpression, CoreStatement, Expression, Parameter, Span, Statement, TypeReference } from "@velarscript/compiler/extension";

export interface WebComponentDeclaration {
  readonly kind: "ExtensionStatement:web:component";
  readonly exported: boolean;
  readonly name: string;
  readonly parameters: readonly Parameter[];
  readonly handleType: TypeReference | null;
  readonly body: readonly WebComponentItem[];
  readonly span: Span;
}

export type WebComponentItem =
  | CoreStatement
  | WebStateDeclaration
  | WebComputedDeclaration
  | WebResourceDeclaration
  | WebActionDeclaration
  | WebWatchDeclaration
  | WebExposeDeclaration
  | WebMountedBlock
  | WebCleanupBlock;

export interface WebExposeDeclaration {
  readonly kind: "ExtensionStatement:web:expose";
  readonly value: Expression;
  readonly span: Span;
}

export interface WebStateDeclaration {
  readonly kind: "ExtensionStatement:web:state";
  readonly exported: boolean;
  readonly name: string;
  readonly type: TypeReference | null;
  readonly initializer: Expression;
  readonly span: Span;
}

/**
 * D71 rule 182: the reactive half of `const`. `computed name = expression` is
 * the one spelling for a derived value — read bare like `state`, never
 * assigned. It shares `WebStateDeclaration`'s shape because it shares its
 * declaration grammar; only the reactivity it registers differs.
 */
export interface WebComputedDeclaration {
  readonly kind: "ExtensionStatement:web:computed";
  readonly exported: boolean;
  readonly name: string;
  readonly type: TypeReference | null;
  readonly initializer: Expression;
  readonly span: Span;
}

export interface WebResourceDeclaration {
  readonly kind: "ExtensionStatement:web:resource";
  readonly exported: boolean;
  readonly name: string;
  readonly type: TypeReference | null;
  readonly initializer: Expression;
  readonly span: Span;
}

export interface WebActionDeclaration {
  readonly kind: "ExtensionStatement:web:action";
  readonly exported: boolean;
  readonly name: string;
  readonly parameters: readonly Parameter[];
  readonly returnType: TypeReference | null;
  /** The deletable ` -> T` region; see `FunctionDeclaration.resultAnnotationSpan`. */
  readonly resultAnnotationSpan?: Span;
  readonly signatureSpan: Span;
  readonly body: readonly Statement[];
  readonly span: Span;
}

export interface WebWatchDeclaration {
  readonly kind: "ExtensionStatement:web:watch";
  readonly expression: Expression;
  readonly currentName: string | null;
  readonly previousName: string | null;
  readonly body: readonly Statement[];
  readonly span: Span;
}

export interface WebMountedBlock {
  readonly kind: "ExtensionStatement:web:mounted";
  readonly body: readonly Statement[];
  readonly span: Span;
}

export interface WebCleanupBlock {
  readonly kind: "ExtensionStatement:web:cleanup";
  readonly body: readonly Statement[];
  readonly span: Span;
}

export type WebUnsafeCssSource =
  | { readonly kind: "external"; readonly path: string; readonly span: Span }
  | { readonly kind: "inline"; readonly css: string; readonly span: Span };

export interface WebUnsafeCssDeclaration {
  readonly kind: "ExtensionStatement:web:unsafe-css";
  readonly source: WebUnsafeCssSource;
  readonly placement: "before" | "after";
  readonly span: Span;
}

export type WebStatement =
  | WebComponentDeclaration
  | WebStateDeclaration
  | WebComputedDeclaration
  | WebResourceDeclaration
  | WebActionDeclaration
  | WebWatchDeclaration
  | WebUnsafeCssDeclaration;

export interface WebUnitLiteralExpression {
  readonly kind: "ExtensionExpression:web:unit";
  readonly value: number;
  readonly unit: string;
  readonly raw: string;
  readonly span: Span;
}

export interface WebLookHookExpression {
  readonly kind: "ExtensionExpression:web:look-hook";
  readonly name: string;
  readonly span: Span;
}

export interface WebLookExpression {
  readonly kind: "ExtensionExpression:web:look";
  readonly entries: readonly WebLookEntry[];
  readonly span: Span;
}

export interface WebKeyframesExpression {
  readonly kind: "ExtensionExpression:web:keyframes";
  readonly stops: readonly WebKeyframeStop[];
  readonly span: Span;
}

export interface WebKeyframeStop {
  readonly offsets: readonly number[];
  readonly entries: readonly WebLookProperty[];
  readonly span: Span;
}

export type WebLookEntry = WebLookProperty | WebLookSpread | WebLookIf | WebLookTarget;

export interface WebLookProperty {
  readonly kind: "LookProperty";
  readonly name: string;
  readonly value: Expression;
  readonly span: Span;
}

export interface WebLookSpread {
  readonly kind: "LookSpread";
  readonly value: Expression;
  readonly span: Span;
}

export interface WebLookIf {
  readonly kind: "LookIf";
  readonly condition: Expression;
  readonly thenEntries: readonly WebLookEntry[];
  readonly elseEntries: readonly WebLookEntry[];
  readonly span: Span;
}

export interface WebLookTarget {
  readonly kind: "LookTarget";
  readonly name: string;
  readonly entries: readonly WebLookEntry[];
  readonly span: Span;
}

export interface WebJsxElementExpression {
  readonly kind: "ExtensionExpression:web:jsx";
  readonly tag: string;
  readonly tagSpan: Span;
  readonly attributes: readonly WebJsxAttribute[];
  readonly children: readonly WebJsxChild[];
  readonly span: Span;
}

export interface WebJsxAttribute {
  readonly name: string;
  readonly value: string | Expression | null;
  readonly span: Span;
}

export type WebJsxChild = WebJsxText | WebJsxExpressionChild | WebJsxElementExpression;

export interface WebJsxText {
  readonly kind: "JSXText";
  readonly value: string;
  readonly span: Span;
}

export interface WebJsxExpressionChild {
  readonly kind: "JSXExpressionChild";
  readonly expression: Expression;
  readonly span: Span;
}

export type WebExpression =
  | WebUnitLiteralExpression
  | WebLookHookExpression
  | WebLookExpression
  | WebKeyframesExpression
  | WebJsxElementExpression;

export type WebAwareExpression = CoreExpression | WebExpression;
export type WebAwareStatement = CoreStatement | WebStatement;
export type WebOwnedStatement = WebStatement | WebExposeDeclaration | WebMountedBlock | WebCleanupBlock;

export function isWebStatement(statement: Statement | WebComponentItem): statement is WebOwnedStatement {
  return statement.kind.startsWith("ExtensionStatement:web:");
}

export function isWebExpression(expression: Expression): expression is WebExpression {
  return expression.kind.startsWith("ExtensionExpression:web:");
}

export function isWebComponent(statement: Statement | WebComponentItem): statement is WebComponentDeclaration {
  return statement.kind === "ExtensionStatement:web:component";
}

export function isWebJsx(expression: Expression | WebAwareExpression): expression is WebJsxElementExpression {
  return expression.kind === "ExtensionExpression:web:jsx";
}

export function isWebLook(expression: Expression | WebAwareExpression): expression is WebLookExpression {
  return expression.kind === "ExtensionExpression:web:look";
}

export function isWebKeyframes(expression: Expression | WebAwareExpression): expression is WebKeyframesExpression {
  return expression.kind === "ExtensionExpression:web:keyframes";
}

export function isWebUnit(expression: Expression | WebAwareExpression): expression is WebUnitLiteralExpression {
  return expression.kind === "ExtensionExpression:web:unit";
}
