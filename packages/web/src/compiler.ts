/**
 * The Web extension's composition root. `compiler.ts` was one 1,136-line module;
 * D115 P4 R3e moved each `velar/*` surface's `ValueType` tables into its own
 * `modules/<surface>.ts` file and the editor prose into `documentation.ts`, and
 * left here what a composition root is: the published surface version, the
 * assembled module map, and the frozen extension literal every part of the
 * toolchain reads the Web target through.
 *
 * Where to look:
 *
 *  - `modules/types.ts`     the type vocabulary every surface table is written in
 *  - `modules/<surface>.ts` one file per `velar/*` surface, holding its tables and its entry
 *  - `module-roster.ts`     the ordered entry list this file assembles the map from
 *  - `documentation.ts`     the three editor-documentation tables
 */
import { type CompilerExtension, type ModuleInterface, type ValueType } from "@velarscript/compiler";
import type { AnalysisContext, CompilerAnalysisExtension, CompilerEmitterOptions, CompilerLexicalExtension, LoweringHints, Token } from "@velarscript/compiler/extension";
import { inferWebIntrinsic, VelarWebAnalyzer } from "./analyzer.ts";
import {
  WEB_STATEMENT_CONSTRUCTS,
  webExpressionContainsDirectAwait,
  webStatementConstructKey,
  webStatementContainsDirectAwait,
} from "./ast.ts";
import { BROWSER_TEST_MODULE, BROWSER_TEST_SOURCE_SUFFIX, browserTestDrivingGuidance } from "./browser-test.ts";
import { webKeywordDocumentation } from "./documentation.ts";
import { WEB_VOID_ELEMENTS } from "./elements.ts";
import { WebJavaScriptEmitter } from "./emitter.ts";
import { velarWebProjectEditorExtension } from "./editor.ts";
import { velarWebInspectionExtension } from "./inspection.ts";
import { webModuleEntries } from "./module-roster.ts";
import { mountTargetType, namedFunction, nodeType, nullType, webCanonicalCollectionProjection } from "./modules/types.ts";
import { VelarWebParser } from "./parser.ts";
import { scanWebToken, scanWebUnsafeCssLiteral, WEB_CONTEXTUAL_KEYWORDS } from "./lexer.ts";
import { webModuleSource, webModuleSources, type VelarWebRuntimeConfig } from "./runtime.ts";
import { velarWebSemanticExtension } from "./semantic.ts";
import { LOOK_BUILDERS, LOOK_MEDIA_SUBJECTS, LOOK_UNIT_TYPES } from "./look.ts";
import { isWebTypeAssignable, resolveWebTypeSyntax, WEB_OWNED_TYPE_NAMES } from "./types.ts";

export const VELAR_WEB_API_VERSION = "0.14";

// D57 rule 138 gave the browser-test boundary teeth, so the two names it is
// written in are part of the published contract: the framework host hands the
// suffix to the CLI runner, and tooling that has to name a browser test module
// reads both from here instead of spelling them again.
export { BROWSER_TEST_MODULE, BROWSER_TEST_SOURCE_SUFFIX } from "./browser-test.ts";

const webGlobals = new Map<string, ValueType>([
  ["mount", namedFunction(["node", "target"], [nodeType, mountTargetType], nullType)],
  ["tick", namedFunction([], [], { kind: "promise", value: nullType })],
]);

const webTextFormTypes = new Set(LOOK_UNIT_TYPES.values());
// D72 rule 186: derived from the one published table. `Component` is the only
// name that answers `textForm` differently — it is a constructor contract
// rather than a value type — so it is subtracted here rather than kept in a
// second list.
const webOwnedNamedTypes = new Set([...WEB_OWNED_TYPE_NAMES].filter((name) => name !== "Component"));

/**
 * The `velar/*` surfaces this capability publishes. One `modules/<surface>.ts`
 * file owns each entry's tables; `module-roster.ts` owns the order they are
 * assembled in, because a file this map is built from cannot import the map.
 */
