import { optionalOf, type CompilerExtension, type EnumInfo, type ModuleInterface, type ValueType } from "@velarscript/compiler";
import { VELAR_STRICT_JSON_RUNTIME, VELAR_TYPE_REGISTRY_RUNTIME, VELAR_UTF8_RUNTIME } from "@velarscript/compiler/extension";
import { velarCompilerExtension as webCompilerExtension, webModuleSource } from "@velarscript/web/compiler";
import { nodeModuleInterfaces, VELAR_NODE_API_VERSION, VELAR_PROCESS_HOST_RUNTIME } from "@velarscript/node/compiler";
import { VELAR_DESKTOP_API_VERSION, velarProjectExtension, type VelarDesktopConfig } from "./config.ts";

const stringType: ValueType = { kind: "string" };
const boolType: ValueType = { kind: "bool" };
const numberType: ValueType = { kind: "number" };
const nullType: ValueType = { kind: "null" };
const optionalStringType = optionalOf(stringType);
const optionalNumberType = optionalOf(numberType);
const listStringType: ValueType = { kind: "list", element: stringType };

function functionType(parameters: readonly ValueType[], result: ValueType, requiredParameters = parameters.length): ValueType {
  return { kind: "function", parameters, requiredParameters, result };
}

function moduleInterface(
  exports: ReadonlyMap<string, ValueType>,
  namedTypes: ReadonlyMap<string, ReadonlyMap<string, ValueType>> = new Map(),
  namedTypeIdentities: ReadonlyMap<string, string> = new Map(),
  enums: ReadonlyMap<string, EnumInfo> = new Map(),
): ModuleInterface {
  return {
    exports,
    mutableExports: new Set(),
    reactiveExports: new Map(),
    reExports: new Map(),
    namedTypes,
    namedTypeIdentities,
    typeAliases: new Map(),
    enums,
    classes: new Map(),
    tests: [],
    extensionExports: new Map(),
    extensionData: new Map(),
  };
}

const DESKTOP_HOST_ABI_RUNTIME = String.raw`
const __velarDesktopBridgeKey = Symbol.for("velar.desktop.bridge.v1");
const __velarDesktopGetOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const __velarDesktopReflectApply = Reflect.apply;
const __velarDesktopBridgeDescriptor = __velarDesktopGetOwnPropertyDescriptor(globalThis, __velarDesktopBridgeKey);
if (!__velarDesktopBridgeDescriptor || !("value" in __velarDesktopBridgeDescriptor)
  || !__velarDesktopBridgeDescriptor.value || typeof __velarDesktopBridgeDescriptor.value !== "object") {
  throw new Error("VelarScript Desktop bridge is unavailable");
}
const __velarDesktopBridge = __velarDesktopBridgeDescriptor.value;
const __velarDesktopInvokeDescriptor = __velarDesktopGetOwnPropertyDescriptor(__velarDesktopBridge, "invoke");
if (!__velarDesktopInvokeDescriptor || !("value" in __velarDesktopInvokeDescriptor) || typeof __velarDesktopInvokeDescriptor.value !== "function") {
  throw new TypeError("Desktop bridge invoke must be a function data value");
}
const __velarDesktopInvoke = __velarDesktopInvokeDescriptor.value;
function __velarDesktopHostField(name) {
  const descriptor = __velarDesktopGetOwnPropertyDescriptor(__velarDesktopBridge, name);
  if (!descriptor || !("value" in descriptor)) throw new TypeError("Desktop bridge field '" + name + "' must be a data value");
  return descriptor.value;
}
function __velarDesktopHostCall(capability, operation, args, timeout = 30000) {
  return __velarDesktopReflectApply(__velarDesktopInvoke, __velarDesktopBridge, [capability, operation, args, timeout]);
}
`.trim();

const languageServerIdentity = "velar/desktop#type:LanguageServer";
const languageServerType: ValueType = { kind: "named", name: "LanguageServer", identity: languageServerIdentity };
const projectTaskIdentity = "velar/desktop#type:ProjectTask";
const projectTaskType: ValueType = { kind: "named", name: "ProjectTask", identity: projectTaskIdentity };
const projectTaskCommandIdentity = "velar/desktop#enum:ProjectTaskCommand";
const projectTaskCommands = new Set(["check", "test", "build", "run"]);
const projectTaskCommandType: ValueType = { kind: "enum", name: "ProjectTaskCommand", identity: projectTaskCommandIdentity };
const projectTaskOutputChannelIdentity = "velar/desktop#enum:ProjectTaskOutputChannel";
const projectTaskOutputChannels = new Set(["stdout", "stderr"]);
const projectTaskOutputChannelType: ValueType = { kind: "enum", name: "ProjectTaskOutputChannel", identity: projectTaskOutputChannelIdentity };
const projectTaskResultType: ValueType = { kind: "object", fields: new Map<string, ValueType>([
  ["code", optionalNumberType],
  ["signal", optionalStringType],
  ["stdout", stringType],
  ["stderr", stringType],
]) };
const projectTaskOutputType: ValueType = { kind: "object", fields: new Map<string, ValueType>([
  ["channel", projectTaskOutputChannelType],
  ["text", stringType],
]) };
const projectTaskOptionsType: ValueType = {
  kind: "object",
  fields: new Map<string, ValueType>([["timeout", numberType], ["maxOutputBytes", numberType]]),
  optionalFields: new Set(["timeout", "maxOutputBytes"]),
};
const terminalSessionIdentity = "velar/desktop#type:TerminalSession";
const terminalSessionType: ValueType = { kind: "named", name: "TerminalSession", identity: terminalSessionIdentity };
const terminalResultType: ValueType = { kind: "object", fields: new Map<string, ValueType>([["code", numberType]]) };
const terminalOptionsType: ValueType = {
  kind: "object",
  fields: new Map<string, ValueType>([["columns", numberType], ["rows", numberType]]),
  optionalFields: new Set(["columns", "rows"]),
};
const desktopModuleInterface = moduleInterface(new Map([
  ["LanguageServer", { kind: "typeObject", name: "LanguageServer" }],
  ["ProjectTask", { kind: "typeObject", name: "ProjectTask" }],
  ["ProjectTaskCommand", { kind: "enumObject", name: "ProjectTaskCommand", identity: projectTaskCommandIdentity, members: projectTaskCommands }],
  ["ProjectTaskOutputChannel", { kind: "enumObject", name: "ProjectTaskOutputChannel", identity: projectTaskOutputChannelIdentity, members: projectTaskOutputChannels }],
  ["TerminalSession", { kind: "typeObject", name: "TerminalSession" }],
  ["platform", functionType([], stringType)],
  ["packaged", functionType([], boolType)],
  ["homeDirectory", functionType([], { kind: "promise", value: stringType })],
  ["appDataDirectory", functionType([], { kind: "promise", value: stringType })],
  ["projectDirectory", functionType([], { kind: "promise", value: stringType })],
  ["selectedProjectDirectory", functionType([], { kind: "promise", value: optionalStringType })],
  ["selectProjectDirectory", functionType([], { kind: "promise", value: optionalStringType })],
  ["languageServer", functionType([], { kind: "promise", value: languageServerType })],
  ["startProjectTask", functionType([projectTaskCommandType, listStringType, projectTaskOptionsType], { kind: "promise", value: projectTaskType }, 1)],
  ["openTerminal", functionType([terminalOptionsType], { kind: "promise", value: terminalSessionType }, 0)],
]), new Map([
  ["LanguageServer", new Map([
    ["send", functionType([stringType], { kind: "promise", value: nullType })],
    ["next", functionType([], { kind: "promise", value: optionalStringType })],
      ["close", functionType([], { kind: "promise", value: nullType })],
    ])],
  ["ProjectTask", new Map([
    ["pid", numberType],
    ["next", functionType([], { kind: "promise", value: optionalOf(projectTaskOutputType) })],
    ["wait", functionType([], { kind: "promise", value: projectTaskResultType })],
    ["stop", functionType([], { kind: "promise", value: nullType })],
  ])],
  ["TerminalSession", new Map([
    ["pid", numberType],
    ["write", functionType([stringType], { kind: "promise", value: nullType })],
    ["resize", functionType([numberType, numberType], { kind: "promise", value: nullType })],
    ["next", functionType([], { kind: "promise", value: optionalStringType })],
    ["wait", functionType([], { kind: "promise", value: terminalResultType })],
    ["close", functionType([], { kind: "promise", value: nullType })],
  ])],
]), new Map([
  ["LanguageServer", languageServerIdentity],
  ["ProjectTask", projectTaskIdentity],
  ["TerminalSession", terminalSessionIdentity],
]), new Map([
  ["ProjectTaskCommand", { identity: projectTaskCommandIdentity, members: projectTaskCommands }],
  ["ProjectTaskOutputChannel", { identity: projectTaskOutputChannelIdentity, members: projectTaskOutputChannels }],
]));

const desktopTestModuleInterface = moduleInterface(new Map([
  ["appDataDirectory", functionType([], { kind: "promise", value: stringType })],
  ["projectDirectory", functionType([], { kind: "promise", value: stringType })],
  ["makeDirectory", functionType([stringType], { kind: "promise", value: nullType })],
  ["readText", functionType([stringType, { kind: "number" }], { kind: "promise", value: stringType })],
  ["writeText", functionType([stringType, stringType], { kind: "promise", value: nullType })],
  ["removeFile", functionType([stringType], { kind: "promise", value: nullType })],
]));

const nodeProcessInterface = nodeModuleInterfaces.get("velar/process")!;
const desktopProcessInterface: ModuleInterface = nodeProcessInterface;

