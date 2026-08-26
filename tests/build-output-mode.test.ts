import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { resolveVelarProject } from "../packages/cli/src/config.ts";
import { verifyProductionBuild } from "../packages/cli/src/production-verifier.ts";

const cli = resolve("packages/cli/src/cli.ts");
const webPackage = resolve("packages/web");

interface Execution {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

function run(cwd: string, ...arguments_: readonly string[]): Execution {
  const result = spawnSync(process.execPath, [cli, ...arguments_], {
    cwd,
    encoding: "utf8",
    timeout: 120_000,
  });
  return { status: result.status, stdout: String(result.stdout), stderr: String(result.stderr) };
}

function execute(cwd: string, entry: string): Execution {
  const result = spawnSync(process.execPath, [entry], { cwd, encoding: "utf8", timeout: 120_000 });
  return { status: result.status, stdout: String(result.stdout), stderr: String(result.stderr) };
}

async function writeTree(root: string, files: Readonly<Record<string, string>>): Promise<void> {
  for (const [name, contents] of Object.entries(files)) {
    const path = join(root, name);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, contents, "utf8");
  }
}

async function javaScriptFiles(root: string): Promise<readonly string[]> {
  const files: string[] = [];
  const visit = async (directory: string): Promise<void> => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await visit(path);
      else if (entry.isFile() && entry.name.endsWith(".js")) files.push(path);
    }
  };
  await visit(root);
  return files.sort();
}

function count(text: string, pattern: RegExp): number {
  return [...text.matchAll(pattern)].length;
}

