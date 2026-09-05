import { createHash } from "node:crypto";
import { realpath } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import type { ModuleInterface } from "@velarscript/compiler";
import {
  artifactSnapshotContents,
  assertVelarLibraryArtifactBudgets,
  assertVelarLibraryArtifactSourceMap,
  authorizeArtifactFile,
  readAuthenticatedArtifactText,
  readAuthorizedArtifactText,
  VELAR_LIBRARY_ARTIFACT_LIMITS,
  type VelarLibraryArtifactJavaScriptSnapshot,
} from "./library-artifact-snapshot.ts";
import { assertVelarLibraryArtifactModuleClosure } from "./library-artifact-module-closure.ts";
import { assertArtifactRuntimeDependencies } from "./package-runtime-dependencies.ts";
import { validateVelarLibraryModuleInterface as validateModuleInterface } from "./library-artifact-interface.ts";
import {
  assertVelarLibraryArtifactReceiptPackagePaths,
  assertVelarLibraryArtifactReceiptEntries,
  validateVelarLibraryArtifactReceipt,
  velarLibraryArtifactReceiptEntry,
  type VelarLibraryArtifactReceipt,
  type VelarLibraryArtifactTarget,
} from "./library-artifact-receipt.ts";
import { assertVelarPackageEntrySubpath, type VelarPackageSubpath } from "./package-entry.ts";
import { packageRuntimeExportTargets } from "./package-exports.ts";
import { nearestPackageTypeForFile } from "./package-scope.ts";

export type {
  VelarLibraryArtifactChunkReceipt,
  VelarLibraryArtifactEntryReceipt,
  VelarLibraryArtifactReceipt,
  VelarLibraryArtifactReceiptV1,
  VelarLibraryArtifactReceiptV2,
  VelarLibraryArtifactTarget,
} from "./library-artifact-receipt.ts";
export {
  artifactSnapshotContents,
  assertArtifactSnapshotCurrent,
  type VelarLibraryArtifactJavaScriptSnapshot,
} from "./library-artifact-snapshot.ts";

/** The first frozen JavaScript/package-interface contract shipped by VelarScript. */
export const VELAR_LIBRARY_ABI_VERSION = 1;

export interface LoadedVelarLibraryArtifact {
  readonly abiVersion: 1;
  readonly target: VelarLibraryArtifactTarget;
  readonly compilerVersion: string;
  readonly receiptPath: string;
  readonly subpath: VelarPackageSubpath;
  readonly sourceEntry: string;
  readonly entryPath: string;
  readonly sourceMapPath: string;
  readonly interfacePath: string;
  /** Every public interface authenticated by the same package/target receipt. */
  readonly interfacePaths: readonly string[];
  readonly chunkPaths: readonly string[];
  readonly entrySnapshot: VelarLibraryArtifactJavaScriptSnapshot;
  /** Every public entry authenticated by the same package/target receipt. */
  readonly entrySnapshots: readonly VelarLibraryArtifactJavaScriptSnapshot[];
  readonly chunkSnapshots: readonly VelarLibraryArtifactJavaScriptSnapshot[];
  readonly moduleInterface: ModuleInterface;
}

interface PortableObject {
  readonly [key: string]: PortableValue;
}

type PortableValue = null | boolean | number | string | readonly PortableValue[] | PortableObject | ReadonlyMap<PortableValue, PortableValue> | ReadonlySet<PortableValue>;

type WireValue = null | boolean | number | string | {
  readonly tag: "array" | "object" | "map" | "set";
  readonly value: readonly WireValue[] | readonly (readonly [WireValue, WireValue])[];
};

const ARTIFACT_STAT_CONCURRENCY = 16;
const MAX_WIRE_NODES = 1_000_000;
const MAX_WIRE_DEPTH = 128;

