import { optionalOf as optional, type ClassInfo, type CompilerExtension, type ModuleInterface, type ValueType } from "@velarscript/compiler";
import type { AnalysisContext, CompilerAnalysisExtension, CompilerLexicalExtension, LoweringHints, Token } from "@velarscript/compiler/extension";
import { inferWebIntrinsic, routeContextIdentity, VelarWebAnalyzer } from "./analyzer.ts";
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
const blobType: ValueType = { kind: "named", name: "Blob" };
const lengthType: ValueType = { kind: "named", name: "Length" };
const percentageType: ValueType = { kind: "named", name: "Percentage" };
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
const mountTargetType: ValueType = { kind: "union", members: [stringType, elementType] };
const lookScalarType: ValueType = { kind: "union", members: [numberType, stringType, lengthType, percentageType] };
const trackInputType: ValueType = { kind: "union", members: [numberType, stringType, lengthType, percentageType, trackType, trackListType] };
const repeatCountType: ValueType = { kind: "union", members: [numberType, stringType] };

function namedFunction(parameterNames: readonly string[], parameters: readonly ValueType[], result: ValueType, requiredParameters = parameters.length): ValueType {
  return { kind: "function", parameterNames, parameters, requiredParameters, result };
}

// memo(transform) is generic over the argument and result of the unary
// transform: memo<T, U>((T) -> U) -> (T) -> U. The returned type is the same
// anonymous callable shape so a memoized transform stays first-class — it can
// be stored, passed to `.map(...)`, or called directly.
const memoArgumentType: ValueType = { kind: "parameter", name: "T", index: 0 };
const memoResultType: ValueType = { kind: "parameter", name: "U", index: 1 };
const memoTransformType: ValueType = { kind: "function", parameters: [memoArgumentType], requiredParameters: 1, result: memoResultType };
const memoType: ValueType = { kind: "function", typeParameterNames: ["T", "U"], parameterNames: ["transform"], parameters: [memoTransformType], requiredParameters: 1, result: memoTransformType };

const webGlobals = new Map<string, ValueType>([
  ["mount", namedFunction(["node", "target"], [nodeType, mountTargetType], nullType)],
  ["tick", namedFunction([], [], { kind: "promise", value: nullType })],
  ["memo", memoType],
  ["batch", namedFunction(["work"], [{ kind: "function", parameters: [], requiredParameters: 0, result: { kind: "unknown" } }], nullType)],
  ["color", namedFunction(["value"], [stringType], colorType)],
  ["rgb", namedFunction(["red", "green", "blue"], [numberType, numberType, numberType], colorType)],
  ["rgba", namedFunction(["red", "green", "blue", "alpha"], [numberType, numberType, numberType, numberType], colorType)],
  ["hsl", namedFunction(["hue", "saturation", "lightness"], [numberType, numberType, numberType], colorType)],
  ["alpha", namedFunction(["color", "opacity"], [colorInputType, numberType], colorType)],
  ["lighten", namedFunction(["color", "amount"], [colorInputType, numberType], colorType)],
  ["darken", namedFunction(["color", "amount"], [colorInputType, numberType], colorType)],
  ["border", namedFunction(["width", "color", "style"], [lengthType, colorInputType, stringType], borderType, 2)],
  ["shadow", namedFunction(["x", "y", "blur", "color", "spread", "inset"], [lengthType, lengthType, lengthType, colorInputType, lengthType, boolType], shadowType, 4)],
  ["linearGradient", namedFunction(["angle", "start", "end"], [angleType, colorInputType, colorInputType], imageType)],
  ["asset", namedFunction(["path"], [stringType], imageType)],
  ["minmax", namedFunction(["minimum", "maximum"], [lookScalarType, lookScalarType], trackType)],
  ["repeat", namedFunction(["count", "size"], [repeatCountType, trackInputType], trackListType)],
  ["tracks", { kind: "function", parameterNames: ["first"], parameters: [trackInputType], requiredParameters: 1, rest: trackInputType, result: trackListType }],
  ["transition", namedFunction(["property", "duration", "easing", "delay"], [stringType, durationType, stringType, durationType], transitionType, 2)],
  ["spacing", namedFunction(["first", "second", "third", "fourth"], [lookScalarType, lookScalarType, lookScalarType, lookScalarType], spacingType, 1)],
  ["min", namedFunction(["first", "second"], [lengthType, lengthType], lengthType)],
  ["max", namedFunction(["first", "second"], [lengthType, lengthType], lengthType)],
  ["clamp", namedFunction(["minimum", "preferred", "maximum"], [lengthType, lengthType, lengthType], lengthType)],
]);

