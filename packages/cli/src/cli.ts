#!/usr/bin/env node

import { copyFile, lstat, mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { basename, dirname, extname, isAbsolute, join, parse as parsePath, relative, resolve } from "node:path";
import { homedir, tmpdir } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { CompileResult, CompilerExtension } from "@velarscript/compiler";
import { createVelarProject, parseCreateArguments } from "create-velar";
import { projectImportKey, type ProjectModule, type ProjectResult } from "./project.ts";
import { checkResolvedProject, discoverVelarSources, formatCheckOutput } from "./project-check.ts";
import { reproductionHint, writeReproduction } from "./reproduction.ts";
import { runDevServer } from "./dev-server.ts";
import {
  nodeApplicationConfig,
  nodeApplicationEntry,
  type NodeApplicationConfig,
  runNodeApplication,
  runNodeDevelopment,
} from "./node-application.ts";
import { createFrameworkArtifacts } from "./framework-host.ts";
import { migrateVelarProjectManifest, resolveVelarProject, type VelarProjectConfig } from "./config.ts";
import { standardModuleClosure, standardModuleSource, standardModuleSources } from "./standard-modules.ts";
import { runTests } from "./test-runner.ts";
import { runProgram } from "./program-runner.ts";
import type { BrowserEngineSelection } from "./browser-test-runner.ts";
import { buildProductionFramework, PRODUCTION_MANIFEST_NAME, writeProductionManifest } from "./production-build.ts";
import { formatSourceChecked } from "./format-guard.ts";
import { VELAR_VERSION } from "./version.ts";
import { formatSurfaceVersions } from "./surface-versions.ts";
import { assertRequiredPublicAssets, copyPublicAssets, writeStaticDeployment } from "./static-deployment.ts";
import { verifyProductionBuild } from "./production-verifier.ts";
import { runProductionPreview } from "./preview-server.ts";
import { createDeploymentVerificationReport, verifyRemoteDeployment } from "./deployment-verifier.ts";
import { readVelarSourceFile } from "./source-limits.ts";
import { parseDependencyArguments, runDependencyCommand, type DependencyAction } from "./package-manager.ts";
import { hostErrorMessage, isHostErrorCode, isMissingHostModule } from "./host-error.ts";
import { loadApplicationPackageHost, validateApplicationPackageResult } from "./application-package-host.ts";
import { buildLanguageServerTool } from "./language-server-tool.ts";
import { applyProjectMechanicalFixes } from "./mechanical-fixer.ts";
import { bundleStandaloneJavaScript, needsStandaloneJavaScriptBundle } from "./standalone-build.ts";
import { BUILD_STAGING_MARKER } from "./build-staging.ts";
import { writeServerConfigurationDependency, writeWebSocketDependency } from "./node-runtime-dependencies.ts";
import {
  assertUniqueEmbeddedModuleOutputs,
  embeddedModuleFileContents,
  embeddedModuleOutputPath,
  VELAR_EMBEDDED_MODULE_MARKER,
} from "./embedded-modules.ts";
import { resourceOutputRelativePath, writeBuildResourcePackageManifests, writeProjectResources } from "./resource-output.ts";
import { resolveVelarLibraryBuild, writeVelarLibraryArtifact } from "./library-artifact-build.ts";
import { renderJavaScriptOutput, type JavaScriptBuildMode } from "./javascript-output.ts";
import { NODE_BUILD_MANIFEST_NAME, writeNodeProductionManifest } from "./node-production-build.ts";
import { verifyApplicationBuild } from "./application-verifier.ts";
import { VelarProjectSessions } from "./project-session.ts";
import { buildOwnershipGraph } from "./ownership-graph.ts";
import { createProjectLogicGraph, renderProjectLogicGraph } from "./logic-graph-output.ts";


interface CommandArguments {
  readonly input: string | null;
  readonly output: string | null;
  readonly outputDirectory: string | null;
  readonly force: boolean;
  /** 仅 `build` 接受；null 表示读取项目配置。 */
  readonly mode: JavaScriptBuildMode | null;
  /** 仅 `build` 接受；null 表示读取独立的 build.sourceMaps 配置。 */
  readonly sourceMaps: boolean | null;
}

interface BuildLibraryArguments {
  readonly input: string | null;
  readonly mode: JavaScriptBuildMode | null;
}

// esbuild 转换和文件写入都可并行，但无界 Promise.all 会让大型项目同时保留
// 全部模块源码、映射和压缩结果。固定四个 worker 在吞吐与峰值内存之间给出
// 稳定上界；输出路径彼此独立，完成顺序不影响产物。
const BUILD_OUTPUT_CONCURRENCY = 4;

async function mapBuildOutputs<T>(items: readonly T[], operation: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  let failure: unknown = null;
  const worker = async (): Promise<void> => {
    while (failure === null) {
      const index = next;
      if (index >= items.length) return;
      next += 1;
      try {
        await operation(items[index]!);
      } catch (error) {
        failure = error;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(BUILD_OUTPUT_CONCURRENCY, items.length) }, worker));
  if (failure !== null) throw failure;
}

interface FormatArguments {
  readonly input: string | null;
  readonly check: boolean;
}

interface DevArguments {
  readonly input: string | null;
  readonly port: number | null;
}

interface ServeArguments {
  readonly input: string | null;
}

interface TestArguments {
  readonly input: string | null;
  readonly browser: BrowserEngineSelection | null;
}

interface PreviewArguments {
  readonly input: string | null;
  readonly port: number;
}

interface RunArguments {
  readonly input: string | null;
  readonly programArguments: readonly string[];
  readonly fullStack: boolean;
}

interface ReproArguments {
  readonly input: string | null;
  readonly outputDirectory: string | null;
}

interface DeploymentVerificationArguments {
  readonly input: string | null;
  readonly url: string | null;
  readonly json: boolean;
}

interface GraphArguments {
  readonly input: string | null;
  readonly json: boolean;
  readonly focus: string | null;
  readonly depth: number;
  readonly maximumNodes: number;
  readonly maximumEdges: number;
}

async function main(arguments_: readonly string[]): Promise<number> {
  const [command, ...rest] = arguments_;

  if (!command || command === "--help" || command === "-h") {
    if (rest.length > 0) {
      process.stderr.write("velar help: unexpected arguments after the top-level help option\n");
      return 2;
    }
    printHelp();
    return 0;
  }

  if (command === "help") {
    if (rest.length === 0) {
      printHelp();
      return 0;
    }
    if (rest.length !== 1 || !commandNames.has(rest[0]!)) {
      process.stderr.write(`velar help: unknown command '${rest[0] ?? ""}'\n`);
      return 2;
    }
    printCommandHelp(rest[0]!);
    return 0;
  }

  if (command === "--version" || command === "-v") {
    if (rest.length > 0) {
      process.stderr.write("velar --version: this option does not accept arguments\n");
      return 2;
    }
    // D110 rule 6: the release number, then the five surfaces it ships. The
    // first line is what you installed; the second is what an upgrade actually
    // asks you to re-read, which the release number alone cannot say.
    process.stdout.write(`velar ${VELAR_VERSION}\n  ${await formatSurfaceVersions()}\n`);
    return 0;
  }

  if (commandNames.has(command) && helpRequested(command, rest)) {
    printCommandHelp(command);
    return 0;
  }

  if (command === "lsp") {
    if (rest.length > 0) {
      process.stderr.write("velar lsp: this command does not accept arguments\n");
      return 2;
    }
    const temporary = await mkdtemp(join(tmpdir(), "velar-language-server-"));
    const tool = join(temporary, "language-server.mjs");
    try {
      await buildLanguageServerTool(tool);
      await import(pathToFileURL(tool).href);
    } finally {
      await rm(temporary, { recursive: true, force: true });
    }
    return 0;
  }

  if (command === "skill") {
    const kind = rest[0] ?? "core";
    const files: Readonly<Record<string, string>> = Object.freeze({
      core: "ai-skill.md",
      web: "ai-skill-web.md",
      node: "ai-skill-node.md",
      server: "ai-skill-server.md",
      desktop: "ai-skill-desktop.md",
    });
    if (rest.length > 1 || files[kind] === undefined) {
      process.stderr.write("velar skill: expected core, web, node, server, or desktop\n");
      return 2;
    }
    process.stdout.write(await readFile(new URL(`../skill/${files[kind]}`, import.meta.url), "utf8"));
    return 0;
  }

  if (command === "graph") {
    const parsed = parseGraphArguments(rest);
    if (typeof parsed === "string") {
      process.stderr.write(`velar graph: ${parsed}\n`);
      return 2;
    }
    try {
      const config = await resolveVelarProject(parsed.input);
      const documentPath = parsed.input?.endsWith(".vel") ? resolve(parsed.input) : config.entryPath;
      const snapshot = await new VelarProjectSessions().snapshot(documentPath);
      const graph = await buildOwnershipGraph(snapshot.project, {
        maximumNodes: MAXIMUM_GRAPH_SOURCE_NODES,
        maximumEdges: MAXIMUM_GRAPH_SOURCE_EDGES,
      });
      const diagnostics = snapshot.project.failures.length
        + snapshot.project.modules.reduce((count, module) => count + module.result.diagnostics.length, 0);
      const view = createProjectLogicGraph(graph, snapshot.config.root, {
        ...(parsed.focus ? { focus: parsed.focus } : {}),
        depth: parsed.depth,
        maximumNodes: parsed.maximumNodes,
        maximumEdges: parsed.maximumEdges,
        diagnostics,
      });
      process.stdout.write(parsed.json ? `${JSON.stringify(view, null, 2)}\n` : renderProjectLogicGraph(view));
      return 0;
    } catch (error) {
      process.stderr.write(`velar graph: ${hostErrorMessage(error)}\n`);
      return 1;
    }
  }

  if (command === "create") {
    const parsed = parseCreateArguments(rest);
    if (typeof parsed === "string") {
      process.stderr.write(`velar create: ${parsed}\n`);
      return 2;
    }
    try {
      const result = await createVelarProject(parsed.directory, { template: parsed.template });
      process.stdout.write(`Created VelarScript ${result.template} project -> ${result.root}\n`);
      return 0;
    } catch (error) {
      process.stderr.write(`velar create: ${hostErrorMessage(error)}\n`);
      return 1;
    }
  }

  if (command === "install" || command === "add" || command === "remove" || command === "update") {
    const parsed = parseDependencyArguments(command, rest);
    if (typeof parsed === "string") {
      process.stderr.write(`velar ${command}: ${parsed}\n`);
      return 2;
    }
    try {
      const result = await runDependencyCommand(command, parsed);
      process.stdout.write(dependencyResultMessage(command, result.root, result.packages, result.activatedExtensions, result.removedExtensions));
      return 0;
    } catch (error) {
      process.stderr.write(`velar ${command}: ${hostErrorMessage(error)}\n`);
      return 1;
    }
  }

  if (command === "verify") {
    const input = parseSingleOptionalInput(rest);
    if (input !== null && typeof input === "object") {
      process.stderr.write(`velar verify: ${input.error}\n`);
      return 2;
    }
    try {
      const verified = await verifyApplicationBuild(input);
      if (verified.kind === "framework") {
        // 保留既有 Web CLI 的成功输出契约；统一分派只扩展可校验的产物类型，
        // 不应让依赖这段稳定文本的脚本因为内部重构而失效。
        process.stdout.write(`Verified production ${verified.build.manifest.framework.capability} build ${verified.build.manifest.buildId} -> ${verified.build.directory}\n`);
      } else {
        process.stdout.write(`Verified node build ${verified.build.manifest.buildId} -> ${verified.build.directory}\n`);
      }
      return 0;
    } catch (error) {
      process.stderr.write(`velar verify: ${hostErrorMessage(error)}\n`);
      return 1;
    }
  }

  if (command === "preview") {
    const parsed = parsePreviewArguments(rest);
    if (typeof parsed === "string") {
      process.stderr.write(`velar preview: ${parsed}\n`);
      return 2;
    }
    try {
      const verified = await verifyProductionBuild(parsed.input);
      await runProductionPreview(verified, parsed.port);
      return 0;
    } catch (error) {
      process.stderr.write(`velar preview: ${hostErrorMessage(error)}\n`);
      return 1;
    }
  }

  if (command === "verify-deployment") {
    const parsed = parseDeploymentVerificationArguments(rest);
    if (typeof parsed === "string") {
      process.stderr.write(`velar verify-deployment: ${parsed}\n`);
      return 2;
    }
    const url = parsed.url ?? process.env.VELAR_DEPLOYMENT_URL?.trim() ?? "";
    if (!url) {
      process.stderr.write("velar verify-deployment: provide --url <deployment-origin> or VELAR_DEPLOYMENT_URL\n");
      return 2;
    }
    try {
      const verified = await verifyProductionBuild(parsed.input);
      const deployment = await verifyRemoteDeployment(verified, url);
      if (parsed.json) {
        process.stdout.write(`${JSON.stringify(createDeploymentVerificationReport(verified, deployment), null, 2)}\n`);
      } else {
        process.stdout.write(
          `Verified deployed ${verified.manifest.framework.capability} build ${deployment.buildId} at ${deployment.url} `
          + `(${deployment.checkedFiles} files, ${deployment.checkedRoutes} routes, ${deployment.checkedHeaders} headers)\n`,
        );
      }
      return 0;
    } catch (error) {
      process.stderr.write(`velar verify-deployment: ${hostErrorMessage(error)}\n`);
      return 1;
    }
  }

  if (command === "run") {
    const parsed = parseRunArguments(rest);
    if (typeof parsed === "string") {
      process.stderr.write(`velar run: ${parsed}\n`);
      return 2;
    }
    let projectConfig: VelarProjectConfig;
    try {
      projectConfig = await resolveVelarProject(parsed.input);
    } catch (error) {
      process.stderr.write(`velar run: ${hostErrorMessage(error)}\n`);
      return 1;
    }
    if (projectConfig.framework) {
      process.stderr.write(`velar run: this project enables the '${projectConfig.framework.host.id}' application framework; use 'velar dev' or 'velar build' instead\n`);
      return 1;
    }
    try {
      return await runProgram(projectConfig, parsed.programArguments, { fullStack: parsed.fullStack });
    } catch (error) {
      process.stderr.write(`velar run: ${hostErrorMessage(error)}\n`);
      return 1;
    }
  }

  if (command === "fix") {
    const input = parseSingleOptionalInput(rest);
    if (input !== null && typeof input === "object") {
      process.stderr.write(`velar fix: ${input.error}\n`);
      return 2;
    }
    // The manifest is migrated first, because a retired manifest shape is what
    // fails the project resolution below: the source fixer never gets to run
    // while `velar.json` still names a field this compiler removed.
    const manifestChanges: string[] = [];
    try {
      const migration = await migrateVelarProjectManifest(input);
      if (migration) manifestChanges.push(...migration.changes.map((change) => `${displayPath(migration.manifestPath)} ${change}`));
    } catch (error) {
      process.stderr.write(`velar fix: ${hostErrorMessage(error)}\n`);
      return 1;
    }
    let fixConfig: VelarProjectConfig;
    try {
      fixConfig = await resolveVelarProject(input);
    } catch (error) {
      for (const change of manifestChanges) process.stdout.write(`${change}\n`);
      process.stderr.write(`velar fix: ${hostErrorMessage(error)}\n`);
      return 1;
    }
    let report;
    try {
      report = await applyProjectMechanicalFixes(fixConfig, input, displayPath);
    } catch (error) {
      for (const change of manifestChanges) process.stdout.write(`${change}\n`);
      process.stderr.write(`velar fix: ${hostErrorMessage(error)}\n`);
      return 1;
    }
    for (const change of manifestChanges) process.stdout.write(`${change}\n`);
    for (const change of report.changes) process.stdout.write(`${change}\n`);
    if (report.remainingDiagnostics.length > 0) process.stderr.write(`${report.remainingDiagnostics.join("\n\n")}\n`);
    // D51 item NEW-D8: a write that failed is named, and the summary that says
    // what did change is printed either way — a rewritten tree is never left
    // unreported.
    for (const failure of report.writeFailures) process.stderr.write(`velar fix: could not write ${failure}\n`);
    // The manifest counts as one changed file and each of its migrations as one
    // fix, so the summary reports the whole rewritten tree rather than only its
    // `.vel` half.
    const files = report.changedFiles.length + (manifestChanges.length > 0 ? 1 : 0);
    const applied = report.changes.length + manifestChanges.length;
    process.stdout.write(
      `applied ${applied} mechanical fix${applied === 1 ? "" : "es"}`
      + `${files > 0 ? ` in ${files} file${files === 1 ? "" : "s"}` : ""}`
      + `${report.writeFailures.length > 0 ? `; ${report.writeFailures.length} file${report.writeFailures.length === 1 ? "" : "s"} could not be written` : ""}`
      + `; ${report.remainingDiagnostics.length} diagnostic${report.remainingDiagnostics.length === 1 ? " remains" : "s remain"}\n`,
    );
    return report.remainingDiagnostics.length > 0 || report.writeFailures.length > 0 ? 1 : 0;
  }

  if (command === "repro") {
    const parsed = parseReproArguments(rest);
    if (typeof parsed === "string") {
      process.stderr.write(`velar repro: ${parsed}\n`);
      return 2;
    }
    let reproConfig: VelarProjectConfig;
    try {
      reproConfig = await resolveVelarProject(parsed.input);
    } catch (error) {
      process.stderr.write(`velar repro: ${hostErrorMessage(error)}\n`);
      return 1;
    }
    try {
      const checked = await checkResolvedProject(reproConfig, parsed.input);
      if (checked.errors.length === 0) {
        process.stderr.write(`velar repro: ${displayInput(parsed.input, reproConfig)} checks without errors; there is no failure to reproduce\n`);
        return 1;
      }
      const reproduction = await writeReproduction({
        config: reproConfig,
        input: parsed.input,
        checked,
        outputDirectory: parsed.outputDirectory,
        toolchainEntry: fileURLToPath(import.meta.url),
      });
      process.stdout.write(`Wrote a minimal reproduction of ${checked.errors.length} diagnostic${checked.errors.length === 1 ? "" : "s"} -> ${reproduction.directory}\n`);
      // Discipline 3: the bundle was re-checked in an extracted copy, and a
      // bundle that stopped reproducing says so instead of being handed over
      // as a clean report.
      process.stdout.write(reproduction.reproduced
        ? "The extracted bundle produces the same diagnostics.\n"
        : "Reproduces on this machine but not in the extracted bundle; the README says what the copy reported instead.\n");
      return 0;
    } catch (error) {
      process.stderr.write(`velar repro: ${hostErrorMessage(error)}\n`);
      return 1;
    }
  }

  if (command === "build-library") {
    const parsed = parseBuildLibraryArguments(rest);
    if (typeof parsed === "string") {
      process.stderr.write(`velar build-library: ${parsed}\n`);
      return 2;
    }
    let staging: string | null = null;
    try {
      const config = await resolveVelarProject(parsed.input);
      const library = await resolveVelarLibraryBuild(config);
      const checked = await checkResolvedProject(library.project, parsed.input ?? library.project.root);
      process.stderr.write(formatCheckOutput(checked));
      if (checked.errors.length > 0) return 1;
      staging = await prepareBuildStaging(library.outputRoot, { declared: true, forced: false });
      await writeVelarLibraryArtifact(library, checked.project, staging, parsed.mode ?? config.build.mode);
      await replaceOutputDirectory(staging, library.outputRoot);
      staging = null;
      process.stdout.write(`Built Velar library ABI 1 ${library.packageName}@${library.packageVersion} (${library.target}) -> ${library.receiptPath}\n`);
      return 0;
    } catch (error) {
      if (staging !== null) await rm(staging, { recursive: true, force: true });
      process.stderr.write(`velar build-library: ${hostErrorMessage(error)}\n`);
      return 1;
    }
  }

  if (command !== "check" && command !== "build" && command !== "package" && command !== "format" && command !== "dev" && command !== "serve" && command !== "test") {
    process.stderr.write(`Unknown command '${command}'.\n\n`);
    printHelp(process.stderr);
    return 2;
  }

  if (command === "format") {
    const parsed = parseFormatArguments(rest);
    if (typeof parsed === "string") {
      process.stderr.write(`velar format: ${parsed}\n`);
      return 2;
    }
    const singleFile = parsed.input !== null && extname(resolve(parsed.input)) === ".vel";
    let inputs: string[];
    let formattingExtensions: readonly CompilerExtension[] = [];
    try {
      if (singleFile) {
        inputs = [resolve(parsed.input!)];
        const config = await resolveVelarProject(parsed.input);
        formattingExtensions = config.compilerExtensions;
      } else {
        const config = await resolveVelarProject(parsed.input);
        inputs = await discoverVelarSources(config);
        formattingExtensions = config.compilerExtensions;
      }
    } catch (error) {
      process.stderr.write(`velar format: ${hostErrorMessage(error)}\n`);
      return 1;
    }
    if (inputs.length === 0) {
      process.stderr.write("velar format: no .vel source files were found\n");
      return 1;
    }
    const changed: string[] = [];
    const unstable: string[] = [];
    try {
      for (const input of inputs) {
        const source = await readVelarSourceFile(input);
        const { text: formatted, stable } = formatSourceChecked(source, { extensions: formattingExtensions });
        // Formatting is idempotent by contract. A result the formatter would
        // change again is a formatter defect, and writing it would replace a
        // module that compiles with one that may not, so the file keeps the
        // bytes the author wrote and the command reports the defect.
        if (!stable) {
          unstable.push(input);
          continue;
        }
        if (formatted === source) continue;
        changed.push(input);
        if (!parsed.check) await writeFile(input, formatted, "utf8");
      }
    } catch (error) {
      process.stderr.write(`velar format: ${hostErrorMessage(error)}\n`);
      return 1;
    }
    if (unstable.length > 0) {
      for (const input of unstable) {
        process.stderr.write(`velar format: ${displayPath(input)}: the formatter did not reach a fixed point; the file was left unchanged\n`);
      }
      return 1;
    }
    if (parsed.check && changed.length > 0) {
      for (const input of changed) process.stderr.write(`${displayPath(input)} is not formatted\n`);
      process.stderr.write(`${changed.length} of ${inputs.length} VelarScript source file${inputs.length === 1 ? "" : "s"} require formatting\n`);
      return 1;
    }
    if (singleFile) {
      process.stdout.write(parsed.check ? `${parsed.input} is formatted\n` : `Formatted ${parsed.input}\n`);
    } else if (parsed.check) {
      process.stdout.write(`Checked formatting of ${inputs.length} VelarScript source file${inputs.length === 1 ? "" : "s"}\n`);
    } else {
      process.stdout.write(`Formatted ${changed.length} of ${inputs.length} VelarScript source file${inputs.length === 1 ? "" : "s"}\n`);
    }
    return 0;
  }

  if (command === "dev") {
    const parsed = parseDevArguments(rest);
    if (typeof parsed === "string") {
      process.stderr.write(`velar dev: ${parsed}\n`);
      return 2;
    }
    let projectConfig: VelarProjectConfig;
    try {
      projectConfig = await resolveVelarProject(parsed.input);
      if (projectConfig.framework) await runDevServer(projectConfig, parsed.port ?? 5173);
      else if (nodeApplicationConfig(projectConfig)) {
        if (parsed.port !== null) throw new Error("Node application host and port belong to velar/server configuration; --port is available only to Web and Desktop development servers");
        await runNodeDevelopment(projectConfig);
      }
      else throw new Error("the project does not declare a Web, Desktop, or Node application target");
    } catch (error) {
      process.stderr.write(`velar dev: ${hostErrorMessage(error)}\n`);
      return 1;
    }
    return 0;
  }

  if (command === "serve") {
    const parsed = parseServeArguments(rest);
    if (typeof parsed === "string") {
      process.stderr.write(`velar serve: ${parsed}\n`);
      return 2;
    }
    try {
      const projectConfig = await resolveVelarProject(parsed.input);
      return await runNodeApplication(projectConfig);
    } catch (error) {
      process.stderr.write(`velar serve: ${hostErrorMessage(error)}\n`);
      return 1;
    }
  }

  if (command === "test") {
    const parsed = parseTestArguments(rest);
    if (typeof parsed === "string") {
      process.stderr.write(`velar test: ${parsed}\n`);
      return 2;
    }
    if (!parsed.browser && parsed.input?.endsWith(".browser.test.vel")) {
      process.stderr.write("velar test: .browser.test.vel files require --browser\n");
      return 2;
    }
    if (parsed.browser && parsed.input?.endsWith(".test.vel") && !parsed.input.endsWith(".browser.test.vel")) {
      process.stderr.write("velar test: --browser accepts a project or .browser.test.vel file\n");
      return 2;
    }
    let projectConfig: VelarProjectConfig;
    try {
      projectConfig = await resolveVelarProject(parsed.input);
      if (parsed.browser && parsed.input?.endsWith(".browser.test.vel") && projectConfig.manifestPath) {
        projectConfig = await resolveVelarProject(projectConfig.root);
      }
    } catch (error) {
      process.stderr.write(`velar test: ${hostErrorMessage(error)}\n`);
      return 1;
    }
    if (parsed.browser) {
      // D111 rule 6: Playwright is an optional peer, so a project that never
      // declared it reaches here with nothing to load. That is a missing
      // install rather than a crash, and it is told the same way the engine
      // download below it is: name the command that fixes it.
      let runBrowserTests;
      try {
        ({ runBrowserTests } = await import("./browser-test-runner.ts"));
      } catch (error) {
        if (!isMissingHostModule(error, "playwright")) throw error;
        process.stderr.write("velar test: --browser drives real browsers through Playwright, which this project does not install.\nInstall it with: npm install --save-dev playwright\n");
        return 1;
      }
      return runBrowserTests(projectConfig, parsed.input, parsed.browser);
    }
    return runTests(projectConfig, parsed.input);
  }

  const parsed = command === "package" ? parsePackageArguments(rest) : parseCommandArguments(rest, command === "build");
  if (typeof parsed === "string") {
    process.stderr.write(`velar ${command}: ${parsed}\n`);
    return 2;
  }

  let projectConfig: VelarProjectConfig;
  try {
    projectConfig = await resolveVelarProject(parsed.input);
  } catch (error) {
    process.stderr.write(`velar ${command}: ${hostErrorMessage(error)}\n`);
    return 1;
  }

  // `check` 不会写出 JavaScript，生产构建也可能明确关闭映射。把这一事实传到
  // 编译器入口，避免先完整生成 Source Map，最后才在输出阶段丢弃它。
  const requestedSourceMaps = command === "check"
    ? false
    : command === "package"
      ? projectConfig.build.sourceMaps
      : parsed.sourceMaps ?? projectConfig.build.sourceMaps;
  const checked = await checkResolvedProject(projectConfig, parsed.input, { emitSourceMaps: requestedSourceMaps });
  const project = checked.project;
  process.stderr.write(formatCheckOutput(checked));
  if (checked.errors.length > 0) {
    // D66 ruling 7B: a failing check ends with the command that bundles the
    // failure — one line, no persuasion, and nothing about data leaving the
    // machine, because `velar repro` never sends any. `build` and `package`
    // reach this same exit, and the ruling names `check`: it is the command the
    // reproduction's own README tells a reader to run.
    if (command === "check") process.stderr.write(`${reproductionHint(parsed.input)}\n`);
    return 1;
  }

  if (command === "check") {
    const count = checked.compiled.size;
    // D89: a passing check that carried advisories says how many. Folding them
    // into a silent "checked N modules" would hide the one thing the advisory
    // channel exists to make impossible to miss; the exit code stays 0 either
    // way, because an advisory is not a failure.
    const advisories = checked.advisories.length;
    process.stdout.write(
      `Checked ${count} module${count === 1 ? "" : "s"} from ${displayInput(parsed.input, projectConfig)}`
      + `${advisories > 0 ? ` — ${advisories} advisor${advisories === 1 ? "y" : "ies"}` : ""}\n`,
    );
    return 0;
  }

  if (command === "package") {
    if (!project.framework) {
      process.stderr.write("velar package: this project does not enable an application target\n");
      return 1;
    }
    try {
      const packageHost = await loadApplicationPackageHost(projectConfig);
      let buildRequests = 0;
      let frameworkBuild: Promise<void> | null = null;
      const packageResult = await packageHost.packageApplication({
        projectRoot: projectConfig.root,
        config: projectConfig.framework!.config,
        buildFramework: async (requestedOutput) => {
          buildRequests += 1;
          if (buildRequests > 1) throw new Error("application package host requested more than one framework build");
          const outputDirectory = packageFrameworkOutput(projectConfig.root, requestedOutput);
          frameworkBuild = writeFrameworkProductionApplication(
            project,
            outputDirectory,
            { forced: false, declared: false },
            "production",
            projectConfig.build.sourceMaps,
          );
          await frameworkBuild;
        },
      });
      if (buildRequests !== 1 || !frameworkBuild) throw new Error("application package host did not request exactly one checked framework build");
      await frameworkBuild;
      const result = validateApplicationPackageResult(packageResult, projectConfig.root);
      process.stdout.write(`Packaged ${project.framework.host.displayName} application -> ${result.artifactPath}\n`);
      for (const detail of result.details) process.stdout.write(`${detail}\n`);
      return 0;
    } catch (error) {
      process.stderr.write(`velar package: ${hostErrorMessage(error)}\n`);
      return 1;
    }
  }

  // JavaScript 表达形式和 Source Map 是两个正交选择。命令行只覆盖本次构建，
  // 项目配置保存稳定默认；两者不能互相推导，否则切到 readable 会意外改变
  // 发布目录的文件集合。
  const buildMode = parsed.mode ?? projectConfig.build.mode;
  const buildSourceMaps = parsed.sourceMaps ?? projectConfig.build.sourceMaps;

  if (parsed.output && project.modules.length !== 1) {
    process.stderr.write("velar build: --out is only valid for a single-file build; use --out-dir for module projects\n");
    return 2;
  }

  if (parsed.output) {
    const outputPath = resolve(parsed.output);
    try {
      await assertNodeStandardModuleOutputAvailable(dirname(outputPath), project);
      await mkdir(dirname(outputPath), { recursive: true });
      const result = project.modules[0]!.result;
      if (needsStandaloneJavaScriptBundle(result)) {
        const bundled = await bundleStandaloneJavaScript(outputPath, result, project.resources, "readable", buildSourceMaps);
        await writeCompiled(outputPath, result, true, bundled.code, bundled.sourceMap, false, buildSourceMaps, buildMode);
      } else {
        await writeCompiled(outputPath, result, true, null, null, true, buildSourceMaps, buildMode);
      }
      await writeNodeStandardModules(dirname(outputPath), project, true, buildMode);
    } catch (error) {
      process.stderr.write(`velar build: ${hostErrorMessage(error)}\n`);
      return 1;
    }
    process.stdout.write(`Built ${buildMode} ${displayInput(parsed.input, projectConfig)} -> ${outputPath}\n`);
    return 0;
  }

  const outputDirectory = parsed.outputDirectory ? resolve(parsed.outputDirectory) : projectConfig.outDir;
  // `outDir` is the project manifest's own declaration of a directory velar
  // owns, and config.ts already refuses one that is the project root or that
  // overlaps the entry or the public directory. `--out-dir` carries no such
  // declaration, so a path it names has to prove ownership before the build
  // replaces what is there.
  const replacement: BuildOutputReplacement = { forced: parsed.force, declared: outputDirectory === projectConfig.outDir };
  if (project.framework) {
    try {
      await writeFrameworkProductionApplication(project, outputDirectory, replacement, buildMode, buildSourceMaps);
    } catch (error) {
      process.stderr.write(`velar build: ${hostErrorMessage(error)}\n`);
      return 1;
    }
    process.stdout.write(`Built ${buildMode} ${project.framework.host.displayName} app -> ${outputDirectory}\n`);
    return 0;
  }
  const nodeConfig = nodeApplicationConfig(projectConfig);
  if (nodeConfig) {
    try {
      await writeNodeProductionApplication(project, outputDirectory, nodeConfig, replacement, buildMode, buildSourceMaps);
    } catch (error) {
      process.stderr.write(`velar build: ${hostErrorMessage(error)}\n`);
      return 1;
    }
    process.stdout.write(`Built ${buildMode} Node app -> ${outputDirectory}\n`);
    return 0;
  }
  let staging: string;
  try {
    staging = await prepareBuildStaging(outputDirectory, replacement);
  } catch (error) {
    process.stderr.write(`velar build: ${hostErrorMessage(error)}\n`);
    return 1;
  }
  try {
    assertUniqueEmbeddedModuleOutputs(project.modules.map((module) => ({
      ownerPath: join(staging, module.relativePath.replace(/\.vel$/, ".js")),
      embeddedModules: module.result.embeddedModules,
    })));
    await mapBuildOutputs(project.modules, async (module) => {
      const outputPath = join(staging, module.relativePath.replace(/\.vel$/, ".js"));
      await mkdir(dirname(outputPath), { recursive: true });
      await writeCompiled(outputPath, module.result, false, rewriteVelarPackageImports(project, module), null, true, buildSourceMaps, buildMode);
    });
    await writeProjectResources(project, staging, "build", buildMode);
    await writeBuildResourcePackageManifests(project, staging);
    await writeNodeStandardModules(staging, project, false, buildMode);
    await replaceOutputDirectory(staging, outputDirectory);
  } catch (error) {
    await rm(staging, { recursive: true, force: true });
    process.stderr.write(`velar build: ${hostErrorMessage(error)}\n`);
    return 1;
  }
  process.stdout.write(`Built ${buildMode} ${project.modules.length} module${project.modules.length === 1 ? "" : "s"} -> ${outputDirectory}\n`);
  return 0;
}

async function writeFrameworkProductionApplication(
  project: ProjectResult,
  outputDirectory: string,
  replacement: BuildOutputReplacement,
  mode: JavaScriptBuildMode,
  sourceMaps: boolean,
): Promise<void> {
  if (!project.framework) throw new Error("the checked project has no framework host");
  const framework = project.framework;
  await assertRequiredPublicAssets(
    project.publicRoot,
    project.projectRoot,
    framework.host.requiredPublicAssets?.(framework.config) ?? [],
  );
  const staging = await prepareBuildStaging(outputDirectory, replacement);
  try {
    await copyPublicAssets(project.publicRoot, staging);
    const production = await buildProductionFramework(project, staging, mode, sourceMaps);
    const artifacts = createFrameworkArtifacts(project, false, {}, {
      entryPath: production.entryPath,
      stylesheetPath: production.stylesheetPath,
      includeStandardImports: false,
    });
    if (!artifacts) throw new Error("The framework host did not create an application entry");
    await writeFile(join(staging, "index.html"), artifacts.html, "utf8");
    const deployment = await writeStaticDeployment(
      staging,
      artifacts.html,
      project.framework.host.staticDeployment(project.framework.config),
      production.framework,
    );
    await writeProductionManifest(staging, production, deployment);
    await replaceOutputDirectory(staging, outputDirectory);
  } catch (error) {
    await rm(staging, { recursive: true, force: true });
    throw error;
  }
}

async function writeNodeProductionApplication(
  project: ProjectResult,
  outputDirectory: string,
  config: NodeApplicationConfig,
  replacement: BuildOutputReplacement,
  mode: JavaScriptBuildMode,
  sourceMaps: boolean,
): Promise<void> {
  const application = nodeApplicationEntry(project);
  const entry = application.entry;
  const staging = await prepareBuildStaging(outputDirectory, replacement);
  try {
    assertUniqueEmbeddedModuleOutputs(project.modules.map((module) => ({
      ownerPath: join(staging, module.relativePath.replace(/\.vel$/u, ".js")),
      embeddedModules: module.result.embeddedModules,
    })));
    await mapBuildOutputs(project.modules, async (module) => {
      const outputPath = join(staging, module.relativePath.replace(/\.vel$/u, ".js"));
      await mkdir(dirname(outputPath), { recursive: true });
      await writeCompiled(outputPath, module.result, false, rewriteVelarPackageImports(project, module), null, true, sourceMaps, mode);
    });
    await writeProjectResources(project, staging, "build", mode);
    await writeBuildResourcePackageManifests(project, staging);
    await writeNodeStandardModules(staging, project, false, mode);
    await copyPublicAssets(project.publicRoot, join(staging, "public"), true);
    if (config.configuration !== null) await copyConfiguredServerConfiguration(project.projectRoot, staging, config.configuration);
    const entryPath = `./${relative(project.sourceRoot, entry.inputPath).replace(/\.vel$/u, ".js").replaceAll("\\", "/")}`;
    await writeFile(join(staging, "package.json"), `${JSON.stringify({ name: "velar-node-build", private: true, type: "module" }, null, 2)}\n`, "utf8");
    await writeNodeProductionManifest(staging, { mode, entry: entryPath.slice(2), configuration: config.configuration, sourceMaps });
    await replaceOutputDirectory(staging, outputDirectory);
  } catch (error) {
    await rm(staging, { recursive: true, force: true });
    throw error;
  }
}

async function copyConfiguredServerConfiguration(projectRoot: string, outputRoot: string, configuration: string): Promise<void> {
  const path = join(projectRoot, configuration);
  try {
    const metadata = await lstat(path);
    if (metadata.isSymbolicLink() || !metadata.isFile()) throw new Error(`Configured Server configuration '${path}' must be a regular file`);
    if (metadata.size > 1024 * 1024) throw new Error(`Configured Server configuration '${path}' cannot exceed 1 MiB`);
  } catch (error) {
    if (isHostErrorCode(error, "ENOENT")) throw new Error(`Configured Server configuration '${path}' does not exist`);
    throw error;
  }
  const output = join(outputRoot, configuration);
  await mkdir(dirname(output), {recursive: true});
  await copyFile(path, output);
}

function packageFrameworkOutput(root: string, input: string): string {
  if (!isAbsolute(input)) throw new Error("application package host requested a non-absolute framework output path");
  const output = resolve(input);
  const fromRoot = relative(root, output);
  if (fromRoot === "" || fromRoot === ".." || fromRoot.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) || isAbsolute(fromRoot)) {
    throw new Error("application package host requested a framework output path outside the project root");
  }
  return output;
}

