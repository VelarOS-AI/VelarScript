import type { Plugin } from "esbuild";
import { readFile } from "node:fs/promises";
import { findPackageJSON } from "node:module";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { formatDiagnostic } from "@velarscript/compiler";
import { compileProject } from "./project.ts";
import { standardModuleSource } from "./standard-modules.ts";

async function sourcePackage(name: string): Promise<{ root: string; entry: string }> {
  const manifestPath = findPackageJSON(name, import.meta.url);
  if (!manifestPath) throw new Error(`Official tool dependency '${name}' is not installed`);
  const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as { velar?: { entry?: unknown } };
  const declared = manifest.velar?.entry;
  if (typeof declared !== "string" || declared.length === 0 || isAbsolute(declared)) {
    throw new Error(`Official tool dependency '${name}' has no valid velar.entry`);
  }
  const root = dirname(manifestPath);
  const entry = resolve(root, declared);
  const inside = relative(root, entry);
  if (inside === "" || inside === ".." || inside.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) || isAbsolute(inside)) {
    throw new Error(`Official tool dependency '${name}' has a velar.entry outside its package root`);
  }
  return { root, entry };
}

export async function officialToolModulesPlugin(): Promise<Plugin> {
  const scriptAnalysis = await sourcePackage("@velarscript/script-analysis");
  const project = await compileProject(scriptAnalysis.entry, new Map(), {
    sourceRoot: dirname(scriptAnalysis.entry),
    projectRoot: scriptAnalysis.root,
  });
  const failures = [
    ...project.failures.map((failure) => `${failure.path}: ${failure.message}`),
    ...project.modules.flatMap((module) => module.result.diagnostics
      .map((diagnostic) => formatDiagnostic(module.result.source, diagnostic))),
  ];
  if (failures.length > 0) throw new Error(`Cannot compile official script-analysis package:\n${failures.join("\n\n")}`);
  const textBufferEntry = project.velarPackages.find((package_) => package_.name === "@velarscript/text-buffer")?.entryPath;
  const modules = new Map([
    ["@velarscript/script-analysis", project.modules.find((module) => module.inputPath === scriptAnalysis.entry)?.result.code],
    ["@velarscript/text-buffer", project.modules.find((module) => module.inputPath === textBufferEntry)?.result.code],
  ]);
  for (const [source, code] of modules) if (!code) throw new Error(`Official tool package '${source}' did not emit JavaScript`);
  return {
    name: "velar-official-tool-modules",
    setup(build) {
      build.onResolve({ filter: /^velar\// }, (args) => ({ path: args.path, namespace: "velar-standard-module" }));
      build.onLoad({ filter: /.*/, namespace: "velar-standard-module" }, (args) => {
        const contents = standardModuleSource(args.path);
        if (contents === null) throw new Error(`Official tool requested unknown standard module '${args.path}'`);
        return { contents, loader: "js" };
      });
      build.onResolve({ filter: /^@velarscript\/(?:script-analysis|text-buffer)$/ }, (args) => ({ path: args.path, namespace: "velar-tool-package" }));
      build.onLoad({ filter: /.*/, namespace: "velar-tool-package" }, (args) => ({ contents: modules.get(args.path)!, loader: "js" }));
    },
  };
}
