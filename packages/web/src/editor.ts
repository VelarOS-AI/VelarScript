import type {
  CompilerProjectEditorCompletion,
  CompilerProjectEditorCompletionContext,
  CompilerProjectEditorCompletionResult,
  CompilerProjectEditorExtension,
  CompilerProjectEditorRenameContext,
} from "@velarscript/compiler/extension";
import { LOOK_PROPERTIES } from "./look.ts";

const nativeJsxTags = [
  "a", "article", "aside", "button", "canvas", "dialog", "div", "footer", "form", "h1", "h2", "h3",
  "header", "img", "input", "label", "li", "main", "nav", "option", "p", "section", "select", "span",
  "strong", "textarea", "ul",
] as const;

const nativeSvgTags = [
  "svg", "g", "defs", "symbol", "use", "path", "rect", "circle", "ellipse", "line", "polyline", "polygon",
  "text", "tspan", "title", "desc", "clipPath", "mask", "pattern", "linearGradient", "radialGradient", "stop",
  "filter", "foreignObject",
] as const;

const svgElementNames = new Set<string>(nativeSvgTags);

const jsxControlCompletions: readonly CompilerProjectEditorCompletion[] = [
  { label: "key", detail: "stable JSX list key", kind: "field" },
  { label: "ref", detail: "typed Handle exposed by this component", kind: "field" },
  ...[...LOOK_PROPERTIES].sort().map((property) => ({
    label: `look:${property}`,
    detail: "inline checked Look property",
    kind: "field" as const,
  })),
  ...[...LOOK_PROPERTIES].sort().map((property) => ({
    label: `style:${property}`,
    detail: "high-priority inline Style compatibility override; prefer Look",
    kind: "field" as const,
  })),
];

const nativeJsxCompletions: readonly CompilerProjectEditorCompletion[] = [
  ...jsxControlCompletions,
  ...["id", "class", "title", "role", "aria-label", "aria-labelledby", "ref"].map((label) => ({ label, detail: "native Web attribute", kind: "field" as const })),
  ...["on:click", "on:input", "on:change", "on:keydown", "on:submit.prevent"].map((label) => ({ label, detail: "typed native Web event", kind: "field" as const })),
  { label: "look", detail: "checked Look value", kind: "field" },
  { label: "bind:value", detail: "two-way string/number form binding", kind: "field" },
  { label: "bind:checked", detail: "two-way boolean form binding", kind: "field" },
  { label: "class:", detail: "reactive class directive", kind: "field" },
  { label: "unsafe:html", detail: "explicit unsafe HTML boundary", kind: "field" },
];

const nativeSvgCompletions: readonly CompilerProjectEditorCompletion[] = [
  ...["viewBox", "preserveAspectRatio", "d", "x", "y", "x1", "y1", "x2", "y2", "cx", "cy", "r", "rx", "ry",
    "width", "height", "points", "transform", "fill", "stroke", "stroke-width", "text-anchor", "href"]
    .map((label) => ({ label, detail: "native SVG attribute", kind: "field" as const })),
  { label: "aria-hidden", detail: "explicit decorative SVG", kind: "field" },
];

export const velarWebProjectEditorExtension: CompilerProjectEditorExtension = Object.freeze({
  complete: completeWebProject,
  protectRename: protectWebRename,
});

function completeWebProject(context: CompilerProjectEditorCompletionContext): CompilerProjectEditorCompletionResult | undefined {
  const tag = jsxTagContextAt(context.source, context.offset);
  if (tag) {
    const components = context.visibleSymbols.filter((symbol) => symbol.kind === "component"
      || (symbol.kind === "import" && symbol.detail.startsWith("component ")));
    return {
      context: "jsx-tag",
      completions: unique([
        ...components,
        ...nativeJsxTags.map((label) => ({ label, detail: "native Web element", kind: "component" as const })),
        ...nativeSvgTags.map((label) => ({ label, detail: "native SVG element", kind: "component" as const })),
      ]).filter((item) => item.label.startsWith(tag.prefix)),
    };
  }

  const attribute = jsxAttributeContextAt(context.source, context.offset);
  if (!attribute) return undefined;
  const common = attribute.component
    ? jsxControlCompletions
    : svgElementNames.has(attribute.tag)
      ? [...nativeJsxCompletions, ...nativeSvgCompletions]
      : nativeJsxCompletions;
  const component = attribute.component ? context.membersAt(attribute.tagOffset) : [];
  return {
    context: attribute.component ? "component-attribute" : "native-attribute",
    completions: unique([...component, ...common]).filter((item) => !attribute.used.has(item.label)),
  };
}

function protectWebRename(context: CompilerProjectEditorRenameContext): string | undefined {
  return context.kind === "parameter" && context.containerKind === "component" && context.name === "children"
    ? "The JSX children prop cannot be renamed"
    : undefined;
}

function jsxTagContextAt(source: string, offset: number): { readonly prefix: string } | null {
  const end = Math.min(Math.max(0, offset), source.length);
  const before = source.slice(0, end);
  const opening = before.lastIndexOf("<");
  if (opening < 0 || before.lastIndexOf(">") > opening) return null;
  const match = /^<\/?([A-Za-z0-9_]*)$/u.exec(source.slice(opening, end));
  return match ? { prefix: match[1]! } : null;
}

function jsxAttributeContextAt(source: string, offset: number): {
  readonly component: boolean;
  readonly tag: string;
  readonly tagOffset: number;
  readonly used: ReadonlySet<string>;
} | null {
  const end = Math.min(Math.max(0, offset), source.length);
  const before = source.slice(0, end);
  const opening = before.lastIndexOf("<");
  if (opening < 0 || before.lastIndexOf(">") > opening || source[opening + 1] === "/") return null;
  const fragment = source.slice(opening, end);
  const tag = /^<([A-Za-z][A-Za-z0-9_]*)\b/u.exec(fragment);
  if (!tag) return null;
  const attributesStart = tag[0].length;
  let quote: string | null = null;
  let depth = 0;
  let escaped = false;
  let visible = "";
  for (const character of fragment.slice(attributesStart)) {
    if (quote) {
      visible += " ";
      if (!escaped && character === quote) quote = null;
      escaped = !escaped && character === "\\";
      if (character !== "\\") escaped = false;
      continue;
    }
    if (character === '"' || character === "'") { quote = character; visible += " "; continue; }
    if (character === "{") { depth += 1; visible += " "; continue; }
    if (character === "}") { depth = Math.max(0, depth - 1); visible += " "; continue; }
    visible += depth === 0 ? character : " ";
  }
  if (quote || depth > 0) return null;
  const used = new Set<string>();
  for (const match of visible.matchAll(/([A-Za-z_][A-Za-z0-9_.:-]*)\s*(?==|\s|$)/gu)) used.add(match[1]!);
  return {
    component: /^[A-Z]/u.test(tag[1]!),
    tag: tag[1]!,
    tagOffset: opening + 1,
    used,
  };
}

function unique(items: readonly CompilerProjectEditorCompletion[]): readonly CompilerProjectEditorCompletion[] {
  return items.filter((item, index) => items.findIndex((candidate) => candidate.label === item.label) === index);
}
