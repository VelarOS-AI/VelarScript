import assert from "node:assert/strict";
import test, { after } from "node:test";
import { mkdir, readdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { compile as compileCore, type CompilerExtension } from "@velarscript/compiler";
import { Analyzer } from "@velarscript/compiler/extension";
import { makeTemporaryDirectory, removeTemporaryDirectories } from "../support/temporary-directory.ts";
import { compileProject } from "../support/compiler-suite.ts";

after(removeTemporaryDirectories);

test("velar test and velar run resolve bridged npm dependencies from the project", async () => {
  const cli = resolve("packages/cli/src/cli.ts");
  const directory = await makeTemporaryDirectory("velar-bridged-sandbox-");
  const packageRoot = join(directory, "node_modules", "word-count");
  await mkdir(join(directory, "src"), { recursive: true });
  await mkdir(packageRoot, { recursive: true });
  await writeFile(join(directory, "velar.json"), JSON.stringify({ formatVersion: 2, entry: "src/main.vel", extensions: [] }), "utf8");
  // The project's own package manifest deliberately omits "type": the compiled
  // sandbox carries its own ES-module manifest.
  await writeFile(join(directory, "package.json"), JSON.stringify({ name: "bridged-fixture", private: true }), "utf8");
  await writeFile(join(packageRoot, "package.json"), JSON.stringify({ name: "word-count", type: "module", main: "index.js" }), "utf8");
  await writeFile(join(packageRoot, "index.js"), "export function countWords(text) { return text.split(/\\s+/u).filter(Boolean).length; }\n", "utf8");
  await writeFile(join(directory, "src", "words.vel"), `
extern module "word-count":
    export def countWords(text: string) -> number

import js {countWords} from "word-count"

export def measure(text: string) -> number:
    return countWords(text)
`.trimStart(), "utf8");
  await writeFile(join(directory, "src", "main.vel"), `
import {measure} from "./words.vel"

print(measure("velar test resolves bridged packages"))
`.trimStart(), "utf8");
  await writeFile(join(directory, "src", "words.test.vel"), `
import {expect} from "velar/test"
import {measure} from "./words.vel"

test "a bridged dependency resolves":
    expect(measure("one two three")).toBe(3)
`.trimStart(), "utf8");

  // No TMPDIR override: the compiled tree must resolve the bridged package
  // through the project's own node_modules.
  const tested = spawnSync(process.execPath, [cli, "test"], { cwd: directory, encoding: "utf8" });
  assert.equal(tested.status, 0, String(tested.stderr));
  assert.match(tested.stdout, /words\.test\.vel" :: "a bridged dependency resolves"/u);
  assert.match(tested.stdout, /1 passed, 0 failed/u);

  const ran = spawnSync(process.execPath, [cli, "run"], { cwd: directory, encoding: "utf8" });
  assert.equal(ran.status, 0, String(ran.stderr));
  assert.equal(ran.stdout, "5\n");

  // The in-project sandbox cleans up after itself.
  const entries = await readdir(directory);
  assert.ok(!entries.includes(".velar"), JSON.stringify(entries));
});

test("route components check without importing RouteContext at the call site", async () => {
  const directory = await makeTemporaryDirectory("velar-route-context-");
  const pagePath = join(directory, "page.vel");
  const mainPath = join(directory, "main.vel");
  await writeFile(pagePath, `
import {RouteContext} from "velar/web"

export component ItemPage(route: RouteContext):
    return <p>{route.path}</p>
`.trimStart(), "utf8");
  // The importing module uses route() and Router without naming RouteContext:
  // the check must resolve the canonical identity rather than the bare name.
  await writeFile(mainPath, `
import {Router, route} from "velar/web"
import {ItemPage} from "./page.vel"

component App:
    return <Router routes={[route("/items/:id", ItemPage)]} fallback={ItemPage} />

mount(<App />, "#app")
`.trimStart(), "utf8");

  const project = await compileProject(mainPath);
  assert.deepEqual(project.failures, []);
  for (const module of project.modules) {
    assert.deepEqual(module.result.diagnostics, []);
  }
});

// The lowering-hint channel (`extensionCalls`) is keyed by span identity with
// an open string vocabulary, and `Analyzer` is exported to extension authors,
// so three in-repo owners plus any third party write it. Its safety used to be
// convention: a second owner claiming a span silently lost, and the emitter
// lowered that expression the other way with nothing anywhere saying so.
test("a second, different lowering hint on one span is a reported compiler defect", () => {
  const claims: [string, string][] = [
    ["4:9", "test.first-claim"],
    ["4:9", "test.first-claim"],    // idempotent: a re-analyzed span decided the same way
    ["4:9", "test.second-claim"],   // collision: two owners disagree about one expression
    ["11:14", "unnamespaced"],      // opts out of the namespace that prevents collisions
    ["11:14", "test.well-named"],   // the refused value never claimed the span
  ];
  class DoubleWritingAnalyzer extends Analyzer {
    override analyze(program: Parameters<Analyzer["analyze"]>[0]): ReturnType<Analyzer["analyze"]> {
      const diagnostics = super.analyze(program);
      for (const [identity, value] of claims) this.extensionCalls.set(identity, value);
      return diagnostics;
    }
  }
  const extension: CompilerExtension = {
    id: "test:lowering-hint-collision",
    analyzer: { create: (context, extensions) => new DoubleWritingAnalyzer(context, extensions) },
  };

  const result = compileCore(`print("hint")\n`, { extensions: [extension] });
  assert.deepEqual(result.diagnostics.map((item) => `${item.code} ${item.message}`), [
    "VEL9004 Internal compiler error: lowering hints 'test.first-claim' and 'test.second-claim' both claim one expression, and only one of them can be emitted; please report this module",
    "VEL9004 Internal compiler error: lowering hint 'unnamespaced' does not name an owner — write '<owner>.<name>' or '@scope/<owner>:<name>'; please report this module",
  ]);
  // The collision points at the source it is about, and the refusal leaves the
  // span free for the owner that spells its hint correctly.
  assert.deepEqual(result.diagnostics.map((item) => item.span), [{ start: 4, end: 9 }, { start: 11, end: 14 }]);
});
