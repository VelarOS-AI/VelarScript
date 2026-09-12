export function withDocumentationFiles<T>(root: string, preamble: string, reserved: readonly string[], run: (directory: string) => Promise<T>): Promise<T>;
