import { optionalOf, type ValueType } from "@velarscript/compiler";
import { stringType, numberType, nullType, optionalStringType, functionType, promiseOf, objectType, moduleInterface } from "./types.ts";

// under the product's own policy.
//
// `ServiceConnection` keeps the `velar/websocket` client's discipline — a send
// that is backpressured, a receive that is a bounded pull, and a release that
// `using` performs — under its own identity, because the peer is a process this
// host dialed and authenticated rather than a URL an author named. It carries
// text: the Desktop bridge has never carried bytes, and a service channel is not
// where that would be decided.
const serviceStateIdentity = "velar/service#enum:ServiceState";
const serviceStateMembers = new Set(["starting", "ready", "restarting", "failed", "stopped"]);
const serviceStateWireValues = new Map([...serviceStateMembers].map((member) => [member, member]));
export const serviceStateType: ValueType = { kind: "enum", name: "ServiceState", identity: serviceStateIdentity };
const serviceConnectionType: ValueType = { kind: "named", name: "ServiceConnection", identity: "velar/service#type:ServiceConnection" };
const serviceStateStreamType: ValueType = { kind: "named", name: "ServiceStateStream", identity: "velar/service#type:ServiceStateStream" };
const serviceCloseType = objectType({ code: numberType, reason: stringType });
// `detail` is the only thing the language says about the *inside* of a service,
// and it says it for the two states where an application has a person to answer
// to: a bounded tail of what the process wrote to stderr on the way down. It is
// diagnostic text and nothing else — never parsed, never matched on — and it is
// null for every other state, because a service that is starting or running or
// converging has not failed at anything worth quoting.
const serviceStateEventType = objectType({ name: stringType, state: serviceStateType, detail: optionalStringType });

export const serviceModuleInterface = moduleInterface(
  new Map<string, ValueType>([
    ["ServiceClose", { kind: "typeObject", name: "ServiceClose" }],
    ["ServiceConnection", { kind: "typeObject", name: "ServiceConnection" }],
    ["ServiceState", { kind: "enumObject", name: "ServiceState", identity: serviceStateIdentity, members: serviceStateMembers }],
    ["ServiceStateEvent", { kind: "typeObject", name: "ServiceStateEvent" }],
    ["ServiceStateStream", { kind: "typeObject", name: "ServiceStateStream" }],
    ["connect", functionType([stringType], promiseOf(serviceConnectionType))],
    ["watchServices", functionType([], promiseOf(serviceStateStreamType))],
  ]),
  new Map([
    ["ServiceConnection", new Map<string, ValueType>([
      ["state", functionType([], promiseOf(stringType))],
      ["send", functionType([stringType], promiseOf(nullType))],
      ["next", functionType([], promiseOf(optionalStringType))],
      ["closeInfo", functionType([], promiseOf(serviceCloseType))],
      ["close", functionType([numberType, stringType], promiseOf(nullType), 0)],
    ])],
    ["ServiceStateStream", new Map<string, ValueType>([
      ["next", functionType([], promiseOf(optionalOf(serviceStateEventType)))],
      ["close", functionType([], promiseOf(nullType))],
    ])],
  ]),
  new Map([
    ["ServiceConnection", "velar/service#type:ServiceConnection"],
    ["ServiceStateStream", "velar/service#type:ServiceStateStream"],
  ]),
  new Map([
    ["ServiceState", { identity: serviceStateIdentity, members: serviceStateMembers, wireValues: serviceStateWireValues }],
  ]),
  new Map([["ServiceClose", serviceCloseType], ["ServiceStateEvent", serviceStateEventType]]),
);
