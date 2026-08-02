import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { prepareExternalPreview } from "../scripts/prepare-external-preview.mjs";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));

test("publication rehearsal emits reproducible verified package identities without publishing", async () => {
  const temporary = await mkdtemp(join(tmpdir(), "velar-release-rehearsal-"));
  const first = join(temporary, "first");
  const second = join(temporary, "second");
  try {
    await runRelease(["rehearse", "--output-dir", first]);
    await runRelease(["verify", first]);
    await runRelease(["rehearse", "--output-dir", second]);
    const firstManifest = JSON.parse(await readFile(join(first, "velar-toolchain-release.json"), "utf8"));
    const secondManifest = JSON.parse(await readFile(join(second, "velar-toolchain-release.json"), "utf8"));
    assert.equal(firstManifest.version, "0.9.0-dev");
    assert.equal(firstManifest.mode, "rehearse");
    assert.equal(firstManifest.publish.performed, false);
    assert.equal(firstManifest.publish.publishable, false);
    assert.ok(firstManifest.publish.blockers.some((item: string) => item.includes("stable release version")));
    assert.ok(!firstManifest.publish.blockers.some((item: string) => item.includes("publishable license")));
    assert.deepEqual(
      firstManifest.packages.map((item: { name: string; version: string; sha256: string }) => ({ name: item.name, version: item.version, sha256: item.sha256 })),
      secondManifest.packages.map((item: { name: string; version: string; sha256: string }) => ({ name: item.name, version: item.version, sha256: item.sha256 })),
    );
    assert.equal(await readFile(join(first, "SHA256SUMS"), "utf8"), await readFile(join(second, "SHA256SUMS"), "utf8"));
    const candidate = await runRelease(["candidate", "--output-dir", join(temporary, "candidate")], true);
    assert.notEqual(candidate.code, 0);
    assert.match(candidate.stderr, /release candidate refused/u);

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
    assert.match(refusedDuplicate.stderr, /complete sorted toolchain set/u);

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
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

test("external preview preparation emits a reproducible root Netlify build", async () => {
  const temporary = await mkdtemp(join(tmpdir(), "velar-external-preview-"));
  const first = join(temporary, "first");
  const second = join(temporary, "second");
  try {
    const firstResult = await prepareExternalPreview(first);
    const secondResult = await prepareExternalPreview(second);
    assert.deepEqual(secondResult.manifest, firstResult.manifest);
    assert.equal(firstResult.manifest.sourceMaps, false);
    assert.ok(firstResult.manifest.assets.every((asset: { role: string }) => asset.role !== "source-map"));
    for (const asset of firstResult.manifest.assets) {
      assert.deepEqual(
        await readFile(join(first, asset.path)),
        await readFile(join(second, asset.path)),
        `non-reproducible external preview asset ${asset.path}`,
      );
    }
    const deployment = JSON.parse(await readFile(join(first, "velar-deploy.json"), "utf8"));
    assert.equal(deployment.base, "/");
    assert.deepEqual(deployment.adapter, { name: "netlify", files: ["_headers", "_redirects"] });
    assert.equal(
      await readFile(join(first, "_redirects"), "utf8"),
      "/assets/* /404.html 404\n/* /index.html 200\n",
    );
    const html = await readFile(join(first, "index.html"), "utf8");
    assert.match(html, /(?:src|href)="\/assets\//u);
    assert.doesNotMatch(html, /(?:src|href)="\/app\/assets\//u);
    assert.ok(firstResult.manifest.assets.some((asset) => asset.path === "share.svg" && asset.role === "asset"));

    const unsafe = join(temporary, "not-a-build");
    await mkdir(unsafe);
    await writeFile(join(unsafe, "keep.txt"), "keep\n", "utf8");
    await assert.rejects(prepareExternalPreview(unsafe), /refusing to replace/u);
    assert.equal(await readFile(join(unsafe, "keep.txt"), "utf8"), "keep\n");
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

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
