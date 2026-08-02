import type { ClassInfo, ModuleInterface, ValueType } from "@velarscript/compiler";
import { VELAR_STANDARD_API_VERSION, VELAR_WEB_API_VERSION } from "./version.ts";

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
const listAny: ValueType = { kind: "list", element: anyType };
const listNumber: ValueType = { kind: "list", element: numberType };
const listString: ValueType = { kind: "list", element: stringType };
const mapAny: ValueType = { kind: "map", key: anyType, value: anyType };
const mapString = (value: ValueType): ValueType => ({ kind: "map", key: stringType, value });
const webElementType: ValueType = { kind: "union", members: [elementType, inputElementType, canvasElementType, dialogElementType] };
const fileType = object({ name: stringType, size: numberType, type: stringType, modified: numberType });
const fileListType: ValueType = { kind: "list", element: fileType };
const patternOptionsType = object({
  ignoreCase: optional(boolType),
  multiline: optional(boolType),
  dotAll: optional(boolType),
});
const textMatchType = object({
  value: stringType,
  index: numberType,
  groups: { kind: "list", element: optional(stringType) },
});
const textMatchListType: ValueType = { kind: "list", element: textMatchType };
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
const urlInfoType = object({
  href: stringType,
  protocol: stringType,
  host: stringType,
  hostname: stringType,
  port: stringType,
  path: stringType,
  query: { kind: "map", key: stringType, value: stringType },
  hash: stringType,
  origin: stringType,
});
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
const timePartsType = object({
  year: numberType, month: numberType, day: numberType, weekday: numberType,
  hour: numberType, minute: numberType, second: numberType, millisecond: numberType,
});
const logFieldsType = mapString(unknownType);
const logRecordType = object({
  timestamp: numberType,
  level: stringType,
  scope: stringType,
  message: stringType,
  fields: logFieldsType,
  error: optional(errorType),
});
const loggerType = object({
  debug: functionType([stringType, logFieldsType], noneType, 1),
  info: functionType([stringType, logFieldsType], noneType, 1),
  warn: functionType([stringType, logFieldsType], noneType, 1),
  error: functionType([stringType, errorType, logFieldsType], noneType, 1),
});
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

