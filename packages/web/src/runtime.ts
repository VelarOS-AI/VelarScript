import { VELAR_REACTIVE_BRIDGE_MODULE } from "@velarscript/compiler/extension";
import {
  VELAR_REACTIVE_BRIDGE_MODULE_SOURCE, VELAR_WEB_WEBSOCKET_RUNTIME, VELAR_WEB_WORKER_RUNTIME,
  WEB_APP_MODULE, WEB_BROWSER_MODULE, WEB_CONFIG_MODULE, WEB_FILES_MODULE, WEB_FORMS_MODULE,
  WEB_HTTP_MODULE, WEB_LOOK_MODULE, WEB_REALTIME_MODULE, WEB_STORAGE_MODULE, WEB_TEST_MODULE,
  WEB_WEB_MODULE,
} from "./runtime-sources.generated.ts";

/**
 * The thirteen `velar/*` modules the Web framework publishes, and the source
 * each one ships to the browser.
 *
 * D115 §一.4 / D114 R2c: the JavaScript itself is real source under
 * `packages/web/runtime/`, where a JavaScript parser reads it and a test can
 * run one module of it on its own. This table is the specifier-to-body map and
 * nothing else — the shared guards, host ABIs and error normalization a module
 * opens with are parts of its constant in `runtime/manifest.json`, so a body is
 * written once however many modules carry it.
 */
export const webModuleSources: ReadonlyMap<string, string> = new Map([
  ["velar/worker", VELAR_WEB_WORKER_RUNTIME],
  ["velar/websocket", VELAR_WEB_WEBSOCKET_RUNTIME],
  ["velar/look", WEB_LOOK_MODULE],
  ["velar/app", WEB_APP_MODULE],
  ["velar/config", WEB_CONFIG_MODULE],
  ["velar/web", WEB_WEB_MODULE],
  ["velar/forms", WEB_FORMS_MODULE],
  ["velar/http", WEB_HTTP_MODULE],
  ["velar/storage", WEB_STORAGE_MODULE],
  ["velar/browser", WEB_BROWSER_MODULE],
  ["velar/files", WEB_FILES_MODULE],
  ["velar/realtime", WEB_REALTIME_MODULE],
  ["velar/web-test", WEB_TEST_MODULE],
]);

export interface VelarWebRuntimeConfig {
  readonly base: string;
  readonly publicConfig?: Readonly<Record<string, unknown>>;
}

/**
 * Two of those modules close over a value the project decides: the base path
 * `velar/web` resolves routes against, and the manifest's own `publicConfig`.
 * Both are written into the runtime source as a placeholder string and replaced
 * here, so the `.js` file stays a file a parser can read rather than a template
 * with a hole in it.
 */
export function webModuleSource(source: string, web: VelarWebRuntimeConfig = { base: "/" }): string | null {
  if (source === VELAR_REACTIVE_BRIDGE_MODULE) return VELAR_REACTIVE_BRIDGE_MODULE_SOURCE;
  const value = webModuleSources.get(source);
  if (!value) return null;
  if (source === "velar/web") return value.replace(JSON.stringify("__VELAR_WEB_BASE__"), JSON.stringify(web.base));
  if (source === "velar/config") {
    return value.replace(JSON.stringify("__VELAR_PUBLIC_CONFIG__"), JSON.stringify(web.publicConfig ?? {}));
  }
  return value;
}
