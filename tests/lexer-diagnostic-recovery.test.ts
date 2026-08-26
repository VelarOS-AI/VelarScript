import assert from "node:assert/strict";
import test from "node:test";
import { compile } from "../packages/compiler/src/index.ts";

test("one unsupported Unicode run produces one source diagnostic", () => {
  const result = compile(`def update():
    let count = 0
    count += 哈大大
`);

  assert.deepEqual(result.diagnostics.map((item) => ({ code: item.code, message: item.message })), [
    { code: "VEL1001", message: "Unexpected characters '哈大大'" },
  ]);
});

test("an unsupported run does not hide an independent error on a later line", () => {
  const result = compile(`def update():
    let count = 0
    count += 哈大大

def later():
    const broken =
`);

  assert.equal(result.diagnostics[0]?.code, "VEL1001");
  assert.equal(result.diagnostics[0]?.message, "Unexpected characters '哈大大'");
  assert.ok(result.diagnostics.some((item) => item.code === "VEL2002"));
});
