/** One `.js` file under `packages/compiler/runtime/`, and what it belongs to. */
export interface RuntimeSourceFile {
  /** File name, relative to `packages/compiler/runtime/`. */
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

/** One part of a constant: another constant, a file, or the separator between two. */
export type RuntimeSourcePart =
  | { readonly constant: string }
  | { readonly file: string }
  | { readonly separator: string };

/** One generated constant, and the parts it is assembled from, left to right. */
export interface RuntimeSourceConstant {
  readonly name: string;
  readonly family: string;
  /** The doc comment emitted above the constant, verbatim, one entry per line. */
  readonly documentation?: readonly string[];
  readonly parts: readonly RuntimeSourcePart[];
}

/** `packages/compiler/runtime/manifest.json`. */
export interface RuntimeSourceManifest {
  readonly decision: string;
  readonly generator: string;
  readonly generated: string;
  readonly gate: string;
  readonly files: readonly RuntimeSourceFile[];
  readonly constants: readonly RuntimeSourceConstant[];
}

/** The generated module, and everything a caller needs to check it. */
export interface GeneratedRuntimeSources {
  readonly manifest: RuntimeSourceManifest;
  /** File name → its exact text. */
  readonly files: ReadonlyMap<string, string>;
  /** Constant name → the string it will hold. */
  readonly values: ReadonlyMap<string, string>;
  /** Every disagreement found; generating anything with these unresolved is a bug. */
  readonly problems: readonly string[];
  /** The complete text of `packages/compiler/src/runtime-sources.generated.ts`. */
  readonly text: string;
}

/**
 * Reads `packages/compiler/runtime/manifest.json` and the `.js` files it names,
 * asserts every resolved interpolation still matches the constant it was
 * rendered from, and returns the generated module without writing it.
 */
export function generateRuntimeSources(directory?: string): Promise<GeneratedRuntimeSources>;
