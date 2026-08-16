/** One export form the scanner could not read, with the text that defeated it. */
export interface EsModuleExportProblem {
  readonly reason: string;
  readonly text: string;
}

/** What a module publishes, and what could not be read while finding out. */
export interface EsModuleExportSurface {
  /** Every name the module exports, in source order. */
  readonly names: string[];
  /** Export forms outside this scanner's boundary. A caller must fail on these. */
  readonly unreadable: EsModuleExportProblem[];
}

/** The names `source` exports, read from its export syntax rather than matched. */
export function esModuleExports(source: string): EsModuleExportSurface;
