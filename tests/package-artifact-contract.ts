import { posix, resolve } from "node:path";
import { decodeVelarLibraryInterface } from "../packages/cli/src/library-artifact.ts";
import { assertVelarLibraryArtifactModuleClosure } from "../packages/cli/src/library-artifact-module-closure.ts";
import {
  assertVelarLibraryArtifactReceiptPackagePaths,
  assertVelarLibraryArtifactReceiptEntries,
  validateVelarLibraryArtifactReceipt,
  type VelarLibraryArtifactEntryReceipt,
  type VelarLibraryArtifactReceipt,
} from "../packages/cli/src/library-artifact-receipt.ts";
import {
  addVelarLibraryArtifactBudgetFile,
  assertArtifactByteLength,
  assertVelarLibraryArtifactSourceMap,
  authenticateArtifactTextBytes,
  createVelarLibraryArtifactBudget,
  decodeArtifactUtf8,
  VELAR_LIBRARY_ARTIFACT_LIMITS,
  type VelarLibraryArtifactJavaScriptSnapshot,
} from "../packages/cli/src/library-artifact-snapshot.ts";
import type { VelarPackageSubpath } from "../packages/cli/src/package-entry.ts";
import { packageRuntimeExportTargets } from "../packages/cli/src/package-exports.ts";
import { assertDeclaredArtifactRuntimeDependencies } from "../packages/cli/src/package-runtime-dependencies.ts";
import { MAX_VELAR_SOURCE_BYTES } from "../packages/cli/src/source-limits.ts";
import type { VelarPackageManifest } from "../scripts/velar-packages.mjs";

/** Reads one exact ordinary member from the packed package under inspection. */
export type PackedFileReader = (path: string) => Promise<Uint8Array>;

interface PackedInspectionContext {
  readonly manifest: VelarPackageManifest;
  readonly packedPathCounts: ReadonlyMap<string, number>;
  readonly read: PackedFileReader;
  readonly failures: string[];
}

interface PackedOutputClaim {
  readonly path: string;
  readonly sourceMapPath?: string;
  readonly label: string;
  readonly hashLabel: string;
  readonly expected: string;
  readonly interface: boolean;
  readonly javascript: boolean;
}

/** Validates every packed frozen-artifact receipt through the consumer's ABI authorities. */
export async function inspectPackedArtifactReceipts(
  manifest: VelarPackageManifest,
  packedPathCounts: ReadonlyMap<string, number>,
  readPackedFile: PackedFileReader | undefined,
  declaredEntries: ReadonlyMap<VelarPackageSubpath, string> | null,
  failures: string[],
): Promise<void> {
  const context = { manifest, packedPathCounts, read: readPackedFile!, failures };
  for (const [target, descriptor] of Object.entries(manifest.velar?.artifacts ?? {})) {
    const receiptPath = descriptor.startsWith("./") ? descriptor.slice(2) : descriptor;
    const count = packedPathCounts.get(receiptPath) ?? 0;
    if (count === 0) continue;
    if (count !== 1) {
      failures.push(`${manifest.name}: packed artifact receipt '${receiptPath}' occurs ${count} times; packed artifact paths must be unique ordinary files`);
      continue;
    }
    if (readPackedFile === undefined) {
      failures.push(`${manifest.name}: packed artifact receipt '${receiptPath}' was not inspected`);
      continue;
    }
    await inspectPackedArtifactReceipt(context, target, receiptPath, declaredEntries);
  }
}

async function inspectPackedArtifactReceipt(
  context: PackedInspectionContext,
  target: string,
  receiptPath: string,
  declaredEntries: ReadonlyMap<VelarPackageSubpath, string> | null,
): Promise<void> {
  const { manifest, failures } = context;
  try {
    const bytes = await context.read(receiptPath);
    if (!(bytes instanceof Uint8Array)) throw new Error("receipt reader did not return bytes");
    assertArtifactByteLength(bytes, VELAR_LIBRARY_ARTIFACT_LIMITS.receiptBytes, "receipt");
    const receipt = validateVelarLibraryArtifactReceipt(JSON.parse(
      decodeArtifactUtf8(bytes, "Velar library artifact receipt"),
    ));
    assertVelarLibraryArtifactReceiptPackagePaths(receipt, receiptPath);
    if (receipt.package.name !== manifest.name || receipt.package.version !== manifest.version) {
      throw new Error(`receipt identifies '${receipt.package.name}@${receipt.package.version}', expected '${manifest.name}@${manifest.version ?? "<missing>"}'`);
    }
    if (receipt.target !== target) throw new Error(`receipt target '${receipt.target}' does not match manifest key '${target}'`);
    if (declaredEntries !== null) {
      assertVelarLibraryArtifactReceiptEntries(receipt, new Map([...declaredEntries].map(
        ([subpath, relativePath]) => [subpath, { relativePath }] as const,
      )));
    }
    for (const source of receipt.sources) {
      await inspectPackedSource(context, source.path, source.sha256);
    }
    const receiptDirectory = posix.dirname(receiptPath);
    const claims = packedOutputClaims(manifest, receipt, receiptDirectory, failures);
    await inspectPackedOutputs(context, receipt, bytes.byteLength, claims);
  } catch (error) {
    failures.push(`${manifest.name}: artifact receipt '${receiptPath}' is invalid: ${errorMessage(error)}`);
  }
}

