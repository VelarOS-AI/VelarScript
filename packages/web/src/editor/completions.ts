/**
 * What both completion families and the Look property documentation read.
 *
 * D115 P4 R3d: `unique` is the rule that one label is offered once however many
 * rosters name it, and `lookPropertyFamilies` is the family each Look property
 * belongs to. Both are read on either side of the Look / JSX split, so they are
 * their own module rather than a dependency between the two.
 */
import type { CompilerProjectEditorCompletion } from "@velarscript/compiler/extension";
import { LOOK_PROPERTY_GROUPS } from "../look.ts";

export const lookPropertyFamilies = new Map(LOOK_PROPERTY_GROUPS.flatMap((group) =>
  group.properties.map((property) => [property, group.family] as const)));

export function unique(items: readonly CompilerProjectEditorCompletion[]): readonly CompilerProjectEditorCompletion[] {
  return items.filter((item, index) => items.findIndex((candidate) => candidate.label === item.label) === index);
}
