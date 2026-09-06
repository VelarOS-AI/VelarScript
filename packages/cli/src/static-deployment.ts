import { lstat, mkdir } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import type { FrameworkRequiredPublicAsset, FrameworkStaticDeployment } from "@velarscript/compiler/framework-host";
import { BUILD_STAGING_MARKER, writeExclusiveBuildFile } from "./build-staging.ts";
import {
  assertDirectorySnapshotUnchanged,
  type BoundedDirectorySnapshot,
  copyInspectedFile,
  inspectBoundedDirectory,
  MAX_PUBLIC_ASSET_BYTES,
  MAX_PUBLIC_ASSET_TOTAL_BYTES,
  publicAssetDirectoryPolicy,
} from "./bounded-directory-snapshot.ts";
import { VELAR_VERSION } from "./version.ts";
import type { ProductionFrameworkIdentity } from "./production-build.ts";
import { isHostErrorCode } from "./host-error.ts";

export const STATIC_DEPLOYMENT_MANIFEST_NAME = "velar-deploy.json";
export const STATIC_FALLBACK_NAME = "404.html";
// Every name the builder writes at the root of the output, so a public file
// cannot take one: the manifest walk skips these at that one level, and a copy
// that survived there would be a file `velar verify` reports as undeclared for
// the rest of the build's life.
const reservedRootFiles = new Set([
  "index.html",
  STATIC_FALLBACK_NAME,
  "velar-build.json",
  STATIC_DEPLOYMENT_MANIFEST_NAME,
  BUILD_STAGING_MARKER,
]);
/**
 * `assets/` is the builder's own namespace: the deployment manifest gives
 * everything under it a one-year `immutable` rule, which is only sound for the
 * content-hashed names the builder produced. A public file copied there would
 * inherit that rule under a stable name, so a replacement could never reach a
 * browser that already fetched it.
 */
const reservedRootNames = new Map<string, string>([
  ["assets", "'assets' holds the build's content-hashed output and carries a one-year immutable cache rule; put it under public/static/ instead"],
]);

export interface StaticDeploymentSummary {
  readonly manifest: typeof STATIC_DEPLOYMENT_MANIFEST_NAME;
  readonly fallback: typeof STATIC_FALLBACK_NAME | null;
  readonly contentSecurityPolicy: boolean;
}

export interface StaticDeploymentManifest {
  readonly formatVersion: 2;
  readonly kind: "velar-static-deployment";
  readonly compiler: { readonly name: "velar"; readonly version: string };
  readonly framework: ProductionFrameworkIdentity;
  readonly base: string;
  readonly spaFallback: { readonly source: "index.html"; readonly fallback: typeof STATIC_FALLBACK_NAME } | null;
  readonly headers: readonly {
    readonly path: string;
    readonly values: Readonly<Record<string, string>>;
  }[];
  readonly caching: {
    readonly assets: "public, max-age=31536000, immutable";
    readonly documents: "no-cache";
  };
}

export interface PublicAssetCopyOptions {
  /** Deterministic test seam after the bounded tree inventory has captured every identity. */
  readonly afterDirectoryInventory?: () => Promise<void>;
  /** Deterministic test seam immediately before each inventoried source descriptor is opened. */
  readonly beforeFileCopy?: (path: string) => Promise<void>;
}

/**
 * A manifest field may name a public file the emitted document points at —
 * `web.icon` is the first. The build fails when that file is absent rather
 * than shipping a document whose own reference resolves to nothing, matching
 * the boundary already enforced for reserved names and symbolic links.
 */
export async function assertRequiredPublicAssets(
  publicRoot: string,
  projectRoot: string,
  required: readonly FrameworkRequiredPublicAsset[],
): Promise<void> {
  for (const asset of required) {
    const path = join(publicRoot, asset.path);
    const expected = relative(projectRoot, path).replaceAll("\\", "/");
    let metadata;
    try {
      metadata = await lstat(path);
    } catch (error) {
      if (!isHostErrorCode(error, "ENOENT") && !isHostErrorCode(error, "ENOTDIR")) throw error;
      throw new Error(`'${asset.field}' names public asset '${asset.path}', but '${expected}' does not exist`);
    }
    if (!metadata.isFile() || metadata.isSymbolicLink()) {
      throw new Error(`'${asset.field}' names public asset '${asset.path}', but '${expected}' is not a regular file`);
    }
  }
}

