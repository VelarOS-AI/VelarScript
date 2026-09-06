import assert from "node:assert/strict";
import test, { after } from "node:test";
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { compile as compileCore, formatSource } from "@velarscript/compiler";
import { compileProject as compileProjectCore } from "../../../packages/cli/src/project.ts";
import { projectDefinitionAt } from "../../../packages/cli/src/project-semantic.ts";
import { makeTemporaryDirectory, removeTemporaryDirectories } from "../../support/temporary-directory.ts";
import { compile, compileProject } from "../../support/compiler-suite.ts";

after(removeTemporaryDirectories);

test("named re-exports join the module interface with aliases and live-export flags", async () => {
  const directory = await makeTemporaryDirectory("velar-re-export-");
  const libraryPath = join(directory, "library.vel");
  const barrelPath = join(directory, "barrel.vel");
  const consumerPath = join(directory, "consumer.vel");
  await writeFile(libraryPath, `
export type Report:
    total: number

export let counter = 0

export def bump():
    counter += 1

export def greet(name: string) -> string:
    return "Hello, " + name
`.trimStart(), "utf8");
  await writeFile(barrelPath, `export {Report, counter, bump, greet as hello} from "./library.vel"\n`, "utf8");
  const consumerSource = `
import {Report, counter, bump, hello} from "./barrel.vel"

const report: Report = {total: 1}
print(hello("Velar"))
print(counter)
bump()
print(counter)
print(report.total)
`.trimStart();
  await writeFile(consumerPath, consumerSource, "utf8");

  const project = await compileProject(consumerPath);
  assert.deepEqual(project.failures, []);
  assert.deepEqual(project.modules.flatMap((module) => module.result.diagnostics), []);
  const barrel = project.modules.find((module) => module.inputPath === barrelPath);
  assert.equal(barrel?.result.code, "export { Report, counter, bump, greet as hello } from \"./library.js\";\n");
  const symbols = project.modules.find((module) => module.inputPath === consumerPath)?.result.semanticIndex.symbols;
  assert.equal(symbols?.find((item) => item.name === "hello")?.type, "(name: string) -> string");

  // Go-to-definition follows the re-export chain to the origin declaration.
  const definition = projectDefinitionAt(project, consumerPath, consumerSource.indexOf("hello(\"Velar\")") + 1);
  assert.equal(definition?.path, libraryPath);

  // The live export propagates: a namespace import of the barrel is rejected
  // exactly like a namespace import of the origin module.
  const namespacePath = join(directory, "namespace.vel");
  await writeFile(namespacePath, `import * as barrel from "./barrel.vel"\n\nprint(barrel.hello("Velar"))\n`, "utf8");
  const namespaceProject = await compileProject(namespacePath);
  assert.ok(namespaceProject.failures.some((failure) => /exports live values; import them by name/u.test(failure.message)),
    JSON.stringify(namespaceProject.failures));

  // End-to-end: the compiled re-export stays a live ES-module binding.
  const cli = resolve("packages/cli/src/cli.ts");
  const execution = spawnSync(process.execPath, [cli, "run", consumerPath], { cwd: process.cwd(), encoding: "utf8" });
  assert.equal(execution.status, 0, execution.stderr);
  assert.equal(execution.stdout, "Hello, Velar\n0\n1\n1\n");
});

test("named re-exports work from package sources and package barrels", async () => {
  const directory = await makeTemporaryDirectory("velar-re-export-package-");
  const packageRoot = join(directory, "node_modules", "velar-lib");
  await mkdir(join(directory, "src"), { recursive: true });
  await mkdir(join(packageRoot, "src"), { recursive: true });
  await writeFile(join(directory, "velar.json"), JSON.stringify({ formatVersion: 2, entry: "src/main.vel", extensions: [] }), "utf8");
  await writeFile(join(packageRoot, "package.json"), JSON.stringify({ name: "velar-lib", velar: { entry: "src/index.vel", targets: ["core", "node"], requires: { capabilities: [] } } }), "utf8");
  await writeFile(join(packageRoot, "src", "impl.vel"), `
export def greet(name: string) -> string:
    return "Hello, " + name
`.trimStart(), "utf8");
  // The package entry is itself a barrel of internal modules.
  await writeFile(join(packageRoot, "src", "index.vel"), `export {greet} from "./impl.vel"\n`, "utf8");
  await writeFile(join(directory, "src", "main.vel"), `
import {packaged} from "./barrel.vel"

print(packaged("Velar"))
`.trimStart(), "utf8");
  // The application barrel re-exports directly from the package source.
  await writeFile(join(directory, "src", "barrel.vel"), `export {greet as packaged} from "velar-lib"\n`, "utf8");

  const project = await compileProjectCore(join(directory, "src", "main.vel"), new Map(), {
    sourceRoot: join(directory, "src"),
    projectRoot: directory,
    extensions: [],
  });
  assert.deepEqual(project.failures, []);
  assert.deepEqual(project.modules.flatMap((module) => module.result.diagnostics), []);

  const cli = resolve("packages/cli/src/cli.ts");
  const execution = spawnSync(process.execPath, [cli, "run"], { cwd: directory, encoding: "utf8" });
  assert.equal(execution.status, 0, execution.stderr);
  assert.equal(execution.stdout, "Hello, Velar\n");
});

