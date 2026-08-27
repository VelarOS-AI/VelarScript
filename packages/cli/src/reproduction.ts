import { spawnSync } from "node:child_process";
import { cp, lstat, mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { dirname, extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import type { VelarProjectConfig } from "./config.ts";
import { isHostErrorCode } from "./host-error.ts";
import { CURRENT_PROJECT_FORMAT_VERSION } from "./project-format.ts";
import { formatCheckOutput, type CheckedProject } from "./project-check.ts";
import type { ProjectModule } from "./project.ts";
import { VELAR_VERSION } from "./version.ts";

/**
 * The report format `docs/escape-hatches.md` fixed for a suspected compiler
 * defect, and the same three sections the repository's defect template asks
 * for. D66 ruling 7 is explicit that the CLI, the issue template, the AI skill
 * brief, and the website quote one source instead of each writing their own —
 * so this constant is that source inside the toolchain, and a test holds it
 * against the prose.
 */
export const DEFECT_REPORT_SECTIONS = Object.freeze([
  "What I wrote (or wanted to write):",
  "What the compiler said:",
  "How I resolved it:",
] as const);

/** Where a reproduction lands when `--out-dir` is absent. `.velar/` is the project's own scratch space. */
export const REPRODUCTION_DIRECTORY = join(".velar", "repro");

const DEFECT_TEMPLATE_URL = "https://github.com/VelarOS-AI/VelarScript/issues/new?template=1-defect.yml";

/**
 * D66 ruling 7B: a failing `velar check` ends with this one line and nothing
 * else — the command that bundles the failure, no persuasion, and no notice
 * about data leaving the machine, because none does.
 */
export function reproductionHint(input: string | null): string {
  return `Run 'velar repro${input ? ` ${input}` : ""}' to write a minimal reproduction of this failure.`;
}

export interface ReproductionOptions {
  readonly config: VelarProjectConfig;
  /** The input as the author typed it, so the bundled command is the command they ran. */
  readonly input: string | null;
  readonly checked: CheckedProject;
  readonly outputDirectory: string | null;
  /** The CLI entry to re-run inside the extracted copy — this toolchain, not a resolved one. */
  readonly toolchainEntry: string;
  readonly cwd?: string;
}

export interface ReproductionResult {
  readonly directory: string;
  readonly files: readonly string[];
  /** False when the extracted copy no longer produces the diagnostics this machine produced. */
  readonly reproduced: boolean;
}

/**
 * D66 ruling 7A. Writes a self-contained minimal reproduction and returns where
 * it went. Three disciplines the ruling states and this function keeps:
 *
 * 1. Nothing is uploaded. There is no network call here, and no prompt offering
 *    one; whether to send the directory is the author's decision alone.
 * 2. Nothing beyond the reproduction is collected — no environment variables,
 *    no git remote, no account name — and every absolute path is rewritten to
 *    a project-relative one before it reaches the bundle.
 * 3. The bundle is re-checked in a temporary extracted copy before this
 *    returns. When the extracted copy behaves differently the result says so,
 *    rather than handing over a reproduction that does not reproduce.
 */
export async function writeReproduction(options: ReproductionOptions): Promise<ReproductionResult> {
  const config = options.config;
  const root = config.root;
  const cwd = options.cwd ?? process.cwd();
  const directory = options.outputDirectory ? resolve(cwd, options.outputDirectory) : join(root, REPRODUCTION_DIRECTORY);
  await prepareDirectory(directory, options.outputDirectory);

  const modules = reproductionModules(options.checked);
  const carried: CarriedFile[] = [];
  const uncarried = new Set<string>();
  for (const module of modules) {
    const within = withinProject(root, module.inputPath);
    if (!within) {
      // Named relative to the project, never as it sits on this machine — this
      // list reaches the bundle, and an absolute path here would be the leak
      // discipline 2 exists to prevent.
      const named = relative(root, module.inputPath);
      if (!isAbsolute(named)) uncarried.add(named.split(sep).join("/"));
      continue;
    }
    carried.push({ source: module.inputPath, target: within });
    // A `look`-adjacent stylesheet or any other compiler resource is part of
    // the source that triggers the behavior, not an asset of the build.
    for (const resource of module.result.resources) {
      const resourcePath = resolve(dirname(module.inputPath), resource.source);
      const resourceWithin = withinProject(root, resourcePath);
      if (!resourceWithin) continue;
      if (carried.some((file) => file.source === resourcePath)) continue;
      carried.push({ source: resourcePath, target: resourceWithin });
    }
  }

  const written: string[] = [];
  for (const file of carried) {
    const target = join(directory, file.target);
    await mkdir(dirname(target), { recursive: true });
    await cp(file.source, target);
    written.push(file.target);
  }

  const manifest = config.manifestPath ? await readFile(config.manifestPath, "utf8") : synthesizedManifest(root, config.entryPath);
  await writeFile(join(directory, "velar.json"), manifest, "utf8");
  written.push("velar.json");
  await writeFile(join(directory, "package.json"), reproductionPackage(config), "utf8");
  written.push("package.json");

  const bundleInput = options.input && extname(resolve(cwd, options.input)) === ".vel"
    ? withinProject(root, resolve(cwd, options.input))
    : null;
  // Everything a check reads is on disk by now, so the copy below is checked
  // against the real bundle. The README is written afterwards because it has to
  // report what that check found, and because prose cannot change a compile.
  const diagnostics = projectRelative(formatCheckOutput(options.checked), root);
  const extracted = await recheckExtractedCopy(directory, bundleInput, options.toolchainEntry);
  const reproduced = extracted === diagnostics;

  await writeFile(join(directory, "README.md"), reproductionReadme({
    diagnostics,
    reproduced,
    extracted,
    bundleInput,
    sources: written.filter((file) => file.endsWith(".vel")),
    uncarried: [...uncarried].sort(),
  }), "utf8");
  written.push("README.md");
  return { directory, files: written, reproduced };
}

interface CarriedFile {
  readonly source: string;
  readonly target: string;
}

/**
 * The entry's own module graph, plus the graph of every additional root — a
 * `*.test.vel` module, or a source nothing imports — that actually produced one
 * of the reported errors. A root nothing complained about is left out. The
 * entry graph itself stays whole because dropping a module the graph imports
 * replaces the reported diagnostic with an unresolved-import failure, which is
 * a different bug report than the one being filed.
 */
function reproductionModules(checked: CheckedProject): readonly ProjectModule[] {
  const modules = new Map<string, ProjectModule>();
  const [entry, ...additional] = checked.roots;
  for (const module of entry?.result.modules ?? []) modules.set(module.inputPath, module);
  for (const root of additional) {
    if (root.errors.length === 0) continue;
    for (const module of root.result.modules) if (!modules.has(module.inputPath)) modules.set(module.inputPath, module);
  }
  return [...modules.values()];
}

/**
 * The path a file takes inside the bundle, or null when it does not belong
 * there. Installed packages are excluded on purpose: they are restored by
 * `npm install`, and copying them would put third-party trees into a minimal
 * reproduction.
 */
function withinProject(root: string, path: string): string | null {
  const fromRoot = relative(root, path);
  if (fromRoot === "" || isAbsolute(fromRoot)) return null;
  const segments = fromRoot.split(sep);
  if (segments[0] === ".." || segments.includes("node_modules")) return null;
  return segments.join("/");
}

/**
 * A path as it sits on this machine, in either host spelling: a POSIX path
 * starting at the filesystem root, a Windows path starting at a drive letter,
 * or a UNC share. The lookbehind keeps `and/or`, `https://example.com/x`, and
 * a path already rewritten by the root pass from matching, and a match needs at
 * least two segments so a lone `/` is never a path.
 */
const ABSOLUTE_PATH = /(?<![\w.~:/\\-])(?:[A-Za-z]:[\\/]|\\\\|\/)[^\s"'`<>:|?*]+(?:[\\/][^\s"'`<>:|?*]+)+/gu;

/**
 * Every absolute path this machine would otherwise leak, rewritten to a form
 * that carries the same information a maintainer needs and nothing about who
 * ran the command. Three passes, in this order:
 *
 * 1. The project root goes first, because the paths inside it are the ones the
 *    report is actually about and they must keep their project-relative shape.
 * 2. Whatever is still absolute is out of the project — a linked package, a
 *    hoisted `node_modules` above the root — and only its file name is part of
 *    the defect, so the directories leading to it are dropped. This is the pass
 *    discipline 2 was missing: the root strip alone left those paths whole.
 * 3. The home directory is replaced last, as a backstop for a mention that was
 *    not part of a path run at all.
 *
 * Exported so the D66 discipline-2 test can hold each pass on its own; the
 * bundle itself is the assertion that matters.
 */
export function projectRelative(text: string, root: string): string {
  let output = text;
  for (const form of new Set([root, root.split(sep).join("/")])) {
    // Anchored on a separator: the old unanchored replacement also matched the
    // prefix of a sibling directory, turning `/home/u/app-backup` into
    // `.-backup`. The bare root still becomes `.`, but only where the next
    // character cannot continue a directory name.
    output = output.split(`${form}${sep}`).join("").split(`${form}/`).join("");
    output = output.replaceAll(new RegExp(`${escapedPattern(form)}(?![\\w.@+-])`, "gu"), ".");
  }
  output = output.replaceAll(ABSOLUTE_PATH, (path) => `<external>/${path.split(/[\\/]/u).pop()!}`);
  const home = homedir();
  return home ? output.split(home).join("~") : output;
}

function escapedPattern(text: string): string {
  return text.replaceAll(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function synthesizedManifest(root: string, entryPath: string): string {
  return `${JSON.stringify({
    formatVersion: CURRENT_PROJECT_FORMAT_VERSION,
    entry: relative(root, entryPath).split(sep).join("/"),
  }, null, 2)}\n`;
}

/**
 * Only what the toolchain needs to check this source again. The author's own
 * package.json is deliberately not copied: its fields carry names, registries,
 * and repository URLs that are not part of the reproduction. Compiler
 * extensions come from the bundled `velar.json`, which is.
 */
function reproductionPackage(config: VelarProjectConfig): string {
  const devDependencies: Record<string, string> = { "@velarscript/cli": VELAR_VERSION };
  for (const name of config.extensions) {
    // A bundle that names the wrong generation reproduces a different defect.
    // The CLI's own version is not a stand-in for an extension whose version
    // this run could not resolve, so the reproduction refuses to guess.
    const version = config.extensionGraph.find((package_) => package_.name === name)?.version;
    if (version === undefined) {
      throw new Error(`cannot write a reproduction: the installed version of extension '${name}' is unknown`);
    }
    devDependencies[name] = version;
  }
  return `${JSON.stringify({
    name: "velar-reproduction",
    version: "0.0.0",
    private: true,
    type: "module",
    devDependencies,
  }, null, 2)}\n`;
}

/**
 * Discipline 3: copy the bundle somewhere else and run the same check against
 * the copy. Everything the check reports is compared verbatim, so a bundle that
 * is missing a file it needed fails this rather than reaching a maintainer.
 */
async function recheckExtractedCopy(directory: string, bundleInput: string | null, toolchainEntry: string): Promise<string> {
  const temporary = await realpath(await mkdtemp(join(tmpdir(), "velar-repro-check-")));
  try {
    const extracted = join(temporary, "reproduction");
    await cp(directory, extracted, { recursive: true });
    const argument = bundleInput ? join(extracted, bundleInput) : extracted;
    const checked = spawnSync(process.execPath, [toolchainEntry, "check", argument], {
      encoding: "utf8",
      maxBuffer: 32 * 1024 * 1024,
    });
    if (checked.error) return `the extracted copy could not be checked: ${checked.error.message}\n`;
    const hint = `${reproductionHint(bundleInput ?? ".")}\n`;
    const output = projectRelative(withoutRuntimeWarnings(checked.stderr ?? ""), extracted);
    return output.endsWith(hint) ? output.slice(0, -hint.length) : output;
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

/** A Node warning on the child's stderr is not something the compiler said. */
function withoutRuntimeWarnings(text: string): string {
  return text
    .split("\n")
    .filter((line) => !/^\(node:\d+\) /u.test(line) && !line.startsWith("(Use `node "))
    .join("\n");
}

async function prepareDirectory(directory: string, requested: string | null): Promise<void> {
  let metadata;
  try {
    metadata = await lstat(directory);
  } catch (error) {
    if (!isHostErrorCode(error, "ENOENT") && !isHostErrorCode(error, "ENOTDIR")) throw error;
    await mkdir(directory, { recursive: true });
    return;
  }
  if (!metadata.isDirectory()) throw new Error(`'${requested ?? REPRODUCTION_DIRECTORY}' already exists and is not a directory`);
  if ((await readdir(directory)).length === 0) return;
  // The default location is inside `.velar`, which the project owns and every
  // template gitignores, so a second run replaces the first. A directory the
  // author named is never emptied for them.
  if (requested !== null) throw new Error(`'${requested}' already exists and is not empty; name an empty directory`);
  await rm(directory, { recursive: true, force: true });
  await mkdir(directory, { recursive: true });
}

interface ReadmeParts {
  readonly diagnostics: string;
  readonly reproduced: boolean;
  readonly extracted: string;
  readonly bundleInput: string | null;
  readonly sources: readonly string[];
  readonly uncarried: readonly string[];
}

function reproductionReadme(parts: ReadmeParts): string {
  const command = `npx velar check${parts.bundleInput ? ` ${parts.bundleInput}` : ""}`;
  const listed = parts.sources.slice(0, 12).map((file) => `\`${file}\``).join(", ");
  const sources = parts.sources.length > 12 ? `${listed}, and ${parts.sources.length - 12} more` : listed;
  const lines = [
    "# Minimal reproduction",
    "",
    "Written by `velar repro`. Nothing was uploaded and nothing was collected beyond",
    "what is in this directory — whether to send it, and to whom, is your decision.",
    "",
    `Versions: velar ${VELAR_VERSION} · node ${process.version} · ${process.platform} ${process.arch}`,
    "",
    "## Reproducing",
    "",
    "```sh",
    "npm install",
    command,
    "```",
    "",
    ...(parts.reproduced
      ? [
        "This directory was extracted to a temporary location and re-checked before it",
        "was handed over: the diagnostics below are what it produces there too.",
      ]
      : [
        "This directory was extracted to a temporary location and re-checked before it",
        "was handed over, and **it reproduces on this machine but not in the extracted",
        "bundle.** Treat the diagnostics below as the report and this directory as an",
        "incomplete reproduction; what the extracted copy said instead is at the end of",
        "this file.",
      ]),
    "",
    ...(parts.uncarried.length > 0
      ? [
        "This reproduction does not carry every module the check read. These came from",
        "outside the project and were left to `npm install`:",
        "",
        ...parts.uncarried.map((path) => `- \`${path}\``),
        "",
      ]
      : []),
    `## ${DEFECT_REPORT_SECTIONS[0]}`,
    "",
    "TODO — this section is yours to write. The source that triggers the behavior is",
    sources ? `in this directory: ${sources}.` : "in this directory.",
    "Cut it down further if you can; if the compiler refused something you wanted to",
    "write, show what you wanted to write instead.",
    "",
    `## ${DEFECT_REPORT_SECTIONS[1]}`,
    "",
    "Filled in verbatim from the run that produced this directory. Do not trim it —",
    "the code, the caret line, and the wording all matter.",
    "",
    ...fenced(parts.diagnostics),
    "",
    `## ${DEFECT_REPORT_SECTIONS[2]}`,
    "",
    "TODO — this section is yours to write. Name the workaround that unblocked you,",
    "or write the single word `blocked`. Both are useful: a workaround tells us the",
    "severity, `blocked` tells us the priority.",
    "",
    "---",
    "",
    `File it with the three sections above: ${DEFECT_TEMPLATE_URL}`,
    ...(parts.reproduced
      ? []
      : [
        "",
        "## What the extracted copy said instead",
        "",
        "Not part of the report. It is here so this directory does not read as a clean",
        "reproduction when it is not one. The copy was checked without `npm install`.",
        "",
        ...fenced(parts.extracted || "(the extracted copy reported nothing)\n"),
      ]),
    "",
  ];
  return `${lines.join("\n")}`;
}

/** A fence longer than any backtick run inside — VelarScript source may hold backtick strings. */
function fenced(text: string): readonly string[] {
  const longest = [...text.matchAll(/`+/gu)].reduce((width, match) => Math.max(width, match[0].length), 0);
  const fence = "`".repeat(Math.max(3, longest + 1));
  return [`${fence}text`, text.replace(/\n$/u, ""), fence];
}
