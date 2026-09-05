import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { compileProject, type ProjectFailure } from "../packages/cli/src/project.ts";
import { formatProjectFailure } from "../packages/cli/src/project-failure.ts";
import { velarNodeCompilerExtension } from "../packages/node/src/compiler.ts";
import { velarCompilerExtension as velarWebCompilerExtension } from "../packages/web/src/compiler.ts";

const cli = resolve("packages/cli/src/cli.ts");

/**
 * MD-I1/MD-I2/MD-U2/MD-I3/SV-C2: module resolution reports like every other
 * compiler family — a code, a position, and one report per mistake.
 *
 * This family used to print `path: message`: no code, no line, no column, and
 * no caret, because seven call sites each spelled that one line and there was
 * nowhere for a code or a span to go. Four of its messages also answered a
 * question the author had not asked — a misspelled export name got no near
 * name, `velar/test` was told it "has no export named 'test'" instead of where
 * a test is declared, and a self-import and a Core prelude name each drew a
 * second report beside the one the compiler had already made.
 */

type Reported = { readonly code: string; readonly message: string; readonly line: number; readonly column: number };

/** Compiles one project on disk and returns its diagnostics with positions. */
async function diagnose(files: Readonly<Record<string, string>>, web = false): Promise<{
  readonly reported: readonly Reported[];
  readonly failures: readonly ProjectFailure[];
  readonly root: string;
}> {
  const root = await mkdtemp(join(tmpdir(), "velar-module-resolution-"));
  for (const [path, contents] of Object.entries(files)) {
    await mkdir(join(root, path, ".."), { recursive: true });
    await writeFile(join(root, path), contents, "utf8");
  }
  const entry = join(root, "main.vel");
  const project = await compileProject(entry, new Map(), { extensions: [web ? velarWebCompilerExtension : velarNodeCompilerExtension] });
  const sourceOf = new Map(project.modules.map((module) => [module.inputPath, module.result.source]));
  const positioned = (path: string, code: string, message: string, span: { readonly start: number }): Reported => {
    const location = sourceOf.get(path)?.location(span.start) ?? { line: 0, column: 0 };
    return { code, message, line: location.line, column: location.column };
  };
  const reported = [
    ...project.modules.flatMap((module) => module.result.diagnostics.map((item) => positioned(module.inputPath, item.code, item.message, item.span))),
    // A resolution failure carries its own code and span; the renderer and the
    // language server read exactly this pair.
    ...project.failures.flatMap((failure) => failure.code === undefined || failure.span === undefined
      ? []
      : [positioned(failure.path, failure.code, failure.message, failure.span)]),
  ];
  return { reported, failures: project.failures.filter((failure) => failure.code === undefined), root };
}

