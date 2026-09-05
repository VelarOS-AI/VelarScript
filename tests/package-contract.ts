import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open, type FileHandle } from "node:fs/promises";
import { VELAR_LIBRARY_ARTIFACT_LIMITS } from "../packages/cli/src/library-artifact-snapshot.ts";
import {
  assertVelarPackageSubpath,
  parseVelarPackageEntrySources,
} from "../packages/cli/src/package-entry.ts";
import {
  BROWSER_ESM_PACKAGE_CONDITIONS,
  NODE_ESM_PACKAGE_CONDITIONS,
  packageExportTargets,
} from "../packages/cli/src/package-exports.ts";
import { assertPortableArtifactPath, portableArtifactPathKey } from "../packages/cli/src/portable-artifact-path.ts";
import type { VelarPackageManifest } from "../scripts/velar-packages.mjs";
import { inspectPackedArtifactReceipts } from "./package-artifact-contract.ts";

// ---------------------------------------------------------------------------
// A-024 — what a published VelarScript package must contain, derived from what
// the package itself promises.
//
// `test:packages` packed a derived roster (`velarWorkspacePackageNames`) and then wrote
// the same eight names out again by hand: the content checks walked six of
// them, the clean install listed eight tarball paths, and `gate:build:packages`
// held a sixth copy. The commit that derived the roster said a new package
// "joins the gate the day it exists"; that was true of `pack()` and of nothing
// after it. A publishable package with no LICENSE, no README, no `dist`, and an
// `exports` pointing at a file that does not exist passed the whole gate with
// exit 0 while a real consumer importing it got ERR_MODULE_NOT_FOUND.
//
// So the contract below asks the manifest, not a list. Every path a manifest
// promises a consumer — `main`, `types`, `bin`, every string leaf of `exports`,
// `velar.entry`, every `velar.entries` source, every declared `velar.artifacts`
// receipt, every declared `velar.resources` path — must be inside the tarball,
// and every specifier those promises create must resolve after a clean install. A package that publishes
// a new export subpath is checked for it without anybody editing this file, and
// a package added to the workspace is checked at all.
// ---------------------------------------------------------------------------

/** One file inside a packed tarball, as `npm pack --json` reports it. */
export interface PackedFile {
  readonly path: string;
}

/** One packed tarball, as `npm pack --json` reports it. */
export interface PackedPackage {
  readonly filename: string;
  readonly files: readonly PackedFile[];
}

/** Reads one path from the package directory whose `npm pack` listing is under test. */
export interface PackedFileReader {
  (path: string): Promise<Uint8Array>;
  releaseSnapshot?: () => void;
}

const MAX_PACKED_TARBALL_BYTES = 512 * 1024 * 1024;

/** Reads the exact ordinary member npm wrote, rather than the mutable source tree it packed. */
export function packedTarballFileReader(tarballPath: string): PackedFileReader {
  let pendingSnapshot: Promise<Buffer> | undefined;
  const read: PackedFileReader = async (path) => {
    assertPackedPath(path, `packed path '${path}'`);
    pendingSnapshot ??= readStablePackedTarball(tarballPath);
    const archive = await pendingSnapshot;
    const member = `package/${path}`;
    const listing = spawnSync("tar", ["-tzvf", "-", member], {
      encoding: "utf8",
      env: { ...process.env, LC_ALL: "C" },
      input: archive,
      maxBuffer: 1024 * 1024,
    });
    const listed = (listing.stdout ?? "").split("\n").filter(Boolean);
    if (listing.status !== 0 || listed.length !== 1 || listed[0]?.[0] !== "-") {
      throw new Error(`packed path '${path}' must name one ordinary tarball file`);
    }
    const extracted = spawnSync("tar", ["-xzOf", "-", member], {
      encoding: null,
      input: archive,
      maxBuffer: VELAR_LIBRARY_ARTIFACT_LIMITS.fileBytes + 1,
    });
    if (extracted.status !== 0 || !Buffer.isBuffer(extracted.stdout)) {
      throw new Error(`could not read packed path '${path}': ${String(extracted.stderr ?? "").trim()}`);
    }
    return extracted.stdout;
  };
  read.releaseSnapshot = () => {
    pendingSnapshot = undefined;
  };
  return read;
}

async function readStablePackedTarball(path: string): Promise<Buffer> {
  const initial = await lstat(path);
  if (!initial.isFile() || initial.isSymbolicLink()) throw new Error("packed tarball must be an ordinary file");
  if (initial.size > MAX_PACKED_TARBALL_BYTES) throw new RangeError(`packed tarball exceeds ${MAX_PACKED_TARBALL_BYTES} bytes`);
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const opened = await handle.stat();
    if (!samePackedFile(initial, opened)) throw new Error("packed tarball changed while it was being authorized");
    const bytes = await handle.readFile();
    const afterRead = await handle.stat();
    if (!samePackedFile(opened, afterRead) || bytes.byteLength !== opened.size) {
      throw new Error("packed tarball changed while it was being read");
    }
    const expected = createHash("sha256").update(bytes).digest("hex");
    if (await hashOpenFile(handle, opened.size) !== expected || !samePackedFile(opened, await handle.stat())) {
      throw new Error("packed tarball changed while its snapshot was being verified");
    }
    return bytes;
  } finally {
    await handle.close();
  }
}

