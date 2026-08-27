import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { chmod, cp, mkdir, mkdtemp, open, readFile, readdir, realpath, rename, rm, stat, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  DESKTOP_NODE_MINIMUM_MAJOR,
  DESKTOP_NODE_RUNTIME_ARCHIVES,
  DESKTOP_NODE_RUNTIME_VERSION,
  DESKTOP_RUNTIME_CEILING_BYTES,
  type VelarDesktopConfig,
} from "./config.ts";
import {
  DESKTOP_EMBEDDED_RUNTIME_PATH,
  provisionDesktopNodeRuntime,
  type DesktopNodeRuntime,
} from "./node-runtime.ts";
import {
  DESKTOP_RUNTIME_ENTITLEMENTS,
  DESKTOP_RUNTIME_ENTITLEMENTS_FILE,
  desktopNotarizationSteps,
  desktopSigningMode,
  desktopSigningPlan,
  type DesktopSigningMode,
} from "./signing.ts";
import { byCodeUnit } from "./stable-order.ts";

/**
 * A packaged application either carries the interpreter it runs on or asks the
 * machine for one. Both shapes name their `kind` first, so a reader of the
 * manifest never has to infer which discipline produced the artifact.
 *
 * `sha256` on the embedded shape is the *provenance* digest: the official
 * `SHASUMS256.txt` value of the nodejs.org archive this runtime was extracted
 * from, verified before anything was cached. The bytes actually shipped are
 * covered by the manifest's whole-tree `sha256`, and they deliberately differ
 * from the upstream file — signing the bundle replaces Apple's own signature on
 * the runtime with the product's.
 */
export type DesktopRuntimeManifest = {
  readonly kind: "embedded-node";
  readonly version: string;
  readonly embedded: true;
  readonly bytes: number;
  readonly sha256: string;
} | {
  readonly kind: "external-node";
  readonly embedded: false;
};

export interface DesktopBuildManifest {
  readonly formatVersion: 4;
  readonly kind: "velar-desktop-build";
  readonly productName: string;
  readonly identifier: string;
  readonly version: string;
  readonly platform: "macos";
  readonly architecture: string;
  readonly hostProtocolVersion: 1;
  readonly runtime: DesktopRuntimeManifest;
  readonly signing: {
    readonly mode: DesktopSigningMode;
    readonly hardenedRuntime: true;
    readonly notarized: boolean;
  };
  readonly applicationBundle: string;
  readonly sizeBudgetBytes: number;
  readonly sizes: {
    readonly hostBytes: number;
    readonly rendererBytes: number;
    readonly capabilityHostBytes: number;
    readonly metadataBytes: number;
    /** The four components above — what `desktop.build.sizeBudgetBytes` governs. */
    readonly applicationBytes: number;
    /** The embedded interpreter, outside the project's budget and under the toolchain's own ceiling. */
    readonly runtimeBytes: number;
    readonly totalBytes: number;
  };
  readonly sha256: string;
}

export interface DesktopBuildResult {
  readonly outputDirectory: string;
  readonly applicationBundle: string;
  readonly manifestPath: string;
  readonly manifest: DesktopBuildManifest;
}

export type DesktopBuildSizes = DesktopBuildManifest["sizes"];

interface DesktopSizeComponent {
  readonly label: string;
  readonly bytes: number;
  /**
   * Mandatory capability infrastructure ships in every Desktop application: it
   * is not application code and cannot be removed by changing the project.
   */
  readonly mandatory: boolean;
}

interface DesktopNativeTemplate {
  readonly host: string;
  readonly worker: string;
  readonly icon: string;
  /**
   * The template application's own embedded runtime. A packaged Desktop
   * application that packages another one already carries a verified
   * interpreter of exactly the version this toolchain pins, so it reuses that
   * rather than reaching for the network it may not have.
   */
  readonly runtime: string | null;
}

const desktopPackageTemplateEnvironment = "VELAR_DESKTOP_PACKAGE_TEMPLATE_ROOT";

/**
 * A packaged Desktop build has no TypeScript checkout or Swift sources. The
 * native host already running it is the exact signed-architecture template it
 * may reuse; the renderer is still rebuilt from the checked target project.
 * The Worker supplies this path from its validated bundle config, never from
 * renderer input.
 */
