#!/usr/bin/env node

import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { verifyToolchainRelease } from "./release-toolchain.mjs";
import { velarPublishedToolchainPackages } from "./velar-packages.mjs";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const registry = "https://registry.npmjs.org";
const registryVisibilityAttempts = 100;
const registryPollIntervalMs = 3_000;

async function main(arguments_) {
  if (process.env.GITHUB_ACTIONS !== "true" || !process.env.ACTIONS_ID_TOKEN_REQUEST_URL) {
    throw new Error("toolchain publication is restricted to an OIDC-capable GitHub Actions runner");
  }
  const options = parseArguments(arguments_);
  const directory = resolve(root, options.directory);
  const manifest = await verifyToolchainRelease(directory);
  if (manifest.mode !== "candidate" || manifest.publish?.publishable !== true
    || manifest.publish?.provenanceRequired !== true || manifest.publish?.registry !== registry) {
    throw new Error("publication requires a verified, provenance-required strict candidate");
  }

  const candidates = new Map(manifest.packages.map((package_) => [package_.name, package_]));
  const order = await publicationOrder();
  if (order.length !== candidates.size || order.some((package_) => !candidates.has(package_.name))) {
    throw new Error("strict candidate and workspace publication rosters do not match");
  }

  for (const package_ of order) {
    const candidate = candidates.get(package_.name);
    const existing = await publishedIntegrity(package_.name, manifest.version);
    if (existing !== null) {
      if (existing !== candidate.npmIntegrity) {
        throw new Error(`${package_.name}@${manifest.version} already exists with different npm integrity`);
      }
      process.stdout.write(`Already published ${package_.name}@${manifest.version}; verified identical integrity\n`);
      continue;
    }
    await runNpm([
      "publish",
      resolve(directory, candidate.fileName),
      "--access", "public",
      "--tag", options.stagingTag,
      "--provenance",
      "--registry", registry,
    ], false, publicationToken(package_.name));
    await waitForIntegrity(package_.name, manifest.version, candidate.npmIntegrity);
    process.stdout.write(`Published ${package_.name}@${manifest.version} with npm provenance\n`);
  }

  // Default installation is exposed only after every exact version and
  // integrity has reached the registry. A failed partial run can therefore be
  // resumed safely without pointing users at an incomplete toolchain graph.
  for (const package_ of order) {
    await runNpm([
      "dist-tag", "add", `${package_.name}@${manifest.version}`,
      options.promoteTag,
      "--registry", registry,
    ], false, publicationToken(package_.name));
  }
  for (const package_ of order) {
    await waitForVersion(`${package_.name}@${options.promoteTag}`, manifest.version);
  }
  process.stdout.write(`Promoted complete VelarScript ${manifest.version} toolchain to ${options.promoteTag}\n`);
}

function parseArguments(arguments_) {
  let directory = "release/toolchain";
  let stagingTag = "next";
  let promoteTag = "latest";
  for (let index = 0; index < arguments_.length; index += 1) {
    const option = arguments_[index];
    const value = arguments_[index + 1];
    if (option === "--directory" && value) directory = value;
    else if (option === "--staging-tag" && value) stagingTag = value;
    else if (option === "--promote-tag" && value) promoteTag = value;
    else throw new Error(`unknown or incomplete publication option '${option ?? ""}'`);
    index += 1;
  }
  for (const [label, value] of [["staging", stagingTag], ["promotion", promoteTag]]) {
    if (!/^[a-z][a-z0-9._-]*$/u.test(value) || value === "latest" && label === "staging") {
      throw new Error(`${label} tag '${value}' is not a safe npm dist-tag`);
    }
  }
  return { directory, stagingTag, promoteTag };
}

async function publicationOrder() {
  const packages = await velarPublishedToolchainPackages(root);
  const byName = new Map(packages.map((package_) => [package_.name, package_]));
  const placed = new Set();
  const visiting = new Set();
  const order = [];
  const visit = (package_) => {
    if (placed.has(package_.name)) return;
    if (visiting.has(package_.name)) throw new Error(`workspace dependency cycle through ${package_.name}`);
    visiting.add(package_.name);
    for (const dependency of Object.keys(package_.manifest.dependencies ?? {}).sort()) {
      const workspace = byName.get(dependency);
      if (workspace) visit(workspace);
    }
    visiting.delete(package_.name);
    placed.add(package_.name);
    order.push(package_);
  };
  for (const package_ of packages) visit(package_);
  return order;
}

async function publishedIntegrity(name, version) {
  const result = await runNpm([
    "view", `${name}@${version}`, "dist.integrity", "--json", "--registry", registry,
  ], true);
  if (result.code === 0) {
    const value = JSON.parse(result.stdout);
    if (typeof value !== "string" || !value.startsWith("sha512-")) {
      throw new Error(`${name}@${version} returned invalid npm integrity metadata`);
    }
    return value;
  }
  if (/\bE404\b|404 Not Found/u.test(`${result.stdout}\n${result.stderr}`)) return null;
  throw new Error(`npm registry lookup failed for ${name}@${version}\n${result.stderr}`);
}

async function waitForIntegrity(name, version, expected) {
  for (let attempt = 0; attempt < registryVisibilityAttempts; attempt += 1) {
    const actual = await publishedIntegrity(name, version);
    if (actual === expected) return;
    if (actual !== null) throw new Error(`${name}@${version} reached npm with different integrity`);
    await new Promise((resolvePromise) => setTimeout(resolvePromise, registryPollIntervalMs));
  }
  throw new Error(`${name}@${version} did not become visible on npm within 5 minutes`);
}

async function waitForVersion(specifier, expected) {
  for (let attempt = 0; attempt < registryVisibilityAttempts; attempt += 1) {
    const actual = await view(specifier, "version");
    if (actual === expected) return;
    await new Promise((resolvePromise) => setTimeout(resolvePromise, registryPollIntervalMs));
  }
  throw new Error(`${specifier} did not resolve to ${expected} on npm within 5 minutes`);
}

async function view(specifier, field) {
  const result = await runNpm(["view", specifier, field, "--json", "--registry", registry]);
  const value = JSON.parse(result.stdout);
  return typeof value === "string" ? value : null;
}

function publicationToken(name) {
  return name.startsWith("@")
    ? process.env.NODE_AUTH_TOKEN
    : process.env.NPM_UNSCOPED_TOKEN ?? process.env.NODE_AUTH_TOKEN;
}

async function runNpm(arguments_, allowFailure = false, authenticationToken = undefined) {
  const npm = process.env.npm_execpath;
  const command = npm ? process.execPath : "npm";
  const values = npm ? [npm, ...arguments_] : arguments_;
  const environment = authenticationToken === undefined
    ? process.env
    : { ...process.env, NODE_AUTH_TOKEN: authenticationToken };
  const child = spawn(command, values, { cwd: root, env: environment, stdio: ["ignore", "pipe", "pipe"] });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => { stdout += chunk.toString("utf8"); });
  child.stderr.on("data", (chunk) => { stderr += chunk.toString("utf8"); });
  const code = await new Promise((resolvePromise, reject) => {
    child.once("error", reject);
    child.once("exit", resolvePromise);
  });
  if (code !== 0 && !allowFailure) {
    throw new Error(`npm ${arguments_.join(" ")} failed (${code})\n${stdout}\n${stderr}`);
  }
  return { code, stdout, stderr };
}

try {
  await main(process.argv.slice(2));
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
