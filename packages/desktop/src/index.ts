import { VELAR_DESKTOP_API_VERSION } from "./config.ts";

export { VELAR_DESKTOP_API_VERSION } from "./config.ts";
export type { DesktopPermissionConfig, DesktopWindowConfig, VelarDesktopConfig } from "./config.ts";

export const VELAR_DESKTOP_MODULES = Object.freeze([
  "velar/desktop",
  "velar/desktop-test",
  "velar/fs",
  "velar/path",
  "velar/process",
  "velar/http",
  "velar/env",
] as const);

export const velarDesktopFramework = Object.freeze({
  name: "@velarscript/desktop",
  apiVersion: VELAR_DESKTOP_API_VERSION,
  modules: VELAR_DESKTOP_MODULES,
  programmingModel: "single-project" as const,
  renderer: "@velarscript/web" as const,
  capabilityHost: "@velarscript/node" as const,
});
