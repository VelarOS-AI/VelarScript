import { chmod, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { build } from "esbuild";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outputFile = resolve(packageRoot, "dist/worker.js");

await mkdir(dirname(outputFile), { recursive: true });
await build({
  entryPoints: [resolve(packageRoot, "native/node/worker.js")],
  outfile: outputFile,
  bundle: true,
  format: "esm",
  platform: "node",
  target: "node24",
  minify: true,
  treeShaking: true,
  sourcemap: false,
  legalComments: "none",
  banner: {
    js: 'import {createRequire as __velarCreateRequire} from "node:module"; import {fileURLToPath as __velarFileURLToPath} from "node:url"; import {dirname as __velarDirname} from "node:path"; const require = __velarCreateRequire(import.meta.url); const __filename = __velarFileURLToPath(import.meta.url); const __dirname = __velarDirname(__filename);',
  },
  logLevel: "silent",
});
await chmod(outputFile, 0o644);