async function desktopNativeTemplate(): Promise<DesktopNativeTemplate | null> {
  const value = process.env[desktopPackageTemplateEnvironment];
  if (value === undefined) return null;
  if (!isAbsolute(value) || value.length > 4096 || value.includes("\0")) {
    throw new Error(`${desktopPackageTemplateEnvironment} must be a bounded absolute Desktop Resources path`);
  }
  const resources = await realpath(value);
  const contents = dirname(resources);
  const runtime = join(contents, "MacOS", "node");
  const template: DesktopNativeTemplate = {
    host: join(contents, "MacOS", "VelarDesktopHost"),
    worker: join(resources, "host", "worker.js"),
    icon: join(resources, "VelarScript.icns"),
    runtime: await isOrdinaryFile(runtime) ? runtime : null,
  };
  for (const candidate of Object.values(template)) {
    if (candidate === null) continue;
    const information = await stat(candidate);
    if (!information.isFile()) throw new Error(`Desktop package template asset is not an ordinary file: ${candidate}`);
  }
  return template;
}

async function isOrdinaryFile(path: string): Promise<boolean> {
  try { return (await stat(path)).isFile(); }
  catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return false;
    throw error;
  }
}

function bundledCapabilityWorker(): string {
  return fileURLToPath(new URL(import.meta.url.endsWith(".ts") ? "../dist/worker.js" : "./worker.js", import.meta.url));
}

/**
 * The application's components, and only those. The embedded runtime is not
 * listed: it is not under this budget, so listing it beside the components that
 * are would invite exactly the arithmetic the budget no longer does.
 */
function desktopSizeComponents(sizes: DesktopBuildSizes): readonly DesktopSizeComponent[] {
  return [
    { label: "capability host (worker.js)", bytes: sizes.capabilityHostBytes, mandatory: true },
    { label: "native host (VelarDesktopHost)", bytes: sizes.hostBytes, mandatory: false },
    { label: "renderer (application code and assets)", bytes: sizes.rendererBytes, mandatory: false },
    { label: "bundle metadata (Info.plist, icon, desktop.json)", bytes: sizes.metadataBytes, mandatory: false },
  ];
}

/**
 * MIG-3: a budget failure that reports only the total forces upstream
 * archaeology before anyone can judge whether raising the budget is safe. The
 * composition — every component, its share, and the mandatory capability
 * infrastructure floor no project can shrink — makes that judgment possible in one
 * pass, so this is the one message the failure prints.
 *
 * The budget governs the application's own components. The embedded interpreter
 * is not one of them: no project change removes it, no project change shrinks
 * it, and it is a hundred times the size of everything beside it — folding it in
 * would make every failure here tell an author to shrink an icon to recover
 * 100 MiB. It is named and excluded instead, and measured against the
 * toolchain's own ceiling in `desktopRuntimeCeilingFailure`.
 */
export function desktopSizeBudgetFailure(sizes: DesktopBuildSizes, sizeBudgetBytes: number): string | null {
  if (sizes.applicationBytes <= sizeBudgetBytes) return null;
  const components = [...desktopSizeComponents(sizes)].sort((left, right) => right.bytes - left.bytes);
  const mandatoryBytes = components
    .filter((component) => component.mandatory)
    .reduce((total, component) => total + component.bytes, 0);
  const share = (bytes: number): string => `${((bytes / Math.max(1, sizes.applicationBytes)) * 100).toFixed(1)}%`;
  const largest = components[0];
  return [
    `Desktop application components are ${formatDesktopBytes(sizes.applicationBytes)} (${sizes.applicationBytes} bytes), exceeding the `
    + `${formatDesktopBytes(sizeBudgetBytes)} (${sizeBudgetBytes}-byte) size budget by `
    + `${formatDesktopBytes(sizes.applicationBytes - sizeBudgetBytes)} (${sizes.applicationBytes - sizeBudgetBytes} bytes)`,
    ...sizes.runtimeBytes > 0
      ? [`The embedded Node.js runtime (${formatDesktopBytes(sizes.runtimeBytes)}, ${sizes.runtimeBytes} bytes) is outside this budget: `
        + "it is this toolchain generation's fixed cost, not application code, and it has its own integrity ceiling"]
      : [],
    "Composition:",
    ...components.map((component) => `  ${component.bytes.toString().padStart(11)} bytes  ${share(component.bytes).padStart(6)}  `
      + `${component.label}${component.mandatory ? " [mandatory capability infrastructure]" : ""}`),
    `Mandatory capability infrastructure: ${formatDesktopBytes(mandatoryBytes)} (${mandatoryBytes} bytes, ${share(mandatoryBytes)} of the application) `
    + "ships in every Desktop application and no project change removes it, so any budget below that floor can never pass",
    `Largest contributor: ${largest ? `${largest.label} at ${formatDesktopBytes(largest.bytes)} (${share(largest.bytes)})` : "none"}`,
    `Raise desktop.build.sizeBudgetBytes to at least ${sizes.applicationBytes} to accept this bundle, or remove bytes from the non-mandatory components above`,
  ].join("\n");
}

