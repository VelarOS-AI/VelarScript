import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { SLOW_SUFFIX, nodeTestFiles } from "./run-node-tests.mjs";
import { velarProjects } from "./velar-projects.mjs";

/**
 * D116 — from a change set to a suite plan.
 *
 * The four public gates run every suite for every change: a wave that touches
 * only `packages/node` still drives Chromium, and a wave that rewords a
 * paragraph still runs three thousand Node tests. D116 §二.1 says a suite may
 * be skipped for exactly one reason — this change set cannot alter its verdict
 * — and gives two ways to know that: the **package dependency closure** (an
 * upstream change reaches every downstream package) and the **emitted-output
 * fingerprint** (the browser and packed-consumer suites only ever run emitted
 * artifacts, so byte-identical output is an unchanged verdict).
 *
 * This module answers the first question and `gate.mjs` runs what it plans.
 * Nothing here is a list somebody maintains: the packages come from
 * `packages/*`, the standard modules from the roster each extension publishes,
 * the fixture projects from their own `velar.json`, and the change set from
 * git. The one declared fact is the graph in `PACKAGE_UPSTREAM`, which is the
 * D116 §三 ruling itself, and a package missing from it is a failure rather
 * than an absent edge.
 *
 * Usage:
 *   node scripts/gate-scope.mjs [--since <ref>] [--all] [--json | --explain]
 *   node scripts/gate-scope.mjs --write-ownership
 *   node scripts/gate-scope.mjs --check-ownership
 */

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const testsDirectory = join(root, "tests");

/** Where the derived ownership lives, relative to the root. */
export const OWNERSHIP_FILE = "tests/ownership.generated.json";
/** The committed emitted-output listing D116 §三 makes an input to the quick tier. */
export const FINGERPRINT_LOCK = "output-fingerprint.lock";

/**
 * D116 §三, the package graph as upstream edges: a package's tests may be
 * changed by a change to anything it lists here, transitively.
 *
 *   compiler → core → {web, node} → {desktop (web + node), server (node)}
 *
 * `cli` and `create` sit below every package: the CLI compiles against all
 * three target packages' declarations (D111), and `create` scaffolds projects
 * for each of them.
 */
const PACKAGE_UPSTREAM = new Map([
  ["compiler", []],
  ["core", ["compiler"]],
  ["web", ["core"]],
  ["node", ["core"]],
  ["desktop", ["web", "node"]],
  ["server", ["node"]],
  ["cli", ["compiler", "core", "web", "node", "desktop", "server"]],
  ["create", ["compiler", "core", "web", "node", "desktop", "server"]],
]);

/**
 * The packages that consume every other one, and are therefore never evidence
 * that a test is filed in the wrong directory.
 *
 * A Node test that spawns `velar build` exercises the CLI; a library-artifact
 * test that scaffolds a project exercises `create`. Both sit below the whole
 * graph by construction (`PACKAGE_UPSTREAM`), so *every* test that runs a
 * command would otherwise appear in the consistency report, and a report that
 * names two thirds of the suite names nothing. The union in `deriveOwnership`
 * still records them, so those tests still run for a CLI change.
 */
const TOOLING_PACKAGES = ["cli", "create"];

/** The two owners that are not packages. `repo` means everything; `docs` means `check` alone. */
export const REPOSITORY_OWNER = "repo";
export const DOCUMENTATION_OWNER = "docs";

/**
 * Change-set prefixes that are the repository itself rather than one package:
 * the gate scripts, the workspace manifest and lockfile, the type-check
 * configuration, CI, and the two locks other gates read. A change to any of
 * them can move any verdict, so they own everything downstream of `compiler`.
 */
const REPOSITORY_PATHS = [
  "scripts/",
  ".github/",
  "package.json",
  "package-lock.json",
  "tsconfig.json",
  "tsconfig.build.json",
  "file-budget-allowlist.json",
  "surface-lock.json",
  "output-fingerprint.lock",
  OWNERSHIP_FILE,
];

/** A test file's name says which package it belongs to when its imports are ambiguous. */
const NAME_PREFIXES = new Map([
  ["web-", "web"],
  ["node-", "node"],
  ["server-", "server"],
  ["desktop-", "desktop"],
  ["cli-", "cli"],
  ["core-", "core"],
  ["compiler-", "compiler"],
  ["create-", "create"],
]);

// ── The package graph ───────────────────────────────────────────────────────

