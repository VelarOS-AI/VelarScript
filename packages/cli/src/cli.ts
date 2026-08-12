#!/usr/bin/env node

import { lstat, mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { basename, dirname, extname, isAbsolute, join, relative, resolve } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { formatDiagnostic, formatSource } from "@velarscript/compiler";
import type { CompileResult, CompilerExtension } from "@velarscript/compiler";
import { createVelarProject, parseCreateArguments } from "create-velar";
import { compileProject, projectImportKey, type ProjectModule, type ProjectResult } from "./project.ts";
import { runDevServer } from "./dev-server.ts";
import { createFrameworkArtifacts } from "./framework-host.ts";
import { resolveVelarProject, type VelarProjectConfig } from "./config.ts";
import { standardModuleClosure, standardModuleSource, standardModuleSources } from "./standard-modules.ts";
import { runTests } from "./test-runner.ts";
import { runProgram } from "./program-runner.ts";
import type { BrowserEngineSelection } from "./browser-test-runner.ts";
import { buildProductionFramework, writeProductionManifest } from "./production-build.ts";
import { VELAR_VERSION } from "./version.ts";
import { copyPublicAssets, writeStaticDeployment } from "./static-deployment.ts";
import { verifyProductionBuild } from "./production-verifier.ts";
import { runProductionPreview } from "./preview-server.ts";
import { createDeploymentVerificationReport, verifyRemoteDeployment } from "./deployment-verifier.ts";
import { MAX_VELAR_PROJECT_MODULES, readVelarSourceFile } from "./source-limits.ts";
import { parseDependencyArguments, runDependencyCommand, type DependencyAction } from "./package-manager.ts";
import { hostErrorMessage, isHostErrorCode } from "./host-error.ts";
import { loadApplicationPackageHost, validateApplicationPackageResult } from "./application-package-host.ts";
import { buildLanguageServerTool, VELAR_LANGUAGE_SERVER_TOOL_ID } from "./language-server-tool.ts";
import { buildProjectTaskTool, VELAR_PROJECT_TASK_TOOL_ID } from "./project-task-tool.ts";
import { buildBuildEngineTool, VELAR_BUILD_ENGINE_TOOL_ID } from "./build-engine-tool.ts";


interface CommandArguments {
  readonly input: string | null;
  readonly output: string | null;
  readonly outputDirectory: string | null;
}

interface FormatArguments {
  readonly input: string | null;
  readonly check: boolean;
}

interface DevArguments {
  readonly input: string | null;
  readonly port: number;
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
}

interface DeploymentVerificationArguments {
  readonly input: string | null;
  readonly url: string | null;
  readonly json: boolean;
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
    process.stdout.write(`velar ${VELAR_VERSION}\n`);
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
    if (rest.length > 0) {
      process.stderr.write("velar skill: this command does not accept arguments\n");
      return 2;
    }
    process.stdout.write(await readFile(new URL("../skill/ai-skill.md", import.meta.url), "utf8"));
    return 0;
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
      const verified = await verifyProductionBuild(input);
      process.stdout.write(`Verified production ${verified.manifest.framework.capability} build ${verified.manifest.buildId} -> ${verified.directory}\n`);
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
      return await runProgram(projectConfig, parsed.programArguments);
    } catch (error) {
      process.stderr.write(`velar run: ${hostErrorMessage(error)}\n`);
      return 1;
    }
  }

  if (command !== "check" && command !== "build" && command !== "package" && command !== "format" && command !== "dev" && command !== "test") {
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
    try {
      for (const input of inputs) {
        const source = await readVelarSourceFile(input);
        const formatted = formatSource(source, { extensions: formattingExtensions });
        if (formatted === source) continue;
        changed.push(input);
        if (!parsed.check) await writeFile(input, formatted, "utf8");
      }
    } catch (error) {
      process.stderr.write(`velar format: ${hostErrorMessage(error)}\n`);
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
      if (!projectConfig.framework) throw new Error("the project does not declare an application framework host");
      await runDevServer(projectConfig, parsed.port);
    } catch (error) {
      process.stderr.write(`velar dev: ${hostErrorMessage(error)}\n`);
      return 1;
    }
    return 0;
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
      const { runBrowserTests } = await import("./browser-test-runner.ts");
      return runBrowserTests(projectConfig, parsed.input, parsed.browser);
    }
    return runTests(projectConfig, parsed.input);
  }

  const parsed = command === "package" ? parsePackageArguments(rest) : parseCommandArguments(rest);
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

  const project = await compileConfiguredProject(projectConfig);
  for (const notice of project.notices) process.stderr.write(`${notice.path}: notice: ${notice.message}\n`);
  if (project.failures.length > 0) {
    for (const failure of project.failures) {
      process.stderr.write(`${failure.path}: ${failure.message}\n`);
    }
    return 1;
  }

  const diagnostics = project.modules.flatMap((module) => module.result.diagnostics.map((item) => formatDiagnostic(module.result.source, item)));
  if (diagnostics.length > 0) {
    process.stderr.write(`${diagnostics.join("\n\n")}\n`);
    return 1;
  }

  if (command === "check") {
    process.stdout.write(`Checked ${project.modules.length} module${project.modules.length === 1 ? "" : "s"} from ${displayInput(parsed.input, projectConfig)}\n`);
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
      const toolRequests = new Set<string>();
      let frameworkBuild: Promise<void> | null = null;
      const packageResult = await packageHost.packageApplication({
        projectRoot: projectConfig.root,
        config: projectConfig.framework!.config,
        buildFramework: async (requestedOutput) => {
          buildRequests += 1;
          if (buildRequests > 1) throw new Error("application package host requested more than one framework build");
          const outputDirectory = packageFrameworkOutput(projectConfig.root, requestedOutput);
          frameworkBuild = writeFrameworkProductionApplication(project, outputDirectory);
          await frameworkBuild;
        },
        buildTool: async (tool) => {
          if (!tool || typeof tool.outputFile !== "string"
            || ![VELAR_LANGUAGE_SERVER_TOOL_ID, VELAR_PROJECT_TASK_TOOL_ID, VELAR_BUILD_ENGINE_TOOL_ID].includes(tool.id)) {
            throw new Error(`application package host requested unknown official tool '${String(tool?.id ?? "")}'`);
          }
          if (toolRequests.has(tool.id)) throw new Error(`application package host requested official tool '${tool.id}' more than once`);
          toolRequests.add(tool.id);
          const outputFile = packageFrameworkOutput(projectConfig.root, tool.outputFile);
          if (tool.id === VELAR_LANGUAGE_SERVER_TOOL_ID) await buildLanguageServerTool(outputFile);
          else if (tool.id === VELAR_PROJECT_TASK_TOOL_ID) await buildProjectTaskTool(outputFile);
          else await buildBuildEngineTool(outputFile);
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

  if (parsed.output && project.modules.length !== 1) {
    process.stderr.write("velar build: --out is only valid for a single-file build; use --out-dir for module projects\n");
    return 2;
  }

  if (parsed.output) {
    const outputPath = resolve(parsed.output);
    try {
      await assertNodeStandardModuleOutputAvailable(dirname(outputPath), project);
      await mkdir(dirname(outputPath), { recursive: true });
      await writeCompiled(outputPath, project.modules[0]!.result, true);
      await writeNodeStandardModules(dirname(outputPath), project, true);
    } catch (error) {
      process.stderr.write(`velar build: ${hostErrorMessage(error)}\n`);
      return 1;
    }
    process.stdout.write(`Built ${displayInput(parsed.input, projectConfig)} -> ${outputPath}\n`);
    return 0;
  }

  const outputDirectory = parsed.outputDirectory ? resolve(parsed.outputDirectory) : projectConfig.outDir;
  if (project.framework) {
    try {
      await writeFrameworkProductionApplication(project, outputDirectory);
    } catch (error) {
      process.stderr.write(`velar build: ${hostErrorMessage(error)}\n`);
      return 1;
    }
    process.stdout.write(`Built production ${project.framework.host.displayName} app -> ${outputDirectory}\n`);
    return 0;
  }
  const parent = dirname(outputDirectory);
  await mkdir(parent, { recursive: true });
  const staging = await mkdtemp(join(parent, `.velar-${basename(outputDirectory)}-`));
  try {
    for (const module of project.modules) {
      const outputPath = join(staging, module.relativePath.replace(/\.vel$/, ".js"));
      await mkdir(dirname(outputPath), { recursive: true });
      await writeCompiled(outputPath, module.result, false, rewriteVelarPackageImports(project, module));
    }
    await writeNodeStandardModules(staging, project);
    await replaceOutputDirectory(staging, outputDirectory);
  } catch (error) {
    await rm(staging, { recursive: true, force: true });
    process.stderr.write(`velar build: ${hostErrorMessage(error)}\n`);
    return 1;
  }
  process.stdout.write(`Built ${project.modules.length} module${project.modules.length === 1 ? "" : "s"} -> ${outputDirectory}\n`);
  return 0;
}

async function writeFrameworkProductionApplication(project: ProjectResult, outputDirectory: string): Promise<void> {
  if (!project.framework) throw new Error("the checked project has no framework host");
  const parent = dirname(outputDirectory);
  await mkdir(parent, { recursive: true });
  const staging = await mkdtemp(join(parent, `.velar-${basename(outputDirectory)}-`));
  try {
    await copyPublicAssets(project.publicRoot, staging);
    const production = await buildProductionFramework(project, staging);
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

function packageFrameworkOutput(root: string, input: string): string {
  if (!isAbsolute(input)) throw new Error("application package host requested a non-absolute framework output path");
  const output = resolve(input);
  const fromRoot = relative(root, output);
  if (fromRoot === "" || fromRoot === ".." || fromRoot.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) || isAbsolute(fromRoot)) {
    throw new Error("application package host requested a framework output path outside the project root");
  }
  return output;
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

async function writeNodeStandardModules(outputRoot: string, project: ProjectResult, replaceExisting = false): Promise<void> {
  const used = requiredNodeStandardModules(project);
  const packageRoot = join(outputRoot, "node_modules", "velar");
  if (!replaceExisting) {
    if (used.size === 0) return;
    await writeNodeStandardModulePackage(packageRoot, used, project);
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
    await writeNodeStandardModulePackage(staging, used, project);
    if (ownership === "generated") await replaceOutputDirectory(staging, packageRoot);
    else await rename(staging, packageRoot);
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

async function writeNodeStandardModulePackage(packageRoot: string, used: ReadonlySet<string>, project: ProjectResult): Promise<void> {
  await mkdir(packageRoot, { recursive: true });
  const exports: Record<string, string> = {};
  for (const source of [...used].sort()) {
    const name = source.slice("velar/".length);
    const moduleSource = standardModuleSource(source, project.extensionConfig, project.compilerExtensions);
    if (moduleSource === null) throw new Error(`Unknown VelarScript standard module '${source}'`);
    exports[`./${name}`] = `./${name}.js`;
    await writeFile(join(packageRoot, `${name}.js`), moduleSource, "utf8");
  }
  await writeFile(join(packageRoot, "package.json"), `${JSON.stringify({
    name: "velar",
    private: true,
    type: "module",
    velarGeneratedRuntime: VELAR_GENERATED_RUNTIME_PACKAGE_VERSION,
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

async function writeCompiled(outputPath: string, result: CompileResult, writeCss: boolean, codeOverride: string | null = null): Promise<void> {
  const mapPath = `${outputPath}.map`;
  const code = `${codeOverride ?? result.code ?? ""}//# sourceMappingURL=${basename(mapPath)}\n`;
  const writes = [
    writeFile(outputPath, code, "utf8"),
    writeFile(mapPath, result.sourceMap ?? "", "utf8"),
  ];
  if (writeCss) {
    const cssPath = outputPath.replace(/\.js$/u, ".css");
    writes.push(result.css ? writeFile(cssPath, result.css, "utf8") : rm(cssPath, { force: true }));
  }
  await Promise.all(writes);
}

function rewriteVelarPackageImports(project: ProjectResult, module: ProjectModule): string | null {
  if (!module.result.code) return null;
  return module.result.code.replace(/(\bfrom\s+["']|\bimport\s+["'])([^"']+)(["'])/gu, (match, prefix: string, source: string, suffix: string) => {
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

function parseCommandArguments(arguments_: readonly string[]): CommandArguments | string {
  let input: string | null = null;
  let output: string | null = null;
  let outputDirectory: string | null = null;

  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index]!;
    if (argument === "--out" || argument === "--out-dir") {
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

  return { input, output, outputDirectory };
}

function parsePackageArguments(arguments_: readonly string[]): CommandArguments | string {
  if (arguments_.length > 1) return `unexpected extra input '${arguments_[1]}'`;
  if (arguments_[0]?.startsWith("-")) return `unknown option '${arguments_[0]}'`;
  return { input: arguments_[0] ?? null, output: null, outputDirectory: null };
}

function parseDevArguments(arguments_: readonly string[]): DevArguments | string {
  let input: string | null = null;
  let port = 5173;
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
  const programArguments: string[] = [];
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index]!;
    if (argument === "--") {
      programArguments.push(...arguments_.slice(index + 1));
      break;
    }
    if (argument.startsWith("--")) return `unknown option '${argument}'; program arguments belong after '--'`;
    if (input) return `unexpected extra input '${argument}'`;
    input = argument;
  }
  return { input, programArguments };
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

function compileConfiguredProject(config: VelarProjectConfig) {
  return compileProject(config.entryPath, new Map(), {
    projectRoot: config.root,
    publicRoot: config.publicDir,
    extensions: config.compilerExtensions,
    extensionConfig: config.extensionConfig,
    framework: config.framework,
  });
}

function displayInput(input: string | null, config: VelarProjectConfig): string {
  return input ?? config.manifestPath ?? config.entryPath;
}

async function discoverVelarSources(config: VelarProjectConfig): Promise<string[]> {
  const output: string[] = [];
  const excluded = new Set([config.outDir, config.publicDir]);
  const visit = async (directory: string): Promise<void> => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === ".git" || entry.name === "node_modules" || entry.name === ".velar" || excluded.has(path)) continue;
        await visit(path);
      } else if (entry.isFile() && entry.name.endsWith(".vel")) {
        output.push(path);
        if (output.length > MAX_VELAR_PROJECT_MODULES) {
          throw new RangeError(`A VelarScript project cannot contain more than ${MAX_VELAR_PROJECT_MODULES} source modules`);
        }
      }
    }
  };
  await visit(config.root);
  return output.sort();
}

function displayPath(path: string): string {
  const value = relative(process.cwd(), path);
  return value && !value.startsWith("..") ? value : path;
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
    "  velar build [entry.vel | project-directory] [--out-dir <directory>]",
    "  velar run [entry.vel | project-directory] [-- <program-arguments>...]",
    "  velar verify [project-directory | build-directory]",
    "  velar preview [project-directory | build-directory] [--port <port>]",
    "  velar verify-deployment [project-directory | build-directory] --url <https-origin> [--json]",
    "  velar test [project-directory | file.test.vel]",
    "  velar test [project-directory] --browser [chromium|firefox|webkit|all]",
    "  velar build <single.vel> --out <file.js>",
    "  velar package [project-directory]",
    "  velar format [file.vel | project-directory] [--check]",
    "  velar skill",
    "  velar lsp",
    "  velar --version",
    "",
  ].join("\n"));
}

const commandNames = new Set([
  "check", "create", "install", "add", "remove", "update", "dev", "build", "package", "run", "verify", "preview",
  "verify-deployment", "test", "format", "skill", "lsp",
]);

function printCommandHelp(command: string, output: NodeJS.WritableStream = process.stdout): void {
  const details: Readonly<Record<string, readonly string[]>> = {
    check: ["Usage: velar check [entry.vel | project-directory]", "Type-checks the whole resolved project without writing build output."],
    create: ["Usage: velar create <project-directory> [--template <web|node|desktop|docs|library|component>]", "Creates a transactional Web, Node, or Desktop app, documentation site, Core source library, or Web component source package without installing dependencies."],
    install: ["Usage: velar install", "Installs the current VelarScript project's declared dependencies through npm, then validates the project."],
    add: ["Usage: velar add <package[@version]>... [--dev]", "Adds npm registry packages and activates packages that declare velar.extension metadata."],
    remove: ["Usage: velar remove <package>...", "Removes npm packages and their extension-owned VelarScript project configuration."],
    update: ["Usage: velar update [package...]", "Updates all or selected direct dependencies within package.json ranges through npm."],
    dev: ["Usage: velar dev [entry.vel | project-directory] [--port <1-65535>]", "Runs the development server; the default port is 5173."],
    build: ["Usage: velar build [entry.vel | project-directory] [--out-dir <directory>]", "       velar build <single.vel> --out <file.js>", "Builds isolated framework application output or JavaScript modules."],
    package: ["Usage: velar package [project-directory]", "Packages an application through its target-owned native packaging host."],
    run: ["Usage: velar run [entry.vel | project-directory] [-- <program-arguments>...]", "Compiles the resolved Core project and executes its entry module once on Node.js; arguments after '--' reach the program."],
    verify: ["Usage: velar verify [project-directory | build-directory]", "Verifies the exact production manifest, inventory, sizes, hashes, and relationships."],
    preview: ["Usage: velar preview [project-directory | build-directory] [--port <1-65535>]", "Serves only a verified production build; the default port is 4173."],
    "verify-deployment": ["Usage: velar verify-deployment [project-directory | build-directory] --url <https-origin> [--json]", "Compares verified local bytes, routes, MIME types, and headers with an HTTPS deployment."],
    test: ["Usage: velar test [project-directory | file.test.vel]", "       velar test [project-directory | file.browser.test.vel] --browser[=chromium|firefox|webkit|all]", "Runs Core tests or explicit browser tests; bare --browser defaults to Chromium."],
    format: ["Usage: velar format [file.vel | project-directory] [--check]", "Formats one file or every manifest-owned .vel source; --check never writes."],
    skill: ["Usage: velar skill", "Prints the packaged VelarScript AI skill brief verbatim to stdout for any coding agent."],
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
