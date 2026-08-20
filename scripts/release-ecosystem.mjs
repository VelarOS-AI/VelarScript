#!/usr/bin/env node

import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { lstat, mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createIsolatedToolchainBuild } from "./isolated-toolchain-build.mjs";
import { velarPublishedEcosystemPackages } from "./velar-packages.mjs";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const manifestName = "velar-ecosystem-release.json";
const checksumName = "SHA256SUMS";

function safeName(name) {
  return name.replace(/^@/u, "").replaceAll("/", "-");
}

async function selectedPackage(name) {
  const packages = await velarPublishedEcosystemPackages(root);
  const package_ = packages.find((candidate) => candidate.name === name);
  if (!package_) throw new Error(`'${name}' is not a publishable ecosystem package`);
  return package_;
}

export async function createEcosystemRelease(name, outputDirectory, mode = "rehearse") {
  if (mode !== "rehearse" && mode !== "candidate") throw new Error(`unsupported ecosystem release mode '${mode}'`);
  const package_ = await selectedPackage(name);
  const source = await sourceIdentity(package_.manifest.repository?.url ?? null);
  const expectedTag = `${package_.name}@${package_.version}`;
  const blockers = [];
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u.test(package_.version)) blockers.push(`version ${package_.version} is not valid semver`);
  if (package_.version.includes("-")) blockers.push(`version ${package_.version} is not stable`);
  if (!package_.manifest.license || package_.manifest.license === "UNLICENSED") blockers.push(`${package_.name} has no publishable license decision`);
  if (!source.commit) blockers.push("source repository has no committed HEAD");
  if (!source.clean) blockers.push("source working tree is not clean");
  if (!source.tags.includes(expectedTag)) blockers.push(`HEAD is not tagged ${expectedTag}`);
  if (!source.remoteMatches) blockers.push("origin does not match package repository metadata");
  if (mode === "candidate" && blockers.length > 0) throw new Error(`ecosystem release candidate refused:\n- ${blockers.join("\n- ")}`);

  outputDirectory = resolve(outputDirectory);
  await assertReplaceableOutput(outputDirectory);
  await mkdir(dirname(outputDirectory), { recursive: true });
  const staging = await mkdtemp(join(dirname(outputDirectory), `.velar-${safeName(name)}-`));
  let isolated;
  try {
    isolated = await createIsolatedToolchainBuild();
    if (package_.manifest.scripts?.build) await runNpm(["run", "build", "--workspace", name], isolated.root);
    const packed = await packWorkspace(name, staging, isolated.root);
    const body = await readFile(join(staging, packed.filename));
    const artifact = {
      name: packed.name,
      version: packed.version,
      fileName: packed.filename,
      sizeBytes: body.byteLength,
      sha256: createHash("sha256").update(body).digest("hex"),
      npmIntegrity: packed.integrity,
      unpackedSizeBytes: packed.unpackedSize,
      fileCount: packed.files.length,
    };
    const manifest = {
      formatVersion: 1,
      kind: "velar-ecosystem-release",
      mode,
      package: artifact,
      source: { ...source, expectedTag },
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
    await writeFile(join(staging, checksumName), `${artifact.sha256}  ${artifact.fileName}\n`, "utf8");
    await verifyEcosystemRelease(staging, name);
    await assertReplaceableOutput(outputDirectory);
    await rm(outputDirectory, { recursive: true, force: true });
    await rename(staging, outputDirectory);
    return { outputDirectory, manifest };
  } catch (error) {
    await rm(staging, { recursive: true, force: true });
    throw error;
  } finally {
    await isolated?.dispose();
  }
}

