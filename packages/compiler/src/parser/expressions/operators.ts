/**
 * The expression grammar between a primary and a statement: precedence
 * climbing over the binary operators, the comparison chain, `not`/`-`/`await`
 * and the other prefixes, `**`, the conditional forms, and arrow functions —
 * including the two lookaheads that tell an arrow's parameter list from a
 * parenthesized expression and an arrow's `{` from a record literal.
 */
import type { ArrowFunctionExpression, BinaryExpression, ComparisonChainExpression, Expression, Parameter, Statement, TypeReference } from "../../ast.ts";
import { diagnostic, mechanicalFix, recoveredDiagnostic, type Diagnostic } from "../../diagnostic.ts";
import { span, type Span } from "../../source.ts";
import { type Token, type TokenKind } from "../../token.ts";
import { binaryPrecedence, comparisonOperators, recordFieldLevelKinds, statementStarterKinds, statementStarterWords } from "../tokens.ts";

export interface OperatorParserHost {
  advance(): Token;
  check(kind: TokenKind): boolean;
  contextualParameterDepth: number;
  current(): Token;
  readonly diagnostics: Diagnostic[];
  expect(kind: TokenKind, message: string): Token;
  index: number;
  match(kind: TokenKind): boolean;
  parseExpression(minimumPrecedence?: number): Expression;
  parseParameters(): readonly Parameter[];
  parsePostfix(): Expression;
  parseTypeReference(allowTrailingOptional?: boolean): TypeReference;
  peekKind(distance: number): TokenKind;
  previous(): Token;
  recoverExpressionAssignment(expression: Expression): Expression;
  reportPrefixBang(bang: Token): void;
  readonly tokens: Token[];
  withParseDepth<T>(parse: () => T): T;
}

export class OperatorParser {
  private readonly host: OperatorParserHost;

  constructor(host: OperatorParserHost) {
    this.host = host;
  }

  parseExpressionBody(minimumPrecedence = 0): Expression {
    const asynchronousArrow = minimumPrecedence === 0
      && this.host.check("async")
      && ((this.host.peekKind(1) === "leftParen" && this.isParenthesizedArrow(1))
        || (this.host.peekKind(1) === "identifier" && this.host.peekKind(2) === "fatArrow"));
    if (asynchronousArrow) {
      const start = this.host.advance().span.start;
      return this.parseArrowExpression(start, true);
    }
    if (minimumPrecedence === 0 && this.host.check("leftParen") && this.isParenthesizedArrow()) {
      return this.parseArrowExpression(this.host.current().span.start, false);
    }
    if (minimumPrecedence === 0 && this.host.check("identifier") && this.host.peekKind(1) === "fatArrow") {
      return this.parseArrowExpression(this.host.current().span.start, false);
    }

    let left = this.parseUnary();

    while (true) {
      const javaScriptInstanceof = this.host.check("identifier") && this.host.current().value === "instanceof";
      const compoundNotIn = this.host.check("not") && this.host.peekKind(1) === "in";
      const precedence = javaScriptInstanceof
        ? binaryPrecedence.is
        : compoundNotIn
          ? binaryPrecedence.in
          : binaryPrecedence[this.host.current().kind];
      if (precedence === undefined || precedence < minimumPrecedence) {
        break;
      }

      const operator = this.host.advance();
      if (compoundNotIn) this.host.advance();
      const comparisonOperator = comparisonOperators[operator.kind];
      const membershipOrTypeTest = compoundNotIn || operator.kind === "in" || operator.kind === "is" || javaScriptInstanceof;
      if (this.isUnparenthesizedComparisonLayer(left)
        && (membershipOrTypeTest || this.isMembershipOrTypeTest(left))) {
        this.host.diagnostics.push(diagnostic(
          "VEL2031",
          "Parenthesize an 'in' or 'is' test used inside another comparison, or split the tests with 'and'",
          operator.span,
        ));
      }
      if (comparisonOperator) {
        left = this.parseComparisonChain(left, comparisonOperator, precedence);
        continue;
      }
      if (operator.kind === "is" || javaScriptInstanceof) {
        left = this.parseTypeTest(left, operator, javaScriptInstanceof);
        continue;
      }

      let binaryLeft = left;
      let prefixNotIn = false;
      if (operator.kind === "in" && !compoundNotIn
        && left.kind === "UnaryExpression" && left.operator === "not") {
        prefixNotIn = true;
        this.host.diagnostics.push(recoveredDiagnostic(
          "VEL2031",
          "Use 'x not in y'; 'not x in y' puts 'not' on the wrong operand",
          span(left.span.start, operator.span.end),
        ));
        binaryLeft = left.operand;
      }
      const right = this.host.parseExpression(precedence + 1);
      const spelledOperator = compoundNotIn || prefixNotIn ? "not in" : this.binaryOperator(operator);
      this.checkNullishBooleanMixing(spelledOperator, binaryLeft, right, operator.span);
      left = {
        kind: "BinaryExpression",
        left: binaryLeft,
        operator: spelledOperator,
        right,
        span: span(binaryLeft.span.start, right.span.end),
      } satisfies BinaryExpression;
    }

    if (minimumPrecedence === 0 && this.host.match("question")) {
      const thenValue = this.host.parseExpression();
      this.host.expect("colon", "Expected ':' in conditional expression");
      const elseValue = this.host.parseExpression();
      return { kind: "ConditionalExpression", condition: left, thenValue, elseValue, span: span(left.span.start, elseValue.span.end) };
    }

    if (minimumPrecedence === 0 && this.host.check("if") && this.hasPythonConditionalElse()) {
      // 'x if cond else y' guides to the '?:' spelling and recovers as the
      // equivalent conditional expression so deeper guidance still surfaces.
      this.host.diagnostics.push(recoveredDiagnostic(
        "VEL2027",
        "Use 'cond ? x : y'; VelarScript writes conditional expressions with '?:', not 'x if cond else y'",
        this.host.current().span,
      ));
      this.host.advance();
      const condition = this.host.parseExpression();
      this.host.expect("else", "Expected 'else' in a conditional expression");
      const elseValue = this.host.parseExpression();
      return { kind: "ConditionalExpression", condition, thenValue: left, elseValue, span: span(left.span.start, elseValue.span.end) };
    }

    return left;
  }

