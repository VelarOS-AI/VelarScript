import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import { compile } from "@velarscript/compiler";
import { standardModuleInterface, standardModuleSource } from "../packages/core/src/index.ts";
import { nodeModuleInterfaces, nodeModuleSources } from "../packages/node/src/compiler.ts";

test("velar/hash is one checked Core digest contract rather than a target capability", () => {
  const module = standardModuleInterface("velar/hash");
  assert.ok(module);
  assert.deepEqual([...module.exports.keys()], ["sha256Text"]);
  assert.equal(nodeModuleInterfaces.has("velar/hash"), false);
  assert.equal(nodeModuleSources.has("velar/hash"), false);

  const sha256Text = module.exports.get("sha256Text");
  assert.ok(sha256Text);
  const result = compile(`
import {sha256Text} from "velar/hash"

const digest: string = sha256Text("方块")
`.trimStart(), {
    analysis: {imports: new Map([["sha256Text", sha256Text]])},
  });
  assert.deepEqual(result.diagnostics, []);
});

test("velar/hash produces bounded portable UTF-8 SHA-256 digests from captured Core operations", async () => {
  const source = standardModuleSource("velar/hash");
  assert.ok(source);
  assert.doesNotMatch(source, /node:/u);
  const runnable = source.replace(
    'import {uint8Buffer, uint32Buffer} from "velar/binary";',
    "const __testUint8Array = globalThis.Uint8Array; const __testUint32Array = globalThis.Uint32Array; const uint8Buffer = size => new __testUint8Array(size); const uint32Buffer = size => new __testUint32Array(size);",
  );
  const directory = await mkdtemp(join(tmpdir(), "velar-core-hash-"));
  const modulePath = join(directory, "hash.mjs");
  await writeFile(modulePath, runnable, "utf8");

  try {
    const hashing = await import(`${pathToFileURL(modulePath).href}?test=${Date.now()}`) as {
      readonly sha256Text: (text: string) => string;
    };
    assert.equal(hashing.sha256Text(""), "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
    assert.equal(hashing.sha256Text("abc"), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    assert.equal(hashing.sha256Text("方块"), "2753766d18e25548b997cb714be9eab175877bb82c738ee728c5f31b229dc5cc");
    assert.equal(hashing.sha256Text("a😀b"), "6fba5b2ea783ded096fc2444d540ffbdf49168df30993b155b7efb683313f110");
    assert.equal(hashing.sha256Text("\ud800"), "83d544ccc223c057d2bf80d3f2a32982c32c3c0db8e2674820da5064783fb097");
    assert.throws(() => (hashing.sha256Text as (value: unknown) => string)(7), /requires text/u);
    assert.throws(() => hashing.sha256Text("a".repeat(16 * 1024 * 1024 + 1)), /cannot exceed 16 MiB/u);

    const apply = Object.getOwnPropertyDescriptor(Reflect, "apply");
    const charCodeAt = Object.getOwnPropertyDescriptor(String.prototype, "charCodeAt");
    assert.ok(apply && charCodeAt);
    try {
      Object.defineProperty(Reflect, "apply", {configurable: true, value() { throw new Error("poisoned apply"); }});
      Object.defineProperty(String.prototype, "charCodeAt", {configurable: true, value() { throw new Error("poisoned charCodeAt"); }});
      assert.equal(hashing.sha256Text("abc"), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    } finally {
      Object.defineProperty(Reflect, "apply", apply);
      Object.defineProperty(String.prototype, "charCodeAt", charCodeAt);
    }
  } finally {
    await rm(directory, {recursive: true, force: true});
  }
});
