/**
 * A word: the keyword table it may be, the member name it may be instead, the
 * receiver parameter a Python author writes as `self`, and the forbidden
 * identifiers a target adds.
 *
 * D115 §三 / D114 R1f: the identifier half of `lexer.ts`.
 */
import { diagnostic, mechanicalFix, recoveredDiagnostic, type Diagnostic, type DiagnosticFix } from "../diagnostic.ts";
import { forbiddenSourceIdentifiers, isForbiddenPrototypeMember } from "../source-names.ts";
import { span } from "../source.ts";
import { keywordKinds, type Token, type TokenKind } from "../token.ts";
import { lineBoundaryKinds } from "./tokens.ts";

/** How far back the receiver-parameter walk reads before giving the name up. */
const RECEIVER_PARAMETER_SCAN_LIMIT = 4096;

/** Everything this half of the lexer asks of the scanner that hosts it, and nothing more. */
export interface IdentifierScannerHost {
  advance(): string;
  readonly classBodyStack: boolean[];
  readonly diagnostics: { push(...reports: readonly Diagnostic[]): void };
  readonly extensionForbiddenIdentifiers: ReadonlyMap<string, string>;
  index: number;
  isIdentifierPart(character: string): boolean;
  peek(offset?: number): string;
  skipHorizontalWhitespace(from: number): number;
  readonly text: string;
  readonly tokens: Token[];
  readonly typeBodyStack: boolean[];
}

export class IdentifierScanner {
  private readonly host: IdentifierScannerHost;

  constructor(host: IdentifierScannerHost) {
    this.host = host;
  }

  readIdentifier(): void {
    const start = this.host.index;
    while (this.host.isIdentifierPart(this.host.peek())) {
      this.host.advance();
    }
    const value = this.host.text.slice(start, this.host.index);
    const previous = this.host.tokens.at(-1)?.kind;
    // D90 (compiler-front-9): a rule's ban is on the spelling as a binding, a
    // parameter and a type; some of them are ordinary member names and record
    // keys. `int` remains forbidden as a type, but velar/random owns the method
    // spelling Random.int(...); `with` remains forbidden as the infix record
    // update, but `Array.prototype.with` and every builder API spelled that way
    // must be callable, and `{with: 1}` must be writable. The exemption is a
    // property of the rule (`memberLegal`) rather than a name spelled here, so
    // `eval` — which the charter keeps unavailable through direct member
    // syntax — does not travel with them.
    const declared = forbiddenSourceIdentifiers.get(value);
    // D90 (coherence): `def close(this)` used to earn two mechanical fixes on
    // one span — this rule's `this` -> `self` rewrite and the analyzer's
    // delete-the-implicit-receiver rewrite — whose texts contradict each
    // other. Applying the first produces `def close(self)`, which is itself an
    // error, so a `velar fix` pass never reaches a clean source. The receiver
    // parameter is the analyzer's report to make: it knows the declaration has
    // an implicit receiver, and its fix deletes the parameter outright. The
    // recovery token is still emitted, so the parameter arrives as `self` and
    // lands on exactly that report.
    const receiverParameter = value === "this" && this.isReceiverParameterPosition(previous);
    const rule = declared?.memberLegal === true && this.isMemberNamePosition(previous) ? undefined : declared;
    const extensionGuidance = rule ? undefined : this.host.extensionForbiddenIdentifiers.get(value);
    if ((value === "Infinity" || value === "NaN") && previous !== "dot" && previous !== "optionalDot") {
      this.host.diagnostics.push(diagnostic(
        "VEL1007",
        value === "Infinity"
          ? "Infinity is not a literal in VelarScript; produce it with arithmetic such as 1 / 0"
          : "NaN is not a literal in VelarScript; produce it with arithmetic such as 0 / 0 and detect it with value.isNaN()",
        span(start, this.host.index),
      ));
      this.host.tokens.push({ kind: "number", value: "0", span: span(start, this.host.index) });
      return;
    }
    if (rule) {
      if (rule.recovery) {
        // The rule carries its successor only when the guidance names exactly
        // one ('var' names 'let' or 'const', so it names none).
        if (!receiverParameter) this.host.diagnostics.push(recoveredDiagnostic("VEL1005", rule.guidance, span(start, this.host.index),
          rule.fix === null ? undefined : mechanicalFix(
            span(start, rule.fix === "" ? this.host.skipHorizontalWhitespace(this.host.index) : this.host.index),
            rule.fix,
            rule.fix === "" ? `Remove '${value}'` : `Use '${rule.fix}'`,
          )));
        for (const item of rule.recovery) {
          this.host.tokens.push({ kind: item.kind, value: item.value, span: span(start, this.host.index) });
        }
        return;
      }
      this.host.diagnostics.push(diagnostic("VEL1005", rule.guidance, span(start, this.host.index)));
    } else if (extensionGuidance) {
      this.host.diagnostics.push(diagnostic("VEL1005", extensionGuidance, span(start, this.host.index)));
    } else if (isForbiddenPrototypeMember(value) && (previous === "dot" || previous === "optionalDot")) {
      this.host.diagnostics.push(diagnostic("VEL1005", "VelarScript does not expose prototype manipulation", span(start, this.host.index)));
    }
    const keyword = Object.hasOwn(keywordKinds, value) ? keywordKinds[value] : undefined;
    this.host.tokens.push({ kind: keyword ?? "identifier", value, span: span(start, this.host.index) });
  }

