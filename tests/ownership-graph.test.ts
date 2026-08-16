import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { buildOwnershipGraph } from "../packages/cli/src/ownership-graph.ts";
import { compileProject } from "../packages/cli/src/project.ts";
import { velarCompilerExtension as webExtension } from "../packages/web/src/compiler.ts";

test("compiler-owned ownership graph publishes stable bounded relations", async () => {
  const root = await mkdtemp(join(tmpdir(), "velar-ownership-graph-"));
  const mainPath = join(root, "main.vel");
  const modelPath = join(root, "model.vel");
  const main = [
    'import {label} from "./model.vel"',
    'import {monotonic} from "velar/time"',
    'def local(value: number) -> string:',
    '    return label(value)',
    'component App:',
    '    state count = 1',
    '    computed doubled = count * 2',
    '    const snapshot: readonly List<number> = [count]',
    '    action refresh():',
    '        count += 1',
    '        print(local(monotonic()))',
    '    return <button on:click={() => refresh()}>{doubled}</button>',
    '',
  ].join("\n");
  try {
    await writeFile(modelPath, 'export def label(value: number) -> string:\n    return str(value)\n', "utf8");
    await writeFile(mainPath, main, "utf8");
    const project = await compileProject(mainPath, new Map(), {
      sourceRoot: root,
      projectRoot: root,
      extensions: [webExtension],
    });
    assert.deepEqual(project.failures, []);
    assert.deepEqual(project.modules.flatMap((module) => module.result.diagnostics), []);

    const graph = await buildOwnershipGraph(project);
    const nodeKinds = new Set(graph.nodes.map((node) => node.kind));
    const edgeKinds = new Set(graph.edges.map((edge) => edge.kind));
    for (const kind of ["module", "component", "state", "computed", "action", "function", "capability", "readonlyProjection"]) {
      assert.ok(nodeKinds.has(kind as never), `missing ${kind} node`);
    }
    for (const kind of ["imports", "owns", "reads", "writes", "derives", "calls", "crossesCapability", "projectsReadonly"]) {
      assert.ok(edgeKinds.has(kind as never), `missing ${kind} edge`);
    }
    assert.equal(graph.coverage.complete, true);
    assert.equal(graph.coverage.modulesIncluded, 2);
    assert.equal(graph.limitReached, false);
    assert.ok(graph.durationMs < 3_000, `ownership graph took ${graph.durationMs}ms`);

    const countId = graph.nodes.find((node) => node.kind === "state" && node.name === "count")?.id;
    const changed = await compileProject(mainPath, new Map([[mainPath, `// shifted\n${main}`]]), {
      sourceRoot: root,
      projectRoot: root,
      extensions: [webExtension],
    });
    const changedGraph = await buildOwnershipGraph(changed);
    assert.equal(changedGraph.nodes.find((node) => node.kind === "state" && node.name === "count")?.id, countId);
    assert.notEqual(changedGraph.revision, graph.revision);

    const bounded = await buildOwnershipGraph(project, { maximumNodes: 2, maximumEdges: 2 });
    assert.equal(bounded.nodes.length, 2);
    assert.equal(bounded.limitReached, true);
    assert.equal(bounded.coverage.complete, false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
