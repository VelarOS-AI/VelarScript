import { spawn } from "node:child_process";
import {
  cp,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  symlink,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const sourceRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const directoryLinkType = process.platform === "win32" ? "junction" : "dir";
const copiedRootEntries = [
  "LICENSE",
  "README.md",
  "package-lock.json",
  "package.json",
  "packages",
  "libraries",
  "scripts",
  "tsconfig.base.json",
  "tsconfig.json",
];

export async function createIsolatedToolchainBuild() {
  const temporaryRoot = await mkdtemp(join(tmpdir(), "velar-toolchain-build-"));
  const workspaceRoot = join(temporaryRoot, "workspace");
  try {
    await mkdir(workspaceRoot);
    for (const entry of copiedRootEntries) {
      const source = join(sourceRoot, entry);
      if (!await exists(source)) continue;
      await cp(source, join(workspaceRoot, entry), {
        recursive: true,
        filter: (path) => basename(path) !== "dist",
      });
    }
    await linkDependencies(workspaceRoot);
    await runNpm(["run", "build:packages", "--silent"], workspaceRoot);
    return {
      root: workspaceRoot,
      async dispose() {
        await rm(temporaryRoot, { recursive: true, force: true });
      },
    };
  } catch (error) {
    await rm(temporaryRoot, { recursive: true, force: true });
    throw error;
  }
}

async function linkDependencies(workspaceRoot) {
  const sourceModules = join(sourceRoot, "node_modules");
  const targetModules = join(workspaceRoot, "node_modules");
  await mkdir(targetModules);
  for (const entry of await readdir(sourceModules, { withFileTypes: true })) {
    if (entry.name === ".bin" || entry.name === ".package-lock.json" || entry.name === "@velarscript" || entry.name === "create-velar") continue;
    await symlink(join(sourceModules, entry.name), join(targetModules, entry.name), entry.isDirectory() ? directoryLinkType : "file");
  }
  await symlink(join(sourceModules, ".bin"), join(targetModules, ".bin"), directoryLinkType);

  for (const workspaceDirectory of ["packages", "libraries"]) {
    for (const entry of await readdir(join(workspaceRoot, workspaceDirectory), { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const packageRoot = join(workspaceRoot, workspaceDirectory, entry.name);
      let manifest;
      try {
        manifest = JSON.parse(await readFile(join(packageRoot, "package.json"), "utf8"));
      } catch {
        continue;
      }
      if (typeof manifest.name !== "string" || !manifest.name) continue;
      const parts = manifest.name.split("/");
      const link = parts.length === 2
        ? join(targetModules, parts[0], parts[1])
        : join(targetModules, manifest.name);
      await mkdir(dirname(link), { recursive: true });
      await symlink(packageRoot, link, directoryLinkType);
    }
  }
}

async function exists(path) {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if (error && typeof error === "object" && error.code === "ENOENT") return false;
    throw error;
  }
}

async function runNpm(arguments_, cwd) {
  const npm = process.env.npm_execpath;
  const command = npm ? process.execPath : process.platform === "win32" ? "npm.cmd" : "npm";
  const commandArguments = npm ? [npm, ...arguments_] : arguments_;
  const child = spawn(command, commandArguments, { cwd, stdio: ["ignore", "pipe", "pipe"] });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => { stdout += chunk.toString("utf8"); });
  child.stderr.on("data", (chunk) => { stderr += chunk.toString("utf8"); });
  const code = await new Promise((resolvePromise, reject) => {
    child.once("error", reject);
    child.once("exit", resolvePromise);
  });
  if (code !== 0) throw new Error(`isolated toolchain build failed (${code})\n${stdout}\n${stderr}`);
}
