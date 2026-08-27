import { VELAR_SERVER_API_VERSION } from "./compiler.ts";

export { VELAR_SERVER_API_VERSION } from "./compiler.ts";
export {velarProjectExtension, type VelarServerConfig} from "./project-config.ts";

export const VELAR_SERVER_MODULES = Object.freeze([
  "velar/server",
  "velar/realtime",
] as const);

export interface VelarServerFrameworkManifest {
  readonly name: "@velarscript/server";
  readonly apiVersion: string;
  readonly modules: typeof VELAR_SERVER_MODULES;
}

export const velarServerFramework: VelarServerFrameworkManifest = Object.freeze({
  name: "@velarscript/server",
  apiVersion: VELAR_SERVER_API_VERSION,
  modules: VELAR_SERVER_MODULES,
});
