import { createHash } from "node:crypto";
import { extname, join } from "node:path";
import { PRODUCTION_MANIFEST_NAME } from "./production-build.ts";
import type { VerifiedProductionBuild } from "./production-verifier.ts";
import { fileIdentity } from "./file-integrity.ts";

export interface VerifiedRemoteDeployment {
  readonly origin: string;
  readonly url: string;
  readonly buildId: string;
  readonly checkedFiles: number;
  readonly checkedRoutes: number;
  readonly checkedHeaders: number;
}

export interface DeploymentVerificationReport {
  readonly formatVersion: 1;
  readonly kind: "velar-deployment-verification";
  readonly verifiedAt: string;
  readonly target: {
    readonly origin: string;
    readonly url: string;
    readonly base: string;
  };
  readonly build: {
    readonly buildId: string;
    readonly compiler: VerifiedProductionBuild["manifest"]["compiler"];
    readonly apiVersion: string;
    readonly sourceMaps: boolean;
  };
  readonly checks: {
    readonly files: number;
    readonly routes: number;
    readonly headers: number;
  };
}

export type DeploymentFetch = (input: string | URL, init?: RequestInit) => Promise<Response>;

interface RemoteFileCheck {
  readonly path: string;
  readonly sizeBytes: number;
  readonly sha256: string;
  readonly acceptedStatuses: readonly number[];
}

interface ResponseCheck {
  readonly response: Response;
  readonly headerCount: number;
}

const requestTimeoutMs = 15_000;
const verificationConcurrency = 8;

export async function verifyRemoteDeployment(
  build: VerifiedProductionBuild,
  target: string,
  fetcher: DeploymentFetch = (input, init) => fetch(input, init),
): Promise<VerifiedRemoteDeployment> {
  const origin = deploymentOrigin(target);
  const baseUrl = new URL(build.deployment.base, origin);
  const manifestIdentity = await fileIdentity(join(build.directory, PRODUCTION_MANIFEST_NAME));
  const checks: RemoteFileCheck[] = [
    {
      path: PRODUCTION_MANIFEST_NAME,
      sizeBytes: manifestIdentity.sizeBytes,
      sha256: manifestIdentity.sha256,
      acceptedStatuses: [200],
    },
    ...build.manifest.assets
      .filter((asset) => asset.role !== "adapter")
      .map((asset) => ({
        path: asset.path,
        sizeBytes: asset.sizeBytes,
        sha256: asset.sha256,
        acceptedStatuses: asset.path === build.deployment.spaFallback?.fallback ? [200, 404] : [200],
      })),
  ];

  const fileResults = await mapConcurrent(checks, verificationConcurrency, async (check) => {
    const url = deploymentAssetUrl(origin, build.deployment.base, check.path, build.manifest.buildId);
    return verifyResponse(build, url, check.path, check.acceptedStatuses, fetcher, check);
  });

  const indexAsset = build.manifest.assets.find((asset) => asset.path === "index.html");
  if (!indexAsset) throw new Error(`Production build does not declare index.html`);
  const root = await verifyResponse(
    build,
    withProbeQuery(baseUrl, build.manifest.buildId),
    "index.html",
    [200],
    fetcher,
    { sizeBytes: indexAsset.sizeBytes, sha256: indexAsset.sha256 },
    build.deployment.caching.documents,
  );

  let checkedRoutes = 1;
  let routeHeaderCount = 0;
  const routeUrl = deploymentAssetUrl(
    origin,
    build.deployment.base,
    `__velar_verify__/route-${build.manifest.buildId.slice(0, 12)}`,
    build.manifest.buildId,
  );
  if (build.deployment.spaFallback) {
    const route = await verifyResponse(
      build,
      routeUrl,
      build.deployment.spaFallback.source,
      [200],
      fetcher,
      { sizeBytes: indexAsset.sizeBytes, sha256: indexAsset.sha256 },
      build.deployment.caching.documents,
    );
    routeHeaderCount = route.headerCount;
  } else {
    await expectStatus(routeUrl, [404], fetcher, "HTML navigation without SPA fallback");
  }
  checkedRoutes += 1;

  const missingAssetUrl = deploymentAssetUrl(
    origin,
    build.deployment.base,
    `assets/__velar_missing_${build.manifest.buildId.slice(0, 12)}.js`,
    build.manifest.buildId,
  );
  await expectStatus(missingAssetUrl, [404], fetcher, "missing production asset");
  checkedRoutes += 1;

  return {
    origin: origin.origin,
    url: baseUrl.href,
    buildId: build.manifest.buildId,
    checkedFiles: checks.length,
    checkedRoutes,
    checkedHeaders: fileResults.reduce(
      (total, result) => total + result.headerCount,
      root.headerCount + routeHeaderCount,
    ),
  };
}

