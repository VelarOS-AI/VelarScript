import { readdir, readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
// The install version and the package→surface map are read from the packages
// that own them rather than restated here, for the reason D110 rule 6 gives:
// a number spelled twice is a number that drifts. `VELAR_VERSION` is the single
// source `velar --version` itself prints (`packages/cli/src/cli.ts` writes
// `velar ${VELAR_VERSION}`), and `surfaceOfExtensionPackage` is the same
// partition the compiler applies when it loads a project's extensions.
import { surfaceOfExtensionPackage } from "../packages/cli/src/extension-metadata.ts";
import { VELAR_VERSION } from "../packages/cli/src/version.ts";
import { VELAR_TEMPLATE_SURFACE_VERSIONS } from "../packages/create/src/types.ts";
import {
  SURFACE_NAMES,
  SURFACE_VERSIONS,
  SURFACE_VERSION_SITES,
  surfaceDigest,
  surfaceInventory,
  surfacePartitionFailures,
} from "./surface-inventory.mjs";
import { velarToolchainPackages } from "./velar-packages.mjs";

/**
 * D110 — one installation number, five surface versions.
 *
 * Every npm package in this repository steps to the same version, and that one
 * number covers five surfaces that do not move together: Desktop's contract sat
 * at 0.10 through several releases while its package climbed with everyone
 * else's, so "desktop 0.25.0" told a reader nothing about whether the Desktop
 * surface had changed. The five surface versions say what the release number
 * cannot — *which* surface you have to re-read after an upgrade.
 *
 * The whole difference between this and writing a version into a document is
 * that the number is not trusted. **The surface is hashed.** Prose versions
 * drift: the website accumulated 24 hand-written `0.20.0`s that were all stale
 * by 0.24, which is D110's own background section. So:
 *
 *  1. `scripts/surface-inventory.mjs` reads every compiler-owned vocabulary
 *     table and files each name under the package that declares it. It is the
 *     same reading `check-tour-coverage.mjs` performs — one enumeration, two
 *     questions — because two gates each reading the language their own way is
 *     how they come to disagree without anybody noticing.
 *  2. Each surface's names and canonical public contracts are sorted and
 *     hashed together.
 *  3. `surface-lock.json` records what each surface hashed to, beside the
 *     version that was current when it did.
 *  4. A digest that no longer matches while its version stands still is a
 *     **failure**, and the failure names the constant to bump, the manifest
 *     field to match, and the lock entry to paste.
 *
 * This is the shape of `check-tour-coverage.mjs`'s `FLOORS`, and for the same
 * stated reason: "a floor that shrinks is a deliberate act, which is why it is
 * acknowledged here rather than silently lowered." Changing a surface is a
 * deliberate act too. The lock is where it is acknowledged, and this gate is
 * what makes the acknowledgment unavoidable rather than remembered.
 *
 * The bump rule is one rule, from D110's ruling: any addition, removal, or
 * change to a surface is `N + 1`. VelarScript is pre-1.0 and promises no
 * compatibility, so a surface version carries none of SemVer's major/minor/
 * patch freight — it is a counter, and `0.N`'s `N` is how many times that
 * surface has moved since counting began, so a low number beside a high one
 * says that surface started counting later and nothing more.
 *
 * ── The prose that quotes these numbers ────────────────────────────────────
 *
 * Hashing the surface settles what the numbers *are*. It says nothing about the
 * places a human sentence repeats them, and those are precisely what this
 * gate's own background section says drifts: two dozen hand-written `0.20.0`s,
 * all stale in one release. The 0.30.0 documentation refresh wrote the install
 * version and the five counters into both root READMEs, into
 * `docs/getting-started.md`, and into the opening line of every package README.
 * Pass 5 reads those files rather than trusting them. Every `velar <x.y.z>` or
 * `VelarScript <x.y.z>` line, every `<surface>@<N.M>` token, every `surfaces`
 * entry, and every `"@velarscript/…"` pin has to equal the value that is live
 * right now: the surface versions from `SURFACE_VERSIONS`, the install version
 * from `VELAR_VERSION` in `packages/cli/src/version.ts` — the one constant
 * `velar --version` prints, so the sentence and the banner cannot disagree. A
 * pin's own shape says which of the two it carries: `x.y.z` is the release
 * every package steps to, `N.M` is a surface counter.
 *
 * A file on that list carrying no version site at all is a failure too. It is
 * the same worst case as an empty digest and an unwalked tree — a gate that
 * checks nothing — and it is how a pass like this one quietly stops covering a
 * document that was reworded out from under it.
 *
 * Usage:
 * `node scripts/check-surface-versions.mjs [lock-file] [--prose-root <dir>]`.
 * The optional lock path exists for the same reason the coverage gate takes an
 * optional tour root: a gate that checks nothing fails silently, so being able
 * to point this one at a mutated lock and watch it go red is part of owning it.
 * `--prose-root` is that same handle for pass 5 — it points the prose scan at a
 * copied tree while the live constants stay the yardstick, which is how the
 * stale-token case is watched to fail without editing a checked-in document.
 */

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const argv = process.argv.slice(2);
const proseRootFlag = argv.indexOf("--prose-root");
if (proseRootFlag !== -1 && argv[proseRootFlag + 1] === undefined) {
  process.stderr.write("--prose-root needs a directory.\n\n"
    + "Usage: node scripts/check-surface-versions.mjs [lock-file] [--prose-root <dir>]\n");
  process.exit(1);
}
const proseRoot = proseRootFlag === -1 ? root : resolve(argv[proseRootFlag + 1]);
const positional = proseRootFlag === -1
  ? argv
  : [...argv.slice(0, proseRootFlag), ...argv.slice(proseRootFlag + 2)];
const lockPath = positional[0] ? resolve(positional[0]) : join(root, "surface-lock.json");

// ── Vacuity floors ──────────────────────────────────────────────────────────
// The worst failure of a digest gate is not a red build, it is a green one that
// hashed nothing: an extension whose module table failed to load hashes the
// empty string perfectly reproducibly, and the lock would agree with it
// forever. These are minimums, not the truth — the truth is whatever the tables
// say today, and the report below prints it. Growing a surface raises the real
// counts and leaves these alone; shrinking one below its floor is a deliberate
// act that has to be acknowledged here.
const FLOORS = Object.freeze({
  core: 200,
  web: 400,
  node: 80,
  // Server and Desktop are small on purpose: both are read as what they add on
  // top of the surfaces they compose, so Server's count is `velar/server` and
  // `velar/realtime` rather than all of Node again.
  server: 8,
  desktop: 50,
});

const API_VERSION = /^(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)$/u;

// ── The prose sites (pass 5) ────────────────────────────────────────────────

/** Where the install version is declared, named in every failure it explains. */
const INSTALL_VERSION_SOURCE = "packages/cli/src/version.ts: VELAR_VERSION";

/**
 * The three documents that carry these numbers by name. Package READMEs are
 * discovered instead, one per directory under `packages/`, so a new package
 * joins this pass by existing. These three cannot be discovered that way and
 * are therefore required to be there: a list that silently shortens is the same
 * defect as a digest over nothing.
 */
const REQUIRED_PROSE_FILES = Object.freeze(["README.md", "README.zh-CN.md", "docs/getting-started.md"]);

/**
 * The shapes a version takes in prose, each paired with the live value it has
 * to equal. `read` answers `{subject, written, current, source}`: what the
 * document says, what is true, and where the truth is declared — the three
 * things a failure has to print to be actionable rather than merely correct.
 */
const PROSE_SITES = Object.freeze([
  {
    kind: "the release transcript",
    pattern: /\bvelar (\d+(?:\.\d+)+)/gu,
    read: (match) => releaseSite(match[0], match[1]),
  },
  {
    kind: "the release line",
    pattern: /\bVelarScript (\d+(?:\.\d+)+)/gu,
    read: (match) => releaseSite(match[0], match[1]),
  },
  {
    kind: "a surface counter",
    pattern: /\b(core|web|node|server|desktop)@(\d+(?:\.\d+)+)/gu,
    read: (match) => surfaceSite(match[0], match[1], match[2]),
  },
  {
    kind: "a 'surfaces' entry",
    pattern: /"(core|web|node|server|desktop)":\s*"(\d+(?:\.\d+)+)"/gu,
    read: (match) => surfaceSite(match[0], match[1], match[2]),
  },
  {
    kind: "a toolchain pin",
    pattern: /"(@velarscript\/[a-z][a-z-]*)":\s*"([^"]*)"/gu,
    read: (match) => toolchainPin(match[0], match[1], match[2]),
  },
]);

