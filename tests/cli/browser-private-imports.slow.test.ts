/** Real Chromium plus source and built CLI application builds dominate this test. */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { access, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test, { after } from "node:test";
import { npmImportsBrowserProject, privateImportsBrowserProject } from "../support/private-imports-project.ts";
import { repositoryRoot } from "../support/repository-root.ts";
import { removeTemporaryDirectories } from "../support/temporary-directory.ts";

after(removeTemporaryDirectories);

test("Chromium test bodies and their built page preserve project and dependency private imports", {timeout: 120_000}, async () => {
  const root = await privateImportsBrowserProject();
  for (const location of ["src/cli.ts", "dist/cli.js"]) {
    const result = spawnSync(process.execPath, [join(repositoryRoot, "packages/cli", location), "test", root, "--browser=chromium"], {
      cwd: root, encoding: "utf8", timeout: 55_000, maxBuffer: 1024 * 1024,
    });
    assert.equal(result.status, 0, `${location}\n${result.stdout}\n${result.stderr}`);
    assert.match(result.stdout, /1 passed, 0 failed/u);
  }
  await assert.rejects(access(join(root, ".velar")), /ENOENT/u);
  for (const name of ["first", "second"]) await assert.rejects(access(join(root, "node_modules", name, ".velar")), /ENOENT/u);
});

for (const kind of ["bare", "alias"] as const) {
  test(`Chromium test bodies resolve ${kind} npm imports and preserve unrelated sandbox artifacts`, {timeout: 120_000}, async () => {
    const root = await npmImportsBrowserProject(kind);
    const artifact = join(root, ".velar", "keep.txt");
    await mkdir(join(root, ".velar"));
    await writeFile(artifact, "owned by the project");
    for (const location of ["src/cli.ts", "dist/cli.js"]) {
      const result = spawnSync(process.execPath, [join(repositoryRoot, "packages/cli", location), "test", root, "--browser=chromium"], {
        cwd: root, encoding: "utf8", timeout: 55_000, maxBuffer: 1024 * 1024,
      });
      assert.equal(result.status, 0, `${location}\n${result.stdout}\n${result.stderr}`);
      assert.match(result.stdout, /1 passed, 0 failed/u);
      assert.deepEqual(await readdir(join(root, ".velar")), ["keep.txt"]);
      assert.equal(await readFile(artifact, "utf8"), "owned by the project");
    }
    for (const name of ["first", "second"]) await assert.rejects(access(join(root, "node_modules", name, ".velar")), /ENOENT/u);
  });
}
