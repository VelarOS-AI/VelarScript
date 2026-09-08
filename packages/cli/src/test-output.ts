import { mkdir, mkdtemp, rm, rmdir, writeFile } from "node:fs/promises";
import { basename, dirname, join, relative } from "node:path";
import { requiredCompilerRuntimeModules } from "./compiler-runtime-modules.ts";
import type { ProjectModule, ProjectResult } from "./project.ts";
import { assertUniqueEmbeddedModuleOutputs, embeddedModuleFileContents, embeddedModuleOutputPath } from "./embedded-modules.ts";
import { copyPackageImportTargets, readProjectPackageImports, writePackageImportSnapshot } from "./package-import-sandbox.ts";
import { assemblePackageOutput, writePackageOutputManifests, type PackageOutputAssembly } from "./package-output-assembler.ts";
import { projectModuleOutputRelativePath } from "./package-output-layout.ts";
import { assertProjectOutputNamespace } from "./project-output-namespace.ts";
import { rewriteProjectResourceImports, writeProjectPackageContents, writeProjectResources } from "./resource-output.ts";
import { snapshotSourcePackageImports, type SourcePackageImportSnapshots, type SourcePackageImportsSnapshot } from "./source-package-imports.ts";

/**
 * D51 rule 105: the verdict line is the last link in the trust chain, so what
 * it says has to be true. Author text — a test name, a module path — reaches it
 * verbatim today, and a `test "\u{202E}…"` reorders a failing line into a
 * passing one on any bidi-aware terminal. The source-level ban (rule 104) does
 * not cover this: an escape sequence puts the very same code point in the
 * string at runtime.
 *
 * The output is a JSON string literal — the escaping the compiler's own
 * duplicate-name diagnostic already applies — plus the twelve `Bidi_Control`
 * code points, which `JSON.stringify` passes through untouched and which are
 * the whole hazard.
 */
const bidirectionalControls = /[\u061C\u200E\u200F\u202A-\u202E\u2066-\u2069]/gu;

export function quoteReportedText(value: string): string {
  return JSON.stringify(value).replaceAll(
    bidirectionalControls,
    (character) => `\\u${character.codePointAt(0)!.toString(16).toUpperCase().padStart(4, "0")}`,
  );
}

/** Paths printed by VelarScript are a portable author-facing protocol. */
export function portablePath(value: string): string {
  return value.replaceAll("\\", "/");
}

/**
 * Creates the sandbox directory that receives a compiled test or run tree.
 *
 * The sandbox lives inside the project (`<project>/.velar/<prefix>-*`), not in
 * os.tmpdir(): Node resolves bare JavaScript imports by walking node_modules
 * directories upward from the importing file, so a compiled tree inside the
 * project still reaches the project's real npm dependencies (bridged
 * `import js` packages), while an os.tmpdir() sandbox severs that resolution.
 * The directory is removed after the run; `.velar/` should be gitignored.
 */
export async function createCompiledSandboxDirectory(projectRoot: string, prefix: "test" | "run" | "dev" | "serve"): Promise<string> {
  const velarRoot = join(projectRoot, ".velar");
  await mkdir(velarRoot, { recursive: true });
  return mkdtemp(join(velarRoot, `${prefix}-`));
}

/** Prepares the root native scope for run hosts that materialize modules incrementally. */
export async function createCompiledSandbox(projectRoot: string, prefix: "test" | "run" | "dev" | "serve"): Promise<string> {
  const sandbox = await createCompiledSandboxDirectory(projectRoot, prefix);
  try {
    // The compiled tree is always ES modules, regardless of the project's own
    // package.json "type" field.
    const imports = await readProjectPackageImports(projectRoot);
    await writeFile(join(sandbox, "package.json"), JSON.stringify({
      name: `velar-${prefix}`,
      private: true,
      type: "module",
      ...(imports ? { imports } : {}),
    }), "utf8");
    if (imports) await copyPackageImportTargets(projectRoot, sandbox, imports);
    return sandbox;
  } catch (error) {
    await removeCompiledSandbox(sandbox);
    throw error;
  }
}

/** Removes a compiled sandbox and prunes `.velar/` when it becomes empty. */
export async function removeCompiledSandbox(sandbox: string): Promise<void> {
  await rm(sandbox, { recursive: true, force: true });
  try {
    await rmdir(dirname(sandbox));
  } catch {
    // Another run is active or `.velar` holds other entries; leave it in place.
  }
}

