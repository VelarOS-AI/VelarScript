/**
 * `velar skill`: a verbatim owner brief or one packaged Core reference topic.
 *
 * The briefs are `packages/cli/skill/`, two levels above this module in both the
 * source tree and the published `dist`, which is why the URL climbs twice.
 */

import { readFile } from "node:fs/promises";
import { CORE_SKILL_TOPICS, SKILL_OWNER_FILES, coreSkillTopicsText } from "../skill-reference.ts";

export async function runSkillCommand(rest: readonly string[]): Promise<number> {
  const kind = rest[0] ?? "core";
  const topic = rest[1];
  if (!Object.hasOwn(SKILL_OWNER_FILES, kind) || rest.length > 2 || (kind !== "core" && topic !== undefined)) {
    process.stderr.write("velar skill: expected core, web, node, server, or desktop; use 'velar skill core topics' for the Core reference\n");
    return 2;
  }
  if (topic === "topics") {
    process.stdout.write(coreSkillTopicsText());
    return 0;
  }
  if (topic !== undefined && !Object.hasOwn(CORE_SKILL_TOPICS, topic)) {
    process.stderr.write(`velar skill: unknown Core topic '${topic}'; use 'velar skill core topics'\n`);
    return 2;
  }
  const file = topic === undefined ? SKILL_OWNER_FILES[kind] : `reference/${topic}.md`;
  process.stdout.write(await readFile(new URL(`../../skill/${file}`, import.meta.url), "utf8"));
  return 0;
}
