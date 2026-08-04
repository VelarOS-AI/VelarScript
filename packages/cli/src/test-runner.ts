import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { pathToFileURL } from "node:url";
import { formatDiagnostic } from "@velarscript/compiler";
import type { VelarProjectConfig } from "./config.ts";
import { compileProject } from "./project.ts";
import { standardModuleSource, standardModuleSources } from "./standard-modules.ts";
import { compiledTestModulePath, writeCompiledTestProject } from "./test-output.ts";
import { hostErrorStack } from "./host-error.ts";

export async function runTests(config: VelarProjectConfig, explicitInput: string | null): Promise<number> {
  const files = explicitInput?.endsWith(".test.vel")
    ? [config.entryPath]
    : await discoverTestFiles(config.root, new Set([config.outDir, config.publicDir]));
  if (files.length === 0) {
    process.stderr.write("No .test.vel files were found\n");
    return 1;
  }

  const temporary = await mkdtemp(join(tmpdir(), "velar-tests-"));
  let passed = 0;
  let failed = 0;
  try {
    await prepareStandardModules(temporary, config);
    for (const file of files) {
      const project = await compileProject(file, new Map(), {
        sourceRoot: config.root,
        projectRoot: config.root,
        publicRoot: config.publicDir,
        extensions: config.compilerExtensions,
        extensionConfig: config.extensionConfig,
        framework: config.framework,
        exportTestFunctions: true,
      });
      const errors = [
        ...project.failures.map((failure) => `${failure.path}: ${failure.message}`),
        ...project.modules.flatMap((module) => module.result.diagnostics.map((diagnostic) => formatDiagnostic(module.result.source, diagnostic))),
      ];
      if (errors.length > 0) {
        failed += 1;
        process.stderr.write(`✗ ${relative(config.root, file)}\n${errors.join("\n\n")}\n`);
        continue;
      }

      await writeCompiledTestProject(project, temporary);

      const entry = project.modules.find((module) => module.inputPath === file);
      const tests = entry?.result.moduleInterface.testFunctions ?? [];
      if (tests.length === 0) {
        failed += 1;
        process.stderr.write(`✗ ${relative(config.root, file)} contains no test_* functions\n`);
        continue;
      }
      const outputEntry = entry ? compiledTestModulePath(project, entry, temporary) : join(temporary, relative(config.root, file).replace(/\.vel$/u, ".js"));
      let namespace: Record<string, unknown>;
      try {
        namespace = await import(`${pathToFileURL(outputEntry).href}?run=${Date.now()}`) as Record<string, unknown>;
      } catch (error) {
        failed += tests.length;
        process.stderr.write(`✗ ${relative(config.root, file)} failed to load\n${stackOf(error)}\n`);
        continue;
      }
      for (const name of tests) {
        const test = namespace[name];
        try {
          if (typeof test !== "function") throw new Error(`Test function '${name}' was not emitted`);
          if (test.length !== 0) throw new Error(`Test function '${name}' cannot declare parameters`);
          await test();
          passed += 1;
          process.stdout.write(`✓ ${relative(config.root, file)} :: ${name}\n`);
        } catch (error) {
          failed += 1;
          process.stderr.write(`✗ ${relative(config.root, file)} :: ${name}\n${stackOf(error)}\n`);
        }
      }
    }
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
  process.stdout.write(`\n${passed} passed, ${failed} failed\n`);
  return failed === 0 ? 0 : 1;
}

async function discoverTestFiles(root: string, excluded: ReadonlySet<string>): Promise<string[]> {
  const output: string[] = [];
  const visit = async (directory: string): Promise<void> => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "node_modules" || entry.name === ".git" || excluded.has(path)) continue;
        await visit(path);
      } else if (entry.isFile() && entry.name.endsWith(".test.vel") && !entry.name.endsWith(".browser.test.vel")) {
        output.push(path);
      }
    }
  };
  await visit(root);
  return output.sort();
}

async function prepareStandardModules(root: string, config: VelarProjectConfig): Promise<void> {
  const packageRoot = join(root, "node_modules", "velar");
  await mkdir(packageRoot, { recursive: true });
  const exports: Record<string, string> = {};
  for (const [source, code] of standardModuleSources(config.compilerExtensions)) {
    const name = source.slice("velar/".length);
    exports[`./${name}`] = `./${name}.js`;
    await writeFile(join(packageRoot, `${name}.js`), standardModuleSource(source, config.extensionConfig, config.compilerExtensions) ?? code, "utf8");
  }
  await writeFile(join(packageRoot, "package.json"), JSON.stringify({ name: "velar", private: true, type: "module", exports }), "utf8");
}

function stackOf(error: unknown): string {
  return hostErrorStack(error);
}
