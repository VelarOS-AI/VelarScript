/**
 * The JavaScript the emitter writes about itself: the marker that ties an
 * emitted node to its authoring span, the shapes the source map and the
 * embedded-JavaScript modules are carried in, the two depth and self-reference
 * constants the runtime `Type` emission is bounded by, and the small renderers
 * every family shares.
 *
 * D114 R1c: these were module-level declarations in `emitter.ts`. They are pure
 * — they read no emitter state — and both `emitter.ts` and its collaborators
 * use them, so they live where neither has to import the other.
 */
import type { EmbeddedJavaScriptDeclaration, Expression, ExternModuleContract } from "../ast.ts";
import { type Span } from "../source.ts";

export interface JavaScriptNode {
  readonly id: number;
  readonly code: string;
  readonly sourceSpan: Span;
}

export interface GeneratedMapping {
  readonly offset: number;
  readonly sourceSpan: Span;
}

export interface PreparedEmbeddedJavaScriptModule {
  readonly statement: EmbeddedJavaScriptDeclaration;
  readonly specifier: `./${string}.js`;
  readonly factoryName: string | null;
  readonly localFactoryName: string | null;
  readonly code: string;
  readonly mappings: readonly GeneratedMapping[];
}

export const javaScriptNodeMarker = /\u0000VELAR_MAP_(\d+)\u0000/gu;

export /**
 * How deep a structural record's inline field proof nests before it degrades
 * to the presence test. A generated validator recurses through a function
 * call; an expression can only recurse by growing, so the depth is what keeps
 * a deeply nested (or self-referential) structural type from expanding without
 * bound.
 */
const maximumStructuralFieldDepth = 4;

export /**
 * D90 rule R5: the placeholder a container's copy plan carries where its own
 * identity goes, until interning has decided the name that identity is spelled
 * with. A container's plan is both the callback it hands the runtime helper
 * and the key that helper's memo files the copy under, so the body has to name
 * itself before it has a name.
 */
const copyPlanSelfReference = "__velarCopyPlanSelf";

export // ENM-U4 + COL-U5: the compiler-raised error types are nameable in source;
// their runtime classes carry compiler-owned names. The source names are
// reserved Core bindings, so a bare reference is always the builtin.
const builtinErrorRuntimeNames: ReadonlyMap<string, string> = new Map([
  ["ValidationError", "__VelarValidationError"],
  ["AssertionError", "__VelarAssertionError"],
  ["NarrowingError", "__VelarNarrowingError"],
  ["IndexError", "__VelarIndexError"],
]);

export /** The member-read suffix for a field name: a dot when the name is spellable, a subscript otherwise. */
function javaScriptMemberAccess(name: string): string {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/u.test(name) ? `.${name}` : `[${JSON.stringify(name)}]`;
}

export function mappedSource(source: string, sourceStart: number): { readonly code: string; readonly mappings: readonly GeneratedMapping[] } {
  const mappings: GeneratedMapping[] = source.length > 0
    ? [{ offset: 0, sourceSpan: { start: sourceStart, end: sourceStart + 1 } }]
    : [];
  for (let index = 0; index < source.length; index += 1) {
    if (source[index] !== "\n" || index + 1 >= source.length) continue;
    mappings.push({
      offset: index + 1,
      sourceSpan: { start: sourceStart + index + 1, end: sourceStart + index + 2 },
    });
  }
  return { code: source, mappings };
}

export /** The names a checked block's contract publishes into VelarScript scope. */
function contractExportNames(contract: ExternModuleContract): ReadonlySet<string> {
  return new Set([
    ...contract.functions.map((item) => item.name),
    ...contract.constants.map((item) => item.name),
    ...contract.classes.map((item) => item.name),
  ]);
}

export function emitCheckedEmbeddedJavaScript(
  statement: EmbeddedJavaScriptDeclaration,
  factoryName: string,
): { readonly code: string; readonly mappings: readonly GeneratedMapping[] } {
  const relative = (value: Span): Span => ({
    start: value.start - statement.sourceSpan.start,
    end: value.end - statement.sourceSpan.start,
  });
  const blank = (value: string): string => value.replace(/[^\r\n]/gu, " ");
  const body = [...statement.factoryEdits]
    .sort((left, right) => right.span.start - left.span.start)
    .reduce((current, edit) => {
      const target = relative(edit.span);
      const replacement = edit.replacement + blank(current.slice(target.start + edit.replacement.length, target.end));
      return `${current.slice(0, target.start)}${replacement}${current.slice(target.end)}`;
    }, statement.source);

  let code = "";
  const mappings: GeneratedMapping[] = [];
  const appendMapped = (value: string, absoluteStart: number): void => {
    const mapped = mappedSource(value, absoluteStart);
    const offset = code.length;
    code += value;
    mappings.push(...mapped.mappings.map((mapping) => ({ ...mapping, offset: offset + mapping.offset })));
  };
  for (const imported of statement.imports) {
    const target = relative(imported.span);
    appendMapped(statement.source.slice(target.start, target.end), imported.span.start);
    if (!code.endsWith("\n") && !code.endsWith("\r")) code += "\n";
  }
  code += `export function ${factoryName}(${statement.captures.map((capture) => capture.name).join(", ")}) {\n`;
  appendMapped(body, statement.sourceSpan.start);
  if (code.length > 0 && !code.endsWith("\n") && !code.endsWith("\r")) code += "\n";
  const entries = statement.exports.map((item) => `${JSON.stringify(item.name)}: ${item.local}`).join(", ");
  code += `return { ${entries} };\n}\n`;
  return { code, mappings };
}

export /**
 * The source-shaped name a failed `value!` reports. Dotted paths, indexes, and
 * calls read back the way the author wrote them; anything else reports as a
 * plain value, since the source offset beside it already locates the unwrap.
 */
function requiredValueDescription(expression: Expression): string {
  switch (expression.kind) {
    case "IdentifierExpression":
      return `'${expression.name}'`;
    case "MemberExpression": {
      const owner = requiredValueDescription(expression.object);
      return owner.startsWith("'") ? `'${owner.slice(1, -1)}${expression.optional ? "?." : "."}${expression.property}'` : `'${expression.property}'`;
    }
    case "IndexExpression": {
      const owner = requiredValueDescription(expression.object);
      return owner.startsWith("'") ? `'${owner.slice(1, -1)}[...]'` : "a value";
    }
    case "CallExpression": {
      const callee = requiredValueDescription(expression.callee);
      return callee.startsWith("'") ? `'${callee.slice(1, -1)}(...)'` : "a call result";
    }
    default:
      return "a value";
  }
}
