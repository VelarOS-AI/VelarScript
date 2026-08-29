import { VELAR_CORE_API_VERSION } from "@velarscript/compiler";

/**
 * D110 — one installation number, five surface versions.
 *
 * `VELAR_VERSION` is the number you install. It steps for every package at
 * once, so it cannot say which of the five observable surfaces actually moved:
 * Desktop's surface sat still for several releases while its package climbed
 * with everybody else's. The surface versions answer the question an upgrade
 * really raises — *which code do I have to re-read?*
 *
 * Every number here is read from the package that owns the surface. None of
 * them is written down twice: D110's background is a website that accumulated
 * two dozen hand-typed release numbers and had every one of them go stale in a
 * single release, and a hand-typed number is the failure this whole mechanism
 * exists to remove. `scripts/check-surface-versions.mjs` hashes each surface
 * and refuses a change that leaves its number behind.
 *
 * `0.N`'s `N` counts how many times that surface has changed since counting
 * began, and it is not a maturity grade: a low number beside a high one means
 * that surface started counting later, and nothing else.
 *
 * The four target constants are imported *lazily*, and that is not an
 * optimization detail — it is the difference between this file costing one
 * command and costing all of them. Reading Web's, Server's and Desktop's
 * numbers means loading three compiler extensions the CLI otherwise touches
 * only when a project activates them, and a static import here would put that
 * on the start of `velar check` and every other command for the sake of a
 * banner almost none of them print. Core's constant is already loaded, because
 * the compiler always is.
 *
 * Three of those four are also optional now (D111): a project installs the
 * targets it declares, so a Core project has no Web, Server or Desktop package
 * to read a number out of. The banner answers for the installation it is in —
 * the same reading `velar.json`'s `surfaces` check already takes, where the
 * installed packages, not the CLI's own pins, decide what a project activates.
 * A surface with nothing installed to speak for it is left out rather than
 * printed from a number written down here, which is exactly the second copy
 * this file exists to avoid.
 */
export async function readSurfaceVersions(): Promise<Readonly<Record<string, string>>> {
  const [web, node, server, desktop] = await Promise.all([
    installedSurface(() => import("@velarscript/web/compiler")),
    import("@velarscript/node/compiler"),
    installedSurface(() => import("@velarscript/server/compiler")),
    installedSurface(() => import("@velarscript/desktop")),
  ]);
  // Declaration order is the order the surface table is printed in (D110 rule 6).
  const versions: Record<string, string> = { core: VELAR_CORE_API_VERSION };
  if (web) versions.web = web.VELAR_WEB_API_VERSION;
  versions.node = node.VELAR_NODE_API_VERSION;
  if (server) versions.server = server.VELAR_SERVER_API_VERSION;
  if (desktop) versions.desktop = desktop.VELAR_DESKTOP_API_VERSION;
  return Object.freeze(versions);
}

/** One optional target's module, or null when this project did not install it. */
async function installedSurface<T>(load: () => Promise<T>): Promise<T | null> {
  try {
    return await load();
  } catch {
    return null;
  }
}

/** One line, three spaces between entries: `core@<n>   web@<n>   …`. */
export async function formatSurfaceVersions(): Promise<string> {
  const versions = await readSurfaceVersions();
  return Object.entries(versions).map(([surface, version]) => `${surface}@${version}`).join("   ");
}
