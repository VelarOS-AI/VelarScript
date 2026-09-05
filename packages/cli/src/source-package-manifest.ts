import { stat } from "node:fs/promises";
import { extname, isAbsolute, relative, resolve } from "node:path";
import { canonicalizePotentialPath } from "./canonical-path.ts";
import { isHostErrorCode } from "./host-error.ts";
import type { VelarLibraryArtifactTarget } from "./library-artifact.ts";
import { assertVelarPackageSubpath, parseVelarPackageEntrySources, type VelarPackageSubpath } from "./package-entry.ts";
import { BROWSER_ESM_PACKAGE_CONDITIONS, NODE_ESM_PACKAGE_CONDITIONS, packageExportTargets } from "./package-exports.ts";
import { packageRuntimeDependencyNames } from "./package-runtime-dependency-manifest.ts";
import { VELAR_VERSION } from "./version.ts";

export type VelarPackageTarget = "core" | "node" | "web" | "desktop";

export interface VelarPackageEntry {
  readonly subpath: VelarPackageSubpath;
  readonly relativePath: string;
  readonly inputPath: string;
}

export interface VelarPackageResource {
  readonly subpath: `./${string}` | null;
  readonly relativePath: string;
  readonly inputPath: string;
  readonly kind: "json";
}

export interface VelarPackageLanguageRange {
  readonly text: string;
  readonly lower: VelarLanguageBound | null;
  readonly upper: VelarLanguageBound | null;
}

export interface VelarLanguageBound {
  readonly generation: VelarLanguageGeneration;
  readonly inclusive: boolean;
}

export interface VelarLanguageGeneration {
  readonly major: number;
  readonly minor: number;
}

export interface VelarPackageCompatibility {
  readonly name: string;
  readonly targets: readonly VelarPackageTarget[];
  readonly requiredCapabilities: readonly string[];
  readonly requiredLanguage: VelarPackageLanguageRange | null;
}

export interface ParsedVelarSourcePackageManifest extends VelarPackageCompatibility {
  readonly version: string;
  readonly entries: ReadonlyMap<VelarPackageSubpath, VelarPackageEntry>;
  readonly resources: readonly VelarPackageResource[];
  readonly artifactDescriptors: ReadonlyMap<VelarLibraryArtifactTarget, string>;
  readonly runtimeDependencies: ReadonlySet<string>;
  readonly exports: unknown;
}

interface VelarPackageManifestShape {
  readonly name?: unknown;
  readonly version?: unknown;
  readonly dependencies?: unknown;
  readonly exports?: unknown;
  readonly velar?: {
    readonly entry?: unknown;
    readonly entries?: unknown;
    readonly artifacts?: unknown;
    readonly resources?: unknown;
    readonly targets?: unknown;
    readonly requires?: unknown;
  };
}

/** The installed package has JavaScript metadata but no VelarScript source entry. */
export class JavaScriptOnlyPackageError extends Error {}

export function parseVelarSourcePackageManifest(
  name: string,
  root: string,
  value: unknown,
): ParsedVelarSourcePackageManifest {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Package '${name}' package.json must contain a JSON object`);
  }
  const manifest = value as VelarPackageManifestShape;
  if (manifest.name !== undefined && manifest.name !== name) {
    throw new Error(`package name is '${String(manifest.name)}', expected '${name}'`);
  }
  if (manifest.velar?.entry === undefined) {
    throw new JavaScriptOnlyPackageError("package.json must declare 'velar.entry'");
  }
  const sources = parseVelarPackageEntrySources(manifest.velar.entry, manifest.velar.entries, "package.json#velar");
  const entries = new Map<VelarPackageSubpath, VelarPackageEntry>();
  for (const [subpath, relativePath] of sources) {
    const inputPath = resolve(root, ...relativePath.split("/"));
    if (escapesRoot(relative(root, inputPath))) throw new Error(`package.json#velar entry '${subpath}' cannot escape the package root`);
    entries.set(subpath, { subpath, relativePath, inputPath });
  }
  const resources = packageResources(name, root, manifest.velar.resources, manifest.exports);
  for (const resource of resources) {
    if (resource.subpath !== null && entries.has(resource.subpath)) {
      throw new Error(`Package '${name}' declares '${resource.subpath}' as both a VelarScript entry and a JSON resource`);
    }
  }
  const artifactDescriptors = packageArtifactDescriptors(manifest.velar.artifacts);
  if (artifactDescriptors.size > 0 && manifest.version === undefined) {
    throw new Error("A package declaring 'velar.artifacts' must declare its version");
  }
  const requires = packageRequiresFields(manifest.velar.requires);
  return {
    name,
    version: typeof manifest.version === "string" && manifest.version !== "" ? manifest.version : "0.0.0",
    entries,
    resources,
    targets: packageTargets(manifest.velar.targets),
    requiredCapabilities: packageRequiredCapabilities(requires),
    requiredLanguage: packageRequiredLanguage(requires),
    artifactDescriptors,
    runtimeDependencies: packageRuntimeDependencyNames(manifest.dependencies, `Package '${name}' package.json#dependencies`),
    exports: manifest.exports,
  };
}

