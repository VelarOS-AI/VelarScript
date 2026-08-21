import {
  parse,
  type AnyNode,
  type Declaration,
  type ExportAllDeclaration,
  type ExportNamedDeclaration,
  type Identifier,
  type ImportDeclaration,
  type Node,
  type Pattern,
  type Program,
} from "acorn";
import { scanOpaqueEmbeddedSource } from "./embedded-source.ts";
import { bindingNameRestriction } from "./source-names.ts";
import { span, type Span } from "./source.ts";

export type EmbeddedJavaScriptKind = "checked" | "unsafe";

export interface EmbeddedJavaScriptLiteralScan {
  readonly kind: EmbeddedJavaScriptKind;
  readonly start: number;
  readonly sourceStart: number;
  readonly sourceEnd: number;
  readonly end: number;
  readonly closed: boolean;
  readonly openingLineBreak: boolean;
}

export interface EmbeddedJavaScriptTokenPayload {
  readonly embeddedJavaScript: true;
  readonly kind: EmbeddedJavaScriptKind;
  readonly sourceSpan: Span;
}

export interface InspectedEmbeddedJavaScriptExport {
  readonly name: string;
  readonly nameSpan: Span;
  readonly local: string;
  readonly localSpan: Span;
}

export interface InspectedEmbeddedJavaScriptImport {
  readonly span: Span;
}

export interface InspectedEmbeddedJavaScriptDependency {
  readonly source: string;
  readonly span: Span;
  readonly dynamic: boolean;
}

export interface InspectedEmbeddedJavaScriptBinding {
  readonly name: string;
  readonly nameSpan: Span;
}

export interface EmbeddedJavaScriptFactoryEdit {
  readonly span: Span;
  readonly replacement: string;
}

export interface EmbeddedJavaScriptIssue {
  readonly message: string;
  readonly span: Span;
}

export interface EmbeddedJavaScriptInspection {
  readonly exports: readonly InspectedEmbeddedJavaScriptExport[];
  readonly imports: readonly InspectedEmbeddedJavaScriptImport[];
  readonly dependencies: readonly InspectedEmbeddedJavaScriptDependency[];
  readonly bindings: readonly InspectedEmbeddedJavaScriptBinding[];
  /**
   * AST-derived edits that turn a checked module body into a factory body:
   * imports leave the body, declaration exports lose only `export`, and export
   * lists leave the body because their local-to-exported mapping is in
   * `exports`. The emitter applies these to the original source slice, so no
   * foreign code is regenerated or formatted by Core.
   */
  readonly factoryEdits: readonly EmbeddedJavaScriptFactoryEdit[];
  readonly issues: readonly EmbeddedJavaScriptIssue[];
}

/**
 * Recognizes the only two Core-owned tagged raw block headers. This is a small
 * scanner for VelarScript's header shape, not for JavaScript: the latter is
 * always parsed by Acorn below.
 */
export function embeddedJavaScriptHeaderKind(source: string, backtick: number): EmbeddedJavaScriptKind | null {
  if (source[backtick] !== "`") return null;
  const lineStart = previousLineStart(source, backtick);
  let cursor = lineStart;
  while (source[cursor] === " " || source[cursor] === "\t") cursor += 1;
  const first = readWord(source, cursor, backtick);
  if (!first) return null;
  cursor = skipHorizontalWhitespace(source, first.end, backtick);
  const second = readWord(source, cursor, backtick);
  if (!second || second.value !== "js") return null;
  cursor = skipHorizontalWhitespace(source, second.end, backtick);

  if (first.value === "unsafe") return cursor === backtick ? "unsafe" : null;
  if (first.value !== "extern" || source[cursor] !== "(") return null;
  let depth = 0;
  for (; cursor < backtick; cursor += 1) {
    const character = source[cursor]!;
    if (character === "(") depth += 1;
    else if (character === ")") {
      depth -= 1;
      if (depth === 0) {
        cursor = skipHorizontalWhitespace(source, cursor + 1, backtick);
        return cursor === backtick ? "checked" : null;
      }
    }
  }
  return null;
}