/** Every package under `packages/`, in code-point order. */
export async function workspacePackageNames(directory = root) {
  const entries = await readdir(join(directory, "packages"), { withFileTypes: true });
  const found = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name === "node_modules") continue;
    const manifest = await readFile(join(directory, "packages", entry.name, "package.json"), "utf8").catch(() => null);
    if (manifest !== null) found.push(entry.name);
  }
  return found.sort(byCodeUnit);
}

/**
 * The packages a change to `owners` can reach: the owners themselves plus
 * everything downstream of them. `repo` reaches every package; `docs` reaches
 * none.
 */
export function downstreamClosure(owners, packages) {
  const missing = packages.filter((name) => !PACKAGE_UPSTREAM.has(name));
  if (missing.length > 0) {
    throw new Error(`${missing.join(", ")} ${missing.length === 1 ? "is" : "are"} not in the D116 package graph in ${basename(fileURLToPath(import.meta.url))}`);
  }
  const wanted = new Set(owners);
  if (wanted.has(REPOSITORY_OWNER)) return [...packages].sort(byCodeUnit);
  const reached = new Set();
  for (const name of packages) {
    if (wanted.has(name) || upstreamOf(name).some((upstream) => wanted.has(upstream))) reached.add(name);
  }
  return [...reached].sort(byCodeUnit);
}

/** Every package transitively upstream of `name`. */
function upstreamOf(name, seen = new Set()) {
  for (const upstream of PACKAGE_UPSTREAM.get(name) ?? []) {
    if (seen.has(upstream)) continue;
    seen.add(upstream);
    upstreamOf(upstream, seen);
  }
  return [...seen];
}

// ── Test ownership, derived ─────────────────────────────────────────────────

/**
 * Which package publishes each `velar/<module>` specifier.
 *
 * Read from the one table each extension publishes rather than from a list
 * here, so a module added to a target is owned the day it is added. Several
 * modules have more than one publisher (`velar/http` is Web, Node and Desktop);
 * `fileOwners` narrows those with the file's own direct imports and otherwise
 * keeps all of them, which is the safe direction.
 */
export async function standardModuleOwners() {
  const owners = new Map();
  const add = (specifier, package_) => {
    if (!owners.has(specifier)) owners.set(specifier, new Set());
    owners.get(specifier).add(package_);
  };
  const compilerExtension = await import("@velarscript/compiler/extension");
  for (const value of Object.values(compilerExtension)) {
    if (typeof value === "string" && value.startsWith("velar/")) add(value, "compiler");
  }
  const core = await import("@velarscript/core");
  for (const specifier of core.standardModuleInterfaces().keys()) add(specifier, "core");
  add(core.VELAR_WORKER_MANIFEST_MODULE, "core");
  for (const [package_, exported] of [["web", "VELAR_WEB_MODULES"], ["node", "VELAR_NODE_MODULES"], ["server", "VELAR_SERVER_MODULES"], ["desktop", "VELAR_DESKTOP_MODULES"]]) {
    const target = await import(`@velarscript/${package_}`);
    for (const specifier of target[exported]) add(specifier, package_);
  }
  return owners;
}

/**
 * Which packages each `velar.json` project declares, by its own manifest:
 * `surfaces` names them and `extensions` names their npm packages. A Core-only
 * project is `core`, and nothing else.
 *
 * `compiler` is deliberately not added here. A project is *downstream* of the
 * compiler — the compiler reads it — so a changed project cannot move a
 * compiler verdict, and reading it as a compiler change would close the whole
 * graph over it and run every suite. `fileOwners` does add `compiler` for a
 * *test* that names a project, because that test compiles it, and compiling is
 * exercising the compiler.
 */
export async function projectPackageOwners(directory = root) {
  const owners = new Map();
  for (const scope of ["examples", "tests/fixtures"]) {
    for (const project of await velarProjects(join(directory, scope))) {
      const manifest = JSON.parse(await readFile(join(project, "velar.json"), "utf8"));
      const declared = new Set();
      for (const surface of Object.keys(manifest.surfaces ?? {})) declared.add(surface);
      for (const extension of manifest.extensions ?? []) {
        const name = /^@velarscript\/([a-z]+)$/u.exec(extension)?.[1];
        if (name !== undefined) declared.add(name);
      }
      owners.set(relative(directory, project).replaceAll("\\", "/"), [...declared].sort(byCodeUnit));
    }
  }
  return owners;
}

