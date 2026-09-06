import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { lstat, mkdir, mkdtemp, readFile, realpath, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  acquireBuildOutputClaim,
  acquireBuildOutputClaims,
  buildOutputComparisonPath,
} from "../../packages/cli/src/build-output-claim.ts";
import { directoryRemovalPath } from "../../packages/cli/src/build-output-directory-removal.ts";
import {
  prepareClaimedBuildStaging,
  recoverInterruptedBuilds,
  replaceOutputDirectory,
  reserveBuildStaging,
  validateBuildOutputTarget,
} from "../../packages/cli/src/build-output-directory.ts";

const workspaceRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const claimModuleUrl = pathToFileURL(
  join(workspaceRoot, "packages", "cli", "src", "build-output-claim.ts"),
).href;
const portableAliases = [
  ["ß", "SS"],
  ["Σ", "ς"],
  ["ſ", "s"],
  ["é", "e\u0301"],
  ["A", "a"],
] as const;

async function temporaryRoot(name: string): Promise<string> {
  return mkdtemp(join(tmpdir(), `${name}-`));
}

async function write(path: string, contents: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, contents, "utf8");
}

async function runIsolatedClaimScript(name: string, body: string): Promise<void> {
  const sandbox = await temporaryRoot(name);
  try {
    const script = [
      'import assert from "node:assert/strict";',
      'import { lstat, mkdir, readFile, readdir, realpath, rename, unlink, writeFile } from "node:fs/promises";',
      'import { join } from "node:path";',
      `const claims = await import(${JSON.stringify(claimModuleUrl)});`,
      `const sandbox = ${JSON.stringify(sandbox)};`,
      body,
    ].join("\n");
    const executed = spawnSync(process.execPath, ["--input-type=module", "--eval", script], {
      cwd: workspaceRoot,
      encoding: "utf8",
      env: { ...process.env, TMPDIR: sandbox, TMP: sandbox, TEMP: sandbox },
      timeout: 120_000,
    });
    assert.equal(executed.status, 0, `${String(executed.stdout)}${String(executed.stderr)}`);
  } finally {
    await rm(sandbox, { recursive: true, force: true });
  }
}

