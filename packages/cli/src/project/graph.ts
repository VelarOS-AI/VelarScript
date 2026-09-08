import { dirname, extname, isAbsolute, join, relative, resolve } from "node:path";
import { inspectModule, type ModuleInspection } from "@velarscript/compiler";
import { readBoundedText } from "../bounded-text.ts";
import { canonicalizePotentialPath } from "../canonical-path.ts";
import { hostErrorMessage, isHostErrorCode } from "../host-error.ts";
import { nearestModuleName, nearestName } from "../module-resolution-messages.ts";
import {
  registerVelarPackage,
  resolveVelarSourcePackage,
} from "../project-package-resolution.ts";
import { projectManifestSite } from "../project-manifest-site.ts";
import { handleStandardModuleTarget } from "../project-runtime-target.ts";
import { MAX_VELAR_PROJECT_MODULES, resolveVelarSourceSnapshot, type VelarSourceFileSnapshot } from "../source-limits.ts";
import { JavaScriptOnlyPackageError, assertVelarPackageCompatibility } from "../source-package-manifest.ts";
import { standardModuleInterfaces } from "../standard-modules.ts";
import {
  checkJavaScriptDependency,
  migratedStandardPackageDiagnostic,
  standardModuleListing,
} from "./diagnostics.ts";
import {
  escapesRoot,
  normalizeModulePath,
  projectModuleBoundaries,
  readProjectJsonResource,
  resolveJsonResource,
} from "./entries.ts";
import { projectImportKey, type PendingModule, type ProjectCompilation } from "./options.ts";
import type { ProjectFailure, ProjectResource } from "../project.ts";

const MAX_PROJECT_RESOURCES = 1024;

/**
 * The state the module walk owns for the length of one discovery pass: the
 * work queue and what it has already scheduled, the import statement behind
 * each scheduled module, and the canonical-path answers the boundary checks
 * memoize. Nothing here outlives discovery, so none of it is on
 * `ProjectCompilation`.
 */
interface ModuleGraphWalk {
  readonly pending: PendingModule[];
  readonly scheduled: Set<string>;
  readonly visited: Set<string>;
  readonly importOrigins: Map<string, { readonly importer: string; readonly source: string }>;
  readonly canonicalModuleKeys: Map<string, string>;
  readonly unsafeCssOwners: Map<string, string>;
  readonly canonicalBoundary: (boundary: string) => Promise<string>;
  readonly enqueue: (module: PendingModule) => void;
}

/** The physical boundaries one module was authorized against, and its canonical identity. */
interface AuthorizedModulePath {
  readonly boundary: string;
  readonly moduleResourceBoundary: string;
  readonly pathWithinBoundary: string;
  readonly canonicalInput: string;
}

function createModuleGraphWalk(compilation: ProjectCompilation): ModuleGraphWalk {
  const { entryPath, failures, initialEntries } = compilation;
  const pending: PendingModule[] = initialEntries.slice(0, MAX_VELAR_PROJECT_MODULES).map((inputPath) => ({ inputPath, package: null }));
  const scheduled = new Set(pending.map((module) => module.inputPath));
  const visited = new Set<string>();
  const unsafeCssOwners = new Map<string, string>();
  // The importing statement behind each scheduled module, so a failure that
  // only surfaces when the target is visited (a missing file, a
  // case-divergent duplicate) can still land on the import that caused it.
  const importOrigins = new Map<string, { readonly importer: string; readonly source: string }>();
  // MOD-D2: one canonical file must be one module. The canonical (real-cased,
  // symlink-resolved) path of every visited module detects a second spelling
  // of the same file before it double-instantiates.
  const canonicalModuleKeys = new Map<string, string>();
  const canonicalBoundaries = new Map<string, Promise<string>>();
  const canonicalBoundary = (boundary: string): Promise<string> => {
    let pending = canonicalBoundaries.get(boundary);
    if (!pending) {
      pending = canonicalizePotentialPath(boundary);
      canonicalBoundaries.set(boundary, pending);
    }
    return pending;
  };
  if (initialEntries.length > MAX_VELAR_PROJECT_MODULES) {
    failures.push({ path: entryPath, message: `A VelarScript project cannot contain more than ${MAX_VELAR_PROJECT_MODULES} source modules` });
  }
  const enqueue = (module: PendingModule): void => {
    if (scheduled.has(module.inputPath)) return;
    if (scheduled.size >= MAX_VELAR_PROJECT_MODULES) {
      failures.push({ path: entryPath, message: `A VelarScript project cannot contain more than ${MAX_VELAR_PROJECT_MODULES} source modules` });
      return;
    }
    scheduled.add(module.inputPath);
    pending.push(module);
  };
  return { pending, scheduled, visited, importOrigins, canonicalModuleKeys, unsafeCssOwners, canonicalBoundary, enqueue };
}

