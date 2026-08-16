import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import test, { after } from "node:test";
import { moduleInterfaceIdentity } from "../packages/cli/src/project.ts";
import { VelarProjectSessions } from "../packages/cli/src/project-session.ts";
import { standardModuleClosure, standardModuleSource, standardModuleSources } from "../packages/cli/src/standard-modules.ts";
import { makeTemporaryDirectory, removeTemporaryDirectories } from "./temporary-directory.ts";

after(removeTemporaryDirectories);

const handleWithoutDispose = `
export class Handle:
    def close():
        print("released")
`.trimStart();

const handleWithSyncDispose = `
export class Handle:
    def close():
        print("released")

    @dispose:
        self.close()
`.trimStart();

const handleWithAsyncDispose = `
export class Handle:
    async def close():
        print("released")

    @dispose:
        await self.close()
`.trimStart();

function diagnostics(project: Awaited<ReturnType<VelarProjectSessions["snapshot"]>>["project"]): readonly string[] {
  return project.modules.flatMap((module) => module.result.diagnostics.map((item) => `${item.code} ${item.message}`));
}

function interfaceIdentity(
  project: Awaited<ReturnType<VelarProjectSessions["snapshot"]>>["project"],
  relativePath: string,
): string {
  const module = project.modules.find((candidate) => candidate.relativePath === relativePath);
  assert.ok(module, `${relativePath} was compiled`);
  return moduleInterfaceIdentity(module.result.moduleInterface, project.compilerExtensions);
}

async function execute(project: Awaited<ReturnType<VelarProjectSessions["snapshot"]>>["project"], root: string): Promise<string> {
  const output = join(root, "dist");
  await mkdir(output, { recursive: true });
  const standardSources = standardModuleSources(project.compilerExtensions);
  const standardRoots = new Set<string>();
  for (const module of project.modules) {
    for (const dependency of module.result.dependencies) {
      if (standardSources.has(dependency.source)) standardRoots.add(dependency.source);
    }
    for (const source of module.result.runtimeModules) {
      if (standardSources.has(source)) standardRoots.add(source);
    }
  }
  const packageRoot = join(output, "node_modules", "velar");
  await mkdir(packageRoot, { recursive: true });
  const exports: Record<string, string> = {};
  for (const source of standardModuleClosure(standardRoots, project.extensionConfig, project.compilerExtensions)) {
    const name = source.slice("velar/".length);
    exports[`./${name}`] = `./${name}.js`;
    await writeFile(
      join(packageRoot, `${name}.js`),
      standardModuleSource(source, project.extensionConfig, project.compilerExtensions) ?? "",
      "utf8",
    );
  }
  await writeFile(
    join(packageRoot, "package.json"),
    JSON.stringify({ name: "velar", private: true, type: "module", exports }),
    "utf8",
  );
  for (const module of project.modules) {
    assert.ok(module.result.code, module.relativePath);
    const path = join(output, module.relativePath.replace(/\.vel$/u, ".js"));
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, module.result.code, "utf8");
  }
  const result = spawnSync(process.execPath, [join(output, "main.js")], { encoding: "utf8", timeout: 20_000 });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout;
}

test("a changed @dispose contract changes the interface identity and recompiles its dependent", async () => {
  const root = await makeTemporaryDirectory("velar-dispose-identity-");
  const entry = join(root, "main.vel");
  const handle = join(root, "handle.vel");
  await writeFile(join(root, "velar.json"), JSON.stringify({ formatVersion: 2, entry: "main.vel", outDir: "dist" }), "utf8");
  await writeFile(entry, `
import {Handle} from "./handle.vel"

async def main():
    using owned = Handle()
    print("body")

await main()
`.trimStart(), "utf8");
  await writeFile(handle, handleWithoutDispose, "utf8");

  const sessions = new VelarProjectSessions();
  const absent = await sessions.snapshot(entry);
  assert.equal(absent.project.stats.compiledModules, 2);
  assert.deepEqual(diagnostics(absent.project), [
    "VEL4032 'using' releases a value whose type declares '@dispose'; Handle does not; declare an '@dispose:' block on the class to say how it releases itself",
  ]);
  const absentIdentity = interfaceIdentity(absent.project, "handle.vel");

  await writeFile(handle, handleWithSyncDispose, "utf8");
  const synchronous = await sessions.update(entry, new Set([handle]));
  assert.equal(synchronous.project.stats.compiledModules, 2, "the changed class and its dependent recompile");
  assert.deepEqual(diagnostics(synchronous.project), []);
  const synchronousIdentity = interfaceIdentity(synchronous.project, "handle.vel");
  assert.notEqual(synchronousIdentity, absentIdentity, "adding @dispose changes the published contract");
  assert.equal(await execute(synchronous.project, root), "body\nreleased\n");

  await writeFile(handle, handleWithAsyncDispose, "utf8");
  const asynchronous = await sessions.update(entry, new Set([handle]));
  assert.equal(asynchronous.project.stats.compiledModules, 2);
  assert.deepEqual(diagnostics(asynchronous.project), []);
  const asynchronousIdentity = interfaceIdentity(asynchronous.project, "handle.vel");
  assert.notEqual(asynchronousIdentity, synchronousIdentity, "sync and async release are different contracts");
  assert.equal(await execute(asynchronous.project, root), "body\nreleased\n");

  await writeFile(handle, handleWithoutDispose, "utf8");
  const removed = await sessions.update(entry, new Set([handle]));
  assert.equal(removed.project.stats.compiledModules, 2);
  assert.deepEqual(diagnostics(removed.project), diagnostics(absent.project));
  assert.equal(interfaceIdentity(removed.project, "handle.vel"), absentIdentity, "removing @dispose restores the old contract identity");
});
