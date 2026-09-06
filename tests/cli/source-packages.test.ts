import assert from "node:assert/strict";
import test, { after } from "node:test";
import { mkdir, readFile, readdir, symlink, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { compileProject as compileProjectCore, type ProjectResult } from "../../packages/cli/src/project.ts";
import { projectDefinitionAt } from "../../packages/cli/src/project-semantic.ts";
import { moduleOutput } from "../../packages/cli/src/module-assets.ts";
import { makeTemporaryDirectory, removeTemporaryDirectories } from "../support/temporary-directory.ts";
import { executeModule } from "../support/execute-module.ts";
import { compileProject, standardModuleSource, linkWorkspaceWebExtension } from "../support/compiler-suite.ts";

after(removeTemporaryDirectories);

test("known lossy JSON inputs fail during checking", async () => {
  const directory = await makeTemporaryDirectory("velar-json-types-");
  const entry = join(directory, "main.vel");
  await writeFile(entry, `
import {http} from "velar/http"
import {database, storage} from "velar/storage"

type Tree:
    name: string
    children: List<Tree>

class Box:
    const value: number

    constructor(value: number):
        self.value = value

const tree: Tree = {name: "root", children: []}
const valid = Json.stringify(tree)
const mapping: Map<string, number> = Map()
mapping.set("value", 1)
const unique = Set([1, 2])
const callback = () => 1
const badMap = Json.stringify(mapping)
const badSet = Json.clone(unique)
const badClass = Json.stringify(Box(1))
const badFunction = Json.stringify(callback)
const badHttp = http.post("/items", {body: mapping})
storage.set("mapping", mapping)
database("cache").set("unique", unique)
`.trimStart(), "utf8");
  const project = await compileProject(entry);
  assert.deepEqual(project.failures, []);
  const messages = project.modules.flatMap((module) => module.result.diagnostics).map((item) => item.message);
  assert.equal(messages.filter((message) => message.startsWith("JSON accepts only records")).length, 4);
  assert.ok(messages.some((message) => /received Map<string, number>/u.test(message)));
  assert.ok(messages.some((message) => /received Set<number>/u.test(message)));
  assert.ok(messages.some((message) => /received Box/u.test(message)));
  assert.ok(messages.some((message) => /received \(\) -> number/u.test(message)));
  assert.ok(messages.some((message) => /HTTP JSON bodies.*received Map<string, number>/u.test(message)));
  assert.equal(messages.filter((message) => message.startsWith("Storage values accept only records")).length, 2);
  assert.ok(messages.some((message) => /Storage values.*received Map<string, number>/u.test(message)));
  assert.ok(messages.some((message) => /Storage values.*received Set<number>/u.test(message)));
});

test("velar/id uses secure host UUIDs without an insecure fallback", async () => {
  const directory = await makeTemporaryDirectory("velar-id-");
  const entry = join(directory, "main.vel");
  const output = join(directory, "dist");
  await writeFile(entry, `
import {isUuid, uuid} from "velar/id"

const first = uuid()
const second = uuid()
print(isUuid(first))
print(first != second)
print(isUuid("task-1"))
`.trimStart(), "utf8");

  const project = await compileProject(entry);
  assert.deepEqual(project.failures, []);
  assert.deepEqual(project.modules.flatMap((module) => module.result.diagnostics), []);
  const build = spawnSync(process.execPath, ["packages/cli/src/cli.ts", "build", entry, "--out-dir", output], { cwd: process.cwd(), encoding: "utf8" });
  assert.equal(build.status, 0, build.stderr);
  const execution = spawnSync(process.execPath, [join(output, "main.js")], { encoding: "utf8" });
  assert.equal(execution.status, 0, execution.stderr);
  assert.equal(execution.stdout, "true\ntrue\nfalse\n");
});

test("velar/id validates the secure host result before typing it as a UUID string", () => {
  const source = standardModuleSource("velar/id") ?? "";
  const execution = executeModule(`
let uuidMode = "invalid";
let uuidCoercions = 0;
const hostileUuidFailure = { toString() { uuidCoercions += 1; return "unsafe"; } };
const initialCrypto = { randomUUID() {
  if (uuidMode === "failure") throw hostileUuidFailure;
  if (uuidMode === "valid") return "00000000-0000-4000-8000-000000000000";
  return "not-a-uuid";
} };
Object.defineProperty(globalThis, "crypto", { configurable: true, value: initialCrypto });
${source}
try { uuid(); console.log("accepted"); } catch (error) { console.log(error.name); }
console.log(isUuid("x".repeat(100000)));
uuidMode = "failure";
try { uuid(); console.log("accepted"); } catch (error) { console.log(error.name + ":" + (error.cause === hostileUuidFailure)); }
console.log(uuidCoercions);
uuidMode = "valid";
let cryptoGetterReads = 0;
Object.defineProperty(globalThis, "crypto", { configurable: true, get() { cryptoGetterReads += 1; throw new Error("poisoned crypto"); } });
initialCrypto.randomUUID = () => { throw new Error("poisoned method"); };
Object.getOwnPropertyDescriptor = () => { throw new Error("poisoned descriptor"); };
Object.getPrototypeOf = () => { throw new Error("poisoned prototype"); };
RegExp.prototype.test = () => { throw new Error("poisoned regexp"); };
Reflect.apply = () => { throw new Error("poisoned apply"); };
Error.isError = () => false;
console.log(uuid());
console.log(isUuid("00000000-0000-4000-8000-000000000000"));
console.log(cryptoGetterReads);
`);
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, "Error\nfalse\nError:true\n0\n00000000-0000-4000-8000-000000000000\ntrue\n0\n");

  const accessorExecution = executeModule(`let uuidGetterReads = 0;
Object.defineProperty(globalThis, "crypto", { configurable: true, value: Object.defineProperty({}, "randomUUID", { get() { uuidGetterReads += 1; return () => "00000000-0000-4000-8000-000000000000"; } }) });
${source}
try { uuid(); console.log("accepted"); } catch (error) { console.log(error.name); }
console.log(uuidGetterReads);
`);
  assert.equal(accessorExecution.status, 0, String(accessorExecution.stderr));
  assert.equal(accessorExecution.stdout, "TypeError\n0\n");
});

