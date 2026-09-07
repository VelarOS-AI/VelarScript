import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { nodeModuleSources } from "../../packages/node/src/compiler.ts";
import { materializeNodeRuntimeDependencies, runProcess } from "../support/node-runtime.ts";

/**
 * D115 §三 — one `velar/*` module per file, split out of the 2,809-line heavy
 * tier `node-platform.slow.test.ts`. Every test here is the one that was
 * there, moved verbatim; the quick-tier core cases D114 GA-U3 lifted out stay
 * in `node-platform.test.ts` and `node-platform-serve.test.ts`.
 *
 * The subject is `velar/fs` under a hostile application: its validation, its
 * `Stats` reads, its decoder and its result shapes all have to come from
 * intrinsics it captured before the program could replace them.
 */

test("Node filesystem keeps captured validation, Stats, decoder, and result operations", async () => {
  const directory = await mkdtemp(join(tmpdir(), "velar-node-hostile-fs-"));
  try {
    const source = nodeModuleSources.get("velar/fs");
    assert.ok(source);
    await materializeNodeRuntimeDependencies(directory, "velar/fs");
    await writeFile(join(directory, "fs.mjs"), source, "utf8");
    await writeFile(join(directory, "driver.mjs"), `
import {Stats} from "node:fs";
import * as fs from "./fs.mjs";

const root = process.argv[2];
const file = root + "/note.txt";
const nativeApply = Reflect.apply;
const nativeDefine = Object.defineProperty;
const nativeDelete = Reflect.deleteProperty;
const nativeOwnDescriptor = Object.getOwnPropertyDescriptor;
const nativeWrite = process.stdout.write;
const typedArrayPrototype = Object.getPrototypeOf(Uint8Array.prototype);
const originals = {
  arrayIsArray: nativeOwnDescriptor(Array, "isArray"),
  arraySort: nativeOwnDescriptor(Array.prototype, "sort"),
  bufferByteLength: nativeOwnDescriptor(Buffer, "byteLength"),
  numberIsFinite: nativeOwnDescriptor(Number, "isFinite"),
  numberIsSafeInteger: nativeOwnDescriptor(Number, "isSafeInteger"),
  objectDefineProperty: nativeOwnDescriptor(Object, "defineProperty"),
  objectFreeze: nativeOwnDescriptor(Object, "freeze"),
  objectGetOwnPropertyDescriptor: nativeOwnDescriptor(Object, "getOwnPropertyDescriptor"),
  objectGetPrototypeOf: nativeOwnDescriptor(Object, "getPrototypeOf"),
  objectKeys: nativeOwnDescriptor(Object, "keys"),
  promiseThen: nativeOwnDescriptor(Promise.prototype, "then"),
  reflectApply: nativeOwnDescriptor(Reflect, "apply"),
  statsIsDirectory: nativeOwnDescriptor(Stats.prototype, "isDirectory"),
  statsIsFile: nativeOwnDescriptor(Stats.prototype, "isFile"),
  statsIsSymbolicLink: nativeOwnDescriptor(Stats.prototype, "isSymbolicLink"),
  stringIncludes: nativeOwnDescriptor(String.prototype, "includes"),
  textDecoderDecode: nativeOwnDescriptor(TextDecoder.prototype, "decode"),
  textEncoderEncode: nativeOwnDescriptor(TextEncoder.prototype, "encode"),
  typedArrayByteLength: nativeOwnDescriptor(typedArrayPrototype, "byteLength"),
};
let poisonCalls = 0;
const poison = () => { poisonCalls += 1; throw new Error("application prototype poison reached velar/fs"); };
nativeDefine(Array, "isArray", {...originals.arrayIsArray, value: poison});
nativeDefine(Array.prototype, "sort", {...originals.arraySort, value: poison});
nativeDefine(Buffer, "byteLength", {...originals.bufferByteLength, value: poison});
nativeDefine(Number, "isFinite", {...originals.numberIsFinite, value: poison});
nativeDefine(Number, "isSafeInteger", {...originals.numberIsSafeInteger, value: poison});
nativeDefine(Object, "defineProperty", {...originals.objectDefineProperty, value: poison});
nativeDefine(Object, "freeze", {...originals.objectFreeze, value: poison});
nativeDefine(Object, "getOwnPropertyDescriptor", {...originals.objectGetOwnPropertyDescriptor, value: poison});
nativeDefine(Object, "getPrototypeOf", {...originals.objectGetPrototypeOf, value: poison});
nativeDefine(Object, "keys", {...originals.objectKeys, value: poison});
nativeDefine(Promise.prototype, "then", {...originals.promiseThen, value: poison});
nativeDefine(Reflect, "apply", {...originals.reflectApply, value: poison});
nativeDefine(Stats.prototype, "isDirectory", {configurable: true, writable: true, value: poison});
nativeDefine(Stats.prototype, "isFile", {configurable: true, writable: true, value: poison});
nativeDefine(Stats.prototype, "isSymbolicLink", {configurable: true, writable: true, value: poison});
nativeDefine(String.prototype, "includes", {...originals.stringIncludes, value: poison});
nativeDefine(TextDecoder.prototype, "decode", {...originals.textDecoderDecode, value: poison});
nativeDefine(TextEncoder.prototype, "encode", {...originals.textEncoderEncode, value: poison});
nativeDefine(typedArrayPrototype, "byteLength", {...originals.typedArrayByteLength, get: poison});

await fs.createText(root + "/zzz-created.txt", "exclusive");
await fs.writeText(file, "one");
await fs.appendText(file, " two");
const text = await fs.readText(file);
const names = await fs.list(root);
const info = await fs.info(file);
const missing = await fs.exists(root + "/missing.txt");
const watcher = await fs.watchFiles(root, true);
const pendingWatch = watcher.next();
// The macOS FSEvents stream behind a recursive watch arms asynchronously, so a
// single write can land before it starts and is then never reported. Re-trigger
// on a timer instead of racing the pull: every combinator that could observe it
// here (Promise.race, .finally, .catch) reads the poisoned Promise.prototype.then.
let watchReported = false;
const watchDeadline = Date.now() + 30000;
const retriggerWatch = async () => {
  if (watchReported) return;
  // Closing settles the outstanding pull with null, so a watch that never
  // reports fails the observed-output assertion instead of hanging the suite.
  if (Date.now() >= watchDeadline) { try { await watcher.close(); } catch {} return; }
  try { await fs.writeText(root + "/watched.txt", "watch"); } catch {}
  if (!watchReported) setTimeout(retriggerWatch, 250);
};
await fs.writeText(root + "/watched.txt", "watch");
setTimeout(retriggerWatch, 250);
const watchBatch = await pendingWatch;
watchReported = true;
await watcher.close();
const observed = [text, names[0], info?.kind, String(missing), String(watchBatch?.paths.length > 0), String(poisonCalls)].join("|");

nativeDefine(Array, "isArray", originals.arrayIsArray);
nativeDefine(Array.prototype, "sort", originals.arraySort);
nativeDefine(Buffer, "byteLength", originals.bufferByteLength);
nativeDefine(Number, "isFinite", originals.numberIsFinite);
nativeDefine(Number, "isSafeInteger", originals.numberIsSafeInteger);
nativeDefine(Object, "defineProperty", originals.objectDefineProperty);
nativeDefine(Object, "freeze", originals.objectFreeze);
nativeDefine(Object, "getOwnPropertyDescriptor", originals.objectGetOwnPropertyDescriptor);
nativeDefine(Object, "getPrototypeOf", originals.objectGetPrototypeOf);
nativeDefine(Object, "keys", originals.objectKeys);
nativeDefine(Promise.prototype, "then", originals.promiseThen);
nativeDefine(Reflect, "apply", originals.reflectApply);
for (const [name, descriptor] of [
  ["isDirectory", originals.statsIsDirectory],
  ["isFile", originals.statsIsFile],
  ["isSymbolicLink", originals.statsIsSymbolicLink],
]) {
  if (descriptor) nativeDefine(Stats.prototype, name, descriptor);
  else nativeDelete(Stats.prototype, name);
}
nativeDefine(String.prototype, "includes", originals.stringIncludes);
nativeDefine(TextDecoder.prototype, "decode", originals.textDecoderDecode);
nativeDefine(TextEncoder.prototype, "encode", originals.textEncoderEncode);
nativeDefine(typedArrayPrototype, "byteLength", originals.typedArrayByteLength);
nativeApply(nativeWrite, process.stdout, [observed + "\\n"]);
`.trimStart(), "utf8");
    const result = await runProcess(
      process.execPath,
      [join(directory, "driver.mjs"), directory],
      directory,
      process.env,
    );
    assert.equal(result.code, 0, result.stderr);
    assert.equal(result.stdout, "one two|driver.mjs|file|false|true|0\n");
    assert.equal(result.stderr, "");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
