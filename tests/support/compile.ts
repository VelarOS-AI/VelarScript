import { compile as compileCore } from "@velarscript/compiler";
import { velarCompilerExtension } from "../../packages/web/src/compiler.ts";

/**
 * D115 §一.6 — the one copy of "compile this source with the Web extension
 * loaded".
 *
 * Sixteen files declared the same three-line `compile`, split only by whether
 * they trimmed the leading newline a template literal carries. That choice is
 * the argument now, so the extension list itself is written once: a test that
 * needs the Web target loads it the same way every other one does.
 */
export const webExtensions = Object.freeze([velarCompilerExtension]);

/**
 * Compile `source` with the Web extension. `trimStart` drops the newline a
 * `` ` `` literal opens with, which is what the files that pass it are after —
 * it is deliberately not the default, because a leading blank line is
 * meaningful to the layout rules some tests are about.
 */
export function compileWeb(source: string, options: { readonly trimStart?: boolean } = {}): ReturnType<typeof compileCore> {
  return compileCore(options.trimStart === true ? source.trimStart() : source, { extensions: webExtensions });
}
