import { link, lstat, mkdir, open, opendir, rename, unlink, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { basename, isAbsolute, join, relative, resolve } from "node:path";
import { tmpdir } from "node:os";
import { canonicalizePotentialPath } from "./canonical-path.ts";
import { readBoundedFileHandle } from "./bounded-text.ts";
import { isHostErrorCode } from "./host-error.ts";
import { unicodeFilesystemComparisonKey } from "./portable-artifact-path.ts";

export type BuildOutputKind = "file" | "tree";

interface ClaimRecord {
  readonly formatVersion: 1;
  readonly kind: "velar-build-output-claim";
  readonly comparisonPath: string;
  readonly outputPath: string;
  readonly outputKind: BuildOutputKind;
  readonly ownerPid: number;
  readonly token: string;
}

interface GateRecord {
  readonly formatVersion: 1;
  readonly kind: "velar-build-output-claim-gate";
  readonly ownerPid: number;
  readonly token: string;
}

interface RegistryIdentityRecord {
  readonly formatVersion: 1;
  readonly kind: "velar-build-output-claim-registry";
  readonly registryPath: string;
  readonly directoryDevice: string;
  readonly directoryInode: string;
  readonly token: string;
}

interface FileIdentity {
  readonly device: number | bigint;
  readonly inode: number | bigint;
}

interface ExistingRecord<T> {
  readonly record: T;
  readonly identity: FileIdentity;
  readonly contents: string;
}

interface RegistryGateLease {
  readonly release: () => Promise<void>;
}

interface BuildOutputClaimRegistry {
  readonly path: string;
  readonly directoryIdentity: FileIdentity;
  readonly identity: ExistingRecord<RegistryIdentityRecord>;
}

interface FileSnapshot {
  readonly identity: FileIdentity;
  readonly contents: string;
}

export interface BuildOutputClaimLease {
  readonly extend: (outputs: readonly BuildOutputClaimRequest[]) => Promise<void>;
  readonly release: () => Promise<void>;
}

export interface BuildOutputClaimRequest {
  readonly path: string;
  readonly kind: BuildOutputKind;
}

export type BuildOutputClaimResult =
  | { readonly status: "committed" }
  | { readonly status: "failed"; readonly error: unknown };

const REGISTRY_NAME = `velarscript-${process.getuid?.() ?? "user"}-build-output-claims-v1`;
const GATE_NAME = ".gate";
const REGISTRY_IDENTITY_NAME = ".registry-identity.json";
export const MAX_BUILD_OUTPUT_CLAIM_RECORD_BYTES = 256 * 1024;
export const MAX_BUILD_OUTPUT_CLAIMS = 8192;
const MAX_BUILD_OUTPUT_REGISTRY_ENTRIES = MAX_BUILD_OUTPUT_CLAIMS * 2;

export function buildOutputClaimRegistryPath(): string {
  return join(tmpdir(), REGISTRY_NAME);
}

function buildOutputClaimRegistryIdentityPath(): string {
  return join(tmpdir(), `.${REGISTRY_NAME}-identity.json`);
}

/**
 * Serializes changes to a process-shared registry, then rejects exact and
 * ancestor/descendant output overlap. The registry lives outside every output,
 * so replacing a claimed directory cannot hide a nested file producer's claim.
 */
export async function acquireBuildOutputClaim(
  outputPath: string,
  outputKind: BuildOutputKind,
): Promise<BuildOutputClaimLease> {
  return acquireBuildOutputClaims([{ path: outputPath, kind: outputKind }]);
}

/** Acquires a complete mutation set under one registry gate. */
export async function acquireBuildOutputClaims(
  outputs: readonly BuildOutputClaimRequest[],
): Promise<BuildOutputClaimLease> {
  if (outputs.length === 0) throw new Error("A build output claim requires at least one path");
  const registry = await prepareRegistry();
  const created = await installClaims(registry, await normalizeRequests(outputs), new Set());
  return releasableClaims(registry, created);
}

/**
 * Ends a build without allowing cleanup bookkeeping to contradict its commit
 * point. A committed output stays successful even when stale files or registry
 * records must be reclaimed by the next process; a failed build keeps its
 * original error while both cleanup paths are still attempted.
 */
export async function finishBuildOutputClaim(
  claim: BuildOutputClaimLease,
  result: BuildOutputClaimResult,
  cleanup: () => Promise<void>,
): Promise<void> {
  try {
    await cleanup();
  } catch {}
  try {
    await claim.release();
  } catch {}
  if (result.status === "failed") throw result.error;
}

function releasableClaims(
  registry: BuildOutputClaimRegistry,
  initialClaims: readonly HeldClaim[],
): BuildOutputClaimLease {
  let claims = [...initialClaims];
  let heldGate: RegistryGateLease | null = null;
  let released = false;
  return {
    extend: async (outputs) => {
      if (released) throw new Error("A released build output claim cannot be extended");
      if (heldGate !== null) throw new Error("A build output claim with an incomplete release must be released again before extension");
      const requests = (await normalizeRequests(outputs)).filter((request) =>
        !claims.some((claim) => claimCovers(claim.existing.record, request.record)));
      if (requests.length === 0) return;
      const ownedTokens = new Set(claims.map((claim) => claim.existing.record.token));
      claims.push(...await installClaims(registry, requests, ownedTokens));
    },
    release: async () => {
      if (released) return;
      const gate = heldGate ?? await acquireRegistryGate(registry);
      heldGate = gate;
      const failures: unknown[] = [];
      const retry: HeldClaim[] = [];
      try {
        for (const claim of claims) {
          try {
            const outcome = await releaseHeldClaim(registry, claim);
            if (outcome.retry) retry.push(claim);
            if (outcome.failure !== undefined) failures.push(outcome.failure);
          } catch (error) {
            retry.push(claim);
            failures.push(error);
          }
        }
      } finally {
        claims = retry;
        try {
          await gate.release();
          heldGate = null;
        } catch (error) {
          failures.push(error);
        }
        released = claims.length === 0 && heldGate === null;
      }
      if (failures.length > 0) {
        throw new AggregateError(failures, "One or more build output claims changed before they could be released");
      }
    },
  };
}

interface ClaimRequest {
  readonly requestedPath: string;
  readonly record: ClaimRecord;
}

interface HeldClaim {
  readonly path: string;
  readonly existing: ExistingRecord<ClaimRecord>;
}

interface ClaimReleaseOutcome {
  readonly retry: boolean;
  readonly failure?: unknown;
}

async function releaseHeldClaim(
  registry: BuildOutputClaimRegistry,
  claim: HeldClaim,
): Promise<ClaimReleaseOutcome> {
  await assertRegistryIdentity(registry);
  const current = await readOrdinaryFile(claim.path);
  if (current === null) {
    const detail = await pathExists(claim.path) ? "is no longer an ordinary file" : "is missing";
    return {
      retry: false,
      failure: new Error(`Build output claim '${claim.path}' ${detail}; the anomaly was preserved`),
    };
  }
  if (current.contents === claim.existing.contents
    && sameIdentity(current.identity, claim.existing.identity)) {
    try {
      await unlink(claim.path);
      await assertRegistryIdentity(registry);
      return { retry: false };
    } catch (error) {
      if (isHostErrorCode(error, "ENOENT")) {
        return {
          retry: false,
          failure: new Error(`Build output claim '${claim.path}' disappeared while it was being released`),
        };
      }
      return { retry: true, failure: error };
    }
  }

  const quarantine = join(
    registry.path,
    `.changed-${basename(claim.path)}-${randomUUID()}`,
  );
  try {
    await rename(claim.path, quarantine);
    const preserved = await readOrdinaryFile(quarantine);
    if (preserved === null || preserved.contents !== current.contents
      || !sameIdentity(preserved.identity, current.identity)) {
      throw new Error(`Changed build output claim '${claim.path}' could not be bound to its preserved evidence`);
    }
    await assertRegistryIdentity(registry);
    return {
      retry: false,
      failure: new Error(`Build output claim '${claim.path}' changed; its evidence was preserved at '${quarantine}'`),
    };
  } catch (error) {
    if (isHostErrorCode(error, "ENOENT")) {
      return {
        retry: false,
        failure: new Error(`Build output claim '${claim.path}' disappeared while its changed evidence was preserved`),
      };
    }
    return { retry: true, failure: error };
  }
}

async function normalizeRequests(outputs: readonly BuildOutputClaimRequest[]): Promise<readonly ClaimRequest[]> {
  if (outputs.length > MAX_BUILD_OUTPUT_CLAIMS) {
    throw new RangeError(`A build cannot claim more than ${MAX_BUILD_OUTPUT_CLAIMS} output paths`);
  }
  const merged: ClaimRequest[] = [];
  for (const output of outputs) {
    const requestedPath = resolve(output.path);
    const canonicalOutput = await canonicalizePotentialPath(requestedPath);
    const request: ClaimRequest = {
      requestedPath,
      record: {
        formatVersion: 1,
        kind: "velar-build-output-claim",
        comparisonPath: buildOutputComparisonPath(canonicalOutput),
        outputPath: canonicalOutput,
        outputKind: output.kind,
        ownerPid: process.pid,
        token: randomUUID(),
      },
    };
    const incompatible = merged.find((existing) => claimsOverlap(existing.record, request.record)
      && !claimCovers(existing.record, request.record)
      && !claimCovers(request.record, existing.record));
    if (incompatible) {
      throw new Error(
        `Build output '${requestedPath}' overlaps requested ${incompatible.record.outputKind} output '${incompatible.requestedPath}' in the same build`,
      );
    }
    if (merged.some((existing) => claimCovers(existing.record, request.record))) continue;
    for (let index = merged.length - 1; index >= 0; index -= 1) {
      if (claimCovers(request.record, merged[index]!.record)) merged.splice(index, 1);
    }
    merged.push(request);
  }
  return merged;
}

async function installClaims(
  registry: BuildOutputClaimRegistry,
  requests: readonly ClaimRequest[],
  ownedTokens: ReadonlySet<string>,
): Promise<readonly HeldClaim[]> {
  const gate = await acquireRegistryGate(registry);
  const created: HeldClaim[] = [];
  try {
    const active = (await activeClaims(registry)).filter((claim) => !ownedTokens.has(claim.record.token));
    for (const request of requests) {
      const conflict = active.find((candidate) => claimsOverlap(request.record, candidate.record));
      if (conflict) {
        throw new Error(
          `Build output '${request.requestedPath}' overlaps active ${conflict.record.outputKind} output '${conflict.record.outputPath}' written by process ${conflict.record.ownerPid}; wait for that build to finish or choose a different output path`,
        );
      }
    }
    for (const request of requests) {
      await assertRegistryIdentity(registry);
      const claimPath = join(registry.path, `claim-${request.record.token}.json`);
      await writeFile(claimPath, recordContents(request.record, "Build output claim"), { encoding: "utf8", flag: "wx", mode: 0o600 });
      const existing = await readClaim(claimPath);
      if (existing === null || existing.record.token !== request.record.token) {
        throw new Error(`Build output claim '${claimPath}' changed while it was being acquired`);
      }
      await assertRegistryIdentity(registry);
      created.push({ path: claimPath, existing });
    }
    return created;
  } catch (error) {
    for (const claim of [...created].reverse()) await removeUnchangedFile(claim.path, claim.existing);
    throw error;
  } finally {
    await gate.release();
  }
}

async function activeClaims(registry: BuildOutputClaimRegistry): Promise<readonly ExistingRecord<ClaimRecord>[]> {
  await assertRegistryIdentity(registry);
  const active: ExistingRecord<ClaimRecord>[] = [];
  let entries = 0;
  let claims = 0;
  for await (const entry of await opendir(registry.path)) {
    entries += 1;
    if (entries > MAX_BUILD_OUTPUT_REGISTRY_ENTRIES) {
      throw new RangeError(`Build output claim registry exceeds ${MAX_BUILD_OUTPUT_REGISTRY_ENTRIES} entries`);
    }
    if (!entry.name.startsWith("claim-") || !entry.name.endsWith(".json")) continue;
    claims += 1;
    if (claims > MAX_BUILD_OUTPUT_CLAIMS) {
      throw new RangeError(`Build output claim registry exceeds ${MAX_BUILD_OUTPUT_CLAIMS} claim records`);
    }
    const path = join(registry.path, entry.name);
    const existing = await readClaim(path);
    if (existing === null) continue;
    if (processIsAlive(existing.record.ownerPid)) active.push(existing);
    else await removeUnchangedFile(path, existing);
  }
  await assertRegistryIdentity(registry);
  return active;
}

function claimsOverlap(left: ClaimRecord, right: ClaimRecord): boolean {
  if (left.comparisonPath === right.comparisonPath) return true;
  return contains(left.comparisonPath, right.comparisonPath)
    || contains(right.comparisonPath, left.comparisonPath);
}

function claimCovers(owner: ClaimRecord, candidate: ClaimRecord): boolean {
  if (owner.comparisonPath === candidate.comparisonPath) {
    return owner.outputKind === "tree" || candidate.outputKind === "file";
  }
  return owner.outputKind === "tree" && contains(owner.comparisonPath, candidate.comparisonPath);
}

async function prepareRegistry(): Promise<BuildOutputClaimRegistry> {
  const path = buildOutputClaimRegistryPath();
  await mkdir(path, { recursive: true, mode: 0o700 });
  const metadata = await lstat(path);
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
    throw new Error(`Build output claim registry '${path}' must be an ordinary directory`);
  }
  const directoryIdentity = identityOf(metadata);
  const identity = await prepareRegistryIdentity(path, directoryIdentity);
  const registry = { path, directoryIdentity, identity };
  await assertRegistryIdentity(registry);
  return registry;
}

