import { optionalOf as optional, type ClassInfo, type CompilerExtension, type ModuleInterface, type ValueType } from "@velarscript/compiler";
import type { AnalysisContext, CompilerAnalysisExtension, CompilerLexicalExtension, LoweringHints, Token } from "@velarscript/compiler/extension";
import { inferWebIntrinsic, VelarWebAnalyzer } from "./analyzer.ts";
import { WebJavaScriptEmitter } from "./emitter.ts";
import { velarWebProjectEditorExtension } from "./editor.ts";
import { velarWebInspectionExtension } from "./inspection.ts";
import { VelarWebParser } from "./parser.ts";
import { scanWebToken } from "./lexer.ts";
import { webModuleSource, webModuleSources, type VelarWebRuntimeConfig } from "./runtime.ts";
import { velarWebSemanticExtension } from "./semantic.ts";

export const VELAR_WEB_API_VERSION = "0.10";

const anyType: ValueType = { kind: "any" };
const nullType: ValueType = { kind: "null" };
const stringType: ValueType = { kind: "string" };
const numberType: ValueType = { kind: "number" };
const boolType: ValueType = { kind: "bool" };
const nodeType: ValueType = { kind: "node" };
const elementType: ValueType = { kind: "named", name: "Element" };
const inputElementType: ValueType = { kind: "named", name: "InputElement" };
const canvasElementType: ValueType = { kind: "named", name: "CanvasElement" };
const dialogElementType: ValueType = { kind: "named", name: "DialogElement" };
const lengthType: ValueType = { kind: "named", name: "Length" };
const colorType: ValueType = { kind: "named", name: "Color" };
const colorInputType: ValueType = colorType;
const borderType: ValueType = { kind: "named", name: "Border" };
const shadowType: ValueType = { kind: "named", name: "Shadow" };
const imageType: ValueType = { kind: "named", name: "Image" };
const trackType: ValueType = { kind: "named", name: "Track" };
const trackListType: ValueType = { kind: "named", name: "TrackList" };
const transitionType: ValueType = { kind: "named", name: "Transition" };
const durationType: ValueType = { kind: "named", name: "Duration" };
const angleType: ValueType = { kind: "named", name: "Angle" };
const spacingType: ValueType = { kind: "named", name: "Spacing" };

function namedFunction(parameterNames: readonly string[], parameters: readonly ValueType[], result: ValueType, requiredParameters = parameters.length): ValueType {
  return { kind: "function", parameterNames, parameters, requiredParameters, result };
}

const webGlobals = new Map<string, ValueType>([
  ["mount", { kind: "function", parameters: [nodeType, anyType], requiredParameters: 2, result: nullType }],
  ["tick", { kind: "function", parameters: [], requiredParameters: 0, result: { kind: "promise", value: nullType } }],
  ["color", namedFunction(["value"], [stringType], colorType)],
  ["rgb", namedFunction(["red", "green", "blue"], [numberType, numberType, numberType], colorType)],
  ["rgba", namedFunction(["red", "green", "blue", "alpha"], [numberType, numberType, numberType, numberType], colorType)],
  ["hsl", namedFunction(["hue", "saturation", "lightness"], [numberType, numberType, numberType], colorType)],
  ["alpha", namedFunction(["color", "opacity"], [colorInputType, numberType], colorType)],
  ["lighten", namedFunction(["color", "amount"], [colorInputType, numberType], colorType)],
  ["darken", namedFunction(["color", "amount"], [colorInputType, numberType], colorType)],
  ["border", namedFunction(["width", "color", "style"], [lengthType, colorInputType, stringType], borderType, 2)],
  ["shadow", namedFunction(["x", "y", "blur", "color", "spread", "inset"], [lengthType, lengthType, lengthType, colorInputType, lengthType, boolType], shadowType, 4)],
  ["linearGradient", namedFunction(["angle", "from", "to"], [angleType, colorInputType, colorInputType], imageType)],
  ["asset", namedFunction(["path"], [stringType], imageType)],
  ["minmax", namedFunction(["minimum", "maximum"], [anyType, anyType], trackType)],
  ["repeat", namedFunction(["count", "size"], [numberType, anyType], trackListType)],
  ["tracks", { kind: "function", parameters: [], requiredParameters: 0, rest: anyType, result: trackListType }],
  ["transition", namedFunction(["property", "duration", "easing", "delay"], [stringType, durationType, stringType, durationType], transitionType, 2)],
  ["spacing", namedFunction(["first", "second", "third", "fourth"], [anyType, anyType, anyType, anyType], spacingType, 1)],
  ["min", namedFunction(["first", "second"], [lengthType, lengthType], lengthType)],
  ["max", namedFunction(["first", "second"], [lengthType, lengthType], lengthType)],
  ["clamp", namedFunction(["minimum", "preferred", "maximum"], [lengthType, lengthType, lengthType], lengthType)],
]);

