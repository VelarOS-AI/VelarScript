/**
 * The statements that own a block and branch: `if`/`else`, `for` and
 * `async for`, `try`/`catch`/`finally`, and `match`. The two lookaheads that
 * decide whether a contextual word is a statement head at all — `match value:`
 * followed by an indented `case`, and a `case` clause with no `match` above it
 * — are here with the statements they answer for.
 */
import type { BindingPattern, Expression, IfStatement, MatchStatement, Statement } from "../../ast.ts";
import { CORE_WORDS } from "../../core-vocabulary.ts";
import { diagnostic, mechanicalFix, recoveredDiagnostic, type Diagnostic } from "../../diagnostic.ts";
import { span } from "../../source.ts";
import { type Token, type TokenKind } from "../../token.ts";

export interface ControlFlowParserHost {
  advance(): Token;
  check(kind: TokenKind): boolean;
  checkWord(value: string): boolean;
  consumeNewlines(): void;
  current(): Token;
  readonly diagnostics: Diagnostic[];
  expect(kind: TokenKind, message: string): Token;
  index: number;
  match(kind: TokenKind): boolean;
  matchWord(value: string): boolean;
  parseBindingPattern(): BindingPattern;
  parseBlock(): readonly Statement[];
  parseExpression(minimumPrecedence?: number): Expression;
  parseMatchPattern(root: boolean): MatchStatement["cases"][number]["pattern"];
  peekKind(distance: number): TokenKind;
  previous(): Token;
  synchronize(): void;
  readonly tokens: Token[];
  withParseDepth<T>(parse: () => T): T;
}

export class ControlFlowParser {
  private readonly host: ControlFlowParserHost;

  constructor(host: ControlFlowParserHost) {
    this.host = host;
  }

  parseForStatement(start: number, asynchronous: boolean): Statement {
    const pattern = this.host.parseBindingPattern();
    const secondPattern = this.host.match("comma") ? this.host.parseBindingPattern() : null;
    if (secondPattern && this.host.match("comma")) {
      const third = this.host.parseBindingPattern();
      this.host.diagnostics.push(diagnostic(
        "VEL2017",
        "A for loop accepts one binding or two slots; use 'for [a, b] in ...' to destructure one item",
        third.span,
      ));
    }
    this.host.expect("in", "Expected 'in' after loop binding");
    const iterable = this.host.parseExpression();
    const body = this.host.parseBlock();
    return { kind: "ForStatement", asynchronous, pattern, secondPattern, iterable, body, span: span(start, body.at(-1)?.span.end ?? iterable.span.end) };
  }

  parseIf(start: number): IfStatement {
    return this.host.withParseDepth(() => this.parseIfBody(start));
  }

  private parseIfBody(start: number): IfStatement {
    const condition = this.host.parseExpression();
    const thenBody = this.host.parseBlock();
    this.consumeNewlinesBeforeClause("else");

    let elseBody: readonly Statement[] | null = null;
    if (this.host.match("else")) {
      if (this.host.match("if")) {
        elseBody = [this.parseIf(this.host.previous().span.start)];
      } else {
        elseBody = this.host.parseBlock();
      }
    }

    const end = elseBody?.at(-1)?.span.end ?? thenBody.at(-1)?.span.end ?? condition.span.end;
    return { kind: "IfStatement", condition, thenBody, elseBody, span: span(start, end) };
  }

  /**
   * An inline suite has no dedent token to preserve its outer statement
   * boundary. Consume its following newline run only when it actually leads to
   * a clause owned by the current statement; otherwise the ordinary statement
   * loop must see the newline before parsing the next sibling statement.
   */
  private consumeNewlinesBeforeClause(...clauses: readonly TokenKind[]): void {
    let distance = 0;
    while (this.host.peekKind(distance) === "newline") distance += 1;
    if (!clauses.includes(this.host.peekKind(distance))) return;
    while (distance > 0) {
      this.host.advance();
      distance -= 1;
    }
  }

  /** Core declarations and control-flow forms whose syntax owns a body. */

