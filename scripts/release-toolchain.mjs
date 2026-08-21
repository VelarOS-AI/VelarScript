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
import { velarPublishedToolchainPackages, velarToolchainPackageNames } from "./velar-packages.mjs";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const defaultOutput = join(root, "release", "rehearsal");
const manifestName = "velar-toolchain-release.json";
const checksumName = "SHA256SUMS";
// Derived from packages/*, never restated here. Project-owned libraries,
// concrete adapters, and provider integrations do not live in this repository.
const workspaces = await velarToolchainPackageNames(root);
// Build products and scratch state, not source. `.velar/` is the CLI's own
// scratch namespace and holds the gate lock a release build runs under, so
// hashing it would make `source.treeSha256` — a value whose whole purpose is
// that an auditor can recompute it — differ on every run.
const excludedTreeNames = new Set([".git", ".velar", "node_modules", "dist", "release", "coverage"]);

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
    // Code-point order: a release manifest is an attested artifact, so its
    // package order must not follow the collation the build machine's locale
    // selects. The same comparator orders the production build manifest.
    packages.sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0);
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

/**
 * A hand-edited version literal is a second copy of a package's generation.
 * `VELAR_VERSION` stamps build manifests, the `.velar/dev-deps` cache key, and
 * every reproduction bundle; `VELAR_CREATE_VERSION` is what create-velar pins
 * the Web and CLI dependencies of every generated project to. Nothing else
 * reads either against its own manifest, so a release that bumped package.json
 * and forgot the literal would record the previous generation everywhere and
 * agree with itself while doing it. Every literal of this kind belongs on this
 * list; a package whose generation nothing here checks is a release the
 * manifest cannot speak for.
 *
 * A generation that is deliberately independent of any package version does
 * not: `VELAR_RUNTIME_SCHEMA_VERSION`, `VELAR_TYPE_REGISTRY_VERSION`,
 * `VELAR_PROMISE_NORMALIZATION_REGISTRY_VERSION` and `VELAR_STANDARD_API_VERSION`
 * each move on their own schedule and have no manifest to disagree with, and
 * the `VELAR_*_API_VERSION` of each target is checked against its own package
 * metadata every time an extension loads. What belongs here is a literal that
 * must equal something a manifest already states.
 */
export const DECLARED_VERSIONS = Object.freeze([
  Object.freeze({ file: "packages/cli/src/version.ts", name: "VELAR_VERSION", package: "@velarscript/cli" }),
  Object.freeze({ file: "packages/create/src/types.ts", name: "VELAR_CREATE_VERSION", package: "create-velar" }),
]);

/**
 * A version literal that pins a third-party runtime dependency one of our own
 * manifests declares. `WEBSOCKET_VERSION` is the `ws` the CLI will accept in a
 * generated project's node_modules; the range that decides which `ws` we ship
 * is in packages/node/package.json, and nothing read the two against each
 * other. Either side moving alone leaves every generated WebSocket project
 * refusing its own runtime dependency at install time, with a green release
 * behind it. These pin a dependency rather than a package's own generation, so
 * they are checked against that dependency's declared range, not a version.
 */
export const PINNED_DEPENDENCY_VERSIONS = Object.freeze([
  Object.freeze({ file: "packages/cli/src/node-runtime-dependencies.ts", name: "WEBSOCKET_VERSION", package: "@velarscript/node", dependency: "ws" }),
]);

/** The `const NAME = "…"` literal a source file declares on one line, exported or not, or null. */
async function sourceLiteral(directory, file, name) {
  const source = await readFile(join(directory, file), "utf8");
  return new RegExp(`^(?:export )?const ${name} = "([^"]*)";$`, "mu").exec(source)?.[1] ?? null;
}

/** The consistency failure a declared version literal reports, or null when it matches its package. */
export async function declaredVersionFailure(directory, file, name, manifest) {
  const declared = await sourceLiteral(directory, file, name);
  return declared === manifest.version ? null
    : `${file} declares ${name} ${declared ?? "(unreadable)"}, but ${manifest.name} is ${manifest.version}`;
}

