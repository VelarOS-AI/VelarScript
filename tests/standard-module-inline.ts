import { standardModuleSource } from "../packages/cli/src/standard-modules.ts";

/**
 * One standard module's source with its `velar/*` imports resolved to data
 * URLs, so a test may evaluate the module on its own without a package on disk.
 *
 * D114 AS-I2: `velar/async` and `velar/task` import the compiler's shared error
 * module for the one `TimeoutError` class both raise — `is TimeoutError` lowers
 * to an `instanceof` against that class, so a second definition would answer
 * false. One level of resolution is enough: the modules a Core standard module
 * imports declare no imports of their own.
 */
export function standardModuleWithDependencies(body: string): string {
  return body.replaceAll(/from\s*"(velar\/[^"]+)"/gu, (whole: string, specifier: string) => {
    const dependency = standardModuleSource(specifier, { base: "/" });
    if (dependency === null || dependency === undefined) return whole;
    return `from ${JSON.stringify(`data:text/javascript;base64,${Buffer.from(dependency, "utf8").toString("base64")}`)}`;
  });
}
