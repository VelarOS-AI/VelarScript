import assert from "node:assert/strict";
import test, { after } from "node:test";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { describeType } from "@velarscript/compiler";
import { VELAR_NARROWING_MODULE } from "@velarscript/compiler/extension";
import { projectCompletionsAt, projectCompletionContextAt, projectDefinitionAt, projectMemberSymbolAt, projectReferencesAt, projectRenameAt, projectSignatureAt, projectSymbolAt } from "../../packages/cli/src/project-semantic.ts";
import { makeTemporaryDirectory, removeTemporaryDirectories } from "../support/temporary-directory.ts";
import { compileProject } from "../support/compiler-suite.ts";

after(removeTemporaryDirectories);

test("project builds enforce imported VelarScript signatures", async () => {
  const directory = await makeTemporaryDirectory("velar-module-types-");
  const library = join(directory, "models.vel");
  const entry = join(directory, "main.vel");
  await writeFile(library, `
export type User:
    name: string

export def greet(user: User) -> string:
    return user.name
`.trimStart(), "utf8");
  await writeFile(entry, `
import {User as Person, greet} from "./models.vel"
const person: Person = {name: 42}
print(greet(person))
`.trimStart(), "utf8");

  const execution = spawnSync(process.execPath, ["packages/cli/src/cli.ts", "check", entry], { cwd: process.cwd(), encoding: "utf8" });
  assert.equal(execution.status, 1);
  assert.match(execution.stderr, /Cannot assign number to string/);
});

test("module interfaces keep live imports guarded without call-effect metadata", async () => {
  const directory = await makeTemporaryDirectory("velar-live-imports-");
  const storePath = join(directory, "store.vel");
  const entryPath = join(directory, "main.vel");
  const namespacePath = join(directory, "namespace.vel");
  const reactiveStorePath = join(directory, "reactive-store.vel");
  const reactiveEntryPath = join(directory, "reactive-main.vel");
  await writeFile(storePath, `
export type User:
    name: string

export let current: User? = {name: "Ada"}
export const fixed: User? = {name: "Lin"}

export def clear():
    current = null
`.trimStart(), "utf8");
  await writeFile(entryPath, `
import {current, fixed, clear} from "./store.vel"

def live() -> string:
    assert current != null
    clear()
    return current.name

def stable() -> string:
    assert fixed != null
    clear()
    return fixed.name
`.trimStart(), "utf8");
  await writeFile(namespacePath, `
import * as store from "./store.vel"
store.current = null
`.trimStart(), "utf8");
  await writeFile(reactiveStorePath, `
export type User:
    name: string

export state current: User? = {name: "Mira"}

export def clear():
    current = null
`.trimStart(), "utf8");
  await writeFile(reactiveEntryPath, `
import {current, clear} from "./reactive-store.vel"

def live() -> string:
    assert current != null
    clear()
    return current.name
`.trimStart(), "utf8");

  // Live imports narrow like ordinary bindings. Calls keep the syntax
  // optimistic, and later reads revalidate the imported storage at runtime.
  const project = await compileProject(entryPath);
  assert.deepEqual(project.failures, []);
  const diagnostics = project.modules.flatMap((module) => module.result.diagnostics);
  assert.equal(diagnostics.filter((item) => /optional access/u.test(item.message)).length, 0);
  assert.ok((project.modules.find((module) => module.inputPath === entryPath)?.result.code ?? "").includes(VELAR_NARROWING_MODULE));
  const store = project.modules.find((module) => module.inputPath === storePath)?.result.moduleInterface;
  assert.equal(store?.mutableExports.has("current"), true);
  assert.equal(store?.mutableExports.has("fixed"), false);

  const namespace = await compileProject(namespacePath);
  assert.ok(namespace.failures.some((failure) => /exports live values; import them by name/u.test(failure.message)));
  assert.ok(namespace.modules.flatMap((module) => module.result.diagnostics)
    .some((item) => /Cannot assign to read-only field 'current'/u.test(item.message)));

  const reactive = await compileProject(reactiveEntryPath);
  assert.deepEqual(reactive.failures, []);
  assert.equal(reactive.modules.flatMap((module) => module.result.diagnostics)
    .filter((item) => /optional access/u.test(item.message)).length, 0);
  assert.ok((reactive.modules.find((module) => module.inputPath === reactiveEntryPath)?.result.code ?? "").includes(VELAR_NARROWING_MODULE));
});

