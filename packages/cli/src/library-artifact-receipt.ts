import { isAbsolute } from "node:path";
import { assertVelarPackageEntrySubpath, type VelarPackageSubpath } from "./package-entry.ts";
import { assertPortableArtifactPath, portableArtifactPathKey } from "./portable-artifact-path.ts";

export type VelarLibraryArtifactTarget = "core" | "node";

export interface VelarLibraryArtifactEntryReceipt {
  readonly sourceEntry: string;
  readonly javascript: string;
  readonly sourceMap: string;
  readonly interface: string;
  readonly sha256: {
    readonly javascript: string;
    readonly sourceMap: string;
    readonly interface: string;
  };
}

export interface VelarLibraryArtifactChunkReceipt {
  readonly javascript: string;
  readonly sourceMap: string;
  readonly sha256: {
    readonly javascript: string;
    readonly sourceMap: string;
  };
}

export interface VelarLibraryArtifactReceiptV1 {
  readonly formatVersion: 1;
  readonly kind: "velar-library-artifact";
  readonly abiVersion: 1;
  readonly package: { readonly name: string; readonly version: string };
  readonly target: VelarLibraryArtifactTarget;
  readonly compilerVersion: string;
  readonly sourceEntry: string;
  readonly sources: readonly { readonly path: string; readonly sha256: string }[];
  readonly entry: Omit<VelarLibraryArtifactEntryReceipt, "sourceEntry">;
}

export interface VelarLibraryArtifactReceiptV2 {
  readonly formatVersion: 2;
  readonly kind: "velar-library-artifact";
  readonly abiVersion: 1;
  readonly package: { readonly name: string; readonly version: string };
  readonly target: VelarLibraryArtifactTarget;
  readonly compilerVersion: string;
  readonly sources: readonly { readonly path: string; readonly sha256: string }[];
  readonly entries: Readonly<Record<string, VelarLibraryArtifactEntryReceipt>>;
  readonly chunks: readonly VelarLibraryArtifactChunkReceipt[];
}

export type VelarLibraryArtifactReceipt = VelarLibraryArtifactReceiptV1 | VelarLibraryArtifactReceiptV2;

interface PortableReceiptPathClaim {
  readonly path: string;
  readonly owner: string;
}

