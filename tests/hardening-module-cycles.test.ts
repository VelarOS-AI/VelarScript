import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { compileProject, type ProjectResult } from "../packages/cli/src/project.ts";
import { velarCompilerExtension } from "../packages/web/src/compiler.ts";

const CYCLE = "VEL3019";
const CIRCULAR_IMPORT = "VEL6010";
const CYCLE_MESSAGE = /Move this read into a function, or extract the shared value into a third module; '\.\/[a-z-]+\.vel' has not initialized when this line runs/u;

const projectRoot = join(tmpdir(), "velar-module-cycle-tests");

async function checkProject(
  modules: Readonly<Record<string, string>>,
  entry: string,
  extensions: readonly (typeof velarCompilerExtension)[] = [],
): Promise<ProjectResult> {
  const overrides = new Map(Object.entries(modules).map(([name, text]) => [join(projectRoot, name), text]));
  return await compileProject(join(projectRoot, entry), overrides, { extensions });
}

function diagnosticsOf(project: ProjectResult, name: string): readonly { code: string; message: string }[] {
  const module = project.modules.find((candidate) => candidate.inputPath === join(projectRoot, name));
  assert.ok(module, `module ${name} was compiled`);
  return module.result.diagnostics;
}

function advisoriesOf(project: ProjectResult, name: string): readonly { code: string; message: string }[] {
  const module = project.modules.find((candidate) => candidate.inputPath === join(projectRoot, name));
  assert.ok(module, `module ${name} was compiled`);
  return module.result.advisories;
}

test("a module initialization cycle is rejected on the reading line with the two-fix teaching message", async () => {
  const project = await checkProject({
    "a.vel": 'import {b} from "./b.vel"\nexport const a = "A"\nprint(b)\n',
    "b.vel": 'import {a} from "./a.vel"\nexport const b = "B" + a\n',
  }, "a.vel");

  assert.deepEqual(project.failures, []);
  assert.deepEqual(diagnosticsOf(project, "a.vel"), []);
  const failing = diagnosticsOf(project, "b.vel");
  assert.equal(failing.length, 1, failing.map((item) => item.message).join("\n"));
  assert.equal(failing[0]?.code, CYCLE);
  assert.equal(
    failing[0]?.message,
    "Move this read into a function, or extract the shared value into a third module; './a.vel' has not initialized when this line runs",
  );
  // The zero-diagnostics gate for code generation still holds.
  const module = project.modules.find((candidate) => candidate.inputPath === join(projectRoot, "b.vel"));
  assert.equal(module?.result.code, null);
});

test("every module-initialization position is classified as an eager read", async () => {
  const project = await checkProject({
    "positions.vel": [
      'import {value} from "./source.vel"',
      "export const fromInitializer = value",
      "print(value)",
      "const viaArgument = str(value)",
      "if true:",
      "    print(value)",
      "class Registry:",
      "    static const seeded: string = value",
      "",
    ].join("\n"),
    "source.vel": 'import {fromInitializer} from "./positions.vel"\nexport const value: string = "seed"\nexport def read() -> string:\n    return fromInitializer\n',
  }, "source.vel");

  assert.deepEqual(project.failures, []);
  assert.deepEqual(diagnosticsOf(project, "source.vel"), []);
  const failing = diagnosticsOf(project, "positions.vel");
  // initializer, print argument, str argument, if-body read, static field.
  assert.equal(failing.length, 5, failing.map((item) => item.message).join("\n"));
  assert.ok(failing.every((item) => item.code === CYCLE && CYCLE_MESSAGE.test(item.message)));
});