const failures = [];

// ── 1. The partition still describes the workspace ──────────────────────────

failures.push(...surfacePartitionFailures(await velarToolchainPackages(root)));

// ── 2. Each surface's version is declared where the partition says it is ────

for (const surface of SURFACE_NAMES) {
  const site = SURFACE_VERSION_SITES[surface];
  const version = SURFACE_VERSIONS[surface];
  if (site === undefined) {
    failures.push(`surface '${surface}' has no entry in SURFACE_VERSION_SITES, so this gate cannot say where to bump it`);
    continue;
  }
  if (typeof version !== "string" || !API_VERSION.test(version)) {
    failures.push(`${site.file}: ${site.constant} is ${JSON.stringify(version)}; a surface version is 'major.minor' with no leading zeros`);
    continue;
  }
  const declared = await readFile(join(root, site.file), "utf8");
  if (!declared.includes(`export const ${site.constant} = ${JSON.stringify(version)}`)) {
    failures.push(`${site.file} does not declare '${site.constant} = ${JSON.stringify(version)}'; SURFACE_VERSION_SITES in scripts/surface-inventory.mjs is pointing at the wrong file, or the constant moved`);
  }
  if (site.manifest === null) continue;
  // An extension's installed package metadata is the copy every project reads
  // (`velar.extension.apiVersion`), and `validateLoadedExtension` refuses a
  // mismatch at project load. Saying it here too means the author who bumps the
  // constant is told about the manifest while they are still in the commit that
  // bumps it, rather than by whichever project happens to load next.
  const manifest = JSON.parse(await readFile(join(root, site.manifest), "utf8"));
  const published = manifest?.velar?.extension?.apiVersion;
  if (published !== version) {
    failures.push(`${site.manifest}: 'velar.extension.apiVersion' is ${JSON.stringify(published)}, but ${site.constant} is ${JSON.stringify(version)} — a surface version is one number in two places, bumped together`);
  }
}