export async function writeCompiledTestProject(
  project: ProjectResult,
  outputRoot: string,
  sourceMaps = true,
  runtimeModules: ReadonlySet<string> = requiredCompilerRuntimeModules(project),
): Promise<void> {
  await writeCompiledTestProjectPlan(await prepareCompiledTestProject(project, outputRoot, sourceMaps, runtimeModules));
}

export interface CompiledTestProjectPlan {
  readonly project: ProjectResult;
  readonly outputRoot: string;
  readonly sourceMaps: boolean;
  readonly runtimeModules: ReadonlySet<string>;
  readonly sourceImports: SourcePackageImportsSnapshot;
  readonly packageAssembly: PackageOutputAssembly;
}

/** Captures native inputs and checks all output owners before any materialization. */
export async function prepareCompiledTestProject(
  project: ProjectResult,
  outputRoot: string,
  sourceMaps = true,
  runtimeModules: ReadonlySet<string> = requiredCompilerRuntimeModules(project),
  snapshots?: SourcePackageImportSnapshots,
): Promise<CompiledTestProjectPlan> {
  const sourceImports = await snapshotSourcePackageImports(project, outputRoot, snapshots);
  const packageAssembly = assemblePackageOutput({
    outputRoot,
    layout: "sandbox",
    runtimeModules,
    project,
    packageImports: sourceImports.imports,
  });
  assertProjectOutputNamespace(project, {
    outputRoot,
    layout: "sandbox",
    sourceMaps,
    moduleOutputPath: (module) => compiledTestModulePath(project, module, outputRoot),
    packageAssembly,
    additionalClaims: [
      { path: join(outputRoot, "package.json"), kind: "file", owner: "sandbox package manifest" },
      ...sourceImports.claims,
    ],
  });
  return {project, outputRoot, sourceMaps, runtimeModules, sourceImports, packageAssembly};
}

/** Writes only a previously checked graph, including its root npm resolution scope. */
export async function writeCompiledTestProjectPlan(plan: CompiledTestProjectPlan): Promise<void> {
  const {project, outputRoot, sourceMaps, runtimeModules, sourceImports, packageAssembly} = plan;
  await mkdir(outputRoot, {recursive: true});
  await writeFile(join(outputRoot, "package.json"), JSON.stringify({
    name: "velar-compiled", private: true, type: "module",
    ...(sourceImports.projectImports ? {imports: sourceImports.projectImports} : {}),
  }), "utf8");
  await writePackageImportSnapshot(outputRoot, sourceImports.files);
  await writeProjectResources(project, outputRoot, "sandbox", "readable", packageAssembly.runtimePackageNames);
  await writeProjectPackageContents(
    project,
    outputRoot,
    "sandbox",
    "readable",
    sourceMaps,
    runtimeModules,
    packageAssembly.runtimePackageNames,
  );
  assertUniqueEmbeddedModuleOutputs(project.modules.map((module) => ({
    ownerPath: compiledTestModulePath(project, module, outputRoot),
    embeddedModules: module.result.embeddedModules,
  })));
  for (const module of project.modules) {
    const output = compiledTestModulePath(project, module, outputRoot);
    await mkdir(dirname(output), { recursive: true });
    const rewritten = rewriteProjectResourceImports(
      project,
      module,
      module.result.code ?? "",
      "sandbox",
      relative(outputRoot, output).replaceAll("\\", "/"),
      packageAssembly.runtimePackageNames,
    );
    const code = sourceMaps
      ? `${rewritten}//# sourceMappingURL=${basename(output)}.map\n`
      : rewritten;
    await writeFile(output, code, "utf8");
    if (sourceMaps) await writeFile(`${output}.map`, module.result.sourceMap ?? "", "utf8");
    for (const embedded of module.result.embeddedModules) {
      const embeddedPath = embeddedModuleOutputPath(output, embedded.specifier);
      await writeFile(embeddedPath, sourceMaps ? embeddedModuleFileContents(embeddedPath, embedded) : embedded.code, "utf8");
      if (sourceMaps) await writeFile(`${embeddedPath}.map`, embedded.sourceMap, "utf8");
    }
  }
  await writePackageOutputManifests(packageAssembly);
}

export function compiledTestModulePath(project: ProjectResult, module: ProjectModule, outputRoot: string): string {
  return join(outputRoot, projectModuleOutputRelativePath(project, module, "sandbox", new Set()));
}