function functionType(parameters: readonly ValueType[], result: ValueType, requiredParameters = parameters.length): ValueType {
  return { kind: "function", parameters, requiredParameters, result };
}

function namedIntrinsic(name: string, parameterNames: readonly string[], parameters: readonly ValueType[], result: ValueType, requiredParameters = parameters.length): ValueType {
  return { kind: "intrinsic", name, parameterNames, parameters, requiredParameters, result };
}

function promise(value: ValueType): ValueType {
  return { kind: "promise", value };
}

function object(fields: Readonly<Record<string, ValueType>>): ValueType {
  return { kind: "object", fields: new Map(Object.entries(fields)) };
}

const unknownType: ValueType = { kind: "unknown" };
const errorType: ValueType = { kind: "class", name: "Error" };
const cleanupType = namedFunction([], [], nullType);
const arrayString: ValueType = { kind: "list", element: stringType };
const mapString = (value: ValueType): ValueType => ({ kind: "map", key: stringType, value });
const webElementType: ValueType = { kind: "union", members: [elementType, inputElementType, canvasElementType, dialogElementType] };
const fileType: ValueType = { kind: "named", name: "File" };
const fileArrayType: ValueType = { kind: "list", element: fileType };
const formBodyType = object({
  field: namedFunction(["name", "value"], [stringType, stringType], nullType),
  file: namedFunction(["name", "value", "fileName"], [stringType, fileType, stringType], nullType, 2),
  files: namedFunction(["name", "values"], [stringType, fileArrayType], nullType),
  remove: namedFunction(["name"], [stringType], nullType),
  has: namedFunction(["name"], [stringType], boolType),
  names: namedFunction([], [], arrayString),
});

const httpResponseType = object({
  ok: boolType,
  status: numberType,
  statusText: stringType,
  url: stringType,
  headers: mapString(stringType),
  json: namedFunction([], [], promise(unknownType)),
  text: namedFunction([], [], promise(stringType)),
  blob: namedFunction([], [], promise(blobType)),
  parse: namedIntrinsic("http.parse", ["target"], [anyType], promise(anyType)),
});

const requestType = object({
  response: namedFunction([], [], promise(httpResponseType)),
  json: namedFunction([], [], promise(unknownType)),
  text: namedFunction([], [], promise(stringType)),
  blob: namedFunction([], [], promise(blobType)),
  parse: namedIntrinsic("http.parse", ["target"], [anyType], promise(anyType)),
  cancel: namedFunction([], [], nullType),
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
  request: namedIntrinsic("http.request", ["method", "url", "options"], [stringType, stringType, httpOptionsType], requestType, 2),
  get: namedIntrinsic("http.request", ["url", "options"], [stringType, httpOptionsType], requestType, 1),
  post: namedIntrinsic("http.request", ["url", "options"], [stringType, httpOptionsType], requestType, 1),
  put: namedIntrinsic("http.request", ["url", "options"], [stringType, httpOptionsType], requestType, 1),
  patch: namedIntrinsic("http.request", ["url", "options"], [stringType, httpOptionsType], requestType, 1),
  delete: namedIntrinsic("http.request", ["url", "options"], [stringType, httpOptionsType], requestType, 1),
  head: namedIntrinsic("http.request", ["url", "options"], [stringType, httpOptionsType], requestType, 1),
});

