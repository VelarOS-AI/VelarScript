import { constants } from "node:fs";
import { copyFile, lstat, mkdir, mkdtemp, opendir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join, relative, resolve, sep } from "node:path";

const DEPLOYMENT_MANIFEST = "velar-deploy.json";
const MAX_MANIFEST_BYTES = 1024 * 1024;
const MAX_ENTRIES = 20_000;
const MAX_TOTAL_BYTES = 2 * 1024 * 1024 * 1024;

interface DeploymentManifest {
  readonly formatVersion: 2;
  readonly kind: "velar-static-deployment";
  readonly base: string;
  readonly spaFallback: { readonly source: string; readonly fallback: string } | null;
  readonly headers: readonly {
    readonly path: string;
    readonly values: Readonly<Record<string, string>>;
  }[];
}

export interface NetlifyProjection {
  readonly inputDirectory: string;
  readonly outputDirectory: string;
  readonly siteDirectory: string;
  readonly files: readonly string[];
}

export async function projectNetlifyDeployment(input: string, output: string): Promise<NetlifyProjection> {
  const inputDirectory = resolve(input);
  const outputDirectory = resolve(output);
  if (inputDirectory === outputDirectory || outputDirectory.startsWith(inputDirectory + sep)) {
    throw new Error("Netlify output must be separate from the source build directory");
  }
  try {
    await lstat(outputDirectory);
    throw new Error("Netlify output directory must not already exist");
  } catch (error) {
    if (!isHostError(error, "ENOENT")) throw error;
  }
  const manifest = await readDeploymentManifest(inputDirectory);
  if (manifest.base !== "/") throw new Error("The Netlify integration currently requires a root-base deployment");

  await mkdir(dirname(outputDirectory), { recursive: true });
  const staging = await mkdtemp(join(dirname(outputDirectory), `.${basename(outputDirectory)}-netlify-`));
  const state = { entries: 0, bytes: 0 };
  try {
    const site = join(staging, "site");
    await copyTree(inputDirectory, site, inputDirectory, state);
    const generated: string[] = ["netlify.toml"];
    await writeFile(join(staging, "netlify.toml"), netlifyConfiguration(manifest), { encoding: "utf8", flag: "wx" });
    await rename(staging, outputDirectory);
    return { inputDirectory, outputDirectory, siteDirectory: join(outputDirectory, "site"), files: Object.freeze(generated) };
  } catch (error) {
    await rm(staging, { recursive: true, force: true });
    throw error;
  }
}

async function readDeploymentManifest(directory: string): Promise<DeploymentManifest> {
  const path = join(directory, DEPLOYMENT_MANIFEST);
  const information = await lstat(path);
  if (!information.isFile() || information.isSymbolicLink()) throw new Error(`${DEPLOYMENT_MANIFEST} must be an ordinary file`);
  if (information.size > MAX_MANIFEST_BYTES) throw new RangeError(`${DEPLOYMENT_MANIFEST} exceeds ${MAX_MANIFEST_BYTES} bytes`);
  const manifest = JSON.parse(await readFile(path, "utf8")) as DeploymentManifest;
  if (manifest?.formatVersion !== 2 || manifest.kind !== "velar-static-deployment") {
    throw new Error(`Unsupported ${DEPLOYMENT_MANIFEST} format`);
  }
  if (!Array.isArray(manifest.headers) || manifest.headers.length > 256) throw new Error("Static deployment headers are invalid");
  for (const rule of manifest.headers) {
    if (!rule || typeof rule.path !== "string" || !rule.path.startsWith("/") || rule.path.includes("\n") || rule.path.includes("\r")) {
      throw new Error("Static deployment header path is invalid");
    }
    if (!rule.values || typeof rule.values !== "object" || Array.isArray(rule.values)) throw new Error("Static deployment header values are invalid");
    for (const [name, value] of Object.entries(rule.values)) {
      if (!/^[A-Za-z0-9-]+$/u.test(name) || typeof value !== "string" || value.includes("\n") || value.includes("\r")) {
        throw new Error("Static deployment header value is invalid");
      }
    }
  }
  if (manifest.spaFallback !== null && (
    !manifest.spaFallback || manifest.spaFallback.source !== "index.html" || manifest.spaFallback.fallback !== "404.html"
  )) throw new Error("Static deployment fallback is invalid");
  return manifest;
}

function netlifyConfiguration(manifest: DeploymentManifest): string {
  const lines = ["[build]", 'publish = "site"'];
  for (const rule of manifest.headers) {
    lines.push("", "[[headers]]", `for = ${tomlString(rule.path)}`, "[headers.values]");
    for (const [name, value] of Object.entries(rule.values)) lines.push(`${tomlString(name)} = ${tomlString(value)}`);
  }
  if (manifest.spaFallback) {
    lines.push(
      "", "[[redirects]]", 'from = "/assets/*"', 'to = "/404.html"', "status = 404",
      "", "[[redirects]]", 'from = "/*"', 'to = "/index.html"', "status = 200",
    );
  }
  return `${lines.join("\n")}\n`;
}

function tomlString(value: string): string {
  return JSON.stringify(value);
}

async function copyTree(source: string, destination: string, root: string, state: { entries: number; bytes: number }): Promise<void> {
  const information = await lstat(source);
  const display = relative(root, source).replaceAll("\\", "/") || ".";
  state.entries += 1;
  if (state.entries > MAX_ENTRIES) throw new RangeError(`Netlify projection cannot exceed ${MAX_ENTRIES} filesystem entries`);
  if (information.isSymbolicLink()) throw new Error(`Deployment input '${display}' cannot be a symbolic link`);
  if (information.isDirectory()) {
    await mkdir(destination, { recursive: true });
    const directory = await opendir(source);
    for await (const entry of directory) await copyTree(join(source, entry.name), join(destination, entry.name), root, state);
    return;
  }
  if (!information.isFile()) throw new Error(`Deployment input '${display}' must be an ordinary file`);
  state.bytes += information.size;
  if (state.bytes > MAX_TOTAL_BYTES) throw new RangeError(`Netlify projection cannot exceed ${MAX_TOTAL_BYTES} bytes`);
  await copyFile(source, destination, constants.COPYFILE_EXCL);
}

function isHostError(value: unknown, code: string): boolean {
  return value instanceof Error && "code" in value && value.code === code;
}
