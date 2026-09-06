import assert from "node:assert/strict";
import test, { after } from "node:test";
import { writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { applyMechanicalFixes, describeType } from "@velarscript/compiler";
import { makeTemporaryDirectory, removeTemporaryDirectories } from "../support/temporary-directory.ts";
import { executeModule } from "../support/execute-module.ts";
import { compile, compileProject } from "../support/compiler-suite.ts";

after(removeTemporaryDirectories);

test("module state, computed values, and watches form a reactive module", () => {
  const result = compile(`
export state count: number = 0
export computed doubled = count * 2

export def increment():
    count += 1

watch count as current, previous:
    print(f"{previous} -> {current}")

component Counter:
    return <button on:click={increment}>{count} / {doubled}</button>
`.trimStart());

  assert.deepEqual(result.diagnostics, []);
  assert.equal(result.moduleInterface.reactiveExports.get("count"), "state");
  assert.equal(result.moduleInterface.reactiveExports.get("doubled"), "state");
  assert.equal(describeType(result.moduleInterface.exports.get("increment")!), "() -> null");
  assert.match(result.code ?? "", /export const count = __velarState\(0, "count"\)/);
  assert.match(result.code ?? "", /export const doubled = __velarComputed\(\(\) => \(\(count\.get\(\) \* 2\)\)\)/);
  assert.match(result.code ?? "", /count\.set\(count\.get\(\) \+ 1\)/);
  assert.match(result.code ?? "", /__velarWatch\(\(\) => count\.get\(\)/);

  const asynchronousWatch = compile(`
async def later():
    return null

state ready = false
watch ready:
    await later()
`.trimStart());
  assert.equal(asynchronousWatch.code, null);
  assert.ok(asynchronousWatch.diagnostics.some((item) => item.code === "VEL4007" && /watch blocks are synchronous/u.test(item.message)));

  const asynchronousWatchRead = compile(`
async def later() -> bool:
    return true

state ready = false
watch ready:
    print(f"{await later()}")
`.trimStart());
  assert.equal(asynchronousWatchRead.code, null);
  assert.ok(asynchronousWatchRead.diagnostics.some((item) => item.code === "VEL4007" && /watch blocks are synchronous/u.test(item.message)));

  // D90 R15(a) also refuses a call in the subject, but the await there is still
  // the synchronous-block failure it always was: the newer refusal does not
  // take VEL4007 off the shape.
  const asynchronousWatchSubject = compile(`
async def later() -> bool:
    return true

watch await later():
    print("changed")
`.trimStart());
  assert.equal(asynchronousWatchSubject.code, null);
  assert.ok(asynchronousWatchSubject.diagnostics.some((item) => item.code === "VEL4007" && /watch blocks are synchronous/u.test(item.message)));

  const asynchronousComputed = compile(`
async def later() -> number:
    return 1

computed value = await later()
`.trimStart());
  assert.equal(asynchronousComputed.code, null);
  assert.ok(asynchronousComputed.diagnostics.some((item) => item.code === "VEL4007" || /computed cannot cache a Promise/u.test(item.message)));

  const asynchronousJsx = compile(`
async def label() -> string:
    return "ready"

mount(<main>{await label()}</main>, "#app")
`.trimStart());
  assert.equal(asynchronousJsx.code, null);
  assert.ok(asynchronousJsx.diagnostics.some((item) => item.code === "VEL4007" && /JSX rendering is synchronous/u.test(item.message)));

  const asynchronousMount = compile(`
async def createRoot() -> WebNode:
    return <main>Ready</main>

mount(await createRoot(), "#app")
`.trimStart());
  assert.equal(asynchronousMount.code, null);
  assert.ok(asynchronousMount.diagnostics.some((item) => item.code === "VEL4007" && /mount constructs its root synchronously/u.test(item.message)));

  const namedMount = compile(`
def root() -> WebNode:
    print("node")
    return <main>Ready</main>

def target() -> string:
    print("target")
    return "#app"

mount(node=root(), target=target())
`.trimStart());
  assert.deepEqual(namedMount.diagnostics, []);
  assert.match(namedMount.code ?? "", /__velarMount\(\(\) => \(\(__velarNamedArguments\) => \[__velarNamedArguments\[0\], __velarNamedArguments\[1\]\]\)\(\[root\(\), target\(\)\]\), null\)/u);
  const mountExecution = executeModule(`
class FakeNode {
  append(node) { this.child = node; }
  setAttribute() {}
}
const targetNode = new FakeNode();
globalThis.Node = FakeNode;
globalThis.CharacterData = FakeNode;
// A text node's character data is now written in place, so the stand-in models
// the accessor the DOM writes it through instead of only its creation.
Object.defineProperty(FakeNode.prototype, "data", { configurable: true,
  get() { return this.textContent !== undefined ? this.textContent : this.value; },
  set(next) { if (this.textContent !== undefined) this.textContent = next; else this.value = next; } });
globalThis.document = {
  createElement() { return new FakeNode(); },
  createTextNode() { return new FakeNode(); },
  createComment() { return new FakeNode(); },
  querySelector() { return targetNode; },
};
${namedMount.code ?? ""}
`);
  assert.equal(mountExecution.status, 0, String(mountExecution.stderr));
  assert.equal(mountExecution.stdout, "node\ntarget\n");

  const reorderedMount = compile(`
component App:
    return <main>Ready</main>

mount(target="#app", node=<App />)
`.trimStart());
  assert.deepEqual(reorderedMount.diagnostics, []);
  assert.match(reorderedMount.code ?? "", /__velarNamedArguments\[1\], __velarNamedArguments\[0\]/u);
});

test("[D71-183] a computed alone installs its runtime, and both retired accessor spellings have one migration diagnostic", () => {
  const result = compile("export computed one = 1\n");
  assert.deepEqual(result.diagnostics, []);
  assert.match(result.code ?? "", /const __velarRuntimeKey/u);
  const execution = executeModule(`${result.code ?? ""}\nconsole.log(one.get());\n`);
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, "1\n");

  // D71 rule 184 reverses W-124: the declaration is the spelling, and the
  // function keeps the cache under the name that says what it does. The old
  // function spelling gets exactly one message -- not an unknown name, and not
  // a second diagnostic from the call around it.
  const retired = compile("state count = 1\nconst doubled = computed(() => count * 2)\nprint(doubled())\n");
  assert.equal(retired.code, null);
  assert.equal(retired.diagnostics.length, 1, JSON.stringify(retired.diagnostics));
  assert.equal(retired.diagnostics[0]?.code, "VEL5055");
  assert.match(retired.diagnostics[0]?.message ?? "", /write 'computed doubled = \.\.\.' and read 'doubled' bare/u);
  assert.doesNotMatch(retired.diagnostics.map((item) => item.message).join("\n"), /Unknown name 'computed'/u);

  const doubledFixSource = "state count = 1\nconst doubled = computed(() => count * 2)\nprint(doubled())\n";
  assert.equal(applyMechanicalFixes(doubledFixSource, retired.diagnostics).text, "state count = 1\ncomputed doubled = count * 2\nprint(doubled)\n");

  // An exported reader loses its `() -> T` annotation along with the call: the
  // declaration infers the type, so the fix rewrites the whole left side. The
  // annotation is also where a second message would hide -- the answer is
  // one message whether or not the author wrote the `() -> T` down, so the
  // count is asserted here and the whole list is handed to the fixer.
  const retiredExportSource = "export const one: () -> number = computed(() => 1)\n";
  const retiredExport = compile(retiredExportSource);
  assert.equal(retiredExport.diagnostics.length, 1, JSON.stringify(retiredExport.diagnostics));
  assert.equal(retiredExport.diagnostics[0]?.code, "VEL5055");
  assert.equal(applyMechanicalFixes(retiredExportSource, retiredExport.diagnostics).text, "export computed one = 1\n");

  // Annotating the declaration must not add a second diagnostic either.
  const retiredAnnotated = compile("state count = 1\nconst doubled: () -> number = computed(() => count * 2)\nprint(doubled())\n");
  assert.equal(retiredAnnotated.diagnostics.length, 1, JSON.stringify(retiredAnnotated.diagnostics));
  assert.equal(retiredAnnotated.diagnostics[0]?.code, "VEL5055");

  // Passing the accessor on is the one shape `velar fix` must not decide, so it
  // carries the message and no edit -- D71's migration discipline verbatim.
  const passed = compile("state count = 1\nconst doubled = computed(() => count * 2)\nprint([doubled].size)\n");
  assert.equal(passed.diagnostics.length, 1, JSON.stringify(passed.diagnostics));
  assert.equal(passed.diagnostics[0]?.fix, undefined);
  assert.match(passed.diagnostics[0]?.message ?? "", /declare the value — 'computed doubled = \.\.\.' — and write an ordinary 'def' where a callable is required/u);

  // A bare reference to `computed` names the declaration form, not an unknown
  // name -- a call is the habit Vue and the signals libraries teach.
  const bare = compile("print(computed)\n");
  assert.equal(bare.diagnostics.length, 1, JSON.stringify(bare.diagnostics));
  assert.equal(bare.diagnostics[0]?.code, "VEL5055");
  assert.match(bare.diagnostics[0]?.message ?? "", /'computed' declares a derived value/u);

  // D90 R22: `cached` is nobody's habit -- no version of this language was ever
  // published, so there is nobody to migrate and it is an ordinary name.
  const removedSpelling = compile("print(cached)\n");
  assert.deepEqual(removedSpelling.diagnostics.map((item) => `${item.code} ${item.message}`), ["VEL3001 Unknown name 'cached'"]);
  const shadowed = compile("const cached = 1\nprint(cached)\n");
  assert.deepEqual(shadowed.diagnostics, []);
});

test("deep reactivity retires identity memo caches without changing derivation results", () => {
  const store = compile(`
type Session:
    id: string
    title: string

type Message:
    id: string
    sessionId: string
    text: string

def textOf(message: Message?) -> string:
    return message == null ? "No messages yet" : message.text

def previewOf(message: Message?) -> string:
    print(message == null ? "derive:none" : f"derive:{message.id}")
    return textOf(message)

state sessions: List<Session> = [{id: "s1", title: "one"}, {id: "s2", title: "two"}, {id: "s3", title: "three"}]
state messages: List<Message> = [
    {id: "m1", sessionId: "s1", text: "alpha"},
    {id: "m2", sessionId: "s2", text: "beta"},
    {id: "m3", sessionId: "s3", text: "gamma"},
]

def latestFor(list: List<Message>, sessionId: string) -> Message?:
    const own = list.filter(message => message.sessionId == sessionId)
    return own.size == 0 ? null : own[own.size - 1]

def buildEntries(sessionList: List<Session>, messageList: List<Message>) -> List<string>:
    return sessionList.map(session => previewOf(latestFor(messageList, session.id)))

computed previews = buildEntries(sessions, messages)

watch previews as current, previous:
    print(f"previews:{current.join("|")}")

export def appendChunk(replyId: string, chunk: string):
    const message = messages.find(item => item.id == replyId)
    if message != null:
        message.text += chunk

export def removeSession(id: string):
    sessions = sessions.filter(session => session.id != id)

export def restoreSession(session: Session):
    sessions.append(session)
`.trimStart());
  assert.deepEqual(store.diagnostics, []);
  assert.doesNotMatch(store.code ?? "", /__velar(?:Auto)?Memo/u);
  const execution = executeModule(`
${store.code ?? ""}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
console.log("chunk:s1");
appendChunk("m1", "!");
await flush();
console.log("remove:s2");
const savedSession = sessions.get().find((session) => session.id === "s2");
removeSession("s2");
await flush();
console.log("missed-run");
appendChunk("m1", "?");
await flush();
console.log("restore:s2");
restoreSession(savedSession);
await flush();
`);
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, [
    "derive:m1", "derive:m2", "derive:m3",
    "chunk:s1", "derive:m1", "derive:m2", "derive:m3", "previews:alpha!|beta|gamma",
    "remove:s2", "derive:m1", "derive:m3", "previews:alpha!|gamma",
    "missed-run", "derive:m1", "derive:m3", "previews:alpha!?|gamma",
    "restore:s2", "derive:m1", "derive:m3", "derive:m2", "previews:alpha!?|gamma|beta",
    "",
  ].join("\n"));

  const direct = compile(`
type Message:
    id: string
    text: string

def textOf(message: Message) -> string:
    return message.text

def previewOf(message: Message) -> string:
    print(f"derive:{message.id}")
    return textOf(message)

state items: List<Message> = [{id: "m1", text: "alpha"}, {id: "m2", text: "beta"}]
computed previews = items.map(previewOf)

watch previews as current, previous:
    print(f"previews:{current.join("|")}")

export def snapshot() -> List<string>:
    return items.map(previewOf)

export def touchFirst():
    items[0].text += "!"
`.trimStart());
  assert.deepEqual(direct.diagnostics, []);
  assert.doesNotMatch(direct.code ?? "", /__velar(?:Auto)?Memo/u);
  const directExecution = executeModule(`
${direct.code ?? ""}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
console.log("touch:m1");
touchFirst();
await flush();
console.log("snapshot");
snapshot();
`);
  assert.equal(directExecution.status, 0, String(directExecution.stderr));
  assert.equal(directExecution.stdout, [
    "derive:m1", "derive:m2",
    "touch:m1", "derive:m1", "derive:m2", "previews:alpha!|beta",
    "snapshot", "derive:m1", "derive:m2",
    "",
  ].join("\n"));
});

