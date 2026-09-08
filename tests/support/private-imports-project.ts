import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { makeTemporaryDirectory } from "./temporary-directory.ts";
import { linkVelarExtension } from "./web-project.ts";

/** The same private spellings belong to three distinct npm resolution scopes. */
export async function privateImportsBrowserProject(nativeTarget = "./native/adapter.mjs"): Promise<string> {
  const root = await makeTemporaryDirectory("velar-browser-private-imports-");
  await linkVelarExtension(root, "web");
  await nativeOwner(root, "project", nativeTarget);
  for (const name of ["first", "second"]) {
    const owner = join(root, "node_modules", name);
    await nativeOwner(owner, name);
    await writeTree(owner, {
      "package.json": JSON.stringify({
        name, version: "1.0.0", type: "module", imports: nativeImports(),
        velar: {entry: "src/index.vel", targets: ["core"], requires: {capabilities: []}},
      }),
      "src/index.vel": nativeBridge("sourceLabel"),
    });
  }
  await writeTree(root, {
    "velar.json": JSON.stringify({
      formatVersion: 2, entry: "src/main.vel", outDir: "dist", extensions: ["@velarscript/web"],
      web: {title: "Private imports"},
    }),
    "src/bridge.vel": nativeBridge("rootLabel") + [
      'import {sourceLabel as first} from "first"',
      'import {sourceLabel as second} from "second"',
      'export const label = rootLabel + "/" + first + "/" + second', "",
    ].join("\n"),
    "src/app.vel": 'import {label} from "./bridge.vel"\nexport component App():\n    return <p id="label">{label}</p>\n',
    "src/main.vel": 'import {App} from "./app.vel"\n@main: mount(<App />, "#app")\n',
    "src/app.browser.test.vel": [
      'import {expect} from "velar/test"', 'import {browser} from "velar/web-test"',
      'import {label} from "./bridge.vel"', '',
      'test "private imports keep their root and dependency owners":',
      '    expect(label).toBe("project/native/first/native/second/native")',
      '    await browser.open("/")',
      '    expect(await browser.text("#label")).toBe(label)', '',
    ].join("\n"),
  });
  return root;
}

/** Native npm dependencies stay in their installed project scope, without copying them. */
export async function npmImportsBrowserProject(kind: "bare" | "alias"): Promise<string> {
  const root = await privateImportsBrowserProject();
  const specifier = kind === "bare" ? "native-probe" : "#native";
  await writeTree(root, {
    "package.json": JSON.stringify({
      name: "project", private: true, type: "module",
      imports: {...nativeImports(), "#native": "native-probe"},
    }),
    "node_modules/native-probe/package.json": JSON.stringify({
      name: "native-probe", version: "1.0.0", type: "module", exports: "./index.mjs",
    }),
    "node_modules/native-probe/index.mjs": 'export const nativeLabel="project/native";\n',
    "src/bridge.vel": nativeBridge("rootLabel", specifier) + [
      'import {sourceLabel as first} from "first"',
      'import {sourceLabel as second} from "second"',
      'export const label = rootLabel + "/" + first + "/" + second', "",
    ].join("\n"),
  });
  return root;
}

function nativeImports(target = "./native/adapter.mjs") {
  return {"#native": target, "#suffix": "./native/suffix.mjs"};
}

function nativeBridge(exported: string, specifier = "#native"): string {
  return [
    `extern module ${JSON.stringify(specifier)}:`, '    export const nativeLabel: string',
    `import js {nativeLabel} from ${JSON.stringify(specifier)}`, `export const ${exported} = nativeLabel`, '',
  ].join("\n");
}

async function nativeOwner(root: string, name: string, target = "./native/adapter.mjs"): Promise<void> {
  await writeTree(root, {
    "package.json": JSON.stringify({name, private: true, type: "module", imports: nativeImports(target)}),
    [target.slice(2)]: `import {label} from ${JSON.stringify(target.includes("/src/") ? "../native/detail.mjs" : "./detail.mjs")};\nimport {suffix} from "#suffix";\nexport const nativeLabel=label+"/"+suffix;\n`,
    "native/detail.mjs": `export const label=${JSON.stringify(name)};\n`,
    "native/suffix.mjs": 'export const suffix="native";\n',
  });
}

async function writeTree(root: string, files: Readonly<Record<string, string>>): Promise<void> {
  for (const [name, source] of Object.entries(files)) {
    const path = join(root, name);
    await mkdir(dirname(path), {recursive: true});
    await writeFile(path, source, "utf8");
  }
}
