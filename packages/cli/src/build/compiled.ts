/**
 * One checked module's output — its JavaScript, its source map, its embedded
 * modules and its stylesheet — and the bounded fan-out every directory writer
 * maps its modules with.
 *
 * The two directory writers and the single-file writer all reach the disk
 * through `writeCompiled`, so the file set a module produces is decided once.
 */

import { rm } from "node:fs/promises";
import { basename, dirname, relative } from "node:path";
import type { CompileResult } from "@velarscript/compiler";
import { writeExclusiveBuildFile } from "../build-staging.ts";
import {
  assertEmbeddedModuleOutputWritable,
  assertUniqueEmbeddedModuleOutputs,
  embeddedModuleFileContents,
  embeddedModuleOutputPath,
  VELAR_EMBEDDED_MODULE_MARKER,
} from "../embedded-modules.ts";
import { type JavaScriptBuildMode, renderJavaScriptOutput } from "../javascript-output.ts";
import { projectModuleOutputRelativePath } from "../package-output-layout.ts";
import { projectImportKey, type ProjectModule, type ProjectResult } from "../project.ts";
import { rewriteProjectResourceImports } from "../resource-output.ts";

// esbuild 转换和文件写入都可并行，但无界 Promise.all 会让大型项目同时保留
// 全部模块源码、映射和压缩结果。固定四个 worker 在吞吐与峰值内存之间给出
// 稳定上界；输出路径彼此独立，完成顺序不影响产物。
const BUILD_OUTPUT_CONCURRENCY = 4;

export async function mapBuildOutputs<T>(items: readonly T[], operation: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  let failure: unknown = null;
  const worker = async (): Promise<void> => {
    while (failure === null) {
      const index = next;
      if (index >= items.length) return;
      next += 1;
      try {
        await operation(items[index]!);
      } catch (error) {
        failure = error;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(BUILD_OUTPUT_CONCURRENCY, items.length) }, worker));
  if (failure !== null) throw failure;
}

export async function writeCompiled(
  outputPath: string,
  result: CompileResult,
  writeCss: boolean,
  codeOverride: string | null = null,
  sourceMapOverride: string | null = null,
  writeEmbedded = true,
  sourceMaps = true,
  mode: JavaScriptBuildMode = "readable",
): Promise<void> {
  const mapPath = `${outputPath}.map`;
  const rawCode = codeOverride ?? result.code ?? "";
  const output = await renderJavaScriptOutput({
    code: rawCode,
    sourceMap: sourceMapOverride ?? result.sourceMap,
    sourceFile: result.source.path,
    outputFile: outputPath,
    mode,
    sourceMaps,
    target: "node24",
  });
  const code = !sourceMaps || output.code.includes(`//# sourceMappingURL=${basename(mapPath)}`)
    ? output.code
    : `${output.code}//# sourceMappingURL=${basename(mapPath)}\n`;
  if (writeEmbedded) {
    assertUniqueEmbeddedModuleOutputs([{ ownerPath: outputPath, embeddedModules: result.embeddedModules }]);
    for (const module of result.embeddedModules) {
      const embeddedPath = embeddedModuleOutputPath(outputPath, module.specifier);
      await assertEmbeddedModuleOutputWritable(embeddedPath);
    }
  }
  const embeddedWrites = (await Promise.all((writeEmbedded ? result.embeddedModules : []).map(async (module) => {
    const embeddedPath = embeddedModuleOutputPath(outputPath, module.specifier);
    const embeddedOutput = await renderJavaScriptOutput({
      code: module.code,
      sourceMap: module.sourceMap,
      sourceFile: `${result.source.path}:${module.specifier}`,
      outputFile: embeddedPath,
      mode,
      sourceMaps,
      target: "node24",
    });
    const embeddedCode = sourceMaps
      ? embeddedModuleFileContents(embeddedPath, { ...module, code: embeddedOutput.code })
      : `${embeddedOutput.code}${VELAR_EMBEDDED_MODULE_MARKER}`;
    return sourceMaps
      ? [
          writeExclusiveBuildFile(embeddedPath, embeddedCode, `Embedded module '${relative(dirname(outputPath), embeddedPath).replaceAll("\\", "/")}'`),
          writeExclusiveBuildFile(`${embeddedPath}.map`, embeddedOutput.sourceMap, `Embedded module source map '${relative(dirname(outputPath), `${embeddedPath}.map`).replaceAll("\\", "/")}'`),
        ]
      : [
          writeExclusiveBuildFile(embeddedPath, embeddedCode, `Embedded module '${relative(dirname(outputPath), embeddedPath).replaceAll("\\", "/")}'`),
          rm(`${embeddedPath}.map`, { force: true }),
        ];
  }))).flat();
  const writes: Promise<void>[] = [
    writeExclusiveBuildFile(outputPath, code, `Compiled module '${basename(outputPath)}'`),
    ...(sourceMaps ? [writeExclusiveBuildFile(mapPath, output.sourceMap, `Compiled source map '${basename(mapPath)}'`)] : [rm(mapPath, { force: true })]),
    ...embeddedWrites,
  ];
  if (writeCss) {
    const cssPath = outputPath.replace(/\.js$/u, ".css");
    writes.push(result.css
      ? writeExclusiveBuildFile(cssPath, result.css, `Compiled stylesheet '${basename(cssPath)}'`)
      : rm(cssPath, { force: true }));
  }
  await Promise.all(writes);
}

export function rewriteVelarPackageImports(
  project: ProjectResult,
  module: ProjectModule,
  runtimePackageNames: ReadonlySet<string>,
): string | null {
  if (!module.result.code) return null;
  const moduleOutput = projectModuleOutputRelativePath(project, module, "build", runtimePackageNames);
  const rewrittenResources = rewriteProjectResourceImports(
    project,
    module,
    module.result.code,
    "build",
    moduleOutput,
    runtimePackageNames,
  );
  return rewrittenResources.replace(/(\bfrom\s+["']|\bimport\s+["'])([^"']+)(["'])/gu, (match, prefix: string, source: string, suffix: string) => {
    const targetPath = project.velarImports.get(projectImportKey(module.inputPath, source));
    if (!targetPath) return match;
    const target = project.modules.find((item) => item.inputPath === targetPath);
    if (!target) return match;
    const targetOutput = projectModuleOutputRelativePath(project, target, "build", runtimePackageNames);
    let targetImport = relative(dirname(moduleOutput), targetOutput).replaceAll("\\", "/");
    if (!targetImport.startsWith(".")) targetImport = `./${targetImport}`;
    return `${prefix}${targetImport}${suffix}`;
  });
}
