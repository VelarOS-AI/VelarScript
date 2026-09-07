import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { compile } from "@velarscript/compiler";
import { standardModuleSources } from "../../packages/cli/src/standard-modules.ts";
import { cliPath } from "./run-cli.ts";

/**
 * D115 P5 — the harness the D114 audit regressions share.
 *
 * `tests/compiler/types/bounded-generics-and-dispose.slow.test.ts` split into
 * six subject files, and this section is what all six needed: the four ways
 * those regressions state a case — what a compile reports, that it reports
 * nothing, what the program prints when it runs with every standard module
 * linked in, and what the `velar` entry point does with a real project on
 * disk. `cliPath` is `run-cli.ts`'s, which is the same path this file used to
 * spell for itself. The bodies below are the bodies that file had.
 */

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

export function messages(source: string, extensions: readonly unknown[] = []): readonly string[] {
  return compile(source, { extensions: extensions as never }).diagnostics.map((item) => item.message);
}

export function clean(source: string): void {
  const result = compile(source);
  assert.deepEqual(result.diagnostics, [], result.diagnostics.map((item) => item.message).join("\n"));
}

function linkedModuleUrls(): ReadonlyMap<string, string> {
  const sources = standardModuleSources();
  const urls = new Map<string, string>();
  const encode = (source: string): string => `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;
  const link = (source: string): string => {
    let linked = source;
    for (const name of sources.keys()) linked = linked.replaceAll(JSON.stringify(name), JSON.stringify(urls.get(name)!));
    return linked;
  };
  for (const [name, source] of sources) urls.set(name, encode(source));
  for (let pass = 0; pass < 3; pass += 1) {
    for (const [name, source] of sources) urls.set(name, encode(link(source)));
  }
  return urls;
}

export function execute(code: string): { readonly status: number | null; readonly stdout: string; readonly stderr: string } {
  const urls = linkedModuleUrls();
  let linked = code;
  for (const [name, url] of urls) linked = linked.replaceAll(JSON.stringify(name), JSON.stringify(url));
  const result = spawnSync(process.execPath, ["--input-type=module"], { encoding: "utf8", input: linked, timeout: 30_000 });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

export function run(source: string): string {
  const result = compile(source);
  assert.deepEqual(result.diagnostics, [], result.diagnostics.map((item) => item.message).join("\n"));
  const execution = execute(result.code ?? "");
  assert.equal(execution.status, 0, execution.stderr);
  return execution.stdout;
}

export interface CliProject {
  readonly root: string;
  cli(...commandArguments: readonly string[]): { readonly status: number | null; readonly stdout: string; readonly stderr: string };
}

/**
 * A real project on disk driven through the `velar` entry point. NEW-D1 is the
 * reason this exists: every CLI entry compiles with shared runtime modules,
 * while `compileCore` inlines them, so a defect in the shared-module wiring is
 * invisible to a compile-level test and green against a broken product.
 */
export async function cliProject(files: Readonly<Record<string, string>>, web = false): Promise<CliProject> {
  const root = await mkdtemp(join(tmpdir(), "velar-wave-c2-"));
  await writeFile(join(root, "velar.json"), JSON.stringify({
    formatVersion: 2,
    entry: "src/main.vel",
    ...(web ? { extensions: ["@velarscript/web"] } : {}),
  }), "utf8");
  for (const [name, source] of Object.entries(files)) {
    const path = join(root, name);
    await mkdir(join(path, ".."), { recursive: true });
    await writeFile(path, source, "utf8");
  }
  return {
    root,
    cli(...commandArguments) {
      const result = spawnSync(process.execPath, [cliPath, ...commandArguments], { cwd: root, encoding: "utf8", timeout: 120_000 });
      return { status: result.status, stdout: result.stdout, stderr: result.stderr };
    },
  };
}
