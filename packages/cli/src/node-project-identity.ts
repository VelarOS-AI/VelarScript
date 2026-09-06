import { join } from "node:path";
import { nodeProjectIdentity } from "@velarscript/node/compiler";
import { readProjectManifestSource } from "./project-manifest-source.ts";

/**
 * D114 F9-node-cli, audit NO-D1: who the project a Node build compiled is, in
 * the form the emitted `velar/serve` bakes and later re-derives from whatever
 * `velar.json` it finds at its own offset.
 *
 * The derivation itself lives once, in `@velarscript/node`'s
 * `nodeProjectIdentity`, and the emitted module carries that function's
 * compiled source. What is here is only the manifest reading: the build reads
 * the project's own `velar.json`, the runtime reads the one standing where the
 * offset points, and the two identities are compared. A manifest that cannot be
 * read or is not a JSON object yields `""` — "this build knew no identity" —
 * which leaves the offset judged by whether the directory is there, the answer
 * a project with no manifest at all has to be given.
 */
export function nodeProjectIdentityOfManifest(manifestSource: string | null): string {
  if (manifestSource === null) return "";
  let declared: unknown;
  try { declared = JSON.parse(manifestSource); }
  catch { return ""; }
  if (!declared || typeof declared !== "object" || Array.isArray(declared)) return "";
  const manifest = declared as { readonly name?: unknown; readonly entry?: unknown };
  return nodeProjectIdentity(manifest.name, manifest.entry);
}

/** The same identity for a build that has the project root rather than its manifest text. */
export async function nodeProjectIdentityAt(projectRoot: string): Promise<string> {
  const source = await readProjectManifestSource(join(projectRoot, "velar.json")).catch(() => null);
  return nodeProjectIdentityOfManifest(source);
}