async function hashOpenFile(handle: FileHandle, size: number): Promise<string> {
  const hash = createHash("sha256");
  const buffer = Buffer.allocUnsafe(Math.min(1024 * 1024, Math.max(size, 1)));
  let position = 0;
  while (position < size) {
    const { bytesRead } = await handle.read(buffer, 0, Math.min(buffer.byteLength, size - position), position);
    if (bytesRead === 0) throw new Error("packed tarball ended while its snapshot was being verified");
    hash.update(buffer.subarray(0, bytesRead));
    position += bytesRead;
  }
  return hash.digest("hex");
}

function samePackedFile(
  left: { readonly dev: number; readonly ino: number; readonly size: number },
  right: { readonly dev: number; readonly ino: number; readonly size: number },
): boolean {
  return left.dev === right.dev && left.ino === right.ino && left.size === right.size;
}

/** Every file path a manifest promises a consumer, in declaration order. */
export function declaredEntryPaths(manifest: VelarPackageManifest): string[] {
  const paths: string[] = [];
  const add = (value: unknown): void => {
    if (typeof value !== "string" || value === "") return;
    const path = value.startsWith("./") ? value.slice(2) : value;
    if (!paths.includes(path)) paths.push(path);
  };
  add(manifest.main);
  add(manifest.types);
  // `exports` is a tree of conditions whose leaves are all file targets, so the
  // walk is structural: a condition this file has never heard of is still read.
  const walk = (value: unknown): void => {
    if (typeof value === "string") return add(value);
    if (Array.isArray(value)) return void value.forEach(walk);
    if (value !== null && typeof value === "object") return void Object.values(value).forEach(walk);
  };
  walk(manifest.exports);
  if (typeof manifest.bin === "string") add(manifest.bin);
  else for (const value of Object.values(manifest.bin ?? {})) add(value);
  add(manifest.velar?.entry);
  for (const entry of Object.values(manifest.velar?.entries ?? {})) add(entry);
  for (const artifact of Object.values(manifest.velar?.artifacts ?? {})) add(artifact);
  for (const resource of Object.values(manifest.velar?.resources ?? {})) add(resource.path);
  return paths;
}

function exportTargetsAt(manifest: VelarPackageManifest, subpath: string): string[] {
  assertVelarPackageSubpath(subpath, `resource subpath '${subpath}'`);
  return [...packageExportTargets(
    manifest.exports,
    subpath,
    [NODE_ESM_PACKAGE_CONDITIONS, BROWSER_ESM_PACKAGE_CONDITIONS],
  )];
}

/**
 * The import specifiers a clean consumer must be able to resolve. A `.vel`
 * source package publishes no JavaScript entry point — the Vel toolchain reads
 * its `velar.entry` — so it contributes none, and its entry file is checked as
 * a path instead.
 */
export function declaredImportSpecifiers(manifest: VelarPackageManifest): string[] {
  const exports = manifest.exports;
  if (typeof exports === "string") return [manifest.name];
  if (exports === null || typeof exports !== "object" || Array.isArray(exports)) {
    return manifest.main !== undefined ? [manifest.name] : [];
  }
  const specifiers: string[] = [];
  const resourceSubpaths = new Set(Object.keys(manifest.velar?.resources ?? {}));
  for (const key of Object.keys(exports)) {
    // A subpath key starts with '.'; anything else is a condition name at the
    // top level, which means the whole object describes the '.' entry.
    if (!key.startsWith(".")) return [manifest.name];
    if (key.includes("*")) continue;
    if (resourceSubpaths.has(key)) continue;
    specifiers.push(key === "." ? manifest.name : `${manifest.name}/${key.slice(2)}`);
  }
  return specifiers;
}

/** JSON resource specifiers, imported with a JSON attribute by JS consumer gates. */
export function declaredJsonResourceImportSpecifiers(manifest: VelarPackageManifest): string[] {
  return Object.keys(manifest.velar?.resources ?? {}).map((subpath) =>
    `${manifest.name}/${subpath.slice(2)}`
  );
}