// ── 3. The scaffolder's copy ────────────────────────────────────────────────
// `create-velar` ships no dependencies on purpose, so it cannot read a surface
// version out of a package it is still writing the install line for. Its table
// is therefore literals — and therefore checked here, in the same shape
// `scripts/release-toolchain.mjs` checks `VELAR_CREATE_VERSION`. Without this,
// a bumped surface would go on being scaffolded at its old number and every new
// project would open with a manifest its own compiler refuses.
const templateSurfaces = Object.keys(VELAR_TEMPLATE_SURFACE_VERSIONS);
for (const surface of SURFACE_NAMES) {
  const scaffolded = VELAR_TEMPLATE_SURFACE_VERSIONS[surface];
  if (scaffolded === SURFACE_VERSIONS[surface]) continue;
  failures.push(`packages/create/src/types.ts: VELAR_TEMPLATE_SURFACE_VERSIONS scaffolds ${surface}@${scaffolded ?? "(nothing)"}, but ${surface}@${SURFACE_VERSIONS[surface]} is what this toolchain publishes — set it to ${JSON.stringify(SURFACE_VERSIONS[surface])} in the commit that bumps the surface, or every project 'velar create' writes opens with a manifest its own compiler refuses`);
}
for (const surface of templateSurfaces) {
  if (!SURFACE_NAMES.includes(surface)) {
    failures.push(`packages/create/src/types.ts: VELAR_TEMPLATE_SURFACE_VERSIONS names '${surface}', which is not one of the surfaces D110 rule 1 names (${SURFACE_NAMES.join(", ")})`);
  }
}

// ── 4. The surfaces themselves ──────────────────────────────────────────────

const inventory = surfaceInventory();
failures.push(...inventory.failures);

const lock = await readLock();
const summary = [];
const bumped = [];

for (const surface of SURFACE_NAMES) {
  const entry = inventory.surfaces.get(surface);
  const version = SURFACE_VERSIONS[surface];
  const names = [...entry.names.keys()].sort(byCodeUnit);
  const digest = surfaceDigest(entry.names);
  const floor = FLOORS[surface];

  summary.push(`  ${surface.padEnd(8)} ${`${surface}@${version}`.padEnd(14)} ${String(names.length).padStart(4)} names  ${digest.slice(0, 16)}…`
    + (entry.beneath.length > 0 ? `  (over ${entry.beneath.join(", ")}; ${entry.published} published in all)` : ""));

  if (floor === undefined) {
    failures.push(`surface '${surface}' has no vacuity floor; add one to FLOORS in scripts/check-surface-versions.mjs so an empty table cannot pass`);
  } else if (names.length < floor) {
    failures.push(`The ${surface} surface published only ${names.length} names; expected at least ${floor}. A vocabulary table read short or empty, and a digest over nothing agrees with itself forever.`);
  }

  const recorded = lock?.surfaces?.[surface];
  if (recorded === undefined) {
    failures.push(`surface-lock.json records nothing for the ${surface} surface; every surface D110 rule 1 names carries a {"version", "digest"} entry`);
    continue;
  }
  if (recorded.digest === digest && recorded.version === version) continue;
  if (recorded.digest === digest) {
    failures.push(`The ${surface} surface is unchanged, but ${site(surface).constant} says ${version} while surface-lock.json says ${recorded.version}.`
      + ` One of the two moved alone. If the version is right, set surface-lock.json's "${surface}" entry to ${JSON.stringify({ version, digest }, null, 0)}.`);
    continue;
  }
  if (recorded.version !== version) {
    // Both moved: the digest and the version were changed together, which is
    // the bump this gate exists to require. All that is left is that the lock
    // carries the new digest.
    failures.push(`The ${surface} surface changed and ${surface}@${version} was bumped with it, but surface-lock.json still holds the old digest.`
      + ` Set its "${surface}" entry to ${JSON.stringify({ version, digest }, null, 0)}.`);
    continue;
  }
  bumped.push({ surface, version, digest });
}

