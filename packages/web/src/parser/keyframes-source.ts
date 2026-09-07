/**
 * The recursive-descent reader for a `keyframes:` block's own indented source:
 * the stop labels, their ascending order, and the direct properties each stop
 * holds.
 */
import type { Diagnostic, Span } from "@velarscript/compiler";
import type { Expression } from "@velarscript/compiler/extension";
import { type WebKeyframeStop, type WebLookEntry as LookEntry } from "../ast.ts";
import type { WebKeyframesBlockSyntax, WebLookLineSyntax } from "../lexer.ts";
import { diagnostic, recoveredDiagnostic, span } from "./spans.ts";

export class KeyframesSourceParser {
  private readonly lines: readonly WebLookLineSyntax[];
  private readonly blockSpan: Span;
  private readonly parseExpression: (text: string, offset: number, openingIndent?: string) => Expression;
  private readonly report: (item: Diagnostic) => void;
  private readonly seenOffsets = new Set<number>();
  private index = 0;
  private previousGroupStart = -1;

  constructor(
    block: WebKeyframesBlockSyntax,
    parseExpression: (text: string, offset: number, openingIndent?: string) => Expression,
    report: (item: Diagnostic) => void,
  ) {
    this.lines = block.lines;
    this.blockSpan = block.span;
    this.parseExpression = parseExpression;
    this.report = report;
  }

  parse(): readonly WebKeyframeStop[] {
    if (this.lines.length === 0) {
      this.report(diagnostic("VEL5060", "A keyframes block requires at least one stop", this.blockSpan));
      return [];
    }
    const indent = this.lines[0]!.indent;
    const stops: WebKeyframeStop[] = [];
    while (this.index < this.lines.length) {
      const line = this.lines[this.index]!;
      if (line.indent !== indent) {
        this.report(diagnostic("VEL5060", "Unexpected keyframes indentation; stops share one indentation level", this.lineSpan(line)));
        this.index += 1;
        continue;
      }
      this.index += 1;
      const label = /^(.+):$/u.exec(line.text)?.[1]?.trim();
      if (!label) {
        this.report(diagnostic("VEL5060", "A keyframe stop uses 'from:', 'to:', or a percentage such as '50%:'", this.lineSpan(line)));
        continue;
      }
      const offsets = this.parseOffsets(label, line);
      const next = this.lines[this.index];
      if (!next || next.indent <= line.indent) {
        this.report(diagnostic("VEL5060", `Keyframe stop '${label}' requires an indented property body`, this.lineSpan(line)));
        continue;
      }
      const entries = this.parseEntries(next.indent, line.indent);
      if (offsets.length > 0) stops.push({
        offsets,
        entries,
        span: span(line.start, entries.at(-1)?.span.end ?? line.end),
      });
    }
    // WB-I6: no summary. Every path above pushes a stop or says why that line is not one, on the line rather than the block.
    return stops;
  }

  private parseOffsets(label: string, line: WebLookLineSyntax): readonly number[] {
    const parts = label.split(",").map((part) => part.trim());
    const offsets: number[] = [];
    for (const part of parts) {
      let offset: number | null = part === "from" ? 0 : part === "to" ? 100 : null;
      const percentage = /^(\d+(?:\.\d+)?)%$/u.exec(part);
      if (percentage) {
        offset = Number(percentage[1]);
        if (offset === 0 || offset === 100) {
          this.report(diagnostic("VEL5060", `Use '${offset === 0 ? "from" : "to"}:'; ${offset}% has one canonical keyframe spelling`, this.lineSpan(line)));
          continue;
        }
        if (!(offset > 0 && offset < 100)) {
          this.report(diagnostic("VEL5060", `Keyframe percentage '${part}' must be greater than 0% and less than 100%`, this.lineSpan(line)));
          continue;
        }
      }
      if (offset === null) {
        this.report(diagnostic("VEL5060", `Unknown keyframe stop '${part}'; use from, to, or a percentage between them`, this.lineSpan(line)));
        continue;
      }
      if (this.seenOffsets.has(offset)) {
        this.report(diagnostic("VEL5060", `Keyframe stop '${part}' duplicates ${offset === 0 ? "from" : offset === 100 ? "to" : `${offset}%`}`, this.lineSpan(line)));
        continue;
      }
      this.seenOffsets.add(offset);
      offsets.push(offset);
    }
    const groupStart = offsets.length > 0 ? Math.min(...offsets) : this.previousGroupStart;
    if (groupStart < this.previousGroupStart) {
      this.report(diagnostic("VEL5060", "Keyframe stops must be declared in ascending order", this.lineSpan(line)));
    } else this.previousGroupStart = groupStart;
    return offsets;
  }

  private parseEntries(indent: number, stopIndent: number): WebKeyframeStop["entries"] {
    const entries: Extract<LookEntry, { kind: "LookProperty" }>[] = [];
    while (this.index < this.lines.length) {
      const line = this.lines[this.index]!;
      if (line.indent <= stopIndent) break;
      this.index += 1;
      if (line.indent !== indent) {
        this.report(diagnostic("VEL5060", "Keyframe stop bodies cannot contain nested targets, conditions, or blocks", this.lineSpan(line)));
        continue;
      }
      if (line.text.startsWith("if ") || line.text.startsWith("@") || line.text.startsWith("...") || line.text === "look:") {
        this.report(diagnostic("VEL5060", "Keyframe stops contain only direct Look properties; conditions, targets, composition, and spreads are not allowed", this.lineSpan(line)));
        continue;
      }
      const kebab = /^([A-Za-z][A-Za-z0-9]*(?:-[A-Za-z][A-Za-z0-9]*)+)\s*=\s*([\s\S]+)$/u.exec(line.text);
      const property = kebab ? null : /^([A-Za-z][A-Za-z0-9]*)\s*=\s*([\s\S]+)$/u.exec(line.text);
      if (!kebab && !property) {
        this.report(diagnostic("VEL5060", "A keyframe property is written as 'property = value'", this.lineSpan(line)));
        continue;
      }
      const name = kebab
        ? kebab[1]!.replace(/-+([A-Za-z])/gu, (_, letter: string) => letter.toUpperCase())
        : property![1]!;
      if (kebab) this.report(recoveredDiagnostic("VEL5038", `Use '${name}'; Look properties use the DOM camelCase spelling`, this.lineSpan(line)));
      const assignment = line.text.indexOf("=");
      const afterAssignment = line.text.slice(assignment + 1);
      const valueText = afterAssignment.trim();
      const valueStart = line.start + assignment + 1 + (afterAssignment.length - afterAssignment.trimStart().length);
      entries.push({
        kind: "LookProperty",
        name,
        value: this.parseExpression(valueText, valueStart, /[\r\n]/u.test(valueText) ? line.openingIndent : undefined),
        span: this.lineSpan(line),
      });
    }
    return entries;
  }

  private lineSpan(line: { start: number; end: number }): Span {
    return span(line.start, line.end);
  }
}