  /**
   * The three positions in which a name is a member name rather than a binding:
   * after a member step, as a record-literal key, and as the name of a member
   * declared in a class body. The first two are the reads — `q.with("cte")`,
   * `{with: 1}` — and the third is the declaration an extern module needs to
   * describe such an API at all.
   *
   * A class body is the only place the declaration is legal: `def with(...)`
   * outside one binds a name, and the generated module would say
   * `function with`, which is not JavaScript.
   */
  private isMemberNamePosition(previous: TokenKind | undefined): boolean {
    if (previous === "dot" || previous === "optionalDot") return true;
    // A record key is followed by ':' — `{with: 1}` and `{a: 1, with: 2}`. The
    // preceding '{' or ',' is what separates a key from an argument in a call.
    if ((previous === "leftBrace" || previous === "comma")
      && this.host.text[this.host.skipHorizontalWhitespace(this.host.index)] === ":") return true;
    if ((this.host.typeBodyStack.at(-1) ?? false)
      && this.host.text[this.host.skipHorizontalWhitespace(this.host.index)] === ":") return true;
    const declaring = previous === "def"
      || (previous === "identifier" && (this.host.tokens.at(-1)?.value === "get" || this.host.tokens.at(-1)?.value === "set"));
    return declaring && (this.host.classBodyStack.at(-1) ?? false);
  }

  /**
   * D90 (coherence): the one position where `this` is the Python receiver
   * reflex rather than JavaScript's dynamic receiver — a parameter name in the
   * list of an instance method or a constructor inside a class body. The
   * analyzer owns that report, because only it knows the declaration carries
   * an implicit receiver, and its rewrite deletes the parameter instead of
   * renaming it to a spelling that is an error in the same position.
   *
   * The walk is paren-balanced so a default value cannot be mistaken for the
   * list that encloses it — `def m(a = f(this))` is an ordinary receiver read
   * — and `static def make(this)` is excluded because a static method has no
   * receiver to delete, so the rename is still the honest answer there.
   */
  private isReceiverParameterPosition(previous: TokenKind | undefined): boolean {
    if (previous !== "leftParen" && previous !== "comma") return false;
    if (!(this.host.classBodyStack.at(-1) ?? false)) return false;
    let depth = 0;
    let index = this.host.tokens.length - 1;
    for (let steps = 0; index >= 0 && steps < RECEIVER_PARAMETER_SCAN_LIMIT; steps += 1, index -= 1) {
      const kind = this.host.tokens[index]!.kind;
      if (kind === "rightParen") depth += 1;
      else if (kind === "leftParen") {
        if (depth === 0) break;
        depth -= 1;
      } else if (lineBoundaryKinds.has(kind) && depth === 0 && kind !== "newline") return false;
    }
    if (index < 0 || this.host.tokens[index]?.kind !== "leftParen") return false;
    let head = index - 1;
    // A generic method writes its parameters after the type parameter list, so
    // `def m<T>(this)` has to walk back over a balanced '<...>' to reach the
    // name that says which declaration this list belongs to.
    if (this.host.tokens[head]?.kind === "greater") {
      let angle = 0;
      for (let steps = 0; head >= 0 && steps < RECEIVER_PARAMETER_SCAN_LIMIT; steps += 1, head -= 1) {
        const kind = this.host.tokens[head]!.kind;
        if (kind === "greater") angle += 1;
        else if (kind === "less" && (angle -= 1) === 0) {
          head -= 1;
          break;
        }
      }
    }
    const name = this.host.tokens[head];
    if (name?.kind !== "identifier") return false;
    if (name.value === "constructor") return true;
    return this.host.tokens[head - 1]?.kind === "def" && this.host.tokens[head - 2]?.kind !== "static";
  }

  /**
   * The rewrite of a symbol operator to its word spelling. A word needs air on
   * either side that a symbol did not: 'a&&b' becomes 'a and b', while
   * 'a && b' keeps the spacing it already had.
   */
  wordOperatorFix(start: number, end: number, word: string, title: string): DiagnosticFix {
    const before = this.host.text[start - 1];
    const after = this.host.text[end];
    const left = before !== undefined && !/[\s([{,]/u.test(before) ? " " : "";
    const right = after !== undefined && !/[\s)\]},]/u.test(after) ? " " : "";
    return mechanicalFix(span(start, end), `${left}${word}${right}`, title);
  }
}
