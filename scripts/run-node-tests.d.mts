export type NodeTestMode = "quick" | "full";

export function nodeTestFiles(directory: string, mode: NodeTestMode): Promise<string[]>;
