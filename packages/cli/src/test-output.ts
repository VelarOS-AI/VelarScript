import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import type { ProjectModule, ProjectResult, VelarSourcePackage } from "./project.ts";

export async function writeCompiledTestProject(project: ProjectResult, outputRoot: string): Promise<void> {
  for (const package_ of project.velarPackages) await writePackageManifest(package_, outputRoot);
  for (const module of project.modules) {
    const output = compiledTestModulePath(project, module, outputRoot);
    await mkdir(dirname(output), { recursive: true });
    await writeFile(output, `${module.result.code ?? ""}//# sourceMappingURL=${output.split("/").at(-1)}.map\n`, "utf8");
    await writeFile(`${output}.map`, module.result.sourceMap ?? "", "utf8");
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

async function writePackageManifest(package_: VelarSourcePackage, outputRoot: string): Promise<void> {
  const root = join(outputRoot, "node_modules", ...package_.name.split("/"));
  const entry = `./${compiledRelativePath(package_.root, package_.entryPath).replaceAll("\\", "/")}`;
  await mkdir(root, { recursive: true });
  await writeFile(join(root, "package.json"), JSON.stringify({
    name: package_.name,
    private: true,
    type: "module",
    main: entry,
    exports: entry,
  }), "utf8");
}

function compiledRelativePath(root: string, inputPath: string): string {
  return relative(root, inputPath).replace(/\.vel$/u, ".js");
}
