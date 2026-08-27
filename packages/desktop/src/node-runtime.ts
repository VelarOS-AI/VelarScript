import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { chmod, mkdir, mkdtemp, open, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, isAbsolute, join } from "node:path";
import {
  DESKTOP_NODE_RUNTIME_ARCHIVES,
  DESKTOP_NODE_RUNTIME_ORIGIN,
  DESKTOP_NODE_RUNTIME_VERSION,
  DESKTOP_RUNTIME_CEILING_BYTES,
} from "./config.ts";

/**
 * An override for the user-level cache directory. It exists for machines whose
 * cache belongs somewhere else — a CI runner with a mounted cache volume, a
 * build account with no writable home — and it moves *where* the runtime is
 * kept, never *which* runtime is used. The version, the archive and its digest
 * remain the toolchain's, so a redirected cache cannot smuggle in a different
 * interpreter: whatever it holds is verified against the same pinned digest
 * before it is embedded.
 */
export const DESKTOP_RUNTIME_CACHE_ENVIRONMENT = "VELAR_DESKTOP_RUNTIME_CACHE";

/** The bundle-relative home of the embedded runtime. See `desktopRuntimeSigningPlan`. */
export const DESKTOP_EMBEDDED_RUNTIME_PATH = "Contents/MacOS/node";

const RUNTIME_RECEIPT_FILE = "velar-runtime.json";
const RUNTIME_EXECUTABLE_FILE = "node";

export interface DesktopNodeRuntime {
  /** Absolute path of the cached bare `node` executable. */
  readonly executablePath: string;
  readonly version: string;
  /** The official `SHASUMS256.txt` digest of the archive this runtime came out of. */
  readonly archiveSha256: string;
  readonly bytes: number;
  /** Whether this call had to reach the network, reported so a build can say which it did. */
  readonly source: "cache" | "download";
}

interface DesktopRuntimeReceipt {
  readonly formatVersion: 1;
  readonly version: string;
  readonly platform: string;
  readonly architecture: string;
  readonly archive: string;
  readonly archiveSha256: string;
  readonly executableSha256: string;
  readonly bytes: number;
}

export interface DesktopRuntimeRequest {
  readonly platform: string;
  readonly architecture: string;
  /** Overridden only by the provisioning tests, which serve a synthetic archive over loopback. */
  readonly origin?: string;
  readonly cacheRoot?: string;
}

/**
 * Where a provisioned runtime is kept between builds. It is keyed by version,
 * platform and architecture, so two toolchain generations on one machine do not
 * fight over one directory and neither has to re-download when the other runs.
 */
export function desktopRuntimeCacheRoot(): string {
  const configured = process.env[DESKTOP_RUNTIME_CACHE_ENVIRONMENT];
  if (configured !== undefined) {
    if (!isAbsolute(configured) || configured.length > 4096 || configured.includes("\0")) {
      throw new Error(`${DESKTOP_RUNTIME_CACHE_ENVIRONMENT} must be a bounded absolute directory path`);
    }
    return configured;
  }
  return join(homedir(), "Library", "Caches", "velarscript", "desktop-runtimes");
}

export function desktopRuntimeCacheDirectory(request: DesktopRuntimeRequest): string {
  return join(request.cacheRoot ?? desktopRuntimeCacheRoot(), DESKTOP_NODE_RUNTIME_VERSION, `${request.platform}-${request.architecture}`);
}

/**
 * The one way a Desktop build obtains the interpreter it embeds: read the cache,
 * and on a miss download the official archive for the pinned version, verify it
 * against the digest this toolchain generation carries, and keep the bare
 * executable. Nothing else from the distribution is kept — `npm`, `npx` and
 * `corepack` are symbolic links the runtime never needs and the bundle's tree
 * hash refuses to walk.
 *
 * Three cache states, all handled here rather than by the caller: a hit whose
 * executable still hashes to its receipt is used offline; a miss downloads; and
 * an entry whose bytes no longer match its receipt is treated as a miss, because
 * a corrupt cache is not a reason to ship a corrupt runtime.
 */
