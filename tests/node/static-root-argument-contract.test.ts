import assert from "node:assert/strict";
import test from "node:test";
import { compile } from "@velarscript/compiler";
import { velarNodeCompilerExtension } from "../../packages/node/src/compiler.ts";
import { standardModuleInterface } from "../../packages/cli/src/standard-modules.ts";

const extensions = [velarNodeCompilerExtension];
const exported = standardModuleInterface("velar/serve", extensions)!.exports;

function checked(source: string, local = "staticFiles", imported = "staticFiles") {
  return compile(source, { extensions, analysis: { imports: new Map([[local, exported.get(imported)!]]) } });
}

test("static root contracts read immutable bindings and renamed source imports", () => {
  for (const value of ['"../outside"', '".." + "/outside"', '"public/../../outside"']) {
    const result = checked(`import {staticFiles as assets} from "velar/serve"\nconst root = ${value}\nconst saved = root\nconst app = assets("/", root=saved)\n`, "assets");
    assert.equal(result.diagnostics.length, 1, JSON.stringify(result.diagnostics));
    assert.match(result.diagnostics[0]!.message, /leaves the project directory/u);
  }
});

test("file, fileResponse and staticFiles all consume the same scalar proof", () => {
  for (const [name, call] of [
    ["file", 'file("x", root=root)'],
    ["fileResponse", 'fileResponse(path="x", root=root)'],
    ["staticFiles", 'staticFiles("/", root=root)'],
  ]) {
    const result = checked(`import {${name}} from "velar/serve"\nconst root = ".."\nconst output = ${call}\n`, name, name);
    assert.equal(result.diagnostics.length, 1, JSON.stringify(result.diagnostics));
    assert.match(result.diagnostics[0]!.message, /leaves the project directory/u);
  }
});

test("static roots accept normalized in-project paths, absolute paths and dynamic values", () => {
  for (const value of ['"public/../public"', '"/tmp/../shared"', '"C:/tmp/../shared"']) {
    assert.deepEqual(checked(`import {staticFiles} from "velar/serve"\nconst root=${value}\nconst app=staticFiles("/", root)\n`).diagnostics, []);
  }
  assert.deepEqual(checked('import {staticFiles} from "velar/serve"\ndef app(root: string): return staticFiles("/", root)\n').diagnostics, []);
  assert.deepEqual(checked('def staticFiles(path: string, root: string, fallback: string?=null): return root\nprint(staticFiles("/", "../outside"))\n').diagnostics, []);
  assert.deepEqual(checked('import {staticFiles} from "velar/serve"\nlet root="../outside"\nroot="public"\nconst app=staticFiles("/", root)\n').diagnostics, []);
});

test("static root contracts follow immutable callable aliases", () => {
  const result = checked('import {staticFiles} from "velar/serve"\nconst assets=staticFiles\nconst alias=assets\nconst app=alias("/", root="..")\n');
  assert.equal(result.diagnostics.length, 1, JSON.stringify(result.diagnostics));
  assert.match(result.diagnostics[0]!.message, /leaves the project directory/u);
});
