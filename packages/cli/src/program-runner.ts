import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { formatDiagnostic } from "@velarscript/compiler";
import type { VelarProjectConfig } from "./config.ts";
import { compileProject } from "./project.ts";
import { compiledTestModulePath, writeCompiledTestProject } from "./test-output.ts";
import { prepareStandardModules } from "./test-runner.ts";

export async function runProgram(config: VelarProjectConfig, programArguments: readonly string[]): Promise<number> {
  const project = await compileProject(config.entryPath, new Map(), {
    sourceRoot: config.root,
    projectRoot: config.root,
    publicRoot: config.publicDir,
    extensions: config.compilerExtensions,
    extensionConfig: config.extensionConfig,
    framework: config.framework,
  });
  for (const notice of project.notices) process.stderr.write(`${notice.path}: notice: ${notice.message}\n`);
  const errors = [
    ...project.failures.map((failure) => `${failure.path}: ${failure.message}`),
    ...project.modules.flatMap((module) => module.result.diagnostics.map((diagnostic) => formatDiagnostic(module.result.source, diagnostic))),
  ];
  if (errors.length > 0) {
    process.stderr.write(`${errors.join("\n\n")}\n`);
    return 1;
  }
  const entry = project.modules.find((module) => module.inputPath === project.entryPath);
  if (!entry) {
    process.stderr.write(`velar run: the entry module ${project.entryPath} was not compiled\n`);
    return 1;
  }

  const temporary = await mkdtemp(join(tmpdir(), "velar-run-"));
  try {
    await writeFile(join(temporary, "package.json"), JSON.stringify({ name: "velar-run", private: true, type: "module" }), "utf8");
    await prepareStandardModules(temporary, config);
    await writeCompiledTestProject(project, temporary);
    return await executeNodeProgram(compiledTestModulePath(project, entry, temporary), programArguments);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

function executeNodeProgram(entryPath: string, programArguments: readonly string[]): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--enable-source-maps", entryPath, ...programArguments], { stdio: "inherit" });
    child.once("error", reject);
    child.once("exit", (code) => resolve(code ?? 1));
  });
}