export async function provisionDesktopNodeRuntime(request: DesktopRuntimeRequest): Promise<DesktopNodeRuntime> {
  const key = `${request.platform}-${request.architecture}`;
  const pinned = DESKTOP_NODE_RUNTIME_ARCHIVES[key];
  if (!pinned) {
    throw new Error(
      `This toolchain embeds a Node.js ${DESKTOP_NODE_RUNTIME_VERSION} runtime for ${Object.keys(DESKTOP_NODE_RUNTIME_ARCHIVES).sort().join(", ")} `
      + `and has no pinned archive for '${key}'; building a Desktop application for that platform and architecture is a later Desktop milestone`,
    );
  }
  const directory = desktopRuntimeCacheDirectory(request);
  const cached = await readCachedRuntime(directory, pinned.sha256);
  if (cached) return cached;
  const origin = request.origin ?? DESKTOP_NODE_RUNTIME_ORIGIN;
  const url = `${origin}/v${DESKTOP_NODE_RUNTIME_VERSION}/${pinned.archive}`;
  await mkdir(dirname(directory), { recursive: true });
  const staging = await mkdtemp(`${directory}-`);
  try {
    const archive = join(staging, pinned.archive);
    const digest = await download(url, archive, directory);
    if (digest !== pinned.sha256) {
      throw new Error(
        `Downloaded Node.js runtime archive does not match the digest this toolchain pins for it.\n`
        + `  archive:  ${url}\n  expected: ${pinned.sha256}\n  received: ${digest}\n`
        + "Nothing was cached or embedded. A mismatch is a supply-chain answer, not a retryable failure.",
      );
    }
    const executable = join(staging, RUNTIME_EXECUTABLE_FILE);
    // `--strip-components 2` drops `node-vX.Y.Z-<platform>-<arch>/bin/`, and
    // naming the one member keeps the 60 MB of headers, `npm`, and its symbolic
    // links out of the staging directory entirely.
    await runProcess("/usr/bin/tar", [
      "-xzf", archive, "-C", staging, "--strip-components", "2",
      `node-v${DESKTOP_NODE_RUNTIME_VERSION}-${request.platform}-${request.architecture}/bin/node`,
    ], staging);
    const information = await stat(executable);
    if (!information.isFile()) throw new Error(`Node.js runtime archive ${pinned.archive} did not contain a bare 'bin/node' executable`);
    if (information.size > DESKTOP_RUNTIME_CEILING_BYTES) {
      throw new Error(
        `Embedded Node.js runtime is ${information.size} bytes, above the ${DESKTOP_RUNTIME_CEILING_BYTES}-byte integrity ceiling this toolchain enforces`,
      );
    }
    await chmod(executable, 0o755);
    const receipt: DesktopRuntimeReceipt = {
      formatVersion: 1,
      version: DESKTOP_NODE_RUNTIME_VERSION,
      platform: request.platform,
      architecture: request.architecture,
      archive: pinned.archive,
      archiveSha256: pinned.sha256,
      executableSha256: await hashFile(executable),
      bytes: information.size,
    };
    await writeFile(join(staging, RUNTIME_RECEIPT_FILE), `${JSON.stringify(receipt, null, 2)}\n`, "utf8");
    await rm(archive, { force: true });
    await rm(directory, { recursive: true, force: true });
    await rename(staging, directory);
    return Object.freeze({
      executablePath: join(directory, RUNTIME_EXECUTABLE_FILE),
      version: DESKTOP_NODE_RUNTIME_VERSION,
      archiveSha256: pinned.sha256,
      bytes: receipt.bytes,
      source: "download",
    });
  } catch (error) {
    await rm(staging, { recursive: true, force: true });
    throw error;
  }
}

/**
 * A cache entry is trusted only as far as it can prove itself: the receipt has
 * to name this toolchain's pinned archive, and the executable beside it has to
 * still hash to what the receipt recorded. Anything else reads as absent.
 */
