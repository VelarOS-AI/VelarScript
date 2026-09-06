import { standardModuleSource } from "../../packages/cli/src/standard-modules.ts";

/**
 * One standard module's source with its `velar/*` imports resolved to data
 * URLs, so a test may evaluate the module on its own without a package on disk.
 *
 * D114 AS-I2: `velar/async` and `velar/task` import the compiler's shared error
 * module for the one `TimeoutError` class both raise — `is TimeoutError` lowers
 * to an `instanceof` against that class, so a second definition would answer
 * false.
 *
 * D114 CO-U4b: the resolution is recursive. It used to stop after one level,
 * on the reasoning that the modules a Core standard module imports declare no
 * imports of their own — which stopped being true the moment the primitive
 * receiver methods began importing `__VelarIndexError` from the
 * collection-lowering module, which imports the collection host and the
 * reactive bridge in turn. The graph is acyclic, so the walk terminates.
 */
export function standardModuleWithDependencies(body: string): string {
  return body.replaceAll(/from\s*"(velar\/[^"]+)"/gu, (whole: string, specifier: string) => {
    const dependency = standardModuleSource(specifier, { base: "/" });
    if (dependency === null || dependency === undefined) return whole;
    const resolved = standardModuleWithDependencies(dependency);
    return `from ${JSON.stringify(`data:text/javascript;base64,${Buffer.from(resolved, "utf8").toString("base64")}`)}`;
  });
}