test("portable Unicode folding joins filesystem aliases without transliteration", async () => {
  const root = await temporaryRoot("velar-unicode-output-alias");
  try {
    for (const [index, [left, right]] of portableAliases.entries()) {
      const leftPath = join(root, `pair-${index}`, left);
      const rightPath = join(root, `pair-${index}`, right);
      assert.equal(buildOutputComparisonPath(leftPath), buildOutputComparisonPath(rightPath));
      const lease = await acquireBuildOutputClaim(leftPath, "file");
      try {
        await assert.rejects(acquireBuildOutputClaim(rightPath, "file"), /overlaps active file output/u);
      } finally {
        await lease.release();
      }
    }
    for (const [left, right] of [["é", "e"], ["ø", "o"], ["æ", "ae"]] as const) {
      assert.notEqual(
        buildOutputComparisonPath(join(root, left)),
        buildOutputComparisonPath(join(root, right)),
      );
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Darwin filesystem confirms the folded aliases share physical identity", {
  skip: process.platform !== "darwin",
}, async () => {
  const root = await temporaryRoot("velar-darwin-output-alias");
  try {
    for (const [index, [left, right]] of portableAliases.entries()) {
      const directory = join(root, `pair-${index}`);
      await mkdir(directory);
      const stored = join(directory, left);
      const alias = join(directory, right);
      await writeFile(stored, "filesystem alias\n", "utf8");
      const [storedMetadata, aliasMetadata] = await Promise.all([lstat(stored), lstat(alias)]);
      assert.equal(aliasMetadata.dev, storedMetadata.dev);
      assert.equal(aliasMetadata.ino, storedMetadata.ino);
      assert.equal(await realpath(alias), await realpath(stored));
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("file claims conflict across ancestor paths in both directions", async () => {
  const root = await temporaryRoot("velar-file-ancestor-claims");
  const parent = join(root, "dist");
  const child = join(parent, "bundle.js");
  try {
    const parentLease = await acquireBuildOutputClaim(parent, "file");
    try {
      await assert.rejects(acquireBuildOutputClaim(child, "file"), /overlaps active file output/u);
    } finally {
      await parentLease.release();
    }
    const childLease = await acquireBuildOutputClaim(child, "file");
    try {
      await assert.rejects(acquireBuildOutputClaim(parent, "file"), /overlaps active file output/u);
    } finally {
      await childLease.release();
    }
    await assert.rejects(acquireBuildOutputClaims([
      { path: parent, kind: "file" },
      { path: child, kind: "file" },
    ]), /overlaps requested file output .* in the same build/u);
    await assert.rejects(acquireBuildOutputClaims([
      { path: child, kind: "file" },
      { path: parent, kind: "file" },
    ]), /overlaps requested file output .* in the same build/u);
    const tree = await acquireBuildOutputClaims([
      { path: child, kind: "file" },
      { path: parent, kind: "tree" },
    ]);
    await tree.release();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("renaming and replacing the registry cannot hide an active claim", async () => {
  await runIsolatedClaimScript("velar-registry-swap", `
const output = join(sandbox, "dist", "main.js");
await claims.acquireBuildOutputClaim(output, "file");
const registry = claims.buildOutputClaimRegistryPath();
const hidden = \`${"${registry}"}.hidden\`;
await rename(registry, hidden);
await mkdir(registry);
await assert.rejects(
  claims.acquireBuildOutputClaim(output, "file"),
  /physical identity|bound physical identity/u,
);
const hiddenClaims = (await readdir(hidden)).filter((name) => /^claim-.*\\.json$/u.test(name));
const replacementClaims = (await readdir(registry)).filter((name) => /^claim-.*\\.json$/u.test(name));
assert.equal(hiddenClaims.length, 1);
assert.equal(replacementClaims.length, 0);
`);
});

test("a missing held claim does not retain the other unchanged claims", async () => {
  await runIsolatedClaimScript("velar-partial-claim-release", `
const canonicalRoot = await realpath(sandbox);
const outputs = [join(canonicalRoot, "one.js"), join(canonicalRoot, "two.js")];
const lease = await claims.acquireBuildOutputClaims(outputs.map((path) => ({ path, kind: "file" })));
const registry = claims.buildOutputClaimRegistryPath();
const entries = (await readdir(registry)).filter((name) => /^claim-.*\\.json$/u.test(name));
const byOutput = new Map();
for (const name of entries) {
  const path = join(registry, name);
  byOutput.set(JSON.parse(await readFile(path, "utf8")).outputPath, path);
}
await unlink(byOutput.get(outputs[0]));
await assert.rejects(lease.release(), /claims changed before they could be released/u);
await assert.rejects(lstat(byOutput.get(outputs[1])), (error) => error?.code === "ENOENT");
const retry = await claims.acquireBuildOutputClaims(outputs.map((path) => ({ path, kind: "file" })));
await retry.release();
await lease.release();
`);
});

test("a tampered claim is quarantined while unchanged claims are released", async () => {
  await runIsolatedClaimScript("velar-tampered-claim-release", `
const canonicalRoot = await realpath(sandbox);
const outputs = [join(canonicalRoot, "one.js"), join(canonicalRoot, "two.js")];
const lease = await claims.acquireBuildOutputClaims(outputs.map((path) => ({ path, kind: "file" })));
const registry = claims.buildOutputClaimRegistryPath();
const entries = (await readdir(registry)).filter((name) => /^claim-.*\\.json$/u.test(name));
const byOutput = new Map();
for (const name of entries) {
  const path = join(registry, name);
  byOutput.set(JSON.parse(await readFile(path, "utf8")).outputPath, path);
}
const changedPath = byOutput.get(outputs[0]);
const unchangedPath = byOutput.get(outputs[1]);
const record = JSON.parse(await readFile(changedPath, "utf8"));
record.untrusted = true;
const changedContents = \`${"${JSON.stringify(record)}"}\\n\`;
const before = await lstat(changedPath);
await writeFile(changedPath, changedContents, "utf8");
const after = await lstat(changedPath);
assert.equal(after.dev, before.dev);
assert.equal(after.ino, before.ino);
await assert.rejects(lease.release(), /claims changed before they could be released/u);
await assert.rejects(lstat(unchangedPath), (error) => error?.code === "ENOENT");
await assert.rejects(lstat(changedPath), (error) => error?.code === "ENOENT");
const preserved = [];
for (const name of await readdir(registry)) {
  const path = join(registry, name);
  try {
    if (await readFile(path, "utf8") === changedContents) preserved.push(path);
  } catch {}
}
assert.equal(preserved.length, 1);
assert.equal((await lstat(preserved[0])).ino, before.ino);
assert.doesNotMatch(preserved[0], /claim-[0-9a-f-]+\\.json$/u);
const retry = await claims.acquireBuildOutputClaims(outputs.map((path) => ({ path, kind: "file" })));
await retry.release();
await lease.release();
assert.equal(await readFile(preserved[0], "utf8"), changedContents);
`);
});

test("directory cleanup restores an author tree swapped at the removal boundary", async () => {
  const root = await temporaryRoot("velar-directory-removal-swap");
  const output = join(root, "dist");
  const displaced = join(root, "displaced-previous");
  await write(join(output, "old.txt"), "old output\n");
  const reserved = await reserveBuildStaging(output);
  const prepared = await prepareClaimedBuildStaging(
    reserved,
    await validateBuildOutputTarget(output, async () => {}),
  );
  const previous = `${prepared.directory}-previous`;
  let attacked = false;
  let removed = false;
  try {
    await write(join(prepared.directory, "main.js"), "new output\n");
    await replaceOutputDirectory(prepared, {
      renamePath: async (source, destination) => {
        if (!attacked && source === previous && destination === directoryRemovalPath(previous)) {
          attacked = true;
          await rename(source, displaced);
          await write(join(source, "author.txt"), "later author directory\n");
        }
        await rename(source, destination);
      },
      removePath: async (path, options) => {
        removed = true;
        await rm(path, options);
      },
    });
    assert.equal(attacked, true);
    assert.equal(removed, false);
    assert.equal(await readFile(join(output, "main.js"), "utf8"), "new output\n");
    assert.equal(await readFile(join(previous, "author.txt"), "utf8"), "later author directory\n");
    assert.equal(await readFile(join(displaced, "old.txt"), "utf8"), "old output\n");
    await assert.rejects(lstat(directoryRemovalPath(previous)), (error: unknown) => isErrorCode(error, "ENOENT"));
  } finally {
    await prepared.claim.release().catch(() => {});
    await rm(root, { recursive: true, force: true });
  }
});

test("recovery resumes an interrupted staging removal from its claimed isolation", async () => {
  const root = await temporaryRoot("velar-directory-removal-resume");
  const output = join(root, "dist");
  const reserved = await reserveBuildStaging(output);
  const prepared = await prepareClaimedBuildStaging(
    reserved,
    await validateBuildOutputTarget(output, async () => {}),
  );
  const isolation = directoryRemovalPath(prepared.directory);
  let recoveryClaim: Awaited<ReturnType<typeof acquireBuildOutputClaim>> | null = null;
  try {
    const evidence = JSON.parse(await readFile(prepared.transactionPath, "utf8")) as Record<string, unknown>;
    evidence.ownerPid = 99_999_999;
    await writeFile(prepared.transactionPath, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
    await rename(prepared.directory, isolation);
    await prepared.claim.release();
    recoveryClaim = await acquireBuildOutputClaim(output, "tree");
    await recoverInterruptedBuilds(output, recoveryClaim, async () => false);
    await recoveryClaim.release();
    recoveryClaim = null;
    await assert.rejects(lstat(isolation), (error: unknown) => isErrorCode(error, "ENOENT"));
    await assert.rejects(lstat(prepared.transactionPath), (error: unknown) => isErrorCode(error, "ENOENT"));
  } finally {
    await recoveryClaim?.release().catch(() => {});
    await prepared.claim.release().catch(() => {});
    await rm(root, { recursive: true, force: true });
  }
});

function isErrorCode(error: unknown, code: string): boolean {
  return typeof error === "object" && error !== null && "code" in error
    && (error as { readonly code?: unknown }).code === code;
}
