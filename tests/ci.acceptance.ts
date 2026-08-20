import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { relative, resolve } from "node:path";
import test from "node:test";
import { velarProjects } from "../scripts/velar-projects.mjs";
import { repositoryRoot } from "./repository-root.ts";

/**
 * Expands the `npm run` links inside a script so a gate is checked by what it
 * actually runs. Public gates delegate their body through `scripts/gate-lock.mjs`,
 * and reading only the outer command would silently stop covering the chain.
 */
function resolveScript(scripts: Record<string, string>, name: string, seen: Set<string> = new Set()): string {
  if (seen.has(name)) return "";
  seen.add(name);
  const body = scripts[name] ?? "";
  return [body, ...invokedScripts(body).map((target) => resolveScript(scripts, target, seen))].join(" ");
}

/** npm's own script aliases: `npm test` runs the `test` script, `npm ci` does not. */
const NPM_SCRIPT_ALIASES = new Set(["test", "start", "stop", "restart"]);

/**
 * The package scripts one shell command runs — `npm run x`, `npm run --silent x`,
 * `npm run-script x`, and npm's builtin aliases.
 *
 * Words are split on whitespace, which covers every command form this
 * repository writes, and it fails in the safe direction: an invocation this
 * missed would make a gate look unreached, and an unreached gate is a red test,
 * never a quiet pass.
 */
function invokedScripts(command: string): string[] {
  const words = command.split(/\s+/u).filter((word) => word !== "");
  const found: string[] = [];
  for (const [index, word] of words.entries()) {
    if (word !== "npm") continue;
    let cursor = index + 1;
    while (words[cursor]?.startsWith("-") === true) cursor += 1;
    const verb = words[cursor];
    if (verb === undefined) continue;
    if (verb !== "run" && verb !== "run-script") {
      if (NPM_SCRIPT_ALIASES.has(verb)) found.push(verb);
      continue;
    }
    cursor += 1;
    while (words[cursor]?.startsWith("-") === true) cursor += 1;
    const target = words[cursor];
    if (target !== undefined) found.push(target);
  }
  return found;
}

/** Every package script these commands reach, directly or through another script. */
function reachedScripts(scripts: Record<string, string>, commands: readonly string[]): Set<string> {
  const reached = new Set<string>();
  const pending = commands.flatMap((command) => invokedScripts(command));
  while (pending.length > 0) {
    const name = pending.pop()!;
    const body = scripts[name];
    if (body === undefined || reached.has(name)) continue;
    reached.add(name);
    pending.push(...invokedScripts(body));
  }
  return reached;
}

/**
 * Every `run:` step of a GitHub workflow, in file order.
 *
 * Deliberately not a YAML parser. It reads the block-mapping subset these
 * workflows are written in and refuses everything else out loud, because a step
 * this could not see would look exactly like a step CI does not have — which is
 * the failure being repaired here, not one to rebuild. Block scalars are
 * followed so a `run: |` body is never mistaken for more keys; anchors,
 * aliases, merge keys, tags, flow collections, tab indentation and multiple
 * documents throw instead of being misread.
 */
