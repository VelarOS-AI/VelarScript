import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { withDocumentationFiles } from "../../scripts/documentation-example-files.mjs";
import { repositoryRoot } from "../support/repository-root.ts";

test("documentation resource fixtures are isolated and cleaned after success or failure", async () => {
  let previous = "";
  const preamble = '// velar-file data/value.json {"count":1}\n// velar-file theme.css "body {}"';
  for (const fail of [false, true]) {
    let owned = "";
    const operation = withDocumentationFiles(repositoryRoot, preamble, [], async (directory) => {
      owned = directory;
      assert.notEqual(directory, repositoryRoot);
      assert.notEqual(directory, previous);
      assert.deepEqual(JSON.parse(await readFile(join(directory, "data/value.json"), "utf8")), {count: 1});
      assert.equal(await readFile(join(directory, "theme.css"), "utf8"), "body {}");
      if (fail) throw new Error("example failed");
      return 42;
    });
    if (fail) await assert.rejects(operation, /example failed/u);
    else assert.equal(await operation, 42);
    await assert.rejects(stat(owned), {code: "ENOENT"});
    previous = owned;
  }
});

test("documentation resource declarations reject escaping paths and conflicting context", async () => {
  let invoked = false;
  const run = async () => { invoked = true; };
  for (const path of ["../escape", "/escape", "a/../escape", "a//file", "./file", "C:/file", "a\\file"]) {
    await assert.rejects(withDocumentationFiles(repositoryRoot, `// velar-file ${path} {}`, [], run), /inside its example directory/u);
  }
  await assert.rejects(withDocumentationFiles(repositoryRoot, "// velar-file data.json invalid", [], run), /valid JSON/u);
  await assert.rejects(withDocumentationFiles(repositoryRoot, "// velar-file data.json {}\n// velar-file data.json {}", [], run), /repeats example path/u);
  await assert.rejects(withDocumentationFiles(repositoryRoot, "// velar-file main.vel {}", ["main.vel"], run), /repeats example path/u);
  await assert.rejects(withDocumentationFiles(repositoryRoot, "// velar-file app.vel {}", ["./app.vel"], run), /repeats example path/u);
  await assert.rejects(withDocumentationFiles(repositoryRoot, "// velar-file pages/app.vel {}", ["./pages/./app.vel"], run), /repeats example path/u);
  await assert.rejects(withDocumentationFiles(repositoryRoot, "// velar-file pages {}", ["./pages/app.vel"], run), /conflicts with example path/u);
  await assert.rejects(withDocumentationFiles(repositoryRoot, "// velar-file app.vel/data.json {}", ["./app.vel"], run), /conflicts with example path/u);
  await assert.rejects(withDocumentationFiles(repositoryRoot, "// velar-file missing-value", [], run), /relative path and one JSON value/u);
  assert.equal(invoked, false);
});

test("a declared package JSON resource is fully compiled and downstream errors stay visible", async () => {
  const directory = await mkdtemp(join(tmpdir(), "velar-documentation-file-test-"));
  const document = join(directory, "resource.md");
  const source = [
    "<!-- velar-preamble",
    '// velar-file node_modules/catalog-package/package.json {"name":"catalog-package","version":"1.0.0","exports":{"./catalog":"./catalog.json"},"velar":{"entry":"index.vel","targets":["core"],"requires":{"capabilities":[]},"resources":{"./catalog":{"path":"catalog.json","type":"json"}}}}',
    '// velar-file node_modules/catalog-package/index.vel "export const title = 1"',
    '// velar-file node_modules/catalog-package/catalog.json {"count":1}',
    "-->",
    "```velar fragment",
    'import json rawCatalog from "catalog-package/catalog"',
    "type Catalog:",
    "    count: number",
    "const catalog = Catalog.parse(rawCatalog)",
    "print(catalog.count)",
    "```",
  ].join("\n");
  const run = () => spawnSync(process.execPath, ["scripts/check-documentation-examples.mjs", document], {cwd: repositoryRoot, encoding: "utf8"});
  try {
    await writeFile(document, source);
    const valid = run();
    assert.equal(valid.status, 0, valid.stdout + valid.stderr);
    assert.match(valid.stdout, /all 1 fragments were checked in full/u);
    await writeFile(document, source.replace("print(catalog.count)", "const wrong: string = catalog.count"));
    const invalid = run();
    assert.equal(invalid.status, 1, invalid.stdout + invalid.stderr);
    assert.match(invalid.stderr, /Cannot assign number to string/u);
    assert.doesNotMatch(invalid.stdout, /suppressed/u);
  } finally {
    await rm(directory, {recursive: true, force: true});
  }
});
