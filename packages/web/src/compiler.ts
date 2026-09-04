import { optionalOf as optional, type ClassInfo, type CompilerExtension, type EnumInfo, type GenericTypeInfo, type ModuleInterface, type ValueType } from "@velarscript/compiler";
import type { AnalysisContext, CompilerAnalysisExtension, CompilerEmitterOptions, CompilerLexicalExtension, Expression, LoweringHints, Token } from "@velarscript/compiler/extension";
import { inferWebIntrinsic, routeContextIdentity, VelarWebAnalyzer } from "./analyzer.ts";
import {
  WEB_STATEMENT_CONSTRUCTS,
  webExpressionContainsDirectAwait,
  isWebJsx,
  webStatementConstructKey,
  webStatementContainsDirectAwait,
} from "./ast.ts";
import { BROWSER_TEST_MODULE, BROWSER_TEST_SOURCE_SUFFIX, browserTestDrivingGuidance } from "./browser-test.ts";
import { WEB_NATIVE_ELEMENTS, WEB_VOID_ELEMENTS } from "./elements.ts";
import { WebJavaScriptEmitter } from "./emitter.ts";
import { velarWebProjectEditorExtension, webLookPropertyDocumentation } from "./editor.ts";
import { velarWebInspectionExtension } from "./inspection.ts";
import { VelarWebParser } from "./parser.ts";
import { scanWebToken, scanWebUnsafeCssLiteral, WEB_CONTEXTUAL_KEYWORDS } from "./lexer.ts";
import { webModuleSource, webModuleSources, type VelarWebRuntimeConfig } from "./runtime.ts";
import { velarWebSemanticExtension } from "./semantic.ts";
import { LOOK_BUILDER_SIGNATURES, LOOK_BUILDERS, LOOK_HOOKS, LOOK_MEDIA_SUBJECTS, LOOK_PUBLIC_TYPE_NAMES, LOOK_TARGETS, LOOK_UNIT_TYPES, type LookBuilderResultKind } from "./look.ts";
import { isWebTypeAssignable, resolveWebTypeSyntax, WEB_OWNED_TYPE_NAMES, webComponentConstructor, webNodeType } from "./types.ts";

export const VELAR_WEB_API_VERSION = "0.11";
const bytesType: ValueType = { kind: "named", name: "Bytes", identity: "velar/binary#type:Bytes" };

// D57 rule 138 gave the browser-test boundary teeth, so the two names it is
// written in are part of the published contract: the framework host hands the
// suffix to the CLI runner, and tooling that has to name a browser test module
// reads both from here instead of spelling them again.
export { BROWSER_TEST_MODULE, BROWSER_TEST_SOURCE_SUFFIX } from "./browser-test.ts";

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

/**
 * Native JSX construction preserves the order and count of a collection
 * projection. Attribute and child holes still have to pass Core's stability
 * proof; event arrows are inert values here and run only after dispatch.
 * Components, custom elements, refs, and bindings keep the explicit loop
 * because their setup can execute user code or write through a binding.
 */
function webCanonicalCollectionProjection(
  expression: Expression,
  pure: (expression: Expression) => boolean,
): boolean | undefined {
  if (!isWebJsx(expression)) return undefined;
  if (expression.tag !== "" && !WEB_NATIVE_ELEMENTS.has(expression.tag)) return false;
  for (const attribute of expression.attributes) {
    if (attribute.name === "ref" || attribute.name.startsWith("bind:")) return false;
    if (typeof attribute.value === "string" || attribute.value === null) continue;
    if (attribute.name.startsWith("on:") && attribute.value.kind === "ArrowFunctionExpression") continue;
    if (!pure(attribute.value)) return false;
  }
  for (const child of expression.children) {
    if (child.kind === "JSXText") continue;
    if (child.kind === "ExtensionExpression:web:jsx") {
      if (webCanonicalCollectionProjection(child, pure) !== true) return false;
      continue;
    }
    if (!pure(child.expression)) return false;
  }
  return true;
}
const transitionType: ValueType = { kind: "named", name: "Transition" };
const keyframesType: ValueType = { kind: "named", name: "Keyframes" };
const animationType: ValueType = { kind: "named", name: "Animation" };
const durationType: ValueType = { kind: "named", name: "Duration" };
const angleType: ValueType = { kind: "named", name: "Angle" };
const spacingType: ValueType = { kind: "named", name: "Spacing" };
const mountTargetType: ValueType = { kind: "union", members: [stringType, elementType] };
const lookScalarType: ValueType = { kind: "union", members: [numberType, stringType, lengthType, percentageType, lengthPercentageType] };
const trackInputType: ValueType = { kind: "union", members: [numberType, stringType, lengthType, percentageType, lengthPercentageType, trackFractionType, trackType, trackListType] };
const repeatCountType: ValueType = { kind: "union", members: [numberType, stringType] };
const lookBuilderResultTypes: Readonly<Record<LookBuilderResultKind, ValueType>> = {
  animation: animationType,
  border: borderType,
  color: colorType,
  image: imageType,
  length: lengthType,
  shadow: shadowType,
  spacing: spacingType,
  string: stringType,
  track: trackType,
  "track-list": trackListType,
  transition: transitionType,
};

function namedFunction(parameterNames: readonly string[], parameters: readonly ValueType[], result: ValueType, requiredParameters = parameters.length): ValueType {
  return { kind: "function", parameterNames, parameters, requiredParameters, result };
}