export async function verifyEcosystemRelease(outputDirectory, expectedName = null) {
  const directory = resolve(outputDirectory);
  const status = await lstat(directory);
  if (status.isSymbolicLink() || !status.isDirectory()) throw new Error("ecosystem release path must be a real directory");
  const manifest = JSON.parse(await readFile(join(directory, manifestName), "utf8"));
  if (manifest?.formatVersion !== 1 || manifest.kind !== "velar-ecosystem-release") throw new Error("ecosystem release manifest has an unsupported format");
  if (manifest.mode !== "rehearse" && manifest.mode !== "candidate") throw new Error("ecosystem release mode is invalid");
  const package_ = manifest.package;
  if (!package_ || typeof package_.name !== "string" || expectedName && package_.name !== expectedName) throw new Error("ecosystem release package identity is invalid");
  const workspace = await selectedPackage(package_.name);
  const expectedFileName = `${safeName(package_.name)}-${package_.version}.tgz`;
  if (package_.version !== workspace.version || package_.fileName !== expectedFileName || basename(package_.fileName) !== package_.fileName) {
    throw new Error("ecosystem release artifact identity is invalid");
  }
  if (!Number.isSafeInteger(package_.sizeBytes) || package_.sizeBytes <= 0
    || !Number.isSafeInteger(package_.unpackedSizeBytes) || package_.unpackedSizeBytes <= 0
    || !Number.isSafeInteger(package_.fileCount) || package_.fileCount <= 0
    || typeof package_.sha256 !== "string" || !/^[0-9a-f]{64}$/u.test(package_.sha256)
    || typeof package_.npmIntegrity !== "string" || !/^sha512-[A-Za-z0-9+/]+={0,2}$/u.test(package_.npmIntegrity)) {
    throw new Error("ecosystem release artifact metadata is invalid");
  }
  const source = manifest.source;
  const expectedTag = `${package_.name}@${package_.version}`;
  if (!source || source.repository !== (workspace.manifest.repository?.url ?? null)
    || source.expectedTag !== expectedTag
    || source.commit !== null && (typeof source.commit !== "string" || !/^[0-9a-f]{40,64}$/u.test(source.commit))
    || source.tree !== null && (typeof source.tree !== "string" || !/^[0-9a-f]{40,64}$/u.test(source.tree))
    || !Array.isArray(source.tags) || source.tags.length > 256
    || source.tags.some((tag) => typeof tag !== "string" || tag.length === 0 || tag.length > 512)
    || new Set(source.tags).size !== source.tags.length
    || typeof source.clean !== "boolean"
    || source.remote !== null && typeof source.remote !== "string"
    || typeof source.remoteMatches !== "boolean") {
    throw new Error("ecosystem release source identity is invalid");
  }
  const expectedPublishable = manifest.mode === "candidate";
  if (manifest.publish?.performed !== false || manifest.publish?.registry !== "https://registry.npmjs.org"
    || manifest.publish?.access !== "public" || manifest.publish?.provenanceRequired !== true
    || manifest.publish?.publishable !== expectedPublishable || !Array.isArray(manifest.publish?.blockers)
    || manifest.publish.blockers.some((blocker) => typeof blocker !== "string" || blocker.length === 0 || blocker.length > 1024)
    || expectedPublishable && manifest.publish.blockers.length > 0) throw new Error("ecosystem publication contract is invalid");
  if (expectedPublishable) {
    if (!source.commit || !source.tree || !source.clean || !source.remoteMatches || !source.tags.includes(expectedTag)) {
      throw new Error("ecosystem candidate source identity is not publishable");
    }
    const currentSource = await sourceIdentity(source.repository);
    if (JSON.stringify(currentSource) !== JSON.stringify({
      repository: source.repository,
      commit: source.commit,
      tree: source.tree,
      tags: source.tags,
      clean: source.clean,
      remote: source.remote,
      remoteMatches: source.remoteMatches,
    })) throw new Error("ecosystem candidate does not match the current source checkout");
  }
  const body = await readFile(join(directory, package_.fileName));
  const sha256 = createHash("sha256").update(body).digest("hex");
  if (body.byteLength !== package_.sizeBytes || sha256 !== package_.sha256) throw new Error("ecosystem tarball does not match its manifest");
  if (await readFile(join(directory, checksumName), "utf8") !== `${sha256}  ${package_.fileName}\n`) throw new Error("ecosystem checksums do not match");
  const expectedFiles = [checksumName, manifestName, package_.fileName].sort();
  const entries = await readdir(directory, { withFileTypes: true });
  if (entries.some((entry) => !entry.isFile() || entry.isSymbolicLink())
    || JSON.stringify(entries.map((entry) => entry.name).sort()) !== JSON.stringify(expectedFiles)) {
    throw new Error("ecosystem release directory must contain exactly its manifest, checksum, and tarball");
  }
  return manifest;
}

