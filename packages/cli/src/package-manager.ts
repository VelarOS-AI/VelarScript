import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { link, lstat, mkdtemp, rename, rm, unlink, writeFile } from "node:fs/promises";
import { dirname, join, parse, resolve } from "node:path";
import { CURRENT_PROJECT_FORMAT_VERSION, resolveVelarProject } from "./config.ts";
import { unsupportedProjectFormat } from "./project-format.ts";
import { hostErrorMessage, isHostErrorCode } from "./host-error.ts";
import {
  readOrdinaryFileSnapshot,
  type OrdinaryFileSnapshotIdentity,
} from "./ordinary-file-snapshot.ts";
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
  readonly manifestIdentity: OrdinaryFileSnapshotIdentity;
  readonly manifest: Record<string, unknown>;
}

interface ProjectManifestVersion {
  readonly source: string;
  readonly identity: OrdinaryFileSnapshotIdentity;
}

interface DependencyRemovalPreparation {
  readonly removedExtensions: readonly string[];
  readonly stagedManifest: ProjectManifestVersion | null;
}

export interface PackageManifestReplacementOperations {
  /** Test seam immediately before the current pathname is moved into the transaction directory. */
  readonly beforeCurrentMove?: (path: string) => Promise<void>;
  /** Test seam after the validated current file is moved and before the exclusive install. */
  readonly afterCurrentMove?: (path: string) => Promise<void>;
  /** Test seam for proving that a failed best-effort cleanup cannot alias the live declaration. */
  readonly beforeTransactionCleanup?: (transaction: string) => Promise<void>;
}

interface MovedManifestRestore {
  readonly restored: boolean;
  readonly evidencePath: string;
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
  options: {
    readonly cwd?: string;
    readonly executeNpm?: NpmExecutor;
    readonly manifestReplacement?: PackageManifestReplacementOperations;
  } = {},
): Promise<DependencyCommandResult> {
  const project = await locatePackageProject(options.cwd ?? process.cwd());
  await validatePackageManager(project.packagePath);
  const executeNpm = options.executeNpm ?? executeNpmCommand;
  const replacementOperations = options.manifestReplacement ?? {};
  const declaredBefore = extensionNames(project.manifest);
  const removal = action === "remove"
    ? await prepareDependencyRemoval(project, declaredBefore, parsed.packageNames, replacementOperations)
    : { removedExtensions: [], stagedManifest: null };

  const npmArguments = npmArgumentsFor(action, parsed);
  try {
    await executeNpm(npmArguments, project.root);
  } catch (error) {
    if (removal.stagedManifest) {
      try {
        await restoreProjectManifest(project, removal.stagedManifest, replacementOperations);
      } catch (restoreError) {
        throw new Error(`Dependency removal failed: ${hostErrorMessage(error)}; the staged project declaration changed concurrently and was not overwritten: ${hostErrorMessage(restoreError)}`);
      }
    }
    throw error;
  }

  const addedMetadata = action === "add" ? await installedExtensionMetadata(project, parsed.packageNames) : [];
  const activatedExtensions = addedMetadata.map((item) => item.name).filter((name) => !declaredBefore.includes(name));
  if (action === "add") {
    await activateAddedExtensions(project, addedMetadata, replacementOperations);
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
    removedExtensions: removal.removedExtensions,
  };
}

