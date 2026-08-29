import {
  VELAR_NODE_API_VERSION,
  velarCompilerExtension as nodeCompiler,
  velarProjectExtension as nodeProject,
} from "@velarscript/node/compiler";
import { registerBundledExtension } from "./bundled-extension-registry.ts";
import { VELAR_VERSION } from "./version.ts";

/**
 * D111 rule 3: the language server registers the official targets it can
 * resolve, and skips the ones this project never installed.
 *
 * `@velarscript/node` is a CLI dependency, so it is always present and is
 * imported statically. Web, Server and Desktop are optional peers, so each is
 * loaded on its own: the bundler inlines the ones it resolves and leaves the
 * rest as a runtime import that fails here. An absent target is not an error
 * and produces no warning — a project that never declared Desktop should not be
 * offered Desktop completions, so there is nothing to report.
 */
export async function installOfficialLanguageServerExtensions(): Promise<void> {
  registerBundledExtension({
    name: "@velarscript/node",
    version: VELAR_VERSION,
    kind: "capability",
    apiVersion: VELAR_NODE_API_VERSION,
    manifestKey: "node",
    extends: Object.freeze({}),
    composes: Object.freeze({}),
    compiler: nodeCompiler,
    project: nodeProject,
    host: null,
  });

  const server = await resolvedTarget(() => import("@velarscript/server/compiler"));
  if (server) {
    registerBundledExtension({
      name: "@velarscript/server",
      version: VELAR_VERSION,
      kind: "application",
      apiVersion: server.VELAR_SERVER_API_VERSION,
      manifestKey: "server",
      extends: Object.freeze({}),
      composes: Object.freeze({"@velarscript/node": VELAR_NODE_API_VERSION}),
      compiler: server.velarCompilerExtension,
      project: server.velarProjectExtension,
      host: null,
    });
  }

  // A target is registered from its own resolved modules or not at all: half a
  // target — a compiler extension with no framework host — is not something the
  // language server can answer with.
  const web = await resolvedTarget(() => import("@velarscript/web/compiler"));
  const webHost = web === null ? null : await resolvedTarget(() => import("@velarscript/web/host"));
  if (web && webHost) {
    registerBundledExtension({
      name: "@velarscript/web",
      version: VELAR_VERSION,
      kind: "application",
      apiVersion: web.VELAR_WEB_API_VERSION,
      manifestKey: "web",
      extends: Object.freeze({}),
      composes: Object.freeze({}),
      compiler: web.velarCompilerExtension,
      project: web.velarProjectExtension,
      host: webHost.velarFrameworkHost,
    });
  }

  // Desktop composes Web, and the API version it composes is the installed Web
  // package's own. A Desktop without a resolvable Web therefore has nothing
  // truthful to declare, so it is skipped with it.
  const desktop = web === null ? null : await resolvedTarget(() => import("@velarscript/desktop/compiler"));
  const desktopApi = desktop === null ? null : await resolvedTarget(() => import("@velarscript/desktop"));
  const desktopHost = desktop === null ? null : await resolvedTarget(() => import("@velarscript/desktop/host"));
  if (web && desktop && desktopApi && desktopHost) {
    registerBundledExtension({
      name: "@velarscript/desktop",
      version: VELAR_VERSION,
      kind: "application",
      apiVersion: desktopApi.VELAR_DESKTOP_API_VERSION,
      manifestKey: "desktop",
      extends: Object.freeze({}),
      composes: Object.freeze({
        "@velarscript/web": web.VELAR_WEB_API_VERSION,
        "@velarscript/node": VELAR_NODE_API_VERSION,
      }),
      compiler: desktop.velarCompilerExtension,
      project: desktop.velarProjectExtension,
      host: desktopHost.velarFrameworkHost,
    });
  }
}

/** One optional target module, or null when this project did not install it. */
async function resolvedTarget<T>(load: () => Promise<T>): Promise<T | null> {
  try {
    return await load();
  } catch {
    return null;
  }
}
