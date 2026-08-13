import type { Plugin } from "esbuild";
import { fileURLToPath } from "node:url";
import { formatDiagnostic } from "@velarscript/compiler";
import { compileProject } from "./project.ts";
import { standardModuleSource } from "./standard-modules.ts";

const scriptAnalysisEntry = fileURLToPath(new URL("../../script-analysis/src/index.vel", import.meta.url));

export async function officialToolModulesPlugin(): Promise<Plugin> {
  const project = await compileProject(scriptAnalysisEntry, new Map(), {
    sourceRoot: fileURLToPath(new URL("../../script-analysis/src/", import.meta.url)),
    projectRoot: fileURLToPath(new URL("../../script-analysis/", import.meta.url)),
  });
  const failures = [
    ...project.failures.map((failure) => `${failure.path}: ${failure.message}`),
    ...project.modules.flatMap((module) => module.result.diagnostics
      .map((diagnostic) => formatDiagnostic(module.result.source, diagnostic))),
  ];
  if (failures.length > 0) throw new Error(`Cannot compile official script-analysis package:\n${failures.join("\n\n")}`);
  const textBufferEntry = project.velarPackages.find((package_) => package_.name === "@velarscript/text-buffer")?.entryPath;
  const modules = new Map([
    ["@velarscript/script-analysis", project.modules.find((module) => module.inputPath === scriptAnalysisEntry)?.result.code],
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
