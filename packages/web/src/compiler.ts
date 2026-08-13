import { optionalOf as optional, type ClassInfo, type CompilerExtension, type EnumInfo, type ModuleInterface, type ValueType } from "@velarscript/compiler";
import type { AnalysisContext, CompilerAnalysisExtension, CompilerEmitterOptions, CompilerLexicalExtension, LoweringHints, Token } from "@velarscript/compiler/extension";
import { inferWebIntrinsic, routeContextIdentity, VelarWebAnalyzer } from "./analyzer.ts";
import { WebJavaScriptEmitter } from "./emitter.ts";
import { velarWebProjectEditorExtension } from "./editor.ts";
import { velarWebInspectionExtension } from "./inspection.ts";
import { VelarWebParser } from "./parser.ts";
import { scanWebToken } from "./lexer.ts";
import { webModuleSource, webModuleSources, type VelarWebRuntimeConfig } from "./runtime.ts";
import { velarWebSemanticExtension } from "./semantic.ts";
import { LOOK_BUILDERS, LOOK_MEDIA_SUBJECTS, LOOK_PUBLIC_TYPE_NAMES, LOOK_UNIT_TYPES } from "./look.ts";
import { isWebTypeAssignable, resolveWebTypeSyntax, webComponentConstructor, webNodeType } from "./types.ts";

export const VELAR_WEB_API_VERSION = "0.10";

const webVoidElements = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"]);

const anyType: ValueType = { kind: "any" };
const nullType: ValueType = { kind: "null" };
const stringType: ValueType = { kind: "string" };
const numberType: ValueType = { kind: "number" };
const boolType: ValueType = { kind: "bool" };
const nodeType: ValueType = webNodeType;
const elementType: ValueType = { kind: "named", name: "Element" };
const inputElementType: ValueType = { kind: "named", name: "InputElement" };
const textAreaElementType: ValueType = { kind: "named", name: "TextAreaElement" };
const canvasElementType: ValueType = { kind: "named", name: "CanvasElement" };
const dialogElementType: ValueType = { kind: "named", name: "DialogElement" };
const blobType: ValueType = { kind: "named", name: "Blob" };
const lengthType: ValueType = { kind: "named", name: "Length" };
const percentageType: ValueType = { kind: "named", name: "Percentage" };
const lengthPercentageType: ValueType = { kind: "named", name: "LengthPercentage" };
const trackFractionType: ValueType = { kind: "named", name: "TrackFraction" };
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
const lookScalarType: ValueType = { kind: "union", members: [numberType, stringType, lengthType, percentageType, lengthPercentageType] };
const trackInputType: ValueType = { kind: "union", members: [numberType, stringType, lengthType, percentageType, lengthPercentageType, trackFractionType, trackType, trackListType] };
const repeatCountType: ValueType = { kind: "union", members: [numberType, stringType] };

function namedFunction(parameterNames: readonly string[], parameters: readonly ValueType[], result: ValueType, requiredParameters = parameters.length): ValueType {
  return { kind: "function", parameterNames, parameters, requiredParameters, result };
}

const unknownType: ValueType = { kind: "unknown" };
const webGlobals = new Map<string, ValueType>([
  ["mount", namedFunction(["node", "target"], [nodeType, mountTargetType], nullType)],
  ["tick", namedFunction([], [], { kind: "promise", value: nullType })],
  ["computed", namedIntrinsic(
    "reactive.computed",
    ["read"],
    [{ kind: "function", parameters: [], requiredParameters: 0, result: unknownType }],
    { kind: "function", parameters: [], requiredParameters: 0, result: unknownType },
  )],
]);