async function prepareRegistryIdentity(
  registryPath: string,
  directoryIdentity: FileIdentity,
): Promise<ExistingRecord<RegistryIdentityRecord>> {
  // The outside anchor survives a registry rename; its hard link inside the
  // registry binds that pathname to the directory inode all claimants saw.
  const anchorPath = buildOutputClaimRegistryIdentityPath();
  const candidate: RegistryIdentityRecord = {
    formatVersion: 1,
    kind: "velar-build-output-claim-registry",
    registryPath,
    directoryDevice: directoryIdentity.device.toString(),
    directoryInode: directoryIdentity.inode.toString(),
    token: randomUUID(),
  };
  const anchor = await installRegistryIdentityAnchor(anchorPath, candidate);
  assertRegistryIdentityRecord(anchor.record, registryPath, directoryIdentity);
  const markerPath = join(registryPath, REGISTRY_IDENTITY_NAME);
  try {
    await link(anchorPath, markerPath);
  } catch (error) {
    if (!isHostErrorCode(error, "EEXIST")) throw error;
  }
  const marker = await readRequiredRegistryIdentity(markerPath);
  if (marker.contents !== anchor.contents || !sameIdentity(marker.identity, anchor.identity)) {
    throw new Error(`Build output claim registry '${registryPath}' has mismatched identity evidence`);
  }
  return anchor;
}

