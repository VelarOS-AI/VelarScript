import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { WEB_RUNTIME_BODY } from "../../packages/web/src/runtime-sources.generated.ts";
import { repositoryRoot } from "../support/repository-root.ts";
import { compiled } from "../support/emitted-web-module.ts";

/**
 * D115 P5 — the boundary the emitted Web runtime is held to, one subject of the
 * file that was `tests/web/reactive-graph-and-runtime-abi.slow.test.ts` before
 * it reached 881 lines.
 *
 * Fix wave 2 of the marathon defect ledger
 * (docs/decisions/archive/MARATHON-DEFECTS.md): the Web runtime items. Each
 * probe stays at the level the ledger's evidence was taken at.
 * Three of them are about the boundary rather than the graph: a module with no
 * Web syntax in it keeps the Core detached-task contract, the reactive wrapper
 * rewrite reaches every occurrence and not only the first, and the gate that
 * enforces the boundary covers the whole emitted runtime — which is read out of
 * `scripts/check-runtime-boundary.mjs` here, so the definition and the runtime
 * that has to satisfy it are pinned against each other. The bodies below are
 * the bodies that file had.
 */

const root = repositoryRoot;

// ---------------------------------------------------------------------------
// alpha-4: the Web detached-task helper must follow `webOutput`.
// ---------------------------------------------------------------------------

test("[alpha-4] a module without Web syntax keeps the Core detached-task contract", () => {
  const dataOnly = compiled(`
async def boom():
    throw Error("data module failure")

detach boom()
print("still running")
`);
  assert.ok(!dataOnly.includes("__velarDetachedRegistryKey"),
    "a module with no Web syntax was given the browser detached-report path");
  assert.ok(!dataOnly.includes("__velarRuntime"), "a module with no Web syntax emitted the Web runtime");

  // The Node contract: report on stderr, do not end the process.
  const execution = spawnSync(process.execPath, ["--input-type=module"], { encoding: "utf8", input: dataOnly });
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, "still running\n");
  assert.match(String(execution.stderr), /data module failure/u);

  // A module that really is Web output still reports through velar/app.
  const webModule = compiled(`
state ready = true

async def boom():
    throw Error("web failure")

detach boom()
`);
  assert.ok(webModule.includes("__velarDetachedRegistryKey"), "Web output lost the velar/app detached-report path");
});

// ---------------------------------------------------------------------------
// beta-11: the reactive wrapper rewrite must reach every occurrence.
// ---------------------------------------------------------------------------

test("[beta-11] the Web collection-call rewrite replaces every occurrence", async () => {
  const program = compiled(`
type Row:
    label: string

state rows: List<Row> = [{label: "a"}, {label: "b"}, {label: "c"}]

def take() -> Row:
    return rows.pop(0)

def pair() -> string:
    return rows.pop(0).label + rows.pop().label
`);
  assert.ok(program.includes("__velarWebListPop("), "pop() lost its reactive wrapper");
  // The raw operations survive inside the collection runtime that defines them;
  // what must never survive is a raw call in the application's own code.
  const application = program.slice(program.indexOf("function take()"));
  assert.ok(!/(?<![A-Za-z])__velarListPop\(/u.test(application), "a raw List pop survived in Web application code");
  // The defect was mechanical: `String.replace` with a string pattern rewrites
  // one occurrence, so a single lowered node emitting two collection calls
  // would silently keep a raw one. `pair` is exactly that node.
  assert.equal(application.match(/__velarWebListPop\(/gu)?.length, 3, "the rewrite missed an occurrence inside one expression");

  const emitter = await readFile(join(root, "packages", "web", "src", "emitter.ts"), "utf8");
  // Bounded by `emitExpression`'s own closing line: a marker naming what follows can move to a collaborator (D115 P4 R3d moved `emitLook` to `emit/look.ts`), and a slice to a missing marker reads the whole file instead of the rewrite it is about.
  const tail = emitter.indexOf("const emitted = super.emitExpression(expression);");
  const rewrite = emitter.slice(tail, emitter.indexOf("\n  }", tail));
  assert.equal(rewrite.match(/\.replaceAll\(/gu)?.length, 1, "the collection-call rewrite no longer replaces every occurrence");
  assert.ok(!/\.replace\(/u.test(rewrite), "the collection-call rewrite kept a single-occurrence replace");
});

// ---------------------------------------------------------------------------
// beta-6: the boundary gate must cover the whole emitted Web runtime.
// ---------------------------------------------------------------------------

test("[beta-6] the ABI gate covers the whole emitted Web runtime", async () => {
  const gate = await readFile(join(root, "scripts", "check-runtime-boundary.mjs"), "utf8");
  for (const phrase of [
    'const emittedWebRuntimeSource = webFamilySource("emitted")',
    "function emittedRuntimeUseSource(template)",
    "const emittedWebRuntimeUseSource = emittedRuntimeUseSource(emittedWebRuntimeSource)",
    "escaped the emitted Web runtime that the ABI gate covers",
  ]) {
    assert.ok(gate.includes(phrase), `the runtime-boundary gate lost whole-runtime coverage: '${phrase}'`);
  }

  // Independent second opinion on the content itself: the surfaces that used
  // to sit outside every slice (keyed reconciliation, look, class, style,
  // events, form binding) must not reach a replaceable global or prototype.
  const template = WEB_RUNTIME_BODY;
  assert.ok(template.includes("function __velarKeyed(") && template.includes("function __velarApplyClasses(")
    && template.includes("function __velarOn(") && template.includes("function __velarBindValue("),
    "the emitted Web runtime no longer spans the surfaces the gate must cover");
  const runtimeUse = template.split("\n")
    .filter((line) => !(/^const __velar[A-Za-z0-9]+ = /u.test(line) && !/=>|function\s*[(*]|function [A-Za-z_$]/u.test(line)))
    .join("\n");
  for (const pattern of [
    /\bnew (?:Set|Map|WeakSet|WeakMap)\s*\(/u,
    /\bObject\.(?:is|freeze|keys|entries|create|defineProperty|getOwnPropertyNames)\s*\(/u,
    /\bArray\.isArray\s*\(/u,
    /__velarRuntime\.[A-Za-z]+\.(?:get|set|has|add|delete)\b/u,
    /\.(?:classList|addEventListener|removeEventListener|innerHTML|valueAsNumber|checked)\b/u,
    /\.(?:flatMap|filter|map|forEach|join|reverse|push|includes)\s*\(/u,
  ]) {
    const match = pattern.exec(runtimeUse);
    assert.equal(match, null, `the emitted Web runtime reaches a replaceable operation: ${match?.[0] ?? ""}`);
  }
});