/**
 * Authorizes every declared source entry by physical filesystem identity.
 *
 * Lexical containment is checked while parsing. This second boundary catches
 * a symlink that resolves outside the installed package and prevents two
 * different manifest paths from naming one physical source as if they were
 * independent entries. Several public subpaths may intentionally name the
 * same declared source path; the artifact builder separately requires those
 * aliases to share one runtime output.
 */
export async function canonicalVelarPackageEntryPaths(
  name: string,
  root: string,
  entries: ReadonlyMap<VelarPackageSubpath, VelarPackageEntry>,
): Promise<ReadonlyMap<VelarPackageSubpath, string>> {
  const canonicalRoot = await canonicalizePotentialPath(root);
  const canonicalPaths = new Map<VelarPackageSubpath, string>();
  const declarations = new Map<string, { readonly subpath: VelarPackageSubpath; readonly relativePath: string }>();
  for (const [subpath, entry] of entries) {
    const canonicalPath = await canonicalizePotentialPath(entry.inputPath);
    if (escapesRoot(relative(canonicalRoot, canonicalPath))) {
      throw new Error(`Package '${name}' entry '${subpath}' cannot escape the package root through a symbolic link`);
    }
    let metadata;
    try {
      metadata = await stat(entry.inputPath);
    } catch (error) {
      if (isHostErrorCode(error, "ENOENT") || isHostErrorCode(error, "ENOTDIR")) {
        throw new Error(`Package '${name}' entry '${subpath}' points to missing source '${entry.relativePath}'`);
      }
      throw error;
    }
    if (!metadata.isFile()) {
      throw new Error(`Package '${name}' entry '${subpath}' must point to a source file`);
    }
    const existing = declarations.get(canonicalPath);
    if (existing && existing.relativePath !== entry.relativePath) {
      throw new Error(`Package '${name}' entries '${existing.subpath}' and '${subpath}' resolve '${existing.relativePath}' and '${entry.relativePath}' to the same physical source; declare one source path for aliases`);
    }
    declarations.set(canonicalPath, { subpath, relativePath: entry.relativePath });
    canonicalPaths.set(subpath, canonicalPath);
  }
  return canonicalPaths;
}

export function assertVelarPackageCompatibility(
  package_: VelarPackageCompatibility,
  target: VelarPackageTarget,
  capabilities: ReadonlySet<string>,
): void {
  const declaredLanguage = package_.requiredLanguage;
  if (declaredLanguage !== null) {
    const current = parseLanguageGeneration(TOOLCHAIN_LANGUAGE_GENERATION);
    if (current === null) throw new Error(`VelarScript toolchain version '${VELAR_VERSION}' is not a language generation`);
    if (!languageRangeAdmits(declaredLanguage, current)) {
      throw new Error(`package '${package_.name}' requires VelarScript language ${declaredLanguage.text}; this toolchain implements ${TOOLCHAIN_LANGUAGE_GENERATION}; install a release of '${package_.name}' published for ${TOOLCHAIN_LANGUAGE_GENERATION}, or run the toolchain the package asks for — its sources are not wrong, they belong to another generation of the language`);
    }
  }
  assertVelarPackageTargetCapabilities(package_, target, capabilities);
}

export function assertVelarPackageTargetCapabilities(
  package_: VelarPackageCompatibility,
  target: VelarPackageTarget,
  capabilities: ReadonlySet<string>,
): void {
  if (!package_.targets.includes("core") && !package_.targets.includes(target)) {
    throw new Error(`package '${package_.name}' does not support the '${target}' target; supported targets: ${package_.targets.join(", ")}`);
  }
  const missing = package_.requiredCapabilities.filter((capability) => !capabilities.has(capability));
  if (missing.length > 0) {
    throw new Error(`package '${package_.name}' requires host ${missing.length === 1 ? "capability" : "capabilities"} ${missing.map((name) => `'${name}'`).join(", ")}`);
  }
}