const lookModuleExports = new Map<string, ValueType>([
  ...LOOK_PUBLIC_TYPE_NAMES.map((name) => [name, { kind: "typeObject", name, value: { kind: "named", name } } as ValueType] as const),
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
  ["minmax", namedFunction(["minimum", "maximum"], [trackInputType, trackInputType], trackType)],
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
const httpChunkConsumerType = namedFunction(["chunk"], [stringType], promise(nullType));
const httpTransportPhaseIdentity = "velar/http#enum:HttpTransportPhase";
const httpTransportPhaseMembers = new Set(["request", "response"]);
const httpTransportPhaseType: ValueType = { kind: "enum", name: "HttpTransportPhase", identity: httpTransportPhaseIdentity };
const httpTransportErrorIdentity = "velar/http#class:HttpTransportError";

const httpResponseType = object({
  ok: boolType,
  status: numberType,
  statusText: stringType,
  url: stringType,
  headers: mapString(stringType),
  json: namedFunction([], [], promise(unknownType)),
  text: namedFunction([], [], promise(stringType)),
  streamText: namedFunction(["consume"], [httpChunkConsumerType], promise(nullType)),
  blob: namedFunction([], [], promise(blobType)),
  parse: namedIntrinsic("runtime.parseAsync", ["target"], [anyType], promise(anyType)),
});

const requestType = object({
  response: namedFunction([], [], promise(httpResponseType)),
  json: namedFunction([], [], promise(unknownType)),
  text: namedFunction([], [], promise(stringType)),
  streamText: namedFunction(["consume"], [httpChunkConsumerType], promise(nullType)),
  blob: namedFunction([], [], promise(blobType)),
  parse: namedIntrinsic("runtime.parseAsync", ["target"], [anyType], promise(anyType)),
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
    ["get", namedIntrinsic("storage.get", ["key", "target", "fallback", "maxBytes"], [stringType, anyType, anyType, numberType], anyType, 2)],
    ["set", namedIntrinsic("storage.set", ["key", "value", "maxBytes"], [stringType, anyType, numberType], nullType, 2)],
    ["has", namedFunction(["key"], [stringType], boolType)],
    ["keys", namedFunction([], [], arrayString)],
    ["remove", namedFunction(["key"], [stringType], nullType)],
    ["clear", namedFunction([], [], nullType)],
    ["watch", namedIntrinsic("storage.watch", ["key", "target", "callback", "maxBytes"], [stringType, anyType, anyType, numberType], cleanupType, 3)],
  ]);
  const scoped: ValueType = { kind: "object", fields: common() };
  const fields = common();
  fields.set("scope", namedFunction(["name"], [stringType], scoped));
  return { kind: "object", fields };
}

const storageType = createStorageType();
const databaseType = object({
  get: namedIntrinsic("storage.databaseGet", ["key", "target", "fallback", "maxBytes"], [stringType, anyType, anyType, numberType], promise(anyType), 2),
  set: namedIntrinsic("storage.set", ["key", "value", "maxBytes"], [stringType, anyType, numberType], promise(nullType), 2),
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
const scrollMetricsType = object({
  x: numberType, y: numberType,
  viewportWidth: numberType, viewportHeight: numberType,
  contentWidth: numberType, contentHeight: numberType,
});
const textSelectionType = object({ start: numberType, end: numberType, direction: stringType });
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
const browserTestNavigationTimingType = object({
  firstContentfulPaintMs: optional(numberType),
  domContentLoadedMs: numberType,
  loadMs: numberType,
});
const browserTestInteractionTimingType = object({
  inputDelayMs: numberType,
  processingDurationMs: numberType,
  nextFrameMs: numberType,
});
const browserTestControllerType = object({
  open: namedFunction(["path"], [stringType], promise(nullType), 0),
  reload: namedFunction([], [], promise(nullType)),
  click: namedFunction(["selector"], [stringType], promise(nullType)),
  fill: namedFunction(["selector", "value"], [stringType, stringType], promise(nullType)),
  select: namedFunction(["selector", "value"], [stringType, stringType], promise(nullType)),
  press: namedFunction(["selector", "key"], [stringType, stringType], promise(nullType)),
  scroll: namedFunction(["selector", "x", "y"], [stringType, numberType, numberType], promise(nullType)),
  text: namedFunction(["selector"], [stringType], promise(stringType)),
  attribute: namedFunction(["selector", "name"], [stringType, stringType], promise(optional(stringType))),
  namespace: namedFunction(["selector"], [stringType], promise(stringType)),
  count: namedFunction(["selector"], [stringType], promise(numberType)),
  visible: namedFunction(["selector"], [stringType], promise(boolType)),
  waitFor: namedFunction(["selector", "until"], [stringType, stringType], promise(nullType), 1),
  waitForText: namedFunction(["selector", "text"], [stringType, stringType], promise(nullType)),
  currentPath: namedFunction([], [], promise(stringType)),
  viewport: namedFunction(["width", "height"], [numberType, numberType], promise(nullType)),
  timings: namedFunction([], [], promise(browserTestNavigationTimingType)),
  measureClick: namedFunction(["selector"], [stringType], promise(browserTestInteractionTimingType)),
  measureFill: namedFunction(["selector", "value"], [stringType, stringType], promise(browserTestInteractionTimingType)),
  measurePress: namedFunction(["selector", "key"], [stringType, stringType], promise(browserTestInteractionTimingType)),
});
const browserTestStorageControllerType = object({
  get: namedFunction(["key"], [stringType], promise(optional(stringType))),
  set: namedFunction(["key", "value"], [stringType, stringType], promise(nullType)),
  remove: namedFunction(["key"], [stringType], promise(nullType)),
  clear: namedFunction([], [], promise(nullType)),
});
const browserTestNetworkControllerType = object({
  respond: namedFunction(["path", "body", "status", "contentType", "delayMs"], [stringType, stringType, numberType, stringType, numberType], promise(nullType), 2),
  clear: namedFunction([], [], promise(nullType)),
});


export const webModuleInterfaces: ReadonlyMap<string, ModuleInterface> = new Map([
  ["velar/look", moduleInterface(lookModuleExports)],
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
    ["Head", webComponentConstructor("Head", new Map<string, ValueType>([
      ["title", stringType], ["description", stringType], ["canonical", stringType], ["robots", stringType],
      ["image", stringType], ["themeColor", stringType], ["language", stringType],
    ]), new Set(["title"]), null)],
    ["Router", webComponentConstructor("Router", new Map<string, ValueType>([["routes", { kind: "list", element: routeType }], ["fallback", anyType]]), new Set(["routes"]), null, "web.router")],
    ["Link", webComponentConstructor("Link", new Map<string, ValueType>([["to", stringType], ["replace", boolType], ["class", optional(stringType)], ["look", optional({ kind: "named", name: "Look" })], ["children", nodeType]]), new Set(["to"]), null)],
    ["NavLink", webComponentConstructor("NavLink", new Map<string, ValueType>([["to", stringType], ["exact", boolType], ["replace", boolType], ["class", optional(stringType)], ["look", optional({ kind: "named", name: "Look" })], ["children", nodeType]]), new Set(["to"]), null)],
  ]), new Map(), new Map([["RouteContext", routeContextFields]]), new Map([
    ["RouteContext", "@velarscript/web:velar/web#type:RouteContext"],
  ]))],
  ["velar/http", moduleInterface(new Map([
    ["http", httpType],
    ["formBody", namedFunction([], [], formBodyType)],
    ["HttpTransportPhase", { kind: "enumObject", name: "HttpTransportPhase", identity: httpTransportPhaseIdentity, members: httpTransportPhaseMembers }],
    ["HttpAbortError", { kind: "classConstructor", name: "HttpAbortError" }],
    ["HttpError", { kind: "classConstructor", name: "HttpError" }],
    ["HttpTransportError", { kind: "classConstructor", name: "HttpTransportError", identity: httpTransportErrorIdentity }],
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
    ["HttpTransportError", {
      identity: httpTransportErrorIdentity,
      parameters: [stringType, httpTransportPhaseType],
      parameterNames: ["message", "phase"],
      requiredParameters: 2,
      base: "Error",
      abstract: false,
      fields: new Map([["phase", { mutable: false, type: httpTransportPhaseType }]]),
      getters: new Set(),
      abstractGetters: new Set(),
      methods: new Map(),
      abstractMethods: new Set(),
      staticFields: new Map(),
      staticGetters: new Set(),
      staticMethods: new Map(),
    }],
  ]), new Map(), new Map(), new Map([["HttpTransportPhase", { identity: httpTransportPhaseIdentity, members: httpTransportPhaseMembers }]]))],
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
    ["scrollMetrics", namedFunction(["element"], [webElementType], scrollMetricsType)],
    ["scrollElementTo", namedFunction(["element", "x", "y", "behavior"], [webElementType, numberType, numberType, stringType], nullType, 3)],
    ["focus", namedFunction(["element", "preventScroll"], [webElementType, boolType], nullType, 1)],
    ["blur", namedFunction(["element"], [webElementType], nullType)],
    ["measure", namedFunction(["element"], [webElementType], rectType)],
    ["textSelection", namedFunction(["element"], [textAreaElementType], textSelectionType)],
    ["setTextSelection", namedFunction(["element", "start", "end", "direction"], [textAreaElementType, numberType, numberType, stringType], nullType, 3)],
    ["clipboardText", namedFunction(["event"], [{ kind: "named", name: "ClipboardEvent" }], stringType)],
    ["setClipboardText", namedFunction(["event", "value"], [{ kind: "named", name: "ClipboardEvent" }, stringType], nullType)],
    ["capturePointer", namedFunction(["element", "pointerId"], [webElementType, numberType], nullType)],
    ["releasePointer", namedFunction(["element", "pointerId"], [webElementType, numberType], nullType)],
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
    ["localStorage", browserTestStorageControllerType],
    ["sessionStorage", browserTestStorageControllerType],
    ["network", browserTestNetworkControllerType],
  ]))],
]);