async function inspectPackedSource(
  context: PackedInspectionContext,
  path: string,
  expected: string,
): Promise<void> {
  const bytes = await readPackedBytes(context, path, "artifact source", MAX_VELAR_SOURCE_BYTES);
  if (bytes === null) return;
  try {
    authenticateArtifactTextBytes(bytes, MAX_VELAR_SOURCE_BYTES, expected, "artifact source", "source");
  } catch (error) {
    context.failures.push(`${context.manifest.name}: artifact source '${path}' is invalid: ${errorMessage(error)}`);
  }
}

function packedOutputClaims(
  manifest: VelarPackageManifest,
  receipt: VelarLibraryArtifactReceipt,
  receiptDirectory: string,
  failures: string[],
): ReadonlyMap<string, PackedOutputClaim> {
  const claims = new Map<string, PackedOutputClaim>();
  const add = (claim: PackedOutputClaim): void => {
    if (!claims.has(claim.path)) claims.set(claim.path, claim);
  };
  for (const [subpath, entry] of receiptEntries(receipt)) {
    const javascriptPath = posix.join(receiptDirectory, entry.javascript);
    inspectRuntimeExport(manifest, receipt, subpath, javascriptPath, failures);
    const sourceMapPath = posix.join(receiptDirectory, entry.sourceMap);
    add(outputClaim(javascriptPath, "artifact JavaScript", "JavaScript", entry.sha256.javascript, true, false, sourceMapPath));
    add(outputClaim(sourceMapPath, "artifact source map", "source map", entry.sha256.sourceMap));
    add(outputClaim(posix.join(receiptDirectory, entry.interface), "artifact interface", "interface", entry.sha256.interface, false, true));
  }
  if (receipt.formatVersion === 2) {
    for (const chunk of receipt.chunks) {
      const javascriptPath = posix.join(receiptDirectory, chunk.javascript);
      const sourceMapPath = posix.join(receiptDirectory, chunk.sourceMap);
      add(outputClaim(javascriptPath, "artifact shared JavaScript", "chunk JavaScript", chunk.sha256.javascript, true, false, sourceMapPath));
      add(outputClaim(sourceMapPath, "artifact shared source map", "chunk source map", chunk.sha256.sourceMap));
    }
  }
  return claims;
}

function inspectRuntimeExport(
  manifest: VelarPackageManifest,
  receipt: VelarLibraryArtifactReceipt,
  subpath: VelarPackageSubpath,
  javascriptPath: string,
  failures: string[],
): void {
  const expected = `./${javascriptPath}`;
  try {
    const targets = packageRuntimeExportTargets(manifest.exports, subpath, receipt.target);
    if (targets.length === 0 || targets.some((target) => target !== expected)) {
      failures.push(`${manifest.name}: artifact entry '${subpath}' must export '${expected}' on every supported ESM runtime`);
    }
  } catch (error) {
    failures.push(`${manifest.name}: artifact entry '${subpath}' has an invalid npm export: ${errorMessage(error)}`);
  }
}

async function inspectPackedOutputs(
  context: PackedInspectionContext,
  receipt: VelarLibraryArtifactReceipt,
  receiptBytes: number,
  claims: ReadonlyMap<string, PackedOutputClaim>,
): Promise<void> {
  const contents = new Map<string, string>();
  let budget = createVelarLibraryArtifactBudget(receiptBytes);
  for (const claim of claims.values()) {
    const maximum = claim.interface
      ? VELAR_LIBRARY_ARTIFACT_LIMITS.interfaceBytes
      : VELAR_LIBRARY_ARTIFACT_LIMITS.fileBytes;
    const bytes = await readPackedBytes(context, claim.path, claim.label, maximum);
    if (bytes === null) continue;
    budget = addVelarLibraryArtifactBudgetFile(budget, {
      size: bytes.byteLength,
      interface: claim.interface,
      javascript: claim.javascript,
    });
    try {
      contents.set(claim.path, authenticateArtifactTextBytes(
        bytes,
        maximum,
        claim.expected,
        claim.label,
        claim.hashLabel,
      ));
    } catch (error) {
      context.failures.push(`${context.manifest.name}: ${claim.label} '${claim.path}' is invalid: ${errorMessage(error)}`);
    }
  }
  inspectPackedInterfaces(context, claims, contents);
  inspectPackedModuleClosure(context, receipt, claims, contents);
}

