import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { cp, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { sourceHasExpectedTag } from "../scripts/release-toolchain.mjs";
import { velarWorkspaceBuildOrder } from "../scripts/velar-packages.mjs";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));

test("toolchain release identity accepts its exact tag when sibling package tags share HEAD", () => {
  assert.equal(sourceHasExpectedTag({ tag: null, tags: ["@velarscript/core@0.14.6", "v0.14.6"] }, "v0.14.6"), true);
  assert.equal(sourceHasExpectedTag({ tag: null, tags: ["@velarscript/core@0.14.6"] }, "v0.14.6"), false);
  assert.equal(sourceHasExpectedTag({ tag: "v0.14.6" }, "v0.14.6"), true);
});

test("publication rehearsal emits reproducible verified package identities without publishing", async () => {
  const temporary = await mkdtemp(join(tmpdir(), "velar-release-rehearsal-"));
  const workspaceOutputs = await protectWorkspaceOutputs("release");
  const first = join(temporary, "first");
  const second = join(temporary, "second");
  try {
    await runRelease(["rehearse", "--output-dir", first]);
    await runRelease(["verify", first]);
    await runRelease(["rehearse", "--output-dir", second]);
    const firstManifest = JSON.parse(await readFile(join(first, "velar-toolchain-release.json"), "utf8"));
    const secondManifest = JSON.parse(await readFile(join(second, "velar-toolchain-release.json"), "utf8"));
    assert.equal(firstManifest.version, "0.23.3");
    assert.equal(firstManifest.mode, "rehearse");
    assert.equal(firstManifest.publish.performed, false);
    assert.equal(firstManifest.publish.publishable, false);
    assert.ok(!firstManifest.publish.blockers.some((item: string) => item.includes("stable release version")));
    assert.ok(!firstManifest.publish.blockers.some((item: string) => item.includes("publishable license")));
    assert.deepEqual(firstManifest.packages.map((item: { name: string }) => item.name), [
      "@velarscript/cli",
      "@velarscript/compiler",
      "@velarscript/core",
      "@velarscript/desktop",
      "@velarscript/node",
      "@velarscript/server",
      "@velarscript/web",
      "create-velar",
    ]);
    assert.deepEqual(
      firstManifest.packages.map((item: { name: string; version: string; sha256: string }) => ({ name: item.name, version: item.version, sha256: item.sha256 })),
      secondManifest.packages.map((item: { name: string; version: string; sha256: string }) => ({ name: item.name, version: item.version, sha256: item.sha256 })),
    );
    assert.equal(await readFile(join(first, "SHA256SUMS"), "utf8"), await readFile(join(second, "SHA256SUMS"), "utf8"));
    const candidatePath = join(temporary, "candidate");
    const candidate = await runRelease(["candidate", "--output-dir", candidatePath], true);
    if (firstManifest.publish.blockers.length === 0) {
      assert.equal(candidate.code, 0, candidate.stderr);
      await runRelease(["verify", candidatePath]);
    } else {
      assert.notEqual(candidate.code, 0);
      assert.match(candidate.stderr, /release candidate refused/u);
    }

    const unrelated = join(temporary, "unrelated");
    await mkdir(unrelated);
    await writeFile(join(unrelated, "keep.txt"), "keep\n", "utf8");
    const refusedReplacement = await runRelease(["rehearse", "--output-dir", unrelated], true);
    assert.notEqual(refusedReplacement.code, 0);
    assert.match(refusedReplacement.stderr, /refusing to replace non-release directory/u);
    assert.equal(await readFile(join(unrelated, "keep.txt"), "utf8"), "keep\n");

    const duplicatePackages = join(temporary, "duplicate-packages");
    await cp(first, duplicatePackages, { recursive: true });
    const duplicateManifestPath = join(duplicatePackages, "velar-toolchain-release.json");
    const duplicateManifest = JSON.parse(await readFile(duplicateManifestPath, "utf8"));
    duplicateManifest.packages[1].name = duplicateManifest.packages[0].name;
    await writeFile(duplicateManifestPath, `${JSON.stringify(duplicateManifest, null, 2)}\n`, "utf8");
    const refusedDuplicate = await runRelease(["verify", duplicatePackages], true);
    assert.notEqual(refusedDuplicate.code, 0);
    assert.match(refusedDuplicate.stderr, /complete sorted release set/u);

    const traversingPackage = join(temporary, "traversing-package");
    await cp(first, traversingPackage, { recursive: true });
    const traversingManifestPath = join(traversingPackage, "velar-toolchain-release.json");
    const traversingManifest = JSON.parse(await readFile(traversingManifestPath, "utf8"));
    traversingManifest.packages[0].fileName = "../outside.tgz";
    await writeFile(traversingManifestPath, `${JSON.stringify(traversingManifest, null, 2)}\n`, "utf8");
    const refusedTraversal = await runRelease(["verify", traversingPackage], true);
    assert.notEqual(refusedTraversal.code, 0);
    assert.match(refusedTraversal.stderr, /package identity is invalid/u);

    const extraFile = join(temporary, "extra-file");
    await cp(first, extraFile, { recursive: true });
    await writeFile(join(extraFile, "unexpected.txt"), "unexpected\n", "utf8");
    const refusedExtra = await runRelease(["verify", extraFile], true);
    assert.notEqual(refusedExtra.code, 0);
    assert.match(refusedExtra.stderr, /must contain exactly/u);
    await workspaceOutputs.assertUntouched();
  } finally {
    await workspaceOutputs.dispose();
    await rm(temporary, { recursive: true, force: true });
  }
});

