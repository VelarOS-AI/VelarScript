import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import test, { after } from "node:test";
import { VELAR_CORE_API_VERSION } from "../packages/compiler/src/core-vocabulary.ts";
import { resolveVelarProject } from "../packages/cli/src/config.ts";
import { CORE_PROJECT_MANIFEST_FIELDS } from "../packages/cli/src/project-format.ts";
import { surfaceOfExtensionPackage } from "../packages/cli/src/extension-metadata.ts";
import { formatSurfaceVersions, readSurfaceVersions } from "../packages/cli/src/surface-versions.ts";
import { createTemplateFiles } from "../packages/create/src/templates.ts";
import {
  VELAR_CREATE_VERSION,
  VELAR_PROJECT_FORMAT_VERSION,
  VELAR_PROJECT_TEMPLATES,
  VELAR_TEMPLATE_SURFACE_VERSIONS,
} from "../packages/create/src/types.ts";
import { VELAR_DESKTOP_API_VERSION } from "../packages/desktop/src/config.ts";
import { VELAR_NODE_API_VERSION } from "../packages/node/src/compiler.ts";
import { VELAR_SERVER_API_VERSION } from "../packages/server/src/compiler.ts";
import { VELAR_WEB_API_VERSION } from "../packages/web/src/compiler.ts";
import { SURFACE_NAMES, SURFACE_VERSIONS, surfaceDigest, surfaceInventory } from "../scripts/surface-inventory.mjs";
import { makeTemporaryDirectory, removeTemporaryDirectories } from "./temporary-directory.ts";

// ---------------------------------------------------------------------------
// D110 — one installation number, five surface versions.
//
// Two things have to be true for a surface version to be worth printing. It has
// to be *computed*, so that a surface cannot change while its number stands
// still — that is the digest gate, and the tests below turn it red on purpose,
// because a gate nobody has watched fail is a gate nobody knows works. And it
// has to be *one* number: the constant, the package manifest, the scaffolder's
// copy, the lock, and the CLI banner all saying the same thing, since D110's
// own background is two dozen hand-written versions that all went stale in one
// release.
// ---------------------------------------------------------------------------

const root = resolve(import.meta.dirname, "..");
const gate = join(root, "scripts", "check-surface-versions.mjs");

after(removeTemporaryDirectories);

function runGate(lockPath?: string) {
  const execution = spawnSync(process.execPath, lockPath ? [gate, lockPath] : [gate], {
    cwd: root,
    encoding: "utf8",
    timeout: 300_000,
  });
  return { status: execution.status, output: `${execution.stdout ?? ""}${execution.stderr ?? ""}` };
}

interface SurfaceLock {
  readonly gate: string;
  readonly decision: string;
  surfaces: Record<string, { version: string; digest: string }>;
}

async function readLock(): Promise<SurfaceLock> {
  return JSON.parse(await readFile(join(root, "surface-lock.json"), "utf8")) as SurfaceLock;
}

/** A private copy of the lock, so a mutation never touches the repository. */
async function copyOfLock(mutate: (lock: SurfaceLock) => void): Promise<string> {
  const lock = await readLock();
  mutate(lock);
  const directory = await makeTemporaryDirectory("velar-surface-lock-");
  const path = join(directory, "surface-lock.json");
  await writeFile(path, `${JSON.stringify(lock, null, 2)}\n`, "utf8");
  return path;
}

test("the surface gate passes on this repository and reports what it hashed", async () => {
  const { status, output } = runGate();
  assert.equal(status, 0, output);
  for (const surface of SURFACE_NAMES) {
    const line = output.split("\n").find((item) => item.trimStart().startsWith(`${surface} `));
    assert.ok(line, `${surface} is missing from the gate's report:\n${output}`);
    const names = Number(/(\d+) names/u.exec(line)?.[1]);
    // A digest over an empty set is perfectly reproducible and means nothing,
    // so "the gate was green" is only worth reading beside a count it looked at.
    assert.ok(names > 0, `the ${surface} surface hashed ${names} names — its tables read empty:\n${line}`);
    assert.ok(line.includes(`${surface}@${SURFACE_VERSIONS[surface]}`),
      `the report does not print ${surface}'s version:\n${line}`);
  }
});