async function prepareDependencyRemoval(
  project: PackageProject,
  declaredBefore: readonly string[],
  packageNames: readonly string[],
  operations: PackageManifestReplacementOperations = {},
): Promise<DependencyRemovalPreparation> {
  const graph = await resolveExtensionPackages(project.root, declaredBefore);
  const removing = new Set(packageNames);
  for (const extension of graph) {
    if (removing.has(extension.name)) continue;
    const removedParent = Object.keys(extension.extends).find((parent) => removing.has(parent));
    if (removedParent) {
      throw new Error(`Cannot remove '${removedParent}'; installed extension '${extension.name}' requires its API ${extension.extends[removedParent]}`);
    }
  }
  await resolveVelarProject(project.root);
  const removedExtensions = Object.freeze(declaredBefore.filter((name) => removing.has(name)));
  const removedMetadata = orphanedExtensionMetadata(graph, declaredBefore, new Set(removedExtensions));
  const next = dependencyManifest(project.manifest, "remove", removedMetadata);
  if (JSON.stringify(next) === JSON.stringify(project.manifest)) {
    return { removedExtensions, stagedManifest: null };
  }
  let stagedManifest: ProjectManifestVersion;
  try {
    stagedManifest = await replaceProjectManifest(project, jsonSource(next), operations);
  } catch (error) {
    throw new Error(`Dependency was not removed because its project declaration changed before staging: ${hostErrorMessage(error)}`);
  }
  try {
    await resolveVelarProject(project.root);
  } catch (error) {
    try {
      await restoreProjectManifest(project, stagedManifest, operations);
    } catch (restoreError) {
      throw new Error(`Dependency was not removed because its staged project declaration is invalid: ${hostErrorMessage(error)}; the declaration changed again and was not overwritten: ${hostErrorMessage(restoreError)}`);
    }
    throw new Error(`Dependency was not removed because its staged project declaration is invalid: ${hostErrorMessage(error)}`);
  }
  return { removedExtensions, stagedManifest };
}

async function installedExtensionMetadata(
  project: PackageProject,
  packageNames: readonly string[],
): Promise<readonly VelarPackageMetadata[]> {
  try {
    const installed = await Promise.all(packageNames.map((name) => resolveInstalledExtensionPackage(project.root, name)));
    return Object.freeze(installed
      .filter((item): item is ResolvedExtensionPackage => item !== null)
      .map((item) => ({ name: item.name, manifestKey: item.manifestKey })));
  } catch (error) {
    throw new Error(`Dependency was installed but its VelarScript metadata is invalid: ${hostErrorMessage(error)}`);
  }
}

async function activateAddedExtensions(
  project: PackageProject,
  metadata: readonly VelarPackageMetadata[],
  operations: PackageManifestReplacementOperations = {},
): Promise<void> {
  const next = dependencyManifest(project.manifest, "add", metadata);
  if (JSON.stringify(next) === JSON.stringify(project.manifest)) {
    await resolveVelarProject(project.root);
    return;
  }
  let stagedManifest: ProjectManifestVersion;
  try {
    stagedManifest = await replaceProjectManifest(project, jsonSource(next), operations);
  } catch (error) {
    throw new Error(`Dependency was installed but its project declaration changed while npm was running and was not overwritten: ${hostErrorMessage(error)}`);
  }
  try {
    await resolveVelarProject(project.root);
  } catch (error) {
    try {
      await restoreProjectManifest(project, stagedManifest, operations);
    } catch (restoreError) {
      throw new Error(`Dependency was installed but could not be activated: ${hostErrorMessage(error)}; the project declaration changed again and was not overwritten: ${hostErrorMessage(restoreError)}`);
    }
    throw new Error(`Dependency was installed but could not be activated: ${hostErrorMessage(error)}`);
  }
}

async function replaceProjectManifest(
  project: PackageProject,
  source: string,
  operations: PackageManifestReplacementOperations,
): Promise<ProjectManifestVersion> {
  const identity = await replaceSourceIfCurrent(
    project.manifestPath,
    project.manifestSource,
    source,
    project.manifestIdentity,
    operations,
  );
  return { source, identity };
}