/** Every test file ownership is derived for: the Node suites plus the acceptance files. */
export async function ownedTestFiles(directory = root) {
  const tests = join(directory, "tests");
  const found = [];
  await collectTests(tests, tests, found);
  return found.sort(byCodeUnit);
}

/** The walk D115 P5's `tests/<owner>/` layout needs; fixtures and the corpus are inputs, not tests. */
async function collectTests(base, directory, found) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "fixtures" || entry.name === "corpus" || entry.name === "node_modules" || entry.name === ".velar") continue;
      await collectTests(base, path, found);
    } else if (entry.isFile() && (entry.name.endsWith(".test.ts") || entry.name.endsWith(".acceptance.ts"))) {
      found.push(`tests/${relative(base, path).replaceAll("\\", "/")}`);
    }
  }
}

/**
 * D116 §四, after D115 P5 — the directory gives the owner.
 *
 * `tests/<package>/**` is that package; `tests/repo/`, `tests/acceptance/` and
 * `tests/support/` are the repository, which reaches every package. A file
 * still sitting at the root of `tests/` is the repository too, which is the
 * direction a gate is allowed to be wrong in.
 */
export function directoryOwner(name, packages) {
  const first = name.split("/")[1];
  if (first === undefined || !name.slice("tests/".length).includes("/")) return REPOSITORY_OWNER;
  return packages.includes(first) ? first : REPOSITORY_OWNER;
}

/**
 * The packages one test file exercises, from its own text and the text of every
 * `tests/` helper it imports.
 *
 * Five kinds of evidence, unioned, because a missing owner is a test that stops
 * running and a surplus owner is only a test that runs more often than it must:
 *
 *   1. `@velarscript/<p>` and `packages/<p>/{src,dist}` paths — direct, exact.
 *      Both the import spelling and the `join("packages", "<p>", …)` spelling,
 *      because a test that assembles the path is running the same code.
 *   2. the fixture or example projects it names, through their `velar.json`,
 *      plus `compiler`, because naming a project is compiling it.
 *   3. `"velar/<module>"` specifiers, through the publishing roster.
 *   4. a `scripts/*.mjs` gate or helper, which is `repo`: it is repository
 *      infrastructure, so anything downstream of the compiler can move it.
 *   5. a repository document it reads, which is `docs`. D116 §三 gives a
 *      documentation change `check` alone, and that is right for 271 of the 273
 *      files here — but `server-port-zero.test.ts` reads
 *      `docs/ai-skill-server.md` and asserts the bound the runtime enforces is
 *      the bound the skill states. §二.1 allows a suite to be skipped only when
 *      the change cannot alter its verdict, and a documentation change can
 *      alter that one, so the document is an owner like any other.
 *   6. the file name prefix, which is the tie-breaker D116 §四 names.
 */
export function fileOwners(name, text, tables) {
  const direct = new Set();
  for (const [, package_] of text.matchAll(/@velarscript\/([a-z]+)/gu)) if (tables.packages.includes(package_)) direct.add(package_);
  for (const [, package_] of text.matchAll(/packages\/([a-z]+)\/(?:src|dist)/gu)) if (tables.packages.includes(package_)) direct.add(package_);
  for (const [, package_] of text.matchAll(/"packages",\s*"([a-z]+)"/gu)) if (tables.packages.includes(package_)) direct.add(package_);
  const owners = new Set(direct);
  for (const [project, declared] of tables.projects) {
    if (!text.includes(project)) continue;
    // Naming a project is compiling it, so the compiler is exercised too.
    owners.add("compiler");
    for (const package_ of declared) owners.add(package_);
  }
  for (const [, specifier] of text.matchAll(/"(velar\/[a-z0-9-]+)"/gu)) {
    const publishers = tables.modules.get(specifier);
    if (publishers === undefined) continue;
    const narrowed = [...publishers].filter((package_) => direct.has(package_));
    for (const package_ of (narrowed.length > 0 ? narrowed : publishers)) owners.add(package_);
  }
  // Quoted, so a `scripts/…` mentioned in a comment is prose rather than
  // evidence; both spellings, because a path can be imported or assembled, and
  // any number of leading `../` segments, because a helper under
  // `tests/support/` reaches the same script from one directory deeper.
  if (/"(?:\.\.\/)*scripts\/[a-z0-9-]+\.mjs"|"scripts",\s*"[a-z0-9-]+\.mjs"/u.test(text)) owners.add(REPOSITORY_OWNER);
  // A whole document path, so a `docs/…` inside a sentence is prose too.
  if (/"docs\/[A-Za-z0-9._/-]+\.md"/u.test(text)) owners.add(DOCUMENTATION_OWNER);
  const stem = basename(name);
  for (const [prefix, package_] of NAME_PREFIXES) if (stem.startsWith(prefix)) owners.add(package_);
  return [...owners].sort(byCodeUnit);
}

