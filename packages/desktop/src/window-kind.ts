/**
 * The window kind a Desktop application always declares and the host always
 * opens at launch. Every other kind is opened by `openWindow`.
 *
 * It has a module of its own because two modules in this directory need the
 * name and neither may depend on the other: `config.ts` validates the
 * `desktop.windows` table that must declare it, and `manifest-migration.ts`
 * writes it into a manifest that predates that table. `config.ts` imported the
 * migration and the migration imported this constant back out of `config.ts`,
 * which is the one import cycle D115 R6's `check:module-map` found in the
 * repository; the shared name moves down to a module both of them import,
 * exactly as D114's "P4 R4b 落地" broke `diagnostics ↔ incremental` with
 * `project/scc.ts`.
 *
 * `config.ts` re-exports it, so `./config.ts` remains the import path every
 * other module and `index.ts` already use. This module is not the public one.
 */
export const DESKTOP_MAIN_WINDOW_KIND = "main";
