import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { access, realpath, rename, rm, stat, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative } from "node:path";
import { type Advisory, applyMechanicalFixes, formatDiagnostic } from "@velarscript/compiler";
import type { VelarProjectConfig } from "./config.ts";
import { hostErrorMessage } from "./host-error.ts";
import { compileProject, compileProjectEntries, type ProjectModule, type ProjectOwnedResourcePackage, type ProjectResult } from "./project.ts";
import { additionalProjectRoots } from "./project-check.ts";
import { projectLayerFindings } from "./project-layer-findings.ts";
import { projectPackageTarget } from "./project-package-target.ts";
import { resolveProjectCompilationRoots } from "./project-source-package.ts";
import { readVelarSourceFile } from "./source-limits.ts";

export interface MechanicalFixReport {
  /** One line per applied rewrite, in source order, already display-formatted. */
  readonly changes: readonly string[];
  readonly changedFiles: readonly string[];
  readonly remainingDiagnostics: readonly string[];
  /**
   * D114 WB-I2: how many advisories the tree still carries once the passes
   * stop. `velar fix` used to end on "0 diagnostics remain" over a tree
   * `velar check` still had something to say about, because an advisory is not
   * a diagnostic and nothing in the summary was about the other channel.
   */
  readonly remainingAdvisories: number;
  /**
   * D51 item NEW-D8: files this run could not write. A failed write used to
   * throw out of the whole command, so the rewrites that had already landed on
   * disk were never reported — the author was left with a modified tree, exit
   * 1, and no summary of what changed.
   */
  readonly writeFailures: readonly string[];
  readonly passes: number;
}

interface MechanicalFixCompilation {
  readonly primaryEntries: readonly string[];
  readonly sourceRoot: string;
  readonly sourceBoundary: string;
  readonly resourceBoundary: string;
  readonly ownedResourcePackage: ProjectOwnedResourcePackage | null;
  readonly additionalEntries: readonly string[];
  readonly sourcePackageManifest: { readonly path: string; readonly source: string } | null;
}

async function mechanicalFixCompilation(
  config: VelarProjectConfig,
  input: string | null,
): Promise<MechanicalFixCompilation> {
  const roots = await resolveProjectCompilationRoots(config, input);
  return {
    primaryEntries: roots.entries,
    sourceRoot: roots.sourceRoot,
    sourceBoundary: roots.sourceBoundary,
    resourceBoundary: roots.resourceBoundary,
    ownedResourcePackage: roots.ownedResourcePackage,
    additionalEntries: await additionalProjectRoots(config, input),
    sourcePackageManifest: roots.sourcePackageManifest,
  };
}

async function compileMechanicalFixProjects(
  config: VelarProjectConfig,
  compilation: MechanicalFixCompilation,
): Promise<readonly ProjectResult[]> {
  const packageTarget = projectPackageTarget(config);
  const sourceOverrides = compilation.sourcePackageManifest
    ? new Map([[compilation.sourcePackageManifest.path, compilation.sourcePackageManifest.source]])
    : new Map<string, string>();
  const primary = await compileProjectEntries(compilation.primaryEntries, config.entryPath, sourceOverrides, {
    sourceRoot: compilation.sourceRoot,
    sourceBoundary: compilation.sourceBoundary,
    resourceBoundary: compilation.resourceBoundary,
    ownedResourcePackage: compilation.ownedResourcePackage,
    projectRoot: config.root,
    publicRoot: config.publicDir,
    extensions: config.compilerExtensions,
    extensionConfig: config.extensionConfig,
    framework: config.framework,
    packageTarget,
  });
  const results: ProjectResult[] = [primary];
  // A root an earlier root already walked needs no compile of its own. Public
  // package entries share the primary graph; tests and undeclared orphans stay
  // check/fix-only roots and therefore never widen a build.
  const covered = new Set(primary.modules.map((module) => module.inputPath));
  for (const entry of compilation.additionalEntries) {
    if (covered.has(entry)) continue;
    const result = await compileProject(entry, sourceOverrides, {
      sourceRoot: config.root,
      resourceBoundary: compilation.resourceBoundary,
      ownedResourcePackage: compilation.ownedResourcePackage,
      projectRoot: config.root,
      publicRoot: config.publicDir,
      extensions: config.compilerExtensions,
      extensionConfig: config.extensionConfig,
      framework: config.framework,
      packageTarget,
      exportTestFunctions: true,
    });
    for (const module of result.modules) covered.add(module.inputPath);
    results.push(result);
  }
  return results;
}

/** One file this pass rewrites, the lines that report it, and the write itself. */
interface MechanicalFixWrite {
  readonly path: string;
  readonly lines: readonly string[];
  readonly write: Promise<void>;
}

