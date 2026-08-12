import { readdir } from "node:fs/promises";
import { basename, dirname, extname, isAbsolute, join, relative, resolve } from "node:path";
import { resolveVelarProjectForDocument, type VelarProjectConfig } from "./config.ts";
import { compileProjectEntries, type ProjectResult } from "./project.ts";
import { MAX_VELAR_PROJECT_MODULES, readVelarSourceFile, validateVelarSourceText } from "./source-limits.ts";
import { readBoundedText } from "./bounded-text.ts";
import { isHostErrorCode } from "./host-error.ts";

interface SessionState {
  config: VelarProjectConfig;
  configKey: string;
  project: ProjectResult | null;
  files: string[];
  nestedRoots: string[];
  contents: Map<string, string>;
}

export interface ProjectSessionActivity {
  readonly strategy: "refresh" | "known-changes";
  readonly workspaceScans: number;
  readonly filesRead: number;
  readonly projectReused: boolean;
}

export interface ProjectSessionSnapshot {
  readonly config: VelarProjectConfig;
  readonly project: ProjectResult;
  readonly changedPaths: ReadonlySet<string>;
  readonly activity: ProjectSessionActivity;
}

export class VelarProjectSessions {
  private readonly sessions = new Map<string, SessionState>();

  /**
   * Performs an authoritative refresh. This resolves the manifest, discovers the
   * workspace, and reads every tracked input so callers that have no file-event
   * stream still observe external changes correctly.
   */
  async snapshot(path: string, overrides: ReadonlyMap<string, string> = new Map()): Promise<ProjectSessionSnapshot> {
    const config = await resolveVelarProjectForDocument(path);
    const key = configKey(config);
    const existing = this.sessions.get(config.root);
    const state = existing && existing.configKey === key
      ? existing
      : { config, configKey: key, project: null, files: [], nestedRoots: [], contents: new Map() };
    state.config = config;
    this.sessions.set(config.root, state);

    const discovery = await discoverVelarFiles(config);
    const files = discovery.files;
    state.nestedRoots = discovery.nestedRoots;
    if (!files.includes(resolve(path))) files.push(resolve(path));
    if (!files.includes(config.entryPath)) files.push(config.entryPath);
    files.sort();

    let filesRead = 0;
    const contents = new Map<string, string>();
    const changed = new Set<string>();
    for (const file of files) {
      const overridden = overrides.get(file);
      const text = overridden === undefined
        ? await readVelarSourceFile(file).finally(() => { filesRead += 1; })
        : validateVelarSourceText(overridden, file);
      contents.set(file, text);
      if (state.contents.get(file) !== text) changed.add(file);
    }
    for (const module of state.project?.modules ?? []) {
      if (contents.has(module.inputPath)) continue;
      try {
        const overridden = overrides.get(module.inputPath);
        const text = overridden === undefined
          ? await readVelarSourceFile(module.inputPath).finally(() => { filesRead += 1; })
          : validateVelarSourceText(overridden, module.inputPath);
        contents.set(module.inputPath, text);
        if (state.contents.get(module.inputPath) !== text) changed.add(module.inputPath);
      } catch {
        changed.add(module.inputPath);
      }
    }
    for (const resourcePath of resourcePaths(state.project)) {
      if (contents.has(resourcePath)) continue;
      try {
        const text = overrides.get(resourcePath)
          ?? await readBoundedText(resourcePath, 4 * 1024 * 1024, "compiler resource").finally(() => { filesRead += 1; });
        contents.set(resourcePath, text);
        if (state.contents.get(resourcePath) !== text) changed.add(resourcePath);
      } catch {
        changed.add(resourcePath);
      }
    }
    for (const dependencyPath of state.project?.externalTypeDependencies.keys() ?? []) {
      if (contents.has(dependencyPath)) continue;
      try {
        const text = overrides.get(dependencyPath)
          ?? await readBoundedText(dependencyPath, 2 * 1024 * 1024, "external type dependency").finally(() => { filesRead += 1; });
        contents.set(dependencyPath, text);
        if (state.contents.get(dependencyPath) !== text) changed.add(dependencyPath);
      } catch {
        changed.add(dependencyPath);
      }
    }
    for (const previous of state.contents.keys()) if (!contents.has(previous)) changed.add(previous);
    if (state.project && changed.size === 0) {
      state.files = files;
      return {
        config,
        project: state.project,
        changedPaths: changed,
        activity: { strategy: "refresh", workspaceScans: 1, filesRead, projectReused: true },
      };
    }

    const project = await compile(state, files, contents, changed);
    filesRead += await cacheNewProjectInputs(state, overrides);
    return {
      config,
      project,
      changedPaths: changed,
      activity: { strategy: "refresh", workspaceScans: 1, filesRead, projectReused: false },
    };
  }