export function sha256Text(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

/**
 * ABI 1 is deliberately a data format, never JSON.stringify over compiler
 * internals. Every container carries an explicit tag, so Maps/Sets survive and
 * an extension-owned object cannot be mistaken for one of the wire wrappers.
 */
export function encodeVelarLibraryInterface(interface_: ModuleInterface): string {
  validateModuleInterface(interface_, "module interface");
  let nodes = 0;
  const active = new Set<object>();
  const encode = (value: unknown, depth: number): WireValue => {
    nodes += 1;
    if (nodes > MAX_WIRE_NODES) throw new RangeError(`Velar library interface exceeds ${MAX_WIRE_NODES} values`);
    if (depth > MAX_WIRE_DEPTH) throw new RangeError(`Velar library interface exceeds ${MAX_WIRE_DEPTH} nested values`);
    if (value === null || typeof value === "string" || typeof value === "boolean") return value;
    if (typeof value === "number") {
      if (!Number.isFinite(value)) throw new Error("Velar library interface cannot contain a non-finite number");
      return value;
    }
    if (value === undefined) throw new Error("Velar library interface cannot contain an explicit undefined value");
    if (typeof value !== "object") throw new Error(`Velar library interface cannot contain ${typeof value}`);
    if (active.has(value)) throw new Error("Velar library interface cannot contain an object cycle");
    active.add(value);
    let output: WireValue;
    if (Array.isArray(value)) {
      output = { tag: "array", value: value.map((item) => encode(item, depth + 1)) };
    } else if (value instanceof Map) {
      output = { tag: "map", value: [...value].map(([key, item]) => [encode(key, depth + 1), encode(item, depth + 1)] as const) };
    } else if (value instanceof Set) {
      output = { tag: "set", value: [...value].map((item) => encode(item, depth + 1)) };
    } else {
      const entries = Object.entries(value)
        .filter(([, item]) => item !== undefined)
        .map(([key, item]) => [key as WireValue, encode(item, depth + 1)] as const);
      output = { tag: "object", value: entries };
    }
    active.delete(value);
    return output;
  };
  return `${JSON.stringify({ formatVersion: 1, abiVersion: VELAR_LIBRARY_ABI_VERSION, interface: encode(interface_, 0) }, null, 2)}\n`;
}

export function decodeVelarLibraryInterface(text: string): ModuleInterface {
  if (Buffer.byteLength(text, "utf8") > VELAR_LIBRARY_ARTIFACT_LIMITS.interfaceBytes) {
    throw new RangeError(`Velar library interface exceeds ${VELAR_LIBRARY_ARTIFACT_LIMITS.interfaceBytes} bytes`);
  }
  const envelope = record(JSON.parse(text), "Velar library interface");
  exactKeys(envelope, ["formatVersion", "abiVersion", "interface"], "Velar library interface");
  if (envelope.formatVersion !== 1) throw new Error("Velar library interface formatVersion must be 1");
  if (envelope.abiVersion !== VELAR_LIBRARY_ABI_VERSION) throw new Error(`Velar library interface ABI ${String(envelope.abiVersion)} is not supported`);
  let nodes = 0;
  const decode = (value: unknown, depth: number): PortableValue => {
    nodes += 1;
    if (nodes > MAX_WIRE_NODES) throw new RangeError(`Velar library interface exceeds ${MAX_WIRE_NODES} values`);
    if (depth > MAX_WIRE_DEPTH) throw new RangeError(`Velar library interface exceeds ${MAX_WIRE_DEPTH} nested values`);
    if (value === null || typeof value === "string" || typeof value === "boolean") return value;
    if (typeof value === "number") {
      if (!Number.isFinite(value)) throw new Error("Velar library interface contains a non-finite number");
      return value;
    }
    const wrapper = record(value, "Velar library interface wire value");
    exactKeys(wrapper, ["tag", "value"], "Velar library interface wire value");
    if (!Array.isArray(wrapper.value)) throw new Error("Velar library interface wire container value must be a list");
    if (wrapper.tag === "array") return wrapper.value.map((item) => decode(item, depth + 1));
    if (wrapper.tag === "set") return new Set(wrapper.value.map((item) => decode(item, depth + 1)));
    if (wrapper.tag === "map" || wrapper.tag === "object") {
      const entries = wrapper.value.map((entry, index) => {
        if (!Array.isArray(entry) || entry.length !== 2) throw new Error(`Velar library interface ${String(wrapper.tag)} entry ${index} must contain a key and value`);
        return [decode(entry[0], depth + 1), decode(entry[1], depth + 1)] as const;
      });
      if (wrapper.tag === "map") return new Map(entries);
      const output: Record<string, PortableValue> = Object.create(null) as Record<string, PortableValue>;
      for (const [key, item] of entries) {
        if (typeof key !== "string" || key === "__proto__" || key === "prototype" || key === "constructor") {
          throw new Error("Velar library interface object keys must be safe strings");
        }
        if (Object.hasOwn(output, key)) throw new Error(`Velar library interface object repeats key '${key}'`);
        output[key] = item;
      }
      return output;
    }
    throw new Error(`Velar library interface wire tag '${String(wrapper.tag)}' is not supported`);
  };
  const decoded = decode(envelope.interface, 0);
  validateModuleInterface(decoded, "Velar library interface");
  return decoded as unknown as ModuleInterface;
}

/** Replaces physical module paths in every nominal identity with package-stable paths. */
export function rebaseModuleInterfaceIdentities(
  interface_: ModuleInterface,
  replacements: readonly { readonly physical: string; readonly logical: string }[],
): ModuleInterface {
  const normalized = replacements
    .map((item) => ({ physical: item.physical.replaceAll("\\", "/"), logical: item.logical }))
    .sort((left, right) => right.physical.length - left.physical.length);
  const replace = (text: string): string => {
    let output = text.replaceAll("\\", "/");
    for (const item of normalized) output = output.replaceAll(item.physical, item.logical);
    return output;
  };
  const visit = (value: unknown): unknown => {
    if (typeof value === "string") return replace(value);
    if (value === null || typeof value !== "object") return value;
    if (Array.isArray(value)) return value.map(visit);
    if (value instanceof Map) return new Map([...value].map(([key, item]) => [visit(key), visit(item)]));
    if (value instanceof Set) return new Set([...value].map(visit));
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, visit(item)]));
  };
  const rebased = visit(interface_);
  validateModuleInterface(rebased, "rebased module interface");
  return rebased as ModuleInterface;
}