function workflowRunCommands(workflow: string): string[] {
  const refused = new Map([
    ["<<:", "a merge key"],
    [": &", "an anchor"],
    [": *", "an alias"],
    ["- &", "an anchor"],
    ["- *", "an alias"],
    ["run: [", "a flow sequence"],
    ["run: {", "a flow mapping"],
    ["run: !", "a tag"],
  ]);
  const commands: string[] = [];
  let block: { indent: number; folded: boolean; lines: string[] } | null = null;
  const closeBlock = () => {
    if (block === null) return;
    commands.push(block.lines.join(block.folded ? " " : "\n"));
    block = null;
  };
  for (const line of workflow.split(/\r?\n/u)) {
    const content = line.trim();
    if (block !== null) {
      const indent = line.length - line.trimStart().length;
      if (content === "" || indent > block.indent) {
        block.lines.push(content);
        continue;
      }
      closeBlock();
    }
    if (line.includes("\t")) throw new Error(`this workflow reader does not model tab indentation: ${content}`);
    if (content === "---" || content === "..." || content.startsWith("%")) {
      throw new Error(`this workflow reader models one document per file: ${content}`);
    }
    for (const [marker, what] of refused) {
      if (line.includes(marker)) throw new Error(`this workflow reader does not model ${what}: ${content}`);
    }
    if (content === "" || content.startsWith("#")) continue;
    const keyed = content.startsWith("- ") ? content.slice(2).trim() : content;
    if (!keyed.startsWith("run:")) continue;
    const value = keyed.slice("run:".length).trim();
    if (value.startsWith("|") || value.startsWith(">")) {
      block = { indent: line.length - line.trimStart().length, folded: value.startsWith(">"), lines: [] };
      continue;
    }
    if (value.startsWith("\"") || value.startsWith("'")) {
      const quote = value[0]!;
      const end = value.indexOf(quote, 1);
      if (end < 0) throw new Error(`this workflow reader cannot read an unterminated quoted command: ${content}`);
      commands.push(value.slice(1, end));
      continue;
    }
    const comment = value.indexOf(" #");
    commands.push((comment < 0 ? value : value.slice(0, comment)).trim());
  }
  closeBlock();
  return commands;
}

test("default CI stays lightweight while rehearsal and npm publication remain explicit", async () => {
  const workspace = JSON.parse(await readFile("package.json", "utf8")) as { scripts: Record<string, string> };
  assert.match(resolveScript(workspace.scripts, "test"), /tests\/release\.acceptance\.ts/u);
  assert.equal(workspace.scripts["release:rehearse"], "node scripts/release-toolchain.mjs rehearse");
  assert.equal(workspace.scripts["release:publish"], "node scripts/publish-toolchain.mjs");
  assert.equal(workspace.scripts["preview:prepare"], "node scripts/prepare-external-preview.mjs");

  // Every gate, derived: a `gate:x` script is the body a public gate `x` runs
  // under the checkout lock. The list this replaces named six by hand.
  const gates = Object.keys(workspace.scripts)
    .filter((name) => name.startsWith("gate:"))
    .map((name) => name.slice("gate:".length))
    .sort();
  assert.ok(gates.length >= 5, `package.json declares only ${gates.length} gates`);
  // A gate that stops taking the checkout lock lets a second run delete a
  // package dist mid-test and fail the first one for no reason.
  for (const gate of gates) {
    assert.match(workspace.scripts[gate] ?? "", /^node scripts\/gate-lock\.mjs /u, `${gate} must run under the gate lock`);
  }

  // `npm run velar -- build app.vel` forwards the developer's own arguments,
  // and CI has none to give it; that trailing `--` is what makes it an entry
  // point rather than a gate. Pinned instead of merely filtered, so the day a
  // real gate starts forwarding arguments — and would therefore drop out of
  // the set CI has to run — this fails rather than quietly shrinking that set.
  const forwarding = gates.filter((gate) => (workspace.scripts[gate] ?? "").trimEnd().endsWith(" --"));
  assert.deepEqual(forwarding, ["velar"], "the gates that forward developer arguments changed");
  const ci = await readFile(".github/workflows/ci.yml", "utf8");
  assert.match(ci, /runs-on: ubuntu-latest/u);
  assert.match(ci, /node-version: "24\.x"/u);

  // Full tests, packed consumers, and the browser matrix run locally before a
  // release. A default push only repeats the cheap clean-install source check;
  // publication below independently rebuilds and verifies the strict tagged
  // candidate. Pin both sides so routine pushes cannot silently grow back into
  // the former three-OS plus six-browser release suite.
  const reached = reachedScripts(workspace.scripts, workflowRunCommands(ci));
  assert.ok(reached.has("check"), ".github/workflows/ci.yml must reach the source-quality gate");
  for (const heavy of ["test", "test:packages", "test:browser", "release:rehearse", "release:publish"]) {
    assert.equal(reached.has(heavy), false, `.github/workflows/ci.yml must not run ${heavy} on every push`);
  }
  assert.doesNotMatch(ci, /macos-latest|windows-latest|playwright install|npm test|test:packages|test:browser/u);

  const release = await readFile(".github/workflows/release-rehearsal.yml", "utf8");
  assert.match(release, /id-token: write/u);
  assert.match(release, /attestations: write/u);
  assert.match(release, /artifact-metadata: write/u);
  assert.match(release, /actions\/attest@v4/u);
  assert.match(release, /release:rehearse/u);
  assert.doesNotMatch(release, /playwright install|npm test/u);
  assert.doesNotMatch(release, /npm publish/u);

  const publication = await readFile(".github/workflows/publish-npm.yml", "utf8");
  const publicationHelper = await readFile("scripts/publish-toolchain.mjs", "utf8");
  assert.match(publication, /workflow_dispatch:/u);
  assert.match(publication, /inputs\.confirm == 'publish'/u);
  assert.match(publication, /id-token: write/u);
  assert.match(publication, /release-toolchain\.mjs candidate/u);
  assert.match(publication, /npm run release:publish/u);
  assert.doesNotMatch(publication, /playwright install|npm test|test:browser|test:packages/u);
  assert.doesNotMatch(publication, /\n\s+push:/u);
  assert.match(publicationHelper, /GITHUB_ACTIONS/u);
  assert.match(publicationHelper, /ACTIONS_ID_TOKEN_REQUEST_URL/u);
  assert.match(publicationHelper, /"--provenance"/u);
  assert.match(publication, /NPM_UNSCOPED_TOKEN/u);
  assert.match(publication, /NPM_CONFIG_PREFER_ONLINE/u);
  assert.match(publicationHelper, /publicationToken/u);
  assert.match(publicationHelper, /waitForIntegrity/u);
  assert.match(publicationHelper, /"dist-tag", "add"/u);

  const externalPreview = await readFile(".github/workflows/external-preview-verification.yml", "utf8");
  assert.match(externalPreview, /workflow_dispatch:/u);
  assert.match(externalPreview, /deployment_url:/u);
  assert.match(externalPreview, /VELAR_DEPLOYMENT_URL/u);
  assert.match(externalPreview, /verify-deployment release\/external-preview\/site --json/u);
  assert.match(externalPreview, /actions\/attest@v4/u);
  assert.match(externalPreview, /artifact-metadata: write/u);
  assert.match(externalPreview, /actions\/upload-artifact@v5/u);
  assert.doesNotMatch(externalPreview, /netlify deploy|npm publish|secrets\./u);
});

