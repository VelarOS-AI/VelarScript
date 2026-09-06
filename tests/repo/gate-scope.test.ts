import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import {
  heavyNodeTests,
  OWNERSHIP_FILE,
  buildPlan,
  classifyPath,
  deriveOwnership,
  downstreamClosure,
  explainPlan,
  ownershipText,
  projectPackageOwners,
  readOwnership,
  workspacePackageNames,
} from "../../scripts/gate-scope.mjs";
import type { ChangeBase, GatePlan, OwnershipDocument } from "../../scripts/gate-scope.mjs";
import { repositoryRoot } from "../support/repository-root.ts";

/**
 * D116 — the gate that decides which gates run.
 *
 * A scoping gate fails in a direction nothing else notices: it goes green by
 * running less. Nobody reads a passing gate's file count, so the only place the
 * rule "a suite is skipped only when this change cannot alter its verdict" is
 * actually held is here. Each test below fixes one clause of D116 §三 against a
 * change set with a known answer — a package change, a documentation change, a
 * repository change, a fixture project's change — and the last two hold the two
 * generated artifacts the plan is computed from.
 */

const base: ChangeBase = { ref: "test", commit: "0".repeat(40), how: "a fixed base, so these plans do not depend on the checkout's history" };

async function plan(changes: readonly string[]): Promise<GatePlan> {
  return buildPlan({ changes, base });
}

/** The owners the ownership file gives one planned file, for asserting on membership. */
function owners(ownership: OwnershipDocument, file: string): readonly string[] {
  const found = ownership.tests[file];
  assert.ok(found !== undefined, `${file} has no entry in ${OWNERSHIP_FILE}`);
  return found;
}

test("[D116-3] a Web-only change runs the Web downstream closure and defers the browser suite", async () => {
  const ownership = await readOwnership();
  const web = await plan(["packages/web/src/lexer.ts"]);

  assert.deepEqual(web.owners, ["web"]);
  // web → desktop (web + node) → and the CLI and scaffolder, which consume every
  // package. Not compiler, core, node or server: nothing upstream of web moved.
  assert.deepEqual(web.closure, ["cli", "create", "desktop", "web"]);
  assert.equal(web.suites.check, true);
  assert.equal(web.suites.fingerprint, true);

  // The two heavy suites are never in a quick-tier plan, whatever changed.
  assert.equal(web.suites.browser, false);
  assert.equal(web.suites.packages, false);
  assert.match(web.deferred.browser, /release:check/u);
  assert.match(web.deferred.packages, /release:check/u);

  assert.ok(web.suites.node.length > 0, "a Web change runs no Node tests at all");
  assert.ok(web.skipped.files.length > 0, "a Web change skips nothing, so the plan is doing no work");
  for (const file of web.suites.node) {
    assert.ok(
      owners(ownership, file).some((owner) => owner === "repo" || web.closure.includes(owner)),
      `${file} runs for a Web change but exercises none of ${web.closure.join(", ")}`,
    );
  }
  for (const file of web.skipped.files) {
    const skipped = owners(ownership, file);
    assert.equal(skipped.includes("repo"), false, `${file} is skipped but is owned by the repository`);
    for (const owner of skipped) {
      assert.equal(web.closure.includes(owner), false, `${file} is skipped but exercises ${owner}, which a Web change reaches`);
    }
  }
  assert.match(explainPlan(web), /browser: deferred to release \(heavy tier\)/u);
});

test("[D116-3] a documentation-only change runs check, and only the tests that read a document", async () => {
  const ownership = await readOwnership();
  for (const path of ["docs/contributing/gates.md", "README.md", "docs/decisions/D116-SCOPED-GATES.md"]) {
    const documentation = await plan([path]);
    assert.deepEqual(documentation.owners, ["docs"], path);
    assert.deepEqual(documentation.closure, [], path);
    assert.equal(documentation.suites.check, true, path);
    // Re-emitting every project to hash output a documentation change cannot
    // reach is the same waste the Node suite is being spared.
    assert.equal(documentation.suites.fingerprint, false, path);
    assert.equal(documentation.suites.projectUnit, false, path);

    // D116 §三 gives documentation `check` alone. §二.1 outranks that shorthand
    // where the two disagree: `server-port-zero.test.ts` reads
    // `docs/ai-skill-server.md` and asserts the bound the runtime enforces is
    // the bound the skill states, so a documentation change can move its
    // verdict and it owns `docs`. Every other file stays out.
    for (const file of documentation.suites.node) {
      assert.ok(owners(ownership, file).includes("docs"), `${file} runs for a documentation change without reading a document`);
    }
    for (const file of documentation.skipped.files) {
      assert.equal(owners(ownership, file).includes("docs"), false, `${file} reads a document and was skipped`);
    }
    assert.ok(documentation.suites.node.includes("tests/server/server-port-zero.test.ts"), path);
    assert.ok(documentation.suites.node.length < 5, `${documentation.suites.node.length} files claim to read a repository document`);
  }
});

test("[D116-3] a repository change runs the whole quick tier", async () => {
  for (const path of ["scripts/build-packages.mjs", "package.json", "tsconfig.json", ".github/workflows/ci.yml", "surface-lock.json"]) {
    const repository = await plan([path]);
    assert.deepEqual(repository.owners, ["repo"], path);
    assert.deepEqual(repository.closure, await workspacePackageNames(), path);
    assert.deepEqual(repository.skipped.files, [], `${path} skipped Node files`);
  }
  // Identical to what `--all` runs, which is the claim "repository change = everything".
  const everything = await buildPlan({ all: true });
  assert.deepEqual((await plan(["scripts/build-packages.mjs"])).suites.node, everything.suites.node);
});