/**
 * MOD-D2 and the boundary rules: where this module is allowed to live, and
 * whether the file it names has already entered the graph under a different
 * spelling. A rejected module has already recorded its own failure.
 */
async function authorizeModulePath(
  compilation: ProjectCompilation,
  walk: ModuleGraphWalk,
  pendingModule: PendingModule,
): Promise<AuthorizedModulePath | null> {
  const { failures, sourceBoundary, resourceBoundary, options, recordResolution } = compilation;
  const { canonicalBoundary, canonicalModuleKeys, importOrigins } = walk;
  const inputPath = pendingModule.inputPath;
  const { boundary, moduleResourceBoundary } = projectModuleBoundaries(pendingModule.package, inputPath, sourceBoundary, resourceBoundary, options);
  const pathWithinBoundary = relative(boundary, inputPath);
  if (escapesRoot(pathWithinBoundary)) {
    failures.push({ path: inputPath, message: pendingModule.package
      ? `VelarScript package '${pendingModule.package.name}' cannot load source outside its package root`
      : "Relative VelarScript imports cannot escape the entry source directory" });
    return null;
  }
  let escapesCanonicalBoundary = false;
  let canonicalInput: string | null = null;
  try {
    canonicalInput = await canonicalizePotentialPath(inputPath);
    escapesCanonicalBoundary = escapesRoot(relative(await canonicalBoundary(boundary), canonicalInput));
  } catch (error) {
    failures.push({ path: inputPath, message: hostErrorMessage(error) });
    return null;
  }
  if (escapesCanonicalBoundary) {
    failures.push({ path: inputPath, message: pendingModule.package
      ? `VelarScript package '${pendingModule.package.name}' cannot load source outside its package root`
      : "Relative VelarScript imports cannot escape the entry source directory" });
    return null;
  }
  // MOD-D2: two spellings of one file (differently cased on a
  // case-insensitive filesystem, or reached through a link) would silently
  // instantiate the module twice and split its state. The first spelling
  // wins; the second is rejected on its import.
  {
    const existingSpelling = canonicalModuleKeys.get(canonicalInput);
    if (existingSpelling !== undefined && existingSpelling !== inputPath) {
      const origin = importOrigins.get(inputPath);
      const message = `Module path ${JSON.stringify(origin?.source ?? inputPath)} names the same file as '${existingSpelling}' under a different spelling; a module has one instance, so import it through one spelling (match the on-disk casing)`;
      if (origin) recordResolution(origin.importer, origin.source, "VEL6005", message);
      else failures.push({ path: inputPath, message });
      return null;
    }
    canonicalModuleKeys.set(canonicalInput, inputPath);
  }
  return { boundary, moduleResourceBoundary, pathWithinBoundary, canonicalInput };
}

