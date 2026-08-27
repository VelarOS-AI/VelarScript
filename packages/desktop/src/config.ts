import { migrateDesktopManifestText } from "./manifest-migration.ts";
import { byCodeUnit } from "./stable-order.ts";

export const VELAR_DESKTOP_API_VERSION = "0.10";
// The budget covers only the application's own components — the native shell,
// renderer, capability host, and metadata. Product tooling is installed by
// products rather than bundled into every Desktop application, and the embedded
// Node.js runtime is not an application component either: it is this toolchain
// generation's fixed cost, measured against its own ceiling below.
export const DEFAULT_DESKTOP_SIZE_BUDGET_BYTES = 32 * 1024 * 1024;

/**
 * The Node.js runtime this generation of the toolchain embeds, and the official
 * `SHASUMS256.txt` digest of the tarball it is extracted from. One generation
 * supports exactly one version: a project does not choose a runtime, so
 * `velar.json` grows no field for it and every application built by this
 * toolchain carries the same interpreter.
 *
 * The digests are copied from https://nodejs.org/dist/v24.19.0/SHASUMS256.txt
 * and are the only reason a downloaded archive is trusted. Bumping the version
 * means replacing both halves of a row here; a version with no row cannot be
 * provisioned at all, which is the point.
 */
export const DESKTOP_NODE_RUNTIME_VERSION = "24.19.0";
/** The Node.js major the host requires of an external runtime, and the major the pinned version is. */
export const DESKTOP_NODE_MINIMUM_MAJOR = 24;
export const DESKTOP_NODE_RUNTIME_ORIGIN = "https://nodejs.org/dist";
/**
 * Keyed by `${platform}-${arch}` as Node reports them. Only the architecture a
 * macOS Desktop application is built for today has a row: x64 and universal
 * binaries are a later Desktop milestone, alongside the Windows and Linux hosts,
 * and an absent row is a refusal rather than a silently different download.
 */
export const DESKTOP_NODE_RUNTIME_ARCHIVES: Readonly<Record<string, { readonly archive: string; readonly sha256: string }>> = Object.freeze({
  "darwin-arm64": Object.freeze({
    archive: `node-v${DESKTOP_NODE_RUNTIME_VERSION}-darwin-arm64.tar.gz`,
    sha256: "8294b7aa9b03997481c06babf1e8b270c859358f27da57a11509afe537ac381d",
  }),
});
/**
 * The runtime is not a project knob, so it does not get a project budget. It
 * gets an integrity ceiling this toolchain owns: an official Node.js macOS
 * executable is around 110 MiB, and an archive that unpacked to something far
 * larger is a supply-chain question rather than a size-tuning one.
 */
export const DESKTOP_RUNTIME_CEILING_BYTES = 200 * 1024 * 1024;

/**
 * The window kind a Desktop application always declares and the host always
 * opens at launch. Every other kind is opened by `openWindow`.
 */
export const DESKTOP_MAIN_WINDOW_KIND = "main";
/**
 * A window kind is an identity the manifest declares and the host registry
 * keys on, so the vocabulary is closed on both sides: lowercase words joined
 * by single hyphens, and at most 32 of them in one application.
 */
export const DESKTOP_WINDOW_KIND_LIMIT = 32;
const desktopWindowKindPattern = /^[a-z]+(?:-[a-z]+)*$/u;

export type DesktopWindowTitleBar = "standard" | "hidden-inset";
export type DesktopWindowMaterial = "none" | "sidebar";
export type DesktopWindowStyle = "window" | "panel";
export type DesktopWindowLevel = "normal" | "floating";

const desktopWindowTitleBars: readonly DesktopWindowTitleBar[] = Object.freeze(["standard", "hidden-inset"]);
const desktopWindowMaterials: readonly DesktopWindowMaterial[] = Object.freeze(["none", "sidebar"]);
const desktopWindowStyles: readonly DesktopWindowStyle[] = Object.freeze(["window", "panel"]);
const desktopWindowLevels: readonly DesktopWindowLevel[] = Object.freeze(["normal", "floating"]);