/** How much of the output directory's current contents this build may replace. */
interface BuildOutputReplacement {
  /** `--force` was passed: replace the directory even without an ownership marker. */
  readonly forced: boolean;
  /** The path is the project manifest's own `outDir`, which declares velar owns it. */
  readonly declared: boolean;
}

interface BuildStagingOwnership {
  readonly formatVersion: 1;
  readonly kind: "velar-build-staging";
  readonly outputDirectory: string;
  readonly stagingDirectory: string;
  readonly ownerPid: number;
}

/**
 * Reclaims only staging directories carrying a marker that names this exact
 * output. A process cut can happen before or after either rename, so recovery
 * also finishes restoring the previous output when installation never began.
 */
async function prepareBuildStaging(outputDirectory: string, replacement: BuildOutputReplacement): Promise<string> {
  const normalizedOutput = resolve(outputDirectory);
  await assertReplaceableBuildOutput(normalizedOutput, replacement);
  const parent = dirname(normalizedOutput);
  await mkdir(parent, { recursive: true });
  await recoverInterruptedBuilds(normalizedOutput);
  const staging = await mkdtemp(join(parent, `.velar-${basename(normalizedOutput)}-`));
  const ownership: BuildStagingOwnership = {
    formatVersion: 1,
    kind: "velar-build-staging",
    outputDirectory: normalizedOutput,
    stagingDirectory: resolve(staging),
    ownerPid: process.pid,
  };
  await writeFile(join(staging, BUILD_STAGING_MARKER), `${JSON.stringify(ownership, null, 2)}\n`, "utf8");
  return staging;
}

