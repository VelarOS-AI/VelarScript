import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import {
  assertDirectorySnapshotUnchanged,
  type BoundedDirectorySnapshot,
  inspectBoundedDirectory,
  inspectedFileIdentity,
  type InspectedDirectoryFile,
  MAX_PRODUCTION_FILE_BYTES,
  MAX_PRODUCTION_MANIFEST_BYTES,
  MAX_PRODUCTION_TOTAL_BYTES,
  productionDirectoryPolicy,
  readInspectedJson,
} from "./bounded-directory-snapshot.ts";
import {
  authorizeBuildOutputCommit,
  type BuildOutputCommitAuthorization,
} from "./build-output-commit.ts";
import { MAX_PRODUCTION_ASSETS } from "./file-integrity.ts";
import { BUILD_STAGING_MARKER } from "./build-staging.ts";
import { hostErrorMessage, isHostErrorCode } from "./host-error.ts";
import {
  NODE_BUILD_MANIFEST_NAME,
  nodeProductionAssetRole,
  nodeProductionBuildId,
  type NodeProductionAsset,
  type NodeProductionBuildManifest,
} from "./node-production-build.ts";

export interface VerifiedNodeProductionBuild {
  readonly directory: string;
  readonly manifest: NodeProductionBuildManifest;
}

export interface NodeProductionVerificationOptions {
  /** Recovery may validate a committed tree before removing its transaction marker. */
  readonly allowBuildStagingMarker?: boolean;
  /** Deterministic test seam after the bounded tree inventory has captured every identity. */
  readonly afterDirectoryInventory?: () => Promise<void>;
  /** Deterministic test seam immediately before each inventoried asset descriptor is opened. */
  readonly beforeAssetVerification?: (path: string) => Promise<void>;
}

/**
 * 校验 Node 构建目录的结构和每一个文件字节。清单本身不提供发布者身份，
 * 但它能可靠发现传输损坏、漏文件、额外文件以及构建后被意外改写的内容。
 */
export async function verifyNodeProductionBuild(
  input: string,
  cwd = process.cwd(),
  options: NodeProductionVerificationOptions = {},
): Promise<VerifiedNodeProductionBuild> {
  const verified = await inspectNodeProductionBuild(input, cwd, options);
  return { directory: verified.directory, manifest: verified.manifest };
}

/** Returns the authenticated tree identity consumed by the final directory commit. */
export async function verifyNodeProductionBuildForCommit(
  input: string,
  cwd = process.cwd(),
  options: NodeProductionVerificationOptions = {},
): Promise<BuildOutputCommitAuthorization> {
  const verified = await inspectNodeProductionBuild(input, cwd, options);
  return authorizeBuildOutputCommit(verified.directory, verified.snapshot, async (installedDirectory) => {
    await inspectNodeProductionBuild(installedDirectory, cwd, { allowBuildStagingMarker: true });
  });
}