async function installRegistryIdentityAnchor(
  anchorPath: string,
  record: RegistryIdentityRecord,
): Promise<ExistingRecord<RegistryIdentityRecord>> {
  const temporaryPath = `${anchorPath}.${record.token}.next`;
  let temporary: ExistingRecord<RegistryIdentityRecord> | null = null;
  try {
    await writeFile(temporaryPath, recordContents(record, "Build output claim registry identity"), { encoding: "utf8", flag: "wx", mode: 0o600 });
    temporary = await readRequiredRegistryIdentity(temporaryPath);
    try {
      await link(temporaryPath, anchorPath);
    } catch (error) {
      if (!isHostErrorCode(error, "EEXIST")) throw error;
    }
    return await readRequiredRegistryIdentity(anchorPath);
  } finally {
    if (temporary !== null) await removeUnchangedFile(temporaryPath, temporary);
  }
}

async function assertRegistryIdentity(registry: BuildOutputClaimRegistry): Promise<void> {
  let metadata: Awaited<ReturnType<typeof lstat>>;
  try {
    metadata = await lstat(registry.path);
  } catch (error) {
    if (isHostErrorCode(error, "ENOENT") || isHostErrorCode(error, "ENOTDIR")) {
      throw new Error(`Build output claim registry '${registry.path}' changed physical identity`);
    }
    throw error;
  }
  if (!metadata.isDirectory() || metadata.isSymbolicLink()
    || !sameIdentity(identityOf(metadata), registry.directoryIdentity)) {
    throw new Error(`Build output claim registry '${registry.path}' changed physical identity`);
  }
  const anchor = await readRequiredRegistryIdentity(buildOutputClaimRegistryIdentityPath());
  const marker = await readRequiredRegistryIdentity(join(registry.path, REGISTRY_IDENTITY_NAME));
  for (const evidence of [anchor, marker]) {
    assertRegistryIdentityRecord(evidence.record, registry.path, registry.directoryIdentity);
    if (evidence.contents !== registry.identity.contents
      || !sameIdentity(evidence.identity, registry.identity.identity)) {
      throw new Error(`Build output claim registry '${registry.path}' changed identity evidence`);
    }
  }
}

