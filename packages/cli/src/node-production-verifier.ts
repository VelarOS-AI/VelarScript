import { lstat, readFile, readdir, stat } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileIdentity, MAX_PRODUCTION_ASSETS } from "./file-integrity.ts";
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

/**
 * 校验 Node 构建目录的结构和每一个文件字节。清单本身不提供发布者身份，
 * 但它能可靠发现传输损坏、漏文件、额外文件以及构建后被意外改写的内容。
 */
export async function verifyNodeProductionBuild(input: string, cwd = process.cwd()): Promise<VerifiedNodeProductionBuild> {
  const explicit = resolve(cwd, input);
  const directory = basename(explicit) === NODE_BUILD_MANIFEST_NAME ? dirname(explicit) : explicit;
  const manifestPath = join(directory, NODE_BUILD_MANIFEST_NAME);
  const actualFiles = await nodeProductionFiles(directory);
  const manifest = await readJson(manifestPath) as NodeProductionBuildManifest;

  if (manifest?.formatVersion !== 4 || manifest.kind !== "velar-node-build") {
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
  if (typeof manifest.app !== "string" || !/^[A-Za-z_][A-Za-z0-9_]*$/u.test(manifest.app)) {
    throw new Error(`${manifestPath} has an invalid startup binding`);
  }
  const entry = safeRelativePath(manifest.entry, "entry");
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
    const expectedRole = nodeProductionAssetRole(path, entry);
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

  for (const path of sortedPaths) {
    const expected = declared.get(path)!;
    const actual = await fileIdentity(join(directory, path));
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
  const sourceMapAssets = sortedPaths.filter((path) => declared.get(path)?.role === "source-map");
  if (manifest.sourceMaps && sourceMapAssets.length === 0) throw new Error(`${manifestPath} enables source maps but declares none`);
  if (!manifest.sourceMaps && sourceMapAssets.length > 0) throw new Error(`${manifestPath} disables source maps but declares source-map assets`);
  return { directory, manifest };
}

async function nodeProductionFiles(root: string): Promise<Set<string>> {
  const output = new Set<string>();
  const visit = async (directory: string): Promise<void> => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      const metadata = await lstat(path);
      const display = relative(root, path).replaceAll("\\", "/");
      if (metadata.isSymbolicLink()) throw new Error(`Node production build contains symbolic link '${display}'`);
      if (metadata.isDirectory()) await visit(path);
      else if (metadata.isFile()) {
        output.add(display);
        if (output.size > MAX_PRODUCTION_ASSETS + 1) {
          throw new RangeError(`A Node production build cannot contain more than ${MAX_PRODUCTION_ASSETS} assets`);
        }
      } else {
        throw new Error(`Node production build contains unsupported file '${display}'`);
      }
    }
  };
  try {
    if (!(await stat(root)).isDirectory()) throw new Error(`${root} is not a Node production build directory`);
    await visit(root);
  } catch (error) {
    if (isHostErrorCode(error, "ENOENT")) {
      throw new Error(`${root} does not contain a Node production build; run 'velar build' first`);
    }
    throw error;
  }
  if (!output.has(NODE_BUILD_MANIFEST_NAME)) throw new Error(`${root} does not contain ${NODE_BUILD_MANIFEST_NAME}`);
  return output;
}

async function readJson(path: string): Promise<unknown> {
  try {
    const metadata = await lstat(path);
    if (!metadata.isFile() || metadata.isSymbolicLink()) throw new Error("manifest is not an ordinary file");
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    throw new Error(`${path} is missing or invalid: ${hostErrorMessage(error)}`);
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