  // True when an expression is followed by Python's 'x if cond else y'
  // conditional shape: an 'if' whose matching 'else' appears at the same
  // bracket depth before the expression context can end. Statement-level if
  // blocks never reach this check, and 'for x in xs if cond:' style filters
  // (no 'else') are left to ordinary parse errors.
  private hasPythonConditionalElse(): boolean {
    let depth = 0;
    for (let offset = 1; this.host.index + offset < this.host.tokens.length; offset += 1) {
      const kind = this.host.peekKind(offset);
      if (kind === "leftParen" || kind === "leftBracket" || kind === "leftBrace") depth += 1;
      else if (kind === "rightParen" || kind === "rightBracket" || kind === "rightBrace") {
        if (depth === 0) return false;
        depth -= 1;
      } else if (depth === 0 && kind === "else") return true;
      else if (depth === 0 && (kind === "colon" || kind === "comma")) return false;
      else if (kind === "newline" || kind === "indent" || kind === "dedent" || kind === "eof") return false;
    }
    return false;
  }

  /**
   * A comparison chain: `a < b < c` is one expression with three operands, not
   * two nested binaries, so the whole run of comparison operators is read here
   * and collapses back to a plain `BinaryExpression` when only one was written.
   */
  private parseComparisonChain(left: Expression, comparisonOperator: ComparisonChainExpression["operators"][number], precedence: number): Expression {
    const operands: Expression[] = [left];
    const operators: ComparisonChainExpression["operators"][number][] = [];
    let nextOperator: ComparisonChainExpression["operators"][number] | undefined = comparisonOperator;
    while (nextOperator) {
      operators.push(nextOperator);
      operands.push(this.host.parseExpression(precedence + 1));
      nextOperator = comparisonOperators[this.host.current().kind];
      if (nextOperator) this.host.advance();
    }
    if (operators.length > 1) {
      if (operators.some((item) => item === "==" || item === "!=")) {
        this.host.diagnostics.push(diagnostic(
          "VEL2031",
          "Equality comparisons do not chain; split the comparisons with 'and'",
          span(operands[0]!.span.start, operands.at(-1)!.span.end),
        ));
      } else {
        const ascending = operators.every((item) => item === "<" || item === "<=");
        const descending = operators.every((item) => item === ">" || item === ">=");
        if (!ascending && !descending) {
          this.host.diagnostics.push(diagnostic(
            "VEL2031",
            "Comparison chains must point one way; split the comparisons with 'and'",
            span(operands[0]!.span.start, operands.at(-1)!.span.end),
          ));
        }
      }
    }
    return operators.length === 1
      ? {
          kind: "BinaryExpression",
          left: operands[0]!,
          operator: operators[0]!,
          right: operands[1]!,
          span: span(operands[0]!.span.start, operands[1]!.span.end),
        } satisfies BinaryExpression
      : {
          kind: "ComparisonChainExpression",
          operands,
          operators,
          span: span(operands[0]!.span.start, operands.at(-1)!.span.end),
        } satisfies ComparisonChainExpression;
  }