  /**
   * Applies an explicit file-event set without resolving the manifest, walking
   * the workspace, or rereading unrelated inputs. It falls back to an
   * authoritative refresh when no compatible session exists or the manifest is
   * among the changed paths.
   */
  async update(
    path: string,
    changedPaths: ReadonlySet<string>,
    overrides: ReadonlyMap<string, string> = new Map(),
  ): Promise<ProjectSessionSnapshot> {
    const documentPath = resolve(path);
    const state = this.sessionFor(documentPath);
    const normalizedChanges = new Set([...changedPaths].map((item) => resolve(item)));
    if (!state || [...normalizedChanges].some((item) => basename(item) === "velar.json" && withinRoot(state.config.root, item))) {
      return this.snapshot(documentPath, overrides);
    }

    const contents = new Map(state.contents);
    const files = new Set(state.files);
    const changed = new Set<string>();
    const modulePaths = new Set((state.project?.modules ?? []).map((module) => module.inputPath));
    const resources = resourcePaths(state.project);
    let filesRead = 0;

    for (const [overridePath, source] of overrides) {
      const target = resolve(overridePath);
      if (!this.ownedBy(state, target)) continue;
      const text = extname(target) === ".vel" ? validateVelarSourceText(source, target) : source;
      if (contents.get(target) === text) continue;
      contents.set(target, text);
      if (extname(target) === ".vel" && withinRoot(state.config.root, target)) files.add(target);
      changed.add(target);
    }

    for (const target of normalizedChanges) {
      if (!this.ownedBy(state, target) || overrides.has(target)) continue;
      const kind = inputKind(state, target, modulePaths, resources);
      if (!kind) continue;
      try {
        const text = kind === "source"
          ? await readVelarSourceFile(target).finally(() => { filesRead += 1; })
          : await readBoundedText(target, kind === "resource" ? 4 * 1024 * 1024 : 2 * 1024 * 1024, kind).finally(() => { filesRead += 1; });
        if (contents.get(target) !== text) changed.add(target);
        contents.set(target, text);
        if (kind === "source" && withinRoot(state.config.root, target)) files.add(target);
      } catch (error) {
        if (!isHostErrorCode(error, "ENOENT") && !isHostErrorCode(error, "ENOTDIR")) throw error;
        if (contents.has(target) || files.has(target) || modulePaths.has(target)) changed.add(target);
        contents.delete(target);
        files.delete(target);
      }
    }

    if (state.project && changed.size === 0) {
      return {
        config: state.config,
        project: state.project,
        changedPaths: changed,
        activity: { strategy: "known-changes", workspaceScans: 0, filesRead, projectReused: true },
      };
    }

    const project = await compile(state, [...files].sort(), contents, changed);
    filesRead += await cacheNewProjectInputs(state, overrides);
    return {
      config: state.config,
      project,
      changedPaths: changed,
      activity: { strategy: "known-changes", workspaceScans: 0, filesRead, projectReused: false },
    };
  }

  invalidate(root: string): void {
    this.sessions.delete(resolve(root));
  }

  clear(): void {
    this.sessions.clear();
  }

  rootFor(path: string): string | null {
    return this.sessionFor(resolve(path))?.config.root ?? null;
  }

  private sessionFor(path: string): SessionState | null {
    let selected: SessionState | null = null;
    for (const state of this.sessions.values()) {
      const known = state.files.includes(path)
        || state.contents.has(path)
        || state.project?.modules.some((module) => module.inputPath === path);
      if (!known) continue;
      if (!selected || state.config.root.length > selected.config.root.length) selected = state;
    }
    return selected;
  }

  private ownedBy(state: SessionState, path: string): boolean {
    if (!belongsToSession(state, path)) return false;
    if (!withinRoot(state.config.root, path)) return true;
    if (state.nestedRoots.some((root) => withinRoot(root, path))) return false;
    for (const candidate of this.sessions.values()) {
      if (candidate === state || candidate.config.root.length <= state.config.root.length) continue;
      if (withinRoot(candidate.config.root, path)) return false;
    }
    return true;
  }
}

