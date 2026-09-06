const maxTextBytes = 16 * 1024 * 1024;
const safeEnvironmentNames = ["HOME", "LANG", "LC_ALL", "PATH", "SHELL", "TERM", "TMPDIR", "USER", "SystemRoot", "WINDIR"];
const processOptionFields = new __velarProcessNativeSet(["cwd", "env", "stdin", "timeout", "maxOutputBytes"]);
const processStartFields = new __velarProcessNativeSet(["handle", "pid"]);
const processResultFields = new __velarProcessNativeSet(["code", "signal", "stdout", "stderr"]);
const processOutputFields = new __velarProcessNativeSet(["channel", "text"]);
const processStopFields = new __velarProcessNativeSet(["result", "error"]);
const processWaitFields = new __velarProcessNativeSet(["result", "error", "retained"]);
const processErrorFields = new __velarProcessNativeSet(["name", "message"]);
const processHostMessageFields = new __velarProcessNativeSet(["kind", "id", "ok", "value", "error", "handle", "pid"]);
const __velarNodeProcessToken = Symbol("velar.node.process");
const __velarNodeProcessNativeProcess = process;
const __velarNodeProcessEnvironment = __velarNodeProcessNativeProcess.env;
const __velarNodeProcessKill = __velarProcessDataOperation(__velarNodeProcessNativeProcess, "kill");
const __velarNodeProcessPlatform = __velarNodeProcessNativeProcess.platform;
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
function plainRecord(value) {
  return __velarProcessRecord(value == null ? {} : value, "Process options", processOptionFields);
}
function environmentValue(name) {
  const descriptor = __velarProcessOwnDescriptor(__velarNodeProcessEnvironment, name);
  return descriptor && "value" in descriptor && typeof descriptor.value === "string" ? descriptor.value : null;
}
function environmentOf(value) {
  const output = __velarProcessCreate(null);
  for (const name of safeEnvironmentNames) {
    const item = environmentValue(name);
    if (item !== null) output[name] = item;
  }
  if (value == null) return output;
  const snapshot = __velarProcessMapSnapshot(value);
  if (snapshot.size > 1000) throw new __velarProcessNativeRangeError("Process env cannot exceed 1000 entries");
  let units = 0;
  for (let index = 0; index < snapshot.entries.length; index += 1) {
    const name = snapshot.entries[index][0];
    const item = snapshot.entries[index][1];
    if (!__velarProcessEnvironmentName(name) || typeof item !== "string" || __velarProcessIncludes(item, "\0")) throw new __velarProcessNativeTypeError("Process env must contain valid string variables");
    units += name.length + item.length;
    if (units > 1024 * 1024) throw new __velarProcessNativeRangeError("Process env cannot exceed 1 MiB");
    output[name] = item;
  }
  return output;
}
function optionsOf(value) {
  value = plainRecord(value);
  const cwd = value.cwd == null ? undefined : boundedText(value.cwd, "Process cwd");
  const stdin = value.stdin ?? "";
  if (typeof stdin !== "string" || __velarUtf8ByteLength(stdin) > maxTextBytes) throw new __velarProcessNativeRangeError("Process stdin cannot exceed 16 MiB");
  const timeout = value.timeout ?? 120000;
  if (!__velarProcessIsSafeInteger(timeout) || timeout < 0 || timeout > 600000) throw new __velarProcessNativeRangeError("Process timeout must be an integer from 0 through 600000 milliseconds");
  const maxOutputBytes = value.maxOutputBytes ?? 4 * 1024 * 1024;
  if (!__velarProcessIsSafeInteger(maxOutputBytes) || maxOutputBytes < 1 || maxOutputBytes > maxTextBytes) throw new __velarProcessNativeRangeError("Process maxOutputBytes must be an integer from 1 through 16777216");
  return { cwd, env: environmentOf(value.env), stdin, timeout, maxOutputBytes };
}

