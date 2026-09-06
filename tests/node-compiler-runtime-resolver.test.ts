import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import test, { after } from "node:test";
import type { LoadedVelarLibraryArtifact } from "../packages/cli/src/library-artifact.ts";
import type { VelarLibraryArtifactJavaScriptSnapshot } from "../packages/cli/src/library-artifact-snapshot.ts";
import { writeNodeCompilerRuntimeResolverBootstrap } from "../packages/cli/src/node-compiler-runtime-resolver.ts";
import { makeTemporaryDirectory, removeTemporaryDirectories } from "./temporary-directory.ts";

after(removeTemporaryDirectories);

test("the Node resolver serves authenticated entry and chunk snapshots without reopening their paths", async () => {
  const root = await makeTemporaryDirectory("velar-artifact-exact-loader-");
  const artifactRoot = join(root, "installed", "dist");
  const sandbox = join(root, "sandbox");
  await mkdir(artifactRoot, { recursive: true });
  await mkdir(sandbox, { recursive: true });
  const entry = snapshot(
    join(artifactRoot, "index.js"),
    'import {value} from "./chunk.js";\nexport {value};\n',
  );
  const chunk = snapshot(join(artifactRoot, "chunk.js"), 'export const value = "authenticated";\n');
  await Promise.all([
    writeFile(entry.path, entry.code, "utf8"),
    writeFile(chunk.path, chunk.code, "utf8"),
  ]);
  const artifact = {
    entrySnapshot: entry,
    entrySnapshots: [entry],
    chunkSnapshots: [chunk],
  } as unknown as LoadedVelarLibraryArtifact;
  const bootstrap = await writeNodeCompilerRuntimeResolverBootstrap(sandbox, new Set(), [artifact]);
  const launcher = join(sandbox, "launcher.mjs");
  await writeFile(launcher, [
    `import {value} from ${JSON.stringify(pathToFileURL(entry.path).href)};`,
    "console.log(value);",
    "",
  ].join("\n"), "utf8");
  await rm(join(root, "installed"), { recursive: true, force: true });

  const executed = spawnSync(process.execPath, ["--import", bootstrap, launcher], {
    cwd: root,
    encoding: "utf8",
  });
  assert.equal(executed.status, 0, executed.stderr);
  assert.equal(executed.stdout, "authenticated\n");
});

function snapshot(path: string, code: string): VelarLibraryArtifactJavaScriptSnapshot {
  return {
    path,
    code,
    sourceMapPath: `${path}.map`,
    sourceMap: `${JSON.stringify({ version: 3, sources: [], names: [], mappings: "" })}\n`,
  };
}
