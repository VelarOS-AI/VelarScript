/** One `.js` file under a package's `runtime/`, and what it belongs to. */
export interface RuntimeSourceFile {
  /** File name, relative to `packages/<package>/runtime/`. */
  readonly file: string;
  /** The runtime family the file belongs to, e.g. `collection-host`. */
  readonly family: string;
  /** A constant this file is part of. */
  readonly constant: string;
  /** `__velar…` helpers the file declares at the top level. */
  readonly defines: readonly string[];
  /** `__velar…` helpers the file expects a sibling in its module to declare. */
  readonly requires: readonly string[];
}

/**
 * One part of a constant: another constant (this package's or an imported one),
 * another constant JSON-encoded, a file, the separator between two, or a
 * per-compilation hole with the sample that stands in for it when the module is
 * assembled for checking.
 *
 * `json` is how a module that launches a Worker carries that Worker's source:
 * the emitted module holds it as a string literal, and the Worker's own source
 * stays one file rather than being written a second time, escaped, inside its
 * launcher.
 */
export type RuntimeSourcePart =
  | { readonly constant: string }
  | { readonly json: string }
  | { readonly file: string }
  | { readonly separator: string }
  | { readonly sample: string };

/** One generated constant, and the parts it is assembled from, left to right. */
export interface RuntimeSourceConstant {
  readonly name: string;
  readonly family: string;
  /** The doc comment emitted above the constant, verbatim, one entry per line. */
  readonly documentation?: readonly string[];
  readonly parts: readonly RuntimeSourcePart[];
}

/**
 * A module whose text is only complete at compile time, because it closes over
 * what a project's manifest granted. The generated constants are its invariant
 * runs; `assembled` says which TypeScript function puts the grants back between
 * them, and the `sample` parts make the whole module a parse unit here.
 */
export interface RuntimeSourceAssembly {
  readonly name: string;
  readonly family: string;
  /** `path/to/module.ts#functionName`. */
  readonly assembled: string;
  readonly parts: readonly RuntimeSourcePart[];
}

/** `packages/<package>/runtime/manifest.json`. */
export interface RuntimeSourceManifest {
  readonly decision: string;
  readonly generator: string;
  readonly generated: string;
  readonly gate: string;
  /** Module specifier → the constants this package's parts borrow from it. */
  readonly imports?: Readonly<Record<string, readonly string[]>>;
  readonly files: readonly RuntimeSourceFile[];
  readonly constants: readonly RuntimeSourceConstant[];
  readonly assemblies?: readonly RuntimeSourceAssembly[];
}

/** The generated module for one package root, and everything a caller needs to check it. */
export interface GeneratedRuntimeSources {
  /** The package root, e.g. `core`. */
  readonly package: string;
  readonly manifest: RuntimeSourceManifest;
  /** Absolute path of `packages/<package>/runtime`. */
  readonly base: string;
  /** Absolute path of the generated module the manifest names. */
  readonly generated: string;
  /** File name → its exact text. */
  readonly files: ReadonlyMap<string, string>;
  /** Constant name → the string it will hold, including the imported ones. */
  readonly values: ReadonlyMap<string, string>;
  /** Assembly name → the whole module, with a sample in each per-compilation hole. */
  readonly assemblies: ReadonlyMap<string, string>;
  /** Every disagreement found; generating anything with these unresolved is a bug. */
  readonly problems: readonly string[];
  /** The complete text of the generated module. */
  readonly text: string;
}

/**
 * The package roots whose runtime JavaScript is real source. Adding a root is
 * this list plus that package's `runtime/manifest.json`.
 */
export const RUNTIME_PACKAGES: readonly string[];

/**
 * Reads `packages/<package>/runtime/manifest.json` and the `.js` files it names,
 * asserts every resolved interpolation still matches the constant it was
 * rendered from, and returns the generated module without writing it.
 */
export function generateRuntimeSources(directory?: string, package_?: string): Promise<GeneratedRuntimeSources>;

/** Every package root's generated module, keyed by package, in `RUNTIME_PACKAGES` order. */
export function generateAllRuntimeSources(directory?: string): Promise<ReadonlyMap<string, GeneratedRuntimeSources>>;
