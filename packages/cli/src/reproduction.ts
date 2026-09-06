import { spawnSync } from "node:child_process";
import { cp, mkdir, mkdtemp, realpath, rm } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { dirname, extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { writeExclusiveBuildFile } from "./build-staging.ts";
import type { VelarProjectConfig } from "./config.ts";
import { assertBuildInputsOutsideOutput, type AdditionalBuildInput } from "./build-input-boundary.ts";
import { CURRENT_PROJECT_FORMAT_VERSION } from "./project-format.ts";
import { formatCheckOutput, type CheckedProject } from "./project-check.ts";
import type { ProjectModule } from "./project.ts";
import type { ProjectSourcePackageContract } from "./project-source-package.ts";
import {
  planReproductionLayout,
  sameContents,
  uniqueCarriedFiles,
  type ReproductionCarriedFile,
} from "./reproduction-layout.ts";
import { writeReproductionOutput } from "./reproduction-output.ts";
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
  if (options.outputDirectory === "") throw new Error("reproduction output directory cannot be empty");
  const directory = options.outputDirectory !== null
    ? resolve(cwd, options.outputDirectory)
    : join(root, REPRODUCTION_DIRECTORY);
  await assertReproductionInputsOutsideOutput(config, options.checked, directory);

  const modules = reproductionModules(options.checked);
  const carried: ReproductionCarriedFile[] = [];
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
    // The checked source snapshot is the byte authority for this reproduction.
    // Writing it creates an ordinary file even when the author reached that
    // source through a symbolic link, and it cannot drift after the check.
    carried.push({ source: module.inputPath, target: within, contents: module.result.source.text });
    // A `look`-adjacent stylesheet or any other compiler resource is part of
    // the source that triggers the behavior, not an asset of the build.
    for (const resource of module.result.resources) {
      if (resource.kind === "json") continue;
      const resourcePath = resolve(dirname(module.inputPath), resource.source);
      const resourceWithin = withinProject(root, resourcePath);
      if (!resourceWithin) continue;
      if (carried.some((file) => file.source === resourcePath)) continue;
      const contents = module.resourceContents?.get(resource.source);
      if (contents === undefined) {
        throw new Error(`cannot reproduce compiler resource '${resource.source}' without its checked byte snapshot`);
      }
      carried.push({
        source: resourcePath,
        target: resourceWithin,
        contents,
      });
    }
  }
  const carriedModules = new Set(modules.map((module) => resolve(module.inputPath)));
  for (const root_ of options.checked.roots) {
    for (const resource of root_.result.resources) {
      if (!carriedModules.has(resolve(resource.importerPath))) continue;
      const resourceWithin = withinProject(root, resource.inputPath);
      if (!resourceWithin) {
        const named = relative(root, resource.inputPath);
        if (!isAbsolute(named)) uncarried.add(named.split(sep).join("/"));
        continue;
      }
      if (carried.some((file) => file.target === resourceWithin)) continue;
      carried.push({ source: resource.inputPath, target: resourceWithin, contents: resource.content });
    }
  }

  const layout = planReproductionLayout(root, options.checked, carried);
  const bundleInput = options.input && extname(resolve(cwd, options.input)) === ".vel"
    ? withinProject(root, resolve(cwd, options.input))
    : null;
  const diagnostics = projectRelative(formatCheckOutput(options.checked), root);
  const result = await writeReproductionOutput({
    projectRoot: root,
    outputDirectory: directory,
    requestedOutput: options.outputDirectory,
    defaultOutputName: REPRODUCTION_DIRECTORY,
  }, async (stagingDirectory) => writeReproductionStaging({
      directory: stagingDirectory,
      carried: layout.carried,
      manifest: reproductionManifest(config),
      rootPackage: reproductionPackage(config, layout.nestedProject ? null : layout.sourcePackage),
      projectPackage: layout.nestedProject && layout.sourcePackage
        ? reproductionProjectPackage(layout.sourcePackage)
        : null,
      nestedProject: layout.nestedProject,
      bundleInput,
      diagnostics,
      uncarried: [...uncarried].sort(),
      toolchainEntry: options.toolchainEntry,
    }));
  return { directory, files: result.files, reproduced: result.reproduced };
}

interface ReproductionStagingOptions {
  readonly directory: string;
  readonly carried: readonly ReproductionCarriedFile[];
  readonly manifest: string;
  readonly rootPackage: string;
  readonly projectPackage: string | null;
  readonly nestedProject: boolean;
  readonly bundleInput: string | null;
  readonly diagnostics: string;
  readonly uncarried: readonly string[];
  readonly toolchainEntry: string;
}

