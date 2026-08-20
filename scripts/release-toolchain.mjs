#!/usr/bin/env node

import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import {
  mkdir,
  lstat,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createIsolatedToolchainBuild } from "./isolated-toolchain-build.mjs";
import { velarToolchainPackageNames } from "./velar-packages.mjs";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const defaultOutput = join(root, "release", "rehearsal");
const manifestName = "velar-toolchain-release.json";
const checksumName = "SHA256SUMS";
// D63 rule 159: derived from packages/*, never restated here. Ordinary source
// libraries under libraries/* and concrete integrations under adapters/* are
// independent packages, not members of this version-locked compiler/runtime
// release generation.
const workspaces = await velarToolchainPackageNames(root);
const excludedTreeNames = new Set([".git", "node_modules", "dist", "release", "coverage"]);

async function main(arguments_) {
  const [command, ...rest] = arguments_;
  if (command === "rehearse" || command === "candidate") {
    const outputDirectory = parseOutputDirectory(rest, command === "rehearse" ? defaultOutput : join(root, "release", "candidate"));
    const result = await createToolchainRelease(outputDirectory, command);
    process.stdout.write(`${command === "candidate" ? "Created VelarScript release candidate" : "VelarScript publication rehearsal passed"} -> ${result.outputDirectory}\n`);
    return 0;
  }
  if (command === "verify") {
    const outputDirectory = rest.length === 0 ? defaultOutput : resolve(root, rest[0]);
    if (rest.length > 1) throw new Error("verify accepts at most one release directory");
    await verifyToolchainRelease(outputDirectory);
    process.stdout.write(`Verified VelarScript toolchain release -> ${outputDirectory}\n`);
    return 0;
  }
  process.stderr.write("Usage: release-toolchain.mjs <rehearse|candidate|verify> [--output-dir <directory>]\n");
  return 2;
}

function parseOutputDirectory(arguments_, fallback) {
  let output = fallback;
  let provided = false;
  for (let index = 0; index < arguments_.length; index += 1) {
    if (arguments_[index] !== "--output-dir" || !arguments_[index + 1]) {
      throw new Error(`unknown or incomplete release option '${arguments_[index] ?? ""}'`);
    }
    if (provided) throw new Error("--output-dir may be provided only once");
    provided = true;
    output = resolve(root, arguments_[index + 1]);
    index += 1;
  }
  return output;
}