function functionType(parameters: readonly ValueType[], result: ValueType, requiredParameters = parameters.length): ValueType {
  return { kind: "function", parameters, requiredParameters, result };
}

function intrinsic(name: string, parameters: readonly ValueType[], result: ValueType, requiredParameters = parameters.length): ValueType {
  return { kind: "intrinsic", name, parameters, requiredParameters, result };
}

function promise(value: ValueType): ValueType {
  return { kind: "promise", value };
}

function object(fields: Readonly<Record<string, ValueType>>): ValueType {
  return { kind: "object", fields: new Map(Object.entries(fields)) };
}

const unknownType: ValueType = { kind: "unknown" };
const errorType: ValueType = { kind: "class", name: "Error" };
const cleanupType = functionType([], nullType);
const arrayString: ValueType = { kind: "list", element: stringType };
const mapString = (value: ValueType): ValueType => ({ kind: "map", key: stringType, value });
const webElementType: ValueType = { kind: "union", members: [elementType, inputElementType, canvasElementType, dialogElementType] };
const fileType = object({ name: stringType, size: numberType, type: stringType, modified: numberType });
const fileArrayType: ValueType = { kind: "list", element: fileType };
const formBodyType = object({
  field: functionType([stringType, stringType], nullType),
  file: functionType([stringType, fileType, stringType], nullType, 2),
  files: functionType([stringType, fileArrayType], nullType),
  remove: functionType([stringType], nullType),
  has: functionType([stringType], boolType),
  names: functionType([], arrayString),
});

const httpResponseType = object({
  ok: boolType,
  status: numberType,
  statusText: stringType,
  url: stringType,
  headers: mapString(stringType),
  json: functionType([], promise(unknownType)),
  text: functionType([], promise(stringType)),
  blob: functionType([], promise(anyType)),
  parse: intrinsic("http.parse", [anyType], promise(anyType)),
});

const requestType = object({
  response: functionType([], promise(httpResponseType)),
  json: functionType([], promise(unknownType)),
  text: functionType([], promise(stringType)),
  blob: functionType([], promise(anyType)),
  parse: intrinsic("http.parse", [anyType], promise(anyType)),
  cancel: functionType([], nullType),
});

const httpOptionsType = object({
  headers: optional(mapString(stringType)),
  body: optional(anyType),
  timeout: optional(numberType),
  maxBytes: optional(numberType),
  credentials: optional(stringType),
  cache: optional(stringType),
});
const httpType = object({
  request: intrinsic("http.request", [stringType, stringType, httpOptionsType], requestType, 2),
  get: intrinsic("http.request", [stringType, httpOptionsType], requestType, 1),
  post: intrinsic("http.request", [stringType, httpOptionsType], requestType, 1),
  put: intrinsic("http.request", [stringType, httpOptionsType], requestType, 1),
  patch: intrinsic("http.request", [stringType, httpOptionsType], requestType, 1),
  delete: intrinsic("http.request", [stringType, httpOptionsType], requestType, 1),
  head: intrinsic("http.request", [stringType, httpOptionsType], requestType, 1),
});

function createStorageType(): ValueType {
  const common = (): Map<string, ValueType> => new Map([
    ["get", intrinsic("storage.get", [stringType, anyType, anyType], anyType, 2)],
    ["set", functionType([stringType, anyType], nullType)],
    ["has", functionType([stringType], boolType)],
    ["keys", functionType([], arrayString)],
    ["remove", functionType([stringType], nullType)],
    ["clear", functionType([], nullType)],
    ["watch", intrinsic("storage.watch", [stringType, anyType, anyType], cleanupType)],
  ]);
  const scoped: ValueType = { kind: "object", fields: common() };
  const fields = common();
  fields.set("scope", functionType([stringType], scoped));
  return { kind: "object", fields };
}

const storageType = createStorageType();
const databaseType = object({
  get: intrinsic("storage.databaseGet", [stringType, anyType, anyType], promise(anyType), 2),
  set: functionType([stringType, anyType], promise(nullType)),
  has: functionType([stringType], promise(boolType)),
  keys: functionType([], promise(arrayString)),
  remove: functionType([stringType], promise(nullType)),
  clear: functionType([], promise(nullType)),
});