async function restoreProjectManifest(
  project: PackageProject,
  staged: ProjectManifestVersion,
  operations: PackageManifestReplacementOperations,
): Promise<void> {
  await replaceSourceIfCurrent(
    project.manifestPath,
    staged.source,
    project.manifestSource,
    staged.identity,
    operations,
  );
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
      const {
        source: manifestSource,
        identity: manifestIdentity,
        value: manifest,
      } = await readJsonObject(manifestPath, "VelarScript project manifest");
      if (manifest.formatVersion !== CURRENT_PROJECT_FORMAT_VERSION) {
        throw new Error(typeof manifest.formatVersion === "number"
          ? `${manifestPath}: ${unsupportedProjectFormat(manifest.formatVersion)}`
          : `${manifestPath}: package commands require formatVersion ${CURRENT_PROJECT_FORMAT_VERSION}`);
      }
      extensionNames(manifest);
      return { root: current, manifestPath, packagePath, manifestSource, manifestIdentity, manifest };
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

async function readJsonObject(path: string, label: string): Promise<{
  readonly source: string;
  readonly identity: OrdinaryFileSnapshotIdentity;
  readonly value: Record<string, unknown>;
}> {
  let snapshot;
  try {
    snapshot = await readOrdinaryFileSnapshot(path, MAX_JSON_BYTES, `${path}: ${label}`);
  } catch (error) {
    if (error instanceof RangeError) throw new RangeError(`${path}: ${label} exceeds 1 MiB`);
    throw error;
  }
  const source = snapshot.bytes.toString("utf8");
  let value: unknown;
  try { value = JSON.parse(source); }
  catch (error) { throw new Error(`${path}: cannot parse ${label}: ${hostErrorMessage(error)}`); }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${path}: ${label} must be a JSON object`);
  return { source, identity: snapshot.identity, value: value as Record<string, unknown> };
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

async function replaceSourceIfCurrent(
  path: string,
  expected: string,
  source: string,
  expectedIdentity: OrdinaryFileSnapshotIdentity,
  operations: PackageManifestReplacementOperations,
): Promise<OrdinaryFileSnapshotIdentity> {
  let current;
  try {
    current = await readOrdinaryFileSnapshot(path, MAX_JSON_BYTES, `${path}: project manifest`);
  } catch (error) {
    if (error instanceof RangeError) {
      throw new Error(`${path} is no longer the bounded project manifest that this command read`);
    }
    throw error;
  }
  if (!sameIdentity(current.identity, expectedIdentity)
    || !current.bytes.equals(Buffer.from(expected, "utf8"))) {
    throw new Error(`${path} changed while the dependency command was running`);
  }
  return writeSourceAtomically(path, source, current.identity, current.bytes, operations);
}

async function writeSourceAtomically(
  path: string,
  source: string,
  expectedIdentity: OrdinaryFileSnapshotIdentity,
  expectedBytes: Buffer,
  operations: PackageManifestReplacementOperations,
): Promise<OrdinaryFileSnapshotIdentity> {
  const sourceBytes = Buffer.from(source, "utf8");
  if (sourceBytes.byteLength > MAX_JSON_BYTES) {
    throw new RangeError(`${path}: project declaration exceeds 1 MiB`);
  }
  const information = await lstat(path, { bigint: true });
  if (!information.isFile() || information.isSymbolicLink()
    || !sameIdentity(expectedIdentity, identityOf(information))) {
    throw new Error(`${path} changed while the dependency command was running`);
  }
  const transaction = await mkdtemp(join(dirname(path), ".velar-manifest-transaction-"));
  const replacement = join(transaction, `${randomUUID()}.next.json`);
  const previous = join(transaction, `${randomUUID()}.previous.json`);
  let currentMoved = false;
  try {
    await writeFile(replacement, source, { encoding: "utf8", flag: "wx", mode: Number(information.mode) });
    const replacementIdentity = identityOf(await lstat(replacement, { bigint: true }));
    const current = await lstat(path, { bigint: true });
    if (!current.isFile() || current.isSymbolicLink()
      || !sameIdentity(expectedIdentity, identityOf(current))) {
      throw new Error(`${path} changed while the dependency command was running`);
    }
    await operations.beforeCurrentMove?.(path);
    await rename(path, previous);
    currentMoved = true;
    const moved = await readOrdinaryFileSnapshot(
      previous,
      MAX_JSON_BYTES,
      `${path}: displaced project manifest`,
    );
    if (!samePhysicalFile(expectedIdentity, moved.identity) || !moved.bytes.equals(expectedBytes)) {
      throw new Error(`${path} changed while the dependency command was running`);
    }
    await operations.afterCurrentMove?.(path);
    try {
      await link(replacement, path);
    } catch (error) {
      if (isHostErrorCode(error, "EEXIST")) {
        throw new Error(`${path} changed while the dependency command was installing its project declaration`);
      }
      throw error;
    }
    const installed = await readOrdinaryFileSnapshot(
      path,
      MAX_JSON_BYTES,
      `${path}: installed project manifest`,
    );
    if (!samePhysicalFile(replacementIdentity, installed.identity)
      || !installed.bytes.equals(sourceBytes)) {
      throw new Error(`${path} changed while the dependency command was installing its project declaration`);
    }
    // The installed hard link must become the only writable name for the new
    // inode before this operation can commit. Leaving the transaction alias
    // behind would let a later cleanup or editor mutate the live declaration.
    await unlink(replacement);
    const committed = await readOrdinaryFileSnapshot(
      path,
      MAX_JSON_BYTES,
      `${path}: committed project manifest`,
    );
    if (!samePhysicalFile(replacementIdentity, committed.identity)
      || !committed.bytes.equals(sourceBytes)) {
      throw new Error(`${path} changed while the dependency command was committing its project declaration`);
    }
    currentMoved = false;
    await cleanManifestTransaction(transaction, operations);
    return committed.identity;
  } catch (error) {
    if (!currentMoved) {
      await cleanManifestTransaction(transaction, operations);
      throw error;
    }
    const restoration = await restoreMovedManifest(previous, path, Number(information.mode));
    if (restoration.restored) {
      await cleanManifestTransaction(transaction, operations);
      throw error;
    }
    throw new Error(
      `${hostErrorMessage(error)}; the displaced project declaration was preserved at '${restoration.evidencePath}'`,
      { cause: error },
    );
  }
}

/** Restores through an exclusive hard link, so a concurrent editor is never overwritten. */
async function restoreMovedManifest(previous: string, path: string, mode: number): Promise<MovedManifestRestore> {
  let evidencePath = previous;
  try {
    const displaced = await readOrdinaryFileSnapshot(
      previous,
      MAX_JSON_BYTES,
      `${path}: displaced project manifest recovery`,
    );
    await link(previous, path);
    const restored = await readOrdinaryFileSnapshot(
      path,
      MAX_JSON_BYTES,
      `${path}: restored project manifest`,
    );
    if (!samePhysicalFile(displaced.identity, restored.identity)
      || !restored.bytes.equals(displaced.bytes)) {
      return { restored: false, evidencePath };
    }

    // Keep an independent recovery copy until the restored pathname has become
    // the only hard link. If cleanup later fails, it cannot mutate the live file.
    const recovery = join(dirname(previous), `${randomUUID()}.recovery.json`);
    await writeFile(recovery, displaced.bytes, { flag: "wx", mode });
    const recoverySnapshot = await readOrdinaryFileSnapshot(
      recovery,
      MAX_JSON_BYTES,
      `${path}: independent project manifest recovery`,
    );
    if (!recoverySnapshot.bytes.equals(displaced.bytes)) {
      return { restored: false, evidencePath };
    }
    evidencePath = recovery;
    await unlink(previous);
    const committed = await readOrdinaryFileSnapshot(
      path,
      MAX_JSON_BYTES,
      `${path}: committed restored project manifest`,
    );
    return {
      restored: samePhysicalFile(displaced.identity, committed.identity)
        && committed.bytes.equals(displaced.bytes),
      evidencePath,
    };
  } catch {
    // The original remains in the transaction directory if an exclusive link
    // cannot be proved. Never trade its evidence for a best-effort overwrite.
    return { restored: false, evidencePath };
  }
}

async function cleanManifestTransaction(
  transaction: string,
  operations: PackageManifestReplacementOperations,
): Promise<void> {
  try {
    await operations.beforeTransactionCleanup?.(transaction);
    await rm(transaction, { recursive: true, force: true });
  } catch {
    // The pathname commit is already decided. A cleanup failure must neither
    // roll it back nor turn a successful dependency operation into ambiguity.
  }
}

function identityOf(information: {
  readonly dev: bigint;
  readonly ino: bigint;
  readonly size: bigint;
  readonly mtimeNs: bigint;
  readonly ctimeNs: bigint;
}): OrdinaryFileSnapshotIdentity {
  return {
    device: information.dev,
    inode: information.ino,
    size: information.size,
    modified: information.mtimeNs,
    changed: information.ctimeNs,
  };
}

function sameIdentity(left: OrdinaryFileSnapshotIdentity, right: OrdinaryFileSnapshotIdentity): boolean {
  return left.device === right.device && left.inode === right.inode && left.size === right.size
    && left.modified === right.modified && left.changed === right.changed;
}

function samePhysicalFile(left: OrdinaryFileSnapshotIdentity, right: OrdinaryFileSnapshotIdentity): boolean {
  return left.device === right.device && left.inode === right.inode
    && left.size === right.size && left.modified === right.modified;
}