const SHA256 = /^[a-f0-9]{64}$/u;
const PACKAGE_NAME = /^(?:@[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*|[a-z0-9][a-z0-9._-]*)$/u;
const PACKAGE_VERSION = /^(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/u;

/** Strictly validates an untrusted ABI-1 receipt, including every v2 entry. */
export function validateVelarLibraryArtifactReceipt(value: unknown): VelarLibraryArtifactReceipt {
  const receipt = object(value, "Velar library artifact receipt");
  if (receipt.formatVersion !== 1 && receipt.formatVersion !== 2) {
    throw new Error("Velar library artifact receipt formatVersion must be 1 or 2");
  }
  const multiEntry = receipt.formatVersion === 2;
  exactKeys(receipt, multiEntry
    ? ["formatVersion", "kind", "abiVersion", "package", "target", "compilerVersion", "sources", "entries", "chunks"]
    : ["formatVersion", "kind", "abiVersion", "package", "target", "compilerVersion", "sourceEntry", "sources", "entry"], "Velar library artifact receipt");
  if (receipt.kind !== "velar-library-artifact" || receipt.abiVersion !== 1) {
    throw new Error("Velar library artifact receipt must declare kind 'velar-library-artifact' and ABI 1");
  }
  validateIdentity(receipt);
  const sourcePaths = validateSources(receipt.sources);
  const outputPaths = new Map<string, PortableReceiptPathClaim>();
  if (!multiEntry) {
    normalizedRelativePath(receipt.sourceEntry, "Velar library artifact sourceEntry");
    const entry = validateEntry(receipt.entry, "Velar library artifact entry", receipt.sourceEntry as string);
    if (!sourcePaths.has(receipt.sourceEntry as string)) throw new Error("Velar library artifact sourceEntry must be present in sources");
    claimEntryPaths(entry, outputPaths, entryOwner(entry));
    assertNoPortablePathHierarchy(outputPaths);
    return receipt as unknown as VelarLibraryArtifactReceiptV1;
  }
  const entries = object(receipt.entries, "Velar library artifact entries");
  const declarations = Object.entries(entries);
  if (declarations.length < 2 || declarations.length > 256 || !Object.hasOwn(entries, ".")) {
    throw new Error("Velar library artifact formatVersion 2 must contain the root and at least one subpath entry, with at most 256 entries");
  }
  for (const [subpath, candidate] of declarations) {
    if (subpath !== ".") assertVelarPackageEntrySubpath(subpath, `Velar library artifact entry '${subpath}'`);
    const entry = validateEntry(candidate, `Velar library artifact entry '${subpath}'`);
    if (!sourcePaths.has(entry.sourceEntry)) throw new Error(`Velar library artifact entry '${subpath}' sourceEntry '${entry.sourceEntry}' is absent from sources`);
    claimEntryPaths(entry, outputPaths, entryOwner(entry));
  }
  validateChunks(receipt.chunks, outputPaths);
  assertNoPortablePathHierarchy(outputPaths);
  return receipt as unknown as VelarLibraryArtifactReceiptV2;
}

/** Validates all receipt claims after resolving their distinct relative roots into one package tree. */
export function assertVelarLibraryArtifactReceiptPackagePaths(
  receipt: VelarLibraryArtifactReceipt,
  descriptor: string,
): void {
  const receiptPath = descriptor.startsWith("./") ? descriptor.slice(2) : descriptor;
  normalizedRelativePath(receiptPath, "Velar library artifact receipt path");
  const receiptDirectory = posixDirectory(receiptPath);
  const claims = new Map<string, PortableReceiptPathClaim>();
  claimPortableReceiptPath(receiptPath, claims, "receipt", false);
  for (const source of receipt.sources) {
    claimPortableReceiptPath(source.path, claims, `source:${source.path}`, false);
  }
  for (const entry of receiptEntries(receipt)) {
    const owner = entryOwner(entry);
    for (const path of [entry.javascript, entry.sourceMap, entry.interface]) {
      claimPortableReceiptPath(joinPortablePath(receiptDirectory, path), claims, owner, true);
    }
  }
  if (receipt.formatVersion === 2) {
    for (const [index, chunk] of receipt.chunks.entries()) {
      for (const path of [chunk.javascript, chunk.sourceMap]) {
        claimPortableReceiptPath(joinPortablePath(receiptDirectory, path), claims, `chunk:${index}`, false);
      }
    }
  }
  assertNoPortablePathHierarchy(claims);
}

function validateChunks(value: unknown, claimedPaths: Map<string, PortableReceiptPathClaim>): void {
  if (!Array.isArray(value) || value.length > 512) {
    throw new Error("Velar library artifact chunks must be a bounded list");
  }
  for (const [index, candidate] of value.entries()) {
    const label = `Velar library artifact chunk ${index}`;
    const chunk = object(candidate, label);
    exactKeys(chunk, ["javascript", "sourceMap", "sha256"], label);
    normalizedRelativePath(chunk.javascript, `${label} JavaScript path`);
    normalizedRelativePath(chunk.sourceMap, `${label} source map path`);
    if (!(chunk.javascript as string).match(/\.m?js$/u)) throw new Error(`${label} JavaScript path must end in .js or .mjs`);
    if (chunk.sourceMap !== `${chunk.javascript as string}.map`) throw new Error(`${label} source map must be the JavaScript path followed by .map`);
    const hashes = object(chunk.sha256, `${label} hashes`);
    exactKeys(hashes, ["javascript", "sourceMap"], `${label} hashes`);
    digest(hashes.javascript, `${label} JavaScript hash`);
    digest(hashes.sourceMap, `${label} source map hash`);
    for (const path of [chunk.javascript as string, chunk.sourceMap as string]) {
      claimPortableReceiptPath(path, claimedPaths, label, false);
    }
  }
}

function claimEntryPaths(
  entry: VelarLibraryArtifactEntryReceipt,
  claimedPaths: Map<string, PortableReceiptPathClaim>,
  owner: string,
): void {
  for (const path of [entry.javascript, entry.sourceMap, entry.interface]) {
    claimPortableReceiptPath(path, claimedPaths, owner, true);
  }
}

function entryOwner(entry: VelarLibraryArtifactEntryReceipt): string {
  return [
    "entry:",
    entry.sourceEntry,
    entry.javascript,
    entry.sourceMap,
    entry.interface,
    entry.sha256.javascript,
    entry.sha256.sourceMap,
    entry.sha256.interface,
  ].join("\0");
}

function claimPortableReceiptPath(
  path: string,
  claimedPaths: Map<string, PortableReceiptPathClaim>,
  owner: string,
  allowSameOwner: boolean,
): void {
  const key = portableArtifactPathKey(path);
  const existing = claimedPaths.get(key);
  if (existing !== undefined) {
    if (allowSameOwner && existing.owner === owner) return;
    if (owner.startsWith("entry:") && existing.owner.startsWith("entry:")) {
      throw new Error(`Velar library artifact path '${path}' is claimed by entries with different source or output metadata`);
    }
    throw new Error(`Velar library artifact path '${path}' is claimed more than once or aliases '${existing.path}' on portable filesystems`);
  }
  claimedPaths.set(key, { path, owner });
}

function assertNoPortablePathHierarchy(claimedPaths: ReadonlyMap<string, PortableReceiptPathClaim>): void {
  for (const [key, claim] of claimedPaths) {
    const segments = key.split("/");
    for (let length = 1; length < segments.length; length += 1) {
      const ancestor = claimedPaths.get(segments.slice(0, length).join("/"));
      if (ancestor !== undefined) {
        throw new Error(`Velar library artifact paths '${ancestor.path}' and '${claim.path}' cannot be both a file and an ancestor directory`);
      }
    }
  }
}

export function velarLibraryArtifactReceiptEntry(
  receipt: VelarLibraryArtifactReceipt,
  subpath: VelarPackageSubpath,
): VelarLibraryArtifactEntryReceipt {
  if (receipt.formatVersion === 1) {
    if (subpath !== ".") throw new Error(`Velar library artifact formatVersion 1 does not publish entry '${subpath}'`);
    return { sourceEntry: receipt.sourceEntry, ...receipt.entry };
  }
  const entry = receipt.entries[subpath];
  if (!entry) throw new Error(`Velar library artifact does not publish entry '${subpath}'`);
  return entry;
}

/** Ensures one receipt covers the manifest's complete source-entry surface. */
export function assertVelarLibraryArtifactReceiptEntries(
  receipt: VelarLibraryArtifactReceipt,
  declaredEntries: ReadonlyMap<VelarPackageSubpath, { readonly relativePath: string }>,
): void {
  if (receipt.formatVersion === 1) {
    const root = declaredEntries.get(".");
    if (declaredEntries.size !== 1 || root?.relativePath !== receipt.sourceEntry) {
      throw new Error("Velar library artifact formatVersion 1 can cover only the package's root source entry");
    }
    return;
  }
  const published = Object.keys(receipt.entries);
  if (published.length !== declaredEntries.size) {
    throw new Error("Velar library artifact entries must exactly cover package.json#velar.entry and package.json#velar.entries");
  }
  for (const [subpath, declared] of declaredEntries) {
    const entry = receipt.entries[subpath];
    if (!entry) throw new Error(`Velar library artifact is missing declared package entry '${subpath}'`);
    if (entry.sourceEntry !== declared.relativePath) {
      throw new Error(`Velar library artifact entry '${subpath}' identifies source '${entry.sourceEntry}', expected '${declared.relativePath}' from package.json`);
    }
  }
}

function validateIdentity(receipt: Record<string, unknown>): void {
  const package_ = object(receipt.package, "Velar library artifact package identity");
  exactKeys(package_, ["name", "version"], "Velar library artifact package identity");
  if (typeof package_.name !== "string" || !PACKAGE_NAME.test(package_.name) || typeof package_.version !== "string" || !PACKAGE_VERSION.test(package_.version)) {
    throw new Error("Velar library artifact package identity must contain a package name and semantic version");
  }
  if (receipt.target !== "core" && receipt.target !== "node") throw new Error("Velar library ABI 1 target must be 'core' or 'node'");
  if (typeof receipt.compilerVersion !== "string" || !PACKAGE_VERSION.test(receipt.compilerVersion)) {
    throw new Error("Velar library artifact compilerVersion must be a semantic version");
  }
}

function validateSources(
  value: unknown,
): ReadonlySet<string> {
  if (!Array.isArray(value) || value.length === 0 || value.length > 10_000) throw new Error("Velar library artifact sources must be a non-empty bounded list");
  const paths = new Set<string>();
  const portablePaths = new Set<string>();
  const claimedPaths = new Map<string, PortableReceiptPathClaim>();
  for (const source of value) {
    const item = object(source, "Velar library artifact source");
    exactKeys(item, ["path", "sha256"], "Velar library artifact source");
    normalizedRelativePath(item.path, "Velar library artifact source path");
    const key = portableArtifactPathKey(item.path);
    if (portablePaths.has(key)) {
      throw new Error(`Velar library artifact repeats portable source path '${item.path}'`);
    }
    paths.add(item.path);
    portablePaths.add(key);
    claimPortableReceiptPath(item.path, claimedPaths, `source:${String(item.path)}`, false);
    digest(item.sha256, "Velar library artifact source hash");
  }
  assertNoPortablePathHierarchy(claimedPaths);
  return paths;
}

function receiptEntries(receipt: VelarLibraryArtifactReceipt): readonly VelarLibraryArtifactEntryReceipt[] {
  if (receipt.formatVersion === 1) return [{ sourceEntry: receipt.sourceEntry, ...receipt.entry }];
  return Object.values(receipt.entries);
}

function posixDirectory(path: string): string {
  const separator = path.lastIndexOf("/");
  return separator < 0 ? "" : path.slice(0, separator);
}

function joinPortablePath(directory: string, path: string): string {
  return directory === "" ? path : `${directory}/${path}`;
}

function validateEntry(value: unknown, label: string, legacySourceEntry?: string): VelarLibraryArtifactEntryReceipt {
  const entry = object(value, label);
  exactKeys(entry, legacySourceEntry === undefined
    ? ["sourceEntry", "javascript", "sourceMap", "interface", "sha256"]
    : ["javascript", "sourceMap", "interface", "sha256"], label);
  const sourceEntry = legacySourceEntry ?? entry.sourceEntry;
  normalizedRelativePath(sourceEntry, `${label} sourceEntry`);
  normalizedRelativePath(entry.javascript, `${label} JavaScript path`);
  normalizedRelativePath(entry.sourceMap, `${label} source map path`);
  normalizedRelativePath(entry.interface, `${label} interface path`);
  if (new Set([entry.javascript, entry.sourceMap, entry.interface].map(portableArtifactPathKey)).size !== 3) {
    throw new Error(`${label} JavaScript, source map, and interface paths must be portably distinct`);
  }
  const hashes = object(entry.sha256, `${label} hashes`);
  exactKeys(hashes, ["javascript", "sourceMap", "interface"], `${label} hashes`);
  digest(hashes.javascript, `${label} JavaScript hash`);
  digest(hashes.sourceMap, `${label} source map hash`);
  digest(hashes.interface, `${label} interface hash`);
  return { ...entry, sourceEntry } as unknown as VelarLibraryArtifactEntryReceipt;
}

function object(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object`);
  return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, allowed: readonly string[], label: string): void {
  const fields = new Set(allowed);
  const unknown = Object.keys(value).find((key) => !fields.has(key));
  if (unknown) throw new Error(`${label} has unknown field '${unknown}'`);
  const missing = allowed.find((key) => !Object.hasOwn(value, key));
  if (missing) throw new Error(`${label} is missing field '${missing}'`);
}

function normalizedRelativePath(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string" || value === "" || /[\u0000-\u001f\u007f]/u.test(value) || isAbsolute(value) || value.includes("\\")
    || value.split("/").some((part) => part === "" || part === "." || part === "..")) throw new Error(`${label} must be a normalized relative path`);
  assertPortableArtifactPath(value, label);
}

function digest(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string" || !SHA256.test(value)) throw new Error(`${label} must be a lowercase SHA-256 digest`);
}
