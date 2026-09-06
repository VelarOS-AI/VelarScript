import { cp, lstat } from "node:fs/promises";
import { join } from "node:path";
import type { GeneratedOutputClaim } from "./generated-output-claim.ts";
import { isHostErrorCode } from "./host-error.ts";
import { resolveOwnedRuntimeDependency } from "./installed-package-closure.ts";
import { standardRuntimePackageLayout, standardRuntimePackageRoot } from "./standard-runtime-package-layout.ts";

interface NodeRuntimeDependency {
  readonly standardModule: string;
  readonly ownerName: string;
  readonly packageName: string;
  readonly version: string;
}

export const WEBSOCKET_VERSION = "8.21.1";
export const YAML_VERSION = "2.9.0";

const NODE_RUNTIME_DEPENDENCIES: readonly NodeRuntimeDependency[] = [
  { standardModule: "velar/websocket", ownerName: "@velarscript/node", packageName: "ws", version: WEBSOCKET_VERSION },
  { standardModule: "velar/server", ownerName: "@velarscript/server", packageName: "yaml", version: YAML_VERSION },
];

/** Reserves host dependencies inside the generated package that imports them. */
export function nodeRuntimeDependencyOutputClaims(
  nodeModulesRoot: string,
  used: ReadonlySet<string>,
): readonly GeneratedOutputClaim[] {
  return requiredRuntimeDependencies(used).map((dependency) => ({
    path: runtimeDependencyOutputPath(nodeModulesRoot, dependency),
    kind: "tree",
    owner: `Node runtime dependency '${dependency.packageName}'`,
  }));
}

export async function writeNodeRuntimeDependencies(
  nodeModulesRoot: string,
  used: ReadonlySet<string>,
): Promise<void> {
  for (const dependency of requiredRuntimeDependencies(used)) {
    await writeRuntimeDependency(runtimeDependencyOwnerRoot(nodeModulesRoot, dependency), dependency);
  }
}

function requiredRuntimeDependencies(used: ReadonlySet<string>): readonly NodeRuntimeDependency[] {
  return NODE_RUNTIME_DEPENDENCIES.filter(({ standardModule }) => used.has(standardModule));
}

function runtimeDependencyOutputPath(nodeModulesRoot: string, dependency: NodeRuntimeDependency): string {
  return join(runtimeDependencyOwnerRoot(nodeModulesRoot, dependency), dependency.packageName);
}

function runtimeDependencyOwnerRoot(nodeModulesRoot: string, dependency: NodeRuntimeDependency): string {
  const [owner] = standardRuntimePackageLayout([dependency.standardModule]);
  if (!owner) throw new Error(`Node runtime dependency '${dependency.packageName}' has no runtime package owner`);
  return join(standardRuntimePackageRoot(nodeModulesRoot, owner.name), "node_modules");
}

async function writeRuntimeDependency(
  nodeModulesRoot: string,
  { ownerName, packageName, version }: NodeRuntimeDependency,
): Promise<void> {
  const target = join(nodeModulesRoot, packageName);
  const dependency = await resolveOwnedRuntimeDependency(ownerName, packageName);
  if (dependency.version !== version) {
    throw new Error(`Installed runtime dependency '${dependency.root}' does not match ${packageName}@${version}`);
  }
  const source = dependency.root;

  try {
    await lstat(target);
    throw runtimeDependencyOutputCollision(packageName, target);
  } catch (error) {
    if (!isHostErrorCode(error, "ENOENT")) {
      if (isHostErrorCode(error, "ENOTDIR")) throw runtimeDependencyOutputCollision(packageName, target);
      throw error;
    }
  }

  try {
    // `force: false` is what makes `errorOnExist` effective. Besides refusing
    // an output already claimed by a checked resource, fs.cp then creates the
    // package root as its exclusive claim: two producers racing for the same
    // staging tree cannot both merge partial package contents and report a
    // successful build.
    await cp(source, target, { recursive: true, force: false, errorOnExist: true });
  } catch (error) {
    if (isRuntimeDependencyCopyCollision(error)) throw runtimeDependencyOutputCollision(packageName, target);
    throw error;
  }
}

function runtimeDependencyOutputCollision(packageName: string, target: string): Error {
  return new Error(`Node runtime dependency '${packageName}' conflicts with an existing build output '${target}'`);
}

function isRuntimeDependencyCopyCollision(error: unknown): boolean {
  return isHostErrorCode(error, "ERR_FS_CP_EEXIST")
    || isHostErrorCode(error, "ERR_FS_CP_DIR_TO_NON_DIR")
    || isHostErrorCode(error, "EEXIST")
    || isHostErrorCode(error, "EISDIR")
    || isHostErrorCode(error, "ENOTDIR")
    || isHostErrorCode(error, "ENOTEMPTY");
}
