/**
 * Completion inside a `look:` block: what the caret is in the middle of writing,
 * and what may be written there.
 *
 * D115 P4 R3d: the context scanner and the five answers it selects between are
 * one concern — a new Look completion position is a new arm here and a new case
 * in `lookCompletionContextAt`, and nothing else in the editor moves.
 */
import type {
  CompilerProjectEditorCompletion,
  CompilerProjectEditorCompletionContext,
  CompilerProjectEditorCompletionResult,
} from "@velarscript/compiler/extension";
import {
  LOOK_HOOKS,
  LOOK_MEDIA_SUBJECTS,
  LOOK_PROPERTIES,
  LOOK_PROPERTY_CSS_FUNCTIONS,
  LOOK_TARGETS,
  lookBuilderSupportsProperty,
  lookPropertyCompletionKeywords,
} from "../look.ts";
import { lookPropertyFamilies, unique } from "./completions.ts";

interface LookPropertyCompletionContext {
  readonly kind: "property";
  readonly prefix: string;
}

interface LookValueCompletionContext {
  readonly kind: "value";
  readonly property: string;
  readonly prefix: string;
  readonly quoted: boolean;
}

interface LookStructuralCompletionContext {
  readonly kind: "hook" | "media" | "target";
  readonly prefix: string;
}

export type LookCompletionContext = LookPropertyCompletionContext | LookValueCompletionContext | LookStructuralCompletionContext;

/** What may be written at a caret inside a `look:` block. */
export function completeLook(
  look: LookCompletionContext,
  context: CompilerProjectEditorCompletionContext,
): CompilerProjectEditorCompletionResult | undefined {
  if (look.kind === "property") {
    return {
      context: "look-property",
      completions: [...LOOK_PROPERTIES]
        .filter((property) => property.startsWith(look.prefix))
        .map((property) => ({
          label: property,
          detail: `${lookPropertyFamilies.get(property) ?? "visual"} Look property`,
          kind: "field" as const,
        })),
    };
  }
  if (look.kind === "value") {
    const keywords: readonly CompilerProjectEditorCompletion[] = lookPropertyCompletionKeywords(look.property)
      .filter((keyword) => keyword.startsWith(look.prefix))
      .map((keyword) => ({
        label: JSON.stringify(keyword),
        detail: `${look.property} keyword`,
        kind: "field" as const,
        filterText: keyword,
        insertText: look.quoted ? keyword : JSON.stringify(keyword),
      }));
    const cssFunctions: readonly CompilerProjectEditorCompletion[] = [...LOOK_PROPERTY_CSS_FUNCTIONS.get(look.property) ?? []]
      .filter((item) => item.name.startsWith(look.prefix))
      .map((item) => ({
        label: `${item.name}()`,
        detail: `CSS function available for ${look.property}`,
        kind: "function" as const,
        presentationKind: "function" as const,
        filterText: `${item.name}()`,
        insertText: look.quoted ? item.example : JSON.stringify(item.example),
      }));
    const builders: readonly CompilerProjectEditorCompletion[] = (look.quoted ? [] : context.visibleSymbols)
      .filter((symbol) => symbol.importSource === "velar/look"
        && symbol.importedName !== undefined
        && lookBuilderSupportsProperty(symbol.importedName, look.property)
        && symbol.label.startsWith(look.prefix))
      .map((symbol) => ({
        label: symbol.label,
        detail: `${symbol.detail} · ${symbol.importedName} from velar/look`,
        kind: symbol.kind,
        presentationKind: "function" as const,
        filterText: symbol.label,
        ...(symbol.documentation ? { documentation: symbol.documentation } : {}),
      }));
    return { context: "look-value", completions: unique([...builders, ...keywords, ...cssFunctions]) };
  }
  if (look.kind === "target") {
    return {
      context: "look-target",
      completions: [...LOOK_TARGETS]
        .filter((target) => target.startsWith(look.prefix))
        .map((target) => ({
          label: `@${target}:`,
          detail: "Look pseudo-element target",
          kind: "field" as const,
          filterText: `@${target}`,
          insertText: `@${target}:`,
        })),
    };
  }
  if (look.kind === "hook") {
    return {
      context: "look-hook",
      completions: [...LOOK_HOOKS]
        .filter((hook) => hook.startsWith(look.prefix))
        .map((hook) => ({
          label: `@${hook}`,
          detail: "Look state condition",
          kind: "field" as const,
          filterText: `@${hook}`,
          insertText: `@${hook}:`,
        })),
    };
  }
  if (look.kind === "media") {
    const conditions = [...LOOK_MEDIA_SUBJECTS].flatMap(([subject, features]) => [...features].map((feature) => {
      const label = `${subject}.${feature}`;
      return {
        label,
        detail: "Look media condition",
        kind: "field" as const,
        filterText: label,
        insertText: subject === "viewport" ? `${label} <= ` : `${label}:`,
      };
    }));
    return {
      context: "look-media",
      completions: conditions.filter((condition) => condition.label.startsWith(look.prefix)),
    };
  }
  return undefined;
}

