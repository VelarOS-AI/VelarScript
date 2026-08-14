import { writeFile } from "node:fs/promises";
import { applyMechanicalFixes, formatDiagnostic } from "@velarscript/compiler";
import type { VelarProjectConfig } from "./config.ts";
import { hostErrorMessage } from "./host-error.ts";
import { compileProject, type ProjectResult } from "./project.ts";

export interface MechanicalFixReport {
  /** One line per applied rewrite, in source order, already display-formatted. */
  readonly changes: readonly string[];
  readonly changedFiles: readonly string[];
  readonly remainingDiagnostics: readonly string[];
  /**
   * D51 item NEW-D8: files this run could not write. A failed write used to
   * throw out of the whole command, so the rewrites that had already landed on
   * disk were never reported — the author was left with a modified tree, exit
   * 1, and no summary of what changed.
   */
  readonly writeFailures: readonly string[];
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
  /**
   * D51 (audit 12): extra roots the module graph does not reach — `*.test.vel`
   * modules nobody imports. A test module is source the author owns, so `fix`
   * rewrites it on the same terms as every other module.
   */
  additionalEntries: readonly string[] = [],
): Promise<MechanicalFixReport> {
  const changes: string[] = [];
  const changedFiles = new Set<string>();
  const entries = [config.entryPath, ...additionalEntries];
  const compile = async (): Promise<readonly ProjectResult[]> => {
    const results: ProjectResult[] = [];
    for (const entry of entries) {
      results.push(await compileProject(entry, new Map(), {
        sourceRoot: config.root,
        projectRoot: config.root,
        publicRoot: config.publicDir,
        extensions: config.compilerExtensions,
        extensionConfig: config.extensionConfig,
        framework: config.framework,
        ...(entry === config.entryPath ? {} : { exportTestFunctions: true }),
      }));
    }
    return results;
  };
  const writeFailures: string[] = [];
  let projects: readonly ProjectResult[] | null = null;
  let passes = 0;
  let pending = false;

  while (passes < maximumPasses) {
    projects = await compile();
    passes += 1;
    const writes: { readonly path: string; readonly lines: readonly string[]; readonly write: Promise<void> }[] = [];
    const visited = new Set<string>();
    for (const module of projects.flatMap((result) => result.modules)) {
      if (visited.has(module.inputPath)) continue;
      visited.add(module.inputPath);
      const source = module.result.source;
      const result = applyMechanicalFixes(source.text, module.result.diagnostics);
      if (result.applied.length === 0) continue;
      const lines = result.applied.map((fix) => {
        const location = source.location(fix.offset);
        return `${displayPath(module.inputPath)}:${location.line}:${location.column} fixed ${fix.code}: ${fix.title}`;
      });
      writes.push({ path: module.inputPath, lines, write: writeFile(module.inputPath, result.text, "utf8") });
    }
    pending = writes.length > 0;
    if (!pending) break;
    // Every write is awaited, and each one is reported on its own terms: the
    // files that landed are named in the summary, and the ones that did not are
    // named as failures. One failed write can no longer hide the rewrites that
    // already changed the author's tree.
    const settled = await Promise.allSettled(writes.map((entry) => entry.write));
    for (let index = 0; index < writes.length; index += 1) {
      const entry = writes[index]!;
      if (settled[index]!.status === "fulfilled") {
        changedFiles.add(entry.path);
        changes.push(...entry.lines);
      } else {
        writeFailures.push(`${displayPath(entry.path)}: ${hostErrorMessage((settled[index] as PromiseRejectedResult).reason)}`);
      }
    }
    if (writeFailures.length > 0) break;
  }
  // The pass cap is a termination guard, never a reporting shortcut: what the
  // command reports as remaining is always the state of the files on disk.
  if (pending) projects = await compile();

  const reported = new Set<string>();
  const remaining: string[] = [];
  for (const result of projects ?? []) {
    for (const failure of result.failures) {
      const line = `${failure.path}: ${failure.message}`;
      if (!reported.has(line)) remaining.push(line);
      reported.add(line);
    }
    for (const module of result.modules) {
      if (reported.has(module.inputPath)) continue;
      reported.add(module.inputPath);
      remaining.push(...module.result.diagnostics.map((item) => formatDiagnostic(module.result.source, item)));
    }
  }
  return { changes, changedFiles: [...changedFiles].sort(), remainingDiagnostics: remaining, writeFailures, passes };
}
