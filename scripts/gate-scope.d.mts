/** The owner of a path that is the repository itself: everything downstream of the compiler. */
export const REPOSITORY_OWNER: "repo";
/** The owner of a documentation path: `check` and nothing else. */
export const DOCUMENTATION_OWNER: "docs";
/** The generated ownership document, relative to the repository root. */
export const OWNERSHIP_FILE: string;
/** The heavy-tier list, relative to the repository root. */
export const HEAVY_FILE: string;
/** The committed emitted-output listing, relative to the repository root. */
export const FINGERPRINT_LOCK: string;

/** A package name, `repo`, or `docs`. */
export type Owner = string;

export interface OwnershipDocument {
  readonly packages: readonly string[];
  readonly unclassified: readonly string[];
  readonly tests: Readonly<Record<string, readonly Owner[]>>;
}

export interface DerivedOwnership extends OwnershipDocument {
  readonly packages: string[];
  readonly unclassified: string[];
  readonly tests: Record<string, string[]>;
}

export interface HeavyEntry {
  readonly seconds: number;
  readonly reason: string;
}

export interface HeavyDocument {
  readonly files: Readonly<Record<string, HeavyEntry>>;
}

export interface ChangeBase {
  readonly ref: string | null;
  readonly commit: string | null;
  readonly how: string;
}

export interface PathOwners {
  readonly owners: readonly Owner[];
  readonly rule: string;
}

export interface GatePlan {
  readonly decision: "D116";
  readonly tier: "quick";
  readonly all: boolean;
  readonly base: ChangeBase;
  readonly changes: readonly string[];
  readonly owners: readonly Owner[];
  readonly closure: readonly string[];
  /** The closure, plus `docs` when the change set touched a document. */
  readonly running: readonly Owner[];
  readonly everything: boolean;
  readonly suites: {
    readonly check: boolean;
    readonly fingerprint: boolean;
    readonly node: readonly string[];
    readonly projectUnit: boolean;
    readonly browser: boolean;
    readonly packages: boolean;
  };
  readonly deferred: {
    readonly node: readonly string[];
    readonly browser: string;
    readonly packages: string;
  };
  readonly skipped: {
    readonly files: readonly string[];
    readonly owners: Readonly<Record<string, number>>;
  };
  readonly reasons: Readonly<Record<string, PathOwners>>;
}

export interface PlanOptions {
  readonly root?: string;
  readonly ownership?: OwnershipDocument;
  readonly projects?: Readonly<Record<string, readonly string[]>>;
  readonly heavy?: HeavyDocument;
  readonly base?: ChangeBase;
  readonly changes?: readonly string[];
  readonly since?: string | undefined;
  readonly all?: boolean;
}

export interface OwnershipTables {
  readonly packages: readonly string[];
  readonly modules: ReadonlyMap<string, ReadonlySet<string>>;
  readonly projects: ReadonlyMap<string, readonly string[]>;
}

export interface ScopeArguments {
  since: string | undefined;
  all: boolean;
  json: boolean;
  explain: boolean;
  writeOwnership: boolean;
  checkOwnership: boolean;
  rest: Record<string, string>;
}

/** Every package under `packages/`, in code-point order. */
export function workspacePackageNames(directory?: string): Promise<string[]>;

/** The packages a change to `owners` can reach, themselves included. */
export function downstreamClosure(owners: readonly Owner[], packages: readonly string[]): string[];

/** Which package publishes each `velar/<module>` specifier, from the extensions' own rosters. */
export function standardModuleOwners(): Promise<Map<string, Set<string>>>;

/** Which packages each `velar.json` project under `examples/` and `tests/fixtures/` declares. */
export function projectPackageOwners(directory?: string): Promise<Map<string, string[]>>;

/** Every test file ownership is derived for: the Node suites plus the acceptance files. */
export function ownedTestFiles(directory?: string): Promise<string[]>;

/** The packages one test file exercises, from its own text. */
export function fileOwners(name: string, text: string, tables: OwnershipTables): string[];

/** A test file's text plus every `tests/` helper it imports, transitively. */
export function testFileEvidence(directory: string, name: string, cache?: Map<string, string>): Promise<string>;

/** Ownership derived from the test files themselves. */
export function deriveOwnership(directory?: string): Promise<DerivedOwnership>;

/** The exact text `--write-ownership` writes and `--check-ownership` compares against. */
export function ownershipText(ownership: OwnershipDocument): string;

/** The committed ownership document. */
export function readOwnership(directory?: string): Promise<OwnershipDocument>;

/** The committed heavy-tier list, or an empty one when there is none. */
export function readHeavy(directory?: string): Promise<HeavyDocument>;

/** The commit this change set is measured against. */
export function changeBase(directory?: string, since?: string | undefined): ChangeBase;

/** Committed changes since the base, plus the working tree and index. */
export function changedPaths(directory: string | undefined, base: ChangeBase): string[];

/** The owner of one changed path, and the D116 §三 rule that decided it. */
export function classifyPath(
  path: string,
  ownership: OwnershipDocument,
  projects: Readonly<Record<string, readonly string[]>>,
): PathOwners;

/** What the quick tier runs for this change set. */
export function buildPlan(options?: PlanOptions): Promise<GatePlan>;

/** The human reading of a plan. */
export function explainPlan(plan: GatePlan): string;

/** The closing summary a gate prints. */
export function summarizePlan(plan: GatePlan, ran: readonly string[]): string;

/** The flags `gate-scope.mjs` and `gate.mjs` share. */
export function parseScopeArguments(argv: readonly string[], extra?: ReadonlySet<string>): ScopeArguments;
