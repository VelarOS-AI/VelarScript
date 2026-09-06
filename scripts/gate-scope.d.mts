/** The owner of a path that is the repository itself: everything downstream of the compiler. */
export const REPOSITORY_OWNER: "repo";
/** The owner of a documentation path: `check` and nothing else. */
export const DOCUMENTATION_OWNER: "docs";
/** The generated ownership document, relative to the repository root. */
export const OWNERSHIP_FILE: string;
/** The judged answers to the consistency report, relative to the repository root. */
export const OWNERSHIP_EXCEPTIONS_FILE: string;
/** The committed emitted-output listing, relative to the repository root. */
export const FINGERPRINT_LOCK: string;

/** A package name, `repo`, or `docs`. */
export type Owner = string;

/** One test whose directory names one owner while its imports reach another. */
export interface ConsistencyFinding {
  readonly declared: Owner;
  readonly exercises: readonly Owner[];
}

/** Owners a test holds only through something other than its own text, beside what carried them. */
export type OwnerAttribution = Readonly<Record<string, Readonly<Record<Owner, readonly string[]>>>>;

export interface OwnershipDocument {
  readonly packages: readonly string[];
  readonly unclassified: readonly string[];
  readonly consistency?: Readonly<Record<string, ConsistencyFinding>>;
  /** Owners a `tests/` helper the file imports carries for it, by helper (D114 GA-I3). */
  readonly viaHelper?: OwnerAttribution;
  /** Owners the publisher roster kept because they are leaf publishers, by specifier (D114 GA-I2). */
  readonly viaRoster?: OwnerAttribution;
  readonly tests: Readonly<Record<string, readonly Owner[]>>;
}

/** One hand-written judgment: the surplus owners excused, and why. */
export interface OwnershipException {
  readonly exercises: readonly Owner[];
  readonly reason: string;
}

export type OwnershipExceptions = Readonly<Record<string, OwnershipException>>;

/** The consistency report read against the judgments, in both directions. */
export interface ConsistencyAudit {
  /** Findings no entry answers, with the owners still unaccounted for. */
  readonly unexplained: readonly { readonly name: string; readonly exercises: readonly Owner[]; readonly missing: readonly Owner[] }[];
  /** Entries whose finding is gone, or that excuse an owner the file no longer reaches. */
  readonly stale: readonly { readonly name: string; readonly surplus: readonly Owner[]; readonly why: string }[];
  /** Entries with no reason written on them. */
  readonly unreasoned: readonly string[];
}

export interface DerivedOwnership extends OwnershipDocument {
  readonly packages: string[];
  readonly unclassified: string[];
  readonly consistency: Record<string, ConsistencyFinding>;
  readonly viaHelper: Record<string, Record<Owner, string[]>>;
  readonly viaRoster: Record<string, Record<Owner, string[]>>;
  readonly tests: Record<string, string[]>;
}

export interface HeavyEntry {
  readonly seconds: number;
  readonly reason: string;
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
  readonly heavy?: readonly string[];
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

/** What `fileOwners` fills in when it is given somewhere to write it. */
export interface FileOwnerRecord {
  /** The owners only rule 3's leaf clause put in the answer, each beside the specifiers that did it. */
  viaRoster?: Record<Owner, string[]>;
}

/** The packages one test file exercises, from its own text. */
export function fileOwners(name: string, text: string, tables: OwnershipTables, record?: FileOwnerRecord): string[];

/** TypeScript source with its comments removed, so a described path is not read as a run one. */
export function stripComments(text: string): string;

/** A test file's code plus every `tests/` helper it imports, transitively, comments removed. */
export function testFileEvidence(directory: string, name: string, cache?: Map<string, string>): Promise<string>;

/** One file's own code, comments removed — the evidence before any helper's is added to it. */
export function testFileText(directory: string, name: string, cache?: Map<string, string>): Promise<string>;

/** Every `tests/` module one file imports, transitively, in the order they are first reached. */
export function testHelperFiles(
  directory: string,
  name: string,
  cache?: Map<string, string[]>,
  textCache?: Map<string, string>,
): Promise<string[]>;

/** Ownership derived from the test files themselves. */
export function deriveOwnership(directory?: string): Promise<DerivedOwnership>;

/** The exact text `--write-ownership` writes and `--check-ownership` compares against. */
export function ownershipText(ownership: OwnershipDocument): string;

/** The committed ownership document. */
export function readOwnership(directory?: string): Promise<OwnershipDocument>;

/** The hand-written judgments answering the consistency report; `{}` when the file is absent. */
export function readOwnershipExceptions(directory?: string): Promise<OwnershipExceptions>;

/** The consistency report read against the judgments: what is unexplained, stale, or unreasoned. */
export function auditConsistency(
  consistency: Readonly<Record<string, ConsistencyFinding>> | undefined,
  exceptions: OwnershipExceptions,
): ConsistencyAudit;

/** The heavy tier: every `*.slow.test.ts`, read from the names themselves. */
export function heavyNodeTests(directory?: string): Promise<string[]>;

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
