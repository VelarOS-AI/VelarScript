import { realpath } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";
import { boundedFileFingerprint, sameFileFingerprint, textFingerprint, type FileContentFingerprint } from "./file-fingerprint.ts";
import type { VelarLibraryArtifactJavaScriptSnapshot } from "./library-artifact-snapshot.ts";

const MAX_PACKAGE_MANIFEST_BYTES = 1024 * 1024;
export const MAX_DEV_DEPENDENCY_INPUTS = 16_384;
const MAX_DEV_DEPENDENCY_INPUT_BYTES = 64 * 1024 * 1024;
const MAX_DEV_DEPENDENCY_GRAPH_BYTES = 512 * 1024 * 1024;

export interface DevDependencyFingerprint {
  readonly manifest: FileContentFingerprint;
  readonly entryTargets: Readonly<Record<string, string>>;
  readonly inputs: Readonly<Record<string, FileContentFingerprint>>;
  /** Authenticated artifact JavaScript and maps, fingerprinted from memory. */
  readonly snapshots: Readonly<Record<string, FileContentFingerprint>>;
}

export interface PrebundleFingerprintState {
  readonly name: string;
  readonly root: string;
  readonly entries: ReadonlyMap<string, string>;
  readonly artifactSnapshots: ReadonlyMap<string, VelarLibraryArtifactJavaScriptSnapshot>;
}

const validatedCaches = new Map<string, string>();
const snapshotFingerprints = new WeakMap<VelarLibraryArtifactJavaScriptSnapshot, {
  readonly code: FileContentFingerprint;
  readonly sourceMap: FileContentFingerprint;
}>();

export function invalidateDevDependencyFingerprint(metaPath: string): void {
  validatedCaches.delete(metaPath);
}

export function rememberDevDependencyFingerprint(metaPath: string, fingerprint: DevDependencyFingerprint): void {
  validatedCaches.set(metaPath, JSON.stringify(fingerprint));
}

export async function reusableDevDependencyFingerprint(
  metaPath: string,
  state: PrebundleFingerprintState,
  expected: DevDependencyFingerprint,
): Promise<boolean> {
  const identity = JSON.stringify(expected);
  try {
    if (!sameFingerprintRecords(expected.snapshots, artifactSnapshotFingerprints(state))) return false;
  } catch {
    return false;
  }
  if (validatedCaches.get(metaPath) === identity) return true;
  if (!await devDependencyFingerprintMatches(state, expected)) return false;
  validatedCaches.set(metaPath, identity);
  return true;
}

export async function devDependencyFingerprint(
  state: PrebundleFingerprintState,
  metafileInputs: readonly string[],
): Promise<DevDependencyFingerprint> {
  const snapshots = artifactSnapshotFingerprints(state);
  if (metafileInputs.length + Object.keys(snapshots).length === 0
    || metafileInputs.length + Object.keys(snapshots).length > MAX_DEV_DEPENDENCY_INPUTS) {
    throw new RangeError(`The development prebundle for '${state.name}' must contain between 1 and ${MAX_DEV_DEPENDENCY_INPUTS} authenticated inputs`);
  }
  const inputs: Record<string, FileContentFingerprint> = {};
  let graphBytes = Object.values(snapshots).reduce((total, fingerprint) => total + fingerprint.bytes, 0);
  if (graphBytes > MAX_DEV_DEPENDENCY_GRAPH_BYTES) {
    throw new RangeError(`Development prebundle inputs for '${state.name}' exceed ${MAX_DEV_DEPENDENCY_GRAPH_BYTES} bytes`);
  }
  for (const input of [...metafileInputs].sort()) {
    const absolute = isAbsolute(input) ? input : resolve(state.root, input);
    const canonical = await realpath(absolute);
    const path = relative(state.root, canonical).replaceAll("\\", "/");
    if (!normalizedPrebundlePath(path)) throw new Error(`Development prebundle input '${input}' escapes package '${state.name}'`);
    if (inputs[path]) continue;
    const fingerprint = await boundedFileFingerprint(canonical, MAX_DEV_DEPENDENCY_INPUT_BYTES, `Development prebundle input '${path}'`);
    graphBytes += fingerprint.bytes;
    if (graphBytes > MAX_DEV_DEPENDENCY_GRAPH_BYTES) {
      throw new RangeError(`Development prebundle inputs for '${state.name}' exceed ${MAX_DEV_DEPENDENCY_GRAPH_BYTES} bytes`);
    }
    inputs[path] = fingerprint;
  }
  return {
    manifest: await boundedFileFingerprint(join(state.root, "package.json"), MAX_PACKAGE_MANIFEST_BYTES, `Package manifest for '${state.name}'`),
    entryTargets: await devDependencyEntryTargets(state),
    inputs,
    snapshots,
  };
}

export function validDevDependencyFingerprint(value: unknown, maximumEntries: number): value is DevDependencyFingerprint {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const fingerprint = value as Partial<DevDependencyFingerprint>;
  if (!validFileFingerprint(fingerprint.manifest, MAX_PACKAGE_MANIFEST_BYTES)) return false;
  if (!fingerprint.entryTargets || typeof fingerprint.entryTargets !== "object" || Array.isArray(fingerprint.entryTargets)
    || Object.keys(fingerprint.entryTargets).length > maximumEntries
    || !Object.values(fingerprint.entryTargets).every((path) => typeof path === "string" && normalizedPrebundlePath(path))) return false;
  if (!fingerprint.inputs || typeof fingerprint.inputs !== "object" || Array.isArray(fingerprint.inputs)) return false;
  const inputs = Object.entries(fingerprint.inputs);
  if (!fingerprint.snapshots || typeof fingerprint.snapshots !== "object" || Array.isArray(fingerprint.snapshots)) return false;
  const snapshots = Object.entries(fingerprint.snapshots);
  if (inputs.length + snapshots.length === 0 || inputs.length + snapshots.length > MAX_DEV_DEPENDENCY_INPUTS) return false;
  let graphBytes = 0;
  for (const [path, input] of [...inputs, ...snapshots]) {
    if (!normalizedPrebundlePath(path) || !validFileFingerprint(input, MAX_DEV_DEPENDENCY_INPUT_BYTES)) return false;
    graphBytes += input.bytes;
    if (graphBytes > MAX_DEV_DEPENDENCY_GRAPH_BYTES) return false;
  }
  return true;
}

