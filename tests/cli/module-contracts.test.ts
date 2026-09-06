import assert from "node:assert/strict";
import test, { after } from "node:test";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { inspectModule as inspectCoreModule, type CompilerExtension } from "@velarscript/compiler";
import { VELAR_PROMISE_NORMALIZATION_MODULE } from "@velarscript/compiler/extension";
import { type ValueType } from "../../packages/compiler/src/types.ts";
import { moduleInterfaceIdentity } from "../../packages/cli/src/project.ts";
import { projectSignatureAt } from "../../packages/cli/src/project-semantic.ts";
import { makeTemporaryDirectory, removeTemporaryDirectories } from "../support/temporary-directory.ts";
import { compileProject } from "../support/compiler-suite.ts";

after(removeTemporaryDirectories);

test("cyclic module convergence observes the complete public class contract", () => {
  const interface_ = inspectCoreModule(`
export class Widget:
    constructor(value: string):
        pass

    get label() -> string:
        return "widget"

    def render() -> string:
        return self.label
`.trimStart(), { path: "/contracts.vel" }).moduleInterface;
  const info = interface_.classes.get("Widget")!;
  const identity = moduleInterfaceIdentity(interface_);
  const changed = (next: typeof info): string => moduleInterfaceIdentity({
    ...interface_,
    classes: new Map([["Widget", next]]),
  });

  const variants = [
    { ...info, parameters: [{ kind: "number" } as ValueType] },
    { ...info, parameterNames: ["item"] },
    { ...info, requiredParameters: 0 },
    { ...info, constructorRest: { kind: "string" } as ValueType },
    { ...info, abstract: true },
    { ...info, getters: new Set<string>() },
    { ...info, abstractGetters: new Set(["label"]) },
    { ...info, abstractMethods: new Set(["render"]) },
    { ...info, staticGetters: new Set(["label"]) },
  ];
  for (const variant of variants) assert.notEqual(changed(variant), identity);

  assert.notEqual(moduleInterfaceIdentity({
    ...interface_,
    namedTypeIdentities: new Map([["WidgetData", "velar:/other.vel#type:WidgetData"]]),
  }), identity);
  assert.notEqual(
    moduleInterfaceIdentity({ ...interface_, namedTypeIdentities: new Map([["a", "b|c:d"]]) }),
    moduleInterfaceIdentity({ ...interface_, namedTypeIdentities: new Map([["a", "b"], ["c", "d"]]) }),
  );

  const extensionInterface = (version: number) => ({
    ...interface_,
    extensionExports: new Map([["contract-test", new Map<string, unknown>([["metadata", { version }]])]]),
  });
  assert.throws(
    () => moduleInterfaceIdentity(extensionInterface(1)),
    /without an interfaceExportIdentity contract/u,
  );
  const contractExtension: CompilerExtension = {
    id: "contract-test",
    inspection: { interfaceExportIdentity: (_name, value) => JSON.stringify(value) },
  };
  assert.notEqual(
    moduleInterfaceIdentity(extensionInterface(1), [contractExtension]),
    moduleInterfaceIdentity(extensionInterface(2), [contractExtension]),
  );
});

