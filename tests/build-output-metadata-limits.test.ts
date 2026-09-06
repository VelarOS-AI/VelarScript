import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { lstat, mkdir, mkdtemp, readFile, rm, truncate, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  MAX_BUILD_STAGING_EVIDENCE_BYTES,
  readBuildStagingOwnership,
} from "../packages/cli/src/build-output-directory.ts";
import {
  BUILD_OUTPUT_RECEIPT,
  MAX_BUILD_OUTPUT_RECEIPT_BYTES,
} from "../packages/cli/src/build-output-receipt.ts";
import { BUILD_STAGING_MARKER } from "../packages/cli/src/build-staging.ts";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const cli = join(repositoryRoot, "packages", "cli", "src", "cli.ts");
const claimModuleUrl = pathToFileURL(
  join(repositoryRoot, "packages", "cli", "src", "build-output-claim.ts"),
).href;

async function temporaryRoot(name: string): Promise<string> {
  return mkdtemp(join(tmpdir(), `${name}-`));
}

async function write(path: string, contents: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, contents, "utf8");
}

test("oversized claim records and mutation sets fail closed without changing their evidence", async () => {
  const sandbox = await temporaryRoot("velar-bounded-output-claim");
  try {
    const script = [
      'import assert from "node:assert/strict";',
      'import {randomUUID} from "node:crypto";',
      'import {lstat, mkdir, truncate, writeFile} from "node:fs/promises";',
      'import {join} from "node:path";',
      `const claims = await import(${JSON.stringify(claimModuleUrl)});`,
      `const sandbox = ${JSON.stringify(sandbox)};`,
      'const output = join(sandbox, "dist", "main.js");',
      'const initial = await claims.acquireBuildOutputClaim(output, "file");',
      'await initial.release();',
      'const registry = claims.buildOutputClaimRegistryPath();',
      'const evidence = join(registry, `claim-${randomUUID()}.json`);',
      'await writeFile(evidence, "author evidence\\n", "utf8");',
      'await truncate(evidence, claims.MAX_BUILD_OUTPUT_CLAIM_RECORD_BYTES + 1);',
      'await assert.rejects(claims.acquireBuildOutputClaim(output, "file"), /claim record .* exceeds/u);',
      'assert.equal((await lstat(evidence)).size, claims.MAX_BUILD_OUTPUT_CLAIM_RECORD_BYTES + 1);',
      'await assert.rejects(claims.acquireBuildOutputClaims(Array.from(',
      '  {length: claims.MAX_BUILD_OUTPUT_CLAIMS + 1},',
      '  (_, index) => ({path: join(sandbox, `output-${index}`), kind: "file"}),',
      ')), /cannot claim more than/u);',
    ].join("\n");
    const executed = spawnSync(process.execPath, ["--input-type=module", "--eval", script], {
      cwd: repositoryRoot,
      encoding: "utf8",
      env: { ...process.env, TMPDIR: sandbox, TMP: sandbox, TEMP: sandbox },
      timeout: 120_000,
    });
    assert.equal(executed.status, 0, String(executed.stdout) + String(executed.stderr));
  } finally {
    await rm(sandbox, { recursive: true, force: true });
  }
});

test("oversized directory transaction evidence is never parsed or removed", async () => {
  const root = await temporaryRoot("velar-bounded-directory-evidence");
  const staging = join(root, ".velar-dist-fixture");
  const marker = join(staging, BUILD_STAGING_MARKER);
  try {
    await write(marker, "author evidence\n");
    await truncate(marker, MAX_BUILD_STAGING_EVIDENCE_BYTES + 1);
    await assert.rejects(
      readBuildStagingOwnership(staging, join(root, "dist"), staging),
      /transaction evidence .* exceeds/u,
    );
    assert.equal((await lstat(marker)).size, MAX_BUILD_STAGING_EVIDENCE_BYTES + 1);
    assert.equal((await readFile(marker)).subarray(0, 16).toString("utf8"), "author evidence\n");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("an oversized directory receipt cannot authorize replacement of author output", async () => {
  const root = await temporaryRoot("velar-bounded-directory-receipt");
  const output = join(root, "alternate-output");
  const source = 'print("bounded receipt")\n';
  const author = "author output\n";
  const receipt = join(output, BUILD_OUTPUT_RECEIPT);
  try {
    await write(join(root, "main.vel"), source);
    await write(join(root, "velar.json"), `${JSON.stringify({
      formatVersion: 2,
      entry: "main.vel",
      outDir: "dist",
    }, null, 2)}\n`);
    await write(join(output, "author.txt"), author);
    await write(receipt, "author receipt\n");
    await truncate(receipt, MAX_BUILD_OUTPUT_RECEIPT_BYTES + 1);

    const built = spawnSync(process.execPath, [cli, "build", "--out-dir", output], {
      cwd: root,
      encoding: "utf8",
      timeout: 120_000,
    });
    assert.equal(built.status, 1, String(built.stdout) + String(built.stderr));
    assert.match(String(built.stderr), /ownership receipt .* exceeds/u);
    assert.equal(await readFile(join(root, "main.vel"), "utf8"), source);
    assert.equal(await readFile(join(output, "author.txt"), "utf8"), author);
    assert.equal((await lstat(receipt)).size, MAX_BUILD_OUTPUT_RECEIPT_BYTES + 1);
    assert.equal((await readFile(receipt)).subarray(0, 15).toString("utf8"), "author receipt\n");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
