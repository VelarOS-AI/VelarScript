/**
 * The Desktop compiler extension: one explicit application composition of the
 * public Web surface and the Node capability contracts Desktop grants.
 *
 * D115 §三 — this file is the composition and nothing else. One interface table
 * per module lives in `interfaces/<module>.ts`, the runtime each module is made
 * of lives in `runtime/<module>.js` and reaches TypeScript through the generated
 * `runtime-sources.generated.ts`, and the five modules a project's manifest
 * closes over are assembled in `modules/<module>.ts`.
 */
import type { CompilerExtension, ModuleInterface } from "@velarscript/compiler";
import { velarCompilerExtension as webCompilerExtension, webModuleSource } from "@velarscript/web/compiler";
import { nodeModuleInterfaces, VELAR_NODE_API_VERSION } from "@velarscript/node/compiler";
import { DESKTOP_MAIN_WINDOW_KIND, VELAR_DESKTOP_API_VERSION, velarProjectExtension, type VelarDesktopConfig } from "./config.ts";
import {
  DESKTOP_ENV_SOURCE,
  DESKTOP_FS_SOURCE,
  DESKTOP_HTTP_SOURCE,
  DESKTOP_PATH_SOURCE,
  DESKTOP_PROCESS_SOURCE,
  DESKTOP_TEST_SOURCE,
} from "./runtime-sources.generated.ts";
import { desktopModuleInterface } from "./interfaces/desktop.ts";
import { desktopTestModuleInterface } from "./interfaces/desktop-test.ts";
import { notificationModuleInterface } from "./interfaces/notification.ts";
import { secureStorageModuleInterface } from "./interfaces/secure-storage.ts";
import { serviceModuleInterface } from "./interfaces/service.ts";
import { windowModuleInterface } from "./interfaces/window.ts";
import { desktopModuleSource } from "./modules/desktop.ts";
import { desktopNotificationSource } from "./modules/notification.ts";
import { desktopSecureStorageSource } from "./modules/secure-storage.ts";
import { desktopServiceSource } from "./modules/service.ts";
import { desktopWindowSource } from "./modules/window.ts";

const nodeProcessInterface = nodeModuleInterfaces.get("velar/process")!;
const desktopProcessInterface: ModuleInterface = nodeProcessInterface;

const desktopModuleInterfaces = new Map(webCompilerExtension.modules!.interfaces);
desktopModuleInterfaces.set("velar/desktop", desktopModuleInterface);
desktopModuleInterfaces.set("velar/desktop-test", desktopTestModuleInterface);
desktopModuleInterfaces.set("velar/window", windowModuleInterface);
desktopModuleInterfaces.set("velar/service", serviceModuleInterface);
desktopModuleInterfaces.set("velar/notification", notificationModuleInterface);
desktopModuleInterfaces.set("velar/secure-storage", secureStorageModuleInterface);
desktopModuleInterfaces.set("velar/fs", nodeModuleInterfaces.get("velar/fs")!);
desktopModuleInterfaces.set("velar/path", nodeModuleInterfaces.get("velar/path")!);
desktopModuleInterfaces.set("velar/process", desktopProcessInterface);
desktopModuleInterfaces.set("velar/http", nodeModuleInterfaces.get("velar/http")!);
desktopModuleInterfaces.set("velar/env", nodeModuleInterfaces.get("velar/env")!);
const desktopModuleSources = new Map(webCompilerExtension.modules!.sources);
const desktopModuleDependencies = new Map(webCompilerExtension.modules!.dependencies);
// The fallback sources outside a resolved project know only what every manifest
// declares by default: the one window kind, and no permission at all. `source()`
// below closes each module over the project's own `desktop` section whenever the
// project config is at hand, so the ungranted fallback is what a caller outside
// a project gets, and it fails closed.
desktopModuleSources.set("velar/desktop", desktopModuleSource([], false));
desktopModuleSources.set("velar/desktop-test", DESKTOP_TEST_SOURCE);
desktopModuleSources.set("velar/window", desktopWindowSource([DESKTOP_MAIN_WINDOW_KIND]));
desktopModuleSources.set("velar/service", desktopServiceSource([]));
desktopModuleSources.set("velar/notification", desktopNotificationSource(false));
desktopModuleSources.set("velar/secure-storage", desktopSecureStorageSource([]));
desktopModuleSources.set("velar/fs", DESKTOP_FS_SOURCE);
desktopModuleSources.set("velar/path", DESKTOP_PATH_SOURCE);
desktopModuleSources.set("velar/process", DESKTOP_PROCESS_SOURCE);
desktopModuleSources.set("velar/http", DESKTOP_HTTP_SOURCE);
desktopModuleSources.set("velar/env", DESKTOP_ENV_SOURCE);

