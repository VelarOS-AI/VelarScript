/**
 * What one running development server knows and changes while it runs.
 *
 * The rebuild scheduler, the watchers and the request handler read and write
 * this record instead of closing over one another's variables, so each of them
 * can be read on its own — and each of them sees the current value, because
 * every read goes through the record rather than through a copy.
 */

import type { ServerResponse } from "node:http";
import type { FrameworkHostArtifacts } from "@velarscript/compiler/framework-host";
import type { BrowserNpmPackage } from "../npm.ts";
import type { ProjectResult } from "../project.ts";

export interface Snapshot {
  readonly project: ProjectResult;
  readonly artifacts: FrameworkHostArtifacts | null;
  readonly errors: readonly string[];
  /** The package-owned part of the import map, exactly as supplied to the host. */
  readonly packageImportsKey: string;
  readonly npmPackages: readonly BrowserNpmPackage[];
  /** Page and Worker npm roots whose source changes require a rebuild. */
  readonly npmWatchRoots: readonly string[];
  readonly compilation: ProjectResult["stats"];
  readonly notices: readonly string[];
  readonly workerModules: ReadonlyMap<string, string>;
}

export interface DirectoryTreeWatcher {
  close(): void;
}

export interface DevelopmentRebuild {
  readonly previous: ProjectResult | null;
  readonly changedPaths: ReadonlySet<string>;
  readonly staleNpmRoots: ReadonlySet<string>;
  readonly revision: number;
  readonly packageImportsKey: string;
}

export interface BranchDirectoryTreeWatcher extends DirectoryTreeWatcher {
  /**
   * The directories that hold a watch. The exclusion is structural here, so an
   * excluded tree never appears — which is the whole point of this branch.
   */
  watchedDirectories(): readonly string[];
}

export interface DevelopmentServerState {
  snapshot: Snapshot;
  compiling: Promise<void> | null;
  revision: number;
  rebuildTimer: ReturnType<typeof setTimeout> | null;
  closing: boolean;
  forceFullRebuild: boolean;
  dirtyRevision: number;
  readonly dirtyPaths: Set<string>;
  readonly clients: Set<ServerResponse>;
  readonly packageWatchers: Map<string, DirectoryTreeWatcher>;
  /**
   * Installed npm package roots whose files changed since the last successful
   * rebuild; their dev prebundles are rebuilt instead of served from cache.
   */
  readonly npmPackageRoots: Set<string>;
  readonly staleNpmRoots: Set<string>;
  /**
   * The trees no watcher in this server reports from. `.velar` and
   * `node_modules` are dropped on every platform; the project's own output
   * directory is named here because it is configured. A package `imports`
   * alias can make the project root a package root too, so the package
   * watchers take the same set rather than only the tree watcher.
   */
  readonly excludedWatchDirectories: ReadonlySet<string>;
}
