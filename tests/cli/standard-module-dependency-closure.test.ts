import assert from "node:assert/strict";
import test from "node:test";
import { type CompilerExtension } from "@velarscript/compiler";
import { standardModuleApi as standardModuleApiCore, standardModuleClosure, standardModuleDependencies } from "../../packages/cli/src/standard-modules.ts";

/**
 * D115 P5 — the runtime dependency closure, one subject of the file that was
 * `shared-runtime-validation.test.ts` before it reached 796 lines.
 *
 * What is held here is the walk itself, over an extension's own synthetic
 * modules rather than over the compiler's: a root's dependencies materialize
 * transitively and in order, an extension listed first replaces the module a
 * later one declares, a dependency nobody publishes is an error with the pair
 * named in it, and none of the three becomes a module a program may import.
 * The body below is the body that file had.
 */

test("extension runtime dependencies materialize transitively without becoming public modules", () => {
  const root = "velar/compiler-test-root-v1";
  const middle = "velar/compiler-test-middle-v1";
  const leaf = "velar/compiler-test-leaf-v1";
  const extension: CompilerExtension = {
    id: "test-runtime-dependencies",
    modules: {
      interfaces: new Map(),
      sources: new Map([[root, `import ${JSON.stringify(middle)};`], [middle, `import ${JSON.stringify(leaf)};`], [leaf, "export const ready = true;"]]),
      dependencies: new Map([[root, [middle]], [middle, [leaf]]]),
    },
  };
  assert.deepEqual([...standardModuleClosure([root], {}, [extension])], [root, middle, leaf]);
  assert.deepEqual(standardModuleDependencies(root, {}, [extension]), [middle]);
  assert.equal(standardModuleApiCore([extension]).modules[root], undefined);

  const replacement: CompilerExtension = {
    id: "test-runtime-replacement",
    modules: { interfaces: new Map(), sources: new Map([[root, "export const replaced = true;"]]) },
  };
  assert.deepEqual([...standardModuleClosure([root], {}, [replacement, extension])], [root]);

  const broken: CompilerExtension = {
    id: "test-runtime-broken",
    modules: {
      interfaces: new Map(),
      sources: new Map([[root, "export const broken = true;"]]),
      dependencies: new Map([[root, ["velar/compiler-test-missing-v1"]]]),
    },
  };
  assert.throws(
    () => standardModuleClosure([root], {}, [broken]),
    /standard module 'velar\/compiler-test-root-v1' depends on unknown module 'velar\/compiler-test-missing-v1'/u,
  );
});