test("an unknown export name is a positioned VEL6007 with the nearest exported name", async () => {
  const { reported, failures, root } = await diagnose({
    "other.vel": "export const alpha = 1\nexport const beta = 2\n",
    "main.vel": 'import {alpha, alpah} from "./other.vel"\n\n@main:\n    print(alpha)\n',
  });
  try {
    const missing = reported.find((item) => item.code === "VEL6007");
    assert.ok(missing, JSON.stringify(reported));
    assert.equal(missing.message, "Module './other.vel' has no export named 'alpah'; did you mean 'alpha'?");
    assert.equal(missing.line, 1);
    assert.equal(missing.column, 28, "the report sits on the module specifier it is about");
    assert.deepEqual(failures, [], "a positioned resolution failure is a diagnostic, not a bare line");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("velar/test in a non-test module reports where a test is declared", async () => {
  const { reported, root } = await diagnose({
    "main.vel": 'import {test} from "velar/test"\n\n@main:\n    print("hi")\n',
  });
  try {
    const rule = reported.find((item) => item.code === "VEL6007");
    assert.ok(rule, JSON.stringify(reported));
    assert.equal(
      rule.message,
      `'velar/test' belongs to a '*.test.vel' module; a test is declared as 'test "name":' at the top level of a '*.test.vel' module, which is where the runner looks`,
    );
    assert.doesNotMatch(rule.message, /has no export named/u);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a self-import and a Core prelude name each draw exactly one report", async () => {
  const { reported, failures, root } = await diagnose({
    "main.vel": 'import {AddressInUseError} from "velar/serve"\nimport {missingThing} from "./main.vel"\n\n@main:\n    print("hi")\n',
  });
  try {
    // MD-I3: VEL6004 names the self edge; nothing says "has no export named".
    assert.equal(reported.filter((item) => item.code === "VEL6004").length, 1, JSON.stringify(reported));
    assert.equal(reported.filter((item) => item.code === "VEL6007").length, 0, JSON.stringify(reported));
    // A Core prelude name imported from a module is VEL3007 and nothing else.
    const reserved = reported.filter((item) => item.code === "VEL3007");
    assert.equal(reserved.length, 1, JSON.stringify(reported));
    assert.equal(reserved[0]!.message, "'AddressInUseError' is a reserved Core binding");
    assert.deepEqual(failures, []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("an aliased Core prelude name keeps its own report, because VEL3007 has none to make", async () => {
  const { reported, root } = await diagnose({
    "other.vel": "export const alpha = 1\n",
    "main.vel": 'import {range as measure} from "./other.vel"\n\n@main:\n    print("hi")\n',
  });
  try {
    // The binding is `measure`, which is not reserved, so nothing else reports.
    assert.equal(reported.filter((item) => item.code === "VEL3007").length, 0, JSON.stringify(reported));
    const missing = reported.find((item) => item.code === "VEL6007");
    assert.ok(missing, JSON.stringify(reported));
    assert.equal(missing.message, "Module './other.vel' has no export named 'range'");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a Web target names where each refused local module's capability lives", async () => {
  const { reported, root } = await diagnose({
    "main.vel": [
      'import {readText} from "velar/fs"',
      'import {serve} from "velar/serve"',
      'import {run} from "velar/process"',
      'import {get} from "velar/env"',
      'import {terminal} from "velar/terminal"',
      'import {exit} from "velar/host"',
      'import {join} from "velar/path"',
      "",
    ].join("\n"),
  }, true);
  try {
    const refusals = reported.filter((item) => item.code === "VEL6008");
    assert.equal(refusals.length, 7, JSON.stringify(reported));
    // Every refusal sits on its own import, and every one says where to go.
    assert.deepEqual(refusals.map((item) => item.line), [1, 2, 3, 4, 5, 6, 7]);
    const guidance = new Map(refusals.map((item) => [item.message.split(" ", 1)[0], item.message]));
    assert.match(guidance.get("velar/fs") ?? "", /use velar\/files for files the person using the application picks or saves$/u);
    assert.match(guidance.get("velar/serve") ?? "", /call an HTTP API with velar\/http$/u);
    assert.match(guidance.get("velar/path") ?? "", /use velar\/url to build and read URL paths; the Web has no filesystem paths$/u);
    assert.match(guidance.get("velar/env") ?? "", /use velar\/config for values the build supplies$/u);
    assert.match(guidance.get("velar/process") ?? "", /the Web has no equivalent: a page cannot start local programs$/u);
    assert.match(guidance.get("velar/terminal") ?? "", /the Web has no equivalent: a page has no terminal$/u);
    assert.match(guidance.get("velar/host") ?? "", /the Web has no equivalent: a page does not own the process it runs in$/u);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("velar check prints a resolution failure as path:line:col error VELxxxx", async () => {
  const project = await mkdtemp(join(tmpdir(), "velar-module-resolution-cli-"));
  try {
    await writeFile(join(project, "velar.json"), `${JSON.stringify({
      formatVersion: 2, kind: "application", entry: "src/main.vel", outDir: "dist",
      extensions: ["@velarscript/node"], surfaces: { core: "0.7", node: "0.16" },
    }, null, 2)}\n`, "utf8");
    await mkdir(join(project, "src"), { recursive: true });
    await writeFile(join(project, "src", "other.vel"), "export const alpha = 1\n", "utf8");
    await writeFile(join(project, "src", "main.vel"), 'import {alpah} from "./other.vel"\n\n@main:\n    print("hi")\n', "utf8");
    const checked = spawnSync(process.execPath, [cli, "check", project], { encoding: "utf8" });
    assert.notEqual(checked.status, 0, checked.stdout);
    assert.match(
      checked.stderr,
      /src\/main\.vel:1:21 error VEL6007: Module '\.\/other\.vel' has no export named 'alpah'; did you mean 'alpha'\?/u,
      checked.stderr,
    );
    // The presentation is the compiler's own: source line, then a caret.
    assert.match(checked.stderr, /import \{alpah\} from "\.\/other\.vel"\n\s+\^+/u, checked.stderr);
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test("a failure with no source behind it keeps the plain path: message line", () => {
  const project = { modules: [], failures: [], notices: [] } as unknown as Parameters<typeof formatProjectFailure>[1];
  assert.equal(
    formatProjectFailure({ path: "/p/main.vel", message: "A VelarScript project cannot contain more than 4096 source modules" }, project),
    "/p/main.vel: A VelarScript project cannot contain more than 4096 source modules",
  );
});
