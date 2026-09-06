import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { velarCompilerExtension, webModuleSource } from "../../packages/web/src/compiler.ts";
import { compileWeb as compile } from "../support/compile.ts";
import { documentStandIn as dom } from "../support/document.ts";


function emitted(source: string): string {
  const result = compile(source);
  assert.deepEqual(result.diagnostics, []);
  return result.code ?? "";
}


function execute(code: string, probe: string): string {
  const execution = spawnSync(process.execPath, ["--input-type=module"], {
    encoding: "utf8",
    input: `${dom}\n${code}\n${probe}`,
  });
  assert.equal(execution.status, 0, String(execution.stderr));
  return execution.stdout;
}

// `trace` is an ordinary `let`, not state, so recording a prop expression's run
// does not make that expression depend on the record and re-run itself.
const orderedApplication = `
let trace = ""
state pulse: number = 0
state seed: number = 1

def note(mark: string) -> string:
    trace = trace + mark
    return mark

component Child(first: string, second: string, spare: string, shown: string):
    trace = trace + "|body|"
    return <p>{first}{second}{shown}</p>

component App:
    return <div><Child second={note("b")} first={note("a")} spare={note("u")} shown={note("s") + str(seed)} /></div>
`.trimStart();

test("[closeout co-1] a component element evaluates its props at the call site in written order", () => {
  const code = emitted(orderedApplication);
  // The call site still hands the runtime one thunk per prop, in written order,
  // and the component body still declares its parameters in its own order. What
  // changed is who runs the thunks: the instantiation site, before the call.
  assert.match(code, /__velarChild\(Child, \{ second: \(\) => \(note\("b"\)\), first: \(\) => \(note\("a"\)\), spare: \(\) => \(note\("u"\)\), shown: /u);
  assert.match(code, /const first = __velarRequiredProp\(__velarProps, "first", "Child"\);\n\s*const second = __velarRequiredProp/u);
  assert.match(code, /for \(let index = 0; index < accesses\.length; index \+= 1\) accesses\[index\]\.get\(\);/u);

  const stdout = execute(code, `
const app = App();
console.log("construct:" + trace + ":" + readText(app.node));
await flush();
console.log("mounted:" + trace);
pulse.set(pulse.get() + 1);
await flush();
console.log("unrelated:" + trace);
seed.set(2);
await flush();
console.log("seed:" + trace + ":" + readText(app.node));
`);
  assert.equal(stdout, [
    // 'b' before 'a' because the caller wrote 'second' before 'first', every
    // prop exactly once, and all of them before the component body ran. The
    // unread 'spare' is evaluated with the rest: the charter promises the
    // expression runs, not that someone reads it.
    "construct:baus|body|:abs1",
    // Nothing re-runs on mount, and nothing re-runs for a state the props do
    // not read -- that is R4-b's other half, which this change keeps.
    "mounted:baus|body|",
    "unrelated:baus|body|",
    // Only the prop built from 'seed' recomputes, and the position that shows
    // it takes the new value.
    "seed:baus|body|s:abs2",
    "",
  ].join("\n"));
});

test("[closeout co-1] the module-level instantiation site forces its props the same way", () => {
  // A component element outside any component scope instantiates rather than
  // becoming a child; both reach the same store, so both owe the caller the
  // same evaluation order. The module-evaluation site goes through
  // __velarModuleInstantiate, which only catches the construction failure that
  // used to escape module evaluation -- the store, the order and the eager
  // forcing are __velarInstantiate's own and unchanged.
  const application = `
let trace = ""

def note(mark: string) -> string:
    trace = trace + mark
    return mark

component Child(first: string, second: string):
    trace = trace + "|body|"
    return <p>{first}{second}</p>

const root = <Child second={note("b")} first={note("a")} />
`.trimStart();
  const code = emitted(application);
  assert.match(code, /const root = __velarModuleInstantiate\(Child, \{ second: \(\) => \(note\("b"\)\), first: \(\) => \(note\("a"\)\) \}/u);
  assert.equal(execute(code, `
console.log("root:" + trace + ":" + readText(root.node));
`), "root:ba|body|:ab\n");
});

test("[closeout co-1] a required children slot is built only by the position that renders it", () => {
  // `children` is rendered content, not an ordinary value prop. The required
  // prop check must prove the slot is present without building it; otherwise a
  // resource or other owned child starts once for the check and again for the
  // actual rendered position.
  const application = `
let trace = ""

def note(mark: string) -> string:
    trace = trace + mark
    return mark

component Panel(children: WebNode):
    return <section>{children}</section>

component App:
    return <Panel>{note("c")}</Panel>
`.trimStart();
  const code = emitted(application);
  assert.match(code, /if \(name === "children"\) return __velarGraphOwnDescriptor\(props, name\) !== undefined;/u);
  assert.equal(execute(code, `
const app = App();
console.log("construct:" + trace + ":" + readText(app.node));
`), "construct:c:c\n");
});

test("[closeout co-1] a 'style:' directive decorates the instance root and is not a prop", () => {
  // The slot the compiler inserts for `style:` is not a field any component
  // declares, so it is bound at the instantiation site for every component
  // alike rather than forced with the props and handed inward -- which is also
  // what lets a component the runtime implements, validating its props against
  // the fields it declares, be a style host at all.
  const application = `
let trace = ""
state tone: string? = "purple"

def note(mark: string) -> string:
    trace = trace + mark
    return mark

component Child(first: string):
    return <p>{first}</p>

component App:
    return <div><Child style:color={tone} first={note("a")} /></div>
`.trimStart();
  const code = emitted(application);
  assert.match(code, /__velarStyle: \(\) => \(/u);
  // The slot never reaches the props store, and no component body binds it any
  // more: one site owns it, for every component.
  assert.match(code, /if \(name === "__velarStyle"\) continue;/u);
  assert.match(code, /if \(styleRead !== undefined\) __velarStyleBindRoot\(instance\.node, styleRead, scope\);/u);
  assert.doesNotMatch(code, /__velarProps\.__velarStyle/u);
  assert.equal(execute(code, `
const app = App();
const child = app.node.childNodes[0];
const read = () => child.style.properties.get("color") ?? "missing";
console.log("construct:" + trace + ":" + read());
tone.set("orange");
await flush();
console.log("updated:" + trace + ":" + read());
app.destroy();
console.log("cleanup:" + read());
`), [
    // Only the prop ran at the call site; the style is bound to the root the
    // component returned, and it follows the state it was built from.
    "construct:a:purple",
    "updated:a:orange",
    "cleanup:missing",
    "",
  ].join("\n"));
});

test("[closeout co-4, co-8] the snapshot-props branch and its flag are gone", () => {
  // Leaving a branch nothing can reach is what this audit kept finding, so the
  // mechanism goes with its last user rather than staying behind a dead flag.
  const runtime = webModuleSource("velar/web") ?? "";
  assert.ok(runtime.length > 0);
  assert.doesNotMatch(runtime, /__velarSnapshotProps/u);
  assert.doesNotMatch(emitted("component App:\n    return <p>ok</p>\n"), /__velarSnapshotProps/u);
});

test("[closeout co-4] all four framework components validate live props and read them where they are used", () => {
  const runtime = webModuleSource("velar/web") ?? "";
  // One rule for four siblings: reactive state changed, the component updates.
  for (const name of ["Head props", "Router props", "Link props", "NavLink props"]) {
    assert.match(runtime, new RegExp(`__velarLiveOptions\\(props, "${name}"`, "u"));
  }
  for (const detail of ["\"head\", \"Head\"", "\"router\", \"Router\"", "\"link\", \"Link\"", "\"navlink\", \"NavLink\""]) {
    assert.ok(runtime.includes(`}, ${detail});`), `missing observer for ${detail}`);
  }
  // A NavLink hands its Link the live fields rather than a copy of their
  // values, so the wrapped href moves with the state the target is built from.
  assert.match(runtime, /get to\(\) \{ return props\.to; \}/u);
  // Reading props inside an observer is what makes a component live; building a
  // subtree there is not, so a Router's route target keeps its own reads.
  assert.match(runtime, /const next = webUntracked\(\(\) => \(match \? match\.item\.component/u);
});