function processErrorOf(value) {
  value = __velarProcessRecord(value, "Node process host error", processErrorFields);
  if (typeof value.name !== "string" || value.name !== "Error" && value.name !== "RangeError" && value.name !== "TypeError"
    || typeof value.message !== "string" || value.message.length === 0 || value.message.length > 65536) {
    throw new __velarProcessNativeTypeError("Node process host returned an invalid error");
  }
  if (value.name === "RangeError") return new __velarProcessNativeRangeError(value.message);
  if (value.name === "TypeError") return new __velarProcessNativeTypeError(value.message);
  return new __velarProcessNativeError(value.message);
}
function startValueOf(value) {
  value = __velarProcessRecord(value, "Node process start result", processStartFields);
  if (!__velarProcessIsSafeInteger(value.handle) || value.handle < 1
    || !__velarProcessIsSafeInteger(value.pid) || value.pid < 0) {
    throw new __velarProcessNativeTypeError("Node process host returned an invalid start result");
  }
  return value;
}
function resultOf(value, maxOutputBytes) {
  value = __velarProcessRecord(value, "Node process result", processResultFields);
  if ((value.code !== null && !__velarProcessIsSafeInteger(value.code))
    || (value.signal !== null && (typeof value.signal !== "string" || value.signal.length === 0 || value.signal.length > 128))
    || typeof value.stdout !== "string" || typeof value.stderr !== "string") {
    throw new __velarProcessNativeTypeError("Node process host returned an invalid result");
  }
  if (__velarUtf8ByteLength(value.stdout) + __velarUtf8ByteLength(value.stderr) > maxOutputBytes) {
    throw new __velarProcessNativeRangeError("Node process result exceeded maxOutputBytes");
  }
  return __velarProcessFreeze({code: value.code, signal: value.signal, stdout: value.stdout, stderr: value.stderr});
}
function outputOf(value, maxOutputBytes) {
  if (value === null) return null;
  value = __velarProcessRecord(value, "Node process output", processOutputFields);
  if (!ProcessOutputChannel.is(value.channel) || typeof value.text !== "string" || value.text.length === 0) {
    throw new __velarProcessNativeTypeError("Node process host returned invalid output");
  }
  const bytes = __velarUtf8ByteLength(value.text);
  if (bytes > maxOutputBytes) throw new __velarProcessNativeRangeError("Node process output exceeded maxOutputBytes");
  return __velarProcessFreeze({channel: value.channel, text: value.text, bytes});
}
function stopValueOf(value, maxOutputBytes) {
  value = __velarProcessRecord(value, "Node process stop result", processStopFields);
  if (value.result !== null && value.error !== null) throw new __velarProcessNativeTypeError("Node process stop result is contradictory");
  return {
    result: value.result === null ? null : resultOf(value.result, maxOutputBytes),
    error: value.error === null ? null : processErrorOf(value.error),
  };
}
function waitValueOf(value, maxOutputBytes) {
  value = __velarProcessRecord(value, "Node process wait result", processWaitFields);
  if (typeof value.retained !== "boolean"
    || value.result !== null && value.error !== null
    || value.retained && (value.result !== null || value.error === null)
    || !value.retained && value.result === null && value.error === null) {
    throw new __velarProcessNativeTypeError("Node process wait result is invalid or contradictory");
  }
  return {
    result: value.result === null ? null : resultOf(value.result, maxOutputBytes),
    error: value.error === null ? null : processErrorOf(value.error),
    retained: value.retained,
  };
}

const __velarNodeProcessMessagePortPost = __velarProcessDataOperation(MessagePort.prototype, "postMessage");
const __velarNodeProcessMessagePortStart = __velarProcessDataOperation(MessagePort.prototype, "start");
const __velarNodeProcessMessagePortRef = __velarProcessDataOperation(MessagePort.prototype, "ref");
const __velarNodeProcessMessagePortUnref = __velarProcessDataOperation(MessagePort.prototype, "unref");
const __velarNodeProcessMessagePortClose = __velarProcessDataOperation(MessagePort.prototype, "close");
const __velarNodeProcessWorkerRef = __velarProcessDataOperation(Worker.prototype, "ref");
const __velarNodeProcessWorkerUnref = __velarProcessDataOperation(Worker.prototype, "unref");
const __velarNodeProcessWorkerTerminate = __velarProcessDataOperation(Worker.prototype, "terminate");
const __velarNodeProcessDefineProperty = __velarProcessDataOperation(__velarProcessNativeObject, "defineProperty");
const __velarNodeProcessEventOn = __velarProcessDataOperation(EventEmitter.prototype, "on");
const __velarNodeProcessMessageData = __velarProcessOwnDescriptor(globalThis.MessageEvent.prototype, "data")?.get;
if (typeof __velarNodeProcessMessageData !== "function") throw new __velarProcessNativeError("Node process MessageEvent data operation is unavailable");
const __velarNodeProcessPending = __velarProcessCreate(null);
const __velarNodeProcessOwners = __velarProcessCreate(null);
const __velarNodeProcessUnconfirmedOwners = __velarProcessCreate(null);
const __velarNodeProcessSettledOwners = __velarProcessCreate(null);
const __velarNodeProcessMaxPending = 1024;
let __velarNodeProcessNextRequest = 1;
let __velarNodeProcessPendingCount = 0;
let __velarNodeProcessRunningCount = 0;
// B: the one readiness deadline every Node Worker in this target shares.
// `velar/node-host-v1` and `velar/terminal` declare the same number under their
// own prefixes, and tests/node-process-readiness.test.ts pins the three to one
// value. The 10 s it replaces is a number a saturated machine lost races to.
const __velarNodeProcessReadyDeadlineMs = 30_000;
let __velarNodeProcessReady = false;
let __velarNodeProcessFailure = null;
let __velarNodeProcessReaper = null;
let __velarNodeProcessReaperAttempts = 0;
let __velarNodeProcessReadyResolve;
let __velarNodeProcessReadyReject;
const __velarNodeProcessReadyPromise = new __velarProcessNativePromise((resolve, reject) => {
  __velarNodeProcessReadyResolve = resolve;
  __velarNodeProcessReadyReject = reject;
});
const __velarNodeProcessChannel = new MessageChannel();
const __velarNodeProcessPort = __velarNodeProcessChannel.port1;