/**
 * Scans one D53 raw block. The closing backtick is deliberately structural:
 * it is the only backtick at the declaration's indentation on an otherwise
 * empty line (apart from the checked block's `:`). JavaScript template
 * literals therefore need no escaping in every shape but one, which the rule
 * cannot avoid and D53 does not record: a literal whose closing backtick sits
 * alone on a line at that same indentation is indistinguishable from the
 * terminator and ends the block there. D53 has no escape for it, so
 * `structuralTerminatorHint` below names the rule when the truncated payload
 * fails to parse; the remedy is to indent that backtick.
 *
 * A truncation whose remnant is *itself* a legal module — `export const t =
 * String.raw` cut before its tagged literal — cannot be named from here at all,
 * because the payload this function hands on is indistinguishable from a block
 * the author meant to end there. Telling those apart needs the lone-backtick
 * line that follows the block, which only the lexer sees.
 */
export function scanEmbeddedJavaScriptLiteral(source: string, start: number): EmbeddedJavaScriptLiteralScan | null {
  const kind = embeddedJavaScriptHeaderKind(source, start);
  if (!kind) return null;
  const headerLineStart = previousLineStart(source, start);
  const indentation = /^[ \t]*/u.exec(source.slice(headerLineStart, start))?.[0] ?? "";
  return {
    kind,
    ...scanOpaqueEmbeddedSource(
      source,
      start,
      indentation,
      (tail) => tail.trim() === (kind === "checked" ? ":" : ""),
    ),
  };
}

export function isEmbeddedJavaScriptTokenPayload(value: unknown): value is EmbeddedJavaScriptTokenPayload {
  if (typeof value !== "object" || value === null) return false;
  const payload = value as Partial<EmbeddedJavaScriptTokenPayload>;
  return payload.embeddedJavaScript === true
    && (payload.kind === "checked" || payload.kind === "unsafe")
    && typeof payload.sourceSpan?.start === "number"
    && typeof payload.sourceSpan.end === "number";
}

