#!/usr/bin/env node

import { spawn } from "node:child_process";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { verifyEcosystemRelease } from "./release-ecosystem.mjs";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const registry = "https://registry.npmjs.org";
const registryVisibilityAttempts = 100;
const registryPollIntervalMs = 3_000;

async function main(arguments_) {
  if (arguments_.length !== 2) throw new Error("Usage: publish-ecosystem.mjs <candidate-directory> <package-name>");
  const [directoryValue, name] = arguments_;
  const directory = resolve(root, directoryValue);
  const manifest = await verifyEcosystemRelease(directory, name);
  if (manifest.mode !== "candidate" || manifest.publish.publishable !== true) throw new Error("only a verified publishable candidate may be published");
  if (process.env.GITHUB_ACTIONS !== "true" || !process.env.ACTIONS_ID_TOKEN_REQUEST_URL || !process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN) {
    throw new Error("ecosystem publication requires a GitHub Actions OIDC runner");
  }
  if (process.env.VELAR_ECOSYSTEM_PUBLISH_CONFIRM !== name) throw new Error(`set VELAR_ECOSYSTEM_PUBLISH_CONFIRM exactly to ${name}`);
  const version = manifest.package.version;
  const existing = await publishedIntegrity(name, version);
  if (existing !== null && existing !== manifest.package.npmIntegrity) {
    throw new Error(`${name}@${version} already exists with different npm integrity`);
  }
  if (existing === null) {
    await runNpm([
      "publish", join(directory, manifest.package.fileName), "--access", "public",
      "--provenance", "--tag", "next", "--registry", registry,
    ]);
    await waitForIntegrity(name, version, manifest.package.npmIntegrity);
  }
  await runNpm(["dist-tag", "add", `${name}@${version}`, "latest", "--registry", registry]);
  await waitForVersion(name, "latest", version);
  process.stdout.write(`Published ${name}@${version} with verified integrity and promoted latest\n`);
}

async function publishedIntegrity(name, version) {
  const result = await runNpm(["view", `${name}@${version}`, "dist.integrity", "--json", "--registry", registry], true);
  if (result.code === 0) {
    const value = JSON.parse(result.stdout);
    if (typeof value !== "string" || !value.startsWith("sha512-")) throw new Error(`${name}@${version} returned invalid npm integrity metadata`);
    return value;
  }
  if (/E404|404 Not Found/u.test(`${result.stdout}\n${result.stderr}`)) return null;
  throw new Error(`registry preflight failed\n${result.stderr}`);
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

async function waitForVersion(name, tag, expected) {
  for (let attempt = 0; attempt < registryVisibilityAttempts; attempt += 1) {
    const result = await runNpm(["view", name, `dist-tags.${tag}`, "--json", "--registry", registry], true);
    const actual = result.code === 0 ? JSON.parse(result.stdout) : null;
    if (actual === expected) return;
    if (result.code !== 0 && !/E404|404 Not Found/u.test(`${result.stdout}\n${result.stderr}`)) {
      throw new Error(`registry dist-tag lookup failed\n${result.stderr}`);
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, registryPollIntervalMs));
  }
  throw new Error(`${name}@${tag} did not resolve to ${expected} on npm within 5 minutes`);
}

async function runNpm(arguments_, allowFailure = false) {
  const npm = process.env.npm_execpath;
  const command = npm ? process.execPath : (process.platform === "win32" ? "npm.cmd" : "npm");
  const argv = npm ? [npm, ...arguments_] : arguments_;
  const child = spawn(command, argv, { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => { stdout += chunk.toString("utf8"); });
  child.stderr.on("data", (chunk) => { stderr += chunk.toString("utf8"); });
  const code = await new Promise((resolveExit, rejectExit) => { child.once("error", rejectExit); child.once("exit", resolveExit); });
  if (code !== 0 && !allowFailure) throw new Error(`npm ${arguments_.join(" ")} failed (${code})\n${stdout}\n${stderr}`);
  return { code, stdout, stderr };
}

try { await main(process.argv.slice(2)); }
catch (error) { process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`); process.exitCode = 1; }
