import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { velarNodeCompilerExtension } from "@velarscript/node/compiler";
import { velarCompilerExtension as serverExtension } from "@velarscript/server/compiler";
import { velarCompilerExtension as webExtension } from "@velarscript/web/compiler";
import { exampleExtensions } from "../../scripts/documentation-fence-language.mjs";
import { repositoryRoot } from "../support/repository-root.ts";

test("documentation imports select the owner of the requested host API", () => {
  assert.deepEqual(exampleExtensions('import {readText} from "velar/fs"', "example.md"), [velarNodeCompilerExtension]);
  assert.deepEqual(exampleExtensions('import {secretHeader} from "velar/http"', "example.md"), [velarNodeCompilerExtension]);
  assert.deepEqual(exampleExtensions('import {RealtimePeer} from "velar/realtime"', "example.md"), [serverExtension]);
  assert.deepEqual(exampleExtensions('import {mount} from "velar/web"', "example.md"), [webExtension]);
});

test("documentation compilation sees the language extension required by a sibling module", async () => {
  const directory = await mkdtemp(join(tmpdir(), "velar-doc-sibling-language-"));
  const document = join(directory, "example.md");
  try {
    await writeFile(document, [
      "<!-- velar-preamble",
      "// velar-module ./routes.vel",
      "export server routes:",
      '    @get health(p"/health") => {ok: true}',
      "-->",
      "```velar fragment",
      'import {routes} from "./routes.vel"',
      'import {run, serve} from "velar/serve"',
      "@main:",
      "    const listener = await serve(routes, port=3000)",
      "    await run(listener)",
      "```",
    ].join("\n"));
    const result = spawnSync(process.execPath, ["scripts/check-documentation-examples.mjs", document], {cwd: repositoryRoot, encoding: "utf8"});
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stdout, /all 1 fragments were checked in full/u);
  } finally {
    await rm(directory, {recursive: true, force: true});
  }
});
