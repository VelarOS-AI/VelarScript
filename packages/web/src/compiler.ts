import type { ClassInfo, CompilerExtension, ModuleInterface, ValueType } from "@velarscript/compiler";
import type { AnalysisContext, CompilerAnalysisExtension, CompilerLexicalExtension, LoweringHints, Token } from "@velarscript/compiler/extension";
import { inferWebIntrinsic, VelarWebAnalyzer } from "./analyzer.ts";
import { WebJavaScriptEmitter } from "./emitter.ts";
import { velarWebProjectEditorExtension } from "./editor.ts";
import { velarWebInspectionExtension } from "./inspection.ts";
import { VelarWebParser } from "./parser.ts";
import { webModuleSource, webModuleSources, type VelarWebRuntimeConfig } from "./runtime.ts";
import { velarWebSemanticExtension } from "./semantic.ts";

export const VELAR_WEB_API_VERSION = "0.8";

const anyType: ValueType = { kind: "any" };
const noneType: ValueType = { kind: "none" };
const stringType: ValueType = { kind: "string" };
const numberType: ValueType = { kind: "number" };
const boolType: ValueType = { kind: "bool" };
const nodeType: ValueType = { kind: "node" };
const elementType: ValueType = { kind: "named", name: "Element" };
const inputElementType: ValueType = { kind: "named", name: "InputElement" };
const canvasElementType: ValueType = { kind: "named", name: "CanvasElement" };
const dialogElementType: ValueType = { kind: "named", name: "DialogElement" };

