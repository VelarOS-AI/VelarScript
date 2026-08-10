import { VELAR_WEB_API_VERSION } from "./compiler.ts";

export { VELAR_WEB_API_VERSION } from "./compiler.ts";

export const VELAR_WEB_MODULES = Object.freeze([
  "velar/look",
  "velar/app",
  "velar/config",
  "velar/web",
  "velar/forms",
  "velar/http",
  "velar/storage",
  "velar/browser",
  "velar/files",
  "velar/realtime",
  "velar/web-test",
] as const);

export interface VelarWebFrameworkManifest {
  readonly name: "@velarscript/web";
  readonly apiVersion: string;
  readonly modules: typeof VELAR_WEB_MODULES;
}

export const velarWebFramework: VelarWebFrameworkManifest = Object.freeze({
  name: "@velarscript/web",
  apiVersion: VELAR_WEB_API_VERSION,
  modules: VELAR_WEB_MODULES,
});

export { webModuleSource, webModuleSources, type VelarWebRuntimeConfig } from "./runtime.ts";
export { velarProjectExtension, type VelarWebConfig } from "./project-config.ts";
