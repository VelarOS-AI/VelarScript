import assert from "node:assert/strict";
import test, { after } from "node:test";
import { mkdir, realpath, symlink, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { npmAsset } from "../../packages/cli/src/npm.ts";
import { makeTemporaryDirectory, removeTemporaryDirectories } from "../support/temporary-directory.ts";
import { executeModule } from "../support/execute-module.ts";
import { standaloneRealtimeSource, standardModuleSource } from "../support/compiler-suite.ts";

after(removeTemporaryDirectories);

test("file helpers reject forged files and hostile options before native effects", () => {
  const source = standardModuleSource("velar/files") ?? "";
  const execution = executeModule(`
let getterReads = 0;
let nativeCalls = 0;
globalThis.document = {
  createElement() { nativeCalls += 1; return {}; },
  body: { append() { nativeCalls += 1; } },
};
globalThis.Blob = class { constructor() { nativeCalls += 1; } };
globalThis.FileReader = class { constructor() { nativeCalls += 1; } };
globalThis.URL = { createObjectURL() { nativeCalls += 1; return "blob:test"; } };
${source}
const pickerAccessor = Object.defineProperty({}, "accept", { enumerable: true, get() { getterReads += 1; return "text/plain"; } });
const forged = Object.freeze({ name: "fake.txt", size: 1, type: "text/plain", modified: 0 });
const operations = [
  () => pick(pickerAccessor),
  () => pick({ unknown: true }),
  () => pick({ accept: 42 }),
  () => pick({ multiple: "yes" }),
  () => download(42, "data"),
  () => download("file.txt", 42),
  () => download("file.txt", "data", 42),
  () => readText(forged),
  () => readDataUrl(forged),
];
const failures = [];
for (const operation of operations) {
  try { operation(); failures.push("accepted"); }
  catch (error) { failures.push(error.name); }
}
console.log(failures.join(","));
console.log(getterReads + ":" + nativeCalls);
`);
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, `${new Array(9).fill("TypeError").join(",")}\n0:0\n`);

  const accessorRegistry = executeModule(`
Object.defineProperty(globalThis, Symbol.for("velar.file.registry.v1"), {
  get() { console.log("accessor invoked"); return new WeakMap(); },
});
${source}
`);
  assert.notEqual(accessorRegistry.status, 0);
  assert.equal(accessorRegistry.stdout, "");
  assert.match(String(accessorRegistry.stderr), /VelarScript file registry cannot be an accessor/u);
});

test("file reads enforce explicit byte budgets before allocating browser readers", () => {
  const source = standardModuleSource("velar/files") ?? "";
  const execution = executeModule(`
let textReads = 0;
let readerCalls = 0;
let blobCalls = 0;
const listeners = new Map();
const fileState = new WeakMap();
const fileListState = new WeakMap();
class FakeBlob {
  constructor(parts = null) { if (parts !== null) blobCalls += 1; }
  get size() { return fileState.get(this).size; }
  get type() { return fileState.get(this).type; }
  text() { textReads += 1; return Promise.resolve(fileState.get(this).text); }
}
class FakeFile extends FakeBlob {
  constructor(fields) { super(); fileState.set(this, fields); }
  get name() { return fileState.get(this).name; }
  get lastModified() { return fileState.get(this).lastModified; }
}
class FakeFileList {
  constructor(files) { fileListState.set(this, files); }
  get length() { return fileListState.get(this).length; }
  item(index) { return fileListState.get(this)[index] ?? null; }
}
globalThis.Blob = FakeBlob;
globalThis.File = FakeFile;
globalThis.FileList = FakeFileList;
const selected = new FakeFile({ name: "large.txt", size: 16 * 1024 * 1024 + 1, type: "text/plain", lastModified: 0, text: "data" });
const input = {
  files: new FakeFileList([selected]),
  addEventListener(name, listener) { listeners.set(name, listener); },
  remove() {},
  click() { listeners.get("change")(); },
};
globalThis.document = { createElement() { return input; }, body: { append() {} } };
globalThis.addEventListener = () => {};
globalThis.removeEventListener = () => {};
globalThis.FileReader = class { constructor() { readerCalls += 1; } };
globalThis.URL = { createObjectURL() { return "blob:test"; } };
const hostileFileRegistry = new WeakMap();
hostileFileRegistry.get = () => { throw new Error("instance get must not run"); };
hostileFileRegistry.set = () => { throw new Error("instance set must not run"); };
Object.defineProperty(globalThis, Symbol.for("velar.file.registry.v1"), { value: hostileFileRegistry });
${source}
const [file] = await pick();
const failures = [];
for (const operation of [
  () => readText(file),
  () => readText(file, 0),
  () => readDataUrl(file),
  () => download("", "data"),
]) {
  try { await operation(); failures.push("accepted"); }
  catch (error) { failures.push(error.name); }
}
console.log(failures.join(","));
console.log([textReads, readerCalls, blobCalls].join(":"));
`);
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, "RangeError,RangeError,RangeError,RangeError\n0:0:0\n");
});

