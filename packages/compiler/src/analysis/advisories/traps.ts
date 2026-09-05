/**
 * A2 and A3: the two loop-and-operator reflexes whose Vel spelling means
 * something else. Both are pure Python habits — the `enumerate` slot order and
 * the sign of `%` — and neither is an error, because Vel accepts the spelling
 * and simply answers differently.
 *
 * D115 §三 / D114 R1f: one family of `advisories.ts`, which grew past the
 * 800-line budget when A8 arrived.
 */
import { type Expression, type ForStatement } from "../../ast.ts";
import { mechanicalEdits } from "../../diagnostic.ts";
import { type ValueType } from "../../types.ts";
import { span, type Span } from "../../source.ts";
import { loopIndexSlotNames, loopValueSlotNames, singularIterableName, type AdvisoryHost } from "./roster.ts";

export class AdvisoryTraps {
  private readonly host: AdvisoryHost;

  constructor(host: AdvisoryHost) {
    this.host = host;
  }

  /**
   * D89 A2: the two-slot `for` over a List, Set, or string binds
   * `value, index`, which matches JavaScript's `forEach((v, i) => …)` and
   * inverts Python's `enumerate`. Python's own spelling is already a loud
   * error, so nothing silent comes from it; the silence happens when a model
   * writes `for i, v in nums`, a hybrid neither language has, and both names
   * quietly hold the other one's value.
   *
   * Both rosters must hit. One name alone proves nothing — `for index, total
   * in scores` may be counting exactly what it says — and a wrong guess here
   * would tell a correct author to break working code. The value slot also
   * accepts the singular of the collection's own name, because `for i, user
   * in users` is the same reflex spelled from the data instead of a letter.
   */
  adviseSwappedLoopSlots(statement: ForStatement, iterable: ValueType): void {
    if (iterable.kind !== "list" && iterable.kind !== "set" && iterable.kind !== "string") return;
    const indexSlot = statement.pattern;
    const valueSlot = statement.secondPattern;
    if (indexSlot.kind !== "NameBindingPattern" || valueSlot?.kind !== "NameBindingPattern") return;
    if (!loopIndexSlotNames.has(indexSlot.name)) return;
    if (!loopValueSlotNames.has(valueSlot.name) && valueSlot.name !== singularIterableName(statement.iterable)) return;
    this.host.advise(
      "A2",
      `A two-slot 'for' binds 'value, index', so '${indexSlot.name}' receives the element and '${valueSlot.name}' receives the position; write 'for ${valueSlot.name}, ${indexSlot.name} in ...' to bind them the way the names read`,
      span(indexSlot.span.start, valueSlot.span.end),
      mechanicalEdits(
        [{ span: indexSlot.span, text: valueSlot.name }, { span: valueSlot.span, text: indexSlot.name }],
        `Swap '${indexSlot.name}' and '${valueSlot.name}'`,
      ),
    );
  }

  /**
   * D89 A3: `%` follows JavaScript and keeps the dividend's sign, so `-7 % 3`
   * is `-1` where Python answers `2`. Nothing here reports an error — both
   * languages accept the spelling, they just disagree about the result.
   *
   * Only a literal negative dividend triggers. A variable's sign is not
   * knowable, and advising every `%` whose left side might go negative would
   * be the noise the tier exists to avoid. The shape matched is a unary minus
   * wrapping a numeric literal, because that is what `-7` parses as; there is
   * no negative-valued literal for a value test to find.
   *
   * The admission bar is "Vel accepts the spelling as a different meaning", so
   * every shape whose two answers are the same is silent rather than advised:
   * a remainder of zero (`-6 % 3`) agrees, `% 0` answers NaN here and raises
   * in Python so there is no Python answer to name, and a non-finite dividend
   * answers NaN on both sides. A message that states a disagreement and then
   * prints the same number twice is a new defect, not a weaker advisory.
   */
  adviseNegativeLiteralModulo(leftExpression: Expression, rightExpression: Expression, operationSpan: Span): void {
    if (leftExpression.kind !== "UnaryExpression" || leftExpression.operator !== "-") return;
    const dividend = leftExpression.operand;
    if (dividend.kind !== "LiteralExpression" || typeof dividend.value !== "number") return;
    const divisor = rightExpression.kind === "LiteralExpression" && typeof rightExpression.value === "number"
      ? rightExpression
      : null;
    if (divisor !== null) {
      const divisorValue = Number(divisor.value);
      if (divisorValue === 0) return;
      // `-0` renders as `0`, so a zero remainder would print one number on
      // both sides of a sentence claiming they differ.
      const remainder = -Number(dividend.value) % divisorValue;
      if (!Number.isFinite(remainder) || remainder === 0) return;
      // A literal divisor is always positive — a negative one parses as a
      // unary minus, not a literal — so Python's answer, which takes the
      // divisor's sign, is this remainder lifted by one divisor.
      const python = remainder + divisorValue;
      // The rewrite the message advertises is its own remedy, so quoting an
      // answer that rewrite does not produce would be false. The two part ways
      // only when the lift rounds back onto the divisor; the general sentence
      // below covers that without naming a number.
      if ((remainder + divisorValue) % divisorValue === python) {
        this.host.advise(
          "A3",
          `VelarScript's '%' follows JavaScript and keeps the dividend's sign, so '-${dividend.raw} % ${divisor.raw}' is ${remainder} where Python answers ${python}; write '((a % b) + b) % b' for the Python answer`,
          operationSpan,
        );
        return;
      }
    }
    this.host.advise(
      "A3",
      "VelarScript's '%' follows JavaScript and keeps the dividend's sign, so a negative dividend leaves a remainder that is negative or zero, where Python's takes the divisor's sign; write '((a % b) + b) % b' for the Python answer",
      operationSpan,
    );
  }
}