/**
 * A build replaces its output directory wholesale, so the path is accepted only
 * when velar owns it: absent, empty, carrying a manifest a previous build wrote,
 * or named by the project manifest's own `outDir`. Every other destructive path
 * in this repository makes the same test first — `assertReplaceableReleaseOutput`
 * in scripts/release-toolchain.mjs, `prepareDirectory` in reproduction.ts, and
 * `createVelarProject` — and `--out-dir` was the one an author runs daily that
 * did not. `--force` waives the ownership test and nothing else: the home
 * directory, the filesystem root and a symbolic link stay refused.
 */
async function assertReplaceableBuildOutput(outputDirectory: string, replacement: BuildOutputReplacement): Promise<void> {
  const directory = resolve(outputDirectory);
  if (directory === parsePath(directory).root || directory === resolve(homedir())) {
    throw new Error(`refusing to replace '${directory}': a build output cannot be the filesystem root or the home directory`);
  }
  let metadata;
  try {
    metadata = await lstat(directory);
  } catch (error) {
    if (isHostErrorCode(error, "ENOENT") || isHostErrorCode(error, "ENOTDIR")) return;
    throw error;
  }
  if (metadata.isSymbolicLink()) throw new Error(`refusing to replace '${directory}': it is a symbolic link`);
  if (!metadata.isDirectory()) throw new Error(`refusing to replace '${directory}': it is not a directory`);
  if (replacement.forced || replacement.declared) return;
  if ((await readdir(directory)).length === 0) return;
  if (await isBuildOutputDirectory(directory)) return;
  throw new Error(`refusing to replace '${directory}': it is not empty and was not produced by velar build (pass --force to overwrite)`);
}