/**
 * The runtime's own bound, and it is deliberately not a project field. A project
 * cannot choose the runtime, so it has nothing to tune here; what this catches
 * is an archive that unpacked to something an official Node.js macOS build never
 * is, which is a supply-chain question rather than a budget one.
 */
export function desktopRuntimeCeilingFailure(runtimeBytes: number): string | null {
  if (runtimeBytes <= DESKTOP_RUNTIME_CEILING_BYTES) return null;
  return `Embedded Node.js runtime is ${formatDesktopBytes(runtimeBytes)} (${runtimeBytes} bytes), above the `
    + `${formatDesktopBytes(DESKTOP_RUNTIME_CEILING_BYTES)} (${DESKTOP_RUNTIME_CEILING_BYTES}-byte) integrity ceiling this toolchain generation enforces. `
    + "The ceiling is not a project setting: an official runtime is far below it, so a build that reaches it is reporting a corrupt or substituted archive";
}

export function formatDesktopBytes(value: number): string {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KiB`;
  return `${(value / 1024 / 1024).toFixed(2)} MiB`;
}

export async function buildDesktopApplication(
  projectRoot: string,
  config: VelarDesktopConfig,
  buildRenderer: (outputDirectory: string) => Promise<void>,
): Promise<DesktopBuildResult> {
  if (process.platform !== "darwin") throw new Error("@velarscript/desktop 0.10 currently builds only the macOS system-WebView host");
  projectRoot = resolve(projectRoot);
  const packageManifestPath = await findPackageManifest(projectRoot);
  const packageManifest = await readJsonObject(packageManifestPath);
  const version = packageVersion(packageManifest, packageManifestPath);
  const outputDirectory = projectPath(projectRoot, config.build.outDir, "desktop.build.outDir");
  const parent = dirname(outputDirectory);
  await mkdir(parent, { recursive: true });
  const staging = await mkdtemp(join(parent, `.velar-${basename(outputDirectory)}-`));
  const applicationName = `${config.productName}.app`;
  const applicationBundle = join(staging, applicationName);
  const contents = join(applicationBundle, "Contents");
  const executableDirectory = join(contents, "MacOS");
  const resources = join(contents, "Resources");
  const renderer = join(resources, "renderer");
  try {
    await Promise.all([mkdir(executableDirectory, { recursive: true }), mkdir(resources, { recursive: true })]);
    const nativeTemplate = await desktopNativeTemplate();
    await buildRenderer(renderer);
    const hostResources = join(resources, "host");
    await mkdir(hostResources);
    const workerPath = join(hostResources, "worker.js");
    await cp(nativeTemplate?.worker ?? bundledCapabilityWorker(), workerPath);
    await cp(nativeTemplate?.icon ?? fileURLToPath(new URL("../native/macos/VelarScript.icns", import.meta.url)), join(resources, "VelarScript.icns"));
    const hostPath = join(executableDirectory, "VelarDesktopHost");
    if (nativeTemplate) {
      await cp(nativeTemplate.host, hostPath);
      await chmod(hostPath, 0o755);
    } else {
      await compileMacHost(hostPath);
    }
    await writeFile(join(contents, "Info.plist"), infoPlist(config, version), "utf8");
    await writeFile(join(resources, "desktop.json"), `${JSON.stringify({
      protocolVersion: 1,
      productName: config.productName,
      identifier: config.identifier,
      version,
      nodeMinimumMajor: DESKTOP_NODE_MINIMUM_MAJOR,
      windows: config.windows,
      permissions: config.permissions,
    }, null, 2)}\n`, "utf8");

    // The runtime goes into `Contents/MacOS`, beside the executable, because a
    // Mach-O under `Contents/Resources` is sealed as a plain resource: codesign
    // records a hash for it and no signature, `--deep` will not sign it, and
    // arm64 refuses to execute an unsigned Mach-O. The layout is what makes the
    // signature possible, not a filing preference.
    const runtimePath = join(applicationBundle, DESKTOP_EMBEDDED_RUNTIME_PATH);
    const runtime = await embedDesktopRuntime(nativeTemplate, runtimePath);
    // Checked on what was provisioned, before this build's signature replaces
    // Apple's: the ceiling is a question about the archive that arrived.
    const ceilingFailure = desktopRuntimeCeilingFailure((await stat(runtimePath)).size);
    if (ceilingFailure) throw new Error(ceilingFailure);

    const entitlementsPath = join(staging, DESKTOP_RUNTIME_ENTITLEMENTS_FILE);
    await writeFile(entitlementsPath, DESKTOP_RUNTIME_ENTITLEMENTS, "utf8");
    const notarized = await signDesktopBundle(projectRoot, config, applicationBundle, entitlementsPath, staging);

    // Every size is read after signing, and none of them before. A signature is
    // bytes in the bundle — an ad-hoc one is *smaller* than the Developer ID
    // signature it replaced on the runtime — so measurements taken earlier
    // describe an artifact that no longer exists, and their parts stop summing
    // to their total.
    const runtimeBytes = (await stat(runtimePath)).size;
    const hostBytes = (await stat(hostPath)).size;
    const rendererBytes = await treeSize(renderer);
    const capabilityHostBytes = (await stat(workerPath)).size;
    const totalBytes = await treeSize(applicationBundle);
    const metadataBytes = totalBytes - hostBytes - rendererBytes - capabilityHostBytes - runtimeBytes;
    const budgetFailure = desktopSizeBudgetFailure({
      hostBytes,
      rendererBytes,
      capabilityHostBytes,
      metadataBytes,
      applicationBytes: totalBytes - runtimeBytes,
      runtimeBytes,
      totalBytes,
    }, config.build.sizeBudgetBytes);
    if (budgetFailure) throw new Error(budgetFailure);
    const manifest: DesktopBuildManifest = Object.freeze({
      formatVersion: 4,
      kind: "velar-desktop-build",
      productName: config.productName,
      identifier: config.identifier,
      version,
      platform: "macos",
      architecture: process.arch,
      hostProtocolVersion: 1,
      runtime: Object.freeze({
        kind: "embedded-node" as const,
        version: runtime.version,
        embedded: true as const,
        bytes: runtimeBytes,
        sha256: runtime.archiveSha256,
      }),
      signing: Object.freeze({
        mode: desktopSigningMode(config.build.signing),
        hardenedRuntime: true as const,
        notarized,
      }),
      applicationBundle: applicationName,
      sizeBudgetBytes: config.build.sizeBudgetBytes,
      sizes: Object.freeze({
        hostBytes,
        rendererBytes,
        capabilityHostBytes,
        metadataBytes,
        applicationBytes: totalBytes - runtimeBytes,
        runtimeBytes,
        totalBytes,
      }),
      sha256: await desktopTreeSha256(applicationBundle),
    });
    await writeFile(join(staging, "velar-desktop-build.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
    await rm(outputDirectory, { recursive: true, force: true });
    await rename(staging, outputDirectory);
    return Object.freeze({
      outputDirectory,
      applicationBundle: join(outputDirectory, applicationName),
      manifestPath: join(outputDirectory, "velar-desktop-build.json"),
      manifest,
    });
  } catch (error) {
    await rm(staging, { recursive: true, force: true });
    throw error;
  }
}

/**
 * Only the bare executable is embedded. `npm`, `npx` and `corepack` are symbolic
 * links into `lib/`, the runtime needs none of them, and the bundle's tree hash
 * refuses to walk a symbolic link at all — three reasons that agree.
 */
async function embedDesktopRuntime(template: DesktopNativeTemplate | null, destination: string): Promise<DesktopNodeRuntime> {
  const runtime = template?.runtime
    ? await templateRuntime(template.runtime)
    : await provisionDesktopNodeRuntime({ platform: process.platform, architecture: process.arch });
  await cp(runtime.executablePath, destination);
  // `cp` preserves neither the executable bit across every filesystem nor a
  // read-only source's mode, and a runtime the host cannot execute is a bundle
  // that fails at launch rather than at build.
  await chmod(destination, 0o755);
  return runtime;
}

/**
 * A template application was built by this same toolchain generation, so the
 * runtime inside it came through the same pinned archive and carries the same
 * provenance — which is why the digest is read from the pin table rather than
 * recomputed from a file whose signature the previous build already replaced.
 */
async function templateRuntime(path: string): Promise<DesktopNodeRuntime> {
  const key = `${process.platform}-${process.arch}`;
  const pinned = DESKTOP_NODE_RUNTIME_ARCHIVES[key];
  if (!pinned) throw new Error(`This toolchain has no pinned Node.js runtime archive for '${key}'`);
  return Object.freeze({
    executablePath: path,
    version: DESKTOP_NODE_RUNTIME_VERSION,
    archiveSha256: pinned.sha256,
    bytes: (await stat(path)).size,
    source: "cache",
  });
}

/**
 * Inside-out, always: the embedded runtime with the entitlements only it needs,
 * then the host, then the bundle. An identity makes the result distributable; its
 * absence makes it ad-hoc, which is still a signature and is what lets an arm64
 * machine run what it just built.
 */
async function signDesktopBundle(
  projectRoot: string,
  config: VelarDesktopConfig,
  applicationBundle: string,
  runtimeEntitlements: string,
  staging: string,
): Promise<boolean> {
  const signing = config.build.signing;
  let entitlements: string | null = null;
  if (signing.entitlements !== null) {
    entitlements = projectPath(projectRoot, signing.entitlements, "desktop.build.signing.entitlements");
    const information = await stat(entitlements).catch(() => null);
    if (!information?.isFile()) {
      throw new Error(`'desktop.build.signing.entitlements' names ${signing.entitlements}, which is not an ordinary file in this project`);
    }
  }
  const plan = desktopSigningPlan({
    applicationBundle,
    nestedCode: [{ path: DESKTOP_EMBEDDED_RUNTIME_PATH, entitlements: runtimeEntitlements }],
    executable: "Contents/MacOS/VelarDesktopHost",
    identity: signing.identity,
    entitlements,
  });
  for (const step of plan) {
    try {
      await runProcess(step.command, step.arguments, dirname(applicationBundle));
    } catch (error) {
      throw new Error(`Desktop signing failed while signing the ${step.label}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  if (signing.notarization === null) return false;
  const archive = join(staging, "velar-desktop-notarization.zip");
  try {
    for (const step of desktopNotarizationSteps(applicationBundle, archive, signing.notarization.keychainProfile)) {
      await runProcess(step.command, step.arguments, dirname(applicationBundle));
    }
  } finally {
    await rm(archive, { force: true });
  }
  return true;
}