/**
 * A velar/look builder's published type, with its parameter names and required
 * count read from LOOK_BUILDER_SIGNATURES rather than repeated here. The static
 * keyframe lowering places named arguments from that same table, so the two
 * cannot disagree about what `spread=0px` means.
 */
function lookBuilder(name: string, parameters: readonly ValueType[], rest?: ValueType): ValueType {
  const signature = LOOK_BUILDER_SIGNATURES.get(name);
  if (!signature) throw new Error(`velar/look builder '${name}' has no declared signature`);
  if (signature.parameters.length !== parameters.length) {
    throw new Error(`velar/look builder '${name}' declares ${signature.parameters.length} parameters but types ${parameters.length}`);
  }
  if ((signature.rest ?? false) !== (rest !== undefined)) {
    throw new Error(`velar/look builder '${name}' disagrees with its declared rest parameter`);
  }
  return {
    kind: "function",
    parameterNames: signature.parameters,
    parameters,
    requiredParameters: signature.required,
    ...(rest ? { rest } : {}),
    result: lookBuilderResultTypes[signature.result],
  };
}

const unknownType: ValueType = { kind: "unknown" };
const webGlobals = new Map<string, ValueType>([
  ["mount", namedFunction(["node", "target"], [nodeType, mountTargetType], nullType)],
  ["tick", namedFunction([], [], { kind: "promise", value: nullType })],
]);

const lookModuleExports = new Map<string, ValueType>([
  ...LOOK_PUBLIC_TYPE_NAMES.map((name) => [name, { kind: "typeObject", name, value: { kind: "named", name } } as ValueType] as const),
  // D103: a token reference has no visual kind of its own, because the design
  // system owns the value and the compiler cannot see it. `string` is the type
  // every checked Look property kind already admits alongside its own visual
  // type, which is what makes one spelling legal in all of them; the kinds keep
  // their D37 keyword tables, which read literals and folded keywords and so
  // never see a call.
  ["token", lookBuilder("token", [stringType])],
  ["color", lookBuilder("color", [stringType])],
  ["rgb", lookBuilder("rgb", [numberType, numberType, numberType])],
  ["rgba", lookBuilder("rgba", [numberType, numberType, numberType, numberType])],
  ["hsl", lookBuilder("hsl", [numberType, numberType, numberType])],
  ["alpha", lookBuilder("alpha", [colorInputType, numberType])],
  ["lighten", lookBuilder("lighten", [colorInputType, numberType])],
  ["darken", lookBuilder("darken", [colorInputType, numberType])],
  ["border", lookBuilder("border", [lengthType, colorInputType, stringType])],
  ["shadow", lookBuilder("shadow", [lengthType, lengthType, lengthType, colorInputType, lengthType, boolType])],
  ["linearGradient", lookBuilder("linearGradient", [angleType, colorInputType, colorInputType])],
  ["asset", lookBuilder("asset", [stringType])],
  ["minmax", lookBuilder("minmax", [trackInputType, trackInputType])],
  ["repeat", lookBuilder("repeat", [repeatCountType, trackInputType])],
  ["tracks", lookBuilder("tracks", [trackInputType], trackInputType)],
  ["transition", lookBuilder("transition", [stringType, durationType, stringType, durationType])],
  ["spacing", lookBuilder("spacing", [lookScalarType, lookScalarType, lookScalarType, lookScalarType])],
  ["min", lookBuilder("min", [lengthType, lengthType])],
  ["max", lookBuilder("max", [lengthType, lengthType])],
  ["clamp", lookBuilder("clamp", [lengthType, lengthType, lengthType])],
  ["animate", lookBuilder(
    "animate",
    [keyframesType, durationType, stringType, durationType, numberType, boolType, stringType, stringType],
  )],
]);

// D52 rule 114: `Look.` is gone. JavaScript has no `Look` global, so the
// prefix was ours to invent and ours to withdraw — and a look block is the
// densest run of calls in the language, which is the worst place to spend four
// characters per call on a word that adds nothing. The builders are named
// imports again; `Look` survives only as the type of a look value.

const webTextFormTypes = new Set(LOOK_UNIT_TYPES.values());
// D72 rule 186: derived from the one published table. `Component` is the only
// name that answers `textForm` differently — it is a constructor contract
// rather than a value type — so it is subtracted here rather than kept in a
// second list.
const webOwnedNamedTypes = new Set([...WEB_OWNED_TYPE_NAMES].filter((name) => name !== "Component"));

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

/** A structurally declared standard capability handle; see ValueType.capabilityHandle. */
function capabilityHandle(fields: Readonly<Record<string, ValueType>>): ValueType {
  return { kind: "object", fields: new Map(Object.entries(fields)), capabilityHandle: true };
}

const errorType: ValueType = { kind: "class", name: "Error" };
const cleanupType = namedFunction([], [], nullType);
const arrayString: ValueType = { kind: "list", element: stringType };
const arrayNumber: ValueType = { kind: "list", element: numberType };
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
const httpTransportPhaseWireValues = new Map([...httpTransportPhaseMembers].map((member) => [member, member]));
const httpTransportPhaseType: ValueType = { kind: "enum", name: "HttpTransportPhase", identity: httpTransportPhaseIdentity };
const httpTransportErrorIdentity = "velar/http#class:HttpTransportError";

