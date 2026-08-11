import { createRequire } from "node:module";
import { isAbsolute, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  VELAR_APPLICATION_PACKAGE_HOST_PROTOCOL_VERSION,
  type ApplicationPackageHost,
  type ApplicationPackageResult,
} from "@velarscript/compiler/application-package-host";
import type { VelarProjectConfig } from "./config.ts";
import { hostErrorCode, hostErrorMessage } from "./host-error.ts";

export async function loadApplicationPackageHost(project: VelarProjectConfig): Promise<ApplicationPackageHost> {
  const framework = project.framework;
  if (!framework) throw new Error("this project does not enable an application target");
  const package_ = project.extensionGraph.find((item) => item.name === framework.host.id);
  if (!package_) throw new Error(`application target '${framework.host.id}' is absent from the resolved extension graph`);
  const require = createRequire(package_.manifestPath);
  const specifier = `${package_.name}/package-host`;
  let entry: string;
  try {
    entry = require.resolve(specifier);
  } catch (error) {
    const code = hostErrorCode(error);
    const message = hostErrorMessage(error);
    if (code === "ERR_PACKAGE_PATH_NOT_EXPORTED"
      || (code === "MODULE_NOT_FOUND" && message.includes(`'${specifier}'`))) {
      throw new Error(`application target '${package_.name}' does not provide native packaging`);
    }
    throw error;
  }
  const namespace = await import(pathToFileURL(entry).href) as { readonly velarApplicationPackageHost?: unknown };
  return validateApplicationPackageHost(namespace.velarApplicationPackageHost, package_.name, framework.host.apiVersion);
}

export function validateApplicationPackageResult(value: unknown, projectRoot: string): ApplicationPackageResult {
  const result = value as Partial<ApplicationPackageResult> | null;
  if (!result || typeof result !== "object" || typeof result.artifactPath !== "string" || !isAbsolute(result.artifactPath)
    || !Array.isArray(result.details) || result.details.length > 16
    || result.details.some((item) => typeof item !== "string" || item.length > 1024 || /[\0\r\n]/u.test(item))) {
    throw new Error("application package host returned an invalid result");
  }
  const artifactPath = resolve(result.artifactPath);
  const fromRoot = relative(projectRoot, artifactPath);
  if (fromRoot === "" || fromRoot === ".." || fromRoot.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) || isAbsolute(fromRoot)) {
    throw new Error("application package host returned an artifact path outside the project root");
  }
  return Object.freeze({ artifactPath, details: Object.freeze([...result.details]) });
}

function validateApplicationPackageHost(value: unknown, name: string, apiVersion: string): ApplicationPackageHost {
  const host = value as Partial<ApplicationPackageHost> | null;
  if (!host || typeof host !== "object"
    || host.protocolVersion !== VELAR_APPLICATION_PACKAGE_HOST_PROTOCOL_VERSION
    || host.id !== name || host.apiVersion !== apiVersion
    || typeof host.packageApplication !== "function") {
    throw new Error(`'${name}/package-host' exports an invalid application package host`);
  }
  return Object.freeze(host as ApplicationPackageHost);
}
