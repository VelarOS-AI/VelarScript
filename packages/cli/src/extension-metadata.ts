import { lstat, readFile, stat } from "node:fs/promises";
import { createRequire } from "node:module";
import { join } from "node:path";
import {
  VELAR_EXTENSION_PROTOCOL_VERSION,
  type CompilerExtension,
  type VelarExtensionKind,
} from "@velarscript/compiler";
import { hostErrorMessage, isHostErrorCode } from "./host-error.ts";
import { isReservedExtensionManifestKey } from "./project-format.ts";
import { bundledExtension } from "./bundled-extension-registry.ts";
import { byCodeUnit } from "./stable-order.ts";

const MAX_JSON_BYTES = 1024 * 1024;
const MAX_EXTENSION_GRAPH_SIZE = 64;
const PACKAGE_NAME = /^(?:@[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*|[a-z0-9][a-z0-9._-]*)$/u;
const MANIFEST_KEY = /^[a-z][a-z0-9-]*$/u;
const API_VERSION = /^(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)$/u;
const PACKAGE_VERSION = /^(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)(?:-(?:0|[1-9][0-9]*|[0-9]*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9][0-9]*|[0-9]*[A-Za-z-][0-9A-Za-z-]*))*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/u;
const MAX_VERSION_LENGTH = 256;
const kinds = new Set<VelarExtensionKind>(["application", "capability", "language"]);
const toolchainExtensionPackages = new Set([
  "@velarscript/web",
  "@velarscript/node",
  "@velarscript/server",
  "@velarscript/desktop",
]);

/**
 * The official target extensions this toolchain ships. They are the only
 * packages allowed to name a `velar/*` module, because that vocabulary belongs
 * to the language rather than to whoever installed a package.
 */
export function isToolchainExtensionPackage(name: string): boolean {
  return toolchainExtensionPackages.has(name);
}
/**
 * BLD-U1: the official web application extension's package identity, exported
 * so configuration diagnostics can teach a complete manifest while the CLI
 * composition layer itself never names the package.
 */
export const OFFICIAL_WEB_EXTENSION_PACKAGE = "@velarscript/web";
const toolchainRequire = createRequire(import.meta.url);

export interface ResolvedExtensionPackage {
  readonly name: string;
  readonly version: string;
  readonly manifestPath: string;
  readonly kind: VelarExtensionKind;
  readonly apiVersion: string;
  readonly manifestKey: string | null;
  readonly extends: Readonly<Record<string, string>>;
  readonly composes: Readonly<Record<string, string>>;
  readonly direct: boolean;
  readonly resolution: "project" | "toolchain" | "bundled";
}

export async function resolveInstalledExtensionPackage(
  root: string,
  name: string,
): Promise<ResolvedExtensionPackage | null> {
  const require = createRequire(join(root, "package.json"));
  const loaded = await readExtensionPackage(require, name, true, true);
  return loaded?.package ?? null;
}

