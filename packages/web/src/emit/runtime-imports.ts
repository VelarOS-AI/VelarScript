/**
 * Which runtime a Web program carries, and which of the compiler's own helpers
 * a Web lowering replaces.
 *
 * D115 P4 R3d: every one of these is a seam `JavaScriptEmitter` already asks
 * about — "does this module need the file-type helper", "what does an `is`
 * check on `Element` compile to" — so the family answers for Web and leaves the
 * base's answer to the host, which is the one thing a collaborator cannot call
 * for itself.
 */
import type { Expression, ValueType } from "@velarscript/compiler/extension";
import { VELAR_ERROR_NORMALIZATION_MODULE, VELAR_RUNTIME_REGISTRY_KEY } from "@velarscript/compiler/extension";
import { type WebLookEntry as LookEntry } from "../ast.ts";
import { cssPropertyName, LOOK_PROPERTY_KEYWORDS } from "../look.ts";
import {
  CSS_STRING_RUNTIME_BODY, LOOK_ARITHMETIC_RUNTIME, WEB_FILE_TYPE_RUNTIME,
  WEB_LOCAL_REACTIVE_BRIDGE_RUNTIME, WEB_LOCAL_REACTIVE_COLLECTION_BRIDGE_RUNTIME,
  WEB_RUNTIME_BODY, WEB_RUNTIME_FOUNDATION, WEB_RUNTIME_FOUNDATION_SHARED_ERROR,
} from "../runtime-sources.generated.ts";

/**
 * What runtime-import selection reads on the emitter, plus the four base-class
 * answers a collaborator has no `super` of its own to ask for. `webOutput` and
 * the two `needs…` flags are live: `emitTypeCheck` sets one while statements
 * are still being emitted, and `additionalHelpers` reads it afterwards.
 */
export interface RuntimeImportHost {
  readonly lookKeywordProperties: ReadonlySet<string>;
  needsFileTypeHelper: boolean;
  readonly needsLookArithmeticRuntime: boolean;
  readonly webOutput: boolean;
  baseDetachedTaskHelpers(): readonly string[];
  baseIsCheck(type: ValueType, value: string): string;
  baseReactiveBridgeHelpers(
    needsJavaScriptCallBoundary: boolean,
    needsCollections: boolean,
    usedIdentifiers: ReadonlySet<string>,
  ): readonly string[];
  baseTypeCheck(type: ValueType, value: string, state: string): string;
  requireRuntimeModule(source: string): void;
  usesSharedRuntimeModules(): boolean;
}

export function emitTypeCheck(host: RuntimeImportHost, type: ValueType, value: string, state: string): string {
  if (type.kind === "named") {
    if (type.name === "Event" || type.name === "KeyboardEvent" || type.name === "PointerEvent" || type.name === "InputEvent" || type.name === "CompositionEvent" || type.name === "ClipboardEvent") {
      return `(typeof ${type.name} !== "undefined" && ${value} instanceof ${type.name})`;
    }
    if (type.name === "Element") return `(typeof Element !== "undefined" && ${value} instanceof Element)`;
    if (type.name === "CanvasElement") return `(typeof HTMLCanvasElement !== "undefined" && ${value} instanceof HTMLCanvasElement)`;
    if (type.name === "DialogElement") return `(typeof HTMLDialogElement !== "undefined" && ${value} instanceof HTMLDialogElement)`;
    if (type.name === "InputElement") {
      return `((typeof HTMLInputElement !== "undefined" && ${value} instanceof HTMLInputElement) || (typeof HTMLSelectElement !== "undefined" && ${value} instanceof HTMLSelectElement) || (typeof HTMLTextAreaElement !== "undefined" && ${value} instanceof HTMLTextAreaElement))`;
    }
    if (type.name === "TextAreaElement") return `(typeof HTMLTextAreaElement !== "undefined" && ${value} instanceof HTMLTextAreaElement)`;
    if (type.name === "Blob") return `(typeof Blob !== "undefined" && ${value} instanceof Blob)`;
    if (type.name === "File") {
      host.needsFileTypeHelper = true;
      return `__velarFileTypeIs(${value})`;
    }
  }
  return host.baseTypeCheck(type, value, state);
}