test("record metadata keeps module identity without creating implicit type imports", async () => {
  const directory = await makeTemporaryDirectory("velar-record-module-");
  const leftLibrary = join(directory, "left.vel");
  const rightLibrary = join(directory, "right.vel");
  const entry = join(directory, "main.vel");
  await writeFile(leftLibrary, `
export type Item:
    left: string

export def makeLeft() -> Item:
    return {left: "left"}
`.trimStart(), "utf8");
  await writeFile(rightLibrary, `
export type Item:
    right: number

export def makeRight() -> Item:
    return {right: 1}
`.trimStart(), "utf8");
  await writeFile(entry, `
import {makeLeft} from "./left.vel"
import {makeRight} from "./right.vel"

print(makeLeft().left)
print(makeRight().right)
`.trimStart(), "utf8");

  const collisionFree = await compileProject(entry);
  assert.deepEqual(collisionFree.failures, []);
  assert.deepEqual(collisionFree.modules.flatMap((module) => module.result.diagnostics), []);

  await writeFile(entry, `
import {makeLeft} from "./left.vel"
const value: Item = makeLeft()
`.trimStart(), "utf8");
  const hiddenName = await compileProject(entry);
  assert.ok(hiddenName.modules.find((module) => module.inputPath === entry)?.result.diagnostics
    .some((item) => /Unknown type 'Item'/u.test(item.message)));

  await writeFile(entry, `
import {Item as LeftItem, makeLeft} from "./left.vel"
import {Item as RightItem, makeRight} from "./right.vel"

const left: LeftItem = makeLeft()
const right: RightItem = makeRight()
print(left.left)
print(right.right)
`.trimStart(), "utf8");
  const explicit = await compileProject(entry);
  assert.deepEqual(explicit.failures, []);
  assert.deepEqual(explicit.modules.flatMap((module) => module.result.diagnostics), []);
});

test("same-named record types from different modules use their structural contracts", async () => {
  const directory = await makeTemporaryDirectory("velar-record-contract-");
  const consumerPath = join(directory, "consumer.vel");
  const producerPath = join(directory, "producer.vel");
  const mainPath = join(directory, "main.vel");
  await writeFile(consumerPath, `
export type Item:
    label: string

export def consume(value: Item):
    print(value.label)
`.trimStart(), "utf8");
  await writeFile(producerPath, `
export type Item:
    count: number

export def make() -> Item:
    return {count: 1}
`.trimStart(), "utf8");
  await writeFile(mainPath, `
import {consume} from "./consumer.vel"
import {make} from "./producer.vel"
consume(make())
`.trimStart(), "utf8");

  const incompatible = await compileProject(mainPath);
  assert.deepEqual(incompatible.failures, []);
  assert.ok(incompatible.modules.find((module) => module.inputPath === mainPath)?.result.diagnostics
    .some((item) => /Cannot assign Item to a different Item contract/u.test(item.message)));

  await writeFile(producerPath, `
export type Item:
    label: string

export def make() -> Item:
    return {label: "ready"}
`.trimStart(), "utf8");
  const compatible = await compileProject(mainPath);
  assert.deepEqual(compatible.failures, []);
  assert.deepEqual(compatible.modules.flatMap((module) => module.result.diagnostics), []);
});

