import assert from "node:assert/strict";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { chmod, link, lstat, mkdir, mkdtemp, readFile, readdir, realpath, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  acquireBuildOutputClaim,
  acquireBuildOutputClaims,
  buildOutputClaimRegistryPath,
  finishBuildOutputClaim,
} from "../packages/cli/src/build-output-claim.ts";
import {
  BUILD_OUTPUT_RECEIPT,
  buildStagingTransactionPath,
  discardBuildStaging,
  prepareClaimedBuildStaging,
  readBuildStagingOwnership,
  recoverInterruptedBuilds,
  releaseBuildStagingReservation,
  replaceOutputDirectory,
  reserveBuildStaging,
  sameBuildStagingOwnership,
  validateBuildOutputTarget,
  writeBuildOutputReceipt,
} from "../packages/cli/src/build-output-directory.ts";
import { BUILD_STAGING_MARKER } from "../packages/cli/src/build-staging.ts";

const workspaceRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const cliPath = join(workspaceRoot, "packages", "cli", "src", "cli.ts");
const claimModuleUrl = pathToFileURL(join(workspaceRoot, "packages", "cli", "src", "build-output-claim.ts")).href;

interface Execution {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

async function temporaryRoot(name: string): Promise<string> {
  return mkdtemp(join(tmpdir(), `${name}-`));
}

async function write(path: string, contents: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, contents, "utf8");
}

async function prepareReservedBuild(
  reserved: Awaited<ReturnType<typeof reserveBuildStaging>>,
): Promise<Awaited<ReturnType<typeof prepareClaimedBuildStaging>>> {
  const authorization = await validateBuildOutputTarget(reserved.outputDirectory, async () => {});
  return prepareClaimedBuildStaging(reserved, authorization);
}

function runCli(cwd: string, ...arguments_: readonly string[]): Execution {
  const result = spawnSync(process.execPath, [cliPath, ...arguments_], {
    cwd,
    encoding: "utf8",
    timeout: 120_000,
  });
  return { status: result.status, stdout: String(result.stdout), stderr: String(result.stderr) };
}

test("an active file claim rejects a concurrent standalone CLI build", async () => {
  const root = await temporaryRoot("velar-active-file-claim");
  const output = join(root, "dist", "main.js");
  let claim: Awaited<ReturnType<typeof acquireBuildOutputClaim>> | null = null;
  try {
    await write(join(root, "main.vel"), 'print("claimed")\n');
    claim = await acquireBuildOutputClaim(output, "file");
    const built = runCli(root, "build", "main.vel", "--out", output);
    assert.equal(built.status, 1, built.stdout + built.stderr);
    assert.match(built.stderr, /overlaps active file output .* written by process [1-9][0-9]*; wait for that build to finish/u);
    await assert.rejects(lstat(output), (error: unknown) => isErrorCode(error, "ENOENT"));
    await claim.release();
    claim = null;
    assert.equal(runCli(root, "build", "main.vel", "--out", output).status, 0);
  } finally {
    await claim?.release();
    await rm(root, { recursive: true, force: true });
  }
});