/**
 * The three build shapes leave three different receipts: a framework build
 * writes `velar-build.json`, a node build writes `velar-node.json`, and a build
 * cut between the two renames leaves the staging marker naming this same output.
 */
async function isBuildOutputDirectory(directory: string): Promise<boolean> {
  if (await buildStagingOwnership(directory, directory, null)) return true;
  return await buildManifestKind(join(directory, PRODUCTION_MANIFEST_NAME)) === "velar-framework-build"
    || await buildManifestKind(join(directory, NODE_BUILD_MANIFEST_NAME)) === "velar-node-build";
}

async function buildManifestKind(path: string): Promise<string | null> {
  try {
    const metadata = await lstat(path);
    if (!metadata.isFile() || metadata.isSymbolicLink()) return null;
    const parsed = JSON.parse(await readFile(path, "utf8")) as { formatVersion?: unknown; kind?: unknown };
    return Number.isSafeInteger(parsed.formatVersion) && typeof parsed.kind === "string" ? parsed.kind : null;
  } catch (error) {
    if (isHostErrorCode(error, "ENOENT") || isHostErrorCode(error, "ENOTDIR") || error instanceof SyntaxError) return null;
    throw error;
  }
}

async function recoverInterruptedBuilds(outputDirectory: string): Promise<void> {
  const parent = dirname(outputDirectory);
  const prefix = `.velar-${basename(outputDirectory)}-`;

  const installed = await buildStagingOwnership(outputDirectory, outputDirectory, null);
  if (installed && !processIsAlive(installed.ownerPid)) {
    await rm(`${installed.stagingDirectory}-previous`, { recursive: true, force: true });
    await rm(join(outputDirectory, BUILD_STAGING_MARKER), { force: true });
  }

  for (const entry of await readdir(parent, { withFileTypes: true })) {
    if (!entry.name.startsWith(prefix) || entry.name.endsWith("-previous") || !entry.isDirectory()) continue;
    const staging = resolve(parent, entry.name);
    const ownership = await buildStagingOwnership(staging, outputDirectory, staging);
    if (!ownership || processIsAlive(ownership.ownerPid)) continue;
    const previous = `${staging}-previous`;
    try {
      await lstat(outputDirectory);
      await rm(previous, { recursive: true, force: true });
    } catch (error) {
      if (!isHostErrorCode(error, "ENOENT")) throw error;
      try {
        await rename(previous, outputDirectory);
      } catch (restoreError) {
        if (!isHostErrorCode(restoreError, "ENOENT")) throw restoreError;
      }
    }
    await rm(staging, { recursive: true, force: true });
  }
}