function createStorageType(): ValueType {
  const common = (): Map<string, ValueType> => new Map([
    ["get", namedIntrinsic("storage.get", ["key", "target", "fallback"], [stringType, anyType, anyType], anyType, 2)],
    ["set", namedIntrinsic("storage.set", ["key", "value"], [stringType, anyType], nullType)],
    ["has", namedFunction(["key"], [stringType], boolType)],
    ["keys", namedFunction([], [], arrayString)],
    ["remove", namedFunction(["key"], [stringType], nullType)],
    ["clear", namedFunction([], [], nullType)],
    ["watch", namedIntrinsic("storage.watch", ["key", "target", "callback"], [stringType, anyType, anyType], cleanupType)],
  ]);
  const scoped: ValueType = { kind: "object", fields: common() };
  const fields = common();
  fields.set("scope", namedFunction(["name"], [stringType], scoped));
  return { kind: "object", fields };
}

const storageType = createStorageType();
const databaseType = object({
  get: namedIntrinsic("storage.databaseGet", ["key", "target", "fallback"], [stringType, anyType, anyType], promise(anyType), 2),
  set: namedIntrinsic("storage.set", ["key", "value"], [stringType, anyType], promise(nullType)),
  has: namedFunction(["key"], [stringType], promise(boolType)),
  keys: namedFunction([], [], promise(arrayString)),
  remove: namedFunction(["key"], [stringType], promise(nullType)),
  clear: namedFunction([], [], promise(nullType)),
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
const routeContextType: ValueType = { kind: "named", name: "RouteContext", identity: routeContextIdentity };
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
  state: namedFunction([], [], stringType),
  send: namedFunction(["data"], [stringType], nullType),
  sendJson: namedIntrinsic("realtime.sendJson", ["data"], [anyType], nullType),
  close: namedFunction(["code", "reason"], [numberType, stringType], nullType, 0),
});
const eventStreamHandlersType = object({
  open: optional(functionType([], unknownType)),
  message: optional(functionType([stringType, stringType], unknownType)),
  error: optional(functionType([stringType], unknownType)),
});
const eventStreamType = object({ url: stringType, state: namedFunction([], [], stringType), close: namedFunction([], [], nullType) });
const appErrorType = object({
  error: errorType,
  phase: stringType,
  detail: stringType,
  component: stringType,
  timestamp: numberType,
});
const browserTestControllerType = object({
  open: namedFunction(["path"], [stringType], promise(nullType), 0),
  reload: namedFunction([], [], promise(nullType)),
  click: namedFunction(["selector"], [stringType], promise(nullType)),
  fill: namedFunction(["selector", "value"], [stringType, stringType], promise(nullType)),
  select: namedFunction(["selector", "value"], [stringType, stringType], promise(nullType)),
  press: namedFunction(["selector", "key"], [stringType, stringType], promise(nullType)),
  text: namedFunction(["selector"], [stringType], promise(stringType)),
  attribute: namedFunction(["selector", "name"], [stringType, stringType], promise(optional(stringType))),
  namespace: namedFunction(["selector"], [stringType], promise(stringType)),
  count: namedFunction(["selector"], [stringType], promise(numberType)),
  visible: namedFunction(["selector"], [stringType], promise(boolType)),
  waitFor: namedFunction(["selector", "until"], [stringType, stringType], promise(nullType), 1),
  waitForText: namedFunction(["selector", "text"], [stringType, stringType], promise(nullType)),
  currentPath: namedFunction([], [], promise(stringType)),
  viewport: namedFunction(["width", "height"], [numberType, numberType], promise(nullType)),
});


