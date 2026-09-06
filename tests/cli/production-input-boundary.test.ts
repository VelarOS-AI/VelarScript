import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  mkdir,
  mkdtemp,
  lstat,
  readFile,
  rename,
  rm,
  symlink,
  truncate,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import {
  MAX_PRODUCTION_DIRECTORIES,
  MAX_PRODUCTION_DIRECTORY_DEPTH,
  MAX_PRODUCTION_MANIFEST_BYTES,
  MAX_PUBLIC_ASSET_BYTES,
  MAX_PUBLIC_ASSET_TOTAL_BYTES,
} from "../../packages/cli/src/bounded-directory-snapshot.ts";
import { verifyNodeProductionBuild } from "../../packages/cli/src/node-production-verifier.ts";
import { verifyProductionBuild } from "../../packages/cli/src/production-verifier.ts";
import { copyPublicAssets } from "../../packages/cli/src/static-deployment.ts";
import { repositoryRoot } from "../support/repository-root.ts";

const cli = join(repositoryRoot, "packages", "cli", "src", "cli.ts");
const webPackage = join(repositoryRoot, "packages", "web");

test("production verifiers reject oversized descriptor-bound manifests", async () => {
  const root = await mkdtemp(join(tmpdir(), "velar-production-manifest-boundary-"));
  try {
    const web = join(root, "web");
    const node = join(root, "node");
    await Promise.all([mkdir(web), mkdir(node)]);
    await Promise.all([
      writeFile(join(web, "velar-build.json"), "{}", "utf8"),
      writeFile(join(node, "velar-node.json"), "{}", "utf8"),
    ]);
    await Promise.all([
      truncate(join(web, "velar-build.json"), MAX_PRODUCTION_MANIFEST_BYTES + 1),
      truncate(join(node, "velar-node.json"), MAX_PRODUCTION_MANIFEST_BYTES + 1),
    ]);
    await assert.rejects(verifyProductionBuild(web), /production build manifest.*exceeds/u);
    await assert.rejects(verifyNodeProductionBuild(node), /Node production build manifest.*exceeds/u);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("public assets reject an oversized ordinary file before creating output", async () => {
  const root = await mkdtemp(join(tmpdir(), "velar-public-file-boundary-"));
  try {
    const publicRoot = join(root, "public");
    const output = join(root, "output");
    await mkdir(publicRoot);
    await writeFile(join(publicRoot, "oversized.bin"), "", "utf8");
    await truncate(join(publicRoot, "oversized.bin"), MAX_PUBLIC_ASSET_BYTES + 1);
    await assert.rejects(copyPublicAssets(publicRoot, output), /oversized\.bin.*exceeds/u);
    await assert.rejects(readFile(join(output, "oversized.bin")), /ENOENT/u);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("public assets reject a tree whose individually bounded files exceed the total byte budget", async () => {
  const root = await mkdtemp(join(tmpdir(), "velar-public-total-boundary-"));
  try {
    const publicRoot = join(root, "public");
    await mkdir(publicRoot);
    const files = Math.floor(MAX_PUBLIC_ASSET_TOTAL_BYTES / MAX_PUBLIC_ASSET_BYTES) + 1;
    for (let index = 0; index < files; index += 1) {
      const path = join(publicRoot, `${index}.bin`);
      await writeFile(path, "", "utf8");
      await truncate(path, MAX_PUBLIC_ASSET_BYTES);
    }
    await assert.rejects(
      copyPublicAssets(publicRoot, join(root, "output")),
      new RegExp(`exceeds ${MAX_PUBLIC_ASSET_TOTAL_BYTES} total file bytes`, "u"),
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("public asset traversal bounds wide empty directory trees", async () => {
  const root = await mkdtemp(join(tmpdir(), "velar-public-wide-boundary-"));
  try {
    const publicRoot = join(root, "public");
    const wide = join(publicRoot, "wide");
    await mkdir(wide, { recursive: true });
    await writeFile(join(publicRoot, "velar-build.json"), "{}", "utf8");
    for (let start = 0; start < MAX_PRODUCTION_DIRECTORIES; start += 128) {
      await Promise.all(Array.from(
        { length: Math.min(128, MAX_PRODUCTION_DIRECTORIES - start) },
        (_, offset) => mkdir(join(wide, String(start + offset).padStart(5, "0"))),
      ));
    }
    const expected = new RegExp(`cannot contain more than ${MAX_PRODUCTION_DIRECTORIES} directories`, "u");
    await assert.rejects(verifyProductionBuild(publicRoot), expected);
    await assert.rejects(copyPublicAssets(publicRoot, join(root, "output")), expected);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("public asset traversal bounds deeply nested empty directories", async () => {
  const root = await mkdtemp(join(tmpdir(), "velar-public-depth-boundary-"));
  try {
    const publicRoot = join(root, "public");
    const segments = Array.from({ length: MAX_PRODUCTION_DIRECTORY_DEPTH + 1 }, (_, index) => `d${index}`);
    await mkdir(join(publicRoot, ...segments), { recursive: true });
    await writeFile(join(publicRoot, "velar-node.json"), "{}", "utf8");
    const expected = new RegExp(`cannot exceed ${MAX_PRODUCTION_DIRECTORY_DEPTH} nested directories`, "u");
    await assert.rejects(verifyNodeProductionBuild(publicRoot), expected);
    await assert.rejects(copyPublicAssets(publicRoot, join(root, "output")), expected);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("public asset copy refuses a source path replaced after inventory and copies no outside bytes", async () => {
  const root = await mkdtemp(join(tmpdir(), "velar-public-swap-boundary-"));
  try {
    const publicRoot = join(root, "public");
    const output = join(root, "output");
    const asset = join(publicRoot, "textures", "grass.bin");
    const original = join(root, "original.bin");
    const outside = join(root, "outside.bin");
    await mkdir(dirname(asset), { recursive: true });
    await writeFile(asset, "owned texture\n", "utf8");
    await writeFile(outside, "outside secret\n", "utf8");
    let replaced = false;
    await assert.rejects(copyPublicAssets(publicRoot, output, false, {
      beforeFileCopy: async (path) => {
        if (path !== "textures/grass.bin" || replaced) return;
        replaced = true;
        await rename(asset, original);
        await symlink(outside, asset);
      },
    }), /changed physical identity/u);
    assert.equal(replaced, true);
    await assert.rejects(readFile(join(output, "textures", "grass.bin")), /ENOENT/u);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("production verification refuses a FIFO replacement before descriptor-bound hashing without blocking", {
  skip: process.platform === "win32",
}, async () => {
  const root = await mkdtemp(join(tmpdir(), "velar-production-asset-swap-"));
  try {
    await writeWebProject(root);
    const built = spawnSync(process.execPath, [cli, "build"], { cwd: root, encoding: "utf8", timeout: 300_000 });
    assert.equal(built.status, 0, String(built.stdout) + String(built.stderr));
    const output = join(root, "dist");
    const manifest = JSON.parse(await readFile(join(output, "velar-build.json"), "utf8")) as { entry: string };
    const entry = join(output, manifest.entry);
    const original = join(root, "entry-original.js");
    let replaced = false;
    await assert.rejects(verifyProductionBuild(output, process.cwd(), {
      beforeAssetVerification: async (path) => {
        if (path !== manifest.entry || replaced) return;
        replaced = true;
        await rename(entry, original);
        const fifo = spawnSync("mkfifo", [entry], { encoding: "utf8" });
        assert.equal(fifo.status, 0, String(fifo.stderr));
      },
    }), /changed physical identity/u);
    assert.equal(replaced, true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("bounded public asset copying preserves nested files and empty directories", async () => {
  const root = await mkdtemp(join(tmpdir(), "velar-public-valid-boundary-"));
  try {
    const publicRoot = join(root, "public");
    const output = join(root, "output");
    await mkdir(join(publicRoot, "empty"), { recursive: true });
    await mkdir(join(publicRoot, "textures"), { recursive: true });
    await writeFile(join(publicRoot, "textures", "stone.bin"), "stone\n", "utf8");
    await copyPublicAssets(publicRoot, output);
    assert.equal(await readFile(join(output, "textures", "stone.bin"), "utf8"), "stone\n");
    assert.equal((await lstat(join(output, "empty"))).isDirectory(), true);
    await copyPublicAssets(join(root, "absent"), join(root, "absent-output"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

async function writeWebProject(root: string): Promise<void> {
  const scope = join(root, "node_modules", "@velarscript");
  await mkdir(join(root, "src"), { recursive: true });
  await mkdir(scope, { recursive: true });
  await symlink(webPackage, join(scope, "web"), "dir");
  await writeFile(
    join(root, "src", "main.vel"),
    "component App:\n    return <main>Verified</main>\n\n@main: mount(<App />, \"#app\")\n",
    "utf8",
  );
  await writeFile(join(root, "velar.json"), `${JSON.stringify({
    formatVersion: 2,
    kind: "application",
    entry: "src/main.vel",
    outDir: "dist",
    extensions: ["@velarscript/web"],
    web: { base: "/", deployment: { spaFallback: true } },
  }, null, 2)}\n`, "utf8");
}