  /**
   * A type test: `value is Type`, `value is not Type`, and the JavaScript
   * `instanceof` spelling recovered as the `is` it meant.
   */
  private parseTypeTest(left: Expression, operator: Token, javaScriptInstanceof: boolean): Expression {
    if (javaScriptInstanceof) {
      this.host.diagnostics.push(recoveredDiagnostic(
        "VEL2031",
        "Use 'is' for a type test; VelarScript does not expose JavaScript 'instanceof'",
        operator.span,
        mechanicalFix(operator.span, "is", "Use 'is' for the type test"),
      ));
    }
    const negated = this.host.match("not");
    // 'is' tests runtime types and 'null' is a value, so 'is [not] null'
    // is the removed spelling of the equality test. Recovery builds the
    // '== null' / '!= null' comparison itself, so narrowing and every
    // later stage still run, and a '?' after the test keeps meaning '?:'
    // instead of being read as an optional-type marker.
    if (this.host.check("null") && this.host.peekKind(1) !== "pipe" && this.host.peekKind(1) !== "dot") {
      const nullToken = this.host.advance();
      // 'null?' spells the same removed test; consume the '?' only when it
      // ends the test (an optional-type marker), never when it opens a
      // conditional expression.
      const question = this.host.check("question") && !this.questionContinuesExpression() ? this.host.advance() : null;
      const end = question?.span.end ?? nullToken.span.end;
      this.host.diagnostics.push(recoveredDiagnostic(
        "VEL2033",
        negated
          ? "Use '!= null' to test for a value; 'is' tests runtime types"
          : "Use '== null' to test for a value; 'is' tests runtime types",
        span(operator.span.start, end),
        mechanicalFix(span(operator.span.start, end), negated ? "!= null" : "== null", `Use '${negated ? "!=" : "=="} null' to test for a value`),
      ));
      return {
        kind: "BinaryExpression",
        left,
        operator: negated ? "!=" : "==",
        right: { kind: "LiteralExpression", value: null, raw: "null", span: nullToken.span },
        span: span(left.span.start, end),
      } satisfies BinaryExpression;
    }
    const conditionalTypeTest = this.typeTestHasConditionalQuestion();
    const type = this.host.parseTypeReference(!conditionalTypeTest);
    if (conditionalTypeTest) {
      this.host.diagnostics.push(recoveredDiagnostic(
        "VEL2031",
        "Parenthesize the type test before a conditional: '(value is Type) ? then : else'; '?' immediately after a type can also mean an optional type",
        span(left.span.start, this.host.current().span.end),
      ));
    }
    return {
      kind: "IsExpression",
      value: left,
      operator: negated ? "is not" : "is",
      type,
      span: span(left.span.start, type.span.end),
    };
  }

  private parseArrowExpression(start: number, asynchronous: boolean): ArrowFunctionExpression {
    if (this.host.check("leftParen")) {
      this.host.contextualParameterDepth += 1;
      const parameters = this.host.parseParameters();
      this.host.contextualParameterDepth -= 1;
      this.host.expect("fatArrow", "Expected '=>' after arrow parameters");
      const body = this.parseArrowBody();
      return { kind: "ArrowFunctionExpression", asynchronous, parameters, body, span: span(start, body.span.end) };
    }
    const parameterToken = this.host.expect("identifier", "Expected an arrow parameter");
    this.host.expect("fatArrow", "Expected '=>' after arrow parameter");
    const body = this.parseArrowBody();
    const parameter: Parameter = { name: parameterToken.value, type: null, defaultValue: null, rest: false, span: parameterToken.span };
    return { kind: "ArrowFunctionExpression", asynchronous, parameters: [parameter], body, span: span(start, body.span.end) };
  }