test("the lock records the digest the inventory computes, surface by surface", async () => {
  // The other direction of the gate. The gate compares the two and reports; this
  // recomputes the digest here and pins the checked-in number to it, so a table
  // that changes without a lock update fails in the test suite as well as in the
  // gate — and the failure names which surface moved.
  const lock = await readLock();
  const { surfaces, failures } = surfaceInventory();
  assert.deepEqual(failures, [], "the surface inventory could not read a table");
  for (const surface of SURFACE_NAMES) {
    const names = surfaces.get(surface)!.names;
    const digest = surfaceDigest(names);
    assert.equal(lock.surfaces[surface]?.digest, digest,
      `surface-lock.json does not record the ${surface} surface as it stands (${names.size} names); bump ${surface} and update the lock in one commit`);
    assert.equal(lock.surfaces[surface]?.version, SURFACE_VERSIONS[surface]);
  }
  assert.deepEqual(Object.keys(lock.surfaces).sort(), [...SURFACE_NAMES].sort());
});

test("the surface digest changes when a public contract changes under the same name", () => {
  const left = new Map([["module-export:velar/example\0run", { shape: "number -> string" }]]);
  const right = new Map([["module-export:velar/example\0run", { shape: "string -> string" }]]);
  assert.notEqual(surfaceDigest(left), surfaceDigest(right));
});

test("the WorkerPool surface shape includes its pool-wide broadcast contract", () => {
  const { surfaces, failures } = surfaceInventory();
  assert.deepEqual(failures, []);
  const workerPool = surfaces.get("core")!.names.get("module-export:velar/worker\0WorkerPool");
  assert.ok(workerPool, "velar/worker.WorkerPool is absent from the Core surface inventory");
  assert.match(workerPool.shape, /broadcast/u);
});

test("the Core surface hashes collection callback arity and read-only presence", () => {
  const { surfaces, failures } = surfaceInventory();
  assert.deepEqual(failures, []);
  const core = surfaces.get("core")!.names;
  const map = core.get("collection-member:List.map");
  assert.ok(map, "List.map is absent from the Core surface inventory");
  assert.match(map.shape, /number/u);
  assert.equal(core.has("collection-member:readonly List.append"), false);
  assert.equal(core.has("collection-member:readonly List.map"), true);
});

test("a surface that changes without its version turns the gate red and says how to bump it", async () => {
  // A changed digest beside an unchanged version is exactly what a surface
  // edited without a bump produces, so this is that failure, staged from the
  // lock side because a test cannot edit the compiler's tables.
  const path = await copyOfLock((lock) => {
    lock.surfaces.web!.digest = "0".repeat(64);
  });
  const { status, output } = runGate(path);
  assert.equal(status, 1, `the gate stayed green over a surface that no longer hashes to its lock:\n${output}`);
  assert.match(output, /The web surface changed while web@[\d.]+ stood still\./u);
  // The failure has to be actionable: the file, the constant, the manifest, the
  // lock entry, and the changelog section, in the commit that changed the
  // surface. A refusal that only says "something moved" is a puzzle.
  assert.match(output, /packages\/web\/src\/compiler\.ts: VELAR_WEB_API_VERSION = "0\.12"/u);
  assert.match(output, /packages\/web\/package\.json: "velar\.extension\.apiVersion": "0\.12"/u);
  assert.match(output, /surface-lock\.json: "web": \{"version":"0\.12","digest":"[0-9a-f]{64}"\}/u);
  assert.match(output, /CHANGELOG\.md/u);
});