const webGlobals = new Map<string, ValueType>([
  ["mount", { kind: "function", parameters: [nodeType, anyType], requiredParameters: 2, result: noneType }],
  ["tick", { kind: "function", parameters: [], requiredParameters: 0, result: { kind: "promise", value: noneType } }],
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

function optional(value: ValueType): ValueType {
  return { kind: "optional", inner: value };
}

function object(fields: Readonly<Record<string, ValueType>>): ValueType {
  return { kind: "object", fields: new Map(Object.entries(fields)) };
}

const unknownType: ValueType = { kind: "unknown" };
const errorType: ValueType = { kind: "class", name: "Error" };
const cleanupType = functionType([], noneType);
const listString: ValueType = { kind: "list", element: stringType };
const mapString = (value: ValueType): ValueType => ({ kind: "map", key: stringType, value });
const webElementType: ValueType = { kind: "union", members: [elementType, inputElementType, canvasElementType, dialogElementType] };
const fileType = object({ name: stringType, size: numberType, type: stringType, modified: numberType });
const fileListType: ValueType = { kind: "list", element: fileType };
const formBodyType = object({
  field: functionType([stringType, stringType], noneType),
  file: functionType([stringType, fileType, stringType], noneType, 2),
  files: functionType([stringType, fileListType], noneType),
  remove: functionType([stringType], noneType),
  has: functionType([stringType], boolType),
  names: functionType([], listString),
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
  cancel: functionType([], noneType),
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
    ["set", functionType([stringType, anyType], noneType)],
    ["has", functionType([stringType], boolType)],
    ["keys", functionType([], listString)],
    ["remove", functionType([stringType], noneType)],
    ["clear", functionType([], noneType)],
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
  set: functionType([stringType, anyType], promise(noneType)),
  has: functionType([stringType], promise(boolType)),
  keys: functionType([], promise(listString)),
  remove: functionType([stringType], promise(noneType)),
  clear: functionType([], promise(noneType)),
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
  languages: listString,
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
  send: functionType([stringType], noneType),
  sendJson: intrinsic("realtime.sendJson", [anyType], noneType),
  close: functionType([numberType, stringType], noneType, 0),
});
const eventStreamHandlersType = object({
  open: optional(functionType([], unknownType)),
  message: optional(functionType([stringType, stringType], unknownType)),
  error: optional(functionType([stringType], unknownType)),
});
const eventStreamType = object({ url: stringType, state: functionType([], stringType), close: functionType([], noneType) });
const appErrorType = object({
  error: errorType,
  phase: stringType,
  detail: stringType,
  component: stringType,
  timestamp: numberType,
});
const browserTestControllerType = object({
  open: functionType([stringType], promise(noneType), 0),
  reload: functionType([], promise(noneType)),
  click: functionType([stringType], promise(noneType)),
  fill: functionType([stringType, stringType], promise(noneType)),
  select: functionType([stringType, stringType], promise(noneType)),
  press: functionType([stringType, stringType], promise(noneType)),
  text: functionType([stringType], promise(stringType)),
  attribute: functionType([stringType, stringType], promise(optional(stringType))),
  namespace: functionType([stringType], promise(stringType)),
  count: functionType([stringType], promise(numberType)),
  visible: functionType([stringType], promise(boolType)),
  waitFor: functionType([stringType, stringType], promise(noneType), 1),
  waitForText: functionType([stringType, stringType], promise(noneType)),
  currentPath: functionType([], promise(stringType)),
  viewport: functionType([numberType, numberType], promise(noneType)),
});


export const webModuleInterfaces: ReadonlyMap<string, ModuleInterface> = new Map([
  ["velar/app", moduleInterface(new Map([
    ["onError", functionType([functionType([appErrorType], unknownType)], cleanupType)],
    ["reportError", functionType([errorType, stringType, stringType], noneType, 1)],
  ]))],
  ["velar/config", moduleInterface(new Map([
    ["publicConfig", intrinsic("config.public", [anyType], anyType)],
    ["has", functionType([stringType], boolType)],
    ["keys", functionType([], listString)],
  ]))],
  ["velar/web", moduleInterface(new Map([
    ["RouteContext", { kind: "typeObject", name: "RouteContext" }],
    ["route", intrinsic("web.route", [stringType, anyType], routeType)],
    ["lazy", intrinsic("web.lazy", [functionType([], promise(anyType)), stringType, anyType, anyType], anyType, 2)],
    ["navigate", functionType([stringType, navigationOptionsType], noneType, 1)],
    ["redirect", functionType([stringType], noneType)],
    ["back", functionType([], noneType)],
    ["forward", functionType([], noneType)],
    ["reload", functionType([], noneType)],
    ["currentRoute", functionType([], routeContextType)],
    ["announce", functionType([stringType, stringType], noneType, 1)],
    ["domId", functionType([stringType], stringType, 0)],
    ["Head", { kind: "componentConstructor", name: "Head", props: new Map<string, ValueType>([
      ["title", stringType], ["description", stringType], ["canonical", stringType], ["robots", stringType],
      ["image", stringType], ["themeColor", stringType],
    ]), requiredProps: new Set(["title"]) }],
    ["Router", { kind: "componentConstructor", name: "Router", props: new Map<string, ValueType>([["routes", { kind: "list", element: routeType }], ["fallback", anyType]]), requiredProps: new Set(["routes"]), intrinsic: "web.router" }],
    ["Link", { kind: "componentConstructor", name: "Link", props: new Map<string, ValueType>([["to", stringType], ["replace", boolType], ["children", nodeType]]), requiredProps: new Set(["to"]) }],
    ["NavLink", { kind: "componentConstructor", name: "NavLink", props: new Map<string, ValueType>([["to", stringType], ["exact", boolType], ["replace", boolType], ["children", nodeType]]), requiredProps: new Set(["to"]) }],
  ]), new Map(), new Map([["RouteContext", routeContextFields]]))],
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
    ["fieldValues", functionType([elementType, stringType], listString)],
    ["setError", functionType([elementType, stringType, stringType], noneType)],
    ["clearError", functionType([elementType, stringType], noneType)],
    ["clearErrors", functionType([elementType], noneType)],
    ["errors", functionType([elementType], mapString(stringType))],
    ["focusFirstError", functionType([elementType], boolType)],
    ["setPending", functionType([elementType, boolType], noneType)],
    ["reset", functionType([elementType], noneType)],
  ]))],
  ["velar/browser", moduleInterface(new Map([
    ["after", functionType([numberType, functionType([], unknownType)], cleanupType)],
    ["location", functionType([], browserLocationType)],
    ["environment", functionType([], browserEnvironmentType)],
    ["copyText", functionType([stringType], promise(noneType))],
    ["readClipboardText", functionType([], promise(stringType))],
    ["open", functionType([stringType, stringType], noneType, 1)],
    ["scrollTo", functionType([numberType, numberType, stringType], noneType, 2)],
    ["scrollIntoView", functionType([webElementType, stringType], noneType, 1)],
    ["focus", functionType([webElementType, boolType], noneType, 1)],
    ["blur", functionType([webElementType], noneType)],
    ["measure", functionType([webElementType], rectType)],
    ["media", functionType([stringType], boolType)],
    ["watchMedia", functionType([stringType, functionType([boolType], unknownType)], cleanupType)],
    ["watchOnline", functionType([functionType([boolType], unknownType)], cleanupType)],
    ["watchVisibility", functionType([functionType([boolType], unknownType)], cleanupType)],
    ["showDialog", functionType([dialogElementType], noneType)],
    ["closeDialog", functionType([dialogElementType, stringType], noneType, 1)],
    ["dialogResult", functionType([dialogElementType], stringType)],
    ["every", functionType([numberType, functionType([], unknownType)], cleanupType)],
    ["frame", functionType([], promise(numberType))],
  ]))],
  ["velar/files", moduleInterface(new Map([
    ["pick", functionType([fileOptionsType], promise(fileListType), 0)],
    ["readText", functionType([fileType, numberType], promise(stringType), 1)],
    ["readDataUrl", functionType([fileType, numberType], promise(stringType), 1)],
    ["download", functionType([stringType, stringType, stringType], noneType, 2)],
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
): ModuleInterface {
  return { exports, reactiveExports: new Map(), namedTypes, typeAliases: new Map(), enums: new Map(), classes, testFunctions: [] };
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
      style: "style",
      global: "global",
    }),
    forbiddenIdentifiers: Object.freeze({
      effect: "Effects are internal to @velarscript/web; use watch, mounted, or cleanup",
      onMount: "Use the Web extension's component-level 'mounted:' block",
      onMounted: "Use the Web extension's component-level 'mounted:' block",
      on_mount: "Use the Web extension's component-level 'mounted:' block",
    }),
    jsx: true,
    css: true,
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
    primitiveTypes: new Set(["WebNode", "Element", "InputElement", "CanvasElement", "DialogElement", "Event", "KeyboardEvent", "PointerEvent", "InputEvent"]),
    globals: webGlobals,
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
      style: "Declares component-scoped CSS; use `style global:` for global CSS.",
    }),
    typeDocumentation: Object.freeze({
      WebNode: "A value that can be rendered as component or JSX children.",
      Element: "A general native element reference obtained through JSX `ref`.",
      InputElement: "A native input, select, or textarea reference obtained through JSX `ref`.",
      CanvasElement: "A native canvas reference obtained through JSX `ref`.",
      DialogElement: "A native dialog reference obtained from `<dialog ref={value}>` and operated through `velar/browser`.",
      Event: "A restricted Web event value exposed to Velar event handlers.",
    }),
    completions: Object.freeze([
      ...["component", "state", "computed", "resource", "action", "watch", "mounted", "cleanup", "style"].map((label) => ({ label, kind: 14 })),
      { label: "mount", kind: 3, detail: "mount(node, target) -> none" },
      { label: "tick", kind: 3, detail: "tick() -> Promise<none>" },
      { label: "bind:value", kind: 10, detail: "Two-way string state binding" },
      { label: "bind:checked", kind: 10, detail: "Two-way boolean state binding" },
      { label: "on:click", kind: 10, detail: "DOM click handler" },
      { label: "on:submit.prevent", kind: 10, detail: "DOM event with a preventDefault modifier" },
      { label: "class:", kind: 10, detail: "Reactive class directive" },
      { label: "style:", kind: 10, detail: "Reactive style property directive" },
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
  createEmitter(hints: LoweringHints, forcedFunctionExports: ReadonlySet<string>) {
    return new WebJavaScriptEmitter(hints, forcedFunctionExports);
  },
});

export { webModuleSource, webModuleSources, type VelarWebRuntimeConfig };
export { velarProjectExtension, type VelarWebConfig } from "./project-config.ts";