for (const item of bumped) {
  const next = nextVersion(item.version);
  failures.push([
    `The ${item.surface} surface changed while ${item.surface}@${item.version} stood still.`,
    "",
    "  A surface version is a counter, and a change to a surface is a deliberate act (D110 rule 4).",
    "  Nothing here can tell whether the change was intended; it can only refuse to let it pass",
    "  unrecorded, because an upgrade that says nothing about which surface moved is the defect",
    "  this number exists to remove. In the same commit:",
    "",
    `    1. ${site(item.surface).file}: ${site(item.surface).constant} = ${JSON.stringify(next)}`,
    ...(site(item.surface).manifest === null ? [] : [`    2. ${site(item.surface).manifest}: "velar.extension.apiVersion": ${JSON.stringify(next)}`]),
    `    ${site(item.surface).manifest === null ? "2" : "3"}. surface-lock.json: "${item.surface}": ${JSON.stringify({ version: next, digest: item.digest }, null, 0)}`,
    `    ${site(item.surface).manifest === null ? "3" : "4"}. CHANGELOG.md: the ${item.surface} section of the release you are writing`,
    "",
    "  If instead you meant to leave the surface alone, the change to it is the bug.",
  ].join("\n"));
}

// ── 5. The prose that quotes these numbers ──────────────────────────────────

const prose = await checkProseVersions(proseRoot);
failures.push(...prose.failures);

// GA-I6: the summary is the green verdict, so it is printed only when the run
// is green. Printed above the failures it asserted what those failures deny —
// one run said "all read against velar 0.32.0" and then refused a file for
// carrying no version site at all.
if (failures.length > 0) {
  console.error(`The surface versions do not describe the surfaces (D110 rule 4):\n\n${failures.join("\n\n")}\n`);
  process.exitCode = 1;
} else {
  console.log([
    `Hashed ${SURFACE_NAMES.length} language surfaces (D110):`,
    ...summary,
    `  lock: ${relativeToRoot(lockPath)}`,
    `  prose: ${prose.files} files, ${prose.sites} version sites, all read against velar ${VELAR_VERSION}`
      + (proseRoot === root ? "" : ` (under ${proseRoot})`),
  ].join("\n"));
}

function site(surface) {
  return SURFACE_VERSION_SITES[surface];
}

/** `0.12` → `0.13`. One rule, one counter (D110 rule 4). */
function nextVersion(version) {
  const parts = version.split(".");
  return [...parts.slice(0, -1), String(Number(parts.at(-1)) + 1)].join(".");
}

// ── Pass 5: prose sites ─────────────────────────────────────────────────────

function releaseSite(subject, written) {
  return { subject, written, current: VELAR_VERSION, source: INSTALL_VERSION_SOURCE };
}

function surfaceSite(subject, surface, written) {
  return { subject, written, current: SURFACE_VERSIONS[surface], source: `${site(surface).file}: ${site(surface).constant}` };
}

/**
 * A pin's own shape says which number it carries: `x.y.z` is the one release
 * number every package steps to, `N.M` is the surface version of the package
 * named — the `composes` pins at the top of the Server and Desktop READMEs.
 * Anything else falls through to the release version, so an unpinned or ranged
 * `@velarscript/*` dependency goes red rather than passing unread; a range in
 * this scope would already be the defect `docs/getting-started.md` explains.
 */
function toolchainPin(subject, packageName, written) {
  const parts = /^\d+(?:\.\d+)+$/u.test(written) ? written.split(".") : null;
  const surface = parts?.length === 2 ? surfaceOfExtensionPackage(packageName) : null;
  return surface === null ? releaseSite(subject, written) : surfaceSite(subject, surface, written);
}

/**
 * Both root READMEs — not only the English one, the reason
 * `check-documentation-examples.mjs` gives for reading them all — the
 * getting-started walkthrough, and every package README that exists. A package
 * without a public README contributes no prose and is not invented here.
 */
