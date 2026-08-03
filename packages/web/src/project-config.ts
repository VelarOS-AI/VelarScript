export interface VelarWebConfig {
  readonly title: string;
  readonly base: string;
  readonly publicConfig: Readonly<Record<string, unknown>>;
  readonly build: { readonly sourceMaps: boolean };
  readonly security: {
    readonly contentSecurityPolicy: boolean;
    readonly connectSources: readonly string[];
    readonly imageSources: readonly string[];
  };
  readonly deployment: {
    readonly spaFallback: boolean;
    readonly adapter: "neutral" | "netlify";
  };
}

export const velarProjectExtension = Object.freeze({
  id: "@velarscript/web",
  manifestKey: "web",
  parse(value: unknown, manifestPath: string): VelarWebConfig {
    return webConfig(value, manifestPath);
  },
});

function webConfig(value: unknown, manifestPath: string): VelarWebConfig {
  if (value !== undefined && (!value || typeof value !== "object" || Array.isArray(value))) {
    throw new Error(`${manifestPath}: 'web' must be an object`);
  }
  const web = value as {
    readonly title?: unknown;
    readonly base?: unknown;
    readonly publicConfig?: unknown;
    readonly build?: unknown;
    readonly security?: unknown;
    readonly deployment?: unknown;
  } | undefined;
  if (web) knownFields(web as Record<string, unknown>, new Set(["title", "base", "publicConfig", "build", "security", "deployment"]), "web", manifestPath);
  const title = stringField(web?.title, "web.title", "Velar App");
  let base = stringField(web?.base, "web.base", "/");
  if (!base.startsWith("/")) throw new Error(`${manifestPath}: 'web.base' must start with '/'`);
  if (!base.endsWith("/")) base += "/";
  validateWebBase(base, manifestPath);
  const deployment = deploymentConfig(web?.deployment, manifestPath);
  if (deployment.adapter === "netlify" && base !== "/") {
    throw new Error(`${manifestPath}: 'web.deployment.adapter' netlify currently requires 'web.base' to be '/'`);
  }
  return {
    title,
    base,
    publicConfig: publicConfigField(web?.publicConfig, manifestPath),
    build: buildConfig(web?.build, manifestPath),
    security: securityConfig(web?.security, manifestPath),
    deployment,
  };
}

function buildConfig(value: unknown, manifestPath: string): VelarWebConfig["build"] {
  if (value !== undefined && (!value || typeof value !== "object" || Array.isArray(value))) {
    throw new Error(`${manifestPath}: 'web.build' must be an object`);
  }
  const build = value as { readonly sourceMaps?: unknown } | undefined;
  if (build) knownFields(build as Record<string, unknown>, new Set(["sourceMaps"]), "web.build", manifestPath);
  return { sourceMaps: booleanField(build?.sourceMaps, "web.build.sourceMaps", false) };
}

