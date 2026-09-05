/**
 * A17: a List literal used as a tuple. A List holds one element type, so a
 * mixed literal publishes a union and every value read back out of it is that
 * union; the record is the spelling this language has for a fixed group of
 * differently typed values.
 *
 * D115 §三 / D114 R1f: one family of `advisories.ts`.
 */
import { type Expression } from "../../ast.ts";
import { type Span } from "../../source.ts";
import { describeType, type ValueType } from "../../types.ts";
import { type AdvisoryHost } from "./roster.ts";

export class TupleAdvisories {
  private readonly host: AdvisoryHost;

  constructor(host: AdvisoryHost) {
    this.host = host;
  }

  /**
   * D114 ⑤ — A17: Python's `return a, b` and JavaScript's `return [a, b]` both
   * land here as a List literal whose elements are of different types. Vel
   * accepts it and types it `List<string | number>`, so the author does not
   * learn anything until a member read three lines later reports "no common
   * field". The record is the spelling this language has for a fixed group of
   * differently typed values, and it gives each value a name.
   *
   * The admission is deliberately narrow, at D89's near-zero-false-positive
   * bar. Two or more written elements, every one of them in a primitive
   * category — string, number, bool, or enum — and at least two different
   * categories among them. A `null` element is ignored rather than counted:
   * `["a", null]` is a `List<string?>`, which is one element type. Anything
   * else in the literal — a spread, a record, a class, a collection, a
   * function, a union, `unknown` — keeps the whole literal silent, because a
   * heterogeneous list of records is a real data shape and this advisory may
   * not guess. Two different enums are one category, so `[Kind.a, Status.b]`
   * is silent as well.
   *
   * The literal must also stand where nothing declared its element type. An
   * annotated binding, a declared result, an annotated field, and an argument
   * to a `List<string | number>` parameter all arrive here with a contextual
   * type: the author wrote the union, and the advisory has nothing to say. An
   * unannotated binding, a body-inferred `return`, and an arrow body with no
   * contextual function type arrive with none.
   *
   * There is no mechanical fix. The rewrite has to invent a field name for
   * each value, which is a judgement, exactly as A7's is.
   */
  adviseTupleShapedListLiteral(
    expression: Extract<Expression, { kind: "ListExpression" }>,
    contextualType: ValueType,
    writtenElementTypes: readonly ValueType[],
    element: ValueType,
  ): void {
    if (contextualType.kind !== "unknown" || contextualType.boundary === true) return;
    if (expression.elements.length < 2 || writtenElementTypes.length !== expression.elements.length) return;

    const categories = new Set<string>();
    for (const type of writtenElementTypes) {
      const category = this.tupleElementCategory(type);
      if (category === null) return;
      if (category !== "") categories.add(category);
    }
    if (categories.size < 2) return;

    const quoted = this.boundedSourceQuote(expression.span);
    const record = this.tupleRecordSpelling(expression, writtenElementTypes);
    this.host.advise(
      "A17",
      `A List holds one element type, so every value read back out of ${quoted} is '${describeType(element)}'. VelarScript spells a fixed group of differently typed values as a record, which gives each one a name — ${record === null ? "write '{name: value, ...}' with a field per value" : `write '${record}'`}, or declare a type for it`,
      expression.span,
    );
  }

  /**
   * A17's element classification. Answers the primitive category an element
   * contributes, `""` for an element that is ignored (`null`, and the `null`
   * arm of an optional), and `null` for one that keeps the whole literal
   * silent.
   */
  private tupleElementCategory(type: ValueType): string | null {
    const expanded = this.host.expandAliases(type);
    if (expanded.kind === "optional") return this.tupleElementCategory(expanded.inner);
    switch (expanded.kind) {
      case "null": return "";
      case "string": return "string";
      case "number": return "number";
      case "bool": return "bool";
      case "enum":
      case "enumMember": return "enum";
      default: return null;
    }
  }

  /** The record an A17 literal would be written as, or null when it is too long to quote. */
  private tupleRecordSpelling(
    expression: Extract<Expression, { kind: "ListExpression" }>,
    writtenElementTypes: readonly ValueType[],
  ): string | null {
    const names: string[] = [];
    for (const [index, item] of expression.elements.entries()) {
      const name = this.tupleFieldName(item, writtenElementTypes[index]!);
      names.push(names.includes(name) ? `${name}${index + 1}` : name);
    }
    const entries = expression.elements.map((item, index) => {
      const written = this.host.sourceText.slice(item.span.start, item.span.end);
      return written.includes("\n") || written.includes("//") || written.includes("/*") ? null : `${names[index]}: ${written}`;
    });
    if (entries.some((entry) => entry === null)) return null;
    const spelling = `{${entries.join(", ")}}`;
    return spelling.length > 72 ? null : spelling;
  }

  /** The field name a value suggests: the name it already reads, else its category. */
  private tupleFieldName(item: Expression, type: ValueType): string {
    if (item.kind === "IdentifierExpression") return item.name;
    if (item.kind === "MemberExpression" && !item.optional) return item.property;
    if (item.kind === "CallExpression" && !item.optional && item.callee.kind === "MemberExpression" && !item.callee.optional) {
      return item.callee.property;
    }
    const category = this.tupleElementCategory(type);
    return category === "string" ? "text" : category === "number" ? "count" : category === "bool" ? "flag" : "value";
  }

  /** One written expression, quoted for a message and clipped when it runs long. */
  private boundedSourceQuote(quoted: Span): string {
    const written = this.host.sourceText.slice(quoted.start, quoted.end).replaceAll(/\s+/gu, " ").trim();
    return written.length === 0 ? "this literal"
      : written.length > 60 ? `'${written.slice(0, 59)}…'`
        : `'${written}'`;
  }
}
