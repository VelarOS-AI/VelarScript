import assert from "node:assert/strict";
import test from "node:test";
import type { Metafile } from "esbuild";
import { productionEntryOutput } from "../packages/cli/src/production-build.ts";

test("production HTML selects the checked application entry instead of a dependency split point", () => {
  const projectRoot = "/workspace/project";
  const applicationEntry = "/workspace/project/apps/web/src/main.vel";
  const output = (entryPoint: string): Metafile["outputs"][string] => ({
    bytes: 1,
    entryPoint,
    exports: [],
    imports: [],
    inputs: {},
  });
  const shaderChunk = output("node_modules/render-engine/shaders/bilateralBlur.fragment.js");
  const application = output("apps/web/src/main.vel");
  const metafile: Metafile = {
    inputs: {},
    outputs: {
      "dist/assets/chunk-bilateralBlur.fragment-AAAA.js": shaderChunk,
      "dist/assets/main-BBBB.js": application,
    },
  };

  assert.deepEqual(
    productionEntryOutput(metafile, projectRoot, applicationEntry),
    ["dist/assets/main-BBBB.js", application],
  );
});

test("production entry selection fails closed when only dependency split points exist", () => {
  const metafile: Metafile = {
    inputs: {},
    outputs: {
      "dist/assets/chunk-shader-AAAA.js": {
        bytes: 1,
        entryPoint: "node_modules/render-engine/shader.js",
        exports: [],
        imports: [],
        inputs: {},
      },
    },
  };

  assert.equal(
    productionEntryOutput(metafile, "/workspace/project", "/workspace/project/src/main.vel"),
    undefined,
  );
});