function assertRegistryIdentityRecord(
  record: RegistryIdentityRecord,
  registryPath: string,
  directoryIdentity: FileIdentity,
): void {
  if (record.registryPath !== registryPath
    || record.directoryDevice !== directoryIdentity.device.toString()
    || record.directoryInode !== directoryIdentity.inode.toString()) {
    throw new Error(`Build output claim registry '${registryPath}' does not match its bound physical identity`);
  }
}

async function acquireRegistryGate(registry: BuildOutputClaimRegistry): Promise<RegistryGateLease> {
  const gatePath = join(registry.path, GATE_NAME);
  const deadline = Date.now() + 30_000;
  while (true) {
    await assertRegistryIdentity(registry);
    const record: GateRecord = {
      formatVersion: 1,
      kind: "velar-build-output-claim-gate",
      ownerPid: process.pid,
      token: randomUUID(),
    };
    const created = await tryCreateGate(registry, gatePath, record);
    if (created !== null) return gateLease(registry, gatePath, created);
    const existing = await readGate(gatePath);
    if (existing === null) continue;
    if (!processIsAlive(existing.record.ownerPid)) {
      await removeUnchangedFile(gatePath, existing);
      continue;
    }
    if (Date.now() >= deadline) {
      throw new Error(`Build output claim registry is busy in process ${existing.record.ownerPid}; retry the build`);
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 2));
  }
}

