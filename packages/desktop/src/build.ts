import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { chmod, cp, mkdir, mkdtemp, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { VelarDesktopConfig } from "./config.ts";

export interface DesktopBuildManifest {
  readonly formatVersion: 2;
  readonly kind: "velar-desktop-build";
  readonly productName: string;
  readonly identifier: string;
  readonly version: string;
  readonly platform: "macos";
  readonly architecture: string;
  readonly hostProtocolVersion: 1;
  readonly runtime: {
    readonly kind: "external-node";
    readonly minimumMajor: 24;
    readonly discovery: "environment-and-system-paths";
    readonly embedded: false;
  };
  readonly applicationBundle: string;
  readonly sizeBudgetBytes: number;
  readonly sizes: {
    readonly hostBytes: number;
    readonly rendererBytes: number;
    readonly capabilityHostBytes: number;
    readonly toolchainBytes: number;
    readonly metadataBytes: number;
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

export async function buildDesktopApplication(
  projectRoot: string,
  config: VelarDesktopConfig,
  buildRenderer: (outputDirectory: string) => Promise<void>,
  buildTool: (tool: { readonly id: string; readonly outputFile: string }) => Promise<void>,
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
    await buildRenderer(renderer);
    const hostResources = join(resources, "host");
    await mkdir(hostResources);
    const workerPath = join(hostResources, "worker.js");
    await cp(fileURLToPath(new URL("../native/node/worker.js", import.meta.url)), workerPath);
    const languageServerPath = join(hostResources, "language-server.js");
    await buildTool({ id: "velar-language-server", outputFile: languageServerPath });
    await cp(fileURLToPath(new URL("../native/macos/VelarScript.icns", import.meta.url)), join(resources, "VelarScript.icns"));
    const hostPath = join(executableDirectory, "VelarDesktopHost");
    await compileMacHost(hostPath);
    await writeFile(join(contents, "Info.plist"), infoPlist(config, version), "utf8");
    await writeFile(join(resources, "desktop.json"), `${JSON.stringify({
      protocolVersion: 1,
      productName: config.productName,
      identifier: config.identifier,
      version,
      nodeMinimumMajor: 24,
      window: config.window,
      permissions: config.permissions,
      languageServer: { path: "host/language-server.js" },
    }, null, 2)}\n`, "utf8");

    const hostBytes = (await stat(hostPath)).size;
    const rendererBytes = await treeSize(renderer);
    const capabilityHostBytes = (await stat(workerPath)).size;
    const toolchainBytes = (await stat(languageServerPath)).size;
    const totalBytes = await treeSize(applicationBundle);
    const metadataBytes = totalBytes - hostBytes - rendererBytes - capabilityHostBytes - toolchainBytes;
    if (totalBytes > config.build.sizeBudgetBytes) {
      throw new Error(`Desktop bundle is ${totalBytes} bytes, exceeding the ${config.build.sizeBudgetBytes}-byte size budget`);
    }
    const manifest: DesktopBuildManifest = Object.freeze({
      formatVersion: 2,
      kind: "velar-desktop-build",
      productName: config.productName,
      identifier: config.identifier,
      version,
      platform: "macos",
      architecture: process.arch,
      hostProtocolVersion: 1,
      runtime: Object.freeze({ kind: "external-node", minimumMajor: 24 as const, discovery: "environment-and-system-paths" as const, embedded: false }),
      applicationBundle: applicationName,
      sizeBudgetBytes: config.build.sizeBudgetBytes,
      sizes: Object.freeze({ hostBytes, rendererBytes, capabilityHostBytes, toolchainBytes, metadataBytes, totalBytes }),
      sha256: await hashTree(applicationBundle),
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

async function compileMacHost(output: string): Promise<void> {
  const source = fileURLToPath(new URL("../native/macos/VelarDesktopHost.swift", import.meta.url));
  await runProcess("/usr/bin/swiftc", [
    "-Osize", "-whole-module-optimization", "-swift-version", "5", "-parse-as-library",
    "-framework", "Cocoa", "-framework", "WebKit", source, "-o", output,
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

async function hashTree(root: string): Promise<string> {
  const hash = createHash("sha256");
  const visit = async (directory: string): Promise<void> => {
    const entries = (await readdir(directory, { withFileTypes: true })).sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const path = join(directory, entry.name);
      const name = relative(root, path).replaceAll("\\", "/");
      if (entry.isDirectory()) await visit(path);
      else if (entry.isFile()) {
        const body = await readFile(path);
        hash.update(name).update("\0").update(String(body.byteLength)).update("\0").update(body);
      } else throw new Error(`Desktop output contains unsupported entry '${name}'`);
    }
  };
  await visit(root);
  return hash.digest("hex");
}

function xml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}