/** The consistency failure a pinned dependency literal reports, or null when it matches the declared range. */
export async function pinnedDependencyFailure(directory, file, name, dependency, manifest) {
  const declared = await sourceLiteral(directory, file, name);
  const range = manifest.dependencies?.[dependency];
  if (!range) return `${file} pins ${name}, but ${manifest.name} no longer depends on '${dependency}'`;
  const pinned = /^[\^~]?(\d+\.\d+\.\d+)$/u.exec(range)?.[1];
  if (!pinned) return `${manifest.name} depends on ${dependency}@${range}, which names no single version for ${file} to pin`;
  return declared === pinned ? null
    : `${file} declares ${name} ${declared ?? "(unreadable)"}, but ${manifest.name} depends on ${dependency}@${range}`;
}

async function readPackageManifests() {
  const rootManifest = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
  const packages = (await velarPublishedToolchainPackages(root)).map((entry) => entry.manifest);
  const byName = new Map(packages.map((package_) => [package_.name, package_]));
  const required = (name) => {
    const value = byName.get(name);
    if (!value) throw new Error(`toolchain release is missing ${name}`);
    return value;
  };
  const compiler = required("@velarscript/compiler");
  const core = required("@velarscript/core");
  const node = required("@velarscript/node");
  const web = required("@velarscript/web");
  const create = required("create-velar");
  const cli = required("@velarscript/cli");
  const desktop = required("@velarscript/desktop");
  for (const package_ of packages) {
    if (package_.version !== rootManifest.version) throw new Error(`${package_.name} version must exactly match ${rootManifest.version}`);
    if (package_.repository?.url !== rootManifest.repository?.url) throw new Error(`${package_.name} repository must match the workspace repository`);
  }
  if (cli.dependencies?.["@velarscript/compiler"] !== rootManifest.version) {
    throw new Error("@velarscript/cli must pin the exact compiler version");
  }
  if (cli.dependencies?.["@velarscript/core"] !== rootManifest.version) {
    throw new Error("@velarscript/cli must pin the exact Core Standard API version");
  }
  if (core.dependencies?.["@velarscript/compiler"] !== rootManifest.version) {
    throw new Error("@velarscript/core must pin the exact compiler version");
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
  for (const declaration of DECLARED_VERSIONS) {
    const failure = await declaredVersionFailure(root, declaration.file, declaration.name, required(declaration.package));
    if (failure) throw new Error(failure);
  }
  for (const pin of PINNED_DEPENDENCY_VERSIONS) {
    const failure = await pinnedDependencyFailure(root, pin.file, pin.name, pin.dependency, required(pin.package));
    if (failure) throw new Error(failure);
  }
  return { root: rootManifest, packages, compiler, core, node, web, create, cli, desktop };
}

function releaseBlockers(manifests, source) {
  const blockers = [];
  if (manifests.root.version.includes("-")) blockers.push(`version ${manifests.root.version} is not a stable release version`);
  if (!source.commit) blockers.push("source repository has no committed HEAD");
  if (!source.clean) blockers.push("source working tree is not clean");
  const expectedTag = `v${manifests.root.version}`;
  if (!sourceHasExpectedTag(source, expectedTag)) blockers.push(`HEAD is not exactly tagged ${expectedTag}`);
  if (!source.remoteMatches) blockers.push("origin does not match package repository metadata");
  for (const package_ of manifests.packages) {
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
    tags,
    clean: status === "",
    remote: origin,
    remoteMatches: Boolean(origin && repository && normalizeRepository(origin) === normalizeRepository(repository)),
    treeSha256: await sourceTreeHash(),
  };
}

export function sourceHasExpectedTag(source, expectedTag) {
  return Array.isArray(source?.tags)
    ? source.tags.includes(expectedTag)
    : source?.tag === expectedTag;
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
