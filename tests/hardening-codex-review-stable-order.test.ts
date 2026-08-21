import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile, readdir } from "node:fs/promises";
import { extname, join, relative } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { byCodeUnit as byCliCodeUnit } from "../packages/cli/src/stable-order.ts";
import { byCodeUnit as byCompilerCodeUnit } from "../packages/compiler/src/stable-order.ts";
import { byCodeUnit as byDesktopCodeUnit } from "../packages/desktop/src/stable-order.ts";
import { byCodeUnit as byWebCodeUnit } from "../packages/web/src/stable-order.ts";
import { validateLoadedExtension, type ResolvedExtensionPackage } from "../packages/cli/src/extension-metadata.ts";
import { lookStaticIdentity } from "../packages/web/src/look-static.ts";
import { VELAR_EXTENSION_PROTOCOL_VERSION } from "@velarscript/compiler/extension";

const repositoryRoot = fileURLToPath(new URL("..", import.meta.url));
const selfPath = fileURLToPath(import.meta.url);

// A name a collation reorders: Swedish sorts 'ä' after 'z', American before it.
const COLLATED = ["z.txt", "ä.txt", "Z.txt", "a.txt", "b-1.vel", "b_1.vel"];
// Two distinct names the default collation calls equal — a soft hyphen is
// ignorable — which is what let a sort tie leave two equal records in
// different orders.
const TIED = ["ab", "a­b"];

test("every package orders by code unit, and all four comparators agree", () => {
  const expected = [...COLLATED].sort();
  for (const comparator of [byCliCodeUnit, byCompilerCodeUnit, byDesktopCodeUnit, byWebCodeUnit]) {
    assert.deepEqual([...COLLATED].sort(comparator), expected);
    assert.deepEqual([...TIED].sort(comparator), [...TIED].sort());
  }
  // A total order: no two distinct names tie, which a collation does.
  assert.equal(byCliCodeUnit(TIED[0]!, TIED[1]!) === 0, false);
  assert.equal(TIED[0]!.localeCompare(TIED[1]!), 0);
});

test("no ordering that decides output, a hash, or an identity follows the machine's collation", async () => {
  // cr-5 / D90 R3(a): the desktop build receipt hashed its tree with
  // `localeCompare`, so the same tree hashed differently under a different
  // `LC_ALL`. Closing the sink means the call cannot come back anywhere a
  // produced byte, hash, identity string, or reported order depends on it.
  const roots = [
    join(repositoryRoot, "packages", "cli", "src"),
    join(repositoryRoot, "packages", "compiler", "src"),
    join(repositoryRoot, "packages", "desktop", "src"),
    join(repositoryRoot, "packages", "node", "src"),
    join(repositoryRoot, "packages", "web", "src"),
    join(repositoryRoot, "scripts"),
    join(repositoryRoot, "tests"),
  ];
  const offenders: string[] = [];
  const visit = async (directory: string): Promise<void> => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        await visit(path);
        continue;
      }
      // This file names the call it forbids, in the demonstration above and in
      // the detector below.
      if (!entry.isFile() || path === selfPath || ![".ts", ".mjs", ".js"].includes(extname(entry.name))) continue;
      const source = await readFile(path, "utf8");
      source.split("\n").forEach((line, index) => {
        // Prose about the removed dependence is the record of why it is gone.
        const code = line.replace(/^\s*(?:\/\/|\*|\/\*).*$/u, "");
        if (code.includes("localeCompare")) offenders.push(`${relative(repositoryRoot, path)}:${index + 1}`);
      });
    }
  };
  for (const root of roots) await visit(root);
  assert.deepEqual(offenders, []);
});

test("a Look static identity is the same string on two machines that differ only in LC_ALL", () => {
  const value = {
    kind: "object",
    properties: {
      "z": { kind: "number", value: 1 },
      "ä": { kind: "number", value: 2 },
      "a": { kind: "number", value: 3 },
    },
  };
  const script = `
import { lookStaticIdentity } from ${JSON.stringify(join(repositoryRoot, "packages", "web", "src", "look-static.ts"))};
process.stdout.write(lookStaticIdentity(${JSON.stringify(value)}));
`;
  const under = (locale: string) => execFileSync(process.execPath, ["--input-type=module", "--eval", script], {
    encoding: "utf8",
    env: { ...process.env, LC_ALL: locale, LANG: locale },
  });
  assert.equal(under("en_US.UTF-8"), under("sv_SE.UTF-8"));
  assert.equal(under("en_US.UTF-8"), lookStaticIdentity(value));
});

test("an extension contract compares equal to itself whatever order its records were written in", () => {
  // `sameStringRecord` sorted both sides and compared the result. A collation
  // that ties two distinct keys left each side in its own insertion order, so a
  // package matched its own contract only by the order someone typed it in.
  const extends_ = { [TIED[0]!]: "1", [TIED[1]!]: "2" };
  const reversed = { [TIED[1]!]: "2", [TIED[0]!]: "1" };
  const package_: ResolvedExtensionPackage = {
    name: "@example/extension",
    version: "0.12.1",
    manifestPath: "/project/node_modules/@example/extension/package.json",
    kind: "capability",
    apiVersion: "0.10",
    manifestKey: "example",
    extends: extends_,
    composes: {},
    direct: true,
    resolution: "project",
  };
  const extension = {
    id: "@example/extension",
    contract: {
      protocolVersion: VELAR_EXTENSION_PROTOCOL_VERSION,
      apiVersion: "0.10",
      kind: "capability" as const,
      extends: reversed,
      composes: {},
    },
  };
  assert.equal(validateLoadedExtension(package_, extension).id, "@example/extension");
  assert.throws(
    () => validateLoadedExtension(package_, { ...extension, contract: { ...extension.contract, extends: { [TIED[0]!]: "9" } } }),
    /contract does not match its package metadata/u,
  );
});