/** A `*` target matched against the tarball's file list. */
function matchesPattern(pattern: string, paths: readonly string[]): boolean {
  const expression = new RegExp(`^${pattern.split("*").map((part) => part.replaceAll(/[.*+?^${}()|[\]\\]/gu, "\\$&")).join("[^\\n]*")}$`, "u");
  return paths.some((path) => expression.test(path));
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Everything wrong with one published package, as a list of sentences. Empty
 * means the package satisfies what it promises; the caller decides how loudly
 * to say so.
 */
export async function packageContentFailures(
  manifest: VelarPackageManifest,
  packed: PackedPackage,
  readPackedFile?: PackedFileReader,
): Promise<string[]> {
  try {
    return await inspectPackageContentFailures(manifest, packed, readPackedFile);
  } finally {
    readPackedFile?.releaseSnapshot?.();
  }
}

async function inspectPackageContentFailures(
  manifest: VelarPackageManifest,
  packed: PackedPackage,
  readPackedFile?: PackedFileReader,
): Promise<string[]> {
  const paths = packed.files.map((file) => file.path);
  const packedPathCounts = new Map<string, number>();
  for (const path of paths) packedPathCounts.set(path, (packedPathCounts.get(path) ?? 0) + 1);
  const failures: string[] = [];
  const portablePackedPaths = new Map<string, string>();
  for (const path of paths) {
    try {
      assertPackedPath(path, `packed path '${path}'`);
      assertPortableArtifactPath(path, `packed path '${path}'`);
      const key = portableArtifactPathKey(path);
      const previous = portablePackedPaths.get(key);
      if (previous !== undefined) {
        failures.push(previous === path
          ? `${manifest.name}: packed path '${path}' occurs more than once`
          : `${manifest.name}: packed paths '${previous}' and '${path}' conflict on portable filesystems`);
      } else {
        portablePackedPaths.set(key, path);
      }
    } catch (error) {
      failures.push(`${manifest.name}: ${errorMessage(error)}`);
    }
  }
  appendPackedPathHierarchyFailures(manifest.name, portablePackedPaths, failures);
  const has = (path: string): boolean => paths.includes(path);
  // Every published package carries its licence and its public README. Neither
  // is declared in `files` — npm includes them — so an empty package fails here
  // before anything else is examined.
  if (!has("LICENSE")) failures.push(`${manifest.name}: the tarball carries no LICENSE`);
  if (!has("README.md")) failures.push(`${manifest.name}: the tarball carries no README.md`);
  let velarEntries: ReturnType<typeof parseVelarPackageEntrySources> | null = null;
  if (manifest.velar?.entry !== undefined || manifest.velar?.entries !== undefined || manifest.velar?.artifacts !== undefined) {
    try {
      velarEntries = parseVelarPackageEntrySources(manifest.velar?.entry, manifest.velar?.entries);
    } catch (error) {
      failures.push(`${manifest.name}: VelarScript package entries are invalid: ${errorMessage(error)}`);
    }
  }
  const declared = declaredEntryPaths(manifest);
  if (declared.length === 0) {
    failures.push(`${manifest.name}: the manifest promises a consumer no entry point at all — no 'main', 'types', 'exports', 'bin' or 'velar.entry'`);
  }
  for (const path of declared) {
    const present = path.includes("*") ? matchesPattern(path, paths) : has(path);
    if (!present) failures.push(`${manifest.name}: the manifest points at '${path}', which is not in the tarball (${paths.length} file${paths.length === 1 ? "" : "s"} packed)`);
  }
  await inspectPackedArtifactReceipts(manifest, packedPathCounts, readPackedFile, velarEntries, failures);
  for (const [subpath, resource] of Object.entries(manifest.velar?.resources ?? {})) {
    const expected = `./${resource.path}`;
    let targets: string[];
    try {
      targets = exportTargetsAt(manifest, subpath);
    } catch (error) {
      failures.push(`${manifest.name}: resource '${subpath}' has an invalid npm export: ${errorMessage(error)}`);
      continue;
    }
    if (resource.type !== "json") failures.push(`${manifest.name}: resource '${subpath}' has unsupported type '${resource.type}'`);
    if (targets.length === 0) failures.push(`${manifest.name}: resource '${subpath}' has no matching npm export`);
    else if (targets.some((target) => target !== expected)) {
      failures.push(`${manifest.name}: resource '${subpath}' must export '${expected}' in every condition`);
    }
  }
  for (const subpath of Object.keys(manifest.velar?.entries ?? {})) {
    if (Object.hasOwn(manifest.velar?.resources ?? {}, subpath)) {
      failures.push(`${manifest.name}: '${subpath}' cannot be both a VelarScript entry and a JSON resource`);
    }
  }
  for (const path of paths) {
    if (/(?:^|\/)tests?(?:\/|$)/u.test(path)) failures.push(`${manifest.name}: the tarball ships '${path}'; tests are not published`);
  }
  return failures;
}

function assertPackedPath(path: string, label: string): void {
  if (path === "" || /[\u0000-\u001f\u007f]/u.test(path) || path.startsWith("/") || path.includes("\\")
    || path.split("/").some((segment) => segment === "" || segment === "." || segment === "..")) {
    throw new Error(`${label} must be a normalized relative path`);
  }
}

function appendPackedPathHierarchyFailures(
  packageName: string,
  portablePaths: ReadonlyMap<string, string>,
  failures: string[],
): void {
  for (const [key, path] of portablePaths) {
    const segments = key.split("/");
    for (let length = 1; length < segments.length; length += 1) {
      const ancestor = portablePaths.get(segments.slice(0, length).join("/"));
      if (ancestor !== undefined) {
        failures.push(`${packageName}: packed paths '${ancestor}' and '${path}' cannot be both a file and an ancestor directory`);
        break;
      }
    }
  }
}
