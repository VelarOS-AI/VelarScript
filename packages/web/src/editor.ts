import type {
  CompilerProjectEditorCompletion,
  CompilerProjectEditorCompletionContext,
  CompilerProjectEditorCompletionResult,
  CompilerProjectEditorExtension,
  CompilerProjectEditorRenameContext,
} from "@velarscript/compiler/extension";
import {
  LOOK_BUILDER_SIGNATURES,
  LOOK_LARGE_KEYWORD_SETS,
  LOOK_PROPERTIES,
  LOOK_HOOKS,
  LOOK_MEDIA_SUBJECTS,
  LOOK_PROPERTY_CSS_FUNCTIONS,
  LOOK_PROPERTY_GROUPS,
  LOOK_PROPERTY_VALUE_KINDS,
  LOOK_TARGETS,
  lookPropertyDocumentationKey,
  lookBuilderSupportsProperty,
  lookPropertyCompletionKeywords,
  type LookBuilderSignature,
  type LookPropertyValueKind,
} from "./look.ts";

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
const lookPropertyFamilies = new Map(LOOK_PROPERTY_GROUPS.flatMap((group) =>
  group.properties.map((property) => [property, group.family] as const)));

const lookPropertyValueTypes: Readonly<Record<LookPropertyValueKind, readonly string[]>> = Object.freeze({
  animation: ["Animation", "List<Animation>"],
  angle: ["Angle", "listed keyword"],
  background: ["Color", "Image", "listed keyword"],
  border: ["Border", "listed keyword"],
  color: ["Color", "listed keyword"],
  duration: ["Duration", "listed keyword"],
  filter: ["Filter", "CSS text"],
  image: ["Image", "listed keyword"],
  keyword: ["listed keyword"],
  "line-height": ["number", "Length", "listed keyword"],
  metric: ["Length", "Percentage", "LengthPercentage", "Spacing", "listed keyword"],
  number: ["number", "listed keyword"],
  "number-keyword": ["number", "Spacing", "listed keyword"],
  shadow: ["Shadow", "listed keyword"],
  text: ["CSS text"],
  track: ["TrackList", "listed keyword"],
  transform: ["CSS transform text"],
  transition: ["Transition", "listed keyword"],
});

function lookBuilderLabel(name: string, signature: LookBuilderSignature): string {
  const parameters = signature.parameters.map((parameter, index) => {
    const rest = signature.rest === true && index === signature.parameters.length - 1;
    const optional = index >= signature.required;
    return `${rest ? "..." : ""}${parameter}${optional ? "?" : ""}`;
  });
  return `${name}(${parameters.join(", ")})`;
}

function codeValues(values: readonly string[]): string {
  return values.map((value) => `\`${value}\``).join(", ");
}

function lookPropertyDocumentation(property: string): string {
  const kind = LOOK_PROPERTY_VALUE_KINDS.get(property)!;
  const keywords = lookPropertyCompletionKeywords(property);
  const builders = [...LOOK_BUILDER_SIGNATURES]
    .filter(([name]) => lookBuilderSupportsProperty(name, property))
    .map(([name, signature]) => `\`${lookBuilderLabel(name, signature)}\``);
  const cssFunctions = [...LOOK_PROPERTY_CSS_FUNCTIONS.get(property) ?? []]
    .map((item) => `\`${item.name}()\``);
  const largeKeywordSet = LOOK_LARGE_KEYWORD_SETS.get(property);
  const lines = [
    `Allowed value types: ${lookPropertyValueTypes[kind].map((value) => `\`${value}\``).join(", ")}.`,
    "",
    `${lookPropertyFamilies.get(property) ?? "visual"} property in a checked \`look:\` value.`,
  ];
  if (keywords.length > 0) {
    lines.push("", largeKeywordSet
      ? `Accepted keywords: ${largeKeywordSet}. Completion lists the individual values.`
      : `Accepted keywords: ${codeValues(keywords)}.`);
  }
  if (builders.length > 0) lines.push("", `Available \`velar/look\` builders: ${builders.join(", ")}.`);
  if (cssFunctions.length > 0) lines.push("", `Available CSS text functions: ${cssFunctions.join(", ")}.`);
  if (kind === "text" || kind === "filter" || kind === "transform") {
    lines.push("", "Free CSS text is accepted here; the compiler checks the Look property but does not parse the full CSS value grammar inside that text.");
  }
  return lines.join("\n");
}

export const webLookPropertyDocumentation: Readonly<Record<string, string>> = Object.freeze(Object.fromEntries(
  [...LOOK_PROPERTIES].map((property) => [lookPropertyDocumentationKey(property), lookPropertyDocumentation(property)]),
));

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
  ...["id", "class", "title", "role", "aria-label", "aria-labelledby", "ref"].map((label) => ({ label, detail: "native Web attribute", kind: "field" as const })),
  ...["on:click", "on:input", "on:change", "on:keydown", "on:submit.prevent"].map((label) => ({ label, detail: "typed native Web event", kind: "field" as const })),
  { label: "look", detail: "checked Look value", kind: "field" },
  { label: "bind:value", detail: "two-way string/number form binding", kind: "field" },
  { label: "bind:checked", detail: "two-way boolean form binding", kind: "field" },
  { label: "bind:group", detail: "two-way radio or checkbox group binding", kind: "field" },
  { label: "class:", detail: "reactive class directive", kind: "field" },
  { label: "unsafe:html", detail: "explicit unsafe HTML boundary", kind: "field" },
  ...jsxControlCompletions,
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
  const look = lookCompletionContextAt(context.source, context.offset);
  if (look?.kind === "property") {
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
  if (look?.kind === "value") {
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
  if (look?.kind === "target") {
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
  if (look?.kind === "hook") {
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
  if (look?.kind === "media") {
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

  const tag = jsxTagContextAt(context.source, context.offset);
  if (tag) {
    const components = context.visibleSymbols.filter((symbol) => symbol.kind === "extension:function:web-component"
      || (symbol.kind === "import" && symbol.detail.startsWith("component ")));
    return {
      context: "jsx-tag",
      completions: unique([
        ...components,
        ...nativeJsxTags.map((label) => ({ label, detail: "native Web element", kind: "extension:function:web-component" as const, presentationKind: "class" as const })),
        ...nativeSvgTags.map((label) => ({ label, detail: "native SVG element", kind: "extension:function:web-component" as const, presentationKind: "class" as const })),
      ]).filter((item) => item.label.startsWith(tag.prefix)),
    };
  }

  const attribute = jsxAttributeContextAt(context.source, context.offset);
  if (!attribute) return undefined;
  const common = attribute.component
    ? jsxControlCompletions
    : svgElementNames.has(attribute.tag)
      ? [...nativeSvgCompletions, ...nativeJsxCompletions]
      : nativeJsxCompletions;
  const component = attribute.component ? context.membersAt(attribute.tagOffset) : [];
  return {
    context: attribute.component ? "component-attribute" : "native-attribute",
    completions: unique([...component, ...common]).filter((item) => !attribute.used.has(item.label)),
  };
}

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

type LookCompletionContext = LookPropertyCompletionContext | LookValueCompletionContext | LookStructuralCompletionContext;

function lookCompletionContextAt(source: string, offset: number): LookCompletionContext | null {
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

function protectWebRename(context: CompilerProjectEditorRenameContext): string | undefined {
  return context.kind === "parameter" && context.containerKind === "extension:function:web-component" && context.name === "children"
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