test("the retired memo surface stays absent from every derivation shape", () => {
  const plain = (source: string, label: string): void => {
    const result = compile(source);
    assert.deepEqual(result.diagnostics, [], label);
    const sites = (result.code ?? "").split("\n")
      .filter((line) => line.includes("__velarAutoMemo(") && !line.includes("function __velarAutoMemo") && !line.trimStart().startsWith("//"));
    assert.deepEqual(sites, [], label);
  };

  // (a) Reading a reactive binding anywhere in the callback graph.
  plain(`
state suffix: string = "!"

def shout(value: string) -> string:
    return value + "?"

def decorate(value: string) -> string:
    return shout(value) + suffix

state items: List<string> = []
computed labels = items.map(decorate)
`.trimStart(), "reactive read");

  // (b) Capturing a mutable module binding.
  plain(`
let counter = 0

def shout(value: string) -> string:
    return value

def label(value: string) -> string:
    return shout(value) + str(counter)

state items: List<string> = []
computed labels = items.map(label)
`.trimStart(), "mutable capture");

  // (c) Calling anything unproved — an async def here.
  plain(`
def shout(value: string) -> string:
    return value + "!"

async def sideEffect():
    return null

def label(value: string) -> string:
    detach sideEffect()
    return shout(value)

state items: List<string> = []
computed labels = items.map(label)
`.trimStart(), "unproved callee");

  // (d) Mutating the argument through member assignment.
  plain(`
type Box:
    value: number

def helperOf(box: Box) -> number:
    return box.value

def bump(box: Box) -> number:
    box.value = box.value + 1
    return helperOf(box)

state boxes: List<Box> = []
computed values = boxes.map(bump)
`.trimStart(), "argument mutation");

  // (e) A trivial non-delegating callback is cheaper than its cache entry.
  plain(`
def double(value: number) -> number:
    return value * 2

state items: List<number> = []
computed doubled = items.map(double)
`.trimStart(), "non-delegating callback");

  // (f) Actions and event handlers are not derivation contexts.
  plain(`
def shout(value: string) -> string:
    return value + "!"

def polish(value: string) -> string:
    return shout(value)

state items: List<string> = []
state output: List<string> = []

export def commit():
    output = items.map(polish)
`.trimStart(), "non-derivation context");

  // The retired globals are ordinary identifiers again: the language
  // exposes no memoization or batching API.
  const freed = compile("const memo = 1\nconst batch = memo + 1\nprint(str(batch))\n");
  assert.deepEqual(freed.diagnostics, []);
  const unknown = compile("const broken = memo(3)\n");
  assert.ok(unknown.diagnostics.some((item) => item.code === "VEL3001" && /Unknown name 'memo'/u.test(item.message)));
});