// D90 R20: `ok` is gone from the response. `response()` throws
// `HttpResponseError` for every non-2xx, so the only response an author can
// hold has `ok === true` — a field that is always true is a lie in the type,
// and `if not r.ok:` was a dead branch the tour taught twice. The failure
// path is a `catch` that narrows with `is HttpResponseError`, and the
// analyzer says so when the old field is read.
const httpResponseType = object({
  status: numberType,
  statusText: stringType,
  url: stringType,
  headers: mapString(stringType),
  json: namedFunction([], [], promise(unknownType)),
  text: namedFunction([], [], promise(stringType)),
  bytes: namedFunction([], [], promise(bytesType)),
  streamText: namedFunction(["consume"], [httpChunkConsumerType], promise(nullType)),
  blob: namedFunction([], [], promise(blobType)),
  parse: namedIntrinsic("runtime.parseAsync", ["target"], [unknownType], promise(unknownType)),
});

const requestType = object({
  response: namedFunction([], [], promise(httpResponseType)),
  json: namedFunction([], [], promise(unknownType)),
  text: namedFunction([], [], promise(stringType)),
  bytes: namedFunction([], [], promise(bytesType)),
  streamText: namedFunction(["consume"], [httpChunkConsumerType], promise(nullType)),
  blob: namedFunction([], [], promise(blobType)),
  parse: namedIntrinsic("runtime.parseAsync", ["target"], [unknownType], promise(unknownType)),
  cancel: namedFunction([], [], nullType),
});

const httpOptionsType = object({
  headers: optional(mapString(stringType)),
  body: optional(unknownType),
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
    ["get", namedIntrinsic("storage.get", ["key", "target", "fallback", "maxBytes"], [stringType, unknownType, unknownType, numberType], unknownType, 2)],
    ["set", namedIntrinsic("storage.set", ["key", "value", "maxBytes"], [stringType, unknownType, numberType], nullType, 2)],
    ["has", namedFunction(["key"], [stringType], boolType)],
    ["keys", namedFunction([], [], arrayString)],
    ["remove", namedFunction(["key"], [stringType], nullType)],
    ["clear", namedFunction([], [], nullType)],
    ["watch", namedIntrinsic("storage.watch", ["key", "target", "callback", "maxBytes"], [stringType, unknownType, unknownType, numberType], cleanupType, 3)],
  ]);
  const scoped: ValueType = { kind: "object", fields: common() };
  const fields = common();
  fields.set("scope", namedFunction(["name"], [stringType], scoped));
  return { kind: "object", fields };
}

const storageType = createStorageType();
const storageBatchChangeType = object({ key: stringType, bytes: optional(bytesType) });
const databaseType = object({
  get: namedIntrinsic("storage.databaseGet", ["key", "target", "fallback", "maxBytes"], [stringType, unknownType, unknownType, numberType], promise(unknownType), 2),
  set: namedIntrinsic("storage.set", ["key", "value", "maxBytes"], [stringType, unknownType, numberType], promise(nullType), 2),
  getBytes: namedFunction(["key", "fallback", "maxBytes"], [stringType, optional(bytesType), numberType], promise(optional(bytesType)), 1),
  setBytes: namedFunction(["key", "value", "maxBytes"], [stringType, bytesType, numberType], promise(nullType), 2),
  batch: namedFunction(["changes"], [{ kind: "list", element: storageBatchChangeType }], promise(nullType)),
  has: namedFunction(["key"], [stringType], promise(boolType)),
  keys: namedFunction([], [], promise(arrayString)),
  remove: namedFunction(["key"], [stringType], promise(nullType)),
  clear: namedFunction([], [], promise(nullType)),
});
const storageQuotaErrorIdentity = "velar/storage#class:StorageQuotaError";
const storageTransactionErrorIdentity = "velar/storage#class:StorageTransactionError";
const storageUpgradeErrorIdentity = "velar/storage#class:StorageUpgradeError";
function storageErrorClass(identity: string): ClassInfo {
  return {
    identity, parameters: [stringType], parameterNames: ["message"], requiredParameters: 0,
    base: "Error", abstract: false, fields: new Map(), getters: new Set(), abstractGetters: new Set(),
    methods: new Map(), abstractMethods: new Set(), staticFields: new Map(), staticGetters: new Set(), staticMethods: new Map(),
  };
}

/**
 * D90 R17-a left exactly one `any` standing in this file, and this is it.
 *
 * `component` holds a component constructor, not a rendered node, so
 * `webNodeType` is the wrong family — the two referees that check this slot
 * (`checkRouteComponent` and `checkWebRouteComponent`) match it with
 * `isWebComponentType`, and `isWebTypeAssignable` refuses a component against a
 * node outright. `unknown`, the answer R17 gives every other boundary position
 * here, is refused by the shape of assignability rather than by the ruling: a
 * writable object field and a List element are both compared *invariantly*, and
 * `unknown` is invariant with nothing, so `List<{path, component: Page}>` — the
 * type a route list bound to a name actually has — would stop being assignable
 * to the Router's `routes` prop. `any` is the only spelling that is invariant
 * with every component type at once, and no published name means "some
 * component"; R17-a declined to mint one. The slot is checked by its two
 * referees, not by this declaration.
 */
