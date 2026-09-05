/**
 * The two things an index says about a span rather than about a symbol: the
 * syntax token an editor colours it with, and the documentation key a hover
 * reads. Also the doc comment written above a declaration.
 *
 * D115 §三 / D114 R1f: the documentation half of `semantic.ts`.
 */
import { type SourceText, type Span } from "../source.ts";
import { type SemanticSyntaxDocumentation, type SemanticSyntaxToken, type SemanticSyntaxTokenKind } from "./symbols.ts";

/** What the syntax log asks of the index that hosts it, and nothing more. */
export interface SemanticSyntaxLogHost {
  readonly source: SourceText;
  readonly syntaxDocumentation: SemanticSyntaxDocumentation[];
  readonly syntaxDocumentationIdentities: Set<string>;
  readonly syntaxTokenIdentities: Set<string>;
  readonly syntaxTokens: SemanticSyntaxToken[];
}

export class SemanticSyntaxLog {
  private readonly host: SemanticSyntaxLogHost;

  constructor(host: SemanticSyntaxLogHost) {
    this.host = host;
  }

  syntaxToken(tokenSpan: Span, kind: SemanticSyntaxTokenKind): void {
    if (!Number.isSafeInteger(tokenSpan.start) || !Number.isSafeInteger(tokenSpan.end)
      || tokenSpan.start < 0 || tokenSpan.end <= tokenSpan.start || tokenSpan.end > this.host.source.text.length) return;
    const identity = `${tokenSpan.start}:${tokenSpan.end}:${kind}`;
    if (this.host.syntaxTokenIdentities.has(identity)) return;
    this.host.syntaxTokenIdentities.add(identity);
    this.host.syntaxTokens.push({ span: tokenSpan, kind });
  }

  documentSyntax(documentedSpan: Span, key: string): void {
    if (!Number.isSafeInteger(documentedSpan.start) || !Number.isSafeInteger(documentedSpan.end)
      || documentedSpan.start < 0 || documentedSpan.end <= documentedSpan.start
      || documentedSpan.end > this.host.source.text.length || key.length === 0 || key.length > 128) return;
    const identity = `${documentedSpan.start}:${documentedSpan.end}:${key}`;
    if (this.host.syntaxDocumentationIdentities.has(identity)) return;
    this.host.syntaxDocumentationIdentities.add(identity);
    this.host.syntaxDocumentation.push({ span: documentedSpan, key });
  }
}

const MAX_DOCUMENTATION_CHARS = 16_384;

export function documentationBefore(source: SourceText, declarationStart: number): string | null {
  const location = source.location(declarationStart);
  const lineStart = source.lineStarts[location.line - 1] ?? 0;
  const indentation = source.text.slice(lineStart, declarationStart);
  if (!/^[ \t]*$/u.test(indentation)) return null;
  const lines: string[] = [];
  for (let lineNumber = location.line - 1; lineNumber > 0; lineNumber -= 1) {
    const line = source.lineText(lineNumber);
    if (!line.startsWith(`${indentation}///`)) break;
    const suffix = line.slice(indentation.length + 3);
    lines.unshift(suffix.startsWith(" ") ? suffix.slice(1) : suffix);
  }
  while (lines[0] === "") lines.shift();
  while (lines.at(-1) === "") lines.pop();
  if (lines.length === 0) return null;
  const documentation = lines.join("\n");
  return documentation.length <= MAX_DOCUMENTATION_CHARS
    ? documentation
    : `${documentation.slice(0, MAX_DOCUMENTATION_CHARS - 1)}…`;
}
