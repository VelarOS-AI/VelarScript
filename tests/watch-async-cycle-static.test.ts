import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { compile as compileCore } from "@velarscript/compiler";
import { compileProject } from "../packages/cli/src/project.ts";
import { velarCompilerExtension } from "../packages/web/src/compiler.ts";

// D114 W A2: the two asynchronous watch cycles a compile can prove.
//
// A cycle that crosses an `await` is a new flush every round, which is why A1
// moved the runtime budget from the flush to the task. The budget is a
// backstop, though: it stops a frozen page, it does not tell an author which
// two lines made it. Two shapes are provable where they are written, with no
// call graph and no cross-module reasoning, and those two are refused here.
//
//  (a) The subject is a `resource` field and the body reloads that same
//      resource. A reload writes `value`, `loading`, `ready` and `error`, so
//      every completed load re-triggers the watch that started it. The charter
//      and the tour teach the other spelling in the same breath -- watch the
//      *input* the load reads -- so the refusal has a correct line to name.
//
//  (b) The body starts an `action` or an `async def` of this module whose own
//      top level writes the watched place, unconditionally. One hop, one
//      module, no condition on either end.
//
// The boundary is the point. D90 R21 deleted the analysis of who writes what
// across calls, and this restores exactly one hop of it -- for two shapes with
// a named correct spelling, and nothing else. Two hops, another module, a
// condition at either end, or an ordinary `def` and the answer is silence: the
// runtime budget owns those, and a cycle that crosses the network cannot be
// decided by anybody.

function compile(text: string) {
  return compileCore(text.trimStart(), { extensions: [velarCompilerExtension] });
}

/** Every diagnostic of the compile, `CODE message`, so a "stays legal" case cannot pass by being broken. */
function messages(source: string): readonly string[] {
  return compile(source).diagnostics.map((item) => `${item.code} ${item.message}`);
}