const routeType = object({
  path: stringType,
  component: anyType,
});

const routeContextFields = new Map<string, ValueType>([
  ["path", stringType],
  ["params", mapString(stringType)],
  ["query", mapString(stringType)],
  ["hash", stringType],
]);
const routeContextType: ValueType = { kind: "named", name: "RouteContext" };
const navigationOptionsType = object({ replace: optional(boolType), scroll: optional(boolType) });
const formValuesType: ValueType = { kind: "map", key: stringType, value: unknownType };
const browserLocationType = object({
  href: stringType,
  origin: stringType,
  path: stringType,
  query: mapString(stringType),
  hash: stringType,
});
const browserEnvironmentType = object({
  language: stringType,
  languages: arrayString,
  online: boolType,
  visible: boolType,
  colorScheme: stringType,
  reducedMotion: boolType,
  touch: boolType,
});
const rectType = object({
  x: numberType, y: numberType, width: numberType, height: numberType,
  top: numberType, right: numberType, bottom: numberType, left: numberType,
});
const fileOptionsType = object({ accept: optional(stringType), multiple: optional(boolType) });
const socketHandlersType = object({
  open: optional(functionType([], unknownType)),
  message: optional(functionType([stringType], unknownType)),
  error: optional(functionType([stringType], unknownType)),
  close: optional(functionType([numberType, stringType], unknownType)),
});
const socketType = object({
  url: stringType,
  state: functionType([], stringType),
  send: functionType([stringType], nullType),
  sendJson: intrinsic("realtime.sendJson", [anyType], nullType),
  close: functionType([numberType, stringType], nullType, 0),
});
const eventStreamHandlersType = object({
  open: optional(functionType([], unknownType)),
  message: optional(functionType([stringType, stringType], unknownType)),
  error: optional(functionType([stringType], unknownType)),
});
const eventStreamType = object({ url: stringType, state: functionType([], stringType), close: functionType([], nullType) });
const appErrorType = object({
  error: errorType,
  phase: stringType,
  detail: stringType,
  component: stringType,
  timestamp: numberType,
});
const browserTestControllerType = object({
  open: functionType([stringType], promise(nullType), 0),
  reload: functionType([], promise(nullType)),
  click: functionType([stringType], promise(nullType)),
  fill: functionType([stringType, stringType], promise(nullType)),
  select: functionType([stringType, stringType], promise(nullType)),
  press: functionType([stringType, stringType], promise(nullType)),
  text: functionType([stringType], promise(stringType)),
  attribute: functionType([stringType, stringType], promise(optional(stringType))),
  namespace: functionType([stringType], promise(stringType)),
  count: functionType([stringType], promise(numberType)),
  visible: functionType([stringType], promise(boolType)),
  waitFor: functionType([stringType, stringType], promise(nullType), 1),
  waitForText: functionType([stringType, stringType], promise(nullType)),
  currentPath: functionType([], promise(stringType)),
  viewport: functionType([numberType, numberType], promise(nullType)),
});