export const webModuleInterfaces: ReadonlyMap<string, ModuleInterface> = new Map(webModuleEntries);

export const velarCompilerExtension: CompilerExtension = Object.freeze({
  id: "@velarscript/web",
  contract: Object.freeze({ protocolVersion: 1, apiVersion: VELAR_WEB_API_VERSION, kind: "application", extends: Object.freeze({}) }),
  capabilities: Object.freeze(["web"]),
  formatting: Object.freeze({
    angleBracketEmbedding: Object.freeze({ voidElements: WEB_VOID_ELEMENTS }),
    scanOpaqueSource: scanWebUnsafeCssLiteral,
  }),
  lexical: Object.freeze({
    // D30 item 16: every word the Web extension adds is contextual. Each is an
    // ordinary name until its own declaration shape appears, so a Web module
    // and a Core module accept exactly the same bindings.
    contextualKeywords: WEB_CONTEXTUAL_KEYWORDS,
    forbiddenIdentifiers: Object.freeze({
      effect: "Effects are internal to @velarscript/web; use watch, @mounted, or @cleanup",
      onMount: "Use the Web extension's component-level '@mounted:' block",
      onMounted: "Use the Web extension's component-level '@mounted:' block",
      on_mount: "Use the Web extension's component-level '@mounted:' block",
    }),
    numericSuffixes: new Set(LOOK_UNIT_TYPES.keys()),
    scan: scanWebToken,
  }),
  parser: Object.freeze({
    create(tokens: readonly Token[], lexicalExtensions: readonly CompilerLexicalExtension[]) {
      return new VelarWebParser(tokens, lexicalExtensions);
    },
  }),
  // D56 rule 129: the parser above adds eleven statement constructs to the
  // language, and a coverage gate that only reads vocabulary tables cannot see
  // one of them. This is how they are required of `examples/tour/`.
  syntax: Object.freeze({
    statementConstructs: WEB_STATEMENT_CONSTRUCTS,
    statementConstructKey: webStatementConstructKey,
  }),
  analyzer: Object.freeze({
    create(context: AnalysisContext, extensions: readonly CompilerAnalysisExtension[]) {
      return new VelarWebAnalyzer(context, extensions);
    },
  }),
  semantic: velarWebSemanticExtension,
  inspection: velarWebInspectionExtension,
  analysis: Object.freeze({
    directAwaitExpression: webExpressionContainsDirectAwait,
    directAwaitStatement: webStatementContainsDirectAwait,
    canonicalCollectionProjection: webCanonicalCollectionProjection,
    // `Duration` is Core's own primitive; the Web extension reads it but does
    // not register it a second time.
    primitiveTypes: new Set([...WEB_OWNED_TYPE_NAMES].filter((name) => name !== "Duration")),
    primitiveParents: new Map([
      ["InputElement", new Set(["Element"])],
      ["TextAreaElement", new Set(["InputElement"])],
      ["CanvasElement", new Set(["Element"])],
      ["DialogElement", new Set(["Element"])],
      ["KeyboardEvent", new Set(["Event"])],
      ["PointerEvent", new Set(["Event"])],
      ["InputEvent", new Set(["Event"])],
      ["CompositionEvent", new Set(["Event"])],
      ["ClipboardEvent", new Set(["Event"])],
    ]),
    primitiveMutableFields: new Map([
      ["InputElement", new Set(["value", "checked"])],
      ["CanvasElement", new Set(["width", "height"])],
    ]),
    globals: webGlobals,
    // D52 rule 114: `Look.spacing(...)` still parses, so it still has to be
    // answered — with the named import that replaced it, and with the rewrite
    // that gets there in one step.
    retiredNamespaces: new Map([["Look", { module: "velar/look", members: LOOK_BUILDERS }]]),
    // LOK-D4: the Look media subjects are matched by name inside a Look
    // condition, ahead of ordinary lexical resolution. A user binding of the
    // same name used to be reverse-shadowed with no diagnostic anywhere, so the
    // three names are reserved in a Web module.
    reservedBindings: new Set(["mount", "tick", ...LOOK_MEDIA_SUBJECTS.keys()]),
    globalGuidance: new Map([
      // D52 rule 114: the destination is the spelling that survives, so the
      // guidance names the import outright rather than a prefix the next
      // compile would retire in turn.
      ...[...LOOK_BUILDERS].map((name) => [name, `Import the builder — import {${name}} from "velar/look" — then call ${name}(...)`] as const),
      ["document", "Use JSX, refs, and velar/browser instead of the untyped document global"],
      ["window", "Use velar/browser or an explicit JavaScript boundary instead of the untyped window global"],
      ["navigator", "Use velar/browser instead of the navigator global"],
      ["location", "Use velar/browser location() or velar/web navigation instead of the location global"],
      ["history", "Use velar/web navigation instead of the history global"],
      ["fetch", "Use velar/http instead of the raw fetch global"],
      // D90 coherence-6c: the storage guidance used to live only in the
      // browser-test map below, so an ordinary component — the place the reflex
      // is actually written — got a bare "Unknown name". `guidanceForGlobal`
      // consults the path-suffix map first per name, so the browser-test
      // answers keep winning inside a `.browser.test.vel` body.
      ["localStorage", 'Use \'import {storage} from "velar/storage"\' — it is a typed, validated key/value area instead of the untyped string store'],
      ["sessionStorage", 'Use \'import {session} from "velar/storage"\' — it is a typed, validated key/value area that lasts for the tab'],
      // `velar/websocket` is extension-owned rather than Core's, so each
      // surface answers this one for itself. A browser can only `connect`;
      // the Node extension's sentence names `listen` as well.
      ["WebSocket", 'Use "velar/websocket" — \'connect\' opens a connection — instead of the WebSocket global'],
    ]),
    // A `.browser.test.vel` body runs in the test process and drives a page
    // that already runs the built application, so the DOM globals do not point
    // at velar/browser there: the door is velar/web-test.
    globalGuidanceByPathSuffix: new Map([
      [BROWSER_TEST_SOURCE_SUFFIX, new Map([
        ["document", browserTestDrivingGuidance("document")],
        ["window", browserTestDrivingGuidance("window")],
        ["navigator", browserTestDrivingGuidance("navigator")],
        ["localStorage", browserTestDrivingGuidance("localStorage")],
        ["sessionStorage", browserTestDrivingGuidance("sessionStorage")],
      ])],
    ]),
    resolveTypeSyntax: resolveWebTypeSyntax,
    isTypeAssignable: isWebTypeAssignable,
    textForm(type: ValueType): boolean | undefined {
      if (type.kind === "extension" && type.extensionId === "@velarscript/web") return false;
      if (type.kind !== "named" || !webOwnedNamedTypes.has(type.name)) return undefined;
      return webTextFormTypes.has(type.name as "Length" | "Percentage" | "TrackFraction" | "Duration" | "Angle");
    },
    inferIntrinsic: inferWebIntrinsic,
  }),
  editor: Object.freeze({
    project: velarWebProjectEditorExtension,
    keywordDocumentation: webKeywordDocumentation,
    typeDocumentation: Object.freeze({
      WebNode: "A value that can be rendered as component or JSX children.",
      Element: "A general native element reference obtained through JSX `ref`.",
      InputElement: "A native input, select, or textarea reference obtained through JSX `ref`.",
      TextAreaElement: "A native textarea reference whose selection is accessed through velar/browser code-point APIs.",
      CanvasElement: "A native canvas reference obtained through JSX `ref`.",
      DialogElement: "A native dialog reference obtained from `<dialog ref={value}>` and operated through `velar/browser`.",
      Blob: "An opaque binary HTTP body returned by `blob()` and accepted by HTTP request bodies.",
      File: "An opaque selected file returned by `velar/files.pick()` with checked read-only metadata.",
      Event: "A restricted Web event value exposed to VelarScript event handlers.",
      Look: "A typed, composable Web appearance value applied through JSX look={...}.",
    }),
    completions: Object.freeze([
      ...["component", "state", "computed", "resource", "action", "watch", "@mounted", "@cleanup", "exposes", "expose", "look", "keyframes"].map((label) => ({ label, kind: 14 })),
      { label: "mount", kind: 3, detail: "mount(node, target) -> null" },
      { label: "tick", kind: 3, detail: "tick() -> Promise<null>" },
      { label: "bind:value", kind: 10, detail: "Two-way string state binding" },
      { label: "bind:checked", kind: 10, detail: "Two-way boolean state binding" },
      { label: "bind:group", kind: 10, detail: "Two-way radio or checkbox group binding" },
      { label: "on:click", kind: 10, detail: "DOM click handler" },
      { label: "on:submit.prevent", kind: 10, detail: "DOM event with a preventDefault modifier" },
      { label: "class:", kind: 10, detail: "Reactive class directive" },
      { label: "look={value}", kind: 10, detail: "Apply a typed Look value" },
      { label: "style:color={value}", kind: 10, detail: "High-priority checked inline Style compatibility override" },
      { label: "import css unsafe", kind: 14, detail: "Import native CSS before Look output" },
      { label: "unsafe css", kind: 14, detail: "Embed multiline raw CSS before or after Look output" },
      { label: "after look", kind: 14, detail: "Place an unsafe CSS import after Look output" },
      { label: "velar/look", kind: 9, detail: "Named visual builders and visual value Type objects" },
      { label: "velar/app", kind: 9, detail: "Application error reports and explicit handler ownership" },
      { label: "velar/config", kind: 9, detail: "Validated manifest-declared public application configuration" },
      { label: "velar/web", kind: 9, detail: "Typed routing, navigation, metadata, and announcements" },
      { label: "velar/forms", kind: 9, detail: "Form values, pending state, and accessible field errors" },
      { label: "velar/http", kind: 9, detail: "Typed HTTP responses, runtime parsing, timeout, and cancellation" },
      { label: "velar/storage", kind: 9, detail: "Typed local, session, scoped, observed, and IndexedDB storage" },
      { label: "velar/browser", kind: 9, detail: "Browser state, cancellable timers, clipboard, media, visibility, layout, and frames" },
      { label: "velar/files", kind: 9, detail: "Cross-browser file selection, reading, and downloads" },
      { label: "velar/realtime", kind: 9, detail: "WebSocket and server-sent event connections" },
      { label: BROWSER_TEST_MODULE, kind: 9, detail: `Restricted browser automation, imported only from a *${BROWSER_TEST_SOURCE_SUFFIX} module` },
    ]),
  }),
  modules: Object.freeze({
    apiVersion: VELAR_WEB_API_VERSION,
    interfaces: webModuleInterfaces,
    sources: webModuleSources,
    dependencies: new Map([
      ["velar/worker", ["velar/worker-manifest", "velar/task", "velar/binary"]],
      ["velar/http", ["velar/binary"]],
      ["velar/storage", ["velar/binary"]],
      ["velar/realtime", ["velar/websocket"]],
    ]),
    source(specifier: string, projectConfig: unknown) {
      return webModuleSource(specifier, (projectConfig ?? { base: "/" }) as VelarWebRuntimeConfig);
    },
  }),
  createEmitter(
    hints: LoweringHints,
    forcedFunctionExports: ReadonlySet<string>,
    resourceContents: ReadonlyMap<string, string>,
    extensionImports: ReadonlyMap<string, ReadonlyMap<string, unknown>>,
    options: CompilerEmitterOptions,
  ) {
    return new WebJavaScriptEmitter(hints, forcedFunctionExports, resourceContents, extensionImports, options);
  },
});

export { webModuleSource, webModuleSources, type VelarWebRuntimeConfig };
export { velarProjectExtension, type VelarWebConfig } from "./project-config.ts";
