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

/**
 * D90 R16: one state named by a `watch` header's `writes` clause. The span is
 * the name's own token, so the contention error, go-to-definition and a rename
 * all land on what the author wrote rather than on the whole header.
 */
export interface WebWatchWriteTarget {
  readonly name: string;
  readonly span: Span;
}

export interface WebWatchDeclaration {
  readonly kind: "ExtensionStatement:web:watch";
  readonly expression: Expression;
  readonly currentName: string | null;
  readonly previousName: string | null;
  /** D90 R16: the states this watch declares it writes; empty makes it a pure observer. */
  readonly writes: readonly WebWatchWriteTarget[];
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

/**
 * D56 rule 129 — the Web extension's half of the statement-construct roster
 * Core publishes as `CORE_STATEMENT_CONSTRUCTS`, reached through the extension
 * protocol's `syntax` slot so the tour-coverage gate can require an
 * extension's constructs without being taught this package's node names.
 *
 * `unsafe-css` contributes two keys rather than one because its `source` is a
 * tagged union this package already owns: the external import and the inline
 * block are two spellings the AST tells apart on its own. Requiring only the
 * kind would let D53 rule 117's inline block hide behind the `import css
 * unsafe` that predates it, which is exactly how the block reached a release
 * with no example anywhere in `examples/`.
 */
export type WebStatementConstructKey =
  | Exclude<WebOwnedStatement["kind"], "ExtensionStatement:web:unsafe-css">
  | `ExtensionStatement:web:unsafe-css/${WebUnsafeCssSource["kind"]}`;

export const WEB_STATEMENT_CONSTRUCTS = Object.freeze({
  "ExtensionStatement:web:component": "component Name:",
  "ExtensionStatement:web:state": "state name = value",
  "ExtensionStatement:web:computed": "computed name = value",
  "ExtensionStatement:web:resource": "resource name = load()",
  "ExtensionStatement:web:action": "action name():",
  "ExtensionStatement:web:watch": "watch value as current:",
  "ExtensionStatement:web:expose": "expose {member}",
  "ExtensionStatement:web:mounted": "@mounted:",
  "ExtensionStatement:web:cleanup": "@cleanup:",
  "ExtensionStatement:web:unsafe-css/external": 'import css unsafe "./sheet.css" before look',
  "ExtensionStatement:web:unsafe-css/inline": "unsafe css`…` after look",
} satisfies { readonly [Key in WebStatementConstructKey]: string });

/**
 * The construct key of one parsed node, or null when this extension does not
 * own it. The gate walks every node in a module and asks each installed
 * extension, so this has to answer for Core nodes and for another extension's
 * nodes without knowing them.
 */
export function webStatementConstructKey(node: { readonly kind: string }): WebStatementConstructKey | null {
  if (!node.kind.startsWith("ExtensionStatement:web:")) return null;
  if (node.kind !== "ExtensionStatement:web:unsafe-css") return node.kind as WebStatementConstructKey;
  return `${node.kind}/${(node as WebUnsafeCssDeclaration).source.kind}`;
}

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

function webLookContainsDirectAwait(entries: readonly WebLookEntry[], contains: (expression: Expression) => boolean): boolean {
  return entries.some((entry) => {
    if (entry.kind === "LookProperty" || entry.kind === "LookSpread") return contains(entry.value);
    if (entry.kind === "LookIf") {
      return contains(entry.condition)
        || webLookContainsDirectAwait(entry.thenEntries, contains)
        || webLookContainsDirectAwait(entry.elseEntries, contains);
    }
    return webLookContainsDirectAwait(entry.entries, contains);
  });
}

/** Web owns the frame semantics of every expression node its parser adds. */
export function webExpressionContainsDirectAwait(
  expression: Expression,
  contains: (expression: Expression) => boolean,
): boolean | undefined {
  if (!isWebExpression(expression)) return undefined;
  if (isWebUnit(expression) || expression.kind === "ExtensionExpression:web:look-hook") return false;
  if (isWebKeyframes(expression)) {
    return expression.stops.some((stop) => stop.entries.some((entry) => contains(entry.value)));
  }
  if (isWebLook(expression)) return webLookContainsDirectAwait(expression.entries, contains);
  return expression.attributes.some((attribute) => typeof attribute.value !== "string"
    && attribute.value !== null
    && contains(attribute.value))
    || expression.children.some((child) => child.kind === "JSXExpressionChild"
      ? contains(child.expression)
      : child.kind === "ExtensionExpression:web:jsx" && contains(child));
}

/** Web owns whether each statement form executes in this frame or a child. */
export function webStatementContainsDirectAwait(
  statement: Statement,
  containsExpression: (expression: Expression) => boolean,
  _containsBlock: (statements: readonly Statement[]) => boolean,
): boolean | undefined {
  if (!isWebStatement(statement)) return undefined;
  switch (statement.kind) {
    case "ExtensionStatement:web:state":
      // State initialization is emitted directly in its containing frame.
      return containsExpression(statement.initializer);
    case "ExtensionStatement:web:expose":
      // A component handle is assembled during component setup.
      return containsExpression(statement.value);
    case "ExtensionStatement:web:component":
    case "ExtensionStatement:web:computed":
    case "ExtensionStatement:web:resource":
    case "ExtensionStatement:web:action":
    case "ExtensionStatement:web:watch":
    case "ExtensionStatement:web:mounted":
    case "ExtensionStatement:web:cleanup":
    case "ExtensionStatement:web:unsafe-css":
      // Each executable child is emitted behind its own callback/frame; unsafe
      // CSS has no runtime expression.
      return false;
  }
}

export function isWebKeyframes(expression: Expression | WebAwareExpression): expression is WebKeyframesExpression {
  return expression.kind === "ExtensionExpression:web:keyframes";
}

export function isWebUnit(expression: Expression | WebAwareExpression): expression is WebUnitLiteralExpression {
  return expression.kind === "ExtensionExpression:web:unit";
}
