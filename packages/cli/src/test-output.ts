import { mkdir, mkdtemp, readFile, rm, rmdir, writeFile } from "node:fs/promises";
import { basename, dirname, join, relative } from "node:path";
import type { ProjectModule, ProjectResult, VelarSourcePackage } from "./project.ts";
import { assertUniqueEmbeddedModuleOutputs, embeddedModuleFileContents, embeddedModuleOutputPath } from "./embedded-modules.ts";
import { usedPackageResourceExports, writeProjectResources } from "./resource-output.ts";

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
export async function createCompiledSandbox(projectRoot: string, prefix: "test" | "run" | "dev" | "serve"): Promise<string> {
  const velarRoot = join(projectRoot, ".velar");
  await mkdir(velarRoot, { recursive: true });
  const sandbox = await mkdtemp(join(velarRoot, `${prefix}-`));
  // The compiled tree is always ES modules, regardless of the project's own
  // package.json "type" field.
  const imports = await projectPackageImports(projectRoot);
  await writeFile(join(sandbox, "package.json"), JSON.stringify({
    name: `velar-${prefix}`,
    private: true,
    type: "module",
    ...(imports ? { imports } : {}),
  }), "utf8");
  return sandbox;
}

async function projectPackageImports(projectRoot: string): Promise<Record<string, unknown> | null> {
  try {
    const manifest = JSON.parse(await readFile(join(projectRoot, "package.json"), "utf8")) as { readonly imports?: unknown };
    return manifest.imports !== null && typeof manifest.imports === "object" && !Array.isArray(manifest.imports)
      ? manifest.imports as Record<string, unknown>
      : null;
  } catch {
    return null;
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

export async function writeCompiledTestProject(project: ProjectResult, outputRoot: string, sourceMaps = true): Promise<void> {
  await writeProjectResources(project, outputRoot, "sandbox");
  // A frozen package stays a bare ESM import and resolves to its installed
  // package.json#exports. Shadow manifests are only for compiled source
  // fallback; writing one for an artifact would hide the very JS entry the
  // package published.
  for (const package_ of project.velarPackages) {
    if (package_.artifact === null) await writePackageManifest(project, package_, outputRoot);
  }
  assertUniqueEmbeddedModuleOutputs(project.modules.map((module) => ({
    ownerPath: compiledTestModulePath(project, module, outputRoot),
    embeddedModules: module.result.embeddedModules,
  })));
  for (const module of project.modules) {
    const output = compiledTestModulePath(project, module, outputRoot);
    await mkdir(dirname(output), { recursive: true });
    const code = sourceMaps
      ? `${module.result.code ?? ""}//# sourceMappingURL=${basename(output)}.map\n`
      : module.result.code ?? "";
    await writeFile(output, code, "utf8");
    if (sourceMaps) await writeFile(`${output}.map`, module.result.sourceMap ?? "", "utf8");
    for (const embedded of module.result.embeddedModules) {
      const embeddedPath = embeddedModuleOutputPath(output, embedded.specifier);
      await writeFile(embeddedPath, sourceMaps ? embeddedModuleFileContents(embeddedPath, embedded) : embedded.code, "utf8");
      if (sourceMaps) await writeFile(`${embeddedPath}.map`, embedded.sourceMap, "utf8");
    }
  }
}

export function compiledTestModulePath(project: ProjectResult, module: ProjectModule, outputRoot: string): string {
  const package_ = packageForModule(project, module.inputPath);
  if (!package_) return join(outputRoot, module.relativePath.replace(/\.vel$/u, ".js"));
  return join(outputRoot, "node_modules", ...package_.name.split("/"), compiledRelativePath(package_.root, module.inputPath));
}

function packageForModule(project: ProjectResult, inputPath: string): VelarSourcePackage | null {
  for (const package_ of project.velarPackages) {
    const path = relative(package_.root, inputPath);
    if (path === "" || (!path.startsWith("..") && !path.startsWith("/"))) return package_;
  }
  return null;
}

async function writePackageManifest(project: ProjectResult, package_: VelarSourcePackage, outputRoot: string): Promise<void> {
  const root = join(outputRoot, "node_modules", ...package_.name.split("/"));
  const entry = `./${compiledRelativePath(package_.root, package_.entryPath).replaceAll("\\", "/")}`;
  const resources = usedPackageResourceExports(project, package_.name);
  await mkdir(root, { recursive: true });
  await writeFile(join(root, "package.json"), JSON.stringify({
    name: package_.name,
    private: true,
    type: "module",
    main: entry,
    exports: Object.keys(resources).length === 0 ? entry : { ".": entry, ...resources },
  }), "utf8");
}

function compiledRelativePath(root: string, inputPath: string): string {
  return relative(root, inputPath).replace(/\.vel$/u, ".js");
}
