import { optionalOf, type ValueType } from "@velarscript/compiler";
import { stringType, nullType, optionalStringType, functionType, promiseOf, objectType, moduleInterface, enumEntry } from "./types.ts";

// `velar/notification` — system notification delivery and the activations it
// produces. The manifest's `notifications` flag is the declaration of intent;
// the operating system still asks the user, and `requestPermission` is how the
// application learns that answer.
export const notificationPermission = enumEntry("velar/notification", "NotificationPermission", ["granted", "denied", "undetermined"]);
const notificationActivationStreamType: ValueType = { kind: "named", name: "NotificationActivationStream", identity: "velar/notification#type:NotificationActivationStream" };
const notificationActivationType = objectType({ tag: optionalStringType }, ["tag"]);
export const notificationInputType = objectType({ title: stringType, body: stringType, tag: optionalStringType }, ["tag"]);

export const notificationModuleInterface = moduleInterface(
  new Map<string, ValueType>([
    ["NotificationActivation", { kind: "typeObject", name: "NotificationActivation" }],
    ["NotificationActivationStream", { kind: "typeObject", name: "NotificationActivationStream" }],
    ["NotificationPermission", notificationPermission.object],
    ["requestPermission", functionType([], promiseOf(notificationPermission.value))],
    ["show", functionType([notificationInputType], promiseOf(nullType))],
    ["activations", functionType([], promiseOf(notificationActivationStreamType))],
  ]),
  new Map([
    ["NotificationActivationStream", new Map<string, ValueType>([
      ["next", functionType([], promiseOf(optionalOf(notificationActivationType)))],
      ["close", functionType([], promiseOf(nullType))],
    ])],
  ]),
  new Map([["NotificationActivationStream", "velar/notification#type:NotificationActivationStream"]]),
  new Map([["NotificationPermission", notificationPermission.info]]),
  new Map([["NotificationActivation", notificationActivationType]]),
);
