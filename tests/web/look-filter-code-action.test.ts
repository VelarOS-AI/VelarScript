import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { applyMechanicalFixes, compile as compileCore } from "@velarscript/compiler";
import { resolveVelarProject } from "../../packages/cli/src/config.ts";
import { applyProjectMechanicalFixes } from "../../packages/cli/src/mechanical-fixer.ts";
import { velarCompilerExtension, webModuleInterfaces } from "../../packages/web/src/compiler.ts";
import { webModuleSources } from "../../packages/web/src/runtime.ts";
import { linkVelarExtension } from "../support/web-project.ts";

function compileWeb(text: string) {
  const imports = new Map<string, unknown>();
  const lookExports = webModuleInterfaces.get("velar/look")?.exports;
  for (const match of text.matchAll(/import\s*\{([^}]*)\}\s*from\s*"velar\/look"/gu)) {
    for (const raw of match[1]!.split(",")) {
      const [imported, local = imported] = raw.trim().split(/\s+as\s+/u);
      if (!imported) continue;
      const type = lookExports?.get(imported);
      if (type) imports.set(local!, type);
    }
  }
  return compileCore(text, {
    analysis: { imports: imports as never },
    extensions: [velarCompilerExtension],
  });
}

function look(value: string): string {
  return `export const panel = look:\n    backdropFilter = ${value}\n`;
}

test("A16 rewrites a complete CSS filter string to checked builders and carries imports", () => {
  const source = look('"blur(26px) brightness(1.09)"');
  const result = compileWeb(source);
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(result.advisories.map((item) => item.code), ["A16"]);
  assert.deepEqual(result.advisories[0]?.fix?.edits.map((edit) => edit.text), [
    'import {blur, brightness, filters} from "velar/look"\n\n',
    "filters(blur(26px), brightness(1.09))",
  ]);

  const fixed = applyMechanicalFixes(source, result.advisories).text;
  assert.equal(fixed, [
    'import {blur, brightness, filters} from "velar/look"',
    "",
    "export const panel = look:",
    "    backdropFilter = filters(blur(26px), brightness(1.09))",
    "",
  ].join("\n"));
  const checked = compileWeb(fixed);
  assert.deepEqual(checked.diagnostics, []);
  assert.deepEqual(checked.advisories, []);
});

test("A16 honors aliases and rewrites an inline Look directive as an expression", () => {
  const source = [
    'import {blur as soften} from "velar/look"',
    "",
    "component Panel:",
    '    return <div look:backdropFilter="blur(26px)"></div>',
    "",
  ].join("\n");
  const result = compileWeb(source);
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(result.advisories.map((item) => item.code), ["A16"]);
  assert.deepEqual(result.advisories[0]?.fix?.edits.map((edit) => edit.text), [
    "look:backdropFilter={soften(26px)}",
  ]);
});

test("A16 closes the common scalar and drop-shadow family but leaves unproved CSS alone", () => {
  const source = [
    "export const effects = look:",
    '    filter = "drop-shadow(0 3px 10px rgba(0, 0, 0, 0.3))"',
    '    backdropFilter = "url(\'#glass\')"',
    "",
  ].join("\n");
  const result = compileWeb(source);
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(result.advisories.map((item) => item.code), ["A16"]);
  assert.deepEqual(result.advisories[0]?.fix?.edits.map((edit) => edit.text), [
    'import {dropShadow, rgba} from "velar/look"\n\n',
    "dropShadow(0px, 3px, 10px, rgba(0, 0, 0, 0.3))",
  ]);
});

