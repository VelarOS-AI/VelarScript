import {
  VELAR_APPLICATION_PACKAGE_HOST_PROTOCOL_VERSION,
  type ApplicationPackageInput,
  type ApplicationPackageHost,
} from "@velarscript/compiler/application-package-host";
import { buildDesktopApplication, formatDesktopBytes as formatBytes } from "./build.ts";
import { DESKTOP_NODE_MINIMUM_MAJOR, VELAR_DESKTOP_API_VERSION, type VelarDesktopConfig } from "./config.ts";
import { DESKTOP_EMBEDDED_RUNTIME_PATH } from "./node-runtime.ts";

export const velarApplicationPackageHost: ApplicationPackageHost = Object.freeze({
  protocolVersion: VELAR_APPLICATION_PACKAGE_HOST_PROTOCOL_VERSION,
  id: "@velarscript/desktop",
  apiVersion: VELAR_DESKTOP_API_VERSION,
  async packageApplication(input: ApplicationPackageInput) {
    const result = await buildDesktopApplication(
      input.projectRoot,
      input.config as VelarDesktopConfig,
      input.buildFramework,
    );
    const sizes = result.manifest.sizes;
    const runtime = result.manifest.runtime;
    const signing = result.manifest.signing;
    const services = result.manifest.services;
    return Object.freeze({
      artifactPath: result.applicationBundle,
      details: Object.freeze([
        `Application ${formatBytes(sizes.applicationBytes)} / ${formatBytes(result.manifest.sizeBudgetBytes)} `
        + `(host ${formatBytes(sizes.hostBytes)}, renderer ${formatBytes(sizes.rendererBytes)}, capabilities ${formatBytes(sizes.capabilityHostBytes)}`
        // Named only when there are any, because a build line that reports
        // zero bytes of a section this project has none of is a line nobody
        // reads twice.
        + `${services.length > 0 ? `, services ${formatBytes(sizes.servicesBytes)}` : ""})`,
        ...services.length > 0
          ? [`Services ${services.map((service) => `${service.name} (${service.restart})`).join(", ")}, started before the renderer and converged on quit`]
          : [],
        runtime.embedded
          ? `Runtime embedded Node.js ${runtime.version} at ${DESKTOP_EMBEDDED_RUNTIME_PATH} (${formatBytes(runtime.bytes)}, self-contained)`
          : `Runtime external Node.js >=${DESKTOP_NODE_MINIMUM_MAJOR} (not embedded)`,
        `Bundle ${formatBytes(sizes.totalBytes)} signed ${signing.mode} with the hardened runtime`
        + `${signing.notarized ? ", notarized and stapled" : ""}`,
      ]),
    });
  },
});
