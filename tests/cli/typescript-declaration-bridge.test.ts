import assert from "node:assert/strict";
import test, { after } from "node:test";
import { mkdir, realpath, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { compile as compileCore, describeType } from "@velarscript/compiler";
import { loadTypeScriptDeclarations, parseTypeScriptDeclarations } from "../../packages/cli/src/typescript-declarations.ts";
import { makeTemporaryDirectory, removeTemporaryDirectories } from "../support/temporary-directory.ts";
import { compileProject } from "../support/compiler-suite.ts";

after(removeTemporaryDirectories);

test("limited TypeScript declarations bridge safe JavaScript imports without importing TypeScript's type system", async () => {
  const declarations = parseTypeScriptDeclarations(`
export interface FormatOptions {
  prefix?: string;
  precision: number;
}
export interface BaseClient {
  readonly version: string;
}
export interface Client extends BaseClient {
  request(path: string, timeoutMs?: number): Promise<string>;
  close?(): void;
}
export interface NestedValue {
  name: string;
}
export interface Holder {
  readonly nested: NestedValue;
}
export interface RecursiveClient extends RecursiveClient {
  value: string;
}
export interface GenericClient extends GenericBase<string> {
  value: string;
}
export declare function format(value: number, options?: FormatOptions): Promise<string>;
export declare function join(first: string, ...parts: readonly string[]): string;
export declare function unique(values: readonly string[]): ReadonlySet<string>;
export declare function consume(values: readonly string[]): void;
export declare function supply(handler: (values: readonly string[]) => void): void;
export declare function createValues(): readonly string[];
export declare function mutableValues(): string[];
export declare function bytes(): Uint8Array;
export declare function nodeBytes(): Buffer<ArrayBuffer>;
export declare function words(): Uint16Array<ArrayBuffer>;
export declare function indices(): Uint32Array<ArrayBuffer>;
export declare function positions(): Float32Array<ArrayBuffer>;
export declare function acceptBytes(value: Uint8Array): void;
export declare function acceptIndices(value: Uint32Array): void;
export declare function acceptValues(values: string[]): void;
export declare function dictionary(): Record<string, number>;
export declare function setMode(value: "fast" | "safe"): void;
export declare function visit(handler: (value: string) => void): void;
export declare function acceptVoid(value: void): void;
export declare function empty(): null;
export declare function absent(): undefined;
export declare const version: string;
export declare const client: Client;
export declare const holder: Holder;
export declare const readonlyValues: ReadonlyMap<string, NestedValue>;
export declare const mutableValuesByKey: Map<string, NestedValue>;
export declare const recursiveClient: RecursiveClient;
export declare const genericClient: GenericClient;
export declare class BaseFormatter {
  readonly locale: string;
  static readonly family: string;
}
export declare class Formatter extends BaseFormatter {
  constructor(readonly prefix: string, precision?: number);
  precision: number;
  static readonly version: string;
  format(value: number, suffix?: string): string;
  setPrecision(value: number): this;
  visit(visitor: (label: string) => void): void;
  static create(prefix: string): Formatter;
}
export declare class GenericFormatter<T> {
  format(value: T): string;
}
export declare class BrokenFormatter extends BaseFormatter {
  readonly locale: number;
}
export declare function overloaded(value: string): string;
export declare function overloaded(value: number): number;
export declare function identity<T>(value: T): T;
export declare function invalidOrder(first?: string, second: number): number;
export declare class InvalidOrder {
  constructor(first?: string, second: number);
}
`, "fixture/index.d.ts");
  assert.equal(describeType(declarations.exports.get("format")!), "(number, { prefix?: string, precision: number } = default) -> Promise<string>");
  assert.equal(describeType(declarations.exports.get("join")!), "(string, ...string) -> string");
  assert.equal(describeType(declarations.exports.get("unique")!), "(readonly List<string>) -> readonly Set<string>");
  assert.equal(describeType(declarations.exports.get("consume")!), "(readonly List<string>) -> null");
  assert.equal(describeType(declarations.exports.get("supply")!), "((readonly List<string>) -> null) -> null");
  assert.equal(describeType(declarations.exports.get("createValues")!), "() -> readonly List<string>");
  assert.equal(describeType(declarations.exports.get("mutableValues")!), "() -> List<string>");
  assert.equal(describeType(declarations.exports.get("bytes")!), "() -> Bytes");
  assert.equal(describeType(declarations.exports.get("nodeBytes")!), "() -> Bytes");
  assert.equal(describeType(declarations.exports.get("words")!), "() -> UInt16Buffer");
  assert.equal(describeType(declarations.exports.get("indices")!), "() -> UInt32Buffer");
  assert.equal(describeType(declarations.exports.get("positions")!), "() -> Float32Buffer");
  assert.equal(describeType(declarations.exports.get("acceptBytes")!), "(Bytes | UInt8Buffer) -> null");
  assert.equal(describeType(declarations.exports.get("acceptIndices")!), "(UInt32Buffer) -> null");
  assert.equal(describeType(declarations.exports.get("dictionary")!), "() -> unknown");
  assert.equal(describeType(declarations.exports.get("setMode")!), "(unknown) -> null");
  assert.equal(describeType(declarations.exports.get("visit")!), "((string) -> null) -> null");
  assert.equal(describeType(declarations.exports.get("acceptVoid")!), "(unknown) -> null");
  assert.equal(describeType(declarations.exports.get("empty")!), "() -> null");
  assert.equal(describeType(declarations.exports.get("absent")!), "() -> null");
  assert.equal(describeType(declarations.exports.get("version")!), "string");
  assert.equal(describeType(declarations.exports.get("client")!), "{ readonly version: string, request: (string, number = default) -> Promise<string>, close?: () -> null }");
  assert.equal(describeType(declarations.exports.get("holder")!), "{ readonly nested: { name: string } }");
  assert.equal(describeType(declarations.exports.get("readonlyValues")!), "readonly Map<string, { name: string }>");
  assert.equal(describeType(declarations.exports.get("mutableValuesByKey")!), "Map<string, { name: string }>");
  assert.equal(describeType(declarations.exports.get("recursiveClient")!), "unknown");
  assert.equal(describeType(declarations.exports.get("genericClient")!), "unknown");
  assert.equal(describeType(declarations.exports.get("Formatter")!), "Formatter");
  assert.equal(describeType(declarations.exports.get("GenericFormatter")!), "unknown");
  assert.equal(describeType(declarations.exports.get("BrokenFormatter")!), "unknown");
  assert.equal(declarations.classes.get("Formatter")?.requiredParameters, 1);
  assert.equal(declarations.classes.get("Formatter")?.base, declarations.classes.get("BaseFormatter")?.identity);
  assert.equal(declarations.classes.get("Formatter")!.fields.get("prefix")?.mutable, false);
  assert.equal(describeType(declarations.classes.get("Formatter")!.methods.get("format")!), "(number, string = default) -> string");
  assert.equal(describeType(declarations.classes.get("Formatter")!.methods.get("setPrecision")!), "(number) -> Formatter");
  assert.equal(describeType(declarations.classes.get("Formatter")!.staticMethods.get("create")!), "(string) -> Formatter");
  assert.equal(describeType(declarations.classes.get("Formatter")!.staticFields.get("version")!.type), "string");
  assert.equal(describeType(declarations.exports.get("overloaded")!), "unknown");
  assert.equal(describeType(declarations.exports.get("identity")!), "unknown");
  assert.equal(describeType(declarations.exports.get("invalidOrder")!), "unknown");
  assert.equal(describeType(declarations.exports.get("InvalidOrder")!), "unknown");
  assert.ok(declarations.warnings.some((warning) => /Overloaded export 'overloaded'/u.test(warning)));
  assert.ok(declarations.warnings.some((warning) => /Recursive interface 'RecursiveClient'/u.test(warning)));
  assert.ok(declarations.warnings.some((warning) => /Generic or complex interface base 'GenericBase<string>'/u.test(warning)));
  assert.ok(declarations.warnings.some((warning) => /Generic function 'identity'/u.test(warning)));
  assert.ok(declarations.warnings.some((warning) => /GenericFormatter/u.test(warning)));
  assert.ok(declarations.warnings.some((warning) => /incompatible inherited member contract/u.test(warning)));
  assert.ok(!declarations.warnings.some((warning) => /Readonly collection type/u.test(warning)));
  assert.ok(!declarations.warnings.some((warning) => /ReadonlyMap|Generic type 'Map'/u.test(warning)));
  assert.ok(declarations.warnings.some((warning) => /Record is a plain JavaScript object/u.test(warning)));
  assert.ok(declarations.warnings.some((warning) => /literal type/u.test(warning)));
  assert.ok(declarations.warnings.some((warning) => /void cannot be supplied/u.test(warning)));
  assert.ok(declarations.warnings.some((warning) => /Required parameter 'second: number' follows an optional parameter/u.test(warning)));
  assert.ok(declarations.warnings.some((warning) => /Required constructor parameter 'second: number' follows an optional parameter/u.test(warning)));

  const restrictedLiteral = compileCore('import js {setMode} from "fixture"\nsetMode("fast")\n', {
    analysis: { imports: new Map([["setMode", declarations.exports.get("setMode")!]]) },
  });
  assert.ok(restrictedLiteral.diagnostics.some((item) => /Cannot assign string to unknown/u.test(item.message)));
  const restrictedVoid = compileCore('import js {acceptVoid} from "fixture"\nacceptVoid(null)\n', {
    analysis: { imports: new Map([["acceptVoid", declarations.exports.get("acceptVoid")!]]) },
  });
  assert.ok(restrictedVoid.diagnostics.some((item) => /Cannot assign null to unknown/u.test(item.message)));

  const readonlyCollection = compileCore('import js {acceptValues, createValues} from "fixture"\nconst values = createValues()\nvalues.append("x")\nacceptValues(values)\n', {
    analysis: { imports: declarations.exports },
  });
  assert.ok(readonlyCollection.diagnostics.some((item) => /mutating method 'append' through readonly List<string>/u.test(item.message)));
  assert.ok(readonlyCollection.diagnostics.some((item) => /Cannot assign readonly List<string> to List<string>/u.test(item.message)));

  const readonlyMapAndDeepField = compileCore(`
import js {holder, readonlyValues, mutableValuesByKey} from "fixture"
holder.nested.name = "allowed"
holder.nested = {name: "blocked"}
const readonlyValue = readonlyValues.get("item")
if readonlyValue != null:
    readonlyValue.name = "blocked"
const mutableValue = mutableValuesByKey.get("item")
if mutableValue != null:
    mutableValue.name = "allowed"
`.trimStart(), { analysis: { imports: declarations.exports } });
  assert.deepEqual(readonlyMapAndDeepField.diagnostics.map((item) => item.message), [
    "Cannot assign through readonly { name: string }; it is a read-only view",
    "Cannot assign to read-only field 'nested'",
    "Cannot assign through readonly { name: string }; it is a read-only view",
  ]);

  const directory = await makeTemporaryDirectory("velar-dts-");
  const packageRoot = join(directory, "node_modules", "typed-format");
  await mkdir(packageRoot, { recursive: true });
  await writeFile(join(packageRoot, "package.json"), JSON.stringify({
    name: "typed-format",
    type: "module",
    exports: "./index.js",
    types: "./index.d.ts",
  }), "utf8");
  await writeFile(join(packageRoot, "index.js"), "export class Formatter { static version = '1'; constructor(prefix) { this.prefix = prefix; this.precision = 1; } format(value) { return this.prefix + value.toFixed(this.precision); } static create(prefix) { return new Formatter(prefix); } }\nexport const format = value => String(value)\nexport const join = (first, ...parts) => [first, ...parts].join('')\nexport const visit = handler => handler('ready')\nexport const client = { version: '1', request: async path => path }\nexport const maybe = () => undefined\nexport const maybeAsync = async () => undefined\nexport const absent = () => undefined\nexport const maybeValue = undefined\nexport const identity = value => value\n", "utf8");
  await writeFile(join(packageRoot, "core.d.ts"), "export declare class Formatter { constructor(prefix: string); readonly prefix: string; precision: number; static readonly version: string; format(value: number): string; static create(prefix: string): Formatter; }\nexport interface Client { readonly version: string; request(path: string, timeoutMs?: number): Promise<string>; close?(): void; }\nexport interface FormatOptions { prefix?: string; precision: number; }\nexport declare function format(value: number, options?: FormatOptions): string;\nexport declare function join(first: string, ...parts: readonly string[]): string;\nexport declare const client: Client;\nexport declare function maybe(): string | undefined;\nexport declare function maybeAsync(): Promise<string | undefined>;\nexport declare function absent(): undefined;\nexport declare const maybeValue: string | undefined;\nexport declare function identity<T>(value: T): T;\n", "utf8");
  await writeFile(join(packageRoot, "callbacks.d.ts"), "export declare function visit(handler: (value: string) => void): void;\n", "utf8");
  await writeFile(join(packageRoot, "index.d.ts"), "export {Formatter, absent, client, format, identity, join, maybe, maybeAsync, maybeValue} from \"./core.js\";\nexport * from \"./callbacks\";\n", "utf8");
  const alternateRoot = join(directory, "node_modules", "typed-format-alt");
  await mkdir(alternateRoot, { recursive: true });
  await writeFile(join(alternateRoot, "package.json"), JSON.stringify({
    name: "typed-format-alt",
    type: "module",
    exports: "./index.js",
    types: "./index.d.ts",
  }), "utf8");
  await writeFile(join(alternateRoot, "index.js"), "export class Formatter { constructor(prefix) { this.prefix = prefix; } }\n", "utf8");
  await writeFile(join(alternateRoot, "index.d.ts"), "export declare class Formatter { constructor(prefix: string); readonly prefix: string; }\n", "utf8");

  const validPath = join(directory, "valid.vel");
  await writeFile(validPath, "import js {Formatter as NumberFormatter, absent, client, format, join, maybe, maybeAsync, maybeValue, visit} from \"typed-format\"\nconst formatter: NumberFormatter = NumberFormatter(\">\")\nformatter.precision = 2\nconst formatted: string = formatter.format(42)\nconst restored: NumberFormatter = NumberFormatter.create(\"~\")\nconst version: string = NumberFormatter.version\nconst label: string = format(42)\nconst configured: string = format(42, {precision: 1})\nclient.close?.()\nconst joined: string = join(\"Velar\", \"Script\")\nconst requested: Promise<string> = client.request(\"/status\", 1000)\nvisit(value => print(value))\nprint(maybe() == null)\nprint(await maybeAsync() == null)\nprint(absent() == null)\nprint(maybeValue == null)\n", "utf8");
  const valid = await compileProject(validPath);
  assert.deepEqual(valid.failures, []);
  assert.deepEqual(valid.modules.flatMap((module) => module.result.diagnostics), []);
  const validOutput = join(directory, "valid.js");
  const validBuild = spawnSync(process.execPath, ["packages/cli/src/cli.ts", "build", validPath, "--out", validOutput], {
    cwd: process.cwd(),
    encoding: "utf8",
  });
  assert.equal(validBuild.status, 0, String(validBuild.stderr));
  const validExecution = spawnSync(process.execPath, [validOutput], { encoding: "utf8" });
  assert.equal(validExecution.status, 0, String(validExecution.stderr));
  assert.equal(validExecution.stdout, "ready\ntrue\ntrue\ntrue\ntrue\n");

  const invalidPath = join(directory, "invalid.vel");
  await writeFile(invalidPath, "import js {Formatter, client, format, join, identity, visit} from \"typed-format\"\nimport js {Formatter as ForeignFormatter} from \"typed-format-alt\"\nconst formatter = Formatter(1)\nconst foreign: ForeignFormatter = formatter\nformatter.prefix = \"changed\"\nFormatter.version = \"2\"\nclient.version = \"2\"\nformatter.format(\"wrong\")\nconst label = format(\"wrong\")\nformat(42, null)\nformat(42, {precision: 1, prefix: null})\nconst joined = join(\"Velar\", 2)\nclient.request(2)\nclient.request(\"/status\", null)\nvisit(value => value + 1)\nidentity(1)\n", "utf8");
  const invalid = await compileProject(invalidPath);
  const invalidDiagnostics = invalid.modules.flatMap((module) => module.result.diagnostics);
  assert.ok(invalidDiagnostics.some((item) => /Cannot assign string to number/u.test(item.message)));
  assert.ok(invalidDiagnostics.filter((item) => /Cannot assign number to string/u.test(item.message)).length >= 3);
  assert.ok(invalidDiagnostics.some((item) => /Cannot assign to read-only member 'prefix'/u.test(item.message)));
  assert.ok(invalidDiagnostics.some((item) => /Cannot assign to read-only static member 'version'/u.test(item.message)));
  assert.ok(invalidDiagnostics.some((item) => /Cannot assign to read-only field 'version'/u.test(item.message)));
  assert.ok(invalidDiagnostics.some((item) => /Cannot assign Formatter to ForeignFormatter/u.test(item.message)));
  assert.ok(invalidDiagnostics.some((item) => /String concatenation requires two strings/u.test(item.message)));
  assert.ok(invalidDiagnostics.some((item) => /Cannot assign null to \{ prefix/u.test(item.message)), JSON.stringify(invalidDiagnostics));
  assert.ok(invalidDiagnostics.some((item) => /Cannot assign null to string/u.test(item.message)));
  assert.ok(invalidDiagnostics.some((item) => /Cannot assign null to number/u.test(item.message)));
  assert.ok(invalidDiagnostics.some((item) => /Cannot call an unknown JavaScript value/u.test(item.message)));
  assert.ok(invalid.notices.some((notice) => /Generic function 'identity'/u.test(notice.message)));
});

test("TypeScript declaration re-exports stay package-confined, bounded, and identity-preserving", async () => {
  const directory = await makeTemporaryDirectory("velar-dts-graph-");
  const sourceRoot = join(directory, "src");
  const packageRoot = join(directory, "node_modules", "graph-sdk");
  await mkdir(sourceRoot, { recursive: true });
  await mkdir(packageRoot, { recursive: true });
  await writeFile(join(packageRoot, "package.json"), JSON.stringify({
    name: "graph-sdk",
    type: "module",
    exports: "./index.js",
    types: "./index.d.ts",
  }), "utf8");
  await writeFile(join(packageRoot, "index.js"), "class Base { constructor() { this.kind = 'client'; } }\nclass Client extends Base { constructor(id) { super(); this.id = id; } configure(options) { return options.prefix + this.id; } }\nexport {Client, Client as SameClient};\n", "utf8");
  await writeFile(join(packageRoot, "model.d.ts"), "export interface Options { prefix: string; }\nexport declare class Base { readonly kind: string; }\n", "utf8");
  await writeFile(join(packageRoot, "client.d.ts"), "import {Base, type Options} from \"./model\";\nexport declare class Client extends Base { constructor(readonly id: string); configure(options: Options): string; }\n", "utf8");
  await writeFile(join(packageRoot, "left.d.ts"), "export declare const version: string;\n", "utf8");
  await writeFile(join(packageRoot, "right.d.ts"), "export declare const version: number;\n", "utf8");
  await writeFile(join(packageRoot, "cycle-a.d.ts"), "export declare const local: string;\nexport * from \"./cycle-b\";\n", "utf8");
  await writeFile(join(packageRoot, "cycle-b.d.ts"), "export declare const remote: string;\nexport * from \"./cycle-a\";\n", "utf8");
  for (let index = 0; index < 18; index += 1) {
    await writeFile(
      join(packageRoot, `depth-${index}.d.ts`),
      index === 17 ? "export declare const tooDeep: string;\n" : `export * from "./depth-${index + 1}";\n`,
      "utf8",
    );
  }
  const outside = join(directory, "outside.d.ts");
  await writeFile(outside, "export declare const leaked: string;\n", "utf8");
  await symlink(outside, join(packageRoot, "leak.d.ts"));
  await writeFile(join(packageRoot, "index.d.ts"), `
export {Client, Client as SameClient, missing as Missing} from "./client.js";
export * from "./left";
export * from "./right";
export * from "./cycle-a";
export * from "./depth-0";
export {leaked} from "./leak";
`.trimStart(), "utf8");

  const bridge = await loadTypeScriptDeclarations("graph-sdk", join(sourceRoot, "main.vel"));
  assert.ok(bridge);
  assert.ok(bridge.dependencies.includes(await realpath(join(packageRoot, "package.json"))));
  assert.ok(bridge.dependencies.includes(await realpath(join(packageRoot, "index.d.ts"))));
  assert.ok(bridge.dependencies.includes(await realpath(join(packageRoot, "client.d.ts"))));
  assert.ok(bridge.dependencies.includes(await realpath(join(packageRoot, "model.d.ts"))));
  const client = bridge.exports.get("Client");
  const sameClient = bridge.exports.get("SameClient");
  assert.equal(client?.kind, "classConstructor");
  assert.equal(sameClient?.kind, "classConstructor");
  assert.equal(
    client?.kind === "classConstructor" ? client.identity : null,
    sameClient?.kind === "classConstructor" ? sameClient.identity : null,
  );
  assert.equal(bridge.exports.get("Missing")?.kind, "unknown");
  assert.equal(bridge.exports.get("version")?.kind, "unknown");
  assert.equal(bridge.exports.get("local")?.kind, "string");
  assert.equal(bridge.exports.get("remote")?.kind, "string");
  assert.equal(bridge.exports.get("leaked")?.kind, "unknown");
  assert.equal(bridge.exports.has("tooDeep"), false);
  assert.ok(bridge.warnings.some((warning) => /Ambiguous declaration star export 'version'/u.test(warning)));
  assert.ok(bridge.warnings.some((warning) => /Cyclic TypeScript declaration re-export/u.test(warning)));
  assert.ok(bridge.warnings.some((warning) => /not a package-local \.d\.ts file/u.test(warning)));
  assert.ok(bridge.warnings.some((warning) => /re-export depth exceeds 16/u.test(warning)));

  const entry = join(sourceRoot, "main.vel");
  await writeFile(entry, "import js {Client as Primary, SameClient as Alias} from \"graph-sdk\"\nconst first = Primary(\"one\")\nconst same: Alias = first\nconst kind: string = first.kind\nconst configured: string = first.configure({prefix: \"ready:\"})\n", "utf8");
  const project = await compileProject(entry);
  assert.deepEqual(project.failures, []);
  assert.deepEqual(project.modules.flatMap((module) => module.result.diagnostics), []);
});

test("TypeScript declaration local export tables preserve runtime and type boundaries", async () => {
  const directory = await makeTemporaryDirectory("velar-dts-local-exports-");
  const sourceRoot = join(directory, "src");
  const packageRoot = join(directory, "node_modules", "bundled-sdk");
  await mkdir(sourceRoot, { recursive: true });
  await mkdir(packageRoot, { recursive: true });
  await writeFile(join(packageRoot, "package.json"), JSON.stringify({
    name: "bundled-sdk",
    type: "module",
    exports: "./index.js",
    types: "./index.d.ts",
  }), "utf8");
  await writeFile(join(packageRoot, "index.js"), `
class BundledClient {
  constructor(id) { this.id = id; this._timeout = 1000; }
  get label() { return "client:" + this.id; }
  get timeout() { return this._timeout; }
  set timeout(value) { this._timeout = value; }
  request(path) { return this.id + ":" + path; }
  static get standard() { return new BundledClient("standard"); }
}
function createClient(id) { return new BundledClient(id); }
const version = "1";
export {BundledClient, BundledClient as BundledAlias, createClient, version};
export default BundledClient;
`.trimStart(), "utf8");
  await writeFile(join(packageRoot, "index.d.ts"), `
declare class BundledClient {
  constructor(readonly id: string);
  get label(): string;
  get timeout(): number;
  set timeout(value: number);
  request(path: string): string;
  static get standard(): BundledClient;
}
declare function createClient(id: string): BundledClient;
declare const version: string;
interface BundledOptions { prefix: string; }
export {BundledClient, BundledClient as BundledAlias, createClient, version};
export type {BundledOptions};
export default BundledClient;
`.trimStart(), "utf8");

  const entry = join(sourceRoot, "main.vel");
  const bridge = await loadTypeScriptDeclarations("bundled-sdk", entry);
  assert.ok(bridge);
  const client = bridge.exports.get("BundledClient");
  const alias = bridge.exports.get("BundledAlias");
  const defaultClient = bridge.exports.get("default");
  assert.equal(client?.kind, "classConstructor");
  assert.equal(alias?.kind, "classConstructor");
  assert.equal(defaultClient?.kind, "classConstructor");
  assert.equal(client?.kind === "classConstructor" ? client.identity : null, alias?.kind === "classConstructor" ? alias.identity : null);
  assert.equal(client?.kind === "classConstructor" ? client.identity : null, defaultClient?.kind === "classConstructor" ? defaultClient.identity : null);
  assert.equal(bridge.exports.get("createClient")?.kind, "function");
  assert.equal(bridge.exports.get("version")?.kind, "string");
  assert.equal(bridge.exports.has("BundledOptions"), false);
  assert.equal(bridge.typeExports.get("BundledOptions")?.kind, "object");
  assert.equal(bridge.classes.get("BundledClient")?.fields.get("label")?.mutable, false);
  assert.equal(bridge.classes.get("BundledClient")?.fields.get("timeout")?.mutable, true);
  assert.equal(bridge.classes.get("BundledClient")?.staticFields.get("standard")?.mutable, false);
  assert.deepEqual(bridge.warnings, []);

  await writeFile(entry, `
import js {BundledClient as Client, BundledAlias, createClient, version} from "bundled-sdk"
const direct = Client("one")
const same: BundledAlias = direct
const created = createClient("two")
created.timeout = 250
const directLabel: string = direct.request("status")
const createdLabel: string = created.request(version)
const id: string = created.id
const label: string = created.label
const standardLabel: string = Client.standard.label
`.trimStart(), "utf8");
  const project = await compileProject(entry);
  assert.deepEqual(project.failures, []);
  assert.deepEqual(project.modules.flatMap((module) => module.result.diagnostics), []);

  await writeFile(entry, "import js {BundledClient as Client} from \"bundled-sdk\"\nconst client = Client(\"one\")\nclient.label = \"changed\"\nClient.standard = client\n", "utf8");
  const readonly = await compileProject(entry);
  const diagnostics = readonly.modules.flatMap((module) => module.result.diagnostics);
  assert.ok(diagnostics.some((item) => /read-only member 'label'/u.test(item.message)));
  assert.ok(diagnostics.some((item) => /read-only static member 'standard'/u.test(item.message)));

  const unsupported = parseTypeScriptDeclarations("export declare class Broken { set value(next: string); get mixed(): string; set mixed(next: number); }\n");
  assert.equal(unsupported.exports.get("Broken")?.kind, "unknown");
  assert.ok(unsupported.warnings.some((warning) => /Setter-only class accessor 'value'/u.test(warning)));
  assert.ok(unsupported.warnings.some((warning) => /incompatible getter and setter types/u.test(warning)));
});

test("TypeScript declarations follow package export subpaths without losing identity or confinement", async () => {
  const directory = await makeTemporaryDirectory("velar-dts-subpaths-");
  const sourceRoot = join(directory, "src");
  const packageRoot = join(directory, "node_modules", "subpath-sdk");
  await mkdir(sourceRoot, { recursive: true });
  await mkdir(join(packageRoot, "dist", "feature"), { recursive: true });
  await mkdir(join(packageRoot, "types", "feature"), { recursive: true });
  await writeFile(join(packageRoot, "package.json"), JSON.stringify({
    name: "subpath-sdk",
    type: "module",
    exports: {
      ".": { types: "./types/index.d.ts", default: "./dist/index.js" },
      "./client": { types: "./types/client.d.mts", default: "./dist/client.js" },
      "./feature/*": { types: "./types/feature/*.d.cts", default: "./dist/feature/*.cjs" },
      "./escaped": { types: "../outside.d.ts", default: "./dist/escaped.js" },
    },
  }), "utf8");
  await writeFile(join(packageRoot, "dist", "package.json"), JSON.stringify({ type: "module" }), "utf8");
  const clientRuntime = "export class Client { constructor(id) { this.id = id; } label() { return this.id; } }\n";
  await writeFile(join(packageRoot, "dist", "client.js"), clientRuntime, "utf8");
  await writeFile(join(packageRoot, "dist", "index.js"), "export {Client} from './client.js';\n", "utf8");
  await writeFile(join(packageRoot, "dist", "feature", "math.cjs"), "exports.scale = (value, factor) => value * factor;\n", "utf8");
  await writeFile(join(packageRoot, "dist", "escaped.js"), "export const escaped = true;\n", "utf8");
  await writeFile(join(packageRoot, "types", "client.d.mts"), "declare class Client { constructor(readonly id: string); label(): string; }\nexport {Client};\n", "utf8");
  await writeFile(join(packageRoot, "types", "index.d.ts"), "export {Client} from './client.mjs';\n", "utf8");
  await writeFile(join(packageRoot, "types", "feature", "math.d.cts"), "export declare function scale(value: number, factor: number): number;\n", "utf8");
  await writeFile(join(directory, "outside.d.ts"), "export declare const escaped: boolean;\n", "utf8");

  const entry = join(sourceRoot, "main.vel");
  const root = await loadTypeScriptDeclarations("subpath-sdk", entry);
  const direct = await loadTypeScriptDeclarations("subpath-sdk/client", entry);
  const feature = await loadTypeScriptDeclarations("subpath-sdk/feature/math", entry);
  assert.ok(root);
  assert.ok(direct);
  assert.ok(feature);
  const rootClient = root.exports.get("Client");
  const directClient = direct.exports.get("Client");
  assert.equal(rootClient?.kind, "classConstructor");
  assert.equal(directClient?.kind, "classConstructor");
  assert.equal(rootClient?.kind === "classConstructor" ? rootClient.identity : null, directClient?.kind === "classConstructor" ? directClient.identity : null);
  assert.equal(feature.exports.get("scale")?.kind, "function");
  // BRG-U3: a declared types path that cannot be used (here: it escapes the
  // package root, so confinement ignores it) degrades to unknown with the
  // polite notice instead of degrading in silence. Confinement still holds:
  // the outside file contributes no contracts.
  const escaped = await loadTypeScriptDeclarations("subpath-sdk/escaped", entry);
  assert.ok(escaped);
  assert.equal(escaped.unreadableDeclaredTypes, true);
  assert.equal(escaped.exports.size, 0);
  assert.ok(escaped.warnings.some((warning) => /declares types '\.\.\/outside\.d\.ts', but that is not a readable declaration file inside the package/u.test(warning)), JSON.stringify(escaped.warnings));

  await writeFile(entry, `
import js {Client as RootClient} from "subpath-sdk"
import js {Client as DirectClient} from "subpath-sdk/client"
import js {scale} from "subpath-sdk/feature/math"
const client = RootClient("ready")
const same: DirectClient = client
const label: string = same.label()
const value: number = scale(2, 3)
`.trimStart(), "utf8");
  const project = await compileProject(entry);
  assert.deepEqual(project.failures, []);
  assert.deepEqual(project.modules.flatMap((module) => module.result.diagnostics), []);
});