async function inspectNodeProductionBuild(
  input: string,
  cwd: string,
  options: NodeProductionVerificationOptions,
): Promise<VerifiedNodeProductionBuild & { readonly snapshot: BoundedDirectorySnapshot }> {
  const explicit = resolve(cwd, input);
  const directory = basename(explicit) === NODE_BUILD_MANIFEST_NAME ? dirname(explicit) : explicit;
  const manifestPath = join(directory, NODE_BUILD_MANIFEST_NAME);
  const inventory = await nodeProductionFiles(directory, options.allowBuildStagingMarker ?? false);
  const actualFiles = new Set(inventory.files.keys());
  const manifestFile = inventory.files.get(NODE_BUILD_MANIFEST_NAME);
  if (!manifestFile) throw new Error(`${directory} does not contain ${NODE_BUILD_MANIFEST_NAME}`);
  await options.afterDirectoryInventory?.();
  await assertDirectorySnapshotUnchanged(inventory, "Node production build");
  const manifest = await readJson(manifestFile) as NodeProductionBuildManifest;

  if (manifest?.formatVersion !== 5 || manifest.kind !== "velar-node-build") {
    throw new Error(`${manifestPath} has an unsupported Node production build format`);
  }
  if (manifest.compiler?.name !== "velar" || typeof manifest.compiler.version !== "string" || !manifest.compiler.version) {
    throw new Error(`${manifestPath} has invalid compiler identity`);
  }
  if (manifest.mode !== "production" && manifest.mode !== "readable") {
    throw new Error(`${manifestPath} has an invalid JavaScript build mode`);
  }
  if (typeof manifest.buildId !== "string" || !/^[a-f0-9]{64}$/u.test(manifest.buildId)) {
    throw new Error(`${manifestPath} has an invalid buildId`);
  }
  if (typeof manifest.sourceMaps !== "boolean") throw new Error(`${manifestPath} has invalid source-map state`);
  const entry = safeRelativePath(manifest.entry, "entry");
  const configuration = manifest.configuration === null
    ? null
    : safeRelativePath(manifest.configuration, "configuration");
  if (!Array.isArray(manifest.assets) || manifest.assets.length === 0) throw new Error(`${manifestPath} has no asset inventory`);
  if (manifest.assets.length > MAX_PRODUCTION_ASSETS) {
    throw new Error(`${manifestPath} exceeds the ${MAX_PRODUCTION_ASSETS}-asset production limit`);
  }

  const declared = new Map<string, NodeProductionAsset>();
  for (const asset of manifest.assets) {
    const path = safeRelativePath(asset?.path, "asset path");
    if (declared.has(path)) throw new Error(`${manifestPath} declares duplicate asset '${path}'`);
    if (!Number.isSafeInteger(asset.sizeBytes) || asset.sizeBytes < 0) throw new Error(`${manifestPath} has invalid size for '${path}'`);
    if (typeof asset.sha256 !== "string" || !/^[a-f0-9]{64}$/u.test(asset.sha256)) {
      throw new Error(`${manifestPath} has invalid SHA-256 for '${path}'`);
    }
    if (asset.role !== "entry" && asset.role !== "source-map" && asset.role !== "configuration" && asset.role !== "asset") {
      throw new Error(`${manifestPath} has invalid role for '${path}'`);
    }
    const expectedRole = nodeProductionAssetRole(path, entry, configuration);
    if (asset.role !== expectedRole) {
      throw new Error(`${manifestPath} must classify '${path}' as ${expectedRole}`);
    }
    declared.set(path, asset);
  }
  const declaredPaths = [...declared.keys()];
  const sortedPaths = [...declaredPaths].sort(byCodePoint);
  if (declaredPaths.some((path, index) => path !== sortedPaths[index])) {
    throw new Error(`${manifestPath} asset inventory is not deterministically sorted`);
  }

  const actualPaths = [...actualFiles].filter((path) => path !== NODE_BUILD_MANIFEST_NAME).sort(byCodePoint);
  const missing = sortedPaths.filter((path) => !actualFiles.has(path));
  const unexpected = actualPaths.filter((path) => !declared.has(path));
  if (missing.length > 0) throw new Error(`Node production build is missing declared asset '${missing[0]}'`);
  if (unexpected.length > 0) throw new Error(`Node production build contains undeclared file '${unexpected[0]}'`);

  let verifiedBytes = 0;
  for (const path of sortedPaths) {
    const expected = declared.get(path)!;
    const inspected = inventory.files.get(path)!;
    await options.beforeAssetVerification?.(path);
    const actual = await inspectedFileIdentity(inspected, MAX_PRODUCTION_FILE_BYTES, `Node production asset '${path}'`);
    verifiedBytes += actual.sizeBytes;
    if (verifiedBytes > MAX_PRODUCTION_TOTAL_BYTES) {
      throw new RangeError(`Node production build exceeds ${MAX_PRODUCTION_TOTAL_BYTES} total asset bytes`);
    }
    if (actual.sizeBytes !== expected.sizeBytes) {
      throw new Error(`Node production asset '${path}' size does not match ${NODE_BUILD_MANIFEST_NAME}`);
    }
    if (actual.sha256 !== expected.sha256) {
      throw new Error(`Node production asset '${path}' SHA-256 does not match ${NODE_BUILD_MANIFEST_NAME}`);
    }
  }
  if (nodeProductionBuildId(manifest.assets) !== manifest.buildId) {
    throw new Error(`${manifestPath} buildId does not match its asset inventory`);
  }
  if (declared.get(entry)?.role !== "entry") throw new Error(`${manifestPath} entry '${entry}' is not the entry asset`);
  if (sortedPaths.filter((path) => declared.get(path)?.role === "entry").length !== 1) {
    throw new Error(`${manifestPath} must declare exactly one entry asset`);
  }
  if (configuration !== null && declared.get(configuration)?.role !== "configuration") {
    throw new Error(`${manifestPath} configuration '${configuration}' is not the configuration asset`);
  }
  const sourceMapAssets = sortedPaths.filter((path) => declared.get(path)?.role === "source-map");
  if (manifest.sourceMaps && sourceMapAssets.length === 0) throw new Error(`${manifestPath} enables source maps but declares none`);
  if (!manifest.sourceMaps && sourceMapAssets.length > 0) throw new Error(`${manifestPath} disables source maps but declares source-map assets`);
  await assertDirectorySnapshotUnchanged(inventory, "Node production build");
  return { directory, manifest, snapshot: inventory };
}

async function nodeProductionFiles(root: string, allowBuildStagingMarker: boolean): Promise<BoundedDirectorySnapshot> {
  try {
    return await inspectBoundedDirectory(root, "Node production build", productionDirectoryPolicy, {
      ...(allowBuildStagingMarker ? { ignoredRootNames: new Set([BUILD_STAGING_MARKER]) } : {}),
    });
  } catch (error) {
    if (isHostErrorCode(error, "ENOENT")) {
      throw new Error(`${root} does not contain a Node production build; run 'velar build' first`);
    }
    throw error;
  }
}

async function readJson(file: InspectedDirectoryFile): Promise<unknown> {
  try {
    return await readInspectedJson(file, MAX_PRODUCTION_MANIFEST_BYTES, "Node production build manifest");
  } catch (error) {
    throw new Error(`${file.absolutePath} is missing or invalid: ${hostErrorMessage(error)}`);
  }
}

function safeRelativePath(value: unknown, label: string): string {
  if (typeof value !== "string" || !value || isAbsolute(value) || value.includes("\\")) {
    throw new Error(`Node production ${label} must be a normalized relative path`);
  }
  const segments = value.split("/");
  if (segments.some((segment) => !segment || segment === "." || segment === "..")) {
    throw new Error(`Node production ${label} must be a normalized relative path`);
  }
  return value;
}

function byCodePoint(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