async function buildStagingOwnership(
  directory: string,
  outputDirectory: string,
  expectedStaging: string | null,
): Promise<BuildStagingOwnership | null> {
  try {
    const directoryMetadata = await lstat(directory);
    if (!directoryMetadata.isDirectory() || directoryMetadata.isSymbolicLink()) return null;
    const markerPath = join(directory, BUILD_STAGING_MARKER);
    const markerMetadata = await lstat(markerPath);
    if (!markerMetadata.isFile() || markerMetadata.isSymbolicLink()) return null;
    const parsed = JSON.parse(await readFile(markerPath, "utf8")) as Partial<BuildStagingOwnership>;
    if (parsed.formatVersion !== 1
      || parsed.kind !== "velar-build-staging"
      || parsed.outputDirectory !== outputDirectory
      || typeof parsed.stagingDirectory !== "string"
      || dirname(parsed.stagingDirectory) !== dirname(outputDirectory)
      || !basename(parsed.stagingDirectory).startsWith(`.velar-${basename(outputDirectory)}-`)
      || (expectedStaging !== null && parsed.stagingDirectory !== expectedStaging)
      || !Number.isSafeInteger(parsed.ownerPid)
      || (parsed.ownerPid ?? 0) <= 0) return null;
    return parsed as BuildStagingOwnership;
  } catch (error) {
    if (isHostErrorCode(error, "ENOENT") || error instanceof SyntaxError) return null;
    throw error;
  }
}

function processIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return isHostErrorCode(error, "EPERM");
  }
}

async function replaceOutputDirectory(staging: string, outputDirectory: string): Promise<void> {
  const previous = `${staging}-previous`;
  let movedPrevious = false;
  let installed = false;
  try {
    try {
      await rename(outputDirectory, previous);
      movedPrevious = true;
    } catch (error) {
      if (!isHostErrorCode(error, "ENOENT")) throw error;
    }
    await rename(staging, outputDirectory);
    installed = true;
    if (movedPrevious) await rm(previous, { recursive: true, force: true });
    await rm(join(outputDirectory, BUILD_STAGING_MARKER), { force: true });
  } catch (error) {
    if (!installed && movedPrevious) {
      try {
        await rename(previous, outputDirectory);
      } catch (restoreError) {
        throw new Error(`Build output replacement failed and the previous output could not be restored: ${hostErrorMessage(restoreError)}`, { cause: error });
      }
    }
    throw error;
  }
}

const VELAR_GENERATED_RUNTIME_PACKAGE_VERSION = 1;

