import { velarCompilerExtension as webCompiler, velarProjectExtension as webProject, VELAR_WEB_API_VERSION } from "@velarscript/web/compiler";
import { velarFrameworkHost as webHost } from "@velarscript/web/host";
import { velarCompilerExtension as desktopCompiler, velarProjectExtension as desktopProject } from "@velarscript/desktop/compiler";
import { velarFrameworkHost as desktopHost } from "@velarscript/desktop/host";
import { VELAR_DESKTOP_API_VERSION } from "@velarscript/desktop";
import { VELAR_NODE_API_VERSION } from "@velarscript/node/compiler";
import { registerBundledExtension } from "./bundled-extension-registry.ts";
import { VELAR_VERSION } from "./version.ts";

export function installOfficialLanguageServerExtensions(): void {
  registerBundledExtension({
    name: "@velarscript/web",
    version: VELAR_VERSION,
    kind: "application",
    apiVersion: VELAR_WEB_API_VERSION,
    manifestKey: "web",
    extends: Object.freeze({}),
    composes: Object.freeze({}),
    compiler: webCompiler,
    project: webProject,
    host: webHost,
  });
  registerBundledExtension({
    name: "@velarscript/desktop",
    version: VELAR_VERSION,
    kind: "application",
    apiVersion: VELAR_DESKTOP_API_VERSION,
    manifestKey: "desktop",
    extends: Object.freeze({}),
    composes: Object.freeze({
      "@velarscript/web": VELAR_WEB_API_VERSION,
      "@velarscript/node": VELAR_NODE_API_VERSION,
    }),
    compiler: desktopCompiler,
    project: desktopProject,
    host: desktopHost,
  });
}