async function tryCreateGate(
  registry: BuildOutputClaimRegistry,
  gatePath: string,
  record: GateRecord,
): Promise<ExistingRecord<GateRecord> | null> {
  const temporaryPath = `${gatePath}.${record.token}.next`;
  let temporary: ExistingRecord<GateRecord> | null = null;
  try {
    await writeFile(temporaryPath, recordContents(record, "Build output claim gate"), { encoding: "utf8", flag: "wx", mode: 0o600 });
    temporary = await readGate(temporaryPath);
    if (temporary === null || temporary.record.token !== record.token) {
      throw new Error(`Build output claim gate candidate '${temporaryPath}' changed while it was being created`);
    }
    await link(temporaryPath, gatePath);
    const created = await readGate(gatePath);
    if (created === null || created.record.token !== record.token || created.record.ownerPid !== record.ownerPid) {
      throw new Error(`Build output claim gate '${gatePath}' changed while it was being acquired`);
    }
    await assertRegistryIdentity(registry);
    return created;
  } catch (error) {
    if (isHostErrorCode(error, "EEXIST")) return null;
    throw error;
  } finally {
    if (temporary !== null) await removeUnchangedFile(temporaryPath, temporary);
  }
}

function gateLease(
  registry: BuildOutputClaimRegistry,
  gatePath: string,
  existing: ExistingRecord<GateRecord>,
): RegistryGateLease {
  let released = false;
  return {
    release: async () => {
      if (released) return;
      await assertRegistryIdentity(registry);
      const current = await readGate(gatePath);
      if (current === null
        || current.record.ownerPid !== existing.record.ownerPid
        || current.record.token !== existing.record.token
        || current.contents !== existing.contents
        || !sameIdentity(current.identity, existing.identity)) {
        throw new Error(`Build output claim gate '${gatePath}' changed before it could be released`);
      }
      await unlink(gatePath);
      await assertRegistryIdentity(registry);
      released = true;
    },
  };
}

