import { spawn } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { formatDiagnostic } from "@velarscript/compiler";
import type { VelarProjectConfig } from "./config.ts";
import { compileProject } from "./project.ts";
import { compiledTestModulePath, createCompiledSandbox, removeCompiledSandbox, writeCompiledTestProject } from "./test-output.ts";
import { prepareStandardModules } from "./test-runner.ts";
import { uncaughtProgramEntrySource } from "./uncaught-program-error.ts";

// velar/host owns a 30-second in-program graceful-shutdown window. The outer
// launcher must not truncate that public contract; this margin only catches a
// child that ignored the signal or failed to exit after its own deadline.
const runShutdownDeadlineMs = 35_000;

export interface RunProgramOptions {
  /** MOD-U10: prints the unfiltered Node.js stack instead of the owned frames. */
  readonly fullStack?: boolean;
}

export async function runProgram(
  config: VelarProjectConfig,
  programArguments: readonly string[],
  options: RunProgramOptions = {},
): Promise<number> {
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

  const temporary = await createCompiledSandbox(config.root, "run");
  try {
    await prepareStandardModules(temporary, config);
    await writeCompiledTestProject(project, temporary);
    // MOD-U10: the program is entered through a VelarScript-owned launcher so an
    // uncaught initialization or entry error prints as a VelarScript failure —
    // the source-mapped .vel frames without Node's module-loader frames or its
    // version banner — instead of a raw Node.js crash dump.
    const launcher = join(temporary, ".velar-run-entry.mjs");
    await writeFile(launcher, uncaughtProgramEntrySource({
      entryUrl: pathToFileURL(compiledTestModulePath(project, entry, temporary)).href,
      sourcePath: entry.inputPath.replaceAll("\\", "/"),
      fullStack: options.fullStack === true,
    }), "utf8");
    return await executeNodeProgram(launcher, programArguments);
  } finally {
    await removeCompiledSandbox(temporary);
  }
}

function executeNodeProgram(entryPath: string, programArguments: readonly string[]): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--enable-source-maps", entryPath, ...programArguments], { stdio: "inherit" });
    let forwardedSignal: "SIGINT" | "SIGTERM" | null = null;
    let shutdownDeadline: ReturnType<typeof setTimeout> | null = null;
    const cleanup = (): void => {
      process.off("SIGINT", onInterrupt);
      process.off("SIGTERM", onTerminate);
      if (shutdownDeadline) clearTimeout(shutdownDeadline);
    };
    const forward = (signal: "SIGINT" | "SIGTERM"): void => {
      if (child.exitCode !== null || child.signalCode !== null) return;
      if (forwardedSignal !== null) {
        child.kill("SIGKILL");
        return;
      }
      forwardedSignal = signal;
      child.kill(signal);
      shutdownDeadline = setTimeout(() => {
        if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
      }, runShutdownDeadlineMs);
      shutdownDeadline.unref();
    };
    const onInterrupt = (): void => forward("SIGINT");
    const onTerminate = (): void => forward("SIGTERM");
    process.on("SIGINT", onInterrupt);
    process.on("SIGTERM", onTerminate);
    child.once("error", (error) => {
      cleanup();
      reject(error);
    });
    child.once("exit", (code, signal) => {
      cleanup();
      resolve(code ?? (signal === "SIGINT" ? 130 : signal === "SIGTERM" ? 143 : 1));
    });
  });
}