function inspectPackedInterfaces(
  context: PackedInspectionContext,
  claims: ReadonlyMap<string, PackedOutputClaim>,
  contents: ReadonlyMap<string, string>,
): void {
  for (const claim of claims.values()) {
    const text = contents.get(claim.path);
    if (!claim.interface || text === undefined) continue;
    try {
      decodeVelarLibraryInterface(text);
    } catch (error) {
      context.failures.push(`${context.manifest.name}: ${claim.label} '${claim.path}' is invalid: ${errorMessage(error)}`);
    }
  }
}

function inspectPackedModuleClosure(
  context: PackedInspectionContext,
  receipt: VelarLibraryArtifactReceipt,
  claims: ReadonlyMap<string, PackedOutputClaim>,
  contents: ReadonlyMap<string, string>,
): void {
  const root = resolve(".velar-packed-artifact", context.manifest.name.replaceAll("/", "_"));
  const snapshots = [...claims.values()].flatMap((claim): VelarLibraryArtifactJavaScriptSnapshot[] => {
    if (!claim.javascript || claim.sourceMapPath === undefined) return [];
    const code = contents.get(claim.path);
    const sourceMap = contents.get(claim.sourceMapPath);
    if (code === undefined || sourceMap === undefined) return [];
    return [{
      path: packedSnapshotPath(root, claim.path),
      code,
      sourceMapPath: packedSnapshotPath(root, claim.sourceMapPath),
      sourceMap,
    }];
  });
  if (snapshots.length !== [...claims.values()].filter((claim) => claim.javascript).length) return;
  try {
    for (const snapshot of snapshots) assertVelarLibraryArtifactSourceMap(snapshot);
  } catch (error) {
    context.failures.push(`${context.manifest.name}: packed artifact source map is invalid: ${errorMessage(error)}`);
    return;
  }
  try {
    const external = assertVelarLibraryArtifactModuleClosure(snapshots, context.manifest.name, receipt.target);
    assertDeclaredArtifactRuntimeDependencies(
      external,
      new Set(Object.keys(context.manifest.dependencies ?? {})),
      context.manifest.name,
    );
  } catch (error) {
    context.failures.push(`${context.manifest.name}: packed artifact ESM closure is invalid: ${errorMessage(error)}`);
  }
}

async function readPackedBytes(
  context: PackedInspectionContext,
  path: string,
  label: string,
  maximum: number,
): Promise<Uint8Array | null> {
  const count = context.packedPathCounts.get(path) ?? 0;
  if (count === 0) {
    context.failures.push(`${context.manifest.name}: ${label} '${path}' is not in the tarball`);
    return null;
  }
  if (count !== 1) {
    context.failures.push(`${context.manifest.name}: ${label} '${path}' occurs ${count} times in the tarball; packed artifact paths must be unique ordinary files`);
    return null;
  }
  try {
    const bytes = await context.read(path);
    if (!(bytes instanceof Uint8Array)) throw new Error("packed-file reader did not return bytes");
    assertArtifactByteLength(bytes, maximum, label);
    return bytes;
  } catch (error) {
    context.failures.push(`${context.manifest.name}: ${label} '${path}' is invalid: ${errorMessage(error)}`);
    return null;
  }
}

function outputClaim(
  path: string,
  label: string,
  hashLabel: string,
  expected: string,
  javascript = false,
  interface_ = false,
  sourceMapPath?: string,
): PackedOutputClaim {
  return {
    path,
    label,
    hashLabel,
    expected,
    javascript,
    interface: interface_,
    ...(sourceMapPath === undefined ? {} : { sourceMapPath }),
  };
}

function receiptEntries(
  receipt: VelarLibraryArtifactReceipt,
): readonly (readonly [VelarPackageSubpath, VelarLibraryArtifactEntryReceipt])[] {
  if (receipt.formatVersion === 1) return [[".", { sourceEntry: receipt.sourceEntry, ...receipt.entry }]];
  return Object.entries(receipt.entries) as readonly (readonly [VelarPackageSubpath, VelarLibraryArtifactEntryReceipt])[];
}

function packedSnapshotPath(root: string, path: string): string {
  return resolve(root, ...path.split("/"));
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