test("file picker and reader host results reject instead of hanging or escaping budgets", () => {
  const source = standardModuleSource("velar/files") ?? "";
  const execution = executeModule(`
let removals = 0;
let fileListLengthReads = 0;
let fileListIndexReads = 0;
const fileState = new WeakMap();
const fileListState = new WeakMap();
class FakeBlob {
  get size() { return fileState.get(this).size; }
  get type() { return fileState.get(this).type; }
  text() { return Promise.resolve(fileState.get(this).text); }
}
class FakeFile extends FakeBlob {
  constructor(fields) { super(); fileState.set(this, fields); }
  get name() { return fileState.get(this).name; }
  get lastModified() { return fileState.get(this).lastModified; }
}
class FakeFileList {
  constructor(files) { fileListState.set(this, files); }
  get length() { fileListLengthReads += 1; return fileListState.get(this).length; }
  item(index) { return fileListState.get(this)[index] ?? null; }
}
globalThis.Blob = FakeBlob;
globalThis.File = FakeFile;
globalThis.FileList = FakeFileList;
let selectedFile = new FakeFile({ name: "invalid.txt", size: Number.NaN, type: "text/plain", lastModified: 0, text: "" });
let selectedFiles = new FakeFileList([selectedFile]);
globalThis.document = {
  createElement() {
    const listeners = new Map();
    return {
      get files() { return selectedFiles; },
      addEventListener(name, listener) { listeners.set(name, listener); },
      remove() { removals += 1; },
      click() { listeners.get("change")(); },
    };
  },
  body: { append() {} },
};
globalThis.addEventListener = () => {};
globalThis.removeEventListener = () => {};
globalThis.FileReader = class {
  readAsDataURL() { this.result = "x".repeat(5000); this.onload(); }
};
${source}
try { await pick(); console.log("accepted"); } catch (error) { console.log(error.name); }
selectedFile = new FakeFile({ name: "valid.txt", size: 1, type: "text/plain", lastModified: 0, text: "xx" });
selectedFiles = null;
try { await pick(); console.log("accepted"); } catch (error) { console.log(error.name); }
selectedFiles = new FakeFileList([selectedFile]);
Object.defineProperty(selectedFiles, "0", { get() { fileListIndexReads += 1; throw new Error("Indexed FileList access must not run"); } });
const [file] = await pick();
try { await readText(file, 1); console.log("accepted"); } catch (error) { console.log(error.name); }
try { await readDataUrl(file, 1); console.log("accepted"); } catch (error) { console.log(error.name); }
console.log(removals, fileListLengthReads, fileListIndexReads);
`);
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, "TypeError\nTypeError\nRangeError\nRangeError\n3 2 0\n");
});

test("realtime validates event-stream handlers and credentials before native effects", () => {
  const source = standaloneRealtimeSource();
  const execution = executeModule(`
let getterReads = 0;
let constructed = 0;
let closed = 0;
class FakeEventSource {
  constructor(url) { constructed += 1; this.url = url; this.readyState = 1; }
  addEventListener() {}
  close() { closed += 1; }
}
globalThis.EventSource = FakeEventSource;
${source}
const handlerAccessor = Object.defineProperty({}, "message", { enumerable: true, get() { getterReads += 1; return () => null; } });
const invalidOperations = [
  () => eventStream(42),
  () => eventStream("https://example.test", handlerAccessor),
  () => eventStream("https://example.test", { unknown() {} }),
  () => eventStream("https://example.test", { message: "invalid" }),
  () => eventStream("https://example.test", {}, "yes"),
];
const failures = [];
for (const operation of invalidOperations) {
  try { operation(); failures.push("accepted"); }
  catch (error) { failures.push(error.name); }
}
console.log(failures.join(","));
console.log([getterReads, constructed, closed].join(":"));
`);
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, "TypeError,TypeError,TypeError,TypeError,TypeError\n0:0:0\n");
});