  parseMatch(start: number): MatchStatement {
    const value = this.host.parseExpression();
    this.host.expect("colon", "Expected ':' before match cases");
    this.host.expect("newline", "Expected a newline before match cases");
    this.host.consumeNewlines();
    this.host.expect("indent", "Expected indented match cases");

    const cases: MatchStatement["cases"][number][] = [];
    this.host.consumeNewlines();
    while (!this.host.check("dedent") && !this.host.check("eof")) {
      const branchStart = this.host.current().span.start;
      if (this.host.matchWord("case")) {
        const pattern = this.host.parseMatchPattern(true);
        const guard = this.host.match("if") ? this.host.parseExpression() : null;
        const body = this.host.parseBlock();
        cases.push({ pattern, guard, body, span: span(branchStart, body.at(-1)?.span.end ?? this.host.previous().span.end) });
      } else if (this.host.match("else")) {
        // D28 item 4: 'case _:' is the only fallback spelling. The removed
        // 'else:' clause recovers as a wildcard case so exhaustiveness and
        // the rest of the block keep analyzing without cascades.
        const keyword = this.host.previous();
        this.host.diagnostics.push(recoveredDiagnostic(
          "VEL2035",
          "Use 'case _:' for the fallback case; 'match' has no 'else' clause",
          keyword.span,
          mechanicalFix(keyword.span, "case _", "Use 'case _:' for the fallback case"),
        ));
        const body = this.host.parseBlock();
        cases.push({
          pattern: { kind: "MatchWildcardPattern", span: keyword.span },
          guard: null,
          body,
          span: span(branchStart, body.at(-1)?.span.end ?? this.host.previous().span.end),
        });
      } else {
        this.host.diagnostics.push(diagnostic("VEL2015", "A match block accepts only case branches", this.host.current().span));
        this.host.synchronize();
      }
      this.host.consumeNewlines();
    }
    const close = this.host.expect("dedent", "Expected the end of a match block");
    if (cases.length === 0) {
      this.host.diagnostics.push(diagnostic("VEL2015", "A match block requires at least one case", span(start, close.span.end)));
    }
    const end = cases.at(-1)?.span.end ?? value.span.end;
    return { kind: "MatchStatement", value, cases, span: span(start, end) };
  }

  parseTry(start: number): Statement {
    const tryBody = this.host.parseBlock();
    this.consumeNewlinesBeforeClause("catch", "finally");
    let catchName: string | null = null;
    let catchBody: readonly Statement[] | null = null;
    let finallyBody: readonly Statement[] | null = null;

    if (this.host.match("catch")) {
      catchName = this.host.check("identifier") ? this.host.advance().value : "error";
      catchBody = this.host.parseBlock();
      this.consumeNewlinesBeforeClause("finally");
    }

    if (this.host.match("finally")) {
      finallyBody = this.host.parseBlock();
    }

    if (!catchBody && !finallyBody) {
      this.host.diagnostics.push(diagnostic("VEL2008", "A try block requires catch or finally", span(start, tryBody.at(-1)?.span.end ?? start)));
    }

    const end = finallyBody?.at(-1)?.span.end ?? catchBody?.at(-1)?.span.end ?? tryBody.at(-1)?.span.end ?? start;
    return { kind: "TryStatement", tryBody, catchName, catchBody, finallyBody, span: span(start, end) };
  }

  /**
   * A match statement is the one statement whose header ends in ':' and opens
   * an indented block. No expression statement can end in ':' — a call is
   * `match(value)` and an assignment is `match = value` — so the two-line
   * lookahead is exact. D30 item 16 named `case` as the block's first token;
   * the block's contents are deliberately not inspected, so a malformed first
   * branch and the `else:` recovery still reach the match block's own
   * teaching instead of falling back to a bare-name reading.
   */
  matchStatementAhead(): boolean {
    if (!this.host.checkWord(CORE_WORDS.match)) return false;
    let depth = 0;
    let offset = 1;
    for (; this.host.index + offset < this.host.tokens.length; offset += 1) {
      const kind = this.host.tokens[this.host.index + offset]!.kind;
      if (kind === "leftParen" || kind === "leftBracket" || kind === "leftBrace") depth += 1;
      else if (kind === "rightParen" || kind === "rightBracket" || kind === "rightBrace") depth -= 1;
      else if (depth === 0 && (kind === "newline" || kind === "dedent" || kind === "eof")) break;
    }
    if (offset < 3 || this.host.tokens[this.host.index + offset - 1]?.kind !== "colon") return false;
    while (this.host.peekKind(offset) === "newline") offset += 1;
    return this.host.peekKind(offset) === "indent";
  }

  /**
   * `case` outside a match block is an ordinary name, but a `case ...:` line
   * standing alone is the author reaching for a branch that has no header. The
   * branch shape — the word followed by a pattern and a line-ending ':' — keeps
   * the existing directed message without claiming the word anywhere else.
   */
  orphanCaseClauseAhead(): boolean {
    if (!this.host.checkWord(CORE_WORDS.case) || this.host.peekKind(1) === "colon") return false;
    let depth = 0;
    for (let offset = 1; this.host.index + offset < this.host.tokens.length; offset += 1) {
      const kind = this.host.tokens[this.host.index + offset]!.kind;
      if (kind === "leftParen" || kind === "leftBracket" || kind === "leftBrace") depth += 1;
      else if (kind === "rightParen" || kind === "rightBracket" || kind === "rightBrace") depth -= 1;
      else if (depth === 0 && (kind === "newline" || kind === "dedent" || kind === "eof")) {
        return this.host.tokens[this.host.index + offset - 1]?.kind === "colon";
      }
    }
    return false;
  }
}