test("component callback types cross module and editor boundaries", async () => {
  const directory = await makeTemporaryDirectory("velar-callback-props-");
  const domainPath = join(directory, "domain.vel");
  const itemPath = join(directory, "item.vel");
  const validPath = join(directory, "valid.vel");
  const invalidPath = join(directory, "invalid.vel");
  const childrenPath = join(directory, "children.vel");
  const svgPath = join(directory, "svg.vel");
  await writeFile(domainPath, `
export type ChooseHandler = (string) -> null
`.trimStart(), "utf8");
  await writeFile(itemPath, `
import {ChooseHandler} from "./domain.vel"

export component Item(label: string, onChoose: ChooseHandler):
    return <button type="button" on:click={() => onChoose(label)}>{label}</button>
`.trimStart(), "utf8");
  await writeFile(validPath, `
import {ChooseHandler as Handler} from "./domain.vel"
import {Item as Choice} from "./item.vel"
const choose: Handler = Handler.parse(label => null)
component App:
    return <Choice label="Velar" onChoose={choose} />
`.trimStart(), "utf8");
  await writeFile(invalidPath, `
import {Item} from "./item.vel"
def choose(value: number):
    return null
component App:
    return <Item label="Velar" onChoose={choose} />
`.trimStart(), "utf8");
  const childrenSource = `
component Wrapper(children: WebNode):
    return <section>{children}</section>
component App:
    return <Wrapper><p>Content</p></Wrapper>
`.trimStart();
  await writeFile(childrenPath, childrenSource, "utf8");
  const svgSource = `
component Chart:
    return <svg aria-label="Traffic" viewBox="0 0 100 40"><rect x="4" y="4" width="20" height="30" /><foreignObject x="30" y="4" width="60" height="30"><div>Summary</div></foreignObject></svg>
`.trimStart();
  await writeFile(svgPath, svgSource, "utf8");

  const valid = await compileProject(validPath);
  assert.deepEqual(valid.failures, []);
  assert.deepEqual(valid.modules.flatMap((module) => module.result.diagnostics), []);
  const invalid = await compileProject(invalidPath);
  assert.ok(invalid.modules.flatMap((module) => module.result.diagnostics).some((item) => /Cannot assign \(value: number\) -> null to \(string\) -> null/u.test(item.message)));
  const childrenProject = await compileProject(childrenPath);
  assert.deepEqual(childrenProject.modules.flatMap((module) => module.result.diagnostics), []);
  const svgProject = await compileProject(svgPath);
  assert.deepEqual(svgProject.modules.flatMap((module) => module.result.diagnostics), []);
  assert.equal(projectRenameAt(childrenProject, childrenPath, childrenSource.indexOf("children: WebNode") + 1, "content"),
    "The JSX children prop cannot be renamed");
  const itemSource = await readFile(itemPath, "utf8");
  const validSource = await readFile(validPath, "utf8");
  const labelDeclaration = itemSource.indexOf("label: string");
  const labelAttribute = validSource.indexOf("label=\"Velar\"");
  const validModule = valid.modules.find((module) => module.inputPath === validPath)!;
  assert.deepEqual(validModule.result.semanticIndex.memberReferences.find((reference) => reference.span.start === labelAttribute), {
    name: "label",
    path: validPath,
    span: { start: labelAttribute, end: labelAttribute + "label".length },
    ownerType: "Choice",
    ownerKind: "extension",
    ownerIdentity: "@velarscript/web:component:Choice",
    ownerSymbolKind: "extension:function:web-component",
    syntax: "extension-property",
    shorthand: false,
  });
  assert.equal(projectCompletionContextAt(valid, validPath, labelAttribute), "extension:@velarscript/web:component-attribute");
  const propCompletions = projectCompletionsAt(valid, validPath, labelAttribute);
  assert.ok(propCompletions.some((item) => item.label === "label" && item.detail === "string"));
  assert.ok(propCompletions.some((item) => item.label === "onChoose" && item.detail === "(string) -> null"));
  assert.ok(propCompletions.some((item) => item.label === "key"));
  assert.ok(propCompletions.some((item) => item.label === "look:color" && item.detail === "inline checked Look property"));
  assert.ok(propCompletions.some((item) => item.label === "style:color" && item.detail?.includes("high-priority inline Style")));
  assert.ok(!propCompletions.some((item) => item.label === "const"));
  const nativeAttribute = itemSource.indexOf("type=\"button\"");
  assert.equal(projectCompletionContextAt(valid, itemPath, nativeAttribute), "extension:@velarscript/web:native-attribute");
  const nativeCompletions = projectCompletionsAt(valid, itemPath, nativeAttribute);
  assert.ok(nativeCompletions.some((item) => item.label === "aria-label"));
  assert.ok(nativeCompletions.some((item) => item.label === "on:click"));
  assert.ok(nativeCompletions.some((item) => item.label === "look:display" && item.detail === "inline checked Look property"));
  assert.ok(nativeCompletions.some((item) => item.label === "style:display" && item.detail?.includes("prefer Look")));
  assert.ok(!nativeCompletions.some((item) => item.label === "while"));
  const componentTag = validSource.indexOf("<Choice") + "<Ch".length;
  assert.equal(projectCompletionContextAt(valid, validPath, componentTag), "extension:@velarscript/web:jsx-tag");
  const componentTags = projectCompletionsAt(valid, validPath, componentTag);
  assert.ok(componentTags.some((item) => item.label === "Choice" && item.detail?.startsWith("component ")));
  assert.deepEqual(componentTags.map((item) => item.label), ["Choice"]);
  assert.ok(!componentTags.some((item) => item.label === "while"));
  const nativeClosingTag = itemSource.indexOf("</button>") + "</bu".length;
  assert.equal(projectCompletionContextAt(valid, itemPath, nativeClosingTag), "extension:@velarscript/web:jsx-tag");
  assert.ok(projectCompletionsAt(valid, itemPath, nativeClosingTag).some((item) => item.label === "button"));
  const svgTag = svgSource.indexOf("<svg") + "<sv".length;
  assert.deepEqual(projectCompletionsAt(svgProject, svgPath, svgTag).map((item) => item.label), ["svg"]);
  const foreignObjectTag = svgSource.indexOf("<foreignObject") + "<foreignO".length;
  assert.deepEqual(projectCompletionsAt(svgProject, svgPath, foreignObjectTag).map((item) => item.label), ["foreignObject"]);
  const svgAttribute = svgSource.indexOf("viewBox");
  const svgCompletions = projectCompletionsAt(svgProject, svgPath, svgAttribute);
  assert.ok(svgCompletions.some((item) => item.label === "viewBox" && item.detail === "native SVG attribute"));
  assert.ok(svgCompletions.some((item) => item.label === "stroke-width"));
  assert.ok(svgCompletions.slice(0, 160).some((item) => item.label === "viewBox"), "native SVG attributes must survive bounded editor result sets");
  assert.deepEqual(projectDefinitionAt(valid, validPath, labelAttribute + 1), {
    path: itemPath,
    span: { start: labelDeclaration, end: labelDeclaration + "label".length },
  });
  assert.equal(projectMemberSymbolAt(valid, validPath, labelAttribute + 1)?.type, "string");
  const labelReferences = projectReferencesAt(valid, itemPath, labelDeclaration + 1, true);
  assert.equal(labelReferences.length, 4);
  assert.equal(projectRenameAt(valid, itemPath, labelDeclaration + 1, "onChoose"), "The new name collides with another declaration");
  const labelRename = projectRenameAt(valid, validPath, labelAttribute + 1, "text");
  assert.notEqual(typeof labelRename, "string");
  if (typeof labelRename !== "string") {
    assert.equal(labelRename.edits.length, 4);
    const editsByPath = new Map<string, typeof labelRename.edits[number][]>();
    for (const edit of labelRename.edits) {
      const edits = editsByPath.get(edit.path) ?? [];
      edits.push(edit);
      editsByPath.set(edit.path, edits);
    }
    for (const [editPath, edits] of editsByPath) {
      let updated = await readFile(editPath, "utf8");
      for (const edit of [...edits].sort((left, right) => right.span.start - left.span.start)) {
        updated = `${updated.slice(0, edit.span.start)}${edit.replacement ?? "text"}${updated.slice(edit.span.end)}`;
      }
      await writeFile(editPath, updated, "utf8");
    }
    const renamed = await compileProject(validPath);
    assert.deepEqual(renamed.failures, []);
    assert.deepEqual(renamed.modules.flatMap((module) => module.result.diagnostics), []);
  }
});

