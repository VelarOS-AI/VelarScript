import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { repositoryRoot } from "../support/repository-root.ts";

const references = [
  "docs/core-standard.md",
  "docs/language-charter.md",
  "docs/standard-library.md",
  "docs/ai-skill.md",
  "docs/ai-skill-desktop.md",
  "docs/ai-skill-node.md",
  "docs/ai-skill-server.md",
  "docs/ai-skill-web.md",
  "docs/best-practices.md",
  "docs/escape-hatches.md",
  "docs/javascript-bridge.md",
  "docs/web-api.md",
  "docs/decisions/D18-VELAR-SERVE.md",
  "docs/decisions/D26-DEEP-REACTIVITY.md",
  "docs/decisions/D35-PARALLEL-ASYNC-AND-NAMESPACES.md",
  "docs/decisions/D90-AUDIT-SEMANTIC-RULINGS.md",
  "docs/decisions/D96-MAP-GET-OR-SET.md",
  "packages/desktop/README.md",
  "packages/node/README.md",
  "packages/server/README.md",
  "packages/web/README.md",
];

test("published documentation examples resolve their full context without fragment suppression", () => {
  // A successful exit alone also admits unresolved fragments. Pin full
  // analysis for the references whose missing context has been supplied;
  // check:docs separately walks the entire published document inventory.
  const run = spawnSync(process.execPath, ["scripts/check-documentation-examples.mjs", "--partial", ...references], {
    cwd: repositoryRoot,
    encoding: "utf8",
    timeout: 60_000,
  });
  const output = `${run.stdout ?? ""}${run.stderr ?? ""}`;
  assert.equal(run.error, undefined, output);
  assert.equal(run.status, 0, output);
  assert.match(run.stdout, /^Coverage: all [1-9]\d* fragments were checked in full$/mu);
  assert.doesNotMatch(output, /NOT checked in full|suppressed as inherent to a fragment/u);
});
