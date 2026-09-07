/**
 * The construct rosters: every statement form and every expression form Core's
 * grammar produces, each with the spelling a reader recognises it by.
 *
 * Both are mapped types over the unions in `nodes/base.ts`, so a node kind the
 * parser can return cannot be missing from them — `tsc` refuses the object
 * until its spelling is written. `scripts/check-tour-coverage.mjs` and
 * `scripts/surface-inventory.mjs` read them from `ast.ts`.
 */
import type { CoreExpression, CoreStatement } from "./nodes/base.ts";
import type {
  ClassDeclaration,
  EmbeddedJavaScriptDeclaration,
  ForStatement,
  FunctionDeclaration,
  TypeDeclaration,
  VariableDeclaration,
} from "./nodes/statements.ts";

/**
 * D56 rule 129 — every statement form Core's grammar produces, keyed by the
 * node kind the parser returns for it. The string is prose for a failure
 * message; the *keys* are the data.
 *
 * The mapped type is both the derivation and the enforcement: a member added
 * to `CoreStatement` above makes this object stop typechecking until its
 * spelling is written here, so the roster cannot fall behind the union the
 * parser returns. That is the whole reason it lives beside the union instead
 * of in a gate script — D57 rule 134's failure family is the hand-kept copy,
 * and a copy that `tsc` refuses to accept as incomplete is not one.
 *
 * The tour-coverage gate requires every key to be parsed out of
 * `examples/tour/`, and this is the one category of that gate that names a
 * *construct* rather than a *name*. It exists because names were not enough:
 * `extern`, `js`, and `unsafe` were already covered as keywords by chapter 13's
 * `extern module` and `import js unsafe`, so D53 rule 117's two inline blocks —
 * spelled entirely out of keywords the tour already exercised — landed with no
 * tour example at all and the gate stayed green.
 *
 * A node kind that deliberately carries multiple grammar forms contributes a
 * projected key for each form. The AST keeps its semantic fields instead of
 * acquiring redundant tags solely for coverage; this function is the one
 * compiler-owned projection the tour gate reads.
 */
export type CoreStatementConstructKey = Exclude<
  CoreStatement,
  EmbeddedJavaScriptDeclaration | TypeDeclaration | VariableDeclaration | FunctionDeclaration | ClassDeclaration | ForStatement
>["kind"]
  | "EmbeddedJavaScriptDeclaration:checked"
  | "EmbeddedJavaScriptDeclaration:unsafe"
  | `TypeDeclaration:${"type" | "readonly-type"}`
  | `VariableDeclaration:${VariableDeclaration["binding"]}`
  | `FunctionDeclaration:${"def" | "async-def"}`
  | `ClassDeclaration:${"class" | "abstract-class"}`
  | `ForStatement:${"for" | "async-for"}`;

export const CORE_STATEMENT_CONSTRUCTS = Object.freeze({
  ImportDeclaration: 'import {name} from "./module.vel"',
  ReExportDeclaration: 'export {name} from "./module.vel"',
  ExternModuleDeclaration: 'extern module "node:crypto":',
  "EmbeddedJavaScriptDeclaration:checked": "extern js(capture: T)`…`:",
  "EmbeddedJavaScriptDeclaration:unsafe": "unsafe js`…`",
  "TypeDeclaration:type": "type Name:",
  "TypeDeclaration:readonly-type": "readonly type Name:",
  TypeAliasDeclaration: "type Name = string",
  EnumDeclaration: "enum Name:",
  "ClassDeclaration:class": "class Name:",
  "ClassDeclaration:abstract-class": "abstract class Name:",
  "VariableDeclaration:const": "const name = value",
  "VariableDeclaration:let": "let name = value",
  UsingDeclaration: "using name = open(path)",
  TestDeclaration: 'test "a name":',
  MainBlock: "@main: run()",
  "FunctionDeclaration:def": "def name() -> T:",
  "FunctionDeclaration:async-def": "async def name() -> T:",
  ReturnStatement: "return value",
  ThrowStatement: "throw error",
  AssertStatement: "assert condition",
  IfStatement: "if condition:",
  MatchStatement: "match value:",
  "ForStatement:for": "for item in values:",
  "ForStatement:async-for": "async for item in values:",
  WhileStatement: "while condition:",
  BreakStatement: "break",
  ContinueStatement: "continue",
  TryStatement: "try:",
  PassStatement: "pass",
  AssignmentStatement: "name = value",
  ExpressionStatement: "call()",
  DetachStatement: "detach call()",
} satisfies { readonly [Kind in CoreStatementConstructKey]: string });

/** The tour key for one Core statement, including every multi-form projection. */
export function coreStatementConstructKey(statement: CoreStatement): CoreStatementConstructKey {
  switch (statement.kind) {
    case "EmbeddedJavaScriptDeclaration":
      return `EmbeddedJavaScriptDeclaration:${statement.form}`;
    case "VariableDeclaration":
      return `VariableDeclaration:${statement.binding}`;
    case "TypeDeclaration":
      return `TypeDeclaration:${statement.readonly ? "readonly-type" : "type"}`;
    case "FunctionDeclaration":
      return `FunctionDeclaration:${statement.asynchronous ? "async-def" : "def"}`;
    case "ClassDeclaration":
      return `ClassDeclaration:${statement.abstract ? "abstract-class" : "class"}`;
    case "ForStatement":
      return `ForStatement:${statement.asynchronous ? "async-for" : "for"}`;
    default:
      return statement.kind;
  }
}

/** D82 rule 203: a mapped roster makes every Core expression kind explicit. */
export const CORE_EXPRESSION_CONSTRUCTS = Object.freeze({
  LiteralExpression: "literal",
  FStringExpression: "f-string",
  IdentifierExpression: "name",
  SuperExpression: "super",
  DynamicImportExpression: "import(\"./module.vel\")",
  ListExpression: "[value]",
  ObjectExpression: "{field: value}",
  SpreadExpression: "...value",
  UnaryExpression: "not value — or await value",
  TryExpression: "try value",
  BinaryExpression: "left + right",
  AssignmentExpression: "recovery node for assignment in expression position",
  ComparisonChainExpression: "minimum <= value < maximum",
  ConditionalExpression: "value if condition else fallback",
  IsExpression: "value is Type",
  RequiredExpression: "value!",
  ArrowFunctionExpression: "value => result",
  CallExpression: "call()",
  MemberExpression: "value.member",
  IndexExpression: "value[index]",
  "ExtensionExpression:core:duration": "250ms",
} satisfies { readonly [Kind in CoreExpression["kind"]]: string });