export function lookCompletionContextAt(source: string, offset: number): LookCompletionContext | null {
  const end = Math.min(Math.max(0, offset), source.length);
  const lineStart = end === 0 ? 0 : source.lastIndexOf("\n", end - 1) + 1;
  const linePrefix = source.slice(lineStart, end);
  const indentation = /^[ \t]*/u.exec(linePrefix)?.[0] ?? "";
  if (!insideLookBlock(source, lineStart, indentationWidth(indentation))) return null;
  const body = linePrefix.slice(indentation.length);
  const assignment = /^([A-Za-z][A-Za-z0-9]*)\s*=\s*(.*)$/u.exec(body);
  if (assignment) {
    const property = assignment[1]!;
    if (!LOOK_PROPERTIES.has(property)) return { kind: "value", property, prefix: "", quoted: false };
    const value = assignment[2]!;
    const quoted = /^(["'])([^"']*)$/u.exec(value);
    if (quoted) return { kind: "value", property, prefix: quoted[2]!, quoted: true };
    return /^[A-Za-z0-9_-]*$/u.test(value)
      ? { kind: "value", property, prefix: value, quoted: false }
      : null;
  }
  const target = /^@([A-Za-z][A-Za-z0-9]*)?$/u.exec(body);
  if (target) return { kind: "target", prefix: target[1] ?? "" };
  const hook = /^if\s+@([A-Za-z][A-Za-z0-9]*)?$/u.exec(body);
  if (hook) return { kind: "hook", prefix: hook[1] ?? "" };
  const media = /^if\s+([A-Za-z][A-Za-z0-9.]*)?$/u.exec(body);
  if (media) return { kind: "media", prefix: media[1] ?? "" };
  const property = /^([A-Za-z][A-Za-z0-9]*)?$/u.exec(body);
  return property ? { kind: "property", prefix: property[1] ?? "" } : null;
}

function insideLookBlock(source: string, lineStart: number, currentIndent: number): boolean {
  const lines = source.slice(0, lineStart).split("\n");
  let childIndent = currentIndent;
  for (let index = lines.length - 2; index >= 0; index -= 1) {
    const line = lines[index]!;
    if (line.trim().length === 0) continue;
    const indentation = /^[ \t]*/u.exec(line)?.[0] ?? "";
    const indent = indentationWidth(indentation);
    if (indent >= childIndent) continue;
    const body = line.slice(indentation.length).trimEnd();
    if (/(?:=\s*|\breturn\s+)look\s*:\s*$/u.test(body)) return true;
    if (/^(?:if\b.+|else|@[A-Za-z][A-Za-z0-9]*)\s*:\s*$/u.test(body)) {
      childIndent = indent;
      continue;
    }
    return false;
  }
  return false;
}

function indentationWidth(indentation: string): number {
  let width = 0;
  for (const character of indentation) width += character === "\t" ? 4 - (width % 4) : 1;
  return width;
}