const DESKTOP_MODULE_SOURCE = String.raw`
${DESKTOP_HOST_ABI_RUNTIME}
${VELAR_TYPE_REGISTRY_RUNTIME}
${VELAR_UTF8_RUNTIME}
${VELAR_PROCESS_HOST_RUNTIME}
const desktopPlatform = __velarDesktopHostField("platform");
const desktopPackaged = __velarDesktopHostField("packaged");
const languageServerToken = Symbol("velar.desktop.language-server");
const projectTaskToken = Symbol("velar.desktop.project-task");
const terminalSessionToken = Symbol("velar.desktop.terminal-session");
export function platform() {
  const value = desktopPlatform;
  if (typeof value !== "string" || value.length === 0) throw new TypeError("Desktop host returned an invalid platform");
  return value;
}
export function packaged() {
  const value = desktopPackaged;
  if (typeof value !== "boolean") throw new TypeError("Desktop host returned an invalid packaged marker");
  return value;
}
async function path(operation) {
  const value = await __velarDesktopHostCall("desktop", operation, []);
  if (typeof value !== "string" || !value.startsWith("/") || value.length > 4096 || value.includes("\0")) throw new TypeError("Desktop host returned an invalid absolute path");
  return value;
}
async function optionalPath(operation, timeout = 30000) {
  const value = await __velarDesktopHostCall("desktop", operation, [], timeout);
  if (value === null) return null;
  if (typeof value !== "string" || !value.startsWith("/") || value.length > 4096 || value.includes("\0")) throw new TypeError("Desktop host returned an invalid optional project path");
  return value;
}
export async function homeDirectory() { return path("homeDirectory"); }
export async function appDataDirectory() { return path("appDataDirectory"); }
export async function projectDirectory() { return path("projectDirectory"); }
export async function selectedProjectDirectory() { return optionalPath("selectedProjectDirectory"); }
export async function selectProjectDirectory() { return optionalPath("selectProjectDirectory", 0); }
class LanguageServerHandle {
  constructor(token, handle) {
    if (token !== languageServerToken || !Number.isSafeInteger(handle) || handle < 1) throw new TypeError("LanguageServer values are created only by velar/desktop.languageServer");
    this.handle = handle;
    this.closed = false;
    this.reading = false;
  }
  async send(message) {
    if (this.closed) throw new Error("LanguageServer is closed");
    if (typeof message !== "string" || message.length === 0 || message.length > 16 * 1024 * 1024) throw new RangeError("LanguageServer.send requires bounded JSON text");
    const value = await __velarDesktopHostCall("language-server", "send", [this.handle, message]);
    if (value !== null) throw new TypeError("Desktop host returned an invalid language-server send result");
    return null;
  }
  async next() {
    if (this.closed) return null;
    if (this.reading) throw new Error("LanguageServer.next already has an active pull");
    this.reading = true;
    try {
      const value = await __velarDesktopHostCall("language-server", "next", [this.handle], 0);
      if (value === null) { this.closed = true; return null; }
      if (typeof value !== "string" || value.length === 0 || value.length > 16 * 1024 * 1024) throw new TypeError("Desktop host returned invalid language-server JSON text");
      return value;
    } finally {
      this.reading = false;
    }
  }
  async close() {
    if (this.closed) return null;
    const value = await __velarDesktopHostCall("language-server", "close", [this.handle], 10000);
    if (value !== null) throw new TypeError("Desktop host returned an invalid language-server close result");
    this.closed = true;
    return null;
  }
}
export const LanguageServer = Object.freeze({
  is(value) { return value instanceof LanguageServerHandle; },
  parse(value) { if (!(value instanceof LanguageServerHandle)) throw new TypeError("Value does not match LanguageServer"); return value; },
});
export async function languageServer() {
  const handle = await __velarDesktopHostCall("language-server", "start", []);
  return new LanguageServerHandle(languageServerToken, handle);
}
const projectTaskOptionFields = new __velarProcessNativeSet(["timeout", "maxOutputBytes"]);
const projectTaskStartFields = new __velarProcessNativeSet(["handle", "pid"]);
const projectTaskOutputFields = new __velarProcessNativeSet(["channel", "text"]);
const projectTaskResultFields = new __velarProcessNativeSet(["code", "signal", "stdout", "stderr"]);
const projectTaskErrorFields = new __velarProcessNativeSet(["name", "message"]);
const projectTaskWaitFields = new __velarProcessNativeSet(["result", "error", "retained"]);
const projectTaskStopFields = new __velarProcessNativeSet(["result", "error"]);
export const ProjectTaskCommand = __velarRegisterRuntimeType(__velarProcessFreeze({
  check: "check", test: "test", build: "build", run: "run",
  is(value) { return value === "check" || value === "test" || value === "build" || value === "run"; },
  parse(value) {
    if (!ProjectTaskCommand.is(value)) throw new __velarProcessNativeTypeError("Value does not match ProjectTaskCommand");
    return value;
  },
  // D60 rule 149: values() is the third name charter section 6 reserves on
  // every enum, and it returns a fresh mutable List in declaration order.
  values() { return ["check", "test", "build", "run"]; },
}));
export const ProjectTaskOutputChannel = __velarRegisterRuntimeType(__velarProcessFreeze({
  stdout: "stdout", stderr: "stderr",
  is(value) { return value === "stdout" || value === "stderr"; },
  parse(value) {
    if (!ProjectTaskOutputChannel.is(value)) throw new __velarProcessNativeTypeError("Value does not match ProjectTaskOutputChannel");
    return value;
  },
  values() { return ["stdout", "stderr"]; },
}));
function projectTaskArguments(value, command) {
  if (value == null) return [];
  if (!__velarProcessIsArray(value) || value.length > 1000) throw new __velarProcessNativeTypeError("Project task arguments must be a bounded List<string>");
  if (command !== "run" && value.length > 0) throw new __velarProcessNativeTypeError("Only a run project task accepts program arguments");
  let units = 0;
  const output = [];
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = __velarProcessOwnDescriptor(value, __velarProcessNativeString(index));
    const item = descriptor?.enumerable && "value" in descriptor ? descriptor.value : null;
    if (typeof item !== "string" || item.length > 1024 * 1024 || __velarProcessIncludes(item, "\0")) {
      throw new __velarProcessNativeTypeError("Project task arguments must contain bounded string data values");
    }
    units += item.length;
    if (units > 1024 * 1024) throw new __velarProcessNativeRangeError("Project task arguments cannot exceed 1 MiB");
    output[output.length] = item;
  }
  return output;
}
function projectTaskOptions(value) {
  value = __velarProcessRecord(value == null ? {} : value, "Project task options", projectTaskOptionFields);
  const timeout = value.timeout ?? 120000;
  const maxOutputBytes = value.maxOutputBytes ?? 4 * 1024 * 1024;
  if (!__velarProcessIsSafeInteger(timeout) || timeout < 0 || timeout > 600000) {
    throw new __velarProcessNativeRangeError("Project task timeout must be an integer from 0 through 600000 milliseconds");
  }
  if (!__velarProcessIsSafeInteger(maxOutputBytes) || maxOutputBytes < 1 || maxOutputBytes > 16 * 1024 * 1024) {
    throw new __velarProcessNativeRangeError("Project task maxOutputBytes must be an integer from 1 through 16777216");
  }
  return {timeout, maxOutputBytes};
}
function projectTaskError(value) {
  value = __velarProcessRecord(value, "Project task host error", projectTaskErrorFields);
  if (typeof value.message !== "string" || value.message.length === 0 || value.message.length > 65536
    || value.name !== "Error" && value.name !== "RangeError" && value.name !== "TypeError") {
    throw new __velarProcessNativeTypeError("Desktop host returned an invalid project task error");
  }
  if (value.name === "RangeError") return new __velarProcessNativeRangeError(value.message);
  if (value.name === "TypeError") return new __velarProcessNativeTypeError(value.message);
  return new __velarProcessNativeError(value.message);
}
function projectTaskResult(value, maxOutputBytes) {
  value = __velarProcessRecord(value, "Project task result", projectTaskResultFields);
  if (value.code !== null && !__velarProcessIsSafeInteger(value.code)
    || value.signal !== null && (typeof value.signal !== "string" || value.signal.length === 0 || value.signal.length > 128)
    || typeof value.stdout !== "string" || typeof value.stderr !== "string"
    || __velarUtf8ByteLength(value.stdout) + __velarUtf8ByteLength(value.stderr) > maxOutputBytes) {
    throw new __velarProcessNativeTypeError("Desktop host returned an invalid project task result");
  }
  return __velarProcessFreeze({code: value.code, signal: value.signal, stdout: value.stdout, stderr: value.stderr});
}
function projectTaskOutput(value, maxOutputBytes) {
  if (value === null) return null;
  value = __velarProcessRecord(value, "Project task output", projectTaskOutputFields);
  if (!ProjectTaskOutputChannel.is(value.channel) || typeof value.text !== "string" || value.text.length === 0
    || __velarUtf8ByteLength(value.text) > maxOutputBytes) {
    throw new __velarProcessNativeTypeError("Desktop host returned invalid project task output");
  }
  return __velarProcessFreeze({channel: value.channel, text: value.text});
}
function projectTaskWait(value, maxOutputBytes) {
  value = __velarProcessRecord(value, "Project task wait result", projectTaskWaitFields);
  if (typeof value.retained !== "boolean" || value.result !== null && value.error !== null
    || value.retained && (value.result !== null || value.error === null)
    || !value.retained && value.result === null && value.error === null) {
    throw new __velarProcessNativeTypeError("Desktop host returned an invalid project task wait result");
  }
  return {
    result: value.result === null ? null : projectTaskResult(value.result, maxOutputBytes),
    error: value.error === null ? null : projectTaskError(value.error),
    retained: value.retained,
  };
}
function projectTaskStop(value, maxOutputBytes) {
  value = __velarProcessRecord(value, "Project task stop result", projectTaskStopFields);
  if (value.result !== null && value.error !== null) throw new __velarProcessNativeTypeError("Desktop host returned a contradictory project task stop result");
  return {
    result: value.result === null ? null : projectTaskResult(value.result, maxOutputBytes),
    error: value.error === null ? null : projectTaskError(value.error),
  };
}
class ProjectTaskHandle {
  constructor(token, handle, pid, maxOutputBytes) {
    if (token !== projectTaskToken || !__velarProcessIsSafeInteger(handle) || handle < 1
      || !__velarProcessIsSafeInteger(pid) || pid < 1) throw new __velarProcessNativeTypeError("ProjectTask values are created only by velar/desktop.startProjectTask");
    this.handle = handle;
    this.pid = pid;
    this.maxOutputBytes = maxOutputBytes;
    this.outputBytes = 0;
    this.reading = false;
    this.waitStarted = false;
    this.stopRequested = false;
    this.result = null;
    __velarProcessSeal(this);
  }
  async next() {
    if (this.waitStarted) throw new __velarProcessNativeError("Project task output must be consumed before wait()");
    if (this.stopRequested) throw new __velarProcessNativeError("Project task output is unavailable after stop()");
    if (this.reading) throw new __velarProcessNativeError("ProjectTask.next() allows only one active pull");
    this.reading = true;
    try {
      const output = projectTaskOutput(await __velarDesktopHostCall("project-task", "read", [this.handle], 0), this.maxOutputBytes);
      if (output !== null) {
        this.outputBytes += __velarUtf8ByteLength(output.text);
        if (this.outputBytes > this.maxOutputBytes) throw new __velarProcessNativeRangeError("Project task output exceeded maxOutputBytes");
      }
      return output;
    } finally { this.reading = false; }
  }
  wait() {
    if (this.reading) return __velarProcessReject(new __velarProcessNativeError("Project task wait() cannot run while next() is pending"));
    this.waitStarted = true;
    if (this.result === null) {
      let pending;
      pending = __velarProcessThen(__velarDesktopHostCall("project-task", "wait", [this.handle], 0), value => {
        const outcome = projectTaskWait(value, this.maxOutputBytes);
        if (outcome.retained) { if (this.result === pending) this.result = null; throw outcome.error; }
        if (outcome.error) throw outcome.error;
        return outcome.result;
      }, error => { if (this.result === pending) this.result = null; throw error; });
      this.result = pending;
    }
    return this.result;
  }
  async stop() {
    if (this.result !== null && this.waitStarted) { await this.result; return null; }
    this.stopRequested = true;
    const outcome = projectTaskStop(await __velarDesktopHostCall("project-task", "stop", [this.handle], 10000), this.maxOutputBytes);
    if (outcome.error) { this.result = __velarProcessObservedReject(outcome.error); throw outcome.error; }
    if (outcome.result) this.result = __velarProcessResolve(outcome.result);
    return null;
  }
}
export const ProjectTask = __velarProcessFreeze({
  is(value) { return value instanceof ProjectTaskHandle; },
  parse(value) {
    if (!(value instanceof ProjectTaskHandle)) throw new __velarProcessNativeTypeError("Value does not match ProjectTask");
    return value;
  },
});
export async function startProjectTask(command, arguments_ = [], options = {}) {
  command = ProjectTaskCommand.parse(command);
  const args = projectTaskArguments(arguments_, command);
  const wire = projectTaskOptions(options);
  const value = __velarProcessRecord(
    await __velarDesktopHostCall("project-task", "start", [command, args, wire]),
    "Project task start result",
    projectTaskStartFields,
  );
  if (!__velarProcessIsSafeInteger(value.handle) || value.handle < 1 || !__velarProcessIsSafeInteger(value.pid) || value.pid < 1) {
    throw new __velarProcessNativeTypeError("Desktop host returned an invalid project task start result");
  }
  return new ProjectTaskHandle(projectTaskToken, value.handle, value.pid, wire.maxOutputBytes);
}
const terminalOptionFields = new __velarProcessNativeSet(["columns", "rows"]);
const terminalStartFields = new __velarProcessNativeSet(["handle", "pid"]);
const terminalResultFields = new __velarProcessNativeSet(["code"]);
function terminalDimension(value, fallback, name, minimum) {
  value = value ?? fallback;
  if (!__velarProcessIsSafeInteger(value) || value < minimum || value > 1000) {
    throw new __velarProcessNativeRangeError("Terminal " + name + " must be an integer from " + minimum + " through 1000");
  }
  return value;
}
function terminalOptions(value) {
  value = __velarProcessRecord(value == null ? {} : value, "Terminal options", terminalOptionFields);
  return {columns: terminalDimension(value.columns, 80, "columns", 20), rows: terminalDimension(value.rows, 24, "rows", 5)};
}
function terminalResult(value) {
  value = __velarProcessRecord(value, "Terminal result", terminalResultFields);
  if (!__velarProcessIsSafeInteger(value.code) || value.code < 0 || value.code > 255) {
    throw new __velarProcessNativeTypeError("Desktop host returned an invalid terminal result");
  }
  return __velarProcessFreeze({code: value.code});
}
class TerminalSessionHandle {
  constructor(token, handle, pid) {
    if (token !== terminalSessionToken || !__velarProcessIsSafeInteger(handle) || handle < 1
      || !__velarProcessIsSafeInteger(pid) || pid < 1) throw new __velarProcessNativeTypeError("TerminalSession values are created only by velar/desktop.openTerminal");
    this.handle = handle;
    this.pid = pid;
    this.reading = false;
    this.closed = false;
    this.outputEnded = false;
    this.result = null;
    __velarProcessSeal(this);
  }
  async write(text) {
    if (this.closed) throw new __velarProcessNativeError("TerminalSession is closed");
    if (typeof text !== "string" || text.length === 0 || __velarUtf8ByteLength(text) > 1024 * 1024) {
      throw new __velarProcessNativeRangeError("TerminalSession.write requires 1 byte through 1 MiB of text");
    }
    const value = await __velarDesktopHostCall("terminal", "write", [this.handle, text], 0);
    if (value !== null) throw new __velarProcessNativeTypeError("Desktop host returned an invalid terminal write result");
    return null;
  }
  async resize(columns, rows) {
    if (this.closed) throw new __velarProcessNativeError("TerminalSession is closed");
    columns = terminalDimension(columns, 80, "columns", 20);
    rows = terminalDimension(rows, 24, "rows", 5);
    const value = await __velarDesktopHostCall("terminal", "resize", [this.handle, columns, rows]);
    if (value !== null) throw new __velarProcessNativeTypeError("Desktop host returned an invalid terminal resize result");
    return null;
  }
  async next() {
    if (this.reading) throw new __velarProcessNativeError("TerminalSession.next() allows only one active pull");
    if (this.closed || this.outputEnded) return null;
    this.reading = true;
    try {
      const value = await __velarDesktopHostCall("terminal", "next", [this.handle], 0);
      if (value === null) { this.outputEnded = true; return null; }
      if (typeof value !== "string" || value.length === 0 || __velarUtf8ByteLength(value) > 1024 * 1024) {
        throw new __velarProcessNativeTypeError("Desktop host returned invalid terminal output");
      }
      return value;
    } finally { this.reading = false; }
  }
  wait() {
    if (this.result === null) {
      if (this.reading) return __velarProcessReject(new __velarProcessNativeError("Terminal output cannot be waited while next() is pending"));
      if (!this.outputEnded) return __velarProcessReject(new __velarProcessNativeError("Terminal output must be consumed before wait()"));
      let pending;
      pending = __velarProcessThen(__velarDesktopHostCall("terminal", "wait", [this.handle], 0), value => {
        this.closed = true;
        return terminalResult(value);
      }, error => { if (this.result === pending) this.result = null; throw error; });
      this.result = pending;
    }
    return this.result;
  }
  async close() {
    if (this.closed) return null;
    const outcome = terminalResult(await __velarDesktopHostCall("terminal", "close", [this.handle], 10000));
    this.closed = true;
    if (this.result === null) this.result = __velarProcessResolve(outcome);
    return null;
  }
}
export const TerminalSession = __velarProcessFreeze({
  is(value) { return value instanceof TerminalSessionHandle; },
  parse(value) {
    if (!(value instanceof TerminalSessionHandle)) throw new __velarProcessNativeTypeError("Value does not match TerminalSession");
    return value;
  },
});
export async function openTerminal(options = {}) {
  const wire = terminalOptions(options);
  const value = __velarProcessRecord(await __velarDesktopHostCall("terminal", "open", [wire]), "Terminal start result", terminalStartFields);
  if (!__velarProcessIsSafeInteger(value.handle) || value.handle < 1 || !__velarProcessIsSafeInteger(value.pid) || value.pid < 1) {
    throw new __velarProcessNativeTypeError("Desktop host returned an invalid terminal start result");
  }
  return new TerminalSessionHandle(terminalSessionToken, value.handle, value.pid);
}
`.trimStart();

