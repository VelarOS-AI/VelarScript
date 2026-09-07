import assert from "node:assert/strict";
import { Buffer as NodeBuffer } from "node:buffer";
import { ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createConnection } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { StringDecoder } from "node:string_decoder";
import { Writable } from "node:stream";
import test from "node:test";
import { MessagePort, Worker } from "node:worker_threads";
import { runtime } from "../support/node-runtime.ts";
import { registerRuntimeType } from "../support/runtime-type-registry.ts";

/**
 * D115 §三 — one `velar/*` module per file, split out of the 2,809-line heavy
 * tier `node-platform.slow.test.ts`. Every test here is the one that was
 * there, moved verbatim; the quick-tier core cases D114 GA-U3 lifted out stay
 * in `node-platform.test.ts` and `node-platform-serve.test.ts`.
 *
 * The subject is the one boundary `velar/process` and `velar/http` hold
 * together: a secret that must not leave the host, a cancellation that must
 * reach the child, a timeout that must not orphan one, and a stream that must
 * stay bounded either way. It is a single test, and a long one, because those
 * four properties are asserted against one live descendant tree.
 */

test("Node process and HTTP runtimes preserve secret, cancellation, timeout, and streaming boundaries", async () => {
  const processRuntime = await runtime<{
    readonly ProcessOutputChannel: Readonly<{ readonly stdout: "stdout"; readonly stderr: "stderr" }>;
    run(command: string, args?: readonly string[], options?: Record<string, unknown>): Promise<{ readonly code: number | null; readonly stdout: string }>;
    start(command: string, args?: readonly string[], options?: Record<string, unknown>): Promise<{
      next(): Promise<Readonly<{ readonly channel: "stdout" | "stderr"; readonly text: string }> | null>;
      stop(): Promise<null>;
      wait(): Promise<{ readonly signal: string | null; readonly stdout: string; readonly stderr: string }>;
    }>;
  }>("velar/process");
  assert.deepEqual(
    { stdout: processRuntime.ProcessOutputChannel.stdout, stderr: processRuntime.ProcessOutputChannel.stderr },
    { stdout: "stdout", stderr: "stderr" },
  );
  const secretName = `VELAR_NODE_SECRET_${process.pid}`;
  let escapedPid: number | null = null;
  process.env[secretName] = "must-not-leak";
  try {
    const hidden = await processRuntime.run(process.execPath, ["-e", `process.stdout.write(process.env.${secretName} ?? "hidden")`]);
    assert.equal(hidden.code, 0);
    assert.equal(hidden.stdout, "hidden");
    const explicit = await processRuntime.run(process.execPath, ["-e", "process.stdout.write(process.env.VISIBLE ?? 'missing')"], { env: new Map([["VISIBLE", "yes"]]) });
    assert.equal(explicit.stdout, "yes");
    const timerProbe = setTimeout(() => null, 2147483647);
    const timerPrototype = Object.getPrototypeOf(timerProbe);
    clearTimeout(timerProbe);
    const typedArrayPrototype = Object.getPrototypeOf(Uint8Array.prototype);
    const processIntrinsicDescriptors = {
      arrayIsArray: Object.getOwnPropertyDescriptor(Array, "isArray")!,
      bufferConcat: Object.getOwnPropertyDescriptor(NodeBuffer, "concat")!,
      bufferFrom: Object.getOwnPropertyDescriptor(NodeBuffer, "from")!,
      bufferToString: Object.getOwnPropertyDescriptor(NodeBuffer.prototype, "toString")!,
      childKill: Object.getOwnPropertyDescriptor(ChildProcess.prototype, "kill")!,
      childUnref: Object.getOwnPropertyDescriptor(ChildProcess.prototype, "unref")!,
      eventOn: Object.getOwnPropertyDescriptor(EventEmitter.prototype, "on")!,
      eventRemoveListener: Object.getOwnPropertyDescriptor(EventEmitter.prototype, "removeListener")!,
      mapEntries: Object.getOwnPropertyDescriptor(Map.prototype, "entries")!,
      mapSize: Object.getOwnPropertyDescriptor(Map.prototype, "size")!,
      messageData: Object.getOwnPropertyDescriptor(MessageEvent.prototype, "data")!,
      messagePortPost: Object.getOwnPropertyDescriptor(MessagePort.prototype, "postMessage")!,
      messagePortRef: Object.getOwnPropertyDescriptor(MessagePort.prototype, "ref")!,
      messagePortStart: Object.getOwnPropertyDescriptor(MessagePort.prototype, "start")!,
      messagePortUnref: Object.getOwnPropertyDescriptor(MessagePort.prototype, "unref")!,
      numberIsSafeInteger: Object.getOwnPropertyDescriptor(Number, "isSafeInteger")!,
      objectCreate: Object.getOwnPropertyDescriptor(Object, "create")!,
      objectFreeze: Object.getOwnPropertyDescriptor(Object, "freeze")!,
      objectGetOwnPropertyDescriptor: Object.getOwnPropertyDescriptor(Object, "getOwnPropertyDescriptor")!,
      objectGetPrototypeOf: Object.getOwnPropertyDescriptor(Object, "getPrototypeOf")!,
      objectSeal: Object.getOwnPropertyDescriptor(Object, "seal")!,
      reflectOwnKeys: Object.getOwnPropertyDescriptor(Reflect, "ownKeys")!,
      regExpTest: Object.getOwnPropertyDescriptor(RegExp.prototype, "test")!,
      setHas: Object.getOwnPropertyDescriptor(Set.prototype, "has")!,
      stringIncludes: Object.getOwnPropertyDescriptor(String.prototype, "includes")!,
      stringDecoderEnd: Object.getOwnPropertyDescriptor(StringDecoder.prototype, "end")!,
      stringDecoderWrite: Object.getOwnPropertyDescriptor(StringDecoder.prototype, "write")!,
      timerUnref: Object.getOwnPropertyDescriptor(timerPrototype, "unref")!,
      typedArrayByteLength: Object.getOwnPropertyDescriptor(typedArrayPrototype, "byteLength")!,
      processKill: Object.getOwnPropertyDescriptor(process, "kill")!,
      writableEnd: Object.getOwnPropertyDescriptor(Writable.prototype, "end")!,
      workerUnref: Object.getOwnPropertyDescriptor(Worker.prototype, "unref")!,
    };
    let processPoisonCalls = 0;
    const poison = () => { processPoisonCalls += 1; throw new Error("poisoned process intrinsic"); };
    let capturedProcessResult: { readonly stdout: string; readonly stderr: string } | null = null;
    const capturedProcessChunks: Array<Readonly<{ readonly channel: "stdout" | "stderr"; readonly text: string }>> = [];
    try {
      Object.defineProperty(Array, "isArray", { ...processIntrinsicDescriptors.arrayIsArray, value: poison });
      Object.defineProperty(NodeBuffer, "concat", { ...processIntrinsicDescriptors.bufferConcat, value: poison });
      Object.defineProperty(NodeBuffer, "from", { ...processIntrinsicDescriptors.bufferFrom, value: poison });
      Object.defineProperty(NodeBuffer.prototype, "toString", { ...processIntrinsicDescriptors.bufferToString, value: poison });
      Object.defineProperty(ChildProcess.prototype, "kill", { ...processIntrinsicDescriptors.childKill, value: poison });
      Object.defineProperty(ChildProcess.prototype, "unref", { ...processIntrinsicDescriptors.childUnref, value: poison });
      Object.defineProperty(EventEmitter.prototype, "on", { ...processIntrinsicDescriptors.eventOn, value: poison });
      Object.defineProperty(EventEmitter.prototype, "removeListener", { ...processIntrinsicDescriptors.eventRemoveListener, value: poison });
      Object.defineProperty(Map.prototype, "entries", { ...processIntrinsicDescriptors.mapEntries, value: poison });
      Object.defineProperty(Map.prototype, "size", { ...processIntrinsicDescriptors.mapSize, get: poison });
      Object.defineProperty(MessageEvent.prototype, "data", { ...processIntrinsicDescriptors.messageData, get: poison });
      Object.defineProperty(MessagePort.prototype, "postMessage", { ...processIntrinsicDescriptors.messagePortPost, value: poison });
      Object.defineProperty(MessagePort.prototype, "ref", { ...processIntrinsicDescriptors.messagePortRef, value: poison });
      Object.defineProperty(MessagePort.prototype, "start", { ...processIntrinsicDescriptors.messagePortStart, value: poison });
      Object.defineProperty(MessagePort.prototype, "unref", { ...processIntrinsicDescriptors.messagePortUnref, value: poison });
      Object.defineProperty(Number, "isSafeInteger", { ...processIntrinsicDescriptors.numberIsSafeInteger, value: poison });
      Object.defineProperty(Object, "create", { ...processIntrinsicDescriptors.objectCreate, value: poison });
      Object.defineProperty(Object, "freeze", { ...processIntrinsicDescriptors.objectFreeze, value: poison });
      Object.defineProperty(Object, "getOwnPropertyDescriptor", { ...processIntrinsicDescriptors.objectGetOwnPropertyDescriptor, value: poison });
      Object.defineProperty(Object, "getPrototypeOf", { ...processIntrinsicDescriptors.objectGetPrototypeOf, value: poison });
      Object.defineProperty(Object, "seal", { ...processIntrinsicDescriptors.objectSeal, value: poison });
      Object.defineProperty(Reflect, "ownKeys", { ...processIntrinsicDescriptors.reflectOwnKeys, value: poison });
      Object.defineProperty(RegExp.prototype, "test", { ...processIntrinsicDescriptors.regExpTest, value: poison });
      Object.defineProperty(Set.prototype, "has", { ...processIntrinsicDescriptors.setHas, value: poison });
      Object.defineProperty(String.prototype, "includes", { ...processIntrinsicDescriptors.stringIncludes, value: poison });
      Object.defineProperty(StringDecoder.prototype, "end", { ...processIntrinsicDescriptors.stringDecoderEnd, value: poison });
      Object.defineProperty(StringDecoder.prototype, "write", { ...processIntrinsicDescriptors.stringDecoderWrite, value: poison });
      Object.defineProperty(timerPrototype, "unref", { ...processIntrinsicDescriptors.timerUnref, value: poison });
      Object.defineProperty(typedArrayPrototype, "byteLength", { ...processIntrinsicDescriptors.typedArrayByteLength, get: poison });
      Object.defineProperty(process, "kill", { ...processIntrinsicDescriptors.processKill, value: poison });
      Object.defineProperty(Writable.prototype, "end", { ...processIntrinsicDescriptors.writableEnd, value: poison });
      Object.defineProperty(Worker.prototype, "unref", { ...processIntrinsicDescriptors.workerUnref, value: poison });
      const capturedProcess = await processRuntime.start(process.execPath, ["-e", "process.stdout.write(process.env.VISIBLE);process.stderr.write('safe')"], {
        env: new Map([["VISIBLE", "captured"]]),
        timeout: 1000,
      });
      while (true) {
        const chunk = await capturedProcess.next();
        if (chunk === null) break;
        capturedProcessChunks.push(chunk);
      }
      capturedProcessResult = await capturedProcess.wait();
    } finally {
      Object.defineProperty(Array, "isArray", processIntrinsicDescriptors.arrayIsArray);
      Object.defineProperty(NodeBuffer, "concat", processIntrinsicDescriptors.bufferConcat);
      Object.defineProperty(NodeBuffer, "from", processIntrinsicDescriptors.bufferFrom);
      Object.defineProperty(NodeBuffer.prototype, "toString", processIntrinsicDescriptors.bufferToString);
      Object.defineProperty(ChildProcess.prototype, "kill", processIntrinsicDescriptors.childKill);
      Object.defineProperty(ChildProcess.prototype, "unref", processIntrinsicDescriptors.childUnref);
      Object.defineProperty(EventEmitter.prototype, "on", processIntrinsicDescriptors.eventOn);
      Object.defineProperty(EventEmitter.prototype, "removeListener", processIntrinsicDescriptors.eventRemoveListener);
      Object.defineProperty(Map.prototype, "entries", processIntrinsicDescriptors.mapEntries);
      Object.defineProperty(Map.prototype, "size", processIntrinsicDescriptors.mapSize);
      Object.defineProperty(MessageEvent.prototype, "data", processIntrinsicDescriptors.messageData);
      Object.defineProperty(MessagePort.prototype, "postMessage", processIntrinsicDescriptors.messagePortPost);
      Object.defineProperty(MessagePort.prototype, "ref", processIntrinsicDescriptors.messagePortRef);
      Object.defineProperty(MessagePort.prototype, "start", processIntrinsicDescriptors.messagePortStart);
      Object.defineProperty(MessagePort.prototype, "unref", processIntrinsicDescriptors.messagePortUnref);
      Object.defineProperty(Number, "isSafeInteger", processIntrinsicDescriptors.numberIsSafeInteger);
      Object.defineProperty(Object, "create", processIntrinsicDescriptors.objectCreate);
      Object.defineProperty(Object, "freeze", processIntrinsicDescriptors.objectFreeze);
      Object.defineProperty(Object, "getOwnPropertyDescriptor", processIntrinsicDescriptors.objectGetOwnPropertyDescriptor);
      Object.defineProperty(Object, "getPrototypeOf", processIntrinsicDescriptors.objectGetPrototypeOf);
      Object.defineProperty(Object, "seal", processIntrinsicDescriptors.objectSeal);
      Object.defineProperty(Reflect, "ownKeys", processIntrinsicDescriptors.reflectOwnKeys);
      Object.defineProperty(RegExp.prototype, "test", processIntrinsicDescriptors.regExpTest);
      Object.defineProperty(Set.prototype, "has", processIntrinsicDescriptors.setHas);
      Object.defineProperty(String.prototype, "includes", processIntrinsicDescriptors.stringIncludes);
      Object.defineProperty(StringDecoder.prototype, "end", processIntrinsicDescriptors.stringDecoderEnd);
      Object.defineProperty(StringDecoder.prototype, "write", processIntrinsicDescriptors.stringDecoderWrite);
      Object.defineProperty(timerPrototype, "unref", processIntrinsicDescriptors.timerUnref);
      Object.defineProperty(typedArrayPrototype, "byteLength", processIntrinsicDescriptors.typedArrayByteLength);
      Object.defineProperty(process, "kill", processIntrinsicDescriptors.processKill);
      Object.defineProperty(Writable.prototype, "end", processIntrinsicDescriptors.writableEnd);
      Object.defineProperty(Worker.prototype, "unref", processIntrinsicDescriptors.workerUnref);
    }
    assert.equal(processPoisonCalls, 0);
    assert.deepEqual(capturedProcessResult, { code: 0, signal: null, stdout: "captured", stderr: "safe" });
    assert.equal(capturedProcessChunks.map((chunk) => chunk.text).join(""), "capturedsafe");
    let optionReads = 0;
    const accessorOptions = Object.defineProperty({}, "cwd", {
      enumerable: true,
      get() { optionReads += 1; return process.cwd(); },
    });
    await assert.rejects(processRuntime.run(process.execPath, ["--version"], accessorOptions), /enumerable data values/u);
    assert.equal(optionReads, 0);
    let argumentReads = 0;
    const accessorArguments: string[] = [];
    Object.defineProperty(accessorArguments, "0", {
      enumerable: true,
      configurable: true,
      get() { argumentReads += 1; return "--version"; },
    });
    accessorArguments.length = 1;
    await assert.rejects(processRuntime.run(process.execPath, accessorArguments), /enumerable data values/u);
    assert.equal(argumentReads, 0);
    await assert.rejects(processRuntime.run(process.execPath, ["--version"], { unexpected: true }), /unknown field 'unexpected'/u);
    await assert.rejects(
      processRuntime.run(process.execPath, ["x".repeat(600_000), "y".repeat(600_000)]),
      /arguments cannot exceed 1 MiB/u,
    );
    await assert.rejects(processRuntime.run(process.execPath, ["-e", "setTimeout(() => {}, 10000)"], { timeout: 10 }), /timed out/u);
    const streamed = await processRuntime.start(process.execPath, [
      "-e",
      "process.stdout.write('one');setTimeout(()=>process.stderr.write('two'),25)",
    ], { timeout: 1000 });
    const streamedChunks: Array<Readonly<{ channel: "stdout" | "stderr"; text: string }>> = [];
    while (true) {
      const chunk = await streamed.next();
      if (chunk === null) break;
      streamedChunks.push(chunk);
    }
    assert.deepEqual(streamedChunks.map((chunk) => `${chunk.channel}:${chunk.text}`), ["stdout:one", "stderr:two"]);
    const streamedResult = await streamed.wait();
    assert.equal(streamedResult.stdout, "one");
    assert.equal(streamedResult.stderr, "two");
    await assert.rejects(streamed.next(), /consumed before wait/u);

    const delayed = await processRuntime.start(process.execPath, ["-e", "setTimeout(()=>process.stdout.write('ready'),25)"], { timeout: 1000 });
    const firstPull = delayed.next();
    await assert.rejects(delayed.next(), /only one active pull/u);
    assert.deepEqual(await firstPull, { channel: "stdout", text: "ready" });
    assert.equal(await delayed.next(), null);
    await delayed.wait();

    const waitOnly = await processRuntime.start(process.execPath, ["-e", "process.stdout.write('done')"], { timeout: 1000 });
    assert.equal((await waitOnly.wait()).stdout, "done");
    await assert.rejects(waitOnly.next(), /consumed before wait/u);
    const running = await processRuntime.start(process.execPath, ["-e", "setTimeout(() => {}, 10000)"], { timeout: 0 });
    await running.stop();
    assert.equal((await running.wait()).signal, "SIGTERM");
    const descendantToken = `velar-descendant-${process.pid}-${Date.now()}`;
    const descendantSource = `const {createServer}=require("node:net"); const server=createServer(socket=>socket.end(${JSON.stringify(descendantToken)})); server.listen(0,"127.0.0.1",()=>process.stdout.write(String(server.address().port)+"\\n"));`;
    const tree = await processRuntime.start(process.execPath, ["-e", `const {spawn}=require("node:child_process"); const child=spawn(process.execPath,["-e",${JSON.stringify(descendantSource)}],{stdio:["ignore","pipe","inherit"]}); child.stdout.on("data",chunk=>process.stdout.write(chunk)); setTimeout(()=>{},10000);`], { timeout: 0 });
    let descendantPortText = "";
    while (!descendantPortText.includes("\n")) {
      const output = await tree.next();
      assert.ok(output);
      if (output.channel === "stdout") descendantPortText += output.text;
    }
    const descendantPort = Number(descendantPortText.trim());
    assert.equal(Number.isSafeInteger(descendantPort), true);
    assert.equal(await receivesTcpToken(descendantPort, descendantToken), true, "the descendant capability must be live before stop");
    await tree.stop();
    await tree.wait();
    assert.equal(await receivesTcpToken(descendantPort, descendantToken), false, "a completed stop must retire descendant capabilities");

    if (process.platform !== "win32") {
      const timeoutDirectory = await mkdtemp(join(tmpdir(), "velar-process-timeout-"));
      try {
        const pidFile = join(timeoutDirectory, "descendant.pid");
        const timeoutStartedAt = Date.now();
        await assert.rejects(processRuntime.run(process.execPath, ["-e", `
const {spawn} = require("node:child_process");
const {writeFileSync} = require("node:fs");
const descendant = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
  detached: true,
  stdio: ["ignore", "inherit", "inherit"],
});
descendant.unref();
writeFileSync(process.env.PID_FILE, String(descendant.pid));
setInterval(() => {}, 1000);
        `], { env: new Map([["PID_FILE", pidFile]]), timeout: 200 }), /timed out after 200 milliseconds/u);
        assert.ok(Date.now() - timeoutStartedAt < 8_000, "Process.run timeout must converge through post-exit pipes");
        escapedPid = Number(await readFile(pidFile, "utf8"));
        assert.equal(Number.isSafeInteger(escapedPid), true);
        assert.doesNotThrow(() => process.kill(escapedPid as number, 0));
        try { process.kill(-(escapedPid as number), "SIGKILL"); }
        catch { try { process.kill(escapedPid as number, "SIGKILL"); } catch {} }
        escapedPid = null;
      } finally {
        await rm(timeoutDirectory, { recursive: true, force: true });
      }

      const abandonedOutput = await processRuntime.start(process.execPath, ["-e", `
const {spawn} = require("node:child_process");
const descendant = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
  detached: true,
  stdio: ["ignore", "inherit", "inherit"],
});
descendant.unref();
process.stdout.write(String(descendant.pid) + "\\n");
      `], { timeout: 0 });
      let abandonedPidText = "";
      while (!abandonedPidText.includes("\n")) {
        const output = await abandonedOutput.next();
        assert.ok(output);
        abandonedPidText += output.text;
      }
      const abandonedPid = Number(abandonedPidText.trim());
      assert.equal(Number.isSafeInteger(abandonedPid), true);
      escapedPid = abandonedPid;
      const outputDeadlineStartedAt = Date.now();
      await assert.rejects(abandonedOutput.next(), /output streams did not close within 5000 milliseconds after process exit/u);
      assert.ok(Date.now() - outputDeadlineStartedAt < 8_000, "Process output must reject within its post-exit pipe deadline");
      await assert.rejects(abandonedOutput.wait(), /output streams did not close within 5000 milliseconds after process exit/u);
      assert.doesNotThrow(() => process.kill(abandonedPid, 0));
      try { process.kill(-abandonedPid, "SIGKILL"); }
      catch { try { process.kill(abandonedPid, "SIGKILL"); } catch {} }
      escapedPid = null;

      const escaped = await processRuntime.start(process.execPath, ["-e", `
const {spawn} = require("node:child_process");
const descendant = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
  detached: true,
  stdio: ["ignore", "inherit", "inherit"],
});
process.stdout.write(String(descendant.pid) + "\\n");
setInterval(() => {}, 1000);
      `], { timeout: 0 });
      let escapedPidText = "";
      while (!escapedPidText.includes("\n")) {
        const output = await escaped.next();
        assert.ok(output);
        escapedPidText += output.text;
      }
      const parsedEscapedPid = Number(escapedPidText.trim());
      assert.equal(Number.isSafeInteger(parsedEscapedPid), true);
      escapedPid = parsedEscapedPid;
      const escapedWait = escaped.wait();
      const stopStartedAt = Date.now();
      await assert.rejects(escaped.stop(), /termination could not be confirmed within 5000 milliseconds/u);
      await assert.rejects(escapedWait, /termination could not be confirmed within 5000 milliseconds/u);
      assert.ok(Date.now() - stopStartedAt < 8_000, "Process.stop must reject within its owned confirmation deadline");
      assert.doesNotThrow(() => process.kill(parsedEscapedPid, 0));
      try { process.kill(-parsedEscapedPid, "SIGKILL"); }
      catch { try { process.kill(parsedEscapedPid, "SIGKILL"); } catch {} }
      assert.notEqual((await escaped.wait()).signal, null);
      escapedPid = null;
    }
  } finally {
    if (escapedPid !== null) {
      try { process.kill(-escapedPid, "SIGKILL"); }
      catch { try { process.kill(escapedPid, "SIGKILL"); } catch {} }
    }
    delete process.env[secretName];
  }

  const http = await runtime<{
    readonly HttpAbortError: new (...args: unknown[]) => Error;
    readonly HttpResponseError: new (...args: unknown[]) => Error & { readonly body: unknown };
    readonly HttpTransportError: new (...args: unknown[]) => Error & { readonly phase: "request" | "response" };
    readonly HttpTransportPhase: Readonly<{ readonly request: "request"; readonly response: "response" }>;
    secretHeader(name: string, environment: string, prefix?: string): Readonly<{ name: string; environment: string; prefix: string }>;
    readonly http: {
      get(url: string, options?: Record<string, unknown>): {
        cancel(): null;
        json(): Promise<unknown>;
        parse<T>(target: { parse(value: unknown): T }): Promise<T>;
        text(): Promise<string>;
        response(): Promise<{ parse<T>(target: { parse(value: unknown): T }): Promise<T>; streamText(consume: (chunk: string) => Promise<null>): Promise<null> }>;
      };
      post(url: string, options?: Record<string, unknown>): { text(): Promise<string> };
    };
  }>("velar/http");
  // D90 fr-6: registry membership alone no longer admits a value; a Type must
  // still present the surface its caller invokes, so `is` is answered here the
  // way every Type the compiler emits answers it.
  const User = registerRuntimeType(Object.freeze({
    is(value: unknown): boolean { return !!value && typeof value === "object" && (value as { name?: unknown }).name === "Ada"; },
    parse(value: unknown): { name: string } {
      if (!value || typeof value !== "object" || (value as { name?: unknown }).name !== "Ada") throw new TypeError("invalid User");
      return value as { name: string };
    },
  }));
  const oversizedHttpBody = "é".repeat(8 * 1024 * 1024 + 1);
  const fullHttpHeaders = new Map<string, string>();
  for (let index = 0; index < 100; index += 1) fullHttpHeaders.set(`x-header-${index}`, "value");
  assert.throws(() => http.http.post("http://127.0.0.1/", { body: oversizedHttpBody }), /cannot exceed 16 MiB/u);
  assert.throws(() => http.http.post("http://127.0.0.1/", { body: { value: oversizedHttpBody } }), /cannot exceed 16 MiB/u);
  assert.throws(() => http.http.post("http://127.0.0.1/", { headers: fullHttpHeaders, body: { value: 1 } }), /cannot exceed 100 fields/u);
  const unavailable = createServer();
  await new Promise<void>((resolve, reject) => {
    unavailable.once("error", reject);
    unavailable.listen(0, "127.0.0.1", resolve);
  });
  const unavailableAddress = unavailable.address();
  assert.ok(unavailableAddress && typeof unavailableAddress !== "string");
  const unavailablePort = unavailableAddress.port;
  await new Promise<void>((resolve) => unavailable.close(() => resolve()));
  await assert.rejects(
    http.http.get(`http://127.0.0.1:${unavailablePort}/`).text(),
    (error: unknown) => error instanceof http.HttpTransportError
      && error.phase === http.HttpTransportPhase.request
      && error.message === "HTTP request transport failed",
  );
  let observedAuthorization: string | undefined;
  let redirectedSecret: string | undefined;
  const redirectTarget = createServer((request, response) => {
    const value = request.headers["x-provider-key"];
    redirectedSecret = typeof value === "string" ? value : undefined;
    if (request.url === "/error-target") {
      response.writeHead(502, { "content-type": "application/json" });
      response.end('{"failed":true}');
      return;
    }
    response.writeHead(200, { "content-type": "text/plain" });
    response.end("redirected");
  });
  await new Promise<void>((resolve, reject) => {
    redirectTarget.once("error", reject);
    redirectTarget.listen(0, "127.0.0.1", resolve);
  });
  const redirectAddress = redirectTarget.address();
  assert.ok(redirectAddress && typeof redirectAddress !== "string");
  const server = createServer((request, response) => {
    if (request.url === "/typed") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end('{"name":"Ada"}');
      return;
    }
    if (request.url === "/lossy-json") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end('{"value":1e400}');
      return;
    }
    if (request.url === "/lossy-error") {
      response.writeHead(500, { "content-type": "application/json" });
      response.end("1e400");
      return;
    }
    if (request.url === "/slow") {
      response.writeHead(200, { "content-type": "text/plain" });
      response.write("first");
      setTimeout(() => response.end("second"), 100);
      return;
    }
    if (request.url === "/authorized") {
      observedAuthorization = request.headers.authorization;
      response.writeHead(200, { "content-type": "text/plain" });
      response.end("authorized");
      return;
    }
    if (request.url === "/cancel-final") {
      response.writeHead(200, { "content-type": "text/plain" });
      response.end("final");
      return;
    }
    if (request.url === "/transport-response") {
      response.writeHead(200, { "content-length": "100", "content-type": "text/plain" });
      response.flushHeaders();
      response.write("partial");
      setTimeout(() => response.socket?.destroy(), 10);
      return;
    }
    if (request.url === "/redirect-secret") {
      response.writeHead(302, { location: `http://127.0.0.1:${redirectAddress.port}/target` });
      response.end();
      return;
    }
    if (request.url === "/redirect-error") {
      response.writeHead(302, { location: `http://127.0.0.1:${redirectAddress.port}/error-target` });
      response.end();
      return;
    }
    response.writeHead(200, { "content-type": "text/plain" });
    response.write("one");
    setTimeout(() => response.end("two"), 10);
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  try {
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const base = `http://127.0.0.1:${address.port}`;
    assert.equal((await http.http.get(`${base}/typed`).parse(User)).name, "Ada");
    assert.equal((await (await http.http.get(`${base}/typed`).response()).parse(User)).name, "Ada");
    await assert.rejects(http.http.get(`${base}/typed`).parse({ parse: (value: unknown) => value }), /compiler-known VelarScript runtime type/u);
    let optionReads = 0;
    const accessorOptions = Object.defineProperty({}, "body", { enumerable: true, get() { optionReads += 1; return { unsafe: true }; } });
    assert.throws(() => http.http.post(base, accessorOptions), /enumerable data values/u);
    assert.equal(optionReads, 0);
    assert.throws(() => http.http.post(base, { body: new Map([["unsafe", true]]) }), /only records and Lists are supported/u);
    const httpSecretName = `VELAR_HTTP_SECRET_${process.pid}`;
    process.env[httpSecretName] = "host-only-token";
    assert.equal(await http.http.get(`${base}/authorized`, {
      secretHeaders: [http.secretHeader("authorization", httpSecretName, "Bearer ")],
    }).text(), "authorized");
    assert.equal(observedAuthorization, "Bearer host-only-token");
    assert.equal(await http.http.get(`${base}/redirect-secret`, {
      secretHeaders: [http.secretHeader("x-provider-key", httpSecretName)],
    }).text(), "redirected");
    assert.equal(redirectedSecret, undefined);
    const finalErrorUrl = `http://127.0.0.1:${redirectAddress.port}/error-target`;
    await assert.rejects(
      http.http.get(`${base}/redirect-error`).text(),
      (error: unknown) => error instanceof http.HttpResponseError
        && (error as Error & { readonly url?: unknown }).url === finalErrorUrl
        && error.message === `HTTP 502 for ${finalErrorUrl}`
        && (error.body as { failed?: unknown }).failed === true,
    );
    await assert.rejects(http.http.get(base, {
      secretHeaders: [http.secretHeader("authorization", "VELAR_MISSING_SECRET")],
    }).text(), /is unavailable/u);
    delete process.env[httpSecretName];
    const chunks: string[] = [];
    const response = await http.http.get(base).response();
    await response.streamText(async (chunk) => { chunks.push(chunk); return null; });
    assert.equal(chunks.join(""), "onetwo");
    assert.ok(chunks.length >= 2);
    await assert.rejects(http.http.get(`${base}/lossy-json`).json(), /numbers must be finite/u);
    await assert.rejects(
      http.http.get(`${base}/lossy-error`).text(),
      (error: unknown) => error instanceof http.HttpResponseError && error.body === "1e400",
    );
    const timed = http.http.get(`${base}/slow`, { timeout: 20 });
    const timedResponse = await timed.response();
    await assert.rejects(timedResponse.streamText(async () => null), (error: unknown) => error instanceof http.HttpAbortError);
    const cancelled = http.http.get(`${base}/slow`, { timeout: 0 });
    const cancelledResponse = await cancelled.response();
    cancelled.cancel();
    await assert.rejects(cancelledResponse.streamText(async () => null), (error: unknown) => error instanceof http.HttpAbortError);
    const cancelledFromConsumer = http.http.get(`${base}/cancel-final`, { timeout: 0 });
    const finalResponse = await cancelledFromConsumer.response();
    await assert.rejects(finalResponse.streamText(async () => {
      cancelledFromConsumer.cancel();
      return null;
    }), (error: unknown) => error instanceof http.HttpAbortError);
    await assert.rejects(
      http.http.get(`${base}/transport-response`, { timeout: 0 }).text(),
      (error: unknown) => error instanceof http.HttpTransportError
        && error.phase === http.HttpTransportPhase.response
        && error.message === "HTTP response transport failed",
    );
  } finally {
    delete process.env[`VELAR_HTTP_SECRET_${process.pid}`];
    server.closeAllConnections();
    redirectTarget.closeAllConnections();
    await Promise.all([
      new Promise<void>((resolve) => server.close(() => resolve())),
      new Promise<void>((resolve) => redirectTarget.close(() => resolve())),
    ]);
  }
});

function receivesTcpToken(port: number, token: string): Promise<boolean> {
  return new Promise((resolveProbe) => {
    const socket = createConnection({ host: "127.0.0.1", port });
    let received = "";
    let settled = false;
    const finish = (result: boolean): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      resolveProbe(result);
    };
    const timer = setTimeout(() => finish(false), 1000);
    socket.setEncoding("utf8");
    socket.on("data", (chunk) => { received += chunk; });
    socket.once("end", () => finish(received === token));
    socket.once("error", () => finish(false));
  });
}