/** Every diagnostic of a whole project, in module order, for the cross-module cases. */
async function projectMessages(files: Readonly<Record<string, string>>): Promise<readonly string[]> {
  const directory = await mkdtemp(join(tmpdir(), "velar-d114-a2-"));
  try {
    const overrides = new Map(Object.entries(files).map(([name, text]) => [join(directory, name), text.trimStart()]));
    const project = await compileProject(join(directory, "main.vel"), overrides, { extensions: [velarCompilerExtension] });
    assert.deepEqual(project.failures.map((item) => item.message), []);
    return project.modules.flatMap((module) => module.result.diagnostics.map((item) => `${item.code} ${item.message}`));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

function reloadsOwnResource(name: string): string {
  return `VEL5078 This watch reloads '${name}' — the resource it watches — so every completed load re-triggers it;`
    + ` watch the input the load reads instead, as 'watch userId:' with 'detach ${name}.reload()' in its body`;
}

function startsWriter(callee: string, path: string): string {
  return `VEL5079 This watch starts '${callee}', which writes '${path}' — the reactive value this watch is on —`
    + ` so each completed run re-triggers the watch; make the write conditional, or watch the input '${callee}' reads`;
}

/** The loader every resource case declares, so each fixture is only its watch. */
const loader = `
type User:
    name: string

async def loadUser(id: string) -> User:
    return {name: id}
`;

// ---------------------------------------------------------------------------
// (a) the watch that reloads the resource it watches
// ---------------------------------------------------------------------------

test("[W-A2a] a watch on a resource field that reloads that resource is refused", () => {
  assert.deepEqual(messages(`${loader}
component Profile(userId: string):
    resource profile: User = loadUser(userId)

    watch profile.value:
        detach profile.reload()

    return <p>{profile.value?.name ?? ""}</p>
`), [reloadsOwnResource("profile")]);
});

test("[W-A2a] every field a reload writes is watched by the same rule", () => {
  // A reload writes all four, so watching any of them and reloading is the
  // same cycle. The rule asks the resource's own field roster rather than a
  // second list of names, so the four move together by construction.
  for (const field of ["value", "loading", "ready", "error"]) {
    assert.deepEqual(messages(`${loader}
component Profile(userId: string):
    resource profile: User = loadUser(userId)

    watch profile.${field}:
        detach profile.reload()

    return <p>{profile.value?.name ?? ""}</p>
`), [reloadsOwnResource("profile")], field);
  }
});

test("[W-A2a] the undetached call is refused too, beside the answer it already had", () => {
  // A watch body is synchronous, so a bare `reload()` also discards a Promise
  // and VEL4027 says so. The two are different mistakes on one line -- one
  // about how the call is started, one about what it re-triggers -- and both
  // are true.
  assert.deepEqual(messages(`${loader}
component Profile(userId: string):
    resource profile: User = loadUser(userId)

    watch profile.value:
        profile.reload()

    return <p>{profile.value?.name ?? ""}</p>
`), [
    "VEL4027 This call returns Promise<null>; 'await profile.reload()' to wait for it,"
    + " or 'detach profile.reload()' to run it detached",
    reloadsOwnResource("profile"),
  ]);
});

test("[W-A2a] the refusal is an error and blocks emission", () => {
  const result = compile(`${loader}
component Profile(userId: string):
    resource profile: User = loadUser(userId)

    watch profile.value:
        detach profile.reload()

    return <p>{profile.value?.name ?? ""}</p>
`);
  assert.deepEqual(result.diagnostics.map((item) => item.code), ["VEL5078"]);
  assert.equal(result.code, null);
});

test("[W-A2a] watching the input is the spelling the charter teaches, and stays legal", () => {
  // The whole of examples/tour/web/04 and four charter fences. If this ever
  // reported, the refusal would be refusing the thing it names as the fix.
  assert.deepEqual(messages(`${loader}
component Profile(userId: string):
    resource profile: User = loadUser(userId)

    watch userId:
        detach profile.reload()

    return <p>{profile.value?.name ?? ""}</p>
`), []);
});

test("[W-A2a] a conditional reload may converge and stays legal", () => {
  assert.deepEqual(messages(`${loader}
component Profile(userId: string, live: bool):
    resource profile: User = loadUser(userId)

    watch profile.value:
        if live:
            detach profile.reload()

    return <p>{profile.value?.name ?? ""}</p>
`), []);
});

test("[W-A2a] reloading a different resource is not a cycle", () => {
  // The refusal is about one resource reloading itself. A watch on one
  // resource's value that refreshes a dependent one is an ordinary program.
  assert.deepEqual(messages(`${loader}
component Profile(userId: string):
    resource profile: User = loadUser(userId)
    resource friend: User = loadUser("friend")

    watch profile.value:
        detach friend.reload()

    return <p>{profile.value?.name ?? ""}{friend.value?.name ?? ""}</p>
`), []);
});

// ---------------------------------------------------------------------------
// (b) the watch that starts a writer of what it watches
// ---------------------------------------------------------------------------

test("[W-A2b] a watch that detaches an action writing its subject is refused", () => {
  assert.deepEqual(messages(`
state items: List<string> = []

action save():
    items = ["saved"]
    await tick()

watch items:
    detach save()
`), [startsWriter("save", "items")]);
});

test("[W-A2b] an async def is the same shape, before or after the await", () => {
  for (const body of ["    items = [\"saved\"]\n    await tick()", "    await tick()\n    items = [\"saved\"]"]) {
    assert.deepEqual(messages(`
state items: List<string> = []

async def save():
${body}

watch items:
    detach save()
`), [startsWriter("save", "items")], body);
  }
});

test("[W-A2b] a mutating collection call in the writer is a write of the subject", () => {
  assert.deepEqual(messages(`
state items: List<string> = []

action save():
    await tick()
    items.append("saved")

watch items:
    detach save()
`), [startsWriter("save", "items")]);
});

test("[W-A2b] a component action and a component watch are the same module", () => {
  assert.deepEqual(messages(`
component Editor:
    state items: List<string> = []

    action save():
        await tick()
        items = ["saved"]

    watch items:
        detach save()

    return <p>{str(items.size)}</p>
`), [startsWriter("save", "items")]);
});

test("[W-A2b] the refusal is an error and blocks emission", () => {
  const result = compile(`
state items: List<string> = []

action save():
    await tick()
    items = ["saved"]

watch items:
    detach save()
`);
  assert.deepEqual(result.diagnostics.map((item) => item.code), ["VEL5079"]);
  assert.equal(result.code, null);
});

test("[W-A2b] a conditional write in the writer may converge and stays legal", () => {
  assert.deepEqual(messages(`
state items: List<string> = []
state live = false

action save():
    await tick()
    if live:
        items = ["saved"]

watch items:
    detach save()
`), []);
});

test("[W-A2b] a writer of a different state is an ordinary program", () => {
  assert.deepEqual(messages(`
state items: List<string> = []
state saves = 0

action save():
    await tick()
    saves = saves + 1

watch items:
    detach save()
`), []);
});

test("[W-A2b] a conditional call is the author's own condition and stays legal", () => {
  assert.deepEqual(messages(`
state items: List<string> = []
state live = false

action save():
    await tick()
    items = ["saved"]

watch items:
    if live:
        detach save()
`), []);
});

test("[W-A2b] an ordinary def is not this rule's business", () => {
  // A synchronous helper that writes the subject is the shape D90 R21 ruled is
  // silent, and it is one flush, so the flush budget already sees it. Only the
  // asynchronous spellings -- the ones that escape a flush -- are refused.
  assert.deepEqual(messages(`
state items: List<string> = []

def save():
    items = ["saved"]

watch items:
    save()
`), []);
});

test("[W-A2b] a writer whose own parameter is spelled like the subject writes its parameter", () => {
  assert.deepEqual(messages(`
state items: List<string> = []

action save(items: List<string>):
    await tick()
    items.append("saved")

watch items:
    detach save(items)
`), []);
});

test("[W-A2b] a writer whose name is declared twice is ambiguous, and silence is the answer", () => {
  // Two candidates mean the refusal does not know which body the call reaches,
  // and a rule that has to be right every time answers nothing rather than
  // guessing. The inner declaration below is what makes the name ambiguous.
  assert.deepEqual(messages(`
state items: List<string> = []

action save():
    await tick()
    items = ["saved"]

def outer():
    def save():
        print("other")
    save()

watch items:
    detach save()
`), []);
});

test("[W-A2b] a writer imported from another module is out of reach on purpose", async () => {
  // One module. R16-a widened a rule like this across modules and R21 revoked
  // the whole family; the refusal here does not follow an import, and the
  // runtime budget is what stands behind the shape.
  assert.deepEqual(await projectMessages({
    "store.vel": `
export state items: List<string> = []

export action save():
    await tick()
    items = ["saved"]
`,
    "main.vel": `
import {items, save} from "./store.vel"

watch items:
    detach save()

print(str(items.size))
`,
  }), []);
});
