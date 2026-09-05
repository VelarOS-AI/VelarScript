import { readdir } from "node:fs/promises";
import { basename, extname, isAbsolute, join, relative, resolve } from "node:path";
import { resolveVelarProjectForDocument, type VelarProjectConfig } from "./config.ts";
import { compileProjectEntries, type ProjectResult } from "./project.ts";
import {
  projectSessionDependencyInputs,
  projectSessionNeedsFullRebuild,
  type ProjectSessionDependencyInput,
} from "./project-session-inputs.ts";
import { MAX_VELAR_PROJECT_MODULES, readVelarSourceFile, validateVelarSourceText } from "./source-limits.ts";
import {
  boundedFileFingerprint,
  sameFileFingerprint,
  textFingerprint,
  type FileContentFingerprint,
} from "./file-fingerprint.ts";
import { isHostErrorCode } from "./host-error.ts";
import { projectPackageTarget } from "./project-package-target.ts";

interface SessionState {
  config: VelarProjectConfig;
  configKey: string;
  project: ProjectResult | null;
  files: string[];
  nestedRoots: string[];
  contents: Map<string, string>;
  dependencyInputs: Map<string, ProjectSessionDependencyInput>;
  dependencyFingerprints: Map<string, FileContentFingerprint>;
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
      : {
        config,
        configKey: key,
        project: null,
        files: [],
        nestedRoots: [],
        contents: new Map(),
        dependencyInputs: new Map(),
        dependencyFingerprints: new Map(),
      };
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
    const dependencyFingerprints = new Map<string, FileContentFingerprint>();
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
    for (const input of state.dependencyInputs.values()) {
      try {
        const overridden = overrides.get(input.path);
        const fingerprint = overridden === undefined
          ? await boundedFileFingerprint(input.path, input.maxBytes, input.kind).finally(() => { filesRead += 1; })
          : boundedOverrideFingerprint(overridden, input);
        if (overridden !== undefined) contents.set(input.path, overridden);
        dependencyFingerprints.set(input.path, fingerprint);
        if (!sameFileFingerprint(state.dependencyFingerprints.get(input.path), fingerprint)) changed.add(input.path);
      } catch {
        changed.add(input.path);
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
    filesRead += await cacheNewProjectInputs(state, overrides, dependencyFingerprints);
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
    const dependencyFingerprints = new Map(state.dependencyFingerprints);
    const files = new Set(state.files);
    const changed = new Set<string>();
    const modulePaths = new Set((state.project?.modules ?? []).map((module) => module.inputPath));
    let filesRead = 0;

    for (const [overridePath, source] of overrides) {
      const target = resolve(overridePath);
      if (!this.ownedBy(state, target)) continue;
      const dependency = state.dependencyInputs.get(target);
      if (dependency) {
        const fingerprint = boundedOverrideFingerprint(source, dependency);
        contents.set(target, source);
        if (!sameFileFingerprint(dependencyFingerprints.get(target), fingerprint)) changed.add(target);
        dependencyFingerprints.set(target, fingerprint);
        continue;
      }
      const text = extname(target) === ".vel" ? validateVelarSourceText(source, target) : source;
      if (contents.get(target) === text) continue;
      contents.set(target, text);
      if (extname(target) === ".vel" && withinRoot(state.config.root, target)) files.add(target);
      changed.add(target);
    }

    for (const target of normalizedChanges) {
      if (!this.ownedBy(state, target) || overrides.has(target)) continue;
      const input = sessionInput(state, target, modulePaths);
      if (!input) continue;
      try {
        if (input === "source") {
          const text = await readVelarSourceFile(target).finally(() => { filesRead += 1; });
          if (contents.get(target) !== text) changed.add(target);
          contents.set(target, text);
          if (withinRoot(state.config.root, target)) files.add(target);
        } else {
          const fingerprint = await boundedFileFingerprint(target, input.maxBytes, input.kind).finally(() => { filesRead += 1; });
          if (!sameFileFingerprint(dependencyFingerprints.get(target), fingerprint)) changed.add(target);
          dependencyFingerprints.set(target, fingerprint);
          contents.delete(target);
        }
      } catch (error) {
        if (!isHostErrorCode(error, "ENOENT") && !isHostErrorCode(error, "ENOTDIR")) throw error;
        if (input !== "source" || contents.has(target) || files.has(target) || modulePaths.has(target)
          || dependencyFingerprints.has(target)) changed.add(target);
        contents.delete(target);
        dependencyFingerprints.delete(target);
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
    filesRead += await cacheNewProjectInputs(state, overrides, dependencyFingerprints);
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
  const previousModulePaths = new Set(state.project?.modules.map((module) => module.inputPath));
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
      packageTarget: projectPackageTarget(config),
    },
    projectSessionNeedsFullRebuild(state.dependencyInputs, changed) ? null : state.project,
    changed,
  );
  state.project = project;
  state.files = files;
  state.contents = contents;
  for (const module of project.modules) state.contents.set(module.inputPath, module.result.source.text);
  if (!projectHasErrors(project)) {
    const currentModulePaths = new Set(project.modules.map((module) => module.inputPath));
    for (const path of previousModulePaths) {
      if (!currentModulePaths.has(path) && !files.includes(path)) state.contents.delete(path);
    }
  }
  return project;
}

async function cacheNewProjectInputs(
  state: SessionState,
  overrides: ReadonlyMap<string, string>,
  observed: ReadonlyMap<string, FileContentFingerprint>,
): Promise<number> {
  let filesRead = 0;
  const next = new Map(projectSessionDependencyInputs(state.project));
  const failed = state.project !== null && projectHasErrors(state.project);
  if (failed) {
    for (const [path, input] of state.dependencyInputs) if (!next.has(path)) next.set(path, input);
  } else {
    const sourcePaths = new Set(state.project?.modules.map((module) => module.inputPath));
    for (const path of state.dependencyInputs.keys()) {
      if (!next.has(path) && !sourcePaths.has(path) && !state.files.includes(path)) state.contents.delete(path);
    }
  }
  state.dependencyInputs = next;
  const fingerprints = new Map<string, FileContentFingerprint>();
  for (const input of next.values()) {
    const known = observed.get(input.path);
    if (known) {
      fingerprints.set(input.path, known);
      continue;
    }
    try {
      const overridden = overrides.get(input.path);
      const fingerprint = overridden === undefined
        ? await boundedFileFingerprint(input.path, input.maxBytes, input.kind).finally(() => { filesRead += 1; })
        : boundedOverrideFingerprint(overridden, input);
      if (overridden !== undefined) state.contents.set(input.path, overridden);
      else state.contents.delete(input.path);
      fingerprints.set(input.path, fingerprint);
    } catch {
      // The project diagnostic remains authoritative; the input stays watched so a matching event can recover it.
    }
  }
  state.dependencyFingerprints = fingerprints;
  return filesRead;
}

function boundedOverrideFingerprint(value: string, input: ProjectSessionDependencyInput): FileContentFingerprint {
  const fingerprint = textFingerprint(value);
  if (fingerprint.bytes > input.maxBytes) throw new RangeError(`${input.kind} exceeds ${input.maxBytes} bytes`);
  return fingerprint;
}

function projectHasErrors(project: ProjectResult): boolean {
  return project.failures.length > 0 || project.modules.some((module) => module.result.diagnostics.length > 0);
}

function sessionInput(
  state: SessionState,
  path: string,
  modulePaths: ReadonlySet<string>,
): "source" | ProjectSessionDependencyInput | null {
  if (extname(path) === ".vel" && (withinRoot(state.config.root, path)
    || state.contents.has(path)
    || modulePaths.has(path))) return "source";
  return state.dependencyInputs.get(path) ?? null;
}

function belongsToSession(state: SessionState, path: string): boolean {
  return withinRoot(state.config.root, path)
    || state.contents.has(path)
    || state.project?.modules.some((module) => module.inputPath === path)
    || state.dependencyInputs.has(path);
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
