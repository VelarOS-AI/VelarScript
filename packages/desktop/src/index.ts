import { VELAR_DESKTOP_API_VERSION } from "./config.ts";

export {
  DESKTOP_MAIN_WINDOW_KIND,
  DESKTOP_SERVICE_LIMIT,
  DESKTOP_WINDOW_KIND_LIMIT,
  DESKTOP_WINDOWS_MIGRATION_MESSAGE,
  VELAR_DESKTOP_API_VERSION,
  desktopExternalNavigationPermitted,
} from "./config.ts";
export type {
  DesktopFileScope,
  DesktopLinkScheme,
  DesktopPermissionConfig,
  DesktopServiceConfig,
  DesktopServiceRestart,
  DesktopWindowConfig,
  DesktopWindowLevel,
  DesktopWindowMaterial,
  DesktopWindowStyle,
  DesktopWindowTitleBar,
  VelarDesktopConfig,
} from "./config.ts";
export { migrateDesktopManifestText } from "./manifest-migration.ts";

export const VELAR_DESKTOP_MODULES = Object.freeze([
  "velar/desktop",
  "velar/desktop-test",
  "velar/window",
  "velar/service",
  "velar/notification",
  "velar/secure-storage",
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
