import assert from "node:assert/strict";
import { cp, link, lstat, mkdtemp, mkdir, readFile, readdir, rename, rm, truncate, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import test from "node:test";
import { acquireBuildOutputClaim } from "../packages/cli/src/build-output-claim.ts";
import { MAX_PRODUCTION_FILE_BYTES } from "../packages/cli/src/bounded-directory-snapshot.ts";
import { copyReproductionSnapshot } from "../packages/cli/src/reproduction-output-copy.ts";
import { writeReproductionOutput } from "../packages/cli/src/reproduction-output.ts";
import { TRANSACTION_CANDIDATE_LIMIT, TRANSACTION_JSON_MAX_BYTES } from "../packages/cli/src/transaction-metadata.ts";
import {
  inspectOrdinaryDirectory,
  inspectReproductionTarget,
  recoverReproductionOutputTransactions,
  replaceReproductionDirectory,
  ReproductionReplacementError,
  type ReproductionReplacement,
  type ReproductionReplacementOperations,
} from "../packages/cli/src/reproduction-output-transaction.ts";

async function temporaryRoot(name: string): Promise<string> {
  return mkdtemp(join(tmpdir(), `${name}-`));
}

async function write(path: string, contents: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, contents, "utf8");
}

test("reproduction claims every transaction path before staging writes begin", async () => {
  const root = await temporaryRoot("velar-repro-complete-claim");
  const target = join(root, ".velar", "repro");
  try {
    await write(join(target, "old.txt"), "old reproduction\n");
    await writeReproductionOutput({
      projectRoot: root,
      outputDirectory: target,
      requestedOutput: null,
      defaultOutputName: ".velar/repro",
    }, async (staging) => {
      const evidence = await lstat(`${staging}.velar-transaction.json`);
      const marker = await lstat(join(staging, ".velar-reproduction-output-transaction.json"));
      assert.equal(marker.dev, evidence.dev, "transaction evidence must be bound into its staging tree");
      assert.equal(marker.ino, evidence.ino, "transaction evidence links must share one inode");
      const competing = [
        { path: target, kind: "tree" as const },
        { path: staging, kind: "tree" as const },
        { path: `${staging}-previous`, kind: "tree" as const },
        { path: `${staging}-recovery`, kind: "tree" as const },
        { path: `${staging}.velar-transaction.json`, kind: "file" as const },
      ];
      for (const output of competing) {
        await assert.rejects(acquireBuildOutputClaim(output.path, output.kind), /overlaps active/u);
      }
      const sibling = await acquireBuildOutputClaim(join(dirname(target), "independent-output"), "tree");
      await sibling.release();
      await write(join(staging, "new.txt"), "new reproduction\n");
      return null;
    });
    assert.equal(await readFile(join(target, "new.txt"), "utf8"), "new reproduction\n");
    assert.deepEqual((await readdir(dirname(target))).sort(), ["repro"]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("target-adjacent transaction JSON never authorizes deletion of a sibling tree", async () => {
  const root = await temporaryRoot("velar-repro-untrusted-evidence");
  const target = join(root, ".velar", "repro");
  const forgedStaging = join(root, ".velar", ".velar-repro-repro-forged");
  const authorTree = `${forgedStaging}-previous`;
  const forgedEvidence = `${forgedStaging}.velar-transaction.json`;
  try {
    await write(join(target, "old.txt"), "old reproduction\n");
    await write(join(authorTree, "thesis.txt"), "preserve author data\n");
    await write(forgedEvidence, `${JSON.stringify({
      formatVersion: 1,
      kind: "velar-reproduction-output-transaction",
      ownerPid: 99_999_999,
      token: "00000000-0000-4000-8000-000000000000",
      target,
      staging: forgedStaging,
      previous: authorTree,
      recovery: `${forgedStaging}-recovery`,
    })}\n`);
    await writeReproductionOutput({
      projectRoot: root,
      outputDirectory: target,
      requestedOutput: null,
      defaultOutputName: ".velar/repro",
    }, async (staging) => {
      await write(join(staging, "new.txt"), "new reproduction\n");
      return null;
    });
    assert.equal(await readFile(join(authorTree, "thesis.txt"), "utf8"), "preserve author data\n");
    assert.match(await readFile(forgedEvidence, "utf8"), /velar-reproduction-output-transaction/u);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("reproduction rejects an output directory whose inode changes while staging is written", async () => {
  const root = await temporaryRoot("velar-repro-output-swap");
  const target = join(root, "bundle");
  const original = join(root, "original-bundle");
  try {
    await mkdir(target);
    await assert.rejects(writeReproductionOutput({
      projectRoot: root,
      outputDirectory: target,
      requestedOutput: target,
      defaultOutputName: ".velar/repro",
    }, async (staging) => {
      await rename(target, original);
      await mkdir(target);
      await write(join(staging, "new.txt"), "new reproduction\n");
      return null;
    }), /changed physical identity/u);
    assert.deepEqual(await readdir(target), []);
    assert.deepEqual(await readdir(original), []);
    assert.deepEqual((await readdir(root)).sort(), ["bundle", "original-bundle"]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("rename-time inode validation restores a non-empty directory swapped in after preflight", async () => {
  const fixture = await replacementFixture("velar-repro-rename-swap");
  const original = join(fixture.root, "original-empty-target");
  const incoming = join(fixture.root, "incoming-author-directory");
  try {
    await write(join(incoming, "thesis.txt"), "preserve author data\n");
    let calls = 0;
    const operations = replacementOperations({
      rename: async (source, destination) => {
        calls += 1;
        if (calls === 1) {
          await rename(fixture.target, original);
          await rename(incoming, fixture.target);
        }
        await rename(source, destination);
      },
    });
    await assert.rejects(
      replaceReproductionDirectory(fixture.transaction, operations),
      /changed physical identity/u,
    );
    assert.equal(await readFile(join(fixture.target, "thesis.txt"), "utf8"), "preserve author data\n");
    assert.equal(await readFile(join(original, "old.txt"), "utf8"), "old reproduction\n");
    assert.equal(await readFile(join(fixture.staging, "new.txt"), "utf8"), "new reproduction\n");
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("rename-time evidence content validation restores the previous reproduction", async () => {
  const fixture = await replacementFixture("velar-repro-evidence-content-swap");
  try {
    let calls = 0;
    await assert.rejects(replaceReproductionDirectory(fixture.transaction, replacementOperations({
      rename: async (source, destination) => {
        calls += 1;
        if (calls === 1) await writeFile(fixture.evidence, "changed transaction evidence\n", "utf8");
        await rename(source, destination);
      },
    })), /changed physical identity/u);
    assert.equal(await readFile(join(fixture.target, "old.txt"), "utf8"), "old reproduction\n");
    assert.equal(await readFile(join(fixture.staging, "new.txt"), "utf8"), "new reproduction\n");
    assert.equal(await readFile(fixture.evidence, "utf8"), "changed transaction evidence\n");
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("parent identity validation preserves every artifact when the parent is swapped", async () => {
  const fixture = await replacementFixture("velar-repro-parent-swap");
  const movedRoot = `${fixture.root}-moved`;
  try {
    await assert.rejects(replaceReproductionDirectory(fixture.transaction, replacementOperations({
      afterFirstRename: async () => {
        await rename(fixture.root, movedRoot);
        await mkdir(fixture.root);
      },
    })), (error: unknown) => error instanceof ReproductionReplacementError && error.preserveArtifacts);
    assert.deepEqual(await readdir(fixture.root), []);
    assert.equal(await readFile(join(movedRoot, basename(fixture.previous), "old.txt"), "utf8"), "old reproduction\n");
    assert.equal(await readFile(join(movedRoot, basename(fixture.staging), "new.txt"), "utf8"), "new reproduction\n");
    assert.equal(await readFile(join(movedRoot, basename(fixture.evidence)), "utf8"), fixture.evidenceContents);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
    await rm(movedRoot, { recursive: true, force: true });
  }
});

test("a failed second rename restores the complete previous reproduction", async () => {
  const fixture = await replacementFixture("velar-repro-second-rename");
  try {
    let calls = 0;
    const operations = replacementOperations({
      rename: async (source, destination) => {
        calls += 1;
        if (calls === 2) throw new Error("simulated second rename failure");
        await rename(source, destination);
      },
    });
    await assert.rejects(
      replaceReproductionDirectory(fixture.transaction, operations),
      /Could not install reproduction/u,
    );
    assert.equal(await readFile(join(fixture.target, "old.txt"), "utf8"), "old reproduction\n");
    assert.equal(await readFile(join(fixture.staging, "new.txt"), "utf8"), "new reproduction\n");
    await assert.rejects(readdir(fixture.previous), isMissing);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("an interruption after the first rename restores the previous reproduction", async () => {
  const fixture = await replacementFixture("velar-repro-first-rename-interruption");
  try {
    const operations = replacementOperations({
      afterFirstRename: async () => {
        throw new Error("simulated interruption after first rename");
      },
    });
    await assert.rejects(
      replaceReproductionDirectory(fixture.transaction, operations),
      /changed physical identity/u,
    );
    assert.equal(await readFile(join(fixture.target, "old.txt"), "utf8"), "old reproduction\n");
    assert.equal(await readFile(join(fixture.staging, "new.txt"), "utf8"), "new reproduction\n");
    await assert.rejects(readdir(fixture.previous), isMissing);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("an interruption after the second rename preserves both complete bundles and evidence", async () => {
  const fixture = await replacementFixture("velar-repro-second-rename-interruption");
  try {
    const operations = replacementOperations({
      afterSecondRename: async () => {
        throw new Error("simulated interruption after second rename");
      },
    });
    await assert.rejects(replaceReproductionDirectory(fixture.transaction, operations), (error: unknown) =>
      error instanceof ReproductionReplacementError && error.preserveArtifacts);
    assert.equal(await readFile(join(fixture.target, "new.txt"), "utf8"), "new reproduction\n");
    assert.equal(await readFile(join(fixture.previous, "old.txt"), "utf8"), "old reproduction\n");
    assert.equal(await readFile(fixture.evidence, "utf8"), fixture.evidenceContents);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("post-second-rename validation preserves an author directory swapped into the target", async () => {
  const fixture = await replacementFixture("velar-repro-installed-swap");
  const installed = join(fixture.root, "installed-staging");
  const incoming = join(fixture.root, "incoming-author-directory");
  try {
    await write(join(incoming, "thesis.txt"), "preserve author data\n");
    await assert.rejects(replaceReproductionDirectory(fixture.transaction, replacementOperations({
      afterSecondRename: async () => {
        await rename(fixture.target, installed);
        await rename(incoming, fixture.target);
      },
    })), (error: unknown) => error instanceof ReproductionReplacementError && error.preserveArtifacts);
    assert.equal(await readFile(join(fixture.target, "thesis.txt"), "utf8"), "preserve author data\n");
    assert.equal(await readFile(join(installed, "new.txt"), "utf8"), "new reproduction\n");
    assert.equal(await readFile(join(fixture.previous, "old.txt"), "utf8"), "old reproduction\n");
    assert.equal(await readFile(fixture.evidence, "utf8"), fixture.evidenceContents);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("a rollback failure preserves the old bundle and transaction evidence", async () => {
  const fixture = await replacementFixture("velar-repro-rollback-failure");
  try {
    let calls = 0;
    const operations = replacementOperations({
      rename: async (source, destination) => {
        calls += 1;
        if (calls >= 2) throw new Error(`simulated rename failure ${calls}`);
        await rename(source, destination);
      },
    });
    await assert.rejects(replaceReproductionDirectory(fixture.transaction, operations), (error: unknown) =>
      error instanceof ReproductionReplacementError && error.preserveArtifacts);
    assert.equal(await readFile(join(fixture.previous, "old.txt"), "utf8"), "old reproduction\n");
    assert.equal(await readFile(join(fixture.staging, "new.txt"), "utf8"), "new reproduction\n");
    assert.equal(await readFile(fixture.evidence, "utf8"), fixture.evidenceContents);
    await assert.rejects(readdir(fixture.target), isMissing);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("post-commit cleanup failure keeps the new and previous bundles complete", async () => {
  const fixture = await replacementFixture("velar-repro-cleanup-failure");
  try {
    const operations = replacementOperations({
      removeTree: async () => {
        throw new Error("simulated cleanup failure");
      },
    });
    const result = await replaceReproductionDirectory(fixture.transaction, operations);
    assert.equal(result.cleanupDeferred, true);
    assert.equal(await readFile(join(fixture.target, "new.txt"), "utf8"), "new reproduction\n");
    assert.equal(await readFile(join(fixture.previous, "old.txt"), "utf8"), "old reproduction\n");
    assert.equal(await readFile(join(fixture.recovery, "old.txt"), "utf8"), "old reproduction\n");
    const retainedEvidence = JSON.parse(await readFile(fixture.evidence, "utf8")) as { recoveryIdentity: unknown };
    assert.notEqual(retainedEvidence.recoveryIdentity, null, "the complete recovery copy must be bound before deletion starts");
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("post-commit cleanup never removes transaction evidence replaced by an author file", async () => {
  const fixture = await replacementFixture("velar-repro-evidence-swap");
  const originalEvidence = join(fixture.root, "original-transaction-evidence");
  const incoming = join(fixture.root, "incoming-author-evidence");
  try {
    await writeFile(incoming, "preserve author evidence\n", "utf8");
    const result = await replaceReproductionDirectory(fixture.transaction, replacementOperations({
      afterSecondRename: async () => {
        await rename(fixture.evidence, originalEvidence);
        await rename(incoming, fixture.evidence);
      },
    }));
    assert.equal(result.cleanupDeferred, true);
    assert.equal(await readFile(fixture.evidence, "utf8"), "preserve author evidence\n");
    assert.equal(await readFile(originalEvidence, "utf8"), fixture.evidenceContents);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("post-commit cleanup never removes a previous path swapped after validation", async () => {
  const fixture = await replacementFixture("velar-repro-previous-cleanup-swap");
  const originalPrevious = join(fixture.root, "original-previous");
  const incoming = join(fixture.root, "incoming-author-directory");
  try {
    await write(join(incoming, "thesis.txt"), "preserve author data\n");
    const result = await replaceReproductionDirectory(fixture.transaction, replacementOperations({
      copyTree: async () => {
        await rename(fixture.previous, originalPrevious);
        await rename(incoming, fixture.previous);
        throw new Error("source snapshot changed before recovery copy");
      },
    }));
    assert.equal(result.cleanupDeferred, true);
    assert.equal(await readFile(join(fixture.previous, "thesis.txt"), "utf8"), "preserve author data\n");
    assert.equal(await readFile(join(originalPrevious, "old.txt"), "utf8"), "old reproduction\n");
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("the next reproduction restores a crash-interrupted first rename before its own build", async () => {
  const fixture = await interruptedTransactionFixture("velar-repro-recover-first-rename", "first-renamed");
  try {
    await assert.rejects(writeReproductionOutput({
      projectRoot: fixture.root,
      outputDirectory: fixture.target,
      requestedOutput: null,
      defaultOutputName: ".velar/repro",
    }, async () => { throw new Error("simulated next build failure"); }), /simulated next build failure/u);
    assert.equal(await readFile(join(fixture.target, "old.txt"), "utf8"), "old reproduction\n");
    assert.deepEqual(await readdir(fixture.root), ["bundle"]);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("the next reproduction finishes cleanup after a crash-interrupted commit", async () => {
  const fixture = await interruptedTransactionFixture("velar-repro-recover-installed", "installed");
  try {
    await assert.rejects(writeReproductionOutput({
      projectRoot: fixture.root,
      outputDirectory: fixture.target,
      requestedOutput: null,
      defaultOutputName: ".velar/repro",
    }, async () => { throw new Error("simulated next build failure"); }), /simulated next build failure/u);
    assert.equal(await readFile(join(fixture.target, "new.txt"), "utf8"), "new reproduction\n");
    assert.deepEqual(await readdir(fixture.root), ["bundle"]);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("the next reproduction finishes a crash-interrupted old-tree cleanup from bound recovery", async () => {
  const fixture = await interruptedTransactionFixture("velar-repro-recover-cleanup", "installed");
  const recovery = `${fixture.staging}-recovery`;
  try {
    await cp(fixture.previous, recovery, { recursive: true, force: false, errorOnExist: true });
    const recoveryMetadata = await lstat(recovery);
    const evidence = JSON.parse(await readFile(fixture.evidence, "utf8")) as Record<string, unknown>;
    evidence.recoveryIdentity = { device: recoveryMetadata.dev, inode: recoveryMetadata.ino };
    await writeFile(fixture.evidence, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
    await rm(fixture.previous, { recursive: true, force: true });
    await assert.rejects(writeReproductionOutput({
      projectRoot: fixture.root,
      outputDirectory: fixture.target,
      requestedOutput: null,
      defaultOutputName: ".velar/repro",
    }, async () => { throw new Error("simulated next build failure"); }), /simulated next build failure/u);
    assert.equal(await readFile(join(fixture.target, "new.txt"), "utf8"), "new reproduction\n");
    assert.deepEqual(await readdir(fixture.root), ["bundle"]);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("crash recovery preserves a new author directory swapped into previous", async () => {
  const fixture = await interruptedTransactionFixture("velar-repro-recover-previous-swap", "first-renamed");
  const originalPrevious = join(fixture.root, "original-previous");
  let staged = false;
  try {
    await rename(fixture.previous, originalPrevious);
    await write(join(fixture.previous, "thesis.txt"), "preserve author data\n");
    await assert.rejects(writeReproductionOutput({
      projectRoot: fixture.root,
      outputDirectory: fixture.target,
      requestedOutput: null,
      defaultOutputName: ".velar/repro",
    }, async () => { staged = true; }), /changed physical identity/u);
    assert.equal(staged, false, "recovery must finish before the next staging callback starts");
    assert.equal(await readFile(join(fixture.previous, "thesis.txt"), "utf8"), "preserve author data\n");
    assert.equal(await readFile(join(originalPrevious, "old.txt"), "utf8"), "old reproduction\n");
    assert.equal(await readFile(join(fixture.staging, "new.txt"), "utf8"), "new reproduction\n");
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("crash recovery preserves a new author directory created at the missing target", async () => {
  const fixture = await interruptedTransactionFixture("velar-repro-recover-target-author", "first-renamed");
  let staged = false;
  try {
    await write(join(fixture.target, "thesis.txt"), "preserve author data\n");
    await assert.rejects(writeReproductionOutput({
      projectRoot: fixture.root,
      outputDirectory: fixture.target,
      requestedOutput: null,
      defaultOutputName: ".velar/repro",
    }, async () => { staged = true; }), /changed physical identity/u);
    assert.equal(staged, false);
    assert.equal(await readFile(join(fixture.target, "thesis.txt"), "utf8"), "preserve author data\n");
    assert.equal(await readFile(join(fixture.previous, "old.txt"), "utf8"), "old reproduction\n");
    assert.equal(await readFile(join(fixture.staging, "new.txt"), "utf8"), "new reproduction\n");
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("crash recovery rejects evidence whose inode changes while its paths are claimed", async () => {
  const fixture = await interruptedTransactionFixture("velar-repro-recover-evidence-swap", "first-renamed");
  const claim = await acquireBuildOutputClaim(fixture.target, "tree");
  try {
    const parentMetadata = await lstat(fixture.root);
    await assert.rejects(recoverReproductionOutputTransactions(
      fixture.target,
      { device: parentMetadata.dev, inode: parentMetadata.ino },
      claim,
      {
        afterTransactionClaim: async () => {
          const contents = await readFile(fixture.evidence, "utf8");
          const replacement = join(fixture.root, "replacement-evidence");
          const marker = join(fixture.staging, ".velar-reproduction-output-transaction.json");
          await writeFile(replacement, contents, { encoding: "utf8", flag: "wx" });
          await unlink(marker);
          await unlink(fixture.evidence);
          await link(replacement, fixture.evidence);
          await link(replacement, marker);
          await unlink(replacement);
        },
      },
    ), /changed while it was being claimed/u);
    assert.equal(await readFile(join(fixture.previous, "old.txt"), "utf8"), "old reproduction\n");
    assert.equal(await readFile(join(fixture.staging, "new.txt"), "utf8"), "new reproduction\n");
  } finally {
    await claim.release();
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("crash recovery rejects oversized linked evidence without changing either reproduction", async () => {
  const fixture = await interruptedTransactionFixture("velar-repro-recover-oversized-evidence", "first-renamed");
  const claim = await acquireBuildOutputClaim(fixture.target, "tree");
  try {
    const original = await readFile(fixture.evidence, "utf8");
    const oversized = original + " ".repeat(TRANSACTION_JSON_MAX_BYTES);
    await writeFile(fixture.evidence, oversized, "utf8");
    const parentMetadata = await lstat(fixture.root);
    await assert.rejects(recoverReproductionOutputTransactions(
      fixture.target,
      { device: parentMetadata.dev, inode: parentMetadata.ino },
      claim,
    ), /exceeds 65536 bytes/u);
    assert.equal(await readFile(fixture.evidence, "utf8"), oversized);
    assert.equal(await readFile(join(fixture.previous, "old.txt"), "utf8"), "old reproduction\n");
    assert.equal(await readFile(join(fixture.staging, "new.txt"), "utf8"), "new reproduction\n");
  } finally {
    await claim.release();
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("crash recovery bounds matching parent transaction candidates before reading evidence", async () => {
  const root = await temporaryRoot("velar-repro-recover-candidate-limit");
  const target = join(root, "bundle");
  await write(join(target, "author.txt"), "preserve author data\n");
  for (let index = 0; index <= TRANSACTION_CANDIDATE_LIMIT; index += 1) {
    await write(join(root, `.velar-bundle-repro-${String(index).padStart(8, "0")}.velar-transaction.json`), "{}\n");
  }
  const claim = await acquireBuildOutputClaim(target, "tree");
  try {
    const parentMetadata = await lstat(root);
    await assert.rejects(recoverReproductionOutputTransactions(
      target,
      { device: parentMetadata.dev, inode: parentMetadata.ino },
      claim,
    ), /exceeds 128 candidates/u);
    assert.equal(await readFile(join(target, "author.txt"), "utf8"), "preserve author data\n");
  } finally {
    await claim.release();
    await rm(root, { recursive: true, force: true });
  }
});

test("an oversized previous reproduction is restored before the new tree becomes visible", async () => {
  const root = await temporaryRoot("velar-repro-previous-file-limit");
  const target = join(root, "bundle");
  const oversized = join(target, "author-large.bin");
  try {
    await write(join(target, "old.txt"), "old reproduction\n");
    await write(oversized, "author bytes\n");
    await truncate(oversized, MAX_PRODUCTION_FILE_BYTES + 1);
    await assert.rejects(writeReproductionOutput({
      projectRoot: root,
      outputDirectory: target,
      requestedOutput: null,
      defaultOutputName: ".velar/repro",
    }, async (staging) => {
      await write(join(staging, "new.txt"), "new reproduction\n");
      return null;
    }), /Previous reproduction directory file 'author-large\.bin' exceeds 268435456 bytes/u);
    assert.equal(await readFile(join(target, "old.txt"), "utf8"), "old reproduction\n");
    assert.equal((await lstat(oversized)).size, MAX_PRODUCTION_FILE_BYTES + 1);
    assert.deepEqual(await readdir(root), ["bundle"]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("an empty explicit output argument is rejected before any directory is created", async () => {
  const root = await temporaryRoot("velar-repro-empty-output");
  try {
    await assert.rejects(writeReproductionOutput({
      projectRoot: root,
      outputDirectory: join(root, ".velar", "repro"),
      requestedOutput: "",
      defaultOutputName: ".velar/repro",
    }, async () => null), /output directory cannot be empty/u);
    assert.deepEqual(await readdir(root), []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

interface ReplacementFixture {
  readonly root: string;
  readonly target: string;
  readonly staging: string;
  readonly previous: string;
  readonly recovery: string;
  readonly evidence: string;
  readonly evidenceContents: string;
  readonly transaction: ReproductionReplacement;
}

interface InterruptedTransactionFixture {
  readonly root: string;
  readonly target: string;
  readonly staging: string;
  readonly previous: string;
  readonly evidence: string;
}

async function interruptedTransactionFixture(
  name: string,
  phase: "first-renamed" | "installed",
): Promise<InterruptedTransactionFixture> {
  const root = await temporaryRoot(name);
  const target = join(root, "bundle");
  const token = phase === "first-renamed"
    ? "77777777-7777-4777-8777-777777777777"
    : "88888888-8888-4888-8888-888888888888";
  const staging = join(root, `.velar-bundle-repro-${token}`);
  const previous = `${staging}-previous`;
  const recovery = `${staging}-recovery`;
  const evidence = `${staging}.velar-transaction.json`;
  await write(join(target, "old.txt"), "old reproduction\n");
  await write(join(staging, "new.txt"), "new reproduction\n");
  const [parentMetadata, targetMetadata, stagingMetadata] = await Promise.all([
    lstat(root),
    lstat(target),
    lstat(staging),
  ]);
  await writeFile(evidence, `${JSON.stringify({
    formatVersion: 2,
    kind: "velar-reproduction-output-transaction",
    ownerPid: 2_147_483_647,
    token,
    target,
    staging,
    previous,
    recovery,
    recoveryIdentity: null,
    parent: root,
    parentIdentity: { device: parentMetadata.dev, inode: parentMetadata.ino },
    targetSnapshot: {
      status: "directory",
      identity: { device: targetMetadata.dev, inode: targetMetadata.ino },
      empty: false,
    },
    stagingIdentity: { device: stagingMetadata.dev, inode: stagingMetadata.ino },
  }, null, 2)}\n`, "utf8");
  await link(evidence, join(staging, ".velar-reproduction-output-transaction.json"));
  await rename(target, previous);
  if (phase === "installed") await rename(staging, target);
  return { root, target, staging, previous, evidence };
}

async function replacementFixture(name: string): Promise<ReplacementFixture> {
  const root = await temporaryRoot(name);
  const target = join(root, "bundle");
  const token = "99999999-9999-4999-8999-999999999999";
  const staging = join(root, `.velar-bundle-repro-${token}`);
  const previous = `${staging}-previous`;
  const recovery = `${staging}-recovery`;
  const evidence = `${staging}.velar-transaction.json`;
  await write(join(target, "old.txt"), "old reproduction\n");
  await write(join(staging, "new.txt"), "new reproduction\n");
  const [parentMetadata, targetMetadata, stagingMetadata] = await Promise.all([
    lstat(root),
    lstat(target),
    lstat(staging),
  ]);
  const evidenceContents = `${JSON.stringify({
    formatVersion: 2,
    kind: "velar-reproduction-output-transaction",
    ownerPid: process.pid,
    token,
    target,
    staging,
    previous,
    recovery,
    recoveryIdentity: null,
    parent: root,
    parentIdentity: { device: parentMetadata.dev, inode: parentMetadata.ino },
    targetSnapshot: {
      status: "directory",
      identity: { device: targetMetadata.dev, inode: targetMetadata.ino },
      empty: false,
    },
    stagingIdentity: { device: stagingMetadata.dev, inode: stagingMetadata.ino },
  }, null, 2)}\n`;
  await write(evidence, evidenceContents);
  await link(evidence, join(staging, ".velar-reproduction-output-transaction.json"));
  const evidenceMetadata = await lstat(evidence);
  return {
    root,
    target,
    staging,
    previous,
    recovery,
    evidence,
    evidenceContents,
    transaction: {
      paths: { target, staging, previous, recovery, transactionEvidence: evidence },
      parent: root,
      parentIdentity: await inspectOrdinaryDirectory(root, "fixture parent"),
      targetSnapshot: await inspectReproductionTarget(target, false, target),
      stagingIdentity: await inspectOrdinaryDirectory(staging, "fixture staging"),
      evidenceIdentity: { device: evidenceMetadata.dev, inode: evidenceMetadata.ino },
      evidenceContents,
      recoveryIdentity: null,
      explicitOutput: false,
    },
  };
}

function replacementOperations(
  overrides: Partial<ReproductionReplacementOperations>,
): ReproductionReplacementOperations {
  return {
    rename,
    copyTree: copyReproductionSnapshot,
    removeTree: async (path) => rm(path, { recursive: true, force: true }),
    removeFile: async (path) => rm(path, { force: true }),
    ...overrides,
  };
}

function isMissing(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}
