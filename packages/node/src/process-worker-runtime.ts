// Complete Node-only process host. It is evaluated in an eagerly initialized
// Worker realm that never loads application dependencies, because Node's own
// child_process implementation consults public EventEmitter/stream prototypes
// while spawning and cannot be made post-initialization-stable in a shared
// application realm by wrapping only the outer calls.
export const VELAR_NODE_PROCESS_WORKER_SOURCE = String.raw`
import {spawn} from "node:child_process";
import {StringDecoder} from "node:string_decoder";
import {workerData} from "node:worker_threads";

const port = workerData;
const maxTextBytes = 16 * 1024 * 1024;
const maxProcessHandles = 128;
const maxOutputChunks = 1000000;
const stopConfirmationTimeoutMs = 5000;
const exitPipeConfirmationTimeoutMs = 5000;
const fatalDrainTimeoutMs = 8000;
const requestFields = new Set(["id", "operation", "args"]);
const optionFields = new Set(["cwd", "env", "stdin", "timeout", "maxOutputBytes"]);
const processHandles = new Map();
let nextProcessHandle = 1;
let fatalDrainStarted = false;
const terminationMarker = Object.freeze({});
const rootExitMarker = Object.freeze({});
const stopMarker = Object.freeze({});

function ownRecord(value, name, allowed) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError(name + " must be a record");
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) throw new TypeError(name + " must be a plain record");
  const output = Object.create(null);
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string" || !allowed.has(key)) throw new TypeError(name + " has an unknown field");
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor?.enumerable || !("value" in descriptor)) throw new TypeError(name + " fields must be enumerable data values");
    output[key] = descriptor.value;
  }
  return output;
}

function boundedText(value, name, maximum = 4096) {
  if (typeof value !== "string" || value.length === 0) throw new TypeError(name + " must be non-empty text");
  if (value.length > maximum || value.includes("\0")) throw new RangeError(name + " is outside the supported bounds");
  return value;
}

function integer(value, minimum, maximum, name) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new RangeError(name + " must be an integer from " + minimum + " through " + maximum);
  }
  return value;
}

function argumentsOf(value) {
  if (!Array.isArray(value) || value.length > 1000) throw new TypeError("Process args must be a bounded List<string>");
  const output = [];
  let units = 0;
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor?.enumerable || !("value" in descriptor)) throw new TypeError("Process args must contain enumerable data values");
    const item = boundedText(descriptor.value, "Process argument", 1024 * 1024);
    units += item.length;
    if (units > 1024 * 1024) throw new RangeError("Process arguments cannot exceed 1 MiB");
    output.push(item);
  }
  return output;
}

function environmentOf(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError("Process environment must be a record");
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) throw new TypeError("Process environment must be a plain record");
  const output = Object.create(null);
  const keys = Reflect.ownKeys(value);
  if (keys.length > 1010) throw new RangeError("Process environment cannot exceed its field limit");
  let units = 0;
  for (const name of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, name);
    if (typeof name !== "string" || !descriptor?.enumerable || !("value" in descriptor)
      || !/^[A-Za-z_][A-Za-z0-9_]*$/u.test(name)
      || typeof descriptor.value !== "string" || descriptor.value.includes("\0")) {
      throw new TypeError("Process environment must contain valid string variables");
    }
    const item = descriptor.value;
    units += name.length + item.length;
    if (units > 2 * 1024 * 1024) throw new RangeError("Process environment exceeds its transport boundary");
    output[name] = item;
  }
  return output;
}

function optionsOf(value) {
  value = ownRecord(value, "Process options", optionFields);
  const cwd = value.cwd == null ? undefined : boundedText(value.cwd, "Process cwd");
  const stdin = value.stdin ?? "";
  if (typeof stdin !== "string" || Buffer.byteLength(stdin, "utf8") > maxTextBytes) throw new RangeError("Process stdin cannot exceed 16 MiB");
  const timeout = integer(value.timeout ?? 120000, 0, 600000, "Process timeout");
  const maxOutputBytes = integer(value.maxOutputBytes ?? 4 * 1024 * 1024, 1, maxTextBytes, "Process maxOutputBytes");
  return {cwd, env: environmentOf(value.env), stdin, timeout, maxOutputBytes};
}

function processHandle(value) {
  return integer(value, 1, Number.MAX_SAFE_INTEGER, "Node process handle");
}

function errorRecord(error) {
  const name = error instanceof TypeError ? "TypeError" : error instanceof RangeError ? "RangeError" : "Error";
  let message = error instanceof Error ? error.message : "Node process host failed";
  if (typeof message !== "string" || message.length === 0) message = "Node process host failed";
  if (message.length > 65536) message = message.slice(0, 65536);
  return {name, message};
}

function terminalOutcome(task) {
  return task.result.then(
    (result) => ({result, error: null, retained: false}),
    (failure) => ({result: null, error: errorRecord(failure), retained: false}),
  );
}

async function confirmationOutcome(terminal) {
  let timer = null;
  const confirmationFailure = new Error("Process termination could not be confirmed within " + stopConfirmationTimeoutMs + " milliseconds");
  try {
    return await Promise.race([
      terminal,
      new Promise((resolve) => {
        timer = setTimeout(
          () => resolve({result: null, error: errorRecord(confirmationFailure), retained: true}),
          stopConfirmationTimeoutMs,
        );
      }),
    ]);
  } finally {
    if (timer !== null) clearTimeout(timer);
  }
}

async function waitForTask(task) {
  const terminal = terminalOutcome(task);
  if (!task.terminationRequested) {
    const first = await Promise.race([terminal, task.termination.then(() => terminationMarker)]);
    if (first !== terminationMarker) return first;
  }
  if (task.rootExited && !task.stopping) {
    const afterExit = await Promise.race([terminal, task.stopRequest.then(() => stopMarker)]);
    if (afterExit !== stopMarker) return afterExit;
    return await confirmationOutcome(terminal);
  }
  const confirmation = confirmationOutcome(terminal);
  const first = await Promise.race([
    terminal,
    confirmation,
    task.stopping ? new Promise(() => {}) : task.rootExit.then(() => rootExitMarker),
  ]);
  if (first !== rootExitMarker) return first;
  if (task.stopping) return await confirmation;
  const afterExit = await Promise.race([terminal, task.stopRequest.then(() => stopMarker)]);
  if (afterExit !== stopMarker) return afterExit;
  return await confirmationOutcome(terminal);
}

function send(value) {
  port.postMessage(value);
}

function signalTree(child, signal) {
  if (!child.pid) return;
  if (process.platform === "win32") {
    try {
      const args = ["/pid", String(child.pid), "/t"];
      if (signal === "SIGKILL") args.push("/f");
      const killer = spawn("taskkill", args, {shell: false, stdio: "ignore", windowsHide: true});
      killer.unref();
      return;
    } catch {}
    try { child.kill(signal); } catch {}
    return;
  }
  try { process.kill(-child.pid, signal); }
  catch { try { child.kill(signal); } catch {} }
}

async function waitForProcessGroupExit(child) {
  if (process.platform === "win32" || !child.pid) return;
  while (true) {
    try { process.kill(-child.pid, 0); }
    catch (error) {
      if (error && typeof error === "object" && error.code === "ESRCH") return;
      throw error;
    }
    await new Promise(resolve => setTimeout(resolve, 20));
  }
}

function launchProcess(command, commandArgs, options, settled) {
  const child = spawn(command, commandArgs, {
    cwd: options.cwd,
    env: options.env,
    shell: false,
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
    detached: process.platform !== "win32",
  });
  let resolveTermination;
  const termination = new Promise((resolve) => { resolveTermination = resolve; });
  let resolveRootExit;
  const rootExit = new Promise((resolve) => { resolveRootExit = resolve; });
  let resolveStopRequest;
  const stopRequest = new Promise((resolve) => { resolveStopRequest = resolve; });
  const task = {
    child,
    pid: child.pid ?? 0,
    settled: false,
    stopping: false,
    terminationRequested: false,
    termination,
    rootExited: false,
    rootExit,
    stopRequest,
    stdout: [],
    stderr: [],
    outputBytes: 0,
    outputChunks: 0,
    outputQueue: [],
    outputWaiter: null,
    reading: false,
    waitStarted: false,
    waitRetained: false,
    stdoutDecoder: new StringDecoder("utf8"),
    stderrDecoder: new StringDecoder("utf8"),
    failure: null,
    timer: null,
    exitTimer: null,
    result: null,
    terminate(failure, signal) {
      if (failure && !task.failure) task.failure = failure;
      if (!task.terminationRequested) {
        task.terminationRequested = true;
        resolveTermination();
      }
      if (task.outputWaiter) {
        const waiter = task.outputWaiter;
        task.outputWaiter = null;
        waiter.reject(task.failure ?? new Error("Process output is unavailable after stop()"));
      }
      signalTree(child, signal);
    },
    stop() {
      if (task.settled) return;
      if (task.stopping) {
        signalTree(child, "SIGKILL");
        return;
      }
      task.stopping = true;
      resolveStopRequest();
      if (task.exitTimer) {
        clearTimeout(task.exitTimer);
        task.exitTimer = null;
      }
      task.terminate(null, "SIGTERM");
      setTimeout(() => { if (!task.settled) signalTree(child, "SIGKILL"); }, 2000).unref();
    },
    async next() {
      if (task.waitStarted) throw new Error("Process output must be consumed before wait()");
      if (task.stopping) throw new Error("Process output is unavailable after stop()");
      if (task.terminationRequested) throw task.failure ?? new Error("Process output is unavailable after termination");
      if (task.reading) throw new Error("Process.next() allows only one active pull");
      task.reading = true;
      try {
        if (task.outputQueue.length > 0) return task.outputQueue.shift();
        if (task.settled) {
          if (task.failure) throw task.failure;
          return null;
        }
        return await new Promise((resolve, reject) => { task.outputWaiter = {resolve, reject}; });
      } finally {
        task.reading = false;
      }
    },
  };
  task.result = new Promise((resolve, reject) => {
    const deliver = (channel, text) => {
      if (text.length === 0 || task.failure) return;
      task.outputChunks += 1;
      if (task.outputChunks > maxOutputChunks) {
        task.terminate(new RangeError("Process output cannot exceed 1000000 chunks"), "SIGKILL");
        return;
      }
      const value = Object.freeze({channel, text});
      if (task.outputWaiter) {
        const waiter = task.outputWaiter;
        task.outputWaiter = null;
        waiter.resolve(value);
      } else task.outputQueue.push(value);
    };
    const collect = (target, decoder, channel, chunk) => {
      if (task.failure) return;
      task.outputBytes += chunk.byteLength;
      if (task.outputBytes > options.maxOutputBytes) {
        task.terminate(new RangeError("Process output exceeded maxOutputBytes"), "SIGKILL");
        return;
      }
      const copy = Buffer.from(chunk);
      target.push(copy);
      deliver(channel, decoder.write(copy));
    };
    child.stdout.on("data", (chunk) => collect(task.stdout, task.stdoutDecoder, "stdout", chunk));
    child.stderr.on("data", (chunk) => collect(task.stderr, task.stderrDecoder, "stderr", chunk));
    child.once("error", (error) => { task.terminate(error, "SIGKILL"); });
    child.once("exit", () => {
      task.rootExited = true;
      resolveRootExit();
      if (!task.stopping) {
        signalTree(child, "SIGTERM");
        setTimeout(() => { if (!task.settled) signalTree(child, "SIGKILL"); }, 2000).unref();
        task.exitTimer = setTimeout(() => {
          if (task.settled) return;
          if (!task.failure) task.failure = new Error("Process output streams did not close within " + exitPipeConfirmationTimeoutMs + " milliseconds after process exit");
          child.stdout.destroy();
          child.stderr.destroy();
        }, exitPipeConfirmationTimeoutMs);
        task.exitTimer.unref();
      }
    });
    child.once("close", (code, signal) => { void (async () => {
      // A POSIX root can close before all live descendants have stopped.
      // stop() owns the whole detached process group, so its result is not
      // terminal until that group has no live members. waitForTask() keeps this
      // confirmation bounded and retains the handle when it cannot be proven.
      if (task.stopping) await waitForProcessGroupExit(child);
      task.settled = true;
      if (task.timer) clearTimeout(task.timer);
      if (task.exitTimer) clearTimeout(task.exitTimer);
      deliver("stdout", task.stdoutDecoder.end());
      deliver("stderr", task.stderrDecoder.end());
      if (task.outputWaiter) {
        const waiter = task.outputWaiter;
        task.outputWaiter = null;
        if (task.outputQueue.length > 0) waiter.resolve(task.outputQueue.shift());
        else if (task.failure) waiter.reject(task.failure);
        else waiter.resolve(null);
      }
      settled();
      if (task.failure) reject(task.failure);
      else resolve(Object.freeze({
        code: code == null ? null : code,
        // taskkill reports an exit code rather than a POSIX signal. The public
        // Process contract reports the termination stop() requested, so callers
        // get one portable answer instead of an OS implementation detail.
        signal: signal == null && task.stopping && process.platform === "win32" ? "SIGTERM" : signal == null ? null : signal,
        stdout: Buffer.concat(task.stdout).toString("utf8"),
        stderr: Buffer.concat(task.stderr).toString("utf8"),
      }));
    })().catch((error) => {
      if (!task.failure) task.failure = error instanceof Error ? error : new Error("Process group exit confirmation failed");
      task.settled = true;
      if (task.timer) clearTimeout(task.timer);
      if (task.exitTimer) clearTimeout(task.exitTimer);
      settled();
      reject(task.failure);
    }); });
  });
  task.timer = options.timeout === 0 ? null : setTimeout(() => {
    if (task.settled) return;
    task.terminate(new Error("Process timed out after " + options.timeout + " milliseconds"), "SIGKILL");
  }, options.timeout);
  child.stdin.end(options.stdin);
  return task;
}

async function processStart(args) {
  if (processHandles.size >= maxProcessHandles) throw new RangeError("Node process handle limit reached");
  if (!Array.isArray(args) || args.length !== 3) throw new TypeError("Node process start arguments are invalid");
  const command = boundedText(args[0], "Process command");
  const commandArgs = argumentsOf(args[1]);
  const options = optionsOf(args[2]);
  const handle = nextProcessHandle++;
  const task = launchProcess(command, commandArgs, options, () => send({kind: "settled", handle}));
  processHandles.set(handle, task);
  // Transfer cleanup ownership before the start response. The application
  // proxy can then reap this process group even if this Worker exits between
  // accepting the child and resolving start().
  send({kind: "owned", handle, pid: task.pid});
  task.result.catch(() => {});
  return {handle, pid: task.pid};
}

async function processRead(args) {
  if (!Array.isArray(args) || args.length !== 1) throw new TypeError("Node process read arguments are invalid");
  const handle = processHandle(args[0]);
  const task = processHandles.get(handle);
  if (!task) throw new Error("Node process handle is unknown or already released");
  return task.next();
}

async function processWait(args) {
  if (!Array.isArray(args) || args.length !== 1) throw new TypeError("Node process wait arguments are invalid");
  const handle = processHandle(args[0]);
  const task = processHandles.get(handle);
  if (!task) throw new Error("Node process handle is unknown or already released");
  if (task.reading) throw new Error("Process wait() cannot run while next() is pending");
  task.waitStarted = true;
  if (task.waitRetained && !task.settled) signalTree(task.child, "SIGKILL");
  const outcome = await waitForTask(task);
  task.waitRetained = outcome.retained;
  if (!outcome.retained) processHandles.delete(handle);
  return outcome;
}

async function processStop(args) {
  if (!Array.isArray(args) || args.length !== 1) throw new TypeError("Node process stop arguments are invalid");
  const handle = processHandle(args[0]);
  const task = processHandles.get(handle);
  if (!task) return {result: null, error: null};
  task.stop();
  const outcome = await waitForTask(task);
  if (outcome.retained) throw new Error(outcome.error.message);
  processHandles.delete(handle);
  return {result: outcome.result, error: outcome.error};
}

async function fatalDrain() {
  if (fatalDrainStarted) return;
  fatalDrainStarted = true;
  port.removeAllListeners("message");
  const tasks = Array.from(processHandles.values());
  for (const task of tasks) task.stop();
  let timer = null;
  try {
    await Promise.race([
      Promise.allSettled(tasks.map(task => task.result)),
      new Promise(resolve => { timer = setTimeout(resolve, fatalDrainTimeoutMs); }),
    ]);
  } finally {
    if (timer !== null) clearTimeout(timer);
    for (const task of tasks) if (!task.settled) signalTree(task.child, "SIGKILL");
    process.exit(1);
  }
}

async function dispatch(value) {
  const request = ownRecord(value, "Node process request", requestFields);
  const id = integer(request.id, 1, Number.MAX_SAFE_INTEGER, "Node process request id");
  if (!Array.isArray(request.args)) throw new TypeError("Node process request args must be a List");
  let result;
  if (request.operation === "start") result = await processStart(request.args);
  else if (request.operation === "read") result = await processRead(request.args);
  else if (request.operation === "wait") result = await processWait(request.args);
  else if (request.operation === "stop") result = await processStop(request.args);
  else throw new TypeError("Unknown Node process operation");
  return {id, result};
}

port.on("message", (value) => {
  Promise.resolve(dispatch(value)).then(
    ({id, result}) => send({kind: "response", id, ok: true, value: result}),
    (error) => {
      const descriptor = value && typeof value === "object" ? Object.getOwnPropertyDescriptor(value, "id") : null;
      const id = descriptor && "value" in descriptor && Number.isSafeInteger(descriptor.value) ? descriptor.value : 0;
      send({kind: "response", id, ok: false, error: errorRecord(error)});
    },
  );
});
process.on("uncaughtException", () => { void fatalDrain(); });
process.on("unhandledRejection", () => { void fatalDrain(); });
port.on("close", () => { void fatalDrain(); });
process.once("exit", () => {
  for (const task of processHandles.values()) signalTree(task.child, "SIGKILL");
});
send({kind: "ready"});
`;
