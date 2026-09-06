import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { cp, link, lstat, mkdir, mkdtemp, readdir, readFile, rename, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { acquireBuildOutputClaim } from "../packages/cli/src/build-output-claim.ts";
import { TRANSACTION_CANDIDATE_LIMIT, TRANSACTION_JSON_MAX_BYTES } from "../packages/cli/src/transaction-metadata.ts";
import { internalDependencyPinFailures, sourceHasExpectedTag } from "../scripts/release-toolchain.mjs";
import {
  acquireReleaseOutputClaim,
  recoverReleaseOutputTransactions,
  replaceReleaseDirectory,
} from "../scripts/release-output-transaction.mjs";
import { velarWorkspaceBuildOrder } from "../scripts/velar-packages.mjs";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));

test("toolchain release identity accepts its exact tag when sibling package tags share HEAD", () => {
  assert.equal(sourceHasExpectedTag({ tag: null, tags: ["@velarscript/core@0.14.6", "v0.14.6"] }, "v0.14.6"), true);
  assert.equal(sourceHasExpectedTag({ tag: null, tags: ["@velarscript/core@0.14.6"] }, "v0.14.6"), false);
  assert.equal(sourceHasExpectedTag({ tag: "v0.14.6" }, "v0.14.6"), true);
});

test("toolchain release exact-pins every first-party dependency edge", () => {
  const version = "9.8.7";
  const dependency = { name: "@velarscript/future-target" };
  for (const section of ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"] as const) {
    const packages = (declared: string) => [
      { name: "@velarscript/future-consumer", [section]: { [dependency.name]: declared } },
      dependency,
    ];
    assert.deepEqual(internalDependencyPinFailures(packages(version), version), []);
    for (const declared of [`^${version}`, "9.8.6"]) {
      assert.deepEqual(internalDependencyPinFailures(packages(declared), version), [
        `@velarscript/future-consumer ${section}.@velarscript/future-target must pin exact version ${version}, not ${JSON.stringify(declared)}`,
      ]);
    }
  }
});

