import { dirname, resolve } from "node:path";
import { projectImportKey, type ProjectResult } from "./project.ts";

/**
 * VelarScript modules reachable from one or more execution entries.
 *
 * A checked project may contain several independent roots (the document and
 * Module Workers). Consumers that own only one runtime graph must not infer
 * dependencies from the other roots merely because compilation checked them
 * together.
 */
export function projectModuleClosure(
  project: ProjectResult,
  entries: readonly string[],
): ReadonlySet<string> {
  const modules = new Map(project.modules.map((module) => [resolve(module.inputPath), module]));
  const reachable = new Set<string>();
  const pending = entries.map((entry) => resolve(entry));
  for (let cursor = 0; cursor < pending.length; cursor += 1) {
    const path = pending[cursor]!;
    if (reachable.has(path)) continue;
    const module = modules.get(path);
    if (!module) continue;
    reachable.add(path);
    for (const dependency of module.result.dependencies) {
      if (dependency.javascript || dependency.resource) continue;
      const target = dependency.source.startsWith(".")
        ? resolve(dirname(module.inputPath), dependency.source)
        : project.velarImports.get(projectImportKey(module.inputPath, dependency.source));
      if (target !== undefined && modules.has(resolve(target))) pending.push(resolve(target));
    }
  }
  return reachable;
}