export async function resolveExtensionPackages(
  root: string,
  names: readonly string[],
): Promise<readonly ResolvedExtensionPackage[]> {
  const require = createRequire(join(root, "package.json"));
  const packages = new Map<string, ResolvedExtensionPackage>();
  const dependencies = new Map<string, readonly string[]>();
  const direct = new Set(names);

  const discover = async (name: string): Promise<void> => {
    if (packages.has(name)) return;
    if (packages.size >= MAX_EXTENSION_GRAPH_SIZE) {
      throw new Error(`Velar extension graph cannot contain more than ${MAX_EXTENSION_GRAPH_SIZE} packages`);
    }
    const loaded = await readExtensionPackage(require, name, direct.has(name), false, true);
    if (!loaded) throw new Error(`installed package '${name}' is not a VelarScript extension`);
    packages.set(name, loaded.package);
    const parents = Object.keys(loaded.package.extends).sort();
    dependencies.set(name, Object.freeze(parents));
    for (const parent of parents) {
      if (typeof loaded.peerDependencies[parent] !== "string" || !(loaded.peerDependencies[parent] as string).trim()) {
        throw new Error(`${loaded.package.manifestPath}: extension '${name}' must declare parent '${parent}' in peerDependencies`);
      }
      await discover(parent);
    }
  };
  for (const name of [...names].sort()) await discover(name);

  const visiting = new Set<string>();
  const visited = new Set<string>();
  const ordered: string[] = [];
  const visit = (name: string, trail: readonly string[]): void => {
    if (visiting.has(name)) throw new Error(`Velar extension dependency cycle: ${[...trail, name].join(" -> ")}`);
    if (visited.has(name)) return;
    visiting.add(name);
    for (const parent of dependencies.get(name) ?? []) visit(parent, [...trail, name]);
    visiting.delete(name);
    visited.add(name);
    ordered.push(name);
  };
  for (const name of [...packages.keys()].sort()) visit(name, []);

  for (const name of ordered) {
    const package_ = packages.get(name)!;
    for (const [parentName, requiredApi] of Object.entries(package_.extends)) {
      const parent = packages.get(parentName)!;
      if (parent.apiVersion !== requiredApi) {
        throw new Error(`${package_.manifestPath}: extension '${name}' requires ${parentName} API ${requiredApi}, but ${parent.apiVersion} is installed`);
      }
    }
  }
  await assertToolchainGeneration(ordered.map((name) => packages.get(name)!));

  const applications = ordered.map((name) => packages.get(name)!).filter((item) => item.kind === "application");
  if (applications.length > 1) {
    throw new Error(`A VelarScript project can activate only one application extension; found ${applications.map((item) => item.name).join(", ")}`);
  }
  return Object.freeze(ordered.map((name) => packages.get(name)!));
}

interface ToolchainIdentity {
  readonly version: string;
  readonly pins: Readonly<Record<string, string>>;
}

let toolchainIdentity: ToolchainIdentity | null = null;

/**
 * This CLI's own version and the exact versions it was published against.
 * `@velarscript/cli` pins every official target extension to its own version
 * and the release gate refuses a candidate whose pins drift, so these are the
 * versions whose compiler generation is the one running here.
 */
async function readToolchainIdentity(): Promise<ToolchainIdentity> {
  if (toolchainIdentity) return toolchainIdentity;
  try {
    const manifestPath = new URL("../package.json", import.meta.url);
    const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as {
      readonly version?: unknown;
      readonly dependencies?: Readonly<Record<string, unknown>>;
    };
    const pins: Record<string, string> = {};
    for (const [name, range] of Object.entries(manifest.dependencies ?? {})) {
      if (typeof range === "string" && PACKAGE_VERSION.test(range)) pins[name] = range;
    }
    toolchainIdentity = Object.freeze({
      version: typeof manifest.version === "string" ? manifest.version : "unknown",
      pins: Object.freeze(pins),
    });
  } catch {
    // A toolchain whose own manifest is unreadable cannot claim a generation;
    // it must not turn that into a refusal of the project's extensions.
    toolchainIdentity = Object.freeze({ version: "unknown", pins: Object.freeze({}) });
  }
  return toolchainIdentity;
}

/**
 * An extension is resolved from the project before the toolchain, deliberately,
 * so the CLI's exact pin does not constrain what actually loads. That routes
 * around the only thing keeping the two halves of an emitted program on one
 * compiler generation: an official target extension from another release brings
 * its own nested `@velarscript/compiler`, and `validateLoadedExtension` cannot
 * see the difference — `protocolVersion` has never moved and `apiVersion` is
 * compared against the extension's own manifest. The npm versions are the one
 * generation marker both sides do carry, so they are compared here.
 */
async function assertToolchainGeneration(packages: readonly ResolvedExtensionPackage[]): Promise<void> {
  const toolchain = await readToolchainIdentity();
  for (const package_ of packages) {
    if (package_.resolution !== "project") continue;
    const pinned = toolchain.pins[package_.name];
    if (pinned === undefined || pinned === package_.version) continue;
    throw new Error(`${package_.manifestPath}: this project resolves ${package_.name} ${package_.version}, but @velarscript/cli ${toolchain.version} is built against ${package_.name} ${pinned}; a VelarScript toolchain is one generation, so install ${package_.name} ${pinned} or @velarscript/cli ${package_.version}`);
  }
}

