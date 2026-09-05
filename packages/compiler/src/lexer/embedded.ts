/**
 * Source that is not VelarScript: an embedded JavaScript literal, a token an
 * extension's own scanner claims, and the `#name` a JavaScript private member
 * is written with inside one.
 *
 * D115 §三 / D114 R1f: the embedded-source half of `lexer.ts`.
 */
import { scanEmbeddedJavaScriptLiteral, type EmbeddedJavaScriptTokenPayload } from "../embedded-javascript.ts";
import type { CompilerLexicalExtension } from "../extension.ts";
import { diagnostic, mechanicalFix, recoveredDiagnostic, type Advisory, type Diagnostic } from "../diagnostic.ts";
import { span } from "../source.ts";
import { type Token } from "../token.ts";

/** Everything this half of the lexer asks of the scanner that hosts it, and nothing more. */
export interface EmbeddedScannersHost {
  advance(): string;
  readonly advisories: Advisory[];
  atLineStart: boolean;
  readonly diagnostics: { push(...reports: readonly Diagnostic[]): void };
  readonly extensionScanners: NonNullable<CompilerLexicalExtension["scan"]>[];
  readonly indentStack: number[];
  index: number;
  isIdentifierPart(character: string): boolean;
  isIdentifierStart(character: string): boolean;
  peek(offset?: number): string;
  readonly text: string;
  readonly tokens: Token[];
}

export class EmbeddedScanners {
  private readonly host: EmbeddedScannersHost;

  constructor(host: EmbeddedScannersHost) {
    this.host = host;
  }

  readEmbeddedJavaScript(scanned: NonNullable<ReturnType<typeof scanEmbeddedJavaScriptLiteral>>): void {
    this.host.index = scanned.end;
    if (!scanned.openingLineBreak) {
      this.host.diagnostics.push(diagnostic(
        "VEL1003",
        "An inline JavaScript source block begins on the line after its opening backtick",
        span(scanned.start, Math.min(this.host.text.length, scanned.start + 1)),
      ));
    }
    if (!scanned.closed) {
      this.host.diagnostics.push(diagnostic(
        "VEL1003",
        scanned.kind === "checked"
          ? "Unterminated checked JavaScript source block; close it with '`:' alone at the declaration's indentation"
          : "Unterminated unsafe JavaScript source block; close it with '`' alone at the declaration's indentation",
        span(scanned.start, scanned.end),
      ));
    }
    const sourceSpan = span(scanned.sourceStart, scanned.sourceEnd);
    this.host.tokens.push({
      kind: "string",
      value: this.host.text.slice(sourceSpan.start, sourceSpan.end),
      span: span(scanned.start, scanned.end),
      payload: {
        embeddedJavaScript: true,
        kind: scanned.kind,
        sourceSpan,
      } satisfies EmbeddedJavaScriptTokenPayload,
    });
  }

  readExtensionToken(): boolean {
    for (const scanner of this.host.extensionScanners) {
      const result = scanner({
        source: this.host.text,
        offset: this.host.index,
        currentIndent: this.host.indentStack.at(-1) ?? 0,
        tokens: this.host.tokens,
      });
      if (!result) continue;
      if (result.token.kind !== "extensionToken" || result.nextOffset <= this.host.index || result.nextOffset > this.host.text.length) {
        throw new Error("A compiler lexical extension returned an invalid token boundary");
      }
      this.host.tokens.push(result.token);
      this.host.diagnostics.push(...result.diagnostics ?? []);
      this.host.advisories.push(...result.advisories ?? []);
      this.host.index = result.nextOffset;
      this.host.atLineStart = result.startsLine ?? false;
      return true;
    }
    return false;
  }

  readJavaScriptPrivateIdentifier(start: number): boolean {
    const previous = this.host.tokens.at(-1);
    const memberAccess = previous?.kind === "dot" || previous?.kind === "optionalDot";
    const declaration = previous?.kind === "let" || previous?.kind === "const" || previous?.kind === "def"
      || (previous?.kind === "identifier" && previous.value === "get");
    if ((!memberAccess && !declaration) || !this.host.isIdentifierStart(this.host.peek(1))) return false;
    this.host.index = start + 1;
    const nameStart = this.host.index;
    while (this.host.isIdentifierPart(this.host.peek())) this.host.advance();
    this.host.diagnostics.push(recoveredDiagnostic(
      "VEL1005",
      "Remove '#'; VelarScript owns class privacy and does not expose JavaScript private identifiers",
      span(start, start + 1),
      mechanicalFix(span(start, start + 1), "", "Remove the JavaScript private marker"),
    ));
    this.host.tokens.push({ kind: "identifier", value: this.host.text.slice(nameStart, this.host.index), span: span(nameStart, this.host.index) });
    return true;
  }
}