test("project builds preserve enum identities and aliases across modules", async () => {
  const directory = await makeTemporaryDirectory("velar-enum-module-");
  const library = join(directory, "workflow.vel");
  const otherLibrary = join(directory, "other-workflow.vel");
  const store = join(directory, "store.vel");
  const entry = join(directory, "main.vel");
  await writeFile(library, `
export enum TaskStatus:
    todo
    doing
    done

export def advance(status: TaskStatus) -> TaskStatus:
    match status:
        case TaskStatus.todo:
            return TaskStatus.doing
        case TaskStatus.doing, TaskStatus.done:
            return TaskStatus.done
`.trimStart(), "utf8");
  await writeFile(store, `
import {TaskStatus} from "./workflow.vel"
export state current: TaskStatus = TaskStatus.todo
`.trimStart(), "utf8");
  await writeFile(otherLibrary, `
export enum TaskStatus:
    todo
    doing
    done
`.trimStart(), "utf8");
  await writeFile(entry, `
import {TaskStatus as Status, advance} from "./workflow.vel"
import {current} from "./store.vel"

const initial: Status = Status.todo
const next: Status = advance(current)
const parsed: Status = Status.parse("todo")
print(next)
`.trimStart(), "utf8");

  const valid = await compileProject(entry);
  assert.deepEqual(valid.failures, []);
  assert.deepEqual(valid.modules.flatMap((module) => module.result.diagnostics), []);
  assert.equal(valid.modules.find((module) => module.inputPath === entry)?.result.semanticIndex.symbols.find((symbol) => symbol.name === "next")?.type, "Status");
  const validSource = await readFile(entry, "utf8");
  const enumMember = validSource.indexOf("Status.todo") + "Status.".length;
  const definition = projectDefinitionAt(valid, entry, enumMember);
  assert.equal(definition?.path, library);
  assert.equal((await readFile(library, "utf8")).slice(definition?.span.start, definition?.span.end), "todo");
  assert.equal(projectSymbolAt(valid, entry, enumMember)?.kind, "enum-member");
  assert.deepEqual(projectCompletionsAt(valid, entry, enumMember).map((item) => item.label), ["todo", "doing", "done", "is", "parse", "values"]);
  const parseCall = validSource.indexOf("Status.parse(") + "Status.parse(".length;
  assert.deepEqual(projectSignatureAt(valid, entry, parseCall), {
    label: "parse(value: unknown) -> Status",
    activeParameter: 0,
  });
  const memberReferences = projectReferencesAt(valid, entry, enumMember, true);
  assert.equal(memberReferences.length, 4);
  assert.ok(memberReferences.every((location) => valid.modules
    .find((module) => module.inputPath === location.path)?.result.source.text.slice(location.span.start, location.span.end) === "todo"));
  const memberRename = projectRenameAt(valid, entry, enumMember, "pending");
  assert.notEqual(typeof memberRename, "string");
  if (typeof memberRename !== "string") {
    assert.equal(memberRename.placeholder, "todo");
    assert.deepEqual(memberRename.edits, memberReferences);
  }
  assert.equal(projectRenameAt(valid, entry, enumMember, "doing"), "The new name collides with another declaration");

  await writeFile(entry, `
import {TaskStatus as Status, advance} from "./workflow.vel"
const current: Status = "todo"
print(advance(current))
`.trimStart(), "utf8");
  const invalid = await compileProject(entry);
  assert.ok(invalid.modules.some((module) => module.inputPath === entry
    && module.result.diagnostics.some((item) => /Cannot assign string to Status/u.test(item.message))));

  await writeFile(entry, `
import {TaskStatus as WorkflowStatus} from "./workflow.vel"
import {TaskStatus as OtherStatus} from "./other-workflow.vel"
const current: WorkflowStatus = OtherStatus.todo
`.trimStart(), "utf8");
  const foreignIdentity = await compileProject(entry);
  assert.ok(foreignIdentity.modules.some((module) => module.inputPath === entry
    && module.result.diagnostics.some((item) => /Cannot assign OtherStatus\.todo to WorkflowStatus/u.test(item.message))));
});