test("function-body reads stay legal: a pure function cycle compiles and runs", async () => {
  const project = await checkProject({
    "left.vel": [
      'import {shoutRight} from "./right.vel"',
      "export def shoutLeft() -> string:",
      '    return "left"',
      "export def relay() -> string:",
      "    return shoutRight()",
      "print(relay())",
      "",
    ].join("\n"),
    "right.vel": [
      'import {shoutLeft} from "./left.vel"',
      "export def shoutRight() -> string:",
      "    return shoutLeft()",
      "",
    ].join("\n"),
  }, "left.vel");

  assert.deepEqual(project.failures, []);
  for (const module of project.modules) {
    assert.deepEqual(module.result.diagnostics, [], module.inputPath);
    assert.ok(module.result.code, module.inputPath);
    assert.deepEqual(module.result.runtimeModules, [], module.inputPath);
    assert.deepEqual(module.result.advisories.map((item) => item.code), [CIRCULAR_IMPORT]);
    assert.match(module.result.advisories[0]?.message ?? "", /Circular module dependency includes left\.vel, right\.vel/u);
  }

  // Execution-level: the emitted ESM cycle evaluates and the relay resolves.
  const directory = await mkdtemp(join(tmpdir(), "velar-function-cycle-"));
  try {
    for (const module of project.modules) {
      const name = module.inputPath.endsWith("left.vel") ? "left.js" : "right.js";
      await writeFile(join(directory, name), module.result.code ?? "", "utf8");
    }
    const execution = spawnSync(process.execPath, [join(directory, "left.js")], { encoding: "utf8" });
    assert.equal(execution.status, 0, execution.stderr);
    assert.equal(execution.stdout, "left\n");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("deferred positions stay legal: methods, arrows, instance fields, and parameter defaults", async () => {
  const project = await checkProject({
    "deferred.vel": [
      'import {value} from "./provider.vel"',
      "export def readInBody() -> string:",
      "    return value",
      "export const viaArrow = () => value",
      "def withDefault(text: string = value) -> string:",
      "    return text",
      "class Holder:",
      "    const held: string = value",
      "    def read() -> string:",
      "        return value",
      "",
    ].join("\n"),
    "provider.vel": 'import {readInBody} from "./deferred.vel"\nexport const value: string = "ready"\nprint(readInBody())\n',
  }, "provider.vel");

  assert.deepEqual(project.failures, []);
  for (const module of project.modules) {
    assert.deepEqual(module.result.diagnostics, [], module.inputPath);
  }
});

test("cross-module mutually recursive record types stay legal", async () => {
  const project = await checkProject({
    "type-a.vel": [
      'import {B} from "./type-b.vel"',
      "export type A:",
      "    partner: B?",
      "export const seed: A = {partner: null}",
      "print(seed.partner == null)",
      "",
    ].join("\n"),
    "type-b.vel": 'import {A} from "./type-a.vel"\nexport type B:\n    partner: A?\n',
  }, "type-a.vel");

  assert.deepEqual(project.failures, []);
  for (const module of project.modules) {
    assert.deepEqual(module.result.diagnostics, [], module.inputPath);
  }
});

test("an eager read of a cycle member that evaluates earlier stays legal", async () => {
  // Evaluation order from the entry is cycle-b first, then cycle-a, so
  // cycle-a's top-level read observes an initialized binding.
  const project = await checkProject({
    "cycle-a.vel": 'import {value} from "./cycle-b.vel"\nexport const forwarded = value\n',
    "cycle-b.vel": 'import {forwarded} from "./cycle-a.vel"\nexport const value: number = 1\nexport def read() -> number:\n    return forwarded\n',
  }, "cycle-a.vel");

  assert.deepEqual(project.failures, []);
  for (const module of project.modules) {
    assert.deepEqual(module.result.diagnostics, [], module.inputPath);
  }
});

test("a three-module cycle flags only the member that reads a later-evaluating module", async () => {
  const project = await checkProject({
    "first.vel": 'import {fromSecond} from "./second.vel"\nexport const fromFirst = "first"\nprint(fromSecond)\n',
    "second.vel": 'import {fromThird} from "./third.vel"\nexport const fromSecond = fromThird\n',
    "third.vel": 'import {fromFirst} from "./first.vel"\nexport const fromThird = fromFirst\n',
  }, "first.vel");

  assert.deepEqual(project.failures, []);
  // Evaluation order: third, second, first. Only third reads a later module.
  assert.deepEqual(diagnosticsOf(project, "first.vel"), []);
  assert.deepEqual(diagnosticsOf(project, "second.vel"), []);
  const failing = diagnosticsOf(project, "third.vel");
  assert.equal(failing.length, 1, failing.map((item) => item.message).join("\n"));
  assert.equal(failing[0]?.code, CYCLE);
  assert.match(failing[0]?.message ?? "", /'\.\/first\.vel' has not initialized when this line runs/u);
});

test("a module-scope state initializer is an initialization position in web modules", async () => {
  const project = await checkProject({
    "store.vel": 'import {seed} from "./seed.vel"\nstate current = seed\nexport def read() -> string:\n    return current\n',
    "seed.vel": 'import {read} from "./store.vel"\nexport const seed = "initial"\nprint(read())\n',
  }, "seed.vel", [velarCompilerExtension]);

  assert.deepEqual(project.failures, []);
  assert.deepEqual(diagnosticsOf(project, "seed.vel"), []);
  const failing = diagnosticsOf(project, "store.vel");
  assert.equal(failing.length, 1, failing.map((item) => item.message).join("\n"));
  assert.equal(failing[0]?.code, CYCLE);

  // Component bodies render after module evaluation, so the same read inside
  // a component stays legal.
  const deferred = await checkProject({
    "view.vel": 'import {seed} from "./data.vel"\ncomponent Label:\n    return <span>{seed}</span>\nexport def keep() -> string:\n    return seed\n',
    "data.vel": 'import {keep} from "./view.vel"\nexport const seed = "shown"\nprint(keep())\n',
  }, "data.vel", [velarCompilerExtension]);
  assert.deepEqual(deferred.failures, []);
  for (const module of deferred.modules) {
    assert.deepEqual(module.result.diagnostics, [], module.inputPath);
  }
});

test("a module-scope watch evaluates its subject eagerly but runs its body on change", async () => {
  // The watched subject reads while the module initializes: flagged. D90 R15(a)
  // narrowed the subject to a named reactive variable, so the import itself is
  // now the subject -- and the watch alone carries the cycle: delete the watch
  // line and this module compiles clean, which the next case asserts.
  const eager = await checkProject({
    "watcher.vel": 'import {seed} from "./origin.vel"\nstate local = "x"\nwatch seed as current, previous:\n    print(current + previous)\nexport def read() -> string:\n    return local\n',
    "origin.vel": 'import {read} from "./watcher.vel"\nexport state seed = "s"\nprint(read())\n',
  }, "origin.vel", [velarCompilerExtension]);
  assert.deepEqual(eager.failures, []);
  const failing = diagnosticsOf(eager, "watcher.vel");
  assert.equal(failing.length, 1, failing.map((item) => item.message).join("\n"));
  assert.equal(failing[0]?.code, CYCLE);

  // The same two modules without the watch line: nothing else reads the import
  // eagerly, so the diagnostic above belongs to the subject and to nothing else.
  const withoutWatch = await checkProject({
    "watcher.vel": 'import {seed} from "./origin.vel"\nstate local = "x"\nexport def read() -> string:\n    return local\n',
    "origin.vel": 'import {read} from "./watcher.vel"\nexport state seed = "s"\nprint(read())\n',
  }, "origin.vel", [velarCompilerExtension]);
  assert.deepEqual(withoutWatch.failures, []);
  for (const module of withoutWatch.modules) {
    assert.deepEqual(module.result.diagnostics, [], module.inputPath);
  }

  // A body-only read runs on a later change, never during evaluation: legal.
  const bodyOnly = await checkProject({
    "watcher.vel": 'import {seed} from "./origin.vel"\nstate local = "x"\nwatch local as current, previous:\n    print(current + previous + seed)\nexport def read() -> string:\n    return local\n',
    "origin.vel": 'import {read} from "./watcher.vel"\nexport state seed = "s"\nprint(read())\n',
  }, "origin.vel", [velarCompilerExtension]);
  assert.deepEqual(bodyOnly.failures, []);
  for (const module of bodyOnly.modules) {
    assert.deepEqual(module.result.diagnostics, [], module.inputPath);
  }
});

test("modules outside any cycle never pay the check", async () => {
  const project = await checkProject({
    "app.vel": 'import {value} from "./library.vel"\nprint(value)\n',
    "library.vel": 'export const value = "linear"\n',
  }, "app.vel");

  assert.deepEqual(project.failures, []);
  for (const module of project.modules) {
    assert.deepEqual(module.result.diagnostics, [], module.inputPath);
    assert.deepEqual(module.result.advisories, [], module.inputPath);
  }
});

test("an incremental edit clears a stale circular-import advisory", async () => {
  const cyclicSources = {
    "left.vel": 'import {right} from "./right.vel"\nexport def left() -> string:\n    return right()\n',
    "right.vel": 'import {left} from "./left.vel"\nexport def right() -> string:\n    return left()\n',
  };
  const initial = await checkProject(cyclicSources, "left.vel");
  assert.deepEqual(advisoriesOf(initial, "left.vel").map((item) => item.code), [CIRCULAR_IMPORT]);
  assert.deepEqual(advisoriesOf(initial, "right.vel").map((item) => item.code), [CIRCULAR_IMPORT]);

  const fixedSources = {
    ...cyclicSources,
    "right.vel": 'export def right() -> string:\n    return "right"\n',
  };
  const overrides = new Map(Object.entries(fixedSources).map(([name, text]) => [join(projectRoot, name), text]));
  const fixed = await compileProject(
    join(projectRoot, "left.vel"),
    overrides,
    {},
    initial,
    new Set([join(projectRoot, "right.vel")]),
  );
  assert.deepEqual(advisoriesOf(fixed, "left.vel"), []);
  assert.deepEqual(advisoriesOf(fixed, "right.vel"), []);
});