export interface DesktopWindowConfig {
  readonly title: string;
  readonly width: number;
  readonly height: number;
  readonly minWidth: number;
  readonly minHeight: number;
  readonly titleBar: DesktopWindowTitleBar;
  /** macOS vibrancy behind the renderer; `sidebar` implies a transparent page background. */
  readonly material: DesktopWindowMaterial;
  /** `panel` is an NSPanel: non-activating, floating, outside the window cycle. */
  readonly style: DesktopWindowStyle;
  readonly frame: boolean;
  readonly level: DesktopWindowLevel;
  readonly visibleOnAllWorkspaces: boolean;
  /** Locked width-to-height ratio, or null when the window is free. */
  readonly aspectRatio: number | null;
  readonly resizable: boolean;
}

/**
 * The URL schemes `openExternal` may hand to the system default handler. The
 * vocabulary is closed rather than open because an allowlist whose values are
 * author-supplied text is an allowlist that grows by typo.
 */
export type DesktopLinkScheme = "http" | "https" | "mailto";
const desktopLinkSchemes: readonly DesktopLinkScheme[] = Object.freeze(["http", "https", "mailto"]);

/**
 * The file roots a Desktop application may reach. `dropped` is not a directory:
 * it authorizes reading the files a user's own drag gesture brings in, and
 * learning their real paths. The gesture is the grant, and it lasts for the
 * session.
 */
export type DesktopFileScope = "app-data" | "project" | "dropped";
const desktopFileScopes: readonly DesktopFileScope[] = Object.freeze(["app-data", "project", "dropped"]);

/**
 * A named credential slot and a named environment secret follow the same
 * spelling rule, because the manifest refuses to declare one name in both
 * lists and a collision rule between two different spellings would never fire.
 */
const desktopSecretNamePattern = /^[A-Z_][A-Z0-9_]{0,127}$/u;

export interface DesktopPermissionConfig {
  readonly files: readonly DesktopFileScope[];
  readonly processes: readonly string[];
  readonly network: readonly string[];
  readonly environment: readonly string[];
  readonly secrets: readonly string[];
  /** The schemes `openExternal` may open; every other scheme is refused. */
  readonly links: readonly DesktopLinkScheme[];
  /** Whether this application may deliver system notifications at all. The user still grants the real authorization. */
  readonly notifications: boolean;
  /** The keychain entry names `velar/secure-storage` may read and write. */
  readonly secureStorage: readonly string[];
}

/**
 * Notarization credentials are never a manifest field. `keychainProfile` names
 * a profile `xcrun notarytool store-credentials` already put in the developer's
 * keychain, so the manifest carries a *reference* the machine resolves rather
 * than an Apple ID, a team password, or an App Store Connect key.
 */
export interface DesktopNotarizationConfig {
  readonly keychainProfile: string;
}

/**
 * Who owns what, in one shape: the identity, the product entitlements, and the
 * notarization credentials belong to the product; the order the bundle is signed
 * in, the entitlements the embedded runtime needs, and the tools that do it
 * belong to this toolchain. A project states the three product answers here and
 * nothing about the mechanics.
 */
export interface DesktopSigningConfig {
  /**
   * The `codesign` identity, usually a `Developer ID Application: …` common
   * name. Absent means ad-hoc: `velar package` still signs, with `codesign -s -`,
   * because an arm64 Mach-O with no signature at all cannot be executed.
   */
  readonly identity: string | null;
  /** Project-relative entitlements plist applied to the host and the application bundle. */
  readonly entitlements: string | null;
  /** Absent means `velar package` does not submit the build for notarization. */
  readonly notarization: DesktopNotarizationConfig | null;
}

export interface VelarDesktopConfig {
  readonly productName: string;
  readonly identifier: string;
  /**
   * Every window kind this application may open, keyed by kind and always
   * containing `main`. The record is built in sorted key order so the packaged
   * `desktop.json` and the generated `velar/window` module are byte-stable.
   */
  readonly windows: Readonly<Record<string, DesktopWindowConfig>>;
  readonly permissions: DesktopPermissionConfig;
  readonly build: {
    readonly outDir: string;
    readonly sizeBudgetBytes: number;
    readonly signing: DesktopSigningConfig;
  };
}

