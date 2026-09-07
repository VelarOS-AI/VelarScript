import assert from "node:assert/strict";
import { join } from "node:path";
import test from "node:test";
import { tmpdir } from "node:os";
import { compileProject } from "../../packages/cli/src/project.ts";
import { velarNodeCompilerExtension, velarProjectExtension } from "@velarscript/node/compiler";

/**
 * D115 §三 — one subject per file, split out of the 1,012-line
 * `node-server-framework.test.ts`. Every test here is the one that was there,
 * moved verbatim.
 *
 * The subject is the boundary of a Node application as a project: the `node`
 * block a `velar.json` may declare, and the module census that keeps
 * `velar/server-test` inside test modules.
 */

test("Node application configuration is bounded and rejects unknown fields", () => {
  assert.deepEqual(velarProjectExtension.parse(undefined, "/service/velar.json"), {});
  assert.throws(() => velarProjectExtension.parse({port: 3000}, "/service/velar.json"), /unknown 'node' field 'port'/u);
  assert.throws(() => velarProjectExtension.parse({host: "127.0.0.1"}, "/service/velar.json"), /unknown 'node' field 'host'/u);
  assert.throws(() => velarProjectExtension.parse({maxBodyBytes: 16_777_216}, "/service/velar.json"), /unknown 'node' field 'maxBodyBytes'/u);
  assert.throws(() => velarProjectExtension.parse({workers: 4}, "/service/velar.json"), /unknown 'node' field 'workers'/u);
});

test("velar/server-test is available only to test modules", async () => {
  const root = join(tmpdir(), "velar-node-server-test-boundary");
  const application = join(root, "app.vel");
  const forbidden = await compileProject(application, new Map([[application, `import {client} from "velar/server-test"\nconst value = client\n`]]), {extensions: [velarNodeCompilerExtension]});
  assert.ok(forbidden.modules.flatMap((module) => module.result.diagnostics).some((item) => /only from a '\*\.test\.vel' module/u.test(item.message)));

  const testPath = join(root, "app.test.vel");
  const allowed = await compileProject(testPath, new Map([[testPath, `
import {client} from "velar/server-test"
import {ServeApp} from "velar/serve"

async def open(app: ServeApp):
    const testClient = await client(app)
    await testClient.close()
`.trimStart()]]), {extensions: [velarNodeCompilerExtension]});
  assert.deepEqual(allowed.failures, []);
  assert.deepEqual(allowed.modules.flatMap((module) => module.result.diagnostics), []);
});
