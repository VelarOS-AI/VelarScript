import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, readdir, readFile, symlink, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import test, { after } from "node:test";
import { fileURLToPath } from "node:url";
import { makeTemporaryDirectory, removeTemporaryDirectories } from "./temporary-directory.ts";
import { moduleOutput } from "../packages/cli/src/module-assets.ts";
import type { ProjectResult } from "../packages/cli/src/project.ts";

after(removeTemporaryDirectories);

const workspaceRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const cliPath = join(workspaceRoot, "packages", "cli", "src", "cli.ts");

interface CommandResult {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

function run(command: string, arguments_: readonly string[], cwd = workspaceRoot): CommandResult {
  const result = spawnSync(command, arguments_, {
    cwd,
    encoding: "utf8",
    timeout: 120_000,
    maxBuffer: 16 * 1024 * 1024,
  });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

function runCli(cwd: string, ...arguments_: readonly string[]): CommandResult {
  return run(process.execPath, [cliPath, ...arguments_], cwd);
}

function source(lines: readonly string[]): string {
  return `${lines.join("\n")}\n`;
}

test("[D53-117] development revisions never rewrite import-looking raw JavaScript text", () => {
  const code = [
    'export const text = "import \'./literal.js\'";',
    "// import './comment.js'",
    "export const template = `import './template.js'`;",
    "",
  ].join("\n");
  const project = {
    modules: [{
      relativePath: "main.vel",
      result: { embeddedModules: [{ specifier: "./main.embedded-1.js", code, sourceMap: "{}" }] },
    }],
  } as unknown as ProjectResult;
  const output = moduleOutput(project, "main.embedded-1.js", "revision-2");
  assert.ok(output);
  assert.equal(output.body, `${code}//# sourceMappingURL=main.embedded-1.js.map\n`);
  assert.doesNotMatch(output.body, /literal\.js\?velar|comment\.js\?velar|template\.js\?velar/u);
});

async function coreProject(prefix: string, main: string): Promise<{ readonly root: string; readonly entry: string }> {
  const root = await makeTemporaryDirectory(prefix);
  await mkdir(join(root, "src"), { recursive: true });
  const entry = join(root, "src", "main.vel");
  await writeFile(join(root, "package.json"), `${JSON.stringify({ private: true, type: "module" }, null, 2)}\n`, "utf8");
  await writeFile(join(root, "velar.json"), `${JSON.stringify({ formatVersion: 2, entry: "src/main.vel" }, null, 2)}\n`, "utf8");
  await writeFile(entry, main, "utf8");
  return { root, entry };
}

async function webProject(prefix: string, main: string): Promise<{ readonly root: string; readonly entry: string; readonly output: string }> {
  const root = await makeTemporaryDirectory(prefix);
  const entry = join(root, "src", "main.vel");
  const output = join(root, "dist");
  await mkdir(join(root, "src"), { recursive: true });
  await mkdir(join(root, "node_modules", "@velarscript"), { recursive: true });
  await symlink(join(workspaceRoot, "packages", "web"), join(root, "node_modules", "@velarscript", "web"), "dir");
  await writeFile(join(root, "velar.json"), `${JSON.stringify({
    formatVersion: 2,
    entry: "src/main.vel",
    outDir: "dist",
    extensions: ["@velarscript/web"],
    web: { title: "D53 embedded source", build: { sourceMaps: true } },
  }, null, 2)}\n`, "utf8");
  await writeFile(entry, main, "utf8");
  return { root, entry, output };
}

test("[D53-117] checked captures exist at module evaluation and emit an executable mapped sibling", async () => {
  const program = source([
    "const factor = 21",
    "extern js(factor: number)`",
    'import {basename as __velarEmbeddedFactory_0} from "node:path"',
    "export const doubled = factor * 2",
    "export function scale(value) { return value * factor }",
    'export function leaf() { return __velarEmbeddedFactory_0("/tmp/leaf.txt") }',
    "`:",
    "    export const doubled: number",
    "    export def scale(value: number) -> number",
    "    export def leaf() -> string",
    "",
    "print(doubled)",
    "print(scale(3))",
    "print(leaf())",
  ]);
  const project = await coreProject("velar-d53-checked-", program);
  const output = join(project.root, "capture.js");
  const built = runCli(project.root, "build", project.entry, "--out", output);
  assert.equal(built.status, 0, built.stderr + built.stdout);

  const owner = await readFile(output, "utf8");
  const files = await readdir(project.root);
  const siblingName = files.find((name) => name.endsWith(".js") && name !== "capture.js" && owner.includes(`./${name}`));
  assert.ok(siblingName, `no embedded sibling import was emitted:\n${owner}\nfiles=${JSON.stringify(files)}`);
  assert.doesNotMatch(owner, /data:text\/javascript|dataurl:/u);

  const sibling = await readFile(join(project.root, siblingName), "utf8");
  const siblingMapText = await readFile(join(project.root, `${siblingName}.map`), "utf8");
  const siblingMap = JSON.parse(siblingMapText) as { sources?: unknown; sourcesContent?: unknown };
  assert.ok(Array.isArray(siblingMap.sources), siblingMapText);
  assert.ok(siblingMap.sources.some((item) => typeof item === "string" && item.endsWith("main.vel")), siblingMapText);
  assert.ok(siblingMap.sources.every((item) => typeof item === "string" && !/^(?:dataurl:|data:)/u.test(item)), siblingMapText);
  assert.ok(Array.isArray(siblingMap.sourcesContent)
    && siblingMap.sourcesContent.some((item) => typeof item === "string" && item.includes("export const doubled = factor * 2")), siblingMapText);
  assert.doesNotMatch(sibling, /data:text\/javascript|dataurl:|\beval\s*\(|\bnew\s+Function\s*\(/u);

  const executed = run(process.execPath, ["--enable-source-maps", output], project.root);
  assert.equal(executed.status, 0, executed.stderr);
  assert.equal(executed.stdout, "42\n63\nleaf.txt\n");

  const wrongProject = await coreProject("velar-d53-capture-type-", source([
    'const factor = "twenty-one"',
    "extern js(factor: number)`",
    "export const doubled = factor * 2",
    "`:",
    "    export const doubled: number",
    "",
    "print(doubled)",
  ]));
  const checked = runCli(wrongProject.root, "check", wrongProject.entry);
  assert.equal(checked.status, 1, checked.stdout + checked.stderr);
  assert.match(checked.stderr, /main\.vel:2:\d+/u);
  assert.match(checked.stderr, /factor/u);
  assert.match(checked.stderr, /string/u);
  assert.match(checked.stderr, /number/u);
});

test("[D53-117] unsafe exports propagate as any and raw JavaScript bytes keep dollar braces and slashes", async () => {
  const project = await coreProject("velar-d53-unsafe-", source([
    "unsafe js`",
    "const jsValue = \"JS\";",
    "export const loose = 41;",
    "export function bump(value) { return value + 1; }",
    'export const literal = "${notVelar}|{plain}|\\\\path";',
    "export const templated = String.raw`js:${jsValue}|{also}|\\tail`;",
    "`",
    "",
    "const checked: number = loose",
    "print(bump(checked))",
    "print(literal)",
    "print(templated)",
  ]));

  const executed = runCli(project.root, "run", project.entry);
  assert.equal(executed.status, 0, executed.stderr);
  assert.equal(executed.stdout, "42\n${notVelar}|{plain}|\\path\njs:JS|{also}|\\tail\n");
});

test("[D53-117] JavaScript syntax diagnostics point inside the raw block", async () => {
  const project = await coreProject("velar-d53-syntax-", source([
    "unsafe js`",
    "export const ready = 1",
    "export const broken = ;",
    "`",
    "",
    "print(ready)",
  ]));
  const checked = runCli(project.root, "check", project.entry);
  assert.equal(checked.status, 1, checked.stdout + checked.stderr);
  assert.match(checked.stderr, /JavaScript syntax error/u);
  assert.match(checked.stderr, /main\.vel:3:\d+/u);
  assert.match(checked.stderr, /export const broken = ;/u);
});

test("[D53-117] production Web output preserves CSP and chains embedded maps back to VelarScript", { timeout: 180_000 }, async () => {
  const project = await webProject("velar-d53-production-", source([
    'const prefix = "embedded"',
    "extern js(prefix: string)`",
    'export function label() { return prefix + "-D53_EMBEDDED_SENTINEL" }',
    "`:",
    "    export def label() -> string",
    "",
    "component App:",
    "    return <main>{label()}</main>",
    "",
    'mount(<App />, "#app")',
  ]));

  const built = runCli(project.root, "build", project.root, "--out-dir", project.output);
  assert.equal(built.status, 0, built.stderr + built.stdout);

  const html = await readFile(join(project.output, "index.html"), "utf8");
  assert.match(html, /Content-Security-Policy/u);
  assert.match(html, /script-src 'self'/u);
  assert.doesNotMatch(html, /script-src[^;"]*'unsafe-(?:eval|inline)'/u);

  const assetNames = await readdir(join(project.output, "assets"));
  const scriptNames = assetNames.filter((name) => name.endsWith(".js"));
  const mapNames = assetNames.filter((name) => name.endsWith(".js.map"));
  assert.ok(scriptNames.length > 0, JSON.stringify(assetNames));
  assert.ok(mapNames.length > 0, JSON.stringify(assetNames));

  let foundEmbeddedResult = false;
  for (const name of scriptNames) {
    const javascript = await readFile(join(project.output, "assets", name), "utf8");
    if (javascript.includes("D53_EMBEDDED_SENTINEL")) foundEmbeddedResult = true;
    assert.doesNotMatch(javascript, /data:text\/javascript|dataurl:|\beval\s*\(|\bnew\s+Function\s*\(/u, name);
    assert.doesNotMatch(javascript, /(?:createElement|createElementNS)\([^)]*["']script["']|<script\b/u, name);
  }
  assert.equal(foundEmbeddedResult, true, "the embedded JavaScript result was tree-shaken out of every production script");

  let foundVelarSource = false;
  let foundEmbeddedMapContent = false;
  for (const name of mapNames) {
    const text = await readFile(join(project.output, "assets", name), "utf8");
    assert.doesNotMatch(text, /dataurl:|data:text\/javascript/u, name);
    const map = JSON.parse(text) as { sources?: unknown; sourcesContent?: unknown };
    assert.ok(Array.isArray(map.sources), `${name}: ${text}`);
    if (map.sources.some((item) => typeof item === "string" && item.endsWith("main.vel"))) foundVelarSource = true;
    if (Array.isArray(map.sourcesContent)
      && map.sourcesContent.some((item) => typeof item === "string" && item.includes('export function label() { return prefix + "-D53_EMBEDDED_SENTINEL" }'))) {
      foundEmbeddedMapContent = true;
    }
  }
  assert.equal(foundVelarSource, true, "no final production source map points to main.vel");
  assert.equal(foundEmbeddedMapContent, true, "the final source-map chain lost the embedded block's VelarScript source content");

  const manifest = JSON.parse(await readFile(join(project.output, "velar-build.json"), "utf8")) as { sourceMaps?: unknown };
  assert.equal(manifest.sourceMaps, true);
});

test("[D53-117] velar fix rewrites an equivalent data module once and preserves execution", async () => {
  const dataModule = "data:text/javascript,export function answer(){return 42}";
  const project = await coreProject("velar-d53-fix-", source([
    `import js unsafe {answer} from "${dataModule}"`,
    "print(answer())",
  ]));

  // Once the migration diagnostic exists, the retired VelarScript source is
  // intentionally not runnable. Execute its exact ESM module as the before
  // oracle, then compare the fixed VelarScript program byte-for-byte on stdout.
  const before = run(process.execPath, [
    "--input-type=module",
    "--eval",
    `import {answer} from ${JSON.stringify(dataModule)}; console.log(answer());`,
  ], project.root);
  assert.equal(before.status, 0, before.stderr);
  assert.equal(before.stdout, "42\n");

  const fixed = runCli(project.root, "fix", project.root);
  assert.equal(fixed.status, 0, fixed.stderr + fixed.stdout);
  assert.match(fixed.stdout, /fixed VEL\d+:/u);
  const rewritten = await readFile(project.entry, "utf8");
  assert.doesNotMatch(rewritten, /data:text\/javascript|import js unsafe/u);
  assert.match(rewritten, /unsafe js`/u);
  assert.match(rewritten, /export function answer\(\)\s*\{\s*return 42\s*\}/u);

  const after = runCli(project.root, "run", project.entry);
  assert.equal(after.status, 0, after.stderr);
  assert.equal(after.stdout, before.stdout);

  const again = runCli(project.root, "fix", project.root);
  assert.equal(again.status, 0, again.stderr + again.stdout);
  assert.match(again.stdout, /applied 0 mechanical fixes/u);
  assert.equal(await readFile(project.entry, "utf8"), rewritten);
  const repeated = runCli(project.root, "run", project.entry);
  assert.equal(repeated.status, 0, repeated.stderr);
  assert.equal(repeated.stdout, before.stdout);
});