export const velarProjectExtension = Object.freeze({
  id: "@velarscript/desktop",
  manifestKey: "desktop",
  parse(value: unknown, manifestPath: string): VelarDesktopConfig {
    return desktopConfig(value, manifestPath);
  },
  /**
   * The mechanical manifest rewrite `velar fix` applies for this extension.
   * The check-time error the old shape raises names this command, so the two
   * are one migration reported from two places rather than two rules.
   */
  migrate(manifestText: string): string | null {
    return migrateDesktopManifestText(manifestText);
  },
});

/**
 * The one sentence a manifest written against the singular `desktop.window`
 * shape reads. It is raised before `knownFields` so the author is told what
 * replaced the field and how to migrate, rather than only that the field is
 * unknown; `velar fix` performs exactly the rewrite this names.
 */
export const DESKTOP_WINDOWS_MIGRATION_MESSAGE =
  "'desktop.window' was replaced by 'desktop.windows', a map of window kinds whose required 'main' entry is the window the host opens at launch; "
  + "run 'velar fix' to rewrite 'window: {...}' as 'windows: {\"main\": {...}}'";

function desktopConfig(value: unknown, manifestPath: string): VelarDesktopConfig {
  const desktop = objectField(value, "desktop", manifestPath);
  if (desktop.window !== undefined) throw new Error(`${manifestPath}: ${DESKTOP_WINDOWS_MIGRATION_MESSAGE}`);
  knownFields(desktop, new Set(["productName", "identifier", "windows", "permissions", "build"]), "desktop", manifestPath);
  const productName = stringField(desktop.productName, "desktop.productName");
  if (!/^[^/:\0]{1,80}$/u.test(productName) || productName === "." || productName === "..") {
    throw new Error(`${manifestPath}: 'desktop.productName' must be a safe application name of at most 80 characters`);
  }
  const identifier = stringField(desktop.identifier, "desktop.identifier");
  if (!/^[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+$/u.test(identifier)) {
    throw new Error(`${manifestPath}: 'desktop.identifier' must be a reverse-DNS application identifier`);
  }
  return Object.freeze({
    productName,
    identifier,
    windows: windowsConfig(desktop.windows, productName, manifestPath),
    permissions: permissionConfig(desktop.permissions, manifestPath),
    build: buildConfig(desktop.build, manifestPath),
  });
}

function windowsConfig(value: unknown, productName: string, manifestPath: string): Readonly<Record<string, DesktopWindowConfig>> {
  const windows = value === undefined ? { [DESKTOP_MAIN_WINDOW_KIND]: {} } : objectField(value, "desktop.windows", manifestPath);
  const kinds = Object.keys(windows).sort(byCodeUnit);
  if (kinds.length > DESKTOP_WINDOW_KIND_LIMIT) {
    throw new Error(`${manifestPath}: 'desktop.windows' cannot declare more than ${DESKTOP_WINDOW_KIND_LIMIT} window kinds`);
  }
  if (!kinds.includes(DESKTOP_MAIN_WINDOW_KIND)) {
    throw new Error(`${manifestPath}: 'desktop.windows' must declare the '${DESKTOP_MAIN_WINDOW_KIND}' window kind the host opens at launch`);
  }
  const output: Record<string, DesktopWindowConfig> = {};
  for (const kind of kinds) {
    if (!desktopWindowKindPattern.test(kind) || kind.length > DESKTOP_WINDOW_KIND_LIMIT) {
      throw new Error(`${manifestPath}: desktop window kind '${kind}' must be lowercase words joined by single hyphens, at most ${DESKTOP_WINDOW_KIND_LIMIT} characters`);
    }
    output[kind] = windowConfig(windows[kind], kind, productName, manifestPath);
  }
  return Object.freeze(output);
}

function windowConfig(value: unknown, kind: string, productName: string, manifestPath: string): DesktopWindowConfig {
  const field = `desktop.windows.${kind}`;
  const window = value === undefined ? {} : objectField(value, field, manifestPath);
  knownFields(window, new Set([
    "title", "width", "height", "minWidth", "minHeight",
    "titleBar", "material", "style", "frame", "level", "visibleOnAllWorkspaces", "aspectRatio", "resizable",
  ]), field, manifestPath);
  const width = integerField(window.width, `${field}.width`, 1180, 480, 8192);
  const height = integerField(window.height, `${field}.height`, 760, 320, 8192);
  const style = enumField(window.style, `${field}.style`, desktopWindowStyles, "window");
  return Object.freeze({
    title: window.title === undefined ? productName : stringField(window.title, `${field}.title`),
    width,
    height,
    // A window smaller than its own floor is a manifest that cannot be
    // honoured, so the floors are bounded by the size declared beside them.
    minWidth: integerField(window.minWidth, `${field}.minWidth`, Math.min(720, width), 320, width),
    minHeight: integerField(window.minHeight, `${field}.minHeight`, Math.min(520, height), 240, height),
    titleBar: enumField(window.titleBar, `${field}.titleBar`, desktopWindowTitleBars, "standard"),
    material: enumField(window.material, `${field}.material`, desktopWindowMaterials, "none"),
    style,
    frame: booleanField(window.frame, `${field}.frame`, true),
    // A panel that did not float would be an ordinary window wearing a panel's
    // name, so `panel` carries the floating level its own definition implies
    // and `level` narrows nothing further.
    level: enumField(window.level, `${field}.level`, desktopWindowLevels, style === "panel" ? "floating" : "normal"),
    visibleOnAllWorkspaces: booleanField(window.visibleOnAllWorkspaces, `${field}.visibleOnAllWorkspaces`, false),
    aspectRatio: ratioField(window.aspectRatio, `${field}.aspectRatio`),
    resizable: booleanField(window.resizable, `${field}.resizable`, true),
  });
}

function permissionConfig(value: unknown, manifestPath: string): DesktopPermissionConfig {
  const permissions = value === undefined ? {} : objectField(value, "desktop.permissions", manifestPath);
  knownFields(
    permissions,
    new Set(["files", "processes", "network", "environment", "secrets", "links", "notifications", "secureStorage"]),
    "desktop.permissions",
    manifestPath,
  );
  const files = stringList(permissions.files, "desktop.permissions.files", desktopFileScopes.length);
  const validFileScopes = new Set<string>(desktopFileScopes);
  for (const scope of files) if (!validFileScopes.has(scope)) throw new Error(`${manifestPath}: unknown desktop file scope '${scope}'`);
  const processes = stringList(permissions.processes, "desktop.permissions.processes", 64);
  for (const command of processes) {
    if (!/^[A-Za-z0-9._+-]{1,128}$/u.test(command)) throw new Error(`${manifestPath}: desktop process permissions must be executable names, not paths or shell text`);
  }
  const network = stringList(permissions.network, "desktop.permissions.network", 64);
  for (const origin of network) {
    let parsed: URL;
    try { parsed = new URL(origin); }
    catch { throw new Error(`${manifestPath}: desktop network permission '${origin}' must be an absolute origin`); }
    const loopback = parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1" || parsed.hostname === "[::1]";
    if ((parsed.protocol !== "https:" && !(parsed.protocol === "http:" && loopback))
      || parsed.username || parsed.password || parsed.pathname !== "/" || parsed.search || parsed.hash) {
      throw new Error(`${manifestPath}: desktop network permission '${origin}' must be an HTTPS origin or exact loopback origin`);
    }
  }
  const environment = stringList(permissions.environment, "desktop.permissions.environment", 64);
  for (const name of environment) {
    if (!/^[A-Z_][A-Z0-9_]{0,127}$/u.test(name)) throw new Error(`${manifestPath}: desktop environment permissions must be uppercase variable names`);
  }
  const secrets = stringList(permissions.secrets, "desktop.permissions.secrets", 64);
  for (const name of secrets) {
    if (!desktopSecretNamePattern.test(name)) throw new Error(`${manifestPath}: desktop secret permissions must be uppercase variable names`);
    if (environment.includes(name)) throw new Error(`${manifestPath}: desktop secret '${name}' cannot also be exposed through desktop.permissions.environment`);
  }
  const links = stringList(permissions.links, "desktop.permissions.links", desktopLinkSchemes.length);
  const validLinkSchemes = new Set<string>(desktopLinkSchemes);
  for (const scheme of links) {
    if (!validLinkSchemes.has(scheme)) {
      throw new Error(`${manifestPath}: 'desktop.permissions.links' must contain only ${desktopLinkSchemes.map((item) => `'${item}'`).join(", ")}`);
    }
  }
  const secureStorage = stringList(permissions.secureStorage, "desktop.permissions.secureStorage", 64);
  for (const name of secureStorage) {
    if (!desktopSecretNamePattern.test(name)) throw new Error(`${manifestPath}: desktop secure storage permissions must be uppercase variable names`);
    // An environment-injected opaque value and an application-written credential
    // slot are different authorities over the same name, so one name may name
    // only one of them.
    if (secrets.includes(name)) throw new Error(`${manifestPath}: desktop secure storage name '${name}' cannot also be declared in desktop.permissions.secrets`);
  }
  return Object.freeze({
    files: files as DesktopPermissionConfig["files"],
    processes,
    network,
    environment,
    secrets,
    links: links as DesktopPermissionConfig["links"],
    notifications: booleanField(permissions.notifications, "desktop.permissions.notifications", false),
    secureStorage,
  });
}

// Handing a renderer URL to the system browser is the same question
// `desktop.permissions.network` already answers: may this application reach
// this host. An origin that was never granted is cancelled rather than opened,
// and only `https` is ever a candidate — every other scheme stays cancelled, as
// it is in the native host. Matching is exact on scheme, host and port; a
// suffix or substring rule is how allowlists get bypassed.
export function desktopExternalNavigationPermitted(config: VelarDesktopConfig, url: string): boolean {
  const candidate = permissionOrigin(url);
  if (candidate === null) return false;
  return config.permissions.network.some((origin) => permissionOrigin(origin) === candidate);
}

// `https` is read off the parsed URL rather than off the origin text, because a
// nested scheme such as `blob:https://host/id` reports an `https` origin while
// naming a scheme the host never opens.
function permissionOrigin(value: string): string | null {
  let parsed: URL;
  try { parsed = new URL(value); }
  catch { return null; }
  return parsed.protocol === "https:" ? parsed.origin : null;
}

function buildConfig(value: unknown, manifestPath: string): VelarDesktopConfig["build"] {
  const build = value === undefined ? {} : objectField(value, "desktop.build", manifestPath);
  knownFields(build, new Set(["outDir", "sizeBudgetBytes", "signing"]), "desktop.build", manifestPath);
  const outDir = build.outDir === undefined ? "dist/desktop" : stringField(build.outDir, "desktop.build.outDir");
  if (outDir.startsWith("/") || outDir.split(/[\\/]/u).includes("..")) throw new Error(`${manifestPath}: 'desktop.build.outDir' must stay inside the project`);
  return Object.freeze({
    outDir,
    sizeBudgetBytes: integerField(build.sizeBudgetBytes, "desktop.build.sizeBudgetBytes", DEFAULT_DESKTOP_SIZE_BUDGET_BYTES, 64 * 1024, 1024 * 1024 * 1024),
    signing: signingConfig(build.signing, manifestPath),
  });
}

function signingConfig(value: unknown, manifestPath: string): DesktopSigningConfig {
  const signing = value === undefined ? {} : objectField(value, "desktop.build.signing", manifestPath);
  knownFields(signing, new Set(["identity", "entitlements", "notarization"]), "desktop.build.signing", manifestPath);
  let identity: string | null = null;
  if (signing.identity !== undefined) {
    identity = stringField(signing.identity, "desktop.build.signing.identity");
    // Ad-hoc is the absence of an identity, not the string every `codesign`
    // invocation spells it with. Two ways to say one thing is one way too many,
    // and the one that reads like an identity is the one that misleads.
    if (identity === "-") throw new Error(`${manifestPath}: 'desktop.build.signing.identity' is ad-hoc when it is absent; remove the field rather than naming '-'`);
    if (identity.length > 256 || /[\r\n]/u.test(identity)) {
      throw new Error(`${manifestPath}: 'desktop.build.signing.identity' must be a single-line codesign identity of at most 256 characters`);
    }
  }
  let entitlements: string | null = null;
  if (signing.entitlements !== undefined) {
    entitlements = stringField(signing.entitlements, "desktop.build.signing.entitlements");
    if (entitlements.startsWith("/") || entitlements.split(/[\\/]/u).includes("..")) {
      throw new Error(`${manifestPath}: 'desktop.build.signing.entitlements' must stay inside the project`);
    }
  }
  let notarization: DesktopNotarizationConfig | null = null;
  if (signing.notarization !== undefined) {
    const declared = objectField(signing.notarization, "desktop.build.signing.notarization", manifestPath);
    knownFields(declared, new Set(["keychainProfile"]), "desktop.build.signing.notarization", manifestPath);
    const keychainProfile = stringField(declared.keychainProfile, "desktop.build.signing.notarization.keychainProfile");
    if (!/^[A-Za-z0-9._-]{1,128}$/u.test(keychainProfile)) {
      throw new Error(`${manifestPath}: 'desktop.build.signing.notarization.keychainProfile' must be the name of a stored 'notarytool' credential profile`);
    }
    // Apple notarizes Developer ID signatures. An ad-hoc build submitted for
    // notarization is rejected by the service, so it is refused here where the
    // author can read why instead of after a build and an upload.
    if (identity === null) {
      throw new Error(`${manifestPath}: 'desktop.build.signing.notarization' requires 'desktop.build.signing.identity'; Apple does not notarize an ad-hoc signature`);
    }
    notarization = Object.freeze({ keychainProfile });
  }
  return Object.freeze({ identity, entitlements, notarization });
}

function stringList(value: unknown, field: string, maximum: number): readonly string[] {
  if (value === undefined) return Object.freeze([]);
  if (!Array.isArray(value) || value.length > maximum || value.some((item) => typeof item !== "string" || !item || item.includes("\0"))) {
    throw new Error(`'${field}' must be a list of at most ${maximum} non-empty strings`);
  }
  if (new Set(value).size !== value.length) throw new Error(`'${field}' cannot contain duplicates`);
  return Object.freeze([...value] as string[]);
}

function objectField(value: unknown, field: string, manifestPath: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${manifestPath}: '${field}' must be an object`);
  return value as Record<string, unknown>;
}

function stringField(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0 || value.includes("\0")) throw new Error(`'${field}' must be a non-empty string without NUL bytes`);
  return value;
}

function integerField(value: unknown, field: string, fallback: number, minimum: number, maximum: number): number {
  if (value === undefined) return fallback;
  if (!Number.isSafeInteger(value) || (value as number) < minimum || (value as number) > maximum) {
    throw new Error(`'${field}' must be an integer from ${minimum} through ${maximum}`);
  }
  return value as number;
}

function booleanField(value: unknown, field: string, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  if (typeof value !== "boolean") throw new Error(`'${field}' must be a boolean`);
  return value;
}

function enumField<T extends string>(value: unknown, field: string, allowed: readonly T[], fallback: T): T {
  if (value === undefined) return fallback;
  if (typeof value !== "string" || !allowed.includes(value as T)) {
    throw new Error(`'${field}' must be one of ${allowed.map((item) => `'${item}'`).join(", ")}`);
  }
  return value as T;
}

function ratioField(value: unknown, field: string): number | null {
  if (value === undefined) return null;
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0 || value > 100) {
    throw new Error(`'${field}' must be a finite number greater than 0 and at most 100`);
  }
  return value;
}

function knownFields(value: Record<string, unknown>, allowed: ReadonlySet<string>, field: string, manifestPath: string): void {
  for (const key of Object.keys(value)) if (!allowed.has(key)) throw new Error(`${manifestPath}: unknown '${field}' field '${key}'`);
}