const DESKTOP_TEST_SOURCE = String.raw`
const runtimeKey = Symbol.for("velar.browser.test.v1");
const getOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const reflectApply = Reflect.apply;
function invoke(capability, operation, args, timeout) {
  // The controller replaces this runtime for every isolated browser test, so
  // this test-only module deliberately resolves one data-only snapshot per
  // call instead of retaining a previous test's Page authority.
  const runtimeDescriptor = getOwnPropertyDescriptor(globalThis, runtimeKey);
  if (!runtimeDescriptor || !("value" in runtimeDescriptor) || !runtimeDescriptor.value || typeof runtimeDescriptor.value !== "object") {
    throw new Error("velar/desktop-test requires 'velar test --browser'");
  }
  const runtime = runtimeDescriptor.value;
  const invokeDescriptor = getOwnPropertyDescriptor(runtime, "frameworkInvoke");
  if (!invokeDescriptor || !("value" in invokeDescriptor) || typeof invokeDescriptor.value !== "function") {
    throw new Error("velar/desktop-test requires 'velar test --browser'");
  }
  return reflectApply(invokeDescriptor.value, runtime, [capability, operation, args, timeout]);
}
export async function appDataDirectory() {
  const value = await invoke("desktop", "appDataDirectory", [], 30000);
  if (typeof value !== "string" || !value.startsWith("/") || value.length > 4096 || value.includes("\0")) throw new TypeError("Desktop test host returned an invalid absolute app-data path");
  return value;
}
export async function projectDirectory() {
  const value = await invoke("desktop", "projectDirectory", [], 30000);
  if (typeof value !== "string" || !value.startsWith("/") || value.length > 4096 || value.includes("\0")) throw new TypeError("Desktop test host returned an invalid absolute project path");
  return value;
}
export async function makeDirectory(path) {
  if (typeof path !== "string" || path.length === 0 || path.length > 4096 || path.includes("\0")) throw new TypeError("Desktop test makeDirectory requires a bounded path");
  const value = await invoke("fs", "makeDirectory", [path], 30000);
  if (value !== null) throw new TypeError("Desktop test host returned an invalid directory result");
  return null;
}
export async function readText(path, maxBytes) {
  if (typeof path !== "string" || path.length === 0 || path.length > 4096 || path.includes("\0")) throw new TypeError("Desktop test readText requires a bounded path");
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > 16 * 1024 * 1024) throw new RangeError("Desktop test readText maxBytes is outside its supported bounds");
  const value = await invoke("fs", "readText", [path, maxBytes], 30000);
  if (typeof value !== "string") throw new TypeError("Desktop test host returned invalid file text");
  return value;
}
export async function writeText(path, text) {
  if (typeof path !== "string" || path.length === 0 || path.length > 4096 || path.includes("\0")) throw new TypeError("Desktop test writeText requires a bounded path");
  if (typeof text !== "string") throw new TypeError("Desktop test writeText requires text");
  const value = await invoke("fs", "writeText", [path, text], 30000);
  if (value !== null) throw new TypeError("Desktop test host returned an invalid write result");
  return null;
}
export async function removeFile(path) {
  if (typeof path !== "string" || path.length === 0 || path.length > 4096 || path.includes("\0")) throw new TypeError("Desktop test removeFile requires a bounded path");
  const value = await invoke("fs", "removeFile", [path], 30000);
  if (value !== null) throw new TypeError("Desktop test host returned an invalid remove result");
  return null;
}
`.trimStart();