async function writeReproductionStaging(options: ReproductionStagingOptions): Promise<{
  readonly files: readonly string[];
  readonly reproduced: boolean;
}> {
  const projectDirectory = options.nestedProject ? join(options.directory, "project") : options.directory;
  const projectPrefix = options.nestedProject ? "project/" : "";
  const carried = uniqueCarriedFiles(options.carried);
  const written: string[] = [];
  for (const [path, file] of carried) {
    const target = join(projectDirectory, path);
    await mkdir(dirname(target), { recursive: true });
    await writeExclusiveBuildFile(target, file.contents, `Reproduction source '${projectPrefix}${path}'`);
    written.push(`${projectPrefix}${path}`);
  }

  await writeProjectContractFile(projectDirectory, "velar.json", options.manifest, carried, projectPrefix, written);
  if (options.nestedProject) {
    await writeExclusiveBuildFile(
      join(options.directory, "package.json"), options.rootPackage, "Reproduction bootstrap package manifest",
    );
    written.push("package.json");
    if (options.projectPackage !== null && !carried.has("package.json")) {
      await writeProjectContractFile(
        projectDirectory, "package.json", options.projectPackage, carried, projectPrefix, written,
      );
    }
  } else {
    await writeProjectContractFile(projectDirectory, "package.json", options.rootPackage, carried, projectPrefix, written);
  }

  // Everything a check reads is on disk by now, so the copy below is checked
  // against the real staged bundle. README follows because prose cannot change
  // a compile and must state what this exact copy produced.
  const extracted = await recheckExtractedCopy(
    options.directory, options.nestedProject, options.bundleInput, options.toolchainEntry,
  );
  const reproduced = extracted === options.diagnostics;
  const readme = reproductionReadme({
    diagnostics: options.diagnostics,
    reproduced,
    extracted,
    bundleInput: options.bundleInput,
    nestedProject: options.nestedProject,
    sources: written.filter((file) => file.endsWith(".vel")),
    uncarried: options.uncarried,
  });
  await writeExclusiveBuildFile(join(options.directory, "README.md"), readme, "Reproduction README");
  written.push("README.md");
  return { files: written, reproduced };
}

async function writeProjectContractFile(
  projectDirectory: string,
  path: string,
  contents: string,
  carried: ReadonlyMap<string, ReproductionCarriedFile>,
  projectPrefix: string,
  written: string[],
): Promise<void> {
  const existing = carried.get(path);
  if (existing) {
    if (!sameContents(existing.contents, contents)) {
      throw new Error(`cannot reproduce '${path}' because its checked bytes differ from the project contract`);
    }
    return;
  }
  await writeExclusiveBuildFile(
    join(projectDirectory, path), contents, `Reproduction project contract '${projectPrefix}${path}'`,
  );
  written.push(`${projectPrefix}${path}`);
}

function reproductionManifest(config: VelarProjectConfig): string {
  if (config.manifestPath === null) return synthesizedManifest(config.root, config.entryPath);
  if (config.manifestSource === null) {
    throw new Error("cannot reproduce a project without its checked manifest snapshot");
  }
  return config.manifestSource;
}

async function assertReproductionInputsOutsideOutput(
  config: VelarProjectConfig,
  checked: CheckedProject,
  outputDirectory: string,
): Promise<void> {
  const additionalInputs: AdditionalBuildInput[] = [];
  if (config.manifestPath) additionalInputs.push({ path: config.manifestPath, kind: "file", label: "project manifest" });
  if (checked.sourcePackage) {
    additionalInputs.push({ path: join(config.root, "package.json"), kind: "file", label: "source package manifest" });
  }
  for (const root of checked.roots) {
    await assertBuildInputsOutsideOutput(root.result, outputDirectory, additionalInputs);
  }
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
 * Only what the toolchain needs to check this source again. The validated
 * package name is retained so source-package self imports keep their identity;
 * author, registry, repository, and every other package.json field are not
 * copied. Compiler extensions come from the bundled `velar.json`.
 */
function reproductionPackage(config: VelarProjectConfig, sourcePackage: ProjectSourcePackageContract | null): string {
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
    ...reproductionProjectPackageFields(sourcePackage),
    version: "0.0.0",
    private: true,
    type: "module",
    devDependencies,
  }, null, 2)}\n`;
}

function reproductionProjectPackage(sourcePackage: ProjectSourcePackageContract): string {
  return `${JSON.stringify({
    ...reproductionProjectPackageFields(sourcePackage),
    version: "0.0.0",
    private: true,
    type: "module",
  }, null, 2)}\n`;
}

function reproductionProjectPackageFields(sourcePackage: ProjectSourcePackageContract | null): Record<string, unknown> {
  if (sourcePackage === null) return { name: "velar-reproduction" };
  return {
    name: sourcePackage.name,
    ...(sourcePackage.exports ? { exports: sourcePackage.exports } : {}),
    velar: {
      entry: sourcePackage.entry,
      entries: sourcePackage.entries,
      targets: sourcePackage.targets,
      requires: sourcePackage.requires,
      ...(sourcePackage.resources ? { resources: sourcePackage.resources } : {}),
    },
  };
}

/**
 * Discipline 3: copy the bundle somewhere else and run the same check against
 * the copy. Everything the check reports is compared verbatim, so a bundle that
 * is missing a file it needed fails this rather than reaching a maintainer.
 */
async function recheckExtractedCopy(
  directory: string,
  nestedProject: boolean,
  bundleInput: string | null,
  toolchainEntry: string,
): Promise<string> {
  const temporary = await realpath(await mkdtemp(join(tmpdir(), "velar-repro-check-")));
  try {
    const extracted = join(temporary, "reproduction");
    await cp(directory, extracted, { recursive: true });
    const projectDirectory = nestedProject ? join(extracted, "project") : extracted;
    const argument = bundleInput ? join(projectDirectory, bundleInput) : projectDirectory;
    const checked = spawnSync(process.execPath, [toolchainEntry, "check", argument], {
      encoding: "utf8",
      maxBuffer: 32 * 1024 * 1024,
    });
    if (checked.error) return `the extracted copy could not be checked: ${checked.error.message}\n`;
    const hint = `${reproductionHint(bundleInput ?? ".")}\n`;
    const output = projectRelative(withoutRuntimeWarnings(checked.stderr ?? ""), projectDirectory);
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

interface ReadmeParts {
  readonly diagnostics: string;
  readonly reproduced: boolean;
  readonly extracted: string;
  readonly bundleInput: string | null;
  readonly nestedProject: boolean;
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
    ...(parts.nestedProject ? ["cd project"] : []),
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
