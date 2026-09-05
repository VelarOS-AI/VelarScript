import { mkdir, mkdtemp, readFile, rm, rmdir, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import type { ProjectModule, ProjectResult, VelarSourcePackage } from "./project.ts";
import { assertUniqueEmbeddedModuleOutputs, embeddedModuleFileContents, embeddedModuleOutputPath } from "./embedded-modules.ts";
import { importSpecifierSites } from "./module-assets.ts";
import { writeProjectResources, writeSandboxPackageManifests } from "./resource-output.ts";

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
  if (imports) await copyPackageImportTargets(projectRoot, sandbox, imports);
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

/** Every string leaf of an `imports` target: a plain path, a fallback array, or a conditions object. */
function packageImportTargets(value: unknown): readonly string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(packageImportTargets);
  if (value !== null && typeof value === "object") return Object.values(value).flatMap(packageImportTargets);
  return [];
}

/**
 * Brings the files a relative `#` import target names into the sandbox.
 *
 * The manifest is copied verbatim, and that is right for a target that names a
 * package: the sandbox lives inside the project precisely so Node's upward
 * `node_modules` walk still reaches the project's real installation. A target
 * that names a *path* has no such fallback — it is anchored to the manifest's
 * own directory, which is now the sandbox — so `velar test` and `velar run`
 * used to fail to resolve a `#` specifier that `velar check` and `velar build`
 * both resolve, because those two resolve from the real importer instead.
 *
 * The file is mirrored at its project-relative path so its own relative imports
 * keep their meaning without a byte being rewritten, and those imports are
 * followed, because a target's neighbours are as necessary to it as the target
 * is to the compiled tree. Bare and `#` specifiers inside a copied file are not
 * followed: those resolve exactly as they did before, through the upward walk
 * and through this same manifest. A target that resolves outside the project is
 * skipped rather than mirrored somewhere it does not belong — Node rejects that
 * shape itself, since an `imports` target may not escape its package.
 */
async function copyPackageImportTargets(projectRoot: string, sandbox: string, imports: Record<string, unknown>): Promise<void> {
  const pending = Object.values(imports)
    .flatMap(packageImportTargets)
    .filter((target) => target.startsWith("./") || target.startsWith("../"))
    .map((target) => resolve(projectRoot, target));
  const copied = new Set<string>();
  const velarRoot = join(projectRoot, ".velar");
  while (pending.length > 0) {
    const source = pending.pop()!;
    if (copied.has(source)) continue;
    const inside = relative(projectRoot, source);
    if (inside.startsWith("..") || isAbsolute(inside) || source === velarRoot || source.startsWith(`${velarRoot}${sep}`)) continue;
    let contents: Buffer;
    try {
      contents = await readFile(source);
    } catch {
      // A target that does not exist is the project's own defect, and the
      // resolution failure names it far better than a copier could.
      continue;
    }
    copied.add(source);
    const output = join(sandbox, inside);
    await mkdir(dirname(output), { recursive: true });
    await writeFile(output, contents);
    if (!/\.[cm]?js$/u.test(source)) continue;
    for (const site of importSpecifierSites(contents.toString("utf8"))) {
      if (site.source.startsWith("./") || site.source.startsWith("../")) pending.push(resolve(dirname(source), site.source));
    }
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
  await writeSandboxPackageManifests(project, outputRoot);
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

function compiledRelativePath(root: string, inputPath: string): string {
  return relative(root, inputPath).replace(/\.vel$/u, ".js");
}
