import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { buildOwnershipGraph, ownershipGraphDelta, updateOwnershipGraph } from "../packages/cli/src/ownership-graph.ts";
import { compileProject, compileProjectEntries } from "../packages/cli/src/project.ts";
import { velarCompilerExtension as webExtension } from "../packages/web/src/compiler.ts";

test("compiler-owned ownership graph publishes stable bounded relations", async () => {
  const root = await mkdtemp(join(tmpdir(), "velar-ownership-graph-"));
  const mainPath = join(root, "main.vel");
  const modelPath = join(root, "model.vel");
  const main = [
    'import {label} from "./model.vel"',
    'import {monotonic} from "velar/time"',
    '/// Formats one model value for presentation.',
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
    assert.equal(
      graph.nodes.find((node) => node.kind === "function" && node.name === "local")?.documentation,
      "Formats one model value for presentation.",
    );

    const countId = graph.nodes.find((node) => node.kind === "state" && node.name === "count")?.id;
    const changed = await compileProject(mainPath, new Map([[mainPath, `// shifted\n${main}`]]), {
      sourceRoot: root,
      projectRoot: root,
      extensions: [webExtension],
    }, project, new Set([mainPath]));
    const changedGraph = await buildOwnershipGraph(changed);
    const hotGraph = await updateOwnershipGraph(graph, project, changed);
    assert.equal(changedGraph.nodes.find((node) => node.kind === "state" && node.name === "count")?.id, countId);
    assert.notEqual(changedGraph.revision, graph.revision);
    assert.equal(hotGraph.activity.strategy, "affected-modules");
    assert.equal(hotGraph.activity.modulesVisited, 1);
    assert.deepEqual(
      [...hotGraph.nodes].sort((left, right) => left.id.localeCompare(right.id)),
      [...changedGraph.nodes].sort((left, right) => left.id.localeCompare(right.id)),
    );
    assert.deepEqual(
      [...hotGraph.edges].sort((left, right) => left.id.localeCompare(right.id)),
      [...changedGraph.edges].sort((left, right) => left.id.localeCompare(right.id)),
    );
    const delta = ownershipGraphDelta(graph, hotGraph);
    assert.equal(delta.baseRevision, graph.revision);
    assert.equal(delta.revision, hotGraph.revision);
    assert.ok(delta.nodes.length < hotGraph.nodes.length);
    assert.ok(delta.nodes.some((node) => node.kind === "module" && node.name === "main.vel"));
    assert.ok(delta.nodes.every((node) => node.path === mainPath));

    const bounded = await buildOwnershipGraph(project, { maximumNodes: 2, maximumEdges: 2 });
    assert.equal(bounded.nodes.length, 2);
    assert.equal(bounded.limitReached, true);
    assert.equal(bounded.coverage.complete, false);
    const rebuiltBounded = await updateOwnershipGraph(bounded, project, changed, { maximumNodes: 2, maximumEdges: 2 });
    assert.equal(rebuiltBounded.activity.strategy, "full");
    assert.equal(rebuiltBounded.limitReached, true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("one source edit rebuilds one graph fragment instead of the whole project", async () => {
  const root = await mkdtemp(join(tmpdir(), "velar-ownership-graph-hot-"));
  const sources = new Map<string, string>();
  for (let moduleIndex = 0; moduleIndex < 64; moduleIndex += 1) {
    const lines: string[] = [];
    for (let functionIndex = 0; functionIndex < 24; functionIndex += 1) {
      lines.push(`export def helper${functionIndex}(value: number) -> number:`);
      lines.push(`    return value + ${moduleIndex + functionIndex}`);
      lines.push("");
    }
    sources.set(join(root, `module-${moduleIndex}.vel`), lines.join("\n"));
  }
  const entries = [...sources.keys()];
  const entry = entries[0]!;
  try {
    const project = await compileProjectEntries(entries, entry, sources, { sourceRoot: root, projectRoot: root });
    assert.deepEqual(project.failures, []);
    assert.deepEqual(project.modules.flatMap((module) => module.result.diagnostics), []);
    const graph = await buildOwnershipGraph(project);

    const changedPath = entries.at(-1)!;
    const changedSources = new Map(sources);
    changedSources.set(changedPath, `// changed\n${changedSources.get(changedPath)}`);
    const changed = await compileProjectEntries(
      entries,
      entry,
      changedSources,
      { sourceRoot: root, projectRoot: root },
      project,
      new Set([changedPath]),
    );

    let hot = await updateOwnershipGraph(graph, project, changed);
    let full = await buildOwnershipGraph(changed);
    let hotMs = Number.POSITIVE_INFINITY;
    let fullMs = Number.POSITIVE_INFINITY;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      hot = await updateOwnershipGraph(graph, project, changed);
      hotMs = Math.min(hotMs, hot.durationMs);
      full = await buildOwnershipGraph(changed);
      fullMs = Math.min(fullMs, full.durationMs);
    }

    assert.equal(hot.activity.strategy, "affected-modules");
    assert.equal(hot.activity.modulesVisited, 1);
    assert.equal(full.activity.modulesVisited, sources.size);
    assert.deepEqual(
      [...hot.nodes].sort((left, right) => left.id.localeCompare(right.id)),
      [...full.nodes].sort((left, right) => left.id.localeCompare(right.id)),
    );
    assert.deepEqual(
      [...hot.edges].sort((left, right) => left.id.localeCompare(right.id)),
      [...full.edges].sort((left, right) => left.id.localeCompare(right.id)),
    );
    assert.ok(
      hotMs < fullMs * 0.75,
      `affected-module graph ${Math.round(hotMs)} ms vs full ${Math.round(fullMs)} ms`,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