export function packageStableModulePath(name: string, version: string, relativeSourcePath: string): string {
  return `package:${name}@${version}/${relativeSourcePath.replaceAll("\\", "/")}`;
}

export async function loadVelarLibraryArtifact(options: {
  readonly packageRoot: string;
  readonly packageName: string;
  readonly packageVersion: string;
  readonly packageEntries: ReadonlyMap<VelarPackageSubpath, { readonly relativePath: string }>;
  readonly subpath?: VelarPackageSubpath;
  readonly sourceEntry: string;
  readonly descriptor: string;
  readonly target: VelarLibraryArtifactTarget;
  readonly packageExports: unknown;
  readonly runtimeDependencies?: ReadonlySet<string>;
}): Promise<LoadedVelarLibraryArtifact> {
  const subpath = options.subpath ?? ".";
  if (subpath !== ".") assertVelarPackageEntrySubpath(subpath, "Velar library artifact subpath");
  const artifacts = await loadVelarLibraryArtifactSet(options);
  const artifact = artifacts.get(subpath);
  if (!artifact) throw new Error(`Velar library artifact does not publish entry '${subpath}'`);
  if (artifact.sourceEntry !== options.sourceEntry) {
    throw new Error(`Velar library artifact entry '${subpath}' identifies source '${artifact.sourceEntry}', expected '${options.sourceEntry}' from package.json`);
  }
  return artifact;
}