async function protectWorkspaceOutputs(label: string) {
  // Release tooling must work in isolation. Protect every compiled package.
  const built = await velarWorkspaceBuildOrder(root);
  const paths = built.map((package_) => join(package_.directory, "dist", `.workspace-${label}.sentinel`));
  // Recomputed by a second route — the manifests themselves — so that replacing
  // the derivation above with a literal list again fails here instead of
  // silently protecting fewer packages than the workspace has.
  const compiled = (await Promise.all((await readdir(join(root, "packages"), { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map(async ({ name }) => {
      let manifest: { private?: boolean; scripts?: Record<string, string> };
      try {
        manifest = JSON.parse(await readFile(join(root, "packages", name, "package.json"), "utf8"));
      } catch {
        return null;
      }
      return manifest.private === true || manifest.scripts?.build === undefined ? null : join("packages", name);
    })))
    .filter((name): name is string => name !== null)
    .map((name) => join(root, name, "dist", `.workspace-${label}.sentinel`));
  assert.deepEqual([...paths].sort(), compiled.sort(), "release tooling is not protected on every package that declares a build");
  const sourcePaths = [
    join(root, "packages", "compiler", "src", "analyzer.ts"),
    join(root, "packages", "web", "src", "analyzer.ts"),
    join(root, "packages", "cli", "src", "project.ts"),
  ];
  const sourceContents = new Map(await Promise.all(sourcePaths.map(async (path) => [path, await readFile(path)] as const)));
  const value = `workspace-owned-${label}\n`;
  for (const path of paths) {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, value, "utf8");
  }
  return {
    async assertUntouched() {
      for (const path of paths) assert.equal(await readFile(path, "utf8"), value, `release tooling replaced ${path}`);
      for (const [path, content] of sourceContents) {
        assert.deepEqual(await readFile(path), content, `release tooling modified active source ${path}`);
      }
    },
    async dispose() {
      await Promise.all(paths.map((path) => rm(path, { force: true })));
    },
  };
}

async function runRelease(arguments_: readonly string[], allowFailure = false): Promise<{ code: number | null; stdout: string; stderr: string }> {
  const child = spawn(process.execPath, ["scripts/release-toolchain.mjs", ...arguments_], {
    cwd: root,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk: Buffer) => { stdout += chunk.toString("utf8"); });
  child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString("utf8"); });
  const code = await new Promise<number | null>((resolvePromise, reject) => {
    child.once("error", reject);
    child.once("exit", resolvePromise);
  });
  if (code !== 0 && !allowFailure) throw new Error(`release command failed (${code})\n${stdout}\n${stderr}`);
  return { code, stdout, stderr };
}