const DESKTOP_PATH_SOURCE = String.raw`
${DESKTOP_HOST_ABI_RUNTIME}
const maxPathCodeUnits = 4096;
const pathApply = Reflect.apply;
const pathArrayIsArray = Array.isArray;
const pathArrayJoin = Array.prototype.join;
const pathGetOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const pathStringIndexOf = String.prototype.indexOf;
const pathStringSlice = String.prototype.slice;
const pathStringToLowerCase = String.prototype.toLowerCase;
const pathEncodeURIComponent = encodeURIComponent;
const pathDecodeURIComponent = decodeURIComponent;
const pathNativeURL = URL;
const pathURLProtocol = pathGetOwnPropertyDescriptor(pathNativeURL.prototype, "protocol")?.get;
const pathURLUsername = pathGetOwnPropertyDescriptor(pathNativeURL.prototype, "username")?.get;
const pathURLPassword = pathGetOwnPropertyDescriptor(pathNativeURL.prototype, "password")?.get;
const pathURLPort = pathGetOwnPropertyDescriptor(pathNativeURL.prototype, "port")?.get;
const pathURLSearch = pathGetOwnPropertyDescriptor(pathNativeURL.prototype, "search")?.get;
const pathURLHash = pathGetOwnPropertyDescriptor(pathNativeURL.prototype, "hash")?.get;
const pathURLHostname = pathGetOwnPropertyDescriptor(pathNativeURL.prototype, "hostname")?.get;
const pathURLPathname = pathGetOwnPropertyDescriptor(pathNativeURL.prototype, "pathname")?.get;
if (typeof pathURLProtocol !== "function" || typeof pathURLUsername !== "function" || typeof pathURLPassword !== "function"
  || typeof pathURLPort !== "function" || typeof pathURLSearch !== "function" || typeof pathURLHash !== "function"
  || typeof pathURLHostname !== "function" || typeof pathURLPathname !== "function") {
  throw new TypeError("Desktop path URL runtime is unavailable");
}
const desktopProjectDirectoryValue = __velarDesktopHostField("projectDirectoryValue");
function stringIndexOf(value, search) { return pathApply(pathStringIndexOf, value, [search]); }
function stringSlice(value, start, end) { return pathApply(pathStringSlice, value, end === undefined ? [start] : [start, end]); }
function stringToLowerCase(value) { return pathApply(pathStringToLowerCase, value, []); }
function arrayJoin(value, separator) { return pathApply(pathArrayJoin, value, [separator]); }
function urlValue(value, getter) { return pathApply(getter, value, []); }
function checked(value, operation) {
  if (typeof value !== "string" || value.length === 0) throw new TypeError(operation + " requires a non-empty path string");
  if (value.length > maxPathCodeUnits || stringIndexOf(value, "\0") !== -1) throw new RangeError(operation + " path is outside the supported bounds");
  return value;
}
function bounded(value, operation) {
  if (value.length > maxPathCodeUnits) throw new RangeError(operation + " result is outside the supported bounds");
  return value;
}
function normalizePath(value) {
  const absolute = value[0] === "/";
  const trailing = value[value.length - 1] === "/";
  const output = [];
  let start = 0;
  for (let index = 0; index <= value.length; index += 1) {
    if (index < value.length && value[index] !== "/") continue;
    const part = stringSlice(value, start, index);
    start = index + 1;
    if (part === "" || part === ".") continue;
    if (part !== "..") {
      output[output.length] = part;
      continue;
    }
    if (output.length > 0 && output[output.length - 1] !== "..") output.length -= 1;
    else if (!absolute) output[output.length] = "..";
  }
  const body = arrayJoin(output, "/");
  let result = absolute ? "/" + body : body;
  if (result === "") result = absolute ? "/" : ".";
  if (trailing && result !== "/") result += "/";
  return result;
}
function dirnamePath(value) {
  const absolute = value[0] === "/";
  let end = -1;
  let matchedSlash = true;
  for (let index = value.length - 1; index >= 1; index -= 1) {
    if (value[index] === "/") {
      if (!matchedSlash) {
        end = index;
        break;
      }
    } else matchedSlash = false;
  }
  if (end === -1) return absolute ? "/" : ".";
  if (absolute && end === 1) return "//";
  return stringSlice(value, 0, end);
}
function basenamePath(value) {
  let start = 0;
  let end = -1;
  let matchedSlash = true;
  for (let index = value.length - 1; index >= 0; index -= 1) {
    if (value[index] === "/") {
      if (!matchedSlash) {
        start = index + 1;
        break;
      }
    } else if (end === -1) {
      matchedSlash = false;
      end = index + 1;
    }
  }
  return end === -1 ? "" : stringSlice(value, start, end);
}
function extensionPath(value) {
  let startDot = -1;
  let startPart = 0;
  let end = -1;
  let matchedSlash = true;
  let preDotState = 0;
  for (let index = value.length - 1; index >= 0; index -= 1) {
    const character = value[index];
    if (character === "/") {
      if (!matchedSlash) {
        startPart = index + 1;
        break;
      }
      continue;
    }
    if (end === -1) {
      matchedSlash = false;
      end = index + 1;
    }
    if (character === ".") {
      if (startDot === -1) startDot = index;
      else if (preDotState !== 1) preDotState = 1;
    } else if (startDot !== -1) preDotState = -1;
  }
  if (startDot === -1 || end === -1 || preDotState === 0
    || (preDotState === 1 && startDot === end - 1 && startDot === startPart + 1)) return "";
  return stringSlice(value, startDot, end);
}
function parts(value, operation) {
  if (!pathArrayIsArray(value) || value.length > 256) throw new TypeError(operation + " requires a bounded List<string>");
  const output = [];
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = pathGetOwnPropertyDescriptor(value, index);
    if (!descriptor?.enumerable || !("value" in descriptor)) throw new TypeError(operation + " path parts must contain enumerable data values");
    output[output.length] = checked(descriptor.value, operation);
  }
  return output;
}
function projectDirectory() {
  if (typeof desktopProjectDirectoryValue !== "function") throw new TypeError("Desktop project directory provider must be a function data value");
  const value = checked(pathApply(desktopProjectDirectoryValue, undefined, []), "resolve");
  if (!value.startsWith("/")) throw new TypeError("Desktop project directory must be absolute");
  return value;
}
function resolved(values, operation) {
  let value = projectDirectory();
  const normalizedParts = parts(values, operation);
  for (let index = 0; index < normalizedParts.length; index += 1) {
    const item = normalizedParts[index];
    value = item[0] === "/" ? item : value + "/" + item;
  }
  return normalizePath(value);
}
function pathSegments(value) {
  const output = [];
  let start = value[0] === "/" ? 1 : 0;
  for (let index = start; index <= value.length; index += 1) {
    if (index < value.length && value[index] !== "/") continue;
    if (index > start) output[output.length] = stringSlice(value, start, index);
    start = index + 1;
  }
  return output;
}
function relativeValue(from, to) {
  const left = pathSegments(resolved([checked(from, "relative")], "relative"));
  const right = pathSegments(resolved([checked(to, "relative")], "relative"));
  let shared = 0;
  while (shared < left.length && shared < right.length && left[shared] === right[shared]) shared += 1;
  const output = [];
  for (let index = shared; index < left.length; index += 1) output[output.length] = "..";
  for (let index = shared; index < right.length; index += 1) output[output.length] = right[index];
  return arrayJoin(output, "/");
}
export function normalize(path) { return bounded(normalizePath(checked(path, "normalize")), "normalize"); }
export function join(values = []) { return bounded(normalizePath(arrayJoin(parts(values, "join"), "/")), "join"); }
export function resolve(values = []) { return bounded(resolved(values, "resolve"), "resolve"); }
export function relative(from, to) { return bounded(relativeValue(from, to), "relative"); }
export function dirname(path) { return bounded(dirnamePath(checked(path, "dirname")), "dirname"); }
export function basename(path) { return basenamePath(checked(path, "basename")); }
export function extension(path) { return extensionPath(checked(path, "extension")); }
export function isAbsolute(path) { return checked(path, "isAbsolute")[0] === "/"; }
export function contains(root, target) { const value = relativeValue(root, target); return value === "" || (value !== ".." && stringIndexOf(value, "../") !== 0 && value[0] !== "/"); }
export function toFileUrl(path) {
  const segments = pathSegments(resolved([checked(path, "toFileUrl")], "toFileUrl"));
  const encoded = [];
  for (let index = 0; index < segments.length; index += 1) encoded[index] = pathEncodeURIComponent(segments[index]);
  return "file:///" + arrayJoin(encoded, "/");
}
export function fromFileUrl(value) {
  value = checked(value, "fromFileUrl");
  let url;
  try { url = new pathNativeURL(value); } catch { throw new TypeError("fromFileUrl requires a valid file URL"); }
  const pathname = urlValue(url, pathURLPathname);
  const lowercasePathname = stringToLowerCase(pathname);
  const encodedSeparator = stringIndexOf(lowercasePathname, "%2f") !== -1 || stringIndexOf(lowercasePathname, "%5c") !== -1;
  const hostname = urlValue(url, pathURLHostname);
  if (urlValue(url, pathURLProtocol) !== "file:" || urlValue(url, pathURLUsername) !== "" || urlValue(url, pathURLPassword) !== ""
    || urlValue(url, pathURLPort) !== "" || urlValue(url, pathURLSearch) !== "" || urlValue(url, pathURLHash) !== ""
    || hostname !== "" && hostname !== "localhost" || encodedSeparator) throw new TypeError("fromFileUrl requires a local file URL");
  let path;
  try { path = pathDecodeURIComponent(pathname); } catch { throw new TypeError("fromFileUrl requires a valid encoded file URL"); }
  return bounded(normalizePath(path), "fromFileUrl");
}
`.trimStart();

