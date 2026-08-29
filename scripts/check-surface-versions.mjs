import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { VELAR_TEMPLATE_SURFACE_VERSIONS } from "../packages/create/src/types.ts";
import {
  SURFACE_NAMES,
  SURFACE_VERSIONS,
  SURFACE_VERSION_SITES,
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
 *  2. Each surface's names are sorted and hashed.
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
 * Usage: `node scripts/check-surface-versions.mjs [lock-file]`. The optional
 * lock path exists for the same reason the coverage gate takes an optional tour
 * root: a gate that checks nothing fails silently, so being able to point this
 * one at a mutated lock and watch it go red is part of owning it.
 */

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const lockPath = process.argv[2] ? resolve(process.argv[2]) : join(root, "surface-lock.json");

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
  const digest = createHash("sha256").update(names.join("\n"), "utf8").digest("hex");
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

const report = [
  `Hashed ${SURFACE_NAMES.length} language surfaces (D110):`,
  ...summary,
  `  lock: ${relativeToRoot(lockPath)}`,
].join("\n");

if (failures.length > 0) {
  console.error(`${report}\n\nThe surface versions do not describe the surfaces (D110 rule 4):\n\n${failures.join("\n\n")}\n`);
  process.exitCode = 1;
} else {
  console.log(report);
}

function site(surface) {
  return SURFACE_VERSION_SITES[surface];
}

/** `0.11` → `0.12`. One rule, one counter (D110 rule 4). */
function nextVersion(version) {
  const parts = version.split(".");
  return [...parts.slice(0, -1), String(Number(parts.at(-1)) + 1)].join(".");
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