export async function createToolchainRelease(outputDirectory, mode = "rehearse") {
  if (mode !== "rehearse" && mode !== "candidate") throw new Error(`unsupported release mode '${mode}'`);
  const manifests = await readPackageManifests();
  const source = await sourceIdentity(manifests.root.repository?.url ?? null);
  const blockers = releaseBlockers(manifests, source);
  if (mode === "candidate" && blockers.length > 0) {
    throw new Error(`release candidate refused:\n- ${blockers.join("\n- ")}`);
  }

  outputDirectory = resolve(outputDirectory);
  await assertReplaceableReleaseOutput(outputDirectory);
  const parent = dirname(outputDirectory);
  await mkdir(parent, { recursive: true });
  const staging = await mkdtemp(join(parent, `.velar-${basename(outputDirectory)}-`));
  let toolchain;
  try {
    toolchain = await createIsolatedToolchainBuild();
    const packages = [];
    for (const workspace of workspaces) {
      const packed = await packWorkspace(workspace, staging, toolchain.root);
      const tarballPath = join(staging, packed.filename);
      const body = await readFile(tarballPath);
      packages.push({
        name: packed.name,
        version: packed.version,
        fileName: packed.filename,
        sizeBytes: body.byteLength,
        sha256: createHash("sha256").update(body).digest("hex"),
        npmIntegrity: packed.integrity,
        unpackedSizeBytes: packed.unpackedSize,
        fileCount: packed.files.length,
      });
    }
    packages.sort((left, right) => left.name.localeCompare(right.name));
    const manifest = {
      formatVersion: 1,
      kind: "velar-toolchain-release",
      mode,
      version: manifests.root.version,
      source,
      runtime: { node: manifests.root.engines?.node ?? null, platform: "javascript" },
      packages,
      publish: {
        performed: false,
        registry: "https://registry.npmjs.org",
        access: "public",
        provenanceRequired: true,
        publishable: mode === "candidate" && blockers.length === 0,
        blockers,
      },
    };
    await writeFile(join(staging, manifestName), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
    await writeFile(
      join(staging, checksumName),
      `${packages.map((item) => `${item.sha256}  ${item.fileName}`).join("\n")}\n`,
      "utf8",
    );
    await verifyToolchainRelease(staging);
    await replaceDirectory(staging, outputDirectory);
    return { outputDirectory, manifest };
  } catch (error) {
    await rm(staging, { recursive: true, force: true });
    throw error;
  } finally {
    await toolchain?.dispose();
  }
}

export async function verifyToolchainRelease(outputDirectory) {
  const directory = resolve(outputDirectory);
  const directoryStatus = await lstat(directory);
  if (directoryStatus.isSymbolicLink() || !directoryStatus.isDirectory()) throw new Error("release path must be a real directory");
  let manifest;
  try { manifest = JSON.parse(await readFile(join(directory, manifestName), "utf8")); }
  catch (error) { throw new Error(`${manifestName} is missing or invalid`, { cause: error }); }
  if (manifest?.formatVersion !== 1 || manifest?.kind !== "velar-toolchain-release") {
    throw new Error(`${manifestName} has an unsupported format`);
  }
  if (manifest.mode !== "rehearse" && manifest.mode !== "candidate") throw new Error("release manifest has an invalid mode");
  if (typeof manifest.version !== "string" || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u.test(manifest.version)) {
    throw new Error("release manifest has an invalid version");
  }
  if (!manifest.source || typeof manifest.source !== "object"
    || typeof manifest.source.treeSha256 !== "string" || !/^[0-9a-f]{64}$/u.test(manifest.source.treeSha256)) {
    throw new Error("release manifest has an invalid source identity");
  }
  if (manifest.publish?.performed !== false) throw new Error("a toolchain release manifest must never claim that publication occurred");
  if (manifest.publish?.registry !== "https://registry.npmjs.org" || manifest.publish?.access !== "public"
    || manifest.publish?.provenanceRequired !== true || !Array.isArray(manifest.publish?.blockers)
    || !manifest.publish.blockers.every((item) => typeof item === "string")) {
    throw new Error("release manifest has an invalid publication contract");
  }
  const expectedPublishable = manifest.mode === "candidate";
  if (manifest.publish.publishable !== expectedPublishable
    || (expectedPublishable && manifest.publish.blockers.length > 0)) {
    throw new Error("release manifest publishability does not match its mode and blockers");
  }
  if (!Array.isArray(manifest.packages) || manifest.packages.length !== workspaces.length) {
    throw new Error("release manifest does not contain the complete release package set");
  }
  const names = manifest.packages.map((package_) => package_?.name);
  const expectedNames = [...workspaces].sort();
  if (JSON.stringify(names) !== JSON.stringify(expectedNames)) {
    throw new Error("release manifest package names must be the complete sorted release set");
  }
  const sums = [];
  for (const package_ of manifest.packages) {
    const expectedFileName = `${package_.name.replace(/^@/u, "").replaceAll("/", "-")}-${manifest.version}.tgz`;
    if (package_.version !== manifest.version || package_.fileName !== expectedFileName || basename(package_.fileName) !== package_.fileName) {
      throw new Error(`release package identity is invalid for ${package_.name}`);
    }
    if (!Number.isSafeInteger(package_.sizeBytes) || package_.sizeBytes <= 0
      || !Number.isSafeInteger(package_.unpackedSizeBytes) || package_.unpackedSizeBytes <= 0
      || !Number.isSafeInteger(package_.fileCount) || package_.fileCount <= 0
      || typeof package_.sha256 !== "string" || !/^[0-9a-f]{64}$/u.test(package_.sha256)
      || typeof package_.npmIntegrity !== "string" || !/^sha512-[A-Za-z0-9+/]+={0,2}$/u.test(package_.npmIntegrity)) {
      throw new Error(`release package metadata is invalid for ${package_.name}`);
    }
    const body = await readFile(join(directory, package_.fileName));
    const sha256 = createHash("sha256").update(body).digest("hex");
    if (body.byteLength !== package_.sizeBytes) throw new Error(`${package_.fileName} size does not match the release manifest`);
    if (sha256 !== package_.sha256) throw new Error(`${package_.fileName} SHA-256 does not match the release manifest`);
    sums.push(`${sha256}  ${package_.fileName}`);
  }
  const expectedSums = `${sums.join("\n")}\n`;
  if (await readFile(join(directory, checksumName), "utf8") !== expectedSums) {
    throw new Error(`${checksumName} does not match the release manifest`);
  }
  const expectedFiles = [manifestName, checksumName, ...manifest.packages.map((package_) => package_.fileName)].sort();
  const entries = await readdir(directory, { withFileTypes: true });
  if (entries.some((entry) => !entry.isFile() || entry.isSymbolicLink())
    || JSON.stringify(entries.map((entry) => entry.name).sort()) !== JSON.stringify(expectedFiles)) {
    throw new Error("release directory must contain exactly the manifest, checksums, and declared package files");
  }
  return manifest;
}

async function readPackageManifests() {
  const rootManifest = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
  const compiler = JSON.parse(await readFile(join(root, "packages", "compiler", "package.json"), "utf8"));
  const node = JSON.parse(await readFile(join(root, "packages", "node", "package.json"), "utf8"));
  const web = JSON.parse(await readFile(join(root, "packages", "web", "package.json"), "utf8"));
  const create = JSON.parse(await readFile(join(root, "packages", "create", "package.json"), "utf8"));
  const cli = JSON.parse(await readFile(join(root, "packages", "cli", "package.json"), "utf8"));
  const desktop = JSON.parse(await readFile(join(root, "packages", "desktop", "package.json"), "utf8"));
  const textBuffer = JSON.parse(await readFile(join(root, "libraries", "text-buffer", "package.json"), "utf8"));
  const scriptAnalysis = JSON.parse(await readFile(join(root, "libraries", "script-analysis", "package.json"), "utf8"));
  for (const package_ of [compiler, node, web, create, cli, desktop]) {
    if (package_.version !== rootManifest.version) throw new Error(`${package_.name} version must exactly match ${rootManifest.version}`);
    if (package_.repository?.url !== rootManifest.repository?.url) throw new Error(`${package_.name} repository must match the workspace repository`);
  }
  if (cli.dependencies?.["@velarscript/compiler"] !== rootManifest.version) {
    throw new Error("@velarscript/cli must pin the exact compiler version");
  }
  if (web.dependencies?.["@velarscript/compiler"] !== rootManifest.version) {
    throw new Error("@velarscript/web must pin the exact compiler version");
  }
  if (node.dependencies?.["@velarscript/compiler"] !== rootManifest.version) {
    throw new Error("@velarscript/node must pin the exact compiler version");
  }
  if (cli.dependencies?.["@velarscript/node"] !== rootManifest.version) {
    throw new Error("@velarscript/cli must pin the exact Node runtime version");
  }
  for (const dependency of ["@velarscript/compiler", "@velarscript/node", "@velarscript/web"]) {
    if (desktop.dependencies?.[dependency] !== rootManifest.version) {
      throw new Error(`@velarscript/desktop must pin the exact ${dependency} version`);
    }
  }
  if (desktop.dependencies?.["@velarscript/cli"] || desktop.peerDependencies?.["@velarscript/cli"]) {
    throw new Error("@velarscript/desktop must not depend on CLI orchestration");
  }
  for (const dependency of ["@velarscript/web", "@velarscript/desktop"]) {
    if (cli.dependencies?.[dependency] !== rootManifest.version) {
      throw new Error(`@velarscript/cli must pin the exact official ${dependency} toolchain target`);
    }
  }
  if (cli.dependencies?.["create-velar"] !== rootManifest.version) {
    throw new Error("@velarscript/cli must pin the exact project creator version");
  }
  if (scriptAnalysis.dependencies?.["@velarscript/text-buffer"] !== textBuffer.version) {
    throw new Error("@velarscript/script-analysis must pin the exact @velarscript/text-buffer version");
  }
  if (cli.dependencies?.["@velarscript/script-analysis"] !== scriptAnalysis.version) {
    throw new Error("@velarscript/cli must pin the exact @velarscript/script-analysis version");
  }
  return { root: rootManifest, compiler, node, web, create, cli, desktop, textBuffer, scriptAnalysis };
}

function releaseBlockers(manifests, source) {
  const blockers = [];
  if (manifests.root.version.includes("-")) blockers.push(`version ${manifests.root.version} is not a stable release version`);
  if (!source.commit) blockers.push("source repository has no committed HEAD");
  if (!source.clean) blockers.push("source working tree is not clean");
  if (source.tag !== `v${manifests.root.version}`) blockers.push(`HEAD is not exactly tagged v${manifests.root.version}`);
  if (!source.remoteMatches) blockers.push("origin does not match package repository metadata");
  for (const package_ of [
    manifests.compiler,
    manifests.node,
    manifests.web,
    manifests.create,
    manifests.cli,
    manifests.desktop,
  ]) {
    if (!package_.license || package_.license === "UNLICENSED") blockers.push(`${package_.name} has no publishable license decision`);
  }
  return blockers;
}

async function sourceIdentity(repository) {
  const commit = await gitValue(["rev-parse", "--verify", "HEAD"]);
  const status = await gitValue(["status", "--porcelain=v1", "--untracked-files=all"]);
  const tags = commit ? (await gitValue(["tag", "--points-at", "HEAD"]) ?? "").split("\n").filter(Boolean) : [];
  const origin = await gitValue(["remote", "get-url", "origin"]);
  return {
    repository,
    commit,
    tag: tags.length === 1 ? tags[0] : null,
    clean: status === "",
    remote: origin,
    remoteMatches: Boolean(origin && repository && normalizeRepository(origin) === normalizeRepository(repository)),
    treeSha256: await sourceTreeHash(),
  };
}

function normalizeRepository(value) {
  return value
    .replace(/^git\+/u, "")
    .replace(/^git@github\.com:/u, "https://github.com/")
    .replace(/\.git$/u, "")
    .replace(/\/$/u, "")
    .toLowerCase();
}

async function sourceTreeHash() {
  const files = [];
  const visit = async (directory) => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (excludedTreeNames.has(entry.name)) continue;
      const path = join(directory, entry.name);
      if (entry.isSymbolicLink()) throw new Error(`release source contains unsupported symlink ${relative(root, path)}`);
      if (entry.isDirectory()) await visit(path);
      else if (entry.isFile()) files.push(path);
    }
  };
  await visit(root);
  const hash = createHash("sha256");
  for (const path of files.sort()) {
    hash.update(relative(root, path).replaceAll("\\", "/"));
    hash.update("\0");
    hash.update(await readFile(path));
    hash.update("\0");
  }
  return hash.digest("hex");
}