/**
 * A test file's own text plus every `tests/` module it imports, transitively.
 *
 * `packed-tarball-snapshot.test.ts` names no package: it imports
 * `./package-contract.ts`, and the contract is where `npm pack` and the
 * workspace roster live. A helper is part of what the test exercises, so its
 * evidence is the test's evidence.
 */
export async function testFileEvidence(directory, name, cache = new Map()) {
  if (cache.has(name)) return cache.get(name) ?? "";
  cache.set(name, "");
  const text = await readFile(join(directory, name), "utf8").catch(() => "");
  const parts = [text];
  for (const [, specifier] of text.matchAll(/from "(\.[^"]*\.ts)"/gu)) {
    const helper = relative(directory, resolve(join(directory, dirname(name)), specifier)).replaceAll("\\", "/");
    if (helper.startsWith("tests/")) parts.push(await testFileEvidence(directory, helper, cache));
  }
  const combined = parts.join("\n");
  cache.set(name, combined);
  return combined;
}

/**
 * The generated ownership document.
 *
 * Two answers per test, unioned. The **directory** is the declared owner
 * (D116 §四): a file under `tests/web/` runs for a Web change whether or not
 * its text mentions Web. The **import derivation** stays because it is the only
 * thing that can see a test reaching outside its directory, and because §四
 * says a surplus owner only runs a test more often than it must while a missing
 * one stops it running at all.
 *
 * Where the two disagree in the direction that would *lose* a run — the test
 * exercises a package that is neither its directory's nor upstream of it, so a
 * change to that package would not reach the directory's owner — the file is
 * listed in `consistency` rather than moved. That is the check D116 §四 keeps
 * the derivation for.
 */
export async function deriveOwnership(directory = root) {
  const packages = await workspacePackageNames(directory);
  const tables = { packages, modules: await standardModuleOwners(), projects: await projectPackageOwners(directory) };
  const tests = {};
  const unclassified = [];
  const consistency = {};
  const cache = new Map();
  for (const name of await ownedTestFiles(directory)) {
    const derived = fileOwners(name, await testFileEvidence(directory, name, cache), tables);
    if (derived.length === 0) unclassified.push(name);
    const declared = directoryOwner(name, packages);
    tests[name] = [...new Set([declared, ...derived])].sort(byCodeUnit);
    if (declared !== REPOSITORY_OWNER) {
      const covered = new Set([declared, ...upstreamOf(declared), ...TOOLING_PACKAGES]);
      const outside = derived.filter((owner) => owner !== DOCUMENTATION_OWNER && !covered.has(owner));
      if (outside.length > 0) consistency[name] = { declared, exercises: outside.sort(byCodeUnit) };
    }
  }
  return { packages, tests, unclassified, consistency };
}

/** The generated file's exact text, so `--write-ownership` and `--check-ownership` cannot disagree. */
export function ownershipText(ownership) {
  return `${JSON.stringify({
    generatedBy: "node scripts/gate-scope.mjs --write-ownership",
    decision: "D116",
    packages: ownership.packages,
    unclassified: ownership.unclassified,
    consistency: ownership.consistency ?? {},
    tests: ownership.tests,
  }, null, 2)}\n`;
}

/** The committed ownership, which planning reads so a plan needs no build. */
export async function readOwnership(directory = root) {
  const text = await readFile(join(directory, OWNERSHIP_FILE), "utf8").catch(() => null);
  if (text === null) {
    throw new Error(`${OWNERSHIP_FILE} is missing; regenerate it with \`node scripts/gate-scope.mjs --write-ownership\``);
  }
  return JSON.parse(text);
}

/**
 * The heavy tier, read from the names themselves.
 *
 * `tests/heavy.json` used to hold this list, with a measured duration beside
 * each entry. D115 P5 replaced it with the `.slow.test.ts` suffix: a list of
 * file names in a second place is a list that goes stale the first time a file
 * is renamed, and the suffix travels with the file. What the list could say and
 * the suffix cannot — *how* slow, and why — belongs in the file's own header.
 */
