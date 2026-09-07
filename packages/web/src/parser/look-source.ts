/**
 * The recursive-descent reader for a `look:` block's own indented source.
 *
 * D115 P4 R3e: it was already the collaborator shape — four injected fields and
 * a cursor, reaching the enclosing parser only through the two callbacks it was
 * handed — so it moves whole.
 */
import type { Diagnostic, Span } from "@velarscript/compiler";
import { scanStringLiteral, type Expression } from "@velarscript/compiler/extension";
import { type WebLookEntry as LookEntry } from "../ast.ts";
import type { WebLookBlockSyntax, WebLookLineSyntax } from "../lexer.ts";
import { diagnostic, recoveredDiagnostic, replaceLookHooks, span } from "./spans.ts";

export class LookSourceParser {
  private readonly lines: readonly WebLookLineSyntax[];
  private readonly blockSpan: Span;
  private readonly parseExpression: (text: string, offset: number, openingIndent?: string) => Expression;
  private readonly report: (item: Diagnostic) => void;
  private index = 0;

  constructor(
    block: WebLookBlockSyntax,
    parseExpression: (text: string, offset: number, openingIndent?: string) => Expression,
    report: (item: Diagnostic) => void,
  ) {
    this.blockSpan = block.span;
    this.parseExpression = parseExpression;
    this.report = report;
    this.lines = block.lines;
  }

  parse(): readonly LookEntry[] {
    if (this.lines.length === 0) {
      this.report(diagnostic("VEL5038", "A Look block requires at least one entry", this.blockSpan));
      return [];
    }
    return this.parseEntries(this.lines[0]!.indent);
  }

  private parseEntries(indent: number): readonly LookEntry[] {
    const entries: LookEntry[] = [];
    while (this.index < this.lines.length) {
      const line = this.lines[this.index]!;
      if (line.indent < indent) break;
      if (line.indent > indent) {
        this.report(diagnostic("VEL5038", "Unexpected Look indentation", this.lineSpan(line)));
        this.index += 1;
        continue;
      }
      this.index += 1;
      if (line.text.startsWith("if ") && line.text.endsWith(":")) {
        entries.push(this.parseIf(line, indent, "if "));
        continue;
      }
      if (line.text === "else:" || line.text.startsWith("else if ")) {
        this.report(diagnostic("VEL5038", "Look 'else' must immediately follow an 'if' at the same indentation", this.lineSpan(line)));
        continue;
      }
      // A kebab-case property receives camelCase guidance and recovers as the
      // camelCase entry, so semantic analysis still checks its value and every
      // other Look and JSX diagnostic co-reports in the same compile.
      const kebab = /^([A-Za-z][A-Za-z0-9]*(?:-[A-Za-z][A-Za-z0-9]*)+)\s*=(.*)$/u.exec(line.text);
      const property = kebab
        ? null
        : /^([A-Za-z][A-Za-z0-9]*)\s*=\s*([\s\S]+)$/u.exec(line.text);
      if (kebab && kebab[2]!.trim().length === 0) {
        const camel = kebab[1]!.replace(/-+([A-Za-z])/gu, (_, letter: string) => letter.toUpperCase());
        this.report(diagnostic("VEL5038", `Use '${camel}'; Look properties use the DOM camelCase spelling`, this.lineSpan(line)));
        continue;
      }
      if (kebab || property) {
        const propertyName = kebab
          ? kebab[1]!.replace(/-+([A-Za-z])/gu, (_, letter: string) => letter.toUpperCase())
          : property![1]!;
        if (kebab) {
          this.report(recoveredDiagnostic("VEL5038", `Use '${propertyName}'; Look properties use the DOM camelCase spelling`, this.lineSpan(line)));
        }
        const assignment = line.text.indexOf("=");
        const afterAssignment = line.text.slice(assignment + 1);
        const valueText = afterAssignment.trim();
        const valueStart = line.start + assignment + 1 + (afterAssignment.length - afterAssignment.trimStart().length);
        if (/^(?:margin|padding|inset)/u.test(propertyName) && /^[+-]?\d[\w.%]*(?:\s+[+-]?\d[\w.%]*)+$/u.test(valueText)) {
          const builderArguments = valueText
            .split(/\s+/u)
            .map((token) => (/^[+-]?\d+(?:\.\d+)?$/u.test(token) ? `${token}px` : token))
            .join(", ");
          this.report(recoveredDiagnostic("VEL5038", `Use 'spacing(${builderArguments})'; Look multi-value shorthand is written with the spacing builder`, this.lineSpan(line)));
          entries.push({
            kind: "LookProperty",
            name: propertyName,
            value: { kind: "LiteralExpression", value: null, raw: "null", span: span(valueStart, valueStart + valueText.length) },
            span: this.lineSpan(line),
          });
          continue;
        }
        entries.push({
          kind: "LookProperty",
          name: propertyName,
          value: this.parseExpression(valueText, valueStart, /[\r\n]/u.test(valueText) ? line.openingIndent : undefined),
          span: this.lineSpan(line),
        });
        continue;
      }
      if (line.text.startsWith("...")) {
        const afterSpread = line.text.slice(3);
        const valueText = afterSpread.trim();
        if (!valueText) {
          this.report(diagnostic("VEL5038", "Look composition requires a value after '...'", this.lineSpan(line)));
          continue;
        }
        entries.push({
          kind: "LookSpread",
          value: this.parseExpression(valueText, line.start + 3 + (afterSpread.length - afterSpread.trimStart().length)),
          span: this.lineSpan(line),
        });
        continue;
      }
      const target = /^@([A-Za-z][A-Za-z0-9]*):$/u.exec(line.text)?.[1];
      if (!target) {
        this.report(diagnostic("VEL5038", "Look entries use 'property = value', 'if condition:', '@target:', or composition with '...'", this.lineSpan(line)));
        continue;
      }
      const next = this.lines[this.index];
      if (!next || next.indent <= line.indent) {
        this.report(diagnostic("VEL5038", `Look target '@${target}' requires an indented body`, this.lineSpan(line)));
        continue;
      }
      const children = this.parseEntries(next.indent);
      entries.push({ kind: "LookTarget", name: target, entries: children, span: span(line.start, children.at(-1)?.span.end ?? line.end) });
    }
    return entries;
  }

