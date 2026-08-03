import { readdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { resolveVelarProject, type VelarProjectConfig } from "./config.ts";
import { compileProjectEntries, type ProjectResult } from "./project.ts";
import { MAX_VELAR_PROJECT_MODULES, readVelarSourceFile, validateVelarSourceText } from "./source-limits.ts";
import { readBoundedText } from "./bounded-text.ts";

interface SessionState {
  config: VelarProjectConfig;
  configKey: string;
  project: ProjectResult | null;
  contents: Map<string, string>;
}

export interface ProjectSessionSnapshot {
  readonly config: VelarProjectConfig;
  readonly project: ProjectResult;
  readonly changedPaths: ReadonlySet<string>;
}

export class VelarProjectSessions {
  private readonly sessions = new Map<string, SessionState>();

  async snapshot(path: string, overrides: ReadonlyMap<string, string> = new Map()): Promise<ProjectSessionSnapshot> {
    const config = await projectForDocument(path);
    const key = configKey(config);
    const existing = this.sessions.get(config.root);
    const state = existing && existing.configKey === key
      ? existing
      : { config, configKey: key, project: null, contents: new Map() };
    state.config = config;
    this.sessions.set(config.root, state);
    const files = await discoverVelarFiles(config);
    if (!files.includes(resolve(path))) files.push(resolve(path));
    if (!files.includes(config.entryPath)) files.push(config.entryPath);

    const contents = new Map<string, string>();
    const changed = new Set<string>();
    for (const file of files) {
      const overridden = overrides.get(file);
      const text = overridden === undefined ? await readVelarSourceFile(file) : validateVelarSourceText(overridden, file);
      contents.set(file, text);
      if (state.contents.get(file) !== text) changed.add(file);
    }
    for (const module of state.project?.modules ?? []) {
      if (contents.has(module.inputPath)) continue;
      try {
        const overridden = overrides.get(module.inputPath);
        const text = overridden === undefined
          ? await readVelarSourceFile(module.inputPath)
          : validateVelarSourceText(overridden, module.inputPath);
        contents.set(module.inputPath, text);
        if (state.contents.get(module.inputPath) !== text) changed.add(module.inputPath);
      } catch {
        changed.add(module.inputPath);
      }
    }
    for (const module of state.project?.modules ?? []) {
      for (const resource of module.result.resources) {
        if (!resource.source.startsWith(".")) continue;
        const resourcePath = resolve(dirname(module.inputPath), resource.source);
        if (contents.has(resourcePath)) continue;
        try {
          const overridden = overrides.get(resourcePath);
          const text = overridden === undefined
            ? await readBoundedText(resourcePath, 4 * 1024 * 1024, `${resource.kind} resource '${resource.source}'`)
            : overridden;
          contents.set(resourcePath, text);
          if (state.contents.get(resourcePath) !== text) changed.add(resourcePath);
        } catch {
          changed.add(resourcePath);
        }
      }
    }
    for (const previous of state.contents.keys()) if (!contents.has(previous)) changed.add(previous);
    if (state.project && changed.size === 0) return { config, project: state.project, changedPaths: changed };

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
    state.contents = new Map(contents);
    for (const module of project.modules) state.contents.set(module.inputPath, module.result.source.text);
    for (const module of project.modules) {
      for (const resource of module.result.resources) {
        if (!resource.source.startsWith(".")) continue;
        const resourcePath = resolve(dirname(module.inputPath), resource.source);
        try {
          state.contents.set(resourcePath, overrides.get(resourcePath)
            ?? await readBoundedText(resourcePath, 4 * 1024 * 1024, `${resource.kind} resource '${resource.source}'`));
        } catch {
          // Failed resources remain represented by project failures and are retried on the next snapshot.
        }
      }
    }
    return { config, project, changedPaths: changed };
  }

  invalidate(root: string): void {
    this.sessions.delete(resolve(root));
  }

  clear(): void {
    this.sessions.clear();
  }
}

function configKey(config: VelarProjectConfig): string {
  return JSON.stringify({
    formatVersion: config.formatVersion,
    manifestPath: config.manifestPath,
    entryPath: config.entryPath,
    outDir: config.outDir,
    publicDir: config.publicDir,
    extensions: config.extensions,
    extensionConfig: [...config.extensionConfig],
    framework: config.framework ? {
      id: config.framework.host.id,
      protocolVersion: config.framework.host.protocolVersion,
      apiVersion: config.framework.host.apiVersion,
    } : null,
  });
}

async function projectForDocument(path: string): Promise<VelarProjectConfig> {
  try {
    return await resolveVelarProject(null, dirname(path));
  } catch {
    return resolveVelarProject(path);
  }
}

async function discoverVelarFiles(config: VelarProjectConfig): Promise<string[]> {
  const output: string[] = [];
  const excluded = new Set([config.outDir, config.publicDir]);
  const visit = async (directory: string): Promise<void> => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "node_modules" || entry.name === ".git" || excluded.has(path)) continue;
        await visit(path);
      } else if (entry.isFile() && entry.name.endsWith(".vel")) {
        output.push(path);
        if (output.length > MAX_VELAR_PROJECT_MODULES) {
          throw new RangeError(`A Velar workspace cannot contain more than ${MAX_VELAR_PROJECT_MODULES} source modules`);
        }
      }
    }
  };
  await visit(config.root);
  return output.sort();
}