export async function heavyNodeTests(directory = root) {
  const all = await nodeTestFiles(join(directory, "tests"), "full");
  return all
    .map((file) => relative(directory, file).replaceAll("\\", "/"))
    .filter((file) => file.endsWith(SLOW_SUFFIX));
}

// ── The change set, from git ────────────────────────────────────────────────

const ZERO_SHA = "0000000000000000000000000000000000000000";

function git(directory, ...arguments_) {
  const execution = spawnSync("git", arguments_, { cwd: directory, encoding: "utf8" });
  return { status: execution.status, text: `${execution.stdout ?? ""}`.trimEnd() };
}

/**
 * The base this change set is measured against.
 *
 * `--since` wins; otherwise the merge base with `origin/main`, which is the
 * commit a wave branched from. A checkout with no `origin/main` — a worktree
 * cut for one wave, a CI runner's first push — falls back to `HEAD~1`, and a
 * repository with no second commit has no base at all, which `buildPlan` reads
 * as "run everything in the quick tier".
 */
export function changeBase(directory = root, since = undefined) {
  const candidates = since === undefined || since === "" || since === ZERO_SHA
    ? [{ ref: "origin/main", how: "merge base with origin/main" }, { ref: "HEAD~1", how: "no origin/main in this checkout, so HEAD~1" }]
    : [{ ref: since, how: `--since ${since}` }, { ref: "HEAD~1", how: `${since} is not a commit in this checkout, so HEAD~1` }];
  for (const candidate of candidates) {
    const resolved = git(directory, "rev-parse", "--verify", "--quiet", `${candidate.ref}^{commit}`);
    if (resolved.status !== 0) continue;
    const mergeBase = git(directory, "merge-base", "HEAD", resolved.text);
    return { ref: candidate.ref, commit: mergeBase.status === 0 ? mergeBase.text : resolved.text, how: candidate.how };
  }
  return { ref: null, commit: null, how: "no base commit is reachable" };
}

/** Committed changes since the base, plus everything the working tree and index hold. */
export function changedPaths(directory = root, base) {
  const paths = new Set();
  if (base.commit !== null) {
    const diff = git(directory, "diff", "--name-only", `${base.commit}...HEAD`);
    for (const line of diff.text.split("\n")) if (line !== "") paths.add(line);
  }
  const status = git(directory, "status", "--porcelain");
  for (const line of status.text.split("\n")) {
    if (line.length < 4) continue;
    const subject = line.slice(3);
    const renamed = subject.split(" -> ");
    paths.add((renamed.at(-1) ?? subject).replace(/^"|"$/gu, ""));
  }
  return [...paths].sort(byCodeUnit);
}

// ── One path to one owner ───────────────────────────────────────────────────

/**
 * The owner of one changed path, and the D116 §三 rule that decided it.
 *
 * A path nothing else claims is `repo`: an unrecognised file at the root of the
 * checkout is exactly the case where guessing narrow is guessing wrong.
 */
export function classifyPath(path, ownership, projects) {
  const normalized = path.replaceAll("\\", "/");
  for (const prefix of REPOSITORY_PATHS) {
    if (normalized === prefix || normalized.startsWith(prefix)) return { owners: [REPOSITORY_OWNER], rule: `${prefix} is the repository itself` };
  }
  const package_ = /^packages\/([^/]+)\//u.exec(normalized)?.[1];
  if (package_ !== undefined && ownership.packages.includes(package_)) return { owners: [package_], rule: `packages/${package_}/**` };
  if (normalized.startsWith("docs/") || normalized.endsWith(".md")) return { owners: [DOCUMENTATION_OWNER], rule: "documentation" };
  const project = longestProject(normalized, projects);
  if (project !== null) return { owners: projects[project], rule: `${project}/velar.json declares ${projects[project].join(", ")}` };
  if (normalized.startsWith("tests/")) return testPathOwners(normalized, ownership);
  return { owners: [REPOSITORY_OWNER], rule: "unrecognised path, so everything downstream" };
}

/** The fixture or example project a path lies inside, longest match first. */
function longestProject(path, projects) {
  let best = null;
  for (const project of Object.keys(projects)) {
    if (!path.startsWith(`${project}/`)) continue;
    if (best === null || project.length > best.length) best = project;
  }
  return best;
}