test("project interfaces use analyzed export types through dependency chains and cycles", async () => {
  const directory = await makeTemporaryDirectory("velar-analyzed-interface-");
  const leaf = join(directory, "leaf.vel");
  const middle = join(directory, "middle.vel");
  const entry = join(directory, "main.vel");
  await writeFile(leaf, "export const value = 42\n\nexport def answer():\n    return 42\n", "utf8");
  await writeFile(middle, 'import {value as source, answer} from "./leaf.vel"\nexport const forwarded = source\nexport def forwardedAnswer():\n    return answer()\n', "utf8");
  await writeFile(entry, 'import {forwarded, forwardedAnswer} from "./middle.vel"\nconst invalid: string = forwarded\nconst answer: number = forwardedAnswer()\n', "utf8");

  const project = await compileProject(entry);
  assert.deepEqual(project.failures, []);
  assert.equal(describeType(project.modules.find((module) => module.inputPath === middle)!.result.moduleInterface.exports.get("forwarded")!), "number");
  assert.equal(describeType(project.modules.find((module) => module.inputPath === middle)!.result.moduleInterface.exports.get("forwardedAnswer")!), "() -> number");
  assert.ok(project.modules.find((module) => module.inputPath === entry)!.result.diagnostics
    .some((item) => /Cannot assign number to string/u.test(item.message)));

  const first = join(directory, "cycle-a.vel");
  const second = join(directory, "cycle-b.vel");
  await writeFile(first, 'import {value} from "./cycle-b.vel"\nexport const forwarded = value\n', "utf8");
  await writeFile(second, 'import {forwarded} from "./cycle-a.vel"\nexport const value: number = 1\nexport def read() -> number:\n    return forwarded\n', "utf8");
  const cyclic = await compileProject(first);
  assert.deepEqual(cyclic.failures, []);
  assert.deepEqual(cyclic.modules.flatMap((module) => module.result.diagnostics), []);
  assert.equal(describeType(cyclic.modules.find((module) => module.inputPath === first)!.result.moduleInterface.exports.get("forwarded")!), "number");

  await writeFile(first, 'import {seed} from "./cycle-b.vel"\nexport def forwarded():\n    return seed()\n', "utf8");
  await writeFile(second, 'import {forwarded} from "./cycle-a.vel"\nexport def seed():\n    return 42\n', "utf8");
  const inferredCycle = await compileProject(first);
  assert.deepEqual(inferredCycle.failures, []);
  assert.deepEqual(inferredCycle.modules.flatMap((module) => module.result.diagnostics), []);
  assert.equal(describeType(inferredCycle.modules.find((module) => module.inputPath === first)!.result.moduleInterface.exports.get("forwarded")!), "() -> number");

  await writeFile(first, 'import {second} from "./cycle-b.vel"\nexport def first():\n    return second()\n', "utf8");
  await writeFile(second, 'import {first} from "./cycle-a.vel"\nexport def second():\n    return first()\n', "utf8");
  const unresolvedCycle = await compileProject(first);
  assert.deepEqual(unresolvedCycle.failures, []);
  assert.deepEqual(
    unresolvedCycle.modules.flatMap((module) => module.result.diagnostics).map((item) => item.code),
    ["VEL4025", "VEL4025"],
  );
});