async function writeNodeStandardModules(
  outputRoot: string,
  project: ProjectResult,
  replaceExisting = false,
  mode: JavaScriptBuildMode = "readable",
): Promise<void> {
  const used = requiredNodeStandardModules(project);
  const packageRoot = join(outputRoot, "node_modules", "velar");
  if (!replaceExisting) {
    if (used.size === 0) return;
    await writeNodeStandardModulePackage(packageRoot, used, project, mode);
    if (used.has("velar/websocket")) await writeWebSocketDependency(dirname(packageRoot));
    if (used.has("velar/server")) await writeServerConfigurationDependency(dirname(packageRoot));
    return;
  }

  const ownership = await generatedRuntimePackageOwnership(packageRoot);
  if (used.size === 0) {
    if (ownership === "generated") await rm(packageRoot, { recursive: true, force: true });
    return;
  }
  if (ownership === "foreign") throw new Error(`Refusing to replace non-generated package '${packageRoot}'`);
  await mkdir(dirname(packageRoot), { recursive: true });
  const staging = await mkdtemp(join(dirname(packageRoot), ".velar-runtime-"));
  try {
    await writeNodeStandardModulePackage(staging, used, project, mode);
    if (ownership === "generated") await replaceOutputDirectory(staging, packageRoot);
    else await rename(staging, packageRoot);
    if (used.has("velar/websocket")) await writeWebSocketDependency(dirname(packageRoot));
    if (used.has("velar/server")) await writeServerConfigurationDependency(dirname(packageRoot));
  } catch (error) {
    await rm(staging, { recursive: true, force: true });
    throw error;
  }
}

function requiredNodeStandardModules(project: ProjectResult): ReadonlySet<string> {
  const sources = standardModuleSources(project.compilerExtensions);
  const roots = new Set(project.modules.flatMap((module) => module.result.dependencies
    .map((dependency) => dependency.source)
    .filter((source) => sources.has(source))));
  for (const module of project.modules) {
    for (const source of module.result.runtimeModules) if (sources.has(source)) roots.add(source);
  }
  return standardModuleClosure(roots, project.extensionConfig, project.compilerExtensions);
}

async function assertNodeStandardModuleOutputAvailable(outputRoot: string, project: ProjectResult): Promise<void> {
  if (requiredNodeStandardModules(project).size === 0) return;
  const packageRoot = join(outputRoot, "node_modules", "velar");
  if (await generatedRuntimePackageOwnership(packageRoot) === "foreign") {
    throw new Error(`Refusing to replace non-generated package '${packageRoot}'`);
  }
}

async function writeNodeStandardModulePackage(
  packageRoot: string,
  used: ReadonlySet<string>,
  project: ProjectResult,
  mode: JavaScriptBuildMode,
): Promise<void> {
  await mkdir(packageRoot, { recursive: true });
  const exports: Record<string, string> = {};
  const sources = [...used].sort();
  for (const source of sources) exports[`./${source.slice("velar/".length)}`] = `./${source.slice("velar/".length)}.js`;
  await mapBuildOutputs(sources, async (source) => {
    const name = source.slice("velar/".length);
    const moduleSource = standardModuleSource(source, project.extensionConfig, project.compilerExtensions);
    if (moduleSource === null) throw new Error(`Unknown VelarScript standard module '${source}'`);
    const outputPath = join(packageRoot, `${name}.js`);
    const output = await renderJavaScriptOutput({
      code: moduleSource,
      sourceMap: null,
      sourceFile: `velar/${name}`,
      outputFile: outputPath,
      mode,
      sourceMaps: false,
      target: "node24",
    });
    await writeFile(outputPath, output.code, "utf8");
  });
  await writeFile(join(packageRoot, "package.json"), `${JSON.stringify({
    name: "velar",
    private: true,
    type: "module",
    velarGeneratedRuntime: VELAR_GENERATED_RUNTIME_PACKAGE_VERSION,
    velarBuildMode: mode,
    exports,
  }, null, 2)}\n`, "utf8");
}

async function generatedRuntimePackageOwnership(packageRoot: string): Promise<"absent" | "generated" | "foreign"> {
  try {
    const stats = await lstat(packageRoot);
    if (!stats.isDirectory() || stats.isSymbolicLink()) return "foreign";
  } catch (error) {
    if (isHostErrorCode(error, "ENOENT")) return "absent";
    throw error;
  }
  try {
    const manifest = JSON.parse(await readFile(join(packageRoot, "package.json"), "utf8")) as Record<string, unknown>;
    return manifest.name === "velar"
      && manifest.private === true
      && manifest.type === "module"
      && manifest.velarGeneratedRuntime === VELAR_GENERATED_RUNTIME_PACKAGE_VERSION
      ? "generated"
      : "foreign";
  } catch (error) {
    if (isHostErrorCode(error, "ENOENT") || error instanceof SyntaxError) return "foreign";
    throw error;
  }
}

async function writeCompiled(
  outputPath: string,
  result: CompileResult,
  writeCss: boolean,
  codeOverride: string | null = null,
  sourceMapOverride: string | null = null,
  writeEmbedded = true,
  sourceMaps = true,
  mode: JavaScriptBuildMode = "readable",
): Promise<void> {
  const mapPath = `${outputPath}.map`;
  const rawCode = codeOverride ?? result.code ?? "";
  const output = await renderJavaScriptOutput({
    code: rawCode,
    sourceMap: sourceMapOverride ?? result.sourceMap,
    sourceFile: result.source.path,
    outputFile: outputPath,
    mode,
    sourceMaps,
    target: "node24",
  });
  const code = !sourceMaps || output.code.includes(`//# sourceMappingURL=${basename(mapPath)}`)
    ? output.code
    : `${output.code}//# sourceMappingURL=${basename(mapPath)}\n`;
  if (writeEmbedded) {
    assertUniqueEmbeddedModuleOutputs([{ ownerPath: outputPath, embeddedModules: result.embeddedModules }]);
    for (const module of result.embeddedModules) {
      const embeddedPath = embeddedModuleOutputPath(outputPath, module.specifier);
      await assertEmbeddedModuleOutputWritable(embeddedPath);
    }
  }
  const embeddedWrites = (await Promise.all((writeEmbedded ? result.embeddedModules : []).map(async (module) => {
    const embeddedPath = embeddedModuleOutputPath(outputPath, module.specifier);
    const embeddedOutput = await renderJavaScriptOutput({
      code: module.code,
      sourceMap: module.sourceMap,
      sourceFile: `${result.source.path}:${module.specifier}`,
      outputFile: embeddedPath,
      mode,
      sourceMaps,
      target: "node24",
    });
    const embeddedCode = sourceMaps
      ? embeddedModuleFileContents(embeddedPath, { ...module, code: embeddedOutput.code })
      : `${embeddedOutput.code}${VELAR_EMBEDDED_MODULE_MARKER}`;
    return sourceMaps
      ? [writeFile(embeddedPath, embeddedCode, "utf8"), writeFile(`${embeddedPath}.map`, embeddedOutput.sourceMap, "utf8")]
      : [writeFile(embeddedPath, embeddedCode, "utf8"), rm(`${embeddedPath}.map`, { force: true })];
  }))).flat();
  const writes: Promise<void>[] = [
    writeFile(outputPath, code, "utf8"),
    ...(sourceMaps ? [writeFile(mapPath, output.sourceMap, "utf8")] : [rm(mapPath, { force: true })]),
    ...embeddedWrites,
  ];
  if (writeCss) {
    const cssPath = outputPath.replace(/\.js$/u, ".css");
    writes.push(result.css ? writeFile(cssPath, result.css, "utf8") : rm(cssPath, { force: true }));
  }
  await Promise.all(writes);
}

async function assertEmbeddedModuleOutputWritable(path: string): Promise<void> {
  try {
    const metadata = await lstat(path);
    if (!metadata.isFile() || metadata.isSymbolicLink()) {
      throw new Error(`Refusing to replace non-generated embedded JavaScript output '${path}'`);
    }
    const existing = await readFile(path, "utf8");
    if (!existing.includes(VELAR_EMBEDDED_MODULE_MARKER)) {
      throw new Error(`Refusing to replace non-generated embedded JavaScript output '${path}'`);
    }
  } catch (error) {
    if (!isHostErrorCode(error, "ENOENT")) throw error;
    try {
      await lstat(`${path}.map`);
      throw new Error(`Refusing to replace source map '${path}.map' without its generated embedded JavaScript owner`);
    } catch (mapError) {
      if (!isHostErrorCode(mapError, "ENOENT")) throw mapError;
    }
  }
}

function rewriteVelarPackageImports(project: ProjectResult, module: ProjectModule): string | null {
  if (!module.result.code) return null;
  return module.result.code.replace(/(\bfrom\s+["']|\bimport\s+["'])([^"']+)(["'])/gu, (match, prefix: string, source: string, suffix: string) => {
    const resource = project.resourceImports.get(projectImportKey(module.inputPath, source));
    if (resource) {
      const output = `${resourceOutputRelativePath(project, resource, "build")}.js`;
      let targetImport = relative(dirname(module.relativePath), output).replaceAll("\\", "/");
      if (!targetImport.startsWith(".")) targetImport = `./${targetImport}`;
      return `${prefix}${targetImport}${suffix}`;
    }
    const targetPath = project.velarImports.get(projectImportKey(module.inputPath, source));
    if (!targetPath) return match;
    const target = project.modules.find((item) => item.inputPath === targetPath);
    if (!target) return match;
    let targetImport = relative(dirname(module.relativePath), target.relativePath).replace(/\.vel$/u, ".js").replaceAll("\\", "/");
    if (!targetImport.startsWith(".")) targetImport = `./${targetImport}`;
    return `${prefix}${targetImport}${suffix}`;
  });
}

function parseFormatArguments(arguments_: readonly string[]): FormatArguments | string {
  let input: string | null = null;
  let check = false;
  for (const argument of arguments_) {
    if (argument === "--check") {
      check = true;
    } else if (argument.startsWith("--")) {
      return `unknown option '${argument}'`;
    } else if (input) {
      return `unexpected extra input '${argument}'`;
    } else {
      input = argument;
    }
  }
  return { input, check };
}

function parseCommandArguments(arguments_: readonly string[], allowForce = false): CommandArguments | string {
  let input: string | null = null;
  let output: string | null = null;
  let outputDirectory: string | null = null;
  let force = false;
  let mode: JavaScriptBuildMode | null = null;
  let sourceMaps: boolean | null = null;

  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index]!;
    if (allowForce && argument === "--force") {
      force = true;
    } else if (allowForce && (argument === "--mode" || argument.startsWith("--mode="))) {
      if (mode !== null) return "--mode may be provided only once";
      const value = argument === "--mode" ? arguments_[index + 1] : argument.slice("--mode=".length);
      if (value !== "production" && value !== "readable") return "--mode must be production or readable";
      mode = value;
      if (argument === "--mode") index += 1;
    } else if (allowForce && (argument === "--source-maps" || argument === "--no-source-maps")) {
      if (sourceMaps !== null) return "--source-maps and --no-source-maps may be provided only once";
      sourceMaps = argument === "--source-maps";
    } else if (argument === "--out" || argument === "--out-dir") {
      const value = arguments_[index + 1];
      if (!value || value.startsWith("--")) {
        return `${argument} requires a path`;
      }
      if (argument === "--out") {
        if (extname(value) !== ".js") return "--out requires a .js file path";
        output = value;
      } else {
        outputDirectory = value;
      }
      index += 1;
    } else if (argument.startsWith("--")) {
      return `unknown option '${argument}'`;
    } else if (input) {
      return `unexpected extra input '${argument}'`;
    } else {
      input = argument;
    }
  }

  return { input, output, outputDirectory, force, mode, sourceMaps };
}

