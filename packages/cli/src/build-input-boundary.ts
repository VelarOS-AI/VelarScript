import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { canonicalizePotentialPath } from "./canonical-path.ts";
import type { VelarProjectConfig } from "./config.ts";
import {
  enclosingInstalledPackage,
  installedPackageTreeClosure,
} from "./installed-package-closure.ts";
import type { ProjectResult } from "./project.ts";
import { projectSessionDependencyInputs } from "./project-session-inputs.ts";
import { installedJavaScriptPackageRoot, standaloneJavaScriptDependencyEntryPaths } from "./standalone-build.ts";
import { standardModuleSources } from "./standard-modules.ts";

export interface BuildOutputClaim {
  readonly path: string;
  /** A tree claim replaces everything below its path; a file claim replaces only that identity. */
  readonly kind: "file" | "tree";
}

export interface AdditionalBuildInput {
  readonly path: string;
  readonly kind: "file" | "tree";
  readonly label: string;
}

/** Inputs owned by project resolution but not carried directly on ProjectResult. */
export async function directoryBuildInputs(
  config: VelarProjectConfig,
  projects: readonly ProjectResult[],
): Promise<AdditionalBuildInput[]> {
  return [
    ...projectContractInputs(config),
    ...await toolchainBuildInputs(config),
    ...await frozenArtifactPackageBuildInputs(projects),
    ...javascriptBuildInputs(
      projects.flatMap((project) => {
        const compilerOwnedModules = new Set(standardModuleSources(project.compilerExtensions).keys());
        return project.modules.flatMap((module) => standaloneJavaScriptDependencyEntryPaths(
          module.result,
          compilerOwnedModules,
        ));
      }),
      "JavaScript dependency",
    ),
  ];
}

/** Complete runtime package trees owned by every selected frozen artifact. */
async function frozenArtifactPackageBuildInputs(
  projects: readonly ProjectResult[],
): Promise<AdditionalBuildInput[]> {
  const seeds = new Map<string, { readonly manifestPath: string; readonly label: string }>();
  for (const project of projects) {
    for (const package_ of project.velarPackages) {
      if (package_.artifacts.size === 0) continue;
      const manifestPath = join(package_.root, "package.json");
      seeds.set(resolve(manifestPath), {
        manifestPath,
        label: `frozen package '${package_.name}'`,
      });
    }
  }
  if (seeds.size === 0) return [];
  const packages = await installedPackageTreeClosure(
    [...seeds.values()],
    { includeInstalledPeers: true },
  );
  return packages.map((package_) => ({ path: package_.path, kind: "tree", label: package_.label }));
}

/**
 * Package trees loaded by the build host are immutable inputs too. Start with
 * the CLI package and the exact extension graph selected for this project,
 * then close over their installed runtime dependencies. This derives esbuild's
 * native helper and framework-owned packages such as ws/yaml from manifests,
 * so a newly added tool dependency receives the same protection automatically.
 */
export async function toolchainBuildInputs(config: VelarProjectConfig): Promise<AdditionalBuildInput[]> {
  const cli = await enclosingInstalledPackage(fileURLToPath(import.meta.url), "@velarscript/cli");
  const packages = await installedPackageTreeClosure([
    { manifestPath: cli.manifestPath, label: "VelarScript CLI package" },
    ...config.extensionGraph.map((item) => ({
      manifestPath: item.manifestPath,
      label: `compiler extension '${item.name}'`,
    })),
  ]);
  return packages.map((package_) => ({ path: package_.path, kind: "tree", label: package_.label }));
}

/** Manifest-backed projects reserve both their Velar and npm contract files as author inputs. */
export function projectContractInputs(config: VelarProjectConfig): AdditionalBuildInput[] {
  if (config.manifestPath === null) return [];
  return [
    { path: config.manifestPath, kind: "file", label: "project manifest" },
    { path: join(config.root, "package.json"), kind: "file", label: "project package manifest" },
  ];
}

/** Ordinary JavaScript files and their installed package ownership trees. */
export function javascriptBuildInputs(paths: readonly string[], label: string): AdditionalBuildInput[] {
  return paths.flatMap((path) => {
    const packageRoot = installedJavaScriptPackageRoot(path);
    return [
      { path, kind: "file" as const, label },
      ...(packageRoot ? [{ path: packageRoot, kind: "tree" as const, label: `${label} package` }] : []),
    ];
  });
}

/**
 * A directory build replaces its destination as one transaction. Authorize
 * every checked input against that destructive sink before staging begins, so
 * neither an outDir declaration nor `--out-dir --force` can turn source into
 * replaceable build output through lexical spelling or a symbolic link.
 */
