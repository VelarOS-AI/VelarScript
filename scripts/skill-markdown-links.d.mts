export interface MarkdownLink {
  readonly target: string;
  readonly start: number;
  readonly end: number;
}
export function markdownLinks(markdown: string): readonly MarkdownLink[];
export function markdownAnchors(markdown: string): ReadonlySet<string>;
export function isLocalMarkdownLink(target: string): boolean;
export function checkSkillMarkdownLinks(files: ReadonlyMap<string, string>): string[];
