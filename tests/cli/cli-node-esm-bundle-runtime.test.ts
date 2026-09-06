import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { build, type Plugin } from "esbuild";
import { NODE_ESM_COMMONJS_RUNTIME_PLUGIN } from "../../packages/cli/src/node-esm-bundle-runtime.ts";

test("the Node ESM builtin bridge is lazy and caches its CommonJS value", async () => {
  const code = await bundle([
    'import { builtinProbeCalls } from "node:process";',
    "export const calls = () => builtinProbeCalls();",
    'export const maybeLoad = (enabled) => enabled ? require("node:path").marker : "off";',
  ].join("\n"), builtinProbePlugin('{ marker: specifier }'));
  const runtime = await importJavaScript<{
    readonly calls: () => number;
    readonly maybeLoad: (enabled: boolean) => unknown;
  }>(code);

  assert.equal(runtime.calls(), 0);
  assert.equal(runtime.maybeLoad(false), "off");
  assert.equal(runtime.calls(), 0);
  assert.equal(runtime.maybeLoad(true), "node:path");
  assert.equal(runtime.maybeLoad(true), "node:path");
  assert.equal(runtime.calls(), 1);
});

test("the Node ESM builtin bridge is not redirected through a mutable process hook", async () => {
  const code = await bundle([
    "export function loadPathAfterMutation() {",
    "  const original = process.getBuiltinModule;",
    '  process.getBuiltinModule = () => ({ sep: "hijacked" });',
    '  try { return require("node:path").sep; }',
    "  finally { process.getBuiltinModule = original; }",
    "}",
  ].join("\n"));
  const runtime = await importJavaScript<{
    readonly loadPathAfterMutation: () => string;
  }>(code);

  assert.equal(runtime.loadPathAfterMutation(), process.platform === "win32" ? "\\" : "/");
});

test("the Node ESM builtin bridge throws when the deployment runtime lacks the builtin", async () => {
  const code = await bundle(
    'export const load = () => require("node:path");\n',
    builtinProbePlugin("undefined"),
  );
  const runtime = await importJavaScript<{
    readonly load: () => unknown;
  }>(code);

  assert.throws(() => runtime.load());
});

async function bundle(source: string, extraPlugin?: Plugin): Promise<string> {
  const result = await build({
    bundle: true,
    format: "esm",
    logLevel: "silent",
    platform: "node",
    plugins: [NODE_ESM_COMMONJS_RUNTIME_PLUGIN, ...(extraPlugin ? [extraPlugin] : [])],
    stdin: { contents: source, loader: "js", sourcefile: "fixture.js" },
    target: "node24",
    write: false,
  });
  const output = result.outputFiles?.[0];
  assert.ok(output);
  return output.text;
}

function builtinProbePlugin(value: string): Plugin {
  const namespace = `velar-test-node-process-${randomUUID()}`;
  return {
    name: "velar-test-node-process",
    setup(context) {
      context.onResolve({ filter: /^node:process$/ }, () => ({ path: "node:process", namespace }));
      context.onLoad({ filter: /.*/, namespace }, () => ({
        contents: [
          "let calls = 0;",
          `export function getBuiltinModule(specifier) { calls += 1; return ${value}; }`,
          "export function builtinProbeCalls() { return calls; }",
          "export default { getBuiltinModule };",
        ].join("\n"),
        loader: "js",
      }));
    },
  };
}

async function importJavaScript<T>(code: string): Promise<T> {
  return await import(`data:text/javascript;base64,${Buffer.from(code).toString("base64")}#${randomUUID()}`) as T;
}
