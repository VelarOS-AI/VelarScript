/**
 * The TypeScript declaration bridge: what an installed package's `.d.ts`
 * promises, read into VelarScript types. The readers live in `typescript/` —
 * `entry.ts` finds the declaration file, `graph.ts` walks the package-local
 * graph, and `declarations.ts` reads one file with the help of the rest.
 */
export type { TypeScriptDeclarationBridge } from "./typescript/bridge.ts";
export { parseTypeScriptDeclarations } from "./typescript/declarations.ts";
export { loadTypeScriptDeclarations } from "./typescript/entry.ts";