/** Loads and authenticates one package/target receipt as a single bounded unit. */
export async function loadVelarLibraryArtifactSet(options: {
  readonly packageRoot: string;
  readonly packageName: string;
  readonly packageVersion: string;
  readonly packageEntries: ReadonlyMap<VelarPackageSubpath, { readonly relativePath: string }>;
  readonly descriptor: string;
  readonly target: VelarLibraryArtifactTarget;
  readonly packageExports: unknown;
  readonly runtimeDependencies?: ReadonlySet<string>;
}): Promise<ReadonlyMap<VelarPackageSubpath, LoadedVelarLibraryArtifact>> {
  const packageIdentity = await realpath(options.packageRoot);
  const receiptPath = artifactPath(options.packageRoot, options.descriptor, "velar.artifacts receipt");
  const receiptFile = await authorizeArtifactFile(packageIdentity, receiptPath, VELAR_LIBRARY_ARTIFACT_LIMITS.receiptBytes, "Velar library artifact receipt");
  const receiptText = await readAuthorizedArtifactText(receiptFile);
  const receipt = validateVelarLibraryArtifactReceipt(JSON.parse(receiptText));
  assertVelarLibraryArtifactReceiptPackagePaths(receipt, options.descriptor);
  if (receipt.package.name !== options.packageName || receipt.package.version !== options.packageVersion) {
    throw new Error(`Velar library artifact identifies '${receipt.package.name}@${receipt.package.version}', expected '${options.packageName}@${options.packageVersion}'`);
  }
  if (receipt.target !== options.target) throw new Error(`Velar library artifact target '${receipt.target}' does not match manifest key '${options.target}'`);
  assertVelarLibraryArtifactReceiptEntries(receipt, options.packageEntries);
  const receiptRoot = dirname(receiptPath);
  const { files, entries, artifactJavaScriptPaths, scopedJavaScriptPaths, chunkPaths } = collectArtifactClaims(receipt, receiptRoot, options);

  // Authorize and account for the complete receipt before reading one output,
  // preventing its bounded lists from multiplying aggregate allocation.
  const claims = [...files.values()];
  const authorized = await mapBounded(claims, ARTIFACT_STAT_CONCURRENCY, async (claim) => ({
    ...claim,
    ...await authorizeArtifactFile(packageIdentity, claim.path, claim.maximum, claim.label),
  }));
  assertVelarLibraryArtifactBudgets(authorized.map((file) => ({ size: file.size, interface: file.interface, javascript: artifactJavaScriptPaths.has(file.path) })), receiptFile.size);
  for (const path of scopedJavaScriptPaths) {
    if (await nearestPackageTypeForFile(options.packageRoot, path, "Velar library JavaScript artifact") !== "module") {
      throw new Error(`Package '${options.packageName}' must place every .js Velar library artifact inside a package scope with package.json 'type' set to 'module'`);
    }
  }

  // Read one file at a time. Besides bounding memory, this verifies aliased
  // entries and common chunks exactly once for this package/target set.
  const interfaces = new Map<string, ModuleInterface>();
  const contents = new Map<string, string>();
  const identities = new Map<string, string>();
  for (const file of authorized) {
    const content = await readAuthenticatedArtifactText(file, file.expected, file.hashLabel);
    identities.set(file.path, file.identity);
    if (file.interface) interfaces.set(file.path, decodeVelarLibraryInterface(content));
    else contents.set(file.path, content);
  }
  const { byPath: entrySnapshotsByPath, all: sharedEntrySnapshots } = artifactEntrySnapshots(entries, identities, contents);
  const sharedInterfacePaths = Object.freeze([...new Set([...entries.values()].map((paths) => identities.get(paths.interfacePath)!))]);
  const sharedChunkPaths = Object.freeze(chunkPaths.slice());
  const sharedChunkSnapshots = Object.freeze(receipt.formatVersion === 2
    ? receipt.chunks.map((chunk): VelarLibraryArtifactJavaScriptSnapshot => {
        const javascriptPath = artifactPath(receiptRoot, chunk.javascript, "artifact chunk JavaScript");
        const sourceMapPath = artifactPath(receiptRoot, chunk.sourceMap, "artifact chunk source map");
        return Object.freeze({
          path: identities.get(javascriptPath)!,
          code: contents.get(javascriptPath)!,
          sourceMapPath: identities.get(sourceMapPath)!,
          sourceMap: contents.get(sourceMapPath)!,
        });
      })
    : []);
  for (const snapshot of [...sharedEntrySnapshots, ...sharedChunkSnapshots]) {
    assertVelarLibraryArtifactSourceMap(snapshot);
  }
  const external = assertVelarLibraryArtifactModuleClosure(
    [...sharedEntrySnapshots, ...sharedChunkSnapshots],
    options.packageName,
    receipt.target,
  );
  await assertArtifactRuntimeDependencies(
    external,
    options.runtimeDependencies ?? new Set(),
    options.packageRoot,
    options.packageName,
    receipt.target,
  );
  return new Map([...entries].map(([subpath, paths]) => [subpath, {
    abiVersion: 1 as const,
    target: receipt.target,
    compilerVersion: receipt.compilerVersion,
    receiptPath,
    subpath,
    sourceEntry: paths.entry.sourceEntry,
    entryPath: paths.entryPath,
    sourceMapPath: paths.sourceMapPath,
    interfacePath: paths.interfacePath,
    interfacePaths: sharedInterfacePaths,
    chunkPaths: sharedChunkPaths,
    entrySnapshot: entrySnapshotsByPath.get(identities.get(paths.entryPath)!)!,
    entrySnapshots: sharedEntrySnapshots,
    chunkSnapshots: sharedChunkSnapshots,
    moduleInterface: interfaces.get(paths.interfacePath)!,
  }]));
}

