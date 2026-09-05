import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { applyMechanicalFixes, compile as compileCore } from "@velarscript/compiler";
import { velarCompilerExtension, webModuleInterfaces } from "../packages/web/src/compiler.ts";
import { webModuleSources } from "../packages/web/src/runtime.ts";

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
