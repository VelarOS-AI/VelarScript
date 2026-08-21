import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { lstat, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, parse, resolve } from "node:path";
import { CURRENT_PROJECT_FORMAT_VERSION, resolveVelarProject } from "./config.ts";
import { unsupportedProjectFormat } from "./project-format.ts";
import { hostErrorMessage, isHostErrorCode } from "./host-error.ts";
import {
  resolveExtensionPackages,
  resolveInstalledExtensionPackage,
  type ResolvedExtensionPackage,
} from "./extension-metadata.ts";

const MAX_PACKAGE_ARGUMENTS = 32;
const MAX_JSON_BYTES = 1024 * 1024;
const PACKAGE_NAME = /^(?:@[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*|[a-z0-9][a-z0-9._-]*)$/u;

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
  const declaredBefore = extensionNames(project.manifest);
  let extensionGraphBefore: readonly ResolvedExtensionPackage[] = [];
  let removedExtensions: readonly string[] = [];
  let stagedRemovalSource: string | null = null;
  if (action === "remove") {
    const graph = await resolveExtensionPackages(project.root, declaredBefore);
    extensionGraphBefore = graph;
    const removing = new Set(parsed.packageNames);
    for (const extension of graph) {
      if (removing.has(extension.name)) continue;
      const removedParent = Object.keys(extension.extends).find((parent) => removing.has(parent));
      if (removedParent) {
        throw new Error(`Cannot remove '${removedParent}'; installed extension '${extension.name}' requires its API ${extension.extends[removedParent]}`);
      }
    }
    await resolveVelarProject(project.root);
    removedExtensions = Object.freeze(declaredBefore.filter((name) => removing.has(name)));
    const removedMetadata = orphanedExtensionMetadata(extensionGraphBefore, declaredBefore, new Set(removedExtensions));
    const next = dependencyManifest(project.manifest, "remove", removedMetadata);
    if (JSON.stringify(next) !== JSON.stringify(project.manifest)) {
      let nextSource: string;
      try {
        nextSource = jsonSource(next);
        await replaceSourceIfCurrent(project.manifestPath, project.manifestSource, nextSource);
      } catch (error) {
        throw new Error(`Dependency was not removed because its project declaration changed before staging: ${hostErrorMessage(error)}`);
      }
      try {
        await resolveVelarProject(project.root);
      } catch (error) {
        try {
          await replaceSourceIfCurrent(project.manifestPath, nextSource, project.manifestSource);
        } catch (restoreError) {
          throw new Error(`Dependency was not removed because its staged project declaration is invalid: ${hostErrorMessage(error)}; the declaration changed again and was not overwritten: ${hostErrorMessage(restoreError)}`);
        }
        throw new Error(`Dependency was not removed because its staged project declaration is invalid: ${hostErrorMessage(error)}`);
      }
      stagedRemovalSource = nextSource;
    }
  }

  const npmArguments = npmArgumentsFor(action, parsed);
  try {
    await executeNpm(npmArguments, project.root);
  } catch (error) {
    if (stagedRemovalSource) {
      try {
        await replaceSourceIfCurrent(project.manifestPath, stagedRemovalSource, project.manifestSource);
      } catch (restoreError) {
        throw new Error(`Dependency removal failed: ${hostErrorMessage(error)}; the staged project declaration changed concurrently and was not overwritten: ${hostErrorMessage(restoreError)}`);
      }
    }
    throw error;
  }

  let addedMetadata: readonly VelarPackageMetadata[] = [];
  if (action === "add") {
    try {
      const installed = await Promise.all(parsed.packageNames.map((name) => resolveInstalledExtensionPackage(project.root, name)));
      addedMetadata = Object.freeze(installed
        .filter((item): item is ResolvedExtensionPackage => item !== null)
        .map((item) => ({ name: item.name, manifestKey: item.manifestKey })));
    } catch (error) {
      throw new Error(`Dependency was installed but its VelarScript metadata is invalid: ${hostErrorMessage(error)}`);
    }
  }
  const activatedExtensions = addedMetadata.map((item) => item.name).filter((name) => !declaredBefore.includes(name));
  if (action === "add") {
    const next = dependencyManifest(project.manifest, "add", addedMetadata);
    if (JSON.stringify(next) !== JSON.stringify(project.manifest)) {
      let nextSource: string;
      try {
        nextSource = jsonSource(next);
        await replaceSourceIfCurrent(project.manifestPath, project.manifestSource, nextSource);
      } catch (error) {
        throw new Error(`Dependency was installed but its project declaration changed while npm was running and was not overwritten: ${hostErrorMessage(error)}`);
      }
      try {
        await resolveVelarProject(project.root);
      } catch (error) {
        try {
          await replaceSourceIfCurrent(project.manifestPath, nextSource, project.manifestSource);
        } catch (restoreError) {
          throw new Error(`Dependency was installed but could not be activated: ${hostErrorMessage(error)}; the project declaration changed again and was not overwritten: ${hostErrorMessage(restoreError)}`);
        }
        throw new Error(`Dependency was installed but could not be activated: ${hostErrorMessage(error)}`);
      }
    } else {
      await resolveVelarProject(project.root);
    }
  } else if (action === "remove") {
    try {
      await resolveVelarProject(project.root);
    } catch (error) {
      throw new Error(`Dependency was removed and its project declaration was updated, but the remaining installed extension graph is invalid: ${hostErrorMessage(error)}`);
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

function orphanedExtensionMetadata(
  graph: readonly ResolvedExtensionPackage[],
  directBefore: readonly string[],
  removedDirect: ReadonlySet<string>,
): readonly VelarPackageMetadata[] {
  const byName = new Map(graph.map((item) => [item.name, item]));
  const retained = new Set<string>();
  const retain = (name: string): void => {
    if (retained.has(name)) return;
    const package_ = byName.get(name);
    if (!package_) return;
    retained.add(name);
    for (const parent of Object.keys(package_.extends)) retain(parent);
  };
  for (const name of directBefore) if (!removedDirect.has(name)) retain(name);
  return Object.freeze(graph
    .filter((item) => !retained.has(item.name))
    .map((item) => ({ name: item.name, manifestKey: item.manifestKey })));
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
      const { source: manifestSource, value: manifest } = await readJsonObject(manifestPath, "VelarScript project manifest");
      if (manifest.formatVersion !== CURRENT_PROJECT_FORMAT_VERSION) {
        throw new Error(typeof manifest.formatVersion === "number"
          ? `${manifestPath}: ${unsupportedProjectFormat(manifest.formatVersion)}`
          : `${manifestPath}: package commands require formatVersion ${CURRENT_PROJECT_FORMAT_VERSION}`);
      }
      extensionNames(manifest);
      return { root: current, manifestPath, packagePath, manifestSource, manifest };
    }
    const parent = dirname(current);
    if (parent === current || current === parse(current).root) break;
    current = parent;
  }
  throw new Error("velar.json was not found; run package commands inside a VelarScript project");
}

async function validatePackageManager(packagePath: string): Promise<void> {
  const { value } = await readJsonObject(packagePath, "package manifest");
  const packageManager = value.packageManager;
  if (packageManager !== undefined && (typeof packageManager !== "string" || !/^npm@[0-9]+(?:\.[0-9]+){0,2}(?:[-+][0-9A-Za-z.-]+)?$/u.test(packageManager))) {
    throw new Error(`${packagePath}: VelarScript package commands use npm, but packageManager is '${String(packageManager)}'`);
  }
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
  catch (error) { throw new Error(`${path}: cannot parse ${label}: ${hostErrorMessage(error)}`); }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${path}: ${label} must be a JSON object`);
  return { source, value: value as Record<string, unknown> };
}

async function ordinaryFile(path: string): Promise<boolean> {
  try {
    const information = await lstat(path);
    if (!information.isFile() || information.isSymbolicLink()) {
      throw new Error(`${path} must be an ordinary file`);
    }
    return true;
  } catch (error) {
    if (isHostErrorCode(error, "ENOENT") || isHostErrorCode(error, "ENOTDIR")) return false;
    throw error;
  }
}

function jsonSource(value: unknown): string {
  const source = `${JSON.stringify(value, null, 2)}\n`;
  if (Buffer.byteLength(source, "utf8") > MAX_JSON_BYTES) {
    throw new RangeError("serialized project declaration exceeds 1 MiB");
  }
  return source;
}

async function replaceSourceIfCurrent(path: string, expected: string, source: string): Promise<void> {
  const information = await stat(path);
  if (!information.isFile() || information.size > MAX_JSON_BYTES) {
    throw new Error(`${path} is no longer the bounded project manifest that this command read`);
  }
  const current = await readFile(path, "utf8");
  if (Buffer.byteLength(current, "utf8") > MAX_JSON_BYTES || current !== expected) {
    throw new Error(`${path} changed while the dependency command was running`);
  }
  await writeSourceAtomically(path, source);
}

async function writeSourceAtomically(path: string, source: string): Promise<void> {
  if (Buffer.byteLength(source, "utf8") > MAX_JSON_BYTES) {
    throw new RangeError(`${path}: project declaration exceeds 1 MiB`);
  }
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