/** Parses a raw source slice as an ECMAScript module and derives all lowering metadata from its AST. */
export function inspectEmbeddedJavaScript(
  source: string,
  sourceStart: number,
  checked: boolean,
): EmbeddedJavaScriptInspection {
  let program: Program;
  try {
    program = parse(source, { ecmaVersion: "latest", sourceType: "module" });
  } catch (error) {
    const position = syntaxErrorPosition(error);
    const message = error instanceof Error ? error.message.replace(/ \(\d+:\d+\)$/u, "") : String(error);
    return {
      exports: [],
      imports: [],
      dependencies: [],
      bindings: [],
      factoryEdits: [],
      issues: [{
        message: `JavaScript syntax error: ${message}${structuralTerminatorHint(message, source)}`,
        span: span(sourceStart + position, sourceStart + Math.min(source.length, position + 1)),
      }],
    };
  }

  const exports: InspectedEmbeddedJavaScriptExport[] = [];
  const imports: InspectedEmbeddedJavaScriptImport[] = [];
  const dependencies: InspectedEmbeddedJavaScriptDependency[] = [];
  const bindings: InspectedEmbeddedJavaScriptBinding[] = [];
  const factoryEdits: EmbeddedJavaScriptFactoryEdit[] = [];
  const issues: EmbeddedJavaScriptIssue[] = [];
  const absolute = (node: Pick<Node, "start" | "end">): Span => span(sourceStart + node.start, sourceStart + node.end);
  const issue = (message: string, node: Pick<Node, "start" | "end">): void => {
    issues.push({ message, span: absolute(node) });
  };
  const addExport = (nameNode: Identifier | { readonly value?: unknown; readonly start: number; readonly end: number }, localNode: Identifier | { readonly value?: unknown; readonly start: number; readonly end: number }): void => {
    const name = nodeName(nameNode);
    const local = nodeName(localNode);
    if (name === "default") {
      issue("An inline JavaScript block cannot export 'default'; every export enters VelarScript scope by its own name", nameNode);
      return;
    }
    const restriction = bindingNameRestriction(name);
    if (restriction) {
      issue(`JavaScript export ${JSON.stringify(name)} cannot enter VelarScript scope; export it under a valid, non-reserved VelarScript binding name`, nameNode);
      return;
    }
    if (local.length === 0) {
      issue(`JavaScript export ${JSON.stringify(name)} has no statically addressable local binding`, localNode);
      return;
    }
    exports.push({ name, nameSpan: absolute(nameNode), local, localSpan: absolute(localNode) });
  };

  for (const statement of program.body) {
    if (statement.type === "ImportDeclaration") {
      rejectRelativeEmbeddedModuleSource(statement.source, issue);
      imports.push({ span: absolute(statement) });
      if (typeof statement.source.value === "string" && !statement.source.value.startsWith(".")) {
        dependencies.push({ source: statement.source.value, span: absolute(statement.source), dynamic: false });
      }
      for (const specifier of statement.specifiers) {
        bindings.push({ name: specifier.local.name, nameSpan: absolute(specifier.local) });
      }
      if (checked) factoryEdits.push({ span: absolute(statement), replacement: "" });
      continue;
    }
    for (const binding of topLevelStatementBindings(statement)) {
      bindings.push({ name: binding.name, nameSpan: absolute(binding) });
    }
    if (statement.type === "ExportDefaultDeclaration") {
      issue("An inline JavaScript block cannot use a default export; export a named declaration so it can enter VelarScript scope", statement);
      continue;
    }
    if (statement.type === "ExportAllDeclaration") {
      rejectRelativeEmbeddedModuleSource(statement.source, issue);
      if (typeof statement.source.value === "string" && !statement.source.value.startsWith(".")) {
        dependencies.push({ source: statement.source.value, span: absolute(statement.source), dynamic: false });
      }
      inspectExportAll(statement, checked, addExport, issue);
      continue;
    }
    if (statement.type !== "ExportNamedDeclaration") continue;
    if (statement.source) {
      rejectRelativeEmbeddedModuleSource(statement.source, issue);
      if (typeof statement.source.value === "string" && !statement.source.value.startsWith(".")) {
        dependencies.push({ source: statement.source.value, span: absolute(statement.source), dynamic: false });
      }
    }
    inspectNamedExport(statement, checked, addExport, issue, factoryEdits, absolute);
  }

  for (const imported of dynamicImportSources(program)) {
    if (imported.value === null) {
      issue("A dynamic import inside inline JavaScript must use a literal package specifier; computed paths cannot be emitted consistently by run and production builds", imported.node);
    } else if (imported.value.startsWith(".")) {
      issue(`Relative JavaScript import target '${imported.value}' cannot be emitted from an inline block; combine the source into this block or move it into a package`, imported.node);
    } else {
      dependencies.push({ source: imported.value, span: absolute(imported.node), dynamic: true });
    }
  }

  if (checked && containsTopLevelAwait(program)) {
    issue("A captured inline JavaScript block cannot use top-level await; captures are passed to a synchronous factory, and an async factory has not been specified", firstTopLevelAwait(program) ?? program);
  }

  return { exports, imports, dependencies, bindings, factoryEdits, issues };
}

function rejectRelativeEmbeddedModuleSource(
  source: { readonly value?: unknown; readonly start: number; readonly end: number },
  issue: (message: string, node: Pick<Node, "start" | "end">) => void,
): void {
  if (typeof source.value !== "string" || !source.value.startsWith(".")) return;
  issue(`Relative JavaScript import target '${source.value}' cannot be emitted from an inline block; combine the source into this block or move it into a package`, source);
}

