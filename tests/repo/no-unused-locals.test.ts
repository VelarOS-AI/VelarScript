import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { appendFile, cp, mkdtemp, readFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { workspacePackageNames } from "../../scripts/gate-scope.mjs";
import { repositoryRoot } from "../support/repository-root.ts";

/**
 * D114 GA-U5 — `noUnusedLocals` is on for every package, and it is the build
 * that holds it.
 *
 * The claim was in the CHANGELOG and in eight `tsconfig.build.json` files and
 * nowhere else: `grep -rl noUnusedLocals tests scripts` returned nothing, so a
 * package that quietly dropped the line would have shipped its dead locals and
 * no gate would have said a word. It is not the root `tsconfig.json` that
 * carries the flag — `npm run check`'s `tsc` leaves it off — it is each
 * package's own build config, which `npm run build:packages` runs as
 * `tsc -p tsconfig.build.json` per package.
 *
 * So there are two halves here, and neither is sufficient alone. The first
 * reads the flag out of every package on disk, so a ninth package cannot arrive
 * without it. The second proves the flag is *enforced* rather than merely
 * written down: it copies one package — its manifest, its build config and its
 * real sources — beside a copy of the root config it extends, builds it once to
 * show the copy is clean, plants a dead local in one of the copied sources, and
 * builds it again. A gate that checks nothing fails silently, which is the
 * reason `check-file-budget.mjs` takes a `--root` and `check-surface-versions.mjs`
 * takes a lock path; a compiler flag cannot take either, so the equivalent is
 * to point the real build at a tree that must make it red.
 */

/** The package the red build is planted in: the smallest one, and the only one whose sources import no other package. */
const PROBE_PACKAGE = "create";

/** The compiler each package's `build` script runs, from this checkout rather than through `node_modules/.bin`, whose shims are not this worktree's. */
const compiler = join(repositoryRoot, "node_modules", "typescript", "bin", "tsc");

function build(packageRoot: string): { readonly status: number | null; readonly output: string } {
  const result = spawnSync(process.execPath, [compiler, "-p", "tsconfig.build.json"], {
    cwd: packageRoot,
    encoding: "utf8",
    timeout: 120_000,
  });
  return { status: result.status, output: `${result.stdout ?? ""}${result.stderr ?? ""}` };
}

test("[D115] every package's build configuration turns noUnusedLocals on", async () => {
  const packages = await workspacePackageNames(repositoryRoot);
  assert.ok(packages.length >= 8, `only ${packages.length} packages were discovered under packages/`);
  for (const name of packages) {
    const path = join(repositoryRoot, "packages", name, "tsconfig.build.json");
    const configuration = JSON.parse(await readFile(path, "utf8")) as { compilerOptions?: { noUnusedLocals?: unknown } };
    assert.equal(
      configuration.compilerOptions?.noUnusedLocals,
      true,
      `packages/${name}/tsconfig.build.json does not set noUnusedLocals, so that package's dead locals ship`,
    );
  }
  // The root configuration deliberately leaves it off — `tsc -p tsconfig.json`
  // also reads `tests/`, where a half-written probe is not a defect. Pinning
  // that keeps the two configurations from being read as one.
  const workspace = JSON.parse(await readFile(join(repositoryRoot, "tsconfig.json"), "utf8")) as { compilerOptions?: { noUnusedLocals?: unknown } };
  assert.equal(workspace.compilerOptions?.noUnusedLocals, undefined, "the root tsconfig.json now sets noUnusedLocals; this test's account of which configuration enforces it is stale");
});

test("[D115] a dead local in a package source turns that package's build red and names it", async () => {
  const root = await mkdtemp(join(tmpdir(), "velar-no-unused-locals-"));
  try {
    const packageRoot = join(root, "packages", PROBE_PACKAGE);
    // The build config `extends` `../../tsconfig.json`, so the copy needs the
    // same two levels; `node_modules` is linked rather than copied because
    // `types: ["node"]` has to resolve to the same `@types/node` the real build
    // resolves.
    await cp(join(repositoryRoot, "tsconfig.json"), join(root, "tsconfig.json"));
    await symlink(join(repositoryRoot, "node_modules"), join(root, "node_modules"), "dir");
    for (const entry of ["package.json", "tsconfig.build.json", "src"]) {
      await cp(join(repositoryRoot, "packages", PROBE_PACKAGE, entry), join(packageRoot, entry), { recursive: true });
    }

    // Green first. A red build proves nothing about the flag if the copy could
    // not have been green in the first place.
    const clean = build(packageRoot);
    assert.equal(clean.status, 0, `the untouched copy of packages/${PROBE_PACKAGE} did not build:\n${clean.output}`);

    const planted = join(packageRoot, "src", "types.ts");
    await appendFile(planted, "\nconst deadLocalProbe = 1;\n", "utf8");
    const red = build(packageRoot);
    assert.notEqual(red.status, 0, `a dead local in packages/${PROBE_PACKAGE}/src/types.ts built green, so noUnusedLocals is not enforced:\n${red.output}`);
    assert.match(red.output, /TS6133/u, "the build failed for some reason other than the unused local");
    assert.match(red.output, /deadLocalProbe/u, "the failure does not name the local it is about");
    assert.match(red.output, /src[\\/]types\.ts/u, "the failure does not name the file it is in");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
