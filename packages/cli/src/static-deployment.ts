import { cp, lstat, mkdir, readdir, writeFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import type { FrameworkStaticDeployment } from "@velarscript/compiler/framework-host";
import { MAX_PRODUCTION_ASSETS } from "./file-integrity.ts";
import { VELAR_VERSION } from "./version.ts";
import type { ProductionFrameworkIdentity } from "./production-build.ts";

export const STATIC_DEPLOYMENT_MANIFEST_NAME = "velar-deploy.json";
export const STATIC_FALLBACK_NAME = "404.html";
export const NETLIFY_HEADERS_NAME = "_headers";
export const NETLIFY_REDIRECTS_NAME = "_redirects";
const reservedRootFiles = new Set([
  "index.html",
  STATIC_FALLBACK_NAME,
  "velar-build.json",
  STATIC_DEPLOYMENT_MANIFEST_NAME,
  NETLIFY_HEADERS_NAME,
  NETLIFY_REDIRECTS_NAME,
]);

export interface StaticDeploymentSummary {
  readonly manifest: typeof STATIC_DEPLOYMENT_MANIFEST_NAME;
  readonly fallback: typeof STATIC_FALLBACK_NAME | null;
  readonly contentSecurityPolicy: boolean;
  readonly adapter: "neutral" | "netlify";
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
  readonly adapter: {
    readonly name: "netlify";
    readonly files: readonly (typeof NETLIFY_HEADERS_NAME | typeof NETLIFY_REDIRECTS_NAME)[];
  } | null;
}

export async function copyPublicAssets(publicRoot: string, outputDirectory: string): Promise<void> {
  let entries;
  try {
    entries = await readdir(publicRoot, { withFileTypes: true });
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return;
    throw error;
  }
  await mkdir(outputDirectory, { recursive: true });
  const state = { files: 0 };
  for (const entry of entries) {
    if (reservedRootFiles.has(entry.name)) {
      throw new Error(`public asset '${entry.name}' is reserved by the VelarScript production builder`);
    }
    await copySafe(join(publicRoot, entry.name), join(outputDirectory, entry.name), publicRoot, state);
  }
}

async function copySafe(source: string, destination: string, publicRoot: string, state: { files: number }): Promise<void> {
  const information = await lstat(source);
  if (information.isSymbolicLink()) {
    throw new Error(`public asset '${relative(publicRoot, source)}' cannot be a symbolic link`);
  }
  if (information.isDirectory()) {
    await mkdir(destination, { recursive: true });
    for (const entry of await readdir(source)) await copySafe(join(source, entry), join(destination, entry), publicRoot, state);
    return;
  }
  if (!information.isFile()) throw new Error(`public asset '${relative(publicRoot, source)}' is not a regular file`);
  state.files += 1;
  if (state.files > MAX_PRODUCTION_ASSETS) throw new RangeError(`Public assets cannot exceed ${MAX_PRODUCTION_ASSETS} files`);
  await mkdir(dirname(destination), { recursive: true });
  await cp(source, destination, { force: true });
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
  const contract: Omit<StaticDeploymentManifest, "adapter"> = {
    formatVersion: 2,
    kind: "velar-static-deployment",
    compiler: { name: "velar", version: VELAR_VERSION },
    framework,
    base: config.base,
    spaFallback: config.spaFallback ? { source: "index.html", fallback: STATIC_FALLBACK_NAME } : null,
    headers: [
      { path: basePattern, values: securityHeaders },
      { path: `${config.base}assets/*`, values: { "Cache-Control": "public, max-age=31536000, immutable" } },
      ...documentPaths.map((path) => ({ path, values: { "Cache-Control": "no-cache" } })),
    ],
    caching: { assets: "public, max-age=31536000, immutable", documents: "no-cache" },
  };
  const adapterFiles = config.adapter === "netlify"
    ? await writeNetlifyAdapter(outputDirectory, contract)
    : null;
  const manifest: StaticDeploymentManifest = {
    ...contract,
    adapter: adapterFiles ? { name: "netlify", files: adapterFiles } : null,
  };
  if (config.spaFallback) await writeFile(join(outputDirectory, STATIC_FALLBACK_NAME), html, "utf8");
  await writeFile(join(outputDirectory, STATIC_DEPLOYMENT_MANIFEST_NAME), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  return {
    manifest: STATIC_DEPLOYMENT_MANIFEST_NAME,
    fallback: config.spaFallback ? STATIC_FALLBACK_NAME : null,
    contentSecurityPolicy: config.contentSecurityPolicy !== null,
    adapter: config.adapter,
  };
}

async function writeNetlifyAdapter(
  outputDirectory: string,
  manifest: Omit<StaticDeploymentManifest, "adapter">,
): Promise<readonly (typeof NETLIFY_HEADERS_NAME | typeof NETLIFY_REDIRECTS_NAME)[]> {
  const headerSource = `${manifest.headers.map((rule) => [
    rule.path,
    ...Object.entries(rule.values).map(([name, value]) => `  ${name}: ${value}`),
  ].join("\n")).join("\n\n")}\n`;
  await writeFile(join(outputDirectory, NETLIFY_HEADERS_NAME), headerSource, "utf8");
  const files: Array<typeof NETLIFY_HEADERS_NAME | typeof NETLIFY_REDIRECTS_NAME> = [NETLIFY_HEADERS_NAME];
  if (manifest.spaFallback) {
    await writeFile(
      join(outputDirectory, NETLIFY_REDIRECTS_NAME),
      "/assets/* /404.html 404\n/* /index.html 200\n",
      "utf8",
    );
    files.push(NETLIFY_REDIRECTS_NAME);
  }
  return files;
}