test("null normalization follows checked types across Velar module exports", async () => {
  const directory = await makeTemporaryDirectory("velar-host-reexport-");
  const packageRoot = join(directory, "node_modules", "boundary-sdk");
  await mkdir(packageRoot, { recursive: true });
  await writeFile(join(packageRoot, "package.json"), JSON.stringify({
    name: "boundary-sdk",
    type: "module",
    exports: "./index.js",
    types: "./index.d.ts",
  }), "utf8");
  await writeFile(join(packageRoot, "index.js"), "export const client = { maybe: () => undefined };\nexport const emptyBox = { empty: undefined };\nexport const emptyValue = undefined;\nexport const maybeAsync = async () => undefined;\nexport const maybeValue = undefined;\n", "utf8");
  await writeFile(join(packageRoot, "index.d.ts"), "export interface Client { maybe(): string | undefined; }\nexport interface EmptyBox { readonly empty: undefined; }\nexport declare const client: Client;\nexport declare const emptyBox: EmptyBox;\nexport declare const emptyValue: undefined;\nexport declare function maybeAsync(): Promise<string | undefined>;\nexport declare const maybeValue: string | undefined;\n", "utf8");
  const bridge = join(directory, "bridge.vel");
  const entry = join(directory, "main.vel");
  await writeFile(bridge, 'import js {client, emptyBox, emptyValue, maybeAsync, maybeValue} from "boundary-sdk"\nexport type ClientView:\n    maybe: () -> string?\n\nexport const forwardedClient = client\nexport const forwardedEmpty = emptyValue\nexport const forwardedEmptyBox = emptyBox\nexport const forwardedPromise = maybeAsync()\nexport const forwardedValue = maybeValue\n\nexport def current() -> ClientView:\n    return client\n\nexport def relay(value: ClientView) -> ClientView:\n    return value\n\nexport class Holder:\n    constructor():\n        pass\n\n    def current() -> ClientView:\n        return client\n\n    static def shared() -> ClientView:\n        return client\n', "utf8");
  await writeFile(entry, 'import {current, forwardedClient, forwardedEmpty, forwardedEmptyBox, forwardedPromise, forwardedValue, Holder, relay} from "./bridge.vel"\nconst throughFunction = current()\nconst throughParameter = relay(forwardedClient)\nconst throughMethod = Holder().current()\nconst throughStaticMethod = Holder.shared()\nprint(forwardedEmptyBox.empty == null)\nprint(forwardedClient.maybe() == null)\nprint(throughFunction.maybe() == null)\nprint(throughParameter.maybe() == null)\nprint(throughMethod.maybe() == null)\nprint(throughStaticMethod.maybe() == null)\nprint(await forwardedPromise == null)\nprint(forwardedEmpty == null)\nprint(forwardedValue == null)\n', "utf8");

  const project = await compileProject(entry);
  assert.deepEqual(project.failures, []);
  assert.deepEqual(project.modules.flatMap((module) => module.result.diagnostics), []);
  const bridgeModule = project.modules.find((module) => module.inputPath === bridge)!;
  const entryModule = project.modules.find((module) => module.inputPath === entry)!;
  assert.match(entryModule.result.code ?? "", /forwardedEmptyBox\.empty \?\? null/u);
  assert.match(entryModule.result.code ?? "", /forwardedClient\.maybe\(\) \?\? null/u);
  assert.match(entryModule.result.code ?? "", /throughFunction\.maybe\(\) \?\? null/u);
  assert.match(entryModule.result.code ?? "", /throughParameter\.maybe\(\) \?\? null/u);
  assert.match(entryModule.result.code ?? "", /throughMethod\.maybe\(\) \?\? null/u);
  assert.match(entryModule.result.code ?? "", /throughStaticMethod\.maybe\(\) \?\? null/u);
  assert.match(entryModule.result.code ?? "", /forwardedEmpty \?\? null/u);
  assert.match(bridgeModule.result.code ?? "", /emptyValue \?\? null/u);
  assert.match(entryModule.result.code ?? "", /__velarNormalizePromiseValue\(forwardedPromise\)/u);
  assert.ok((entryModule.result.code ?? "").includes(`from ${JSON.stringify(VELAR_PROMISE_NORMALIZATION_MODULE)}`));
  assert.ok(entryModule.result.runtimeModules.includes(VELAR_PROMISE_NORMALIZATION_MODULE));
  assert.doesNotMatch(entryModule.result.code ?? "", /velar\.promise\.normalization\.v1/u);

  const namespaceEntry = join(directory, "namespace.vel");
  await writeFile(namespaceEntry, 'import * as bridge from "./bridge.vel"\nprint(bridge.forwardedEmpty == null)\nprint(await bridge.forwardedPromise == null)\n', "utf8");
  const namespaceProject = await compileProject(namespaceEntry);
  assert.deepEqual(namespaceProject.failures, []);
  assert.deepEqual(namespaceProject.modules.flatMap((module) => module.result.diagnostics), []);
  const namespaceCode = namespaceProject.modules.find((module) => module.inputPath === namespaceEntry)!.result.code ?? "";
  assert.match(namespaceCode, /bridge\.forwardedEmpty \?\? null/u);
  assert.match(namespaceCode, /__velarNormalizePromiseValue\(bridge\.forwardedPromise\)/u);
  assert.ok(namespaceCode.includes(`from ${JSON.stringify(VELAR_PROMISE_NORMALIZATION_MODULE)}`));

  const dynamicEntry = join(directory, "dynamic.vel");
  await writeFile(dynamicEntry, 'const bridge = await import("./bridge.vel")\nprint(bridge.forwardedEmpty == null)\n', "utf8");
  const dynamicProject = await compileProject(dynamicEntry);
  assert.deepEqual(dynamicProject.failures, []);
  assert.deepEqual(dynamicProject.modules.flatMap((module) => module.result.diagnostics), []);
  const dynamicCode = dynamicProject.modules.find((module) => module.inputPath === dynamicEntry)!.result.code ?? "";
  assert.match(dynamicCode, /bridge\.forwardedEmpty \?\? null/u);

  const internal = join(directory, "internal.vel");
  const internalEntry = join(directory, "internal-main.vel");
  await writeFile(internal, 'export const maybe: string? = null\n', "utf8");
  await writeFile(internalEntry, 'import {maybe} from "./internal.vel"\nprint(maybe == null)\n', "utf8");
  const internalProject = await compileProject(internalEntry);
  assert.deepEqual(internalProject.failures, []);
  const internalCode = internalProject.modules.find((module) => module.inputPath === internalEntry)!.result.code ?? "";
  assert.match(internalCode, /maybe \?\? null/u);
});