test("cross-module interfaces no longer carry memo purity markers", async () => {
  const directory = await makeTemporaryDirectory("velar-auto-memo-project-");
  const domainPath = join(directory, "domain.vel");
  const barrelPath = join(directory, "barrel.vel");
  const mainPath = join(directory, "main.vel");
  await writeFile(domainPath, `
export type Message:
    id: string
    text: string

export def messagePreview(latest: Message?, limit: number = 48) -> string:
    if latest == null:
        return "No messages yet"
    return Text.truncate(Text.normalizeWhitespace(latest.text), limit)

export def sessionPreview(messages: List<Message>, sessionId: string) -> string:
    return str(messages.size) + sessionId
`.trimStart(), "utf8");
  await writeFile(barrelPath, "export {Message, messagePreview, sessionPreview} from \"./domain.vel\"\n", "utf8");
  await writeFile(mainPath, `
import {Message, messagePreview} from "./barrel.vel"

type Session:
    id: string

state sessions: List<Session> = []
state latestById: Map<string, Message> = Map()

def buildPreviews(sessionList: List<Session>, latest: Map<string, Message>) -> List<string>:
    return sessionList.map(session => messagePreview(latest.get(session.id)))

computed previews = buildPreviews(sessions, latestById)

mount(<main>{previews.join("|")}</main>, "#app")
`.trimStart(), "utf8");

  const project = await compileProject(mainPath);
  assert.deepEqual(project.failures, []);
  const domain = project.modules.find((module) => module.inputPath === domainPath);
  assert.ok(domain);
  const markers = domain.result.moduleInterface.extensionExports.get("@velarscript/web");
  assert.equal(markers, undefined);
  const main = project.modules.find((module) => module.inputPath === mainPath);
  assert.ok(main);
  assert.deepEqual(main.result.diagnostics, []);
  assert.doesNotMatch(main.result.code ?? "", /__velar(?:Auto)?Memo/u);
});