/**
 * Every rewrite one compile of the tree names: the compiler's own mechanical
 * fixes first, and — only for a pass that found none of those — the project
 * layer's, because both are computed from one snapshot and two whole-file
 * writes against one snapshot cannot both be what the file should hold.
 */
async function mechanicalFixWrites(
  config: VelarProjectConfig,
  projects: readonly ProjectResult[],
  displayPath: (path: string) => string,
): Promise<readonly MechanicalFixWrite[]> {
  const writes: MechanicalFixWrite[] = [];
  const visited = new Set<string>();
  const targets = new Set<string>();
  for (const module of projects.flatMap((result) => result.modules)) {
    if (visited.has(module.inputPath)) continue;
    visited.add(module.inputPath);
    // The module graph reaches installed VelarScript packages, and their
    // diagnostics carry the same mechanical fixes. Their source is not the
    // author's to rewrite, so it is left alone; the diagnostics still reach
    // the author through `remainingDiagnostics` below, which is the same
    // channel `velar check` reports them on.
    if (!await ownedByProject(config, module)) continue;
    const source = module.result.source;
    const result = applyMechanicalFixes(source.text, [...module.result.diagnostics, ...fixedAdvisories(module)]);
    if (result.applied.length === 0) continue;
    // One file is written once per pass, whatever it is called. Two roots
    // reach one file whenever the author gave it two names — a link inside
    // `src/` pointing at a shared module, a module hard-linked under a second
    // name — and each name is a module of its own to the compiler. The second
    // write would be computed from the same snapshot as the first, so it
    // would either race it or fail its own re-read, and it would report the
    // same rewrite twice.
    const identity = await writeIdentity(module.inputPath);
    if (targets.has(identity)) continue;
    targets.add(identity);
    const lines = result.applied.map((fix) => {
      const location = source.location(fix.offset);
      return `${displayPath(module.inputPath)}:${location.line}:${location.column} fixed ${fix.code}: ${fix.title}`;
    });
    writes.push({ path: module.inputPath, lines, write: replaceSourceFile(module.inputPath, source.text, result.text) });
  }
  // The project layer's own rewrites, from the same rules `velar check`
  // refuses on. They are withheld from a pass that already rewrote something:
  // both kinds are computed from one snapshot, and two whole-file writes
  // against one snapshot cannot both be what the file should hold. The loop
  // recompiles and applies it on the next pass — the same deferral
  // `applyMechanicalFixes` uses for two edits that overlap.
  if (writes.length === 0) {
    // `entries[0]` is the project entry and no earlier root can have covered
    // it, so the first result is the entry's own project — the one the
    // project-layer rules are about.
    for (const finding of projectLayerFindings(config, projects[0]!)) {
      const fix = finding.fix;
      if (!fix) continue;
      const module = projects[0]!.modules.find((item) => item.inputPath === fix.path);
      if (!module || !await ownedByProject(config, module)) continue;
      const location = module.result.source.location(fix.offset);
      writes.push({
        path: fix.path,
        lines: [`${displayPath(fix.path)}:${location.line}:${location.column} fixed ${fix.code}: ${fix.title}`],
        write: replaceSourceFile(fix.path, fix.expected, fix.text),
      });
    }
  }
  return writes;
}

/**
 * D114 WB-I2: the advisories this command applies.
 *
 * `docs/web-api.md` promised the `filters(...)` rewrite as "an editor fix", and
 * that word drew a line nothing else in the language draws: `hsl`'s percentage
 * and the `token(...)` migration are two remedies in the same vocabulary, both
 * applied by `velar fix`, and the third one was reachable only by opening the
 * file in an editor — with no sentence anywhere saying where the line was. A16
 * is a spelling change like the other two: the same filter list, written in the
 * checked builders instead of as text nothing reads.
 *
 * The roster is a set rather than "every advisory carrying a fix", because the
 * two are not the same question. `A5` and `A6` rewrite a literal into an
 * interpolation — that is a change of *meaning*, which the author has to choose
 * and an editor is the right place to offer. What belongs here is a rewrite
 * that says the same thing in the checked spelling, and each one is added by a
 * ruling rather than by carrying a fix.
 */
const APPLIED_ADVISORY_CODES: ReadonlySet<string> = new Set(["A16"]);

function fixedAdvisories(module: ProjectModule): readonly Advisory[] {
  return module.result.advisories.filter((item) => APPLIED_ADVISORY_CODES.has(item.code));
}

