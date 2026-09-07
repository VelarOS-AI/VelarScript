import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { velarCompilerExtension } from "../../packages/desktop/src/compiler.ts";
import { velarProjectExtension } from "../../packages/desktop/src/config.ts";

/**
 * D115 §一.6 — how a Desktop test gets at a `velar/*` module the way a built
 * application would: write the source the Desktop compiler extension
 * generates, and import it beside a bridge planted on `globalThis`.
 *
 * The three declarations below stood in `tests/desktop/desktop-runtime.test.ts`
 * until D115 §三 split it by subject; the files it became share them, so §一.6
 * puts the one copy here.
 */

/** Where a Desktop renderer looks for its host bridge. */
export const bridgeKey = Symbol.for("velar.desktop.bridge.v1");

export async function runtime<T>(directory: string, file: string, moduleName: string, transform: (source: string) => string = (source) => source): Promise<T> {
  const source = velarCompilerExtension.modules?.sources.get(moduleName);
  assert.ok(source, `${moduleName} must have a Desktop runtime source`);
  const path = join(directory, `${file}.mjs`);
  await writeFile(path, transform(source), "utf8");
  return import(`${pathToFileURL(path).href}?test=${Date.now()}`) as Promise<T>;
}

/**
 * A module the extension closes over a project's own manifest. `runtime` above
 * reads the ungranted fallback; this reads what a real project would compile,
 * so the two halves of every permission — refused and granted — are exercised
 * against the same generated source a build produces.
 */
export async function configuredRuntime<T>(
  directory: string,
  file: string,
  moduleName: string,
  permissions: Record<string, unknown>,
): Promise<T> {
  const config = velarProjectExtension.parse({
    productName: "Test",
    identifier: "dev.velarscript.test",
    windows: { main: {} },
    permissions,
  }, "velar.json");
  const source = velarCompilerExtension.modules?.source?.(moduleName, config);
  assert.ok(source, `${moduleName} must be generated from the project's declared permissions`);
  const path = join(directory, `${file}.mjs`);
  await writeFile(path, source, "utf8");
  return await import(`${pathToFileURL(path).href}?test=${Date.now()}-${Math.random()}`) as T;
}