function dynamicImportSources(program: Program): readonly {
  readonly value: string | null;
  readonly node: AnyNode;
}[] {
  const found: { value: string | null; node: AnyNode }[] = [];
  const visit = (node: AnyNode): void => {
    if (node.type === "ImportExpression") {
      const source = (node as AnyNode & { readonly source?: unknown }).source;
      if (isNode(source)) {
        const literal = source as AnyNode & {
          readonly value?: unknown;
          readonly expressions?: readonly unknown[];
          readonly quasis?: readonly { readonly value?: { readonly cooked?: unknown } }[];
        };
        const value = typeof literal.value === "string"
          ? literal.value
          : literal.type === "TemplateLiteral" && literal.expressions?.length === 0
            && typeof literal.quasis?.[0]?.value?.cooked === "string"
            ? literal.quasis[0].value.cooked
            : null;
        found.push({ value, node: source });
      } else {
        found.push({ value: null, node });
      }
      return;
    }
    for (const [key, value] of Object.entries(node)) {
      if (key === "loc" || key === "range" || key === "start" || key === "end") continue;
      if (isNode(value)) visit(value);
      else if (Array.isArray(value)) for (const item of value) if (isNode(item)) visit(item);
    }
  };
  visit(program);
  return found;
}

function inspectNamedExport(
  statement: ExportNamedDeclaration,
  checked: boolean,
  addExport: (name: Identifier | { readonly value?: unknown; readonly start: number; readonly end: number }, local: Identifier | { readonly value?: unknown; readonly start: number; readonly end: number }) => void,
  issue: (message: string, node: Pick<Node, "start" | "end">) => void,
  factoryEdits: EmbeddedJavaScriptFactoryEdit[],
  absolute: (node: Pick<Node, "start" | "end">) => Span,
): void {
  if (statement.source && checked) {
    issue("A captured inline JavaScript block cannot re-export from another module; import the value normally, then export its local binding", statement);
  }
  if (statement.declaration) {
    for (const binding of declarationBindings(statement.declaration)) addExport(binding, binding);
    if (checked) {
      factoryEdits.push({
        span: span(absolute(statement).start, absolute(statement.declaration).start),
        replacement: "",
      });
    }
    return;
  }
  for (const specifier of statement.specifiers) addExport(specifier.exported, specifier.local);
  if (checked && !statement.source) factoryEdits.push({ span: absolute(statement), replacement: "" });
}

function inspectExportAll(
  statement: ExportAllDeclaration,
  checked: boolean,
  addExport: (name: Identifier | { readonly value?: unknown; readonly start: number; readonly end: number }, local: Identifier | { readonly value?: unknown; readonly start: number; readonly end: number }) => void,
  issue: (message: string, node: Pick<Node, "start" | "end">) => void,
): void {
  if (!statement.exported) {
    issue("An inline JavaScript block cannot use bare 'export *'; its exports must be statically enumerable", statement);
    return;
  }
  if (checked) {
    issue("A captured inline JavaScript block cannot re-export a namespace; import it normally, then export its local binding", statement);
    return;
  }
  addExport(statement.exported, statement.exported);
}

function declarationBindings(declaration: Declaration): readonly Identifier[] {
  switch (declaration.type) {
    case "FunctionDeclaration":
    case "ClassDeclaration":
      return [declaration.id];
    case "VariableDeclaration":
      return declaration.declarations.flatMap((item) => patternBindings(item.id));
  }
}

/**
 * Every name this top-level statement contributes to the module scope. The
 * lexical half is the statement's own declaration; the other half is `var`,
 * which is function-scoped and therefore module-scoped from wherever below the
 * statement it is written.
 */
function topLevelStatementBindings(statement: Program["body"][number]): readonly Identifier[] {
  const lexical = lexicalStatementBindings(statement);
  const hoisted = hoistedVariableBindings(statement).filter((binding) => !lexical.includes(binding));
  return hoisted.length === 0 ? lexical : [...lexical, ...hoisted];
}

