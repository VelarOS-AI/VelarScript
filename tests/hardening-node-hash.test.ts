import assert from "node:assert/strict";
import { Hash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import { compile } from "@velarscript/compiler";
import { nodeModuleInterfaces, nodeModuleSources, velarNodeCompilerExtension } from "../packages/node/src/compiler.ts";

test("velar/hash exposes one checked text digest instead of a mutable Node Hash handle", () => {
  const module = nodeModuleInterfaces.get("velar/hash");
  assert.ok(module);
  assert.deepEqual([...module.exports.keys()], ["sha256Text"]);

  const sha256Text = module.exports.get("sha256Text");
  assert.ok(sha256Text);
  const result = compile(`
import {sha256Text} from "velar/hash"

const digest: string = sha256Text("方块")
`.trimStart(), {
    extensions: [velarNodeCompilerExtension],
    analysis: {imports: new Map([["sha256Text", sha256Text]])},
  });
  assert.deepEqual(result.diagnostics, []);
});

test("velar/hash produces bounded UTF-8 SHA-256 text digests from captured host operations", async () => {
  const source = nodeModuleSources.get("velar/hash");
  assert.ok(source);
  const directory = await mkdtemp(join(tmpdir(), "velar-node-hash-"));
  const modulePath = join(directory, "hash.mjs");
  await writeFile(modulePath, source, "utf8");

  try {
    const hashing = await import(`${pathToFileURL(modulePath).href}?test=${Date.now()}`) as {
      readonly sha256Text: (text: string) => string;
    };
    assert.equal(hashing.sha256Text(""), "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
    assert.equal(hashing.sha256Text("abc"), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    assert.equal(hashing.sha256Text("方块"), "2753766d18e25548b997cb714be9eab175877bb82c738ee728c5f31b229dc5cc");
    assert.throws(() => (hashing.sha256Text as (value: unknown) => string)(7), /requires text/u);
    assert.throws(() => hashing.sha256Text("a".repeat(16 * 1024 * 1024 + 1)), /cannot exceed 16 MiB/u);

    const update = Object.getOwnPropertyDescriptor(Hash.prototype, "update");
    const digest = Object.getOwnPropertyDescriptor(Hash.prototype, "digest");
    const apply = Object.getOwnPropertyDescriptor(Reflect, "apply");
    const charCodeAt = Object.getOwnPropertyDescriptor(String.prototype, "charCodeAt");
    assert.ok(update && digest && apply && charCodeAt);
    try {
      Object.defineProperty(Hash.prototype, "update", {configurable: true, value() { throw new Error("poisoned update"); }});
      Object.defineProperty(Hash.prototype, "digest", {configurable: true, value() { throw new Error("poisoned digest"); }});
      Object.defineProperty(Reflect, "apply", {configurable: true, value() { throw new Error("poisoned apply"); }});
      Object.defineProperty(String.prototype, "charCodeAt", {configurable: true, value() { throw new Error("poisoned charCodeAt"); }});
      assert.equal(hashing.sha256Text("abc"), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    } finally {
      Object.defineProperty(Hash.prototype, "update", update);
      Object.defineProperty(Hash.prototype, "digest", digest);
      Object.defineProperty(Reflect, "apply", apply);
      Object.defineProperty(String.prototype, "charCodeAt", charCodeAt);
    }
  } finally {
    await rm(directory, {recursive: true, force: true});
  }
});
