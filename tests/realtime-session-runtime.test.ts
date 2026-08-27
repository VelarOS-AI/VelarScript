import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import test from "node:test";
import {VELAR_SERVER_REALTIME_RUNTIME} from "../packages/server/src/realtime-runtime.ts";
import {VELAR_WEB_REALTIME_CLIENT_RUNTIME} from "../packages/web/src/realtime-client-runtime.ts";

function executeModule(source: string): ReturnType<typeof spawnSync> {
  return spawnSync(process.execPath, ["--input-type=module"], {encoding: "utf8", input: source});
}

test("server realtimeSession owns one bounded writer and deterministic cleanup", () => {
  const runtime = VELAR_SERVER_REALTIME_RUNTIME.replace(
    /^import \{[^\n]+\} from "velar\/websocket";$/mu,
    `class __velarRealtimeTransportBackpressure extends Error {}
class __velarRealtimeTransportClosed extends Error {}
const __velarRealtimeConnection = {parse(value) { return value; }};`,
  );
  const execution = executeModule(`
${runtime}
const incoming = ["bad", "hello", null];
const sent = [];
let activeSends = 0;
let maximumActiveSends = 0;
let closeValue = null;
let resolveClose;
const closeInfo = new Promise(resolve => { resolveClose = resolve; });
const connection = {
  async next() { return incoming.shift(); },
  async send(message) {
    activeSends += 1;
    maximumActiveSends = Math.max(maximumActiveSends, activeSends);
    await new Promise(resolve => setTimeout(resolve, 1));
    sent.push(message);
    activeSends -= 1;
    return null;
  },
  async close(code, reason) {
    if (closeValue === null) { closeValue = {code, reason}; resolveClose(closeValue); }
    return null;
  },
  closeInfo() { return closeInfo; },
};
const codec = {
  decode(message) { if (message === "bad") throw new Error("invalid"); return {operation: message}; },
  encode(message) { return message.event; },
};
let cleanupCount = 0;
let openedCapacity = null;
let closedValue = null;
await realtimeSession(
  connection,
  codec,
  async (message, peer) => { await peer.send({event: message.operation.toUpperCase()}); },
  async peer => {
    openedCapacity = [peer.trySend({event: "opened"}), peer.trySend({event: "overflow"})];
    return async () => { cleanupCount += 1; return null; };
  },
  async (failure, peer) => {
    await peer.send({event: "failure:" + failure.phase});
    return RealtimeFailureAction.continue;
  },
  async (_peer, close) => { closedValue = close; return null; },
  {maxQueuedMessages: 1, maxQueuedBytes: 1024, drainTimeout: "1s"},
);
console.log(JSON.stringify({sent, maximumActiveSends, openedCapacity, cleanupCount, closeValue, closedValue}));
`);
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.deepEqual(JSON.parse(String(execution.stdout)), {
    sent: ["opened", "failure:decode", "HELLO"],
    maximumActiveSends: 1,
    openedCapacity: [true, false],
    cleanupCount: 1,
    closeValue: {code: 1000, reason: "Realtime session finished"},
    closedValue: {code: 1000, reason: "Realtime session finished"},
  });
  assert.match(VELAR_SERVER_REALTIME_RUNTIME, /queueHead/u);
  assert.doesNotMatch(VELAR_SERVER_REALTIME_RUNTIME, /queue\.shift\(/u);
  assert.doesNotMatch(VELAR_SERVER_REALTIME_RUNTIME, /new TextEncoder/u);
});

test("server realtimeSession reports a failed setup once and closes as an application failure", () => {
  const runtime = VELAR_SERVER_REALTIME_RUNTIME.replace(
    /^import \{[^\n]+\} from "velar\/websocket";$/mu,
    `class __velarRealtimeTransportClosed extends Error {}
const __velarRealtimeConnection = {parse(value) { return value; }};`,
  );
  const execution = executeModule(`
${runtime}
let resolveClose;
const closeInfo = new Promise(resolve => { resolveClose = resolve; });
let failures = 0;
const connection = {
  async next() { throw new Error("next must not run after setup fails"); },
  async send() { return null; },
  async close(code, reason) { resolveClose({code, reason}); return null; },
  closeInfo() { return closeInfo; },
};
await realtimeSession(
  connection,
  {decode: value => value, encode: value => value},
  async () => null,
  async () => { throw new Error("setup failed"); },
  async failure => { failures += 1; return RealtimeFailureAction.close; },
);
console.log(JSON.stringify({failures, close: await closeInfo}));
`);
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.deepEqual(JSON.parse(String(execution.stdout)), {
    failures: 1,
    close: {code: 1011, reason: "Realtime session setup failed"},
  });
});

test("browser realtimeClient reconnects explicitly without replaying commands", () => {
  const runtime = VELAR_WEB_REALTIME_CLIENT_RUNTIME.replace(
    /^import \{[^\n]+\} from "velar\/websocket";$/mu,
    `const __velarRealtimeConnection = {parse(value) { return value; }};
const __velarRealtimeConnect = async () => connections.shift();`,
  );
  const execution = executeModule(`
const connections = [];
function completedConnection(messages, close) {
  return {
    sent: [],
    async next() { return messages.shift(); },
    async send(message) { this.sent.push(message); return null; },
    async close() { return null; },
    async closeInfo() { return close; },
  };
}
function heldConnection() {
  let resolveNext;
  let resolveClose;
  const next = new Promise(resolve => { resolveNext = resolve; });
  const closeInfo = new Promise(resolve => { resolveClose = resolve; });
  return {
    sent: [],
    next() { return next; },
    async send(message) { this.sent.push(message); return null; },
    async close(code, reason) { resolveNext(null); resolveClose({code, reason}); return null; },
    closeInfo() { return closeInfo; },
  };
}
const first = completedConnection(["bad", "one", null], {code: 1001, reason: "restart"});
const second = heldConnection();
connections.push(first, second);
${runtime}
const states = [];
const received = [];
const failures = [];
const closes = [];
let resolveSecond;
const secondOpened = new Promise(resolve => { resolveSecond = resolve; });
const client = realtimeClient(
  "wss://example.test/live",
  {
    decode(message) { if (message === "bad") throw new Error("invalid"); return {event: message}; },
    encode(message) { return message.operation; },
  },
  async message => { received.push(message.event); return null; },
  async (_client, open) => { if (open.generation === 2) resolveSecond(null); return null; },
  async failure => { failures.push(failure.phase); return RealtimeClientFailureAction.continue; },
  async (_client, close) => { closes.push(close.code); return null; },
  async (_client, state) => { states.push(state); return null; },
  {reconnectDelays: ["0ms"], reconnectJitter: 0},
);
await client.start();
await secondOpened;
await client.send({operation: "sync"});
await client.close(1000, "done");
await client.whenClosed();
console.log(JSON.stringify({states, received, failures, closes, generation: client.generation(), firstSent: first.sent, secondSent: second.sent}));
`);
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.deepEqual(JSON.parse(String(execution.stdout)), {
    states: ["connecting", "open", "reconnecting", "open", "closed"],
    received: ["one"],
    failures: ["decode"],
    closes: [1001, 1000],
    generation: 2,
    firstSent: [],
    secondSent: ["sync"],
  });
});

test("browser realtimeClient stops after an initial failure unless retryInitial is explicit", () => {
  const runtime = VELAR_WEB_REALTIME_CLIENT_RUNTIME.replace(
    /^import \{[^\n]+\} from "velar\/websocket";$/mu,
    `const __velarRealtimeConnection = {parse(value) { return value; }};
let attempts = 0;
const __velarRealtimeConnect = async () => { attempts += 1; throw new Error("offline"); };`,
  );
  const execution = executeModule(`
${runtime}
const client = realtimeClient(
  "wss://example.test/live",
  {decode: value => value, encode: value => value},
  async () => null,
);
let startFailure = "none";
try { await client.start(); } catch (failure) { startFailure = failure.message; }
await client.whenClosed();
console.log(JSON.stringify({attempts, startFailure, state: client.state(), generation: client.generation()}));
`);
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.deepEqual(JSON.parse(String(execution.stdout)), {
    attempts: 1,
    startFailure: "offline",
    state: "closed",
    generation: 0,
  });
});

test("browser realtimeClient settles idle waiters and callback failures without leaking its connection", () => {
  const runtime = VELAR_WEB_REALTIME_CLIENT_RUNTIME.replace(
    /^import \{[^\n]+\} from "velar\/websocket";$/mu,
    `const __velarRealtimeConnection = {parse(value) { return value; }};
const __velarRealtimeConnect = async () => connection;`,
  );
  const execution = executeModule(`
let resolveNext;
let resolveClose;
const next = new Promise(resolve => { resolveNext = resolve; });
const closeInfo = new Promise(resolve => { resolveClose = resolve; });
let transportCloses = 0;
const connection = {
  next() { return next; },
  async send() { return null; },
  async close(code, reason) { transportCloses += 1; resolveNext(null); resolveClose({code, reason}); return null; },
  closeInfo() { return closeInfo; },
};
${runtime}
const codec = {decode: value => value, encode: value => value};
const idle = realtimeClient("wss://example.test/idle", codec, async () => null);
const idleOpening = idle.whenOpen().then(() => "opened", failure => failure.name);
await idle.close();
await idle.whenClosed();

const failing = realtimeClient(
  "wss://example.test/live",
  codec,
  async () => null,
  null,
  null,
  null,
  async (_client, state) => { if (state === RealtimeClientState.closed) throw new Error("state failed"); },
);
await failing.start();
let closeFailure = "none";
try { await failing.close(); } catch (failure) { closeFailure = failure.message; }
let terminalFailure = "none";
try { await failing.whenClosed(); } catch (failure) { terminalFailure = failure.message; }
console.log(JSON.stringify({idleOpening: await idleOpening, idleState: idle.state(), closeFailure, terminalFailure, liveState: failing.state(), transportCloses}));
`);
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.deepEqual(JSON.parse(String(execution.stdout)), {
    idleOpening: "RealtimeUnavailableError",
    idleState: "closed",
    closeFailure: "state failed",
    terminalFailure: "state failed",
    liveState: "closed",
    transportCloses: 1,
  });
});