test("re-exports reject namespace form, duplicates, and missing origin names", async () => {
  const star = compile(`export * from "./library.vel"\n`);
  assert.ok(star.diagnostics.some((item) => item.code === "VEL2029"
    && item.message.includes("export {name, other as alias} from")), JSON.stringify(star.diagnostics));

  const empty = compile(`export {} from "./library.vel"\n`);
  assert.ok(empty.diagnostics.some((item) => item.code === "VEL2029" && /at least one export/u.test(item.message)),
    JSON.stringify(empty.diagnostics));

  const duplicate = compile(`export const value = 1\nexport {value} from "./library.vel"\n`);
  assert.ok(duplicate.diagnostics.some((item) => item.code === "VEL3016"
    && item.message.includes("Export 'value' is declared more than once")), JSON.stringify(duplicate.diagnostics));
  const repeated = compile(`export {value} from "./a.vel"\nexport {value} from "./b.vel"\n`);
  assert.ok(repeated.diagnostics.some((item) => item.code === "VEL3016"), JSON.stringify(repeated.diagnostics));
  const aliased = compile(`export const value = 1\nexport {value as shared} from "./library.vel"\n`);
  assert.deepEqual(aliased.diagnostics, []);

  const directory = await makeTemporaryDirectory("velar-re-export-missing-");
  const libraryPath = join(directory, "library.vel");
  const barrelPath = join(directory, "barrel.vel");
  await writeFile(libraryPath, "export const present = 1\n", "utf8");
  await writeFile(barrelPath, `export {missing} from "./library.vel"\n`, "utf8");
  const project = await compileProject(barrelPath);
  assert.ok(project.failures.some((failure) => failure.message === "Module './library.vel' has no export named 'missing'"),
    JSON.stringify(project.failures));
});