test("build 默认输出生产 JavaScript，并可显式生成语义等价的可读产物", async () => {
  const root = await mkdtemp(join(tmpdir(), "velar-output-mode-"));
  try {
    await writeTree(root, {
      "velar.json": `${JSON.stringify({
        formatVersion: 2,
        entry: "src/main.vel",
        outDir: "production",
        build: { mode: "production" },
      }, null, 2)}\n`,
      "src/model.vel": `
import {Counter} from "./base.vel"

export type Point:
    x: number
    y: number

export type PointSource:
    x: number
    y: number
    ignored: number

export def project(source: PointSource) -> Point: return Point.from(source)

export def classify(value: number) -> string:
    match value:
        case 0: return "zero"
        case _: return "positive"

export async def summarize(values: List<number>) -> number:
    let total = 0
    for value in values: total += value
    return total

export class DoubleCounter extends Counter:
    def bump(): self.count += 2

export def identity<T>(value: T) -> T: return value
`.trimStart(),
      "src/base.vel": `
export class Counter:
    let count: number = 0
`.trimStart(),
      "src/main.vel": `
import {Point, DoubleCounter, project, classify, summarize, identity} from "./model.vel"

@main:
    const source = {x: 2, y: 3, ignored: 99}
    const point: Point = project(source)
    const {x, ...rest} = point
    const values = [x, rest.y]
    let prefix = 0
    for value in range(4): prefix += value
    const total = await summarize(values) + prefix
    const counter = DoubleCounter()
    counter.bump()
    print(f"{classify(values[0])}:{total}:{values.size}:{counter.count}:{identity("ok")}")
`.trimStart(),
    });

    const production = run(root, "build");
    assert.equal(production.status, 0, production.stderr);
    assert.match(production.stdout, /Built production 3 modules/u);

    const readable = run(root, "build", "--out-dir", "readable", "--mode", "readable", "--source-maps");
    assert.equal(readable.status, 0, readable.stderr);
    assert.match(readable.stdout, /Built readable 3 modules/u);

    const productionRun = execute(root, join(root, "production", "main.js"));
    const readableRun = execute(root, join(root, "readable", "main.js"));
    assert.equal(productionRun.status, 0, productionRun.stderr);
    assert.equal(readableRun.status, 0, readableRun.stderr);
    assert.equal(productionRun.stdout, "positive:11:2:2:ok\n");
    assert.equal(readableRun.stdout, productionRun.stdout);

    const productionFiles = await javaScriptFiles(join(root, "production"));
    const readableFiles = await javaScriptFiles(join(root, "readable"));
    const productionText = (await Promise.all(productionFiles.map((path) => readFile(path, "utf8")))).join("\n");
    const readableText = (await Promise.all(readableFiles.map((path) => readFile(path, "utf8")))).join("\n");
    assert.ok(Buffer.byteLength(productionText) < Buffer.byteLength(readableText));
    assert.doesNotMatch(productionText, /import\s*\{\s*\}\s*from/u);
    assert.doesNotMatch(readableText, /import\s*\{\s*\}\s*from/u);
    assert.equal(count(readableText, /function __velarRecordFrom\b/gu), 1);
    assert.doesNotMatch(readableText, /range as __velarRange[, }]/u);

    assert.equal((await readdir(join(root, "production"), { recursive: true })).some((path) => path.endsWith(".map")), false);
    const sourceMap = JSON.parse(await readFile(join(root, "readable", "main.js.map"), "utf8")) as { sources?: unknown };
    assert.ok(Array.isArray(sourceMap.sources));
    assert.ok(sourceMap.sources.some((source) => typeof source === "string" && source.endsWith("main.vel")));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("项目配置可选择 readable，命令行仍可对单次构建覆盖为 production", async () => {
  const root = await mkdtemp(join(tmpdir(), "velar-output-mode-config-"));
  try {
    await writeTree(root, {
      "velar.json": `${JSON.stringify({
        formatVersion: 2,
        entry: "main.vel",
        outDir: "readable",
        build: { mode: "readable", sourceMaps: false },
      }, null, 2)}\n`,
      "main.vel": "@main:\n    const descriptiveValue = 40 + 2\n    print(descriptiveValue)\n",
    });

    assert.equal((await resolveVelarProject(root)).build.mode, "readable");
    assert.equal((await resolveVelarProject(root)).build.sourceMaps, false);
    const readable = run(root, "build");
    assert.equal(readable.status, 0, readable.stderr);
    assert.match(await readFile(join(root, "readable", "main.js"), "utf8"), /descriptiveValue/u);
    assert.equal((await readdir(join(root, "readable"), { recursive: true })).some((path) => path.endsWith(".map")), false);

    const production = run(root, "build", "--out-dir", "production", "--mode=production", "--source-maps");
    assert.equal(production.status, 0, production.stderr);
    assert.doesNotMatch(await readFile(join(root, "production", "main.js"), "utf8"), /descriptiveValue/u);
    assert.ok((await readdir(join(root, "production"), { recursive: true })).some((path) => path.endsWith(".map")));

    const invalidCli = run(root, "build", "--mode", "fast");
    assert.equal(invalidCli.status, 2);
    assert.match(invalidCli.stderr, /--mode must be production or readable/u);

    const duplicateSourceMaps = run(root, "build", "--source-maps", "--no-source-maps");
    assert.equal(duplicateSourceMaps.status, 2);
    assert.match(duplicateSourceMaps.stderr, /may be provided only once/u);

    const singleOutput = join(root, "single", "main.js");
    const mappedSingle = run(root, "build", "main.vel", "--out", singleOutput, "--source-maps");
    assert.equal(mappedSingle.status, 0, mappedSingle.stderr);
    assert.match(await readFile(singleOutput, "utf8"), /sourceMappingURL=main\.js\.map/u);
    await readFile(`${singleOutput}.map`, "utf8");
    const unmappedSingle = run(root, "build", "main.vel", "--out", singleOutput, "--no-source-maps");
    assert.equal(unmappedSingle.status, 0, unmappedSingle.stderr);
    assert.doesNotMatch(await readFile(singleOutput, "utf8"), /sourceMappingURL/u);
    await assert.rejects(readFile(`${singleOutput}.map`, "utf8"), /ENOENT/u);

    await writeFile(join(root, "velar.json"), '{"formatVersion":2,"entry":"main.vel","build":{"mode":"fast"}}\n', "utf8");
    await assert.rejects(resolveVelarProject(root), /build\.mode.*production.*readable/u);
    await writeFile(join(root, "velar.json"), '{"formatVersion":2,"entry":"main.vel","build":{"sourceMaps":"yes"}}\n', "utf8");
    await assert.rejects(resolveVelarProject(root), /build\.sourceMaps.*boolean/u);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Web 打包器遵循同一模式配置，并在构建清单中记录最终选择", async () => {
  const root = await mkdtemp(join(tmpdir(), "velar-web-output-mode-"));
  try {
    await mkdir(join(root, "node_modules", "@velarscript"), { recursive: true });
    await symlink(webPackage, join(root, "node_modules", "@velarscript", "web"), "dir");
    await writeTree(root, {
      "velar.json": `${JSON.stringify({
        formatVersion: 2,
        entry: "src/main.vel",
        outDir: "readable",
        build: { mode: "readable", sourceMaps: true },
        extensions: ["@velarscript/web"],
        web: { title: "Output mode" },
      }, null, 2)}\n`,
      "src/main.vel": `
component App:
    const descriptiveMessage = "Velar output mode"
    return <main><h1>{descriptiveMessage}</h1></main>

@main: mount(<App />, "#app")
`.trimStart(),
    });

    const readable = run(root, "build");
    assert.equal(readable.status, 0, readable.stderr);
    const readableBuild = await verifyProductionBuild(join(root, "readable"));
    assert.equal(readableBuild.manifest.mode, "readable");
    assert.equal(readableBuild.manifest.formatVersion, 4);
    const readableEntry = await readFile(join(root, "readable", readableBuild.manifest.entry), "utf8");
    assert.match(readableEntry, /descriptiveMessage/u);

    const production = run(root, "build", "--out-dir", "production", "--mode", "production");
    assert.equal(production.status, 0, production.stderr);
    const productionBuild = await verifyProductionBuild(join(root, "production"));
    assert.equal(productionBuild.manifest.mode, "production");
    const productionEntry = await readFile(join(root, "production", productionBuild.manifest.entry), "utf8");
    assert.ok(Buffer.byteLength(productionEntry) < Buffer.byteLength(readableEntry));
    assert.doesNotMatch(productionEntry, /descriptiveMessage/u);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
