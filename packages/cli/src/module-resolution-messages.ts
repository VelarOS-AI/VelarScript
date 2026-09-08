import { readdir } from "node:fs/promises";
import { basename, dirname, extname, resolve } from "node:path";
import {
  isCoreReservedBinding,
  removedStandardFunctionGuidance,
  type ModuleDependency,
  type ModuleDependencySpecifier,
} from "@velarscript/compiler";
import type { ProjectFailure } from "./project.ts";

/**
 * The wording of the module-resolution family: which name the author probably
 * meant, and what a module that has no such export should say instead.
 *
 * MD-I1/MD-U2/MD-I3: this used to be one sentence — "Module 'x' has no export
 * named 'y'" — for four different mistakes, and the compiler had already
 * reported two of them under their own codes. A near miss now gets the near
 * name, `velar/test` gets the rule that actually applies to it, and a mistake
 * the compiler has already named is not named a second time here.
 */

/** Levenshtein distance capped at 3 — enough to answer "is this a near miss". */
function editDistance(left: string, right: string): number {
  if (Math.abs(left.length - right.length) > 3) return 4;
  let previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    const current = [leftIndex];
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      current[rightIndex] = Math.min(
        previous[rightIndex]! + 1,
        current[rightIndex - 1]! + 1,
        previous[rightIndex - 1]! + (left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1),
      );
    }
    previous = current;
  }
  return previous[right.length]!;
}

export function nearestName(requested: string, candidates: readonly string[]): string | null {
  let best: string | null = null;
  let bestDistance = 3;
  for (const candidate of candidates) {
    if (candidate === requested) continue;
    const distance = editDistance(requested, candidate);
    if (distance < bestDistance || (distance === bestDistance && best === null)) {
      best = candidate;
      bestDistance = distance;
    }
  }
  return best;
}

/** The nearest .vel file name next to a missing module target, if any. */
export async function nearestModuleName(targetPath: string): Promise<string | null> {
  try {
    const entries = await readdir(dirname(targetPath), { withFileTypes: true });
    const names = entries.filter((entry) => entry.isFile() && entry.name.endsWith(".vel")).map((entry) => entry.name);
    const wanted = basename(targetPath);
    return nearestName(wanted, names);
  } catch {
    return null;
  }
}

export function missingExportMessage(source: string, name: string, exports: readonly string[], importerPath: string): string {
  const guidance = removedStandardFunctionGuidance(source, name);
  if (guidance) return guidance;
  // MOD-U2: `import name from "..."` is the JavaScript default-import habit;
  // .vel modules have no default export, so the answer teaches the named form
  // instead of implying a default might exist.
  if (name === "default") {
    return `VelarScript modules have no default export; import the names you need — import {name} from ${JSON.stringify(source)}`;
  }
  // MD-U2: `velar/test` holds one helper, and `test` is a declaration keyword,
  // not an export. "No export named 'test'" answers a question the author did
  // not ask; the rule they need is where a test may be declared at all.
  if (source === "velar/test") {
    const rule = "a test is declared as 'test \"name\":' at the top level of a '*.test.vel' module, which is where the runner looks";
    if (!importerPath.endsWith(".test.vel")) {
      return `'velar/test' belongs to a '*.test.vel' module; ${rule}`;
    }
    if (name === "test") return `'test' is declared, not imported: ${rule}. 'velar/test' exports ${exports.join(", ")}`;
  }
  const near = nearestName(name, exports);
  return `Module '${source}' has no export named '${name}'`
    + (near === null ? "" : `; did you mean '${near}'?`);
}

/**
 * MD-I1: the report for an imported name a module does not export, or null when
 * the compiler has already reported this exact mistake under its own code.
 *
 * Two mistakes reach this point with a diagnostic already attached to them: a
 * module importing from itself (VEL6004 names the self edge, and every name it
 * asked for is missing because a module's own exports are not in scope through
 * an import) and a Core prelude name bound under that same name (VEL3007 names
 * it a reserved Core binding, at the specifier). Saying "has no export named"
 * beside either is a second report of one mistake. An *aliased* import of such a
 * name binds something VEL3007 has nothing to say about, so it keeps its report.
 */
export function missingExportFailure(
  importerPath: string,
  dependency: ModuleDependency,
  specifier: ModuleDependencySpecifier,
  exports: Iterable<string>,
): ProjectFailure | null {
  if (dependency.source.startsWith(".") && extname(dependency.source) === ".vel"
    && resolve(dirname(importerPath), dependency.source) === importerPath) {
    return null;
  }
  if (specifier.local === specifier.imported && isCoreReservedBinding(specifier.imported)) return null;
  return {
    path: importerPath,
    message: missingExportMessage(dependency.source, specifier.imported, [...exports], importerPath),
    code: "VEL6007",
    // CO-I7: the name that has to change is the export name, not the module
    // specifier — the caret used to fall on the one part of the line that was
    // right, while the sibling report for a permanent namespace already
    // underlined the name. A synthesized specifier has no written span, so the
    // module specifier stands for it.
    span: specifier.span ?? dependency.span,
  };
}

/** Records one missing-export report, or nothing when the compiler already made it. */
export function pushMissingExport(
  failures: ProjectFailure[],
  importerPath: string,
  dependency: ModuleDependency,
  specifier: ModuleDependencySpecifier,
  exports: Iterable<string>,
): void {
  const failure = missingExportFailure(importerPath, dependency, specifier, exports);
  if (failure !== null) failures.push(failure);
}