/** The module's bytes, with a missing file reported on the import that asked for it. */
async function loadModuleSource(
  compilation: ProjectCompilation,
  walk: ModuleGraphWalk,
  inputPath: string,
  canonicalInput: string,
): Promise<VelarSourceFileSnapshot | null> {
  const { failures, overrides, recordResolution } = compilation;
  const { importOrigins } = walk;
  let source: VelarSourceFileSnapshot;
  try {
    source = await resolveVelarSourceSnapshot(inputPath, overrides.get(inputPath), {
      expectedCanonicalPath: canonicalInput,
    });
  } catch (error) {
    // MOD-U5: a missing module lands on the import that asked for it, in
    // owned words, with the closest on-disk name when one is near.
    const origin = importOrigins.get(inputPath);
    if (origin && isHostErrorCode(error, "ENOENT")) {
      const near = await nearestModuleName(inputPath);
      const suggestion = near === null ? null : origin.source.slice(0, origin.source.lastIndexOf("/") + 1) + near;
      recordResolution(
        origin.importer,
        origin.source,
        "VEL6001",
        `Module ${JSON.stringify(origin.source)} does not exist${suggestion ? `; did you mean ${JSON.stringify(suggestion)}?` : ""}`,
      );
      return null;
    }
    // GA-D2: nothing imported the entry, so there is no import line to land on
    // — but the manifest declared it, and that declaration is a line the author
    // wrote. Without it the host's own `ENOENT` string reached the diagnostic
    // channel verbatim: no code, no position, no frame, and the path printed
    // twice, in the one command whose documentation says every diagnostic has
    // that shape.
    const declaration = missingEntryDeclaration(compilation, inputPath, error);
    if (declaration) {
      failures.push(declaration);
      return null;
    }
    failures.push({ path: inputPath, message: hostErrorMessage(error) });
    return null;
  }
  return source;
}

/**
 * The manifest site of an entry file that is not there, as a positioned
 * VEL6001 — the same code, and the same sentence shape, a missing *imported*
 * module reports. The path is named once, in the message, because the report's
 * own header names `velar.json`.
 */
function missingEntryDeclaration(
  compilation: ProjectCompilation,
  inputPath: string,
  error: unknown,
): ProjectFailure | null {
  const manifest = compilation.options.manifest;
  if (!manifest || inputPath !== compilation.entryPath
    || (!isHostErrorCode(error, "ENOENT") && !isHostErrorCode(error, "ENOTDIR"))) return null;
  const site = projectManifestSite(manifest.text, ["entry"]);
  if (site === null) return null;
  const declared = JSON.parse(manifest.text.slice(site.value.start - 1, site.value.end + 1)) as string;
  return {
    path: manifest.path,
    message: `Entry module ${JSON.stringify(declared)} does not exist`,
    code: "VEL6001",
    span: site.value,
    sourceText: manifest.text,
  };
}

/** One `import json` resource: resolved against its owning package, authorized, and read. */
async function loadJsonModuleResource(
  compilation: ProjectCompilation,
  pendingModule: PendingModule,
  resource: ModuleInspection["resources"][number],
  moduleResourceBoundary: string,
  resourceContents: Map<string, string>,
): Promise<void> {
  const { failures, overrides, ownedResourcePackage, velarPackageResolutionCache, velarPackages } = compilation;
  const { packageTarget, packageCapabilities, resources, resourceImports } = compilation;
  const inputPath = pendingModule.inputPath;
  try {
    const resolved = await resolveJsonResource(
      resource.source,
      inputPath,
      pendingModule.package,
      moduleResourceBoundary,
      ownedResourcePackage,
      velarPackageResolutionCache,
    );
    if (resolved.package_) {
      assertVelarPackageCompatibility(resolved.package_, packageTarget, packageCapabilities);
      registerVelarPackage(velarPackages, resolved.package_);
    }
    const content = await readProjectJsonResource(
      resolved.resource.inputPath,
      resolved.boundary,
      resource.source,
      overrides.get(resolved.resource.inputPath),
    );
    try {
      JSON.parse(content);
    } catch (error) {
      throw new Error(`JSON is invalid: ${hostErrorMessage(error)}`);
    }
    const projectResource: ProjectResource = {
      importerPath: inputPath,
      source: resource.source,
      inputPath: resolved.resource.inputPath,
      content,
      kind: "json",
      packageName: resolved.owner?.name ?? null,
      packageRoot: resolved.owner?.root ?? null,
      packageRelativePath: resolved.resource.relativePath,
      packageSubpath: resolved.resource.subpath,
    };
    const importKey = projectImportKey(inputPath, resource.source);
    resourceContents.set(resource.source, content);
    resourceImports.set(importKey, projectResource);
    const importMode = projectResource.source.startsWith(".") ? "relative" : "package";
    resources.set(`${projectResource.kind}\0${projectResource.inputPath}\0${projectResource.packageSubpath ?? ""}\0${importMode}`, projectResource);
    if (resources.size > MAX_PROJECT_RESOURCES) throw new RangeError(`A project cannot import more than ${MAX_PROJECT_RESOURCES} resources`);
  } catch (error) {
    failures.push({ path: inputPath, message: `Cannot load json resource '${resource.source}': ${hostErrorMessage(error)}` });
  }
}