function parseBuildLibraryArguments(arguments_: readonly string[]): BuildLibraryArguments | string {
  let input: string | null = null;
  let mode: JavaScriptBuildMode | null = null;
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index]!;
    if (argument === "--mode" || argument.startsWith("--mode=")) {
      if (mode !== null) return "--mode may be provided only once";
      const value = argument === "--mode" ? arguments_[index + 1] : argument.slice("--mode=".length);
      if (value !== "production" && value !== "readable") return "--mode must be production or readable";
      mode = value;
      if (argument === "--mode") index += 1;
    } else if (argument.startsWith("--")) {
      return `unknown option '${argument}'`;
    } else if (input !== null) {
      return `unexpected extra input '${argument}'`;
    } else {
      input = argument;
    }
  }
  return { input, mode };
}

function parseReproArguments(arguments_: readonly string[]): ReproArguments | string {
  let input: string | null = null;
  let outputDirectory: string | null = null;
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index]!;
    if (argument === "--out-dir") {
      const value = arguments_[index + 1];
      if (!value || value.startsWith("--")) return "--out-dir requires a path";
      if (outputDirectory) return "--out-dir may be provided only once";
      outputDirectory = value;
      index += 1;
    } else if (argument.startsWith("--out-dir=")) {
      if (outputDirectory) return "--out-dir may be provided only once";
      outputDirectory = argument.slice("--out-dir=".length);
      if (!outputDirectory) return "--out-dir requires a path";
    } else if (argument.startsWith("--")) {
      return `unknown option '${argument}'`;
    } else if (input) {
      return `unexpected extra input '${argument}'`;
    } else {
      input = argument;
    }
  }
  return { input, outputDirectory };
}

function parsePackageArguments(arguments_: readonly string[]): CommandArguments | string {
  if (arguments_.length > 1) return `unexpected extra input '${arguments_[1]}'`;
  if (arguments_[0]?.startsWith("-")) return `unknown option '${arguments_[0]}'`;
  return { input: arguments_[0] ?? null, output: null, outputDirectory: null, force: false, mode: null, sourceMaps: null };
}

function parseDevArguments(arguments_: readonly string[]): DevArguments | string {
  let input: string | null = null;
  let port: number | null = null;
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index]!;
    if (argument === "--port") {
      const value = arguments_[index + 1];
      const parsed = value ? Number(value) : Number.NaN;
      if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65_535) return "--port requires an integer from 1 to 65535";
      port = parsed;
      index += 1;
    } else if (argument.startsWith("--")) {
      return `unknown option '${argument}'`;
    } else if (input) {
      return `unexpected extra input '${argument}'`;
    } else {
      input = argument;
    }
  }
  return { input, port };
}

function parseServeArguments(arguments_: readonly string[]): ServeArguments | string {
  let input: string | null = null;
  for (const argument of arguments_) {
    if (argument.startsWith("--")) {
      return `unknown option '${argument}'`;
    } else if (input) {
      return `unexpected extra input '${argument}'`;
    } else {
      input = argument;
    }
  }
  return { input };
}

function parseTestArguments(arguments_: readonly string[]): TestArguments | string {
  let input: string | null = null;
  let browser: BrowserEngineSelection | null = null;
  const engines = new Set<BrowserEngineSelection>(["chromium", "firefox", "webkit", "all"]);
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index]!;
    if (argument === "--browser") {
      const candidate = arguments_[index + 1] as BrowserEngineSelection | undefined;
      if (candidate && engines.has(candidate)) {
        browser = candidate;
        index += 1;
      } else {
        browser = "chromium";
      }
    } else if (argument.startsWith("--browser=")) {
      const candidate = argument.slice("--browser=".length) as BrowserEngineSelection;
      if (!engines.has(candidate)) return "--browser must be chromium, firefox, webkit, or all";
      browser = candidate;
    } else if (argument.startsWith("--")) {
      return `unknown option '${argument}'`;
    } else if (input) {
      return `unexpected extra input '${argument}'`;
    } else {
      input = argument;
    }
  }
  return { input, browser };
}

function parseRunArguments(arguments_: readonly string[]): RunArguments | string {
  let input: string | null = null;
  let fullStack = false;
  const programArguments: string[] = [];
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index]!;
    if (argument === "--") {
      programArguments.push(...arguments_.slice(index + 1));
      break;
    }
    if (argument === "--stack") {
      if (fullStack) return "--stack may be provided only once";
      fullStack = true;
      continue;
    }
    if (argument.startsWith("--")) return `unknown option '${argument}'; program arguments belong after '--'`;
    if (input) return `unexpected extra input '${argument}'`;
    input = argument;
  }
  return { input, programArguments, fullStack };
}

function helpRequested(command: string, arguments_: readonly string[]): boolean {
  const separator = command === "run" ? arguments_.indexOf("--") : -1;
  const visible = separator === -1 ? arguments_ : arguments_.slice(0, separator);
  return visible.some((argument) => argument === "--help" || argument === "-h");
}

function parseSingleOptionalInput(arguments_: readonly string[]): string | null | { readonly error: string } {
  if (arguments_.some((argument) => argument.startsWith("--"))) {
    return { error: `unknown option '${arguments_.find((argument) => argument.startsWith("--"))}'` };
  }
  if (arguments_.length > 1) return { error: `unexpected extra input '${arguments_[1]}'` };
  return arguments_[0] ?? null;
}

const MAXIMUM_GRAPH_SOURCE_NODES = 20_000;
const MAXIMUM_GRAPH_SOURCE_EDGES = 40_000;

function parseGraphBound(option: string, value: string | undefined, maximum: number): number | string {
  const parsed = value ? Number(value) : Number.NaN;
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > maximum) {
    return `${option} requires an integer from 1 through ${maximum}`;
  }
  return parsed;
}

function parseGraphArguments(arguments_: readonly string[]): GraphArguments | string {
  let input: string | null = null;
  let json = false;
  let focus: string | null = null;
  let depth = 2;
  let maximumNodes = 2_000;
  let maximumEdges = 4_000;
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index]!;
    if (argument === "--json") {
      if (json) return "--json may be provided only once";
      json = true;
      continue;
    }
    const option = argument.includes("=") ? argument.slice(0, argument.indexOf("=")) : argument;
    const inline = argument.includes("=") ? argument.slice(argument.indexOf("=") + 1) : undefined;
    if (option === "--focus") {
      const value = inline ?? arguments_[index + 1];
      if (!value || value.startsWith("--") || value.trim().length === 0) return "--focus requires a symbol name, stable node ID, or project-relative path";
      if (focus !== null) return "--focus may be provided only once";
      focus = value.trim();
      if (inline === undefined) index += 1;
    } else if (option === "--depth") {
      const value = inline ?? arguments_[index + 1];
      const parsed = value ? Number(value) : Number.NaN;
      if (!Number.isSafeInteger(parsed) || parsed < 0 || parsed > 6) return "--depth requires an integer from 0 through 6";
      depth = parsed;
      if (inline === undefined) index += 1;
    } else if (option === "--max-nodes" || option === "--max-edges") {
      const value = inline ?? arguments_[index + 1];
      const maximum = option === "--max-nodes" ? MAXIMUM_GRAPH_SOURCE_NODES : MAXIMUM_GRAPH_SOURCE_EDGES;
      const parsed = parseGraphBound(option, value, maximum);
      if (typeof parsed === "string") return parsed;
      if (option === "--max-nodes") maximumNodes = parsed;
      else maximumEdges = parsed;
      if (inline === undefined) index += 1;
    } else if (argument.startsWith("--")) {
      return `unknown option '${argument}'`;
    } else if (input !== null) {
      return `unexpected extra input '${argument}'`;
    } else {
      input = argument;
    }
  }
  return { input, json, focus, depth, maximumNodes, maximumEdges };
}

