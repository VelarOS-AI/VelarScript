import { chmod, copyFile, mkdir, realpath, stat } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";

const desktopPackageTemplateEnvironment = "VELAR_DESKTOP_PACKAGE_TEMPLATE_ROOT";

/**
 * A self-contained Desktop installation rebuilds only the target renderer.
 * Its official tools are immutable versioned inputs, so nested packaging
 * copies them from the Worker-validated application template instead of
 * looking for compiler sources or node_modules outside the package.
 */
export async function copyPackagedOfficialTool(
  outputFile: string,
  bundledRelativePath: string,
  mode: number,
): Promise<boolean> {
  const value = process.env[desktopPackageTemplateEnvironment];
  if (value === undefined) return false;
  if (!isAbsolute(value) || value.length > 4096 || value.includes("\0")) {
    throw new Error(`${desktopPackageTemplateEnvironment} must be a bounded absolute Desktop Resources path`);
  }
  const root = await realpath(value);
  const source = await realpath(join(root, bundledRelativePath));
  const fromRoot = relative(root, source);
  if (fromRoot === "" || fromRoot === ".." || fromRoot.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) || isAbsolute(fromRoot)) {
    throw new Error("Packaged official tool must stay inside the Desktop Resources template");
  }
  const information = await stat(source);
  if (!information.isFile()) throw new Error("Packaged official tool must be an ordinary file");
  outputFile = resolve(outputFile);
  await mkdir(dirname(outputFile), { recursive: true });
  await copyFile(source, outputFile);
  await chmod(outputFile, mode);
  return true;
}
