import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import test from "node:test";
import { applyMechanicalFixes, compile } from "@velarscript/compiler";
import { TEXT_NAMESPACE_MEMBERS } from "@velarscript/compiler/extension";
import { compileProject, type ProjectResult } from "../packages/cli/src/project.ts";
import { standardModuleInterfaces, standardModuleSources } from "../packages/cli/src/standard-modules.ts";

const projectRoot = "/velar-wave-z2-modules";

async function checkProject(modules: Readonly<Record<string, string>>, entry: string): Promise<ProjectResult> {
  const overrides = new Map(Object.entries(modules).map(([name, text]) => [join(projectRoot, name), text]));
  return await compileProject(join(projectRoot, entry), overrides, {});
}

function moduleOf(project: ProjectResult, name: string): ProjectResult["modules"][number] {
  const module = project.modules.find((candidate) => candidate.inputPath === join(projectRoot, name));
  assert.ok(module, `module ${name} was compiled`);
  return module;
}

function projectMessages(project: ProjectResult, name: string): readonly string[] {
  return moduleOf(project, name).result.diagnostics.map((item) => item.message);
}

// The generated standard modules name each other by specifier, so the whole
// graph is linked as data URLs before a program runs. Three passes settle the
// two-level core dependencies.
function linkedModuleUrls(): ReadonlyMap<string, string> {
  const sources = standardModuleSources();
  const urls = new Map<string, string>();
  const encode = (source: string): string => `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;
  const link = (source: string): string => {
    let linked = source;
    for (const name of sources.keys()) linked = linked.replaceAll(JSON.stringify(name), JSON.stringify(urls.get(name)!));
    return linked;
  };
  for (const [name, source] of sources) urls.set(name, encode(source));
  for (let pass = 0; pass < 3; pass += 1) {
    for (const [name, source] of sources) urls.set(name, encode(link(source)));
  }
  return urls;
}

function execute(code: string): { readonly status: number | null; readonly stdout: string; readonly stderr: string } {
  const urls = linkedModuleUrls();
  let linked = code;
  for (const [name, url] of urls) linked = linked.replaceAll(JSON.stringify(name), JSON.stringify(url));
  const result = spawnSync(process.execPath, ["--input-type=module"], { encoding: "utf8", input: linked, timeout: 20_000 });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

function run(source: string): string {
  const result = compile(source);
  assert.deepEqual(result.diagnostics, [], result.diagnostics.map((item) => item.message).join("\n"));
  const execution = execute(result.code ?? "");
  assert.equal(execution.status, 0, execution.stderr);
  return execution.stdout;
}

function runFailing(source: string): string {
  const result = compile(source);
  assert.deepEqual(result.diagnostics, [], result.diagnostics.map((item) => item.message).join("\n"));
  const execution = execute(result.code ?? "");
  assert.notEqual(execution.status, 0);
  return execution.stderr;
}

function messages(source: string): readonly string[] {
  return compile(source).diagnostics.map((item) => item.message);
}

function clean(source: string): void {
  const result = compile(source);
  assert.deepEqual(result.diagnostics, [], result.diagnostics.map((item) => item.message).join("\n"));
}

// ---------------------------------------------------------------------------
// TXT-U3 — Text.normalize
// ---------------------------------------------------------------------------

test("[TXT-U3] canonically equivalent text is unequal until Text.normalize joins it", () => {
  const output = run(`
const composed = "caf\\u{e9}"
const decomposed = "cafe\\u{301}"
print(str(composed == decomposed))
print(str(composed.size))
print(str(decomposed.size))
print(str(Text.normalize(decomposed) == composed))
print(str(Text.normalize(composed, "NFD") == decomposed))
print(str(Text.normalize(composed, "NFC") == composed))
`.trimStart());
  assert.equal(output, ["false", "4", "5", "true", "true", "true"].join("\n") + "\n");
});

test("[TXT-U3] Text.normalize accepts the four Unicode forms and rejects anything else", () => {
  const output = run(`
const ligature = "\\u{fb01}n"
print(Text.normalize(ligature, "NFKC"))
print(Text.normalize(ligature, "NFKD"))
print(str(Text.normalize(ligature, "NFC") == ligature))
print(str(Text.normalize(ligature, "NFD") == ligature))
`.trimStart());
  assert.equal(output, ["fin", "fin", "true", "true"].join("\n") + "\n");

  const failure = runFailing('print(Text.normalize("a", "nfc"))\n');
  assert.match(failure, /normalize form must be NFC, NFD, NFKC, or NFKD/u);
});

test("[TXT-U3] normalized text agrees as a Map and Set key", () => {
  const output = run(`
const composed = "caf\\u{e9}"
const decomposed = "cafe\\u{301}"
const seen = Set([composed])
print(str(decomposed in seen))
print(str(Text.normalize(decomposed) in seen))
const counts = Map([[composed, 1]])
counts.set(Text.normalize(decomposed), 2)
print(str(counts.size))
`.trimStart());
  assert.equal(output, ["false", "true", "1"].join("\n") + "\n");
});

test("[TXT-U3] Text.normalize is a permanent Text member with a two-argument contract", () => {
  assert.ok(TEXT_NAMESPACE_MEMBERS.includes("normalize"));
  assert.deepEqual([...TEXT_NAMESPACE_MEMBERS].sort(),
    [...standardModuleInterfaces().get("velar/text")!.exports.keys()].sort());
  assert.deepEqual(messages('print(Text.normalize("a", "NFC", "NFD"))\n'),
    ["Expected 1-2 arguments but received 3"]);
  assert.deepEqual(messages('print(Text.normalize("a", 1))\n'), ["Cannot assign number to string"]);
  clean('print(Text.normalize("a"))\n');
});

// ---------------------------------------------------------------------------
// FLW-N7 — a boolean literal comparison carries its fact back
// ---------------------------------------------------------------------------

test("[FLW-N7] flag == true and flag == false each narrow a bool?", () => {
  for (const condition of ["flag == true", "true == flag", "flag == false", "false == flag"]) {
    clean(`
def read(flag: bool?) -> bool:
    if ${condition}:
        return flag
    return false
`.trimStart());
  }
  for (const condition of ["flag != true", "flag != false", "not (flag == true)"]) {
    clean(`
def read(flag: bool?) -> bool:
    if ${condition}:
        return false
    return flag
`.trimStart());
  }
});

test("[FLW-N7] the arm that does not prove equality learns nothing", () => {
  // `flag != true` still admits both false and an absent value, which is the
  // same reason `if flag:` teaches its else arm nothing.
  assert.deepEqual(messages(`
def read(flag: bool?) -> bool:
    if flag == true:
        return false
    return flag
`.trimStart()), ["Cannot assign bool? to bool"]);
  assert.deepEqual(messages(`
def read(flag: bool?) -> bool:
    if flag != true:
        return flag
    return false
`.trimStart()), ["Cannot assign bool? to bool"]);
});

test("[FLW-N7] the boolean fact reaches record fields, assert, and union owners", () => {
  clean(`
type Row:
    done: bool?

def read(row: Row) -> bool:
    if row.done == true:
        return row.done
    return false
`.trimStart());
  clean(`
def read(flag: bool?) -> bool:
    assert flag == true
    return flag
`.trimStart());
  clean(`
def read(value: bool | string) -> bool:
    if value == true:
        return value
    return false
`.trimStart());
  // A location already typed bool learns nothing, so no guard is bought.
  const plain = compile(`
def read(flag: bool) -> bool:
    if flag == true:
        return flag
    return false
`.trimStart());
  assert.deepEqual(plain.diagnostics, []);
  assert.doesNotMatch(plain.code ?? "", /__velarNarrow/u);
});

test("[FLW-N7] the narrowed read holds at runtime", () => {
  const output = run(`
def read(flag: bool?) -> string:
    if flag == true:
        return str(flag)
    if flag == false:
        return "explicit " + str(flag)
    return "absent"

print(read(true))
print(read(false))
print(read(null))
`.trimStart());
  assert.equal(output, ["true", "explicit false", "absent"].join("\n") + "\n");
});

// ---------------------------------------------------------------------------
// FLW-N2 — an optional chain that produced a value proves every link
// ---------------------------------------------------------------------------

const chainTypes = `
type Profile:
    email: string

type Account:
    profile: Profile?
`.trimStart();

test("[FLW-N2] a non-null optional chain narrows every link along it", () => {
  clean(chainTypes + `
def address(account: Account) -> string:
    if account.profile?.email != null:
        return account.profile.email
    return ""
`);
  // The fall-through of an `== null` guard proves the same thing.
  clean(chainTypes + `
def address(account: Account) -> string:
    if account.profile?.email == null:
        return ""
    return account.profile.email
`);
  // An optional root is a link too.
  clean(chainTypes + `
def address(account: Account?) -> string:
    if account?.profile != null:
        return account.profile.email
    return ""
`);
  // Every depth of the chain narrows, not only the last link.
  clean(`
type C:
    d: string

type B:
    c: C?

type A:
    b: B?

def read(a: A) -> string:
    if a.b?.c?.d != null:
        return a.b.c.d
    return ""
`.trimStart());
});

test("[FLW-N2] the arm that admits an absent link proves nothing", () => {
  assert.deepEqual(messages(chainTypes + `
def address(account: Account) -> string:
    if account.profile?.email == null:
        return account.profile.email
    return ""
`), ["Use optional access '?.' for Profile?"]);
  assert.deepEqual(messages(chainTypes + `
def address(account: Account) -> string:
    if account.profile?.email != null:
        return ""
    return account.profile.email
`), ["Use optional access '?.' for Profile?"]);
});

test("[FLW-N2] the chain facts hold at runtime", () => {
  const output = run(chainTypes + `
def address(account: Account) -> string:
    if account.profile?.email != null:
        return account.profile.email
    return "none"

print(address({profile: {email: "ada@example.com"}}))
print(address({profile: null}))
`);
  assert.equal(output, ["ada@example.com", "none"].join("\n") + "\n");
});

// ---------------------------------------------------------------------------
// FLW-S1 — a loop with no break keeps its condition's negated fact
// ---------------------------------------------------------------------------

test("[FLW-S1] a while with no break carries its negated condition out", () => {
  clean(`
def settle(initial: number | string) -> string:
    let value = initial
    while value is number:
        value = "settled"
    return value.upper()
`.trimStart());
  clean(`
def drain(initial: string?) -> number:
    let value = initial
    while value != null:
        value = null
    return 0
`.trimStart());
  // `continue` is a back edge, not an exit, so the fact still holds.
  clean(`
def settle(initial: number | string) -> string:
    let value = initial
    while value is number:
        if str(value) == "0":
            continue
        value = "settled"
    return value.upper()
`.trimStart());
  // A break of the outer loop's own is what drops it; a nested loop's is not.
  clean(`
def settle(initial: number | string) -> string:
    let value = initial
    while value is number:
        for index in [1, 2]:
            break
        value = "settled"
    return value.upper()
`.trimStart());
});

test("[FLW-S1] one break of the loop's own drops the negated fact", () => {
  assert.deepEqual(messages(`
def settle(initial: number | string) -> string:
    let value = initial
    while value is number:
        if str(value) == "0":
            break
        value = "settled"
    return value.upper()
`.trimStart()), [
    "number | string has no common field 'upper'",
    "Cannot assign unknown to string",
  ]);
});

test("[FLW-S1] the fact carried out is what both condition tests prove", () => {
  // The body widens the entry fact, so the entry test proves `string` while the
  // back-edge test proves `string | bool`. The loop is left through whichever
  // failed, so the union is what holds — never the narrower entry answer.
  assert.deepEqual(messages(`
def settle(initial: number | string | bool) -> string:
    let value = initial
    if value is not bool:
        while value is number:
            value = true
        return value.upper()
    return ""
`.trimStart()), [
    "string | bool has no common field 'upper'",
    "Cannot assign unknown to string",
  ]);
});

test("[FLW-S1] the carried fact holds at runtime", () => {
  const output = run(`
def settle(initial: number | string) -> string:
    let value = initial
    while value is number:
        value = "settled"
    return value.upper()

print(settle(1))
print(settle("done"))
`.trimStart());
  assert.equal(output, ["SETTLED", "DONE"].join("\n") + "\n");
});

// ---------------------------------------------------------------------------
// FLW-N6 — a while true is left only through its breaks
// ---------------------------------------------------------------------------

test("[FLW-N6] the facts every break of a while true proves hold after it", () => {
  clean(`
def read(value: string?) -> string:
    while true:
        if value == null:
            return "absent"
        break
    return value.upper()
`.trimStart());
  clean(`
def read(initial: string?, early: bool) -> string:
    let value = initial
    while true:
        if value == null:
            return "absent"
        if early:
            break
        break
    return value.upper()
`.trimStart());
  // A member fact crosses the break edge too.
  clean(`
type Box:
    value: string?

def read(box: Box) -> string:
    while true:
        if box.value == null:
            return "absent"
        break
    return box.value.upper()
`.trimStart());
  // A continue back edge does not defeat a break that is still guarded.
  clean(`
def read(initial: string?, again: bool) -> string:
    let value = initial
    while true:
        if again:
            value = null
            continue
        if value == null:
            return "absent"
        break
    return value.upper()
`.trimStart());
});

test("[FLW-N6] one break that proves less carries nothing out", () => {
  assert.deepEqual(messages(`
def read(initial: string?, early: bool) -> string:
    let value = initial
    while true:
        if early:
            break
        if value == null:
            return "absent"
        break
    return value.upper()
`.trimStart()), ["Use optional access '?.' for string?"]);
  // A loop whose condition can fail also exits without the break's fact.
  assert.deepEqual(messages(`
def read(initial: string?, more: bool) -> string:
    let value = initial
    while more:
        if value == null:
            return "absent"
        break
    return value.upper()
`.trimStart()), ["Use optional access '?.' for string?"]);
  // A break in a nested loop belongs to that loop, not the outer one.
  assert.deepEqual(messages(`
def read(initial: string?) -> string:
    let value = initial
    while true:
        for index in [1, 2]:
            if value == null:
                return "absent"
            break
        break
    return value.upper()
`.trimStart()), ["Use optional access '?.' for string?"]);
  // The back-edge pass must agree as well: the write below the break makes the
  // second reaching state prove less than the first.
  assert.deepEqual(messages(`
def read(initial: string?, again: bool) -> string:
    let value = initial
    if value != null:
        while true:
            if again:
                break
            value = null
            continue
        return value.upper()
    return "absent"
`.trimStart()), ["Use optional access '?.' for string?"]);
});

test("[FLW-N6] the break fact holds at runtime", () => {
  const output = run(`
def read(value: string?) -> string:
    while true:
        if value == null:
            return "absent"
        break
    return value.upper()

print(read("ada"))
print(read(null))
`.trimStart());
  assert.equal(output, ["ADA", "absent"].join("\n") + "\n");
});

// ---------------------------------------------------------------------------
// FLW-S2 — a check on a getter is reported, and the read teaches const
// ---------------------------------------------------------------------------

const getterClass = `class Box:
    let stored: string? = "kept"

    get label() -> string?:
        return self.stored

    get flag() -> bool?:
        return true

    get ready() -> bool:
        return true
`;

test("[FLW-S2] a narrowing check written on a getter is reported where it stands", () => {
  assert.deepEqual(messages(getterClass + `
def read(box: Box) -> string:
    if box.label != null:
        return box.label.upper()
    return ""
`), [
    "'label' is a getter, so it is computed again on every read and this check narrows nothing"
    + "; bind it once with 'const label = box.label' and check that name instead",
    "'label' is a getter, so '?.' would compute it a second time"
    + "; bind it once with 'const label = box.label' and read that name instead",
  ]);
  // The taught spelling is the one that compiles.
  clean(getterClass + `
def read(box: Box) -> string:
    const label = box.label
    if label != null:
        return label.upper()
    return ""
`);
  // A stored field is a stable location and still narrows silently.
  clean(getterClass + `
def read(box: Box) -> string:
    if box.stored != null:
        return box.stored.upper()
    return ""
`);
});

test("[FLW-S2] every narrowing form on a getter is named, and a plain read is not", () => {
  for (const condition of ["box.flag", "box.flag == true", "box.flag != null"]) {
    assert.ok(messages(getterClass + `
def read(box: Box) -> bool:
    if ${condition}:
        return true
    return false
`).some((message) => message.startsWith("'flag' is a getter")), condition);
  }
  assert.ok(messages(getterClass + `
def read(box: Box) -> string:
    assert box.label != null
    return "ok"
`).some((message) => message.startsWith("'label' is a getter")));
  assert.ok(messages(`
class Holder:
    get value() -> number | string:
        return 1

def read(holder: Holder) -> string:
    if holder.value is string:
        return "text"
    return "number"
`.trimStart()).some((message) => message.startsWith("'value' is a getter")));
  assert.ok(messages(`
class Shared:
    static get label() -> string?:
        return "shared"

def read() -> string:
    if Shared.label != null:
        return "has"
    return ""
`.trimStart()).some((message) => message.startsWith("'label' is a getter")));
  // A getter with one concrete type is tested, not narrowed: nothing to say.
  clean(getterClass + `
def read(box: Box) -> string:
    if box.ready:
        return "yes"
    return "no"
`);
});

test("[FLW-S2] a non-getter optional still learns the '?.' spelling", () => {
  assert.deepEqual(messages(`
type Row:
    name: string?

def read(row: Row) -> string:
    return row.name.upper()
`.trimStart()), ["Use optional access '?.' for string?"]);
});

// ---------------------------------------------------------------------------
// FLW-N4 — membership asks the == question, so it carries the same fact
// ---------------------------------------------------------------------------

test("[FLW-N4] membership narrows its subject to the container's element type", () => {
  clean(`
def read(value: string?, names: List<string>) -> string:
    if value in names:
        return value
    return ""
`.trimStart());
  clean(`
def read(value: string?, names: Set<string>) -> string:
    if value in names:
        return value
    return ""
`.trimStart());
  clean(`
def read(value: string?, counts: Map<string, number>) -> string:
    if value in counts:
        return value
    return ""
`.trimStart());
  clean(`
def read(value: string?, text: string) -> string:
    if value in text:
        return value
    return ""
`.trimStart());
  clean(`
def read(value: string | number, names: List<string>) -> string:
    if value in names:
        return value
    return ""
`.trimStart());
  // `not in` proves it on its own fall-through.
  clean(`
def read(value: string?, names: List<string>) -> string:
    if value not in names:
        return ""
    return value
`.trimStart());
});

test("[FLW-N4] membership proves nothing where an absent value is an element", () => {
  assert.deepEqual(messages(`
def read(value: string?, names: List<string?>) -> string:
    if value in names:
        return value
    return ""
`.trimStart()), ["Cannot assign string? to string"]);
  // The negative arm proves nothing: any element could have failed to match.
  assert.deepEqual(messages(`
def read(value: string?, names: List<string>) -> string:
    if value in names:
        return ""
    return value
`.trimStart()), ["Cannot assign string? to string"]);
});

test("[FLW-N4] the membership fact holds at runtime", () => {
  const output = run(`
def read(value: string?, names: List<string>) -> string:
    if value in names:
        return value.upper()
    return "absent"

print(read("ada", ["ada", "grace"]))
print(read("nobody", ["ada", "grace"]))
print(read(null, ["ada", "grace"]))
`.trimStart());
  assert.equal(output, ["ADA", "absent", "absent"].join("\n") + "\n");
});

// ---------------------------------------------------------------------------
// MOD-U3 / D38 rule 49 — import type
// ---------------------------------------------------------------------------

const usersModule = `export type User:
    name: string

export def load() -> User:
    return {name: "Ada"}

export const first: string = "Ada"
`;

test("[MOD-U3] import type names a module's types and its values stay out of reach", async () => {
  const legal = await checkProject({
    "users.vel": usersModule,
    "main.vel": [
      'import type {User} from "./users.vel"',
      "",
      "def label(user: User) -> string:",
      "    return user.name",
      "",
      "def count(users: List<User>) -> number:",
      "    return users.size",
      "",
      'print(label({name: "Grace"}))',
      "print(str(count([])))",
      "",
    ].join("\n"),
  }, "main.vel");
  assert.deepEqual(legal.failures, []);
  assert.deepEqual(projectMessages(legal, "main.vel"), []);
  // Item 4: nothing is emitted for the declaration, so the module never loads.
  assert.doesNotMatch(moduleOf(legal, "main.vel").result.code ?? "", /users\.js/u);

  const aliased = await checkProject({
    "users.vel": usersModule,
    "main.vel": 'import type {User as Account} from "./users.vel"\n\ndef label(account: Account) -> string:\n    return account.name\n\nprint(label({name: "Ada"}))\n',
  }, "main.vel");
  assert.deepEqual(projectMessages(aliased, "main.vel"), []);
});

test("[MOD-U3] every position needing the validator is answered with the same fix", async () => {
  const expected = (name: string): string =>
    `'${name}' comes from a type-only import, so it names a type and has no value here`
    + `; runtime validation needs the value import — drop 'type' from the import of "./users.vel"`;
  const cases: readonly (readonly [string, string, readonly string[]])[] = [
    ["parse", 'print(User.parse({name: "Ada"}).name)\n', [expected("User")]],
    ["call", "print(load().name)\n", [expected("load")]],
    ["is", "def read(raw: unknown) -> string:\n    if raw is User:\n        return raw.name\n    return \"\"\n\nprint(read(1))\n", [expected("User")]],
    ["argument", "def read(value: Type<User>) -> string:\n    return \"x\"\n\nprint(read(User))\n", [expected("User")]],
    // A narrowed read rechecks against the record's own validator, which the
    // type-only import never loaded.
    ["narrowed read", "def read(user: User?) -> string:\n    if user != null:\n        return user.name\n    return \"\"\n\nprint(read(null))\n", [expected("User")]],
  ];
  for (const [label, body, messages_] of cases) {
    const project = await checkProject({
      "users.vel": usersModule,
      "main.vel": `import type {User, load} from "./users.vel"\n\n${body}`,
    }, "main.vel");
    assert.deepEqual(projectMessages(project, "main.vel").filter((item) => item.includes("type-only import")), messages_, label);
    assert.equal(moduleOf(project, "main.vel").result.code, null, label);
  }
});

test("[MOD-U3] the value-use diagnostic carries the mechanical rewrite that drops 'type'", () => {
  const source = 'import type {User} from "./users.vel"\n\nprint(User.parse(1))\n';
  const diagnostics = compile(source).diagnostics;
  const named = diagnostics.find((item) => item.message.includes("type-only import"));
  assert.ok(named, diagnostics.map((item) => item.message).join("\n"));
  assert.equal(named.fix?.title, "Drop 'type' from the import");
  const fixed = applyMechanicalFixes(source, diagnostics);
  assert.match(fixed.text, /^import \{User\} from "\.\/users\.vel"/u);
  // Idempotent: the rewritten source no longer registers the fix.
  assert.equal(applyMechanicalFixes(fixed.text, compile(fixed.text).diagnostics).applied.length, 0);
});

test("[MOD-U3] one import line is entirely values or entirely types", () => {
  assert.deepEqual(messages('import {load, type User} from "./users.vel"\n'), [
    "An import is entirely values or entirely types; move 'User' to its own 'import type {...} from' line",
  ]);
  assert.deepEqual(messages('import type {User, type Status} from "./users.vel"\n'), [
    "'type' is already declared for this import; drop the inner marker on 'Status'",
  ]);
  assert.deepEqual(messages('export {measure, type Shape} from "./text.vel"\n'), [
    "A re-export is entirely values or entirely types; move 'Shape' to its own 'export type {...} from' line",
  ]);
  assert.deepEqual(messages('import type * as Users from "./users.vel"\n'), [
    'A type-only import names its types explicitly; write import type {Name} from "..." instead of a namespace import',
  ]);
  assert.ok(messages('import type Users from "./users.vel"\n')
    .includes('A type-only import names its types in braces; write import type {Name} from "..."'));
  assert.deepEqual(messages('import js type {Client} from "sdk"\n'), [
    "'import js type' is not a spelling: a JavaScript module's types come from an 'extern module' declaration, which is already types-only",
  ]);
  // `type` is still a contextual keyword everywhere else.
  clean('const type = "record"\nprint(type)\n');
  clean('type Row:\n    name: string\n\nprint(Row.parse({name: "a"}).name)\n');
});

test("[MOD-U3] a type-only edge does not participate in initialization order", async () => {
  const modules = (keyword: string): Readonly<Record<string, string>> => ({
    "alpha.vel": 'import {beta} from "./beta.vel"\n\nexport type Alpha:\n    field: string\n\nexport const alpha: string = "A" + beta\n',
    "beta.vel": `${keyword} {Alpha} from "./alpha.vel"\n\nexport def describe(value: Alpha) -> string:\n    return value.field\n\nexport const beta: string = "B"\n`,
  });
  const valueEdge = await checkProject(modules("import"), "beta.vel");
  assert.deepEqual(projectMessages(valueEdge, "alpha.vel"), [
    "Move this read into a function, or extract the shared value into a third module; './beta.vel' has not initialized when this line runs",
  ]);

  const typeEdge = await checkProject(modules("import type"), "beta.vel");
  assert.deepEqual(projectMessages(typeEdge, "alpha.vel"), []);
  assert.deepEqual(projectMessages(typeEdge, "beta.vel"), []);
  // The type-only importer emits no import of the module it names.
  assert.doesNotMatch(moduleOf(typeEdge, "beta.vel").result.code ?? "", /alpha\.js/u);
});

test("[MOD-U3] export type re-exports types and emits nothing for them", async () => {
  const project = await checkProject({
    "users.vel": usersModule,
    "barrel.vel": 'export type {User} from "./users.vel"\n\nexport const tag: string = "barrel"\n',
    "main.vel": [
      'import type {User} from "./barrel.vel"',
      'import {tag} from "./barrel.vel"',
      "",
      "def label(user: User) -> string:",
      "    return user.name + \" \" + tag",
      "",
      'print(label({name: "Grace"}))',
      "",
    ].join("\n"),
  }, "main.vel");
  assert.deepEqual(project.failures, []);
  assert.deepEqual(projectMessages(project, "barrel.vel"), []);
  assert.deepEqual(projectMessages(project, "main.vel"), []);
  const barrel = moduleOf(project, "barrel.vel").result.code ?? "";
  assert.doesNotMatch(barrel, /export \{ ?User/u);
  assert.doesNotMatch(barrel, /users\.js/u);
});
