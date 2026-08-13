import { mkdir, readdir, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { pathToFileURL } from "node:url";
import { formatDiagnostic } from "@velarscript/compiler";
import type { VelarProjectConfig } from "./config.ts";
import { compileProject } from "./project.ts";
import { standardModuleSource, standardModuleSources } from "./standard-modules.ts";
import { compiledTestModulePath, createCompiledSandbox, removeCompiledSandbox, writeCompiledTestProject } from "./test-output.ts";
import { hostErrorStack } from "./host-error.ts";

export async function runTests(config: VelarProjectConfig, explicitInput: string | null): Promise<number> {
  const files = explicitInput?.endsWith(".test.vel")
    ? [config.entryPath]
    : await discoverTestFiles(config.root, new Set([config.outDir, config.publicDir]));
  if (files.length === 0) {
    process.stderr.write("No .test.vel files were found\n");
    return 1;
  }

  const temporary = await createCompiledSandbox(config.root, "test");
  let passed = 0;
  let failed = 0;
  // ASY-D2 + WEB-N5 + BLD-D1, one stance: any unowned error during a test
  // fails that test. Unowned means anything that reaches the host error
  // channel instead of the test's own await chain — a detached-task report,
  // an uncaught exception or unhandled rejection (a module whose
  // initialization touches the DOM in a headless run lands here), or any
  // other console.error the program never owned. The runner keeps running:
  // the failure belongs to the test, never to the process.
  const unowned: string[] = [];
  const hostConsole = console;
  const originalConsoleError = hostConsole.error;
  const captureConsoleError = (...values: unknown[]): void => {
    unowned.push(values.map((value) => (typeof value === "string" ? value : hostErrorStack(value))).join(" "));
    Reflect.apply(originalConsoleError, hostConsole, values);
  };
  const captureHostError = (error: unknown): void => {
    unowned.push(hostErrorStack(error));
  };
  // Two macrotask turns let reports that were already scheduled during the
  // awaited work (a settled detached rejection observes on a microtask, its
  // chained observer one turn later) land before the verdict is read.
  const drainUnowned = async (): Promise<readonly string[]> => {
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));
    return unowned.splice(0);
  };
  hostConsole.error = captureConsoleError;
  process.on("uncaughtException", captureHostError);
  process.on("unhandledRejection", captureHostError);
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
      const tests = entry?.result.moduleInterface.tests ?? [];
      if (tests.length === 0) {
        failed += 1;
        process.stderr.write(`✗ ${relative(config.root, file)} declares no tests\n`);
        continue;
      }
      const outputEntry = entry ? compiledTestModulePath(project, entry, temporary) : join(temporary, relative(config.root, file).replace(/\.vel$/u, ".js"));
      let namespace: Record<string, unknown>;
      try {
        namespace = await import(`${pathToFileURL(outputEntry).href}?run=${Date.now()}`) as Record<string, unknown>;
      } catch (error) {
        failed += tests.length;
        process.stderr.write(`✗ ${relative(config.root, file)} failed to load\n${stackOf(error)}\n`);
        await drainUnowned();
        continue;
      }
      // A module initialization error that surfaced on the host channel
      // instead of the import's own await (BLD-D1's exact shape) fails the
      // file's tests before any of them can run green.
      const loadTimeErrors = await drainUnowned();
      if (loadTimeErrors.length > 0) {
        failed += tests.length;
        process.stderr.write(`✗ ${relative(config.root, file)} reported an unowned error while loading\n${loadTimeErrors.join("\n")}\n`);
        continue;
      }
      for (const declared of tests) {
        // D39 item 53: the reporter quotes the author's name for the test.
        const name = declared.title;
        const test = namespace[declared.name];
        try {
          if (typeof test !== "function") throw new Error(`Test ${JSON.stringify(name)} was not emitted`);
          if (test.length !== 0) throw new Error(`Test ${JSON.stringify(name)} cannot declare parameters`);
          await test();
          const testErrors = await drainUnowned();
          if (testErrors.length > 0) {
            throw new Error(`an unowned error was reported while this test ran\n${testErrors.join("\n")}`);
          }
          passed += 1;
          process.stdout.write(`✓ ${relative(config.root, file)} :: ${name}\n`);
        } catch (error) {
          failed += 1;
          await drainUnowned();
          process.stderr.write(`✗ ${relative(config.root, file)} :: ${name}\n${stackOf(error)}\n`);
        }
      }
    }
    // Work a test left behind (a straggling timer, a task that outlived its
    // test) still fails the run instead of crashing it after the guards come
    // down.
    await new Promise((resolve) => setTimeout(resolve, 20));
    const trailing = await drainUnowned();
    if (trailing.length > 0) {
      failed += 1;
      process.stderr.write(`✗ an unowned error was reported after the last test\n${trailing.join("\n")}\n`);
    }
  } finally {
    hostConsole.error = originalConsoleError;
    process.off("uncaughtException", captureHostError);
    process.off("unhandledRejection", captureHostError);
    await removeCompiledSandbox(temporary);
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
        if (entry.name === "node_modules" || entry.name === ".git" || entry.name === ".velar" || excluded.has(path)) continue;
        await visit(path);
      } else if (entry.isFile() && entry.name.endsWith(".test.vel") && !entry.name.endsWith(".browser.test.vel")) {
        output.push(path);
      }
    }
  };
  await visit(root);
  return output.sort();
}

export async function prepareStandardModules(root: string, config: VelarProjectConfig): Promise<void> {
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