async function readCachedRuntime(directory: string, archiveSha256: string): Promise<DesktopNodeRuntime | null> {
  const executable = join(directory, RUNTIME_EXECUTABLE_FILE);
  let receipt: DesktopRuntimeReceipt;
  try {
    const text = await readFile(join(directory, RUNTIME_RECEIPT_FILE), "utf8");
    receipt = JSON.parse(text) as DesktopRuntimeReceipt;
  } catch { return null; }
  if (receipt?.formatVersion !== 1 || receipt.version !== DESKTOP_NODE_RUNTIME_VERSION || receipt.archiveSha256 !== archiveSha256
    || typeof receipt.executableSha256 !== "string" || typeof receipt.bytes !== "number") return null;
  let information;
  try { information = await stat(executable); }
  catch { return null; }
  if (!information.isFile() || information.size !== receipt.bytes) return null;
  if (await hashFile(executable) !== receipt.executableSha256) return null;
  return Object.freeze({
    executablePath: executable,
    version: receipt.version,
    archiveSha256: receipt.archiveSha256,
    bytes: receipt.bytes,
    source: "cache",
  });
}

/**
 * The offline message is the whole point of naming the cache directory: an
 * author on a plane can read exactly which version to fetch and exactly where to
 * put it, and a machine that will never have the network can be primed once.
 */
async function download(url: string, destination: string, cacheDirectory: string): Promise<string> {
  let response: Response;
  try {
    response = await fetch(url, { redirect: "follow" });
  } catch (error) {
    throw new Error(
      `Desktop packaging could not download the Node.js ${DESKTOP_NODE_RUNTIME_VERSION} runtime it embeds, and no verified copy is cached.\n`
      + `  archive: ${url}\n  cache:   ${cacheDirectory}\n`
      + `  reason:  ${error instanceof Error ? error.message : String(error)}\n`
      + "Run 'velar package' once with network access, or prime that cache directory from a machine that has it.",
    );
  }
  if (!response.ok || !response.body) {
    throw new Error(
      `Desktop packaging could not download the Node.js ${DESKTOP_NODE_RUNTIME_VERSION} runtime it embeds, and no verified copy is cached.\n`
      + `  archive: ${url}\n  cache:   ${cacheDirectory}\n  reason:  HTTP ${response.status}\n`
      + "Run 'velar package' once with network access, or prime that cache directory from a machine that has it.",
    );
  }
  const hash = createHash("sha256");
  const handle = await open(destination, "wx", 0o600);
  let bytes = 0;
  try {
    for await (const chunk of response.body as AsyncIterable<Uint8Array>) {
      bytes += chunk.byteLength;
      if (bytes > DESKTOP_RUNTIME_CEILING_BYTES) {
        throw new Error(`Node.js runtime archive exceeded the ${DESKTOP_RUNTIME_CEILING_BYTES}-byte integrity ceiling this toolchain enforces`);
      }
      hash.update(chunk);
      await handle.write(chunk);
    }
  } finally {
    await handle.close();
  }
  return hash.digest("hex");
}

export async function hashFile(path: string): Promise<string> {
  const hash = createHash("sha256");
  const handle = await open(path, "r");
  try {
    const buffer = Buffer.allocUnsafe(1024 * 1024);
    while (true) {
      const { bytesRead } = await handle.read(buffer, 0, buffer.byteLength, null);
      if (bytesRead === 0) break;
      hash.update(buffer.subarray(0, bytesRead));
    }
  } finally {
    await handle.close();
  }
  return hash.digest("hex");
}

async function runProcess(command: string, arguments_: readonly string[], cwd: string): Promise<void> {
  const child = spawn(command, arguments_, { cwd, stdio: ["ignore", "pipe", "pipe"] });
  let output = "";
  child.stdout.on("data", (chunk: Buffer) => { if (output.length <= 8192) output += chunk.toString("utf8"); });
  child.stderr.on("data", (chunk: Buffer) => { if (output.length <= 8192) output += chunk.toString("utf8"); });
  const code = await new Promise<number | null>((resolveExit, reject) => {
    child.once("error", reject);
    child.once("exit", resolveExit);
  });
  if (code !== 0) throw new Error(`${command} failed with exit code ${String(code)}${output ? `\n${output}` : ""}`);
}