  // An arrow body is one expression by design (charter §7): '{' after '=>'
  // opens a record literal, never a JavaScript statement block. When the
  // braces clearly hold statements, one targeted diagnostic replaces the
  // record-literal error cascade and the braces are skipped whole. Record
  // shapes — '{...t, done: true}', '{id: value}', '{a, b}' — parse normally.
  private parseArrowBody(): Expression {
    if (this.host.check("leftBrace") && this.arrowBraceHoldsStatements()) {
      const open = this.host.advance();
      let end = open.span.end;
      let depth = 1;
      while (depth > 0) {
        const kind = this.host.current().kind;
        if (kind === "eof" || kind === "newline" || kind === "indent" || kind === "dedent") break;
        if (kind === "leftBrace") depth += 1;
        else if (kind === "rightBrace") depth -= 1;
        end = this.host.advance().span.end;
      }
      this.host.diagnostics.push(diagnostic(
        "VEL2030",
        "An arrow body is a single expression; write the expression directly or move multi-statement logic into a named 'def'",
        span(open.span.start, end),
      ));
      return { kind: "LiteralExpression", value: null, raw: "null", span: span(open.span.start, end) };
    }
    return this.host.recoverExpressionAssignment(this.host.parseExpression());
  }

  // Scans the braces after '=>' without consuming tokens. Statement keywords
  // that cannot open a record field decide first; a top-level ':' or '...'
  // decides for a record; otherwise any token that cannot sit in a record
  // field list (call parentheses, operators, literals) marks statements.
  private arrowBraceHoldsStatements(): boolean {
    let depth = 0;
    let sawNonRecordToken = false;
    for (let offset = 0; this.host.index + offset < this.host.tokens.length; offset += 1) {
      const token = this.host.tokens[this.host.index + offset]!;
      const kind = token.kind;
      if (kind === "eof" || kind === "newline" || kind === "indent" || kind === "dedent") break;
      if (kind === "leftBrace" || kind === "leftParen" || kind === "leftBracket") {
        if (depth === 1) sawNonRecordToken = true;
        depth += 1;
        continue;
      }
      if (kind === "rightBrace" || kind === "rightParen" || kind === "rightBracket") {
        depth -= 1;
        if (depth === 0) break;
        continue;
      }
      if (depth !== 1) continue;
      const next = this.host.tokens[this.host.index + offset + 1]?.kind;
      // D64 rule 165: a contextual keyword is only statement evidence in the
      // shape that claims it, and `{match}` is not that shape — it is the
      // record shorthand for a binding named `match`, which charter §3
      // promises. The word branch therefore stands down wherever the entry
      // ends: `}` closes the record and `,` starts the next field, exactly as
      // `:` already meant a keyword-named field below. Only the word branch
      // needs this — `statementStarterKinds` holds reserved token kinds, which
      // can never be a field name in the first place.
      const starter = statementStarterKinds.has(kind)
        || (kind === "identifier" && statementStarterWords.has(token.value) && next !== "rightBrace" && next !== "comma");
      if (starter && next !== "colon") return true;
      if (kind === "colon" || kind === "ellipsis") return false;
      if (!recordFieldLevelKinds.has(kind)) sawNonRecordToken = true;
    }
    return sawNonRecordToken;
  }

  private isParenthesizedArrow(initialOffset = 0): boolean {
    let depth = 0;
    for (let offset = initialOffset; this.host.index + offset < this.host.tokens.length; offset += 1) {
      const kind = this.host.tokens[this.host.index + offset]!.kind;
      if (kind === "leftParen") depth += 1;
      else if (kind === "rightParen") {
        depth -= 1;
        if (depth === 0) return this.host.tokens[this.host.index + offset + 1]?.kind === "fatArrow";
      }
      if (kind === "newline" || kind === "eof") return false;
    }
    return false;
  }