async function sourceIdentity(repository) {
  const commit = await gitValue(["rev-parse", "--verify", "HEAD"]);
  const tree = await gitValue(["rev-parse", "HEAD^{tree}"]);
  const status = await gitValue(["status", "--porcelain=v1", "--untracked-files=all"]);
  const tags = commit ? (await gitValue(["tag", "--points-at", "HEAD"]) ?? "").split("\n").filter(Boolean) : [];
  const origin = await gitValue(["remote", "get-url", "origin"]);
  return {
    repository,
    commit,
    tree,
    tags,
    clean: status === "",
    remote: origin,
    remoteMatches: Boolean(origin && repository && normalizeRepository(origin) === normalizeRepository(repository)),
  };
}

function normalizeRepository(value) {
  return value.replace(/^git\+/u, "").replace(/^git@github\.com:/u, "https://github.com/").replace(/\.git$/u, "").replace(/\/$/u, "").toLowerCase();
}

async function packWorkspace(workspace, destination, workspaceRoot) {
  const result = await runNpm(["pack", "--ignore-scripts", "--workspace", workspace, "--pack-destination", destination, "--json"], workspaceRoot);
  const values = JSON.parse(result.stdout);
  if (!Array.isArray(values) || values.length !== 1) throw new Error(`npm pack returned an invalid result for ${workspace}`);
  return values[0];
}

async function assertReplaceableOutput(outputDirectory) {
  const directory = resolve(outputDirectory);
  const rootWithinOutput = relative(directory, root);
  if (dirname(directory) === directory || rootWithinOutput === "" || !rootWithinOutput.startsWith("..") && !isAbsolute(rootWithinOutput)) {
    throw new Error(`refusing unsafe ecosystem release output '${directory}'`);
  }
  try {
    const status = await lstat(directory);
    if (status.isSymbolicLink() || !status.isDirectory()) throw new Error(`refusing non-directory ecosystem release output '${directory}'`);
    const entries = await readdir(directory);
    if (entries.length === 0) return;
    const manifest = JSON.parse(await readFile(join(directory, manifestName), "utf8"));
    if (manifest?.formatVersion === 1 && manifest.kind === "velar-ecosystem-release") return;
    throw new Error(`refusing to replace non-release directory '${directory}'`);
  } catch (error) {
    if (error && typeof error === "object" && error.code === "ENOENT") return;
    throw error;
  }
}

async function gitValue(arguments_) {
  const result = await run("git", arguments_, root, true);
  return result.code === 0 ? result.stdout.trim() : null;
}

async function runNpm(arguments_, cwd) {
  const npm = process.env.npm_execpath;
  return npm ? run(process.execPath, [npm, ...arguments_], cwd) : run(process.platform === "win32" ? "npm.cmd" : "npm", arguments_, cwd);
}

async function run(command, arguments_, cwd, allowFailure = false) {
  const child = spawn(command, arguments_, { cwd, stdio: ["ignore", "pipe", "pipe"] });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => { stdout += chunk.toString("utf8"); });
  child.stderr.on("data", (chunk) => { stderr += chunk.toString("utf8"); });
  const code = await new Promise((resolveExit, rejectExit) => { child.once("error", rejectExit); child.once("exit", resolveExit); });
  if (code !== 0 && !allowFailure) throw new Error(`${command} ${arguments_.join(" ")} failed (${code})\n${stdout}\n${stderr}`);
  return { code, stdout, stderr };
}

function parse(arguments_) {
  const [command, value, ...rest] = arguments_;
  if (command === "verify") {
    if (!value || rest.length > 1) throw new Error("Usage: release-ecosystem.mjs verify <directory> [package-name]");
    return { command, directory: resolve(root, value), name: rest[0] ?? null };
  }
  if (command !== "rehearse" && command !== "candidate" || !value) {
    throw new Error("Usage: release-ecosystem.mjs <rehearse|candidate> <package-name> [--output-dir <directory>]");
  }
  let directory = join(root, "release", "ecosystem", safeName(value), command);
  if (rest.length > 0) {
    if (rest.length !== 2 || rest[0] !== "--output-dir" || !rest[1]) throw new Error("expected --output-dir <directory>");
    directory = resolve(root, rest[1]);
  }
  return { command, name: value, directory };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const options = parse(process.argv.slice(2));
    if (options.command === "verify") {
      await verifyEcosystemRelease(options.directory, options.name);
      process.stdout.write(`Verified ecosystem release -> ${options.directory}\n`);
    } else {
      const result = await createEcosystemRelease(options.name, options.directory, options.command);
      process.stdout.write(`Created ${options.command} for ${result.manifest.package.name}@${result.manifest.package.version} -> ${result.outputDirectory}\n`);
    }
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