test("one release lease claims every transaction path without claiming unrelated siblings", async () => {
  const temporary = await mkdtemp(join(tmpdir(), "velar-release-claims-"));
  const output = join(temporary, "candidate");
  const token = "11111111-1111-4111-8111-111111111111";
  try {
    const claim = await acquireReleaseOutputClaim(output, { token });
    try {
      assert.equal(claim.stagingDirectory, join(temporary, `.velar-candidate-release-staging-${token}`));
      assert.equal(claim.backupDirectory, join(temporary, `.velar-candidate-release-backup-${token}`));
      assert.equal(claim.transactionMarkerPath, join(claim.backupDirectory, ".velar-release-output-transaction.json"));
      assert.equal(claim.transactionAnchorPath, join(temporary, `.velar-candidate-release-transaction-${token}.json`));
      for (const [path, kind] of [
        [output, "tree"],
        [join(output, "nested.js"), "file"],
        [claim.stagingDirectory, "tree"],
        [claim.backupDirectory, "tree"],
        [claim.transactionMarkerPath, "file"],
        [claim.transactionAnchorPath, "file"],
      ] as const) {
        await assert.rejects(acquireBuildOutputClaim(path, kind), /overlaps active (?:file|tree) output/u);
      }
      const sibling = await acquireBuildOutputClaim(join(temporary, "independent-output"), "tree");
      await sibling.release();
    } finally {
      await claim.release();
    }
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

test("release directory replacement restores the previous output when commit rename fails", async () => {
  const temporary = await mkdtemp(join(tmpdir(), "velar-release-rollback-"));
  const output = join(temporary, "candidate");
  const claim = await acquireReleaseOutputClaim(output, { token: "22222222-2222-4222-8222-222222222222" });
  const staging = claim.stagingDirectory;
  let renames = 0;
  try {
    await mkdir(output);
    await mkdir(staging);
    await writeFile(join(output, "previous.txt"), "previous\n", "utf8");
    await writeFile(join(staging, "next.txt"), "next\n", "utf8");
    await assert.rejects(
      replaceReleaseDirectory(claim, async () => {}, {
        renamePath: async (source: string, destination: string) => {
          renames += 1;
          if (renames === 2) throw new Error("simulated commit rename failure");
          await rename(source, destination);
        },
      }),
      /simulated commit rename failure/u,
    );
    assert.equal(await readFile(join(output, "previous.txt"), "utf8"), "previous\n");
    assert.equal(await readFile(join(staging, "next.txt"), "utf8"), "next\n");
  } finally {
    await claim.release();
    await rm(temporary, { recursive: true, force: true });
  }
});

test("first-rename inode validation restores a target swapped in after preflight", async () => {
  const temporary = await mkdtemp(join(tmpdir(), "velar-release-target-swap-"));
  const output = join(temporary, "candidate");
  const original = join(temporary, "verified-target");
  const incoming = join(temporary, "incoming-author-directory");
  const claim = await acquireReleaseOutputClaim(output, { token: "99999999-9999-4999-8999-999999999999" });
  try {
    await mkdir(output);
    await mkdir(incoming);
    await mkdir(claim.stagingDirectory);
    await writeFile(join(output, "previous.txt"), "verified previous\n", "utf8");
    await writeFile(join(incoming, "keep.txt"), "preserve author data\n", "utf8");
    await writeFile(join(claim.stagingDirectory, "next.txt"), "next\n", "utf8");
    let renames = 0;
    await assert.rejects(
      replaceReleaseDirectory(claim, async () => {}, {
        renamePath: async (source: string, destination: string) => {
          renames += 1;
          if (renames === 1) {
            await rename(output, original);
            await rename(incoming, output);
          }
          await rename(source, destination);
        },
      }),
      /changed physical identity/u,
    );
    assert.equal(await readFile(join(output, "keep.txt"), "utf8"), "preserve author data\n");
    assert.equal(await readFile(join(original, "previous.txt"), "utf8"), "verified previous\n");
    assert.equal(await readFile(join(claim.stagingDirectory, "next.txt"), "utf8"), "next\n");
    assert.deepEqual((await readdir(temporary)).sort(), [
      basename(claim.stagingDirectory),
      "candidate",
      "verified-target",
    ].sort());
  } finally {
    await claim.release();
    await rm(temporary, { recursive: true, force: true });
  }
});

test("parent inode validation preserves transaction artifacts when the release parent is swapped", async () => {
  const temporary = await mkdtemp(join(tmpdir(), "velar-release-parent-swap-"));
  const parent = join(temporary, "release-parent");
  const movedParent = join(temporary, "moved-release-parent");
  const output = join(parent, "candidate");
  await mkdir(parent);
  const claim = await acquireReleaseOutputClaim(output, { token: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" });
  try {
    await mkdir(output);
    await mkdir(claim.stagingDirectory);
    await writeFile(join(output, "previous.txt"), "previous\n", "utf8");
    await writeFile(join(claim.stagingDirectory, "next.txt"), "next\n", "utf8");
    await assert.rejects(
      replaceReleaseDirectory(claim, async () => {}, {
        afterFirstRename: async () => {
          await rename(parent, movedParent);
          await mkdir(parent);
        },
      }),
      /could not be restored/u,
    );
    assert.deepEqual(await readdir(parent), []);
    assert.equal(
      await readFile(join(movedParent, basename(claim.backupDirectory), "previous", "previous.txt"), "utf8"),
      "previous\n",
    );
    assert.equal(
      await readFile(join(movedParent, basename(claim.stagingDirectory), "next.txt"), "utf8"),
      "next\n",
    );
    assert.equal(
      await readFile(join(movedParent, basename(claim.transactionAnchorPath)), "utf8"),
      await readFile(join(movedParent, basename(claim.backupDirectory), ".velar-release-output-transaction.json"), "utf8"),
    );
  } finally {
    await claim.release();
    await rm(temporary, { recursive: true, force: true });
  }
});

test("post-second-rename inode validation preserves both releases and transaction evidence", async () => {
  const temporary = await mkdtemp(join(tmpdir(), "velar-release-installed-swap-"));
  const output = join(temporary, "candidate");
  const installedStaging = join(temporary, "installed-staging");
  const incoming = join(temporary, "incoming-author-directory");
  const claim = await acquireReleaseOutputClaim(output, { token: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" });
  let removals = 0;
  try {
    await mkdir(output);
    await mkdir(incoming);
    await mkdir(claim.stagingDirectory);
    await writeFile(join(output, "previous.txt"), "previous\n", "utf8");
    await writeFile(join(incoming, "keep.txt"), "preserve author data\n", "utf8");
    await writeFile(join(claim.stagingDirectory, "next.txt"), "next\n", "utf8");
    await assert.rejects(
      replaceReleaseDirectory(claim, async () => {}, {
        removePath: async (path: string, options: { recursive: true; force: true }) => {
          removals += 1;
          await rm(path, options);
        },
        afterSecondRename: async () => {
          await rename(output, installedStaging);
          await rename(incoming, output);
        },
      }),
      /physical identity could not be verified/u,
    );
    assert.equal(removals, 0, "an unverified installed inode must not enter transaction cleanup");
    assert.equal(await readFile(join(output, "keep.txt"), "utf8"), "preserve author data\n");
    assert.equal(await readFile(join(installedStaging, "next.txt"), "utf8"), "next\n");
    assert.equal(await readFile(join(claim.backupDirectory, "previous", "previous.txt"), "utf8"), "previous\n");
    assert.equal(
      await readFile(claim.transactionAnchorPath, "utf8"),
      await readFile(claim.transactionMarkerPath, "utf8"),
    );
  } finally {
    await claim.release();
    await rm(temporary, { recursive: true, force: true });
  }
});

test("post-commit previous swap is preserved before cleanup", async () => {
  const temporary = await mkdtemp(join(tmpdir(), "velar-release-previous-swap-"));
  const output = join(temporary, "candidate");
  const displaced = join(temporary, "verified-previous");
  const claim = await acquireReleaseOutputClaim(output, { token: "12121212-1212-4212-8212-121212121212" });
  try {
    await mkdir(output);
    await mkdir(claim.stagingDirectory);
    await writeFile(join(output, "previous.txt"), "previous\n", "utf8");
    await writeFile(join(claim.stagingDirectory, "next.txt"), "next\n", "utf8");
    await assert.rejects(
      replaceReleaseDirectory(claim, async () => {}, {
        afterSecondRename: async () => {
          const previous = join(claim.backupDirectory, "previous");
          await rename(previous, displaced);
          await mkdir(previous);
          await writeFile(join(previous, "author.txt"), "author\n", "utf8");
        },
      }),
      /physical identity could not be verified/u,
    );
    assert.equal(await readFile(join(output, "next.txt"), "utf8"), "next\n");
    assert.equal(await readFile(join(displaced, "previous.txt"), "utf8"), "previous\n");
    assert.equal(await readFile(join(claim.backupDirectory, "previous", "author.txt"), "utf8"), "author\n");
    assert.equal(await readFile(claim.transactionMarkerPath, "utf8"), await readFile(claim.transactionAnchorPath, "utf8"));
  } finally {
    await claim.release();
    await rm(temporary, { recursive: true, force: true });
  }
});

test("post-commit evidence swap is preserved before cleanup", async () => {
  const temporary = await mkdtemp(join(tmpdir(), "velar-release-evidence-swap-"));
  const output = join(temporary, "candidate");
  const claim = await acquireReleaseOutputClaim(output, { token: "13131313-1313-4313-8313-131313131313" });
  try {
    await mkdir(output);
    await mkdir(claim.stagingDirectory);
    await writeFile(join(output, "previous.txt"), "previous\n", "utf8");
    await writeFile(join(claim.stagingDirectory, "next.txt"), "next\n", "utf8");
    await assert.rejects(
      replaceReleaseDirectory(claim, async () => {}, {
        afterSecondRename: async () => {
          await unlink(claim.transactionMarkerPath);
          await unlink(claim.transactionAnchorPath);
          await writeFile(claim.transactionMarkerPath, "author evidence\n", { encoding: "utf8", flag: "wx" });
          await link(claim.transactionMarkerPath, claim.transactionAnchorPath);
        },
      }),
      /physical identity could not be verified/u,
    );
    assert.equal(await readFile(join(output, "next.txt"), "utf8"), "next\n");
    assert.equal(await readFile(join(claim.backupDirectory, "previous", "previous.txt"), "utf8"), "previous\n");
    assert.equal(await readFile(claim.transactionMarkerPath, "utf8"), "author evidence\n");
    assert.equal(await readFile(claim.transactionAnchorPath, "utf8"), "author evidence\n");
  } finally {
    await claim.release();
    await rm(temporary, { recursive: true, force: true });
  }
});

test("cleanup quarantine restores an author directory swapped in at its rename boundary", async () => {
  const temporary = await mkdtemp(join(tmpdir(), "velar-release-cleanup-swap-"));
  const output = join(temporary, "candidate");
  const displaced = join(temporary, "verified-previous");
  const claim = await acquireReleaseOutputClaim(output, { token: "14141414-1414-4414-8414-141414141414" });
  let renames = 0;
  let removals = 0;
  try {
    await mkdir(output);
    await mkdir(claim.stagingDirectory);
    await writeFile(join(output, "previous.txt"), "previous\n", "utf8");
    await writeFile(join(claim.stagingDirectory, "next.txt"), "next\n", "utf8");
    await replaceReleaseDirectory(claim, async () => {}, {
      renamePath: async (source: string, destination: string) => {
        renames += 1;
        if (renames === 3) {
          await rename(source, displaced);
          await mkdir(source);
          await writeFile(join(source, "author.txt"), "author\n", "utf8");
        }
        await rename(source, destination);
      },
      removePath: async (path: string, options: { recursive: true; force: true }) => {
        removals += 1;
        await rm(path, options);
      },
    });
    assert.equal(removals, 0, "a mismatched quarantine inode must not be recursively removed");
    assert.equal(await readFile(join(output, "next.txt"), "utf8"), "next\n");
    assert.equal(await readFile(join(displaced, "previous.txt"), "utf8"), "previous\n");
    assert.equal(await readFile(join(claim.backupDirectory, "previous", "author.txt"), "utf8"), "author\n");
    assert.equal(await readFile(claim.transactionMarkerPath, "utf8"), await readFile(claim.transactionAnchorPath, "utf8"));
  } finally {
    await claim.release();
    await rm(temporary, { recursive: true, force: true });
  }
});

test("a committed release stays successful when backup cleanup fails and the next run reclaims it", async () => {
  const temporary = await mkdtemp(join(tmpdir(), "velar-release-cleanup-"));
  const output = join(temporary, "candidate");
  const firstClaim = await acquireReleaseOutputClaim(output, { token: "33333333-3333-4333-8333-333333333333" });
  let recoveryClaim: Awaited<ReturnType<typeof acquireReleaseOutputClaim>> | null = null;
  let blocker: Awaited<ReturnType<typeof acquireBuildOutputClaim>> | null = null;
  try {
    await mkdir(output);
    await mkdir(firstClaim.stagingDirectory);
    await writeFile(join(output, "previous.txt"), "previous\n", "utf8");
    await writeFile(join(firstClaim.stagingDirectory, "next.txt"), "next\n", "utf8");
    await replaceReleaseDirectory(firstClaim, async () => {}, {
      removePath: async () => { throw new Error("simulated backup cleanup failure"); },
    });
    assert.equal(await readFile(join(output, "next.txt"), "utf8"), "next\n");
    assert.ok((await readdir(temporary)).includes(basename(firstClaim.backupDirectory)));
    const persisted = JSON.parse(await readFile(firstClaim.transactionMarkerPath, "utf8"));
    assert.equal(persisted.formatVersion, 2);
    assert.equal(persisted.stagingDirectory, firstClaim.stagingDirectory);
    assert.equal(persisted.previousDirectory, join(firstClaim.backupDirectory, "previous"));
    assert.deepEqual(await directoryIdentity(output), persisted.stagingIdentity);
    assert.deepEqual(await directoryIdentity(firstClaim.stagingDirectory), persisted.previousIdentity);
    assert.deepEqual(await directoryIdentity(firstClaim.backupDirectory), persisted.backupIdentity);
    await firstClaim.release();

    blocker = await acquireBuildOutputClaim(firstClaim.backupDirectory, "tree");
    recoveryClaim = await acquireReleaseOutputClaim(output, { token: "44444444-4444-4444-8444-444444444444" });
    await assert.rejects(
      recoverReleaseOutputTransactions(recoveryClaim, async () => {}),
      /overlaps active tree output/u,
    );
    assert.equal(await readFile(join(firstClaim.stagingDirectory, "previous.txt"), "utf8"), "previous\n");
    await blocker.release();
    blocker = null;
    await recoverReleaseOutputTransactions(recoveryClaim, async () => {});
    assert.deepEqual(await readdir(temporary), ["candidate"]);
  } finally {
    await blocker?.release();
    await recoveryClaim?.release();
    await firstClaim.release();
    await rm(temporary, { recursive: true, force: true });
  }
});

test("exact-shape forged release transaction records cannot delete a user directory", async () => {
  const temporary = await mkdtemp(join(tmpdir(), "velar-release-forged-state-"));
  const output = join(temporary, "candidate");
  const backup = join(temporary, ".velar-candidate-release-backup-forged");
  const previous = join(backup, "previous");
  const token = "55555555-5555-4555-8555-555555555555";
  const anchor = join(temporary, `.velar-candidate-release-transaction-${token}.json`);
  await mkdir(output);
  await mkdir(previous, { recursive: true });
  await writeFile(join(previous, "keep.txt"), "keep\n", "utf8");
  const forgedRecord = `${JSON.stringify({
    formatVersion: 1,
    kind: "velar-release-output-transaction",
    outputDirectory: output,
    backupDirectory: backup,
    anchorPath: anchor,
    ownerPid: 2_147_483_647,
    token,
  })}\n`;
  // These records have the exact expected paths, bytes, and directory shape,
  // but were independently written rather than hard-linked by one transaction.
  await writeFile(join(backup, ".velar-release-output-transaction.json"), forgedRecord, "utf8");
  await writeFile(anchor, forgedRecord, "utf8");
  const claim = await acquireReleaseOutputClaim(output, { token: "66666666-6666-4666-8666-666666666666" });
  try {
    await recoverReleaseOutputTransactions(claim, async () => {});
    assert.equal(await readFile(join(previous, "keep.txt"), "utf8"), "keep\n");
    assert.deepEqual((await readdir(backup)).sort(), [".velar-release-output-transaction.json", "previous"]);
    assert.equal(await readFile(anchor, "utf8"), forgedRecord);
  } finally {
    await claim.release();
    await rm(temporary, { recursive: true, force: true });
  }
});

test("release recovery rejects evidence whose inode changes while its paths are claimed", async () => {
  const temporary = await mkdtemp(join(tmpdir(), "velar-release-evidence-race-"));
  const output = join(temporary, "candidate");
  const staleToken = "77777777-7777-4777-8777-777777777777";
  const backup = join(temporary, `.velar-candidate-release-backup-${staleToken}`);
  await mkdir(output);
  const staging = join(temporary, `.velar-candidate-release-staging-${staleToken}`);
  await mkdir(staging);
  await mkdir(backup);
  await writeFile(join(output, "previous.txt"), "previous\n", "utf8");
  await writeFile(join(staging, "current.txt"), "current\n", "utf8");
  const targetSnapshot = { status: "directory" as const, identity: await directoryIdentity(output) };
  const { marker, anchor, contents: record } = await writeReleaseTransactionEvidence(
    output, staging, backup, staleToken, targetSnapshot,
  );
  const previous = join(backup, "previous");
  await rename(output, previous);
  await rename(staging, output);
  const claim = await acquireReleaseOutputClaim(output, { token: "88888888-8888-4888-8888-888888888888" });
  try {
    await assert.rejects(
      recoverReleaseOutputTransactions(claim, async () => {}, {
        afterTransactionClaim: async () => {
          const replacement = join(temporary, "replacement-evidence");
          await writeFile(replacement, record, { encoding: "utf8", flag: "wx" });
          await unlink(anchor);
          await unlink(marker);
          await link(replacement, marker);
          await link(replacement, anchor);
          await unlink(replacement);
        },
      }),
      /changed while its paths were being claimed/u,
    );
    assert.equal(await readFile(join(output, "current.txt"), "utf8"), "current\n");
    assert.equal(await readFile(join(previous, "previous.txt"), "utf8"), "previous\n");
    assert.equal(await readFile(marker, "utf8"), record);
    assert.equal(await readFile(anchor, "utf8"), record);
  } finally {
    await claim.release();
    await rm(temporary, { recursive: true, force: true });
  }
});

test("release recovery rejects oversized linked evidence and preserves both releases", async () => {
  const temporary = await mkdtemp(join(tmpdir(), "velar-release-oversized-evidence-"));
  const staleToken = "24242424-2424-4424-8424-242424242424";
  const fixture = await prepareReleaseCrashState(temporary, staleToken, "second");
  const original = await readFile(fixture.marker, "utf8");
  const oversized = original + " ".repeat(TRANSACTION_JSON_MAX_BYTES);
  await writeFile(fixture.marker, oversized, "utf8");
  const claim = await acquireReleaseOutputClaim(fixture.output, { token: "25252525-2525-4525-8525-252525252525" });
  try {
    await assert.rejects(recoverReleaseOutputTransactions(claim, async () => {}), /exceeds 65536 bytes/u);
    assert.equal(await readFile(join(fixture.output, "next.txt"), "utf8"), "next\n");
    assert.equal(await readFile(join(fixture.previous, "previous.txt"), "utf8"), "previous\n");
    assert.equal(await readFile(fixture.marker, "utf8"), oversized);
    assert.equal(await readFile(fixture.anchor, "utf8"), oversized);
  } finally {
    await claim.release();
    await rm(temporary, { recursive: true, force: true });
  }
});

test("release recovery bounds matching parent transaction directories", async () => {
  const temporary = await mkdtemp(join(tmpdir(), "velar-release-candidate-limit-"));
  const output = join(temporary, "candidate");
  await mkdir(output);
  await writeFile(join(output, "author.txt"), "preserve author data\n", "utf8");
  for (let index = 0; index <= TRANSACTION_CANDIDATE_LIMIT; index += 1) {
    await mkdir(join(temporary, `.velar-candidate-release-backup-${String(index).padStart(8, "0")}`));
  }
  const claim = await acquireReleaseOutputClaim(output, { token: "26262626-2626-4626-8626-262626262626" });
  try {
    await assert.rejects(recoverReleaseOutputTransactions(claim, async () => {}), /exceeds 128 candidates/u);
    assert.equal(await readFile(join(output, "author.txt"), "utf8"), "preserve author data\n");
  } finally {
    await claim.release();
    await rm(temporary, { recursive: true, force: true });
  }
});

test("release recovery reconciles persisted first-rename, commit, and cleanup crash states", async (context) => {
  for (const [phase, recoveryToken, expectedFile] of [
    ["first", "15151515-1515-4515-8515-151515151515", "previous.txt"],
    ["second", "16161616-1616-4616-8616-161616161616", "next.txt"],
    ["quarantine", "17171717-1717-4717-8717-171717171717", "next.txt"],
  ] as const) {
    await context.test(phase, async () => {
      const temporary = await mkdtemp(join(tmpdir(), `velar-release-crash-${phase}-`));
      const staleToken = `${phase === "first" ? "18181818-1818-4818-8818-181818181818" : phase === "second" ? "19191919-1919-4919-8919-191919191919" : "20202020-2020-4020-8020-202020202020"}`;
      const fixture = await prepareReleaseCrashState(temporary, staleToken, phase);
      const claim = await acquireReleaseOutputClaim(fixture.output, { token: recoveryToken });
      const validated: string[] = [];
      try {
        await recoverReleaseOutputTransactions(claim, async (path) => { validated.push(path); });
        assert.equal(await readFile(join(fixture.output, expectedFile), "utf8"), phase === "first" ? "previous\n" : "next\n");
        assert.deepEqual((await readdir(temporary)).sort(), ["candidate"]);
        assert.ok(validated.includes(fixture.output), "the visible release must pass the complete verifier");
        assert.ok(
          validated.includes(phase === "second" ? fixture.previous : fixture.staging),
          "the retained release inode must pass the complete verifier",
        );
      } finally {
        await claim.release();
        await rm(temporary, { recursive: true, force: true });
      }
    });
  }
});

test("release recovery preserves a new author directory at a recorded stale staging path", async () => {
  const temporary = await mkdtemp(join(tmpdir(), "velar-release-stale-staging-swap-"));
  const staleToken = "21212121-2121-4121-8121-212121212121";
  const fixture = await prepareReleaseCrashState(temporary, staleToken, "preflight");
  const displaced = join(temporary, "verified-staging");
  await rename(fixture.staging, displaced);
  await mkdir(fixture.staging);
  await writeFile(join(fixture.staging, "author.txt"), "author\n", "utf8");
  const claim = await acquireReleaseOutputClaim(fixture.output, { token: "23232323-2323-4323-8323-232323232323" });
  try {
    await assert.rejects(
      recoverReleaseOutputTransactions(claim, async () => {}),
      /persisted directory identities/u,
    );
    assert.equal(await readFile(join(fixture.output, "previous.txt"), "utf8"), "previous\n");
    assert.equal(await readFile(join(fixture.staging, "author.txt"), "utf8"), "author\n");
    assert.equal(await readFile(join(displaced, "next.txt"), "utf8"), "next\n");
    assert.equal(await readFile(fixture.marker, "utf8"), await readFile(fixture.anchor, "utf8"));
  } finally {
    await claim.release();
    await rm(temporary, { recursive: true, force: true });
  }
});

test("publication rehearsal emits reproducible verified package identities without publishing", async () => {
  const temporary = await mkdtemp(join(tmpdir(), "velar-release-rehearsal-"));
  const workspaceOutputs = await protectWorkspaceOutputs("release");
  const first = join(temporary, "first");
  const second = join(temporary, "second");
  try {
    await runRelease(["rehearse", "--output-dir", first]);
    await runRelease(["verify", first]);
    await runRelease(["rehearse", "--output-dir", first]);
    await runRelease(["verify", first]);
    await runRelease(["rehearse", "--output-dir", second]);
    const firstManifest = JSON.parse(await readFile(join(first, "velar-toolchain-release.json"), "utf8"));
    const secondManifest = JSON.parse(await readFile(join(second, "velar-toolchain-release.json"), "utf8"));
    assert.equal(firstManifest.version, "0.29.2");
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
    await writeFile(join(unrelated, "velar-toolchain-release.json"), `${JSON.stringify({
      formatVersion: 1,
      kind: "velar-toolchain-release",
    })}\n`, "utf8");
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

type ReleaseDirectoryIdentity = { readonly dev: number; readonly ino: number };
type ReleaseTargetSnapshot = { readonly status: "missing" }
  | { readonly status: "directory"; readonly identity: ReleaseDirectoryIdentity };

async function directoryIdentity(path: string): Promise<ReleaseDirectoryIdentity> {
  const metadata = await lstat(path);
  return { dev: metadata.dev, ino: metadata.ino };
}

async function writeReleaseTransactionEvidence(
  output: string,
  staging: string,
  backup: string,
  token: string,
  targetSnapshot: ReleaseTargetSnapshot,
) {
  const parent = dirname(output);
  const marker = join(backup, ".velar-release-output-transaction.json");
  const anchor = join(parent, `.velar-${basename(output)}-release-transaction-${token}.json`);
  const contents = `${JSON.stringify({
    formatVersion: 2,
    kind: "velar-release-output-transaction",
    outputDirectory: output,
    parentDirectory: parent,
    parentIdentity: await directoryIdentity(parent),
    targetSnapshot,
    previousDirectory: join(backup, "previous"),
    previousIdentity: targetSnapshot.status === "directory" ? targetSnapshot.identity : null,
    stagingDirectory: staging,
    stagingIdentity: await directoryIdentity(staging),
    backupDirectory: backup,
    backupIdentity: await directoryIdentity(backup),
    anchorPath: anchor,
    ownerPid: 2_147_483_647,
    token,
  })}\n`;
  await writeFile(marker, contents, { encoding: "utf8", flag: "wx" });
  await link(marker, anchor);
  return { marker, anchor, contents };
}

async function prepareReleaseCrashState(
  temporary: string,
  token: string,
  phase: "preflight" | "first" | "second" | "quarantine",
) {
  const output = join(temporary, "candidate");
  const staging = join(temporary, `.velar-candidate-release-staging-${token}`);
  const backup = join(temporary, `.velar-candidate-release-backup-${token}`);
  const previous = join(backup, "previous");
  await mkdir(output);
  await mkdir(staging);
  await mkdir(backup);
  await writeFile(join(output, "previous.txt"), "previous\n", "utf8");
  await writeFile(join(staging, "next.txt"), "next\n", "utf8");
  const targetSnapshot = { status: "directory" as const, identity: await directoryIdentity(output) };
  const evidence = await writeReleaseTransactionEvidence(output, staging, backup, token, targetSnapshot);
  if (phase !== "preflight") await rename(output, previous);
  if (phase === "second" || phase === "quarantine") await rename(staging, output);
  if (phase === "quarantine") await rename(previous, staging);
  return { output, staging, backup, previous, ...evidence };
}

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
