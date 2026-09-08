export const VELAR_FRAMEWORK_HOST_PROTOCOL_VERSION = 3 as const;

export interface FrameworkHostArtifactsInput {
  readonly config: unknown;
  readonly development: boolean;
  readonly entryPath: string;
  readonly stylesheetPath: string | null;
  readonly styles: string;
  readonly imports: Readonly<Record<string, string>>;
}

export interface FrameworkHostArtifacts {
  readonly entryModule: string;
  readonly css: string;
  readonly html: string;
}

export interface FrameworkHostErrorDocumentInput {
  readonly config: unknown;
  readonly errors: readonly string[];
}

export interface FrameworkStaticDeployment {
  readonly base: string;
  readonly spaFallback: boolean;
  readonly contentSecurityPolicy: string | null;
}

export interface FrameworkBrowserTestContract {
  readonly sourceSuffix: string;
  readonly runtimeKey: string;
  /** Deterministic target runtime installed before the test document starts. */
  readonly initScript?: (config: unknown) => string;
  /** Per-test host control for state that must be fixed before first navigation. */
  readonly createController?: (config: unknown) => FrameworkBrowserTestController;
}

export interface FrameworkBrowserTestControlResult {
  readonly handled: boolean;
  readonly value?: unknown;
}

/** Host-owned control plane; it has no browser authority of its own. */
export interface FrameworkBrowserTestController {
  /** Called exactly once, immediately before the test's first `browser.open`. */
  readonly initScript: () => string;
  /** Handles target-specific test setup without requiring a loaded document. */
  readonly invoke: (
    capability: string,
    operation: string,
    args: readonly unknown[],
    timeout: number,
  ) => FrameworkBrowserTestControlResult | Promise<FrameworkBrowserTestControlResult>;
}

/**
 * A file the built application's own documents point at, named by the project
 * manifest and expected to exist under `publicDir`. The host owns the manifest
 * field that named it; the host cannot read files, so its host process resolves
 * the path and fails the build when the asset is absent rather than shipping a
 * document that references nothing.
 */
export interface FrameworkRequiredPublicAsset {
  /** Manifest field that named the asset, for the missing-asset diagnostic. */
  readonly field: string;
  /** Path relative to the project's `publicDir`. */
  readonly path: string;
}

/**
 * Long-running processes a target's manifest declares and its development
 * server starts beside the page. The host owns the processes; this ABI carries
 * only the handle that converges them, because a dev server that outlived the
 * processes it started would leave a product's services running after Ctrl-C.
 */
export interface FrameworkDevelopmentProcesses {
  /** One line per process, already formatted for the dev server's output. */
  readonly report: readonly string[];
  readonly stop: () => Promise<void>;
}

export interface FrameworkDevelopmentProcessInput {
  readonly config: unknown;
  readonly projectRoot: string;
}

export interface FrameworkHostProjectValidationInput {
  readonly config: unknown;
  readonly modules: readonly {
    readonly path: string;
    readonly imports: readonly string[];
  }[];
}

/**
 * DT-D1: one project-wide refusal a target host makes, with the site it is
 * about.
 *
 * A host answers about the project rather than about one expression, but the
 * thing it refuses is still something the author wrote in a file — a Desktop
 * capability the manifest never granted is refused *at the import*. A bare
 * string carries none of that, so the seven Desktop permission refusals reached
 * the author as prose with no code, no `line:column` and no caret, in a
 * diagnostic channel where everything else has all three. The host names the
 * module and the specifier; the host that composed it turns those into a span,
 * because only it holds the parsed module.
 *
 * A plain string is still accepted, for a refusal that genuinely has no site.
 */
export interface FrameworkHostProjectRefusal {
  /** The `VELxxxx` code this refusal reports under. */
  readonly code: string;
  readonly message: string;
  /** The module whose import line is the site — one of the input module paths. */
  readonly module: string;
  /** The imported specifier the caret marks, exactly as that module spells it. */
  readonly specifier: string;
}

/**
 * Tooling ABI implemented by an optional framework package and dynamically
 * composed by hosts such as the VelarScript CLI. It deliberately contains no file,
 * process, network, browser-driver, or compiler implementation.
 */
export interface FrameworkHostExtension {
  readonly protocolVersion: typeof VELAR_FRAMEWORK_HOST_PROTOCOL_VERSION;
  readonly id: string;
  readonly capability: string;
  readonly displayName: string;
  readonly target: "browser";
  readonly apiVersion: string;
  readonly artifactKind: string;
  readonly base: (config: unknown) => string;
  readonly prepareStyles?: (config: unknown, styles: string) => string;
  readonly createArtifacts: (input: FrameworkHostArtifactsInput) => FrameworkHostArtifacts;
  readonly createErrorDocument: (input: FrameworkHostErrorDocumentInput) => string;
  readonly staticDeployment: (config: unknown) => FrameworkStaticDeployment;
  readonly requiredPublicAssets?: (config: unknown) => readonly FrameworkRequiredPublicAsset[];
  readonly browserTests?: FrameworkBrowserTestContract;
  /** Started before the dev server listens and converged when it closes. */
  readonly startDevelopmentProcesses?: (input: FrameworkDevelopmentProcessInput) => Promise<FrameworkDevelopmentProcesses>;
  readonly validateProject?: (input: FrameworkHostProjectValidationInput) => readonly (string | FrameworkHostProjectRefusal)[];
}