test("a version and a lock entry that moved alone are both refused", async () => {
  const stale = await copyOfLock((lock) => {
    lock.surfaces.core!.version = "0.99";
  });
  const staleResult = runGate(stale);
  assert.equal(staleResult.status, 1, staleResult.output);
  assert.match(staleResult.output, /The core surface is unchanged, but VELAR_CORE_API_VERSION says [\d.]+ while surface-lock\.json says 0\.99\./u);

  const missing = await copyOfLock((lock) => {
    delete (lock.surfaces as Record<string, unknown>).desktop;
  });
  const missingResult = runGate(missing);
  assert.equal(missingResult.status, 1, missingResult.output);
  assert.match(missingResult.output, /surface-lock\.json records nothing for the desktop surface/u);

  const unknown = await copyOfLock((lock) => {
    lock.surfaces.game = { version: "0.1", digest: "0".repeat(64) };
  });
  const unknownResult = runGate(unknown);
  assert.equal(unknownResult.status, 1, unknownResult.output);
  assert.match(unknownResult.output, /records a surface named 'game'/u);
});

test("one surface version, in every place that carries it", async () => {
  // The five constants are the originals. Everything else — the CLI banner, the
  // gate's own table, the scaffolder's dependency-free copy — is checked against
  // them here rather than trusted, because "these two numbers are the same
  // number" is precisely the claim that decays without a check.
  const owned: Readonly<Record<string, string>> = {
    core: VELAR_CORE_API_VERSION,
    web: VELAR_WEB_API_VERSION,
    node: VELAR_NODE_API_VERSION,
    server: VELAR_SERVER_API_VERSION,
    desktop: VELAR_DESKTOP_API_VERSION,
  };
  const reported = await readSurfaceVersions();
  assert.deepEqual(Object.keys(owned), [...SURFACE_NAMES]);
  // Declaration order is print order, so it is pinned rather than assumed.
  assert.deepEqual(Object.keys(reported), [...SURFACE_NAMES]);
  for (const [surface, version] of Object.entries(owned)) {
    assert.match(version, /^(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)$/u, `${surface} is not a 'major.minor' surface version`);
    assert.equal(reported[surface], version, `the CLI reports a different ${surface} surface version`);
    assert.equal(SURFACE_VERSIONS[surface], version, `the surface gate reads a different ${surface} surface version`);
    assert.equal(VELAR_TEMPLATE_SURFACE_VERSIONS[surface], version, `'velar create' scaffolds a different ${surface} surface version`);
  }
  // D110 rule 7: `@` reads well in output and in prose, and it is the marker
  // introducer in source. This spelling therefore has to stay out of `.vel`,
  // which is why it lives in a formatter here rather than anywhere near syntax.
  assert.equal(await formatSurfaceVersions(), SURFACE_NAMES.map((surface) => `${surface}@${owned[surface]}`).join("   "));
});

test("velar --version prints the release and the five surfaces", async () => {
  const cli = join(root, "packages", "cli", "src", "cli.ts");
  const printed = spawnSync(process.execPath, [cli, "--version"], { encoding: "utf8" });
  assert.equal(printed.status, 0, printed.stderr);
  const lines = printed.stdout.split("\n");
  assert.match(lines[0] ?? "", /^velar \d+\.\d+\.\d+$/u);
  assert.equal(lines[1], `  ${await formatSurfaceVersions()}`);
  assert.equal(lines[2], "");
});