test("extern default exports pin the class and constant contracts", () => {
  const source = `
type MarkdownItOptions:
    html: bool

type Highlighter:
    highlight: (code: string, language: string) -> string

extern module "markdown-it":
    export class default:
        constructor(options: MarkdownItOptions)
        def render(source: string) -> string

extern module "highlight.js/lib/common":
    export const default: Highlighter

import js MarkdownIt from "markdown-it"
import js hljs from "highlight.js/lib/common"

const renderer = MarkdownIt({html: false})

export def render(text: string) -> string: return renderer.render(text) + hljs.highlight(text, "vel")
`.trimStart();
  const result = compileCore(source);
  assert.deepEqual(result.diagnostics, []);
  // The bare import js form is the canonical default import; because the
  // source is governed by an extern module declaration, both shapes lower
  // through the presence-checked namespace bridge (W-22).
  // Charter section 12: the default name binds through a real `import` so the
  // foreign binding stays live, and the presence probe runs beside it as its
  // own statement instead of freezing the value into a `const`.
  assert.match(result.code ?? "", /^import \{ default as MarkdownIt \} from "markdown-it";$/mu);
  assert.match(result.code ?? "", /^__velarExternExport\(__velarExternModule\d+, "default", "markdown-it"\);$/mu);
  assert.match(result.code ?? "", /^import \{ default as hljs \} from "highlight\.js\/lib\/common";$/mu);
  assert.match(result.code ?? "", /^__velarExternExport\(__velarExternModule\d+, "default", "highlight\.js\/lib\/common"\);$/mu);
  assert.doesNotMatch(result.code ?? "", /const (?:MarkdownIt|hljs) = __velarExternExport\(/u);
  // The declared contracts stay checked.
  const misuse = compileCore(source.replace("renderer.render(text)", "renderer.render(1)"));
  assert.ok(misuse.diagnostics.some((item) => item.code === "VEL4001"), JSON.stringify(misuse.diagnostics));
  // The explicit spelling is equivalent and lowers to the same checked bridge.
  const explicit = compileCore(`
extern module "markdown-it":
    export const default: string

import js {default as banner} from "markdown-it"

print(banner)
`.trimStart());
  assert.deepEqual(explicit.diagnostics, []);
  assert.match(explicit.code ?? "", /^import \{ default as banner \} from "markdown-it";$/mu);
  assert.match(explicit.code ?? "", /^__velarExternExport\(__velarExternModule\d+, "default", "markdown-it"\);$/mu);
  assert.doesNotMatch(explicit.code ?? "", /const banner = __velarExternExport\(/u);
  // The formatter accepts both declaration shapes unchanged.
  assert.equal(formatSource(source), source);
});

test("a manual extern module silences the declaration probe for its source", async () => {
  const directory = await makeTemporaryDirectory("velar-extern-probe-");
  const packageRoot = join(directory, "node_modules", "manual-owned");
  await mkdir(packageRoot, { recursive: true });
  await writeFile(join(packageRoot, "package.json"), JSON.stringify({
    name: "manual-owned",
    type: "module",
    main: "index.js",
    types: "index.d.ts",
  }), "utf8");
  await writeFile(join(packageRoot, "index.js"), "export const helper = () => \"ok\";\n", "utf8");
  // This declaration file produces a probe notice: the export table names a
  // local binding that is never declared.
  await writeFile(join(packageRoot, "index.d.ts"), "export { helper };\n", "utf8");

  const declaredPath = join(directory, "declared.vel");
  await writeFile(declaredPath, `
extern module "manual-owned":
    export def helper() -> string

import js {helper} from "manual-owned"

print(helper())
`.trimStart(), "utf8");
  const declared = await compileProject(declaredPath);
  assert.deepEqual(declared.failures, []);
  assert.deepEqual(declared.modules.flatMap((module) => module.result.diagnostics), []);
  assert.deepEqual(declared.notices, []);

  // Without the manual declaration the same probe notice still surfaces.
  const undeclaredPath = join(directory, "undeclared.vel");
  await writeFile(undeclaredPath, `import js {helper} from "manual-owned"\n\nprint(helper)\n`, "utf8");
  const undeclared = await compileProject(undeclaredPath);
  assert.ok(undeclared.notices.some((notice) => notice.message.includes("manual-owned")
    && notice.message.includes("was not found and was kept as unknown")), JSON.stringify(undeclared.notices));
});

test("extern classes share one contract across modules and conflicting redeclarations are reported", async () => {
  const directory = await makeTemporaryDirectory("velar-extern-contract-");
  const libraryPath = join(directory, "library.vel");
  const mainPath = join(directory, "main.vel");
  await writeFile(libraryPath, `
extern module "node:http":
    export class IncomingMessage:
        const url: string
        pass

import js {IncomingMessage} from "node:http"

export def describe(request: IncomingMessage) -> string:
    return request.url
`.trimStart(), "utf8");

  // Each module declares its own extern block for the same source; matching
  // declarations of the same class are one nominal identity everywhere.
  await writeFile(mainPath, `
import {describe} from "./library.vel"

extern module "node:http":
    export class IncomingMessage:
        const url: string
        pass

    export def request(target: string) -> IncomingMessage

import js {IncomingMessage, request} from "node:http"

const message: IncomingMessage = request("/status")
print(describe(message))
`.trimStart(), "utf8");
  const unified = await compileProject(mainPath, new Map(), { packageTarget: "node" });
  assert.deepEqual(unified.failures, []);
  assert.deepEqual(unified.modules.flatMap((module) => module.result.diagnostics), []);

  // A redeclaration that disagrees structurally is reported at the later
  // declaration instead of silently forking the identity.
  await writeFile(mainPath, `
import {describe} from "./library.vel"

extern module "node:http":
    export class IncomingMessage:
        const url: number
        pass

    export def request(target: string) -> IncomingMessage

import js {IncomingMessage, request} from "node:http"

const message: IncomingMessage = request("/status")
print(describe(message))
`.trimStart(), "utf8");
  const conflicting = await compileProject(mainPath, new Map(), { packageTarget: "node" });
  assert.deepEqual(conflicting.failures, []);
  assert.ok((conflicting.modules.find((module) => module.inputPath === mainPath)?.result.diagnostics ?? [])
    .some((item) => item.code === "VEL4005"
      && /Extern class 'IncomingMessage' from 'node:http' is already declared with a different shape/u.test(item.message)));

  // Genuinely different identities with the same class name report both
  // declaring sources instead of an unexplained "different contract".
  await writeFile(mainPath, `
import {describe} from "./library.vel"

extern module "node:https":
    export class IncomingMessage:
        const url: string
        pass

    export def request(target: string) -> IncomingMessage

import js {IncomingMessage, request} from "node:https"

const message: IncomingMessage = request("/status")
print(describe(message))
`.trimStart(), "utf8");
  const mismatched = await compileProject(mainPath, new Map(), { packageTarget: "node" });
  assert.deepEqual(mismatched.failures, []);
  assert.ok((mismatched.modules.find((module) => module.inputPath === mainPath)?.result.diagnostics ?? [])
    .some((item) => /Cannot assign IncomingMessage to a different IncomingMessage contract \(the value is the extern class from "node:https" and the target is the extern class from "node:http"\)/u.test(item.message)));
});