test("[D116-3] a fixture or example project's change maps to the surfaces its own manifest declares", async () => {
  const projects = Object.fromEntries(await projectPackageOwners());
  const ownership = await readOwnership();

  assert.deepEqual(projects["tests/fixtures/web-capabilities"], ["core", "web"]);
  assert.deepEqual(projects["examples/tour/core"], ["core"]);
  assert.deepEqual(projects["examples/tour/desktop"], ["core", "desktop"]);
  assert.deepEqual(projects["examples/tour/node"], ["core", "server"]);

  const web = classifyPath("tests/fixtures/web-capabilities/src/main.vel", ownership, projects);
  assert.deepEqual(web.owners, ["core", "web"]);
  assert.match(web.rule, /velar\.json/u);

  // A Core-only project is `core`, and nothing else — that is the whole point
  // of reading the manifest rather than the directory's name. `compiler` is not
  // among them: a project is downstream of the compiler, so changing one cannot
  // move a compiler verdict, and reading it as a compiler change would close
  // the graph over every package.
  const core = classifyPath("examples/tour/core/main.vel", ownership, projects);
  assert.deepEqual(core.owners, ["core"]);
  const corePlan = await plan(["examples/tour/core/main.vel"]);
  assert.equal(corePlan.closure.includes("compiler"), false);
  assert.ok(corePlan.skipped.files.length > 0, "a Core-only project's change ran every quick-tier file");

  // The longest project wins: `examples/tour/web` is inside `examples/tour`,
  // which is not itself a project, and a shorter prefix must not claim it.
  const tour = classifyPath("examples/tour/web/main.vel", ownership, projects);
  assert.deepEqual(tour.owners, ["core", "web"]);

  // A test that names a project does exercise the compiler, because it compiles
  // it: the same manifest read from the other side, and the only place
  // `compiler` is added to a project's packages.
  assert.deepEqual(owners(ownership, "tests/web/web-error-paths.test.ts"), ["cli", "compiler", "core", "web"]);
});

test("[D116-3] the package graph closes downstream and refuses a package it does not know", async () => {
  const packages = await workspacePackageNames();
  assert.deepEqual(downstreamClosure(["compiler"], packages), packages);
  assert.deepEqual(downstreamClosure(["core"], packages), ["cli", "core", "create", "desktop", "node", "server", "web"]);
  assert.deepEqual(downstreamClosure(["node"], packages), ["cli", "create", "desktop", "node", "server"]);
  assert.deepEqual(downstreamClosure(["desktop"], packages), ["cli", "create", "desktop"]);
  assert.deepEqual(downstreamClosure(["cli"], packages), ["cli"]);
  assert.deepEqual(downstreamClosure(["repo"], packages), packages);
  assert.deepEqual(downstreamClosure([], packages), []);
  // A package under `packages/` that nobody added to the graph is an absent
  // edge, and an absent edge is a suite that silently stops running.
  assert.throws(() => downstreamClosure(["core"], [...packages, "quantum"]), /quantum is not in the D116 package graph/u);
});

test("[D116-4] the committed ownership file is what the test files derive", async () => {
  const derived = await deriveOwnership();
  const committed = await readFile(join(repositoryRoot, OWNERSHIP_FILE), "utf8");
  assert.equal(
    committed,
    ownershipText(derived),
    `${OWNERSHIP_FILE} is stale; regenerate it with \`node scripts/gate-scope.mjs --write-ownership\``,
  );
  // The unclassified list is the visible half of the derivation's gap. D116 §四
  // aims it at zero; a list that grows is analysis that stopped working.
  assert.ok(derived.unclassified.length < 10, `${derived.unclassified.length} test files carry no ownership evidence: ${derived.unclassified.join(", ")}`);
  for (const [file, entry] of Object.entries(derived.tests)) {
    assert.ok(entry.length > 0, `${file} has an empty owner set`);
  }
});

test("[D116-3] the heavy tier is the .slow suffix, and no plan runs one", async () => {
  // D115 P5 retired `tests/heavy.json`: the tier is written in the file names
  // now, so the list and the files cannot disagree. What this pins is that the
  // two readers of the suffix — the suite runner and the plan — read it the
  // same way, and that nothing is deferred by anything else.
  const listed = await heavyNodeTests(repositoryRoot);
  assert.ok(listed.length > 0, "no test carries the .slow suffix, so the heavy tier is empty");

  const everything = await buildPlan({ all: true });
  for (const file of listed) {
    assert.ok(file.endsWith(".slow.test.ts"), `${file} is deferred without carrying the suffix`);
    assert.equal(everything.suites.node.includes(file), false, `${file} is heavy and still ran in the quick tier`);
  }
  assert.deepEqual([...everything.deferred.node].sort(), [...listed].sort());
});

test("[D116-2] the gate runs the Node suite the way the suite runner runs it", async () => {
  const runner = await readFile(join(repositoryRoot, "scripts", "run-node-tests.mjs"), "utf8");
  const gate = await readFile(join(repositoryRoot, "scripts", "gate.mjs"), "utf8");
  // `run-node-tests.mjs` spawns from its own entry clause rather than exporting
  // the spawn, so `gate.mjs` repeats the flags. Repeated flags drift; these two
  // lists are pinned against each other so the drift is a red test.
  const flags = /"--test",\s*\n?\s*"(--test-concurrency=\d+)",\s*\n?\s*"(--test-timeout=\d+)",/u.exec(runner);
  assert.ok(flags !== null, "scripts/run-node-tests.mjs no longer spawns node --test with the flags this gate copies");
  assert.match(gate, new RegExp(`"--test", "${flags[1]}", "${flags[2]}"`, "u"));
});