function moduleInterface(
  exports: ReadonlyMap<string, ValueType>,
  classes: ReadonlyMap<string, ClassInfo> = new Map(),
  namedTypes: ReadonlyMap<string, ReadonlyMap<string, ValueType>> = new Map(),
  namedTypeIdentities: ReadonlyMap<string, string> = new Map(),
  enums: ReadonlyMap<string, EnumInfo> = new Map(),
): ModuleInterface {
  return { exports, mutableExports: new Set(), reactiveExports: new Map(), reExports: new Map(), namedTypes, namedTypeIdentities, typeAliases: new Map(), enums, classes, testFunctions: [], extensionExports: new Map(), extensionData: new Map() };
}

export const velarCompilerExtension: CompilerExtension = Object.freeze({
  id: "@velarscript/web",
  contract: Object.freeze({ protocolVersion: 1, apiVersion: VELAR_WEB_API_VERSION, kind: "application", extends: Object.freeze({}) }),
  capabilities: Object.freeze(["web"]),
  formatting: Object.freeze({
    angleBracketEmbedding: Object.freeze({ voidElements: webVoidElements }),
  }),
  lexical: Object.freeze({
    keywords: Object.freeze({
      component: "component",
      state: "state",
      resource: "resource",
      action: "action",
      watch: "watch",
      mounted: "mounted",
      cleanup: "cleanup",
      exposes: "exposes",
      expose: "expose",
      look: "look",
      css: "css",
    }),
    forbiddenIdentifiers: Object.freeze({
      effect: "Effects are internal to @velarscript/web; use watch, mounted, or cleanup",
      onMount: "Use the Web extension's component-level 'mounted:' block",
      onMounted: "Use the Web extension's component-level 'mounted:' block",
      on_mount: "Use the Web extension's component-level 'mounted:' block",
    }),
    numericSuffixes: new Set(LOOK_UNIT_TYPES.keys()),
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
    primitiveTypes: new Set(["WebNode", "Component", "Element", "InputElement", "TextAreaElement", "CanvasElement", "DialogElement", "Blob", "File", "Event", "KeyboardEvent", "PointerEvent", "InputEvent", "CompositionEvent", "ClipboardEvent", ...LOOK_PUBLIC_TYPE_NAMES]),
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
    // LOK-D4: the Look media subjects are matched by name inside a Look
    // condition, ahead of ordinary lexical resolution. A user binding of the
    // same name used to be reverse-shadowed with no diagnostic anywhere, so the
    // three names are reserved in a Web module.
    reservedBindings: new Set(["mount", "tick", "computed", ...LOOK_MEDIA_SUBJECTS.keys()]),
    globalGuidance: new Map([
      ...[...LOOK_BUILDERS].map((name) => [name, `Import '${name}' by name from \"velar/look\"`] as const),
      ["document", "Use JSX, refs, and velar/browser instead of the untyped document global"],
      ["window", "Use velar/browser or an explicit JavaScript boundary instead of the untyped window global"],
      ["navigator", "Use velar/browser instead of the navigator global"],
      ["location", "Use velar/browser location() or velar/web navigation instead of the location global"],
      ["history", "Use velar/web navigation instead of the history global"],
      ["fetch", "Use velar/http instead of the raw fetch global"],
    ]),
    resolveTypeSyntax: resolveWebTypeSyntax,
    isTypeAssignable: isWebTypeAssignable,
    inferIntrinsic: inferWebIntrinsic,
  }),
  editor: Object.freeze({
    project: velarWebProjectEditorExtension,
    keywordDocumentation: Object.freeze({
      component: "Declares a compiler-managed Web component that initializes once.",
      state: "Declares writable reactive state in the current lexical scope.",
      resource: "Declares component-owned asynchronous data with reactive value, loading, ready, error, and reload fields.",
      action: "Declares an asynchronous operation with reactive pending and error fields at module or component scope.",
      watch: "Runs a block after a watched expression changes and DOM updates commit.",
      mounted: "Runs once after the component DOM is inserted.",
      cleanup: "Runs once before the component and its owned resources are destroyed.",
      exposes: "Declares the explicit typed control Handle a component makes available through JSX ref.",
      expose: "Provides the component Handle value declared by exposes.",
      look: "Builds a typed, composable Web appearance value.",
    }),
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
      ...["component", "state", "resource", "action", "watch", "mounted", "cleanup", "exposes", "expose", "look"].map((label) => ({ label, kind: 14 })),
      { label: "mount", kind: 3, detail: "mount(node, target) -> null" },
      { label: "tick", kind: 3, detail: "tick() -> Promise<null>" },
      { label: "computed", kind: 3, detail: "computed(() => T) -> () -> T" },
      { label: "bind:value", kind: 10, detail: "Two-way string state binding" },
      { label: "bind:checked", kind: 10, detail: "Two-way boolean state binding" },
      { label: "bind:group", kind: 10, detail: "Two-way radio or checkbox group binding" },
      { label: "on:click", kind: 10, detail: "DOM click handler" },
      { label: "on:submit.prevent", kind: 10, detail: "DOM event with a preventDefault modifier" },
      { label: "class:", kind: 10, detail: "Reactive class directive" },
      { label: "look={value}", kind: 10, detail: "Apply a typed Look value" },
      { label: "style:color={value}", kind: 10, detail: "High-priority checked inline Style compatibility override" },
      { label: "import css unsafe", kind: 14, detail: "Import native CSS before Look output" },
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
    options: CompilerEmitterOptions,
  ) {
    return new WebJavaScriptEmitter(hints, forcedFunctionExports, resourceContents, extensionImports, options);
  },
});

export { webModuleSource, webModuleSources, type VelarWebRuntimeConfig };
export { velarProjectExtension, type VelarWebConfig } from "./project-config.ts";
