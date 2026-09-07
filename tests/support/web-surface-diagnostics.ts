import assert from "node:assert/strict";
import { compile as compileCore } from "@velarscript/compiler";
import { velarCompilerExtension, webModuleInterfaces } from "../../packages/web/src/compiler.ts";

/**
 * D115 P5 — the one copy of the four probes the Web surface files read a
 * diagnostic with, from `tests/web/surface.test.ts` before it was split at
 * 1,464 lines.
 *
 * `compile` answers the `velar/look` imports the source writes, because these
 * probes compile a source and not a project: there is no project to resolve the
 * specifier through, so the import list in the text is read here and the
 * builders it names are seeded with the types the published module gives them.
 * A source that imports nothing is unaffected. The three questions the six
 * files ask of the result are every message, the one message, and none.
 */
export function compile(text: string) {
  const imports = new Map<string, unknown>();
  const lookExports = webModuleInterfaces.get("velar/look")?.exports;
  for (const match of text.matchAll(/import\s*\{([^}]*)\}\s*from\s*"velar\/look"/gu)) {
    for (const raw of match[1]!.split(",")) {
      const [imported, local = imported] = raw.trim().split(/\s+as\s+/u);
      const type = imported ? lookExports?.get(imported) : undefined;
      if (type) imports.set(local!, type);
    }
  }
  return compileCore(text.trimStart(), {
    analysis: { imports: imports as never },
    extensions: [velarCompilerExtension],
  });
}

/** Every diagnostic as `code message`, in the order the compiler reported them. */
export function messages(source: string): readonly string[] {
  return compile(source).diagnostics.map((item) => `${item.code} ${item.message}`);
}

/** The one diagnostic a source is expected to report; the failure prints what it did report. */
export function only(source: string): string {
  const reported = messages(source);
  assert.equal(reported.length, 1, JSON.stringify(reported));
  return reported[0]!;
}

/** A source that must compile with nothing reported, and the result it compiled to. */
export function clean(source: string): ReturnType<typeof compile> {
  const result = compile(source);
  assert.deepEqual(result.diagnostics, []);
  return result;
}