async function compileMacHost(output: string): Promise<void> {
  const source = fileURLToPath(new URL("../native/macos/VelarDesktopHost.swift", import.meta.url));
  await runProcess("/usr/bin/swiftc", [
    "-Osize", "-whole-module-optimization", "-swift-version", "5", "-parse-as-library",
    // Cocoa and WebKit are the shell; the other four are the host surface the
    // manifest's permission categories reach — notifications, the keychain, the
    // microphone probe, and the screen-recording and accessibility probes.
    "-framework", "Cocoa", "-framework", "WebKit",
    "-framework", "UserNotifications", "-framework", "Security",
    "-framework", "AVFoundation", "-framework", "ApplicationServices",
    source, "-o", output,
  ], dirname(output));
  await chmod(output, 0o755);
}

async function runProcess(command: string, arguments_: readonly string[], cwd: string): Promise<void> {
  const child = spawn(command, arguments_, { cwd, stdio: ["ignore", "pipe", "pipe"] });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk: Buffer) => { stdout += chunk.toString("utf8"); });
  child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString("utf8"); });
  const code = await new Promise<number | null>((resolveExit, reject) => {
    child.once("error", reject);
    child.once("exit", resolveExit);
  });
  if (code !== 0) throw new Error(`${command} failed with exit code ${String(code)}${stderr || stdout ? `\n${stderr}${stdout}` : ""}`);
}

