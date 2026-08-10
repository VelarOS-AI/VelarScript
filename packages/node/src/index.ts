import { VELAR_NODE_API_VERSION } from "./compiler.ts";

export { VELAR_NODE_API_VERSION } from "./compiler.ts";

export const VELAR_NODE_MODULES = Object.freeze([
  "velar/serve",
  "velar/fs",
  "velar/env",
  "velar/host",
  "velar/terminal",
  "velar/path",
  "velar/process",
  "velar/http",
] as const);

export interface VelarNodeRuntimeManifest {
  readonly name: "@velarscript/node";
  readonly apiVersion: string;
  readonly modules: typeof VELAR_NODE_MODULES;
}

export const velarNodeRuntime: VelarNodeRuntimeManifest = Object.freeze({
  name: "@velarscript/node",
  apiVersion: VELAR_NODE_API_VERSION,
  modules: VELAR_NODE_MODULES,
});