// D114 P6 items A and B: one rule for the handle this proxy owns.
//
// A Worker call the program can still be awaiting keeps the event loop alive.
// "Outstanding" is the readiness handshake, every in-flight request, and every
// child this process still owns; while any of them stands the MessagePort this
// module owns is ref'd, and when none does it is unref'd so an idle program
// exits. A settled failure is not outstanding: the pending calls are already
// rejected and the port is closed, so holding the loop for it would hang.
//
// Unreffing both handles once at boot and never re-reffing them left a call in
// flight held by nothing at all. That is the accounting behind `velar run`
// exiting 0 with @main still suspended at an await: nothing in the loop
// belonged to this module and Node drained cleanly.
//
// The port is the whole toggle and the Worker is released once, because the
// port is the only one of the two this module can reach through a captured
// reference. Node's own Worker.prototype.ref/unref re-read
// MessagePort.prototype.ref off the worker's *public* port on every call
// (node:internal/worker), so reffing the Worker per call handed a program that
// replaced one prototype method the power to decide whether this module's
// accounting ran — it threw on the first request instead. A ref'd port holds
// the loop for exactly as long as something is outstanding, which is all this
// accounting ever needed of a handle.
function __velarNodeProcessOutstanding() {
  if (__velarNodeProcessFailure) return false;
  return !__velarNodeProcessReady || __velarNodeProcessPendingCount > 0 || __velarNodeProcessRunningCount > 0;
}
// None of the next four may throw. Reference accounting runs inside the port
// handler and inside the promise executor in invoke(), where a throw strands a
// pending entry with the handles ref'd and nothing left to settle it, and the
// program can then never exit — a worse outcome than the failure it reports. A
// host operation this module cannot perform is a dead host, so it becomes this
// module's own named failure instead. The Worker binding is declared below and
// read only after the module body has finished, so the forward reference here
// is never evaluated uninitialized.
function __velarNodeProcessReferencePort(operation) {
  try { __velarProcessCall(operation, __velarNodeProcessPort, []); return true; }
  catch { return false; }
}
function __velarNodeProcessRetainWorker() {
  try { __velarProcessCall(__velarNodeProcessWorkerRef, __velarNodeProcessWorker, []); return true; }
  catch { return false; }
}
function __velarNodeProcessReleaseWorker() {
  try { __velarProcessCall(__velarNodeProcessWorkerUnref, __velarNodeProcessWorker, []); return true; }
  catch { return false; }
}
function __velarNodeProcessTerminateWorker() {
  try {
    __velarProcessThen(__velarProcessCall(__velarNodeProcessWorkerTerminate, __velarNodeProcessWorker, []), () => null, () => null);
    return true;
  } catch { return false; }
}
function __velarNodeProcessUpdateReference() {
  const outstanding = __velarNodeProcessOutstanding();
  if (__velarNodeProcessReferencePort(outstanding ? __velarNodeProcessMessagePortRef : __velarNodeProcessMessagePortUnref)) return;
  __velarNodeProcessFail(new __velarProcessNativeError("Node process worker reference accounting is unavailable"));
}