test("0.7 Core standard library rejects invalid typed calls before runtime", async () => {
  const directory = await makeTemporaryDirectory("velar-standard-library-invalid-");
  const entry = join(directory, "main.vel");
  await writeFile(entry, `
const total = ["one", "two"].sum()
const flat = [1, 2].flatten()
const parsed = Json.parse("{}", 42)
const resolved = await Promise.all([1, 2])
const mapped = await Promise.map([1, 2], value => value, "many")
const pattern = Text.matches(42, "[0-9]+")
const options = Text.matches("42", "[0-9]+", {ignoreCase: "yes"})
`.trimStart(), "utf8");

  const project = await compileProject(entry);
  assert.deepEqual(project.failures, []);
  const messages = project.modules.flatMap((module) => module.result.diagnostics).map((item) => item.message).join("\n");
  assert.match(messages, /List\.sum requires List<number>, received List<string>/u);
  assert.match(messages, /List\.flatten removes exactly one List level, so it requires List<List<T>>, received List<number>/u);
  assert.match(messages, /Runtime parsing requires a VelarScript runtime type/u);
  assert.match(messages, /Expected a List of Promises, received List<number>/u);
  assert.match(messages, /Cannot assign string to number/u);
  assert.match(messages, /Cannot assign number to string/u);
  assert.match(messages, /Cannot assign string to bool\?/u);
});