test("realtime validates resolved event-stream URLs and states", () => {
  const source = standaloneRealtimeSource();
  const execution = executeModule(`
let coercions = 0;
let resolvedUrl = { toString() { coercions += 1; return "https://coerced.test"; } };
let streamValue;
let invalidCloses = 0;
class FakeEventSource {
  constructor() { this.url = resolvedUrl; this.readyState = 1; this.listeners = new Map(); streamValue = this; }
  addEventListener(name, listener) { this.listeners.set(name, listener); }
  close() { invalidCloses += 1; this.readyState = 2; }
}
globalThis.EventSource = FakeEventSource;
${source}
try { eventStream("https://example.test"); console.log("accepted"); } catch (error) { console.log(error.name); }
resolvedUrl = "https://example.test";
const stream = eventStream("https://example.test");
streamValue.readyState = 2;
console.log(stream.state());
streamValue.readyState = 3;
try { stream.state(); console.log("accepted"); } catch (error) { console.log(error.name); }
console.log(coercions + ":" + invalidCloses);
`);
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, "TypeError\nclosed\nTypeError\n0:1\n");
});

test("realtime closes oversized inbound event-stream messages", () => {
  const source = standaloneRealtimeSource();
  const execution = executeModule(`
let streamValue;
let streamClosed = 0;
let streamDataReads = 0;
let streamIdReads = 0;
class FakeEventSource {
  constructor(url) { this.url = url; this.readyState = 1; this.listeners = new Map(); streamValue = this; }
  addEventListener(name, listener) { this.listeners.set(name, listener); }
  close() { streamClosed += 1; this.readyState = 2; }
}
globalThis.EventSource = FakeEventSource;
${source}
const tooLarge = "x".repeat(16 * 1024 * 1024 + 1);
let streamErrors = 0;
const stream = eventStream("https://example.test", { error() { streamErrors += 1; } });
streamValue.listeners.get("message")({
  data: tooLarge,
  lastEventId: "",
});
const metadataStream = eventStream("https://example.test", { error() { streamErrors += 1; } });
streamValue.listeners.get("message")({
  data: "small",
  lastEventId: "x".repeat(65537),
});
console.log([streamErrors, streamClosed].join("|"));
console.log([streamDataReads, streamIdReads].join(":"));
`);
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, "2|2\n0:0\n");
});

test("realtime ignores event accessors and bypasses event-stream instance overrides", () => {
  const source = standaloneRealtimeSource();
  const execution = executeModule(`
const reports = [];
const calls = [];
let streamValue;
globalThis[Symbol.for("velar.runtime.v1")] = { report(error, options) { reports.push(options.detail + ":" + error.name); } };
class FakeEventSource {
  constructor(url) { this.url = url; this.readyState = 1; this.listeners = new Map(); streamValue = this; }
  addEventListener(name, listener) { this.listeners.set(name, listener); }
  close() { calls.push("prototype-stream-close"); this.readyState = 2; }
}
globalThis.EventSource = FakeEventSource;
${source}
const stream = eventStream("https://example.test");
streamValue.close = () => calls.push("instance-stream-close");
let getterReads = 0;
Object.defineProperty(streamValue, "readyState", { configurable: true, get() { getterReads += 1; return 1; } });
try { stream.state(); console.log("accepted"); } catch (error) { console.log(error.name); }
Object.defineProperty(streamValue, "readyState", { configurable: true, writable: true, value: 1 });
stream.close();
streamValue.listeners.get("message")(Object.defineProperties({}, {
  data: { enumerable: true, get() { getterReads += 1; return "unsafe"; } },
  lastEventId: { enumerable: true, get() { getterReads += 1; return "1"; } },
}));
console.log(getterReads);
console.log(calls.join(","));
console.log(reports.sort().join("|"));
`);
  assert.equal(execution.status, 0, String(execution.stderr));
  // Two prototype closes and no instance one: the explicit `close()`, and the
  // close the invalid message event forces. The instance overrides installed
  // above are never reached, which is the property under test.
  assert.equal(execution.stdout, "TypeError\n0\nprototype-stream-close,prototype-stream-close\nevent-stream:message:TypeError\n");
});

test("browser npm assets cannot escape a package through symbolic links", async () => {
  const directory = await makeTemporaryDirectory("velar-npm-asset-");
  const root = join(directory, "package");
  await mkdir(root);
  await writeFile(join(root, "inside.js"), "export const safe = true\n", "utf8");
  await writeFile(join(directory, "outside.js"), "export const escaped = true\n", "utf8");
  await symlink(join(root, "inside.js"), join(root, "inside-link.js"));
  await symlink(join(directory, "outside.js"), join(root, "outside-link.js"));
  const packages = [{ name: "package", root, route: "/@npm/package/", serveRoot: root }];
  assert.equal((await npmAsset(packages, "/@npm/package/inside-link.js"))?.path, await realpath(join(root, "inside.js")));
  assert.equal(await npmAsset(packages, "/@npm/package/outside-link.js"), null);
});