/** A changed file under `tests/`: a test carries its own ownership, a shared harness carries everything. */
function testPathOwners(path, ownership) {
  const owners = ownership.tests[path];
  if (owners !== undefined && path.endsWith(".test.ts")) return { owners, rule: `${OWNERSHIP_FILE} derives ${owners.join(", ")}` };
  if (path.endsWith(".acceptance.ts")) return { owners: [REPOSITORY_OWNER], rule: "an acceptance harness every gate reads" };
  if (path.startsWith("tests/support/")) return { owners: [REPOSITORY_OWNER], rule: "tests/support/** is the shared harness" };
  if (path.endsWith(".test.ts")) return { owners: [REPOSITORY_OWNER], rule: `no ${OWNERSHIP_FILE} entry yet, so everything downstream` };
  return { owners: [REPOSITORY_OWNER], rule: "a shared test harness file" };
}

// ── The plan ────────────────────────────────────────────────────────────────

/**
 * What to run for this change set.
 *
 * The quick tier is `check`, the emitted-output fingerprint, and the Node test
 * files whose ownership meets the downstream closure of the changed owners.
 * The browser and packed-consumer suites are never in it: D116 §三 puts them in
 * the heavy tier, where `release:check` runs them, and the fingerprint is what
 * stands in for them until then.
 */
export async function buildPlan(options = {}) {
  const directory = options.root ?? root;
  const ownership = options.ownership ?? await readOwnership(directory);
  const projects = options.projects ?? Object.fromEntries(await projectPackageOwners(directory));
  const universe = (await nodeTestFiles(join(directory, "tests"), "quick")).map((file) => relative(directory, file).replaceAll("\\", "/"));
  const deferred = options.heavy ?? await heavyNodeTests(directory);

  const base = options.all === true ? { ref: null, commit: null, how: "--all, so the change set is ignored" } : (options.base ?? changeBase(directory, options.since));
  const changes = options.all === true ? [] : (options.changes ?? changedPaths(directory, base));
  const reasons = {};
  const owners = new Set();
  for (const path of changes) {
    const classified = classifyPath(path, ownership, projects);
    reasons[path] = classified;
    for (const owner of classified.owners) owners.add(owner);
  }
  // D116 §二.2 — a plan is only ever narrower than everything when git says
  // what changed. A clean tree with no diff has told us nothing, so it runs the
  // whole quick tier and says why.
  const everything = options.all === true || changes.length === 0;
  // An owner that is neither a package nor `docs` is a name this graph does not
  // model — a surface key that stopped matching a package, say. Reading it as
  // `repo` runs everything, which is the direction a gate is allowed to be
  // wrong in.
  const planned = [...owners]
    .filter((owner) => owner !== DOCUMENTATION_OWNER)
    .map((owner) => (owner === REPOSITORY_OWNER || ownership.packages.includes(owner) ? owner : REPOSITORY_OWNER));
  const closure = everything ? ownership.packages : downstreamClosure(planned, ownership.packages);
  // What a test's ownership is matched against: every package this change can
  // reach, plus `docs` when it changed a document a test can read.
  const running = everything || owners.has(DOCUMENTATION_OWNER) ? [...closure, DOCUMENTATION_OWNER] : closure;

  const node = universe.filter((file) => everything || runsUnder(ownership.tests[file] ?? [REPOSITORY_OWNER], running));
  const skipped = universe.filter((file) => !node.includes(file));
  return {
    decision: "D116",
    tier: "quick",
    all: options.all === true,
    base,
    changes,
    owners: [...owners].sort(byCodeUnit),
    closure,
    running,
    everything,
    suites: {
      check: true,
      fingerprint: closure.length > 0,
      node,
      projectUnit: closure.length > 0,
      browser: false,
      packages: false,
    },
    deferred: {
      node: deferred,
      browser: "heavy tier runs in release:check",
      packages: "heavy tier runs in release:check",
    },
    skipped: { files: skipped, owners: ownerHistogram(skipped, ownership) },
    reasons,
  };
}

/**
 * A test runs when anything it exercises is in the running set.
 *
 * `repo` is the one owner that is not matched by name: it means "every
 * package", so a `repo`-owned test runs on any change that reaches a package
 * and not on a documentation-only change, which reaches none. That is D116 §三's
 * "documentation runs `check`" — held for every test except the ones that read
 * a document, which own `docs` and run for exactly that reason.
 */