const DESKTOP_FS_SOURCE = String.raw`
${DESKTOP_HOST_ABI_RUNTIME}
const watcherToken = Symbol("velar.desktop.fs.watcher");
const maxPathCodeUnits = 4096;
const maxFileBytes = 16 * 1024 * 1024;
const maxListItems = 100000;
const maxListTextUnits = 2 * 1024 * 1024;
const maxWatchPaths = 4096;
function pathOf(value, operation) {
  if (typeof value !== "string" || value.length === 0) throw new TypeError(operation + " requires a non-empty path string");
  if (value.length > maxPathCodeUnits || value.includes("\0")) throw new RangeError(operation + " path is outside the supported bounds");
  return value;
}
function byteLimit(value, operation) {
  if (!Number.isSafeInteger(value) || value < 1 || value > maxFileBytes) throw new RangeError(operation + " maxBytes must be an integer from 1 through 16777216");
  return value;
}
function textOf(value, operation) {
  if (typeof value !== "string") throw new TypeError(operation + " requires text");
  if (new TextEncoder().encode(value).byteLength > maxFileBytes) throw new RangeError(operation + " cannot write more than 16 MiB");
  return value;
}
function replaceOf(value, operation) {
  if (typeof value !== "boolean") throw new TypeError(operation + " replace must be bool");
  return value;
}
function recordOf(value, name, allowed) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError(name + " must be a record");
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) throw new TypeError(name + " must be a plain record");
  const output = Object.create(null);
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string") throw new TypeError(name + " fields must use string names");
    if (!allowed.has(key)) throw new TypeError(name + " has unknown field '" + key + "'");
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor?.enumerable || !("value" in descriptor)) throw new TypeError(name + " fields must be enumerable data values");
    output[key] = descriptor.value;
  }
  return output;
}
function listOf(value, maximum) {
  if (!Array.isArray(value) || value.length > maximum) throw new TypeError("Desktop host returned an invalid directory list");
  const output = [];
  let units = 0;
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor?.enumerable || !("value" in descriptor) || typeof descriptor.value !== "string" || descriptor.value.length === 0 || descriptor.value.includes("/") || descriptor.value.includes("\0")) {
      throw new TypeError("Desktop host returned an invalid directory list");
    }
    units += descriptor.value.length;
    if (units > maxListTextUnits) throw new RangeError("Desktop directory list cannot exceed 2 MiB of text");
    output.push(descriptor.value);
  }
  return output.sort();
}
function infoOf(value) {
  if (value == null) return null;
  value = recordOf(value, "Desktop file info", new Set(["name", "kind", "size", "modifiedAt"]));
  if (typeof value.name !== "string" || value.name.length > maxPathCodeUnits || value.name.includes("/") || value.name.includes("\0")
    || !["file", "directory", "symlink", "other"].includes(value.kind)
    || !Number.isFinite(value.size) || value.size < 0
    || !Number.isFinite(value.modifiedAt)) throw new TypeError("Desktop host returned invalid file info");
  return Object.freeze({name: value.name, kind: value.kind, size: value.size, modifiedAt: value.modifiedAt});
}
function watchBatchOf(value) {
  value = recordOf(value, "Desktop file watch batch", new Set(["paths", "rescan"]));
  if (Reflect.ownKeys(value).length !== 2 || typeof value.rescan !== "boolean" || !Array.isArray(value.paths)
    || value.paths.length > maxWatchPaths || value.rescan && value.paths.length !== 0) {
    throw new TypeError("Desktop host returned an invalid file watch batch");
  }
  const paths = [];
  let units = 0;
  let previous = null;
  for (let index = 0; index < value.paths.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value.paths, String(index));
    if (!descriptor?.enumerable || !("value" in descriptor) || typeof descriptor.value !== "string"
      || descriptor.value.length === 0 || descriptor.value.length > maxPathCodeUnits || descriptor.value.includes("\0")
      || previous !== null && descriptor.value <= previous) throw new TypeError("Desktop host returned invalid file watch paths");
    units += descriptor.value.length;
    if (units > maxListTextUnits) throw new RangeError("Desktop file watch paths cannot exceed 2 MiB of text");
    paths.push(descriptor.value);
    previous = descriptor.value;
  }
  return Object.freeze({paths, rescan: value.rescan});
}
function invoke(operation, args, timeout = 30000) {
  return __velarDesktopHostCall("fs", operation, args, timeout);
}
async function mutate(operation, args) {
  const value = await invoke(operation, args);
  if (value !== null) throw new TypeError("Desktop host returned an invalid " + operation + " result");
}
class FileWatcherHandle {
  constructor(token, handle) {
    if (token !== watcherToken || !Number.isSafeInteger(handle) || handle < 1) throw new TypeError("FileWatcher values are created only by velar/fs.watchFiles");
    this.handle = handle;
    this.closed = false;
    this.pending = false;
    this.next = async () => {
      if (this.closed) return null;
      if (this.pending) throw new Error("FileWatcher.next already has an active pull");
      this.pending = true;
      try {
        const value = await invoke("watchNext", [this.handle], 0);
        if (value === null) { this.closed = true; return null; }
        return watchBatchOf(value);
      } catch (error) {
        this.closed = true;
        try { await invoke("watchClose", [this.handle]); } catch {}
        throw error;
      } finally {
        this.pending = false;
      }
    };
  }
  async close() {
    if (this.closed) return null;
    this.closed = true;
    const value = await invoke("watchClose", [this.handle]);
    if (typeof value !== "boolean") throw new TypeError("Desktop host returned an invalid file watcher release result");
    return null;
  }
}
export const FileWatcher = Object.freeze({
  is(value) { return value instanceof FileWatcherHandle; },
  parse(value) { if (!(value instanceof FileWatcherHandle)) throw new TypeError("Value does not match FileWatcher"); return value; },
});
export const FileWatchBatch = Object.freeze({
  is(value) { try { watchBatchOf(value); return true; } catch { return false; } },
  parse(value) { return watchBatchOf(value); },
});
export async function readText(path, maxBytes = maxFileBytes) {
  maxBytes = byteLimit(maxBytes, "readText");
  const value = await invoke("readText", [pathOf(path, "readText"), maxBytes]);
  if (typeof value !== "string") throw new TypeError("Desktop host returned invalid file text");
  if (new TextEncoder().encode(value).byteLength > maxBytes) throw new RangeError("Desktop file text exceeds maxBytes");
  return value;
}
export async function createText(path, text) { await mutate("createText", [pathOf(path, "createText"), textOf(text, "createText")]); return null; }
export async function replaceTextIfMatches(path, expected, replacement) {
  const value = await invoke("replaceTextIfMatches", [pathOf(path, "replaceTextIfMatches"), textOf(expected, "replaceTextIfMatches expected"), textOf(replacement, "replaceTextIfMatches replacement")]);
  if (typeof value !== "boolean") throw new TypeError("Desktop host returned an invalid replaceTextIfMatches result");
  return value;
}
export async function writeText(path, text) { await mutate("writeText", [pathOf(path, "writeText"), textOf(text, "writeText")]); return null; }
export async function appendText(path, text) { await mutate("appendText", [pathOf(path, "appendText"), textOf(text, "appendText")]); return null; }
export async function exists(path) {
  const value = await invoke("exists", [pathOf(path, "exists")]);
  if (typeof value !== "boolean") throw new TypeError("Desktop host returned invalid file existence");
  return value;
}
export async function list(path, maxItems = maxListItems) {
  if (!Number.isSafeInteger(maxItems) || maxItems < 1 || maxItems > maxListItems) throw new RangeError("list maxItems must be an integer from 1 through 100000");
  return listOf(await invoke("list", [pathOf(path, "list"), maxItems]), maxItems);
}
export async function info(path) { return infoOf(await invoke("info", [pathOf(path, "info")])); }
export async function canonical(path) {
  const value = await invoke("canonical", [pathOf(path, "canonical")]);
  if (typeof value !== "string" || value.length === 0 || value.length > maxPathCodeUnits || value.includes("\0")) throw new TypeError("Desktop host returned an invalid canonical path");
  return value;
}
export async function makeDirectory(path) { await mutate("makeDirectory", [pathOf(path, "makeDirectory")]); return null; }
export async function copyFile(source, target, replace = false) { await mutate("copyFile", [pathOf(source, "copyFile"), pathOf(target, "copyFile"), replaceOf(replace, "copyFile")]); return null; }
export async function move(source, target, replace = false) { await mutate("move", [pathOf(source, "move"), pathOf(target, "move"), replaceOf(replace, "move")]); return null; }
export async function removeFile(path) { await mutate("removeFile", [pathOf(path, "removeFile")]); return null; }
export async function watchFiles(path, recursive = false) {
  path = pathOf(path, "watchFiles");
  if (typeof recursive !== "boolean") throw new TypeError("watchFiles recursive must be bool");
  return new FileWatcherHandle(watcherToken, await invoke("watchStart", [path, recursive]));
}
`.trimStart();

