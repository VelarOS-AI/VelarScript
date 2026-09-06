import assert from "node:assert/strict";
import { lstat, mkdir, readFile, realpath, rename, symlink, truncate, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import test, { after } from "node:test";
import {
  MAX_LIBRARY_PACKAGE_MANIFEST_BYTES,
  readVelarLibraryPackageManifestSource,
} from "../packages/cli/src/library-artifact-build.ts";
import {
  MAX_JSON_RESOURCE_BYTES,
  readProjectJsonResource,
} from "../packages/cli/src/project.ts";
import {
  MAX_VELAR_SOURCE_BYTES,
  readVelarSourceFileSnapshot,
} from "../packages/cli/src/source-limits.ts";
import { makeTemporaryDirectory, removeTemporaryDirectories } from "./temporary-directory.ts";

after(removeTemporaryDirectories);

interface BoundedInputCase {
  readonly name: string;
  readonly relativePath: string;
  readonly maximumBytes: number;
  readonly source: string;
  readonly read: (
    path: string,
    root: string,
    afterPathInspection?: () => Promise<void>,
  ) => Promise<unknown>;
}

const boundedInputs: readonly BoundedInputCase[] = [
  {
    name: "JSON resource",
    relativePath: "data/config.json",
    maximumBytes: MAX_JSON_RESOURCE_BYTES,
    source: "{}\n",
    read: (path, root, afterPathInspection) => readProjectJsonResource(
      path,
      root,
      "./data/config.json",
      undefined,
      {...(afterPathInspection ? {afterPathInspection} : {})},
    ),
  },
  {
    name: "VelarScript source",
    relativePath: "src/main.vel",
    maximumBytes: MAX_VELAR_SOURCE_BYTES,
    source: "print(1)\n",
    read: (path, _root, afterPathInspection) => readVelarSourceFileSnapshot(
      path,
      {...(afterPathInspection ? {afterPathInspection} : {})},
    ),
  },
  {
    name: "library package manifest",
    relativePath: "package.json",
    maximumBytes: MAX_LIBRARY_PACKAGE_MANIFEST_BYTES,
    source: "{}\n",
    read: (path, _root, afterPathInspection) => readVelarLibraryPackageManifestSource(
      path,
      {...(afterPathInspection ? {afterPathInspection} : {})},
    ),
  },
];

test("project input readers stop at their byte contracts without changing evidence", async () => {
  for (const input of boundedInputs) {
    const root = await makeTemporaryDirectory("velar-project-input-limit-");
    const path = join(root, input.relativePath);
    const sentinel = join(root, "existing-output.txt");
    await mkdir(dirname(path), {recursive: true});
    await writeFile(path, "x", "utf8");
    await truncate(path, input.maximumBytes + 1);
    await writeFile(sentinel, "preserve output\n", "utf8");
    await assert.rejects(input.read(path, root), (error: unknown) => {
      assert.ok(error instanceof RangeError, `${input.name} must reject with its byte contract`);
      assert.match(error.message, /exceeds/u);
      return true;
    });
    assert.equal((await lstat(path)).size, input.maximumBytes + 1);
    assert.equal(await readFile(sentinel, "utf8"), "preserve output\n");
  }
});

test("project input readers reject a pathname replacement and preserve both byte sources", async () => {
  for (const input of boundedInputs) {
    const root = await makeTemporaryDirectory("velar-project-input-swap-");
    const path = join(root, input.relativePath);
    const preserved = `${path}.preserved`;
    const outside = join(root, "outside", "secret.txt");
    await mkdir(dirname(path), {recursive: true});
    await mkdir(dirname(outside), {recursive: true});
    await writeFile(path, input.source, "utf8");
    await writeFile(outside, "secret\n", "utf8");
    await assert.rejects(input.read(path, root, async () => {
      await rename(path, preserved);
      await symlink(outside, path);
    }), /changed physical identity|changed its canonical source identity/u);
    assert.equal(await readFile(preserved, "utf8"), input.source);
    assert.equal(await readFile(outside, "utf8"), "secret\n");
  }
});

test("source and library readers preserve intentional symlinks while resources reject them", async () => {
  const root = await makeTemporaryDirectory("velar-project-input-symlink-");
  const target = join(root, "shared", "input.txt");
  const sourceLink = join(root, "src", "main.vel");
  const manifestLink = join(root, "package.json");
  const resourceLink = join(root, "data.json");
  await mkdir(dirname(target), {recursive: true});
  await mkdir(dirname(sourceLink), {recursive: true});
  await writeFile(target, "print(1)\n", "utf8");
  await Promise.all([
    symlink(target, sourceLink),
    symlink(target, manifestLink),
    symlink(target, resourceLink),
  ]);
  assert.equal((await readVelarSourceFileSnapshot(sourceLink, {
    expectedCanonicalPath: await realpath(target),
  })).text, "print(1)\n");
  assert.equal(await readVelarLibraryPackageManifestSource(manifestLink), "print(1)\n");
  await assert.rejects(
    readProjectJsonResource(resourceLink, root, "./data.json"),
    /must be an ordinary file, not a symbolic link/u,
  );
});

test("project authorization stays bound to the canonical source and resource targets", async () => {
  const root = await makeTemporaryDirectory("velar-project-input-boundary-");
  const outsideRoot = await makeTemporaryDirectory("velar-project-input-outside-");
  const source = join(root, "src", "main.vel");
  const originalSource = `${source}.original`;
  const outsideSource = join(outsideRoot, "outside.vel");
  await mkdir(dirname(source), {recursive: true});
  await writeFile(source, "print(1)\n", "utf8");
  const authorizedSource = await realpath(source);
  await writeFile(outsideSource, "print(2)\n", "utf8");
  await rename(source, originalSource);
  await symlink(outsideSource, source);
  await assert.rejects(
    readVelarSourceFileSnapshot(source, {expectedCanonicalPath: authorizedSource}),
    /changed its canonical source identity/u,
  );

  const outsideResource = join(outsideRoot, "data.json");
  const linkedDirectory = join(root, "linked");
  await writeFile(outsideResource, "{}\n", "utf8");
  await symlink(outsideRoot, linkedDirectory);
  await assert.rejects(
    readProjectJsonResource(join(linkedDirectory, "data.json"), root, "./linked/data.json"),
    /cannot escape .* through a symbolic link/u,
  );
  assert.equal(await readFile(originalSource, "utf8"), "print(1)\n");
  assert.equal(await readFile(outsideResource, "utf8"), "{}\n");
});