function runsUnder(owners, running) {
  if (running.length === 0) return false;
  if (owners.some((owner) => running.includes(owner))) return true;
  return owners.includes(REPOSITORY_OWNER) && running.some((owner) => owner !== DOCUMENTATION_OWNER);
}

/** How many skipped files each owner set accounts for, for the summary line. */
function ownerHistogram(files, ownership) {
  const counts = {};
  for (const file of files) {
    for (const owner of ownership.tests[file] ?? [REPOSITORY_OWNER]) counts[owner] = (counts[owner] ?? 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort(([left], [right]) => byCodeUnit(left, right)));
}

// ── Rendering ───────────────────────────────────────────────────────────────

/** The human reading of a plan: what changed, what it owns, what runs, what does not. */
export function explainPlan(plan) {
  const lines = [];
  if (plan.all) lines.push("Scope: --all, so every quick-tier suite runs regardless of the change set.");
  else if (plan.everything) lines.push(`Scope: no change set (${plan.base.how}), so every quick-tier suite runs.`);
  else lines.push(`Scope: ${plan.changes.length} changed path${plan.changes.length === 1 ? "" : "s"} (${plan.base.how}${plan.base.commit === null ? "" : ` at ${plan.base.commit.slice(0, 8)}`}).`);
  const width = Math.min(64, Math.max(0, ...plan.changes.map((path) => path.length)));
  for (const path of plan.changes) {
    const reason = plan.reasons[path];
    lines.push(`  ${path.padEnd(width)} → ${reason.owners.join(", ")}   (${reason.rule})`);
  }
  if (!plan.everything) {
    const documentation = plan.running.includes(DOCUMENTATION_OWNER)
      ? `${plan.closure.length === 0 ? "" : " + "}docs (the tests that read a repository document)`
      : "";
    lines.push(`Owners: ${plan.owners.join(", ") || "none"} → runs the tests of: ${plan.closure.join(", ")}${documentation || (plan.closure.length === 0 ? "nothing" : "")}`);
  }
  lines.push(`check: runs${plan.suites.fingerprint ? "" : " (documentation-only change set, so the emitted-output fingerprint is skipped as well)"}`);
  if (plan.suites.fingerprint) lines.push(`fingerprint: compared against ${FINGERPRINT_LOCK}`);
  const total = plan.suites.node.length + plan.skipped.files.length;
  const histogram = Object.entries(plan.skipped.owners).map(([owner, count]) => `${owner} ${count}`).join(", ");
  lines.push(`Node suite: ${plan.suites.node.length} of ${total} quick-tier files run`
    + (plan.skipped.files.length === 0 ? "" : `; ${plan.skipped.files.length} skipped, owned by ${histogram}`));
  lines.push(`project unit gate: ${plan.suites.projectUnit ? "runs" : "skipped, no package in the plan owns a project"}`);
  lines.push(`browser: deferred to release (heavy tier); packed consumers: deferred to release (heavy tier); `
    + `${plan.deferred.node.length} heavy Node files deferred — heavy tier runs in release:check`);
  return lines.join("\n");
}

/**
 * The closing summary `gate.mjs` prints.
 *
 * `ran` is what this invocation actually ran, which is not always the whole
 * plan: CI splits the quick tier over jobs with `--only`, and a summary that
 * said "124 files run" in a job that ran none of them would be the shape
 * AGENTS.md calls a promise wider than the code.
 */
export function summarizePlan(plan, ran) {
  const total = plan.suites.node.length + plan.skipped.files.length;
  const verb = ran.some((label) => label.startsWith("Node suite")) ? "run" : "planned";
  return [
    `gate (${plan.tier} tier): ${ran.join(", ")}`,
    `  Node suite   ${plan.suites.node.length} of ${total} files ${verb}, ${plan.skipped.files.length} skipped`
      + (plan.skipped.files.length === 0 ? "" : ` (${Object.entries(plan.skipped.owners).map(([owner, count]) => `${owner} ${count}`).join(", ")})`),
    `  heavy tier   ${plan.deferred.node.length} Node files, the browser suite and the packed-consumer suite deferred — heavy tier runs in release:check`,
  ].join("\n");
}

function byCodeUnit(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

// ── Command line ────────────────────────────────────────────────────────────

/** The flags this script and `gate.mjs` share. An unknown flag is refused, never ignored. */
export function parseScopeArguments(argv, extra = new Set()) {
  const parsed = { since: undefined, all: false, json: false, explain: false, writeOwnership: false, checkOwnership: false, rest: {} };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === "--all") parsed.all = true;
    else if (flag === "--json") parsed.json = true;
    else if (flag === "--explain") parsed.explain = true;
    else if (flag === "--write-ownership") parsed.writeOwnership = true;
    else if (flag === "--check-ownership") parsed.checkOwnership = true;
    else if (flag === "--since" || extra.has(flag)) {
      const value = argv[index + 1];
      if (value === undefined) throw new Error(`${flag} requires a value`);
      if (flag === "--since") parsed.since = value;
      else parsed.rest[flag] = value;
      index += 1;
    } else throw new Error(`unrecognised argument: ${flag}`);
  }
  return parsed;
}