test("typed filter builders preserve CSS values and reject invalid numeric domains", () => {
  const source = webModuleSources.get("velar/look");
  assert.ok(source);
  const url = `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;
  const probe = [
    `import {blur, brightness, dropShadow, filterOpacity, filters, rgba} from ${JSON.stringify(url)};`,
    "console.log(filters(blur('26px'), brightness(1.09), filterOpacity(0.5)));",
    "console.log(dropShadow('0px', '3px', '10px', rgba(0, 0, 0, 0.3)));",
    "try { filterOpacity(2); console.log('accepted'); } catch { console.log('refused'); }",
  ].join("\n");
  const run = spawnSync(process.execPath, ["--input-type=module"], { encoding: "utf8", input: probe });
  assert.equal(run.status, 0, run.stderr);
  assert.deepEqual(run.stdout.trim().split("\n"), [
    "blur(26px) brightness(1.09) opacity(0.5)",
    "drop-shadow(0px 3px 10px rgb(0 0 0 / 0.3))",
    "refused",
  ]);
});

// ---------------------------------------------------------------------------
// D114 F10-web (0.32.0 ledger WB-I2): `velar fix` applies this rewrite, and
// says what is left when it does not.
//
// `docs/web-api.md` called this "an editor fix", and that one word drew a line
// nothing else in the language draws. `hsl`'s percentage and the `token(...)`
// migration are two remedies in this same vocabulary and `velar fix` makes
// both; the third was reachable only by opening the file, and no sentence
// anywhere said where the line was. It is a spelling change like the other two
// — the same filter list, written in the checked builders — so it is applied
// here, and the summary counts the advisories the tree still carries so a run
// that ends on "0 diagnostics" cannot imply a clean `velar check`.
// ---------------------------------------------------------------------------

async function webProject(main: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "velar-wb-i2-"));
  await linkVelarExtension(root, "web");
  await writeFile(join(root, "velar.json"), `${JSON.stringify({
    formatVersion: 2,
    entry: "main.vel",
    outDir: "dist",
    extensions: ["@velarscript/web"],
    web: { title: "WB-I2", base: "/" },
  })}\n`, "utf8");
  await writeFile(join(root, "main.vel"), main, "utf8");
  return root;
}

test("[WB-I2] velar fix applies the A16 rewrite, imports and all, and is a fixed point", async () => {
  const before = [
    'import {color, hsl} from "velar/look"',
    "",
    "const accent = hsl(200, 50, 50)",
    "",
    "export const card = look:",
    '    filter = "blur(26px) brightness(1.09)"',
    '    color = color("var(--brand)")',
    "    background = accent",
    "",
    '@main: mount(<div look={card} />, "#app")',
    "",
  ].join("\n");
  const after = [
    'import {blur, brightness, filters, hsl, token} from "velar/look"',
    "",
    "const accent = hsl(200, 50%, 50%)",
    "",
    "export const card = look:",
    "    filter = filters(blur(26px), brightness(1.09))",
    '    color = token("--brand")',
    "    background = accent",
    "",
    '@main: mount(<div look={card} />, "#app")',
    "",
  ].join("\n");
  const root = await webProject(before);
  try {
    const report = await applyProjectMechanicalFixes(await resolveVelarProject(root), null, (path) => path);
    assert.deepEqual(report.remainingDiagnostics, []);
    assert.deepEqual(report.writeFailures, []);
    // The advisory the run applied is gone from the tree it leaves behind, and
    // the `color` the `token` rewrite orphaned left the import list with it.
    assert.equal(report.remainingAdvisories, 0);
    assert.equal(await readFile(join(root, "main.vel"), "utf8"), after);
    assert.ok(report.changes.some((line) => line.includes("fixed A16: Use filters(blur(26px), brightness(1.09))")), report.changes.join("\n"));

    const second = await applyProjectMechanicalFixes(await resolveVelarProject(root), null, (path) => path);
    assert.deepEqual(second.changes, []);
    assert.equal(await readFile(join(root, "main.vel"), "utf8"), after);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("[WB-I2] an advisory velar fix does not apply is counted in what the run reports", async () => {
  // A12 is the other Look advisory and it is not on the applied roster: the
  // free-text `var()` reference is a spelling the author may keep. What the run
  // owes the author is to say that something is still there, which is the half
  // of this finding the summary line carries.
  const root = await webProject([
    'import {color, hsl} from "velar/look"',
    "",
    "const accent = hsl(200, 50, 50)",
    "",
    "export const card = look:",
    '    fontFamily = "var(--body-font)"',
    '    color = color("var(--brand)")',
    "    background = accent",
    "",
    '@main: mount(<div look={card} />, "#app")',
    "",
  ].join("\n"));
  try {
    const report = await applyProjectMechanicalFixes(await resolveVelarProject(root), null, (path) => path);
    assert.deepEqual(report.remainingDiagnostics, []);
    assert.equal(report.remainingAdvisories, 1);
    assert.match(await readFile(join(root, "main.vel"), "utf8"), /^import \{hsl, token\} from "velar\/look"$/mu);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
