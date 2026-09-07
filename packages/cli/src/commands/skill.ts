/**
 * `velar skill`: one packaged owner-specific AI skill brief, printed verbatim.
 *
 * The briefs are `packages/cli/skill/`, two levels above this module in both the
 * source tree and the published `dist`, which is why the URL climbs twice.
 */

import { readFile } from "node:fs/promises";

export async function runSkillCommand(rest: readonly string[]): Promise<number> {
  const kind = rest[0] ?? "core";
  const files: Readonly<Record<string, string>> = Object.freeze({
    core: "ai-skill.md",
    web: "ai-skill-web.md",
    node: "ai-skill-node.md",
    server: "ai-skill-server.md",
    desktop: "ai-skill-desktop.md",
  });
  if (rest.length > 1 || files[kind] === undefined) {
    process.stderr.write("velar skill: expected core, web, node, server, or desktop\n");
    return 2;
  }
  process.stdout.write(await readFile(new URL(`../../skill/${files[kind]}`, import.meta.url), "utf8"));
  return 0;
}