async function packWorkspace(workspace, destination, workspaceRoot) {
  const result = await runNpm(["pack", "--ignore-scripts", "--workspace", workspace, "--pack-destination", destination, "--json"], workspaceRoot);
  const values = JSON.parse(result.stdout);
  if (!Array.isArray(values) || values.length !== 1) throw new Error(`npm pack returned an invalid result for ${workspace}`);
  return values[0];
}

async function replaceDirectory(staging, outputDirectory) {
  if (resolve(staging) === resolve(outputDirectory)) return;
  await assertReplaceableReleaseOutput(outputDirectory);
  await rm(outputDirectory, { recursive: true, force: true });
  await rename(staging, outputDirectory);
}

async function assertReplaceableReleaseOutput(outputDirectory) {
  const directory = resolve(outputDirectory);
  const rootWithinOutput = relative(directory, root);
  if (dirname(directory) === directory
    || rootWithinOutput === ""
    || (!rootWithinOutput.startsWith("..") && !isAbsolute(rootWithinOutput))) {
    throw new Error(`refusing unsafe release output directory '${directory}'`);
  }
  let status;
  try { status = await lstat(directory); }
  catch (error) {
    if (error && typeof error === "object" && error.code === "ENOENT") return;
    throw error;
  }
  if (status.isSymbolicLink() || !status.isDirectory()) {
    throw new Error(`refusing to replace non-directory or symbolic-link release output '${directory}'`);
  }
  const entries = await readdir(directory);
  if (entries.length === 0) return;
  try {
    const manifest = JSON.parse(await readFile(join(directory, manifestName), "utf8"));
    if (manifest?.formatVersion === 1 && manifest?.kind === "velar-toolchain-release") return;
  } catch {}
  throw new Error(`refusing to replace non-release directory '${directory}'`);
}

async function gitValue(arguments_) {
  const result = await run("git", arguments_, root, true);
  return result.code === 0 ? result.stdout.trim() : null;
}

async function runNpm(arguments_, cwd) {
  const npm = process.env.npm_execpath;
  return npm
    ? run(process.execPath, [npm, ...arguments_], cwd)
    : run(process.platform === "win32" ? "npm.cmd" : "npm", arguments_, cwd);
}

async function run(command, arguments_, cwd, allowFailure = false) {
  const child = spawn(command, arguments_, { cwd, stdio: ["ignore", "pipe", "pipe"] });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => { stdout += chunk.toString("utf8"); });
  child.stderr.on("data", (chunk) => { stderr += chunk.toString("utf8"); });
  const code = await new Promise((resolvePromise, reject) => {
    child.once("error", reject);
    child.once("exit", resolvePromise);
  });
  if (code !== 0 && !allowFailure) throw new Error(`${command} ${arguments_.join(" ")} failed (${code})\n${stdout}\n${stderr}`);
  return { code, stdout, stderr };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    process.exitCode = await main(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