const standardInterfaces = new Map<string, ModuleInterface>([
  ["velar/collections", moduleInterface(new Map([
    ["range", functionType([numberType, numberType, numberType], listNumber, 1)],
    ["enumerate", intrinsic("collections.enumerate", [listAny, numberType], listAny, 1)],
    ["zip", intrinsic("collections.zip", [listAny, listAny], listAny)],
    ["unique", intrinsic("collections.unique", [listAny], listAny)],
    ["chunk", intrinsic("collections.chunk", [listAny, numberType], listAny)],
    ["flatten", intrinsic("collections.flatten", [listAny], listAny)],
    ["compact", intrinsic("collections.compact", [listAny], listAny)],
    ["reverse", intrinsic("collections.reverse", [listAny], listAny)],
    ["take", intrinsic("collections.take", [listAny, numberType], listAny)],
    ["drop", intrinsic("collections.drop", [listAny, numberType], listAny)],
    ["first", intrinsic("collections.first", [listAny], anyType)],
    ["last", intrinsic("collections.last", [listAny], anyType)],
    ["find", intrinsic("collections.find", [listAny, anyType], anyType)],
    ["findIndex", intrinsic("collections.findIndex", [listAny, anyType], numberType)],
    ["contains", intrinsic("collections.contains", [listAny, anyType], boolType)],
    ["count", intrinsic("collections.count", [listAny, anyType], numberType)],
    ["any", intrinsic("collections.any", [listAny, anyType], boolType)],
    ["all", intrinsic("collections.all", [listAny, anyType], boolType)],
    ["partition", intrinsic("collections.partition", [listAny, anyType], anyType)],
    ["groupBy", intrinsic("collections.groupBy", [listAny, anyType], mapAny)],
    ["keyBy", intrinsic("collections.keyBy", [listAny, anyType], mapAny)],
    ["countBy", intrinsic("collections.countBy", [listAny, anyType], mapAny)],
    ["sortBy", intrinsic("collections.sortBy", [listAny, anyType, boolType], listAny, 2)],
    ["minBy", intrinsic("collections.minBy", [listAny, anyType], anyType)],
    ["maxBy", intrinsic("collections.maxBy", [listAny, anyType], anyType)],
    ["sum", intrinsic("collections.sum", [listNumber], numberType)],
    ["join", intrinsic("collections.join", [listString, stringType], stringType, 1)],
    ["repeat", intrinsic("collections.repeat", [anyType, numberType], listAny)],
  ]))],
  ["velar/text", moduleInterface(new Map([
    ["trim", functionType([stringType], stringType)],
    ["trimStart", functionType([stringType], stringType)],
    ["trimEnd", functionType([stringType], stringType)],
    ["lower", functionType([stringType], stringType)],
    ["upper", functionType([stringType], stringType)],
    ["capitalize", functionType([stringType], stringType)],
    ["title", functionType([stringType], stringType)],
    ["startsWith", functionType([stringType, stringType], boolType)],
    ["endsWith", functionType([stringType, stringType], boolType)],
    ["includes", functionType([stringType, stringType], boolType)],
    ["split", functionType([stringType, stringType], listString)],
    ["replace", functionType([stringType, stringType, stringType], stringType)],
    ["replaceAll", functionType([stringType, stringType, stringType], stringType)],
    ["repeat", functionType([stringType, numberType], stringType)],
    ["padStart", functionType([stringType, numberType, stringType], stringType, 2)],
    ["padEnd", functionType([stringType, numberType, stringType], stringType, 2)],
    ["lines", functionType([stringType], listString)],
    ["words", functionType([stringType], listString)],
    ["slug", functionType([stringType], stringType)],
    ["truncate", functionType([stringType, numberType, stringType], stringType, 2)],
    ["indent", functionType([stringType, stringType], stringType, 1)],
    ["dedent", functionType([stringType], stringType)],
    ["normalizeWhitespace", functionType([stringType], stringType)],
    ["isBlank", functionType([stringType], boolType)],
    ["escapeHtml", functionType([stringType], stringType)],
    ["matches", functionType([stringType, stringType, patternOptionsType], boolType, 2)],
    ["findMatch", functionType([stringType, stringType, patternOptionsType], optional(textMatchType), 2)],
    ["findMatches", functionType([stringType, stringType, patternOptionsType], textMatchListType, 2)],
    ["replaceMatches", functionType([stringType, stringType, stringType, patternOptionsType], stringType, 3)],
    ["splitPattern", functionType([stringType, stringType, patternOptionsType], listString, 2)],
  ]))],
  ["velar/math", moduleInterface(new Map([
    ["pi", numberType], ["e", numberType], ["tau", numberType], ["infinity", numberType],
    ["abs", functionType([numberType], numberType)],
    ["min", intrinsic("math.min", [numberType], numberType)],
    ["max", intrinsic("math.max", [numberType], numberType)],
    ["clamp", functionType([numberType, numberType, numberType], numberType)],
    ["sign", functionType([numberType], numberType)],
    ["round", functionType([numberType, numberType], numberType, 1)],
    ["floor", functionType([numberType], numberType)],
    ["ceil", functionType([numberType], numberType)],
    ["trunc", functionType([numberType], numberType)],
    ["sqrt", functionType([numberType], numberType)],
    ["cbrt", functionType([numberType], numberType)],
    ["pow", functionType([numberType, numberType], numberType)],
    ["exp", functionType([numberType], numberType)],
    ["log", functionType([numberType, numberType], numberType, 1)],
    ["log2", functionType([numberType], numberType)],
    ["log10", functionType([numberType], numberType)],
    ["sin", functionType([numberType], numberType)],
    ["cos", functionType([numberType], numberType)],
    ["tan", functionType([numberType], numberType)],
    ["asin", functionType([numberType], numberType)],
    ["acos", functionType([numberType], numberType)],
    ["atan", functionType([numberType], numberType)],
    ["atan2", functionType([numberType, numberType], numberType)],
    ["degrees", functionType([numberType], numberType)],
    ["radians", functionType([numberType], numberType)],
    ["hypot", functionType([numberType, numberType], numberType)],
    ["random", functionType([], numberType)],
    ["randomInt", functionType([numberType, numberType], numberType, 1)],
    ["isFinite", functionType([numberType], boolType)],
    ["isInteger", functionType([numberType], boolType)],
    ["gcd", functionType([numberType, numberType], numberType)],
    ["lcm", functionType([numberType, numberType], numberType)],
  ]))],
  ["velar/json", moduleInterface(new Map([
    ["parse", intrinsic("json.parse", [stringType, anyType], unknownType, 1)],
    ["tryParse", intrinsic("json.tryParse", [stringType, anyType, anyType], unknownType, 1)],
    ["stringify", intrinsic("json.stringify", [anyType, { kind: "union", members: [boolType, numberType] }], stringType, 1)],
    ["stableStringify", intrinsic("json.stableStringify", [anyType, { kind: "union", members: [boolType, numberType] }], stringType, 1)],
    ["clone", intrinsic("json.clone", [anyType, anyType], anyType, 1)],
    ["isSerializable", functionType([anyType], boolType)],
    ["deepEqual", functionType([anyType, anyType], boolType)],
  ]))],
  ["velar/async", moduleInterface(new Map([
    ["sleep", functionType([numberType], promise(noneType))],
    ["all", intrinsic("async.all", [listAny], promise(listAny))],
    ["race", intrinsic("async.race", [listAny], promise(anyType))],
    ["timeout", intrinsic("async.timeout", [promise(anyType), numberType, stringType], promise(anyType), 2)],
    ["retry", intrinsic("async.retry", [anyType, numberType], promise(anyType), 1)],
    ["map", intrinsic("async.map", [listAny, anyType, numberType], promise(listAny), 2)],
    ["series", intrinsic("async.series", [listAny], promise(listAny))],
  ]))],
  ["velar/url", moduleInterface(new Map([
    ["parse", functionType([stringType, stringType], urlInfoType, 1)],
    ["join", intrinsic("url.join", [stringType], stringType)],
    ["query", functionType([anyType], stringType)],
    ["parseQuery", functionType([stringType], { kind: "map", key: stringType, value: stringType })],
    ["withQuery", functionType([stringType, anyType], stringType)],
    ["withHash", functionType([stringType, stringType], stringType)],
    ["isExternal", functionType([stringType, stringType], boolType, 1)],
    ["encode", functionType([stringType], stringType)],
    ["decode", functionType([stringType], stringType)],
    ["normalize", functionType([stringType, stringType], stringType, 1)],
  ]))],
  ["velar/time", moduleInterface(new Map([
    ["now", functionType([], numberType)],
    ["monotonic", functionType([], numberType)],
    ["parse", functionType([stringType], optional(numberType))],
    ["iso", functionType([numberType], stringType, 0)],
    ["format", functionType([numberType, stringType, stringType], stringType, 1)],
    ["date", functionType([numberType, numberType, numberType, numberType, numberType, numberType], numberType, 3)],
    ["utc", functionType([numberType, numberType, numberType, numberType, numberType, numberType], numberType, 3)],
    ["parts", functionType([numberType, stringType], timePartsType, 1)],
  ]))],
  ["velar/id", moduleInterface(new Map([
    ["uuid", functionType([], stringType)],
    ["isUuid", functionType([stringType], boolType)],
  ]))],
  ["velar/log", moduleInterface(new Map([
    ["log", loggerType],
    ["logger", functionType([stringType, logFieldsType], loggerType, 1)],
    ["level", functionType([], stringType)],
    ["setLevel", functionType([stringType], noneType)],
    ["useSink", functionType([functionType([logRecordType], unknownType)], cleanupType)],
  ]))],
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
  ["velar/test", moduleInterface(new Map([
    ["expect", intrinsic("test.expect", [anyType], anyType)],
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

export function isStandardModule(source: string): boolean {
  return standardInterfaces.has(source);
}

export function standardModuleInterface(source: string): ModuleInterface | null {
  return standardInterfaces.get(source) ?? null;
}

const ownedCallbackRuntime = String.raw`
function __velarReportOwnedCallback(failure, phase, detail) {
  const error = failure instanceof Error ? failure : new Error(String(failure), { cause: failure });
  const runtime = globalThis[Symbol.for("velar.runtime.v1")];
  if (runtime && typeof runtime.report === "function") runtime.report(error, { phase, detail, unhandled: true });
  else queueMicrotask(() => { throw error; });
}
function __velarInvokeOwnedCallback(callback, arguments_, phase, detail) {
  if (callback == null) return;
  try {
    const result = callback(...arguments_);
    if (result && typeof result.then === "function") result.catch((failure) => __velarReportOwnedCallback(failure, phase, detail));
  } catch (failure) {
    __velarReportOwnedCallback(failure, phase, detail);
  }
}
`.trimStart();

const strictJsonRuntime = String.raw`
const __velarMaxJsonCodeUnits = 16 * 1024 * 1024;
const __velarMaxJsonNodes = 1000000;
const __velarMaxJsonDepth = 128;
function __velarJsonFailure(path, message) {
  throw new TypeError("Invalid JSON value at " + path + ": " + message);
}
function __velarJsonPath(parent, key) {
  return /^[A-Za-z_][A-Za-z0-9_]*$/u.test(key) ? parent + "." + key : parent + "[" + JSON.stringify(key) + "]";
}
function __velarJsonStringUnits(value) {
  let units = 2;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code === 34 || code === 92 || code === 8 || code === 9 || code === 10 || code === 12 || code === 13) units += 2;
    else if (code <= 31 || (code >= 0xD800 && code <= 0xDFFF && !(code <= 0xDBFF && index + 1 < value.length && value.charCodeAt(index + 1) >= 0xDC00 && value.charCodeAt(index + 1) <= 0xDFFF))) units += 6;
    else { units += 1; if (code >= 0xD800 && code <= 0xDBFF) { units += 1; index += 1; } }
    if (units > __velarMaxJsonCodeUnits) return units;
  }
  return units;
}
function __velarJsonBudget(state, path) {
  if (state.nodes > __velarMaxJsonNodes) __velarJsonFailure(path, "data cannot exceed " + __velarMaxJsonNodes + " values");
  if (state.compactUnits > __velarMaxJsonCodeUnits) __velarJsonFailure(path, "encoded JSON cannot exceed 16 MiB");
}
function __velarAssertJson(value, path = "$", state = null) {
  state ??= { active: new Set(), nodes: 0, depth: 0, compactUnits: 0, prettyLines: 0, prettyIndentWeight: 0, prettyColonSpaces: 0 };
  state.nodes += 1;
  if (value === null) { state.compactUnits += 4; __velarJsonBudget(state, path); return state; }
  if (typeof value === "string") { state.compactUnits += __velarJsonStringUnits(value); __velarJsonBudget(state, path); return state; }
  if (typeof value === "boolean") { state.compactUnits += value ? 4 : 5; __velarJsonBudget(state, path); return state; }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) __velarJsonFailure(path, "numbers must be finite");
    state.compactUnits += String(value).length;
    __velarJsonBudget(state, path);
    return state;
  }
  if (typeof value !== "object") __velarJsonFailure(path, typeof value + " is not supported");
  if (state.depth >= __velarMaxJsonDepth) __velarJsonFailure(path, "data cannot exceed " + __velarMaxJsonDepth + " nested collections");
  if (state.active.has(value)) __velarJsonFailure(path, "cyclic data is not supported");
  state.active.add(value);
  try {
    if (Array.isArray(value)) {
      if (value.length > 1000000) __velarJsonFailure(path, "Lists cannot exceed 1000000 items");
      if (Object.getOwnPropertySymbols(value).length > 0) __velarJsonFailure(path, "List symbol fields are not supported");
      const names = Object.getOwnPropertyNames(value);
      if (names.length !== value.length + 1 || names[names.length - 1] !== "length") {
        __velarJsonFailure(path, "Lists must be dense and cannot have extra fields");
      }
      state.compactUnits += 2 + Math.max(0, value.length - 1);
      if (value.length > 0) {
        state.prettyLines += value.length + 1;
        state.prettyIndentWeight += value.length * (state.depth + 1) + state.depth;
      }
      __velarJsonBudget(state, path);
      state.depth += 1;
      for (let index = 0; index < value.length; index += 1) {
        const descriptor = Object.getOwnPropertyDescriptor(value, index);
        if (!descriptor?.enumerable || !("value" in descriptor)) __velarJsonFailure(path + "[" + index + "]", "List entries must be enumerable data values");
        __velarAssertJson(descriptor.value, path + "[" + index + "]", state);
      }
      state.depth -= 1;
      return state;
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      __velarJsonFailure(path, "only records and Lists are supported");
    }
    const keys = Reflect.ownKeys(value);
    if (keys.length > 1000000) __velarJsonFailure(path, "records cannot exceed 1000000 fields");
    state.compactUnits += 2 + Math.max(0, keys.length - 1);
    if (keys.length > 0) {
      state.prettyLines += keys.length + 1;
      state.prettyIndentWeight += keys.length * (state.depth + 1) + state.depth;
      state.prettyColonSpaces += keys.length;
    }
    __velarJsonBudget(state, path);
    state.depth += 1;
    for (const key of keys) {
      if (typeof key !== "string") __velarJsonFailure(path, "record symbol fields are not supported");
      state.compactUnits += __velarJsonStringUnits(key) + 1;
      __velarJsonBudget(state, path);
      const childPath = __velarJsonPath(path, key);
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor?.enumerable || !("value" in descriptor)) {
        __velarJsonFailure(childPath, "record fields must be enumerable data values");
      }
      __velarAssertJson(descriptor.value, childPath, state);
    }
    state.depth -= 1;
    return state;
  } finally {
    state.active.delete(value);
  }
}
function __velarJsonIndent(pretty) {
  if (pretty === false) return 0;
  if (pretty === true) return 2;
  if (!Number.isInteger(pretty) || pretty < 0 || pretty > 10) {
    throw new RangeError("JSON indentation must be false, true, or an integer from 0 to 10");
  }
  return pretty;
}
function __velarJsonStringify(value, pretty = false) {
  const state = __velarAssertJson(value);
  const indentation = __velarJsonIndent(pretty);
  const estimated = state.compactUnits + (indentation ? state.prettyLines + state.prettyColonSpaces + state.prettyIndentWeight * indentation : 0);
  if (estimated > __velarMaxJsonCodeUnits) throw new RangeError("Encoded JSON cannot exceed 16 MiB");
  const output = JSON.stringify(value, null, indentation);
  if (output.length > __velarMaxJsonCodeUnits) throw new RangeError("Encoded JSON cannot exceed 16 MiB");
  return output;
}
`.trimStart();

const deepEqualRuntime = String.raw`
function __velarPlainRecord(value) { const prototype = Object.getPrototypeOf(value); return prototype === Object.prototype || prototype === null; }
function __velarDenseList(value) {
  if (!Array.isArray(value) || value.length > 1000000
    || Object.getOwnPropertySymbols(value).length !== 0
    || Object.getOwnPropertyNames(value).length !== value.length + 1) return false;
  for (let index = 0; index < value.length; index += 1) if (!Object.prototype.hasOwnProperty.call(value, index)) return false;
  return true;
}
function __velarDataRecordKeys(value) {
  if (!__velarPlainRecord(value) || Object.getOwnPropertySymbols(value).length > 0) return null;
  const keys = Object.getOwnPropertyNames(value);
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor?.enumerable || !("value" in descriptor)) return null;
  }
  return keys.sort();
}
function __velarEqualValue(left, right, leftActive, rightActive, depth = 0) {
  if (left === right) return true;
  if (left === null || right === null || typeof left !== "object" || typeof right !== "object") return false;
  if (depth >= 512) return false;
  if (leftActive.has(left) || rightActive.has(right)) return false;
  leftActive.add(left); rightActive.add(right);
  try {
    if (Array.isArray(left) || Array.isArray(right)) {
      return __velarDenseList(left) && __velarDenseList(right) && left.length === right.length
        && left.every((item, index) => __velarEqualValue(item, right[index], leftActive, rightActive, depth + 1));
    }
    if (left instanceof Map || right instanceof Map) {
      if (!(left instanceof Map) || !(right instanceof Map) || left.size !== right.size) return false;
      for (const [key, value] of left) if (!right.has(key) || !__velarEqualValue(value, right.get(key), leftActive, rightActive, depth + 1)) return false;
      return true;
    }
    if (left instanceof Set || right instanceof Set) {
      if (!(left instanceof Set) || !(right instanceof Set) || left.size !== right.size) return false;
      for (const value of left) if (!right.has(value)) return false;
      return true;
    }
    const leftKeys = __velarDataRecordKeys(left);
    const rightKeys = __velarDataRecordKeys(right);
    if (!leftKeys || !rightKeys) return false;
    return leftKeys.length === rightKeys.length
      && leftKeys.every((key, index) => key === rightKeys[index]
        && __velarEqualValue(Object.getOwnPropertyDescriptor(left, key).value, Object.getOwnPropertyDescriptor(right, key).value, leftActive, rightActive, depth + 1));
  } finally {
    leftActive.delete(left); rightActive.delete(right);
  }
}
function __velarDeepEqual(left, right) { return __velarEqualValue(left, right, new WeakSet(), new WeakSet()); }
`.trimStart();

const listRuntime = String.raw`
const __velarMaxListItems = 1000000;
function __velarRequireList(value, name) {
  if (!Array.isArray(value)) throw new TypeError(name + " requires a List");
  if (value.length > __velarMaxListItems) throw new RangeError(name + " cannot exceed " + __velarMaxListItems + " items");
  if (Object.getOwnPropertySymbols(value).length > 0
    || Object.getOwnPropertyNames(value).length !== value.length + 1) {
    throw new TypeError(name + " requires a dense List without extra fields");
  }
  const output = new Array(value.length);
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, index);
    if (!descriptor?.enumerable || !("value" in descriptor)) {
      throw new TypeError(name + " requires data-only List elements");
    }
    output[index] = descriptor.value;
  }
  return output;
}
`.trimStart();

const optionsRuntime = String.raw`
function __velarOptions(value, name, allowed) {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) {
    throw new TypeError(name + " must be a record");
  }
  if (Object.getOwnPropertySymbols(value).length > 0) throw new TypeError(name + " cannot contain symbol fields");
  const output = Object.create(null);
  for (const key of Object.getOwnPropertyNames(value)) {
    if (!allowed.has(key)) throw new TypeError("Unknown " + name + " field '" + key + "'");
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor?.enumerable || !("value" in descriptor)) throw new TypeError(name + " field '" + key + "' must be an enumerable data value");
    output[key] = descriptor.value;
  }
  return Object.freeze(output);
}
function __velarString(value, name) { if (typeof value !== "string") throw new TypeError(name + " must be a string"); return value; }
function __velarBool(value, name) { if (typeof value !== "boolean") throw new TypeError(name + " must be bool"); return value; }
`.trimStart();

const runtimeTypeRuntime = String.raw`
const __velarRuntimeTypeRegistryKey = Symbol.for("velar.type.registry.v1");
const __velarRuntimeTypeRegistry = (() => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, __velarRuntimeTypeRegistryKey);
  if (descriptor) {
    if (!("value" in descriptor)) throw new TypeError("Velar runtime type registry cannot be an accessor");
    try { WeakSet.prototype.has.call(descriptor.value, descriptor.value); }
    catch { throw new TypeError("Velar runtime type registry is invalid"); }
    return descriptor.value;
  }
  const registry = new WeakSet();
  Object.defineProperty(globalThis, __velarRuntimeTypeRegistryKey, {
    value: registry,
    enumerable: false,
    configurable: false,
    writable: false,
  });
  return registry;
})();
function __velarRegisterRuntimeType(value) { __velarRuntimeTypeRegistry.add(value); return value; }
function __velarRequireRuntimeType(value, name, optional = false) {
  if (optional && value == null) return null;
  if (!value || typeof value !== "object" || !WeakSet.prototype.has.call(__velarRuntimeTypeRegistry, value)) {
    throw new TypeError(name + " requires a compiler-known Velar runtime type");
  }
  return value;
}
`.trimStart();

export const standardModuleSources: ReadonlyMap<string, string> = new Map([
  ["velar/collections", String.raw`
${listRuntime}
function requireList(value, name) {
  return __velarRequireList(value, name);
}

function requireCount(value, name, positive = false) {
  if (!Number.isSafeInteger(value) || (positive ? value <= 0 : value < 0)) {
    throw new RangeError(name + " requires " + (positive ? "a positive" : "a non-negative") + " integer");
  }
  return value;
}

function requireCallback(value, name) {
  if (typeof value !== "function") throw new TypeError(name + " requires a function");
  return value;
}

function predicate(callback, value, name) {
  const result = requireCallback(callback, name)(value);
  if (typeof result !== "boolean") throw new TypeError(name + " predicate must return bool");
  return result;
}

function comparable(value, name, expected = null) {
  const type = typeof value;
  if ((type !== "string" && type !== "number") || (type === "number" && Number.isNaN(value))) {
    throw new TypeError(name + " key must be a string or non-NaN number");
  }
  if (expected !== null && type !== expected) throw new TypeError(name + " keys must all have the same type");
  return type;
}

export function range(start, stop = null, step = 1) {
  if (stop === null) { stop = start; start = 0; }
  if (![start, stop, step].every(Number.isFinite) || step === 0) throw new RangeError("range requires finite numbers and a non-zero step");
  const output = [];
  if (step > 0) for (let value = start; value < stop;) {
    if (output.length >= __velarMaxListItems) throw new RangeError("range cannot produce more than " + __velarMaxListItems + " items");
    output.push(value); const next = value + step;
    if (next === value) throw new RangeError("range step is too small to advance at this magnitude");
    value = next;
  } else for (let value = start; value > stop;) {
    if (output.length >= __velarMaxListItems) throw new RangeError("range cannot produce more than " + __velarMaxListItems + " items");
    output.push(value); const next = value + step;
    if (next === value) throw new RangeError("range step is too small to advance at this magnitude");
    value = next;
  }
  return output;
}

export function enumerate(values, start = 0) {
  requireList(values, "enumerate");
  if (!Number.isSafeInteger(start) || (values.length > 0 && !Number.isSafeInteger(start + values.length - 1))) throw new RangeError("enumerate indexes must be safe integers");
  return values.map((value, index) => Object.freeze({ index: start + index, value }));
}

export function zip(left, right) {
  requireList(left, "zip"); requireList(right, "zip");
  const length = Math.min(left.length, right.length);
  return Array.from({ length }, (_, index) => Object.freeze({ first: left[index], second: right[index] }));
}

export function unique(values) { return [...new Set(requireList(values, "unique"))]; }

export function chunk(values, size) {
  requireList(values, "chunk"); requireCount(size, "chunk size", true);
  const output = [];
  for (let index = 0; index < values.length; index += size) output.push(values.slice(index, index + size));
  return output;
}

export function flatten(values) {
  requireList(values, "flatten");
  const output = [];
  for (const value of values) {
    const nested = requireList(value, "flatten");
    if (output.length + nested.length > __velarMaxListItems) throw new RangeError("flatten cannot produce more than " + __velarMaxListItems + " items");
    for (const item of nested) output.push(item);
  }
  return output;
}

export function compact(values) { return requireList(values, "compact").filter((value) => value != null); }
export function reverse(values) { return requireList(values, "reverse").slice().reverse(); }
export function take(values, count) { return requireList(values, "take").slice(0, requireCount(count, "take count")); }
export function drop(values, count) { return requireList(values, "drop").slice(requireCount(count, "drop count")); }
export function first(values) { values = requireList(values, "first"); return values.length ? values[0] : null; }
export function last(values) { values = requireList(values, "last"); return values.length ? values[values.length - 1] : null; }
export function find(values, callback) { return requireList(values, "find").find((value) => predicate(callback, value, "find")) ?? null; }
export function findIndex(values, callback) { return requireList(values, "findIndex").findIndex((value) => predicate(callback, value, "findIndex")); }
export function contains(values, value) { return requireList(values, "contains").some((item) => item === value); }
export function count(values, value) { return requireList(values, "count").reduce((total, item) => total + (item === value ? 1 : 0), 0); }
export function any(values, callback) { return requireList(values, "any").some((value) => predicate(callback, value, "any")); }
export function all(values, callback) { return requireList(values, "all").every((value) => predicate(callback, value, "all")); }

export function partition(values, callback) {
  requireList(values, "partition");
  const matches = [], rest = [];
  for (const value of values) (predicate(callback, value, "partition") ? matches : rest).push(value);
  return Object.freeze({ matches, rest });
}

export function groupBy(values, key) {
  requireList(values, "groupBy");
  requireCallback(key, "groupBy");
  const output = new Map();
  for (const value of values) {
    const name = key(value);
    const group = output.get(name);
    if (group) group.push(value); else output.set(name, [value]);
  }
  return output;
}

export function keyBy(values, key) {
  requireList(values, "keyBy");
  requireCallback(key, "keyBy");
  return new Map(values.map((value) => [key(value), value]));
}

export function countBy(values, key) {
  requireList(values, "countBy");
  requireCallback(key, "countBy");
  const output = new Map();
  for (const value of values) { const name = key(value); output.set(name, (output.get(name) || 0) + 1); }
  return output;
}

export function sortBy(values, key, descending = false) {
  values = requireList(values, "sortBy"); requireCallback(key, "sortBy");
  if (typeof descending !== "boolean") throw new TypeError("sortBy descending must be bool");
  let keyType = null;
  return values.map((value, index) => {
    const result = key(value);
    const type = comparable(result, "sortBy", keyType);
    if (keyType === null) keyType = type;
    return { value, index, key: result };
  }).sort((left, right) => {
    const order = left.key < right.key ? -1 : left.key > right.key ? 1 : 0;
    return order === 0 ? left.index - right.index : descending ? -order : order;
  }).map((item) => item.value);
}

function extremeBy(values, key, direction, name) {
  requireList(values, name); requireCallback(key, name);
  if (!values.length) return null;
  let selected = values[0], selectedKey = key(selected), keyType = comparable(selectedKey, name);
  for (let index = 1; index < values.length; index += 1) {
    const candidate = key(values[index]);
    comparable(candidate, name, keyType);
    if ((direction < 0 && candidate < selectedKey) || (direction > 0 && candidate > selectedKey)) {
      selected = values[index]; selectedKey = candidate;
    }
  }
  return selected;
}

export function minBy(values, key) { return extremeBy(values, key, -1, "minBy"); }
export function maxBy(values, key) { return extremeBy(values, key, 1, "maxBy"); }
export function sum(values) { return requireList(values, "sum").reduce((total, value) => { if (typeof value !== "number") throw new TypeError("sum requires numbers"); return total + value; }, 0); }
export function join(values, separator = "") { if (typeof separator !== "string") throw new TypeError("join separator must be a string"); return requireList(values, "join").map((value) => { if (typeof value !== "string") throw new TypeError("join requires strings"); return value; }).join(separator); }
export function repeat(value, count) { count = requireCount(count, "repeat count"); if (count > __velarMaxListItems) throw new RangeError("repeat cannot produce more than " + __velarMaxListItems + " items"); return Array.from({ length: count }, () => value); }
`.trimStart()],
  ["velar/text", String.raw`
const maxTextCodeUnits = 16 * 1024 * 1024;
const maxTextItems = 1000000;
function valueOf(value) { if (typeof value !== "string") throw new TypeError("velar/text requires strings"); if (value.length > maxTextCodeUnits) throw new RangeError("velar/text strings cannot exceed 16 MiB"); return value; }
function textOutput(value, name) { if (value.length > maxTextCodeUnits) throw new RangeError(name + " output cannot exceed 16 MiB"); return value; }
function textCount(value, name) { if (!Number.isSafeInteger(value) || value < 0 || value > maxTextCodeUnits) throw new RangeError(name + " must be an integer from 0 through " + maxTextCodeUnits); return value; }
function textList(values, name) { if (values.length > maxTextItems) throw new RangeError(name + " cannot produce more than " + maxTextItems + " items"); return values; }
function codePointLength(value) { let length = 0; for (const _ of value) length += 1; return length; }
function codePointPrefix(value, count) { let output = "", length = 0; for (const character of value) { if (length >= count) break; output += character; length += 1; } return output; }
function patternOptions(value) {
  if (value == null) return {};
  if (typeof value !== "object" || Array.isArray(value) || (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) throw new TypeError("text pattern options must be a record");
  if (Object.getOwnPropertySymbols(value).length > 0) throw new TypeError("text pattern options cannot contain symbol fields");
  const allowed = new Set(["ignoreCase", "multiline", "dotAll"]);
  for (const name of Object.getOwnPropertyNames(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, name);
    if (!descriptor?.enumerable || !("value" in descriptor)) throw new TypeError("Text pattern option '" + name + "' must be an enumerable data field");
    if (!allowed.has(name)) throw new TypeError("Unknown text pattern option '" + name + "'");
    const option = descriptor.value;
    if (option != null && typeof option !== "boolean") throw new TypeError("Text pattern option '" + name + "' must be bool");
  }
  return value;
}
function patternOf(expression, options, global = false) {
  expression = valueOf(expression); options = patternOptions(options);
  if (expression.length > 4096) throw new RangeError("text patterns cannot exceed 4096 code units");
  let flags = "u";
  if (global) flags += "g";
  if (options.ignoreCase === true) flags += "i";
  if (options.multiline === true) flags += "m";
  if (options.dotAll === true) flags += "s";
  try { return new RegExp(expression, flags); }
  catch (error) { throw new TypeError("Invalid text pattern: " + (error instanceof Error ? error.message : String(error))); }
}
function matchValue(match) {
  return Object.freeze({ value: match[0], index: match.index, groups: match.slice(1).map((value) => value === undefined ? null : value) });
}
export function trim(value) { return valueOf(value).trim(); }
export function trimStart(value) { return valueOf(value).trimStart(); }
export function trimEnd(value) { return valueOf(value).trimEnd(); }
export function lower(value) { return textOutput(valueOf(value).toLowerCase(), "lower"); }
export function upper(value) { return textOutput(valueOf(value).toUpperCase(), "upper"); }
export function capitalize(value) { value = valueOf(value); if (!value) return ""; const first = String.fromCodePoint(value.codePointAt(0)); return textOutput(first.toUpperCase() + value.slice(first.length).toLowerCase(), "capitalize"); }
export function title(value) { return textOutput(valueOf(value).toLowerCase().replace(/[_\-/]+/gu, " ").replace(/(^|\s)([\p{L}\p{N}])/gu, (_, before, char) => before + char.toUpperCase()), "title"); }
export function startsWith(value, prefix) { return valueOf(value).startsWith(valueOf(prefix)); }
export function endsWith(value, suffix) { return valueOf(value).endsWith(valueOf(suffix)); }
export function includes(value, part) { return valueOf(value).includes(valueOf(part)); }
export function split(value, separator) { value = valueOf(value); separator = valueOf(separator); if (!separator && value.length > maxTextItems) throw new RangeError("split cannot produce more than " + maxTextItems + " items"); const result = value.split(separator, maxTextItems + 1); return textList(result, "split"); }
export function replace(value, search, replacement) { return textOutput(valueOf(value).replace(valueOf(search), valueOf(replacement)), "replace"); }
export function replaceAll(value, search, replacement) { value = valueOf(value); search = valueOf(search); replacement = valueOf(replacement); const matches = search ? Math.floor((value.length - value.replaceAll(search, "").length) / search.length) : value.length + 1; const estimated = value.length + matches * (replacement.length - search.length); if (!Number.isSafeInteger(estimated) || estimated > maxTextCodeUnits) throw new RangeError("replaceAll output cannot exceed 16 MiB"); return value.replaceAll(search, replacement); }
export function repeat(value, count) { value = valueOf(value); count = textCount(count, "text.repeat count"); if (value.length > 0 && count > Math.floor(maxTextCodeUnits / value.length)) throw new RangeError("text.repeat output cannot exceed 16 MiB"); return value.repeat(count); }
export function padStart(value, length, fill = " ") { return valueOf(value).padStart(textCount(length, "padStart length"), valueOf(fill)); }
export function padEnd(value, length, fill = " ") { return valueOf(value).padEnd(textCount(length, "padEnd length"), valueOf(fill)); }
export function lines(value) { return textList(valueOf(value).split(/\r?\n/u, maxTextItems + 1), "lines"); }
export function words(value) { const cleaned = valueOf(value).trim(); return cleaned ? textList(cleaned.split(/\s+/u, maxTextItems + 1), "words") : []; }
export function slug(value) { return textOutput(valueOf(value).normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().trim().replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-+|-+$/gu, ""), "slug"); }
export function truncate(value, length, suffix = "…") { value = valueOf(value); suffix = valueOf(suffix); length = textCount(length, "truncate length"); const valueLength = codePointLength(value); if (valueLength <= length) return value; const suffixLength = codePointLength(suffix); if (suffixLength >= length) return codePointPrefix(suffix, length); return codePointPrefix(value, length - suffixLength) + suffix; }
export function indent(value, prefix = "    ") { return textOutput(lines(valueOf(value)).map((line) => valueOf(prefix) + line).join("\n"), "indent"); }
export function dedent(value) { const rows = lines(valueOf(value)); let width = null; for (const line of rows) if (line.trim()) { const current = line.match(/^[ \t]*/u)[0].length; width = width === null ? current : Math.min(width, current); } return rows.map((line) => line.slice(width ?? 0)).join("\n"); }
export function normalizeWhitespace(value) { return valueOf(value).trim().replace(/\s+/gu, " "); }
export function isBlank(value) { return valueOf(value).trim().length === 0; }
export function escapeHtml(value) { return textOutput(valueOf(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;"), "escapeHtml"); }
export function matches(value, expression, options = {}) { return patternOf(expression, options).test(valueOf(value)); }
export function findMatch(value, expression, options = {}) { const match = patternOf(expression, options).exec(valueOf(value)); return match ? matchValue(match) : null; }
export function findMatches(value, expression, options = {}) { const output = []; for (const match of valueOf(value).matchAll(patternOf(expression, options, true))) { if (output.length >= maxTextItems) throw new RangeError("findMatches cannot produce more than " + maxTextItems + " items"); output.push(matchValue(match)); } return output; }
export function replaceMatches(value, expression, replacement, options = {}) { return textOutput(valueOf(value).replace(patternOf(expression, options, true), () => valueOf(replacement)), "replaceMatches"); }
export function splitPattern(value, expression, options = {}) {
  value = valueOf(value); const output = []; let end = 0;
  for (const match of value.matchAll(patternOf(expression, options, true))) { if (output.length >= maxTextItems) throw new RangeError("splitPattern cannot produce more than " + maxTextItems + " items"); output.push(value.slice(end, match.index)); end = match.index + match[0].length; }
  output.push(value.slice(end)); return output;
}
`.trimStart()],
  ["velar/math", String.raw`
function requireNumber(value, name) { if (typeof value !== "number") throw new TypeError(name + " requires numbers"); return value; }
function unary(value, operation, name) { return operation(requireNumber(value, name)); }
function binary(left, right, operation, name) { return operation(requireNumber(left, name), requireNumber(right, name)); }
export const pi = Math.PI;
export const e = Math.E;
export const tau = Math.PI * 2;
export const infinity = Number.POSITIVE_INFINITY;
export function abs(value) { return unary(value, Math.abs, "abs"); }
export function min(...values) { if (!values.length) throw new RangeError("min requires at least one number"); let result = requireNumber(values[0], "min"); for (let index = 1; index < values.length; index += 1) result = Math.min(result, requireNumber(values[index], "min")); return result; }
export function max(...values) { if (!values.length) throw new RangeError("max requires at least one number"); let result = requireNumber(values[0], "max"); for (let index = 1; index < values.length; index += 1) result = Math.max(result, requireNumber(values[index], "max")); return result; }
export function clamp(value, minimum, maximum) { value = requireNumber(value, "clamp"); minimum = requireNumber(minimum, "clamp"); maximum = requireNumber(maximum, "clamp"); if (minimum > maximum) throw new RangeError("clamp minimum cannot exceed maximum"); return Math.min(maximum, Math.max(minimum, value)); }
export function sign(value) { return unary(value, Math.sign, "sign"); }
export function round(value, digits = 0) {
  value = requireNumber(value, "round");
  if (!Number.isSafeInteger(digits) || digits < -308 || digits > 308) throw new RangeError("round digits must be an integer from -308 through 308");
  if (!Number.isFinite(value) || digits === 0) return Math.round(value);
  const [coefficient, exponent = "0"] = value.toString().split("e");
  const shifted = Math.round(Number(coefficient + "e" + (Number(exponent) + digits)));
  if (!Number.isFinite(shifted)) return value;
  const [rounded, roundedExponent = "0"] = shifted.toString().split("e");
  return Number(rounded + "e" + (Number(roundedExponent) - digits));
}
export function floor(value) { return unary(value, Math.floor, "floor"); }
export function ceil(value) { return unary(value, Math.ceil, "ceil"); }
export function trunc(value) { return unary(value, Math.trunc, "trunc"); }
export function sqrt(value) { return unary(value, Math.sqrt, "sqrt"); }
export function cbrt(value) { return unary(value, Math.cbrt, "cbrt"); }
export function pow(left, right) { return binary(left, right, Math.pow, "pow"); }
export function exp(value) { return unary(value, Math.exp, "exp"); }
export function log(value, base = Math.E) { return Math.log(requireNumber(value, "log")) / Math.log(requireNumber(base, "log")); }
export function log2(value) { return unary(value, Math.log2, "log2"); }
export function log10(value) { return unary(value, Math.log10, "log10"); }
export function sin(value) { return unary(value, Math.sin, "sin"); }
export function cos(value) { return unary(value, Math.cos, "cos"); }
export function tan(value) { return unary(value, Math.tan, "tan"); }
export function asin(value) { return unary(value, Math.asin, "asin"); }
export function acos(value) { return unary(value, Math.acos, "acos"); }
export function atan(value) { return unary(value, Math.atan, "atan"); }
export function atan2(left, right) { return binary(left, right, Math.atan2, "atan2"); }
export function degrees(value) { return requireNumber(value, "degrees") * 180 / Math.PI; }
export function radians(value) { return requireNumber(value, "radians") * Math.PI / 180; }
export function hypot(left, right) { return binary(left, right, Math.hypot, "hypot"); }
export const random = Math.random;
export function randomInt(minimum, maximum = null) { if (maximum === null) { maximum = minimum; minimum = 0; } const width = maximum - minimum; if (!Number.isSafeInteger(minimum) || !Number.isSafeInteger(maximum) || !Number.isSafeInteger(width) || width <= 0) throw new RangeError("randomInt requires an increasing safe-integer range"); return Math.floor(Math.random() * width) + minimum; }
export const isFinite = Number.isFinite;
export const isInteger = Number.isInteger;
export function gcd(left, right) { if (!Number.isSafeInteger(left) || !Number.isSafeInteger(right)) throw new TypeError("gcd requires safe integers"); left = Math.abs(left); right = Math.abs(right); while (right) [left, right] = [right, left % right]; return left; }
export function lcm(left, right) { if (!Number.isSafeInteger(left) || !Number.isSafeInteger(right)) throw new TypeError("lcm requires safe integers"); if (left === 0 || right === 0) return 0; const result = Math.abs((left / gcd(left, right)) * right); if (!Number.isSafeInteger(result)) throw new RangeError("lcm result is outside the safe-integer range"); return result; }
`.trimStart()],
  ["velar/json", String.raw`
${strictJsonRuntime}
${deepEqualRuntime}
${runtimeTypeRuntime}
function runtimeType(Type) { return __velarRequireRuntimeType(Type, "JSON validation", true); }
function validate(value, Type) { Type = runtimeType(Type); return Type ? Type.parse(value) : value; }
export function parse(text, Type = null) { if (typeof text !== "string") throw new TypeError("json.parse requires a string"); Type = runtimeType(Type); if (text.length > __velarMaxJsonCodeUnits) throw new RangeError("JSON text cannot exceed 16 MiB"); const value = JSON.parse(text); __velarAssertJson(value); return Type ? Type.parse(value) : value; }
export function tryParse(text, Type = null, fallback = null) { Type = runtimeType(Type); try { return parse(text, Type); } catch { return fallback; } }
export function stringify(value, pretty = false) { return __velarJsonStringify(value, pretty); }
function sorted(value) { if (value === null || typeof value !== "object") return value; if (Array.isArray(value)) return value.map(sorted); const result = Object.create(null); for (const key of Object.keys(value).sort()) result[key] = sorted(value[key]); return result; }
export function stableStringify(value, pretty = false) { __velarAssertJson(value); return __velarJsonStringify(sorted(value), pretty); }
export function clone(value, Type = null) { Type = runtimeType(Type); const cloned = JSON.parse(__velarJsonStringify(value)); return Type ? Type.parse(cloned) : cloned; }
export function isSerializable(value) { try { __velarAssertJson(value); return true; } catch { return false; } }
export function deepEqual(left, right) { return __velarDeepEqual(left, right); }
`.trimStart()],
  ["velar/async", String.raw`
${listRuntime}
const __velarMaxTimerMilliseconds = 2147483647;
const __velarMaxAsyncFanout = 10000;
function asyncFanout(values, name) { values = __velarRequireList(values, name); if (values.length > __velarMaxAsyncFanout) throw new RangeError(name + " cannot start more than 10000 operations at once"); return values; }
export function sleep(milliseconds) { if (!Number.isFinite(milliseconds) || milliseconds < 0 || milliseconds > __velarMaxTimerMilliseconds) throw new RangeError("sleep requires milliseconds from 0 through 2147483647"); return new Promise((resolve) => setTimeout(() => resolve(null), milliseconds)); }
export function all(values) { return Promise.all(asyncFanout(values, "async.all")); }
export function race(values) { return Promise.race(asyncFanout(values, "async.race")); }
export async function timeout(value, milliseconds, message = "Operation timed out") { if (!Number.isFinite(milliseconds) || milliseconds < 0 || milliseconds > __velarMaxTimerMilliseconds) throw new RangeError("timeout requires milliseconds from 0 through 2147483647"); if (typeof message !== "string") throw new TypeError("timeout message must be a string"); if (message.length > 65536) throw new RangeError("timeout messages cannot exceed 64 KiB"); let timer; try { return await Promise.race([value, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(message)), milliseconds); })]); } finally { clearTimeout(timer); } }
export async function retry(task, attempts = 3) { if (typeof task !== "function") throw new TypeError("retry requires a function"); if (!Number.isSafeInteger(attempts) || attempts < 1 || attempts > 10000) throw new RangeError("retry attempts must be an integer from 1 through 10000"); let last; for (let attempt = 0; attempt < attempts; attempt += 1) { try { return await task(); } catch (error) { last = error; } } throw last; }
export async function map(values, worker, concurrency = 4) { values = __velarRequireList(values, "async.map"); if (typeof worker !== "function") throw new TypeError("async.map requires a worker"); if (!Number.isSafeInteger(concurrency) || concurrency < 1 || concurrency > 1024) throw new RangeError("async.map concurrency must be an integer from 1 through 1024"); const output = new Array(values.length); let cursor = 0; async function run() { while (true) { const index = cursor++; if (index >= values.length) return; output[index] = await worker(values[index]); } } await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, run)); return output; }
export async function series(tasks) { tasks = __velarRequireList(tasks, "async.series"); if (tasks.some((task) => typeof task !== "function")) throw new TypeError("series requires a List of functions"); const output = []; for (const task of tasks) output.push(await task()); return output; }
`.trimStart()],
  ["velar/url", String.raw`
${listRuntime}
const fallbackBase = "https://velar.invalid/";
function urlText(value, name = "velar/url") { if (typeof value !== "string") throw new TypeError(name + " requires a string"); if (value.length > 2 * 1024 * 1024) throw new RangeError(name + " cannot exceed 2 MiB"); return value; }
function baseOf(base) { return base ? urlText(base, "URL base") : (typeof location !== "undefined" ? location.href : fallbackBase); }
function urlOf(value, base = "") { return new URL(urlText(value), baseOf(base)); }
function restore(original, url) { const output = /^[a-z][a-z\d+.-]*:/iu.test(original) ? url.href : original.startsWith("//") ? "//" + url.host + url.pathname + url.search + url.hash : url.pathname + url.search + url.hash; return urlText(output, "URL output"); }
function queryMap(search, name) {
  const output = new Map();
  let count = 0;
  for (const [key, value] of new URLSearchParams(search)) {
    count += 1;
    if (count > 100000) throw new RangeError(name + " cannot exceed 100000 fields");
    output.set(key, value);
  }
  return output;
}
function appendQueryValue(output, name, value, budget) {
  if (value == null) return;
  if (typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean") throw new TypeError("URL query value '" + name + "' must be a string, number, bool, none, or List of those values");
  const text = String(value);
  budget.units += (name.length + text.length) * 9 + 2;
  if (budget.units > 2 * 1024 * 1024) throw new RangeError("URL query output cannot exceed 2 MiB");
  output.append(name, text);
}
function appendParams(params, output) {
  let entries;
  let entryCount;
  if (params instanceof Map) {
    entryCount = Reflect.getOwnPropertyDescriptor(Map.prototype, "size").get.call(params);
    entries = Map.prototype.entries.call(params);
  } else if (params && typeof params === "object" && !Array.isArray(params)
    && (Object.getPrototypeOf(params) === Object.prototype || Object.getPrototypeOf(params) === null)
    && Object.getOwnPropertySymbols(params).length === 0) {
    const names = Object.getOwnPropertyNames(params);
    const values = [];
    for (const name of names) {
      const descriptor = Object.getOwnPropertyDescriptor(params, name);
      if (!descriptor?.enumerable || !("value" in descriptor)) throw new TypeError("URL query record fields must be enumerable data values");
      values.push([name, descriptor.value]);
    }
    entryCount = values.length;
    entries = values;
  } else throw new TypeError("URL query values require a Map or record");
  if (entryCount > 100000) throw new RangeError("URL query values cannot exceed 100000 fields");
  const budget = { units: 0 };
  for (const [name, value] of entries) {
    if (typeof name !== "string") throw new TypeError("URL query names must be strings");
    if (Array.isArray(value)) for (const item of __velarRequireList(value, "URL query list")) appendQueryValue(output, name, item, budget);
    else appendQueryValue(output, name, value, budget);
  }
}
export function parse(value, base = "") { const url = urlOf(value, base); return Object.freeze({ href: url.href, protocol: url.protocol, host: url.host, hostname: url.hostname, port: url.port, path: url.pathname, query: queryMap(url.search, "URL query"), hash: url.hash, origin: url.origin }); }
export function join(...parts) {
  if (!parts.length) throw new RangeError("url.join requires at least one part");
  let output = urlText(parts[0], "url.join");
  for (const part of parts.slice(1)) {
    const value = urlText(part, "url.join");
    if (!value) continue;
    const segment = value.replace(/^\/+|\/+$/gu, "");
    output = output.endsWith("://") ? output + segment : output.replace(/\/+$/u, "") + "/" + segment;
  }
  return urlText(output, "url.join output");
}
export function query(params) { const output = new URLSearchParams(); appendParams(params, output); return urlText(output.toString(), "URL query output"); }
export function parseQuery(value) { return queryMap(urlText(value, "parseQuery").replace(/^\?/u, ""), "URL query"); }
export function withQuery(value, params) { const url = urlOf(value); url.search = ""; appendParams(params, url.searchParams); return restore(value, url); }
export function withHash(value, hash) { const url = urlOf(value); hash = urlText(hash, "withHash"); url.hash = hash ? "#" + hash.replace(/^#/u, "") : ""; return restore(value, url); }
export function isExternal(value, base = "") { value = urlText(value, "isExternal"); if (base) urlText(base, "URL base"); try { const url = urlOf(value, base); const origin = new URL(baseOf(base)).origin; return url.origin !== origin || !/^https?:$/u.test(url.protocol); } catch { return true; } }
export function encode(value) { return encodeURIComponent(urlText(value, "encode")); }
export function decode(value) { return decodeURIComponent(urlText(value, "decode")); }
export function normalize(value, base = "") { const url = urlOf(value, base); return restore(value, url); }
`.trimStart()],
  ["velar/time", String.raw`
function valid(value) { if (!Number.isFinite(value)) throw new TypeError("velar/time requires a finite timestamp"); return value; }
function timeText(value, name) { if (typeof value !== "string") throw new TypeError(name + " must be a string"); if (value.length > 1024) throw new RangeError(name + " cannot exceed 1024 characters"); return value; }
function calendarParts(year, month, day, hour = 0, minute = 0, second = 0, millisecond = 0) {
  for (const value of [year, month, day, hour, minute, second, millisecond]) if (!Number.isInteger(value)) throw new TypeError("velar/time date parts must be integers");
  if (year < 0 || year > 9999) throw new RangeError("velar/time year must be from 0 through 9999");
  if (month < 1 || month > 12) throw new RangeError("velar/time month must be from 1 through 12");
  if (day < 1 || day > 31) throw new RangeError("velar/time day is outside the selected month");
  if (hour < 0 || hour > 23) throw new RangeError("velar/time hour must be from 0 through 23");
  if (minute < 0 || minute > 59 || second < 0 || second > 59) throw new RangeError("velar/time minute and second must be from 0 through 59");
  if (millisecond < 0 || millisecond > 999) throw new RangeError("velar/time millisecond must be from 0 through 999");
  return [year, month, day, hour, minute, second, millisecond];
}
function build(utc, year, month, day, hour = 0, minute = 0, second = 0, millisecond = 0) {
  calendarParts(year, month, day, hour, minute, second, millisecond);
  const value = new Date(0);
  if (utc) {
    value.setUTCFullYear(year, month - 1, day);
    value.setUTCHours(hour, minute, second, millisecond);
    if (value.getUTCFullYear() !== year || value.getUTCMonth() !== month - 1 || value.getUTCDate() !== day
      || value.getUTCHours() !== hour || value.getUTCMinutes() !== minute || value.getUTCSeconds() !== second || value.getUTCMilliseconds() !== millisecond) {
      throw new RangeError("velar/time date parts do not form a real UTC date");
    }
  } else {
    value.setFullYear(year, month - 1, day);
    value.setHours(hour, minute, second, millisecond);
    if (value.getFullYear() !== year || value.getMonth() !== month - 1 || value.getDate() !== day
      || value.getHours() !== hour || value.getMinutes() !== minute || value.getSeconds() !== second || value.getMilliseconds() !== millisecond) {
      throw new RangeError("velar/time date parts do not form a real local date");
    }
  }
  return valid(value.getTime());
}
export function now() { return Date.now(); }
export function monotonic() { return typeof performance === "undefined" ? Date.now() : performance.now(); }
export function parse(value) {
  if (typeof value !== "string") throw new TypeError("velar/time parse requires an ISO string");
  if (value.length > 64) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?(Z|[+-]\d{2}:\d{2}))?$/u.exec(value);
  if (!match) return null;
  try {
    const year = Number(match[1]), month = Number(match[2]), day = Number(match[3]);
    if (!match[4]) return build(true, year, month, day);
    const hour = Number(match[4]), minute = Number(match[5]), second = Number(match[6] || 0);
    const millisecond = Number((match[7] || "").padEnd(3, "0") || 0);
    const zone = match[8];
    let offset = 0;
    if (zone !== "Z") {
      const sign = zone[0] === "+" ? 1 : -1;
      const offsetHour = Number(zone.slice(1, 3)), offsetMinute = Number(zone.slice(4, 6));
      if (offsetHour > 23 || offsetMinute > 59) return null;
      offset = sign * (offsetHour * 60 + offsetMinute);
    }
    return build(true, year, month, day, hour, minute, second, millisecond) - offset * 60_000;
  } catch { return null; }
}
export function iso(value = Date.now()) { return new Date(valid(value)).toISOString(); }
export function format(value, locale = "", timeZone = "") { locale = timeText(locale, "Time locale"); timeZone = timeText(timeZone, "Time zone"); return new Intl.DateTimeFormat(locale || undefined, timeZone ? { dateStyle: "medium", timeStyle: "medium", timeZone } : { dateStyle: "medium", timeStyle: "medium" }).format(new Date(valid(value))); }
export function date(year, month, day, hour = 0, minute = 0, second = 0) { return build(false, year, month, day, hour, minute, second); }
export function utc(year, month, day, hour = 0, minute = 0, second = 0) { return build(true, year, month, day, hour, minute, second); }
export function parts(value, timeZone = "") {
  const date = new Date(valid(value));
  timeZone = timeText(timeZone, "Time zone");
  if (!timeZone) return Object.freeze({ year: date.getFullYear(), month: date.getMonth() + 1, day: date.getDate(), weekday: date.getDay(), hour: date.getHours(), minute: date.getMinutes(), second: date.getSeconds(), millisecond: date.getMilliseconds() });
  const entries = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "numeric", day: "numeric", weekday: "short", hour: "numeric", minute: "numeric", second: "numeric", hourCycle: "h23" }).formatToParts(date).map((part) => [part.type, part.value]));
  const weekdays = new Map([["Sun", 0], ["Mon", 1], ["Tue", 2], ["Wed", 3], ["Thu", 4], ["Fri", 5], ["Sat", 6]]);
  return Object.freeze({ year: Number(entries.year), month: Number(entries.month), day: Number(entries.day), weekday: weekdays.get(entries.weekday) ?? 0, hour: Number(entries.hour), minute: Number(entries.minute), second: Number(entries.second), millisecond: date.getUTCMilliseconds() });
}
`.trimStart()],
  ["velar/id", String.raw`
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export function uuid() {
  const source = globalThis.crypto;
  if (!source || typeof source.randomUUID !== "function") throw new Error("Secure UUID generation is unavailable in this JavaScript host");
  const value = source.randomUUID();
  if (!isUuid(value)) throw new Error("Secure UUID generation returned an invalid UUID");
  return value;
}

export function isUuid(value) {
  return typeof value === "string" && value.length === 36 && uuidPattern.test(value);
}
`.trimStart()],
  ["velar/log", String.raw`
const ranks = new Map([["debug", 10], ["info", 20], ["warn", 30], ["error", 40], ["silent", 100]]);
let threshold = "info";
const sinks = new Set();
const maxLogFields = 1000;
const maxLogSinks = 1000;

function logText(value, name, maximum = 65536) { if (typeof value !== "string") throw new TypeError(name + " must be a string"); if (value.length > maximum) throw new RangeError(name + " is too long"); return value; }

function fieldsOf(value) {
  if (value == null) return new Map();
  if (!(value instanceof Map)) throw new TypeError("Velar log fields must be a Map");
  if (Reflect.getOwnPropertyDescriptor(Map.prototype, "size").get.call(value) > maxLogFields) throw new RangeError("Velar log fields cannot exceed 1000 entries");
  const fields = new Map();
  for (const [key, field] of Map.prototype.entries.call(value)) {
    if (typeof key !== "string") throw new TypeError("Velar log field names must be strings");
    if (key.length > 1024) throw new RangeError("Velar log field names cannot exceed 1024 characters");
    fields.set(key, field);
  }
  return fields;
}

function defaultSink(record) {
  const target = globalThis.console;
  if (!target) return;
  const write = typeof target[record.level] === "function" ? target[record.level] : target.log;
  write.call(target, record.scope ? "[" + record.scope + "] " + record.message : record.message, Object.fromEntries(record.fields), record.error || "");
}

function sinkFailure(value) {
  const error = value instanceof Error ? value : new Error(String(value), { cause: value });
  defaultSink(Object.freeze({ timestamp: Date.now(), level: "error", scope: "velar/log", message: "Log sink failed", fields: new Map(), error }));
}

function emit(scope, level, message, fields, error = null) {
  message = logText(message, "Log message");
  fields = fieldsOf(fields);
  if (error != null && !(error instanceof Error)) throw new TypeError("Logger error must be an Error");
  if ((ranks.get(level) ?? 100) < (ranks.get(threshold) ?? 20)) return null;
  const record = Object.freeze({ timestamp: Date.now(), level, scope, message, fields, error });
  if (!sinks.size) defaultSink(record);
  else for (const sink of sinks) {
    try {
      const delivered = Object.freeze({ ...record, fields: new Map(record.fields) });
      const result = sink(delivered);
      if (result && typeof result.then === "function") result.catch(sinkFailure);
    } catch (failure) { sinkFailure(failure); }
  }
  return null;
}

function createLogger(scope, base = new Map()) {
  const context = fieldsOf(base);
  const merged = (fields) => {
    const output = new Map(context);
    for (const [key, value] of fieldsOf(fields)) {
      if (!output.has(key) && output.size >= maxLogFields) throw new RangeError("Merged log fields cannot exceed 1000 entries");
      output.set(key, value);
    }
    return output;
  };
  return Object.freeze({
    debug(message, fields = new Map()) { return emit(scope, "debug", message, merged(fields)); },
    info(message, fields = new Map()) { return emit(scope, "info", message, merged(fields)); },
    warn(message, fields = new Map()) { return emit(scope, "warn", message, merged(fields)); },
    error(message, error = null, fields = new Map()) { return emit(scope, "error", message, merged(fields), error); },
  });
}

export const log = createLogger("");
export function logger(scope, fields = new Map()) {
  const name = logText(scope, "Logger scope", 1024).trim();
  if (!name) throw new TypeError("A Velar logger requires a non-empty scope");
  return createLogger(name, fields);
}
export function level() { return threshold; }
export function setLevel(value) {
  const next = logText(value, "Log level").toLowerCase();
  if (!ranks.has(next)) throw new TypeError("Log level must be debug, info, warn, error, or silent");
  threshold = next;
  return null;
}
export function useSink(sink) {
  if (typeof sink !== "function") throw new TypeError("A Velar log sink must be callable");
  if (!sinks.has(sink) && sinks.size >= maxLogSinks) throw new RangeError("Velar logging cannot install more than 1000 sinks");
  sinks.add(sink);
  return () => { sinks.delete(sink); return null; };
}
`.trimStart()],
  ["velar/app", String.raw`
const runtimeKey = Symbol.for("velar.runtime.v1");
const runtime = globalThis[runtimeKey] ??= {};
runtime.errorHandlers ??= new Set();
runtime.report ??= (value, options = {}) => {
  const error = value instanceof Error ? value : new Error(String(value), { cause: value });
  const report = Object.freeze({
    error,
    phase: String(options.phase || "runtime"),
    detail: String(options.detail || ""),
    component: String(options.component || ""),
    timestamp: Date.now(),
  });
  let handled = false;
  for (const handler of runtime.errorHandlers) {
    handled = true;
    try {
      const result = handler(report);
      if (result && typeof result.then === "function") result.catch((failure) => queueMicrotask(() => { throw failure; }));
    } catch (failure) { queueMicrotask(() => { throw failure; }); }
  }
  if (options.unhandled && !handled) queueMicrotask(() => { throw error; });
  return report;
};

export function onError(handler) {
  if (typeof handler !== "function") throw new TypeError("onError requires a callback");
  if (!runtime.errorHandlers.has(handler) && runtime.errorHandlers.size >= 1000) throw new RangeError("An application cannot install more than 1000 error handlers");
  runtime.errorHandlers.add(handler);
  return () => { runtime.errorHandlers.delete(handler); return null; };
}

export function reportError(error, phase = "manual", detail = "") {
  if (!(error instanceof Error)) throw new TypeError("reportError requires an Error");
  if (typeof phase !== "string" || typeof detail !== "string") throw new TypeError("reportError phase and detail must be strings");
  if (phase.length > 256 || detail.length > 65536) throw new RangeError("reportError phase/detail text is too long");
  runtime.report(error, { phase, detail, unhandled: false });
  return null;
}
`.trimStart()],
  ["velar/config", String.raw`
${runtimeTypeRuntime}
const source = "__VELAR_PUBLIC_CONFIG__";
function freeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) freeze(child);
  return Object.freeze(value);
}
const value = freeze(source);
export function publicConfig(Type) { Type = __velarRequireRuntimeType(Type, "publicConfig"); return Type.parse(value); }
export function has(key) { if (typeof key !== "string") throw new TypeError("Config keys must be strings"); return Object.prototype.hasOwnProperty.call(value, key); }
export function keys() { return Object.keys(value).sort(); }
`.trimStart()],
  ["velar/web", String.raw`
${listRuntime}
${optionsRuntime}
${runtimeTypeRuntime}
const appBase = "__VELAR_WEB_BASE__";

function isStringMap(value) {
  if (!(value instanceof Map) || Reflect.getOwnPropertyDescriptor(Map.prototype, "size").get.call(value) > 100000) return false;
  for (const [key, item] of Map.prototype.entries.call(value)) if (typeof key !== "string" || typeof item !== "string") return false;
  return true;
}

export const RouteContext = __velarRegisterRuntimeType(Object.freeze({
  is(value) {
    return Boolean(value && typeof value === "object"
      && typeof value.path === "string"
      && isStringMap(value.params)
      && isStringMap(value.query)
      && typeof value.hash === "string");
  },
  parse(value) {
    if (!this.is(value)) throw new TypeError("RouteContext requires path, string params/query Maps, and hash");
    return value;
  },
}));

function validateRoutePath(path) {
  if (typeof path !== "string" || !path.startsWith("/")) throw new TypeError("A Velar route path must start with '/'");
  if (path.length > 8192) throw new RangeError("A Velar route path cannot exceed 8192 code units");
  if (path.includes("?") || path.includes("#")) throw new TypeError("A Velar route path describes only a pathname");
  if (path.includes("\\")) throw new TypeError("A Velar route path cannot contain a backslash");
  if (path.length > 1 && path.endsWith("/")) throw new TypeError("A Velar route path cannot end with '/'");
  const names = new Set();
  const segments = path.split("/").slice(1);
  for (const [index, segment] of segments.entries()) {
    if (!segment && path !== "/") throw new TypeError("A Velar route path cannot contain an empty segment");
    if (segment === "*") {
      if (index !== segments.length - 1) throw new TypeError("A Velar route wildcard must be the final segment");
      if (names.has("wildcard")) throw new TypeError("A Velar route parameter named 'wildcard' conflicts with the '*' capture");
      names.add("wildcard");
      continue;
    }
    if (segment.includes("*")) throw new TypeError("A Velar route wildcard must occupy its whole final segment");
    if (!segment.startsWith(":")) continue;
    const name = segment.slice(1);
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/u.test(name)) throw new TypeError("A Velar route parameter requires a valid name");
    if (names.has(name)) throw new TypeError("A Velar route parameter cannot be repeated: " + name);
    names.add(name);
  }
  return path;
}

function compileRoutePath(path) {
  const names = [];
  const source = path.split("/").map((part) => {
    if (part === "*") { names.push("wildcard"); return "(.*)"; }
    if (part.startsWith(":")) { names.push(part.slice(1)); return "([^/]+)"; }
    return part.replace(/[.*+?^$(){}|[\]\\]/g, "\\$&");
  }).join("/");
  return Object.freeze({ names: Object.freeze(names), pattern: new RegExp("^" + source + "/?$") });
}

export function route(path, component) {
  path = validateRoutePath(path);
  if (typeof component !== "function") throw new TypeError("A Velar route component must be callable");
  return Object.freeze({ path, component });
}

export function lazy(loader, exportName, loading = null, failed = null) {
  if (typeof loader !== "function") throw new TypeError("Velar lazy requires a module loader");
  if (typeof exportName !== "string" || !exportName) throw new TypeError("Velar lazy requires an exported component name");
  if (exportName.length > 4096) throw new RangeError("Velar lazy export names cannot exceed 4096 characters");
  if (loading != null && typeof loading !== "function") throw new TypeError("Velar lazy loading fallback must be a component");
  if (failed != null && typeof failed !== "function") throw new TypeError("Velar lazy failure fallback must be a component");

  let resolved = null;
  let pending = null;
  const load = () => {
    if (resolved) return Promise.resolve(resolved);
    if (!pending) {
      pending = Promise.resolve().then(loader).then((module) => {
        const target = module && module[exportName];
        if (typeof target !== "function") throw new TypeError("Dynamically loaded module has no component export '" + exportName + "'");
        resolved = target;
        return target;
      }).catch((error) => {
        pending = null;
        throw error;
      });
    }
    return pending;
  };

  return function VelarLazy(props = {}, namespace = "html") {
    const svg = namespace === "svg";
    const host = svg
      ? document.createElementNS("http://www.w3.org/2000/svg", "g")
      : document.createElement("velar-lazy");
    if (!svg) host.style.display = "contents";
    let active = loading ? loading({}, namespace) : null;
    if (active != null && !active.__velarComponent) throw new TypeError("Velar lazy loading fallback must render a component");
    let mounted = false;
    let destroyed = false;
    if (active && active.__velarComponent) host.append(active.node);
    else host.append(document.createComment("lazy component loading"));

    const replace = (next) => {
      if (!next || !next.__velarComponent) throw new TypeError("Velar lazy fallbacks must render components");
      if (destroyed) { next.destroy(); return; }
      if (active && active.__velarComponent) active.destroy(false);
      active = next;
      host.replaceChildren(next.node);
      if (mounted) next.__mount();
    };

    const fail = (value) => {
      const error = value instanceof Error ? value : new Error(String(value), { cause: value });
      const runtime = globalThis[Symbol.for("velar.runtime.v1")];
      runtime?.report?.(error, { phase: "resource", detail: "lazy:" + exportName, component: exportName, unhandled: false });
      try {
        if (failed) replace(failed({ error }, namespace));
        else {
          const message = svg
            ? document.createElementNS("http://www.w3.org/2000/svg", "text")
            : document.createElement("div");
          message.setAttribute("role", "alert");
          message.textContent = "Unable to load " + exportName;
          replace(component(message));
        }
      } catch (fallbackFailure) {
        const fallbackError = fallbackFailure instanceof Error ? fallbackFailure : new Error(String(fallbackFailure), { cause: fallbackFailure });
        runtime?.report?.(fallbackError, { phase: "render", detail: "lazy-fallback:" + exportName, component: exportName, unhandled: false });
        if (active && active.__velarComponent) active.destroy(false);
        active = null;
        if (!destroyed) {
          const message = svg
            ? document.createElementNS("http://www.w3.org/2000/svg", "text")
            : document.createElement("div");
          message.setAttribute("role", "alert");
          message.textContent = "Unable to render " + exportName;
          host.replaceChildren(message);
        }
      }
    };

    void load().then((target) => replace(target(props, namespace))).catch(fail);

    return component(host, () => {
      mounted = true;
      if (active && active.__velarComponent) active.__mount();
    }, () => {
      destroyed = true;
      if (active && active.__velarComponent) active.destroy(false);
    });
  };
}

export function navigate(to, options = {}) {
  options = __velarOptions(options, "Navigation options", new Set(["replace", "scroll"]));
  const replace = options.replace ?? false;
  const scroll = options.scroll ?? true;
  __velarBool(replace, "Navigation replace");
  __velarBool(scroll, "Navigation scroll");
  const href = internalHref(to);
  if (replace) history.replaceState(null, "", href);
  else history.pushState(null, "", href);
  dispatchEvent(new PopStateEvent("popstate"));
  if (scroll) requestAnimationFrame(() => globalThis.scrollTo({ top: 0, left: 0 }));
  return null;
}

export function redirect(to) {
  return navigate(to, { replace: true });
}

export function back() {
  history.back();
  return null;
}

export function forward() {
  history.forward();
  return null;
}

export function reload() {
  location.reload();
  return null;
}

export function currentRoute() {
  const path = applicationPath(location.pathname) ?? "/";
  return Object.freeze({ path, params: new Map(), query: queryValues(), hash: routeHash() });
}

export function Head(props) {
  props = __velarOptions(props, "Head props", new Set(["title", "description", "canonical", "robots", "image", "themeColor"]));
  let { title, description = "", canonical = "", robots = "", image = "", themeColor = "" } = props;
  title = __velarString(title, "Head title");
  description = __velarString(description, "Head description");
  canonical = __velarString(canonical, "Head canonical URL");
  robots = __velarString(robots, "Head robots");
  image = __velarString(image, "Head image");
  themeColor = __velarString(themeColor, "Head theme color");
  if (title.length > 4096) throw new RangeError("Head titles cannot exceed 4096 characters");
  if (description.length > 65536) throw new RangeError("Head descriptions cannot exceed 64 KiB");
  if (canonical.length > 2 * 1024 * 1024 || image.length > 2 * 1024 * 1024) throw new RangeError("Head URLs cannot exceed 2 MiB");
  if (robots.length > 4096) throw new RangeError("Head robots cannot exceed 4096 characters");
  if (themeColor.length > 256) throw new RangeError("Head theme colors cannot exceed 256 characters");
  const node = document.createComment("velar head");
  let previousTitle = "";
  let restorers = [];
  return component(node, () => {
    previousTitle = document.title;
    document.title = title;
    restorers = [
      ownHead('meta[name="description"]', "meta", "name", "description", "content", description),
      ownHead('link[rel="canonical"]', "link", "rel", "canonical", "href", canonical),
      ownHead('meta[name="robots"]', "meta", "name", "robots", "content", robots),
      ownHead('meta[property="og:image"]', "meta", "property", "og:image", "content", image),
      ownHead('meta[name="theme-color"]', "meta", "name", "theme-color", "content", themeColor),
    ];
  }, () => {
    if (document.title === title) document.title = previousTitle;
    for (const restore of restorers.reverse()) restore();
  });
}

function ownHead(selector, tag, identityName, identityValue, valueName, value) {
  if (!value) return () => {};
  let element = document.head.querySelector(selector);
  const created = !element;
  if (!element) {
    element = document.createElement(tag);
    element.setAttribute(identityName, identityValue);
    document.head.append(element);
  }
  const previous = element.getAttribute(valueName);
  element.setAttribute(valueName, value);
  return () => {
    if (element.getAttribute(valueName) !== value) return;
    if (created) element.remove();
    else if (previous == null) element.removeAttribute(valueName);
    else element.setAttribute(valueName, previous);
  };
}

export function announce(message, priority = "polite") {
  message = __velarString(message, "Announcement message");
  if (message.length > 65536) throw new RangeError("Announcement messages cannot exceed 64 KiB");
  if (priority !== "polite" && priority !== "assertive") throw new TypeError("Announcement priority must be 'polite' or 'assertive'");
  let region = document.querySelector('[data-velar-announcer="' + priority + '"]');
  if (!region) {
    region = document.createElement("div");
    region.setAttribute("data-velar-announcer", priority);
    region.setAttribute("role", priority === "assertive" ? "alert" : "status");
    region.setAttribute("aria-live", priority);
    region.setAttribute("aria-atomic", "true");
    region.style.cssText = "position:fixed;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0";
    document.body.append(region);
  }
  region.textContent = "";
  requestAnimationFrame(() => { region.textContent = message; });
  return null;
}

export function Router(props) {
  props = __velarOptions(props, "Router props", new Set(["routes", "fallback"]));
  let { routes, fallback = null } = props;
  const routeItems = __velarRequireList(routes, "Router routes");
  if (routeItems.length > 10000) throw new RangeError("A Router cannot contain more than 10000 routes");
  routes = routeItems.map((item) => {
    item = __velarOptions(item, "Router route", new Set(["path", "component"]));
    validateRoutePath(item.path);
    if (typeof item.component !== "function") throw new TypeError("A Router route component must be callable");
    return Object.freeze({ path: item.path, component: item.component, matcher: compileRoutePath(item.path) });
  });
  if (fallback != null && typeof fallback !== "function") throw new TypeError("A Router fallback must be a component");
  const node = document.createElement("velar-router");
  let active = null;
  let mounted = false;
  const notFound = ({ route }) => {
    const page = document.createElement("main");
    page.setAttribute("data-velar-not-found", "");
    const title = document.createElement("h1");
    title.textContent = "Page not found";
    const detail = document.createElement("p");
    detail.textContent = "No route matches " + route.path;
    page.append(title, detail);
    return component(page);
  };
  const render = () => {
    try {
      const path = applicationPath(location.pathname);
      const match = path === null ? null : matchRoute(routes, path);
      const context = match?.context ?? { path: path ?? "/", params: new Map(), query: queryValues(), hash: routeHash() };
      const next = match ? match.item.component({ route: context }) : (fallback ?? notFound)({ route: context });
      if (!next || !next.__velarComponent) throw new TypeError("A Velar Router target must render a component");
      if (active) active.destroy();
      active = next;
      node.replaceChildren(active.node);
      if (mounted) active.__mount();
    } catch (value) {
      const error = value instanceof Error ? value : new Error(String(value), { cause: value });
      if (!mounted) throw error;
      const runtime = globalThis[Symbol.for("velar.runtime.v1")];
      if (runtime && typeof runtime.report === "function") {
        runtime.report(error, { phase: "render", detail: "router", component: "Router", unhandled: true });
      } else {
        queueMicrotask(() => { throw error; });
      }
    }
  };
  const changed = () => render();
  render();
  return component(node, () => {
    mounted = true;
    addEventListener("popstate", changed);
    if (active) active.__mount();
  }, () => {
    removeEventListener("popstate", changed);
    if (active) active.destroy(false);
  });
}

export function Link(props) {
  props = __velarOptions(props, "Link props", new Set(["to", "replace", "children"]));
  let { to, replace = false, children } = props;
  to = __velarString(to, "Link target");
  if (to.length > 2 * 1024 * 1024) throw new RangeError("Link targets cannot exceed 2 MiB");
  __velarBool(replace, "Link replace");
  const external = isExternal(to);
  const href = external ? to : internalHref(to);
  const node = document.createElement("a");
  node.href = href;
  append(node, children);
  const clicked = (event) => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    if (external) return;
    if (new URL(node.href, location.href).origin !== location.origin) return;
    event.preventDefault();
    navigate(to, { replace });
  };
  return component(node, () => node.addEventListener("click", clicked), () => node.removeEventListener("click", clicked));
}

export function NavLink(props) {
  props = __velarOptions(props, "NavLink props", new Set(["to", "exact", "replace", "children"]));
  let { to, exact = false, replace = false, children } = props;
  to = __velarString(to, "NavLink target");
  __velarBool(exact, "NavLink exact");
  __velarBool(replace, "NavLink replace");
  internalHref(to);
  const linked = Link({ to, replace, children });
  const target = normalizeApplicationPath(new URL(to, "https://velar.invalid").pathname);
  const update = () => {
    const application = applicationPath(location.pathname);
    const current = application === null ? null : normalizeApplicationPath(application);
    const active = current !== null && (current === target || (!exact && target !== "/" && current.startsWith(target + "/")));
    if (active) linked.node.setAttribute("aria-current", "page");
    else linked.node.removeAttribute("aria-current");
  };
  update();
  return component(linked.node, () => {
    linked.__mount();
    addEventListener("popstate", update);
  }, () => {
    removeEventListener("popstate", update);
    linked.destroy(false);
  });
}

function normalizeApplicationPath(path) {
  return path.length > 1 ? path.replace(/\/+$/u, "") : "/";
}

function matchRoute(routes, pathname) {
  for (const item of routes) {
    const result = item.matcher.pattern.exec(pathname);
    if (!result) continue;
    const params = new Map();
    let decodable = true;
    for (const [index, name] of item.matcher.names.entries()) {
      try { params.set(name, decodeURIComponent(result[index + 1] || "")); }
      catch { decodable = false; break; }
    }
    if (!decodable) continue;
    return { item, context: { path: pathname, params, query: queryValues(), hash: routeHash() } };
  }
  return null;
}

function applicationPath(pathname) {
  if (typeof pathname !== "string" || pathname.length > 2 * 1024 * 1024) throw new RangeError("Application paths cannot exceed 2 MiB");
  if (appBase === "/") return pathname;
  const prefix = appBase.slice(0, -1);
  if (pathname === prefix) return "/";
  return pathname.startsWith(appBase) ? "/" + pathname.slice(appBase.length) : null;
}

function internalHref(to) {
  if (typeof to !== "string" || !to.startsWith("/") || isExternal(to)) throw new TypeError("Velar navigation targets must be application paths starting with '/'");
  if (to.length > 2 * 1024 * 1024) throw new RangeError("Velar navigation targets cannot exceed 2 MiB");
  const parsed = new URL(to, "https://velar.invalid");
  return appBase + parsed.pathname.slice(1) + parsed.search + parsed.hash;
}

function isExternal(to) {
  return typeof to === "string" && (/^[a-z][a-z\d+.-]*:/i.test(to) || to.startsWith("//"));
}

function queryValues() {
  const search = String(location.search || "");
  if (search.length > 2 * 1024 * 1024) throw new RangeError("Route queries cannot exceed 2 MiB");
  const output = new Map();
  let count = 0;
  for (const [name, value] of new URLSearchParams(search)) {
    count += 1;
    if (count > 100000) throw new RangeError("Route queries cannot exceed 100000 fields");
    output.set(name, value);
  }
  return output;
}

function routeHash() {
  const hash = String(location.hash || "");
  if (hash.length > 2 * 1024 * 1024) throw new RangeError("Route hashes cannot exceed 2 MiB");
  return hash;
}

function component(node, mounted, cleanup) {
  let destroyed = false;
  let ready = false;
  return {
    __velarComponent: true,
    node,
    mount(target, before = null) {
      const parent = typeof target === "string" ? document.querySelector(target) : target;
      if (!parent) throw new Error("Velar mount target was not found");
      parent.insertBefore(node, before);
      this.__mount();
      return null;
    },
    __mount() { if (!destroyed && !ready) { ready = true; if (mounted) mounted(); } },
    destroy(remove = true) { if (!destroyed) { destroyed = true; if (cleanup) cleanup(); if (remove) node.remove(); } return null; },
  };
}

function append(parent, value) {
  if (value == null || value === false || value === true) return;
  if (Array.isArray(value)) { for (const item of __velarRequireList(value, "JSX children")) append(parent, item); return; }
  parent.append(value instanceof Node ? value : document.createTextNode(String(value)));
}
`.trimStart()],
  ["velar/forms", String.raw`
${listRuntime}
${optionsRuntime}
${runtimeTypeRuntime}
let nextErrorId = 1;
const pendingFields = new WeakMap();
const maxFormFields = 100000;
const maxFormTextCodeUnits = 16 * 1024 * 1024;
function formText(value, name, maximum = 1024) { value = __velarString(value, name); if (value.length > maximum) throw new RangeError(name + " is too long"); return value; }
function formValue(value, name) {
  if (typeof value === "string" && value.length > maxFormTextCodeUnits) throw new RangeError(name + " cannot exceed 16 MiB");
  return value;
}
function formList(values, name) {
  if (values.length > maxFormFields) throw new RangeError(name + " cannot exceed 100000 values");
  return values;
}
function formElements(form) {
  if (form.elements.length > maxFormFields) throw new RangeError("Forms cannot exceed 100000 controls");
  return form.elements;
}
function formErrorNodes(form) {
  const nodes = form.querySelectorAll("[data-velar-field-error]");
  if (nodes.length > maxFormFields) throw new RangeError("Forms cannot exceed 100000 field errors");
  return nodes;
}
function formType(value) { return __velarRequireRuntimeType(value, "Form reading"); }
function decoderField(value) {
  value = __velarOptions(value, "Form decoder field", new Set(["name", "kind", "optional", "enumValues"]));
  const name = formText(value.name, "Form decoder field name");
  const kind = formText(value.kind, "Form decoder field kind", 64);
  if (!["string", "number", "bool", "enum", "strings"].includes(kind)) throw new TypeError("Form decoder field '" + name + "' uses an unsupported decoder");
  if (typeof value.optional !== "boolean") throw new TypeError("Form decoder optional must be bool");
  let enumValues = null;
  if (kind === "enum") {
    enumValues = __velarRequireList(value.enumValues, "Form enum values");
    if (enumValues.length > maxFormFields) throw new RangeError("Form enum values cannot exceed 100000 entries");
    if (!enumValues.every((item) => typeof item === "string")) throw new TypeError("Form enum values must be strings");
  } else if (value.enumValues != null) {
    throw new TypeError("Only enum form decoders can declare enum values");
  }
  return Object.freeze({ name, kind, optional: value.optional, enumValues });
}

export function values(form) {
  requireForm(form);
  const output = new Map();
  let count = 0;
  for (const [name, value] of new FormData(form)) {
    count += 1;
    if (count > maxFormFields) throw new RangeError("Forms cannot exceed 100000 submitted fields");
    const checkedName = formText(name, "Submitted form field name");
    formValue(value, "Form field '" + checkedName + "'");
    if (!output.has(checkedName)) output.set(checkedName, value);
    else {
      const current = output.get(checkedName);
      if (Array.isArray(current)) current.push(value);
      else output.set(checkedName, [current, value]);
    }
  }
  return output;
}

export function read(form, type, fields) {
  requireForm(form);
  type = formType(type);
  const decoderItems = __velarRequireList(fields, "Form decoder fields");
  if (decoderItems.length > maxFormFields) throw new RangeError("Form decoders cannot exceed 100000 fields");
  fields = decoderItems.map(decoderField);
  const data = new FormData(form);
  const output = Object.create(null);
  for (const field of fields) {
    const name = field.name;
    const value = formValue(data.get(name), "Form field '" + name + "'");
    if (field.kind === "string") {
      if (value == null) output[name] = field.optional ? null : "";
      else if (typeof value === "string") output[name] = value;
      else throw new TypeError("Form field '" + name + "' is not textual");
    } else if (field.kind === "number") {
      if (value == null || (typeof value === "string" && value.trim() === "")) {
        if (field.optional) output[name] = null;
        else throw new TypeError("Form field '" + name + "' requires a finite number");
      } else if (typeof value === "string" && Number.isFinite(Number(value))) {
        output[name] = Number(value);
      } else {
        throw new TypeError("Form field '" + name + "' requires a finite number");
      }
    } else if (field.kind === "bool") {
      output[name] = data.has(name);
    } else if (field.kind === "enum") {
      if (value == null || value === "") {
        if (field.optional) output[name] = null;
        else throw new TypeError("Form field '" + name + "' requires a known enum value");
      } else if (typeof value === "string") {
        if (!field.enumValues.includes(value)) throw new TypeError("Form field '" + name + "' requires a known enum value");
        output[name] = value;
      } else {
        throw new TypeError("Form field '" + name + "' requires a known enum value");
      }
    } else if (field.kind === "strings") {
      output[name] = formList(data.getAll(name), "Form field '" + name + "'").map((item) => {
        formValue(item, "Form field '" + name + "'");
        if (typeof item !== "string") throw new TypeError("Form field '" + name + "' is not textual");
        return item;
      });
    } else {
      throw new TypeError("Form field '" + name + "' uses an unsupported decoder");
    }
  }
  return type.parse(output);
}

export function fieldValue(form, name) {
  return firstValue(form, name);
}

export function textValue(form, name, fallback = "") {
  name = formText(name, "Form field name");
  fallback = formText(fallback, "Form text fallback", maxFormTextCodeUnits);
  const value = firstValue(form, name);
  if (value == null) return fallback;
  if (typeof value !== "string") throw new TypeError("Form field '" + name + "' is not textual");
  return value;
}

export function numberValue(form, name) {
  const value = textValue(form, name).trim();
  if (!value) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function checkedValue(form, name) {
  requireForm(form);
  name = formText(name, "Form field name");
  return new FormData(form).has(name);
}

export function fieldValues(form, name) {
  requireForm(form);
  name = formText(name, "Form field name");
  return formList(new FormData(form).getAll(name), "Form field '" + name + "'").map((value) => {
    formValue(value, "Form field '" + name + "'");
    if (typeof value !== "string") throw new TypeError("Form field '" + name + "' is not textual");
    return value;
  });
}

export function setError(form, name, message) {
  requireForm(form);
  name = formText(name, "Form field name");
  message = formText(message, "Form error message", 65536);
  const field = namedField(form, name);
  if (!field) throw new Error("Form field '" + name + "' was not found");
  let error = Array.from(formErrorNodes(form)).find((item) => item.getAttribute("data-velar-field-error") === name);
  if (!error) {
    error = document.createElement("p");
    error.id = "velar-field-error-" + nextErrorId++;
    error.setAttribute("data-velar-field-error", name);
    error.setAttribute("role", "alert");
    field.insertAdjacentElement("afterend", error);
  }
  error.textContent = message;
  field.setAttribute("aria-invalid", "true");
  const describedText = formText(field.getAttribute("aria-describedby") || "", "Form aria-describedby", 65536);
  const described = new Set(describedText.split(/\s+/u).filter(Boolean));
  described.add(error.id);
  field.setAttribute("aria-describedby", [...described].join(" "));
  return null;
}

export function clearError(form, name) {
  requireForm(form);
  name = formText(name, "Form field name");
  const field = namedField(form, name);
  const error = Array.from(formErrorNodes(form)).find((item) => item.getAttribute("data-velar-field-error") === name);
  if (error) error.remove();
  if (field) {
    field.removeAttribute("aria-invalid");
    const describedText = formText(field.getAttribute("aria-describedby") || "", "Form aria-describedby", 65536);
    const described = describedText.split(/\s+/u).filter((id) => id && id !== error?.id);
    if (described.length) field.setAttribute("aria-describedby", described.join(" "));
    else field.removeAttribute("aria-describedby");
  }
  return null;
}

export function clearErrors(form) {
  requireForm(form);
  for (const name of [...errors(form).keys()]) clearError(form, name);
  return null;
}

export function errors(form) {
  requireForm(form);
  const nodes = formErrorNodes(form);
  const output = new Map();
  for (const item of nodes) {
    const name = formText(item.getAttribute("data-velar-field-error") || "", "Form error field name");
    const message = formText(item.textContent || "", "Form error message", 65536);
    if (name) output.set(name, message);
  }
  return output;
}

export function focusFirstError(form) {
  requireForm(form);
  const error = form.querySelector("[data-velar-field-error]");
  const field = error ? namedField(form, formText(error.getAttribute("data-velar-field-error") || "", "Form error field name")) : null;
  if (!field) return false;
  field.focus();
  return true;
}

export function setPending(form, pending) {
  requireForm(form);
  if (typeof pending !== "boolean") throw new TypeError("setPending requires a boolean");
  if (pending) {
    const elements = formElements(form);
    if (!pendingFields.has(form)) pendingFields.set(form, Array.from(elements).map((field) => [field, Boolean(field.disabled)]));
    form.setAttribute("aria-busy", "true");
    for (const field of elements) field.disabled = true;
  } else {
    form.removeAttribute("aria-busy");
    for (const [field, disabled] of pendingFields.get(form) || []) field.disabled = disabled;
    pendingFields.delete(form);
  }
  return null;
}

export function reset(form) {
  requireForm(form);
  if (pendingFields.has(form)) setPending(form, false);
  clearErrors(form);
  form.reset();
  return null;
}

function namedField(form, name) {
  for (const item of formElements(form)) if (item.name === name) return item;
  return null;
}

function firstValue(form, name) {
  requireForm(form);
  name = formText(name, "Form field name");
  return formValue(new FormData(form).get(name), "Form field '" + name + "'");
}

function requireForm(value) {
  if (!(value instanceof HTMLFormElement)) throw new TypeError("Velar form helpers require a form element");
}
`.trimStart()],
  ["velar/http", String.raw`
${listRuntime}
${optionsRuntime}
${strictJsonRuntime}
${runtimeTypeRuntime}
const nativeFilesKey = Symbol.for("velar.file.registry.v1");
const nativeFiles = globalThis[nativeFilesKey] ??= new WeakMap();
const formBodies = new WeakMap();

function runtimeHttpType(Type) { return __velarRequireRuntimeType(Type, "HTTP parsing"); }

function methodOf(value) {
  const method = __velarString(value, "HTTP method").toUpperCase();
  if (method.length > 32) throw new RangeError("HTTP methods cannot exceed 32 characters");
  if (!/^[!#$%&'*+.^_\x60|~0-9A-Z-]+$/u.test(method) || ["CONNECT", "TRACE", "TRACK"].includes(method)) throw new TypeError("HTTP method is invalid or forbidden by Fetch");
  return method;
}

function headersOf(value) {
  if (value == null) return new Map();
  if (!(value instanceof Map)) throw new TypeError("HTTP headers must be Map<string, string>");
  const headers = new Map();
  let units = 0;
  for (const [name, item] of Map.prototype.entries.call(value)) {
    if (typeof name !== "string" || typeof item !== "string") throw new TypeError("HTTP header names and values must be strings");
    units += name.length + item.length;
    if (headers.size >= 100 || units > 65536) throw new RangeError("HTTP headers cannot exceed 100 fields or 64 KiB");
    headers.set(name, item);
  }
  return headers;
}

function responseHeadersOf(value) {
  if (typeof Headers === "undefined" || !(value instanceof Headers)) throw new TypeError("HTTP responses require native Headers");
  const headers = new Map();
  let units = 0;
  for (const [name, item] of Headers.prototype.entries.call(value)) {
    if (typeof name !== "string" || typeof item !== "string") throw new TypeError("HTTP response header names and values must be strings");
    units += name.length + item.length;
    if ((!headers.has(name) && headers.size >= 100) || units > 65536) throw new RangeError("HTTP response headers cannot exceed 100 fields or 64 KiB");
    headers.set(name, item);
  }
  return headers;
}

function optionsOf(value) {
  value = __velarOptions(value, "HTTP options", new Set(["headers", "body", "timeout", "maxBytes", "credentials", "cache"]));
  const timeout = value.timeout ?? 0;
  if (!Number.isFinite(timeout) || timeout < 0 || timeout > 2147483647) throw new RangeError("HTTP timeout must be milliseconds from 0 through 2147483647");
  const maxBytes = value.maxBytes ?? 16 * 1024 * 1024;
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > 64 * 1024 * 1024) throw new RangeError("HTTP maxBytes must be an integer from 1 through 67108864");
  const credentials = value.credentials == null ? undefined : __velarString(value.credentials, "HTTP credentials");
  if (credentials !== undefined && !["omit", "same-origin", "include"].includes(credentials)) throw new TypeError("HTTP credentials must be omit, same-origin, or include");
  const cache = value.cache == null ? undefined : __velarString(value.cache, "HTTP cache mode");
  if (cache !== undefined && !["default", "no-store", "reload", "no-cache", "force-cache"].includes(cache)) throw new TypeError("HTTP cache mode must be default, no-store, reload, no-cache, or force-cache");
  const body = value.body ?? null;
  const multipart = body && typeof body === "object" ? formBodies.get(body) : null;
  const nativeForm = typeof FormData !== "undefined" && body instanceof FormData;
  const nativeBlob = typeof Blob !== "undefined" && body instanceof Blob;
  if (body != null && typeof body !== "string" && !multipart && !nativeForm && !nativeBlob) {
    if (typeof body !== "object") throw new TypeError("HTTP body must be text, JSON data, a Blob, or a Velar form body");
    __velarAssertJson(body);
  }
  if (typeof body === "string" && body.length > 16 * 1024 * 1024) throw new RangeError("HTTP text bodies cannot exceed 16 MiB");
  return Object.freeze({ headers: headersOf(value.headers), body, timeout, maxBytes, credentials, cache });
}

function fieldName(value) {
  const name = __velarString(value, "Form body field name");
  if (!name) throw new TypeError("Form body field names cannot be empty");
  if (name.length > 1024) throw new RangeError("Form body field names cannot exceed 1024 characters");
  return name;
}

function nativeFile(value) {
  const file = value && nativeFiles.get(value);
  if (!(file instanceof File)) throw new TypeError("Form body files must come from velar/files pick()");
  return file;
}

export function formBody() {
  const data = new FormData();
  let fieldCount = 0;
  const reserve = (count = 1) => { if (fieldCount + count > 100000) throw new RangeError("Form bodies cannot exceed 100000 fields"); fieldCount += count; };
  const fieldValue = (value) => { value = __velarString(value, "Form body field value"); if (value.length > 16 * 1024 * 1024) throw new RangeError("Form body field values cannot exceed 16 MiB"); return value; };
  const body = {
    field(name, value) { name = fieldName(name); value = fieldValue(value); reserve(); data.append(name, value); return null; },
    file(name, value, fileName = "") {
      const file = nativeFile(value);
      fileName = __velarString(fileName, "Form body file name");
      if (fileName.length > 4096) throw new RangeError("Form body file names cannot exceed 4096 characters");
      name = fieldName(name);
      reserve();
      if (fileName) data.append(name, file, fileName);
      else data.append(name, file);
      return null;
    },
    files(name, values) {
      name = fieldName(name);
      const files = __velarRequireList(values, "Form body files").map(nativeFile);
      reserve(files.length);
      for (const file of files) data.append(name, file);
      return null;
    },
    remove(name) { name = fieldName(name); fieldCount -= data.getAll(name).length; data.delete(name); return null; },
    has(name) { return data.has(fieldName(name)); },
    names() { return [...new Set(data.keys())]; },
  };
  formBodies.set(body, data);
  return Object.freeze(body);
}

export class HttpError extends Error {
  constructor(message, status, url, body = null) {
    message = __velarString(message, "HTTP error message");
    url = __velarString(url, "HTTP error URL");
    if (!Number.isInteger(status) || status < 100 || status > 599) throw new RangeError("HTTP error status must be an integer from 100 through 599");
    super(message);
    this.name = "HttpError";
    this.status = status;
    this.url = url;
    this.body = body;
  }
}

export class HttpAbortError extends Error {
  constructor(reason) {
    if (reason !== "cancelled" && reason !== "timeout") throw new TypeError("HTTP abort reason must be cancelled or timeout");
    super(reason === "timeout" ? "HTTP request timed out" : "HTTP request cancelled");
    this.name = "HttpAbortError";
    this.reason = reason;
  }
}

class HttpResponse {
  constructor(response, maxBytes) {
    if (typeof response.ok !== "boolean" || !Number.isInteger(response.status) || (response.status !== 0 && (response.status < 100 || response.status > 599))) {
      throw new TypeError("Fetch returned invalid HTTP response metadata");
    }
    const statusText = __velarString(response.statusText, "HTTP response status text");
    const url = __velarString(response.url, "HTTP response URL");
    if (statusText.length > 65536) throw new RangeError("HTTP response status text cannot exceed 64 KiB");
    if (url.length > 2 * 1024 * 1024) throw new RangeError("HTTP response URLs cannot exceed 2 MiB");
    this.native = response;
    this.maxBytes = maxBytes;
    this.bytesValue = null;
    this.bytesPending = null;
    this.ok = response.ok;
    this.status = response.status;
    this.statusText = statusText;
    this.url = url;
    this.headers = responseHeadersOf(response.headers);
  }
  async bytes() {
    if (this.bytesValue) return this.bytesValue;
    if (this.bytesPending) return this.bytesPending;
    const declared = this.native.headers.get("content-length");
    if (declared && /^\d+$/u.test(declared) && Number(declared) > this.maxBytes) {
      await this.native.body?.cancel("Velar HTTP response exceeded maxBytes");
      throw new RangeError("HTTP response exceeds maxBytes");
    }
    this.bytesPending = (async () => {
      const reader = this.native.body?.getReader();
      if (!reader) return new Uint8Array();
      const chunks = [];
      let total = 0;
      while (true) {
        const next = await reader.read();
        if (next.done) break;
        total += next.value.byteLength;
        if (total > this.maxBytes) {
          await reader.cancel("Velar HTTP response exceeded maxBytes");
          throw new RangeError("HTTP response exceeds maxBytes");
        }
        chunks.push(next.value);
      }
      const output = new Uint8Array(total);
      let offset = 0;
      for (const chunk of chunks) { output.set(chunk, offset); offset += chunk.byteLength; }
      return output;
    })();
    try { this.bytesValue = await this.bytesPending; return this.bytesValue; }
    finally { this.bytesPending = null; }
  }
  async json() { const text = await this.text(); if (text.length > __velarMaxJsonCodeUnits) throw new RangeError("JSON text cannot exceed 16 MiB"); const value = JSON.parse(text); __velarAssertJson(value); return value; }
  async text() { return new TextDecoder().decode(await this.bytes()); }
  async blob() { return new Blob([await this.bytes()], { type: this.native.headers.get("content-type") ?? "" }); }
  async parse(Type) { Type = runtimeHttpType(Type); return Type.parse(await this.json()); }
}

class Request {
  constructor(method, url, options) {
    this.method = methodOf(method);
    this.url = __velarString(url, "HTTP URL");
    if (this.url.length > 2 * 1024 * 1024) throw new RangeError("HTTP URLs cannot exceed 2 MiB");
    this.options = optionsOf(options);
    if ((this.method === "GET" || this.method === "HEAD") && this.options.body != null) throw new TypeError(this.method + " requests cannot have a body");
    this.controller = null;
    this.pending = null;
    this.abortError = null;
    this.finished = false;
  }
  async response() {
    if (this.pending) return this.pending;
    if (this.abortError) throw this.abortError;
    this.controller = new AbortController();
    this.pending = this.perform(this.controller);
    return this.pending;
  }
  abort(reason) {
    if (this.finished || this.abortError) return;
    this.abortError = new HttpAbortError(reason);
    if (this.controller) this.controller.abort(this.abortError);
  }
  async perform(controller) {
    const timeoutMs = this.options.timeout ?? 0;
    let timer = null;
    try {
      timer = timeoutMs ? setTimeout(() => this.abort("timeout"), timeoutMs) : null;
      const headers = new Headers([...this.options.headers]);
      let body = this.options.body;
      const multipart = body != null && typeof body === "object" ? formBodies.get(body) : null;
      if (multipart instanceof FormData) {
        if (headers.has("content-type")) throw new TypeError("Do not set content-type for a Velar form body; the browser owns its multipart boundary");
        body = multipart;
      } else if (body != null && typeof body === "object" && !(body instanceof FormData) && !(body instanceof Blob)) {
        if (!headers.has("content-type")) headers.set("content-type", "application/json");
        body = __velarJsonStringify(body);
      }
      const response = await fetch(this.url, {
        method: this.method,
        headers,
        body,
        credentials: this.options.credentials,
        cache: this.options.cache,
        signal: controller.signal,
      });
      if (this.abortError) throw this.abortError;
      const wrapped = new HttpResponse(response, this.options.maxBytes);
      if (!response.ok) {
        const text = await wrapped.text();
        let parsed = text;
        try { if (text.length > __velarMaxJsonCodeUnits) throw new RangeError("Error body is too large for JSON"); parsed = text ? JSON.parse(text) : null; __velarAssertJson(parsed); } catch { parsed = text; }
        throw new HttpError("HTTP " + response.status + " for " + this.url, response.status, this.url, parsed);
      }
      return wrapped;
    } catch (error) {
      if (this.abortError) throw this.abortError;
      throw error;
    } finally {
      if (timer) clearTimeout(timer);
      this.finished = true;
    }
  }
  async json() { return (await this.response()).json(); }
  async text() { return (await this.response()).text(); }
  async blob() { return (await this.response()).blob(); }
  async parse(Type) { Type = runtimeHttpType(Type); return Type.parse(await this.json()); }
  cancel() { this.abort("cancelled"); return null; }
}

const createRequest = (method) => (url, options = {}) => new Request(method, url, options);
export const http = Object.freeze({
  request(method, url, options = {}) { return new Request(method, url, options); },
  get: createRequest("GET"), post: createRequest("POST"), put: createRequest("PUT"), patch: createRequest("PATCH"), delete: createRequest("DELETE"), head: createRequest("HEAD"),
});
`.trimStart()],
  ["velar/storage", String.raw`
${ownedCallbackRuntime}
${strictJsonRuntime}
${runtimeTypeRuntime}
const changeEvent = "velar-storage-change";

function storageType(Type) { return __velarRequireRuntimeType(Type, "Storage reads"); }
function storageText(value, name) { if (typeof value !== "string") throw new TypeError(name + " must be a string"); if (value.length > 4096) throw new RangeError(name + " cannot exceed 4096 characters"); return value; }
function parsed(raw, Type, fallback) {
  Type = storageType(Type);
  if (raw == null) return fallback;
  try { if (typeof raw !== "string" || raw.length > __velarMaxJsonCodeUnits) return fallback; const value = JSON.parse(raw); __velarAssertJson(value); return Type.parse(value); } catch { return fallback; }
}

function createStore(storageName, prefix = "", areaName = "local") {
  const area = () => {
    const value = globalThis[storageName];
    if (!value) throw new Error("velar/storage requires a browser storage environment");
    return value;
  };
  const full = (key) => prefix + storageText(key, "Storage key");
  const emit = (key, oldValue, newValue) => dispatchEvent(new CustomEvent(changeEvent, { detail: { areaName, key, oldValue, newValue } }));
  const api = {
    get(key, Type, fallback = null) {
      Type = storageType(Type);
      const name = full(key);
      return parsed(area().getItem(name), Type, fallback);
    },
    set(key, value) {
      const name = full(key);
      const next = __velarJsonStringify(value);
      const target = area();
      const previous = target.getItem(name);
      target.setItem(name, next);
      emit(name, previous, next);
      return null;
    },
    has(key) { const name = full(key); return area().getItem(name) != null; },
    keys() {
      const target = area();
      if (!Number.isSafeInteger(target.length) || target.length < 0 || target.length > 100000) throw new RangeError("Browser storage cannot exceed 100000 keys");
      return Array.from({ length: target.length }, (_, index) => target.key(index))
        .filter((key) => key != null && key.startsWith(prefix))
        .map((key) => key.slice(prefix.length)).sort();
    },
    remove(key) {
      const name = full(key);
      const target = area();
      const previous = target.getItem(name);
      target.removeItem(name);
      if (previous != null) emit(name, previous, null);
      return null;
    },
    clear() { for (const key of api.keys()) api.remove(key); return null; },
    scope(name) {
      const value = storageText(name, "Storage scope").trim();
      if (!value) throw new TypeError("Storage scope cannot be empty");
      return createStore(storageName, prefix + value + ":", areaName);
    },
    watch(key, Type, callback) {
      if (typeof callback !== "function") throw new TypeError("Storage watch requires a callback");
      Type = storageType(Type);
      const name = full(key);
      const changed = (event) => {
        const detail = event.detail;
        if (!detail || detail.areaName !== areaName || detail.key !== name) return;
        __velarInvokeOwnedCallback(callback, [parsed(detail.newValue, Type, null), parsed(detail.oldValue, Type, null)], "storage", "watch");
      };
      const stored = (event) => {
        if (event.storageArea !== area() || event.key !== name) return;
        __velarInvokeOwnedCallback(callback, [parsed(event.newValue, Type, null), parsed(event.oldValue, Type, null)], "storage", "watch");
      };
      addEventListener(changeEvent, changed);
      addEventListener("storage", stored);
      return () => { removeEventListener(changeEvent, changed); removeEventListener("storage", stored); return null; };
    },
  };
  return Object.freeze(api);
}

export const storage = createStore("localStorage");
export const session = createStore("sessionStorage", "", "session");

export function database(name) {
  const databaseName = storageText(name, "Database name").trim();
  if (!databaseName) throw new TypeError("Database name cannot be empty");
  if (databaseName.length > 256) throw new RangeError("Database names cannot exceed 256 characters");
  let opened = null;
  const connect = () => {
    if (opened) return opened;
    const pending = new Promise((resolve, reject) => {
      const request = indexedDB.open("velar:" + databaseName, 1);
      request.onupgradeneeded = () => { if (!request.result.objectStoreNames.contains("values")) request.result.createObjectStore("values"); };
      request.onsuccess = () => {
        const result = request.result;
        if (opened !== pending) { result.close(); return; }
        result.onversionchange = () => { result.close(); if (opened === pending) opened = null; };
        resolve(result);
      };
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(new Error("Velar database upgrade is blocked by another open page"));
    });
    opened = pending;
    void pending.catch(() => { if (opened === pending) opened = null; });
    return pending;
  };
  const request = async (mode, operation) => {
    const db = await connect();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction("values", mode);
      const result = operation(transaction.objectStore("values"));
      let value;
      result.onsuccess = () => { value = result.result; };
      result.onerror = () => reject(result.error);
      transaction.onabort = () => reject(transaction.error);
      transaction.onerror = () => reject(transaction.error);
      transaction.oncomplete = () => resolve(value);
    });
  };
  const keyOf = (key) => storageText(key, "Database key");
  return Object.freeze({
    async get(key, Type, fallback = null) { Type = storageType(Type); const name = keyOf(key); const value = await request("readonly", (store) => store.get(name)); return value === undefined ? fallback : (() => { try { return Type.parse(value); } catch { return fallback; } })(); },
    async set(key, value) {
      const name = keyOf(key);
      const encoded = __velarJsonStringify(value);
      await request("readwrite", (store) => store.put(JSON.parse(encoded), name));
      return null;
    },
    async has(key) { const name = keyOf(key); return (await request("readonly", (store) => store.getKey(name))) !== undefined; },
    async keys() { const keys = await request("readonly", (store) => store.getAllKeys(undefined, 100001)); if (!Array.isArray(keys) || keys.some((key) => typeof key !== "string")) throw new TypeError("Velar database contains a non-string key"); if (keys.length > 100000) throw new RangeError("Velar databases cannot expose more than 100000 keys at once"); return keys.slice().sort(); },
    async remove(key) { const name = keyOf(key); await request("readwrite", (store) => store.delete(name)); return null; },
    async clear() { await request("readwrite", (store) => store.clear()); return null; },
  });
}
`.trimStart()],
  ["velar/browser", String.raw`
${ownedCallbackRuntime}
${optionsRuntime}
const timerRuntimeKey = Symbol.for("velar.runtime.v1");

function browserNumber(value, name) { if (!Number.isFinite(value)) throw new TypeError(name + " must be a finite number"); return value; }
function browserText(value, name, maximum) { value = __velarString(value, name); if (value.length > maximum) throw new RangeError(name + " is too long"); return value; }
function browserQuery(search) {
  search = browserText(String(search || ""), "Browser location query", 2 * 1024 * 1024);
  const output = new Map();
  let count = 0;
  for (const [name, value] of new URLSearchParams(search)) {
    count += 1;
    if (count > 100000) throw new RangeError("Browser location queries cannot exceed 100000 fields");
    output.set(name, value);
  }
  return output;
}
function scrollBehavior(value) { value = __velarString(value, "Scroll behavior"); if (!["auto", "smooth", "instant"].includes(value)) throw new TypeError("Scroll behavior must be auto, smooth, or instant"); return value; }

function timerDuration(value, name, positive) {
  if (!Number.isFinite(value) || value < 0 || value > 2147483647 || (positive && value === 0)) {
    throw new RangeError(name + (positive ? " requires milliseconds from above 0 through 2147483647" : " requires milliseconds from 0 through 2147483647"));
  }
  return value;
}

function reportTimerFailure(failure, detail) {
  const error = failure instanceof Error ? failure : new Error(String(failure), { cause: failure });
  const runtime = globalThis[timerRuntimeKey];
  if (runtime && typeof runtime.report === "function") {
    runtime.report(error, { phase: "timer", detail, unhandled: true });
  } else {
    queueMicrotask(() => { throw error; });
  }
}

async function invokeTimer(callback, detail) {
  try { await callback(); }
  catch (error) { reportTimerFailure(error, detail); }
}

export function after(milliseconds, callback) {
  const duration = timerDuration(milliseconds, "after", false);
  if (typeof callback !== "function") throw new TypeError("after requires a callback");
  let active = true;
  const timer = setTimeout(() => {
    if (!active) return;
    active = false;
    void invokeTimer(callback, "after");
  }, duration);
  return () => { active = false; clearTimeout(timer); return null; };
}

export function every(milliseconds, callback) {
  const duration = timerDuration(milliseconds, "every", true);
  if (typeof callback !== "function") throw new TypeError("every requires a callback");
  let active = true;
  let timer = null;
  const schedule = () => {
    if (!active) return;
    timer = setTimeout(async () => {
      if (!active) return;
      await invokeTimer(callback, "every");
      schedule();
    }, duration);
  };
  schedule();
  return () => { active = false; if (timer !== null) clearTimeout(timer); return null; };
}

export function location() {
  const value = globalThis.location;
  return Object.freeze({
    href: browserText(value.href, "Browser location URL", 2 * 1024 * 1024),
    origin: browserText(value.origin, "Browser location origin", 2 * 1024 * 1024),
    path: browserText(value.pathname, "Browser location path", 2 * 1024 * 1024),
    query: browserQuery(value.search),
    hash: browserText(value.hash, "Browser location hash", 2 * 1024 * 1024),
  });
}

export function environment() {
  const sourceLanguages = navigator.languages || [];
  if (!Number.isSafeInteger(sourceLanguages.length) || sourceLanguages.length < 0 || sourceLanguages.length > 1000) throw new RangeError("Browser languages are outside Velar limits");
  const languages = [];
  for (let index = 0; index < sourceLanguages.length; index += 1) languages.push(browserText(sourceLanguages[index], "Browser language", 256));
  return Object.freeze({
    language: browserText(navigator.language || "", "Browser language", 256),
    languages,
    online: navigator.onLine,
    visible: document.visibilityState === "visible",
    colorScheme: matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light",
    reducedMotion: matchMedia("(prefers-reduced-motion: reduce)").matches,
    touch: navigator.maxTouchPoints > 0,
  });
}

function clipboard() {
  if (!globalThis.isSecureContext || !navigator.clipboard) throw new Error("Clipboard access requires a secure browser context");
  return navigator.clipboard;
}

export async function copyText(value) { value = browserText(value, "Clipboard text", 16 * 1024 * 1024); await clipboard().writeText(value); return null; }
export async function readClipboardText() { return browserText(await clipboard().readText(), "Clipboard text", 16 * 1024 * 1024); }
export function open(url, target = "_blank") { url = browserText(url, "Browser URL", 2 * 1024 * 1024); target = browserText(target, "Browser target", 256); globalThis.open(url, target, target === "_blank" ? "noopener,noreferrer" : undefined); return null; }
export function scrollTo(x, y, behavior = "auto") { globalThis.scrollTo({ left: browserNumber(x, "Scroll x"), top: browserNumber(y, "Scroll y"), behavior: scrollBehavior(behavior) }); return null; }
export function scrollIntoView(element, behavior = "smooth") { requireElement(element); element.scrollIntoView({ behavior: scrollBehavior(behavior), block: "nearest" }); return null; }
export function focus(element, preventScroll = false) {
  element = requireFocusableElement(element);
  preventScroll = __velarBool(preventScroll, "Focus preventScroll");
  HTMLElement.prototype.focus.call(element, { preventScroll });
  return null;
}
export function blur(element) {
  element = requireFocusableElement(element);
  HTMLElement.prototype.blur.call(element);
  return null;
}
export function measure(element) {
  requireElement(element);
  const value = element.getBoundingClientRect();
  return Object.freeze({
    x: browserNumber(value.x, "Element x"), y: browserNumber(value.y, "Element y"),
    width: browserNumber(value.width, "Element width"), height: browserNumber(value.height, "Element height"),
    top: browserNumber(value.top, "Element top"), right: browserNumber(value.right, "Element right"),
    bottom: browserNumber(value.bottom, "Element bottom"), left: browserNumber(value.left, "Element left"),
  });
}
export function media(query) { return matchMedia(browserText(query, "Media query", 4096)).matches; }
export function watchMedia(query, callback) {
  if (typeof callback !== "function") throw new TypeError("watchMedia requires a callback");
  const matcher = matchMedia(browserText(query, "Media query", 4096));
  const changed = (event) => __velarInvokeOwnedCallback(callback, [event.matches], "observer", "media");
  matcher.addEventListener("change", changed);
  return () => { matcher.removeEventListener("change", changed); return null; };
}
export function watchOnline(callback) {
  if (typeof callback !== "function") throw new TypeError("watchOnline requires a callback");
  const changed = () => __velarInvokeOwnedCallback(callback, [navigator.onLine], "observer", "online");
  addEventListener("online", changed); addEventListener("offline", changed);
  return () => { removeEventListener("online", changed); removeEventListener("offline", changed); return null; };
}
export function watchVisibility(callback) {
  if (typeof callback !== "function") throw new TypeError("watchVisibility requires a callback");
  const changed = () => __velarInvokeOwnedCallback(callback, [document.visibilityState === "visible"], "observer", "visibility");
  document.addEventListener("visibilitychange", changed);
  return () => { document.removeEventListener("visibilitychange", changed); return null; };
}
export function showDialog(dialog) {
  requireDialog(dialog);
  if (!dialog.isConnected) throw new Error("A dialog must be mounted before it can be shown");
  if (!dialog.open) dialog.showModal();
  return null;
}
export function closeDialog(dialog, result = "") {
  requireDialog(dialog);
  result = browserText(result, "Dialog result", 65536);
  if (dialog.open) dialog.close(result);
  return null;
}
export function dialogResult(dialog) { requireDialog(dialog); return browserText(dialog.returnValue || "", "Dialog result", 65536); }
export function frame() { return new Promise((resolve, reject) => requestAnimationFrame((value) => { try { resolve(browserNumber(value, "Animation frame timestamp")); } catch (error) { reject(error); } })); }
function requireElement(value) { if (!(value instanceof Element)) throw new TypeError("Browser element helpers require an Element"); }
function requireFocusableElement(value) {
  requireElement(value);
  if (typeof HTMLElement === "undefined" || !(value instanceof HTMLElement)) throw new TypeError("Focus helpers require an HTML element");
  return value;
}
function requireDialog(value) { if (typeof HTMLDialogElement === "undefined" || !(value instanceof HTMLDialogElement)) throw new TypeError("Dialog helpers require a <dialog> element"); }
`.trimStart()],
  ["velar/files", String.raw`
${optionsRuntime}
const nativeFilesKey = Symbol.for("velar.file.registry.v1");
const nativeFiles = globalThis[nativeFilesKey] ??= new WeakMap();
const defaultFileReadBytes = 16 * 1024 * 1024;
const maxFileReadBytes = 64 * 1024 * 1024;
function readLimit(value) {
  if (!Number.isSafeInteger(value) || value < 1 || value > maxFileReadBytes) throw new RangeError("File maxBytes must be an integer from 1 through 67108864");
  return value;
}
function fileText(value, name, maximum) { value = __velarString(value, name); if (value.length > maximum) throw new RangeError(name + " is too long"); return value; }
function wrap(file) {
  const name = fileText(file.name, "Selected file name", 4096);
  const type = fileText(file.type, "Selected file MIME type", 1024);
  const size = file.size;
  const modified = file.lastModified;
  if (!Number.isSafeInteger(size) || size < 0) throw new TypeError("Selected file size must be a non-negative safe integer");
  if (!Number.isFinite(modified) || modified < 0) throw new TypeError("Selected file modified time must be a non-negative finite number");
  const value = { name, size, type, modified };
  Object.freeze(value);
  nativeFiles.set(value, file);
  return value;
}
function native(file) { const value = nativeFiles.get(file); if (!value) throw new TypeError("Expected a file returned by velar/files"); return value; }
export function pick(options = {}) {
  options = __velarOptions(options, "File picker options", new Set(["accept", "multiple"]));
  const accept = options.accept == null ? "" : __velarString(options.accept, "File accept filter");
  if (accept.length > 4096) throw new RangeError("File accept filters cannot exceed 4096 characters");
  const multiple = options.multiple == null ? false : __velarBool(options.multiple, "File picker multiple");
  return new Promise((resolve, reject) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = accept;
    input.multiple = multiple;
    input.hidden = true;
    document.body.append(input);
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      globalThis.removeEventListener("focus", focused);
      try {
        const selected = input.files || [];
        if (!Number.isSafeInteger(selected.length) || selected.length < 0) throw new TypeError("A file picker returned an invalid file list");
        if (selected.length > 10000) {
          input.remove();
          reject(new RangeError("A file picker cannot return more than 10000 files"));
          return;
        }
        const files = [...selected].map(wrap);
        input.remove();
        resolve(files);
      } catch (error) {
        input.remove();
        reject(error);
      }
    };
    input.addEventListener("change", finish, { once: true });
    input.addEventListener("cancel", finish, { once: true });
    const focused = () => setTimeout(finish, 0);
    globalThis.addEventListener("focus", focused, { once: true });
    input.click();
  });
}
export function readText(file, maxBytes = defaultFileReadBytes) {
  const value = native(file);
  maxBytes = readLimit(maxBytes);
  if (value.size > maxBytes) throw new RangeError("File exceeds maxBytes");
  return Promise.resolve(value.text()).then((result) => {
    if (typeof result !== "string") throw new TypeError("File text result was not a string");
    if (result.length > maxBytes) throw new RangeError("File text result exceeds maxBytes");
    return result;
  });
}
export function readDataUrl(file, maxBytes = defaultFileReadBytes) {
  const value = native(file);
  maxBytes = readLimit(maxBytes);
  if (value.size > maxBytes) throw new RangeError("File exceeds maxBytes");
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result !== "string") { reject(new TypeError("File data URL result was not text")); return; }
      if (reader.result.length > Math.ceil(maxBytes * 4 / 3) + 4096) { reject(new RangeError("File data URL result exceeds maxBytes expansion")); return; }
      resolve(reader.result);
    };
    reader.onerror = () => reject(reader.error || new Error("File reading failed"));
    reader.readAsDataURL(value);
  });
}
export function download(name, data, mime = "text/plain;charset=utf-8") {
  name = __velarString(name, "Download name");
  data = __velarString(data, "Download data");
  mime = __velarString(mime, "Download MIME type");
  if (!name || name.length > 4096) throw new RangeError("Download names must contain 1 through 4096 characters");
  if (data.length > maxFileReadBytes) throw new RangeError("Download text cannot exceed 64 MiB");
  if (!mime || mime.length > 1024) throw new RangeError("Download MIME types must contain 1 through 1024 characters");
  const url = URL.createObjectURL(new Blob([data], { type: mime }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.hidden = true;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
  return null;
}
`.trimStart()],
  ["velar/realtime", String.raw`
${ownedCallbackRuntime}
${optionsRuntime}
${strictJsonRuntime}
const maxRealtimeTextCodeUnits = 16 * 1024 * 1024;
const maxRealtimeUrlCodeUnits = 2 * 1024 * 1024;
function realtimeUrl(value, name) {
  value = __velarString(value, name);
  if (value.length > maxRealtimeUrlCodeUnits) throw new RangeError(name + " cannot exceed 2 MiB");
  return value;
}
function realtimeMessage(value, name) {
  value = __velarString(value, name);
  if (value.length > maxRealtimeTextCodeUnits) throw new RangeError(name + " cannot exceed 16 MiB");
  return value;
}
function handler(value, allowed) {
  value = __velarOptions(value, "Realtime handlers", allowed);
  for (const name of Object.getOwnPropertyNames(value)) {
    const callback = Object.getOwnPropertyDescriptor(value, name).value;
    if (callback != null && typeof callback !== "function") throw new TypeError("Realtime handler '" + name + "' must be callable");
  }
  return value;
}
function socketState(value) { return value.readyState === 0 ? "connecting" : value.readyState === 1 ? "open" : value.readyState === 2 ? "closing" : "closed"; }
export function socket(url, handlers = {}) {
  handlers = handler(handlers, new Set(["open", "message", "error", "close"]));
  const value = new WebSocket(realtimeUrl(url, "WebSocket URL"));
  value.addEventListener("open", () => __velarInvokeOwnedCallback(handlers.open, [], "realtime", "socket:open"));
  value.addEventListener("message", (event) => {
    if (typeof event.data !== "string") {
      __velarInvokeOwnedCallback(handlers.error, ["Binary WebSocket messages are not supported by Velar Web API 0.6"], "realtime", "socket:error");
      if (value.readyState < WebSocket.CLOSING) value.close(1003, "Text messages only");
      return;
    }
    if (event.data.length > maxRealtimeTextCodeUnits) {
      __velarInvokeOwnedCallback(handlers.error, ["WebSocket message exceeded 16 MiB"], "realtime", "socket:error");
      if (value.readyState < WebSocket.CLOSING) value.close(1009, "Message too large");
      return;
    }
    __velarInvokeOwnedCallback(handlers.message, [event.data], "realtime", "socket:message");
  });
  value.addEventListener("error", () => __velarInvokeOwnedCallback(handlers.error, ["WebSocket connection error"], "realtime", "socket:error"));
  value.addEventListener("close", (event) => __velarInvokeOwnedCallback(handlers.close, [event.code, event.reason || ""], "realtime", "socket:close"));
  return Object.freeze({
    url: value.url,
    state: () => socketState(value),
    send(data) { data = realtimeMessage(data, "WebSocket message"); if (value.readyState !== WebSocket.OPEN) throw new Error("WebSocket is not open"); value.send(data); return null; },
    sendJson(data) { if (value.readyState !== WebSocket.OPEN) throw new Error("WebSocket is not open"); value.send(__velarJsonStringify(data)); return null; },
    close(code = 1000, reason = "") {
      if (!Number.isSafeInteger(code) || (code !== 1000 && (code < 3000 || code > 4999))) throw new RangeError("WebSocket close code must be 1000 or from 3000 through 4999");
      reason = __velarString(reason, "WebSocket close reason");
      if (new TextEncoder().encode(reason).length > 123) throw new RangeError("WebSocket close reason cannot exceed 123 UTF-8 bytes");
      if (value.readyState < WebSocket.CLOSING) value.close(code, reason);
      return null;
    },
  });
}
export function eventStream(url, handlers = {}, credentials = false) {
  handlers = handler(handlers, new Set(["open", "message", "error"]));
  credentials = __velarBool(credentials, "Event stream credentials");
  const value = new EventSource(realtimeUrl(url, "Event stream URL"), { withCredentials: credentials });
  value.addEventListener("open", () => __velarInvokeOwnedCallback(handlers.open, [], "realtime", "event-stream:open"));
  value.addEventListener("message", (event) => {
    if (typeof event.data !== "string" || event.data.length > maxRealtimeTextCodeUnits || typeof event.lastEventId !== "string" || event.lastEventId.length > 65536) {
      __velarInvokeOwnedCallback(handlers.error, ["Event stream message or ID exceeded Velar limits"], "realtime", "event-stream:error");
      value.close();
      return;
    }
    __velarInvokeOwnedCallback(handlers.message, [event.data, event.lastEventId], "realtime", "event-stream:message");
  });
  value.addEventListener("error", () => __velarInvokeOwnedCallback(handlers.error, ["Event stream connection error"], "realtime", "event-stream:error"));
  return Object.freeze({
    url: value.url,
    state: () => socketState(value),
    close() { value.close(); return null; },
  });
}
`.trimStart()],
  ["velar/test", String.raw`
${deepEqualRuntime}
const browserRuntimeKey = Symbol.for("velar.browser.test.v1");
function browserRuntime() {
  const runtime = globalThis[browserRuntimeKey];
  if (!runtime) throw new Error("velar/test browser controls require 'velar test --browser'");
  return runtime;
}
export const browser = Object.freeze({
  open(path = "/") { return browserRuntime().open(path); },
  reload() { return browserRuntime().reload(); },
  click(selector) { return browserRuntime().click(selector); },
  fill(selector, value) { return browserRuntime().fill(selector, value); },
  select(selector, value) { return browserRuntime().select(selector, value); },
  press(selector, key) { return browserRuntime().press(selector, key); },
  text(selector) { return browserRuntime().text(selector); },
  attribute(selector, name) { return browserRuntime().attribute(selector, name); },
  namespace(selector) { return browserRuntime().namespace(selector); },
  count(selector) { return browserRuntime().count(selector); },
  visible(selector) { return browserRuntime().visible(selector); },
  waitFor(selector, state = "visible") { return browserRuntime().waitFor(selector, state); },
  waitForText(selector, text) { return browserRuntime().waitForText(selector, text); },
  currentPath() { return browserRuntime().currentPath(); },
  viewport(width, height) { return browserRuntime().viewport(width, height); },
});

function display(value, active = new WeakSet()) {
  if (value === null) return "null";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value !== "object") return String(value);
  if (active.has(value)) return "[cycle]";
  active.add(value);
  try {
    if (Array.isArray(value)) return __velarDenseList(value) ? "[" + value.map((item) => display(item, active)).join(", ") + "]" : "[invalid List]";
    if (value instanceof Map) return "Map(" + [...value].map(([key, item]) => display(key, active) + " => " + display(item, active)).join(", ") + ")";
    if (value instanceof Set) return "Set(" + [...value].map((item) => display(item, active)).join(", ") + ")";
    const keys = __velarDataRecordKeys(value);
    if (keys) return "{" + keys.map((key) => JSON.stringify(key) + ": " + display(Object.getOwnPropertyDescriptor(value, key).value, active)).join(", ") + "}";
    const prototype = Object.getPrototypeOf(value);
    const constructor = prototype && Object.getOwnPropertyDescriptor(prototype, "constructor")?.value;
    return "[" + (typeof constructor === "function" && constructor.name ? constructor.name : "object") + "]";
  } finally {
    active.delete(value);
  }
}
export function expect(actual) {
  return Object.freeze({
    toBe(expected) { if (actual !== expected) throw new Error("Expected " + display(actual) + " to be " + display(expected)); },
    toEqual(expected) { if (!__velarDeepEqual(actual, expected)) throw new Error("Expected " + display(actual) + " to deeply equal " + display(expected)); },
    toBeTruthy() { if (actual !== true) throw new Error("Expected bool true but received " + display(actual)); },
    toBeFalsy() { if (actual !== false) throw new Error("Expected bool false but received " + display(actual)); },
    toContain(expected) {
      const contains = typeof actual === "string"
        ? typeof expected === "string" && actual.includes(expected)
        : Array.isArray(actual) && __velarDenseList(actual) && actual.some((value) => value === expected);
      if (!contains) throw new Error("Expected " + display(actual) + " to contain " + display(expected));
    },
    toMatch(expected) {
      if (typeof actual !== "string" || typeof expected !== "string") throw new TypeError("toMatch requires text and a string pattern");
      let pattern;
      try { pattern = new RegExp(expected, "u"); } catch (error) { throw new TypeError("Invalid toMatch pattern: " + (error instanceof Error ? error.message : String(error))); }
      if (!pattern.test(actual)) throw new Error("Expected " + display(actual) + " to match " + display(expected));
    },
    toHaveLength(expected) {
      if (!Number.isSafeInteger(expected) || expected < 0) throw new RangeError("Expected length must be a non-negative safe integer");
      const length = typeof actual === "string" ? actual.length : Array.isArray(actual) && __velarDenseList(actual) ? actual.length : null;
      if (length === null) throw new TypeError("toHaveLength requires text or a dense List");
      if (length !== expected) throw new Error("Expected length " + expected + " but received " + length);
    },
    toThrow() {
      if (typeof actual !== "function") throw new TypeError("toThrow requires a function");
      let threw = false; try { actual(); } catch { threw = true; }
      if (!threw) throw new Error("Expected function to throw");
    },
    async toReject() {
      let result;
      if (typeof actual === "function") {
        try { result = actual(); }
        catch (error) { throw new Error("Expected function to return a rejecting Promise, but it threw synchronously: " + display(error)); }
      } else result = actual;
      if (!result || typeof result.then !== "function") throw new TypeError("toReject requires a Promise or a function returning one");
      try { await result; } catch { return null; }
      throw new Error("Expected Promise to reject");
    },
  });
}
`.trimStart()],
]);

export function standardModuleRoute(source: string): string {
  return `/@velar/${source.slice("velar/".length)}.js`;
}

export interface StandardModuleApi {
  readonly standardVersion: string;
  readonly webVersion: string;
  readonly modules: Readonly<Record<string, readonly string[]>>;
}

export function standardModuleApi(): StandardModuleApi {
  return {
    standardVersion: VELAR_STANDARD_API_VERSION,
    webVersion: VELAR_WEB_API_VERSION,
    modules: Object.fromEntries([...standardInterfaces].map(([source, interface_]) => [source, [...interface_.exports.keys()].sort()])),
  };
}

export function standardModuleSource(source: string, web: {
  readonly base: string;
  readonly publicConfig?: Readonly<Record<string, unknown>>;
} = { base: "/" }): string | null {
  const value = standardModuleSources.get(source);
  if (!value) return null;
  if (source === "velar/web") return value.replace(JSON.stringify("__VELAR_WEB_BASE__"), JSON.stringify(web.base));
  if (source === "velar/config") {
    return value.replace(JSON.stringify("__VELAR_PUBLIC_CONFIG__"), JSON.stringify(web.publicConfig ?? {}));
  }
  return value;
}

export function standardModuleAsset(pathname: string, web: {
  readonly base: string;
  readonly publicConfig?: Readonly<Record<string, unknown>>;
} = { base: "/" }): string | null {
  const match = /^\/@velar\/([a-z-]+)\.js$/u.exec(pathname);
  return match ? standardModuleSource(`velar/${match[1]}`, web) : null;
}
