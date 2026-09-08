import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { compileProject } from "../../packages/cli/src/project.ts";
import { velarNodeCompilerExtension } from "../../packages/node/src/compiler.ts";

/**
 * Standard-module remedies use the project driver — the thing `velar check`
 * runs — to resolve each imported contract before checking its suggestion.
 *
 * `tests/compiler/diagnostics/canonical-type-remedies.test.ts` holds the
 * items a single module can state. These cannot: `logger`'s fields parameter,
 * the two `join` conventions, the caret of an unknown export name, and the
 * twelve exports the reference gained are all facts about a module that has to
 * be resolved first. Each test asserts the sentence and then compiles what it
 * names.
 */

async function inProject<T>(files: Readonly<Record<string, string>>, read: (root: string) => Promise<T>): Promise<T> {
  const root = await mkdtemp(join(tmpdir(), "velar-standard-module-remedies-"));
  try {
    for (const [path, contents] of Object.entries(files)) await writeFile(join(root, path), contents.trimStart(), "utf8");
    return await read(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

/** Every diagnostic of a one-module project, as `CODE message`. */
async function diagnostics(main: string): Promise<readonly string[]> {
  return inProject({ "main.vel": main }, async (root) => {
    const project = await compileProject(join(root, "main.vel"), new Map(), { extensions: [velarNodeCompilerExtension] });
    assert.deepEqual(project.failures.filter((failure) => failure.code === undefined).map((failure) => failure.message), []);
    return [
      ...project.modules.flatMap((module) => module.result.diagnostics.map((item) => `${item.code} ${item.message}`)),
      ...project.failures.flatMap((failure) => failure.code === undefined ? [] : [`${failure.code} ${failure.message}`]),
    ];
  });
}

// ── CO-I3: `logger(scope, fields)` takes a Map literal ─────────────────────

test("[CO-I3] the velar/log fields argument accepts a Map literal, as docs/standard-library.md writes it", async () => {
  assert.deepEqual(await diagnostics(`
import {logger} from "velar/log"

@main:
    const scoped = logger("build", Map({target: "web"}))
    scoped.info("Compilation ready")
`), []);
});

test("[CO-I3] a record literal in that position still names the conversion", async () => {
  assert.deepEqual(await diagnostics(`
import {logger} from "velar/log"

@main:
    const scoped = logger("build", {target: "web"})
    scoped.info("Compilation ready")
`), [
    "VEL4001 Use 'Map({...})' to convert record fields into string-keyed entries; a record literal '{...}' builds a"
    + " record, not a Map",
  ]);
});

// ── CO-I17: the two join conventions ───────────────────────────────────────

test("[CO-I17] each join names the other module's shape as well as its own", async () => {
  assert.deepEqual(await diagnostics(`
import {join} from "velar/path"

@main:
    print(join("a", "b"))
`), [
    "VEL3008 'velar/path' joins one List of segments — write 'join([\"a\", \"b\"])'; the positional 'join(a, b, ...)'"
    + " is the convention of 'velar/url', and the two modules keep different ones",
  ]);
  assert.deepEqual(await diagnostics(`
import {join} from "velar/url"

@main:
    print(join(["a", "b"]))
`), [
    "VEL3008 'velar/url' joins segments positionally — write 'join(\"a\", \"b\")'; the one-List 'join([...])' is the"
    + " convention of 'velar/path', and the two modules keep different ones",
  ]);
});

test("[CO-I17] both rewrites compile, and each convention is left alone where it is right", async () => {
  assert.deepEqual(await diagnostics(`
import {join} from "velar/path"

@main:
    print(join(["a", "b"]))
`), []);
  assert.deepEqual(await diagnostics(`
import {join} from "velar/url"

@main:
    print(join("https://a.dev", "x", "y"))
`), []);
});

test("[CO-I17] join guidance follows the exported member and preserves its local alias", async () => {
  for (const [module, before, after] of [
    ["path", 'combine("a", "b")', 'combine(["a", "b"])'],
    ["url", 'combine(["a", "b"])', 'combine("a", "b")'],
  ] as const) {
    const source = `import {join as combine} from "velar/${module}"\n\n@main:\n    print(${before})\n`;
    const reports = await diagnostics(source);
    assert.equal(reports.length, 1);
    assert.ok(reports[0]!.includes(`write '${after}'`), reports[0]!);
    assert.deepEqual(await diagnostics(source.replace(before, after)), []);
  }
  assert.deepEqual(await diagnostics(`
import {relative as join} from "velar/path"

@main:
    print(join("a", "b"))
`), []);
});

// ── CO-I7: the caret of an unknown export name ─────────────────────────────

test("[CO-I7] VEL6007 underlines the import name, aliased or not", async () => {
  await inProject({ "main.vel": 'import {nope as near} from "velar/time"\n\n@main:\n    print(str(near))\n' }, async (root) => {
    const project = await compileProject(join(root, "main.vel"), new Map(), { extensions: [velarNodeCompilerExtension] });
    const missing = project.failures.find((failure) => failure.code === "VEL6007");
    assert.ok(missing?.span, JSON.stringify(project.failures));
    const source = project.modules.find((module) => module.inputPath === missing.path)?.result.source;
    assert.equal(source?.text.slice(missing.span.start, missing.span.end), "nope");
  });
});

// ── CO-U5: the twelve Core exports docs/standard-library.md now names ──────

test("[CO-U5] every export the standard-library reference gained is real and compiles as written", async () => {
  // Eight `velar/binary` constructors, `velar/task`'s CancellationError, and
  // three of `velar/worker`'s four error classes appeared in no document and no
  // package README. The reference names them now, so this is the check that the
  // names it prints are the names the modules publish.
  assert.deepEqual(await diagnostics(`
import {ByteOrder, float32Buffer, float32Builder, float32FromBytes, uint32Buffer, uint32Builder, uint32FromBytes, uint8Buffer, uint8FromBytes} from "velar/binary"
import {CancellationError} from "velar/task"
import {WorkerBackpressureError, WorkerCallError, WorkerClosedError, WorkerCrashedError} from "velar/worker"

@main:
    const bytes8 = uint8Buffer(4)
    const words = uint32Buffer(4)
    const floats = float32Buffer(4)
    print(str(bytes8.size + words.size + floats.size))
    print(str(uint32Builder(4).size + float32Builder(4).size))
    print(str(uint8FromBytes(bytes8.toBytes()).size))
    print(str(uint32FromBytes(words.toBytes(ByteOrder.little), ByteOrder.little).size))
    print(str(float32FromBytes(floats.toBytes(ByteOrder.little), ByteOrder.little).size))
    const raised: List<Error> = [
        CancellationError("cancelled"),
        WorkerBackpressureError("full"),
        WorkerCallError("failed"),
        WorkerClosedError("closed"),
        WorkerCrashedError("crashed"),
    ]
    print(str(raised.size))
`), []);
});
