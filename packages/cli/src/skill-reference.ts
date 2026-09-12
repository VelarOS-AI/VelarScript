/** The installed skill vocabulary and the canonical sections each topic owns. */
export const SKILL_OWNER_FILES: Readonly<Record<string, string>> = Object.freeze({
  core: "ai-skill.md",
  web: "ai-skill-web.md",
  node: "ai-skill-node.md",
  server: "ai-skill-server.md",
  desktop: "ai-skill-desktop.md",
});

export interface SkillReferenceSource {
  readonly file: string;
  /** Omission selects the complete canonical document. */
  readonly headings?: readonly string[];
  /** Stop before a unique paragraph when the canonical section includes adjacent subjects. */
  readonly endBefore?: string;
}

export interface CoreSkillTopic {
  readonly title: string;
  readonly sources: readonly SkillReferenceSource[];
}

const charter = (headings: readonly string[]): SkillReferenceSource => ({file: "docs/language-charter.md", headings});
const standard = (headings: readonly string[]): SkillReferenceSource => ({file: "docs/standard-library.md", headings});

export const CORE_SKILL_TOPICS: Readonly<Record<string, CoreSkillTopic>> = Object.freeze({
  contract: {title: "Core standard commitments and boundaries", sources: [{file: "docs/core-standard.md"}]},
  syntax: {title: "Files, layout, literals, operators, and diagnostics", sources: [charter([
    "## 2. Files, comments, and blocks", "## Advisories", "## 3. Bindings and literals", "## 4. Operators",
    "## 19. Deliberately absent source features",
  ])]},
  types: {title: "Types, readonly views, records, aliases, enums, and generic records", sources: [charter([
    "## 5. Core types", "## 6. Records, aliases, and enums",
  ])]},
  functions: {title: "Functions, arguments, type parameters, and async calls", sources: [charter(["## 7. Functions and calls"])]},
  collections: {title: "List, Set, Map, Pair, Record, and iteration contracts", sources: [charter(["## 8. Collections"])]},
  control: {title: "If, match, loops, resources, errors, and assertions", sources: [charter([
    "## 9. Control flow", "## 11. Errors and assertions",
  ])]},
  classes: {title: "Classes, inheritance, and generic classes", sources: [charter(["## 10. Classes"])]},
  modules: {title: "Modules, foreign boundaries, and generated JavaScript", sources: [charter([
    "## 12. Modules and JavaScript boundaries", "## 18. Generated JavaScript semantics",
  ])]},
  api: {title: "Core prelude, permanent namespaces, and standard modules", sources: [standard([
    "## Contract", "## Three groups, and how to tell which one a module is in",
    "## `range` (prelude, no import)", "## Binary data, deterministic computation, and work ownership",
    "## Workers and pull-based WebSockets", "## Application libraries and adapters",
    "## `Text.` (permanent, no import)", "## `Math.` (permanent, no import)",
    "## `Json.` (permanent, no import)", "## `Promise.` (permanent, no import)",
    "## `velar/url`", "## `velar/time`", "## `velar/id`", "## `velar/log`",
    "### `velar/hash`", "### `velar/validation`", "## `velar/test`", "## Deliberate omissions",
  ]), charter(["## Core permanent namespaces and durations"])]},
  validation: {title: "Runtime Type parsing and semantic validation rules", sources: [
    charter(["## 5. Core types"]), standard(["### `velar/validation`"]),
  ]},
});

/** Linked supporting contracts, kept separate from the ten task-oriented topics. */
export const CORE_SKILL_REFERENCES: Readonly<Record<string, CoreSkillTopic>> = Object.freeze({
  readonly: {title: "Layered readonly contract", sources: [{file: "docs/decisions/D117-LAYERED-READONLY.md"}]},
  "package-distribution": {title: "Package source entries and JSON resources", sources: [
    {file: "docs/package-distribution.md", headings: ["### Package source entries"]},
    {file: "docs/package-distribution.md", headings: ["### Package resources"], endBefore: "An extension may give one of its JavaScript module sources"},
  ]},
  "javascript-bridge": {title: "JavaScript declaration bridge", sources: [{file: "docs/javascript-bridge.md"}]},
  "runtime-boundary": {title: "Runtime boundary contracts", sources: [{file: "docs/contributing/runtime-boundary.md", headings: [
    "## Boundary classes", "## Runtime ABI authority", "## Current boundary ledger",
  ]}]},
  "desktop-services": {title: "Multiplexing a service connection", sources: [{file: "packages/desktop/README.md", headings: ["### Multiplexing over one connection"]}]},
});

export function coreSkillTopicsText(): string {
  return [
    "Core reference topics (available offline with this CLI version):",
    ...Object.entries(CORE_SKILL_TOPICS).map(([topic, {title}]) => `  velar skill core ${topic} — ${title}`),
    "",
  ].join("\n");
}
