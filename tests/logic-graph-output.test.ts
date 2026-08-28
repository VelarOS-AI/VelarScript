import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const cli = join(process.cwd(), "packages", "cli", "src", "cli.ts");

function graph(root: string, ...arguments_: readonly string[]) {
  return spawnSync(process.execPath, [cli, "graph", root, ...arguments_], {
    cwd: root,
    encoding: "utf8",
    timeout: 30_000,
  });
}

test("velar graph gives AI tools a current global snapshot and focused neighborhood", async () => {
  const root = await mkdtemp(join(tmpdir(), "velar-logic-graph-output-"));
  const entry = join(root, "main.vel");
  try {
    await writeFile(join(root, "velar.json"), JSON.stringify({ formatVersion: 2, entry: "main.vel", extensions: [] }), "utf8");
    await writeFile(join(root, "model.vel"), [
      "/// Doubles one input value.",
      "export def double(value: number) -> number:",
      "    return value * 2",
      "",
    ].join("\n"), "utf8");
    await writeFile(entry, [
      'import {double} from "./model.vel"',
      "/// Computes the visible total.",
      "def total(value: number) -> number:",
      "    return double(value)",
      "print(total(2))",
      "",
    ].join("\n"), "utf8");

    const first = graph(root, "--json");
    assert.equal(first.status, 0, first.stderr);
    const snapshot = JSON.parse(first.stdout) as {
      revision: string;
      diagnostics: number;
      nodes: Array<{ kind: string; name: string; path?: string; documentation?: string }>;
      edges: Array<{ kind: string }>;
      coverage: { complete: boolean };
    };
    assert.match(snapshot.revision, /^[a-f0-9]{64}$/u);
    assert.equal(snapshot.diagnostics, 0);
    assert.equal(snapshot.coverage.complete, true);
    assert.ok(snapshot.nodes.some((node) => node.kind === "module" && node.path === "main.vel"));
    assert.ok(snapshot.nodes.some((node) => node.name === "total" && node.documentation === "Computes the visible total."));
    assert.ok(snapshot.edges.some((edge) => edge.kind === "calls"));
    assert.ok(snapshot.nodes.every((node) => node.kind !== "parameter"));

    const focused = graph(root, "--focus", "total", "--depth", "1");
    assert.equal(focused.status, 0, focused.stderr);
    assert.match(focused.stdout, /scope=focus:"total" depth:1/u);
    assert.match(focused.stdout, /function "total"/u);
    assert.match(focused.stdout, /-calls->/u);

    await writeFile(entry, (await readFile(entry, "utf8")).replaceAll("total", "visible"), "utf8");
    const changed = graph(root, "--json");
    assert.equal(changed.status, 0, changed.stderr);
    assert.notEqual((JSON.parse(changed.stdout) as { revision: string }).revision, snapshot.revision);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
