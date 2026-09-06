import { isBuiltin } from "node:module";
import type { Plugin, PluginBuild } from "esbuild";

const NODE_BUILTIN_NAMESPACE = "velar-node-commonjs-builtin";

/**
 * Converts literal CommonJS loads of Node builtins into lazy, capability-narrow
 * wrappers. Ordinary package `require` edges remain visible to esbuild and are
 * bundled; the emitted ESM receives no ambient `require` capability.
 */
export const NODE_ESM_COMMONJS_RUNTIME_PLUGIN: Plugin = Object.freeze({
  name: "velar-node-commonjs-builtins",
  setup(context: PluginBuild) {
    context.onResolve({ filter: /.*/ }, (arguments_) => (
      arguments_.kind === "require-call" && isBuiltin(arguments_.path)
        ? { path: arguments_.path, namespace: NODE_BUILTIN_NAMESPACE }
        : null
    ));
    context.onLoad({ filter: /.*/, namespace: NODE_BUILTIN_NAMESPACE }, (arguments_) => {
      const specifier = JSON.stringify(arguments_.path);
      return {
        contents: [
          'import { getBuiltinModule } from "node:process";',
          `const value = getBuiltinModule(${specifier});`,
          `if (value === undefined) throw new Error("Node runtime cannot load builtin " + ${specifier});`,
          "module.exports = value;",
        ].join("\n"),
        loader: "js",
      };
    });
  },
});