test("consecutive synchronous state assignments publish once and reads stay fresh", () => {
  // The framework contract the scheduler owns — no API involved: assignments
  // commit immediately (a read between two assignments always sees the
  // latest value, computeds are invalidated synchronously), and every
  // affected computed, watch, and render observer re-runs once per
  // synchronous burst, delivered on the microtask flush. The contract's
  // boundary is the synchronous extent: a burst spread across awaits
  // publishes per assignment.
  const result = compile(`
state left: number = 0
state right: number = 0

def sumOf(a: number, b: number) -> number:
    print(f"sum:{a}:{b}")
    return a + b

computed total = sumOf(left, right)

watch total as current, previous:
    print(f"total:{current}")

export def commitBurst():
    left = left + 1
    print(f"fresh:{left}")
    right = right + 1
    left = left + 1

def nestedCommit():
    right = right + 1

export def deepBurst():
    left = left + 1
    nestedCommit()

export async def spreadBurst():
    left = left + 1
    await tick()
    right = right + 1
    await tick()
    left = left + 1

def throwingCommit():
    left = left + 100
    throw Error("burst failed")

export def throwingBurst():
    throwingCommit()
`.trimStart());
  assert.deepEqual(result.diagnostics, []);
  const execution = executeModule(`
${result.code ?? ""}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
console.log("burst");
commitBurst();
await flush();
console.log("deep");
deepBurst();
await flush();
console.log("spread");
await spreadBurst();
await flush();
console.log("throwing");
try { throwingBurst(); console.log("missing throw"); } catch (error) { console.log("caught:" + error.message); }
await flush();
`);
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, [
    "sum:0:0",
    // Three synchronous assignments, one publication: the read between them
    // is fresh, and the derived total recomputes once, not three times.
    "burst", "fresh:1", "sum:2:1", "total:3",
    // The burst may span helper calls; the synchronous extent is what counts.
    "deep", "sum:3:2", "total:5",
    // Spread across microtask boundaries the same three assignments publish
    // per assignment — the boundary of the contract.
    "spread", "sum:4:2", "total:6", "sum:4:3", "total:7", "sum:5:3", "total:8",
    // A throw does not tear state: what was assigned before the failure
    // still publishes once the microtask flush runs.
    "throwing", "caught:burst failed", "sum:105:3", "total:108",
    "",
  ].join("\n"));
});