export const webModuleInterfaces: ReadonlyMap<string, ModuleInterface> = new Map([
  ["velar/app", moduleInterface(new Map([
    ["onError", namedFunction(["handler"], [functionType([appErrorType], unknownType)], cleanupType)],
    ["reportError", namedFunction(["error", "phase", "detail"], [errorType, stringType, stringType], nullType, 1)],
  ]))],
  ["velar/config", moduleInterface(new Map([
    ["publicConfig", namedIntrinsic("config.public", ["target"], [anyType], anyType)],
    ["has", namedFunction(["key"], [stringType], boolType)],
    ["keys", namedFunction([], [], arrayString)],
  ]))],
  ["velar/web", moduleInterface(new Map([
    ["RouteContext", { kind: "typeObject", name: "RouteContext" }],
    ["route", namedIntrinsic("web.route", ["path", "view"], [stringType, anyType], routeType)],
    ["lazy", namedIntrinsic("web.lazy", ["loader", "exportName", "loading", "failed"], [functionType([], promise(anyType)), stringType, anyType, anyType], anyType, 2)],
    ["navigate", namedFunction(["to", "options"], [stringType, navigationOptionsType], nullType, 1)],
    ["redirect", namedFunction(["to"], [stringType], nullType)],
    ["back", namedFunction([], [], nullType)],
    ["forward", namedFunction([], [], nullType)],
    ["reload", namedFunction([], [], nullType)],
    ["currentRoute", namedFunction([], [], routeContextType)],
    ["announce", namedFunction(["message", "priority"], [stringType, stringType], nullType, 1)],
    ["domId", namedFunction(["prefix"], [stringType], stringType, 0)],
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
    ["formBody", namedFunction([], [], formBodyType)],
    ["HttpAbortError", { kind: "classConstructor", name: "HttpAbortError" }],
    ["HttpError", { kind: "classConstructor", name: "HttpError" }],
  ]), new Map([
    ["HttpAbortError", {
      parameters: [stringType],
      parameterNames: ["reason"],
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
      parameterNames: ["message", "status", "url", "body"],
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
    ["database", namedFunction(["name"], [stringType], databaseType)],
  ]))],
  ["velar/forms", moduleInterface(new Map([
    ["values", namedFunction(["form"], [elementType], formValuesType)],
    ["read", namedIntrinsic("forms.read", ["form", "target"], [elementType, anyType], anyType)],
    ["fieldValue", namedFunction(["form", "name"], [elementType, stringType], optional(unknownType))],
    ["textValue", namedFunction(["form", "name", "fallback"], [elementType, stringType, stringType], stringType, 2)],
    ["numberValue", namedFunction(["form", "name"], [elementType, stringType], optional(numberType))],
    ["checkedValue", namedFunction(["form", "name"], [elementType, stringType], boolType)],
    ["fieldValues", namedFunction(["form", "name"], [elementType, stringType], arrayString)],
    ["setError", namedFunction(["form", "name", "message"], [elementType, stringType, stringType], nullType)],
    ["clearError", namedFunction(["form", "name"], [elementType, stringType], nullType)],
    ["clearErrors", namedFunction(["form"], [elementType], nullType)],
    ["errors", namedFunction(["form"], [elementType], mapString(stringType))],
    ["focusFirstError", namedFunction(["form"], [elementType], boolType)],
    ["setPending", namedFunction(["form", "pending"], [elementType, boolType], nullType)],
    ["reset", namedFunction(["form"], [elementType], nullType)],
  ]))],
  ["velar/browser", moduleInterface(new Map([
    ["after", namedFunction(["milliseconds", "callback"], [numberType, functionType([], unknownType)], cleanupType)],
    ["location", namedFunction([], [], browserLocationType)],
    ["environment", namedFunction([], [], browserEnvironmentType)],
    ["copyText", namedFunction(["value"], [stringType], promise(nullType))],
    ["readClipboardText", namedFunction([], [], promise(stringType))],
    ["open", namedFunction(["url", "target"], [stringType, stringType], nullType, 1)],
    ["scrollTo", namedFunction(["x", "y", "behavior"], [numberType, numberType, stringType], nullType, 2)],
    ["scrollIntoView", namedFunction(["element", "behavior"], [webElementType, stringType], nullType, 1)],
    ["focus", namedFunction(["element", "preventScroll"], [webElementType, boolType], nullType, 1)],
    ["blur", namedFunction(["element"], [webElementType], nullType)],
    ["measure", namedFunction(["element"], [webElementType], rectType)],
    ["media", namedFunction(["query"], [stringType], boolType)],
    ["watchMedia", namedFunction(["query", "callback"], [stringType, functionType([boolType], unknownType)], cleanupType)],
    ["watchOnline", namedFunction(["callback"], [functionType([boolType], unknownType)], cleanupType)],
    ["watchVisibility", namedFunction(["callback"], [functionType([boolType], unknownType)], cleanupType)],
    ["showDialog", namedFunction(["dialog"], [dialogElementType], nullType)],
    ["closeDialog", namedFunction(["dialog", "result"], [dialogElementType, stringType], nullType, 1)],
    ["dialogResult", namedFunction(["dialog"], [dialogElementType], stringType)],
    ["every", namedFunction(["milliseconds", "callback"], [numberType, functionType([], unknownType)], cleanupType)],
    ["frame", namedFunction([], [], promise(numberType))],
  ]))],
  ["velar/files", moduleInterface(new Map([
    ["pick", namedFunction(["options"], [fileOptionsType], promise(fileArrayType), 0)],
    ["readText", namedFunction(["file", "maxBytes"], [fileType, numberType], promise(stringType), 1)],
    ["readDataUrl", namedFunction(["file", "maxBytes"], [fileType, numberType], promise(stringType), 1)],
    ["download", namedFunction(["name", "data", "mime"], [stringType, stringType, stringType], nullType, 2)],
  ]))],
  ["velar/realtime", moduleInterface(new Map([
    ["socket", namedFunction(["url", "handlers"], [stringType, socketHandlersType], socketType, 1)],
    ["eventStream", namedFunction(["url", "handlers", "credentials"], [stringType, eventStreamHandlersType, boolType], eventStreamType, 1)],
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
  return { exports, mutableExports: new Set(), reactiveExports: new Map(), reExports: new Map(), namedTypes, namedTypeIdentities, typeAliases: new Map(), enums: new Map(), classes, testFunctions: [], extensionExports: new Map(), extensionData: new Map() };
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
    primitiveTypes: new Set(["WebNode", "Element", "InputElement", "CanvasElement", "DialogElement", "Blob", "File", "Event", "KeyboardEvent", "PointerEvent", "InputEvent", "Look", "Length", "Percentage", "Color", "Duration", "Angle", "Opacity", "Border", "Shadow", "Image", "Track", "TrackList", "Transition", "Spacing"]),
    primitiveParents: new Map([
      ["InputElement", new Set(["Element"])],
      ["CanvasElement", new Set(["Element"])],
      ["DialogElement", new Set(["Element"])],
      ["KeyboardEvent", new Set(["Event"])],
      ["PointerEvent", new Set(["Event"])],
      ["InputEvent", new Set(["Event"])],
    ]),
    primitiveMutableFields: new Map([
      ["InputElement", new Set(["value", "checked"])],
      ["CanvasElement", new Set(["width", "height"])],
    ]),
    globals: webGlobals,
    reservedBindings: new Set(["mount", "tick", "memo", "batch"]),
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
      action: "Declares an asynchronous operation with reactive pending and error fields at module or component scope.",
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
      Blob: "An opaque binary HTTP body returned by `blob()` and accepted by HTTP request bodies.",
      File: "An opaque selected file returned by `velar/files.pick()` with checked read-only metadata.",
      Event: "A restricted Web event value exposed to VelarScript event handlers.",
      Look: "A typed, composable Web appearance value applied through JSX look={...}.",
    }),
    completions: Object.freeze([
      ...["component", "state", "computed", "resource", "action", "watch", "mounted", "cleanup", "look"].map((label) => ({ label, kind: 14 })),
      { label: "mount", kind: 3, detail: "mount(node, target) -> null" },
      { label: "tick", kind: 3, detail: "tick() -> Promise<null>" },
      { label: "memo", kind: 3, detail: "memo(transform) -> (T) -> U memoized by argument identity" },
      { label: "batch", kind: 3, detail: "batch(work) -> null" },
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
