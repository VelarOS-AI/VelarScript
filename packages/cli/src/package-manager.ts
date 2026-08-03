import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { lstat, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, parse, resolve } from "node:path";
import { CURRENT_PROJECT_FORMAT_VERSION, resolveVelarProject } from "./config.ts";

const MAX_PACKAGE_ARGUMENTS = 32;
const MAX_JSON_BYTES = 1024 * 1024;
const PACKAGE_NAME = /^(?:@[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*|[a-z0-9][a-z0-9._-]*)$/u;
const MANIFEST_KEY = /^[a-z][a-z0-9-]*$/u;

export type DependencyAction = "install" | "add" | "remove" | "update";

export interface DependencyCommandArguments {
  readonly packages: readonly string[];
  readonly packageNames: readonly string[];
  readonly dev: boolean;
}

export interface DependencyCommandResult {
  readonly action: DependencyAction;
  readonly root: string;
  readonly packages: readonly string[];
  readonly activatedExtensions: readonly string[];
  readonly removedExtensions: readonly string[];
}

export type NpmExecutor = (arguments_: readonly string[], cwd: string) => Promise<void>;

interface VelarPackageMetadata {
  readonly name: string;
  readonly manifestKey: string | null;
}

interface PackageProject {
  readonly root: string;
  readonly manifestPath: string;
  readonly packagePath: string;
  readonly manifestSource: string;
  readonly manifest: Record<string, unknown>;
}

export function parseDependencyArguments(
  action: DependencyAction,
  arguments_: readonly string[],
): DependencyCommandArguments | string {
  if (action === "install") {
    return arguments_.length === 0
      ? { packages: [], packageNames: [], dev: false }
      : "install does not accept package names or options";
  }

  let dev = false;
  const packages: string[] = [];
  const packageNames: string[] = [];
  for (const argument of arguments_) {
    if (argument === "--dev") {
      if (action !== "add") return "--dev is available only for 'velar add'";
      if (dev) return "--dev may be provided only once";
      dev = true;
      continue;
    }
    if (argument.startsWith("-")) return `unknown option '${argument}'`;
    const parsed = action === "add" ? registryPackageSpecifier(argument) : barePackageName(argument);
    if (typeof parsed === "string") return parsed;
    packages.push(argument);
    packageNames.push(parsed.name);
  }
  if (packages.length > MAX_PACKAGE_ARGUMENTS) return `a single command cannot change more than ${MAX_PACKAGE_ARGUMENTS} packages`;
  if ((action === "add" || action === "remove") && packages.length === 0) return `${action} requires at least one package name`;
  if (new Set(packageNames).size !== packageNames.length) return "package names cannot be repeated in one command";
  return { packages: Object.freeze(packages), packageNames: Object.freeze(packageNames), dev };
}

export async function runDependencyCommand(
  action: DependencyAction,
  parsed: DependencyCommandArguments,
  options: { readonly cwd?: string; readonly executeNpm?: NpmExecutor } = {},
): Promise<DependencyCommandResult> {
  const project = await locatePackageProject(options.cwd ?? process.cwd());
  await validatePackageManager(project.packagePath);
  const executeNpm = options.executeNpm ?? executeNpmCommand;
  const metadata = action === "remove"
    ? await extensionMetadata(project.root, parsed.packageNames)
    : [];
  if (action === "remove") {
    const declared = extensionNames(project.manifest);
    const described = new Set(metadata.map((item) => item.name));
    const unavailable = parsed.packageNames.filter((name) => declared.includes(name) && !described.has(name));
    if (unavailable.length > 0) {
      throw new Error(`Cannot remove declared extension metadata for ${unavailable.join(", ")}; reinstall the package before removing it`);
    }
  }

  const npmArguments = npmArgumentsFor(action, parsed);
  await executeNpm(npmArguments, project.root);

  let addedMetadata: readonly VelarPackageMetadata[] = [];
  if (action === "add") {
    try {
      addedMetadata = await extensionMetadata(project.root, parsed.packageNames);
    } catch (error) {
      throw new Error(`Dependency was installed but its Velar metadata is invalid: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  const declaredBefore = extensionNames(project.manifest);
  const activatedExtensions = addedMetadata.map((item) => item.name).filter((name) => !declaredBefore.includes(name));
  const removedExtensions = action === "remove"
    ? metadata.map((item) => item.name).filter((name) => declaredBefore.includes(name))
    : [];
  if (action === "add" || action === "remove") {
    const next = dependencyManifest(project.manifest, action, action === "add"
      ? addedMetadata
      : metadata);
    if (JSON.stringify(next) !== JSON.stringify(project.manifest)) {
      await writeJsonAtomically(project.manifestPath, next);
      try {
        await resolveVelarProject(project.root);
      } catch (error) {
        await writeSourceAtomically(project.manifestPath, project.manifestSource);
        const verb = action === "add" ? "installed but could not be activated" : "removed but its project declaration could not be updated";
        throw new Error(`Dependency was ${verb}: ${error instanceof Error ? error.message : String(error)}`);
      }
    } else {
      await resolveVelarProject(project.root);
    }
  } else {
    await resolveVelarProject(project.root);
  }

  return {
    action,
    root: project.root,
    packages: parsed.packageNames,
    activatedExtensions: Object.freeze(activatedExtensions),
    removedExtensions: Object.freeze(removedExtensions),
  };
}

function npmArgumentsFor(action: DependencyAction, parsed: DependencyCommandArguments): readonly string[] {
  if (action === "install") return ["install"];
  if (action === "add") return ["install", parsed.dev ? "--save-dev" : "--save", "--", ...parsed.packages];
  if (action === "remove") return ["uninstall", "--", ...parsed.packageNames];
  return ["update", ...(parsed.packageNames.length > 0 ? ["--", ...parsed.packageNames] : [])];
}

async function executeNpmCommand(arguments_: readonly string[], cwd: string): Promise<void> {
  const npmEntry = process.env.npm_execpath;
  const executable = npmEntry ? process.execPath : process.platform === "win32" ? "npm.cmd" : "npm";
  const childArguments = npmEntry ? [npmEntry, ...arguments_] : arguments_;
  await new Promise<void>((resolvePromise, reject) => {
    const child = spawn(executable, childArguments, { cwd, shell: false, stdio: "inherit" });
    child.once("error", (error) => reject(new Error(`Cannot start npm: ${error.message}`)));
    child.once("exit", (code, signal) => {
      if (code === 0) resolvePromise();
      else reject(new Error(signal ? `npm stopped by signal ${signal}` : `npm exited with status ${String(code)}`));
    });
  });
}

async function locatePackageProject(cwd: string): Promise<PackageProject> {
  let current = resolve(cwd);
  while (true) {
    const manifestPath = join(current, "velar.json");
    if (await ordinaryFile(manifestPath)) {
      const packagePath = join(current, "package.json");
      if (!await ordinaryFile(packagePath)) throw new Error(`${current} contains velar.json but no ordinary package.json`);
      const { source: manifestSource, value: manifest } = await readJsonObject(manifestPath, "Velar project manifest");
      if (manifest.formatVersion !== CURRENT_PROJECT_FORMAT_VERSION) {
        throw new Error(`${manifestPath}: package commands require formatVersion ${CURRENT_PROJECT_FORMAT_VERSION}`);
      }
      extensionNames(manifest);
      return { root: current, manifestPath, packagePath, manifestSource, manifest };
    }
    const parent = dirname(current);
    if (parent === current || current === parse(current).root) break;
    current = parent;
  }
  throw new Error("velar.json was not found; run package commands inside a Velar project");
}

async function validatePackageManager(packagePath: string): Promise<void> {
  const { value } = await readJsonObject(packagePath, "package manifest");
  const packageManager = value.packageManager;
  if (packageManager !== undefined && (typeof packageManager !== "string" || !/^npm@[0-9]+(?:\.[0-9]+){0,2}(?:[-+][0-9A-Za-z.-]+)?$/u.test(packageManager))) {
    throw new Error(`${packagePath}: Velar package commands use npm, but packageManager is '${String(packageManager)}'`);
  }
}

async function extensionMetadata(root: string, names: readonly string[]): Promise<readonly VelarPackageMetadata[]> {
  const output: VelarPackageMetadata[] = [];
  for (const name of names) {
    const path = await installedPackageManifest(root, name);
    if (!path) continue;
    const { value } = await readJsonObject(path, `installed package '${name}'`);
    if (value.name !== name) throw new Error(`${path}: installed package identity does not match '${name}'`);
    const velar = value.velar;
    if (velar === undefined) continue;
    if (!velar || typeof velar !== "object" || Array.isArray(velar)) {
      throw new Error(`${path}: 'velar' must be an object`);
    }
    const extension = (velar as Record<string, unknown>).extension;
    if (extension === undefined) continue;
    if (!extension || typeof extension !== "object" || Array.isArray(extension)) {
      throw new Error(`${path}: 'velar.extension' must be an object`);
    }
    const fields = Object.keys(extension as Record<string, unknown>);
    if (fields.some((field) => field !== "manifestKey")) throw new Error(`${path}: 'velar.extension' contains an unknown field`);
    const manifestKey = (extension as Record<string, unknown>).manifestKey;
    if (manifestKey !== undefined && (typeof manifestKey !== "string" || !MANIFEST_KEY.test(manifestKey))) {
      throw new Error(`${path}: 'velar.extension.manifestKey' must be a lowercase project field name`);
    }
    output.push({ name, manifestKey: (manifestKey as string | undefined) ?? null });
  }
  return Object.freeze(output);
}

async function installedPackageManifest(root: string, name: string): Promise<string | null> {
  const require = createRequire(join(root, "package.json"));
  for (const directory of require.resolve.paths(name) ?? []) {
    const path = join(directory, ...name.split("/"), "package.json");
    if (await ordinaryFile(path)) return path;
  }
  return null;
}

function dependencyManifest(
  manifest: Readonly<Record<string, unknown>>,
  action: "add" | "remove",
  metadata: readonly VelarPackageMetadata[],
): Record<string, unknown> {
  const next = structuredClone(manifest) as Record<string, unknown>;
  const extensions = [...extensionNames(next)];
  if (action === "add") {
    for (const item of metadata) if (!extensions.includes(item.name)) extensions.push(item.name);
  } else {
    const removed = new Set(metadata.map((item) => item.name));
    extensions.splice(0, extensions.length, ...extensions.filter((name) => !removed.has(name)));
    for (const item of metadata) if (item.manifestKey) delete next[item.manifestKey];
  }
  next.extensions = extensions;
  return next;
}

function extensionNames(manifest: Readonly<Record<string, unknown>>): readonly string[] {
  if (!Array.isArray(manifest.extensions) || manifest.extensions.some((item) => typeof item !== "string" || !PACKAGE_NAME.test(item))) {
    throw new Error("velar.json: 'extensions' must be a list of npm package names");
  }
  if (new Set(manifest.extensions).size !== manifest.extensions.length) throw new Error("velar.json: compiler extensions cannot be repeated");
  return manifest.extensions as readonly string[];
}

function registryPackageSpecifier(value: string): { readonly name: string } | string {
  if (!value || value.length > 512 || /[\s\0]/u.test(value)) return `'${value}' is not a supported npm registry package specifier`;
  const scoped = /^(@[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*)(?:@(.+))?$/u.exec(value);
  const unscoped = /^([a-z0-9][a-z0-9._-]*)(?:@(.+))?$/u.exec(value);
  const match = scoped ?? unscoped;
  if (!match || !PACKAGE_NAME.test(match[1]!)) return `'${value}' is not a supported npm registry package specifier`;
  return { name: match[1]! };
}

function barePackageName(value: string): { readonly name: string } | string {
  return PACKAGE_NAME.test(value) ? { name: value } : `'${value}' must be a bare npm package name`;
}

async function readJsonObject(path: string, label: string): Promise<{ readonly source: string; readonly value: Record<string, unknown> }> {
  const information = await stat(path);
  if (information.size > MAX_JSON_BYTES) throw new RangeError(`${path}: ${label} exceeds 1 MiB`);
  const source = await readFile(path, "utf8");
  if (Buffer.byteLength(source, "utf8") > MAX_JSON_BYTES) throw new RangeError(`${path}: ${label} exceeds 1 MiB`);
  let value: unknown;
  try { value = JSON.parse(source); }
  catch (error) { throw new Error(`${path}: cannot parse ${label}: ${error instanceof Error ? error.message : String(error)}`); }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${path}: ${label} must be a JSON object`);
  return { source, value: value as Record<string, unknown> };
}

async function ordinaryFile(path: string): Promise<boolean> {
  try {
    const information = await lstat(path);
    return information.isFile() && !information.isSymbolicLink();
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return false;
    throw error;
  }
}

async function writeJsonAtomically(path: string, value: unknown): Promise<void> {
  await writeSourceAtomically(path, `${JSON.stringify(value, null, 2)}\n`);
}

async function writeSourceAtomically(path: string, source: string): Promise<void> {
  const information = await stat(path);
  const temporary = join(dirname(path), `.velar-${randomUUID()}.json`);
  try {
    await writeFile(temporary, source, { encoding: "utf8", flag: "wx", mode: information.mode });
    await rename(temporary, path);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
}
