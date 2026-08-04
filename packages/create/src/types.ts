export const VELAR_CREATE_VERSION = "0.10.0-dev";
export const VELAR_PROJECT_FORMAT_VERSION = 2;
export const VELAR_PROJECT_TEMPLATES = Object.freeze(["web", "docs", "library", "component"] as const);

export type VelarProjectTemplate = typeof VELAR_PROJECT_TEMPLATES[number];

export interface CreateProjectOptions {
  readonly cwd?: string;
  readonly template?: VelarProjectTemplate;
}

export interface CreateProjectResult {
  readonly root: string;
  readonly template: VelarProjectTemplate;
}