const routeComponentType: ValueType = { kind: "any" };
const routeType = object({
  path: stringType,
  component: routeComponentType,
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
// P2a-4 — `watchIntersection` completes the `velar/browser` watcher family for
// the one question the family could not answer: has *this element* entered or
// left the viewport. The family's shape is kept exactly — a callback plus a
// `() -> null` cleanup, never a live host object — and the entry carries the
// two fields the platform actually guarantees for a single observed target.
// `time` and the four rectangles are deliberately absent: a rectangle read from
// an observer entry is a layout snapshot from the *observation* moment rather
// than from now, so publishing it would invite exactly the read-a-stale-box
// mistake `measure` exists to avoid.
//
// The configuration is closed rather than an options passthrough: a `root` that
// scopes the observation to a scroll container, and a bounded threshold list.
// `rootMargin` is not in it — it is a CSS-string dialect parsed by the host,
// which is the one thing a checked surface must not accept as a string.
const intersectionEntryType = object({ intersecting: boolType, ratio: numberType });
const intersectionOptionsType = object({ root: optional(webElementType), thresholds: optional(arrayNumber) });
const textSelectionType = object({ start: numberType, end: numberType, direction: stringType });
const fileOptionsType = object({ accept: optional(stringType), multiple: optional(boolType) });
// D51 (audit 12): the realtime handle is a standard capability handle that
// publishes `close()`, so `using` supplies its release contract (charter
// section 16). It is declared structurally rather than as a named type, and
// the marker is what lets Core see it without ever detecting a shape.
//
// `velar/websocket.connect` remains the sole raw WebSocket transport. The
// higher-level `realtimeClient` below composes it with typed codecs, lifecycle,
// and reconnect policy; it does not duplicate framing or invent a second
// socket contract.
const eventStreamHandlersType = object({
  open: optional(functionType([], unknownType)),
  message: optional(functionType([stringType, stringType], unknownType)),
  error: optional(functionType([stringType], unknownType)),
});
const eventStreamType = capabilityHandle({ url: stringType, state: namedFunction([], [], stringType), close: namedFunction([], [], nullType) });
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
const browserTestAnimationType = object({
  count: numberType,
  name: stringType,
  rotating: boolType,
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
  box: namedFunction(["selector"], [stringType], promise(rectType)),
  style: namedFunction(["selector", "property"], [stringType, stringType], promise(stringType)),
  namespace: namedFunction(["selector"], [stringType], promise(stringType)),
  count: namedFunction(["selector"], [stringType], promise(numberType)),
  visible: namedFunction(["selector"], [stringType], promise(boolType)),
  waitFor: namedFunction(["selector", "until"], [stringType, stringType], promise(nullType), 1),
  waitForText: namedFunction(["selector", "text"], [stringType, stringType], promise(nullType)),
  currentPath: namedFunction([], [], promise(stringType)),
  viewport: namedFunction(["width", "height"], [numberType, numberType], promise(nullType)),
  timings: namedFunction([], [], promise(browserTestNavigationTimingType)),
  animation: namedFunction(["selector"], [stringType], promise(browserTestAnimationType)),
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

const webSocketConnectionIdentity = "velar/websocket#type:WebSocketConnection";
const webSocketCloseIdentity = "velar/websocket#type:WebSocketClose";
const webSocketConnectionType: ValueType = { kind: "named", name: "WebSocketConnection", identity: webSocketConnectionIdentity };
const webSocketCloseType: ValueType = { kind: "named", name: "WebSocketClose", identity: webSocketCloseIdentity };
const webSocketMessageType: ValueType = { kind: "union", members: [stringType, bytesType] };
const webSocketCloseFields = new Map<string, ValueType>([
  ["code", numberType],
  ["reason", stringType],
]);
const webSocketConnectionFields = new Map<string, ValueType>([
  // D90 fr-4: one identity, one field roster. A Web connection is always an
  // outbound `connect()` result, which was never upgraded from an Origin and
  // therefore reads back null — the same value the Node runtime gives an
  // outbound connection. Leaving the field off Web instead would make
  // `velar/websocket#type:WebSocketConnection` mean two different things.
  ["origin", optional(stringType)],
  ["state", namedFunction([], [], stringType)],
  ["send", namedFunction(["message"], [webSocketMessageType], promise(nullType))],
  ["next", namedFunction([], [], promise(optional(webSocketMessageType)))],
  ["closeInfo", namedFunction([], [], promise(webSocketCloseType))],
  ["close", namedFunction(["code", "reason"], [numberType, stringType], promise(nullType), 0)],
]);
const webSocketConnectOptions = object({
  timeout: optional(durationType),
  maxMessageBytes: optional(numberType),
  maxQueuedMessages: optional(numberType),
  maxQueuedBytes: optional(numberType),
  maxPendingSendBytes: optional(numberType),
});
const webSocketErrorIdentities = new Map([
  ["WebSocketBackpressureError", "velar/websocket#class:WebSocketBackpressureError"],
  ["WebSocketClosedError", "velar/websocket#class:WebSocketClosedError"],
  ["WebSocketProtocolError", "velar/websocket#class:WebSocketProtocolError"],
  ["WebSocketTimeoutError", "velar/websocket#class:WebSocketTimeoutError"],
]);
const webSocketErrorClass = (identity: string): ClassInfo => ({
  identity,
  parameters: [stringType],
  parameterNames: ["message"],
  requiredParameters: 0,
  base: "Error",
  abstract: false,
  fields: new Map(),
  getters: new Set(),
  abstractGetters: new Set(),
  methods: new Map(),
  abstractMethods: new Set(),
  staticFields: new Map(),
  staticGetters: new Set(),
  staticMethods: new Map(),
});

const realtimeWireType = webSocketMessageType;
const realtimeCodecIdentity = "velar/realtime#type:RealtimeCodec";
const realtimeClientIdentity = "velar/realtime#type:RealtimeClient";
const realtimeFailureIdentity = "velar/realtime#type:RealtimeFailure";
const realtimeOpenIdentity = "velar/realtime#type:RealtimeOpen";
const realtimeClientStateIdentity = "velar/realtime#enum:RealtimeClientState";
const realtimeFailureActionIdentity = "velar/realtime#enum:RealtimeClientFailureAction";
const realtimeUnavailableIdentity = "velar/realtime#class:RealtimeUnavailableError";
const realtimeClientStates = new Set(["idle", "connecting", "open", "reconnecting", "closed"]);
const realtimeFailureActions = new Set(["continue", "reconnect", "stop"]);
const realtimeClientStateType: ValueType = {kind: "enum", name: "RealtimeClientState", identity: realtimeClientStateIdentity};
const realtimeFailureActionType: ValueType = {kind: "enum", name: "RealtimeClientFailureAction", identity: realtimeFailureActionIdentity};
const realtimeFailureType: ValueType = {kind: "named", name: "RealtimeFailure", identity: realtimeFailureIdentity};
const realtimeOpenType: ValueType = {kind: "named", name: "RealtimeOpen", identity: realtimeOpenIdentity};
const realtimeCodecIncoming: ValueType = {kind: "parameter", name: "Incoming", index: 0};
const realtimeCodecOutgoing: ValueType = {kind: "parameter", name: "Outgoing", index: 1};
const realtimeClientOutgoing: ValueType = {kind: "parameter", name: "T", index: 0};
const realtimeInput: ValueType = {kind: "parameter", name: "Incoming", index: 0};
const realtimeOutput: ValueType = {kind: "parameter", name: "Outgoing", index: 1};

function realtimeGenericApplication(name: string, identity: string, arguments_: readonly ValueType[]): ValueType {
  const labels = arguments_.map((argument, index) => argument.kind === "parameter" ? argument.name : `T${index + 1}`);
  return {kind: "named", name: `${name}<${labels.join(", ")}>`, identity, application: {declaration: identity, name, arguments: arguments_}};
}

const realtimeCodecOf = (incoming: ValueType, outgoing: ValueType): ValueType => realtimeGenericApplication("RealtimeCodec", realtimeCodecIdentity, [incoming, outgoing]);
const realtimeClientOf = (outgoing: ValueType): ValueType => realtimeGenericApplication("RealtimeClient", realtimeClientIdentity, [outgoing]);
const realtimeCodecTemplate: GenericTypeInfo = {
  identity: realtimeCodecIdentity,
  name: "RealtimeCodec",
  parameterNames: ["Incoming", "Outgoing"],
  parameterBounds: [null, null],
  fields: new Map([
    ["decode", namedFunction(["message"], [realtimeWireType], realtimeCodecIncoming)],
    ["encode", namedFunction(["message"], [realtimeCodecOutgoing], realtimeWireType)],
  ]),
  readonlyFields: new Set(["decode", "encode"]),
};
const realtimeClientTemplate: GenericTypeInfo = {
  identity: realtimeClientIdentity,
  name: "RealtimeClient",
  parameterNames: ["T"],
  parameterBounds: [null],
  fields: new Map([
    ["state", namedFunction([], [], realtimeClientStateType)],
    ["generation", namedFunction([], [], numberType)],
    ["start", namedFunction([], [], promise(nullType))],
    ["whenOpen", namedFunction([], [], promise(numberType))],
    ["whenClosed", namedFunction([], [], promise(nullType))],
    ["send", namedFunction(["message"], [realtimeClientOutgoing], promise(nullType))],
    ["close", namedFunction(["code", "reason"], [numberType, stringType], promise(nullType), 0)],
  ]),
  readonlyFields: new Set(["state", "generation", "start", "whenOpen", "whenClosed", "send", "close"]),
};
const realtimeGenericTypes = new Map<string, GenericTypeInfo>([
  ["RealtimeCodec", realtimeCodecTemplate],
  ["RealtimeClient", realtimeClientTemplate],
]);
const realtimeFailureFields = new Map<string, ValueType>([
  ["phase", stringType],
  ["error", errorType],
  ["recoverable", boolType],
]);
const realtimeOpenFields = new Map<string, ValueType>([
  ["generation", numberType],
  ["reconnected", boolType],
]);
const realtimeClientOptions = object({
  connectTimeout: optional(durationType),
  maxMessageBytes: optional(numberType),
  maxQueuedMessages: optional(numberType),
  maxQueuedBytes: optional(numberType),
  maxPendingSendBytes: optional(numberType),
  reconnectDelays: optional({kind: "list", element: durationType}),
  reconnectJitter: optional(numberType),
  retryInitial: optional(boolType),
});
const realtimeClientOutput = realtimeClientOf(realtimeOutput);
const realtimeUrlType: ValueType = {kind: "union", members: [stringType, namedFunction([], [], stringType)]};
const realtimeReceive = namedFunction(["message", "client"], [realtimeInput, realtimeClientOutput], promise(nullType));
const realtimeOpened = namedFunction(["client", "open"], [realtimeClientOutput, realtimeOpenType], promise(nullType));
const realtimeFailed = namedFunction(["failure", "client"], [realtimeFailureType, realtimeClientOutput], promise(realtimeFailureActionType));
const realtimeClosed = namedFunction(["client", "close"], [realtimeClientOutput, webSocketCloseType], promise(nullType));
const realtimeStateChanged = namedFunction(["client", "state"], [realtimeClientOutput, realtimeClientStateType], promise(nullType));
const realtimeClientFunction: ValueType = {
  kind: "function",
  typeParameterNames: ["Incoming", "Outgoing"],
  parameterNames: ["url", "codec", "receive", "opened", "failed", "closed", "stateChanged", "options"],
  parameters: [
    realtimeUrlType,
    realtimeCodecOf(realtimeInput, realtimeOutput),
    realtimeReceive,
    optional(realtimeOpened),
    optional(realtimeFailed),
    optional(realtimeClosed),
    optional(realtimeStateChanged),
    realtimeClientOptions,
  ],
  requiredParameters: 3,
  result: realtimeClientOutput,
};
const realtimeUnavailableClass: ClassInfo = {
  identity: realtimeUnavailableIdentity,
  parameters: [stringType],
  parameterNames: ["message"],
  requiredParameters: 0,
  base: "Error",
  abstract: false,
  fields: new Map(),
  getters: new Set(),
  abstractGetters: new Set(),
  methods: new Map(),
  abstractMethods: new Set(),
  staticFields: new Map(),
  staticGetters: new Set(),
  staticMethods: new Map(),
};


export const webModuleInterfaces: ReadonlyMap<string, ModuleInterface> = new Map([
  ["velar/websocket", moduleInterface(
    new Map([
      ["WebSocketConnection", { kind: "typeObject", name: "WebSocketConnection", value: webSocketConnectionType }],
      ["WebSocketClose", { kind: "typeObject", name: "WebSocketClose", value: webSocketCloseType }],
      ...[...webSocketErrorIdentities].map(([name, identity]) => [name, { kind: "classConstructor", name, identity } as ValueType] as const),
      ["connect", namedFunction(["url", "options"], [stringType, webSocketConnectOptions], promise(webSocketConnectionType), 1)],
    ]),
    new Map([...webSocketErrorIdentities].map(([name, identity]) => [name, webSocketErrorClass(identity)])),
    new Map([
      ["WebSocketConnection", webSocketConnectionFields],
      ["WebSocketClose", webSocketCloseFields],
    ]),
    new Map([
      ["WebSocketConnection", webSocketConnectionIdentity],
      ["WebSocketClose", webSocketCloseIdentity],
    ]),
    new Map(),
    new Map([
      ["WebSocketConnection", new Set(webSocketConnectionFields.keys())],
      ["WebSocketClose", new Set(webSocketCloseFields.keys())],
    ]),
  )],
  ["velar/look", moduleInterface(lookModuleExports)],
  ["velar/app", moduleInterface(new Map([
    ["onError", namedFunction(["handler"], [functionType([appErrorType], unknownType)], cleanupType)],
    ["reportError", namedFunction(["error", "phase", "detail"], [errorType, stringType, stringType], nullType, 1)],
  ]))],
  ["velar/config", moduleInterface(new Map([
    ["publicConfig", namedIntrinsic("config.public", ["target"], [unknownType], unknownType)],
    ["has", namedFunction(["key"], [stringType], boolType)],
    ["keys", namedFunction([], [], arrayString)],
  ]))],
  ["velar/web", moduleInterface(new Map([
    ["RouteContext", { kind: "typeObject", name: "RouteContext" }],
    ["route", namedIntrinsic("web.route", ["path", "view"], [stringType, unknownType], routeType)],
    ["lazy", namedIntrinsic("web.lazy", ["loader", "exportName", "loading", "failed"], [functionType([], promise(unknownType)), stringType, unknownType, unknownType], unknownType, 2)],
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
    ["Router", webComponentConstructor("Router", new Map<string, ValueType>([["routes", { kind: "list", element: routeType }], ["fallback", unknownType]]), new Set(["routes"]), null, "web.router")],
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
    ["HttpResponseError", { kind: "classConstructor", name: "HttpResponseError" }],
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
    ["HttpResponseError", {
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
  ]), new Map(), new Map(), new Map([["HttpTransportPhase", { identity: httpTransportPhaseIdentity, members: httpTransportPhaseMembers, wireValues: httpTransportPhaseWireValues }]]))],
  ["velar/storage", moduleInterface(new Map([
    ["storage", storageType],
    ["session", storageType],
    ["database", namedFunction(["name"], [stringType], databaseType)],
    ["StorageQuotaError", { kind: "classConstructor", name: "StorageQuotaError", identity: storageQuotaErrorIdentity }],
    ["StorageTransactionError", { kind: "classConstructor", name: "StorageTransactionError", identity: storageTransactionErrorIdentity }],
    ["StorageUpgradeError", { kind: "classConstructor", name: "StorageUpgradeError", identity: storageUpgradeErrorIdentity }],
  ]), new Map([
    ["StorageQuotaError", storageErrorClass(storageQuotaErrorIdentity)],
    ["StorageTransactionError", storageErrorClass(storageTransactionErrorIdentity)],
    ["StorageUpgradeError", storageErrorClass(storageUpgradeErrorIdentity)],
  ]))],
  ["velar/forms", moduleInterface(new Map([
    ["values", namedFunction(["form"], [elementType], formValuesType)],
    ["read", namedIntrinsic("forms.read", ["form", "target"], [elementType, unknownType], unknownType)],
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
    ["after", namedFunction(["duration", "callback"], [durationType, functionType([], unknownType)], cleanupType)],
    ["location", namedFunction([], [], browserLocationType)],
    ["environment", namedFunction([], [], browserEnvironmentType)],
    // D104 rule 4: the two halves of the system clipboard read as a pair. The
    // write used to be `copyText`, and a consumer surveying this table for a
    // "copy this answer" button found `readClipboardText`, `clipboardText` and
    // `setClipboardText` — a read and an event pair — and concluded the module
    // could not write. The capability was there under a name that did not
    // answer the question being asked, which is the same defect as a missing
    // capability from where the author is standing.
    ["readClipboardText", namedFunction([], [], promise(stringType))],
    ["writeClipboardText", namedFunction(["value"], [stringType], promise(nullType))],
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
    ["watchIntersection", namedFunction(["element", "callback", "options"], [webElementType, functionType([intersectionEntryType], unknownType), intersectionOptionsType], cleanupType, 2)],
    ["watchMedia", namedFunction(["query", "callback"], [stringType, functionType([boolType], unknownType)], cleanupType)],
    ["watchOnline", namedFunction(["callback"], [functionType([boolType], unknownType)], cleanupType)],
    ["watchVisibility", namedFunction(["callback"], [functionType([boolType], unknownType)], cleanupType)],
    ["showDialog", namedFunction(["dialog"], [dialogElementType], nullType)],
    ["closeDialog", namedFunction(["dialog", "result"], [dialogElementType, stringType], nullType, 1)],
    ["dialogResult", namedFunction(["dialog"], [dialogElementType], stringType)],
    ["every", namedFunction(["duration", "callback"], [durationType, functionType([], unknownType)], cleanupType)],
    ["frame", namedFunction([], [], promise(numberType))],
  ]))],
  ["velar/files", moduleInterface(new Map([
    ["pick", namedFunction(["options"], [fileOptionsType], promise(fileArrayType), 0)],
    ["readText", namedFunction(["file", "maxBytes"], [fileType, numberType], promise(stringType), 1)],
    ["readDataUrl", namedFunction(["file", "maxBytes"], [fileType, numberType], promise(stringType), 1)],
    ["download", namedFunction(["name", "data", "mime"], [stringType, stringType, stringType], nullType, 2)],
  ]))],
  ["velar/realtime", moduleInterface(
    new Map([
      ["RealtimeClient", {kind: "typeObject", name: "RealtimeClient", value: realtimeClientOf(realtimeClientOutgoing)}],
      ["RealtimeClientFailureAction", {kind: "enumObject", name: "RealtimeClientFailureAction", identity: realtimeFailureActionIdentity, members: realtimeFailureActions}],
      ["RealtimeClientState", {kind: "enumObject", name: "RealtimeClientState", identity: realtimeClientStateIdentity, members: realtimeClientStates}],
      ["RealtimeCodec", {kind: "typeObject", name: "RealtimeCodec", value: realtimeCodecOf(realtimeCodecIncoming, realtimeCodecOutgoing)}],
      ["RealtimeFailure", {kind: "typeObject", name: "RealtimeFailure", value: realtimeFailureType}],
      ["RealtimeOpen", {kind: "typeObject", name: "RealtimeOpen", value: realtimeOpenType}],
      ["RealtimeUnavailableError", {kind: "classConstructor", name: "RealtimeUnavailableError", identity: realtimeUnavailableIdentity}],
      ["eventStream", namedFunction(["url", "handlers", "credentials"], [stringType, eventStreamHandlersType, boolType], eventStreamType, 1)],
      ["realtimeClient", realtimeClientFunction],
    ]),
    new Map([["RealtimeUnavailableError", realtimeUnavailableClass]]),
    new Map([
      ["RealtimeFailure", realtimeFailureFields],
      ["RealtimeOpen", realtimeOpenFields],
    ]),
    new Map([
      ["RealtimeFailure", realtimeFailureIdentity],
      ["RealtimeOpen", realtimeOpenIdentity],
    ]),
    new Map([
      ["RealtimeClientFailureAction", {identity: realtimeFailureActionIdentity, members: realtimeFailureActions, wireValues: new Map([...realtimeFailureActions].map((member) => [member, member]))}],
      ["RealtimeClientState", {identity: realtimeClientStateIdentity, members: realtimeClientStates, wireValues: new Map([...realtimeClientStates].map((member) => [member, member]))}],
    ]),
    new Map([
      ["RealtimeFailure", new Set(realtimeFailureFields.keys())],
      ["RealtimeOpen", new Set(realtimeOpenFields.keys())],
    ]),
    realtimeGenericTypes,
  )],
  [BROWSER_TEST_MODULE, moduleInterface(new Map([
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
  namedTypeReadonlyFields: ReadonlyMap<string, ReadonlySet<string>> = new Map(),
  genericTypes: NonNullable<ModuleInterface["genericTypes"]> = new Map(),
): ModuleInterface {
  return { exports, mutableExports: new Set(), reactiveExports: new Map(), reExports: new Map(), namedTypes, namedTypeReadonlyFields, namedTypeIdentities, genericTypes, typeAliases: new Map(), enums, classes, tests: [], extensionExports: new Map(), extensionData: new Map() };
}

const webLookHookDocumentation = Object.fromEntries([...LOOK_HOOKS].map((name) => [
  `@${name}`,
  [
    `Matches the element's compiler-owned \`${name}\` state inside a \`look:\` condition. It is not a decorator, variable, or runtime callback.`,
    "",
    "```velar",
    `if @${name}:`,
    "    color = \"blue\"",
    "```",
    "",
    "The condition lowers to the corresponding live CSS state. A Look literal cannot read reactive application state; apply a different Look from JSX for that.",
  ].join("\n"),
]));

const webLookTargetDocumentation = Object.fromEntries([...LOOK_TARGETS].map((name) => [
  `@${name}`,
  [
    `Selects the compiler-owned \`::${name}\` visual target inside a \`look:\` value. It is not a decorator or user-defined nested selector.`,
    "",
    "```velar",
    `@${name}:`,
    "    content = \"\"",
    "```",
    "",
    "Only the closed target vocabulary accepted by the Web compiler is available, and every nested property remains checked by Look.",
  ].join("\n"),
]));

const webKeywordDocumentation = Object.freeze({
  component: "Declares a compiler-managed Web component. Props are its parameters, the body initializes once per mounted instance, and JSX is returned directly.\n\n```velar\ncomponent Greeting(name: string):\n    return <p>Hello {name}</p>\n```",
  state: "Declares writable reactive state. Reading it records a dependency and assigning it schedules the owning Web update.\n\n```velar\nstate count = 0\n```",
  computed: "Declares a read-only reactive value derived synchronously from what its initializer reads. Read the value directly; it is not a function.\n\n```velar\ncomputed doubled = count * 2\n```",
  resource: "Declares component-owned asynchronous data with reactive `value`, `loading`, `ready`, `error`, and `reload` fields.\n\n```velar\nresource article: Article = loadArticle(id)\n```",
  action: "Declares an asynchronous user operation with reactive `pending` and `error` fields.\n\n```velar\naction save():\n    await saveDraft(draft)\n```",
  watch: "Runs after the watched reactive path changes and the corresponding DOM update commits. Watch a state/computed path, not an arbitrary effectful expression.\n\n```velar\nwatch query as current, previous:\n    print(f\"{previous} -> {current}\")\n```",
  "@mounted": "Runs once after the component DOM has been inserted. It is a compiler-owned component lifecycle role, not a decorator or callable hook, and its body may `await`.\n\n```velar\n@mounted:\n    await focusInitialField()\n```",
  "@cleanup": "Runs once before the component and its owned resources are destroyed. It is a compiler-owned component lifecycle role, not a decorator or callable hook, and cleanup is synchronous.\n\n```velar\n@cleanup:\n    subscription.close()\n```",
  exposes: "Declares the explicit typed Handle a component permits a parent to receive through JSX `ref`.\n\n```velar\ncomponent Dialog() exposes DialogHandle:\n```",
  expose: "Provides the Handle value promised by the component's `exposes` clause.\n\n```velar\nexpose {open, close}\n```",
  look: "Builds a typed, composable Web appearance value. Properties, units, conditions, targets, and imported `velar/look` builders are checked by the compiler.\n\n```velar\nconst card = look:\n    padding = 16px\n    if @hover:\n        color = \"blue\"\n```",
  keyframes: "Builds checked animation stops as a first-class `Keyframes` value for the `animate` builder.\n\n```velar\nconst spin = keyframes:\n    from:\n        rotate = 0deg\n    to:\n        rotate = 1turn\n```",
  css: "Marks an explicit unsafe native CSS import or raw block. Prefer Look; when CSS is necessary, its order before or after generated Look output must be stated in source.",
  "jsx:on:*": "Attaches a checked DOM event handler. Write `on:event` and optional `.prevent`, `.stop`, `.once`, `.capture`, or `.self` modifiers.\n\n```velar\n<button on:click.prevent={save}>Save</button>\n```",
  "jsx:bind:value": "Two-way binds the value of an input, textarea, or select to writable state.\n\n```velar\n<input bind:value={name} />\n```",
  "jsx:bind:checked": "Two-way binds an input's checked flag to writable bool state.\n\n```velar\n<input type=\"checkbox\" bind:checked={enabled} />\n```",
  "jsx:bind:group": "Binds a radio choice or checkbox group to writable group state using the element's checked value contract.",
  "jsx:class:*": "Adds or removes one CSS class from a bool expression. The suffix is the class name.\n\n```velar\n<section class:active={selected}></section>\n```",
  "jsx:look": "Applies a `Look`, optional Look, or ordered list of Look values to this JSX element.\n\n```velar\n<article look={cardLook}></article>\n```",
  "jsx:look:*": "Applies one checked Look property as a normal-priority JSX visual directive. Prefer a named Look for conditions, targets, or several properties.",
  "jsx:style:*": "Applies one checked high-priority inline visual override. Prefer Look for ordinary styling.",
  "jsx:ref": "Stores the mounted native element or exposed component Handle in a mutable optional `let` binding, then restores `null` during cleanup.",
  "jsx:key": "Gives a repeated JSX child stable identity. Keys must be strings, numbers, or string-backed enum values and must be stable across renders.",
  "jsx:host": "Marks the one native element that receives a component's forwarded host attributes and events.",
  "jsx:unsafe:html": "Writes explicitly unsafe HTML text into a native element. The value must be string or string?; use ordinary JSX for trusted structured content.",
  ...webLookHookDocumentation,
  ...webLookTargetDocumentation,
  ...webLookPropertyDocumentation,
});

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