type ArtifactSetLoadOptions = Parameters<typeof loadVelarLibraryArtifactSet>[0];

interface ArtifactClaimCollection {
  readonly files: ReadonlyMap<string, ArtifactFileClaim>;
  readonly entries: ReadonlyMap<VelarPackageSubpath, ArtifactEntryPaths>;
  readonly artifactJavaScriptPaths: ReadonlySet<string>;
  readonly scopedJavaScriptPaths: ReadonlySet<string>;
  readonly chunkPaths: readonly string[];
}

function collectArtifactClaims(
  receipt: VelarLibraryArtifactReceipt,
  receiptRoot: string,
  options: ArtifactSetLoadOptions,
): ArtifactClaimCollection {
  const files = new Map<string, ArtifactFileClaim>();
  const entries = new Map<VelarPackageSubpath, ArtifactEntryPaths>();
  const artifactJavaScriptPaths = new Set<string>();
  const scopedJavaScriptPaths = new Set<string>();
  for (const subpath of options.packageEntries.keys()) {
    const entry = velarLibraryArtifactReceiptEntry(receipt, subpath);
    if (!entry.javascript.endsWith(".js") && !entry.javascript.endsWith(".mjs")) {
      throw new Error(`Velar library artifact entry '${subpath}' must use an ESM .js or .mjs file`);
    }
    const entryPath = artifactPath(receiptRoot, entry.javascript, "artifact JavaScript entry");
    const sourceMapPath = artifactPath(receiptRoot, entry.sourceMap, "artifact source map");
    const interfacePath = artifactPath(receiptRoot, entry.interface, "artifact interface");
    artifactJavaScriptPaths.add(entryPath);
    if (entry.javascript.endsWith(".js")) scopedJavaScriptPaths.add(entryPath);
    const exported = packageRuntimeExportTargets(options.packageExports, subpath, receipt.target);
    const expectedExport = `./${relative(options.packageRoot, entryPath).replaceAll("\\", "/")}`;
    if (exported.length === 0 || exported.some((target) => target !== expectedExport)) {
      throw new Error(`Package '${options.packageName}' must export Velar entry '${subpath}' as '${expectedExport}' for every supported ESM runtime condition`);
    }
    addArtifactFile(files, entryPath, VELAR_LIBRARY_ARTIFACT_LIMITS.fileBytes, "Velar library JavaScript artifact", "JavaScript", entry.sha256.javascript);
    addArtifactFile(files, sourceMapPath, VELAR_LIBRARY_ARTIFACT_LIMITS.fileBytes, "Velar library source map", "source map", entry.sha256.sourceMap);
    addArtifactFile(files, interfacePath, VELAR_LIBRARY_ARTIFACT_LIMITS.interfaceBytes, "Velar library interface", "interface", entry.sha256.interface, true);
    entries.set(subpath, { entry, entryPath, sourceMapPath, interfacePath });
  }
  const chunkPaths: string[] = [];
  if (receipt.formatVersion === 2) {
    for (const chunk of receipt.chunks) {
      const javascriptPath = artifactPath(receiptRoot, chunk.javascript, "artifact chunk JavaScript");
      const sourceMapPath = artifactPath(receiptRoot, chunk.sourceMap, "artifact chunk source map");
      artifactJavaScriptPaths.add(javascriptPath);
      if (chunk.javascript.endsWith(".js")) scopedJavaScriptPaths.add(javascriptPath);
      addArtifactFile(files, javascriptPath, VELAR_LIBRARY_ARTIFACT_LIMITS.fileBytes, "Velar library artifact chunk JavaScript", "chunk JavaScript", chunk.sha256.javascript);
      addArtifactFile(files, sourceMapPath, VELAR_LIBRARY_ARTIFACT_LIMITS.fileBytes, "Velar library artifact chunk source map", "chunk source map", chunk.sha256.sourceMap);
      chunkPaths.push(javascriptPath, sourceMapPath);
    }
  }
  return { files, entries, artifactJavaScriptPaths, scopedJavaScriptPaths, chunkPaths };
}

