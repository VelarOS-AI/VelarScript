/** Every directory at or below `directory` that holds a `velar.json` manifest. */
export function velarProjects(directory: string): Promise<string[]>;

/** Every `.vel` file at or below `directory`, ignoring build and dependency output. */
export function velarSources(directory: string): Promise<string[]>;
