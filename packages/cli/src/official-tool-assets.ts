import { readFile } from "node:fs/promises";
import type { Plugin } from "esbuild";
import { standardModuleSource } from "./standard-modules.ts";

export async function embeddedStandardAssetsPlugin(): Promise<Plugin> {
  const [javascriptSource, textBufferSource] = await Promise.all([
    readFile(new URL("../stdlib/javascript.vel", import.meta.url), "utf8"),
    readFile(new URL("../stdlib/text-buffer.vel", import.meta.url), "utf8"),
  ]);
  return {
    name: "velar-embedded-standard-assets",
    setup(build) {
      build.onResolve({ filter: /^velar\// }, (args) => ({ path: args.path, namespace: "velar-standard-module" }));
      build.onLoad({ filter: /.*/, namespace: "velar-standard-module" }, (args) => {
        const contents = standardModuleSource(args.path);
        if (contents === null) throw new Error(`Official tool requested unknown standard module '${args.path}'`);
        return { contents, loader: "js" };
      });
      build.onResolve({ filter: /^\.\/embedded-standard-assets\.(?:ts|js)$/ }, (args) => /standard-modules\.(?:ts|js)$/u.test(args.importer)
        ? { path: "velar:embedded-standard-assets", namespace: "velar-tool" }
        : null);
      build.onLoad({ filter: /^velar:embedded-standard-assets$/, namespace: "velar-tool" }, () => ({
        contents: `const assets = new Map([["javascript.vel", ${JSON.stringify(javascriptSource)}], ["text-buffer.vel", ${JSON.stringify(textBufferSource)}]]); export function embeddedStandardAsset(name) { return assets.get(name) ?? null; }`,
        loader: "js",
      }));
    },
  };
}