const DESKTOP_PROCESS_SOURCE = String.raw`
${DESKTOP_HOST_ABI_RUNTIME}
${VELAR_TYPE_REGISTRY_RUNTIME}
${VELAR_UTF8_RUNTIME}
${VELAR_PROCESS_HOST_RUNTIME}
const processToken = Symbol("velar.desktop.process");
const maxTextBytes = 16 * 1024 * 1024;
const processOptionFields = new __velarProcessNativeSet(["cwd", "env", "stdin", "timeout", "maxOutputBytes"]);
const processStartFields = new __velarProcessNativeSet(["handle", "pid"]);
const processResultFields = new __velarProcessNativeSet(["code", "signal", "stdout", "stderr"]);
const processOutputFields = new __velarProcessNativeSet(["channel", "text"]);
const processErrorFields = new __velarProcessNativeSet(["name", "message"]);
const processStopFields = new __velarProcessNativeSet(["result", "error"]);
const processWaitFields = new __velarProcessNativeSet(["result", "error", "retained"]);
export const ProcessOutputChannel = __velarRegisterRuntimeType(__velarProcessFreeze({
  stdout: "stdout",
  stderr: "stderr",
  is(value) { return value === "stdout" || value === "stderr"; },
  parse(value) {
    if (!ProcessOutputChannel.is(value)) throw new __velarProcessNativeTypeError("Value does not match ProcessOutputChannel");
    return value;
  },
  // D60 rule 149: values() is the third name charter section 6 reserves on
  // every enum, and it returns a fresh mutable List in declaration order.
  values() { return ["stdout", "stderr"]; },
}));
function boundedText(value, name, maxCodeUnits = 4096) {
  if (typeof value !== "string" || value.length === 0) throw new __velarProcessNativeTypeError(name + " must be non-empty text");
  if (value.length > maxCodeUnits || __velarProcessIncludes(value, "\0")) throw new __velarProcessNativeRangeError(name + " is outside the supported bounds");
  return value;
}
function argumentsOf(value) {
  if (value == null) return [];
  if (!__velarProcessIsArray(value) || value.length > 1000) throw new __velarProcessNativeTypeError("Process args must be a bounded List<string>");
  let units = 0;
  const output = [];
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = __velarProcessOwnDescriptor(value, __velarProcessNativeString(index));
    if (!descriptor?.enumerable || !("value" in descriptor)) throw new __velarProcessNativeTypeError("Process args must contain enumerable data values");
    const item = descriptor.value;
    units += boundedText(item, "Process argument", 1024 * 1024).length;
    if (units > 1024 * 1024) throw new __velarProcessNativeRangeError("Process arguments cannot exceed 1 MiB");
    output[output.length] = item;
  }
  return output;
}
function recordOf(value, name, allowed) {
  return __velarProcessRecord(value, name, allowed);
}
function mapEntries(value) {
  if (value == null) return null;
  const snapshot = __velarProcessMapSnapshot(value);
  if (snapshot.size > 1000) throw new __velarProcessNativeRangeError("Process env cannot exceed 1000 entries");
  const output = [];
  let units = 0;
  for (let index = 0; index < snapshot.entries.length; index += 1) {
    const name = snapshot.entries[index][0];
    const item = snapshot.entries[index][1];
    if (!__velarProcessEnvironmentName(name) || name === "PATH" || typeof item !== "string" || __velarProcessIncludes(item, "\0")) {
      throw new __velarProcessNativeTypeError("Desktop process env must contain valid string variables and cannot replace PATH");
    }
    units += name.length + item.length;
    if (units > 1024 * 1024) throw new __velarProcessNativeRangeError("Process env cannot exceed 1 MiB");
    output[output.length] = [name, item];
  }
  return output;
}
function optionsOf(value) {
  if (value == null) value = {};
  value = recordOf(value, "Process options", processOptionFields);
  const cwd = value.cwd == null ? null : boundedText(value.cwd, "Process cwd");
  const stdin = value.stdin ?? "";
  if (typeof stdin !== "string" || __velarUtf8ByteLength(stdin) > maxTextBytes) throw new __velarProcessNativeRangeError("Process stdin cannot exceed 16 MiB");
  const timeout = value.timeout ?? 120000;
  if (!__velarProcessIsSafeInteger(timeout) || timeout < 0 || timeout > 600000) throw new __velarProcessNativeRangeError("Process timeout must be an integer from 0 through 600000 milliseconds");
  const maxOutputBytes = value.maxOutputBytes ?? 4 * 1024 * 1024;
  if (!__velarProcessIsSafeInteger(maxOutputBytes) || maxOutputBytes < 1 || maxOutputBytes > maxTextBytes) throw new __velarProcessNativeRangeError("Process maxOutputBytes must be an integer from 1 through 16777216");
  return {cwd, env: mapEntries(value.env), stdin, timeout, maxOutputBytes};
}
function startValueOf(value) {
  value = recordOf(value, "Desktop process start result", processStartFields);
  if (!__velarProcessIsSafeInteger(value.handle) || value.handle < 1 || !__velarProcessIsSafeInteger(value.pid) || value.pid < 0) {
    throw new __velarProcessNativeTypeError("Desktop host returned an invalid process start result");
  }
  return value;
}
function resultOf(value, maxOutputBytes) {
  value = recordOf(value, "Desktop process result", processResultFields);
  if ((value.code !== null && !__velarProcessIsSafeInteger(value.code))
    || (value.signal !== null && (typeof value.signal !== "string" || value.signal.length === 0 || value.signal.length > 128))
    || typeof value.stdout !== "string" || typeof value.stderr !== "string") {
    throw new __velarProcessNativeTypeError("Desktop host returned an invalid process result");
  }
  if (__velarUtf8ByteLength(value.stdout) + __velarUtf8ByteLength(value.stderr) > maxOutputBytes) {
    throw new __velarProcessNativeRangeError("Desktop process result exceeded maxOutputBytes");
  }
  return __velarProcessFreeze({code: value.code, signal: value.signal, stdout: value.stdout, stderr: value.stderr});
}
function processErrorOf(value) {
  value = recordOf(value, "Desktop process host error", processErrorFields);
  if (typeof value.name !== "string" || value.name !== "Error" && value.name !== "RangeError" && value.name !== "TypeError"
    || typeof value.message !== "string" || value.message.length === 0 || value.message.length > 65536) {
    throw new __velarProcessNativeTypeError("Desktop process host returned an invalid error");
  }
  if (value.name === "RangeError") return new __velarProcessNativeRangeError(value.message);
  if (value.name === "TypeError") return new __velarProcessNativeTypeError(value.message);
  return new __velarProcessNativeError(value.message);
}
function outputOf(value, maxOutputBytes) {
  if (value === null) return null;
  value = recordOf(value, "Desktop process output", processOutputFields);
  if (!ProcessOutputChannel.is(value.channel) || typeof value.text !== "string" || value.text.length === 0) {
    throw new __velarProcessNativeTypeError("Desktop host returned invalid process output");
  }
  const bytes = __velarUtf8ByteLength(value.text);
  if (bytes > maxOutputBytes) throw new __velarProcessNativeRangeError("Desktop process output exceeded maxOutputBytes");
  return __velarProcessFreeze({channel: value.channel, text: value.text, bytes});
}
function stopValueOf(value, maxOutputBytes) {
  value = recordOf(value, "Desktop process stop result", processStopFields);
  const resultDescriptor = __velarProcessOwnDescriptor(value, "result");
  const errorDescriptor = __velarProcessOwnDescriptor(value, "error");
  if (!resultDescriptor || !("value" in resultDescriptor) || !errorDescriptor || !("value" in errorDescriptor)
    || value.result !== null && value.error !== null) {
    throw new __velarProcessNativeTypeError("Desktop process stop result is invalid or contradictory");
  }
  return {
    result: value.result === null ? null : resultOf(value.result, maxOutputBytes),
    error: value.error === null ? null : processErrorOf(value.error),
  };
}
function waitValueOf(value, maxOutputBytes) {
  value = recordOf(value, "Desktop process wait result", processWaitFields);
  const resultDescriptor = __velarProcessOwnDescriptor(value, "result");
  const errorDescriptor = __velarProcessOwnDescriptor(value, "error");
  const retainedDescriptor = __velarProcessOwnDescriptor(value, "retained");
  if (!resultDescriptor || !("value" in resultDescriptor) || !errorDescriptor || !("value" in errorDescriptor)
    || !retainedDescriptor || !("value" in retainedDescriptor) || typeof value.retained !== "boolean"
    || value.result !== null && value.error !== null
    || value.retained && (value.result !== null || value.error === null)
    || !value.retained && value.result === null && value.error === null) {
    throw new __velarProcessNativeTypeError("Desktop process wait result is invalid or contradictory");
  }
  return {
    result: value.result === null ? null : resultOf(value.result, maxOutputBytes),
    error: value.error === null ? null : processErrorOf(value.error),
    retained: value.retained,
  };
}
function invoke(operation, args, timeout = 30000) {
  return __velarDesktopHostCall("process", operation, args, timeout);
}
class ProcessHandle {
  constructor(token, handle, pid, maxOutputBytes) {
    if (token !== processToken || !__velarProcessIsSafeInteger(handle) || handle < 1 || !__velarProcessIsSafeInteger(pid) || pid < 0) {
      throw new __velarProcessNativeTypeError("Process values are created only by velar/process.start");
    }
    this.handle = handle;
    this.pid = pid;
    this.maxOutputBytes = maxOutputBytes;
    this.result = null;
    this.stopping = null;
    this.stopRequested = false;
    this.cleanup = null;
    this.reading = false;
    this.waitStarted = false;
    this.outputBytes = 0;
    this.next = async () => {
      if (this.waitStarted) throw new __velarProcessNativeError("Process output must be consumed before wait()");
      if (this.stopRequested) throw new __velarProcessNativeError("Process output is unavailable after stop()");
      if (this.reading) throw new __velarProcessNativeError("Process.next() allows only one active pull");
      this.reading = true;
      try {
        const output = outputOf(await invoke("read", [this.handle], 0), this.maxOutputBytes);
        if (output === null) return null;
        this.outputBytes += output.bytes;
        if (this.outputBytes > this.maxOutputBytes) throw new __velarProcessNativeRangeError("Desktop process output exceeded maxOutputBytes");
        return __velarProcessFreeze({channel: output.channel, text: output.text});
      } finally {
        this.reading = false;
      }
    };
    __velarProcessSeal(this);
  }
  wait() {
    if (this.reading) return __velarProcessReject(new __velarProcessNativeError("Process wait() cannot run while next() is pending"));
    this.waitStarted = true;
    if (!this.result) {
      let result;
      result = __velarProcessThen(invoke("wait", [this.handle], 0), value => {
        let outcome;
        try { outcome = waitValueOf(value, this.maxOutputBytes); }
        catch (error) {
          if (this.result === result) this.result = null;
          throw error;
        }
        if (outcome.retained) {
          if (this.result === result) this.result = null;
          throw outcome.error;
        }
        if (outcome.error) throw outcome.error;
        return outcome.result;
      }, error => {
        if (this.result === result) this.result = null;
        throw error;
      });
      this.result = result;
    }
    return this.result;
  }
  async stop() {
    return await __velarProcessRetryableStop(this, () => __velarProcessThen(invoke("stop", [this.handle], 10000), value => {
        const outcome = stopValueOf(value, this.maxOutputBytes);
        if (outcome.error) this.result = __velarProcessObservedReject(outcome.error);
        else if (outcome.result) this.result = __velarProcessResolve(outcome.result);
        return null;
      }));
  }
}
export const Process = __velarProcessFreeze({
  is(value) { return value instanceof ProcessHandle; },
  parse(value) { if (!(value instanceof ProcessHandle)) throw new __velarProcessNativeTypeError("Process values are created only by velar/process.start"); return value; },
});
export async function start(command, args = [], options = {}) {
  const wire = optionsOf(options);
  const value = startValueOf(await invoke("start", [boundedText(command, "Process command"), argumentsOf(args), wire]));
  return new ProcessHandle(processToken, value.handle, value.pid, wire.maxOutputBytes);
}
export async function run(command, args = [], options = {}) {
  const owner = await start(command, args, options);
  try { return await owner.wait(); }
  catch (error) {
    if (!owner.result) __velarProcessRetainRun(owner);
    throw error;
  }
}
`.trimStart();

const DESKTOP_ENV_SOURCE = String.raw`
${DESKTOP_HOST_ABI_RUNTIME}
const desktopEnvironment = __velarDesktopHostField("environment");
let cachedSnapshot = null;
function variableName(value) {
  if (typeof value !== "string" || !/^[A-Za-z_][A-Za-z0-9_]*$/u.test(value) || value.length > 256) {
    throw new TypeError("Environment variable names use ASCII letters, digits, and underscores, starting with a letter or underscore");
  }
  return value;
}
function snapshot() {
  if (cachedSnapshot) return cachedSnapshot;
  if (!desktopEnvironment || typeof desktopEnvironment !== "object" || Array.isArray(desktopEnvironment)) {
    throw new Error("VelarScript Desktop environment snapshot is unavailable");
  }
  const value = desktopEnvironment;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) throw new TypeError("Desktop environment snapshot must be a plain record");
  const keys = Reflect.ownKeys(value);
  if (keys.length > 64) throw new RangeError("Desktop environment snapshot cannot exceed 64 variables");
  const output = Object.create(null);
  let bytes = 0;
  for (const key of keys) {
    if (typeof key !== "string" || !/^[A-Z_][A-Z0-9_]{0,127}$/u.test(key)) throw new TypeError("Desktop environment snapshot has an invalid variable name");
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor?.enumerable || !("value" in descriptor)) throw new TypeError("Desktop environment snapshot fields must be enumerable data values");
    if (typeof descriptor.value !== "string") throw new TypeError("Desktop environment snapshot values must be text");
    const itemBytes = new TextEncoder().encode(descriptor.value).byteLength;
    bytes += new TextEncoder().encode(key).byteLength + itemBytes;
    if (itemBytes > 64 * 1024 || bytes > 1024 * 1024) throw new RangeError("Desktop environment snapshot exceeds its size boundary");
    output[key] = descriptor.value;
  }
  cachedSnapshot = Object.freeze(output);
  return cachedSnapshot;
}
export function get(name) {
  name = variableName(name);
  const values = snapshot();
  return Object.prototype.hasOwnProperty.call(values, name) ? Object.getOwnPropertyDescriptor(values, name).value : null;
}
export function require(name) {
  name = variableName(name);
  const value = get(name);
  if (value === null) throw new Error("VelarScript environment variable '" + name + "' is required");
  return value;
}
`.trimStart();