async function readJsonObject(path: string): Promise<Record<string, unknown>> {
  const information = await stat(path);
  if (!information.isFile() || information.size > 1024 * 1024) throw new Error(`${path} must be an ordinary JSON file no larger than 1 MiB`);
  let value: unknown;
  try { value = JSON.parse(await readFile(path, "utf8")); }
  catch { throw new Error(`${path} must contain valid JSON`); }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${path} must contain a JSON object`);
  return value as Record<string, unknown>;
}

async function findPackageManifest(start: string): Promise<string> {
  let directory = start;
  while (true) {
    const candidate = join(directory, "package.json");
    try {
      if ((await stat(candidate)).isFile()) return candidate;
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
    }
    const parent = dirname(directory);
    if (parent === directory) break;
    directory = parent;
  }
  throw new Error(`Desktop packaging could not find package.json at or above ${start}`);
}

function projectPath(root: string, value: string, field: string): string {
  if (isAbsolute(value)) throw new Error(`'${field}' must be relative to the project`);
  const path = resolve(root, value);
  const fromRoot = relative(root, path);
  if (fromRoot === "" || fromRoot === ".." || fromRoot.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) || isAbsolute(fromRoot)) {
    throw new Error(`'${field}' must stay below the project root`);
  }
  return path;
}

function infoPlist(config: VelarDesktopConfig, version: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleDevelopmentRegion</key><string>en</string>
  <key>CFBundleDisplayName</key><string>${xml(config.productName)}</string>
  <key>CFBundleExecutable</key><string>VelarDesktopHost</string>
  <key>CFBundleIdentifier</key><string>${xml(config.identifier)}</string>
  <key>CFBundleIconFile</key><string>VelarScript</string>
  <key>CFBundleInfoDictionaryVersion</key><string>6.0</string>
  <key>CFBundleName</key><string>${xml(config.productName)}</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>${xml(version)}</string>
  <key>CFBundleVersion</key><string>${xml(version)}</string>
  <key>LSMinimumSystemVersion</key><string>13.0</string>
  <key>LSMultipleInstancesProhibited</key><true/>
  <key>NSHighResolutionCapable</key><true/>
</dict></plist>
`;
}