export function emitIsCheck(host: RuntimeImportHost, type: ValueType, value: string): string {
  if (type.kind === "named" && (
    type.name === "Event"
    || type.name === "KeyboardEvent"
    || type.name === "PointerEvent"
    || type.name === "InputEvent"
    || type.name === "CompositionEvent"
    || type.name === "ClipboardEvent"
    || type.name === "Element"
    || type.name === "CanvasElement"
    || type.name === "DialogElement"
    || type.name === "InputElement"
    || type.name === "TextAreaElement"
    || type.name === "Blob"
    || type.name === "File"
  )) return emitTypeCheck(host, type, value, "undefined");
  return host.baseIsCheck(type, value);
}

export function additionalHelpers(host: RuntimeImportHost): readonly string[] {
  return [
    ...(host.needsLookArithmeticRuntime ? [LOOK_ARITHMETIC_RUNTIME] : []),
    ...(host.webOutput ? webRuntimeHelpers(host) : []),
    ...(host.needsFileTypeHelper ? [WEB_FILE_TYPE_RUNTIME] : []),
  ];
}

function webRuntimeHelpers(host: RuntimeImportHost): readonly string[] {
  if (!host.usesSharedRuntimeModules()) return [webRuntime(WEB_RUNTIME_FOUNDATION, lookKeywordTable(host))];
  host.requireRuntimeModule(VELAR_ERROR_NORMALIZATION_MODULE);
  return [
    `import { errorApply as __velarErrorApply, errorCode as __velarErrorCode, isError as __velarIsError, normalizeError as __velarNormalizeError } from ${JSON.stringify(VELAR_ERROR_NORMALIZATION_MODULE)};`,
    webRuntime(WEB_RUNTIME_FOUNDATION_SHARED_ERROR, lookKeywordTable(host)),
  ];
}

/**
 * The closed keyword sets of the properties this module styles, so a value
 * the compiler could not read is still checked before it reaches the DOM.
 * Only the properties written here ship: the whole table is 17 KiB, and a
 * module pays for the properties it uses.
 */
function lookKeywordTable(host: RuntimeImportHost): string {
  const entries = [...host.lookKeywordProperties].sort()
    .map((name) => `  ${JSON.stringify(cssPropertyName(name))}: ${JSON.stringify([...LOOK_PROPERTY_KEYWORDS.get(name) ?? []])},`);
  return entries.length === 0
    ? "const __velarLookKeywords = { __proto__: null };"
    : `const __velarLookKeywords = {\n  __proto__: null,\n${entries.join("\n")}\n};`;
}

export function reactiveBridgeHelpers(
  host: RuntimeImportHost,
  needsJavaScriptCallBoundary: boolean,
  needsCollections: boolean,
  usedIdentifiers: ReadonlySet<string>,
): readonly string[] {
  if (host.usesSharedRuntimeModules()) return host.baseReactiveBridgeHelpers(needsJavaScriptCallBoundary, needsCollections, usedIdentifiers);
  if (!host.webOutput) return host.baseReactiveBridgeHelpers(needsJavaScriptCallBoundary, needsCollections, usedIdentifiers);
  if (!needsJavaScriptCallBoundary && !needsCollections) return [];
  return [WEB_LOCAL_REACTIVE_BRIDGE_RUNTIME, ...(needsCollections ? [WEB_LOCAL_REACTIVE_COLLECTION_BRIDGE_RUNTIME] : [])];
}

export function includesErrorNormalizationRuntime(host: RuntimeImportHost): boolean {
  return host.webOutput;
}