test("state publishes deep record and collection mutation through aliases and calls", () => {
  const result = compile(`
type Task:
    label: string
    done: bool

type Meta:
    count: number

type Session:
    title: string
    meta: Meta

state tasks: List<Task> = [{label: "first", done: false}]
state byId: Map<string, Task> = Map()
state byTask: Map<Task, string> = Map()
state selected: Set<string> = Set()
state selectedTasks: Set<Task> = Set()
state session: Session = {title: "old", meta: {count: 0}}
computed doneCount = tasks.filter(task => task.done).size

watch tasks as current, previous:
    print("tasks:" + str(current.size) + ":same=" + str(current == previous))

watch session as current, previous:
    print("session:" + str(current.meta.count) + ":same=" + str(current == previous))

def mark(task: Task):
    task.done = true

export async def exercise():
    const alias = tasks
    alias.append({label: "second", done: false})
    await tick()
    print("size:" + str(tasks.size))
    mark(alias[0])
    await tick()
    print("done:" + str(doneCount))
    byTask.set(alias[0], "first")
    selectedTasks.add(alias[0])
    print("identity:" + str(byTask.get(alias[0])) + ":set=" + str(alias[0] in selectedTasks))
    byId.set("second", alias[1])
    const stored = byId.get("second")
    if stored != null:
        stored.done = true
        selected.add("second")
        session.meta.count += 1
        await tick()
        print("map:" + str(stored.done) + ":set=" + str("second" in selected))
`.trimStart());
  assert.deepEqual(result.diagnostics, []);
  assert.doesNotMatch(result.code ?? "", /__velar(?:Auto)?Memo/u);
  const execution = executeModule(`${result.code ?? ""}\nawait exercise();\n`);
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, [
    "tasks:2:same=true",
    "size:2",
    "tasks:2:same=true",
    "done:1",
    "identity:first:set=true",
    "tasks:2:same=true",
    "session:1:same=true",
    "map:true:set=true",
    "",
  ].join("\n"));

  const propMutation = compile(`
type Task:
    done: bool

component Child(task: Task, tasks: List<Task>):
    def mutate():
        task.done = true
        tasks.append(task)
    return <button type="button" on:click={mutate}>change</button>
`.trimStart());
  const propMessages = propMutation.diagnostics
    .filter((item) => item.code === "VEL3002" || item.code === "VEL4001")
    .map((item) => item.message);
  assert.deepEqual(propMessages, [], JSON.stringify(propMutation.diagnostics));
});