/**
 * Awaits every write, then says which landed and which did not. One failed
 * write can no longer hide the rewrites that already changed the author's tree:
 * the files that landed are reported in the summary, and the ones that did not
 * are reported as failures.
 */
async function settleMechanicalFixWrites(
  writes: readonly MechanicalFixWrite[],
  displayPath: (path: string) => string,
): Promise<{ readonly changed: readonly MechanicalFixWrite[]; readonly failures: readonly string[] }> {
  const changed: MechanicalFixWrite[] = [];
  const failures: string[] = [];
  const settled = await Promise.allSettled(writes.map((entry) => entry.write));
  for (let index = 0; index < writes.length; index += 1) {
    const entry = writes[index]!;
    if (settled[index]!.status === "fulfilled") changed.push(entry);
    else failures.push(`${displayPath(entry.path)}: ${hostErrorMessage((settled[index] as PromiseRejectedResult).reason)}`);
  }
  return { changed, failures };
}

/**
 * What is still refused once the passes stop, over the tree as it now stands on
 * disk: the project failures, each module's own diagnostics, and — read from the
 * files rather than from the run — what the project layer still refuses. A
 * finding that carried no rewrite is reported here rather than silently
 * dropped, and so is a rewrite the passes could not land, because `velar fix`
 * may never claim a tree is clean that `velar check` will refuse.
 */
function remainingMechanicalDiagnostics(
  config: VelarProjectConfig,
  projects: readonly ProjectResult[] | null,
): readonly string[] {
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
  if (projects !== null && projects.length > 0) {
    remaining.push(...projectLayerFindings(config, projects[0]!).map((finding) => finding.message));
  }
  return remaining;
}

/**
 * WB-I2: what the other channel still holds, counted over the tree as it now
 * stands. One module reached through two roots is one module here, the same way
 * its diagnostics are counted once above.
 */
function remainingAdvisoryCount(projects: readonly ProjectResult[] | null): number {
  const counted = new Set<string>();
  let total = 0;
  for (const result of projects ?? []) {
    for (const module of result.modules) {
      if (counted.has(module.inputPath)) continue;
      counted.add(module.inputPath);
      total += module.result.advisories.length;
    }
  }
  return total;
}

/**
 * D38 §48: the `velar fix` engine. It applies every rewrite the compile itself
 * named — nothing more — then recompiles, because one rewrite can let a later
 * stage run and report its own mechanical guidance in turn. It stops when a
 * pass changes nothing, which is exactly what makes a second `velar fix` a
 * no-op.
 *
 * The scope is not a parameter: `input` is the same argument `velar check`
 * takes, and the roots and the project-layer rules are both derived from it
 * through the functions `check` derives them from. A fixer handed a
 * pre-computed scope is a fixer that can be handed a different one, and the
 * defect this shape exists to prevent is precisely the two commands reading
 * one tree two ways.
 */
export async function applyProjectMechanicalFixes(
  config: VelarProjectConfig,
  input: string | null,
  displayPath: (path: string) => string,
  maximumPasses = 8,
): Promise<MechanicalFixReport> {
  const changes: string[] = [];
  const changedFiles = new Set<string>();
  // D51 (audit 12): extra roots the module graph does not reach — `*.test.vel`
  // modules nobody imports, and every other source nothing imports either. Both
  // are source the author owns, so `fix` rewrites them on the same terms as
  // every other module, and on the same terms `velar check` reads them: a
  // diagnostic `check` refuses over must be one `fix` can reach.
  const compilation = await mechanicalFixCompilation(config, input);
  const compile = (): Promise<readonly ProjectResult[]> => compileMechanicalFixProjects(config, compilation);
  const writeFailures: string[] = [];
  let projects: readonly ProjectResult[] | null = null;
  let passes = 0;
  let pending = false;

  while (passes < maximumPasses) {
    projects = await compile();
    passes += 1;
    const writes = await mechanicalFixWrites(config, projects, displayPath);
    pending = writes.length > 0;
    if (!pending) break;
    const settled = await settleMechanicalFixWrites(writes, displayPath);
    for (const entry of settled.changed) {
      changedFiles.add(entry.path);
      changes.push(...entry.lines);
    }
    writeFailures.push(...settled.failures);
    if (writeFailures.length > 0) break;
  }
  // The pass cap is a termination guard, never a reporting shortcut: what the
  // command reports as remaining is always the state of the files on disk.
  if (pending) projects = await compile();
  const remaining = remainingMechanicalDiagnostics(config, projects);
  return {
    changes,
    changedFiles: [...changedFiles].sort(),
    remainingDiagnostics: remaining,
    remainingAdvisories: remainingAdvisoryCount(projects),
    writeFailures,
    passes,
  };
}