export async function assertBuildInputsOutsideOutput(
  project: ProjectResult,
  outputDirectory: string,
  additionalInputs: readonly AdditionalBuildInput[] = [],
): Promise<void> {
  const output = resolve(outputDirectory);
  const inputs = checkedBuildInputs(project, additionalInputs);
  for (const input of inputs.values()) {
    if (contains(output, input.path) || input.kind === "tree" && contains(input.path, output)) refuse(output, input.path);
  }

  const canonicalOutput = await canonicalizePotentialPath(output);
  const canonicalInputs = await Promise.all([...inputs.values()].map(async (input) => ({
    input,
    identity: await canonicalizePotentialPath(input.path),
  })));
  for (const { input, identity } of canonicalInputs) {
    if (contains(canonicalOutput, identity) || input.kind === "tree" && contains(identity, canonicalOutput)) refuse(output, input.path);
  }

  const publicRoot = resolve(project.publicRoot);
  const canonicalPublicRoot = await canonicalizePotentialPath(publicRoot);
  if (contains(output, publicRoot) || contains(publicRoot, output)
    || contains(canonicalOutput, canonicalPublicRoot) || contains(canonicalPublicRoot, canonicalOutput)) {
    throw new Error(`refusing to replace '${output}': it overlaps public assets '${publicRoot}'`);
  }
}

/** A single-file build writes in place rather than replacing a directory. */
export async function assertBuildFilesOutsideInputs(project: ProjectResult, outputs: readonly string[]): Promise<void> {
  await assertBuildOutputClaimsOutsideInputs(project, outputs.map((path) => ({ path, kind: "file" })));
}

/**
 * Authorizes the complete mutation set of a single-file build immediately
 * before its staged files are installed. This includes sources plus every
 * manifest, frozen artifact, type declaration, JSON/CSS resource, and other
 * byte sequence that participated in the checked result.
 */
export async function assertBuildOutputClaimsOutsideInputs(
  project: ProjectResult,
  claims: readonly BuildOutputClaim[],
  additionalInputs: readonly AdditionalBuildInput[] = [],
): Promise<void> {
  const normalized = claims.map((claim) => ({ ...claim, path: resolve(claim.path) }));
  assertDistinctClaims(normalized, normalized.map((claim) => claim.path));

  const canonicalClaims = await Promise.all(normalized.map(async (claim) => ({
    ...claim,
    canonicalPath: await canonicalizePotentialPath(claim.path),
  })));
  assertDistinctClaims(canonicalClaims, canonicalClaims.map((claim) => claim.canonicalPath));

  const inputs = checkedBuildInputs(project, additionalInputs);
  const canonicalInputs = await Promise.all([...inputs.values()].map(async (input) => ({
    ...input,
    canonicalPath: await canonicalizePotentialPath(input.path),
  })));
  for (const claim of normalized) {
    for (const input of inputs.values()) {
      if (claimHitsInput(claim, claim.path, input, input.path)) refuseClaim(claim.path, input.path, input.label);
    }
  }
  for (const claim of canonicalClaims) {
    for (const input of canonicalInputs) {
      if (claimHitsInput(claim, claim.canonicalPath, input, input.canonicalPath)) {
        refuseClaim(claim.path, input.path, input.label);
      }
    }
  }
}

function checkedBuildInputs(
  project: ProjectResult,
  additionalInputs: readonly AdditionalBuildInput[] = [],
): ReadonlyMap<string, AdditionalBuildInput> {
  const inputs = new Map<string, AdditionalBuildInput>();
  const add = (path: string, label: string, kind: AdditionalBuildInput["kind"] = "file"): void => {
    const normalized = resolve(path);
    const existing = inputs.get(normalized);
    if (!existing || existing.kind === "file" && kind === "tree") inputs.set(normalized, { path: normalized, label, kind });
  };
  for (const module of project.modules) add(module.inputPath, "source");
  for (const input of projectSessionDependencyInputs(project).values()) add(input.path, input.kind);
  for (const module of project.modules) {
    for (const resource of module.result.resources) {
      if (resource.source.startsWith(".")) add(resolve(dirname(module.inputPath), resource.source), "compiler resource");
    }
  }
  for (const input of additionalInputs) add(input.path, input.label, input.kind);
  return inputs;
}

function assertDistinctClaims(claims: readonly BuildOutputClaim[], identities: readonly string[]): void {
  for (let leftIndex = 0; leftIndex < claims.length; leftIndex += 1) {
    const left = claims[leftIndex]!;
    const leftPath = identities[leftIndex]!;
    for (let rightIndex = leftIndex + 1; rightIndex < claims.length; rightIndex += 1) {
      const right = claims[rightIndex]!;
      const rightPath = identities[rightIndex]!;
      if (leftPath === rightPath
        || left.kind === "tree" && contains(leftPath, rightPath)
        || right.kind === "tree" && contains(rightPath, leftPath)) {
        throw new Error(`build output claims '${left.path}' and '${right.path}' overlap`);
      }
    }
  }
}

function claimHitsInput(
  claim: BuildOutputClaim,
  claimPath: string,
  input: AdditionalBuildInput,
  inputPath: string,
): boolean {
  return claimPath === inputPath || claim.kind === "tree" && contains(claimPath, inputPath)
    || input.kind === "tree" && contains(inputPath, claimPath);
}

function refuseClaim(output: string, input: string, label: string): never {
  throw new Error(`refusing to write '${output}': it overlaps checked ${label} '${input}'`);
}

function contains(root: string, candidate: string): boolean {
  const fromRoot = relative(root, candidate);
  return fromRoot === "" || (fromRoot !== ".." && !fromRoot.startsWith("../")
    && !fromRoot.startsWith("..\\") && !isAbsolute(fromRoot));
}

function refuse(output: string, input: string): never {
  throw new Error(`refusing to replace '${output}': it contains checked input '${input}'`);
}