export function validateLoadedExtension(
  package_: ResolvedExtensionPackage,
  extension: Partial<CompilerExtension> | null | undefined,
): CompilerExtension {
  if (!extension || extension.id !== package_.name || (extension.createEmitter !== undefined && typeof extension.createEmitter !== "function")) {
    throw new Error(`'${package_.name}/compiler' does not export a matching velarCompilerExtension`);
  }
  const contract = extension.contract;
  if (!contract || contract.protocolVersion !== VELAR_EXTENSION_PROTOCOL_VERSION
    || contract.apiVersion !== package_.apiVersion || contract.kind !== package_.kind
    || !sameStringRecord(contract.extends, package_.extends)
    || !sameStringRecord(contract.composes ?? {}, package_.composes)) {
    throw new Error(`'${package_.name}/compiler' contract does not match its package metadata`);
  }
  return extension as CompilerExtension;
}

async function readExtensionPackage(
  require: NodeJS.Require,
  name: string,
  direct: boolean,
  optional: boolean,
  allowToolchain = false,
): Promise<{ readonly package: ResolvedExtensionPackage; readonly peerDependencies: Readonly<Record<string, unknown>> } | null> {
  let manifestPath = await installedPackageManifest(require, name);
  let resolution: ResolvedExtensionPackage["resolution"] = "project";
  if (!manifestPath && allowToolchain && toolchainExtensionPackages.has(name)) {
    manifestPath = await installedPackageManifest(toolchainRequire, name);
    resolution = "toolchain";
  }
  const bundled = !manifestPath && allowToolchain ? bundledExtension(name) : null;
  if (bundled) {
    return {
      package: Object.freeze({
        name,
        version: bundled.version,
        manifestPath: import.meta.url,
        kind: bundled.kind,
        apiVersion: bundled.apiVersion,
        manifestKey: bundled.manifestKey,
        extends: bundled.extends,
        composes: bundled.composes,
        direct,
        resolution: "bundled",
      }),
      peerDependencies: bundled.extends,
    };
  }
  if (!manifestPath) throw new Error(`cannot resolve installed package '${name}'`);
  const information = await stat(manifestPath);
  if (information.size > MAX_JSON_BYTES) throw new RangeError(`${manifestPath}: package manifest exceeds 1 MiB`);
  let value: unknown;
  try {
    value = JSON.parse(await readFile(manifestPath, "utf8"));
  } catch (error) {
    throw new Error(`${manifestPath}: cannot read package manifest: ${hostErrorMessage(error)}`);
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${manifestPath}: package manifest must be an object`);
  const manifest = value as Record<string, unknown>;
  if (manifest.name !== name) throw new Error(`${manifestPath}: installed package identity does not match '${name}'`);
  if (optional && manifest.velar === undefined) return null;
  const velar = objectField(manifest.velar, "velar", manifestPath);
  if (optional && velar.extension === undefined) return null;
  if (typeof manifest.version !== "string" || manifest.version.length > MAX_VERSION_LENGTH || !PACKAGE_VERSION.test(manifest.version)) {
    throw new Error(`${manifestPath}: extension package must declare a valid SemVer 2.0 version`);
  }
  const extension = objectField(velar.extension, "velar.extension", manifestPath);
  knownFields(extension, new Set(["kind", "apiVersion", "manifestKey", "extends", "composes"]), "velar.extension", manifestPath);
  if (typeof extension.kind !== "string" || !kinds.has(extension.kind as VelarExtensionKind)) {
    throw new Error(`${manifestPath}: 'velar.extension.kind' must be application, capability, or language`);
  }
  if (typeof extension.apiVersion !== "string" || extension.apiVersion.length > MAX_VERSION_LENGTH || !API_VERSION.test(extension.apiVersion)) {
    throw new Error(`${manifestPath}: 'velar.extension.apiVersion' must be a major.minor API version`);
  }
  const manifestKey = extension.manifestKey === undefined ? null : extension.manifestKey;
  if (typeof manifestKey === "string" && isReservedExtensionManifestKey(manifestKey)) {
    throw new Error(`${manifestPath}: 'velar.extension.manifestKey' cannot claim reserved project field '${manifestKey}'`);
  }
  if (manifestKey !== null && (typeof manifestKey !== "string" || !MANIFEST_KEY.test(manifestKey))) {
    throw new Error(`${manifestPath}: 'velar.extension.manifestKey' must be a lowercase project field name`);
  }
  if (extension.kind === "application" && manifestKey === null) {
    throw new Error(`${manifestPath}: an application extension must own a project manifest field`);
  }
  const parents = extension.extends === undefined ? {} : objectField(extension.extends, "velar.extension.extends", manifestPath);
  if (Object.keys(parents).length > 16) throw new Error(`${manifestPath}: an extension cannot declare more than 16 parents`);
  const extends_: Record<string, string> = {};
  for (const [parent, apiVersion] of Object.entries(parents)) {
    if (!PACKAGE_NAME.test(parent) || parent === name) throw new Error(`${manifestPath}: invalid extension parent '${parent}'`);
    if (typeof apiVersion !== "string" || apiVersion.length > MAX_VERSION_LENGTH || !API_VERSION.test(apiVersion)) {
      throw new Error(`${manifestPath}: parent '${parent}' must require a major.minor API version`);
    }
    extends_[parent] = apiVersion;
  }
  if (extension.kind === "application" && Object.keys(extends_).length > 0) {
    throw new Error(`${manifestPath}: an application extension cannot extend another extension`);
  }
  const composed = extension.composes === undefined ? {} : objectField(extension.composes, "velar.extension.composes", manifestPath);
  if (Object.keys(composed).length > 16) throw new Error(`${manifestPath}: an extension cannot compose more than 16 official targets`);
  const composes: Record<string, string> = {};
  for (const [target, apiVersion] of Object.entries(composed)) {
    if (!PACKAGE_NAME.test(target) || target === name) throw new Error(`${manifestPath}: invalid composed target '${target}'`);
    if (typeof apiVersion !== "string" || apiVersion.length > MAX_VERSION_LENGTH || !API_VERSION.test(apiVersion)) {
      throw new Error(`${manifestPath}: composed target '${target}' must require a major.minor API version`);
    }
    composes[target] = apiVersion;
  }
  if (extension.kind !== "application" && Object.keys(composes).length > 0) {
    throw new Error(`${manifestPath}: only an application extension can compose other official targets`);
  }
  const peerDependencies = manifest.peerDependencies === undefined
    ? {}
    : objectField(manifest.peerDependencies, "peerDependencies", manifestPath);
  return {
    package: Object.freeze({
      name,
      version: manifest.version,
      manifestPath,
      kind: extension.kind as VelarExtensionKind,
      apiVersion: extension.apiVersion,
      manifestKey: manifestKey as string | null,
      extends: Object.freeze(extends_),
      composes: Object.freeze(composes),
      direct,
      resolution,
    }),
    peerDependencies,
  };
}

async function installedPackageManifest(require: NodeJS.Require, name: string): Promise<string | null> {
  for (const directory of require.resolve.paths(name) ?? []) {
    const path = join(directory, ...name.split("/"), "package.json");
    let information;
    try {
      information = await lstat(path);
    } catch (error) {
      if (isHostErrorCode(error, "ENOENT") || isHostErrorCode(error, "ENOTDIR")) continue;
      throw error;
    }
    if (!information.isFile() || information.isSymbolicLink()) {
      throw new Error(`${path}: installed package manifest must be an ordinary file`);
    }
    return path;
  }
  return null;
}

function objectField(value: unknown, field: string, manifestPath: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${manifestPath}: '${field}' must be an object`);
  return value as Record<string, unknown>;
}

function knownFields(value: Record<string, unknown>, allowed: ReadonlySet<string>, field: string, manifestPath: string): void {
  // The rejection names what the section does accept: an author who misspells a
  // field is otherwise told only that their spelling is wrong, never which one
  // it should have been. Same shape as 'velar.requires' in project.ts (D90 R13).
  const supported = [...allowed].sort().map((name) => `'${name}'`).join(", ");
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw new Error(`${manifestPath}: '${field}' contains unknown field '${key}'; the supported fields are ${supported}`);
  }
}

function sameStringRecord(left: Readonly<Record<string, string>>, right: Readonly<Record<string, string>>): boolean {
  const leftEntries = Object.entries(left).sort(([a], [b]) => byCodeUnit(a, b));
  const rightEntries = Object.entries(right).sort(([a], [b]) => byCodeUnit(a, b));
  return JSON.stringify(leftEntries) === JSON.stringify(rightEntries);
}
