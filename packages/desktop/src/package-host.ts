import {
  VELAR_APPLICATION_PACKAGE_HOST_PROTOCOL_VERSION,
  type ApplicationPackageInput,
  type ApplicationPackageHost,
} from "@velarscript/compiler/application-package-host";
import { buildDesktopApplication, formatDesktopBytes as formatBytes } from "./build.ts";
import { VELAR_DESKTOP_API_VERSION, type VelarDesktopConfig } from "./config.ts";

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
    return Object.freeze({
      artifactPath: result.applicationBundle,
      details: Object.freeze([
        `Size ${formatBytes(sizes.totalBytes)} / ${formatBytes(result.manifest.sizeBudgetBytes)} (host ${formatBytes(sizes.hostBytes)}, renderer ${formatBytes(sizes.rendererBytes)}, capabilities ${formatBytes(sizes.capabilityHostBytes)})`,
        `Runtime external Node.js >=${result.manifest.runtime.minimumMajor} (not embedded)`,
      ]),
    });
  },
});
