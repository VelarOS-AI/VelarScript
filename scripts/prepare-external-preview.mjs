#!/usr/bin/env node

import { spawn } from "node:child_process";
import {
  mkdir,
  lstat,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
} from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { verifyProductionBuild } from "../packages/cli/src/production-verifier.ts";
import { projectNetlifyDeployment } from "../integrations/netlify/src/index.ts";
import { createIsolatedToolchainBuild } from "./isolated-toolchain-build.mjs";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const sourceProject = join(root, "examples", "app");
const previewManifest = join(sourceProject, "velar.preview.json");
const defaultOutput = join(root, "release", "external-preview", "netlify");

export async function prepareExternalPreview(outputDirectory = defaultOutput) {
  const output = resolve(outputDirectory);
  await assertReplaceableOutput(output);
  const parent = dirname(output);
  let toolchain;
  let staging;
  try {
    toolchain = await createIsolatedToolchainBuild();
    await mkdir(parent, { recursive: true });
    staging = await mkdtemp(join(parent, `.velar-${basename(output)}-`));
    const built = join(staging, "neutral");
    await runCompiler(toolchain.root, ["build", previewManifest, "--out-dir", built]);
    const verified = await verifyProductionBuild(built);
    if (verified.deployment.base !== "/") throw new Error("external preview preparation did not create a root-base contract");
    if (verified.manifest.sourceMaps || verified.manifest.assets.some((asset) => asset.role === "source-map")) {
      throw new Error("external preview preparation must not publish source maps");
    }
    const projected = await projectNetlifyDeployment(built, join(staging, "projected"));
    await verifyProductionBuild(projected.siteDirectory);
    await assertReplaceableOutput(output);
    await rm(output, { recursive: true, force: true });
    await rename(projected.outputDirectory, output);
    return { outputDirectory: join(output, "site"), bundleDirectory: output, manifest: verified.manifest };
  } finally {
    if (staging) await rm(staging, { recursive: true, force: true });
    await toolchain?.dispose();
  }
}

async function assertReplaceableOutput(output) {
  const rootWithinOutput = relative(output, root);
  if (dirname(output) === output || rootWithinOutput === ""
    || (!rootWithinOutput.startsWith("..") && !isAbsolute(rootWithinOutput))) {
    throw new Error(`refusing unsafe external preview output '${output}'`);
  }
  try {
    const information = await lstat(output);
    if (information.isSymbolicLink() || !information.isDirectory()) {
      throw new Error(`external preview output '${output}' exists and is not a real directory`);
    }
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return;
    throw error;
  }
  const entries = await readdir(output, { withFileTypes: true });
  if (entries.some((entry) => entry.isSymbolicLink())
    || JSON.stringify(entries.map((entry) => entry.name).sort()) !== JSON.stringify(["netlify.toml", "site"])) {
    throw new Error(`refusing to replace '${output}' because it is not an exact VelarScript Netlify preview bundle`);
  }
  const configurationPath = join(output, "netlify.toml");
  const configurationStatus = await lstat(configurationPath);
  if (!configurationStatus.isFile() || configurationStatus.isSymbolicLink() || configurationStatus.size > 1024 * 1024
    || !(await readFile(configurationPath, "utf8")).startsWith('[build]\npublish = "site"\n')) {
    throw new Error(`refusing to replace '${output}' because its Netlify configuration is invalid`);
  }
  try {
    await verifyProductionBuild(join(output, "site"));
  } catch {
    throw new Error(`refusing to replace '${output}' because it is not an existing VelarScript Web build`);
  }
}

async function runCompiler(toolchainRoot, arguments_) {
  const cli = join(toolchainRoot, "packages", "cli", "dist", "cli.js");
  await run(process.execPath, [cli, ...arguments_], "external preview build", toolchainRoot);
}

async function run(command, arguments_, label, cwd = root) {
  const child = spawn(command, arguments_, { cwd, stdio: ["ignore", "pipe", "pipe"] });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => { stdout += chunk.toString("utf8"); });
  child.stderr.on("data", (chunk) => { stderr += chunk.toString("utf8"); });
  const code = await new Promise((resolvePromise, reject) => {
    child.once("error", reject);
    child.once("exit", resolvePromise);
  });
  if (code !== 0) throw new Error(`${label} failed (${code})\n${stdout}\n${stderr}`);
}

function parseArguments(arguments_) {
  if (arguments_.length === 0) return defaultOutput;
  if (arguments_.length === 2 && arguments_[0] === "--output-dir" && arguments_[1]) {
    return resolve(root, arguments_[1]);
  }
  throw new Error("Usage: prepare-external-preview.mjs [--output-dir <directory>]");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = await prepareExternalPreview(parseArguments(process.argv.slice(2)));
    process.stdout.write(`Prepared verified VelarScript Netlify preview ${result.manifest.buildId} -> ${result.bundleDirectory}\n`);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
