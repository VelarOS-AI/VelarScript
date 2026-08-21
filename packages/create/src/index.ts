import { lstat, mkdir, mkdtemp, readdir, rename, rm, rmdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { createTemplateFiles } from "./templates.ts";
import {
  VELAR_CREATE_VERSION,
  VELAR_PROJECT_FORMAT_VERSION,
  VELAR_PROJECT_TEMPLATES,
  type CreateProjectOptions,
  type CreateProjectResult,
} from "./types.ts";

export { parseCreateArguments, type CreateArguments } from "./arguments.ts";
export {
  VELAR_CREATE_VERSION,
  VELAR_PROJECT_FORMAT_VERSION,
  VELAR_PROJECT_TEMPLATES,
  type CreateProjectOptions,
  type CreateProjectResult,
  type VelarProjectTemplate,
} from "./types.ts";

export async function createVelarProject(input: string, options: CreateProjectOptions = {}): Promise<CreateProjectResult> {
  if (!input || input.trim().length === 0 || input.includes("\0")) throw new Error("a project directory is required");
  const cwd = options.cwd ?? process.cwd();
  const root = resolve(cwd, input);
  const template = options.template ?? "web";
  if (!(VELAR_PROJECT_TEMPLATES as readonly string[]).includes(template)) {
    throw new Error(`unsupported VelarScript project template '${String(template)}'`);
  }
  const existing = await pathState(root);
  if (existing !== "missing") {
    if (existing !== "directory") throw new Error(`'${input}' already exists and is not an ordinary directory`);
    const entries = await readdir(root);
    if (entries.length > 0) throw new Error(`'${input}' already exists and is not empty`);
  }

  await mkdir(dirname(root), { recursive: true });
  const staging = await mkdtemp(join(dirname(root), ".velar-create-"));
  try {
    const files = createTemplateFiles(template, root, VELAR_CREATE_VERSION, VELAR_PROJECT_FORMAT_VERSION);
    // Code-unit order, not localeCompare: collation follows the process
    // environment, so the same template would be written in a different order
    // under a different LC_ALL. This package ships no dependencies, so the
    // comparison is inlined rather than imported; the reasoning is spelled out
    // once at byCodeUnit in packages/cli/src/stable-order.ts.
    const byCodeUnit = (left: string, right: string): number => (left < right ? -1 : left > right ? 1 : 0);
    for (const [relativePath, contents] of [...files].sort(([left], [right]) => byCodeUnit(left, right))) {
      const path = join(staging, relativePath);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, contents, { encoding: "utf8", flag: "wx" });
    }
    if (existing === "directory") await rmdir(root);
    await rename(staging, root);
  } catch (error) {
    await rm(staging, { recursive: true, force: true });
    if (existing === "directory" && await pathState(root) === "missing") await mkdir(root);
    throw error;
  }
  return { root, template };
}

async function pathState(path: string): Promise<"missing" | "directory" | "other"> {
  try {
    const information = await lstat(path);
    return information.isDirectory() && !information.isSymbolicLink() ? "directory" : "other";
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return "missing";
    throw error;
  }
}