  private parseUnary(): Expression {
    if (this.host.check("identifier") && (this.host.current().value === "delete" || this.host.current().value === "typeof")
      && !["rightParen", "rightBracket", "rightBrace", "comma", "colon", "newline", "dedent", "eof"].includes(this.host.peekKind(1))) {
      const operator = this.host.advance();
      this.host.diagnostics.push(recoveredDiagnostic(
        "VEL2031",
        operator.value === "delete"
          ? "VelarScript does not expose JavaScript 'delete'; use a collection remove operation or construct updated data explicitly"
          : "Use 'is' or a declared type; VelarScript does not expose JavaScript 'typeof'",
        operator.span,
      ));
      return this.host.withParseDepth(() => this.parseUnary());
    }
    if ((this.host.check("plus") || this.host.check("minus")) && this.host.peekKind(1) === this.host.current().kind
      && this.host.current().span.end === this.host.tokens[this.host.index + 1]!.span.start) {
      // GRM-D2: '++value' parses as '+(+value)' — a legal silent no-op — so
      // the stacked-operator spelling is taught directly.
      const first = this.host.current();
      const operator = first.kind === "plus" ? "+" : "-";
      const target = this.host.tokens[this.host.index + 2];
      const name = target?.kind === "identifier" ? target.value : "name";
      this.host.diagnostics.push(recoveredDiagnostic(
        "VEL2031",
        `VelarScript has no '${operator}${operator}'; write '${name} ${operator}= 1'`,
        span(first.span.start, this.host.tokens[this.host.index + 1]!.span.end),
        // Only the prefix spelling '++value' reaches here, so the whole
        // '++name' text is replaced by the compound assignment statement.
        target?.kind === "identifier"
          ? mechanicalFix(span(first.span.start, target.span.end), `${name} ${operator}= 1`, `Write '${name} ${operator}= 1'`)
          : undefined,
      ));
      this.host.advance();
      this.host.advance();
      return this.host.withParseDepth(() => this.parseUnary());
    }
    if (this.host.match("bang")) {
      // D86 rule 212: a `!` reached here stands before its operand, so it is
      // the JavaScript negation, not the required-value unwrap the postfix
      // loop reads. D54 rule 118 keeps that reading a teaching diagnostic.
      this.host.reportPrefixBang(this.host.previous());
      const operator = this.host.previous();
      return this.host.withParseDepth(() => {
        const operand = this.parseUnary();
        return { kind: "UnaryExpression", operator: "not", operand, span: span(operator.span.start, operand.span.end) };
      });
    }
    if (this.host.match("not") || this.host.match("plus") || this.host.match("minus") || this.host.match("tilde")) {
      const operator = this.host.previous();
      return this.host.withParseDepth(() => {
        const operand = this.parseUnary();
        return {
          kind: "UnaryExpression",
          operator: operator.kind === "not" ? "not" : operator.kind === "plus" ? "+" : operator.kind === "minus" ? "-" : "~",
          operand,
          span: span(operator.span.start, operand.span.end),
        };
      });
    }
    return this.parsePower();
  }

  private parsePower(): Expression {
    const left = this.parsePowerBase();
    if (!this.host.match("starStar")) return left;
    const operator = this.host.previous();
    return this.host.withParseDepth(() => {
      const right = this.parseUnary();
      return {
        kind: "BinaryExpression",
        operator: "**",
        left,
        right,
        span: span(left.span.start, right.span.end),
      };
    });
  }

  private parsePowerBase(): Expression {
    // D39 item 51: `try` reaches exactly as far as `await` does — the whole
    // postfix chain — so `try User.parse(raw)` and `try await load()` both
    // read as one attempt.
    if (this.host.match("try")) {
      const keyword = this.host.previous();
      return this.host.withParseDepth(() => {
        const value = this.parsePowerBase();
        return { kind: "TryExpression", value, span: span(keyword.span.start, value.span.end) };
      });
    }
    if (!this.host.match("await")) return this.host.parsePostfix();
    const operator = this.host.previous();
    return this.host.withParseDepth(() => {
      const operand = this.host.check("not") || this.host.check("bang") || this.host.check("plus") || this.host.check("minus") || this.host.check("tilde")
        ? this.parseUnary()
        : this.parsePowerBase();
      return {
        kind: "UnaryExpression",
        operator: "await",
        operand,
        span: span(operator.span.start, operand.span.end),
      };
    });
  }