test("npm packages publish VelarScript source through package.json velar.entry", async () => {
  const directory = await makeTemporaryDirectory("velar-source-package-");
  const packageRoot = join(directory, "node_modules", "velar-greeter");
  await linkWorkspaceWebExtension(directory);
  await mkdir(join(packageRoot, "src"), { recursive: true });
  await writeFile(join(packageRoot, "package.json"), JSON.stringify({
    name: "velar-greeter",
    version: "1.0.0",
    velar: { entry: "src/index.vel", targets: ["web"], requires: { capabilities: ["web"] } },
  }), "utf8");
  await writeFile(join(packageRoot, "src", "message.vel"), "export const greeting = \"Hello\"\n", "utf8");
  const packageEntry = join(packageRoot, "src", "index.vel");
  await writeFile(packageEntry, `
import {greeting} from "./message.vel"

export def greet(name: string) -> string:
    return f"{greeting}, {name}"
`.trimStart(), "utf8");
  const mainPath = join(directory, "main.vel");
  const mainSource = `
import {greet} from "velar-greeter"

component App:
    return <h1>{greet("Velar")}</h1>

@main:
    mount(<App />, "#app")
`.trimStart();
  await writeFile(mainPath, mainSource, "utf8");
  await writeFile(join(directory, "velar.json"), JSON.stringify({ formatVersion: 2, entry: "main.vel", extensions: ["@velarscript/web"] }), "utf8");

  const project = await compileProject(mainPath, new Map(), { projectRoot: directory });
  assert.deepEqual(project.failures, []);
  assert.deepEqual(project.modules.flatMap((module) => module.result.diagnostics), []);
  assert.equal(project.velarPackages[0]?.name, "velar-greeter");
  assert.ok(project.modules.some((module) => module.relativePath === "__velar_packages__/velar-greeter/src/index.vel"));
  assert.equal(projectDefinitionAt(project, mainPath, mainSource.indexOf("greet(\"") + 1)?.path, packageEntry);
  assert.match(moduleOutput(project, "/main.js", "7")?.body ?? "", /\/__velar_packages__\/velar-greeter\/src\/index\.js\?velar=7/u);
  assert.match(moduleOutput(project, "/__velar_packages__/velar-greeter/src/index.js", "7")?.body ?? "", /\.\/message\.js\?velar=7/u);

  const output = join(directory, "dist");
  const execution = spawnSync(process.execPath, [resolve("packages/cli/src/cli.ts"), "build", directory, "--out-dir", output], {
    cwd: process.cwd(),
    encoding: "utf8",
  });
  assert.equal(execution.status, 0, String(execution.stderr));
  const assets = await readdir(join(output, "assets"));
  const javascript = assets.find((name) => /^main-[A-Z0-9]+\.js$/u.test(name));
  assert.ok(javascript);
  assert.match(await readFile(join(output, "assets", javascript), "utf8"), /Hello/);
});

test("VelarScript source packages cannot escape their package root", async () => {
  const directory = await makeTemporaryDirectory("velar-package-boundary-");
  const packageRoot = join(directory, "node_modules", "unsafe-package");
  await mkdir(join(packageRoot, "src"), { recursive: true });
  await writeFile(join(packageRoot, "package.json"), JSON.stringify({
    name: "unsafe-package",
    velar: { entry: "src/index.vel", targets: ["web"], requires: { capabilities: ["web"] } },
  }), "utf8");
  await writeFile(join(packageRoot, "src", "index.vel"), "import {secret} from \"../../secret.vel\"\nexport const value = secret\n", "utf8");
  await writeFile(join(directory, "node_modules", "secret.vel"), "export const secret = 1\n", "utf8");
  const mainPath = join(directory, "main.vel");
  await writeFile(mainPath, "import {value} from \"unsafe-package\"\nprint(value)\n", "utf8");

  const project = await compileProject(mainPath);
  const messages = [
    ...project.failures.map((failure) => failure.message),
    ...project.modules.flatMap((module) => module.result.diagnostics.map((diagnostic) => diagnostic.message)),
  ].join("\n");
  assert.match(messages, /cannot escape VelarScript package 'unsafe-package'/u);
});