async function proseVersionFiles(directory) {
  const found = [];
  for (const entry of await readdir(directory, { withFileTypes: true }).catch(() => [])) {
    if (entry.isFile() && /^README(\.[\w-]+)?\.md$/u.test(entry.name)) found.push(entry.name);
  }
  found.push("docs/getting-started.md");
  for (const entry of await readdir(join(directory, "packages"), { withFileTypes: true }).catch(() => [])) {
    if (entry.isDirectory() && entry.name !== "node_modules") found.push(`packages/${entry.name}/README.md`);
  }
  return found.sort(byCodeUnit);
}

/** Every version site in one document, in the order a reader meets them. */
function proseVersionSites(text) {
  const lines = text.split("\n");
  const found = [];
  for (const entry of PROSE_SITES) {
    for (const [index, line] of lines.entries()) {
      for (const match of line.matchAll(entry.pattern)) {
        found.push({ line: index + 1, kind: entry.kind, ...entry.read(match) });
      }
    }
  }
  return found.sort((left, right) => left.line - right.line);
}

/** Pass 5. Answers what it read, so the report can say it was not nothing. */
async function checkProseVersions(directory) {
  const problems = [];
  const files = await proseVersionFiles(directory);
  for (const required of REQUIRED_PROSE_FILES) {
    if (files.includes(required)) continue;
    problems.push(`${required} is not there to read, but it is one of the documents the release number and the five surface counters are written into; this pass cannot check a file that is missing`);
  }
  let sites = 0;
  for (const file of files) {
    let text;
    try {
      text = await readFile(join(directory, file), "utf8");
    } catch (error) {
      problems.push(`${file}: ${error instanceof Error ? error.message : String(error)}`);
      continue;
    }
    const quoted = proseVersionSites(text);
    if (quoted.length === 0) {
      problems.push(`${file} carries no version site at all — no 'velar <x.y.z>' or 'VelarScript <x.y.z>' line, no '<surface>@<N.M>' token, no 'surfaces' entry, no '@velarscript/…' pin.`
        + ` A gate that checks nothing is this gate's own worst case, so an empty document on this list is refused rather than counted as clean:`
        + ` either the file lost the numbers the release wrote into it, or it no longer belongs on the list 'proseVersionFiles' builds in scripts/check-surface-versions.mjs.`);
      continue;
    }
    sites += quoted.length;
    for (const mention of quoted) {
      if (mention.written === mention.current) continue;
      problems.push(`${file}:${mention.line}: ${mention.kind} says ${mention.written}, but ${mention.current} is current — ${mention.source}.`
        + ` The site reads '${mention.subject}'. Prose versions drift, which is why this one is read rather than trusted (D110).`);
    }
  }
  return { failures: problems, files: files.length, sites };
}

async function readLock() {
  let text;
  try {
    text = await readFile(lockPath, "utf8");
  } catch {
    failures.push(`${relativeToRoot(lockPath)} is missing; it is the record of what each surface hashed to when its version was last set, and it is checked in`);
    return null;
  }
  let value;
  try {
    value = JSON.parse(text);
  } catch (error) {
    failures.push(`${relativeToRoot(lockPath)}: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
  // The two pointers are checked rather than decorative: a lock file nobody can
  // trace back to its gate or its ruling is a wall of hexadecimal.
  if (value?.gate !== "scripts/check-surface-versions.mjs" || value?.decision !== "D110") {
    failures.push(`${relativeToRoot(lockPath)} must name its gate ("scripts/check-surface-versions.mjs") and its ruling ("D110"); those two fields are how a reader of a file full of digests finds out what wrote it`);
  }
  if (!value?.surfaces || typeof value.surfaces !== "object" || Array.isArray(value.surfaces)) {
    failures.push(`${relativeToRoot(lockPath)}: 'surfaces' must be an object mapping each surface to {"version", "digest"}`);
    return null;
  }
  for (const surface of Object.keys(value.surfaces)) {
    if (!SURFACE_NAMES.includes(surface)) {
      failures.push(`${relativeToRoot(lockPath)} records a surface named '${surface}', which D110 rule 1 does not name; the five surfaces are ${SURFACE_NAMES.join(", ")}`);
    }
  }
  return value;
}

function relativeToRoot(path) {
  return path.startsWith(`${root}/`) ? path.slice(root.length + 1) : path;
}

/**
 * D90 R3(a): code-unit order, so this gate's digests are the same on two
 * machines that differ only in `LC_ALL`. A digest that depends on the build
 * machine's collation is a digest that means nothing.
 */
function byCodeUnit(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}