async function compile(
  state: SessionState,
  files: string[],
  contents: Map<string, string>,
  changed: ReadonlySet<string>,
): Promise<ProjectResult> {
  const config = state.config;
  const project = await compileProjectEntries(
    files,
    config.entryPath,
    contents,
    {
      sourceRoot: config.root,
      projectRoot: config.root,
      publicRoot: config.publicDir,
      extensions: config.compilerExtensions,
      extensionConfig: config.extensionConfig,
      framework: config.framework,
    },
    state.project,
    changed,
  );
  state.project = project;
  state.files = files;
  state.contents = contents;
  for (const module of project.modules) state.contents.set(module.inputPath, module.result.source.text);
  return project;
}

async function cacheNewProjectInputs(state: SessionState, overrides: ReadonlyMap<string, string>): Promise<number> {
  let filesRead = 0;
  for (const resourcePath of resourcePaths(state.project)) {
    if (state.contents.has(resourcePath)) continue;
    try {
      state.contents.set(resourcePath, overrides.get(resourcePath)
        ?? await readBoundedText(resourcePath, 4 * 1024 * 1024, "compiler resource").finally(() => { filesRead += 1; }));
    } catch {
      // Failed resources remain represented by project failures and are retried after a matching file event.
    }
  }
  for (const dependencyPath of state.project?.externalTypeDependencies.keys() ?? []) {
    if (state.contents.has(dependencyPath)) continue;
    try {
      state.contents.set(dependencyPath, overrides.get(dependencyPath)
        ?? await readBoundedText(dependencyPath, 2 * 1024 * 1024, "external type dependency").finally(() => { filesRead += 1; }));
    } catch {
      // Missing declarations remain represented by the rebuilt bridge and are retried after a matching file event.
    }
  }
  return filesRead;
}

function resourcePaths(project: ProjectResult | null): Set<string> {
  const paths = new Set<string>();
  for (const module of project?.modules ?? []) {
    for (const resource of module.result.resources) {
      if (resource.source.startsWith(".")) paths.add(resolve(dirname(module.inputPath), resource.source));
    }
  }
  return paths;
}

function inputKind(
  state: SessionState,
  path: string,
  modulePaths: ReadonlySet<string>,
  resources: ReadonlySet<string>,
): "source" | "resource" | "external type dependency" | null {
  if (extname(path) === ".vel" && (withinRoot(state.config.root, path)
    || state.contents.has(path)
    || modulePaths.has(path))) return "source";
  if (resources.has(path)) return "resource";
  if (state.project?.externalTypeDependencies.has(path)) return "external type dependency";
  return null;
}

function belongsToSession(state: SessionState, path: string): boolean {
  return withinRoot(state.config.root, path)
    || state.contents.has(path)
    || state.project?.modules.some((module) => module.inputPath === path)
    || state.project?.externalTypeDependencies.has(path)
    || resourcePaths(state.project).has(path);
}

function withinRoot(root: string, path: string): boolean {
  const value = relative(root, path);
  return value === "" || (!value.startsWith("..") && !isAbsolute(value));
}

function configKey(config: VelarProjectConfig): string {
  return JSON.stringify({
    formatVersion: config.formatVersion,
    manifestPath: config.manifestPath,
    manifestIdentity: config.manifestIdentity,
    entryPath: config.entryPath,
    outDir: config.outDir,
    publicDir: config.publicDir,
    extensions: config.extensions,
    framework: config.framework ? {
      id: config.framework.host.id,
      protocolVersion: config.framework.host.protocolVersion,
      apiVersion: config.framework.host.apiVersion,
    } : null,
  });
}

async function discoverVelarFiles(config: VelarProjectConfig): Promise<{ files: string[]; nestedRoots: string[] }> {
  const output: string[] = [];
  const nestedRoots: string[] = [];
  const excluded = new Set([config.outDir, config.publicDir]);
  const visit = async (directory: string): Promise<void> => {
    const entries = await readdir(directory, { withFileTypes: true });
    if (directory !== config.root && entries.some((entry) => entry.isFile() && entry.name === "velar.json")) {
      nestedRoots.push(directory);
      return;
    }
    for (const entry of entries) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "node_modules" || entry.name === ".git" || excluded.has(path)) continue;
        await visit(path);
      } else if (entry.isFile() && entry.name.endsWith(".vel")) {
        output.push(path);
        if (output.length > MAX_VELAR_PROJECT_MODULES) {
          throw new RangeError(`A VelarScript workspace cannot contain more than ${MAX_VELAR_PROJECT_MODULES} source modules`);
        }
      }
    }
  };
  await visit(config.root);
  return { files: output.sort(), nestedRoots: nestedRoots.sort() };
}
