export const VELAR_CREATE_VERSION = "0.29.0";
export const VELAR_PROJECT_FORMAT_VERSION = 2;

/**
 * D110 rule 5 — the surface versions `velar create` writes into a new project's
 * `velar.json`, so a scaffolded project starts out declaring what it was
 * written against.
 *
 * These are literals for the same reason `VELAR_CREATE_VERSION` is one: this
 * package ships no dependencies, deliberately, and a scaffolder cannot read a
 * number out of the packages it is still writing the install line for. That is
 * exactly the shape D110 distrusts — a hand-written version drifts — so it is
 * not left to be remembered. `scripts/check-surface-versions.mjs` compares
 * every entry here against the constant that owns that surface and fails the
 * build on a difference, the way `scripts/release-toolchain.mjs`'s
 * `DECLARED_VERSIONS` already does for the version above. A surface bump
 * reaches this table in the same commit or not at all.
 */
export const VELAR_TEMPLATE_SURFACE_VERSIONS: Readonly<Record<string, string>> = Object.freeze({
  core: "0.7",
  web: "0.12",
  node: "0.16",
  server: "0.15",
  desktop: "0.10",
});
export const VELAR_PROJECT_TEMPLATES = Object.freeze(["web", "node", "desktop", "docs", "library", "component"] as const);

export type VelarProjectTemplate = typeof VELAR_PROJECT_TEMPLATES[number];

export interface CreateProjectOptions {
  readonly cwd?: string;
  readonly template?: VelarProjectTemplate;
}

export interface CreateProjectResult {
  readonly root: string;
  readonly template: VelarProjectTemplate;
}