function parsePreviewArguments(arguments_: readonly string[]): PreviewArguments | string {
  let input: string | null = null;
  let port = 4173;
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index]!;
    if (argument === "--port") {
      const value = arguments_[index + 1];
      const parsed = value ? Number(value) : Number.NaN;
      if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65_535) return "--port requires an integer from 1 to 65535";
      port = parsed;
      index += 1;
    } else if (argument.startsWith("--")) {
      return `unknown option '${argument}'`;
    } else if (input) {
      return `unexpected extra input '${argument}'`;
    } else {
      input = argument;
    }
  }
  return { input, port };
}

function parseDeploymentVerificationArguments(arguments_: readonly string[]): DeploymentVerificationArguments | string {
  let input: string | null = null;
  let url: string | null = null;
  let json = false;
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index]!;
    if (argument === "--json") {
      if (json) return "--json may be provided only once";
      json = true;
    } else if (argument === "--url") {
      const value = arguments_[index + 1];
      if (!value || value.startsWith("--")) return "--url requires an absolute deployment origin";
      if (url) return "--url may be provided only once";
      url = value;
      index += 1;
    } else if (argument.startsWith("--url=")) {
      if (url) return "--url may be provided only once";
      url = argument.slice("--url=".length);
      if (!url) return "--url requires an absolute deployment origin";
    } else if (argument.startsWith("--")) {
      return `unknown option '${argument}'`;
    } else if (input) {
      return `unexpected extra input '${argument}'`;
    } else {
      input = argument;
    }
  }
  return { input, url, json };
}

function displayInput(input: string | null, config: VelarProjectConfig): string {
  return input ?? config.manifestPath ?? config.entryPath;
}

function displayPath(path: string): string {
  const value = relative(process.cwd(), path);
  return (value && !value.startsWith("..") ? value : path).replaceAll("\\", "/");
}

function printHelp(output: NodeJS.WritableStream = process.stdout): void {
  output.write([
    "VelarScript Compiler",
    "",
    "Usage:",
    "  velar check [entry.vel | project-directory]",
    "  velar create <project-directory> [--template <web|node|desktop|docs|library|component>]",
    "  velar install",
    "  velar add <package[@version]>... [--dev]",
    "  velar remove <package>...",
    "  velar update [package...]",
    "  velar dev [entry.vel | project-directory] [--port <port>]",
    "  velar serve [project-directory]",
    "  velar build [entry.vel | project-directory] [--out-dir <directory>] [--mode <production|readable>] [--source-maps|--no-source-maps] [--force]",
    "  velar build-library [project-directory] [--mode <production|readable>]",
    "  velar run [entry.vel | project-directory] [--stack] [-- <program-arguments>...]",
    "  velar verify [project-directory | build-directory]",
    "  velar preview [project-directory | build-directory] [--port <port>]",
    "  velar verify-deployment [project-directory | build-directory] --url <https-origin> [--json]",
    "  velar test [project-directory | file.test.vel]",
    "  velar test [project-directory] --browser [chromium|firefox|webkit|all]",
    "  velar build <single.vel> --out <file.js>",
    "  velar package [project-directory]",
    "  velar format [file.vel | project-directory] [--check]",
    "  velar fix [entry.vel | project-directory]",
    "  velar graph [entry.vel | project-directory] [--focus <symbol|path>] [--depth <0-6>] [--json]",
    "  velar repro [entry.vel | project-directory] [--out-dir <directory>]",
    "  velar skill [core|web|node|server|desktop]",
    "  velar lsp",
    "  velar --version",
    "",
  ].join("\n"));
}

const commandNames = new Set([
  "check", "create", "install", "add", "remove", "update", "dev", "serve", "build", "build-library", "package", "run", "verify", "preview",
  "verify-deployment", "test", "format", "fix", "graph", "repro", "skill", "lsp",
]);

function printCommandHelp(command: string, output: NodeJS.WritableStream = process.stdout): void {
  const details: Readonly<Record<string, readonly string[]>> = {
    check: ["Usage: velar check [entry.vel | project-directory]", "Type-checks the whole resolved project without writing build output."],
    create: ["Usage: velar create <project-directory> [--template <web|node|desktop|docs|library|component>]", "Creates a transactional Web, Node, or Desktop app, documentation site, Core source library, or Web component source package without installing dependencies."],
    install: ["Usage: velar install", "Installs the current VelarScript project's declared dependencies through npm, then validates the project."],
    add: ["Usage: velar add <package[@version]>... [--dev]", "Adds npm registry packages and activates packages that declare velar.extension metadata."],
    remove: ["Usage: velar remove <package>...", "Removes npm packages and their extension-owned VelarScript project configuration."],
    update: ["Usage: velar update [package...]", "Updates all or selected direct dependencies within package.json ranges through npm."],
    dev: ["Usage: velar dev [entry.vel | project-directory] [--port <1-65535>]", "Watches a framework app or last-good Node server factory; --port applies only to Web and Desktop development servers."],
    serve: ["Usage: velar serve [project-directory]", "Checks and runs a Node server factory with production runtime behavior; host and port belong to velar/server configuration."],
    build: [
      "Usage: velar build [entry.vel | project-directory] [--out-dir <directory>] [--mode <production|readable>] [--source-maps|--no-source-maps] [--force]",
      "       velar build <single.vel> --out <file.js> [--mode <production|readable>] [--source-maps|--no-source-maps]",
      "Builds isolated Web/Desktop output, a standalone Node application, or JavaScript modules.",
      "production is the default and emits compressed deployable JavaScript; readable preserves structured generated JavaScript for inspection and handover.",
      "--out-dir refuses a directory that is not empty and was not produced by a previous build; --force replaces one anyway.",
    ],
    "build-library": ["Usage: velar build-library [project-directory] [--mode <production|readable>]", "Checks a Core or Node source library, then writes its frozen ABI-1 JavaScript, source map, portable type interface, and integrity receipt; production JavaScript is the default."],
    package: ["Usage: velar package [project-directory]", "Packages an application through its target-owned native packaging host."],
    run: ["Usage: velar run [entry.vel | project-directory] [--stack] [-- <program-arguments>...]", "Compiles the resolved Core project and executes its entry module once on Node.js; arguments after '--' reach the program.", "--stack prints the full Node.js trace behind an uncaught program error instead of the VelarScript frames."],
    verify: ["Usage: velar verify [project-directory | build-directory]", "Verifies the exact Web or Node production manifest, inventory, sizes, hashes, and relationships."],
    preview: ["Usage: velar preview [project-directory | build-directory] [--port <1-65535>]", "Serves only a verified production build; the default port is 4173."],
    "verify-deployment": ["Usage: velar verify-deployment [project-directory | build-directory] --url <https-origin> [--json]", "Compares verified local bytes, routes, MIME types, and headers with an HTTPS deployment."],
    test: ["Usage: velar test [project-directory | file.test.vel]", "       velar test [project-directory | file.browser.test.vel] --browser[=chromium|firefox|webkit|all]", "Runs Core tests or explicit browser tests; bare --browser defaults to Chromium."],
    format: ["Usage: velar format [file.vel | project-directory] [--check]", "Formats one file or every manifest-owned .vel source; --check never writes."],
    fix: [
      "Usage: velar fix [entry.vel | project-directory]",
      "Applies every mechanical rewrite the compiler's own diagnostics name — retired spellings with one named successor, line-ending semicolons, and the rest of that family — then reports the diagnostics that are left.",
      "Nothing that needs a decision is rewritten, and a second run changes nothing.",
    ],
    graph: [
      "Usage: velar graph [entry.vel | project-directory] [--focus <symbol|path>] [--depth <0-6>] [--max-nodes <count>] [--max-edges <count>] [--json]",
      "Prints the compiler-owned project logic graph for people and AI tools. The default is a compact project overview; --focus selects a bounded dependency and caller neighborhood.",
      "Each invocation reads the current project. Editor hosts use revision-qualified ownership graph patches for unsaved hot updates.",
    ],
    repro: [
      "Usage: velar repro [entry.vel | project-directory] [--out-dir <directory>]",
      "Writes a self-contained minimal reproduction of a failing check — the entry's modules and the test modules that failed, velar.json, the verbatim diagnostics, and the toolchain, Node, and platform versions — then prints where it went.",
      "It writes to disk and nothing else: no upload, no network call, no environment or account data, and every absolute path rewritten to a project-relative one.",
      "The bundle is extracted to a temporary directory and re-checked first; if the copy stops reproducing, the command says so rather than reporting a clean reproduction.",
      "The default location is .velar/repro inside the project, replaced on each run; a directory named with --out-dir must be empty.",
    ],
    skill: ["Usage: velar skill [core|web|node|server|desktop]", "Prints one packaged, owner-specific VelarScript AI skill brief verbatim to stdout; the default is core."],
    lsp: ["Usage: velar lsp", "Runs the stdio language server for an editor host."],
  };
  output.write(["VelarScript Compiler", "", ...(details[command] ?? []), ""].join("\n"));
}

function dependencyResultMessage(
  action: DependencyAction,
  root: string,
  packages: readonly string[],
  activated: readonly string[],
  removed: readonly string[],
): string {
  if (action === "install") return `Installed and validated VelarScript project dependencies -> ${root}\n`;
  const names = packages.length > 0 ? packages.join(", ") : "all direct dependencies";
  const detail = activated.length > 0
    ? `; activated extensions: ${activated.join(", ")}`
    : removed.length > 0
      ? `; removed extensions: ${removed.join(", ")}`
      : "";
  const verb = action === "add" ? "Added" : action === "remove" ? "Removed" : "Updated";
  return `${verb} ${names}${detail} -> ${root}\n`;
}

try {
  process.exitCode = await main(process.argv.slice(2));
} catch (error) {
  process.stderr.write(`velar: ${hostErrorMessage(error)}\n`);
  process.exitCode = 1;
}