function packageArtifactDescriptors(value: unknown): ReadonlyMap<VelarLibraryArtifactTarget, string> {
  if (value === undefined) return new Map();
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("'velar.artifacts' must be an object mapping core or node to a receipt path");
  }
  const declarations = Object.entries(value as Record<string, unknown>);
  if (declarations.length !== 1) throw new Error("Velar library ABI 1 requires exactly one artifact target per package");
  const artifacts = new Map<VelarLibraryArtifactTarget, string>();
  for (const [target, descriptor] of declarations) {
    if (target !== "core" && target !== "node") {
      throw new Error(`Velar library ABI 1 does not support artifact target '${target}'; supported targets are core and node`);
    }
    if (!normalizedRelativePath(descriptor)) {
      throw new Error(`'velar.artifacts.${target}' must be a normalized package-relative receipt path`);
    }
    artifacts.set(target, descriptor);
  }
  return artifacts;
}

const velarPackageTargets = new Set<VelarPackageTarget>(["core", "node", "web", "desktop"]);

function packageTargets(value: unknown): readonly VelarPackageTarget[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > velarPackageTargets.size) {
    throw new Error("'velar.targets' must be a non-empty list of core, node, web, or desktop");
  }
  const targets: VelarPackageTarget[] = [];
  for (const target of value) {
    if (typeof target !== "string" || !velarPackageTargets.has(target as VelarPackageTarget)) {
      throw new Error("'velar.targets' entries must be core, node, web, or desktop");
    }
    if (targets.includes(target as VelarPackageTarget)) throw new Error(`'velar.targets' contains duplicate '${target}'`);
    targets.push(target as VelarPackageTarget);
  }
  return targets;
}

function packageRequiresFields(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("'velar.requires' must be an object");
  }
  const fields = value as Record<string, unknown>;
  const unknown = Object.keys(fields).filter((field) => field !== "capabilities" && field !== "language");
  if (unknown.length > 0) {
    throw new Error(`'velar.requires' has unknown field '${unknown[0]}'; the supported fields are 'capabilities' and 'language'`);
  }
  return fields;
}

function packageRequiredCapabilities(fields: Record<string, unknown>): readonly string[] {
  const capabilities = fields.capabilities;
  if (!Array.isArray(capabilities) || capabilities.length > 16) {
    throw new Error("'velar.requires.capabilities' must be a list with at most 16 entries");
  }
  const required: string[] = [];
  for (const capability of capabilities) {
    if (typeof capability !== "string" || !/^[a-z][a-z0-9-]{0,63}$/u.test(capability)) {
      throw new Error("'velar.requires.capabilities' entries must be normalized capability names");
    }
    if (required.includes(capability)) throw new Error(`'velar.requires.capabilities' contains duplicate '${capability}'`);
    required.push(capability);
  }
  return required;
}

const TOOLCHAIN_LANGUAGE_GENERATION = VELAR_VERSION.split(".").slice(0, 2).join(".");
const languageGenerationPattern = /^(0|[1-9][0-9]{0,3})\.(0|[1-9][0-9]{0,3})$/u;

function parseLanguageGeneration(text: string): VelarLanguageGeneration | null {
  const match = languageGenerationPattern.exec(text);
  if (match === null) return null;
  return { major: Number(match[1]), minor: Number(match[2]) };
}

function compareLanguageGenerations(left: VelarLanguageGeneration, right: VelarLanguageGeneration): number {
  return left.major !== right.major ? left.major - right.major : left.minor - right.minor;
}