/** One compiler resource: relative, inside the module's boundary, and singly owned when it is raw CSS. */
async function loadCompilerModuleResource(
  compilation: ProjectCompilation,
  walk: ModuleGraphWalk,
  pendingModule: PendingModule,
  resource: ModuleInspection["resources"][number],
  boundary: string,
  resourceContents: Map<string, string>,
): Promise<void> {
  const { failures, overrides, sourceRoot } = compilation;
  const { canonicalBoundary, unsafeCssOwners } = walk;
  const inputPath = pendingModule.inputPath;
  if (!resource.source.startsWith(".")) {
    failures.push({ path: inputPath, message: `Compiler resource '${resource.source}' must use a relative path` });
    return;
  }
  const target = resolve(dirname(inputPath), resource.source);
  if (escapesRoot(relative(boundary, target))) {
    failures.push({ path: inputPath, message: pendingModule.package
      ? `Resource '${resource.source}' cannot escape VelarScript package '${pendingModule.package.name}'`
      : `Resource '${resource.source}' cannot escape the entry source directory` });
    return;
  }
  let resourceEscapesCanonicalBoundary = false;
  try {
    resourceEscapesCanonicalBoundary = escapesRoot(relative(await canonicalBoundary(boundary), await canonicalizePotentialPath(target)));
  } catch (error) {
    failures.push({ path: inputPath, message: `Cannot authorize ${resource.kind} resource '${resource.source}': ${hostErrorMessage(error)}` });
    return;
  }
  if (resourceEscapesCanonicalBoundary) {
    failures.push({ path: inputPath, message: pendingModule.package
      ? `Resource '${resource.source}' cannot escape VelarScript package '${pendingModule.package.name}'`
      : `Resource '${resource.source}' cannot escape the entry source directory` });
    return;
  }
  if (resource.kind === "unsafe CSS") {
    const owner = unsafeCssOwners.get(target);
    if (owner && owner !== inputPath) {
      failures.push({
        path: inputPath,
        message: `Unsafe CSS resource '${resource.source}' is already imported by '${relative(sourceRoot, owner)}'; each raw stylesheet must have one project owner`,
      });
      return;
    }
    unsafeCssOwners.set(target, inputPath);
  }
  try {
    resourceContents.set(resource.source, overrides.get(target) ?? await readBoundedText(target, 4 * 1024 * 1024, `${resource.kind} resource '${resource.source}'`));
  } catch (error) {
    failures.push({ path: inputPath, message: `Cannot load ${resource.kind} resource '${resource.source}': ${hostErrorMessage(error)}` });
  }
}

/** Every resource one module declares, as the exact bytes its checked compile receives. */
async function loadModuleResources(
  compilation: ProjectCompilation,
  walk: ModuleGraphWalk,
  pendingModule: PendingModule,
  inspection: ModuleInspection,
  boundaries: AuthorizedModulePath,
): Promise<Map<string, string>> {
  const resourceContents = new Map<string, string>();
  for (const resource of inspection.resources) {
    if (resource.kind === "json") {
      await loadJsonModuleResource(compilation, pendingModule, resource, boundaries.moduleResourceBoundary, resourceContents);
      continue;
    }
    await loadCompilerModuleResource(compilation, walk, pendingModule, resource, boundaries.boundary, resourceContents);
  }
  return resourceContents;
}

