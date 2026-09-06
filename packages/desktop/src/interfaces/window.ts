import { optionalOf, type ValueType } from "@velarscript/compiler";
import { stringType, boolType, nullType, optionalStringType, functionType, promiseOf, listOf, objectType, moduleInterface, windowBoundsType, displayType } from "./types.ts";

// `velar/window` — the Desktop window surface. A window kind is declared in
// `desktop.windows`; nothing here invents one. The handle families follow the
// two contracts the rest of the target already keeps: an owned resource is
// released by `close()` (charter section 16, so `using` supplies the release),
// and an event source is a bounded pull stream with no callback registry, the
// same shape `velar/fs.watchFiles` publishes.
const windowStateIdentity = "velar/window#enum:WindowState";
const windowStateMembers = new Set(["moved", "resized", "focused", "blurred", "closed"]);
const windowStateWireValues = new Map([...windowStateMembers].map((member) => [member, member]));
const windowStateType: ValueType = { kind: "enum", name: "WindowState", identity: windowStateIdentity };
const windowType: ValueType = { kind: "named", name: "Window", identity: "velar/window#type:Window" };
const windowStateStreamType: ValueType = { kind: "named", name: "WindowStateStream", identity: "velar/window#type:WindowStateStream" };
export const windowInfoType = objectType({ kind: stringType, key: optionalStringType, focused: boolType });
const openWindowOptionsType = objectType({
  route: stringType,
  key: optionalStringType,
  bounds: optionalOf(windowBoundsType),
}, ["key", "bounds"]);

export const windowModuleInterface = moduleInterface(
  new Map<string, ValueType>([
    ["Window", { kind: "typeObject", name: "Window" }],
    ["WindowBounds", { kind: "typeObject", name: "WindowBounds" }],
    ["WindowState", { kind: "enumObject", name: "WindowState", identity: windowStateIdentity, members: windowStateMembers }],
    ["WindowStateStream", { kind: "typeObject", name: "WindowStateStream" }],
    ["currentWindowKind", functionType([], stringType)],
    ["currentWindow", functionType([], windowType)],
    ["openWindow", functionType([stringType, openWindowOptionsType], promiseOf(windowType))],
    ["windows", functionType([], promiseOf(listOf(windowInfoType)))],
  ]),
  new Map([
    ["Window", new Map<string, ValueType>([
      ["focus", functionType([], promiseOf(nullType))],
      ["close", functionType([], promiseOf(nullType))],
      ["bounds", functionType([], promiseOf(windowBoundsType))],
      ["setBounds", functionType([windowBoundsType], promiseOf(nullType))],
      // The same `Display` record `velar/desktop.displays()` publishes by name.
      ["display", functionType([], promiseOf(displayType))],
      ["watchState", functionType([], promiseOf(windowStateStreamType))],
    ])],
    ["WindowStateStream", new Map<string, ValueType>([
      ["next", functionType([], promiseOf(optionalOf(windowStateType)))],
      ["close", functionType([], promiseOf(nullType))],
    ])],
  ]),
  new Map([
    ["Window", "velar/window#type:Window"],
    ["WindowStateStream", "velar/window#type:WindowStateStream"],
  ]),
  new Map([
    ["WindowState", { identity: windowStateIdentity, members: windowStateMembers, wireValues: windowStateWireValues }],
  ]),
  new Map([["WindowBounds", windowBoundsType]]),
);

// `velar/service` — the channel to the long-running processes
// `desktop.services` declares. The language owns four things here: the
// declaration, the supervision, the convergence, and one authenticated loopback
// channel. It owns nothing inside the service, which is the product's own code