// Web detached tasks report through the velar/app error chain with the
// distinct "detached" phase. The runtime registry is looked up at report
// time (module-level tasks can finish before or after the application
// runtime installs); the captured microtask throw keeps a failure loud when
// no runtime exists yet, and 'unhandled: true' keeps it loud when no
// onError handler is installed. Host operations are captured at module
// initialization, matching the owned-callback discipline.
export function detachedTaskHelpers(host: RuntimeImportHost): readonly string[] {
  // A module with no Web syntax emits no Web runtime, so it must keep Core's
  // host reporting: the browser path would route a detached failure through a
  // runtime registry that never gets installed and end in a microtask throw,
  // which under `velar test` kills the whole Node test process.
  if (!host.webOutput) return host.baseDetachedTaskHelpers();
  return [[
    `const __velarDetachedRegistryKey = Symbol.for(${JSON.stringify(VELAR_RUNTIME_REGISTRY_KEY)});`,
    "const __velarDetachedPromiseThen = globalThis.Promise.prototype.then;",
    "const __velarDetachedApply = Reflect.apply;",
    "const __velarDetachedEnqueue = queueMicrotask;",
    "function __velarDetachedReport(failure) {",
    "  const error = __velarNormalizeError(failure);",
    "  const runtime = globalThis[__velarDetachedRegistryKey];",
    "  if (runtime && typeof runtime.report === \"function\") {",
    "    // An action reports its own failure once, in the action phase with",
    "    // the action's name as detail. The detached observer of that same",
    "    // rejection must not report it a second time.",
    "    try {",
    "      if (__velarIsError(failure) && __velarGraphWeakSetRemove(runtime.actionFailures, failure)) return;",
    "    } catch {}",
    "    runtime.report(error, { phase: \"detached\", detail: \"\", unhandled: true });",
    "    return;",
    "  }",
    "  __velarDetachedApply(__velarDetachedEnqueue, globalThis, [() => { throw error; }]);",
    "}",
    "function __velarDetachedTask(task) {",
    // D114 W2: the one place a detached Promise enters the Web runtime, and
    // so the one place the reactive window can be told that an observer run
    // started asynchronous work. The runtime foundation decides whether a run
    // is in progress; this site only reports the fact.
    "  __velarNoteAsyncWork();",
    "  __velarDetachedApply(__velarDetachedPromiseThen, task, [null, __velarDetachedReport]);",
    "  return null;",
    "}",
  ].join("\n")];
}

export function visitLookExpressions(entries: readonly LookEntry[], visit: (expression: Expression) => void): void {
  for (const entry of entries) {
    if (entry.kind === "LookProperty" || entry.kind === "LookSpread") visit(entry.value);
    else if (entry.kind === "LookIf") {
      visit(entry.condition);
      visitLookExpressions(entry.thenEntries, visit);
      visitLookExpressions(entry.elseEntries, visit);
    } else visitLookExpressions(entry.entries, visit);
  }
}

export function containsUnitLiteral(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  if (record.kind === "ExtensionExpression:web:unit") return true;
  for (const child of Object.values(record)) {
    if (Array.isArray(child)) {
      if (child.some(containsUnitLiteral)) return true;
    } else if (containsUnitLiteral(child)) return true;
  }
  return false;
}

export function containsWebSyntax(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  if (record.kind === "ExtensionStatement:web:component" || record.kind === "ExtensionStatement:web:expose" || record.kind === "ExtensionStatement:web:unsafe-css" || record.kind === "ExtensionExpression:web:look" || record.kind === "ExtensionExpression:web:keyframes" || record.kind === "ExtensionExpression:web:jsx"
    || record.kind === "ExtensionStatement:web:state" || record.kind === "ExtensionStatement:web:computed" || record.kind === "ExtensionStatement:web:resource" || record.kind === "ExtensionStatement:web:action" || record.kind === "ExtensionStatement:web:watch") return true;
  if (record.kind === "IdentifierExpression" && (record.name === "mount" || record.name === "tick")) return true;
  return Object.values(record).some((child) => Array.isArray(child) ? child.some(containsWebSyntax) : containsWebSyntax(child));
}

/**
 * The runtime an emitted Web program carries inside itself: the foundation it
 * installs, the CSS string serializer, the closed keyword sets of the Look
 * properties *this* module styles, and the runtime body. Only the keyword table
 * differs per compilation, which is why it is the one hole
 * `runtime/manifest.json` records as an assembly (LOK-U13 keeps the serializer
 * the one css-string.ts publishes rather than a second spelling of it).
 */
function webRuntime(foundation: string, lookKeywords: string): string {
  return `${foundation}\n${CSS_STRING_RUNTIME_BODY}${lookKeywords}\n${WEB_RUNTIME_BODY}`;
}
