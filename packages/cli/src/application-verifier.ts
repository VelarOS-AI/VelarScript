import { lstat } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { resolveVelarProject } from "./config.ts";
import { NODE_BUILD_MANIFEST_NAME } from "./node-production-build.ts";
import { verifyNodeProductionBuild, type VerifiedNodeProductionBuild } from "./node-production-verifier.ts";
import { PRODUCTION_MANIFEST_NAME } from "./production-build.ts";
import { verifyProductionBuild, type VerifiedProductionBuild } from "./production-verifier.ts";

export type VerifiedApplicationBuild =
  | { readonly kind: "framework"; readonly build: VerifiedProductionBuild }
  | { readonly kind: "node"; readonly build: VerifiedNodeProductionBuild };

/**
 * `velar verify` 的入口先识别产物类型，再交给各目标自己的严格校验器。
 * 因此传项目目录、构建目录或具体清单文件含义一致，也不会把 Node 构建
 * 目录错误地当成缺少 velar.json 的源码项目。
 */
export async function verifyApplicationBuild(input: string | null, cwd = process.cwd()): Promise<VerifiedApplicationBuild> {
  const direct = await directBuildDirectory(input, cwd);
  if (direct) return verifyBuildDirectory(direct);
  const project = await resolveVelarProject(input, cwd);
  return verifyBuildDirectory(project.outDir);
}

async function directBuildDirectory(input: string | null, cwd: string): Promise<string | null> {
  const candidate = resolve(cwd, input ?? ".");
  if (input && (basename(candidate) === PRODUCTION_MANIFEST_NAME || basename(candidate) === NODE_BUILD_MANIFEST_NAME)) {
    return dirname(candidate);
  }
  return await hasBuildManifest(candidate) ? candidate : null;
}

async function verifyBuildDirectory(directory: string): Promise<VerifiedApplicationBuild> {
  const framework = await ordinaryFile(join(directory, PRODUCTION_MANIFEST_NAME));
  const node = await ordinaryFile(join(directory, NODE_BUILD_MANIFEST_NAME));
  if (framework && node) throw new Error(`${directory} contains both Web and Node build manifests`);
  if (framework) return { kind: "framework", build: await verifyProductionBuild(directory) };
  if (node) return { kind: "node", build: await verifyNodeProductionBuild(directory) };
  throw new Error(`${directory} does not contain ${PRODUCTION_MANIFEST_NAME} or ${NODE_BUILD_MANIFEST_NAME}; run 'velar build' first`);
}

async function hasBuildManifest(directory: string): Promise<boolean> {
  return await ordinaryFile(join(directory, PRODUCTION_MANIFEST_NAME))
    || await ordinaryFile(join(directory, NODE_BUILD_MANIFEST_NAME));
}

async function ordinaryFile(path: string): Promise<boolean> {
  try {
    const metadata = await lstat(path);
    return metadata.isFile() && !metadata.isSymbolicLink();
  } catch {
    return false;
  }
}