export function createDeploymentVerificationReport(
  build: VerifiedProductionBuild,
  deployment: VerifiedRemoteDeployment,
  verifiedAt = new Date(),
): DeploymentVerificationReport {
  if (deployment.buildId !== build.manifest.buildId) {
    throw new Error(`Remote deployment result does not belong to the verified local build`);
  }
  if (!Number.isFinite(verifiedAt.getTime())) throw new Error(`Deployment verification report requires a valid timestamp`);
  return {
    formatVersion: 1,
    kind: "velar-deployment-verification",
    verifiedAt: verifiedAt.toISOString(),
    target: {
      origin: deployment.origin,
      url: deployment.url,
      base: build.deployment.base,
    },
    build: {
      buildId: deployment.buildId,
      compiler: build.manifest.compiler,
      apiVersion: build.manifest.apiVersion,
      sourceMaps: typeof build.manifest.sourceMaps === "boolean"
        ? build.manifest.sourceMaps
        : build.manifest.assets.some((asset) => asset.role === "source-map"),
    },
    checks: {
      files: deployment.checkedFiles,
      routes: deployment.checkedRoutes,
      headers: deployment.checkedHeaders,
    },
  };
}

async function verifyResponse(
  build: VerifiedProductionBuild,
  url: URL,
  servedPath: string,
  acceptedStatuses: readonly number[],
  fetcher: DeploymentFetch,
  expected: Pick<RemoteFileCheck, "sizeBytes" | "sha256">,
  requiredCacheControl: string | null = null,
): Promise<ResponseCheck> {
  const response = await request(url, fetcher, acceptFor(servedPath));
  if (!acceptedStatuses.includes(response.status)) {
    throw new Error(`Deployment returned HTTP ${response.status} for '${url.pathname}', expected ${acceptedStatuses.join(" or ")}`);
  }
  verifyMediaType(response, servedPath, url.pathname);
  const headerCount = verifyHeaders(build, response, url.pathname, requiredCacheControl);
  const declaredLength = response.headers.get("content-length");
  if (declaredLength && /^\d+$/u.test(declaredLength) && Number(declaredLength) > expected.sizeBytes) {
    await response.body?.cancel("Response exceeds the verified build size");
    throw new Error(`Deployed file '${url.pathname}' declares ${declaredLength} bytes, expected ${expected.sizeBytes}`);
  }
  const identity = await responseIdentity(response, expected.sizeBytes);
  if (identity.sizeBytes !== expected.sizeBytes) {
    throw new Error(`Deployed file '${url.pathname}' has ${identity.sizeBytes} bytes, expected ${expected.sizeBytes}`);
  }
  if (identity.sha256 !== expected.sha256) {
    throw new Error(`Deployed file '${url.pathname}' SHA-256 ${identity.sha256} does not match build ${expected.sha256}`);
  }
  return { response, headerCount };
}

async function responseIdentity(response: Response, expectedBytes: number): Promise<{ readonly sizeBytes: number; readonly sha256: string }> {
  const hash = createHash("sha256");
  const reader = response.body?.getReader();
  let sizeBytes = 0;
  if (reader) {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      sizeBytes += next.value.byteLength;
      if (sizeBytes > expectedBytes) {
        await reader.cancel("Response exceeds the verified build size");
        return { sizeBytes, sha256: "" };
      }
      hash.update(next.value);
    }
  }
  return { sizeBytes, sha256: hash.digest("hex") };
}

async function expectStatus(
  url: URL,
  acceptedStatuses: readonly number[],
  fetcher: DeploymentFetch,
  label: string,
): Promise<void> {
  const response = await request(url, fetcher, label.startsWith("HTML") ? "text/html" : "*/*");
  if (!acceptedStatuses.includes(response.status)) {
    throw new Error(`Deployment ${label} returned HTTP ${response.status} for '${url.pathname}', expected ${acceptedStatuses.join(" or ")}`);
  }
  await response.body?.cancel();
}

async function request(url: URL, fetcher: DeploymentFetch, accept: string): Promise<Response> {
  let response: Response;
  try {
    response = await fetcher(url, {
      method: "GET",
      headers: { Accept: accept, "Cache-Control": "no-cache" },
      redirect: "manual",
      cache: "no-store",
      signal: AbortSignal.timeout(requestTimeoutMs),
    });
  } catch (error) {
    throw new Error(`Cannot reach deployment '${url.href}': ${error instanceof Error ? error.message : String(error)}`);
  }
  if (response.status >= 300 && response.status < 400) {
    throw new Error(`Deployment redirected '${url.pathname}' with HTTP ${response.status}; verify the exact public deployment URL and access policy`);
  }
  return response;
}