/** A non-relative specifier: a standard module, a retired one, a malformed one, or an installed package. */
async function recordPackageDependency(
  compilation: ProjectCompilation,
  walk: ModuleGraphWalk,
  pendingModule: PendingModule,
  dependency: ModuleInspection["dependencies"][number],
): Promise<void> {
  const { failures, recordResolution, packageTarget, packageCapabilities, capabilities, framework } = compilation;
  const { extensionConfig, compilerExtensions, velarPackages, velarPackageResolutionCache } = compilation;
  const { velarImports, velarArtifactInterfaces, velarArtifactImports } = compilation;
  const { enqueue, importOrigins } = walk;
  const inputPath = pendingModule.inputPath;
  if (handleStandardModuleTarget(dependency.source, inputPath, failures, recordResolution, packageTarget,
    capabilities.has("web") || framework?.host.target === "browser", extensionConfig, compilerExtensions)) return;
  // MOD-U6: `velar/` is the language's own prefix; an unknown name in
  // it lists the modules that exist instead of npm-subpath noise.
  if (dependency.source === "velar" || dependency.source.startsWith("velar/")) {
    const migratedStandard = migratedStandardPackageDiagnostic(dependency.source);
    if (migratedStandard) {
      recordResolution(inputPath, dependency.source, "VEL6003", migratedStandard);
      return;
    }
    const interfaces = standardModuleInterfaces(compilerExtensions);
    const available = [...interfaces.keys()].sort();
    const near = nearestName(dependency.source, available);
    recordResolution(
      inputPath,
      dependency.source,
      "VEL6003",
      `Unknown standard module ${JSON.stringify(dependency.source)}${near ? `; did you mean ${JSON.stringify(near)}?` : ""} The standard modules are: ${available.map((module) => standardModuleListing(module, interfaces)).join(", ")}`,
    );
    return;
  }
  const migrated = migratedStandardPackageDiagnostic(dependency.source);
  if (migrated) {
    recordResolution(inputPath, dependency.source, "VEL6002", migrated);
    return;
  }
  // MOD-U5: the two malformed non-package shapes each teach the
  // relative spelling instead of falling into package resolution.
  if (isAbsolute(dependency.source)) {
    recordResolution(
      inputPath,
      dependency.source,
      "VEL6002",
      `Module paths are relative to the importing file; write './name.vel' — an absolute path is not a portable project input`,
    );
    return;
  }
  if (dependency.source.endsWith(".vel")) {
    recordResolution(
      inputPath,
      dependency.source,
      "VEL6002",
      `Import ${JSON.stringify(`./${dependency.source}`)}; a module path without './' names an installed package, not a file`,
    );
    return;
  }
  try {
    const resolvedPackage = await resolveVelarSourcePackage(dependency.source, inputPath, packageTarget, packageCapabilities, velarPackageResolutionCache);
    const package_ = registerVelarPackage(velarPackages, resolvedPackage.package_);
    const importKey = projectImportKey(inputPath, dependency.source);
    if (resolvedPackage.artifact) {
      velarArtifactInterfaces.set(importKey, resolvedPackage.artifact.moduleInterface);
      velarArtifactImports.set(importKey, resolvedPackage.artifact);
    } else {
      velarImports.set(importKey, resolvedPackage.entry.inputPath);
      importOrigins.set(resolvedPackage.entry.inputPath, { importer: inputPath, source: dependency.source });
      enqueue({ inputPath: resolvedPackage.entry.inputPath, package: package_ });
    }
  } catch (error) {
    if (error instanceof JavaScriptOnlyPackageError) {
      recordResolution(
        inputPath,
        dependency.source,
        "VEL6002",
        `'${dependency.source}' is a JavaScript package, not a VelarScript package; reach it across the bridge — import js {name} from ${JSON.stringify(dependency.source)}, and declare 'extern module ${JSON.stringify(dependency.source)}:' when you want the contract checked`,
      );
      return;
    }
    recordResolution(inputPath, dependency.source, "VEL6002", `Cannot resolve VelarScript package import '${dependency.source}': ${hostErrorMessage(error)}`);
  }
}