export const webModuleInterfaces: ReadonlyMap<string, ModuleInterface> = new Map([
  ["velar/app", moduleInterface(new Map([
    ["onError", functionType([functionType([appErrorType], unknownType)], cleanupType)],
    ["reportError", functionType([errorType, stringType, stringType], nullType, 1)],
  ]))],
  ["velar/config", moduleInterface(new Map([
    ["publicConfig", intrinsic("config.public", [anyType], anyType)],
    ["has", functionType([stringType], boolType)],
    ["keys", functionType([], arrayString)],
  ]))],
  ["velar/web", moduleInterface(new Map([
    ["RouteContext", { kind: "typeObject", name: "RouteContext" }],
    ["route", intrinsic("web.route", [stringType, anyType], routeType)],
    ["lazy", intrinsic("web.lazy", [functionType([], promise(anyType)), stringType, anyType, anyType], anyType, 2)],
    ["navigate", functionType([stringType, navigationOptionsType], nullType, 1)],
    ["redirect", functionType([stringType], nullType)],
    ["back", functionType([], nullType)],
    ["forward", functionType([], nullType)],
    ["reload", functionType([], nullType)],
    ["currentRoute", functionType([], routeContextType)],
    ["announce", functionType([stringType, stringType], nullType, 1)],
    ["domId", functionType([stringType], stringType, 0)],
    ["Head", { kind: "componentConstructor", name: "Head", props: new Map<string, ValueType>([
      ["title", stringType], ["description", stringType], ["canonical", stringType], ["robots", stringType],
      ["image", stringType], ["themeColor", stringType], ["language", stringType],
    ]), requiredProps: new Set(["title"]) }],
    ["Router", { kind: "componentConstructor", name: "Router", props: new Map<string, ValueType>([["routes", { kind: "list", element: routeType }], ["fallback", anyType]]), requiredProps: new Set(["routes"]), intrinsic: "web.router" }],
    ["Link", { kind: "componentConstructor", name: "Link", props: new Map<string, ValueType>([["to", stringType], ["replace", boolType], ["class", optional(stringType)], ["look", optional({ kind: "named", name: "Look" })], ["children", nodeType]]), requiredProps: new Set(["to"]) }],
    ["NavLink", { kind: "componentConstructor", name: "NavLink", props: new Map<string, ValueType>([["to", stringType], ["exact", boolType], ["replace", boolType], ["class", optional(stringType)], ["look", optional({ kind: "named", name: "Look" })], ["children", nodeType]]), requiredProps: new Set(["to"]) }],
  ]), new Map(), new Map([["RouteContext", routeContextFields]]), new Map([
    ["RouteContext", "@velarscript/web:velar/web#type:RouteContext"],
  ]))],
  ["velar/http", moduleInterface(new Map([
    ["http", httpType],
    ["formBody", functionType([], formBodyType)],
    ["HttpAbortError", { kind: "classConstructor", name: "HttpAbortError" }],
    ["HttpError", { kind: "classConstructor", name: "HttpError" }],
  ]), new Map([
    ["HttpAbortError", {
      parameters: [stringType],
      requiredParameters: 1,
      base: "Error",
      abstract: false,
      fields: new Map([["reason", { mutable: false, type: stringType }]]),
      getters: new Set(),
      abstractGetters: new Set(),
      methods: new Map(),
      abstractMethods: new Set(),
      staticFields: new Map(),
      staticGetters: new Set(),
      staticMethods: new Map(),
    }],
    ["HttpError", {
      parameters: [stringType, numberType, stringType, unknownType],
      requiredParameters: 3,
      base: "Error",
      abstract: false,
      fields: new Map([
        ["status", { mutable: false, type: numberType }],
        ["url", { mutable: false, type: stringType }],
        ["body", { mutable: false, type: unknownType }],
      ]),
      getters: new Set(),
      abstractGetters: new Set(),
      methods: new Map(),
      abstractMethods: new Set(),
      staticFields: new Map(),
      staticGetters: new Set(),
      staticMethods: new Map(),
    }],
  ]))],
  ["velar/storage", moduleInterface(new Map([
    ["storage", storageType],
    ["session", storageType],
    ["database", functionType([stringType], databaseType)],
  ]))],
  ["velar/forms", moduleInterface(new Map([
    ["values", functionType([elementType], formValuesType)],
    ["read", intrinsic("forms.read", [elementType, anyType], anyType)],
    ["fieldValue", functionType([elementType, stringType], optional(unknownType))],
    ["textValue", functionType([elementType, stringType, stringType], stringType, 2)],
    ["numberValue", functionType([elementType, stringType], optional(numberType))],
    ["checkedValue", functionType([elementType, stringType], boolType)],
    ["fieldValues", functionType([elementType, stringType], arrayString)],
    ["setError", functionType([elementType, stringType, stringType], nullType)],
    ["clearError", functionType([elementType, stringType], nullType)],
    ["clearErrors", functionType([elementType], nullType)],
    ["errors", functionType([elementType], mapString(stringType))],
    ["focusFirstError", functionType([elementType], boolType)],
    ["setPending", functionType([elementType, boolType], nullType)],
    ["reset", functionType([elementType], nullType)],
  ]))],
  ["velar/browser", moduleInterface(new Map([
    ["after", functionType([numberType, functionType([], unknownType)], cleanupType)],
    ["location", functionType([], browserLocationType)],
    ["environment", functionType([], browserEnvironmentType)],
    ["copyText", functionType([stringType], promise(nullType))],
    ["readClipboardText", functionType([], promise(stringType))],
    ["open", functionType([stringType, stringType], nullType, 1)],
    ["scrollTo", functionType([numberType, numberType, stringType], nullType, 2)],
    ["scrollIntoView", functionType([webElementType, stringType], nullType, 1)],
    ["focus", functionType([webElementType, boolType], nullType, 1)],
    ["blur", functionType([webElementType], nullType)],
    ["measure", functionType([webElementType], rectType)],
    ["media", functionType([stringType], boolType)],
    ["watchMedia", functionType([stringType, functionType([boolType], unknownType)], cleanupType)],
    ["watchOnline", functionType([functionType([boolType], unknownType)], cleanupType)],
    ["watchVisibility", functionType([functionType([boolType], unknownType)], cleanupType)],
    ["showDialog", functionType([dialogElementType], nullType)],
    ["closeDialog", functionType([dialogElementType, stringType], nullType, 1)],
    ["dialogResult", functionType([dialogElementType], stringType)],
    ["every", functionType([numberType, functionType([], unknownType)], cleanupType)],
    ["frame", functionType([], promise(numberType))],
  ]))],
  ["velar/files", moduleInterface(new Map([
    ["pick", functionType([fileOptionsType], promise(fileArrayType), 0)],
    ["readText", functionType([fileType, numberType], promise(stringType), 1)],
    ["readDataUrl", functionType([fileType, numberType], promise(stringType), 1)],
    ["download", functionType([stringType, stringType, stringType], nullType, 2)],
  ]))],
  ["velar/realtime", moduleInterface(new Map([
    ["socket", functionType([stringType, socketHandlersType], socketType, 1)],
    ["eventStream", functionType([stringType, eventStreamHandlersType, boolType], eventStreamType, 1)],
  ]))],
  ["velar/web-test", moduleInterface(new Map([
    ["browser", browserTestControllerType],
  ]))],
]);

