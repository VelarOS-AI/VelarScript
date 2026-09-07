import { createHash } from "node:crypto";
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
 *
 * D114 F10-node, audit NO-D1: a manifest that declares no `name` is identified
 * by the SHA-256 of its own text. Both sides hash the same thing — the decoded
 * UTF-8 text of the file, which is what `velar/fs`'s `readText` gives the
 * runtime and what `readProjectManifestSource` gives a build — so the digest is
 * the file's bytes wherever the file is legal UTF-8, and a file that is not is
 * one neither side can read as a manifest at all.
 */
export function projectManifestDigest(manifestSource: string): string {
  return createHash("sha256").update(manifestSource, "utf8").digest("hex");
}

export function nodeProjectIdentityOfManifest(manifestSource: string | null): string {
  if (manifestSource === null) return "";
  let declared: unknown;
  try { declared = JSON.parse(manifestSource); }
  catch { return ""; }
  if (!declared || typeof declared !== "object" || Array.isArray(declared)) return "";
  const manifest = declared as { readonly name?: unknown };
  return nodeProjectIdentity(manifest.name, projectManifestDigest(manifestSource));
}

/** The same identity for a build that has the project root rather than its manifest text. */
export async function nodeProjectIdentityAt(projectRoot: string): Promise<string> {
  const source = await readProjectManifestSource(join(projectRoot, "velar.json")).catch(() => null);
  return nodeProjectIdentityOfManifest(source);
}