/** One dependency edge of one module: recorded, diagnosed, or scheduled for the walk. */
async function recordModuleDependency(
  compilation: ProjectCompilation,
  walk: ModuleGraphWalk,
  pendingModule: PendingModule,
  dependency: ModuleInspection["dependencies"][number],
  boundary: string,
): Promise<void> {
  const { recordResolution, javascriptDependencies } = compilation;
  const { enqueue, importOrigins } = walk;
  const inputPath = pendingModule.inputPath;
  if (dependency.resource) return;
  if (dependency.javascript) {
    await checkJavaScriptDependency(dependency.source, inputPath, javascriptDependencies);
    return;
  }
  if (!dependency.source.startsWith(".")) {
    await recordPackageDependency(compilation, walk, pendingModule, dependency);
    return;
  }
  if (extname(dependency.source) !== ".vel") {
    recordResolution(inputPath, dependency.source, "VEL6001", `VelarScript import '${dependency.source}' must use the .vel extension`);
    return;
  }
  const target = resolve(dirname(inputPath), dependency.source);
  // MOD-D3 / MOD-U8: a module cannot import (or re-export) from itself.
  // The self edge evades the initialization-cycle checker — evaluation
  // order cannot place a module after itself — so the binding crashed
  // with a raw ReferenceError at run time.
  if (target === inputPath) {
    recordResolution(
      inputPath,
      dependency.source,
      "VEL6004",
      dependency.reExport
        ? "A module cannot re-export from itself; declare the binding under the exported name instead"
        : "A module cannot import from itself; use the declaration directly (rename it if the import was an alias)",
    );
    return;
  }
  if (escapesRoot(relative(boundary, target))) {
    recordResolution(inputPath, dependency.source, "VEL6001", pendingModule.package
      ? `Relative import '${dependency.source}' cannot escape VelarScript package '${pendingModule.package.name}'`
      : `Relative import '${dependency.source}' cannot escape the entry source directory`);
    return;
  }
  if (!importOrigins.has(target)) importOrigins.set(target, { importer: inputPath, source: dependency.source });
  enqueue({ inputPath: target, package: pendingModule.package });
}

/**
 * Phase two: the module graph. Starting at the entry roots, every module is
 * authorized, read, inspected and recorded, and each of its dependencies is
 * either diagnosed here or scheduled behind it.
 */
export async function discoverProjectModules(compilation: ProjectCompilation): Promise<void> {
  const { entryPath, failures, loaded, sourceRoot, compilerExtensions } = compilation;
  const walk = createModuleGraphWalk(compilation);
  const { pending, visited } = walk;
  // An index cursor, not `shift()`: the queue is bounded by
  // MAX_VELAR_PROJECT_MODULES, and shifting each of those entries off the
  // front costs O(n) apiece, making the dependency walk itself quadratic.
  for (let cursor = 0; cursor < pending.length; cursor += 1) {
    const pendingModule = pending[cursor]!;
    const inputPath = pendingModule.inputPath;
    if (visited.has(inputPath)) continue;
    if (visited.size >= MAX_VELAR_PROJECT_MODULES) {
      failures.push({ path: entryPath, message: `A VelarScript project cannot contain more than ${MAX_VELAR_PROJECT_MODULES} source modules` });
      break;
    }
    visited.add(inputPath);
    const authorized = await authorizeModulePath(compilation, walk, pendingModule);
    if (authorized === null) continue;
    const { boundary, pathWithinBoundary, canonicalInput } = authorized;
    const source = await loadModuleSource(compilation, walk, inputPath, canonicalInput);
    if (source === null) continue;
    const { text, sha256: sourceSha256 } = source;
    const relativePath = normalizeModulePath(pendingModule.package
      ? join("__velar_packages__", pendingModule.package.name, pathWithinBoundary)
      : relative(sourceRoot, inputPath));
    const inspection = inspectModule(text, { path: inputPath, extensions: compilerExtensions });
    const resourceContents = await loadModuleResources(compilation, walk, pendingModule, inspection, authorized);
    loaded.set(inputPath, { inputPath, relativePath, text, sourceSha256, inspection, package: pendingModule.package, resourceContents });

    for (const dependency of inspection.dependencies) {
      await recordModuleDependency(compilation, walk, pendingModule, dependency, boundary);
    }
  }
}
