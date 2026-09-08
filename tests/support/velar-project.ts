import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolve } from "node:path";

const cli = resolve("packages/cli/src/cli.ts");

/** The manifest a Node-surface probe project needs, and nothing else. */
const NODE_MANIFEST = `${JSON.stringify({
  formatVersion: 2,
  kind: "application",
  entry: "src/main.vel",
  outDir: "dist",
  extensions: ["@velarscript/node"],
  surfaces: { core: "0.9", node: "0.17" },
}, null, 2)}\n`;

export interface VelarProjectRun {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
  /** The project root, still on disk, for a test that wants to look at it. */
  readonly root: string;
}

/**
 * D115 §一.6: the one copy of "compile and run this VelarScript program the way
 * a person would". A Node-surface project needs no installed packages — the CLI
 * materializes the standard modules its manifest selects — so a probe is a
 * directory, a manifest, and one `.vel` file.
 *
 * `files` maps project-relative paths to their contents; `src/main.vel` is the
 * entry, and a probe on another surface names its own `velar.json` there, which
 * is written after this one. The directory is removed unless `keep` is set.
 */
export async function runVelarProject(
  files: Readonly<Record<string, string>>,
  options: {
    readonly command?: "run" | "check" | "fix" | "build" | "test";
    readonly keep?: boolean;
    readonly prefix?: string;
    /** Arguments after the project root, such as `--mode readable` for a build. */
    readonly extraArguments?: readonly string[];
    /** The working directory the CLI is started from; the project root by default. */
    readonly cwd?: string;
  } = {},
): Promise<VelarProjectRun> {
  const root = await mkdtemp(join(tmpdir(), options.prefix ?? "velar-node-probe-"));
  try {
    await writeFile(join(root, "velar.json"), NODE_MANIFEST, "utf8");
    for (const [path, contents] of Object.entries(files)) {
      const target = join(root, path);
      await mkdir(join(target, ".."), { recursive: true });
      await writeFile(target, contents, "utf8");
    }
    const result: SpawnSyncReturns<string> = spawnSync(
      process.execPath,
      [cli, options.command ?? "run", root, ...options.extraArguments ?? []],
      { encoding: "utf8", cwd: options.cwd ?? root, timeout: 120_000 },
    );
    return { status: result.status, stdout: result.stdout ?? "", stderr: result.stderr ?? "", root };
  } finally {
    if (options.keep !== true) await rm(root, { recursive: true, force: true });
  }
}
