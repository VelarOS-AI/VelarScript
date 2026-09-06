import assert from "node:assert/strict";
import test, { after } from "node:test";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { projectCompletionsAt, projectDefinitionAt, projectReferencesAt, projectRenameAt } from "../../../packages/cli/src/project-semantic.ts";
import { makeTemporaryDirectory, removeTemporaryDirectories } from "../../support/temporary-directory.ts";
import { executeModule } from "../../support/execute-module.ts";
import { compile, compileProject } from "../../support/compiler-suite.ts";

after(removeTemporaryDirectories);

test("class member names cannot reopen JavaScript constructor or prototype behavior", () => {
  for (const source of [
    `class Invalid:\n    const __proto__: string = "value"\n`,
    `class Invalid:\n    static const prototype: string = "value"\n`,
    `class Invalid:\n    def constructor() -> string:\n        return "value"\n`,
    `class Invalid:\n    get constructor() -> string:\n        return "value"\n`,
    `class Invalid:\n    private def constructor() -> string:\n        return "value"\n`,
    `extern module "library":\n    export class Invalid:\n        static const prototype: string\n`,
  ]) {
    const result = compile(source);
    assert.ok(result.diagnostics.some((item) => item.code === "VEL4014"), JSON.stringify(result.diagnostics));
    assert.equal(result.code, null);
  }

  const record = compile(`
type Metadata:
    constructor: string
    prototype: string
    __proto__: string

const value: Metadata = {constructor: "data", prototype: "data", "__proto__": "data"}
const {constructor, prototype, __proto__} = value
print(constructor + prototype + __proto__)
`.trimStart());
  assert.deepEqual(record.diagnostics, []);
  const execution = executeModule(record.code ?? "");
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, "datadatadata\n");
});

