import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, posix } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import { desktopBridgeDouble } from "../support/desktop-renderer-bridge.ts";
import { bridgeKey, runtime } from "../support/desktop-runtime-module.ts";
import { registerRuntimeType } from "../support/runtime-type-registry.ts";

/**
 * D115 §三 — one subject per file, split out of the 1,742-line
 * `desktop-runtime.test.ts`. Every test here is the one that was there, moved
 * verbatim.
 *
 * The subject is the proxy every `velar/*` module the renderer publishes is:
 * one `invoke` call over the host bridge, pulled rather than pushed, with the
 * process and HTTP streams the pull has to keep bounded. The answer table it
 * drives — every handle, chunk and poisoned accessor — is
 * `tests/support/desktop-renderer-bridge.ts`.
 */

test("Desktop renderer proxies preserve pull-based process and HTTP streaming", {
  skip: process.platform === "win32" ? "the 0.10 Desktop host publishes POSIX paths on macOS" : false,
}, async () => {
  const directory = await mkdtemp(join(tmpdir(), "velar-desktop-runtime-"));
  const { bridge, calls, pendingProcessRead, state } = desktopBridgeDouble(directory);
  Object.defineProperty(globalThis, bridgeKey, { value: bridge, configurable: true });
  try {
    const processRuntime = await runtime<{
      readonly ProcessOutputChannel: Readonly<{ readonly stdout: "stdout"; readonly stderr: "stderr" }>;
      start(command: string, args?: readonly string[], options?: Record<PropertyKey, unknown>): Promise<{
        readonly pid: number;
        next(): Promise<Readonly<{ readonly channel: "stdout" | "stderr"; readonly text: string }> | null>;
        wait(): Promise<{ readonly signal: string | null; readonly stdout: string; readonly stderr: string }>;
        stop(): Promise<null>;
      }>;
      run(command: string): Promise<{ readonly stdout: string }>;
    }>(directory, "process", "velar/process");
    assert.deepEqual(
      { stdout: processRuntime.ProcessOutputChannel.stdout, stderr: processRuntime.ProcessOutputChannel.stderr },
      { stdout: "stdout", stderr: "stderr" },
    );
    const child = await processRuntime.start("node");
    assert.equal(child.pid, 700);
    assert.equal((await child.wait()).stdout, "ready");
    assert.equal((await child.wait()).stdout, "ready");
    assert.equal((await processRuntime.run("node")).stdout, "ready");
    const processCallsBeforeValidation = calls.filter((call) => call.capability === "process" && call.operation === "start").length;
    let processOptionReads = 0;
    const processAccessorOptions = Object.defineProperty({}, "cwd", {
      enumerable: true,
      get() { processOptionReads += 1; return directory; },
    });
    await assert.rejects(processRuntime.start("node", [], processAccessorOptions), /enumerable data values/u);
    assert.equal(processOptionReads, 0);
    let processArgumentReads = 0;
    const processAccessorArguments: string[] = [];
    Object.defineProperty(processAccessorArguments, "0", {
      enumerable: true,
      configurable: true,
      get() { processArgumentReads += 1; return "--version"; },
    });
    processAccessorArguments.length = 1;
    await assert.rejects(processRuntime.start("node", processAccessorArguments), /enumerable data values/u);
    assert.equal(processArgumentReads, 0);
    await assert.rejects(processRuntime.start("node", [], { unexpected: true }), /unknown field 'unexpected'/u);
    await assert.rejects(processRuntime.start("node", ["x".repeat(600_000), "y".repeat(600_000)]), /arguments cannot exceed 1 MiB/u);
    assert.equal(calls.filter((call) => call.capability === "process" && call.operation === "start").length, processCallsBeforeValidation);
    await assert.rejects(processRuntime.start("hostile-start"), /enumerable data values/u);
    assert.equal(state.hostileProcessReads, 0);
    const hostileWait = await processRuntime.start("hostile-wait");
    await assert.rejects(hostileWait.wait(), /enumerable data values/u);
    assert.equal(state.hostileProcessReads, 0);

    const retriableStop = await processRuntime.start("retry-stop");
    await assert.rejects(retriableStop.stop(), /termination unconfirmed/u);
    await assert.rejects(retriableStop.next(), /unavailable after stop/u);
    await retriableStop.stop();
    assert.equal(state.retriableProcessStops, 2);
    assert.deepEqual(await retriableStop.wait(), { code: null, signal: "SIGTERM", stdout: "", stderr: "" });

    const failedStop = await processRuntime.start("failed-stop");
    await failedStop.stop();
    await new Promise((resolve) => setImmediate(resolve));
    await assert.rejects(failedStop.wait(), /timed out before termination/u);

    const retriableWait = await processRuntime.start("retry-wait");
    const firstRetriableWait = retriableWait.wait();
    assert.equal(retriableWait.wait(), firstRetriableWait);
    await assert.rejects(firstRetriableWait, /termination unconfirmed/u);
    assert.equal((await retriableWait.wait()).stdout, "ready");
    assert.equal(state.retriableProcessWaits, 2);

    const transportWait = await processRuntime.start("transport-wait");
    await assert.rejects(transportWait.wait(), /process wait transport failed/u);
    assert.equal((await transportWait.wait()).stdout, "ready");
    assert.equal(state.transportProcessWaits, 2);

    const invalidWait = await processRuntime.start("invalid-wait");
    await assert.rejects(invalidWait.wait(), /invalid or contradictory/u);
    assert.equal((await invalidWait.wait()).stdout, "ready");
    assert.equal(state.invalidProcessWaits, 2);

    const stopWaitOwner = await processRuntime.start("stop-wait-race");
    const losingWait = stopWaitOwner.wait();
    await stopWaitOwner.stop();
    await assert.rejects(losingWait, /unknown or already released/u);
    assert.equal((await stopWaitOwner.wait()).signal, "SIGTERM");

    await assert.rejects(processRuntime.run("retry-run"), /run cleanup unconfirmed/u);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(state.retainedRunStops, 1);

    const processStream = await processRuntime.start("stream");
    assert.deepEqual(await processStream.next(), { channel: "stdout", text: "one" });
    assert.deepEqual(await processStream.next(), { channel: "stderr", text: "two" });
    assert.equal(await processStream.next(), null);
    assert.deepEqual(await processStream.wait(), { code: 0, signal: null, stdout: "one", stderr: "two" });
    await assert.rejects(processStream.next(), /consumed before wait/u);
    assert.ok(calls.some((call) => call.capability === "process" && call.operation === "read" && call.timeout === 0));

    const processIntrinsicDescriptors = {
      arrayIsArray: Object.getOwnPropertyDescriptor(Array, "isArray")!,
      mapEntries: Object.getOwnPropertyDescriptor(Map.prototype, "entries")!,
      mapSize: Object.getOwnPropertyDescriptor(Map.prototype, "size")!,
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
    };
    let processPoisonCalls = 0;
    const poison = () => { processPoisonCalls += 1; throw new Error("poisoned process intrinsic"); };
    const capturedChunks: Array<Readonly<{ readonly channel: "stdout" | "stderr"; readonly text: string }>> = [];
    let capturedResult: { readonly stdout: string; readonly stderr: string } | null = null;
    try {
      Object.defineProperty(Array, "isArray", { ...processIntrinsicDescriptors.arrayIsArray, value: poison });
      Object.defineProperty(Map.prototype, "entries", { ...processIntrinsicDescriptors.mapEntries, value: poison });
      Object.defineProperty(Map.prototype, "size", { ...processIntrinsicDescriptors.mapSize, get: poison });
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
      const capturedProcess = await processRuntime.start("stream", [], { env: new Map([["SAFE", "value"]]) });
      while (true) {
        const chunk = await capturedProcess.next();
        if (chunk === null) break;
        capturedChunks.push(chunk);
      }
      capturedResult = await capturedProcess.wait();
    } finally {
      Object.defineProperty(Array, "isArray", processIntrinsicDescriptors.arrayIsArray);
      Object.defineProperty(Map.prototype, "entries", processIntrinsicDescriptors.mapEntries);
      Object.defineProperty(Map.prototype, "size", processIntrinsicDescriptors.mapSize);
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
    }
    assert.equal(processPoisonCalls, 0);
    assert.deepEqual(capturedChunks, [{ channel: "stdout", text: "one" }, { channel: "stderr", text: "two" }]);
    assert.deepEqual(capturedResult, { code: 0, signal: null, stdout: "one", stderr: "two" });

    // The renderer refuses the same environment names the capability host does,
    // so a granted executable cannot be handed a command through its own
    // environment, and cannot be pointed at a configuration directory that
    // carries one. Both validators must agree; see the matching worker case.
    for (const reserved of ["GIT_SSH_COMMAND", "NODE_OPTIONS", "LD_PRELOAD", "DYLD_INSERT_LIBRARIES", "BASH_ENV", "IFS", "PERL5OPT", "RUBYOPT", "PAGER_OPTS", "VISUAL_EDITOR", "python_startup", "EDITOR", "VISUAL", "PAGER", "MANPAGER", "BROWSER", "LESSOPEN", "SSH_ASKPASS", "XDG_CONFIG_HOME", "HOME", "SHELL", "TMPDIR", "editor"]) {
      await assert.rejects(
        processRuntime.start("stream", [], { env: new Map([[reserved, "x"]]) }),
        new RegExp(`transport- or interpreter-controlled variable '${reserved}'`, "u"),
      );
    }
    await assert.rejects(processRuntime.start("stream", [], { env: new Map([["PATH", "x"]]) }), /cannot replace PATH/u);

    const hostileRead = await processRuntime.start("hostile-read");
    await assert.rejects(hostileRead.next(), /enumerable data values/u);
    assert.equal(state.hostileProcessReads, 0);

    const pendingRead = await processRuntime.start("pending-read");
    const firstRead = pendingRead.next();
    await assert.rejects(pendingRead.next(), /only one active pull/u);
    await assert.rejects(pendingRead.wait(), /while next\(\) is pending/u);
    assert.ok(pendingProcessRead.resolve);
    pendingProcessRead.resolve({ channel: "stdout", text: "ready" });
    assert.deepEqual(await firstRead, { channel: "stdout", text: "ready" });
    assert.equal(await pendingRead.next(), null);
    await pendingRead.wait();

    const fsRuntime = await runtime<{
      readText(path: string, maxBytes?: number): Promise<string>;
      createText(path: string, text: string): Promise<null>;
      replaceTextIfMatches(path: string, expected: string, replacement: string): Promise<boolean>;
      writeText(path: string, text: string): Promise<null>;
      exists(path: string): Promise<boolean>;
      list(path: string, maxItems?: number): Promise<string[]>;
      info(path: string): Promise<{ readonly name: string; readonly kind: string } | null>;
      canonical(path: string): Promise<string>;
      watchFiles(path: string, recursive?: boolean): Promise<{
        next(): Promise<{ readonly paths: readonly string[]; readonly rescan: boolean } | null>;
        close(): Promise<null>;
      }>;
    }>(directory, "fs", "velar/fs");
    assert.equal(await fsRuntime.readText("note.txt", 16), "value");
    assert.equal(await fsRuntime.createText("created.txt", "value"), null);
    assert.equal(await fsRuntime.replaceTextIfMatches("note.txt", "value", "next"), true);
    await assert.rejects(fsRuntime.replaceTextIfMatches("invalid-replace", "value", "next"), /invalid replaceTextIfMatches result/u);
    await assert.rejects(fsRuntime.readText("oversized.txt", 4), /exceeds maxBytes/u);
    const fsCallsBeforeValidation = calls.filter((call) => call.capability === "fs").length;
    await assert.rejects(fsRuntime.readText("", 16), /non-empty path/u);
    await assert.rejects(fsRuntime.readText("note.txt", 0), /maxBytes/u);
    assert.equal(calls.filter((call) => call.capability === "fs").length, fsCallsBeforeValidation);
    assert.deepEqual(await fsRuntime.list(".", 2), ["alpha", "zeta"]);
    await assert.rejects(fsRuntime.list("hostile-list"), /invalid directory list/u);
    assert.equal(state.hostileFilesystemReads, 0);
    assert.deepEqual(await fsRuntime.info("note.txt"), { name: "note.txt", kind: "file", size: 5, modifiedAt: 0 });
    await assert.rejects(fsRuntime.info("hostile-info"), /enumerable data values/u);
    assert.equal(state.hostileFilesystemReads, 0);
    assert.equal(await fsRuntime.canonical("note.txt"), "/project/note.txt");
    assert.equal(await fsRuntime.exists("note.txt"), true);
    await assert.rejects(fsRuntime.exists("invalid-exists"), /invalid file existence/u);
    // D57 rule 137: `Blob` and `readBlob` were retired, and the Desktop fs
    // runtime is reachable through `import js` — so the names have to be gone
    // from the emitted module, not merely absent from the published interface.
    assert.equal(Object.hasOwn(fsRuntime, "Blob"), false);
    assert.equal(Object.hasOwn(fsRuntime, "readBlob"), false);
    await assert.rejects(fsRuntime.writeText("bad-result", "value"), /invalid writeText result/u);
    const watcher = await fsRuntime.watchFiles(".", true);
    const fileWatchBatch = await watcher.next();
    assert.deepEqual(fileWatchBatch, { paths: ["/project/note.txt"], rescan: false });
    assert.equal(Object.isFrozen(fileWatchBatch?.paths), false);
    assert.equal(calls.at(-1)?.timeout, 0);
    assert.equal(await watcher.close(), null);
    assert.equal(await watcher.next(), null);
    const malformedWatcher = await fsRuntime.watchFiles("malformed-watch", true);
    await assert.rejects(malformedWatcher.next(), /invalid file watch paths/u);
    assert.equal(state.malformedWatcherCloses, 1);
    assert.equal(await malformedWatcher.next(), null);

    const pathRuntime = await runtime<{
      basename(path: string): string;
      contains(root: string, target: string): boolean;
      dirname(path: string): string;
      extension(path: string): string;
      fromFileUrl(url: string): string;
      isAbsolute(path: string): boolean;
      join(parts?: readonly string[]): string;
      normalize(path: string): string;
      relative(from: string, to: string): string;
      resolve(parts?: readonly string[]): string;
      toFileUrl(path: string): string;
    }>(directory, "path", "velar/path");
    assert.equal(pathRuntime.resolve(["src", "main.vel"]), `${directory}/src/main.vel`);
    const encodedPath = `${directory}/space and 雪#100%.vel`;
    const encodedUrl = pathRuntime.toFileUrl(encodedPath);
    assert.equal(encodedUrl, pathToFileURL(encodedPath).href);
    assert.equal(pathRuntime.fromFileUrl(encodedUrl), encodedPath);
    assert.equal(pathRuntime.fromFileUrl(`file://localhost${pathToFileURL(encodedPath).pathname}`), encodedPath);
    assert.throws(() => pathRuntime.fromFileUrl("https://example.test/main.vel"), /requires a local file URL/u);
    assert.throws(() => pathRuntime.fromFileUrl("file:///project%2Fescape.vel"), /requires a local file URL/u);
    assert.equal(pathRuntime.join(["src", "main.vel"]), "src/main.vel");
    assert.equal(pathRuntime.contains(directory, `${directory}/src/main.vel`), true);
    assert.equal(pathRuntime.contains(`${directory}/src`, directory), false);
    assert.throws(() => pathRuntime.join(["x".repeat(4096), "tail"]), /result is outside/u);
    assert.throws(() => pathRuntime.resolve(["x".repeat(4096)]), /result is outside/u);
    let pathPartReads = 0;
    const pathParts: string[] = [];
    Object.defineProperty(pathParts, "0", {
      enumerable: true,
      configurable: true,
      get() { pathPartReads += 1; return "src"; },
    });
    pathParts.length = 1;
    assert.throws(() => pathRuntime.join(pathParts), /enumerable data values/u);
    assert.equal(pathPartReads, 0);
    const sparsePathParts: string[] = [];
    sparsePathParts.length = 1;
    assert.throws(() => pathRuntime.join(sparsePathParts), /enumerable data values/u);

    const pathSamples = [
      ".", "..", "...", ".profile", "..profile", "foo", "foo/", "foo/.", "foo/..", "foo/../bar",
      "foo/./bar", "foo/bar/../", "a//b///c", "../a/..", "/", "//", "///foo", "//foo/bar",
      "/foo/.", "/foo/..", "foo.", "foo..bar", "foo/.hidden", "foo/a..b",
    ];
    const pathCorpus = new Set(pathSamples);
    const pathAtoms = ["a", "b", ".", "..", ".hidden", "a.b", "...", "x-"];
    for (const left of pathAtoms) {
      pathCorpus.add(left);
      pathCorpus.add(`/${left}`);
      pathCorpus.add(`//${left}`);
      pathCorpus.add(`${left}/`);
      for (const right of pathAtoms) {
        for (const separator of ["/", "//", "///"]) {
          pathCorpus.add(`${left}${separator}${right}`);
          pathCorpus.add(`/${left}${separator}${right}`);
          pathCorpus.add(`${left}${separator}${right}/`);
        }
      }
    }
    for (const value of pathCorpus) {
      assert.equal(pathRuntime.normalize(value), posix.normalize(value), `normalize(${JSON.stringify(value)})`);
      assert.equal(pathRuntime.dirname(value), posix.dirname(value), `dirname(${JSON.stringify(value)})`);
      assert.equal(pathRuntime.basename(value), posix.basename(value), `basename(${JSON.stringify(value)})`);
      assert.equal(pathRuntime.extension(value), posix.extname(value), `extension(${JSON.stringify(value)})`);
      assert.equal(pathRuntime.isAbsolute(value), posix.isAbsolute(value), `isAbsolute(${JSON.stringify(value)})`);
    }
    const partSamples = [
      [] as string[],
      ["src", "main.vel"],
      ["src", "..", "main.vel"],
      ["/tmp", "nested", "..", "note.txt"],
      ["alpha", "/absolute", "tail"],
    ];
    for (const values of partSamples) {
      assert.equal(pathRuntime.join(values), posix.join(...values), `join(${JSON.stringify(values)})`);
      assert.equal(pathRuntime.resolve(values), posix.resolve(directory, ...values), `resolve(${JSON.stringify(values)})`);
    }
    const relativeSamples = [
      [".", "."], [".", "src/main.vel"], ["src", "src/main.vel"], ["src/main.vel", "src"],
      ["foo/..", "bar"], ["/tmp/one", "/tmp/two"], ["../one", "../two"],
    ] as const;
    for (const [from, to] of relativeSamples) {
      assert.equal(
        pathRuntime.relative(from, to),
        posix.relative(posix.resolve(directory, from), posix.resolve(directory, to)),
        `relative(${JSON.stringify(from)}, ${JSON.stringify(to)})`,
      );
    }
    for (const from of pathCorpus) {
      for (const to of pathCorpus) {
        assert.equal(
          pathRuntime.relative(from, to),
          posix.relative(posix.resolve(directory, from), posix.resolve(directory, to)),
          `relative(${JSON.stringify(from)}, ${JSON.stringify(to)})`,
        );
      }
    }
    const defineProperty = Object.defineProperty;
    const stringIndexOf = Object.getOwnPropertyDescriptor(String.prototype, "indexOf")!;
    const stringSlice = Object.getOwnPropertyDescriptor(String.prototype, "slice")!;
    const stringToLowerCase = Object.getOwnPropertyDescriptor(String.prototype, "toLowerCase")!;
    const urlPathname = Object.getOwnPropertyDescriptor(URL.prototype, "pathname")!;
    const urlProtocol = Object.getOwnPropertyDescriptor(URL.prototype, "protocol")!;
    const arrayJoin = Object.getOwnPropertyDescriptor(Array.prototype, "join")!;
    const arrayIsArray = Object.getOwnPropertyDescriptor(Array, "isArray")!;
    const getOwnPropertyDescriptor = Object.getOwnPropertyDescriptor(Object, "getOwnPropertyDescriptor")!;
    let capturedJoin = "";
    let capturedExtension = "";
    let capturedContains = false;
    try {
      defineProperty(String.prototype, "indexOf", { ...stringIndexOf, value: () => { throw new Error("poisoned indexOf"); } });
      defineProperty(String.prototype, "slice", { ...stringSlice, value: () => { throw new Error("poisoned slice"); } });
      defineProperty(String.prototype, "toLowerCase", { ...stringToLowerCase, value: () => { throw new Error("poisoned toLowerCase"); } });
      defineProperty(URL.prototype, "pathname", { ...urlPathname, get: () => { throw new Error("poisoned URL pathname"); } });
      defineProperty(URL.prototype, "protocol", { ...urlProtocol, get: () => { throw new Error("poisoned URL protocol"); } });
      defineProperty(Array.prototype, "join", { ...arrayJoin, value: () => { throw new Error("poisoned join"); } });
      defineProperty(Array, "isArray", { ...arrayIsArray, value: () => { throw new Error("poisoned isArray"); } });
      defineProperty(Object, "getOwnPropertyDescriptor", { ...getOwnPropertyDescriptor, value: () => { throw new Error("poisoned descriptor"); } });
      capturedJoin = pathRuntime.join(["alpha", "..", "stable.txt"]);
      capturedExtension = pathRuntime.extension("archive.tar.gz");
      capturedContains = pathRuntime.contains(directory, `${directory}/stable.txt`);
      assert.equal(pathRuntime.fromFileUrl(pathRuntime.toFileUrl(`${directory}/stable.txt`)), `${directory}/stable.txt`);
    } finally {
      defineProperty(String.prototype, "indexOf", stringIndexOf);
      defineProperty(String.prototype, "slice", stringSlice);
      defineProperty(String.prototype, "toLowerCase", stringToLowerCase);
      defineProperty(URL.prototype, "pathname", urlPathname);
      defineProperty(URL.prototype, "protocol", urlProtocol);
      defineProperty(Array.prototype, "join", arrayJoin);
      defineProperty(Array, "isArray", arrayIsArray);
      defineProperty(Object, "getOwnPropertyDescriptor", getOwnPropertyDescriptor);
    }
    assert.equal(capturedJoin, "stable.txt");
    assert.equal(capturedExtension, ".gz");
    assert.equal(capturedContains, true);

    const desktopRuntime = await runtime<{
      appDataDirectory(): Promise<string>;
      homeDirectory(): Promise<string>;
      packaged(): boolean;
      platform(): string;
      DesktopPlatform: Readonly<{
        macos: "macos"; test: "test";
        is(value: unknown): boolean; parse(value: unknown): unknown; values(): string[];
      }>;
      projectDirectory(): Promise<string>;
      selectedProjectDirectory(): Promise<string | null>;
      selectProjectDirectory(): Promise<string | null>;
    }>(directory, "desktop", "velar/desktop");
    assert.equal(desktopRuntime.platform(), "test");
    assert.equal(desktopRuntime.DesktopPlatform.macos, "macos");
    assert.equal(desktopRuntime.DesktopPlatform.test, "test");
    assert.deepEqual(desktopRuntime.DesktopPlatform.values(), ["macos", "test"]);
    assert.equal(desktopRuntime.packaged(), false);
    assert.equal(await desktopRuntime.homeDirectory(), "/home/test");
    assert.equal(await desktopRuntime.appDataDirectory(), "/app-data/test");
    assert.equal(await desktopRuntime.projectDirectory(), directory);
    assert.equal(await desktopRuntime.selectedProjectDirectory(), null);
    assert.equal(await desktopRuntime.selectProjectDirectory(), join(directory, "selected"));
    assert.equal(calls.find((call) => call.capability === "desktop" && call.operation === "selectProjectDirectory")?.timeout, 0);
    assert.equal(await desktopRuntime.selectedProjectDirectory(), join(directory, "selected"));
    assert.equal(await desktopRuntime.projectDirectory(), join(directory, "selected"));
    assert.equal(pathRuntime.resolve(["dynamic.vel"]), join(directory, "selected", "dynamic.vel"));
    const environment = await runtime<{ get(name: string): string | null; require(name: string): string }>(directory, "env", "velar/env");
    assert.equal(environment.get("LANG"), "en_US.UTF-8");
    assert.equal(environment.get("SECRET"), null);
    assert.throws(() => environment.require("SECRET"), /is required/u);

    const httpRuntime = await runtime<{
      secretHeader(name: string, environment: string, prefix?: string): Readonly<{ name: string; environment: string; prefix: string }>;
      http: {
        request(method: string, url: string, options?: Record<string, unknown>): { text(): Promise<string> };
        get(url: string, options?: Record<string, unknown>): {
          streamText(consumer: (chunk: string) => Promise<null>): Promise<null>;
          json(): Promise<unknown>;
          text(): Promise<string>;
          parse<T>(target: { parse(value: unknown): T }): Promise<T>;
          response(): Promise<{ json(): Promise<unknown>; parse<T>(target: { parse(value: unknown): T }): Promise<T>; text(): Promise<string> }>;
          cancel(): null;
        };
        post(url: string, options?: Record<string, unknown>): { text(): Promise<string> };
      };
      HttpAbortError: new (reason: string) => Error & { readonly reason: string };
      HttpResponseError: new (...args: unknown[]) => Error & { readonly body: unknown; readonly url: string };
      HttpTransportError: new (...args: unknown[]) => Error & { readonly phase: "request" | "response" };
      HttpTransportPhase: Readonly<{ readonly request: "request"; readonly response: "response" }>;
    }>(directory, "http", "velar/http", (source) => source.replace("const maxResponseChunks = 1000000;", "const maxResponseChunks = 3;"));
    // D90 fr-6: a registered Type must still present the Type surface, so this
    // fixture answers `is` the way every Type the compiler emits does rather
    // than relying on registry membership alone.
    const User = registerRuntimeType(Object.freeze({
      is(value: unknown): boolean {
        return !!value && typeof value === "object" && (value as { name?: unknown }).name === "Ada";
      },
      parse(value: unknown): { name: string } {
        if (!value || typeof value !== "object" || (value as { name?: unknown }).name !== "Ada") throw new TypeError("invalid User");
        return value as { name: string };
      },
    }));
    const requestsBeforeValidation = calls.filter((call) => call.capability === "http" && call.operation === "request").length;
    assert.throws(() => httpRuntime.http.request("TRACE", "https://example.test/"), /invalid or forbidden/u);
    assert.throws(() => httpRuntime.http.get("file:///tmp/value"), /must use http or https/u);
    assert.throws(() => httpRuntime.http.get("https://user:secret@example.test/"), /credentials are not allowed/u);
    assert.throws(() => new httpRuntime.HttpResponseError("x".repeat(65537), 400, "https://example.test/"), RangeError);
    assert.throws(() => new httpRuntime.HttpResponseError("message", 400, "x".repeat(2 * 1024 * 1024 + 1)), RangeError);
    const oversizedHttpBody = "é".repeat(8 * 1024 * 1024 + 1);
    const fullHttpHeaders = new Map<string, string>();
    for (let index = 0; index < 100; index += 1) fullHttpHeaders.set(`x-header-${index}`, "value");
    assert.throws(() => httpRuntime.http.post("https://example.test/", { body: oversizedHttpBody }), /cannot exceed 16 MiB/u);
    assert.throws(() => httpRuntime.http.post("https://example.test/", { body: { value: oversizedHttpBody } }), /cannot exceed 16 MiB/u);
    assert.throws(() => httpRuntime.http.post("https://example.test/", { headers: fullHttpHeaders, body: { value: 1 } }), /cannot exceed 100 fields/u);
    assert.equal(calls.filter((call) => call.capability === "http" && call.operation === "request").length, requestsBeforeValidation);
    await assert.rejects(
      httpRuntime.http.get("https://example.test/transport-request").text(),
      (error: unknown) => error instanceof httpRuntime.HttpTransportError
        && error.phase === httpRuntime.HttpTransportPhase.request,
    );
    await assert.rejects(
      httpRuntime.http.get("https://example.test/transport-response").text(),
      (error: unknown) => error instanceof httpRuntime.HttpTransportError
        && error.phase === httpRuntime.HttpTransportPhase.response,
    );
    assert.equal((await httpRuntime.http.get("https://example.test/typed").parse(User)).name, "Ada");
    assert.equal((await (await httpRuntime.http.get("https://example.test/typed").response()).parse(User)).name, "Ada");
    const concurrentResponse = await httpRuntime.http.get("https://example.test/typed").response();
    const [concurrentText, concurrentJson] = await Promise.all([concurrentResponse.text(), concurrentResponse.json()]);
    assert.equal(concurrentText, '{"name":"Ada"}');
    assert.equal((concurrentJson as { name: string }).name, "Ada");
    assert.equal(await concurrentResponse.text(), concurrentText);
    const requestsBeforeInvalidType = calls.filter((call) => call.capability === "http" && call.operation === "request").length;
    await assert.rejects(httpRuntime.http.get("https://example.test/typed").parse({ parse: (value: unknown) => value }), /compiler-known VelarScript runtime type/u);
    assert.equal(calls.filter((call) => call.capability === "http" && call.operation === "request").length, requestsBeforeInvalidType);
    const streamed: string[] = [];
    await httpRuntime.http.get("https://example.test/stream").streamText(async (chunk) => { streamed.push(chunk); return null; });
    assert.deepEqual(streamed, ["first ", "chunk"]);
    assert.ok(calls.some((call) => call.capability === "http" && call.operation === "read" && call.timeout === 0));
    await httpRuntime.http.get("https://example.test/authorized", {
      secretHeaders: [httpRuntime.secretHeader("authorization", "OPENAI_API_KEY", "Bearer ")],
    }).text();
    const authorized = calls.find((call) => call.capability === "http" && call.operation === "request" && call.args[2] === "https://example.test/authorized");
    assert.deepEqual((authorized?.args[3] as { secretHeaders?: unknown }).secretHeaders, [
      { name: "authorization", environment: "OPENAI_API_KEY", prefix: "Bearer " },
    ]);
    let optionReads = 0;
    const accessorOptions = Object.defineProperty({}, "body", { enumerable: true, get() { optionReads += 1; return { unsafe: true }; } });
    assert.throws(() => httpRuntime.http.post("https://example.test/accessor", accessorOptions), /enumerable data values/u);
    assert.equal(optionReads, 0);
    assert.throws(() => httpRuntime.http.post("https://example.test/map", { body: new Map([["unsafe", true]]) }), /only records and Lists are supported/u);
    await httpRuntime.http.post("https://example.test/json-body", { body: { ready: true } }).text();
    const jsonBody = calls.find((call) => call.capability === "http" && call.operation === "request" && call.args[2] === "https://example.test/json-body");
    assert.deepEqual((jsonBody?.args[3] as { body?: unknown; headers?: unknown }).body, '{"ready":true}');
    assert.deepEqual((jsonBody?.args[3] as { body?: unknown; headers?: unknown }).headers, [["content-type", "application/json"]]);
    await assert.rejects(httpRuntime.http.get("https://example.test/lossy-json").json(), /numbers must be finite/u);
    await assert.rejects(
      httpRuntime.http.get("https://example.test/lossy-error").text(),
      (error: unknown) => error instanceof httpRuntime.HttpResponseError && error.body === "1e400",
    );
    await assert.rejects(
      httpRuntime.http.get("https://example.test/redirect-error").text(),
      (error: unknown) => error instanceof httpRuntime.HttpResponseError
        && error.url === "https://final.example.test/failure"
        && error.message === "HTTP 502 for https://final.example.test/failure"
        && (error.body as { failed?: unknown }).failed === true,
    );
    await assert.rejects(httpRuntime.http.get("https://example.test/hostile-response").response(), /enumerable data values/u);
    assert.equal(state.hostileResponseReads, 0);
    await assert.rejects(httpRuntime.http.get("https://example.test/invalid-response").response(), /body marker must be boolean/u);
    const invalidCall = calls.find((call) => call.capability === "http" && call.operation === "request" && call.args[2] === "https://example.test/invalid-response");
    assert.ok(invalidCall);
    assert.ok(calls.some((call) => call.capability === "http" && call.operation === "cancel" && call.args[0] === invalidCall.args[0]));
    await assert.rejects(httpRuntime.http.get("https://example.test/status-zero").response(), /invalid HTTP response metadata/u);
    await assert.rejects(httpRuntime.http.get("https://example.test/inconsistent-status").response(), /invalid HTTP response metadata/u);

    const emptyRequest = httpRuntime.http.get("https://example.test/empty", { timeout: 10 });
    const emptyResponse = await emptyRequest.response();
    assert.equal(await emptyResponse.text(), "");
    const emptyCall = calls.find((call) => call.capability === "http" && call.operation === "request" && call.args[2] === "https://example.test/empty");
    assert.ok(emptyCall);
    assert.equal(calls.some((call) => call.capability === "http" && call.operation === "read" && call.args[0] === emptyCall.args[0]), false);

    await assert.rejects(httpRuntime.http.get("https://example.test/too-many-chunks").text(), /cannot exceed 1000000 chunks/u);
    await assert.rejects(httpRuntime.http.get("https://example.test/invalid-chunk").text(), /invalid HTTP chunk/u);

    const pending = httpRuntime.http.get("https://example.test/pending", { timeout: 0 });
    const text = pending.text();
    pending.cancel();
    await assert.rejects(text, (error: unknown) => error instanceof httpRuntime.HttpAbortError && error.reason === "cancelled");
    assert.ok(calls.some((call) => call.capability === "http" && call.operation === "cancel"));
    const cancelledFromConsumer = httpRuntime.http.get("https://example.test/cancel-final", { timeout: 0 });
    await assert.rejects(cancelledFromConsumer.streamText(async () => {
      cancelledFromConsumer.cancel();
      return null;
    }), (error: unknown) => error instanceof httpRuntime.HttpAbortError && error.reason === "cancelled");

    let poisonedBridgeReads = 0;
    let poisonedBridgeCalls = 0;
    const poisonedBridge = Object.defineProperty({}, "invoke", {
      enumerable: true,
      get() {
        poisonedBridgeReads += 1;
        return () => {
          poisonedBridgeCalls += 1;
          throw new Error("poisoned Desktop bridge invoked");
        };
      },
    });
    Object.defineProperty(globalThis, bridgeKey, { value: poisonedBridge, configurable: true });
    assert.equal(desktopRuntime.platform(), "test");
    assert.equal(await desktopRuntime.projectDirectory(), join(directory, "selected"));
    assert.equal(pathRuntime.resolve(["captured"]), join(directory, "selected", "captured"));
    assert.equal(environment.get("LANG"), "en_US.UTF-8");
    assert.equal(await fsRuntime.readText("captured.txt", 16), "value");
    assert.equal((await processRuntime.run("node")).stdout, "ready");
    assert.equal(await httpRuntime.http.get("https://example.test/captured").text(), "first chunk");
    assert.equal(poisonedBridgeReads, 0);
    assert.equal(poisonedBridgeCalls, 0);
    Object.defineProperty(globalThis, bridgeKey, { value: bridge, configurable: true });

    let projectDirectoryReads = 0;
    const hostilePathBridge = {
      platform: "test",
      packaged: false,
      environment: Object.freeze({}),
      invoke: bridge.invoke,
    };
    Object.defineProperty(hostilePathBridge, "projectDirectoryValue", {
      enumerable: true,
      get() { projectDirectoryReads += 1; return () => directory; },
    });
    Object.defineProperty(globalThis, bridgeKey, { value: hostilePathBridge, configurable: true });
    // D60 rule 153 moved the failure from the import to the call, so the module
    // loads and `resolve` is what refuses -- the same shape `velar/env` below
    // has always had. What the accessor bridge is here to prove is unchanged:
    // the field is read through its descriptor, so a getter planted on the
    // bridge never runs.
    const hostilePathRuntime = await runtime<{ resolve(values: readonly string[]): string }>(directory, "path-hostile", "velar/path");
    assert.throws(() => hostilePathRuntime.resolve(["captured"]), /data value/u);
    assert.equal(projectDirectoryReads, 0);

    let environmentReads = 0;
    const hostileEnvironment = Object.defineProperty({}, "LANG", {
      enumerable: true,
      get() { environmentReads += 1; return "unsafe"; },
    });
    const hostileEnvironmentBridge = {
      platform: "test",
      packaged: false,
      projectDirectory: directory,
      environment: hostileEnvironment,
      invoke: bridge.invoke,
    };
    Object.defineProperty(globalThis, bridgeKey, { value: hostileEnvironmentBridge, configurable: true });
    const hostileEnvironmentRuntime = await runtime<{ get(name: string): string | null }>(directory, "env-hostile", "velar/env");
    assert.throws(() => hostileEnvironmentRuntime.get("LANG"), /enumerable data values/u);
    assert.equal(environmentReads, 0);

    const tooManyEnvironment = Object.fromEntries(Array.from({ length: 65 }, (_value, index) => [`VALUE_${index}`, "x"]));
    Object.defineProperty(globalThis, bridgeKey, {
      value: {
        platform: "test",
        packaged: false,
        projectDirectory: directory,
        environment: tooManyEnvironment,
        invoke: bridge.invoke,
      },
      configurable: true,
    });
    const tooManyEnvironmentRuntime = await runtime<{ get(name: string): string | null }>(directory, "env-too-many", "velar/env");
    assert.throws(() => tooManyEnvironmentRuntime.get("VALUE_0"), /cannot exceed 64 variables/u);

    Object.defineProperty(globalThis, bridgeKey, {
      value: {
        platform: "test",
        packaged: false,
        projectDirectory: directory,
        environment: { TOO_LARGE: "x".repeat(64 * 1024 + 1) },
        invoke: bridge.invoke,
      },
      configurable: true,
    });
    const oversizedEnvironmentRuntime = await runtime<{ get(name: string): string | null }>(directory, "env-oversized", "velar/env");
    assert.throws(() => oversizedEnvironmentRuntime.get("TOO_LARGE"), /exceeds its size boundary/u);

    const aggregateEnvironment = Object.fromEntries(Array.from({ length: 17 }, (_value, index) => [`VALUE_${index}`, "x".repeat(64 * 1024)]));
    Object.defineProperty(globalThis, bridgeKey, {
      value: {
        platform: "test",
        packaged: false,
        projectDirectory: directory,
        environment: aggregateEnvironment,
        invoke: bridge.invoke,
      },
      configurable: true,
    });
    const aggregateEnvironmentRuntime = await runtime<{ get(name: string): string | null }>(directory, "env-aggregate", "velar/env");
    assert.throws(() => aggregateEnvironmentRuntime.get("VALUE_0"), /exceeds its size boundary/u);

    let platformReads = 0;
    const hostileDesktopBridge = {
      packaged: false,
      projectDirectory: directory,
      environment: Object.freeze({}),
      invoke: bridge.invoke,
    };
    Object.defineProperty(hostileDesktopBridge, "platform", {
      enumerable: true,
      get() { platformReads += 1; return "unsafe"; },
    });
    Object.defineProperty(globalThis, bridgeKey, { value: hostileDesktopBridge, configurable: true });
    // Same migration as `velar/path` above (D60 rule 153): the module loads and
    // `platform()` refuses. The accessor still never runs.
    const hostileDesktopRuntime = await runtime<{ platform(): string }>(directory, "desktop-accessor", "velar/desktop");
    assert.throws(() => hostileDesktopRuntime.platform(), /data value/u);
    assert.equal(platformReads, 0);

    Object.defineProperty(globalThis, bridgeKey, {
      value: { ...bridge, platform: "windows" },
      configurable: true,
    });
    const unknownPlatformRuntime = await runtime<{ platform(): string }>(directory, "desktop-unknown-platform", "velar/desktop");
    assert.throws(() => unknownPlatformRuntime.platform(), /does not match DesktopPlatform/u);

    const invalidDesktopBridge = {
      platform: "test",
      packaged: false,
      projectDirectory: directory,
      environment: Object.freeze({}),
      async invoke(capability: string): Promise<unknown> { return capability === "desktop" ? "relative/path" : null; },
    };
    Object.defineProperty(globalThis, bridgeKey, { value: invalidDesktopBridge, configurable: true });
    const invalidDesktopRuntime = await runtime<{ projectDirectory(): Promise<string> }>(directory, "desktop-hostile", "velar/desktop");
    await assert.rejects(invalidDesktopRuntime.projectDirectory(), /invalid absolute path/u);
    const invalidOptionalDesktopRuntime = invalidDesktopRuntime as unknown as { selectProjectDirectory(): Promise<string | null> };
    await assert.rejects(invalidOptionalDesktopRuntime.selectProjectDirectory(), /invalid optional project path/u);

    let invokeReads = 0;
    const accessorInvokeBridge = {
      platform: "test",
      packaged: false,
      projectDirectory: directory,
      environment: Object.freeze({}),
    };
    Object.defineProperty(accessorInvokeBridge, "invoke", {
      enumerable: true,
      get() {
        invokeReads += 1;
        return bridge.invoke;
      },
    });
    Object.defineProperty(globalThis, bridgeKey, { value: accessorInvokeBridge, configurable: true });
    // The bridge's own `invoke` is captured through its descriptor while the
    // module initializes, so an accessor is never invoked; D60 rule 153 only
    // moved the refusal to the first capability call.
    const accessorInvokeRuntime = await runtime<{ exists(path: string): Promise<boolean> }>(directory, "fs-invoke-accessor", "velar/fs");
    await assert.rejects(accessorInvokeRuntime.exists("captured.txt"), /function data value/u);
    assert.equal(invokeReads, 0);
  } finally {
    delete (globalThis as { [key: symbol]: unknown })[bridgeKey];
    await rm(directory, { recursive: true, force: true });
  }
});
