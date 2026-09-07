// Strongly connected components over a module graph. Its own module so the
// compilation phase (incremental.ts) and the initialization-cycle diagnostics
// (diagnostics.ts) both read it without reading each other: collaborator
// modules under project/ import in one direction only.
/** Iterative Tarjan: the public 4096-module bound must not depend on host stack depth. */
export function stronglyConnectedPaths(
  paths: Iterable<string>,
  dependencies: (path: string) => readonly string[],
): readonly (readonly string[])[] {
  interface Frame {
    readonly path: string;
    readonly parent: string | null;
    readonly dependencies: readonly string[];
    next: number;
  }
  let nextIndex = 0;
  const indexes = new Map<string, number>();
  const lowLinks = new Map<string, number>();
  const componentStack: string[] = [];
  const active = new Set<string>();
  const groups: string[][] = [];
  const frames: Frame[] = [];
  const begin = (path: string, parent: string | null): void => {
    const index = nextIndex++;
    indexes.set(path, index);
    lowLinks.set(path, index);
    componentStack.push(path);
    active.add(path);
    frames.push({ path, parent, dependencies: dependencies(path), next: 0 });
  };

  for (const root of paths) {
    if (indexes.has(root)) continue;
    begin(root, null);
    while (frames.length > 0) {
      const frame = frames.at(-1)!;
      const dependency = frame.dependencies[frame.next];
      if (dependency !== undefined) {
        frame.next += 1;
        if (!indexes.has(dependency)) {
          begin(dependency, frame.path);
        } else if (active.has(dependency)) {
          lowLinks.set(frame.path, Math.min(lowLinks.get(frame.path)!, indexes.get(dependency)!));
        }
        continue;
      }

      frames.pop();
      if (frame.parent !== null) {
        lowLinks.set(frame.parent, Math.min(lowLinks.get(frame.parent)!, lowLinks.get(frame.path)!));
      }
      if (lowLinks.get(frame.path) !== indexes.get(frame.path)) continue;
      const group: string[] = [];
      while (componentStack.length > 0) {
        const member = componentStack.pop()!;
        active.delete(member);
        group.push(member);
        if (member === frame.path) break;
      }
      groups.push(group);
    }
  }
  return groups;
}