const DESKTOP_HTTP_SOURCE = String.raw`
${VELAR_STRICT_JSON_RUNTIME}
${VELAR_TYPE_REGISTRY_RUNTIME}
${VELAR_UTF8_RUNTIME}
${DESKTOP_HOST_ABI_RUNTIME}
const maxResponseChunks = 1000000;
let nextHandle = 1;
const secretHeaderValues = new WeakSet();
function parseJsonText(text) {
  return __velarJsonParse(text, "HTTP JSON text");
}
function runtimeHttpType(Type) { return __velarRequireRuntimeType(Type, "HTTP parsing"); }
function methodOf(value) {
  if (typeof value !== "string") throw new TypeError("HTTP method must be text");
  const method = value.toUpperCase();
  if (method.length === 0 || method.length > 32 || !/^[!#$%&'*+.^_\x60|~0-9A-Z-]+$/u.test(method) || ["CONNECT", "TRACE", "TRACK"].includes(method)) {
    throw new TypeError("HTTP method is invalid or forbidden");
  }
  return method;
}
function urlOf(value) {
  if (typeof value !== "string" || value.length === 0 || value.length > 2 * 1024 * 1024) throw new TypeError("HTTP URL must be bounded text");
  const url = new URL(value);
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new TypeError("HTTP URL must use http or https");
  if (url.username || url.password) throw new TypeError("HTTP URL credentials are not allowed; use an Authorization header");
  return url.href;
}
export class HttpAbortError extends Error {
  constructor(reason) {
    if (reason !== "cancelled" && reason !== "timeout") throw new TypeError("HTTP abort reason must be cancelled or timeout");
    super(reason === "timeout" ? "HTTP request timed out" : "HTTP request cancelled");
    this.name = "HttpAbortError"; this.reason = reason;
  }
}
// D60 rule 149: a module-provided enum carries the same runtime face a declared
// enum does -- charter section 6 reserves is, parse, and values on every enum.
export const HttpTransportPhase = __velarRegisterRuntimeType(Object.freeze({
  request: "request",
  response: "response",
  is(value) { return value === "request" || value === "response"; },
  parse(value) {
    if (!HttpTransportPhase.is(value)) throw new TypeError("Value does not match HttpTransportPhase");
    return value;
  },
  values() { return ["request", "response"]; },
}));
export class HttpTransportError extends Error {
  constructor(message, phase) {
    if (typeof message !== "string") throw new TypeError("HTTP transport error message must be text");
    if (message.length === 0 || message.length > 65536) throw new RangeError("HTTP transport error messages must contain at most 64 KiB");
    if (phase !== HttpTransportPhase.request && phase !== HttpTransportPhase.response) {
      throw new TypeError("HTTP transport phase must be request or response");
    }
    super(message); this.name = "HttpTransportError"; this.phase = phase;
  }
}
export class HttpError extends Error {
  constructor(message, status, url, body = null) {
    if (typeof message !== "string") throw new TypeError("HTTP error message must be text");
    if (message.length > 65536) throw new RangeError("HTTP error messages cannot exceed 64 KiB");
    if (!Number.isInteger(status) || status < 100 || status > 599) throw new RangeError("HTTP error status must be an integer from 100 through 599");
    if (typeof url !== "string") throw new TypeError("HTTP error URL must be text");
    if (url.length > 2 * 1024 * 1024) throw new RangeError("HTTP error URLs cannot exceed 2 MiB");
    super(message); this.name = "HttpError"; this.status = status; this.url = url; this.body = body;
  }
}
function headersOf(value) {
  if (value == null) return [];
  let size;
  try { size = Reflect.getOwnPropertyDescriptor(Map.prototype, "size").get.call(value); }
  catch { throw new TypeError("HTTP headers must be Map<string, string>"); }
  if (size > 100) throw new RangeError("HTTP headers cannot exceed 100 fields");
  const output = [];
  let units = 0;
  for (const pair of Map.prototype.entries.call(value)) {
    const name = pair[0]; const item = pair[1];
    if (typeof name !== "string" || typeof item !== "string" || !/^[!#$%&'*+.^_|~0-9A-Za-z-]+$/u.test(name) || /[\r\n]/u.test(item)) {
      throw new TypeError("HTTP headers must use valid string names and single-line values");
    }
    units += name.length + item.length;
    if (units > 65536) throw new RangeError("HTTP headers cannot exceed 64 KiB");
    output.push([name, item]);
  }
  return output;
}
function checkedHeaders(value) {
  if (value.length > 100) throw new RangeError("HTTP headers cannot exceed 100 fields");
  let units = 0;
  for (const pair of value) {
    units += pair[0].length + pair[1].length;
    if (units > 65536) throw new RangeError("HTTP headers cannot exceed 64 KiB");
  }
  return value;
}
const forbiddenSecretHeaders = new Set(["connection", "content-length", "cookie", "cookie2", "host", "proxy-authorization", "te", "trailer", "transfer-encoding", "upgrade"]);
export function secretHeader(name, environment, prefix = "") {
  if (typeof name !== "string" || !/^[!#$%&'*+.^_|~0-9A-Za-z-]+$/u.test(name) || forbiddenSecretHeaders.has(name.toLowerCase())) {
    throw new TypeError("HTTP secret header name is invalid or transport-controlled");
  }
  if (typeof environment !== "string" || !/^[A-Z_][A-Z0-9_]{0,127}$/u.test(environment)) {
    throw new TypeError("HTTP secret environment name must be uppercase ASCII text");
  }
  if (typeof prefix !== "string" || prefix.length > 256 || /[\r\n]/u.test(prefix)) {
    throw new TypeError("HTTP secret header prefix must be single-line text of at most 256 characters");
  }
  const value = Object.freeze({name, environment, prefix});
  secretHeaderValues.add(value);
  return value;
}
function secretHeadersOf(value) {
  if (value == null) return [];
  if (!Array.isArray(value) || value.length > 16) throw new TypeError("HTTP secretHeaders must be a List with at most 16 entries");
  const output = [];
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, index);
    if (!descriptor?.enumerable || !("value" in descriptor) || !secretHeaderValues.has(descriptor.value)) {
      throw new TypeError("HTTP secretHeaders entries must be created by secretHeader");
    }
    output.push(descriptor.value);
  }
  return output;
}
function plainOptions(value) {
  if (value == null) return Object.create(null);
  if (typeof value !== "object" || Array.isArray(value)) throw new TypeError("HTTP options must be a record");
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) throw new TypeError("HTTP options must be a plain record");
  const allowed = new Set(["headers", "secretHeaders", "body", "timeout", "maxBytes"]);
  const output = Object.create(null);
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string" || !allowed.has(key)) throw new TypeError("HTTP options has an unknown field '" + String(key) + "'");
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor?.enumerable || !("value" in descriptor)) throw new TypeError("HTTP options fields must be enumerable data values");
    output[key] = descriptor.value;
  }
  return output;
}
function optionsOf(value, method) {
  const options = plainOptions(value);
  const timeout = options.timeout ?? 120000;
  if (!Number.isSafeInteger(timeout) || timeout < 0 || timeout > 600000) throw new RangeError("HTTP timeout must be an integer from 0 through 600000 milliseconds");
  const maxBytes = options.maxBytes ?? 16 * 1024 * 1024;
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > 64 * 1024 * 1024) throw new RangeError("HTTP maxBytes must be an integer from 1 through 67108864");
  const headers = headersOf(options.headers);
  const secretHeaders = secretHeadersOf(options.secretHeaders);
  let body = options.body ?? null;
  if ((method === "GET" || method === "HEAD") && body !== null) throw new TypeError(method + " requests cannot have a body");
  if (body !== null && typeof body !== "string") {
    body = __velarJsonStringify(body);
    if (!headers.some(pair => pair[0].toLowerCase() === "content-type")) headers.push(["content-type", "application/json"]);
    checkedHeaders(headers);
  }
  if (typeof body === "string" && __velarUtf8ByteLength(body) > 16 * 1024 * 1024) throw new RangeError("HTTP body cannot exceed 16 MiB");
  return Object.freeze({headers, secretHeaders, body, timeout, maxBytes});
}
function invoke(operation, args, timeout = 30000) {
  return __velarDesktopHostCall("http", operation, args, timeout);
}
function bridgeTransportError(error, phase) {
  if (!error || typeof error !== "object") return null;
  const name = Object.getOwnPropertyDescriptor(error, "name");
  const message = Object.getOwnPropertyDescriptor(error, "message");
  const actualPhase = Object.getOwnPropertyDescriptor(error, "phase");
  if (!name || !("value" in name) || name.value !== "VelarDesktopHttpTransportError"
    || !message || !("value" in message) || typeof message.value !== "string" || message.value.length === 0 || message.value.length > 65536
    || !actualPhase?.enumerable || !("value" in actualPhase) || actualPhase.value !== phase) return null;
  return new HttpTransportError(message.value, phase);
}
function responseOf(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new TypeError("Desktop bridge returned an invalid HTTP response");
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) throw new TypeError("Desktop bridge returned an invalid HTTP response");
  const allowed = new Set(["ok", "status", "statusText", "url", "headers", "body"]);
  const fields = Object.create(null);
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string" || !allowed.has(key)) throw new TypeError("Desktop bridge returned an unknown HTTP response field");
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor?.enumerable || !("value" in descriptor)) throw new TypeError("Desktop bridge HTTP response fields must be enumerable data values");
    fields[key] = descriptor.value;
  }
  for (const key of allowed) if (!Object.prototype.hasOwnProperty.call(fields, key)) throw new TypeError("Desktop bridge HTTP response is missing field '" + key + "'");
  if (typeof fields.ok !== "boolean" || !Number.isInteger(fields.status) || fields.status < 100 || fields.status > 599
    || fields.ok !== (fields.status >= 200 && fields.status <= 299)) {
    throw new TypeError("Desktop bridge returned invalid HTTP response metadata");
  }
  if (typeof fields.statusText !== "string") throw new TypeError("HTTP response status text must be text");
  if (fields.statusText.length > 65536) throw new RangeError("HTTP response status text cannot exceed 64 KiB");
  if (typeof fields.url !== "string") throw new TypeError("HTTP response URL must be text");
  if (fields.url.length > 2 * 1024 * 1024) throw new RangeError("HTTP response URLs cannot exceed 2 MiB");
  if (typeof fields.body !== "boolean") throw new TypeError("Desktop bridge HTTP response body marker must be boolean");
  if (!Array.isArray(fields.headers) || fields.headers.length > 100) throw new TypeError("Desktop bridge HTTP response headers must be a bounded List");
  const headers = new Map();
  let units = 0;
  for (let index = 0; index < fields.headers.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(fields.headers, String(index));
    if (!descriptor?.enumerable || !("value" in descriptor)) throw new TypeError("Desktop bridge HTTP response headers must be dense data values");
    const pair = descriptor.value;
    if (!Array.isArray(pair) || pair.length !== 2) throw new TypeError("Desktop bridge HTTP response headers must contain pairs");
    const nameDescriptor = Object.getOwnPropertyDescriptor(pair, "0");
    const valueDescriptor = Object.getOwnPropertyDescriptor(pair, "1");
    const name = nameDescriptor?.value;
    const item = valueDescriptor?.value;
    if (!nameDescriptor?.enumerable || !("value" in nameDescriptor) || !valueDescriptor?.enumerable || !("value" in valueDescriptor)
      || typeof name !== "string" || typeof item !== "string" || !/^[!#$%&'*+.^_|~0-9A-Za-z-]+$/u.test(name) || /[\r\n]/u.test(item)) {
      throw new TypeError("Desktop bridge HTTP response headers are invalid");
    }
    units += name.length + item.length;
    if (units > 65536) throw new RangeError("HTTP response headers cannot exceed 64 KiB");
    headers.set(name, item);
  }
  return Object.freeze({ok: fields.ok, status: fields.status, statusText: fields.statusText, url: fields.url, headers, body: fields.body});
}
function chunkOf(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new TypeError("Desktop bridge returned an invalid HTTP chunk");
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) throw new TypeError("Desktop bridge returned an invalid HTTP chunk");
  const keys = Reflect.ownKeys(value);
  if (keys.length !== 2 || !keys.includes("done") || !keys.includes("text")) throw new TypeError("Desktop bridge returned an invalid HTTP chunk");
  const done = Object.getOwnPropertyDescriptor(value, "done");
  const text = Object.getOwnPropertyDescriptor(value, "text");
  if (!done?.enumerable || !("value" in done) || !text?.enumerable || !("value" in text)
    || typeof done.value !== "boolean" || typeof text.value !== "string") {
    throw new TypeError("Desktop bridge HTTP chunks must contain boolean done and text data values");
  }
  return {done: done.value, text: text.value};
}
class DesktopResponse {
  constructor(value, request) {
    const response = responseOf(value);
    this.ok = response.ok; this.status = response.status; this.statusText = response.statusText; this.url = response.url;
    this.headers = response.headers; this.body = response.body; this.request = request; this.cachedText = null; this.textPending = null; this.consuming = false;
    if (!this.body) request.finish();
    Object.seal(this);
  }
  async consume(consumer) {
    if (this.cachedText !== null) {
      const result = await consumer(this.cachedText);
      if (result !== null) throw new TypeError("HTTP stream consumer must resolve to null");
      return null;
    }
    if (this.consuming) throw new Error("HTTP response body is already being consumed");
    this.consuming = true;
    let chunks = 0;
    try {
      if (!this.body) return null;
      while (true) {
        let wire;
        try { wire = await invoke("read", [this.request.handle], 0); }
        catch (error) {
          if (this.request.abortError) throw this.request.abortError;
          throw bridgeTransportError(error, HttpTransportPhase.response) ?? error;
        }
        const chunk = chunkOf(wire);
        if (!chunk.done) {
          chunks += 1;
          if (chunks > maxResponseChunks) throw new RangeError("HTTP responses cannot exceed 1000000 chunks");
        }
        if (chunk.text) {
          const result = await consumer(chunk.text);
          if (result !== null) throw new TypeError("HTTP stream consumer must resolve to null");
        }
        if (chunk.done) break;
        if (this.request.abortError) throw this.request.abortError;
      }
      if (this.request.abortError) throw this.request.abortError;
      return null;
    } catch (error) {
      if (this.request.abortError) throw this.request.abortError;
      void invoke("cancel", [this.request.handle], 10000).catch(() => {});
      throw error;
    } finally {
      this.request.finish();
    }
  }
  async streamText(consumer) { if (typeof consumer !== "function") throw new TypeError("HTTP streamText requires an async consumer"); return this.consume(consumer); }
  async text() {
    if (this.cachedText !== null) return this.cachedText;
    if (this.textPending !== null) return this.textPending;
    const pending = (async () => {
      const chunks = [];
      await this.consume(async chunk => { chunks.push(chunk); return null; });
      return chunks.join("");
    })();
    this.textPending = pending;
    try {
      this.cachedText = await pending;
      return this.cachedText;
    } finally {
      if (this.textPending === pending) this.textPending = null;
    }
  }
  async json() { return parseJsonText(await this.text()); }
  async parse(Type) { Type = runtimeHttpType(Type); return Type.parse(await this.json()); }
}
class DesktopRequest {
  constructor(method, url, options) {
    this.method = methodOf(method); this.url = urlOf(url); this.options = optionsOf(options, this.method); this.handle = nextHandle++; this.pending = null; this.timer = null; this.abortError = null; this.finished = false;
  }
  finish() { if (this.finished) return; this.finished = true; if (this.timer) { clearTimeout(this.timer); this.timer = null; } }
  abort(reason) {
    if (this.finished || this.abortError) return;
    this.abortError = new HttpAbortError(reason);
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    void invoke("cancel", [this.handle], 10000).catch(() => {});
  }
  async response() {
    if (this.pending) return this.pending;
    if (this.abortError) throw this.abortError;
    const timeout = this.options.timeout ?? 120000;
    if (!Number.isSafeInteger(timeout) || timeout < 0 || timeout > 600000) throw new RangeError("HTTP timeout must be an integer from 0 through 600000 milliseconds");
    if (timeout) this.timer = setTimeout(() => this.abort("timeout"), timeout);
    this.pending = (async () => {
      try {
        let value;
        try { value = await invoke("request", [this.handle, this.method, this.url, this.options], timeout === 0 ? 0 : Math.min(600000, timeout + 1000)); }
        catch (error) {
          if (this.abortError) throw this.abortError;
          throw bridgeTransportError(error, HttpTransportPhase.request) ?? error;
        }
        if (this.abortError) throw this.abortError;
        const response = new DesktopResponse(value, this);
        if (!response.ok) {
          const text = await response.text();
          let body = text;
          try { body = text ? parseJsonText(text) : null; } catch {}
          const errorUrl = response.url || this.url;
          throw new HttpError("HTTP " + response.status + " for " + errorUrl, response.status, errorUrl, body);
        }
        return response;
      } catch (error) {
        if (!this.abortError && !this.finished) void invoke("cancel", [this.handle], 10000).catch(() => {});
        this.finish();
        if (this.abortError) throw this.abortError;
        throw error;
      }
    })();
    return this.pending;
  }
  async text() { return (await this.response()).text(); }
  async json() { return (await this.response()).json(); }
  async streamText(consumer) { return (await this.response()).streamText(consumer); }
  async parse(Type) { Type = runtimeHttpType(Type); return Type.parse(await this.json()); }
  cancel() { this.abort("cancelled"); return null; }
}
const create = method => (url, options = {}) => new DesktopRequest(method, url, options);
export const http = Object.freeze({
  request(method, url, options = {}) { return new DesktopRequest(method, url, options); },
  get: create("GET"), post: create("POST"), put: create("PUT"), patch: create("PATCH"), delete: create("DELETE"), head: create("HEAD"),
});
`.trimStart();

