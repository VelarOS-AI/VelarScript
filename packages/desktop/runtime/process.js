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
// An executable grant is only as narrow as that executable's own environment
// surface: many granted programs take a command, an interpreter option, or a
// loader path from their environment, so those names are not caller data. The
// identical predicate is duplicated host-side as reservedEnvironmentName in
// packages/desktop/native/node/worker.js; the two must not drift. PATH keeps
// its own longer-standing message. The bare spellings matter as much as the
// prefixed ones: git commit runs EDITOR, git log runs PAGER, and HOME moves the
// whole configuration surface — including the .gitconfig whose own core.editor
// runs a command — into a directory the caller chooses. The host's base
// environment snapshot owns HOME, SHELL and TMPDIR, so those are not caller
// data either.
const processReservedEnvironmentNames = /^(?:PATH|HOME|USERPROFILE|SHELL|TMPDIR|IFS|ENV|BASH_ENV|SHELLOPTS|BASHOPTS|PS4|EDITOR|VISUAL|PAGER|MANPAGER|MANOPT|BROWSER|SSH_ASKPASS|SUDO_ASKPASS|NODE_OPTIONS|NODE_REPL_EXTERNAL_MODULE)$/iu;
const processReservedEnvironmentPrefixes = /^(?:LD_|DYLD_|GIT_|XDG_|PYTHON|PERL|RUBY|LESS)/iu;
const processReservedEnvironmentSuffixes = /(?:_COMMAND|_EDITOR|_PAGER|_OPTS)$/iu;
function __velarProcessReservedEnvironmentName(name) {
  return __velarProcessCall(__velarProcessRegExpTest, processReservedEnvironmentNames, [name])
    || __velarProcessCall(__velarProcessRegExpTest, processReservedEnvironmentPrefixes, [name])
    || __velarProcessCall(__velarProcessRegExpTest, processReservedEnvironmentSuffixes, [name]);
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
    if (__velarProcessReservedEnvironmentName(name)) {
      throw new __velarProcessNativeTypeError("Process env cannot set the transport- or interpreter-controlled variable '" + name + "'");
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