export const velarCompilerExtension: CompilerExtension = Object.freeze({
  id: "@velarscript/desktop",
  contract: Object.freeze({
    protocolVersion: 1,
    apiVersion: VELAR_DESKTOP_API_VERSION,
    kind: "application",
    extends: Object.freeze({}),
    composes: Object.freeze({
      "@velarscript/web": webCompilerExtension.contract!.apiVersion,
      "@velarscript/node": VELAR_NODE_API_VERSION,
    }),
  }),
  capabilities: Object.freeze(["web", "desktop"]),
  // Desktop is an application composition: Web owns surface syntax,
  // reactivity, DOM lowering, and browser runtime; Desktop owns only its
  // capability modules and host bridge. Keep each layer explicit so adding a
  // future application target cannot inherit hidden Web behavior via spread.
  lexical: webCompilerExtension.lexical!,
  parser: webCompilerExtension.parser!,
  syntax: webCompilerExtension.syntax!,
  analyzer: webCompilerExtension.analyzer!,
  semantic: webCompilerExtension.semantic!,
  inspection: webCompilerExtension.inspection!,
  analysis: webCompilerExtension.analysis!,
  editor: webCompilerExtension.editor!,
  formatting: webCompilerExtension.formatting!,
  createEmitter: webCompilerExtension.createEmitter!,
  modules: Object.freeze({
    apiVersion: VELAR_DESKTOP_API_VERSION,
    interfaces: desktopModuleInterfaces,
    sources: desktopModuleSources,
    dependencies: desktopModuleDependencies,
    source(specifier: string, projectConfig: unknown) {
      const desktop = projectConfig as VelarDesktopConfig | undefined;
      if (specifier === "velar/window") {
        const windows = desktop?.windows;
        return desktopWindowSource(windows ? Object.keys(windows) : [DESKTOP_MAIN_WINDOW_KIND]);
      }
      if (specifier === "velar/service") return desktopServiceSource(Object.keys(desktop?.services ?? {}));
      // A caller outside a resolved Desktop project — the standard-module
      // closure, a documentation fence, a runtime gate — passes a config that
      // has no `desktop` section at all, and gets the ungranted module: every
      // permission-bearing call in it fails closed and says which declaration
      // is missing.
      const permissions = desktop?.permissions as VelarDesktopConfig["permissions"] | undefined;
      if (specifier === "velar/desktop") {
        return desktopModuleSource(permissions?.links ?? [], permissions?.files.includes("dropped") ?? false);
      }
      if (specifier === "velar/notification") return desktopNotificationSource(permissions?.notifications ?? false);
      if (specifier === "velar/secure-storage") return desktopSecureStorageSource(permissions?.secureStorage ?? []);
      if (specifier === "velar/desktop-test") return DESKTOP_TEST_SOURCE;
      if (specifier === "velar/fs") return DESKTOP_FS_SOURCE;
      if (specifier === "velar/path") return DESKTOP_PATH_SOURCE;
      if (specifier === "velar/process") return DESKTOP_PROCESS_SOURCE;
      if (specifier === "velar/http") return DESKTOP_HTTP_SOURCE;
      const config = projectConfig as VelarDesktopConfig;
      return webModuleSource(specifier, { base: "/", publicConfig: { desktop: { identifier: config.identifier } } });
    },
  }),
});

export { velarProjectExtension, type VelarDesktopConfig } from "./config.ts";