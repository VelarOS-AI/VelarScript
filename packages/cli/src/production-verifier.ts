import { createHash } from "node:crypto";
import { stat } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import type { ProductionBuildManifest } from "./production-build.ts";
import { PRODUCTION_MANIFEST_NAME } from "./production-build.ts";
import { BUILD_STAGING_MARKER } from "./build-staging.ts";
import {
  assertDirectorySnapshotUnchanged,
  type BoundedDirectorySnapshot,
  type InspectedDirectoryFile,
  inspectBoundedDirectory,
  inspectedFileIdentity,
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
import { resolveVelarProject } from "./config.ts";
import type { StaticDeploymentManifest } from "./static-deployment.ts";
import { MAX_PRODUCTION_ASSETS } from "./file-integrity.ts";
import { hostErrorMessage, isHostErrorCode } from "./host-error.ts";

export interface VerifiedProductionBuild {
  readonly directory: string;
  readonly manifest: ProductionBuildManifest;
  readonly deployment: StaticDeploymentManifest;
}

export interface ProductionVerificationOptions {
  /** Recovery may validate a committed tree before removing its transaction marker. */
  readonly allowBuildStagingMarker?: boolean;
  /** Deterministic test seam after the bounded tree inventory has captured every identity. */
  readonly afterDirectoryInventory?: () => Promise<void>;
  /** Deterministic test seam immediately before each inventoried asset descriptor is opened. */
  readonly beforeAssetVerification?: (path: string) => Promise<void>;
}

const assetRoles = new Set(["entry", "stylesheet", "source-map", "html", "deployment", "asset"]);

export async function verifyProductionBuild(
  input: string | null,
  cwd = process.cwd(),
  options: ProductionVerificationOptions = {},
): Promise<VerifiedProductionBuild> {
  const verified = await inspectProductionBuild(input, cwd, options);
  return { directory: verified.directory, manifest: verified.manifest, deployment: verified.deployment };
}

/** Returns the authenticated tree identity consumed by the final directory commit. */
export async function verifyProductionBuildForCommit(
  input: string,
  cwd = process.cwd(),
  options: ProductionVerificationOptions = {},
): Promise<BuildOutputCommitAuthorization> {
  const verified = await inspectProductionBuild(input, cwd, options);
  return authorizeBuildOutputCommit(verified.directory, verified.snapshot, async (installedDirectory) => {
    await inspectProductionBuild(installedDirectory, cwd, { allowBuildStagingMarker: true });
  });
}

async function inspectProductionBuild(
  input: string | null,
  cwd: string,
  options: ProductionVerificationOptions,
): Promise<VerifiedProductionBuild & { readonly snapshot: BoundedDirectorySnapshot }> {
  const directory = await resolveProductionDirectory(input, cwd);
  const manifestPath = join(directory, PRODUCTION_MANIFEST_NAME);
  const inventory = await productionFiles(directory, options.allowBuildStagingMarker ?? false);
  const actualFiles = new Set(inventory.files.keys());
  const manifestFile = inventory.files.get(PRODUCTION_MANIFEST_NAME);
  if (!manifestFile) throw new Error(`${directory} does not contain ${PRODUCTION_MANIFEST_NAME}`);
  await options.afterDirectoryInventory?.();
  await assertDirectorySnapshotUnchanged(inventory, "Production build");
  const manifest = await readJson(manifestFile, "production build manifest") as ProductionBuildManifest;
  if (manifest?.formatVersion !== 4 || manifest?.kind !== "velar-framework-build") {
    throw new Error(`${manifestPath} has an unsupported production build format`);
  }
  if (manifest.mode !== "production" && manifest.mode !== "readable") {
    throw new Error(`${manifestPath} has an invalid JavaScript build mode`);
  }
  if (manifest.compiler?.name !== "velar" || typeof manifest.compiler.version !== "string" || !manifest.compiler.version) {
    throw new Error(`${manifestPath} has invalid compiler identity`);
  }
  const framework = manifest.framework;
  if (!framework || typeof framework.id !== "string" || !framework.id
    || typeof framework.capability !== "string" || !/^[a-z][a-z0-9-]*$/u.test(framework.capability)
    || framework.target !== "browser" || !Number.isInteger(framework.protocolVersion) || framework.protocolVersion < 1
    || typeof framework.apiVersion !== "string" || !framework.apiVersion
    || typeof framework.artifactKind !== "string" || !/^[a-z][a-z0-9-]*$/u.test(framework.artifactKind)) {
    throw new Error(`${manifestPath} has an invalid framework host identity`);
  }
  if (!Array.isArray(manifest.assets) || manifest.assets.length === 0) throw new Error(`${manifestPath} has no asset inventory`);
  if (manifest.assets.length > MAX_PRODUCTION_ASSETS) throw new Error(`${manifestPath} exceeds the ${MAX_PRODUCTION_ASSETS}-asset production limit`);

  const declared = new Map<string, ProductionBuildManifest["assets"][number]>();
  for (const asset of manifest.assets) {
    const path = safeRelativePath(asset?.path, "asset path");
    if (declared.has(path)) throw new Error(`${manifestPath} declares duplicate asset '${path}'`);
    if (!Number.isInteger(asset.sizeBytes) || asset.sizeBytes < 0) throw new Error(`${manifestPath} has invalid size for '${path}'`);
    if (typeof asset.sha256 !== "string" || !/^[a-f0-9]{64}$/u.test(asset.sha256)) {
      throw new Error(`${manifestPath} has invalid SHA-256 for '${path}'`);
    }
    if (!assetRoles.has(asset.role)) throw new Error(`${manifestPath} has invalid role for '${path}'`);
    declared.set(path, asset);
  }
  const declaredPaths = [...declared.keys()];
  const sortedPaths = [...declaredPaths].sort();
  if (declaredPaths.some((path, index) => path !== sortedPaths[index])) {
    throw new Error(`${manifestPath} asset inventory is not deterministically sorted`);
  }

  const expectedFiles = [...actualFiles].filter((path) => path !== PRODUCTION_MANIFEST_NAME).sort();
  const missing = sortedPaths.filter((path) => !actualFiles.has(path));
  const unexpected = expectedFiles.filter((path) => !declared.has(path));
  if (missing.length > 0) throw new Error(`Production build is missing declared asset '${missing[0]}'`);
  if (unexpected.length > 0) throw new Error(`Production build contains undeclared file '${unexpected[0]}'`);

  let verifiedBytes = 0;
  for (const path of sortedPaths) {
    const asset = declared.get(path)!;
    const inspected = inventory.files.get(path)!;
    await options.beforeAssetVerification?.(path);
    const identity = await inspectedFileIdentity(inspected, MAX_PRODUCTION_FILE_BYTES, `Production asset '${path}'`);
    verifiedBytes += identity.sizeBytes;
    if (verifiedBytes > MAX_PRODUCTION_TOTAL_BYTES) {
      throw new RangeError(`Production build exceeds ${MAX_PRODUCTION_TOTAL_BYTES} total asset bytes`);
    }
    if (identity.sizeBytes !== asset.sizeBytes) throw new Error(`Production asset '${path}' size does not match ${PRODUCTION_MANIFEST_NAME}`);
    if (identity.sha256 !== asset.sha256) throw new Error(`Production asset '${path}' SHA-256 does not match ${PRODUCTION_MANIFEST_NAME}`);
  }

  const buildId = createHash("sha256")
    .update(sortedPaths.map((path) => `${path}\0${declared.get(path)!.sha256}`).join("\n"))
    .digest("hex");
  if (manifest.buildId !== buildId) throw new Error(`${manifestPath} buildId does not match its asset inventory`);
  const sourceMapAssets = sortedPaths.filter((path) => declared.get(path)?.role === "source-map");
  const sourceMaps = typeof manifest.sourceMaps === "boolean" ? manifest.sourceMaps : sourceMapAssets.length > 0;
  if (sourceMaps && sourceMapAssets.length === 0) throw new Error(`${manifestPath} enables source maps but declares none`);
  if (!sourceMaps && sourceMapAssets.length > 0) throw new Error(`${manifestPath} disables source maps but declares source-map assets`);

  const entry = safeRelativePath(manifest.entry, "entry");
  if (declared.get(entry)?.role !== "entry") throw new Error(`${manifestPath} entry '${entry}' is not the entry asset`);
  if (manifest.stylesheet !== null) {
    const stylesheet = safeRelativePath(manifest.stylesheet, "stylesheet");
    if (declared.get(stylesheet)?.role !== "stylesheet") throw new Error(`${manifestPath} stylesheet '${stylesheet}' is not the stylesheet asset`);
  }

  const deploymentPath = safeRelativePath(manifest.deployment?.manifest, "deployment manifest");
  if (declared.get(deploymentPath)?.role !== "deployment") {
    throw new Error(`${manifestPath} deployment manifest '${deploymentPath}' is not a deployment asset`);
  }
  const deployment = await readJson(inventory.files.get(deploymentPath)!, "static deployment manifest") as StaticDeploymentManifest;
  verifyDeploymentManifest(deployment, manifest, declared, manifestPath);
  await assertDirectorySnapshotUnchanged(inventory, "Production build");
  return { directory, manifest, deployment, snapshot: inventory };
}

async function resolveProductionDirectory(input: string | null, cwd: string): Promise<string> {
  const current = resolve(cwd);
  if (!input && await isFile(join(current, PRODUCTION_MANIFEST_NAME))) return current;
  if (input) {
    const explicit = resolve(current, input);
    if (await isFile(explicit) && basename(explicit) === PRODUCTION_MANIFEST_NAME) return dirname(explicit);
    if (await isFile(join(explicit, PRODUCTION_MANIFEST_NAME))) return explicit;
  }
  const project = await resolveVelarProject(input, current);
  return project.outDir;
}

async function productionFiles(root: string, allowBuildStagingMarker: boolean): Promise<BoundedDirectorySnapshot> {
  try {
    return await inspectBoundedDirectory(root, "Production build", productionDirectoryPolicy, {
      ...(allowBuildStagingMarker ? { ignoredRootNames: new Set([BUILD_STAGING_MARKER]) } : {}),
    });
  } catch (error) {
    if (isHostErrorCode(error, "ENOENT")) {
      throw new Error(`${root} does not contain a production build; run 'velar build' first`);
    }
    throw error;
  }
}

function verifyDeploymentManifest(
  deployment: StaticDeploymentManifest,
  build: ProductionBuildManifest,
  assets: ReadonlyMap<string, ProductionBuildManifest["assets"][number]>,
  manifestPath: string,
): void {
  if (deployment?.formatVersion !== 2 || deployment?.kind !== "velar-static-deployment") {
    throw new Error(`${manifestPath} references an unsupported static deployment manifest`);
  }
  if (deployment.compiler?.name !== build.compiler.name || deployment.compiler.version !== build.compiler.version) {
    throw new Error(`Production compiler identity differs between build and deployment manifests`);
  }
  if (!sameFramework(deployment.framework, build.framework)) {
    throw new Error(`Framework identity differs between build and deployment manifests`);
  }
  if (typeof deployment.base !== "string" || !deployment.base.startsWith("/") || !deployment.base.endsWith("/")) {
    throw new Error(`Static deployment base must start and end with '/'`);
  }
  if (!Array.isArray(deployment.headers) || deployment.headers.some((rule) =>
    !rule || typeof rule.path !== "string" || !rule.path.startsWith("/") || !rule.values ||
    Object.entries(rule.values).some(([name, value]) => !name || typeof value !== "string"))) {
    throw new Error(`Static deployment headers are invalid`);
  }
  if (deployment.caching?.assets !== "public, max-age=31536000, immutable" || deployment.caching?.documents !== "no-cache") {
    throw new Error(`Static deployment caching contract is invalid`);
  }
  const securityPath = `${deployment.base}*`;
  const requiredSecurityHeaders = {
    "Cross-Origin-Opener-Policy": "same-origin",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
  } as const;
  for (const [name, value] of Object.entries(requiredSecurityHeaders)) {
    requireDeploymentHeader(deployment, securityPath, name, value);
  }
  // The document rule covers every deep route the enumerated paths below cannot
  // name, which is what `verify-deployment` probes through the SPA fallback.
  requireDeploymentHeader(deployment, securityPath, "Cache-Control", deployment.caching.documents);
  requireDeploymentHeader(deployment, `${deployment.base}assets/*`, "Cache-Control", deployment.caching.assets);
  const documentPaths = [
    deployment.base,
    `${deployment.base}index.html`,
    `${deployment.base}${PRODUCTION_MANIFEST_NAME}`,
    `${deployment.base}${deploymentPathName(build.deployment.manifest)}`,
    ...(deployment.spaFallback ? [`${deployment.base}${deployment.spaFallback.fallback}`] : []),
  ];
  for (const path of documentPaths) requireDeploymentHeader(deployment, path, "Cache-Control", deployment.caching.documents);
  const fallback = deployment.spaFallback?.fallback ?? null;
  if (fallback !== build.deployment.fallback) throw new Error(`SPA fallback differs between build and deployment manifests`);
  if (fallback && assets.get(safeRelativePath(fallback, "SPA fallback"))?.role !== "html") {
    throw new Error(`SPA fallback '${fallback}' is not a declared HTML asset`);
  }
  if (deployment.spaFallback) {
    const source = safeRelativePath(deployment.spaFallback.source, "SPA fallback source");
    if (assets.get(source)?.role !== "html") throw new Error(`SPA fallback source '${source}' is not a declared HTML asset`);
  }
  const hasCsp = deployment.headers.some((rule) => Object.hasOwn(rule.values, "Content-Security-Policy"));
  if (hasCsp !== build.deployment.contentSecurityPolicy) throw new Error(`CSP state differs between build and deployment manifests`);
}

function sameFramework(left: ProductionBuildManifest["framework"], right: ProductionBuildManifest["framework"]): boolean {
  return left?.id === right.id
    && left.capability === right.capability
    && left.target === right.target
    && left.protocolVersion === right.protocolVersion
    && left.apiVersion === right.apiVersion
    && left.artifactKind === right.artifactKind;
}

function requireDeploymentHeader(
  deployment: StaticDeploymentManifest,
  path: string,
  name: string,
  expected: string,
): void {
  const values = deployment.headers
    .filter((rule) => rule.path === path)
    .flatMap((rule) => Object.entries(rule.values))
    .filter(([candidate]) => candidate.toLowerCase() === name.toLowerCase())
    .map(([, value]) => value);
  if (values.length !== 1 || values[0] !== expected) {
    throw new Error(`Static deployment header '${name}' for '${path}' must be '${expected}'`);
  }
}

function deploymentPathName(value: string): string {
  return safeRelativePath(value, "deployment manifest");
}

function safeRelativePath(value: unknown, label: string): string {
  if (typeof value !== "string" || !value || isAbsolute(value) || value.includes("\\")) {
    throw new Error(`Production ${label} must be a normalized relative path`);
  }
  const segments = value.split("/");
  if (segments.some((segment) => !segment || segment === "." || segment === "..")) {
    throw new Error(`Production ${label} must be a normalized relative path`);
  }
  return value;
}

async function readJson(
  file: InspectedDirectoryFile,
  label: string,
): Promise<unknown> {
  try {
    return await readInspectedJson(file, MAX_PRODUCTION_MANIFEST_BYTES, label);
  } catch (error) {
    throw new Error(`Cannot read ${label} ${file.absolutePath}: ${hostErrorMessage(error)}`);
  }
}

async function isFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}