test("rest signatures retain class element types across module and editor boundaries", async () => {
  const directory = await makeTemporaryDirectory("velar-rest-module-");
  const library = join(directory, "items.vel");
  const entry = join(directory, "main.vel");
  await writeFile(library, `
export class Item:
    const name: string

    constructor(name: string):
        self.name = name

export def count(first: Item, ...others: Item) -> number:
    return others.size + 1
`.trimStart(), "utf8");
  const validSource = `
import {Item as Product, count} from "./items.vel"
const first = Product("first")
const amount = count(first, Product("second"), Product("third"))
print(amount)
`.trimStart();
  await writeFile(entry, validSource, "utf8");

  const valid = await compileProject(entry);
  assert.deepEqual(valid.failures, []);
  assert.ok(valid.modules.every((module) => module.result.diagnostics.length === 0));
  const signatureOffset = validSource.indexOf("Product(\"second\")") + 2;
  const signature = projectSignatureAt(valid, entry, signatureOffset);
  assert.equal(signature?.label, "count(first: Item, ...Item) -> number");
  assert.equal(signature?.activeParameter, 1);

  await writeFile(entry, `
import {Item as Product, count} from "./items.vel"
const first = Product("first")
print(count(first, "wrong"))
`.trimStart(), "utf8");
  const invalid = await compileProject(entry);
  assert.ok(invalid.modules.some((module) => module.inputPath === entry
    && module.result.diagnostics.some((item) => /Cannot assign string to Product/u.test(item.message))));
});

test("Set element contracts cross module aliases and signature help", async () => {
  const directory = await makeTemporaryDirectory("velar-set-module-");
  const library = join(directory, "tags.vel");
  const entry = join(directory, "main.vel");
  await writeFile(library, `
export class Tag:
    const name: string

    constructor(name: string):
        self.name = name

export def count(tags: Set<Tag>) -> number:
    return tags.size
`.trimStart(), "utf8");
  const validSource = `
import {Tag as Label, count} from "./tags.vel"
const tags: Set<Label> = Set([Label("velar")])
print(count(tags))
`.trimStart();
  await writeFile(entry, validSource, "utf8");

  const valid = await compileProject(entry);
  assert.deepEqual(valid.failures, []);
  assert.ok(valid.modules.every((module) => module.result.diagnostics.length === 0));
  const signature = projectSignatureAt(valid, entry, validSource.indexOf("tags))") + 2);
  assert.equal(signature?.label, "count(tags: Set<Tag>) -> number");

  await writeFile(entry, `
import {count} from "./tags.vel"
const tags = Set(["wrong"])
print(count(tags))
`.trimStart(), "utf8");
  const invalid = await compileProject(entry);
  assert.ok(invalid.modules.some((module) => module.inputPath === entry
    && module.result.diagnostics.some((item) => /Cannot assign Set<string> to Set<Tag>/u.test(item.message))));
});
