import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";
import vm from "node:vm";

test("Desktop WebView bridge chunks large requests and responses without changing values", async () => {
  const hostSource = await readFile(resolve("packages/desktop/native/macos/VelarDesktopHost.swift"), "utf8");
  assert.match(hostSource, /let entryBytes = name\.utf8\.count \+ valueBytes/u);
  assert.match(hostSource, /environmentBytes \+ entryBytes <= 1024 \* 1024/u);
  assert.match(hostSource, /process\.terminationHandler/u);
  assert.match(hostSource, /case "process-owned":/u);
  assert.match(hostSource, /Darwin\.kill\(-owner\.pid, SIGKILL\)/u);
  assert.match(hostSource, /pending\.removeAll/u);
  assert.match(hostSource, /private var pending: \[Int: PendingRequest\]/u);
  assert.match(hostSource, /func webView\(_ webView: WKWebView, didCommit navigation:/u);
  assert.match(hostSource, /worker\.retire\(generation: generation\)/u);
  assert.match(hostSource, /response\["id"\] = request\.identity\.id/u);
  assert.match(hostSource, /pendingRequestBytes \+ bytes\.byteLength > 128 \* 1024 \* 1024/u);
  assert.match(hostSource, /responseBytes > 128 \* 1024 \* 1024/u);
  assert.match(hostSource, /private struct BridgeTransportCancel/u);
  assert.match(hostSource, /"hostCommand": "request-cancel"/u);
  const match = /private let bridgeScript = #"""\n([\s\S]*?)\n"""#/u.exec(hostSource);
  const bridgeSource = match?.[1];
  assert.ok(bridgeSource, "native host must contain the injected bridge script");
  const messages: Array<Record<string, unknown>> = [];
  const context = vm.createContext({
    atob,
    btoa,
    clearTimeout,
    crypto: webcrypto,
    setTimeout,
    TextDecoder,
    TextEncoder,
    webkit: { messageHandlers: { velarDesktop: { postMessage(value: Record<string, unknown>) { messages.push(value); } } } },
  });
  const source = bridgeSource
    .replace("__VELAR_PROJECT_DIRECTORY__", JSON.stringify("/tmp/velar-project"))
    .replace("__VELAR_ENVIRONMENT__", JSON.stringify({ LANG: "en_US.UTF-8" }));
  vm.runInContext(`${source}\nglobalThis.__bridgeUnderTest = globalThis[Symbol.for("velar.desktop.bridge.v1")]`, context);
  const bridge = (context as { __bridgeUnderTest?: { invoke(capability: string, operation: string, args: unknown[], timeout?: number): Promise<unknown> } }).__bridgeUnderTest;
  assert.ok(bridge);

  vm.runInContext(`
    globalThis.atob = () => { throw new Error("poisoned atob"); };
    globalThis.btoa = () => { throw new Error("poisoned btoa"); };
    globalThis.clearTimeout = () => { throw new Error("poisoned clearTimeout"); };
    globalThis.setTimeout = () => { throw new Error("poisoned setTimeout"); };
    globalThis.Promise = class PoisonedPromise { constructor() { throw new Error("poisoned Promise"); } };
    globalThis.TextDecoder = class PoisonedTextDecoder { constructor() { throw new Error("poisoned TextDecoder"); } };
    globalThis.TextEncoder = class PoisonedTextEncoder { constructor() { throw new Error("poisoned TextEncoder"); } };
    Array.isArray = () => { throw new Error("poisoned Array.isArray"); };
    JSON.parse = () => { throw new Error("poisoned JSON.parse"); };
    JSON.stringify = () => { throw new Error("poisoned JSON.stringify"); };
    Map.prototype.delete = () => { throw new Error("poisoned Map.delete"); };
    Map.prototype.get = () => { throw new Error("poisoned Map.get"); };
    Map.prototype.has = () => { throw new Error("poisoned Map.has"); };
    Map.prototype.set = () => { throw new Error("poisoned Map.set"); };
    Math.ceil = () => { throw new Error("poisoned Math.ceil"); };
    Math.min = () => { throw new Error("poisoned Math.min"); };
    Number.isSafeInteger = () => { throw new Error("poisoned Number.isSafeInteger"); };
    String.fromCharCode = () => { throw new Error("poisoned String.fromCharCode"); };
    String.prototype.charCodeAt = () => { throw new Error("poisoned charCodeAt"); };
    Uint8Array.prototype.set = () => { throw new Error("poisoned Uint8Array.set"); };
    Uint8Array.prototype.subarray = () => { throw new Error("poisoned Uint8Array.subarray"); };
    webkit.messageHandlers.velarDesktop.postMessage = () => { throw new Error("poisoned postMessage"); };
  `, context);

  const input = `prefix:${"\u0001".repeat(600_000)}:suffix`;
  const result = bridge.invoke("fs", "writeText", ["large.txt", input], 0);
  assert.ok(messages.length > 1);
  assert.ok(messages.every((message) => message.transport === "chunk"));
  const requestBytes = Buffer.concat(messages.map((message) => Buffer.from(message.base64 as string, "base64")));
  const request = JSON.parse(requestBytes.toString("utf8")) as { generation: string; id: number; capability: string; operation: string; args: [string, string] };
  assert.match(request.generation, /^[0-9a-f]{32}$/u);
  assert.ok(messages.every((message) => message.generation === request.generation));
  assert.deepEqual({ capability: request.capability, operation: request.operation, path: request.args[0] }, {
    capability: "fs",
    operation: "writeText",
    path: "large.txt",
  });
  assert.equal(request.args[1], input);

  const output = `response:${"界".repeat(300_000)}`;
  const response = Buffer.from(JSON.stringify({ id: request.id, ok: true, value: output }), "utf8");
  const chunkBytes = 192 * 1024;
  const total = Math.ceil(response.byteLength / chunkBytes);
  const receive = (context as { __velarDesktopTransportChunk?: (generation: string, id: number, index: number, total: number, base64: string) => void }).__velarDesktopTransportChunk;
  const complete = (context as { __velarDesktopComplete?: (generation: string, response: unknown) => void }).__velarDesktopComplete;
  assert.ok(receive);
  assert.ok(complete);
  let settled = false;
  void result.then(() => { settled = true; }, () => { settled = true; });
  complete("0".repeat(32), { id: request.id, ok: true, value: "forged" });
  receive("0".repeat(32), request.id, 0, total, response.subarray(0, Math.min(response.byteLength, chunkBytes)).toString("base64"));
  await new Promise((resolveWait) => setImmediate(resolveWait));
  assert.equal(settled, false, "a page must not forge native completion without its private generation");
  for (let index = total - 1; index >= 0; index -= 1) {
    receive(request.generation, request.id, index, total, response.subarray(index * chunkBytes, Math.min(response.byteLength, (index + 1) * chunkBytes)).toString("base64"));
  }
  assert.equal(await result, output);

  const reloadedMessages: Array<Record<string, unknown>> = [];
  const reloadedContext = vm.createContext({
    atob,
    btoa,
    clearTimeout,
    crypto: webcrypto,
    setTimeout,
    TextDecoder,
    TextEncoder,
    webkit: { messageHandlers: { velarDesktop: { postMessage(value: Record<string, unknown>) { reloadedMessages.push(value); } } } },
  });
  vm.runInContext(`${source}\nglobalThis.__bridgeUnderTest = globalThis[Symbol.for("velar.desktop.bridge.v1")]`, reloadedContext);
  const reloadedBridge = (reloadedContext as { __bridgeUnderTest?: { invoke(capability: string, operation: string, args: unknown[], timeout?: number): Promise<unknown> } }).__bridgeUnderTest;
  assert.ok(reloadedBridge);
  const reloadedResult = reloadedBridge.invoke("desktop", "projectDirectory", [], 0);
  const reloadedRequest = reloadedMessages[0] as { generation: string; id: number };
  assert.equal(reloadedRequest.id, request.id, "a reloaded document intentionally restarts its page-local request IDs");
  assert.notEqual(reloadedRequest.generation, request.generation);
  const reloadedComplete = (reloadedContext as { __velarDesktopComplete?: (generation: string, response: unknown) => void }).__velarDesktopComplete;
  assert.ok(reloadedComplete);
  let reloadedSettled = false;
  void reloadedResult.then(() => { reloadedSettled = true; }, () => { reloadedSettled = true; });
  reloadedComplete(request.generation, { id: reloadedRequest.id, ok: true, value: "stale" });
  await new Promise((resolveWait) => setImmediate(resolveWait));
  assert.equal(reloadedSettled, false, "an old document response must not settle a reloaded document request with the same page ID");
  reloadedComplete(reloadedRequest.generation, { id: reloadedRequest.id, ok: true, value: "/tmp/velar-project" });
  assert.equal(await reloadedResult, "/tmp/velar-project");

  const timedResult = reloadedBridge.invoke("fs", "readText", ["slow.txt", 1024], 1);
  const timedRequest = reloadedMessages.at(-1) as { generation: string; id: number; transport?: string };
  assert.equal(timedRequest.transport, undefined);
  await assert.rejects(timedResult, /Desktop host request timed out/u);
  const cancellation = reloadedMessages.at(-1) as Record<string, unknown>;
  assert.deepEqual({ ...cancellation }, {
    protocolVersion: 1,
    transport: "cancel",
    generation: timedRequest.generation,
    id: timedRequest.id,
  });
});