function lexicalStatementBindings(statement: Program["body"][number]): readonly Identifier[] {
  if (statement.type === "FunctionDeclaration" || statement.type === "ClassDeclaration" || statement.type === "VariableDeclaration") {
    return declarationBindings(statement);
  }
  if (statement.type === "ExportNamedDeclaration" && statement.declaration) return declarationBindings(statement.declaration);
  if (statement.type === "ExportDefaultDeclaration"
    && (statement.declaration.type === "FunctionDeclaration" || statement.declaration.type === "ClassDeclaration")
    && statement.declaration.id) return [statement.declaration.id];
  return [];
}

/**
 * The `var` names a top-level statement hoists into module scope. A `var`
 * inside a block, `if`, loop, `try`, `switch` case, or label is not a nested
 * binding: once the checked body is wrapped in `function factory(capture) {…}`
 * it merges with the factory parameter of the same name and silently discards
 * the captured value, which is exactly what the capture collision guard exists
 * to refuse. The walk therefore descends through statements and stops where a
 * new `var` scope opens — any function body and a class static block.
 */
function hoistedVariableBindings(statement: Program["body"][number]): readonly Identifier[] {
  const found: Identifier[] = [];
  const visit = (node: AnyNode): void => {
    if (node.type === "FunctionDeclaration" || node.type === "FunctionExpression"
      || node.type === "ArrowFunctionExpression" || node.type === "StaticBlock") return;
    if (node.type === "VariableDeclaration" && node.kind === "var") found.push(...declarationBindings(node));
    for (const [key, value] of Object.entries(node)) {
      if (key === "loc" || key === "range" || key === "start" || key === "end") continue;
      if (isNode(value)) visit(value);
      else if (Array.isArray(value)) for (const item of value) if (isNode(item)) visit(item);
    }
  };
  visit(statement);
  return found;
}

function patternBindings(pattern: Pattern): readonly Identifier[] {
  switch (pattern.type) {
    case "Identifier": return [pattern];
    case "ObjectPattern": return pattern.properties.flatMap((property) => property.type === "RestElement" ? patternBindings(property.argument) : patternBindings(property.value));
    case "ArrayPattern": return pattern.elements.flatMap((element) => element ? patternBindings(element) : []);
    case "RestElement": return patternBindings(pattern.argument);
    case "AssignmentPattern": return patternBindings(pattern.left);
    case "MemberExpression": return [];
  }
}

function nodeName(node: Identifier | { readonly value?: unknown }): string {
  if ("name" in node && typeof node.name === "string") return node.name;
  return "value" in node && typeof node.value === "string" ? node.value : "";
}

function containsTopLevelAwait(program: Program): boolean {
  return firstTopLevelAwait(program) !== null;
}

function firstTopLevelAwait(program: Program): AnyNode | null {
  const visit = (node: AnyNode): AnyNode | null => {
    if (node.type === "AwaitExpression" || (node.type === "ForOfStatement" && node.await)) return node;
    if (node.type === "FunctionDeclaration" || node.type === "FunctionExpression" || node.type === "ArrowFunctionExpression") return null;
    for (const [key, value] of Object.entries(node)) {
      if (key === "loc" || key === "range" || key === "start" || key === "end") continue;
      if (isNode(value)) {
        const found = visit(value);
        if (found) return found;
      } else if (Array.isArray(value)) {
        for (const item of value) {
          if (!isNode(item)) continue;
          const found = visit(item);
          if (found) return found;
        }
      }
    }
    return null;
  };
  return visit(program);
}

function isNode(value: unknown): value is AnyNode {
  return typeof value === "object" && value !== null
    && typeof (value as Partial<Node>).type === "string"
    && typeof (value as Partial<Node>).start === "number"
    && typeof (value as Partial<Node>).end === "number";
}

