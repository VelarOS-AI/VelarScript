import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import {
  heavyNodeTests,
  OWNERSHIP_EXCEPTIONS_FILE,
  OWNERSHIP_FILE,
  auditConsistency,
  buildPlan,
  classifyPath,
  deriveOwnership,
  downstreamClosure,
  explainPlan,
  fileOwners,
  ownershipText,
  projectPackageOwners,
  readOwnership,
  readOwnershipExceptions,
  standardModuleOwners,
  stripComments,
  workspacePackageNames,
} from "../../scripts/gate-scope.mjs";
import type { ChangeBase, FileOwnerRecord, GatePlan, OwnershipDocument } from "../../scripts/gate-scope.mjs";
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
    // verdict and it owns `docs`. The CLI skill generator likewise reads the
    // canonical documents to verify the installed reference payload. Keep the
    // derived document-owner roster explicit instead of imposing a fixed cap
    // that fails whenever another document-dependent check is added.
    for (const file of documentation.suites.node) {
      assert.ok(owners(ownership, file).includes("docs"), `${file} runs for a documentation change without reading a document`);
    }
    for (const file of documentation.skipped.files) {
      assert.equal(owners(ownership, file).includes("docs"), false, `${file} reads a document and was skipped`);
    }
    assert.deepEqual(documentation.suites.node, [
      "tests/repo/check-module-map.test.ts",
      "tests/repo/cli-skill-generation.test.ts",
      "tests/repo/documentation-reference-coverage.test.ts",
      "tests/repo/gate-scope.test.ts",
      "tests/repo/surface-versions.test.ts",
      "tests/server/server-port-zero.test.ts",
    ], path);
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

test("[D116-4] every consistency finding is answered, and no answer outlives its finding", async () => {
  // The report is only worth reading while it is short and every line of it has
  // been judged. This holds both halves: a finding nobody answered is work that
  // was skipped, and an answer whose finding is gone is a claim about a file
  // that has changed underneath it. `file-budget-allowlist.json` keeps the same
  // two-sided rule for the same reason.
  const derived = await deriveOwnership();
  const exceptions = await readOwnershipExceptions();
  const audit = auditConsistency(derived.consistency, exceptions);
  assert.deepEqual(audit.unexplained, [], `these tests reach outside their directory with no entry in ${OWNERSHIP_EXCEPTIONS_FILE}`);
  assert.deepEqual(audit.stale, [], `these entries in ${OWNERSHIP_EXCEPTIONS_FILE} no longer answer a finding`);
  assert.deepEqual(audit.unreasoned, [], `these entries in ${OWNERSHIP_EXCEPTIONS_FILE} carry no reason`);

  // An exception is a judgment about the file it names, so it has to name one.
  for (const name of Object.keys(exceptions)) {
    assert.ok(derived.tests[name] !== undefined, `${OWNERSHIP_EXCEPTIONS_FILE} excuses ${name}, which is not a test file`);
  }
});

test("[D114-GA-I2] the publisher narrowing never drops a leaf publisher", async () => {
  // A module's publishers are narrowed by the targets a file names directly,
  // which is right for a sibling — a file that loads `@velarscript/web` is
  // compiling against Web's `velar/http` and never Node's — and wrong for a
  // leaf. Nothing is downstream of Desktop or Server, so a narrowing that drops
  // one leaves no owner that a change to it reaches, and the test stops running
  // for exactly the package whose copy of that module changed.
  const packages = await workspacePackageNames();
  const tables = { packages, modules: await standardModuleOwners(), projects: await projectPackageOwners() };
  const owned = (text: string): { readonly derived: readonly string[]; readonly viaRoster: Record<string, string[]> } => {
    const record: FileOwnerRecord = {};
    return { derived: fileOwners("tests/probe/probe.test.ts", text, tables, record), viaRoster: record.viaRoster ?? {} };
  };

  // A module only Server publishes reaches Server whatever else the file names.
  // Narrowing cannot reach it — the intersection with the direct set is empty —
  // and this is the floor the rest of the case stands on.
  const serverOnly = owned('import { velarCompilerExtension } from "@velarscript/web";\nconst probe = "velar/server";\n');
  assert.deepEqual(serverOnly.derived, ["server", "web"]);
  assert.deepEqual(serverOnly.viaRoster, {});

  // `velar/realtime` is Server's and Web's. The intersection is Web, so before
  // D114 GA-I2 the answer was Web alone and a Server change ran nothing.
  const shared = owned('import { velarCompilerExtension } from "@velarscript/web";\nconst probe = "velar/realtime";\n');
  assert.deepEqual(shared.derived, ["server", "web"]);
  assert.deepEqual(shared.viaRoster, { server: ["velar/realtime"] });

  // `velar/http` is Web's, Node's and Desktop's. Node is a sibling and is still
  // narrowed away; Desktop is a leaf and is kept.
  const http = owned('import { velarCompilerExtension } from "@velarscript/web";\nconst probe = "velar/http";\n');
  assert.deepEqual(http.derived, ["desktop", "web"]);
  assert.deepEqual(http.viaRoster, { desktop: ["velar/http"] });

  // An owner the file shows for itself is not a `viaRoster` owner, whatever the
  // roster also says: the record is about where the answer came from.
  const named = owned('import { desktop } from "@velarscript/desktop";\nconst probe = "velar/http";\n');
  assert.deepEqual(named.derived, ["desktop"]);
  assert.deepEqual(named.viaRoster, {});

  // And the whole point of it, in the plan: `velar-unknown.test.ts` sweeps every
  // target's declarations for `any`, and Desktop was the one target it had
  // stopped running for.
  const census = "tests/web/velar-unknown.test.ts";
  const ownership = await readOwnership();
  assert.ok(owners(ownership, census).includes("desktop"), `${census} lost Desktop to the publisher narrowing again`);
  assert.ok((await plan(["packages/desktop/src/compiler.ts"])).suites.node.includes(census));
});

