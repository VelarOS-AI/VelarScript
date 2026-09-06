import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { link, lstat, mkdir, mkdtemp, readFile, realpath, rename, rm, truncate, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import type { ProjectResult } from "../packages/cli/src/project.ts";
import {
  captureStandaloneOutputIdentity,
  type StandaloneJournalOperation,
} from "../packages/cli/src/standalone-output-recovery.ts";
import {
  STANDALONE_TRANSACTION_EVIDENCE_MARKER,
  STANDALONE_TRANSACTION_MARKER,
} from "../packages/cli/src/standalone-output-ownership.ts";
import {
  MAX_STANDALONE_TRANSACTION_METADATA_BYTES,
  MAX_STANDALONE_TRANSACTION_OPERATIONS,
  writeStandaloneOutputTransaction,
} from "../packages/cli/src/standalone-output-transaction.ts";

interface InterruptedFixture {
  readonly root: string;
  readonly source: string;
  readonly output: string;
  readonly staging: string;
  readonly backup: string;
  readonly evidence: string;
  readonly installedBytes: string;
  readonly previousBytes: string;
}

type TransactionPhase = "staging" | "installing" | "installed";

interface InterruptedFixtureOptions {
  readonly journalPhase?: TransactionPhase;
  readonly evidencePhase?: TransactionPhase;
  readonly journalOperations?: "empty" | "planned";
  readonly state?: "prepared" | "installed";
}

test("standalone recovery preserves a main output written after the interrupted install", async () => {
  const fixture = await interruptedFixture("velar-standalone-later-author");
  try {
    const authorBytes = "later author output\n";
    const installedInode = (await lstat(fixture.output)).ino;
    await writeFile(fixture.output, authorBytes, "utf8");
    assert.equal((await lstat(fixture.output)).ino, installedInode, "content replacement keeps the recorded inode");

    await assert.rejects(runRecovery(fixture), /installed standalone output .* changed; backup .* was preserved/u);
    assert.equal(await readFile(fixture.output, "utf8"), authorBytes);
    assert.equal(await readFile(fixture.backup, "utf8"), fixture.previousBytes);
    await assertRecoveryEvidencePreserved(fixture);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("standalone recovery rejects a same-content output that was replaced with another inode", async () => {
  const fixture = await interruptedFixture("velar-standalone-replaced-inode");
  try {
    const original = await lstat(fixture.output);
    await retainInstalledInodeAndReplace(fixture, fixture.installedBytes);
    assert.notEqual((await lstat(fixture.output)).ino, original.ino);

    await assert.rejects(runRecovery(fixture), /installed standalone output .* changed; backup .* was preserved/u);
    assert.equal(await readFile(fixture.output, "utf8"), fixture.installedBytes);
    assert.equal(await readFile(fixture.backup, "utf8"), fixture.previousBytes);
    await assertRecoveryEvidencePreserved(fixture);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("standalone recovery restores a valid interrupted install with matching identities", async () => {
  const fixture = await interruptedFixture("velar-standalone-valid-recovery");
  try {
    await assert.rejects(runRecovery(fixture), /deliberate stop after recovery/u);
    assert.equal(await readFile(fixture.output, "utf8"), fixture.previousBytes);
    await assert.rejects(lstat(fixture.staging), isMissing);
    await assert.rejects(lstat(fixture.evidence), isMissing);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("installed-phase cleanup keeps its backup when the committed target changed", async () => {
  const fixture = await interruptedFixture("velar-standalone-installed-target-change", { journalPhase: "installed" });
  try {
    const authorBytes = "author output after commit\n";
    await writeFile(fixture.output, authorBytes, "utf8");

    await assert.rejects(runRecovery(fixture), /committed standalone output .* changed; backup .* was preserved/u);
    assert.equal(await readFile(fixture.output, "utf8"), authorBytes);
    assert.equal(await readFile(fixture.backup, "utf8"), fixture.previousBytes);
    await assertRecoveryEvidencePreserved(fixture);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("standalone recovery refuses a journal phase not bound by its evidence", async () => {
  const fixture = await interruptedFixture("velar-standalone-phase-change", {
    journalPhase: "installed",
    evidencePhase: "installing",
  });
  try {
    await assert.rejects(runRecovery(fixture), /incomplete phase transition.*preserved/u);
    assert.equal(await readFile(fixture.output, "utf8"), fixture.installedBytes);
    assert.equal(await readFile(fixture.backup, "utf8"), fixture.previousBytes);
    await assertRecoveryEvidencePreserved(fixture);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("standalone recovery rejects an authenticated staging phase with operations", async () => {
  const fixture = await interruptedFixture("velar-standalone-invalid-staging-phase", {
    journalPhase: "staging",
    evidencePhase: "staging",
  });
  try {
    await assert.rejects(runRecovery(fixture), /invalid staging operation set.*preserved/u);
    assert.equal(await readFile(fixture.output, "utf8"), fixture.installedBytes);
    assert.equal(await readFile(fixture.backup, "utf8"), fixture.previousBytes);
    await assertRecoveryEvidencePreserved(fixture);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("standalone recovery preserves both normal phase-transition windows", async () => {
  const beforeInstall = await interruptedFixture("velar-standalone-enter-installing", {
    journalPhase: "staging",
    evidencePhase: "installing",
    journalOperations: "empty",
    state: "prepared",
  });
  const beforeCommit = await interruptedFixture("velar-standalone-enter-installed", {
    journalPhase: "installing",
    evidencePhase: "installed",
  });
  try {
    await assert.rejects(runRecovery(beforeInstall), /incomplete phase transition.*preserved/u);
    assert.equal(await readFile(beforeInstall.output, "utf8"), beforeInstall.previousBytes);
    assert.equal(await readFile(join(beforeInstall.staging, "main.js"), "utf8"), beforeInstall.installedBytes);
    await assertRecoveryEvidencePreserved(beforeInstall);

    await assert.rejects(runRecovery(beforeCommit), /incomplete phase transition.*preserved/u);
    assert.equal(await readFile(beforeCommit.output, "utf8"), beforeCommit.installedBytes);
    assert.equal(await readFile(beforeCommit.backup, "utf8"), beforeCommit.previousBytes);
    await assertRecoveryEvidencePreserved(beforeCommit);
  } finally {
    await rm(beforeInstall.root, { recursive: true, force: true });
    await rm(beforeCommit.root, { recursive: true, force: true });
  }
});

test("standalone recovery preserves oversized journal and evidence files without parsing them", async () => {
  for (const metadata of ["journal", "evidence"] as const) {
    const fixture = await interruptedFixture(`velar-standalone-oversized-${metadata}`);
    try {
      const path = metadata === "journal"
        ? join(fixture.staging, STANDALONE_TRANSACTION_MARKER)
        : fixture.evidence;
      await truncate(path, MAX_STANDALONE_TRANSACTION_METADATA_BYTES + 1);
      await assert.rejects(runRecovery(fixture), /transaction metadata .* exceeds/u);
      assert.equal((await lstat(path)).size, MAX_STANDALONE_TRANSACTION_METADATA_BYTES + 1);
      assert.equal(await readFile(fixture.output, "utf8"), fixture.installedBytes);
      assert.equal(await readFile(fixture.backup, "utf8"), fixture.previousBytes);
      await assertRecoveryEvidencePreserved(fixture);
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  }
});

test("standalone recovery rejects an unbounded operation roster before validating its members", async () => {
  const fixture = await interruptedFixture("velar-standalone-operation-limit");
  try {
    const journalPath = join(fixture.staging, STANDALONE_TRANSACTION_MARKER);
    const journal = JSON.parse(await readFile(journalPath, "utf8")) as {
      operations: Record<string, unknown>[];
    } & Record<string, unknown>;
    const operation = journal.operations[0]!;
    journal.operations = Array.from(
      {length: MAX_STANDALONE_TRANSACTION_OPERATIONS + 1},
      (_, index) => ({...operation, target: `target-${index}.js`}),
    );
    const oversizedRoster = `${JSON.stringify(journal)}\n`;
    assert.ok(Buffer.byteLength(oversizedRoster) <= MAX_STANDALONE_TRANSACTION_METADATA_BYTES);
    await writeFile(journalPath, oversizedRoster, "utf8");

    await assert.rejects(runRecovery(fixture), /exceeds the operation limit.*preserved/u);
    assert.equal(await readFile(fixture.output, "utf8"), fixture.installedBytes);
    assert.equal(await readFile(fixture.backup, "utf8"), fixture.previousBytes);
    await assertRecoveryEvidencePreserved(fixture);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

async function interruptedFixture(
  name: string,
  options: InterruptedFixtureOptions = {},
): Promise<InterruptedFixture> {
  const root = await mkdtemp(join(tmpdir(), `${name}-`));
  const source = join(root, "main.vel");
  const output = join(root, "dist", "main.js");
  const staging = join(dirname(output), `.velar-main.js-${randomUUID()}`);
  const backup = join(staging, ".previous", "0");
  const evidence = `${staging}.velar-transaction.json`;
  const installedBytes = "transaction-installed output\n";
  const previousBytes = "previous generated output\n";
  await write(source, 'print("unused")\n');
  await write(output, previousBytes);
  await mkdir(dirname(backup), { recursive: true });
  const previousIdentity = await captureStandaloneOutputIdentity(output, "file");
  const staged = join(staging, "main.js");
  await write(staged, installedBytes);
  const stagedIdentity = await captureStandaloneOutputIdentity(staged, "file");
  if ((options.state ?? "installed") === "installed") {
    await rename(output, backup);
    await rename(staged, output);
  }
  const operation: StandaloneJournalOperation = {
    target: "main.js",
    staged: "main.js",
    backup: ".previous/0",
    kind: "file",
    hadPrevious: true,
    stagedIdentity,
    previousIdentity,
  };
  const canonicalOutputRoot = await realpath(dirname(output));
  const canonicalStagingDirectory = await realpath(staging);
  const transactionToken = randomUUID();
  const ownerPid = 2_147_483_647;
  const operations = [operation];
  const journalOperations = options.journalOperations === "empty" ? [] : operations;
  const journalPhase = options.journalPhase ?? "installing";
  await write(join(staging, STANDALONE_TRANSACTION_MARKER), `${JSON.stringify({
    formatVersion: 2,
    kind: "velar-standalone-transaction",
    outputPath: output,
    stagingDirectory: staging,
    canonicalOutputRoot,
    canonicalStagingDirectory,
    ownerPid,
    transactionToken,
    phase: journalPhase,
    operations: journalOperations,
  }, null, 2)}\n`);
  const evidenceBytes = `${JSON.stringify({
    formatVersion: 2,
    kind: "velar-standalone-transaction-evidence",
    outputPath: output,
    stagingDirectory: staging,
    canonicalOutputRoot,
    canonicalStagingDirectory,
    ownerPid,
    transactionToken,
    phase: options.evidencePhase ?? journalPhase,
    operationsSha256: createHash("sha256").update(JSON.stringify(operations)).digest("hex"),
  }, null, 2)}\n`;
  await write(evidence, evidenceBytes);
  await link(evidence, join(staging, STANDALONE_TRANSACTION_EVIDENCE_MARKER));
  return { root, source, output, staging, backup, evidence, installedBytes, previousBytes };
}

async function runRecovery(fixture: InterruptedFixture): Promise<void> {
  const project = {
    modules: [{ inputPath: fixture.source, result: { dependencies: [], resources: [], runtimeModules: [] } }],
    compilerExtensions: [],
    extensionConfig: new Map(),
    publicRoot: join(fixture.root, "public"),
    velarPackages: [],
    resources: [],
    externalTypeDependencies: new Map(),
  } as unknown as ProjectResult;
  return writeStandaloneOutputTransaction({
    outputPath: fixture.output,
    project,
    runtimeModules: new Set(),
    claimedFiles: [fixture.output],
    cleanupFiles: [],
    generatedSiblingFiles: [],
    additionalInputs: [],
    observeClaimedStaging: async () => {
      throw new Error("deliberate stop after recovery");
    },
    writeStaged: async () => assert.fail("recovery test must stop before rendering"),
  });
}

async function retainInstalledInodeAndReplace(fixture: InterruptedFixture, contents: string): Promise<void> {
  await link(fixture.output, join(fixture.root, "retained-transaction-inode"));
  await rm(fixture.output);
  await write(fixture.output, contents);
}

async function assertRecoveryEvidencePreserved(fixture: InterruptedFixture): Promise<void> {
  assert.equal((await lstat(fixture.staging)).isDirectory(), true);
  assert.equal((await lstat(fixture.evidence)).isFile(), true);
  assert.equal((await lstat(join(fixture.staging, STANDALONE_TRANSACTION_EVIDENCE_MARKER))).isFile(), true);
}

async function write(path: string, contents: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, contents, "utf8");
}

function isMissing(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error
    && (error as { readonly code?: unknown }).code === "ENOENT";
}