/**
 * D53's terminator is structural: a line holding nothing but a backtick at the
 * declaration's indentation ends the block, whatever the JavaScript around it
 * means. A multi-line construct whose own text contains such a line therefore
 * loses everything after it, and Acorn's bare "Unterminated template" names
 * the symptom without naming the rule that caused it.
 *
 * The hint states that rule as a *condition* rather than as a fact about this
 * block, because nothing reaching this function can tell the two causes apart.
 * The payload stops at the terminator whenever the block closed, so a literal
 * truncated by the terminator and a literal the author simply never closed
 * arrive here identical, and a block that never closed at all arrives with the
 * rest of the module as its payload. An earlier wording asserted "this block
 * ends at the first line holding nothing but a backtick" and told the author to
 * indent it: false for an ordinary unclosed literal, where no such backtick
 * exists, and directly opposed to the VEL1003 an unterminated block already
 * reports, which correctly asks for a backtick alone at that indentation. A
 * conditional is true in all three shapes and contradicts none of them.
 *
 * An unterminated string constant is left alone: a JavaScript string cannot
 * hold a raw line break, so the terminator, which only ever removes whole
 * lines, is not a plausible cause of one.
 *
 * Acorn's message alone covers only the literal whose *closing* backtick was
 * eaten. When the *opening* backtick is the line that sits alone, the payload
 * stops before the literal starts and Acorn reports a bare "Unexpected token"
 * that names nothing. `templateWouldComplete` decides that case structurally
 * rather than by message text: it re-parses the payload with an empty template
 * literal appended at the truncation point, so the hint is offered exactly when
 * a template opening there would have made the payload parse. That is the same
 * question the author is asking, and it stays off for the truncations a
 * terminator cannot explain — a missing `}` or `)`, a dangling `.`, an open
 * call — because no template completes those either.
 */
function structuralTerminatorHint(message: string, source: string): string {
  if (message.startsWith("Unterminated template")) {
    return " — a line holding nothing but a backtick at the declaration's indentation is this block's terminator, whatever the JavaScript around it means; if this literal was meant to continue past such a line, the block ended there instead, so indent that backtick or write it at the end of a content line";
  }
  if (message.startsWith("Unterminated comment")) {
    return " — a line holding nothing but a backtick at the declaration's indentation is this block's terminator, whatever the JavaScript around it means; if this comment was meant to continue past such a line, the block ended there instead of commenting it out, so indent that backtick or take it out of the comment";
  }
  if (templateWouldComplete(source)) {
    return " — a line holding nothing but a backtick at the declaration's indentation is this block's terminator, whatever the JavaScript around it means; if a template literal was meant to open on such a line, the block ended there instead, so indent that backtick or write it at the end of the line before it";
  }
  return "";
}

/** Whether a template literal written where this payload stops would have completed it. */
function templateWouldComplete(source: string): boolean {
  try {
    parse(`${source}\`\``, { ecmaVersion: "latest", sourceType: "module" });
    return true;
  } catch {
    return false;
  }
}

function syntaxErrorPosition(error: unknown): number {
  if (typeof error !== "object" || error === null || !("pos" in error)) return 0;
  const position = (error as { readonly pos?: unknown }).pos;
  return typeof position === "number" && Number.isSafeInteger(position) && position >= 0 ? position : 0;
}

function readWord(source: string, start: number, limit: number): { readonly value: string; readonly end: number } | null {
  if (!/[A-Za-z_$]/u.test(source[start] ?? "")) return null;
  let end = start + 1;
  while (end < limit && /[A-Za-z0-9_$]/u.test(source[end] ?? "")) end += 1;
  return { value: source.slice(start, end), end };
}

function skipHorizontalWhitespace(source: string, start: number, limit: number): number {
  while (start < limit && (source[start] === " " || source[start] === "\t")) start += 1;
  return start;
}

function previousLineStart(source: string, index: number): number {
  while (index > 0 && source[index - 1] !== "\n" && source[index - 1] !== "\r") index -= 1;
  return index;
}