test("readonly record contracts and hidden nested types survive module re-export chains", async () => {
  const directory = await makeTemporaryDirectory("velar-readonly-interface-");
  const model = join(directory, "model.vel");
  const api = join(directory, "api.vel");
  const entry = join(directory, "main.vel");
  await writeFile(model, `
export type Meta:
    label: string

export type Profile:
    readonly id: string
    meta: readonly Meta

export def observe(profile: readonly Profile) -> readonly Profile:
    return profile

export def mutate(profile: Profile):
    profile.meta = {label: "changed"}
`.trimStart(), "utf8");
  await writeFile(api, 'export {Profile as UserProfile, observe as inspect, mutate} from "./model.vel"\n', "utf8");
  await writeFile(entry, `
import {UserProfile as Profile, inspect, mutate} from "./api.vel"

const mutable: Profile = {id: "p", meta: {label: "A"}}
const viewed: readonly Profile = inspect(mutable)
print(viewed.meta.label)
mutate(viewed)
viewed.meta.label = "x"
mutable.id = "changed"
`.trimStart(), "utf8");

  const project = await compileProject(entry);
  assert.deepEqual(project.failures, []);
  const modelInterface = project.modules.find((module) => module.inputPath === model)!.result.moduleInterface;
  assert.equal(describeType(modelInterface.exports.get("observe")!), "(profile: readonly Profile) -> readonly Profile");
  assert.deepEqual([...modelInterface.namedTypeReadonlyFields?.get("Profile") ?? []], ["id"]);
  const diagnostics = project.modules.find((module) => module.inputPath === entry)!.result.diagnostics;
  assert.deepEqual(diagnostics.map((item) => item.message), [
    "Cannot assign readonly Profile to Profile; the receiving contract permits replacing slots protected by this readonly view — declare the receiving parameter as 'readonly Profile'",
    "Cannot assign through readonly Meta; it is a read-only view",
    "Cannot assign to read-only field 'id'",
  ]);
});

test("module namespace slots are readonly and exported values keep their contracts", async () => {
  const directory = await makeTemporaryDirectory("velar-readonly-namespace-");
  const model = join(directory, "model.vel");
  const entry = join(directory, "main.vel");
  await writeFile(model, `
export type Settings:
    label: string

export const settings: Settings = {label: "Ready"}
`.trimStart(), "utf8");
  await writeFile(entry, `
import {settings} from "./model.vel"
import * as model from "./model.vel"

settings.label = "named"
model.settings.label = "namespace"
model.settings = {label: "blocked"}

const loaded = await import("./model.vel")
loaded.settings.label = "dynamic"
loaded.settings = {label: "blocked"}
`.trimStart(), "utf8");

  const project = await compileProject(entry);
  assert.deepEqual(project.failures, []);
  assert.deepEqual(
    project.modules.find((module) => module.inputPath === entry)!.result.diagnostics.map((item) => item.message),
    [
        "Cannot assign to read-only field 'settings'",
        "Cannot assign to read-only field 'settings'",
    ],
  );
});