async function readClaim(path: string): Promise<ExistingRecord<ClaimRecord> | null> {
  const existing = await readRecord(path, isClaimRecord);
  return existing !== null && basename(path) === `claim-${existing.record.token}.json` ? existing : null;
}

async function readGate(path: string): Promise<ExistingRecord<GateRecord> | null> {
  const existing = await readRecord(path, isGateRecord);
  if (existing === null && await pathExists(path)) {
    throw new Error(`Build output claim gate '${path}' is invalid and was preserved for inspection`);
  }
  return existing;
}

async function readRequiredRegistryIdentity(path: string): Promise<ExistingRecord<RegistryIdentityRecord>> {
  const existing = await readRecord(path, isRegistryIdentityRecord);
  if (existing === null) {
    const detail = await pathExists(path) ? "is invalid" : "is missing";
    throw new Error(`Build output claim registry identity '${path}' ${detail} and was preserved for inspection`);
  }
  return existing;
}

async function readRecord<T>(
  path: string,
  validate: (value: unknown) => value is T,
): Promise<ExistingRecord<T> | null> {
  const snapshot = await readOrdinaryFile(path);
  if (snapshot === null) return null;
  let value: unknown;
  try {
    value = JSON.parse(snapshot.contents);
  } catch (error) {
    if (error instanceof SyntaxError) return null;
    throw error;
  }
  return validate(value) ? { record: value, ...snapshot } : null;
}

async function readOrdinaryFile(path: string): Promise<FileSnapshot | null> {
  let handle: Awaited<ReturnType<typeof open>> | null = null;
  try {
    const pathBefore = await lstat(path);
    if (!pathBefore.isFile() || pathBefore.isSymbolicLink()) return null;
    handle = await open(path, "r");
    const before = await handle.stat();
    if (!before.isFile() || !sameIdentity(identityOf(pathBefore), identityOf(before))) return null;
    const contents = (await readBoundedFileHandle(
      handle,
      MAX_BUILD_OUTPUT_CLAIM_RECORD_BYTES,
      `Build output claim record '${path}'`,
    )).toString("utf8");
    const after = await handle.stat();
    const pathAfter = await lstat(path);
    const identity = identityOf(after);
    return sameIdentity(identityOf(before), identity)
      && !pathAfter.isSymbolicLink() && sameIdentity(identity, identityOf(pathAfter))
      ? { identity, contents }
      : null;
  } catch (error) {
    if (isHostErrorCode(error, "ENOENT") || isHostErrorCode(error, "ENOTDIR")) return null;
    throw error;
  } finally {
    await handle?.close();
  }
}

function recordContents(record: ClaimRecord | GateRecord | RegistryIdentityRecord, label: string): string {
  const contents = `${JSON.stringify(record)}\n`;
  if (Buffer.byteLength(contents, "utf8") > MAX_BUILD_OUTPUT_CLAIM_RECORD_BYTES) {
    throw new RangeError(`${label} exceeds ${MAX_BUILD_OUTPUT_CLAIM_RECORD_BYTES} bytes`);
  }
  return contents;
}

