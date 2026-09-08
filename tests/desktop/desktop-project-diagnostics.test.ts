import assert from "node:assert/strict";
import test from "node:test";
import { velarProjectExtension } from "../../packages/desktop/src/config.ts";
import { velarFrameworkHost } from "../../packages/desktop/src/host.ts";

test("every Desktop capability refusal names the first importing module and exact specifier", () => {
  const config = velarProjectExtension.parse({ productName: "Diagnostics", identifier: "dev.velarscript.diagnostics" }, "velar.json");
  const specifiers = ["velar/fs", "velar/process", "velar/http", "velar/env", "velar/notification", "velar/secure-storage", "velar/service"];
  const modules = [
    { path: "src/first.vel", imports: specifiers },
    { path: "src/second.vel", imports: specifiers },
  ];
  const failures = velarFrameworkHost.validateProject!({ config, modules });
  assert.equal(failures.length, specifiers.length);
  assert.deepEqual(failures.map((failure) => {
    assert.notEqual(typeof failure, "string");
    if (typeof failure === "string") throw new Error("Expected a positioned project refusal");
    assert.equal(failure.code, "VEL6014");
    assert.equal(failure.module, "src/first.vel");
    assert.match(failure.message, /^Desktop source imports 'velar\//u);
    return failure.specifier;
  }), specifiers);
  assert.deepEqual(velarFrameworkHost.validateProject!({ config, modules: [{ path: "src/unused.vel", imports: [] }] }), []);
});