  private parseIf(
    line: { indent: number; text: string; start: number; end: number },
    indent: number,
    prefix: "if " | "else if ",
  ): Extract<LookEntry, { kind: "LookIf" }> {
    const conditionSource = line.text.slice(prefix.length, -1);
    const conditionText = conditionSource.trim();
    const conditionOffset = line.start + prefix.length + (conditionSource.length - conditionSource.trimStart().length);
    const condition = this.parseLookCondition(conditionText, conditionOffset);
    const next = this.lines[this.index];
    let thenEntries: readonly LookEntry[] = [];
    if (!next || next.indent <= line.indent) {
      this.report(diagnostic("VEL5038", "A Look if branch requires an indented body", this.lineSpan(line)));
    } else {
      thenEntries = this.parseEntries(next.indent);
    }

    let elseEntries: readonly LookEntry[] = [];
    const alternate = this.lines[this.index];
    if (alternate?.indent === indent && alternate.text.startsWith("else if ") && alternate.text.endsWith(":")) {
      this.index += 1;
      elseEntries = [this.parseIf(alternate, indent, "else if ")];
    } else if (alternate?.indent === indent && alternate.text === "else:") {
      this.index += 1;
      const elseBody = this.lines[this.index];
      if (!elseBody || elseBody.indent <= alternate.indent) {
        this.report(diagnostic("VEL5038", "A Look else branch requires an indented body", this.lineSpan(alternate)));
      } else {
        elseEntries = this.parseEntries(elseBody.indent);
      }
    }
    return {
      kind: "LookIf",
      condition,
      thenEntries,
      elseEntries,
      span: span(line.start, elseEntries.at(-1)?.span.end ?? thenEntries.at(-1)?.span.end ?? line.end),
    };
  }

  private parseLookCondition(text: string, absoluteOffset: number): Expression {
    const hooks = new Map<number, string>();
    let rewritten = "";
    // Every rewrite here is length-preserving, because `hooks` is keyed by an
    // offset into `text` and `replaceLookHooks` looks those keys up against
    // spans parsed out of `rewritten`. `@name` becomes `_name` and a string
    // literal is copied verbatim, so the two offsets stay equal.
    for (let index = 0; index < text.length;) {
      // A string literal is Core's to define — prefixes, escapes, raw content
      // and every delimiter — so the `@` rewrite steps over whatever Core
      // scans rather than keeping a second spelling of string lexing here.
      const literal = scanStringLiteral(text, index);
      if (literal) {
        const end = Math.max(literal.end, index + 1);
        rewritten += text.slice(index, end);
        index = end;
        continue;
      }
      const match = /^@([A-Za-z][A-Za-z0-9]*)/u.exec(text.slice(index));
      if (match) {
        hooks.set(absoluteOffset + index, match[1]!);
        rewritten += `_${match[1]}`;
        index += match[0].length;
        continue;
      }
      rewritten += text[index]!;
      index += 1;
    }
    const parsed = this.parseExpression(rewritten, absoluteOffset);
    return replaceLookHooks(parsed, hooks);
  }

  private lineSpan(line: { start: number; end: number }): Span {
    return span(line.start, line.end);
  }
}
