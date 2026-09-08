import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { type CompilerExtension } from "@velarscript/compiler";
import { compileProject } from "../../packages/cli/src/project.ts";
import { velarNodeCompilerExtension } from "../../packages/node/src/compiler.ts";
import { velarCompilerExtension } from "../../packages/web/src/compiler.ts";

/** Resolve each target's real module contracts through the project driver. */
async function diagnostics(source: string, extension: CompilerExtension): Promise<readonly string[]> {
  const directory = await mkdtemp(join(tmpdir(), "velar-call-shape-"));
  try {
    const path = join(directory, "main.vel");
    await writeFile(path, source);
    const project = await compileProject(path, new Map(), { extensions: [extension] });
    assert.deepEqual(project.failures, []);
    return project.modules.flatMap((module) => module.result.diagnostics.map((item) => item.message));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test("Web intrinsics reject their arity before interpreting missing route or lazy slots", async () => {
  for (const call of ['route("/")', "lazy()"]) {
    const name = call.startsWith("route") ? "route" : "lazy";
    const reports = await diagnostics(`import {${name}} from "velar/web"\n\n@main:\n    print(${call})\n`, velarCompilerExtension);
    assert.equal(reports.length, 1, JSON.stringify(reports));
    assert.match(reports[0]!, /^Expected .*arguments but received /);
  }
});

test("a failed HttpProblem argument plan precedes its options migration", async () => {
  const wrong = 'import {HttpProblem} from "velar/serve"\n\n@main:\n    print(HttpProblem(problem={status: 404, code: "not_found", title: "Missing"}))\n';
  const reports = await diagnostics(wrong, velarNodeCompilerExtension);
  assert.deepEqual(reports, ["Unknown named argument 'problem'; missing required named argument: options"]);
  const contents = await diagnostics(wrong.replace("problem=", "options="), velarNodeCompilerExtension);
  assert.equal(contents.length, 1, JSON.stringify(contents));
  assert.match(contents[0]!, /takes its semantic problem code as 'reason'/);
  assert.deepEqual(await diagnostics(wrong.replace("problem=", "options=").replace('code: "not_found"', 'reason: "not_found"'), velarNodeCompilerExtension), []);
});

test("URL joins publish the same rest contract their positional calls implement", async () => {
  assert.deepEqual(await diagnostics('import {join} from "velar/url"\n\n@main:\n    print(join("https://a.dev", "a", "b"))\n', velarNodeCompilerExtension), []);
});
