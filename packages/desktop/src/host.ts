import {
  VELAR_FRAMEWORK_HOST_PROTOCOL_VERSION,
  type FrameworkHostArtifactsInput,
  type FrameworkHostErrorDocumentInput,
  type FrameworkHostProjectValidationInput,
  type FrameworkHostExtension,
} from "@velarscript/compiler/framework-host";
import { createWebArtifacts, createWebErrorDocument, velarFrameworkHost as webHost, webStaticDeployment } from "@velarscript/web/host";
import { VELAR_DESKTOP_API_VERSION, type VelarDesktopConfig } from "./config.ts";
import { desktopBrowserTestController } from "./test-runtime.ts";

export const velarFrameworkHost: FrameworkHostExtension = Object.freeze({
  protocolVersion: VELAR_FRAMEWORK_HOST_PROTOCOL_VERSION,
  id: "@velarscript/desktop",
  capability: "desktop",
  displayName: "Desktop",
  target: "browser",
  apiVersion: VELAR_DESKTOP_API_VERSION,
  artifactKind: "velar-desktop-renderer",
  base() {
    return "/";
  },
  sourceMaps() {
    return false;
  },
  prepareStyles(_config: unknown, styles: string) {
    return webHost.prepareStyles?.(webConfig(_config), styles) ?? styles;
  },
  createArtifacts(input: FrameworkHostArtifactsInput) {
    return createWebArtifacts({ ...input, config: webConfig(input.config) });
  },
  createErrorDocument(input: FrameworkHostErrorDocumentInput) {
    return createWebErrorDocument({ ...input, config: webConfig(input.config) });
  },
  staticDeployment(config: unknown) {
    return webStaticDeployment(webConfig(config));
  },
  browserTests: Object.freeze({
    sourceSuffix: ".browser.test.vel",
    runtimeKey: "velar.browser.test.v1",
    createController(config: unknown) {
      return desktopBrowserTestController(config as VelarDesktopConfig);
    },
  }),
  validateProject(input: FrameworkHostProjectValidationInput) {
    const config = input.config as VelarDesktopConfig;
    const imports = new Set(input.modules.flatMap((module) => module.imports));
    const failures: string[] = [];
    if (imports.has("velar/fs") && config.permissions.files.length === 0) {
      failures.push("Desktop source imports 'velar/fs' but desktop.permissions.files grants no file root");
    }
    if (imports.has("velar/process") && config.permissions.processes.length === 0) {
      failures.push("Desktop source imports 'velar/process' but desktop.permissions.processes grants no executable");
    }
    if (imports.has("velar/http") && config.permissions.network.length === 0) {
      failures.push("Desktop source imports 'velar/http' but desktop.permissions.network grants no origin");
    }
    if (imports.has("velar/env") && config.permissions.environment.length === 0) {
      failures.push("Desktop source imports 'velar/env' but desktop.permissions.environment grants no variable");
    }
    return Object.freeze(failures);
  },
});

function webConfig(value: unknown) {
  const config = value as VelarDesktopConfig;
  return {
    title: config.window.title,
    base: "/",
    // A desktop window has no browser tab; its icon is the packaged
    // application icon, not a document `rel="icon"`.
    icon: null,
    publicConfig: Object.freeze({ desktop: Object.freeze({ identifier: config.identifier }) }),
    build: Object.freeze({ sourceMaps: false }),
    security: Object.freeze({ contentSecurityPolicy: true, connectSources: Object.freeze([]), imageSources: Object.freeze([]) }),
    deployment: Object.freeze({ spaFallback: true, adapter: "neutral" as const }),
  };
}