test("class getters expose native read-only derived properties with explicit inheritance", () => {
  const result = compile(`
abstract class Metric:
    abstract get label() -> string

class BaseMetric:
    const name: string

    constructor(name: string):
        self.name = name

    get label() -> string:
        return self.name

class Score extends BaseMetric:
    private const points: number

    constructor(name: string, points: number):
        super(name)
        self.points = points

    private static get internalUnit() -> string:
        return "pt"

    private get doubled() -> number:
        return self.points * 2

    override get label() -> string:
        return f"{super.label}:{self.doubled}"

    static get unit() -> string:
        return Score.internalUnit

    def same(other: Score) -> bool:
        return self.doubled == other.doubled

const metric: BaseMetric = Score("Velar", 21)
const score = Score("Velar", 21)
print(metric.label)
print(Score.unit)
print(score.same(Score("Velar", 21)))
`.trimStart());

  assert.deepEqual(result.diagnostics, []);
  assert.match(result.code ?? "", /get label\(\)/u);
  assert.match(result.code ?? "", /get #doubled\(\)/u);
  assert.match(result.code ?? "", /static get #internalUnit\(\)/u);
  assert.match(result.code ?? "", /static get unit\(\)/u);
  assert.match(result.code ?? "", /super\.label/u);
  const info = result.moduleInterface.classes.get("Score");
  assert.equal(info?.fields.get("label")?.mutable, false);
  assert.equal(info?.getters.has("label"), true);
  assert.equal(info?.staticGetters.has("unit"), true);
  assert.equal(info?.fields.has("doubled"), false);
  assert.equal(info?.staticFields.has("internalUnit"), false);
  const execution = executeModule(result.code ?? "");
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, "Velar:42\npt\ntrue\n");

  const invalid = compile(`
abstract class Contract:
    abstract get value() -> number

class Missing extends Contract:
    pass

class Wrong extends Contract:
    get value() -> number:
        return 1

class WrongType extends Contract:
    override get value() -> string:
        return "wrong"

class Mutable:
    let value: number = 1
    get value() -> number:
        return 2

class Secret:
    private get hidden() -> string:
        return "hidden"
    static get kind() -> string:
        return "secret"

const wrong = WrongType()
wrong.value = "changed"
const secret = Secret()
print(secret.hidden)
Secret.kind = "changed"
`.trimStart());
  assert.ok(invalid.diagnostics.some((item) => /must implement abstract method: value/u.test(item.message)));
  assert.ok(invalid.diagnostics.some((item) => /must use 'override'/u.test(item.message)));
  assert.ok(invalid.diagnostics.some((item) => /must keep the base result number/u.test(item.message)));
  assert.ok(invalid.diagnostics.some((item) => /conflicts with a field/u.test(item.message)));
  assert.ok(invalid.diagnostics.some((item) => /Cannot assign to getter 'value'/u.test(item.message)));
  assert.ok(invalid.diagnostics.some((item) => /is private to class 'Secret'/u.test(item.message)));
  assert.ok(invalid.diagnostics.some((item) => /Cannot assign to read-only static member 'kind'/u.test(item.message)));

  const asynchronous = compile("class AsyncValue:\n    async get value() -> number:\n        return 1\n");
  assert.ok(asynchronous.diagnostics.some((item) => /getter cannot be async/u.test(item.message)));
  const malformed = compile("class Broken:\n    get value(input: number):\n        return input\n");
  assert.ok(malformed.diagnostics.some((item) => item.code === "VEL2023" && /cannot accept parameters/u.test(item.message)));
  assert.ok(malformed.diagnostics.some((item) => item.code === "VEL2023" && /requires an explicit result type/u.test(item.message)));

  const propertyNames = compile(`
type Flags:
    get: bool

class Box:
    const get: string = "field"

class Label:
    def get() -> string:
        return "method"

const get: string = "binding"
const flags: Flags = {get: true}
print(get)
print(flags.get)
print(Box().get)
print(Label().get())
`.trimStart());
  assert.deepEqual(propertyNames.diagnostics, []);
});

test("private class members preserve native encapsulation without a visibility hierarchy", () => {
  const result = compile(`
class Vault:
    private const secret: string
    private static const category: string = "vault"
    private static const fullCategory: string = Vault.category + "-store"
    private const prefix: string = "token"
    private let reads: number = 0

    constructor(secret: string):
        self.secret = secret

    private def reveal(suffix: string) -> string:
        self.reads += 1
        return f"{self.prefix}:{self.secret}:{suffix}:{self.reads}"

    private static def label() -> string:
        return Vault.fullCategory

    private async def revealLater() -> string:
        return self.reveal("async")

    private static async def labelLater() -> string:
        return Vault.category

    def open(suffix: string) -> string:
        return self.reveal(suffix)

    def matches(other: Vault) -> bool:
        return self.secret == other.secret

    async def openLater() -> string:
        return self.revealLater()

    static def kind() -> string:
        return Vault.label()

    static async def kindLater() -> string:
        return Vault.labelLater()

const vault = Vault("safe")
print(vault.open("one"))
print(vault.open("two"))
print(Vault.kind())
print(await vault.openLater())
print(await Vault.kindLater())
print(vault.matches(Vault("safe")))
`.trimStart());

  assert.deepEqual(result.diagnostics, []);
  assert.match(result.code ?? "", /#secret;/u);
  assert.match(result.code ?? "", /#prefix;/u);
  // D44 rule 74: private instance methods are native private methods, not
  // per-instance arrow fields.
  assert.match(result.code ?? "", /#reveal\(suffix\) \{/u);
  assert.match(result.code ?? "", /static #category = "vault";/u);
  assert.match(result.code ?? "", /static #label\(\)/u);
  assert.match(result.code ?? "", /async #revealLater\(\) \{/u);
  assert.match(result.code ?? "", /static async #labelLater\(\)/u);
  assert.doesNotMatch(result.code ?? "", /this\.secret/u);
  const info = result.moduleInterface.classes.get("Vault");
  assert.equal(info?.fields.has("secret"), false);
  assert.equal(info?.fields.has("prefix"), false);
  assert.equal(info?.methods.has("reveal"), false);
  assert.equal(info?.staticFields.has("category"), false);
  assert.equal(info?.staticMethods.has("label"), false);
  assert.equal(info?.methods.has("open"), true);
  assert.equal(info?.staticMethods.has("kind"), true);
  const execution = executeModule(result.code ?? "");
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, "token:safe:one:1\ntoken:safe:two:2\nvault-store\ntoken:safe:async:3\nvault\ntrue\n");

  const inaccessible = compile(`
class Vault:
    private const secret: string
    private static const category: string = "vault"
    private let reads: number = 0

    constructor(secret: string):
        self.secret = secret

    private def reveal() -> string:
        return self.secret

const vault = Vault("safe")
print(vault.secret)
print(vault.reads)
print(vault.reveal())
print(Vault.category)
`.trimStart());
  assert.equal(inaccessible.diagnostics.filter((item) => /is private to class 'Vault'/u.test(item.message)).length, 4);

  const invalid = compile(`
abstract class Base:
    private abstract def hidden() -> string

class Child extends Base:
    private override def hidden() -> string:
        return "child"
`.trimStart());
  assert.ok(invalid.diagnostics.some((item) => /Private method 'hidden' cannot be abstract/u.test(item.message)));
  assert.ok(invalid.diagnostics.some((item) => /Private method 'hidden' cannot use 'override'/u.test(item.message)));

  const reserved = compile("const private = 'reserved'\n");
  assert.ok(reserved.diagnostics.length > 0);

  const memberNames = compile(`
type Flags:
    private: bool

enum Visibility:
    private
    public

class Label:
    def private() -> string:
        return "method"

class Box:
    const private: string = "field"

const flags: Flags = {private: true}
print(flags.private)
print(Visibility.private)
print(Label().private())
print(Box().private)
`.trimStart());
  assert.deepEqual(memberNames.diagnostics, []);
  const memberExecution = executeModule(memberNames.code ?? "");
  assert.equal(memberExecution.status, 0, String(memberExecution.stderr));
  assert.equal(memberExecution.stdout, "true\nprivate\nmethod\nfield\n");
});

test("private members stay inside their class across project and editor semantics", async () => {
  const directory = await makeTemporaryDirectory("velar-private-members-");
  const modelPath = join(directory, "model.vel");
  const mainPath = join(directory, "main.vel");
  const modelSource = `
export class Vault:
    private const secret: string
    private static const category: string = "vault"
    /// Tracks how often the secret was opened.
    private let reads: number = 0

    constructor(secret: string):
        self.secret = secret

    /// Produces the internal display value.
    private def reveal() -> string:
        self.reads += 1
        return f"{self.secret}:{self.reads}"

    def open() -> string:
        return self.reveal()

    static def kind() -> string:
        return Vault.category
`.trimStart();
  const mainSource = `
import {Vault} from "./model.vel"
const vault = Vault("safe")
print(vault.open())
print(Vault.kind())
`.trimStart();
  await writeFile(modelPath, modelSource, "utf8");
  await writeFile(mainPath, mainSource, "utf8");

  const project = await compileProject(mainPath);
  assert.deepEqual(project.failures, []);
  assert.deepEqual(project.modules.flatMap((module) => module.result.diagnostics), []);
  const outsideOffset = mainSource.indexOf("vault.open") + "vault.".length;
  const outside = projectCompletionsAt(project, mainPath, outsideOffset);
  assert.ok(outside.some((item) => item.label === "open"));
  assert.ok(!outside.some((item) => item.label === "secret" || item.label === "reads" || item.label === "reveal"));
  const outsideStaticOffset = mainSource.indexOf("Vault.kind") + "Vault.".length;
  const outsideStatic = projectCompletionsAt(project, mainPath, outsideStaticOffset);
  assert.ok(outsideStatic.some((item) => item.label === "kind"));
  assert.ok(!outsideStatic.some((item) => item.label === "category"));

  const insideOffset = modelSource.indexOf("self.reveal") + "self.".length;
  const inside = projectCompletionsAt(project, modelPath, insideOffset);
  assert.ok(inside.some((item) => item.label === "secret" && item.detail === "string"));
  assert.ok(inside.some((item) => item.label === "reads" && item.detail === "number"));
  assert.match(inside.find((item) => item.label === "reveal")?.documentation ?? "", /internal display value/u);
  const insideStaticOffset = modelSource.indexOf("Vault.category") + "Vault.".length;
  assert.ok(projectCompletionsAt(project, modelPath, insideStaticOffset)
    .some((item) => item.label === "category" && item.detail === "string"));
  const revealDeclaration = modelSource.indexOf("reveal() -> string");
  assert.deepEqual(projectDefinitionAt(project, modelPath, insideOffset + 1), {
    path: modelPath,
    span: { start: revealDeclaration, end: revealDeclaration + "reveal".length },
  });
  assert.equal(projectReferencesAt(project, modelPath, revealDeclaration + 1, true).length, 2);
  const rename = projectRenameAt(project, modelPath, revealDeclaration + 1, "renderSecret");
  assert.notEqual(typeof rename, "string");
  if (typeof rename !== "string") assert.equal(rename.edits.length, 2);
});

test("class getters cross module and editor boundaries as documented properties", async () => {
  const directory = await makeTemporaryDirectory("velar-class-getters-");
  const modelPath = join(directory, "model.vel");
  const mainPath = join(directory, "main.vel");
  const modelSource = `
export class ScoreCard:
    const label: string
    private const values: List<number>

    constructor(label: string, values: List<number>):
        self.label = label
        self.values = values

    /// Number of recorded values.
    get count() -> number:
        return self.values.size

    /// Internal doubled count used by the summary.
    private get doubledCount() -> number:
        return self.count * 2

    /// Stable display text for the card.
    get summary() -> string:
        return f"{self.label}:{self.doubledCount}"
`.trimStart();
  const mainSource = `
import {ScoreCard} from "./model.vel"
const card = ScoreCard("Velar", [1, 2, 3])
print(card.count)
print(card.summary)
`.trimStart();
  await writeFile(modelPath, modelSource, "utf8");
  await writeFile(mainPath, mainSource, "utf8");

  const project = await compileProject(mainPath);
  assert.deepEqual(project.failures, []);
  assert.deepEqual(project.modules.flatMap((module) => module.result.diagnostics), []);
  const memberOffset = mainSource.indexOf("card.summary") + "card.".length;
  const completion = projectCompletionsAt(project, mainPath, memberOffset);
  assert.ok(completion.some((item) => item.label === "count" && item.detail === "number"));
  assert.match(completion.find((item) => item.label === "summary")?.documentation ?? "", /Stable display text/u);
  assert.ok(!completion.some((item) => item.label === "doubledCount"));
  const summaryDeclaration = modelSource.indexOf("summary() -> string");
  assert.deepEqual(projectDefinitionAt(project, mainPath, memberOffset + 1), {
    path: modelPath,
    span: { start: summaryDeclaration, end: summaryDeclaration + "summary".length },
  });
  const privateOffset = modelSource.indexOf("self.doubledCount") + "self.".length;
  assert.match(projectCompletionsAt(project, modelPath, privateOffset)
    .find((item) => item.label === "doubledCount")?.documentation ?? "", /Internal doubled count/u);
  const rename = projectRenameAt(project, modelPath, summaryDeclaration + 1, "display");
  assert.notEqual(typeof rename, "string");
  if (typeof rename !== "string") assert.equal(rename.edits.length, 2);
});

test("abstract getter contracts retain identity across VelarScript modules", async () => {
  const directory = await makeTemporaryDirectory("velar-inherited-getters-");
  const basePath = join(directory, "base.vel");
  const mainPath = join(directory, "main.vel");
  await writeFile(basePath, `
export abstract class Display:
    abstract get label() -> string
`.trimStart(), "utf8");
  await writeFile(mainPath, `
import {Display} from "./base.vel"

class Badge extends Display:
    override get label() -> string:
        return "Velar"

const item: Display = Badge()
print(item.label)
`.trimStart(), "utf8");

  const project = await compileProject(mainPath);
  assert.deepEqual(project.failures, []);
  assert.deepEqual(project.modules.flatMap((module) => module.result.diagnostics), []);
  const main = project.modules.find((module) => module.inputPath === mainPath);
  assert.equal(main?.result.moduleInterface.classes.get("Badge")?.getters.has("label"), true);
});

test("class body fields cross module and editor boundaries", async () => {
  const directory = await makeTemporaryDirectory("velar-class-fields-");
  const modelPath = join(directory, "model.vel");
  const mainPath = join(directory, "main.vel");
  const modelSource = `
export class ScoreCard:
    static const category: string = "score"
    const label: string
    const history: List<number> = []
    let total: number = 0

    constructor(label: string):
        self.label = label
        assert self.label != "" else "ScoreCard label cannot be empty"

    def add(value: number):
        self.history.append(value)
        self.total += value

export class TeamCard extends ScoreCard:
    constructor():
        super("Team")
`.trimStart();
  const mainSource = `
import {ScoreCard as Card, TeamCard} from "./model.vel"
const card = Card("Team")
card.add(5)
const team = TeamCard()
team.add(3)
print(Card.category)
print(card.total)
print(card.history.size)
print(TeamCard.category)
print(team.total)
`.trimStart();
  await writeFile(modelPath, modelSource, "utf8");
  await writeFile(mainPath, mainSource, "utf8");

  const project = await compileProject(mainPath);
  assert.deepEqual(project.failures, []);
  assert.deepEqual(project.modules.flatMap((module) => module.result.diagnostics), []);
  const totalUse = mainSource.indexOf("card.total") + "card.".length;
  const categoryUse = mainSource.indexOf("Card.category") + "Card.".length;
  const inheritedCategoryUse = mainSource.indexOf("TeamCard.category") + "TeamCard.".length;
  const totalDeclaration = modelSource.indexOf("total: number");
  const categoryDeclaration = modelSource.indexOf("category: string");
  const labelDeclaration = modelSource.indexOf("label: string");
  const labelInitUse = modelSource.indexOf("self.label !=") + "self.".length;
  assert.ok(projectCompletionsAt(project, mainPath, totalUse).some((item) => item.label === "total" && item.detail === "number"));
  assert.ok(projectCompletionsAt(project, mainPath, categoryUse).some((item) => item.label === "category" && item.detail === "string"));
  assert.ok(!projectCompletionsAt(project, mainPath, categoryUse).some((item) => item.label === "total"));
  assert.deepEqual(projectDefinitionAt(project, mainPath, totalUse + 1), {
    path: modelPath,
    span: { start: totalDeclaration, end: totalDeclaration + "total".length },
  });
  assert.deepEqual(projectDefinitionAt(project, mainPath, categoryUse + 1), {
    path: modelPath,
    span: { start: categoryDeclaration, end: categoryDeclaration + "category".length },
  });
  assert.deepEqual(projectDefinitionAt(project, mainPath, inheritedCategoryUse + 1), {
    path: modelPath,
    span: { start: categoryDeclaration, end: categoryDeclaration + "category".length },
  });
  assert.deepEqual(projectDefinitionAt(project, modelPath, labelInitUse + 1), {
    path: modelPath,
    span: { start: labelDeclaration, end: labelDeclaration + "label".length },
  });
  assert.equal(projectReferencesAt(project, mainPath, inheritedCategoryUse + 1, true).length, 3);
  const categoryRename = projectRenameAt(project, mainPath, inheritedCategoryUse + 1, "kind");
  assert.notEqual(typeof categoryRename, "string");
  if (typeof categoryRename !== "string") assert.equal(categoryRename.edits.length, 3);
  const totalReferences = projectReferencesAt(project, modelPath, totalDeclaration + 1, true);
  assert.equal(totalReferences.length, 4);
  const totalRename = projectRenameAt(project, mainPath, totalUse + 1, "sum");
  assert.notEqual(typeof totalRename, "string");
  if (typeof totalRename !== "string") assert.equal(totalRename.edits.length, 4);
  const contextualRename = projectRenameAt(project, mainPath, totalUse + 1, "init");
  assert.notEqual(typeof contextualRename, "string");
  if (typeof contextualRename !== "string") assert.equal(contextualRename.edits.length, 4);

  const output = join(directory, "dist");
  const build = spawnSync(process.execPath, ["packages/cli/src/cli.ts", "build", mainPath, "--out-dir", output], { cwd: process.cwd(), encoding: "utf8" });
  assert.equal(build.status, 0, build.stderr);
  const execution = spawnSync(process.execPath, [join(output, "main.js")], { encoding: "utf8" });
  assert.equal(execution.status, 0, execution.stderr);
  assert.equal(execution.stdout, "score\n5\n1\nscore\n3\n");
});

test("class inheritance rejects unsafe or incomplete object contracts", () => {
  const abstractConstruction = compile("abstract class Shape:\n    abstract def area() -> number\n\nShape()\n");
  assert.ok(abstractConstruction.diagnostics.some((item) => /Cannot instantiate abstract class 'Shape'/.test(item.message)));

  const missingImplementation = compile("abstract class Shape:\n    abstract def area() -> number\n\nclass Circle extends Shape:\n    pass\n");
  assert.ok(missingImplementation.diagnostics.some((item) => /must implement abstract method: area/.test(item.message)));

  const implicitOverride = compile("class Base:\n    def label() -> string:\n        return \"base\"\n\nclass Child extends Base:\n    def label() -> string:\n        return \"child\"\n");
  assert.ok(implicitOverride.diagnostics.some((item) => /must use 'override'/.test(item.message)));

  const missingBaseMethod = compile("class Base:\n    pass\n\nclass Child extends Base:\n    override def label() -> string:\n        return \"child\"\n");
  assert.ok(missingBaseMethod.diagnostics.some((item) => /no base method exists/.test(item.message)));

  const incompatibleOverride = compile("class Base:\n    def label(value: string) -> string:\n        return value\n\nclass Child extends Base:\n    override def label(value: number) -> string:\n        return str(value)\n");
  assert.ok(incompatibleOverride.diagnostics.some((item) => /must keep the base method signature/.test(item.message)));

  const inheritedConst = compile("class Base:\n    const id: string\n\n    constructor(id: string):\n        self.id = id\n\nclass Child extends Base:\n    constructor():\n        super(\"fixed\")\n\n    def change():\n        self.id = \"other\"\n");
  assert.ok(inheritedConst.diagnostics.some((item) => /Cannot assign to const field 'id'/.test(item.message)));

  const localFieldMethodCollision = compile("class User:\n    const name: string\n\n    constructor(name: string):\n        self.name = name\n\n    def name() -> string:\n        return self.name\n");
  assert.ok(localFieldMethodCollision.diagnostics.some((item) => /conflicts with a field declared by class 'User'/.test(item.message)));

  const inheritedFieldMethodCollision = compile("class Base:\n    def name() -> string:\n        return \"base\"\n\nclass Child extends Base:\n    const name: string\n\n    constructor(name: string):\n        super()\n        self.name = name\n");
  assert.ok(inheritedFieldMethodCollision.diagnostics.some((item) => /Field 'name' conflicts with an inherited method/.test(item.message)));
});

test("inheritance metadata crosses VelarScript module boundaries", async () => {
  const directory = await makeTemporaryDirectory("velar-module-inheritance-");
  const output = join(directory, "dist");
  const basePath = join(directory, "base.vel");
  const playerPath = join(directory, "player.vel");
  const mainPath = join(directory, "main.vel");
  await writeFile(basePath, `
export abstract class Entity:
    const id: string

    constructor(id: string):
        self.id = id

    def label() -> string:
        return self.id
`.trimStart(), "utf8");
  await writeFile(playerPath, `
import {Entity} from "./base.vel"
export class Player extends Entity:
    constructor(id: string):
        super(id)

    def score() -> number:
        return 1

    static def score(id: string) -> Player:
        return Player(id)

export class NamedPlayer extends Player:
    constructor(id: string):
        super(id)

    override def label() -> string:
        return f"named:{super.label()}"
`.trimStart(), "utf8");
  await writeFile(mainPath, `
import {NamedPlayer, Player as Hero} from "./player.vel"
const player = Hero("Nova")
const named = NamedPlayer("Nova")
const scored = Hero.score("Other")
print(player.label())
print(named.label())
print(player.score())
print(scored.score())
`.trimStart(), "utf8");

  const project = await compileProject(mainPath);
  assert.deepEqual(project.failures, []);
  assert.deepEqual(project.modules.flatMap((module) => module.result.diagnostics), []);
  const playerText = await readFile(playerPath, "utf8");
  const baseUse = playerText.indexOf("extends Entity") + "extends ".length;
  const definition = projectDefinitionAt(project, playerPath, baseUse + 1);
  assert.equal(definition?.path, basePath);
  const mainText = await readFile(mainPath, "utf8");
  const inheritedMethod = mainText.indexOf("player.label") + "player.".length;
  const baseText = await readFile(basePath, "utf8");
  const baseLabel = baseText.indexOf("label() -> string");
  const baseId = baseText.indexOf("id: string");
  assert.deepEqual(projectDefinitionAt(project, mainPath, inheritedMethod + 1), {
    path: basePath,
    span: { start: baseLabel, end: baseLabel + "label".length },
  });
  const overrideMethod = mainText.indexOf("named.label") + "named.".length;
  const namedLabel = playerText.indexOf("label() -> string");
  assert.deepEqual(projectDefinitionAt(project, mainPath, overrideMethod + 1), {
    path: playerPath,
    span: { start: namedLabel, end: namedLabel + "label".length },
  });
  const instanceScore = mainText.indexOf("player.score") + "player.".length;
  const staticScore = mainText.indexOf("Hero.score") + "Hero.".length;
  const instanceScoreDeclaration = playerText.indexOf("score() -> number");
  const staticScoreDeclaration = playerText.indexOf("score(id: string)");
  assert.deepEqual(projectDefinitionAt(project, mainPath, instanceScore + 1), {
    path: playerPath,
    span: { start: instanceScoreDeclaration, end: instanceScoreDeclaration + "score".length },
  });
  assert.deepEqual(projectDefinitionAt(project, mainPath, staticScore + 1), {
    path: playerPath,
    span: { start: staticScoreDeclaration, end: staticScoreDeclaration + "score".length },
  });
  const staticRename = projectRenameAt(project, playerPath, staticScoreDeclaration + 1, "create");
  assert.notEqual(typeof staticRename, "string");
  if (typeof staticRename !== "string") {
    assert.equal(staticRename.edits.length, 2);
    assert.ok(staticRename.edits.every((edit) => project.modules
      .find((module) => module.inputPath === edit.path)?.result.source.text.slice(edit.span.start, edit.span.end) === "score"));
  }
  const methodReferences = projectReferencesAt(project, basePath, baseLabel + 1, true);
  assert.equal(methodReferences.length, 5);
  const fieldReferences = projectReferencesAt(project, basePath, baseId + 1, true);
  assert.equal(fieldReferences.length, 3);
  const fieldRename = projectRenameAt(project, basePath, baseId + 1, "identifier");
  assert.notEqual(typeof fieldRename, "string");
  if (typeof fieldRename !== "string") assert.equal(fieldRename.edits.length, 3);
  assert.equal(projectRenameAt(project, basePath, baseLabel + 1, "score"), "The new name collides with another declaration");
  const methodRename = projectRenameAt(project, basePath, baseLabel + 1, "title");
  assert.notEqual(typeof methodRename, "string");
  if (typeof methodRename !== "string") {
    assert.equal(methodRename.edits.length, 5);
    const editsByPath = new Map<string, typeof methodRename.edits[number][]>();
    for (const edit of methodRename.edits) {
      const edits = editsByPath.get(edit.path) ?? [];
      edits.push(edit);
      editsByPath.set(edit.path, edits);
    }
    for (const [editPath, edits] of editsByPath) {
      let updated = await readFile(editPath, "utf8");
      for (const edit of [...edits].sort((left, right) => right.span.start - left.span.start)) {
        updated = `${updated.slice(0, edit.span.start)}${edit.replacement ?? "title"}${updated.slice(edit.span.end)}`;
      }
      await writeFile(editPath, updated, "utf8");
    }
    const renamed = await compileProject(mainPath);
    assert.deepEqual(renamed.failures, []);
    assert.deepEqual(renamed.modules.flatMap((module) => module.result.diagnostics), []);
  }

  const build = spawnSync(process.execPath, ["packages/cli/src/cli.ts", "build", mainPath, "--out-dir", output], { cwd: process.cwd(), encoding: "utf8" });
  assert.equal(build.status, 0, build.stderr);
  const execution = spawnSync(process.execPath, [join(output, "main.js")], { encoding: "utf8" });
  assert.equal(execution.status, 0, execution.stderr);
  assert.equal(execution.stdout, "Nova\nnamed:Nova\n1\n1\n");
});
