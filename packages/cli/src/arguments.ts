/**
 * Every `velar` command's argument shape and the parser that produces it.
 *
 * A parser answers with the parsed shape or with the one-line problem the
 * command prints; nothing here touches the filesystem, resolves a project, or
 * writes to a stream, so an arm's argument rules can be read without reading
 * the arm.
 */

import { extname } from "node:path";
import type { BrowserEngineSelection } from "./browser-test-runner.ts";
import type { JavaScriptBuildMode } from "./javascript-output.ts";

export interface CommandArguments {
  readonly input: string | null;
  readonly output: string | null;
  readonly outputDirectory: string | null;
  readonly force: boolean;
  /** 仅 `build` 接受；null 表示读取项目配置。 */
  readonly mode: JavaScriptBuildMode | null;
  /** 仅 `build` 接受；null 表示读取独立的 build.sourceMaps 配置。 */
  readonly sourceMaps: boolean | null;
}

export interface BuildLibraryArguments {
  readonly input: string | null;
  readonly mode: JavaScriptBuildMode | null;
}

export interface FormatArguments {
  readonly input: string | null;
  readonly check: boolean;
}

export interface DevArguments {
  readonly input: string | null;
  readonly port: number | null;
}

export interface ServeArguments {
  readonly input: string | null;
}

export interface TestArguments {
  readonly input: string | null;
  readonly browser: BrowserEngineSelection | null;
  readonly fullStack: boolean;
}

export interface PreviewArguments {
  readonly input: string | null;
  readonly port: number;
}

export interface RunArguments {
  readonly input: string | null;
  readonly programArguments: readonly string[];
  readonly fullStack: boolean;
}

export interface ReproArguments {
  readonly input: string | null;
  readonly outputDirectory: string | null;
}

export interface DeploymentVerificationArguments {
  readonly input: string | null;
  readonly url: string | null;
  readonly json: boolean;
}

export interface GraphArguments {
  readonly input: string | null;
  readonly json: boolean;
  readonly focus: string | null;
  readonly depth: number;
  readonly maximumNodes: number;
  readonly maximumEdges: number;
}

export function parseFormatArguments(arguments_: readonly string[]): FormatArguments | string {
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

export function parseCommandArguments(arguments_: readonly string[], allowForce = false): CommandArguments | string {
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
    } else if (allowForce && (argument === "--out" || argument === "--out-dir")) {
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

export function parseBuildLibraryArguments(arguments_: readonly string[]): BuildLibraryArguments | string {
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

export function parseReproArguments(arguments_: readonly string[]): ReproArguments | string {
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

export function parsePackageArguments(arguments_: readonly string[]): CommandArguments | string {
  if (arguments_.length > 1) return `unexpected extra input '${arguments_[1]}'`;
  if (arguments_[0]?.startsWith("-")) return `unknown option '${arguments_[0]}'`;
  return { input: arguments_[0] ?? null, output: null, outputDirectory: null, force: false, mode: null, sourceMaps: null };
}

export function parseDevArguments(arguments_: readonly string[]): DevArguments | string {
  let input: string | null = null;
  let port: number | null = null;
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index]!;
    if (argument === "--port") {
      const value = arguments_[index + 1];
      const parsed = value ? Number(value) : Number.NaN;
      if (!Number.isInteger(parsed) || parsed < 0 || parsed > 65_535) return "--port requires an integer from 0 to 65535, where 0 is any free port";
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

export function parseServeArguments(arguments_: readonly string[]): ServeArguments | string {
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

export function parseTestArguments(arguments_: readonly string[]): TestArguments | string {
  let input: string | null = null;
  let browser: BrowserEngineSelection | null = null;
  let fullStack = false;
  const engines = new Set<BrowserEngineSelection>(["chromium", "firefox", "webkit", "all"]);
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index]!;
    if (argument === "--stack") {
      if (fullStack) return "--stack may be provided only once";
      fullStack = true;
    } else if (argument === "--browser") {
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
  return { input, browser, fullStack };
}

export function parseRunArguments(arguments_: readonly string[]): RunArguments | string {
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

export function helpRequested(command: string, arguments_: readonly string[]): boolean {
  const separator = command === "run" ? arguments_.indexOf("--") : -1;
  const visible = separator === -1 ? arguments_ : arguments_.slice(0, separator);
  return visible.some((argument) => argument === "--help" || argument === "-h");
}

export function parseSingleOptionalInput(arguments_: readonly string[]): string | null | { readonly error: string } {
  if (arguments_.some((argument) => argument.startsWith("--"))) {
    return { error: `unknown option '${arguments_.find((argument) => argument.startsWith("--"))}'` };
  }
  if (arguments_.length > 1) return { error: `unexpected extra input '${arguments_[1]}'` };
  return arguments_[0] ?? null;
}

export const MAXIMUM_GRAPH_SOURCE_NODES = 20_000;
export const MAXIMUM_GRAPH_SOURCE_EDGES = 40_000;

function parseGraphBound(option: string, value: string | undefined, maximum: number): number | string {
  const parsed = value ? Number(value) : Number.NaN;
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > maximum) {
    return `${option} requires an integer from 1 through ${maximum}`;
  }
  return parsed;
}

export function parseGraphArguments(arguments_: readonly string[]): GraphArguments | string {
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

export function parsePreviewArguments(arguments_: readonly string[]): PreviewArguments | string {
  let input: string | null = null;
  let port = 4173;
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index]!;
    if (argument === "--port") {
      const value = arguments_[index + 1];
      const parsed = value ? Number(value) : Number.NaN;
      // GA-U5: `--port 0` means "any free port" here for the same reason it
      // does for `velar dev` — both servers report the port they bound rather
      // than the one they were asked for, so the two commands take one rule.
      if (!Number.isInteger(parsed) || parsed < 0 || parsed > 65_535) return "--port requires an integer from 0 to 65535, where 0 is any free port";
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

export function parseDeploymentVerificationArguments(arguments_: readonly string[]): DeploymentVerificationArguments | string {
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