test("deep reactivity isolates record properties and Map keys", () => {
  const result = compile(`
type Sides:
    left: number
    right: number

state pair: Sides = {left: 0, right: 0}
state scores: Map<string, number> = Map()

def readLeft() -> number:
    print("derive:left")
    return pair.left

def readRight() -> number:
    print("derive:right")
    return pair.right

def readScore(key: string) -> number?:
    print("derive:" + key)
    return scores.get(key)

computed leftValue = readLeft()
computed rightValue = readRight()
computed alpha = readScore("alpha")
computed beta = readScore("beta")

watch leftValue as current, previous:
    print("left:" + str(current))

watch rightValue as current, previous:
    print("right:" + str(current))

watch alpha as current, previous:
    print("alpha:" + str(current))

watch beta as current, previous:
    print("beta:" + str(current))

export async def exercise():
    pair.left += 1
    await tick()
    scores.set("alpha", 7)
    await tick()
`.trimStart());
  assert.deepEqual(result.diagnostics, []);
  const execution = executeModule(`${result.code ?? ""}\nawait exercise();\n`);
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, [
    "derive:left", "derive:right", "derive:alpha", "derive:beta",
    "derive:left", "left:1",
    "derive:alpha", "alpha:7",
    "",
  ].join("\n"));
});