test("[D114-GA-I3] an owner a helper carries is recorded against the helper, and is not a finding on its own", async () => {
  // 89 of the 109 findings T3 answered held `cli`, and every one of them held
  // it because running a VelarScript program at all means spawning the CLI.
  // `cli` sits below every package, so the extra owner changes no scoping
  // decision — but nothing in the generated file said where it came from, so a
  // test that runs a program and a test whose subject is the CLI read the same.
  const derived = await deriveOwnership();
  const carried = derived.viaHelper["tests/core/timeout-error.test.ts"];
  assert.ok(carried !== undefined, "tests/core/timeout-error.test.ts no longer records where its owners come from");
  assert.deepEqual(carried["cli"], ["tests/support/velar-project.ts"]);

  // Not a finding: `consistency` leaves the two tooling packages out, for the
  // reason it always did — they consume every package, so they are never
  // evidence a file is filed in the wrong directory.
  for (const [name, finding] of Object.entries(derived.consistency)) {
    for (const owner of finding.exercises) {
      assert.equal(owner === "cli" || owner === "create", false, `${name} is reported for exercising ${owner}, which every test that runs a command does`);
    }
  }

  // The other way: a file that names the CLI itself holds `cli` as its own, and
  // the record says nothing about it.
  const packages = await workspacePackageNames();
  const tables = { packages, modules: await standardModuleOwners(), projects: await projectPackageOwners() };
  assert.deepEqual(fileOwners("tests/probe/probe.test.ts", 'import { main } from "../../packages/cli/src/cli.ts";\n', tables), ["cli"]);
  const own = Object.entries(derived.viaHelper).filter(([, owners_]) => owners_["cli"] !== undefined);
  assert.ok(own.length > 0 && own.length < Object.keys(derived.tests).length, "either nothing or everything holds cli through a helper, so the record distinguishes nothing");
  assert.equal(derived.viaHelper["tests/cli/language-server.test.ts"]?.["cli"], undefined, "a CLI test's own cli is being attributed to a helper");
});

test("[D114-GA-U3] the Node platform quick tier runs for a Node change, and only the remainder is deferred", async () => {
  // `node-platform.slow.test.ts` was the only end-to-end suite `packages/node`
  // had, and the suffix kept all 3,617 lines of it out of every quick gate —
  // including a gate for a change to `packages/node` itself. The split is only
  // worth anything while the quick half is owned by `node` and actually planned.
  const ownership = await readOwnership();
  const nodeChange = await plan(["packages/node/src/compiler.ts"]);
  for (const file of ["tests/node/node-platform.test.ts", "tests/node/node-platform-serve.test.ts"]) {
    assert.ok(owners(ownership, file).includes("node"), `${file} is not owned by node, so a Node change would not run it`);
    assert.ok(nodeChange.suites.node.includes(file), `${file} is not in the plan for a Node change`);
    assert.equal(file.endsWith(".slow.test.ts"), false);
  }
  // D115 §三 divided that deferred remainder again, one `velar/*` module per
  // file. The rule is unchanged and holds for every one of them: deferred, and
  // therefore never also planned.
  const heavy = nodeChange.deferred.node.filter((file) => file.startsWith("tests/node/node-platform-") && file.endsWith(".slow.test.ts"));
  assert.ok(heavy.length > 0, "no heavy Node platform file is deferred, so the suffix defers nothing");
  for (const file of heavy) {
    assert.ok(owners(ownership, file).includes("node"), `${file} is not owned by node`);
    assert.equal(nodeChange.suites.node.includes(file), false, `${file} is deferred and planned at once`);
  }
});

test("[D116-4] the derivation reads what a test does, not what it says", async () => {
  // The five path rules used to match anywhere in the file, so a header comment
  // naming another target's source filed the test under a package it never
  // loads. Comments are removed first now, and the removal has to leave every
  // spelling a real dependency uses — including the ones inside a template
  // literal or a regular expression, where a `//` is content rather than a
  // comment.
  const stripped = stripComments([
    'import { one } from "../../packages/web/src/compiler.ts";',
    "/**",
    " * `packages/server/src/compiler.ts` spells it the other way.",
    " */",
    "// see packages/desktop/src/compiler.ts for the same rule",
    'const url = "https://example.test/velar";',
    "const dynamic = await import(`../../packages/node/src/compiler.ts?fresh=${count}`);",
    "const pattern = /packages\\/core\\/src\\/[a-z]+/u;",
  ].join("\n"));
  assert.match(stripped, /"\.\.\/\.\.\/packages\/web\/src\/compiler\.ts"/u);
  assert.match(stripped, /packages\/node\/src\/compiler\.ts\?fresh=/u);
  assert.match(stripped, /packages\\\/core\\\/src/u);
  assert.match(stripped, /https:\/\/example\.test\/velar/u);
  assert.doesNotMatch(stripped, /packages\/desktop/u);
  assert.doesNotMatch(stripped, /packages\/server/u);
  // A block comment keeps its line breaks, so a reported position is still the file's.
  assert.equal(stripComments("const a = 1; /* two\nlines */ const b = 2;").split("\n").length, 2);
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
