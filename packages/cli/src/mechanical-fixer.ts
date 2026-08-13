import { writeFile } from "node:fs/promises";
import { applyMechanicalFixes, formatDiagnostic } from "@velarscript/compiler";
import type { VelarProjectConfig } from "./config.ts";
import { compileProject, type ProjectResult } from "./project.ts";

export interface MechanicalFixReport {
  /** One line per applied rewrite, in source order, already display-formatted. */
  readonly changes: readonly string[];
  readonly changedFiles: readonly string[];
  readonly remainingDiagnostics: readonly string[];
  readonly passes: number;
}

/**
 * D38 §48: the `velar fix` engine. It applies every rewrite the compile itself
 * named — nothing more — then recompiles, because one rewrite can let a later
 * stage run and report its own mechanical guidance in turn. It stops when a
 * pass changes nothing, which is exactly what makes a second `velar fix` a
 * no-op.
 */
export async function applyProjectMechanicalFixes(
  config: VelarProjectConfig,
  displayPath: (path: string) => string,
  maximumPasses = 8,
): Promise<MechanicalFixReport> {
  const changes: string[] = [];
  const changedFiles = new Set<string>();
  const compile = (): Promise<ProjectResult> => compileProject(config.entryPath, new Map(), {
    sourceRoot: config.root,
    projectRoot: config.root,
    publicRoot: config.publicDir,
    extensions: config.compilerExtensions,
    extensionConfig: config.extensionConfig,
    framework: config.framework,
  });
  let project: ProjectResult | null = null;
  let passes = 0;
  let pending = false;

  while (passes < maximumPasses) {
    project = await compile();
    passes += 1;
    const writes: Promise<void>[] = [];
    const pass: string[] = [];
    for (const module of project.modules) {
      const source = module.result.source;
      const result = applyMechanicalFixes(source.text, module.result.diagnostics);
      if (result.applied.length === 0) continue;
      for (const fix of result.applied) {
        const location = source.location(fix.offset);
        pass.push(`${displayPath(module.inputPath)}:${location.line}:${location.column} fixed ${fix.code}: ${fix.title}`);
      }
      changedFiles.add(module.inputPath);
      writes.push(writeFile(module.inputPath, result.text, "utf8"));
    }
    pending = writes.length > 0;
    if (!pending) break;
    await Promise.all(writes);
    changes.push(...pass);
  }
  // The pass cap is a termination guard, never a reporting shortcut: what the
  // command reports as remaining is always the state of the files on disk.
  if (pending) project = await compile();

  const remaining = project
    ? [
        ...project.failures.map((failure) => `${failure.path}: ${failure.message}`),
        ...project.modules.flatMap((module) => module.result.diagnostics
          .map((item) => formatDiagnostic(module.result.source, item))),
      ]
    : [];
  return { changes, changedFiles: [...changedFiles].sort(), remainingDiagnostics: remaining, passes };
}
