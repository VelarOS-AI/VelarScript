import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { standardModuleDependencies, standardModuleSource } from "../../packages/cli/src/standard-modules.ts";
import { nodeModuleDependencies, nodeModuleSources } from "../../packages/node/src/compiler.ts";

/**
 * D115 §一.6: the one copy of the helpers that load an emitted Node runtime
 * module and hand it a compiler-shaped RoutePattern. A direct runtime test
 * imports the module the compiler emits, materializes its dependency closure
 * beside it, and drives it exactly as generated code would — which is what
 * makes it a test of the shipped runtime rather than of a re-implementation.
 */

/**
 * One child process, run to completion, with its two streams collected.
 *
 * It lived at the bottom of `node-platform.slow.test.ts` until D114 GA-U3 split
 * that file's quick cases out of it; both halves drive emitted runtimes through
 * a real process, so §一.6 puts the one copy here rather than in either.
 */
export function runProcess(
  command: string,
  arguments_: readonly string[],
  cwd: string,
  env: NodeJS.ProcessEnv,
  input?: string,
): Promise<{ readonly code: number | null; readonly stdout: string; readonly stderr: string }> {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(command, arguments_, { cwd, env, stdio: "pipe" });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => { stdout += chunk.toString("utf8"); });
    child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString("utf8"); });
    child.once("error", rejectRun);
    child.once("exit", (code) => resolveRun({ code, stdout, stderr }));
    child.stdin.end(input ?? "");
  });
}

export type ServeCompilerBridge = {
  createPattern(source: Record<string, unknown>): unknown;
};

export type TestQueryCapture = {
  readonly name: string;
  readonly kind: "string" | "number" | "bool";
  readonly optional?: boolean;
  readonly wireName?: string;
};

/** Direct runtime tests build exactly the same immutable RoutePattern structure as the compiler. */
export function routePattern(bridge: ServeCompilerBridge, pathname: string, query: readonly TestQueryCapture[] = []): unknown {
  const captures = [...pathname.matchAll(/\{([A-Za-z_][A-Za-z0-9_]*):(string|number|bool)\}/gu)].map((match) => {
    const kind = match[2]!;
    return {
      name: match[1], wireName: match[1], explicitWireName: false, typeName: kind, optional: false, kind,
      check: kind === "number" ? (value: unknown) => typeof value === "number"
        : kind === "bool" ? (value: unknown) => typeof value === "boolean"
          : (value: unknown) => typeof value === "string",
      schema: {type: kind === "bool" ? "boolean" : kind},
    };
  });
  const queryCaptures = query.map((capture) => ({
    name: capture.name,
    wireName: capture.wireName ?? capture.name,
    explicitWireName: capture.wireName !== undefined,
    typeName: capture.kind,
    optional: capture.optional === true,
    kind: capture.kind,
    check: capture.kind === "number" ? (value: unknown) => typeof value === "number"
      : capture.kind === "bool" ? (value: unknown) => typeof value === "boolean"
        : (value: unknown) => typeof value === "string",
    schema: {type: capture.kind === "bool" ? "boolean" : capture.kind},
  }));
  const definition = queryCaptures.length === 0
    ? pathname
    : `${pathname}?${queryCaptures.map((capture) => `${capture.explicitWireName ? `${capture.wireName}=` : ""}{${capture.name}:${capture.typeName}${capture.optional ? "?" : ""}}`).join("&")}`;
  return bridge.createPattern({definition, pathname, path: captures, query: queryCaptures});
}

export async function runtime<T>(
  name: string,
  transform: (source: string) => string = (source) => source,
  transformDependency: (name: string, source: string) => string = (_name, source) => source,
): Promise<T> {
  const source = nodeModuleSources.get(name);
  assert.ok(source, `${name} must have a Node runtime source`);
  const directory = await mkdtemp(join(tmpdir(), "velar-node-runtime-"));
  await materializeNodeRuntimeDependencies(directory, name, transformDependency);
  const path = join(directory, `${name.slice("velar/".length)}.mjs`);
  await writeFile(path, transform(source), "utf8");
  const module = await import(`${pathToFileURL(path).href}?test=${Date.now()}`) as T;
  await rm(directory, { recursive: true, force: true });
  return module;
}

export async function materializeNodeRuntimeDependencies(
  directory: string,
  source: string,
  transform: (name: string, source: string) => string = (_name, value) => value,
): Promise<void> {
  const dependencies = new Set<string>();
  const visit = (name: string): void => {
    for (const dependency of nodeModuleDependencies.get(name) ?? standardModuleDependencies(name) ?? []) {
      if (dependencies.has(dependency)) continue;
      dependencies.add(dependency);
      visit(dependency);
    }
  };
  visit(source);
  if (dependencies.size === 0) return;
  const root = join(directory, "node_modules", "velar");
  await mkdir(root, {recursive: true});
  const exports_: Record<string, string> = {};
  for (const dependency of dependencies) {
    // A Node runtime module may depend on a compiler-owned Core runtime module
    // (D50 rule 89 put the nameable capability error classes there), so the
    // materializer resolves both registries.
    const moduleSource = nodeModuleSources.get(dependency) ?? standardModuleSource(dependency);
    assert.ok(moduleSource, `missing Node runtime dependency ${dependency}`);
    const name = dependency.slice("velar/".length);
    exports_[`./${name}`] = `./${name}.js`;
    await writeFile(join(root, `${name}.js`), transform(dependency, moduleSource), "utf8");
  }
  await writeFile(join(root, "package.json"), JSON.stringify({name: "velar", private: true, type: "module", exports: exports_}), "utf8");
}