test("[D110-5] a manifest declares every surface it activates, or none", async () => {
  const directory = await makeTemporaryDirectory("velar-surfaces-manifest-");
  await mkdir(join(directory, "src"), { recursive: true });
  await writeFile(join(directory, "src", "main.vel"), '@main: print("ok")\n', "utf8");
  const manifest = async (surfaces: unknown) => {
    const value: Record<string, unknown> = { formatVersion: VELAR_PROJECT_FORMAT_VERSION, entry: "src/main.vel", extensions: [] };
    if (surfaces !== undefined) value.surfaces = surfaces;
    await writeFile(join(directory, "velar.json"), JSON.stringify(value, null, 2), "utf8");
  };

  // Absent is valid: the key is additive, which is why D110 rule 5 declines to
  // raise formatVersion for it.
  await manifest(undefined);
  assert.equal((await resolveVelarProject(directory)).formatVersion, VELAR_PROJECT_FORMAT_VERSION);

  await manifest({ core: VELAR_CORE_API_VERSION });
  assert.equal((await resolveVelarProject(directory)).root, directory);

  // Present but partial is a typo, not a setting — and the refusal writes out
  // the complete block rather than only naming what is missing.
  await manifest({});
  await assert.rejects(resolveVelarProject(directory), (error: Error) => {
    assert.match(error.message, /'surfaces' does not name core/u);
    assert.match(error.message, /"surfaces": \{\n\s+"core": "[\d.]+"\n\s+\}/u);
    assert.match(error.message, /remove the key entirely to declare nothing/u);
    return true;
  });

  // A surface the project does not activate is equally wrong: a declaration
  // that names web without activating it claims a review nothing performs.
  await manifest({ core: VELAR_CORE_API_VERSION, web: VELAR_WEB_API_VERSION });
  await assert.rejects(resolveVelarProject(directory), /names web, which this project does not activate/u);

  await manifest({ core: "0.1.0" });
  await assert.rejects(resolveVelarProject(directory), /'surfaces\.core' must be a 'major\.minor' surface version/u);

  await manifest([VELAR_CORE_API_VERSION]);
  await assert.rejects(resolveVelarProject(directory), /'surfaces' must be an object mapping each surface/u);
});

test("[D110-5] a declared surface that no longer matches the installed one is refused by name", async () => {
  const directory = await makeTemporaryDirectory("velar-surfaces-drift-");
  await mkdir(join(directory, "src"), { recursive: true });
  await writeFile(join(directory, "src", "main.vel"), '@main: print("ok")\n', "utf8");
  await writeFile(join(directory, "velar.json"), JSON.stringify({
    formatVersion: VELAR_PROJECT_FORMAT_VERSION,
    entry: "src/main.vel",
    extensions: [],
    surfaces: { core: "0.0" },
  }, null, 2), "utf8");
  await assert.rejects(resolveVelarProject(directory), (error: Error) => {
    // The whole value of the key: the refusal names the surface, both numbers,
    // and where to read what changed between them.
    assert.match(error.message, /this project is written against core@0\.0, but core@[\d.]+ is installed/u);
    assert.match(error.message, /'Core' sections of CHANGELOG\.md/u);
    assert.match(error.message, /not a compatibility range to widen/u);
    return true;
  });
});

test("[D110-5] 'surfaces' is a core manifest field and every scaffolded project carries it", async () => {
  assert.ok((CORE_PROJECT_MANIFEST_FIELDS as readonly string[]).includes("surfaces"));
  const installed = await readSurfaceVersions();
  for (const template of VELAR_PROJECT_TEMPLATES) {
    const files = createTemplateFiles(template, join(root, "example-app"), VELAR_CREATE_VERSION, VELAR_PROJECT_FORMAT_VERSION);
    const manifest = JSON.parse(files.get("velar.json") ?? "{}") as {
      extensions?: string[];
      surfaces?: Record<string, string>;
    };
    // Derived from the template's own `extensions`, so the two cannot disagree —
    // which is the same completeness the compiler enforces when it loads the
    // scaffolded project.
    const expected = new Map<string, string>([["core", VELAR_CORE_API_VERSION]]);
    for (const name of manifest.extensions ?? []) {
      const surface = surfaceOfExtensionPackage(name);
      assert.ok(surface, `the ${template} template activates '${name}', which publishes no surface`);
      expected.set(surface, installed[surface]!);
    }
    assert.deepEqual(manifest.surfaces, Object.fromEntries(expected), `the ${template} template scaffolds the wrong surfaces`);
  }
});