export async function copyPublicAssets(
  publicRoot: string,
  outputDirectory: string,
  allowReservedRootFiles = false,
  operations: PublicAssetCopyOptions = {},
): Promise<void> {
  let inventory: BoundedDirectorySnapshot;
  try {
    inventory = await inspectBoundedDirectory(publicRoot, "Public assets", publicAssetDirectoryPolicy);
  } catch (error) {
    if (isHostErrorCode(error, "ENOENT")) return;
    throw error;
  }
  assertPublicRootNames(inventory, allowReservedRootFiles);
  await operations.afterDirectoryInventory?.();
  await assertDirectorySnapshotUnchanged(inventory, "Public assets");
  await mkdir(outputDirectory, { recursive: true });
  for (const path of inventory.directories.keys()) {
    if (path !== "") await makePublicDirectory(join(outputDirectory, path), path);
  }
  let copiedBytes = 0;
  for (const file of inventory.files.values()) {
    const destination = join(outputDirectory, file.path);
    await mkdir(dirname(destination), { recursive: true });
    try {
      await operations.beforeFileCopy?.(file.path);
      copiedBytes += await copyInspectedFile(file, destination, MAX_PUBLIC_ASSET_BYTES, `Public asset '${file.path}'`);
    } catch (error) {
      if (isOutputConflict(error)) {
        throw new Error(`public asset '${file.path}' conflicts with an existing build output`);
      }
      throw error;
    }
    if (copiedBytes > MAX_PUBLIC_ASSET_TOTAL_BYTES) {
      throw new RangeError(`Public assets exceed ${MAX_PUBLIC_ASSET_TOTAL_BYTES} total file bytes`);
    }
  }
  await assertDirectorySnapshotUnchanged(inventory, "Public assets");
}

function assertPublicRootNames(inventory: BoundedDirectorySnapshot, allowReservedRootFiles: boolean): void {
  if (allowReservedRootFiles) return;
  const rootNames = new Set<string>();
  for (const path of [...inventory.files.keys(), ...inventory.directories.keys()]) {
    if (path !== "" && !path.includes("/")) rootNames.add(path);
  }
  for (const name of rootNames) {
    if (reservedRootFiles.has(name)) {
      throw new Error(`public asset '${name}' is reserved by the VelarScript production builder`);
    }
    const reservation = reservedRootNames.get(name);
    if (reservation !== undefined) {
      throw new Error(`public asset '${name}' is reserved by the VelarScript production builder: ${reservation}`);
    }
  }
}

async function makePublicDirectory(path: string, display: string): Promise<void> {
  try {
    await mkdir(path, { recursive: true });
  } catch (error) {
    if (isOutputConflict(error)) throw new Error(`public asset '${display}' conflicts with an existing build output`);
    throw error;
  }
}

function isOutputConflict(error: unknown): boolean {
  return isHostErrorCode(error, "EEXIST") || isHostErrorCode(error, "EISDIR") || isHostErrorCode(error, "ENOTDIR");
}

export async function writeStaticDeployment(
  outputDirectory: string,
  html: string,
  config: FrameworkStaticDeployment,
  framework: ProductionFrameworkIdentity,
): Promise<StaticDeploymentSummary> {
  const securityHeaders: Record<string, string> = {
    "Cross-Origin-Opener-Policy": "same-origin",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
  };
  if (config.contentSecurityPolicy) {
    securityHeaders["Content-Security-Policy"] = config.contentSecurityPolicy;
  }
  const basePattern = `${config.base}*`;
  const documentPaths = [
    config.base,
    `${config.base}index.html`,
    `${config.base}velar-build.json`,
    `${config.base}${STATIC_DEPLOYMENT_MANIFEST_NAME}`,
    ...(config.spaFallback ? [`${config.base}${STATIC_FALLBACK_NAME}`] : []),
  ];
  const manifest: StaticDeploymentManifest = {
    formatVersion: 2,
    kind: "velar-static-deployment",
    compiler: { name: "velar", version: VELAR_VERSION },
    framework,
    base: config.base,
    spaFallback: config.spaFallback ? { source: "index.html", fallback: STATIC_FALLBACK_NAME } : null,
    headers: [
      { path: basePattern, values: securityHeaders },
      // Every document the SPA fallback serves is a deep route the enumerated
      // paths below cannot name, and `verify-deployment` requires `no-cache` on
      // one of them. Stating the rule here is what makes a provider that
      // projects this manifest literally indistinguishable from `velar preview`;
      // the narrower rules that follow win under last-match-wins, so the hashed
      // assets keep their immutable year.
      { path: basePattern, values: { "Cache-Control": "no-cache" } },
      { path: `${config.base}assets/*`, values: { "Cache-Control": "public, max-age=31536000, immutable" } },
      ...documentPaths.map((path) => ({ path, values: { "Cache-Control": "no-cache" } })),
    ],
    caching: { assets: "public, max-age=31536000, immutable", documents: "no-cache" },
  };
  if (config.spaFallback) {
    await writeExclusiveBuildFile(
      join(outputDirectory, STATIC_FALLBACK_NAME),
      html,
      `Static fallback '${STATIC_FALLBACK_NAME}'`,
    );
  }
  await writeExclusiveBuildFile(
    join(outputDirectory, STATIC_DEPLOYMENT_MANIFEST_NAME),
    `${JSON.stringify(manifest, null, 2)}\n`,
    `Static deployment manifest '${STATIC_DEPLOYMENT_MANIFEST_NAME}'`,
  );
  return {
    manifest: STATIC_DEPLOYMENT_MANIFEST_NAME,
    fallback: config.spaFallback ? STATIC_FALLBACK_NAME : null,
    contentSecurityPolicy: config.contentSecurityPolicy !== null,
  };
}
