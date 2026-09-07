/** `velar lsp`: the stdio language server an editor host speaks to. */

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { buildLanguageServerTool } from "../language-server-tool.ts";

export async function runLspCommand(rest: readonly string[]): Promise<number> {
  if (rest.length > 0) {
    process.stderr.write("velar lsp: this command does not accept arguments\n");
    return 2;
  }
  const temporary = await mkdtemp(join(tmpdir(), "velar-language-server-"));
  const tool = join(temporary, "language-server.mjs");
  try {
    await buildLanguageServerTool(tool);
    await import(pathToFileURL(tool).href);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
  return 0;
}
