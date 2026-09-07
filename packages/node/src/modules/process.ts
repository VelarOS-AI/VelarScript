/**
 * `velar/process`
 *
 * D115 §三: one file per `velar/*` surface, holding that surface's `ValueType`
 * tables and the `nodeModuleInterfaces` entry they build.
 */
import { optionalOf as optional, type ModuleInterface, type ValueType } from "@velarscript/compiler";
import { functionType, listStringType, moduleInterface, nullType, numberType, object, promise, stringMapType, stringType } from "./types.ts";

const processResultType = object({
  code: optional(numberType),
  signal: optional(stringType),
  stdout: stringType,
  stderr: stringType,
});
const processOutputChannelIdentity = "velar/process#enum:ProcessOutputChannel";
const processOutputChannelMembers = new Set(["stdout", "stderr"]);
const processOutputChannelWireValues = new Map([...processOutputChannelMembers].map((member) => [member, member]));
const processOutputChannelType: ValueType = { kind: "enum", name: "ProcessOutputChannel", identity: processOutputChannelIdentity };
const processOutputType = object({
  channel: processOutputChannelType,
  text: stringType,
});
const processOptionsType = object({
  cwd: optional(stringType),
  env: optional(stringMapType),
  stdin: optional(stringType),
  timeout: optional(numberType),
  maxOutputBytes: optional(numberType),
}, ["cwd", "env", "stdin", "timeout", "maxOutputBytes"]);
const processType: ValueType = { kind: "named", name: "Process", identity: "velar/process#type:Process" };

export const velarProcessModuleEntry: readonly [string, ModuleInterface] = ["velar/process", moduleInterface(
  new Map([
    ["Process", { kind: "typeObject", name: "Process" }],
    ["ProcessOutputChannel", { kind: "enumObject", name: "ProcessOutputChannel", identity: processOutputChannelIdentity, members: processOutputChannelMembers }],
    ["start", functionType(["command", "args", "options"], [stringType, listStringType, processOptionsType], promise(processType), 1)],
    ["run", functionType(["command", "args", "options"], [stringType, listStringType, processOptionsType], promise(processResultType), 1)],
  ]),
  new Map([
    ["Process", new Map([
      ["pid", numberType],
      ["next", functionType([], [], promise(optional(processOutputType)))],
      ["wait", functionType([], [], promise(processResultType))],
      ["stop", functionType([], [], promise(nullType))],
    ])],
  ]),
  new Map([["Process", "velar/process#type:Process"]]),
  new Map(),
  new Map(),
  new Map([["ProcessOutputChannel", { identity: processOutputChannelIdentity, members: processOutputChannelMembers, wireValues: processOutputChannelWireValues }]]),
)];