function packageRequiredLanguage(fields: Record<string, unknown>): VelarPackageLanguageRange | null {
  const declared = fields.language;
  if (declared === undefined) return null;
  const malformed = new Error("'velar.requires.language' must be a language generation such as '0.12' or a range such as '>=0.11 <0.14'");
  if (typeof declared !== "string") throw malformed;
  const text = declared.trim().split(/\s+/u).join(" ");
  const clauses = text.split(" ");
  if (clauses.length > 2) throw malformed;
  let lower: VelarLanguageBound | null = null;
  let upper: VelarLanguageBound | null = null;
  for (const clause of clauses) {
    const operator = /^(>=|<=|>|<)/u.exec(clause)?.[0] ?? "";
    const generation = parseLanguageGeneration(clause.slice(operator.length));
    if (generation === null) throw malformed;
    if (operator === ">=" || operator === ">") {
      if (lower !== null) throw malformed;
      lower = { generation, inclusive: operator === ">=" };
    } else if (operator === "<=" || operator === "<") {
      if (upper !== null) throw malformed;
      upper = { generation, inclusive: operator === "<=" };
    } else {
      if (clauses.length !== 1) throw malformed;
      lower = { generation, inclusive: true };
      upper = { generation, inclusive: true };
    }
  }
  if (lower !== null && upper !== null) {
    const order = compareLanguageGenerations(lower.generation, upper.generation);
    if (order > 0 || (order === 0 && !(lower.inclusive && upper.inclusive))) throw malformed;
  }
  return { text, lower, upper };
}

function languageRangeAdmits(range: VelarPackageLanguageRange, generation: VelarLanguageGeneration): boolean {
  if (range.lower !== null) {
    const order = compareLanguageGenerations(generation, range.lower.generation);
    if (order < 0 || (order === 0 && !range.lower.inclusive)) return false;
  }
  if (range.upper !== null) {
    const order = compareLanguageGenerations(generation, range.upper.generation);
    if (order > 0 || (order === 0 && !range.upper.inclusive)) return false;
  }
  return true;
}

function packageResources(name: string, root: string, value: unknown, exports: unknown): readonly VelarPackageResource[] {
  if (value === undefined) return [];
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("'velar.resources' must be an object mapping exact package subpaths to resource declarations");
  }
  const declarations = Object.entries(value as Record<string, unknown>);
  if (declarations.length > 128) throw new RangeError("'velar.resources' cannot declare more than 128 resources");
  return declarations.map(([subpath, declaration]) => packageResource(name, root, exports, subpath, declaration));
}

function packageResource(name: string, root: string, exports: unknown, subpath: string, declaration: unknown): VelarPackageResource {
  assertVelarPackageSubpath(subpath, `'velar.resources' key '${subpath}'`);
  if (declaration === null || typeof declaration !== "object" || Array.isArray(declaration)) {
    throw new Error(`'velar.resources.${subpath}' must contain 'path' and 'type'`);
  }
  const fields = declaration as Record<string, unknown>;
  const unknown = Object.keys(fields).filter((field) => field !== "path" && field !== "type");
  if (unknown.length > 0) {
    throw new Error(`'velar.resources.${subpath}' has unknown field '${unknown[0]}'; the supported fields are 'path' and 'type'`);
  }
  if (fields.type !== "json") throw new Error(`'velar.resources.${subpath}.type' must be 'json'`);
  if (!normalizedRelativePath(fields.path)) {
    throw new Error(`'velar.resources.${subpath}.path' must be a normalized package-relative file path`);
  }
  if (extname(fields.path).toLowerCase() !== ".json") {
    throw new Error(`'velar.resources.${subpath}.path' must point to a .json file`);
  }
  const target = `./${fields.path}`;
  const declaredTargets = packageExportTargets(
    exports,
    subpath,
    [NODE_ESM_PACKAGE_CONDITIONS, BROWSER_ESM_PACKAGE_CONDITIONS],
  );
  if (declaredTargets.length === 0) {
    throw new Error(`Package '${name}' must expose resource '${subpath}' through package.json 'exports'`);
  }
  if (declaredTargets.some((candidate) => candidate !== target)) {
    throw new Error(`Package '${name}' resource '${subpath}' must point to '${target}' in every package.json export condition`);
  }
  return { subpath, relativePath: fields.path, inputPath: resolve(root, ...fields.path.split("/")), kind: "json" };
}

function normalizedRelativePath(value: unknown): value is string {
  return typeof value === "string" && value !== "" && !/[\u0000-\u001f\u007f]/u.test(value) && !isAbsolute(value)
    && !value.includes("\\") && value.split("/").every((part) => part !== "" && part !== "." && part !== "..");
}

function escapesRoot(relativePath: string): boolean {
  return relativePath === ".." || relativePath.startsWith("../") || relativePath.startsWith("..\\") || isAbsolute(relativePath);
}
