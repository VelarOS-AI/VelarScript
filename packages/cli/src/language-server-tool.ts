import { chmod, mkdir, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

export const VELAR_LANGUAGE_SERVER_TOOL_ID = "velar-language-server";

export async function buildLanguageServerTool(outputFile: string): Promise<void> {
  outputFile = resolve(outputFile);
  const sourceExtension = import.meta.url.endsWith(".ts") ? "ts" : "js";
  const textBufferSource = await readFile(fileURLToPath(new URL("../stdlib/text-buffer.vel", import.meta.url)), "utf8");
  await mkdir(dirname(outputFile), { recursive: true });
  await build({
    entryPoints: [fileURLToPath(new URL(`./language-server-bundle-entry.${sourceExtension}`, import.meta.url))],
    outfile: outputFile,
    bundle: true,
    format: "esm",
    platform: "node",
    target: "node24",
    minify: true,
    treeShaking: true,
    sourcemap: false,
    legalComments: "none",
    logLevel: "silent",
    plugins: [{
      name: "velar-embedded-standard-assets",
      setup(build) {
        build.onResolve({ filter: /^\.\/embedded-standard-assets\.(?:ts|js)$/ }, (args) => /standard-modules\.(?:ts|js)$/u.test(args.importer)
          ? { path: "velar:embedded-standard-assets", namespace: "velar-tool" }
          : null);
        build.onLoad({ filter: /^velar:embedded-standard-assets$/, namespace: "velar-tool" }, () => ({
          contents: `const assets = new Map([["text-buffer.vel", ${JSON.stringify(textBufferSource)}]]); export function embeddedStandardAsset(name) { return assets.get(name) ?? null; }`,
          loader: "js",
        }));
      },
    }],
  });
  await chmod(outputFile, 0o644);
}
