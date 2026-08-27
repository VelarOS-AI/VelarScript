import { createHash } from "node:crypto";
import { lstat, readdir, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { BUILD_STAGING_MARKER } from "./build-staging.ts";
import { fileIdentity, MAX_PRODUCTION_ASSETS } from "./file-integrity.ts";
import type { JavaScriptBuildMode } from "./javascript-output.ts";
import { VELAR_VERSION } from "./version.ts";

export const NODE_BUILD_MANIFEST_NAME = "velar-node.json";

export interface NodeProductionBuildManifest {
  readonly formatVersion: 5;
  readonly kind: "velar-node-build";
  readonly compiler: {
    readonly name: "velar";
    readonly version: string;
  };
  readonly buildId: string;
  readonly mode: JavaScriptBuildMode;
  readonly entry: string;
  readonly configuration: string | null;
  readonly sourceMaps: boolean;
  readonly assets: readonly NodeProductionAsset[];
}

export interface NodeProductionAsset {
  readonly path: string;
  readonly sizeBytes: number;
  readonly sha256: string;
  readonly role: "entry" | "source-map" | "configuration" | "asset";
}

interface NodeProductionBuildInput {
  readonly mode: JavaScriptBuildMode;
  readonly entry: string;
  readonly configuration: string | null;
  readonly sourceMaps: boolean;
}

/**
 * Node 产物与 Web 产物使用同一种完整性模型：清单列出目录中的每个普通
 * 文件及其内容哈希，buildId 再绑定排好序的整份清单。这样 verify 检查的
 * 是准备部署的确切字节，而不是只检查一个任何人都能仿造的“构建完成”标记。
 */
export async function writeNodeProductionManifest(
  outputDirectory: string,
  build: NodeProductionBuildInput,
): Promise<NodeProductionBuildManifest> {
  const files: Array<{ readonly path: string; readonly absolutePath: string }> = [];
  const visit = async (directory: string): Promise<void> => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const absolutePath = join(directory, entry.name);
      const rootReceipt = directory === outputDirectory
        && (entry.name === NODE_BUILD_MANIFEST_NAME || entry.name === BUILD_STAGING_MARKER);
      if (rootReceipt) continue;
      const metadata = await lstat(absolutePath);
      const display = relative(outputDirectory, absolutePath).replaceAll("\\", "/");
      if (metadata.isSymbolicLink()) throw new Error(`Node production build contains symbolic link '${display}'`);
      if (metadata.isDirectory()) await visit(absolutePath);
      else if (metadata.isFile()) {
        files.push({ path: display, absolutePath });
        if (files.length > MAX_PRODUCTION_ASSETS) {
          throw new RangeError(`A Node production build cannot contain more than ${MAX_PRODUCTION_ASSETS} assets`);
        }
      } else {
        throw new Error(`Node production build contains unsupported file '${display}'`);
      }
    }
  };
  await visit(outputDirectory);
  files.sort((left, right) => byCodePoint(left.path, right.path));

  const assets: NodeProductionAsset[] = [];
  for (const file of files) {
    const identity = await fileIdentity(file.absolutePath);
    assets.push({
      path: file.path,
      sizeBytes: identity.sizeBytes,
      sha256: identity.sha256,
      role: nodeProductionAssetRole(file.path, build.entry, build.configuration),
    });
  }
  const buildId = nodeProductionBuildId(assets);
  const manifest: NodeProductionBuildManifest = {
    formatVersion: 5,
    kind: "velar-node-build",
    compiler: { name: "velar", version: VELAR_VERSION },
    buildId,
    mode: build.mode,
    entry: build.entry,
    configuration: build.configuration,
    sourceMaps: build.sourceMaps,
    assets,
  };
  await writeFile(join(outputDirectory, NODE_BUILD_MANIFEST_NAME), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  return manifest;
}

export function nodeProductionBuildId(assets: readonly Pick<NodeProductionAsset, "path" | "sha256">[]): string {
  return createHash("sha256")
    .update(assets.map((asset) => `${asset.path}\0${asset.sha256}`).join("\n"))
    .digest("hex");
}

export function nodeProductionAssetRole(path: string, entry: string, configuration: string | null): NodeProductionAsset["role"] {
  if (path === entry) return "entry";
  if (path.endsWith(".map")) return "source-map";
  if (configuration !== null && path === configuration) return "configuration";
  return "asset";
}

function byCodePoint(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
