const VELAR_NODE_TERMINAL_INPUT_SOURCE = String.raw`
process.stdin.pause();
const send = value => { if (process.connected && typeof process.send === "function") process.send(value); };
process.stdin.on("data", data => send({kind: "input-data", data}));
process.stdin.on("end", () => { send({kind: "input-end"}); process.disconnect(); });
process.stdin.on("error", () => { send({kind: "input-error"}); process.disconnect(); });
process.on("message", value => {
  if (!value || typeof value !== "object") return;
  if (value.kind === "input-state" && typeof value.active === "boolean") {
    if (value.active) process.stdin.resume();
    else process.stdin.pause();
  } else if (value.kind === "close") {
    process.stdin.pause();
    process.exit(0);
  }
});
process.on("disconnect", () => process.exit(0));
send({kind: "ready"});
`.trimStart();

// Isolated terminal host. The Worker never loads application code or packages;
// an on-demand child owns the inherited stdin handle so a blocking pipe read is
// cancellable without exposing application-Realm stream prototypes.
export const VELAR_NODE_TERMINAL_WORKER_SOURCE = String.raw`
import { Buffer } from "node:buffer";
import { spawn } from "node:child_process";
import { write } from "node:fs";
import { StringDecoder } from "node:string_decoder";
import { isatty } from "node:tty";
import { workerData } from "node:worker_threads";

const port = workerData.port;
const inputHostSource = ${JSON.stringify(VELAR_NODE_TERMINAL_INPUT_SOURCE)};
const maxTextBytes = 1024 * 1024;
const maxQueuedLines = 256;
const decoder = new StringDecoder("utf8");
const waiting = [];
const queued = [];
let queuedBytes = 0;
let queueOverflowed = false;
let closed = false;
let inputHost = null;
let inputHostReady = false;
let inputHostEnded = false;
let inputHostActive = false;
let failure = null;
let lineParts = [];
let lineBytes = 0;
let lineOverflowed = false;
let swallowLineFeed = false;
let operationTail = Promise.resolve();

function errorRecord(error) {
  const name = error instanceof RangeError ? "RangeError" : error instanceof TypeError ? "TypeError" : "Error";
  const message = error instanceof Error && typeof error.message === "string" && error.message.length > 0
    ? error.message.slice(0, 65536)
    : "Node terminal host failed";
  return {name, message};
}

function respond(id, ok, value, error = null) {
  port.postMessage({kind: "response", id, ok, value, error});
}

function referenceInputHost(active) {
  if (inputHost === null) return;
  if (active) {
    inputHost.ref();
    inputHost.channel?.ref();
  } else {
    inputHost.channel?.unref();
    inputHost.unref();
  }
}

function ensureInputHost() {
  if (inputHost !== null || closed) return inputHost;
  inputHost = spawn(process.execPath, ["--input-type=module", "--eval", inputHostSource], {
    stdio: ["inherit", "ignore", "inherit", "ipc"],
    serialization: "advanced",
    windowsHide: true,
  });
  inputHost.on("message", value => {
    try {
      if (!value || typeof value !== "object") throw new TypeError("Node terminal input host returned an invalid message");
      if (value.kind === "ready") {
        inputHostReady = true;
        inputHost.send({kind: "input-state", active: inputHostActive});
      } else if (value.kind === "input-data") acceptForwardedData(value);
      else if (value.kind === "input-end") { inputHostEnded = true; endForwardedInput(); }
      else if (value.kind === "input-error") { inputHostEnded = true; endForwardedInput(new Error("Terminal input failed")); }
      else throw new TypeError("Node terminal input host returned an invalid message");
    } catch (error) { settleInput(error); }
  });
  inputHost.on("error", error => settleInput(error));
  inputHost.on("exit", code => {
    if (!closed && !inputHostEnded) settleInput(new Error("Node terminal input host exited unexpectedly with code " + code));
  });
  referenceInputHost(false);
  return inputHost;
}

function requestForwardedInput(active) {
  if (closed || inputHostActive === active) return;
  inputHostActive = active;
  const host = active ? ensureInputHost() : inputHost;
  if (host === null) return;
  referenceInputHost(active);
  if (inputHostReady) host.send({kind: "input-state", active});
}

function requestOf(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError("Node terminal host received an invalid request");
  const keys = Object.keys(value);
  if (keys.length !== 4 || !keys.includes("kind") || !keys.includes("id") || !keys.includes("operation") || !keys.includes("value")) {
    throw new TypeError("Node terminal host received an invalid request");
  }
  if (value.kind !== "request" || !Number.isSafeInteger(value.id) || value.id < 1
    || value.operation !== "readLine" && value.operation !== "write" && value.operation !== "writeError") {
    throw new TypeError("Node terminal host received an invalid request");
  }
  if (typeof value.value !== "string" || Buffer.byteLength(value.value, "utf8") > maxTextBytes) {
    throw new RangeError("Node terminal request text exceeds its 1 MiB boundary");
  }
  return value;
}

function writeText(fd, text) {
  const data = Buffer.from(text, "utf8");
  return new Promise((resolve, reject) => {
    let offset = 0;
    const next = () => {
      if (offset >= data.length) { resolve(null); return; }
      write(fd, data, offset, data.length - offset, null, (error, written) => {
        if (error) { reject(error); return; }
        if (!Number.isSafeInteger(written) || written < 1) {
          reject(new Error("Node terminal host made no write progress"));
          return;
        }
        offset += written;
        next();
      });
    };
    next();
  });
}

function deliver(entry) {
  const request = waiting.shift();
  if (request) {
    if (entry.error) respond(request.id, false, null, errorRecord(entry.error));
    else respond(request.id, true, entry.value);
    if (waiting.length === 0) requestForwardedInput(false);
    return;
  }
  if (queueOverflowed) return;
  if (queued.length >= maxQueuedLines || queuedBytes + entry.bytes > maxTextBytes) {
    queueOverflowed = true;
    queued.push({
      value: null,
      error: new RangeError("Terminal queued input exceeds its 1 MiB boundary"),
      bytes: 0,
      queueOverflow: true,
    });
    return;
  }
  queued.push(entry);
  queuedBytes += entry.bytes;
  requestForwardedInput(false);
}

function appendLine(text, start, end) {
  if (start >= end || lineOverflowed) return;
  const fragment = text.slice(start, end);
  const bytes = Buffer.byteLength(fragment, "utf8");
  if (lineBytes + bytes > maxTextBytes) {
    lineParts = [];
    lineBytes = 0;
    lineOverflowed = true;
    return;
  }
  lineParts.push(fragment);
  lineBytes += bytes;
}

function completeLine() {
  if (lineOverflowed) {
    deliver({
      value: null,
      error: new RangeError("Terminal input text exceeds its 1 MiB boundary"),
      bytes: 0,
      queueOverflow: false,
    });
  } else {
    deliver({value: lineParts.join(""), error: null, bytes: lineBytes, queueOverflow: false});
  }
  lineParts = [];
  lineBytes = 0;
  lineOverflowed = false;
}

function consume(text) {
  let start = 0;
  for (let index = 0; index < text.length; index += 1) {
    const unit = text.charCodeAt(index);
    if (swallowLineFeed) {
      swallowLineFeed = false;
      if (unit === 10) { start = index + 1; continue; }
    }
    if (unit !== 10 && unit !== 13) continue;
    appendLine(text, start, index);
    completeLine();
    start = index + 1;
    if (unit === 13) swallowLineFeed = true;
  }
  appendLine(text, start, text.length);
}

function settleInput(error = null) {
  if (closed) return;
  closed = true;
  failure = error;
  requestForwardedInput(false);
  while (waiting.length > 0) {
    const request = waiting.shift();
    if (error) respond(request.id, false, null, errorRecord(error));
    else respond(request.id, true, null);
  }
}

function acceptRead(id) {
  if (queued.length > 0) {
    const entry = queued.shift();
    queuedBytes -= entry.bytes;
    if (entry.queueOverflow) queueOverflowed = false;
    if (entry.error) respond(id, false, null, errorRecord(entry.error));
    else respond(id, true, entry.value);
    return;
  }
  if (failure) { respond(id, false, null, errorRecord(failure)); return; }
  if (closed) { respond(id, true, null); return; }
  waiting.push({id});
  requestForwardedInput(true);
}

function acceptForwardedData(value) {
  if (closed || !value || typeof value !== "object" || !(value.data instanceof Uint8Array)
    || value.data.byteLength > maxTextBytes) {
    throw new TypeError("Node terminal host received invalid forwarded input");
  }
  consume(decoder.write(value.data));
  if (waiting.length === 0) requestForwardedInput(false);
}

function endForwardedInput(error = null) {
  if (closed) return;
  if (error !== null) { settleInput(error); return; }
  const tail = decoder.end();
  if (tail) consume(tail);
  if (lineParts.length > 0 || lineOverflowed) completeLine();
  settleInput();
}

async function dispatch(value) {
  let request;
  try {
    request = requestOf(value);
    if (request.operation === "write" || request.operation === "writeError") {
      await writeText(request.operation === "write" ? 1 : 2, request.value);
      respond(request.id, true, null);
      return;
    }
    if (request.value.length > 0) await writeText(1, request.value);
    acceptRead(request.id);
  } catch (error) {
    if (request) respond(request.id, false, null, errorRecord(error));
    else throw error;
  }
}

function closeInput() {
  closed = true;
  failure = null;
  while (waiting.length > 0) waiting.shift();
  while (queued.length > 0) queued.shift();
  queuedBytes = 0;
  requestForwardedInput(false);
  if (inputHost !== null) {
    try { inputHost.send({kind: "close"}); } catch {}
  }
  port.postMessage({kind: "closed", error: null});
}

port.on("message", value => {
  if (value && typeof value === "object" && value.kind === "close") {
    closeInput();
    return;
  }
  operationTail = operationTail.then(() => dispatch(value));
  operationTail.catch(error => { queueMicrotask(() => { throw error; }); });
});
port.on("messageerror", () => { throw new Error("Node terminal host received an unreadable request"); });
port.start();
process.once("exit", () => { if (inputHost !== null) inputHost.kill("SIGKILL"); });
port.postMessage({kind: "ready", interactive: isatty(0) && isatty(1)});
`.trimStart();