function isClaimRecord(value: unknown): value is ClaimRecord {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const record = value as Partial<ClaimRecord>;
  return hasExactKeys(value, ["comparisonPath", "formatVersion", "kind", "outputKind", "outputPath", "ownerPid", "token"])
    && record.formatVersion === 1 && record.kind === "velar-build-output-claim"
    && (record.outputKind === "file" || record.outputKind === "tree")
    && typeof record.outputPath === "string" && isAbsolute(record.outputPath) && resolve(record.outputPath) === record.outputPath
    && record.comparisonPath === buildOutputComparisonPath(record.outputPath)
    && validOwner(record.ownerPid) && validToken(record.token);
}

function isGateRecord(value: unknown): value is GateRecord {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const record = value as Partial<GateRecord>;
  return hasExactKeys(value, ["formatVersion", "kind", "ownerPid", "token"])
    && record.formatVersion === 1 && record.kind === "velar-build-output-claim-gate"
    && validOwner(record.ownerPid) && validToken(record.token);
}

function isRegistryIdentityRecord(value: unknown): value is RegistryIdentityRecord {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const record = value as Partial<RegistryIdentityRecord>;
  return hasExactKeys(value, [
    "directoryDevice",
    "directoryInode",
    "formatVersion",
    "kind",
    "registryPath",
    "token",
  ]) && record.formatVersion === 1 && record.kind === "velar-build-output-claim-registry"
    && typeof record.registryPath === "string" && isAbsolute(record.registryPath)
    && resolve(record.registryPath) === record.registryPath
    && validIdentityPart(record.directoryDevice) && validIdentityPart(record.directoryInode)
    && validToken(record.token);
}

function hasExactKeys(value: object, expected: readonly string[]): boolean {
  const keys = Object.keys(value).sort();
  return keys.length === expected.length && keys.every((key, index) => key === expected[index]);
}

function validOwner(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) > 0;
}

function validToken(value: unknown): value is string {
  return typeof value === "string"
    && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(value);
}

function validIdentityPart(value: unknown): value is string {
  return typeof value === "string" && /^(?:0|[1-9][0-9]*)$/u.test(value);
}

/** Conservatively joins aliases accepted by common case-insensitive Unicode filesystems. */
export function buildOutputComparisonPath(path: string): string {
  return unicodeFilesystemComparisonKey(resolve(path));
}

async function removeUnchangedFile<T>(path: string, expected: ExistingRecord<T>): Promise<void> {
  const current = await readRecord(path, (value): value is T => JSON.stringify(value) === JSON.stringify(expected.record));
  if (current === null || current.contents !== expected.contents || !sameIdentity(current.identity, expected.identity)) return;
  try {
    await unlink(path);
  } catch (error) {
    if (!isHostErrorCode(error, "ENOENT")) throw error;
  }
}

function identityOf(metadata: Awaited<ReturnType<typeof lstat>>): FileIdentity {
  return { device: metadata.dev, inode: metadata.ino };
}

function sameIdentity(left: FileIdentity, right: FileIdentity): boolean {
  return left.device === right.device && left.inode === right.inode;
}

function contains(root: string, candidate: string): boolean {
  const fromRoot = relative(root, candidate);
  return fromRoot !== "" && fromRoot !== ".." && !fromRoot.startsWith("../")
    && !fromRoot.startsWith("..\\") && !isAbsolute(fromRoot);
}

function processIsAlive(pid: number): boolean {
  // Portable Node APIs expose PID existence, not a stable process-instance
  // identity. Treating a reused PID as live is fail-closed: it can preserve a
  // stale claim, while guessing would risk deleting another active build's claim.
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return isHostErrorCode(error, "EPERM");
  }
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if (isHostErrorCode(error, "ENOENT") || isHostErrorCode(error, "ENOTDIR")) return false;
    throw error;
  }
}