function moduleInterface(
  exports: ReadonlyMap<string, ValueType>,
  classes: ReadonlyMap<string, ClassInfo> = new Map(),
  namedTypes: ReadonlyMap<string, ReadonlyMap<string, ValueType>> = new Map(),
  namedTypeIdentities: ReadonlyMap<string, string> = new Map(),
): ModuleInterface {
  return { exports, hostBoundaryExports: new Set(), reactiveExports: new Map(), namedTypes, namedTypeIdentities, typeAliases: new Map(), enums: new Map(), classes, testFunctions: [], extensionExports: new Map(), extensionData: new Map() };
}

export const velarCompilerExtension: CompilerExtension = Object.freeze({
  id: "@velarscript/web",
  capabilities: Object.freeze(["web"]),
  lexical: Object.freeze({
    keywords: Object.freeze({
      component: "component",
      state: "state",
      computed: "computed",
      resource: "resource",
      action: "action",
      watch: "watch",
      mounted: "mounted",
      cleanup: "cleanup",
      look: "look",
      css: "css",
    }),
    forbiddenIdentifiers: Object.freeze({
      effect: "Effects are internal to @velarscript/web; use watch, mounted, or cleanup",
      onMount: "Use the Web extension's component-level 'mounted:' block",
      onMounted: "Use the Web extension's component-level 'mounted:' block",
      on_mount: "Use the Web extension's component-level 'mounted:' block",
    }),
    numericSuffixes: new Set(["px", "rem", "em", "%", "vw", "vh", "vmin", "vmax", "fr", "ms", "s", "deg", "turn"]),
    scan: scanWebToken,
  }),
  parser: Object.freeze({
    create(tokens: readonly Token[], lexicalExtensions: readonly CompilerLexicalExtension[]) {
      return new VelarWebParser(tokens, lexicalExtensions);
    },
  }),
  analyzer: Object.freeze({
    create(context: AnalysisContext, extensions: readonly CompilerAnalysisExtension[]) {
      return new VelarWebAnalyzer(context, extensions);
    },
  }),
  semantic: velarWebSemanticExtension,
  inspection: velarWebInspectionExtension,
  analysis: Object.freeze({
    primitiveTypes: new Set(["WebNode", "Element", "InputElement", "CanvasElement", "DialogElement", "Event", "KeyboardEvent", "PointerEvent", "InputEvent", "Look", "Length", "Percentage", "Color", "Duration", "Angle", "Opacity", "Border", "Shadow", "Image", "Track", "TrackList", "Transition", "Spacing"]),
    globals: webGlobals,
    reservedBindings: new Set(["mount", "tick"]),
    globalGuidance: new Map([
      ["document", "Use JSX, refs, and velar/browser instead of the untyped document global"],
      ["window", "Use velar/browser or an explicit JavaScript boundary instead of the untyped window global"],
      ["navigator", "Use velar/browser instead of the navigator global"],
      ["location", "Use velar/browser location() or velar/web navigation instead of the location global"],
      ["history", "Use velar/web navigation instead of the history global"],
      ["fetch", "Use velar/http instead of the raw fetch global"],
    ]),
    inferIntrinsic: inferWebIntrinsic,
  }),
  editor: Object.freeze({
    project: velarWebProjectEditorExtension,
    keywordDocumentation: Object.freeze({
      component: "Declares a compiler-managed Web component that initializes once.",
      state: "Declares writable reactive state at module or component scope.",
      computed: "Declares a lazy cached value derived from module or component state.",
      resource: "Declares component-owned asynchronous data with reactive value, loading, ready, error, and reload fields.",
      action: "Declares a component-owned asynchronous operation with reactive pending and error fields.",
      watch: "Runs a block after a watched expression changes and DOM updates commit.",
      mounted: "Runs once after the component DOM is inserted.",
      cleanup: "Runs once before the component and its owned resources are destroyed.",
      look: "Builds a typed, composable Web appearance value.",
    }),
    typeDocumentation: Object.freeze({
      WebNode: "A value that can be rendered as component or JSX children.",
      Element: "A general native element reference obtained through JSX `ref`.",
      InputElement: "A native input, select, or textarea reference obtained through JSX `ref`.",
      CanvasElement: "A native canvas reference obtained through JSX `ref`.",
      DialogElement: "A native dialog reference obtained from `<dialog ref={value}>` and operated through `velar/browser`.",
      Event: "A restricted Web event value exposed to VelarScript event handlers.",
      Look: "A typed, composable Web appearance value applied through JSX look={...}.",
    }),
    completions: Object.freeze([
      ...["component", "state", "computed", "resource", "action", "watch", "mounted", "cleanup", "look"].map((label) => ({ label, kind: 14 })),
      { label: "mount", kind: 3, detail: "mount(node, target) -> null" },
      { label: "tick", kind: 3, detail: "tick() -> Promise<null>" },
      { label: "bind:value", kind: 10, detail: "Two-way string state binding" },
      { label: "bind:checked", kind: 10, detail: "Two-way boolean state binding" },
      { label: "on:click", kind: 10, detail: "DOM click handler" },
      { label: "on:submit.prevent", kind: 10, detail: "DOM event with a preventDefault modifier" },
      { label: "class:", kind: 10, detail: "Reactive class directive" },
      { label: "look={value}", kind: 10, detail: "Apply a typed Look value" },
      { label: "import css unsafe", kind: 14, detail: "Import native CSS before Look output" },
      { label: "after look", kind: 14, detail: "Place an unsafe CSS import after Look output" },
      { label: "velar/app", kind: 9, detail: "Application error reports and explicit handler ownership" },
      { label: "velar/config", kind: 9, detail: "Validated manifest-declared public application configuration" },
      { label: "velar/web", kind: 9, detail: "Typed routing, navigation, metadata, and announcements" },
      { label: "velar/forms", kind: 9, detail: "Form values, pending state, and accessible field errors" },
      { label: "velar/http", kind: 9, detail: "Typed HTTP responses, runtime parsing, timeout, and cancellation" },
      { label: "velar/storage", kind: 9, detail: "Typed local, session, scoped, observed, and IndexedDB storage" },
      { label: "velar/browser", kind: 9, detail: "Browser state, cancellable timers, clipboard, media, visibility, layout, and frames" },
      { label: "velar/files", kind: 9, detail: "Cross-browser file selection, reading, and downloads" },
      { label: "velar/realtime", kind: 9, detail: "WebSocket and server-sent event connections" },
      { label: "velar/web-test", kind: 9, detail: "Restricted browser automation for Web tests" },
    ]),
  }),
  modules: Object.freeze({
    apiVersion: VELAR_WEB_API_VERSION,
    interfaces: webModuleInterfaces,
    sources: webModuleSources,
    source(specifier: string, projectConfig: unknown) {
      return webModuleSource(specifier, (projectConfig ?? { base: "/" }) as VelarWebRuntimeConfig);
    },
  }),
  createEmitter(
    hints: LoweringHints,
    forcedFunctionExports: ReadonlySet<string>,
    resourceContents: ReadonlyMap<string, string>,
    extensionImports: ReadonlyMap<string, ReadonlyMap<string, unknown>>,
  ) {
    return new WebJavaScriptEmitter(hints, forcedFunctionExports, resourceContents, extensionImports);
  },
});

export { webModuleSource, webModuleSources, type VelarWebRuntimeConfig };
export { velarProjectExtension, type VelarWebConfig } from "./project-config.ts";