test("source package target and host requirements fail before incompatible code is compiled", async () => {
  const messages = (project: ProjectResult): string => [
    ...project.failures.map((failure) => failure.message),
    ...project.modules.flatMap((module) => module.result.diagnostics.map((diagnostic) => diagnostic.message)),
  ].join("\n");
  const directory = await makeTemporaryDirectory("velar-package-targets-");
  await linkWorkspaceWebExtension(directory);
  const coreRoot = join(directory, "node_modules", "core-fixture");
  await mkdir(join(coreRoot, "src"), { recursive: true });
  await writeFile(join(coreRoot, "package.json"), JSON.stringify({
    name: "core-fixture",
    version: "1.0.0",
    velar: { entry: "src/index.vel", targets: ["core"], requires: { capabilities: [] } },
  }), "utf8");
  await writeFile(join(coreRoot, "src", "index.vel"), "export const portable = 1\n", "utf8");
  const entry = join(directory, "main.vel");
  await writeFile(entry, 'import {portable} from "core-fixture"\n\nprint(portable)\n', "utf8");
  await writeFile(join(directory, "velar.json"), JSON.stringify({ formatVersion: 2, entry: "main.vel", extensions: ["@velarscript/web"] }), "utf8");
  const portable = await compileProject(entry, new Map(), { projectRoot: directory });
  assert.equal(messages(portable), "", "a Core package is portable to the Web target without repeating it");

  const nodeOnlyRoot = join(directory, "node_modules", "node-only-fixture");
  await mkdir(join(nodeOnlyRoot, "src"), { recursive: true });
  await writeFile(join(nodeOnlyRoot, "package.json"), JSON.stringify({
    name: "node-only-fixture",
    version: "1.0.0",
    velar: { entry: "src/index.vel", targets: ["node"], requires: { capabilities: ["node"] } },
  }), "utf8");
  await writeFile(join(nodeOnlyRoot, "src", "index.vel"), "export const value = 1\n", "utf8");
  await writeFile(entry, 'import {value} from "node-only-fixture"\n\nprint(value)\n', "utf8");
  const incompatible = await compileProject(entry, new Map(), { projectRoot: directory });
  assert.match(messages(incompatible), /node-only-fixture.*does not support the 'web' target.*node/u);

  const packageRoot = join(directory, "node_modules", "malformed-package");
  await mkdir(join(packageRoot, "src"), { recursive: true });
  await writeFile(join(packageRoot, "package.json"), JSON.stringify({
    name: "malformed-package",
    version: "1.0.0",
    velar: { entry: "src/index.vel", targets: [], requires: { capabilities: [] } },
  }), "utf8");
  await writeFile(join(packageRoot, "src", "index.vel"), "export const value = 1\n", "utf8");
  await writeFile(entry, 'import {value} from "malformed-package"\nprint(value)\n', "utf8");
  const malformed = await compileProject(entry, new Map(), { projectRoot: directory });
  assert.match(messages(malformed), /velar\.targets.*non-empty list/u);

  await writeFile(join(packageRoot, "package.json"), JSON.stringify({
    name: "malformed-package",
    version: "1.0.0",
    velar: { entry: "src/index.vel", targets: ["web"] },
  }), "utf8");
  const missingRequirements = await compileProject(entry, new Map(), { projectRoot: directory });
  assert.match(messages(missingRequirements), /velar\.requires.*must be an object/u);

  await writeFile(join(packageRoot, "package.json"), JSON.stringify({
    name: "malformed-package",
    version: "1.0.0",
    velar: { entry: "src/index.vel", targets: ["web"], requires: { capabilities: ["node"] } },
  }), "utf8");
  const missingHost = await compileProject(entry, new Map(), { projectRoot: directory });
  assert.match(messages(missingHost), /requires host capability 'node'/u);
});

test("project compilation rejects source symlinks that escape the lexical project root", async () => {
  const directory = await makeTemporaryDirectory("velar-project-source-symlink-");
  const projectRoot = join(directory, "project");
  await mkdir(projectRoot);
  const outside = join(directory, "outside.vel");
  await writeFile(outside, "export const secret = 1\n", "utf8");
  await symlink(outside, join(projectRoot, "leak.vel"));
  const mainPath = join(projectRoot, "main.vel");
  await writeFile(mainPath, "import {secret} from \"./leak.vel\"\nprint(secret)\n", "utf8");

  const project = await compileProjectCore(mainPath, new Map(), { sourceRoot: projectRoot, projectRoot });
  assert.ok(project.failures.some((failure) => failure.path === join(projectRoot, "leak.vel")
    && /cannot escape the entry source directory/u.test(failure.message)), JSON.stringify(project.failures));
  assert.ok(!project.modules.some((module) => module.inputPath === join(projectRoot, "leak.vel")));
});
