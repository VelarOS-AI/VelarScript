import assert from "node:assert/strict";
import test from "node:test";
import { compile } from "@velarscript/compiler";

// 这两组回归守的是同一条原则：编译器的资源判据必须是**编译器自己**的显式预算，
// 而不是「跑到 JavaScript 栈用尽为止」或者「跑到不动为止，跑不动就算了」。前者让
// 同一份源码在 Node、Bun、浏览器 worker 里给出不同答案，后者让用户拿到一个看起来
// 编译成功、类型推断结果却不确定的产物。

test("result type inference reports its own non-convergence instead of accepting the last pass", () => {
  // a 的结果是 List<b 的结果>，b 的结果是 List<a 的结果>：每一趟都比上一趟多包一层
  // List，这个不动点迭代永远不会稳定。它必须报出来。
  const oscillating = compile("def a():\n  return [b()]\ndef b():\n  return [a()]\nprint(str(a()))\n");
  assert.equal(oscillating.code, null);
  const reported = oscillating.diagnostics.find((item) => item.code === "VEL2038");
  assert.ok(reported, JSON.stringify(oscillating.diagnostics));
  assert.match(reported.message, /did not settle within the compiler's \d+-pass budget/u);
  // 诊断落在第一个仍在变化的签名上，而不是模块开头的 0..1 —— 用户要知道改哪里。
  assert.ok(reported.span.end > reported.span.start);
  assert.ok(reported.span.end <= "def a():\n  return [b()]\ndef b():\n  return [a()]\nprint(str(a()))\n".length);

  // 收敛的模块不能被这条诊断误伤，一条也不能。
  const chain = `${Array.from({ length: 40 }, (_, index) => `def f${index}():\n  return ${index === 39 ? "1" : `f${index + 1}()`}\n`).join("")}print(str(f0()))\n`;
  const converging = compile(chain);
  assert.deepEqual(converging.diagnostics, []);
  assert.ok(converging.code);
});

test("nesting depth is decided by an explicit budget rather than by the JavaScript stack", () => {
  // 左结合的表达式链一层语法深度都不花（解析是循环的），但生成的 AST 和链一样深，
  // 而分析器是递归遍历的。以前这条路径靠捕获 RangeError + 正则匹配英文消息兜底，
  // 于是同一份源码热身前后的结论都可能不同；现在它是一条带位置的显式诊断。
  const chained = `const value = ${Array.from({ length: 1_000 }, () => "1").join(" + ")}\n`;
  const overBudget = compile(chained);
  assert.equal(overBudget.code, null);
  assert.deepEqual(overBudget.diagnostics.map((item) => item.code), ["VEL2008"]);
  assert.match(overBudget.diagnostics[0]!.message, /cannot exceed \d+ levels/u);
  assert.ok(overBudget.diagnostics[0]!.span.end > overBudget.diagnostics[0]!.span.start);

  // 预算之内的同形状源码照常编译，两次调用的答案必须一致（冷热无关）。
  const withinBudget = `const value = ${Array.from({ length: 200 }, () => "1").join(" + ")}\n`;
  const first = compile(withinBudget);
  const second = compile(withinBudget);
  assert.deepEqual(first.diagnostics, []);
  assert.deepEqual(second.diagnostics, []);
  assert.equal(first.code, second.code);

  // 语法嵌套同样由解析器的显式预算判定，而不是等栈溢出。
  const deepCalls = `def id(value: number) -> number:\n  return value\nconst x = ${"id(".repeat(450)}1${")".repeat(450)}\n`;
  const rejected = compile(deepCalls);
  assert.equal(rejected.code, null);
  assert.ok(rejected.diagnostics.some((item) => item.code === "VEL2008"), JSON.stringify(rejected.diagnostics));
  assert.ok(!rejected.diagnostics.some((item) => item.code === "VEL9001"), JSON.stringify(rejected.diagnostics));
});

test("a RangeError that escapes every budget is an internal compiler error, not the author's mistake", () => {
  // 编译器自己漏掉一条没设门的递归路径时，用户看到的必须是「这是编译器的缺陷，
  // 请上报」，而不是「你的代码嵌套太复杂」——把自己的 bug 说成用户的错最伤信任。
  const overflow = compile("const value = 1\n", {
    extensions: [{
      id: "fixture-unmetered-recursion",
      lexical: {
        scan() {
          const recurse = (depth: number): number => recurse(depth + 1) + 1;
          recurse(0);
          return null;
        },
      },
    }],
  });
  assert.deepEqual(overflow.diagnostics.map((item) => item.code), ["VEL9001"]);
  assert.match(overflow.diagnostics[0]!.message, /Internal compiler error/u);
  assert.equal(overflow.code, null);
  // 结构仍然完整，playground 之类的下游不会因此崩。
  assert.equal(overflow.source.text, "const value = 1\n");
  assert.ok(overflow.semanticIndex);
});
