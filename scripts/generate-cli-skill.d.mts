export function selectSkillSections(markdown: string, requested: readonly string[], file: string): string;
export function generateCliSkillFiles(root?: string): Promise<Map<string, string>>;
export function synchronizeCliSkill(root?: string, options?: {
  readonly check?: boolean;
  readonly ci?: boolean;
}): Promise<{
  readonly files: number;
  readonly updated: readonly string[];
  readonly removed: readonly string[];
}>;