/**
 * The project driver builds this prefix for every module that came out of an
 * installed VelarScript package (project.ts assembles
 * `join("__velar_packages__", <package name>, <path within the package>)`),
 * so a module carrying it is a dependency rather than source the author wrote.
 */
const PACKAGE_MODULE_PREFIX = "__velar_packages__/";

function pathSegments(path: string): readonly string[] {
  return path.split(/[\\/]/u);
}

/**
 * `velar fix` rewrites source in place, so it may only touch the source the
 * author owns. Installed VelarScript packages are enqueued into the same module
 * graph as the project's own modules, and an edit to one of them is invisible to
 * git, destroyed by the next `npm ci`, and makes the installed tree diverge from
 * its published tarball. `velar format` already draws this boundary in its
 * directory walk; the two commands now agree.
 *
 * The tests are deliberately independent rather than several spellings of one
 * idea: `relativePath` names a module the driver resolved through a package
 * manifest, containment names a file outside the project whatever its
 * provenance, and a `node_modules` segment names an installed tree even when it
 * sits inside the project root. Containment is then asked a second time about
 * the real path, because the write follows the link rather than replacing it:
 * `src/lib.vel` pointing into an installed package is a module whose own path
 * passes every test above and whose rewrite still lands in the dependency.
 */
async function ownedByProject(config: VelarProjectConfig, module: ProjectModule): Promise<boolean> {
  if (module.relativePath.startsWith(PACKAGE_MODULE_PREFIX)) return false;
  if (!containedByProject(config.root, module.inputPath)) return false;
  // The project root is resolved as well: a root reached through a symbolic link
  // — `/tmp` and `/var` on macOS are two — would otherwise fail its own
  // containment test and no module in the project would be rewritten at all.
  const [root, target] = await Promise.all([resolvedPath(config.root), resolvedPath(module.inputPath)]);
  return containedByProject(root, target);
}

function containedByProject(root: string, path: string): boolean {
  const within = relative(root, path);
  if (within.length === 0 || isAbsolute(within)) return false;
  const segments = pathSegments(within);
  return !segments.includes("..") && !segments.includes("node_modules");
}

/**
 * The file a path names, as the filesystem itself identifies it. A path the
 * fixer cannot stat is answered with the path, which makes it its own identity
 * and leaves the failure to the write, where it is reported.
 */
async function writeIdentity(path: string): Promise<string> {
  try {
    const metadata = await stat(path);
    return `${metadata.dev}:${metadata.ino}`;
  } catch {
    return path;
  }
}

/** A path that does not exist is its own real path; the write reports the rest. */
async function resolvedPath(path: string): Promise<string> {
  try {
    return await realpath(path);
  } catch {
    return path;
  }
}

/**
 * The rewrite was computed from the text `compile()` read, so a save that landed
 * since then is not in it and writing the whole file would revert it without a
 * word. The file is re-read immediately before the write and left untouched when
 * it no longer matches the snapshot; the conflict is reported on the same
 * channel as a failed write, so the author is told rather than quietly losing
 * the edit. The replacement itself goes through a sibling temporary plus
 * `rename`, because a torn write on this path destroys the module.
 */
async function replaceSourceFile(path: string, expected: string, text: string): Promise<void> {
  const current = await readVelarSourceFile(path);
  if (current !== expected) {
    throw new Error("the file changed on disk during this fix pass; nothing was written");
  }
  // A rename replaces the name, not the file behind it, so the two things a
  // plain `writeFile` preserved for free have to be carried across by hand: the
  // rewrite lands on the file a symlinked module points at rather than
  // replacing the link, and the temporary is created with the mode the module
  // already had rather than the process umask's.
  const target = await realpath(path);
  const metadata = await stat(target);
  // A rename needs only a writable directory, so a module the author marked
  // read-only would be rewritten through one without ever being consulted. The
  // marker is checked directly and reported on the write channel, which is where
  // the failed `writeFile` used to land it.
  try {
    await access(target, constants.W_OK);
  } catch {
    throw new Error("the file is read-only; nothing was written");
  }
  if (metadata.nlink > 1) {
    // A rename replaces the name rather than the file behind it, so a module the
    // author hard-linked under a second name would come apart: one name would
    // carry the rewrite and the other the original bytes. The link is the
    // author's, so this rare module is written in place and keeps its identity.
    await writeFile(target, text, "utf8");
    return;
  }
  const temporary = join(dirname(target), `.${basename(target)}.velar-fix-${randomUUID()}`);
  await writeFile(temporary, text, { encoding: "utf8", mode: metadata.mode & 0o777 });
  try {
    await rename(temporary, target);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
}