/** `--write-ownership` and `--check-ownership`, which are the same derivation read two ways. */
async function ownershipCommand(options) {
  const derived = await deriveOwnership(root);
  const text = ownershipText(derived);
  const path = join(root, OWNERSHIP_FILE);
  if (options.writeOwnership) {
    await writeFile(path, text, "utf8");
    process.stdout.write(`Wrote ${OWNERSHIP_FILE}: ${Object.keys(derived.tests).length} test files over ${derived.packages.length} packages`
      + `${derived.unclassified.length === 0 ? "" : `, ${derived.unclassified.length} unclassified (they run on every change)`}\n`);
    process.stdout.write(consistencyReport(derived));
    return 0;
  }
  const committed = await readFile(path, "utf8").catch(() => null);
  if (committed === text) {
    process.stdout.write(`Checked ${OWNERSHIP_FILE} against a fresh derivation: ${Object.keys(derived.tests).length} test files agree\n`);
    process.stdout.write(consistencyReport(derived));
    return 0;
  }
  const scratch = join(await mkdtemp(join(tmpdir(), "velar-test-ownership-")), "ownership.generated.json");
  await writeFile(scratch, text, "utf8");
  process.stderr.write([
    committed === null
      ? `  ${OWNERSHIP_FILE} is missing.`
      : `  ${OWNERSHIP_FILE} does not match what tests/ derives${describeFirstDifference(committed, text)}.`,
    "",
    `  A fresh derivation is at ${scratch}.`,
    "",
    "  Test ownership is derived from the test files themselves, so the fix is never to edit the generated",
    "  file: run `node scripts/gate-scope.mjs --write-ownership` and commit what it writes.",
    "",
    "scripts/gate-scope.mjs: 1 problem.",
    "",
  ].join("\n"));
  return 1;
}

/**
 * D116 §四's consistency check, as prose: the tests whose imports reach outside
 * what their directory's owner covers. Reported, never moved — the union in
 * `deriveOwnership` already keeps them running, and where the file belongs is a
 * judgment a gate does not get to make.
 */
function consistencyReport(ownership) {
  const entries = Object.entries(ownership.consistency ?? {});
  if (entries.length === 0) return "  Every test's imports stay inside what its directory's owner covers.\n";
  const lines = [`  ${entries.length} test${entries.length === 1 ? "" : "s"} exercise a package their directory does not cover (D116 §四, reported not moved; the CLI and create are excluded, they consume every package):`];
  for (const [name, found] of entries) lines.push(`    ${name}  is ${found.declared}, and also exercises ${found.exercises.join(", ")}`);
  return `${lines.join("\n")}\n`;
}

/** The first line two texts disagree on, because a byte count is not navigable. */
function describeFirstDifference(left, right) {
  const before = left.split("\n");
  const after = right.split("\n");
  for (let index = 0; index < Math.max(before.length, after.length); index += 1) {
    if (before[index] === after[index]) continue;
    return `, first at line ${index + 1}:\n    committed: ${before[index] ?? "(missing)"}\n    derived:   ${after[index] ?? "(missing)"}`;
  }
  return "";
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let options;
  try {
    options = parseScopeArguments(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`${error.message}\n\nUsage: gate-scope.mjs [--since <ref>] [--all] [--json | --explain] [--write-ownership | --check-ownership]\n`);
    process.exit(2);
  }
  if (options.writeOwnership || options.checkOwnership) process.exit(await ownershipCommand(options));
  const plan = await buildPlan({ since: options.since, all: options.all });
  if (options.json) process.stdout.write(`${JSON.stringify(plan)}\n`);
  else process.stdout.write(`${explainPlan(plan)}\n`);
}
