import { optionalOf as optional, type ClassInfo, type GenericTypeInfo, type ModuleInterface, type ValueType } from "@velarscript/compiler";
import { nullType, stringType, numberType, boolType, durationType, apiFunction, promise, moduleInterface } from "./types.ts";

const cancellationIdentity = "velar/task#type:Cancellation";
const taskIdentity = "velar/task#type:Task";
const channelIdentity = "velar/task#type:Channel";
export const cancellationType: ValueType = { kind: "named", name: "Cancellation", identity: cancellationIdentity };
const taskElementType: ValueType = { kind: "parameter", name: "T", index: 0 };
const taskOf = (value: ValueType): ValueType => ({
  kind: "named",
  name: `Task<${value.kind === "parameter" ? value.name : "T"}>`,
  identity: taskIdentity,
  application: { declaration: taskIdentity, name: "Task", arguments: [value] },
});
const taskTemplate: GenericTypeInfo = {
  identity: taskIdentity,
  name: "Task",
  parameterNames: ["T"],
  parameterBounds: [null],
  fields: new Map([
    ["result", apiFunction([], [], promise(taskElementType))],
    ["cancel", apiFunction(["reason"], [stringType], promise(nullType), 0)],
    ["close", apiFunction([], [], promise(nullType))],
  ]),
  readonlyFields: new Set(["result", "cancel", "close"]),
};
const channelOf = (value: ValueType): ValueType => ({
  kind: "named",
  name: `Channel<${value.kind === "parameter" ? value.name : "T"}>`,
  identity: channelIdentity,
  application: { declaration: channelIdentity, name: "Channel", arguments: [value] },
});
const channelTemplate: GenericTypeInfo = {
  identity: channelIdentity,
  name: "Channel",
  parameterNames: ["T"],
  parameterBounds: [null],
  fields: new Map([
    ["capacity", numberType],
    ["size", numberType],
    ["closed", boolType],
    ["send", {kind: "function", parameterNames: ["value", "cancellation"], parameters: [taskElementType, optional(cancellationType)], requiredParameters: 1, result: promise(nullType)}],
    ["trySend", apiFunction(["value"], [taskElementType], boolType)],
    ["next", {kind: "function", parameterNames: ["cancellation"], parameters: [optional(cancellationType)], requiredParameters: 0, result: promise(optional(taskElementType))}],
    ["close", apiFunction([], [], nullType)],
  ]),
  readonlyFields: new Set(["capacity", "size", "closed", "send", "trySend", "next", "close"]),
};
const cancellationFields = new Map([
  ["cancelled", boolType],
  ["reason", optional(stringType)],
  ["checkpoint", apiFunction([], [], promise(nullType))],
]);
export const taskErrorClass = (identity: string): ClassInfo => ({
  identity,
  parameters: [stringType], parameterNames: ["message"], requiredParameters: 0,
  base: "Error", abstract: false,
  fields: new Map(), getters: new Set(), abstractGetters: new Set(), methods: new Map(), abstractMethods: new Set(),
  staticFields: new Map(), staticGetters: new Set(), staticMethods: new Map(),
});
const cancellationErrorIdentity = "velar/task#class:CancellationError";
const taskTimeoutErrorIdentity = "velar/task#class:TaskTimeoutError";
const channelClosedErrorIdentity = "velar/task#class:ChannelClosedError";
const channelBackpressureErrorIdentity = "velar/task#class:ChannelBackpressureError";

/** `velar/task`: tasks, channels, cancellation, and the errors they raise. */
export const taskModuleInterface: ModuleInterface = moduleInterface(
  new Map([
    ["Cancellation", { kind: "typeObject", name: "Cancellation", value: cancellationType }],
    ["Task", { kind: "typeObject", name: "Task" }],
    ["Channel", { kind: "typeObject", name: "Channel" }],
    ["CancellationError", { kind: "classConstructor", name: "CancellationError", identity: cancellationErrorIdentity }],
    ["TaskTimeoutError", { kind: "classConstructor", name: "TaskTimeoutError", identity: taskTimeoutErrorIdentity }],
    ["ChannelClosedError", { kind: "classConstructor", name: "ChannelClosedError", identity: channelClosedErrorIdentity }],
    ["ChannelBackpressureError", { kind: "classConstructor", name: "ChannelBackpressureError", identity: channelBackpressureErrorIdentity }],
    ["task", { kind: "function", typeParameterNames: ["T"], parameterNames: ["work", "parent"], parameters: [
      { kind: "function", parameterNames: ["cancellation"], parameters: [cancellationType], requiredParameters: 1, result: promise(taskElementType) },
      optional(cancellationType),
    ], requiredParameters: 1, result: taskOf(taskElementType) }],
    ["withTimeout", { kind: "function", typeParameterNames: ["T"], parameterNames: ["source", "duration"], parameters: [taskOf(taskElementType), durationType], requiredParameters: 2, result: promise(taskElementType) }],
    ["channel", { kind: "function", typeParameterNames: ["T"], parameterNames: ["Type", "capacity"], parameters: [{ kind: "runtimeType", value: taskElementType }, numberType], requiredParameters: 1, result: channelOf(taskElementType) }],
  ]),
  new Map([
    ["CancellationError", taskErrorClass(cancellationErrorIdentity)],
    ["TaskTimeoutError", taskErrorClass(taskTimeoutErrorIdentity)],
    ["ChannelClosedError", taskErrorClass(channelClosedErrorIdentity)],
    ["ChannelBackpressureError", taskErrorClass(channelBackpressureErrorIdentity)],
  ]),
  new Map([["Cancellation", cancellationFields]]),
  new Map(),
  new Map([["Cancellation", new Set(["cancelled", "reason", "checkpoint"])]]),
  new Map([["Cancellation", cancellationIdentity]]),
  new Map(),
  new Map([["Task", taskTemplate], [taskIdentity, taskTemplate], ["Channel", channelTemplate], [channelIdentity, channelTemplate]]),
);
