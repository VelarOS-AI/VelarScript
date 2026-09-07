import type {
  CompilerProjectEditorCompletionContext,
  CompilerProjectEditorCompletionResult,
  CompilerProjectEditorExtension,
  CompilerProjectEditorRenameContext,
} from "@velarscript/compiler/extension";
import {
  LOOK_BUILDER_SIGNATURES,
  LOOK_LARGE_KEYWORD_SETS,
  LOOK_PROPERTIES,
  LOOK_PROPERTY_CSS_FUNCTIONS,
  LOOK_PROPERTY_VALUE_KINDS,
  lookPropertyDocumentationKey,
  lookBuilderSupportsProperty,
  lookPropertyCompletionKeywords,
  type LookBuilderSignature,
  type LookPropertyValueKind,
} from "./look.ts";
import { lookPropertyFamilies } from "./editor/completions.ts";
import { completeJsx } from "./editor/jsx-completion.ts";
import { completeLook, lookCompletionContextAt } from "./editor/look-completion.ts";

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

export const velarWebProjectEditorExtension: CompilerProjectEditorExtension = Object.freeze({
  complete: completeWebProject,
  protectRename: protectWebRename,
});

/**
 * The caret is inside a `look:` block or it is inside JSX; the two families
 * answer for their own positions and this only says which one is asked.
 */
function completeWebProject(context: CompilerProjectEditorCompletionContext): CompilerProjectEditorCompletionResult | undefined {
  const look = lookCompletionContextAt(context.source, context.offset);
  const lookCompletion = look ? completeLook(look, context) : undefined;
  if (lookCompletion) return lookCompletion;
  return completeJsx(context);
}

function protectWebRename(context: CompilerProjectEditorRenameContext): string | undefined {
  return context.kind === "parameter" && context.containerKind === "extension:function:web-component" && context.name === "children"
    ? "The JSX children prop cannot be renamed"
    : undefined;
}