test("tree and nested file output claims reject each other in both directions", async () => {
  const root = await temporaryRoot("velar-overlapping-output-claims");
  const outputRoot = join(root, "dist");
  const nestedOutput = join(outputRoot, "bundle.js");
  await write(join(root, "main.vel"), 'print("overlap")\n');
  try {
    const tree = await acquireBuildOutputClaim(outputRoot, "tree");
    try {
      const nested = runCli(root, "build", "main.vel", "--out", nestedOutput);
      assert.equal(nested.status, 1, nested.stdout + nested.stderr);
      assert.match(nested.stderr, /overlaps active tree output/u);
    } finally {
      await tree.release();
    }

    const file = await acquireBuildOutputClaim(nestedOutput, "file");
    try {
      const directory = runCli(root, "build", "main.vel", "--out-dir", outputRoot, "--force");
      assert.equal(directory.status, 1, directory.stdout + directory.stderr);
      assert.match(directory.stderr, /overlaps active file output/u);
    } finally {
      await file.release();
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a rejected directory claim creates no output parent", async () => {
  const root = await temporaryRoot("velar-claimed-directory-no-write");
  const output = join(root, "unwritten", "dist");
  await write(join(root, "main.vel"), 'print("claimed")\n');
  const claim = await acquireBuildOutputClaim(output, "tree");
  try {
    const built = runCli(root, "build", "main.vel", "--out-dir", output, "--force");
    assert.equal(built.status, 1, built.stdout + built.stderr);
    assert.match(built.stderr, /overlaps active tree output/u);
    await assert.rejects(lstat(dirname(output)), (error: unknown) => isErrorCode(error, "ENOENT"));
  } finally {
    await claim.release();
    await rm(root, { recursive: true, force: true });
  }
});

test("portable path aliases share one output claim identity before they exist", async () => {
  const root = await temporaryRoot("velar-portable-output-alias");
  const composed = join(root, "Missing-Caf\u00e9");
  const alias = join(root, "missing-cafe\u0301", "bundle.js");
  try {
    const tree = await acquireBuildOutputClaim(composed, "tree");
    try {
      await assert.rejects(acquireBuildOutputClaim(alias, "file"), /overlaps active tree output/u);
    } finally {
      await tree.release();
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("one lease explicitly merges its own tree-covered file requests", async () => {
  const root = await temporaryRoot("velar-merged-output-claims");
  try {
    const lease = await acquireBuildOutputClaims([
      { path: join(root, "dist", "main.js"), kind: "file" },
      { path: join(root, "dist"), kind: "tree" },
      { path: join(root, "dist", "main.js"), kind: "file" },
    ]);
    try {
      await assert.rejects(
        acquireBuildOutputClaim(join(root, "dist", "other.js"), "file"),
        /overlaps active tree output/u,
      );
    } finally {
      await lease.release();
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("committed finalization keeps success while failed finalization preserves its original error", async () => {
  const committedEvents: string[] = [];
  await finishBuildOutputClaim({
    extend: async () => {},
    release: async () => {
      committedEvents.push("release");
      throw new Error("registry cleanup failed");
    },
  }, { status: "committed" }, async () => {
    committedEvents.push("cleanup");
    throw new Error("staging cleanup failed");
  });
  assert.deepEqual(committedEvents, ["cleanup", "release"]);

  const original = new Error("compile failed");
  const failedEvents: string[] = [];
  await assert.rejects(finishBuildOutputClaim({
    extend: async () => {},
    release: async () => {
      failedEvents.push("release");
      throw new Error("registry cleanup failed");
    },
  }, { status: "failed", error: original }, async () => {
    failedEvents.push("cleanup");
    throw new Error("staging cleanup failed");
  }), (error: unknown) => error === original);
  assert.deepEqual(failedEvents, ["cleanup", "release"]);
});

test("a directory commit survives cleanup permissions and releases its claim", {
  skip: process.platform === "win32" || process.getuid?.() === 0,
}, async () => {
  const root = await temporaryRoot("velar-directory-cleanup-commit");
  const output = join(root, "dist");
  let reserved: Awaited<ReturnType<typeof reserveBuildStaging>> | null = null;
  let previous: string | null = null;
  try {
    await write(join(root, "main.vel"), 'print("recovered")\n');
    await write(join(output, "locked", "old.txt"), "old output\n");
    await chmod(join(output, "locked"), 0);
    reserved = await reserveBuildStaging(output);
    const staging = reserved.directory;
    previous = `${staging}-previous`;
    const prepared = await prepareReservedBuild(reserved);
    assert.equal(
      (await lstat(join(staging, BUILD_STAGING_MARKER))).ino,
      (await lstat(prepared.transactionPath)).ino,
    );
    await write(join(staging, "main.js"), "new output\n");
    await writeBuildOutputReceipt(staging, output);
    await replaceOutputDirectory(prepared);
    reserved = null;

    assert.equal(await readFile(join(output, "main.js"), "utf8"), "new output\n");
    assert.equal((await lstat(previous)).isDirectory(), true);
    assert.equal((await lstat(join(output, BUILD_STAGING_MARKER))).isFile(), true);
    const record = JSON.parse(await readFile(prepared.transactionPath, "utf8")) as Record<string, unknown>;
    record.ownerPid = 99_999_999;
    await write(prepared.transactionPath, `${JSON.stringify(record)}\n`);
    const retry = await acquireBuildOutputClaim(output, "tree");
    await retry.release();
    await chmod(join(previous, "locked"), 0o700);
    const rebuilt = runCli(root, "build", "main.vel", "--out-dir", output);
    assert.equal(rebuilt.status, 0, rebuilt.stdout + rebuilt.stderr);
    await assert.rejects(lstat(previous), (error: unknown) => isErrorCode(error, "ENOENT"));
    await assert.rejects(lstat(join(output, BUILD_STAGING_MARKER)), (error: unknown) => isErrorCode(error, "ENOENT"));
  } finally {
    await reserved?.claim.release().catch(() => {});
    if (previous !== null) await chmod(join(previous, "locked"), 0o700).catch(() => {});
    await rm(root, { recursive: true, force: true });
  }
});

test("legacy transaction evidence cannot authorize moving an author backup", async () => {
  const root = await temporaryRoot("velar-recovery-before-preflight");
  const output = join(root, "victim");
  const staging = join(root, ".velar-victim-interrupted");
  try {
    const transactionToken = randomUUID();
    const ownership = `${JSON.stringify({
      formatVersion: 2,
      kind: "velar-build-staging",
      outputDirectory: output,
      stagingDirectory: staging,
      ownerPid: 99_999_999,
      transactionToken,
    })}\n`;
    await write(join(root, "main.vel"), 'print("safe")\n');
    await write(buildStagingTransactionPath(staging), ownership);
    await mkdir(staging, { recursive: true });
    await link(buildStagingTransactionPath(staging), join(staging, BUILD_STAGING_MARKER));
    await write(join(`${staging}-previous`, "thesis.txt"), "preserve me\n");

    const built = runCli(root, "build", "main.vel", "--out-dir", output);
    assert.equal(built.status, 0, built.stdout + built.stderr);
    assert.equal(await readFile(join(`${staging}-previous`, "thesis.txt"), "utf8"), "preserve me\n");
    assert.equal((await lstat(staging)).isDirectory(), true, "legacy staging remains available for inspection");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("an exact staging pair on independent inodes cannot authorize a victim or delete its author sibling", async () => {
  const root = await temporaryRoot("velar-forged-directory-marker");
  const output = join(root, "victim");
  const staging = join(root, ".velar-victim-forged");
  const previous = `${staging}-previous`;
  try {
    const ownership = `${JSON.stringify({
      formatVersion: 2,
      kind: "velar-build-staging",
      outputDirectory: output,
      stagingDirectory: staging,
      ownerPid: 99_999_999,
      transactionToken: randomUUID(),
    })}\n`;
    await write(join(root, "main.vel"), 'print("safe")\n');
    await write(join(output, "thesis.txt"), "victim contents\n");
    await write(join(previous, "archive.txt"), "author sibling\n");
    await write(join(output, BUILD_STAGING_MARKER), ownership);
    await write(buildStagingTransactionPath(staging), ownership);
    assert.notEqual(
      (await lstat(join(output, BUILD_STAGING_MARKER))).ino,
      (await lstat(buildStagingTransactionPath(staging))).ino,
    );

    const built = runCli(root, "build", "main.vel", "--out-dir", output);
    assert.equal(built.status, 1, built.stdout + built.stderr);
    assert.match(built.stderr, /not empty and was not produced by velar build/u);
    assert.equal(await readFile(join(output, "thesis.txt"), "utf8"), "victim contents\n");
    assert.equal(await readFile(join(previous, "archive.txt"), "utf8"), "author sibling\n");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("an exact staging pair on independent inodes cannot move an author backup", async () => {
  const root = await temporaryRoot("velar-forged-stale-staging-marker");
  const output = join(root, "alternate");
  const staging = join(root, ".velar-alternate-forged");
  const previous = `${staging}-previous`;
  try {
    const ownership = `${JSON.stringify({
      formatVersion: 2,
      kind: "velar-build-staging",
      outputDirectory: output,
      stagingDirectory: staging,
      ownerPid: 99_999_999,
      transactionToken: randomUUID(),
    })}\n`;
    await write(join(root, "main.vel"), 'print("safe")\n');
    await write(join(previous, "archive.txt"), "author sibling\n");
    await write(join(staging, BUILD_STAGING_MARKER), ownership);
    await write(buildStagingTransactionPath(staging), ownership);
    assert.notEqual(
      (await lstat(join(staging, BUILD_STAGING_MARKER))).ino,
      (await lstat(buildStagingTransactionPath(staging))).ino,
    );

    const built = runCli(root, "build", "main.vel", "--out-dir", output);
    assert.equal(built.status, 0, built.stdout + built.stderr);
    assert.equal(await readFile(join(previous, "archive.txt"), "utf8"), "author sibling\n");
    assert.equal((await lstat(staging)).isDirectory(), true, "untrusted staging remains available for inspection");
    assert.equal(await readFile(join(output, "main.js"), "utf8").then((value) => value.length > 0), true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("directory reservation blocks every competitor before its first transaction path is created", async () => {
  const root = await temporaryRoot("velar-directory-staging-claim");
  const output = join(root, "dist");
  let reserved: Awaited<ReturnType<typeof reserveBuildStaging>> | null = await reserveBuildStaging(output);
  try {
    for (const [path, kind] of [
      [output, "tree"],
      [reserved.directory, "tree"],
      [`${reserved.directory}-previous`, "tree"],
      [reserved.transactionPath, "file"],
    ] as const) {
      await assert.rejects(acquireBuildOutputClaim(path, kind), /overlaps active/u);
    }
    for (const path of [reserved.directory, `${reserved.directory}-previous`, reserved.transactionPath]) {
      await assert.rejects(lstat(path), (error: unknown) => isErrorCode(error, "ENOENT"));
    }
    const prepared = await prepareReservedBuild(reserved);
    assert.equal(
      (await lstat(join(prepared.directory, BUILD_STAGING_MARKER))).ino,
      (await lstat(prepared.transactionPath)).ino,
    );
    await discardBuildStaging(prepared);
    reserved = null;
  } finally {
    await reserved?.claim.release().catch(() => {});
    await rm(root, { recursive: true, force: true });
  }
});

test("directory transaction collisions preserve pre-existing staging and evidence", async () => {
  const root = await temporaryRoot("velar-directory-staging-collision");
  try {
    for (const collisionKind of ["staging", "evidence"] as const) {
      const reserved = await reserveBuildStaging(join(root, `dist-${collisionKind}`));
      const collision = collisionKind === "staging"
        ? join(reserved.directory, "thesis.txt")
        : reserved.transactionPath;
      try {
        await write(collision, `${collisionKind} author data\n`);
        await assert.rejects(
          prepareReservedBuild(reserved),
          (error: unknown) => isErrorCode(error, "EEXIST")
            || error instanceof Error && /conflicts with an existing build output/u.test(error.message),
        );
        assert.equal(await readFile(collision, "utf8"), `${collisionKind} author data\n`);
      } finally {
        await releaseBuildStagingReservation(reserved);
      }
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("directory recovery detects a replaced hard-link pair across claim extension", async () => {
  const root = await temporaryRoot("velar-directory-evidence-swap");
  const output = join(root, "dist");
  const reserved = await reserveBuildStaging(output);
  const prepared = await prepareReservedBuild(reserved);
  try {
    const before = await readBuildStagingOwnership(prepared.directory, output, prepared.directory);
    assert.ok(before);
    const contents = await readFile(prepared.transactionPath, "utf8");
    await rm(join(prepared.directory, BUILD_STAGING_MARKER));
    await rm(prepared.transactionPath);
    await write(prepared.transactionPath, contents);
    await link(prepared.transactionPath, join(prepared.directory, BUILD_STAGING_MARKER));
    const after = await readBuildStagingOwnership(prepared.directory, output, prepared.directory);
    assert.ok(after);
    assert.equal(sameBuildStagingOwnership(before, after), false);
  } finally {
    await discardBuildStaging(prepared);
    await rm(root, { recursive: true, force: true });
  }
});

test("directory replacement preserves a target swapped after transaction preparation", async () => {
  const root = await temporaryRoot("velar-directory-target-swap");
  const output = join(root, "dist");
  const displaced = join(root, "displaced-output");
  await write(join(output, "old.txt"), "old output\n");
  const reserved = await reserveBuildStaging(output);
  const prepared = await prepareReservedBuild(reserved);
  try {
    await write(join(prepared.directory, "main.js"), "new output\n");
    await rename(output, displaced);
    await write(join(output, "author.txt"), "author output\n");

    await assert.rejects(replaceOutputDirectory(prepared), /changed physical identity/u);
    assert.equal(await readFile(join(output, "author.txt"), "utf8"), "author output\n");
    assert.equal(await readFile(join(displaced, "old.txt"), "utf8"), "old output\n");
  } finally {
    await prepared.claim.release().catch(() => {});
    await rm(root, { recursive: true, force: true });
  }
});

test("staging identity changes cannot install or clean up an author directory", async () => {
  const root = await temporaryRoot("velar-directory-staging-swap");
  const output = join(root, "dist");
  const displaced = join(root, "displaced-staging");
  const prepared = await prepareReservedBuild(await reserveBuildStaging(output));
  try {
    await write(join(prepared.directory, "main.js"), "new output\n");
    await rename(prepared.directory, displaced);
    await write(join(prepared.directory, "author.txt"), "author staging\n");
    await assert.rejects(replaceOutputDirectory(prepared), /changed physical identity/u);
    assert.equal(await readFile(join(prepared.directory, "author.txt"), "utf8"), "author staging\n");
    assert.equal(await readFile(join(displaced, "main.js"), "utf8"), "new output\n");
    await assert.rejects(lstat(output), (error: unknown) => isErrorCode(error, "ENOENT"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("preflight authorization cannot cross a replaced output parent", async () => {
  const root = await temporaryRoot("velar-directory-parent-swap");
  const parent = join(root, "parent");
  const output = join(parent, "dist");
  const displaced = join(root, "displaced-parent");
  await mkdir(parent);
  const reserved = await reserveBuildStaging(output);
  const authorization = await validateBuildOutputTarget(output, async () => {});
  try {
    await rename(parent, displaced);
    await write(join(output, "author.txt"), "later parent\n");
    await assert.rejects(prepareClaimedBuildStaging(reserved, authorization), /changed physical identity/u);
    assert.equal(await readFile(join(output, "author.txt"), "utf8"), "later parent\n");
    await assert.rejects(lstat(reserved.directory), (error: unknown) => isErrorCode(error, "ENOENT"));
  } finally {
    await reserved.claim.release().catch(() => {});
    await rm(root, { recursive: true, force: true });
  }
});

test("directory replacement preserves paths changed after its first rename", async () => {
  const root = await temporaryRoot("velar-directory-first-rename-swap");
  const output = join(root, "dist");
  await write(join(output, "old.txt"), "old output\n");
  const prepared = await prepareReservedBuild(await reserveBuildStaging(output));
  const previous = `${prepared.directory}-previous`;
  try {
    await write(join(prepared.directory, "main.js"), "new output\n");
    await assert.rejects(replaceOutputDirectory(prepared, {
      afterFirstRename: async () => write(join(output, "author.txt"), "later output\n"),
    }), /previous output could not be restored/u);
    assert.equal(await readFile(join(output, "author.txt"), "utf8"), "later output\n");
    assert.equal(await readFile(join(previous, "old.txt"), "utf8"), "old output\n");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("directory replacement preserves paths changed after its second rename", async () => {
  const root = await temporaryRoot("velar-directory-second-rename-swap");
  const output = join(root, "dist");
  const installed = join(root, "displaced-installed");
  await write(join(output, "old.txt"), "old output\n");
  const prepared = await prepareReservedBuild(await reserveBuildStaging(output));
  const previous = `${prepared.directory}-previous`;
  try {
    await write(join(prepared.directory, "main.js"), "new output\n");
    await assert.rejects(replaceOutputDirectory(prepared, { afterSecondRename: async () => {
      await rename(output, installed);
      await write(join(output, "author.txt"), "later output\n");
    } }), /became visible.*preserved/u);
    assert.equal(await readFile(join(output, "author.txt"), "utf8"), "later output\n");
    assert.equal(await readFile(join(previous, "old.txt"), "utf8"), "old output\n");
    assert.equal(await readFile(join(installed, "main.js"), "utf8"), "new output\n");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("committed cleanup preserves a replaced backup path", async () => {
  const root = await temporaryRoot("velar-directory-cleanup-swap");
  const output = join(root, "dist");
  const displaced = join(root, "displaced-previous");
  await write(join(output, "old.txt"), "old output\n");
  const prepared = await prepareReservedBuild(await reserveBuildStaging(output));
  const previous = `${prepared.directory}-previous`;
  try {
    await write(join(prepared.directory, "main.js"), "new output\n");
    await replaceOutputDirectory(prepared, { beforePreviousCleanup: async () => {
      await rename(previous, displaced);
      await write(join(previous, "author.txt"), "later backup\n");
    } });
    assert.equal(await readFile(join(output, "main.js"), "utf8"), "new output\n");
    assert.equal(await readFile(join(previous, "author.txt"), "utf8"), "later backup\n");
    assert.equal(await readFile(join(displaced, "old.txt"), "utf8"), "old output\n");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("installed directory recovery preserves a later directory at the backup path", async () => {
  const root = await temporaryRoot("velar-directory-recovery-backup-swap");
  const output = join(root, "dist");
  await write(join(root, "main.vel"), 'print("next")\n');
  await write(join(output, "old.txt"), "old output\n");
  const reserved = await reserveBuildStaging(output);
  const prepared = await prepareReservedBuild(reserved);
  const previous = `${prepared.directory}-previous`;
  try {
    await write(join(prepared.directory, "main.js"), "installed output\n");
    await writeBuildOutputReceipt(prepared.directory, output);
    const ownership = JSON.parse(await readFile(prepared.transactionPath, "utf8")) as Record<string, unknown>;
    ownership.ownerPid = 99_999_999;
    await write(prepared.transactionPath, `${JSON.stringify(ownership)}\n`);
    await rename(output, previous);
    await rename(prepared.directory, output);
    await rm(previous, { recursive: true });
    await write(join(previous, "author.txt"), "later author directory\n");
    await prepared.claim.release();

    const rebuilt = runCli(root, "build", "main.vel", "--out-dir", output, "--force");
    assert.equal(rebuilt.status, 1, rebuilt.stdout + rebuilt.stderr);
    assert.match(rebuilt.stderr, /backup.*changed physical identity/u);
    assert.equal(await readFile(join(previous, "author.txt"), "utf8"), "later author directory\n");
  } finally {
    await prepared.claim.release().catch(() => {});
    await rm(root, { recursive: true, force: true });
  }
});

test("an alternate generic output carries a path-bound receipt and rebuilds without force", async () => {
  const root = await temporaryRoot("velar-generic-output-receipt");
  const output = join(root, "alternate");
  const forged = join(root, "forged");
  try {
    await write(join(root, "main.vel"), 'print("receipt")\n');
    const first = runCli(root, "build", "main.vel", "--out-dir", output);
    assert.equal(first.status, 0, first.stdout + first.stderr);
    const receipt = JSON.parse(await readFile(join(output, BUILD_OUTPUT_RECEIPT), "utf8")) as Record<string, unknown>;
    assert.equal(receipt.kind, "velar-directory-build-output");
    assert.equal(receipt.outputDirectory, await realpath(output));
    assert.equal(receipt.formatVersion, 2);
    assert.match(String(receipt.buildId), /^[a-f0-9]{64}$/u);
    assert.equal(Array.isArray(receipt.inventory), true);

    const repeated = runCli(root, "build", "main.vel", "--out-dir", output);
    assert.equal(repeated.status, 0, repeated.stdout + repeated.stderr);
    await write(join(output, "author.txt"), "author data\n");
    const tampered = runCli(root, "build", "main.vel", "--out-dir", output);
    assert.equal(tampered.status, 1, tampered.stdout + tampered.stderr);
    assert.match(tampered.stderr, /not empty and was not produced by velar build/u);
    assert.equal(await readFile(join(output, "author.txt"), "utf8"), "author data\n");

    await write(join(forged, BUILD_OUTPUT_RECEIPT), `${JSON.stringify(receipt)}\n`);
    await write(join(forged, "thesis.txt"), "author data\n");
    const refused = runCli(root, "build", "main.vel", "--out-dir", forged);
    assert.equal(refused.status, 1, refused.stdout + refused.stderr);
    assert.match(refused.stderr, /not empty and was not produced by velar build/u);
    assert.equal(await readFile(join(forged, "thesis.txt"), "utf8"), "author data\n");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("runtime-free standalone builds do not claim or emit an unused runtime tree", async () => {
  const root = await temporaryRoot("velar-standalone-runtime-claim");
  const output = join(root, "dist", "main.js");
  await write(join(root, "main.vel"), 'print("runtime-free")\n');
  const runtime = await acquireBuildOutputClaim(join(root, "dist", "node_modules", "velar"), "tree");
  try {
    const built = runCli(root, "build", "main.vel", "--out", output);
    assert.equal(built.status, 0, built.stdout + built.stderr);
    assert.equal((await lstat(output)).isFile(), true);
    await assert.rejects(
      lstat(join(root, "dist", "node_modules")),
      (error: unknown) => isErrorCode(error, "ENOENT"),
    );
  } finally {
    await runtime.release();
    await rm(root, { recursive: true, force: true });
  }
});

test("an obsolete receipt sidecar is claimed before standalone cleanup", async () => {
  const root = await temporaryRoot("velar-obsolete-sidecar-claim");
  const outputRoot = join(root, "dist");
  const output = join(outputRoot, "main.js");
  try {
    await write(join(root, "main.vel"), [
      "extern js()`",
      "export const embeddedValue = 42",
      "`:",
      "    export const embeddedValue: number",
      "",
      "print(embeddedValue)",
      "",
    ].join("\n"));
    const first = runCli(root, "build", "main.vel", "--out", output, "--no-source-maps");
    assert.equal(first.status, 0, first.stdout + first.stderr);
    const sidecarName = (await readdir(outputRoot)).find((name) => name.includes(".embedded-") && name.endsWith(".js"));
    assert.ok(sidecarName);
    const sidecar = join(outputRoot, sidecarName);
    const oldMain = await readFile(output, "utf8");
    const oldSidecar = await readFile(sidecar, "utf8");
    await write(join(root, "main.vel"), 'print("replacement")\n');

    const competing = await acquireBuildOutputClaim(sidecar, "file");
    try {
      const blocked = runCli(root, "build", "main.vel", "--out", output, "--no-source-maps");
      assert.equal(blocked.status, 1, blocked.stdout + blocked.stderr);
      assert.match(blocked.stderr, /overlaps active file output/u);
      assert.equal(await readFile(output, "utf8"), oldMain);
      assert.equal(await readFile(sidecar, "utf8"), oldSidecar);
    } finally {
      await competing.release();
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("concurrent CLI tree and nested standalone builds cannot both succeed", { timeout: 120_000 }, async () => {
  const root = await temporaryRoot("velar-cross-shape-output-race");
  let directoryBuild: ChildProcess | null = null;
  try {
    const outputRoot = join(root, "dist");
    await write(join(root, "velar.json"), `${JSON.stringify({
      formatVersion: 2,
      entry: "src/main.vel",
      outDir: "dist",
    })}\n`);
    await write(join(root, "src", "main.vel"), 'print("tree")\n');
    await write(join(root, "small.vel"), 'print("nested")\n');
    for (let start = 0; start < 20_000; start += 200) {
      await Promise.all(Array.from({ length: 200 }, (_, offset) => write(
        join(outputRoot, "previous", `file-${start + offset}.txt`),
        "previous output\n",
      )));
    }
    directoryBuild = spawn(process.execPath, [cliPath, "build", "--out-dir", outputRoot, "--force"], {
      cwd: root,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const directoryCompletion = collectExecution(directoryBuild);
    try {
      await waitForOutputClaim(outputRoot, "tree", directoryBuild);
    } catch (error) {
      const early = await directoryCompletion;
      throw new Error(`${error instanceof Error ? error.message : String(error)}: ${early.stdout}${early.stderr}`);
    }
    const nested = runCli(root, "build", "small.vel", "--out", join(outputRoot, "bundle.js"));
    assert.equal(nested.status, 1, nested.stdout + nested.stderr);
    assert.match(nested.stderr, /overlaps active tree output/u);
    const completed = await directoryCompletion;
    directoryBuild = null;
    assert.equal(completed.status, 0, completed.stdout + completed.stderr);
    await assert.rejects(lstat(join(outputRoot, "bundle.js")), (error: unknown) => isErrorCode(error, "ENOENT"));
  } finally {
    if (directoryBuild && directoryBuild.exitCode === null && directoryBuild.signalCode === null) directoryBuild.kill("SIGKILL");
    await rm(root, { recursive: true, force: true });
  }
});

test("a dead output owner is reclaimed", async () => {
  const root = await temporaryRoot("velar-dead-output-claim");
  const output = join(root, "dist", "main.js");
  try {
    const script = `import {acquireBuildOutputClaim} from ${JSON.stringify(claimModuleUrl)}; await acquireBuildOutputClaim(${JSON.stringify(output)}, "file");`;
    const abandoned = spawnSync(process.execPath, ["--input-type=module", "--eval", script], {
      encoding: "utf8",
      timeout: 120_000,
    });
    assert.equal(abandoned.status, 0, String(abandoned.stderr));
    const claim = await acquireBuildOutputClaim(output, "file");
    await claim.release();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("invalid registry data and output-adjacent author data are preserved", async () => {
  const root = await temporaryRoot("velar-forged-output-claim");
  const output = join(root, "dist", "main.js");
  const authorPath = join(root, "dist", ".velar-main.js.claim", "author-data.txt");
  const invalidPath = join(buildOutputClaimRegistryPath(), `claim-${randomUUID()}.json`);
  const mismatchedPath = join(buildOutputClaimRegistryPath(), `claim-${randomUUID()}.json`);
  const forgedToken = randomUUID();
  try {
    await write(authorPath, "preserve author data\n");
    await write(invalidPath, "not a generated claim\n");
    await write(mismatchedPath, `${JSON.stringify({
      formatVersion: 1,
      kind: "velar-build-output-claim",
      comparisonPath: resolve(output).normalize("NFC").toLowerCase(),
      outputPath: resolve(output),
      outputKind: "file",
      ownerPid: 99_999_999,
      token: forgedToken,
    })}\n`);
    const claim = await acquireBuildOutputClaim(output, "file");
    await claim.release();
    assert.equal(await readFile(authorPath, "utf8"), "preserve author data\n");
    assert.equal(await readFile(invalidPath, "utf8"), "not a generated claim\n");
    assert.equal(JSON.parse(await readFile(mismatchedPath, "utf8")).token, forgedToken);
  } finally {
    await rm(invalidPath, { force: true });
    await rm(mismatchedPath, { force: true });
    await rm(root, { recursive: true, force: true });
  }
});

async function waitForOutputClaim(path: string, kind: "file" | "tree", child: ChildProcess): Promise<void> {
  const deadline = Date.now() + 30_000;
  const expectedPath = await realpath(path);
  while (Date.now() < deadline) {
    for (const name of await readdir(buildOutputClaimRegistryPath()).catch(() => [] as string[])) {
      if (!name.startsWith("claim-") || !name.endsWith(".json")) continue;
      try {
        const record = JSON.parse(await readFile(join(buildOutputClaimRegistryPath(), name), "utf8")) as Record<string, unknown>;
        if (record.outputPath === expectedPath && record.outputKind === kind) return;
      } catch {}
    }
    if (child.exitCode !== null || child.signalCode !== null) throw new Error("build exited before claiming its output");
  }
  throw new Error("build did not claim its output");
}

async function collectExecution(child: ChildProcess): Promise<Execution> {
  const stdout: Buffer[] = [];
  const stderr: Buffer[] = [];
  child.stdout?.on("data", (chunk: Buffer) => stdout.push(chunk));
  child.stderr?.on("data", (chunk: Buffer) => stderr.push(chunk));
  const status = await new Promise<number | null>((resolveExit, rejectExit) => {
    child.once("error", rejectExit);
    child.once("exit", resolveExit);
  });
  return { status, stdout: Buffer.concat(stdout).toString("utf8"), stderr: Buffer.concat(stderr).toString("utf8") };
}

function isErrorCode(error: unknown, code: string): boolean {
  return typeof error === "object" && error !== null && "code" in error
    && (error as { readonly code?: unknown }).code === code;
}
