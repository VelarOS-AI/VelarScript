import assert from "node:assert/strict";
import test from "node:test";
import { compile, type CompilerExtension, type ValueType } from "@velarscript/compiler";

test("an owner may explain arity without entering inference or recovering the refused result", () => {
  let guidanceCalls = 0;
  let inferenceCalls = 0;
  const string: ValueType = { kind: "string" };
  const extension: CompilerExtension = {
    id: "@example/arity",
    analysis: {
      globals: new Map([["probe", {
        kind: "intrinsic", name: "example.probe", parameters: [string, string],
        requiredParameters: 2, result: string,
      }]]),
      intrinsicArityGuidance(intrinsic, arguments_) {
        guidanceCalls += 1;
        return intrinsic.name === "example.probe" && arguments_.length < 2 ? "Supply both the key and its declared shape" : undefined;
      },
      inferIntrinsic(context) {
        inferenceCalls += 1;
        context.arity();
        context.inferAt(0, string);
        context.inferAt(1, string);
        return string;
      },
    },
  };
  const checked = (source: string) => compile(source, { extensions: [extension] });
  const refused = checked('print(str(probe((value: number) => value + "bad").field))\n');
  assert.equal(refused.code, null);
  assert.equal(refused.diagnostics.length, 2, JSON.stringify(refused.diagnostics));
  assert.equal(refused.diagnostics[0]!.message, "Supply both the key and its declared shape");
  assert.match(refused.diagnostics[1]!.message, /String concatenation requires two strings/u);
  assert.equal(inferenceCalls, 0);
  assert.equal(guidanceCalls, 1);
  const generic = checked('print(str(probe("a", "b", "c")))\n');
  assert.deepEqual(generic.diagnostics.map((item) => item.message), ["Expected 2 arguments but received 3"]);
  assert.equal(inferenceCalls, 0);
  assert.equal(guidanceCalls, 2);
  assert.deepEqual(checked('print(probe("a", "b"))\n').diagnostics, []);
  assert.equal(inferenceCalls, 1);
  assert.equal(guidanceCalls, 2, "valid calls do not enter the refusal hook");
});