function publicConfigField(value: unknown, manifestPath: string): Readonly<Record<string, unknown>> {
  if (value === undefined) return Object.freeze({});
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${manifestPath}: 'web.publicConfig' must be a JSON object`);
  }
  const dangerous = new Set(["__proto__", "prototype", "constructor"]);
  const visit = (item: unknown, path: string): void => {
    if (item === null || typeof item === "string" || typeof item === "boolean") return;
    if (typeof item === "number") {
      if (!Number.isFinite(item)) throw new Error(`${manifestPath}: '${path}' must contain a finite JSON number`);
      return;
    }
    if (Array.isArray(item)) {
      item.forEach((child, index) => visit(child, `${path}[${index}]`));
      return;
    }
    if (!item || typeof item !== "object") throw new Error(`${manifestPath}: '${path}' contains a non-JSON value`);
    for (const [key, child] of Object.entries(item)) {
      if (dangerous.has(key)) throw new Error(`${manifestPath}: '${path}' contains reserved key '${key}'`);
      visit(child, `${path}.${key}`);
    }
  };
  visit(value, "web.publicConfig");
  const encoded = JSON.stringify(value);
  if (Buffer.byteLength(encoded, "utf8") > 65_536) throw new Error(`${manifestPath}: 'web.publicConfig' cannot exceed 64 KiB`);
  return JSON.parse(encoded) as Record<string, unknown>;
}

function securityConfig(value: unknown, manifestPath: string): VelarWebConfig["security"] {
  if (value !== undefined && (!value || typeof value !== "object" || Array.isArray(value))) {
    throw new Error(`${manifestPath}: 'web.security' must be an object`);
  }
  const security = value as {
    readonly contentSecurityPolicy?: unknown;
    readonly connectSources?: unknown;
    readonly imageSources?: unknown;
  } | undefined;
  if (security) knownFields(security as Record<string, unknown>, new Set(["contentSecurityPolicy", "connectSources", "imageSources"]), "web.security", manifestPath);
  return {
    contentSecurityPolicy: booleanField(security?.contentSecurityPolicy, "web.security.contentSecurityPolicy", true),
    connectSources: sourceList(security?.connectSources, "web.security.connectSources", new Set(["https:", "wss:"])),
    imageSources: sourceList(security?.imageSources, "web.security.imageSources", new Set(["https:"])),
  };
}

function deploymentConfig(value: unknown, manifestPath: string): VelarWebConfig["deployment"] {
  if (value !== undefined && (!value || typeof value !== "object" || Array.isArray(value))) {
    throw new Error(`${manifestPath}: 'web.deployment' must be an object`);
  }
  const deployment = value as { readonly spaFallback?: unknown; readonly adapter?: unknown } | undefined;
  if (deployment) knownFields(deployment as Record<string, unknown>, new Set(["spaFallback", "adapter"]), "web.deployment", manifestPath);
  const adapter = stringField(deployment?.adapter, "web.deployment.adapter", "neutral");
  if (adapter !== "neutral" && adapter !== "netlify") throw new Error(`'web.deployment.adapter' must be 'neutral' or 'netlify'`);
  return { spaFallback: booleanField(deployment?.spaFallback, "web.deployment.spaFallback", true), adapter };
}

function booleanField(value: unknown, field: string, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  if (typeof value !== "boolean") throw new Error(`'${field}' must be a boolean`);
  return value;
}

function sourceList(value: unknown, field: string, protocols: ReadonlySet<string>): readonly string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) throw new Error(`'${field}' must be a list of secure origins`);
  return [...new Set(value.map((item) => {
    let url: URL;
    try { url = new URL(item as string); }
    catch { throw new Error(`'${field}' contains invalid origin '${String(item)}'`); }
    if (!protocols.has(url.protocol) || url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
      throw new Error(`'${field}' contains unsupported origin '${String(item)}'`);
    }
    return url.origin;
  }))].sort();
}

function stringField(value: unknown, field: string, fallback: string): string {
  if (value === undefined) return fallback;
  if (typeof value !== "string" || value.trim().length === 0 || value.includes("\0")) throw new Error(`'${field}' must be a non-empty string without NUL bytes`);
  return value;
}

function knownFields(value: Record<string, unknown>, allowed: ReadonlySet<string>, field: string, manifestPath: string): void {
  for (const key of Object.keys(value)) if (!allowed.has(key)) throw new Error(`${manifestPath}: unknown '${field}' field '${key}'`);
}

function validateWebBase(base: string, manifestPath: string): void {
  if (base.includes("?") || base.includes("#") || base.includes("\\")) throw new Error(`${manifestPath}: 'web.base' must be a canonical URL pathname`);
  const segments = base.split("/").slice(1, -1);
  if (segments.some((segment) => segment.length === 0)) throw new Error(`${manifestPath}: 'web.base' cannot contain empty path segments`);
  for (const segment of segments) {
    let decoded: string;
    try { decoded = decodeURIComponent(segment); }
    catch { throw new Error(`${manifestPath}: 'web.base' contains invalid percent encoding`); }
    if (decoded === "." || decoded === ".." || decoded.includes("/") || decoded.includes("\\")) {
      throw new Error(`${manifestPath}: 'web.base' must use canonical path segments`);
    }
  }
  const parsed = new URL(base, "https://velar.invalid");
  if (parsed.pathname !== base || parsed.search || parsed.hash) throw new Error(`${manifestPath}: 'web.base' must be a canonical URL pathname`);
}