function artifactEntrySnapshots(
  entries: ReadonlyMap<VelarPackageSubpath, ArtifactEntryPaths>,
  identities: ReadonlyMap<string, string>,
  contents: ReadonlyMap<string, string>,
): { readonly byPath: ReadonlyMap<string, VelarLibraryArtifactJavaScriptSnapshot>; readonly all: readonly VelarLibraryArtifactJavaScriptSnapshot[] } {
  const byPath = new Map<string, VelarLibraryArtifactJavaScriptSnapshot>();
  for (const paths of entries.values()) {
    const path = identities.get(paths.entryPath)!;
    const sourceMapPath = identities.get(paths.sourceMapPath)!;
    const existing = byPath.get(path);
    if (existing) {
      if (existing.sourceMapPath !== sourceMapPath
        || existing.code !== contents.get(paths.entryPath)
        || existing.sourceMap !== contents.get(paths.sourceMapPath)) {
        throw new Error(`Velar library artifact entry '${path}' has conflicting verified snapshots`);
      }
      continue;
    }
    byPath.set(path, Object.freeze({
      path,
      code: contents.get(paths.entryPath)!,
      sourceMapPath,
      sourceMap: contents.get(paths.sourceMapPath)!,
    }));
  }
  return { byPath, all: Object.freeze([...byPath.values()]) };
}

interface ArtifactEntryPaths {
  readonly entry: ReturnType<typeof velarLibraryArtifactReceiptEntry>;
  readonly entryPath: string;
  readonly sourceMapPath: string;
  readonly interfacePath: string;
}

interface ArtifactFileClaim {
  readonly path: string;
  readonly maximum: number;
  readonly label: string;
  readonly hashLabel: string;
  readonly expected: string;
  readonly interface: boolean;
}

function addArtifactFile(
  files: Map<string, ArtifactFileClaim>,
  path: string,
  maximum: number,
  label: string,
  hashLabel: string,
  expected: string,
  interface_ = false,
): void {
  const existing = files.get(path);
  if (existing) {
    if (existing.expected !== expected || existing.interface !== interface_) {
      throw new Error(`Velar library artifact output '${path}' has conflicting claims`);
    }
    return;
  }
  files.set(path, { path, maximum, label, hashLabel, expected, interface: interface_ });
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value) || value instanceof Map || value instanceof Set) {
    throw new Error(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, allowed: readonly string[], label: string): void {
  const allowedSet = new Set(allowed);
  const unknown = Object.keys(value).find((key) => !allowedSet.has(key));
  if (unknown) throw new Error(`${label} has unknown field '${unknown}'`);
  const missing = allowed.find((key) => !Object.hasOwn(value, key));
  if (missing) throw new Error(`${label} is missing field '${missing}'`);
}
function normalizedRelativePath(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string" || value === "" || /[\u0000-\u001f\u007f]/u.test(value) || isAbsolute(value) || value.includes("\\")
    || value.split("/").some((part) => part === "" || part === "." || part === "..")) {
    throw new Error(`${label} must be a normalized relative path`);
  }
}

function artifactPath(root: string, value: unknown, label: string): string {
  normalizedRelativePath(value, label);
  const path = resolve(root, ...value.split("/"));
  const fromRoot = relative(root, path);
  if (!fromRoot || fromRoot.startsWith("..") || isAbsolute(fromRoot)) throw new Error(`${label} escapes its package directory`);
  return path;
}

async function mapBounded<T, R>(
  values: readonly T[],
  concurrency: number,
  operation: (value: T) => Promise<R>,
): Promise<R[]> {
  const output = new Array<R>(values.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(concurrency, values.length) }, async () => {
    while (next < values.length) {
      const index = next;
      next += 1;
      output[index] = await operation(values[index]!);
    }
  });
  await Promise.all(workers);
  return output;
}