function packageVersion(manifest: Record<string, unknown>, path: string): string {
  const version = manifest.version;
  if (typeof version !== "string" || !/^\d{1,6}\.\d{1,6}\.\d{1,6}$/u.test(version)) {
    throw new Error(`${path}: Desktop packaging requires a numeric major.minor.patch package version`);
  }
  return version;
}

async function treeSize(root: string): Promise<number> {
  let total = 0;
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`Desktop output cannot contain symbolic link '${relative(root, path)}'`);
    if (entry.isDirectory()) total += await treeSize(path);
    else if (entry.isFile()) total += (await stat(path)).size;
  }
  return total;
}

/**
 * One digest over the whole bundle, in one stable order, streamed. The digest is
 * exactly what a whole-file implementation produced — name, NUL, byte count,
 * NUL, then the bytes — so an embedded runtime does not change the meaning of
 * the receipt, only the cost of computing it: a 110 MiB interpreter read into
 * memory in one buffer is a hundred megabytes this build has no use for.
 *
 * A symbolic link is still refused rather than followed or hashed. A link is
 * neither a directory nor a file here, so it lands in the same refusal an
 * unsupported entry does, and that refusal is why only the bare `node`
 * executable is ever embedded.
 *
 * The runtime is inside the tree on purpose: its version is pinned to this
 * toolchain generation, so the digest moves when the generation moves and not
 * otherwise.
 */
export async function desktopTreeSha256(root: string): Promise<string> {
  const hash = createHash("sha256");
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  const visit = async (directory: string): Promise<void> => {
    const entries = (await readdir(directory, { withFileTypes: true })).sort((left, right) => byCodeUnit(left.name, right.name));
    for (const entry of entries) {
      const path = join(directory, entry.name);
      const name = relative(root, path).replaceAll("\\", "/");
      if (entry.isDirectory()) await visit(path);
      else if (entry.isFile()) {
        const handle = await open(path, "r");
        try {
          hash.update(name).update("\0").update(String((await handle.stat()).size)).update("\0");
          while (true) {
            const { bytesRead } = await handle.read(buffer, 0, buffer.byteLength, null);
            if (bytesRead === 0) break;
            hash.update(buffer.subarray(0, bytesRead));
          }
        } finally {
          await handle.close();
        }
      } else throw new Error(`Desktop output contains unsupported entry '${name}'`);
    }
  };
  await visit(root);
  return hash.digest("hex");
}

function xml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}