  private binaryOperator(token: Token): BinaryExpression["operator"] {
    const operators: Partial<Record<TokenKind, BinaryExpression["operator"]>> = {
      nullish: "??",
      or: "or",
      and: "and",
      in: "in",
      equal: "==",
      notEqual: "!=",
      less: "<",
      lessEqual: "<=",
      greater: ">",
      greaterEqual: ">=",
      plus: "+",
      minus: "-",
      star: "*",
      starStar: "**",
      slash: "/",
      percent: "%",
      pipe: "|",
      amp: "&",
      caret: "^",
      leftShift: "<<",
      rightShift: ">>",
      unsignedRightShift: ">>>",
    };
    return operators[token.kind] ?? "+";
  }

  private isUnparenthesizedComparisonLayer(expression: Expression): boolean {
    if (expression.kind === "ComparisonChainExpression" || expression.kind === "IsExpression") return !expression.parenthesized;
    return expression.kind === "BinaryExpression" && !expression.parenthesized
      && (expression.operator === "in" || expression.operator === "not in" || expression.operator === "=="
        || expression.operator === "!=" || expression.operator === "<" || expression.operator === "<="
        || expression.operator === ">" || expression.operator === ">=");
  }

  private isMembershipOrTypeTest(expression: Expression): boolean {
    return expression.kind === "IsExpression"
      || (expression.kind === "BinaryExpression" && (expression.operator === "in" || expression.operator === "not in"));
  }

  // '??' never shares a bare binary chain with 'and'/'or': the two groupings
  // read differently, so the mix requires explicit parentheses. '??' binds
  // loosest, so every unparenthesized mix surfaces as an 'and'/'or' node
  // becoming a direct operand of a '??' node; the symmetric test also covers
  // recovered shapes. One diagnostic marks each mixing operator, and the node
  // is still built with the current grouping so later stages keep running.
  private checkNullishBooleanMixing(
    operator: BinaryExpression["operator"],
    left: Expression,
    right: Expression,
    operatorSpan: Span,
  ): void {
    const nullish = operator === "??";
    const boolean = operator === "and" || operator === "or";
    if (!nullish && !boolean) return;
    const conflicting = (operand: Expression): BinaryExpression["operator"] | null =>
      operand.kind === "BinaryExpression" && !operand.parenthesized
        && (nullish ? operand.operator === "and" || operand.operator === "or" : operand.operator === "??")
        ? operand.operator
        : null;
    const adjacent = conflicting(left) ?? conflicting(right);
    if (!adjacent) return;
    const booleanOperator = nullish ? adjacent : operator;
    this.host.diagnostics.push(recoveredDiagnostic(
      "VEL2034",
      `Parenthesize the mix of '??' and '${booleanOperator}'; the two groupings read differently`,
      operatorSpan,
    ));
  }

  // True when the '?' at the current position opens a conditional expression:
  // more of the expression follows on the logical line. A '?' that ends the
  // line is an optional-type marker. This is the same reading
  // typeTestHasConditionalQuestion applies to a '?' directly after a type.
  private questionContinuesExpression(): boolean {
    const next = this.host.peekKind(1);
    return next !== "newline" && next !== "dedent" && next !== "eof";
  }

  private typeTestHasConditionalQuestion(): boolean {
    let angles = 0;
    let parentheses = 0;
    let brackets = 0;
    for (let offset = 0; this.host.index + offset < this.host.tokens.length; offset += 1) {
      const token = this.host.tokens[this.host.index + offset]!;
      if (token.kind === "newline" || token.kind === "dedent" || token.kind === "eof") return false;
      if (token.kind === "less") angles += 1;
      else if (token.kind === "greater") angles = Math.max(0, angles - 1);
      else if (token.kind === "leftParen") parentheses += 1;
      else if (token.kind === "rightParen") {
        if (parentheses === 0) return false;
        parentheses -= 1;
      }
      else if (token.kind === "leftBracket") brackets += 1;
      else if (token.kind === "rightBracket") {
        if (brackets === 0) return false;
        brackets -= 1;
      }
      else if (token.kind === "question" && angles === 0 && parentheses === 0 && brackets === 0) {
        const next = this.host.tokens[this.host.index + offset + 1]?.kind;
        return next !== undefined && next !== "newline" && next !== "dedent" && next !== "eof";
      }
    }
    return false;
  }
}