const desktopModuleInterfaces = new Map(webCompilerExtension.modules!.interfaces);
desktopModuleInterfaces.set("velar/desktop", desktopModuleInterface);
desktopModuleInterfaces.set("velar/desktop-test", desktopTestModuleInterface);
desktopModuleInterfaces.set("velar/fs", nodeModuleInterfaces.get("velar/fs")!);
desktopModuleInterfaces.set("velar/path", nodeModuleInterfaces.get("velar/path")!);
desktopModuleInterfaces.set("velar/process", desktopProcessInterface);
desktopModuleInterfaces.set("velar/http", nodeModuleInterfaces.get("velar/http")!);
desktopModuleInterfaces.set("velar/env", nodeModuleInterfaces.get("velar/env")!);
const desktopModuleSources = new Map(webCompilerExtension.modules!.sources);
const desktopModuleDependencies = new Map(webCompilerExtension.modules!.dependencies);
desktopModuleSources.set("velar/desktop", DESKTOP_MODULE_SOURCE);
desktopModuleSources.set("velar/desktop-test", DESKTOP_TEST_SOURCE);
desktopModuleSources.set("velar/fs", DESKTOP_FS_SOURCE);
desktopModuleSources.set("velar/path", DESKTOP_PATH_SOURCE);
desktopModuleSources.set("velar/process", DESKTOP_PROCESS_SOURCE);
desktopModuleSources.set("velar/http", DESKTOP_HTTP_SOURCE);
desktopModuleSources.set("velar/env", DESKTOP_ENV_SOURCE);

export const velarCompilerExtension: CompilerExtension = Object.freeze({
  id: "@velarscript/desktop",
  contract: Object.freeze({
    protocolVersion: 1,
    apiVersion: VELAR_DESKTOP_API_VERSION,
    kind: "application",
    extends: Object.freeze({}),
    composes: Object.freeze({
      "@velarscript/web": webCompilerExtension.contract!.apiVersion,
      "@velarscript/node": VELAR_NODE_API_VERSION,
    }),
  }),
  capabilities: Object.freeze(["web", "desktop"]),
  // Desktop is an application composition: Web owns surface syntax,
  // reactivity, DOM lowering, and browser runtime; Desktop owns only its
  // capability modules and host bridge. Keep each layer explicit so adding a
  // future application target cannot inherit hidden Web behavior via spread.
  lexical: webCompilerExtension.lexical!,
  parser: webCompilerExtension.parser!,
  analyzer: webCompilerExtension.analyzer!,
  semantic: webCompilerExtension.semantic!,
  inspection: webCompilerExtension.inspection!,
  analysis: webCompilerExtension.analysis!,
  editor: webCompilerExtension.editor!,
  formatting: webCompilerExtension.formatting!,
  createEmitter: webCompilerExtension.createEmitter!,
  modules: Object.freeze({
    apiVersion: VELAR_DESKTOP_API_VERSION,
    interfaces: desktopModuleInterfaces,
    sources: desktopModuleSources,
    dependencies: desktopModuleDependencies,
    source(specifier: string, projectConfig: unknown) {
      if (specifier === "velar/desktop") return DESKTOP_MODULE_SOURCE;
      if (specifier === "velar/desktop-test") return DESKTOP_TEST_SOURCE;
      if (specifier === "velar/fs") return DESKTOP_FS_SOURCE;
      if (specifier === "velar/path") return DESKTOP_PATH_SOURCE;
      if (specifier === "velar/process") return DESKTOP_PROCESS_SOURCE;
      if (specifier === "velar/http") return DESKTOP_HTTP_SOURCE;
      const config = projectConfig as VelarDesktopConfig;
      return webModuleSource(specifier, { base: "/", publicConfig: { desktop: { identifier: config.identifier } } });
    },
  }),
});

export { velarProjectExtension, type VelarDesktopConfig } from "./config.ts";