test("[D61-156] the test gates discover example projects instead of naming them", async () => {
  // `examples/app` was written with twenty-one tests and no gate ran any of
  // them, because `gate:test` and `gate:test:browser` each named four projects
  // by hand and nobody edited those lines. The list is the defect, so what is
  // pinned here is that there is no list: the gates call the discovery runner,
  // and no example path is spelled in either of them.
  const workspace = JSON.parse(await readFile("package.json", "utf8")) as { scripts: Record<string, string> };
  const unit = resolveScript(workspace.scripts, "test");
  const browser = resolveScript(workspace.scripts, "test:browser");
  assert.match(unit, /scripts\/run-project-gate\.mjs unit/u);
  assert.match(browser, /scripts\/run-project-gate\.mjs browser/u);
  assert.doesNotMatch(unit, /examples\//u);
  assert.doesNotMatch(browser, /examples\//u);
  assert.match(resolveScript(workspace.scripts, "check"), /scripts\/check-project-builds\.mjs/u);

  // ...and that the discovery reaches the projects a list would have to be
  // told about, `examples/app` first among them.
  const root = repositoryRoot;
  const discovered = (await velarProjects(resolve(root, "examples"))).map((project: string) => relative(root, project).replaceAll("\\", "/"));
  for (const project of ["examples/app", "examples/tour/core", "examples/tour/desktop", "examples/tour/node", "examples/tour/web"]) {
    assert.ok(discovered.includes(project), `${project} is not discovered by the project gates; found ${discovered.join(", ")}`);
  }
});