function verifyHeaders(
  build: VerifiedProductionBuild,
  response: Response,
  pathname: string,
  requiredCacheControl: string | null,
): number {
  const expected = new Map<string, { name: string; value: string }>();
  for (const rule of build.deployment.headers) {
    if (!matchesPath(rule.path, pathname)) continue;
    for (const [name, value] of Object.entries(rule.values)) {
      expected.set(name.toLowerCase(), { name, value });
    }
  }
  if (requiredCacheControl) {
    expected.set("cache-control", { name: "Cache-Control", value: requiredCacheControl });
  }
  for (const { name, value } of expected.values()) {
    const actual = response.headers.get(name);
    if (normalizeHeader(actual) !== normalizeHeader(value)) {
      throw new Error(`Deployment header '${name}' for '${pathname}' is '${actual ?? "<missing>"}', expected '${value}'`);
    }
  }
  return expected.size;
}

function verifyMediaType(response: Response, path: string, pathname: string): void {
  const accepted = acceptedMediaTypes(path);
  if (!accepted) return;
  const actual = response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() ?? "";
  if (!accepted.includes(actual)) {
    throw new Error(`Deployment Content-Type for '${pathname}' is '${actual || "<missing>"}', expected ${accepted.join(" or ")}`);
  }
}

function acceptedMediaTypes(path: string): readonly string[] | null {
  switch (extname(path).toLowerCase()) {
    case ".css": return ["text/css"];
    case ".html": return ["text/html"];
    case ".js":
    case ".mjs": return ["text/javascript", "application/javascript"];
    case ".json":
    case ".map": return ["application/json"];
    case ".svg": return ["image/svg+xml"];
    case ".txt": return ["text/plain"];
    case ".png": return ["image/png"];
    case ".jpg":
    case ".jpeg": return ["image/jpeg"];
    case ".webp": return ["image/webp"];
    case ".gif": return ["image/gif"];
    case ".ico": return ["image/x-icon", "image/vnd.microsoft.icon"];
    case ".woff": return ["font/woff", "application/font-woff"];
    case ".woff2": return ["font/woff2"];
    default: return null;
  }
}

function acceptFor(path: string): string {
  const mediaTypes = acceptedMediaTypes(path);
  return mediaTypes?.join(", ") ?? "*/*";
}

function deploymentOrigin(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`Deployment URL '${value}' is not a valid absolute URL`);
  }
  if (url.username || url.password) throw new Error(`Deployment URL must not contain credentials`);
  if (url.search || url.hash) throw new Error(`Deployment URL must not contain a query or fragment`);
  if (url.pathname !== "/") throw new Error(`Deployment URL must be an origin without a path; the build declares base separately`);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && isLoopback(url.hostname))) {
    throw new Error(`Deployment URL must use HTTPS; HTTP is accepted only for loopback verification`);
  }
  return new URL("/", url);
}

function isLoopback(hostname: string): boolean {
  const value = hostname.toLowerCase();
  return value === "localhost" || value === "[::1]" || /^127(?:\.\d{1,3}){3}$/u.test(value);
}

function deploymentAssetUrl(origin: URL, base: string, path: string, buildId: string): URL {
  const encodedPath = path.split("/").map((segment) => encodeURIComponent(segment)).join("/");
  return withProbeQuery(new URL(`${base}${encodedPath}`, origin), buildId);
}

function withProbeQuery(url: URL, buildId: string): URL {
  const output = new URL(url);
  output.searchParams.set("__velar_verify", buildId);
  return output;
}

function matchesPath(pattern: string, pathname: string): boolean {
  return pattern.endsWith("*") ? pathname.startsWith(pattern.slice(0, -1)) : pathname === pattern;
}

function normalizeHeader(value: string | null): string {
  return value?.trim().replace(/\s+/gu, " ") ?? "";
}


async function mapConcurrent<Input, Output>(
  values: readonly Input[],
  concurrency: number,
  worker: (value: Input) => Promise<Output>,
): Promise<Output[]> {
  const output = new Array<Output>(values.length);
  let nextIndex = 0;
  const run = async (): Promise<void> => {
    while (nextIndex < values.length) {
      const index = nextIndex;
      nextIndex += 1;
      output[index] = await worker(values[index]!);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, run));
  return output;
}
