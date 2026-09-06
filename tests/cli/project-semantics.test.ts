import assert from "node:assert/strict";
import test, { after } from "node:test";
import { mkdir, readFile, realpath, unlink, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { compile as compileCore, semanticVisibleSymbolsAt } from "@velarscript/compiler";
import { VelarProjectSessions } from "../../packages/cli/src/project-session.ts";
import {

  projectCompletionsAt,
  projectCompletionContextAt,
  projectDefinitionAt,
  projectExpressionAt,
  projectMemberSymbolAt,
  projectPrepareRenameAt,
  projectReferencesAt,
  projectRenameAt,
  projectSignatureAt,
  projectSymbolAt,
} from "../../packages/cli/src/project-semantic.ts";
import { makeTemporaryDirectory, removeTemporaryDirectories } from "../support/temporary-directory.ts";
import { compile, compileProject } from "../support/compiler-suite.ts";

after(removeTemporaryDirectories);

test("semantic index preserves lexical shadowing and typed call signatures", () => {
  const source = `
def show(value: number) -> number:
    const outer = value
    if true:
        const value = 4
        print(value)
    return outer

const result = show(2)
`.trimStart();
  const result = compile(source, { path: "/tmp/semantic.vel" });
  assert.deepEqual(result.diagnostics, []);
  const values = result.semanticIndex.symbols.filter((symbol) => symbol.name === "value");
  assert.equal(values.length, 2);
  const inner = values.find((symbol) => symbol.kind === "variable");
  const parameter = values.find((symbol) => symbol.kind === "parameter");
  assert.ok(inner && parameter);
  const references = result.semanticIndex.references.filter((reference) => reference.name === "value");
  assert.equal(references.length, 2);
  assert.notEqual(references[0]?.symbolId, references[1]?.symbolId);
  assert.equal(parameter.type, "number");
  const show = result.semanticIndex.symbols.find((symbol) => symbol.name === "show");
  assert.equal(show?.type, "(value: number) -> number");
  assert.equal(show?.callable, true);
  const innerOffset = source.indexOf("print(value)") + "print(".length;
  const innerVisible = semanticVisibleSymbolsAt(result.semanticIndex, innerOffset);
  assert.deepEqual(innerVisible.filter((symbol) => symbol.name === "value").map((symbol) => symbol.kind), ["variable"]);
  assert.ok(innerVisible.some((symbol) => symbol.name === "outer" && symbol.kind === "variable"));
  assert.ok(innerVisible.some((symbol) => symbol.name === "show" && symbol.kind === "function"));
  assert.ok(!innerVisible.some((symbol) => symbol.name === "result"), "later ordinary declarations are not visible early");
  const returnOffset = source.indexOf("return outer") + "return ".length;
  const returnVisible = semanticVisibleSymbolsAt(result.semanticIndex, returnOffset);
  assert.deepEqual(returnVisible.filter((symbol) => symbol.name === "value").map((symbol) => symbol.kind), ["parameter"]);
});

test("semantic module references retain exact literal content spans", () => {
  const source = 'import {value} from "./a\\\"b.vel"\nprint(value)\n';
  const result = compileCore(source, { analysis: { imports: new Map([
    ["value", { kind: "number" }],
  ]) } });
  assert.deepEqual(result.diagnostics, []);
  assert.equal(result.semanticIndex.moduleReferences.length, 1);
  const reference = result.semanticIndex.moduleReferences[0]!;
  assert.equal(reference.source, './a"b.vel');
  assert.equal(source.slice(reference.span.start, reference.span.end), './a\\"b.vel');
});

test("semantic type references come from the type AST instead of display text", () => {
  const source = `type User:
    name: string

type Profile = User
type Handler = (User: string, current: (User), values: List<User>) -> User
`;
  const result = compileCore(source);
  assert.deepEqual(result.diagnostics, []);
  const references = result.semanticIndex.references.filter((reference) => reference.name === "User");
  assert.equal(references.length, 4);
  assert.ok(references.every((reference) => source.slice(reference.span.start, reference.span.end) === "User"));
  assert.ok(!references.some((reference) => reference.span.start === source.indexOf("(User: string") + 1));
  const profile = result.semanticIndex.symbols.find((symbol) => symbol.name === "Profile");
  assert.equal(profile?.type, "User");
  assert.equal(profile?.typeTarget, "User");
  assert.equal(result.semanticIndex.symbols.find((symbol) => symbol.name === "Handler")?.typeTarget, undefined);
});

test("project member navigation follows explicit type-alias targets", async () => {
  const directory = await makeTemporaryDirectory("velar-alias-navigation-");
  const modelsPath = join(directory, "models.vel");
  const mainPath = join(directory, "main.vel");
  const modelsSource = `export type User:
    name: string

export type Profile = User
`;
  const mainSource = `import {Profile} from "./models.vel"
const profile: Profile = {name: "Ada"}
print(profile.name)
`;
  await writeFile(modelsPath, modelsSource, "utf8");
  await writeFile(mainPath, mainSource, "utf8");
  const project = await compileProject(mainPath);
  assert.deepEqual(project.failures, []);
  assert.deepEqual(project.modules.flatMap((module) => module.result.diagnostics), []);
  const memberOffset = mainSource.indexOf("profile.name") + "profile.".length;
  const fieldOffset = modelsSource.indexOf("name: string");
  assert.deepEqual(projectDefinitionAt(project, mainPath, memberOffset + 1), {
    path: modelsPath,
    span: { start: fieldOffset, end: fieldOffset + "name".length },
  });
});

test("documentation comments cross declarations, aliases, members, hover targets, and completion", async () => {
  const direct = compile(`
/// Formats a visible label.
///
/// Accepts **plain text**.
export def formatLabel(value: string) -> string:
    return value

/// Not attached because a blank source line follows.

const detached = "value"

/// Owns a mutable count.
class Counter:
    /// Current accumulated value.
    let value: number = 0

    /// Adds one checked amount.
    def add(amount: number):
        self.value += amount
`.trimStart(), { path: "/tmp/documented.vel" });
  assert.deepEqual(direct.diagnostics, []);
  assert.equal(direct.semanticIndex.symbols.find((symbol) => symbol.name === "formatLabel")?.documentation,
    "Formats a visible label.\n\nAccepts **plain text**.");
  assert.equal(direct.semanticIndex.symbols.find((symbol) => symbol.name === "Counter")?.documentation,
    "Owns a mutable count.");
  assert.equal(direct.semanticIndex.symbols.find((symbol) => symbol.name === "value" && symbol.kind === "field")?.documentation,
    "Current accumulated value.");
  assert.equal(direct.semanticIndex.symbols.find((symbol) => symbol.name === "add")?.documentation,
    "Adds one checked amount.");
  assert.equal(direct.semanticIndex.symbols.find((symbol) => symbol.name === "detached")?.documentation, null);
  assert.doesNotMatch(direct.code ?? "", /Formats a visible label|Owns a mutable count/u);

  const oversized = compile(`/// ${"x".repeat(17_000)}\nconst documented = true\n`);
  const boundedDocumentation = oversized.semanticIndex.symbols.find((symbol) => symbol.name === "documented")?.documentation ?? "";
  assert.equal(boundedDocumentation.length, 16_384);
  assert.ok(boundedDocumentation.endsWith("…"));

  const directory = await makeTemporaryDirectory("velar-documentation-");
  const apiPath = join(directory, "api.vel");
  const mainPath = join(directory, "main.vel");
  const apiSource = `
/// Represents a public profile.
export type Profile:
    /// Stable display name.
    name: string

/// Builds the greeting shown in the header.
export def greet(profile: Profile) -> string:
    return f"Hello, {profile.name}"

/// Counts completed operations.
export class Meter:
    let total: number = 0

    /// Records one completed operation.
    def add():
        self.total += 1
`.trimStart();
  const mainSource = `
import {Profile, greet as welcome, Meter as Counter} from "./api.vel"

const profile: Profile = {name: "Ada"}
const counter = Counter()
counter.add()
print(welcome(profile))
print(profile.name)
`.trimStart();
  await writeFile(apiPath, apiSource, "utf8");
  await writeFile(mainPath, mainSource, "utf8");
  const project = await compileProject(mainPath);
  assert.deepEqual(project.failures, []);
  assert.deepEqual(project.modules.flatMap((module) => module.result.diagnostics), []);

  const welcomeOffset = mainSource.indexOf("welcome(profile)") + 1;
  assert.equal(projectSymbolAt(project, mainPath, welcomeOffset)?.documentation,
    "Builds the greeting shown in the header.");
  const addOffset = mainSource.indexOf("counter.add") + "counter.".length + 1;
  assert.equal(projectMemberSymbolAt(project, mainPath, addOffset)?.documentation,
    "Records one completed operation.");
  const memberCompletions = projectCompletionsAt(project, mainPath,
    mainSource.indexOf("counter.add") + "counter.".length);
  assert.equal(memberCompletions.find((item) => item.label === "add")?.documentation,
    "Records one completed operation.");
  const nameOffset = mainSource.indexOf("profile.name") + "profile.".length + 1;
  assert.equal(projectMemberSymbolAt(project, mainPath, nameOffset)?.documentation,
    "Stable display name.");
  const completions = projectCompletionsAt(project, mainPath, mainSource.length);
  assert.equal(completions.find((item) => item.label === "welcome")?.documentation,
    "Builds the greeting shown in the header.");
  assert.equal(completions.find((item) => item.label === "Counter")?.documentation,
    "Counts completed operations.");
});

test("project semantics resolve imports and keep alias rename fail-closed", async () => {
  const directory = await makeTemporaryDirectory("velar-semantics-");
  const modelsPath = join(directory, "models.vel");
  const mainPath = join(directory, "main.vel");
  await writeFile(modelsPath, `
export type User:
    name: string

export def greet(user: User) -> string:
    return user.name

export const sample: User = {name: "Sample"}
const {name: sampleName} = sample
print(sample.name)

export def copy(source: User) -> User:
    const name = source.name
    const result: User = {name}
    return result

export def pick(source: User) -> string:
    const {name} = source
    return name
`.trimStart(), "utf8");
  const mainSource = `
import {User as Person, greet} from "./models.vel"

const ada = Person.parse({name: "Ada"})
print(ada.name)
print(Person.parse({name: "Grace"}).name)
const page = [1, 2, 3].slice(0, 2)
const label = greet(ada)
`.trimStart();
  await writeFile(mainPath, mainSource, "utf8");
  const project = await compileProject(mainPath);
  assert.deepEqual(project.failures, []);
  assert.deepEqual(project.modules.flatMap((module) => module.result.diagnostics), []);

  const personUse = mainSource.indexOf("Person.parse");
  const definition = projectDefinitionAt(project, mainPath, personUse + 1);
  assert.equal(definition?.path, modelsPath);
  assert.equal((await readFile(modelsPath, "utf8")).slice(definition?.span.start, definition?.span.end), "User");

  const localRename = projectRenameAt(project, mainPath, personUse + 1, "Account");
  assert.notEqual(typeof localRename, "string");
  if (typeof localRename !== "string") {
    assert.equal(localRename.edits.length, 3);
    assert.ok(localRename.edits.every((edit) => edit.path === mainPath));
  }
  assert.notEqual(typeof projectRenameAt(project, mainPath, personUse + 1, "$Account"), "string");
  assert.match(String(projectRenameAt(project, mainPath, personUse + 1, "delete")), /reserved by JavaScript.*lexical bindings/u);
  assert.match(String(projectRenameAt(project, mainPath, personUse + 1, "Array")), /reserved Core binding/u);
  assert.match(String(projectRenameAt(project, mainPath, personUse + 1, "eval")), /unavailable in VelarScript/u);
  assert.match(String(projectRenameAt(project, mainPath, personUse + 1, "__velarRoot")), /reserved compiler prefix/u);

  const importedUser = mainSource.indexOf("User as");
  const exportedRename = projectRenameAt(project, mainPath, importedUser + 1, "Member");
  assert.notEqual(typeof exportedRename, "string");
  if (typeof exportedRename !== "string") {
    assert.ok(exportedRename.edits.some((edit) => edit.path === modelsPath));
    assert.ok(exportedRename.edits.some((edit) => edit.path === mainPath && edit.span.start === importedUser));
    assert.ok(!exportedRename.edits.some((edit) => edit.path === mainPath && mainSource.slice(edit.span.start, edit.span.end) === "Person"));
  }

  const references = projectReferencesAt(project, modelsPath, (await readFile(modelsPath, "utf8")).indexOf("greet") + 1, true);
  assert.equal(references.filter((item) => item.path === mainPath).length, 2);
  assert.equal(projectRenameAt(project, modelsPath, (await readFile(modelsPath, "utf8")).indexOf("greet") + 1, "User"), "The new name collides with another declaration");
  assert.deepEqual(projectSignatureAt(project, mainPath, mainSource.indexOf("greet(ada)") + "greet(".length), {
    label: "greet(user: User) -> string",
    activeParameter: 0,
  });
  const ordinaryCompletions = projectCompletionsAt(project, mainPath, mainSource.indexOf("const label"));
  assert.ok(ordinaryCompletions.some((item) => item.label === "Person" && item.kind === "import" && item.detail === "Person"));
  assert.ok(ordinaryCompletions.some((item) => item.label === "greet" && item.kind === "import" && /\(user: Person\) -> string/u.test(item.detail)));
  assert.ok(ordinaryCompletions.some((item) => item.label === "ada" && item.kind === "variable" && item.detail === "Person"));
  assert.ok(!ordinaryCompletions.some((item) => item.label === "label"), "the binding being declared must not complete itself");
  assert.deepEqual(projectCompletionsAt(project, mainPath, personUse + "Person.".length), [
    { label: "is", detail: "(value: unknown) -> bool", kind: "method" },
    { label: "parse", detail: "(value: unknown) -> User", kind: "method" },
    { label: "from", detail: "(source: unknown, overrides: unknown = default) -> User", kind: "method" },
  ]);
  const adaMember = mainSource.indexOf("ada.name") + "ada.".length;
  assert.deepEqual(projectCompletionsAt(project, mainPath, adaMember), [
    { label: "name", detail: "string", kind: "field" },
  ]);
  const userField = (await readFile(modelsPath, "utf8")).indexOf("name: string");
  assert.notEqual(typeof projectRenameAt(project, modelsPath, userField + 1, "delete"), "string");
  assert.notEqual(typeof projectRenameAt(project, modelsPath, userField + 1, "invert"), "string");
  assert.notEqual(typeof projectRenameAt(project, modelsPath, userField + 1, "$field"), "string");
  assert.match(String(projectRenameAt(project, modelsPath, userField + 1, "eval")), /unavailable in VelarScript/u);
  assert.match(String(projectRenameAt(project, modelsPath, userField + 1, "prototype")), /prototype manipulation/u);
  assert.deepEqual(projectDefinitionAt(project, mainPath, adaMember + 1), {
    path: modelsPath,
    span: { start: userField, end: userField + "name".length },
  });
  const parsedMember = mainSource.indexOf("}).name") + "}).".length;
  assert.deepEqual(projectCompletionsAt(project, mainPath, parsedMember), [
    { label: "name", detail: "string", kind: "field" },
  ]);
  const parsedExpression = projectExpressionAt(project, mainPath, parsedMember + 1);
  assert.equal(parsedExpression?.type, "string");
  assert.equal(parsedExpression?.memberName, "name");
  assert.equal(parsedExpression?.ownerType, "Person");
  assert.ok(parsedExpression?.members.some((member) => member.name === "size" && member.kind === "field" && member.type === "number"));
  assert.ok(parsedExpression?.members.some((member) => member.name === "trim" && member.kind === "method" && member.type === "() -> string"));
  assert.ok(parsedExpression?.members.some((member) => member.name === "slice" && member.kind === "method"));
  assert.deepEqual(projectDefinitionAt(project, mainPath, parsedMember + 1), {
    path: modelsPath,
    span: { start: userField, end: userField + "name".length },
  });
  const modelsSource = await readFile(modelsPath, "utf8");
  const sampleKey = modelsSource.indexOf("{name: \"Sample\"") + 1;
  assert.equal(projectCompletionContextAt(project, modelsPath, sampleKey), "object-field");
  assert.deepEqual(projectCompletionsAt(project, modelsPath, sampleKey), [
    { label: "name", detail: "string", kind: "field" },
  ]);
  assert.equal(projectCompletionContextAt(project, modelsPath, sampleKey + "name: ".length), "ordinary");
  const memberReferences = projectReferencesAt(project, modelsPath, userField + 1, true);
  assert.equal(memberReferences.length, 12);
  assert.ok(memberReferences.every((location) => project.modules
    .find((module) => module.inputPath === location.path)?.result.source.text.slice(location.span.start, location.span.end) === "name"));
  assert.deepEqual(projectDefinitionAt(project, modelsPath, modelsSource.indexOf("{name: \"Sample\"") + 2), {
    path: modelsPath,
    span: { start: userField, end: userField + "name".length },
  });
  assert.deepEqual(projectDefinitionAt(project, modelsPath, modelsSource.indexOf("{name: sampleName") + 2), {
    path: modelsPath,
    span: { start: userField, end: userField + "name".length },
  });
  const sliceCall = mainSource.indexOf(".slice(0, 2)") + ".slice(0, ".length;
  assert.deepEqual(projectSignatureAt(project, mainPath, sliceCall), {
    label: "slice(start: number = default, end: number = default) -> List<number>",
    activeParameter: 1,
  });
  assert.equal(projectExpressionAt(project, mainPath, mainSource.indexOf(".slice") + 2)?.type,
    "(start: number = default, end: number = default) -> List<number>");
  assert.equal(projectExpressionAt(project, mainPath, mainSource.indexOf(".slice") + 2)?.callable, true);
  const preparedFieldRename = projectPrepareRenameAt(project, modelsPath, modelsSource.indexOf("{name}\n") + 2);
  assert.equal(preparedFieldRename?.placeholder, "name");
  const fieldRename = projectRenameAt(project, modelsPath, userField + 1, "fullName");
  assert.notEqual(typeof fieldRename, "string");
  if (typeof fieldRename !== "string") {
    assert.equal(fieldRename.edits.length, 12);
    assert.equal(fieldRename.edits.filter((edit) => edit.replacement === "fullName: name").length, 2);
    const editsByPath = new Map<string, typeof fieldRename.edits[number][]>();
    for (const edit of fieldRename.edits) {
      const edits = editsByPath.get(edit.path) ?? [];
      edits.push(edit);
      editsByPath.set(edit.path, edits);
    }
    for (const [editPath, edits] of editsByPath) {
      let updated = await readFile(editPath, "utf8");
      for (const edit of [...edits].sort((left, right) => right.span.start - left.span.start)) {
        updated = `${updated.slice(0, edit.span.start)}${edit.replacement ?? "fullName"}${updated.slice(edit.span.end)}`;
      }
      await writeFile(editPath, updated, "utf8");
    }
    const renamedProject = await compileProject(mainPath);
    assert.deepEqual(renamedProject.failures, []);
    assert.deepEqual(renamedProject.modules.flatMap((module) => module.result.diagnostics), []);
  }
});

test("project sessions reuse unaffected modules and invalidate reverse dependencies", async () => {
  const directory = await makeTemporaryDirectory("velar-session-");
  await writeFile(join(directory, "velar.json"), JSON.stringify({ formatVersion: 2, entry: "main.vel", outDir: "dist", extensions: [] }), "utf8");
  const storePath = join(directory, "store.vel");
  const mainPath = join(directory, "main.vel");
  const otherPath = join(directory, "other.vel");
  await writeFile(storePath, "export const value = 1\n", "utf8");
  await writeFile(mainPath, "import {value} from \"./store.vel\"\nprint(value)\n", "utf8");
  await writeFile(otherPath, "export const untouched = 2\n", "utf8");

  const sessions = new VelarProjectSessions();
  const first = await sessions.snapshot(mainPath);
  assert.equal(first.activity.strategy, "refresh");
  assert.equal(first.activity.workspaceScans, 1);
  assert.equal(first.activity.filesRead, 3);
  assert.equal(first.activity.projectReused, false);
  assert.deepEqual(first.project.stats, {
    moduleCount: 3,
    compiledModules: 3,
    reusedModules: 0,
    affectedModules: 3,
    durationMs: first.project.stats.durationMs,
  });
  const second = await sessions.snapshot(mainPath);
  assert.equal(second.project, first.project);
  assert.deepEqual(second.activity, {
    strategy: "refresh",
    workspaceScans: 1,
    filesRead: 3,
    projectReused: true,
  });
  const firstOther = first.project.modules.find((module) => module.inputPath === otherPath)?.result;
  const firstMain = first.project.modules.find((module) => module.inputPath === mainPath)?.result;
  const third = await sessions.update(
    mainPath,
    new Set([storePath]),
    new Map([[storePath, "export const value = 3\n"]]),
  );
  assert.deepEqual([...third.changedPaths], [storePath]);
  assert.deepEqual(third.activity, {
    strategy: "known-changes",
    workspaceScans: 0,
    filesRead: 0,
    projectReused: false,
  });
  assert.equal(third.project.modules.find((module) => module.inputPath === otherPath)?.result, firstOther);
  assert.notEqual(third.project.modules.find((module) => module.inputPath === mainPath)?.result, firstMain);
  assert.equal(third.project.stats.compiledModules, 2);
  assert.equal(third.project.stats.reusedModules, 1);
  assert.equal(third.project.stats.affectedModules, 2);

  const unchanged = await sessions.update(mainPath, new Set(), new Map([[storePath, "export const value = 3\n"]]));
  assert.equal(unchanged.project, third.project);
  assert.deepEqual(unchanged.activity, {
    strategy: "known-changes",
    workspaceScans: 0,
    filesRead: 0,
    projectReused: true,
  });

  await unlink(storePath);
  const missing = await sessions.update(mainPath, new Set([storePath]));
  // MOD-I5 + MOD-U5: the missing module is a positional diagnostic on the
  // import statement that asked for it, in owned words.
  assert.ok(missing.project.modules.find((module) => module.inputPath === mainPath)?.result.diagnostics
    .some((item) => item.code === "VEL6001" && /does not exist/u.test(item.message)), JSON.stringify(missing.project.failures));
  assert.equal(missing.activity.workspaceScans, 0);
  assert.equal(missing.activity.filesRead, 1);
  assert.equal(missing.project.modules.find((module) => module.inputPath === otherPath)?.result, firstOther);
  assert.equal(missing.project.modules.some((module) => module.inputPath === storePath), false);

  await writeFile(storePath, "export const value = 4\n", "utf8");
  const restored = await sessions.update(mainPath, new Set([storePath]));
  assert.deepEqual(restored.project.failures, []);
  assert.deepEqual(restored.project.modules.flatMap((module) => module.result.diagnostics), []);
  assert.equal(restored.project.modules.find((module) => module.inputPath === otherPath)?.result, firstOther);
  assert.match(restored.project.modules.find((module) => module.inputPath === storePath)?.result.code ?? "", /const value = 4/u);
});

test("project sessions keep the manifest entry stable across multiple documents", async () => {
  const directory = await makeTemporaryDirectory("velar-session-documents-");
  const manifestPath = join(directory, "velar.json");
  const mainPath = join(directory, "main.vel");
  const featurePath = join(directory, "feature.vel");
  await writeFile(manifestPath, JSON.stringify({ formatVersion: 2, entry: "main.vel", extensions: [] }), "utf8");
  await writeFile(mainPath, "import {value} from \"./feature.vel\"\nprint(value)\n", "utf8");
  await writeFile(featurePath, "export const value = 1\n", "utf8");

  const sessions = new VelarProjectSessions();
  const main = await sessions.snapshot(mainPath);
  const feature = await sessions.snapshot(featurePath);
  assert.equal(main.config.entryPath, mainPath);
  assert.equal(feature.config.entryPath, mainPath);
  assert.equal(feature.project, main.project);
  assert.equal(feature.activity.projectReused, true);
});

test("project sessions invalidate safe JavaScript imports when declaration graphs change", async () => {
  const directory = await makeTemporaryDirectory("velar-session-dts-");
  const packageRoot = join(directory, "node_modules", "session-sdk");
  await mkdir(packageRoot, { recursive: true });
  await writeFile(join(directory, "velar.json"), JSON.stringify({ formatVersion: 2, entry: "main.vel", outDir: "dist", extensions: [] }), "utf8");
  await writeFile(join(packageRoot, "package.json"), JSON.stringify({
    name: "session-sdk",
    type: "module",
    exports: "./index.js",
    types: "./index.d.ts",
  }), "utf8");
  await writeFile(join(packageRoot, "index.js"), "export const value = 'ready'\n", "utf8");
  const declarationPath = join(packageRoot, "index.d.ts");
  await writeFile(declarationPath, "export declare const value: string;\n", "utf8");
  const resolvedDeclarationPath = await realpath(declarationPath);
  const mainPath = join(directory, "main.vel");
  const otherPath = join(directory, "other.vel");
  await writeFile(mainPath, "import js {value} from \"session-sdk\"\nconst label: string = value\n", "utf8");
  await writeFile(otherPath, "export const untouched = 1\n", "utf8");

  const sessions = new VelarProjectSessions();
  const first = await sessions.snapshot(mainPath);
  assert.deepEqual(first.project.failures, []);
  assert.deepEqual(first.project.modules.flatMap((module) => module.result.diagnostics), []);
  assert.equal(first.project.externalTypeDependencies.get(resolvedDeclarationPath)?.has(mainPath), true);
  const firstOther = first.project.modules.find((module) => module.inputPath === otherPath)?.result;

  await writeFile(declarationPath, "export declare const value: number;\n", "utf8");
  const changed = await sessions.snapshot(mainPath);
  assert.deepEqual([...changed.changedPaths], [resolvedDeclarationPath]);
  assert.ok(changed.project.modules.find((module) => module.inputPath === mainPath)?.result.diagnostics
    .some((item) => /Cannot assign number to string/u.test(item.message)));
  assert.equal(changed.project.modules.find((module) => module.inputPath === otherPath)?.result, firstOther);
  assert.equal(changed.project.stats.compiledModules, 1);
  assert.equal(changed.project.stats.reusedModules, 1);
});

test("project sessions surface invalid manifests instead of silently compiling standalone", async () => {
  const directory = await makeTemporaryDirectory("velar-session-config-");
  const mainPath = join(directory, "main.vel");
  await writeFile(mainPath, "const value = 1\n", "utf8");
  await writeFile(join(directory, "velar.json"), JSON.stringify({ formatVersion: 1, entry: "main.vel", extensions: [] }), "utf8");
  await assert.rejects(new VelarProjectSessions().snapshot(mainPath), /unsupported formatVersion 1/u);
});

test("project sessions key reuse by the exact manifest identity", async () => {
  const directory = await makeTemporaryDirectory("velar-session-manifest-");
  const mainPath = join(directory, "main.vel");
  const manifestPath = join(directory, "velar.json");
  const manifest = { formatVersion: 2, entry: "main.vel", outDir: "dist", extensions: [] };
  await writeFile(mainPath, "const value = 1\n", "utf8");
  await writeFile(manifestPath, JSON.stringify(manifest), "utf8");
  const sessions = new VelarProjectSessions();
  const first = await sessions.snapshot(mainPath);
  const reused = await sessions.snapshot(mainPath);
  assert.equal(reused.project, first.project);

  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  const refreshed = await sessions.snapshot(mainPath);
  assert.notEqual(refreshed.project, first.project);
  assert.notEqual(refreshed.config.manifestIdentity, first.config.manifestIdentity);
  assert.equal(refreshed.project.stats.compiledModules, 1);
});

test("project sessions keep nested manifest sources under their nearest owner", async () => {
  const directory = await makeTemporaryDirectory("velar-session-nested-");
  const mainPath = join(directory, "main.vel");
  const nestedRoot = join(directory, "nested");
  const nestedPath = join(nestedRoot, "main.vel");
  await mkdir(nestedRoot, { recursive: true });
  await writeFile(join(directory, "velar.json"), JSON.stringify({ formatVersion: 2, entry: "main.vel", extensions: [] }), "utf8");
  await writeFile(mainPath, "export const outer = 1\n", "utf8");
  await writeFile(join(nestedRoot, "velar.json"), JSON.stringify({ formatVersion: 2, entry: "main.vel", extensions: [] }), "utf8");
  await writeFile(nestedPath, "export const nested = 1\n", "utf8");

  const sessions = new VelarProjectSessions();
  const outer = await sessions.snapshot(mainPath);
  assert.equal(sessions.rootFor(mainPath), directory);
  assert.equal(sessions.rootFor(nestedPath), null);
  assert.deepEqual(outer.project.modules.map((module) => module.inputPath), [mainPath]);
  const ignored = await sessions.update(
    mainPath,
    new Set([nestedPath]),
    new Map([[nestedPath, "export const nested = 2\n"]]),
  );
  assert.equal(ignored.project, outer.project);
  assert.deepEqual(ignored.changedPaths, new Set());
  assert.deepEqual(ignored.activity, { strategy: "known-changes", workspaceScans: 0, filesRead: 0, projectReused: true });

  const nested = await sessions.snapshot(nestedPath, new Map([[nestedPath, "export const nested = 2\n"]]));
  assert.equal(sessions.rootFor(nestedPath), nestedRoot);
  assert.deepEqual(nested.project.modules.map((module) => module.inputPath), [nestedPath]);
  assert.equal(nested.project.modules[0]?.result.source.text, "export const nested = 2\n");
});