export function normalizedPrebundlePath(path: string): boolean {
  return path !== "" && !isAbsolute(path) && !path.includes("\\") && !/[\u0000-\u001f\u007f]/u.test(path)
    && path.split("/").every((part) => part !== "" && part !== "." && part !== "..");
}

async function devDependencyFingerprintMatches(
  state: PrebundleFingerprintState,
  expected: DevDependencyFingerprint,
): Promise<boolean> {
  try {
    const manifest = await boundedFileFingerprint(join(state.root, "package.json"), MAX_PACKAGE_MANIFEST_BYTES, `Package manifest for '${state.name}'`);
    if (!sameFileFingerprint(expected.manifest, manifest)) return false;
    if (!sameFingerprintRecords(expected.snapshots, artifactSnapshotFingerprints(state))) return false;
    const entryTargets = await devDependencyEntryTargets(state);
    for (const [subpath, target] of Object.entries(entryTargets)) {
      if (expected.entryTargets[subpath] !== target) return false;
    }
    let graphBytes = 0;
    for (const [path, fingerprint] of Object.entries(expected.inputs)) {
      const absolute = await realpath(resolve(state.root, ...path.split("/")));
      const fromRoot = relative(state.root, absolute).replaceAll("\\", "/");
      if (fromRoot !== path || !normalizedPrebundlePath(fromRoot)) return false;
      const actual = await boundedFileFingerprint(absolute, MAX_DEV_DEPENDENCY_INPUT_BYTES, `Development prebundle input '${path}'`);
      graphBytes += actual.bytes;
      if (graphBytes > MAX_DEV_DEPENDENCY_GRAPH_BYTES || !sameFileFingerprint(fingerprint, actual)) return false;
    }
    return true;
  } catch {
    return false;
  }
}

async function devDependencyEntryTargets(state: PrebundleFingerprintState): Promise<Record<string, string>> {
  const targets: Record<string, string> = {};
  const entries = [...state.entries].sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0);
  for (const [subpath, entry] of entries) {
    const canonical = state.artifactSnapshots.get(resolve(entry))?.path ?? await realpath(entry);
    const path = relative(state.root, canonical).replaceAll("\\", "/");
    if (!normalizedPrebundlePath(path)) throw new Error(`Development prebundle entry '${subpath}' escapes package '${state.name}'`);
    targets[subpath] = path;
  }
  return targets;
}

function artifactSnapshotFingerprints(state: PrebundleFingerprintState): Record<string, FileContentFingerprint> {
  const fingerprints: Record<string, FileContentFingerprint> = {};
  for (const snapshot of state.artifactSnapshots.values()) {
    let cached = snapshotFingerprints.get(snapshot);
    if (!cached) {
      cached = { code: textFingerprint(snapshot.code), sourceMap: textFingerprint(snapshot.sourceMap) };
      snapshotFingerprints.set(snapshot, cached);
    }
    addSnapshotFingerprint(fingerprints, state, snapshot.path, cached.code);
    addSnapshotFingerprint(fingerprints, state, snapshot.sourceMapPath, cached.sourceMap);
  }
  return Object.fromEntries(Object.entries(fingerprints).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0));
}

function addSnapshotFingerprint(
  fingerprints: Record<string, FileContentFingerprint>,
  state: PrebundleFingerprintState,
  absolute: string,
  fingerprint: FileContentFingerprint,
): void {
  const path = relative(state.root, absolute).replaceAll("\\", "/");
  if (!normalizedPrebundlePath(path)) throw new Error(`Authenticated prebundle input '${absolute}' escapes package '${state.name}'`);
  if (fingerprint.bytes > MAX_DEV_DEPENDENCY_INPUT_BYTES) {
    throw new RangeError(`Authenticated prebundle input '${path}' exceeds ${MAX_DEV_DEPENDENCY_INPUT_BYTES} bytes`);
  }
  const existing = fingerprints[path];
  if (existing && !sameFileFingerprint(existing, fingerprint)) {
    throw new Error(`Authenticated prebundle input '${path}' has conflicting snapshots`);
  }
  fingerprints[path] = fingerprint;
}

function sameFingerprintRecords(
  left: Readonly<Record<string, FileContentFingerprint>>,
  right: Readonly<Record<string, FileContentFingerprint>>,
): boolean {
  const leftPaths = Object.keys(left).sort();
  const rightPaths = Object.keys(right).sort();
  return leftPaths.length === rightPaths.length
    && leftPaths.every((path, index) => path === rightPaths[index] && sameFileFingerprint(left[path], right[path]!));
}

function validFileFingerprint(value: unknown, maximumBytes: number): value is FileContentFingerprint {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const fingerprint = value as Partial<FileContentFingerprint>;
  return Number.isSafeInteger(fingerprint.bytes) && fingerprint.bytes! >= 0 && fingerprint.bytes! <= maximumBytes
    && typeof fingerprint.sha256 === "string" && /^[0-9a-f]{64}$/u.test(fingerprint.sha256);
}
