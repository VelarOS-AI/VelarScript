import assert from "node:assert/strict";
import { rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { velarCompilerExtension as webCompilerExtension } from "../../../packages/web/src/compiler.ts";
import { cliProject, messages, run } from "../../support/compiler-audit-suite.ts";

/**
 * D115 P5 — the audit's INCONSISTENT items, one subject of the file that was
 * `bounded-generics-and-dispose.slow.test.ts` before it reached 916 lines.
 *
 * What is held here is the group the audit filed together because each was one
 * rule stated twice and answered differently in the two places: the retirement
 * guidance, `*.test.vel` across check/build/fix, which scopes own resources,
 * what `test name:` is told, `using` on the declared capability handles, and
 * what a JSX attribute value accepts. The harness is in
 * `tests/support/compiler-audit-suite.ts`; the bodies below are the bodies
 * that file had.
 */

// ---------------------------------------------------------------------------
// Audit 12 INCONSISTENT items
// ---------------------------------------------------------------------------

test("[audit 12] the retirement guidance names the spelling that survives, in one round", () => {
  for (const [source, expected] of [
    ['print("a".trimStart())\n', "Use Text.trimStart(value); string operations beyond the core members live in the Text namespace, which needs no import"],
    ['print("a".lstrip())\n', "Use Text.trimStart(value); string operations beyond the core members live in the Text namespace, which needs no import"],
    ['print("a".title())\n', "Use Text.title(value); string operations beyond the core members live in the Text namespace, which needs no import"],
    ['print("a".splitlines().join(""))\n', "Use Text.lines(value); it splits on line boundaries, and the Text namespace needs no import"],
  ] as const) {
    const reported = messages(source);
    assert.ok(reported.includes(expected), `${source}: ${reported.join(" | ")}`);
    for (const message of reported) assert.ok(!message.includes("velar/text"), message);
  }
});

test("[audit 12] check, build, and fix all see a '*.test.vel' module", async () => {
  const project = await cliProject({
    "src/main.vel": "print(\"app\")\n",
    "src/app.test.vel": `
import {expect} from "velar/test"

test "typed":
    const n: number = "not a number"
    expect(n).toBe(1)
`.trimStart(),
  });
  try {
    for (const command of ["check", "build"] as const) {
      const result = project.cli(command, ".");
      assert.equal(result.status, 1, `${command}: ${result.stdout}`);
      assert.match(result.stderr, /src\/app\.test\.vel:4:23 error VEL4001: Cannot assign string to number/u);
    }
    await writeFile(join(project.root, "src", "app.test.vel"), `
import {expect} from "velar/test"

test "typed":
    const values: Array<number> = [1]
    expect(values.size).toBe(1)
`.trimStart(), "utf8");
    const fixed = project.cli("fix", ".");
    assert.equal(fixed.status, 0, fixed.stderr);
    assert.match(fixed.stdout, /src\/app\.test\.vel:4:19 fixed VEL2012/u);
    const checked = project.cli("check", ".");
    assert.equal(checked.status, 0, checked.stderr);
    assert.match(checked.stdout, /Checked 2 modules/u);
  } finally {
    await rm(project.root, { recursive: true, force: true });
  }
});

test("[audit 12] a cleanup hook and a component watch body own resources like every other scope", () => {
  const reported = messages(`
class Handle:
    let open: bool = true

    @dispose:
        self.open = false

component App:
    state local: number = 0

    watch local:
        using watched = Handle()
        print(str(watched.open))

    @cleanup:
        using released = Handle()
        print(str(released.open))

    return <div>{str(local)}</div>
`.trimStart(), [webCompilerExtension]);
  assert.deepEqual(reported, []);
});

test("[audit 12] a component body still has no scope to release at", () => {
  const reported = messages(`
class Handle:
    let open: bool = true

    @dispose:
        self.open = false

component App:
    using handle = Handle()

    return <div>{str(handle.open)}</div>
`.trimStart(), [webCompilerExtension]);
  assert.equal(reported.length, 1);
  assert.match(reported[0]!, /A component body builds the component and does not end/u);
});

test("[audit 12] 'test name:' is told the name is a string rather than called an unknown keyword", () => {
  const reported = messages("test name:\n    print(\"x\")\n");
  assert.ok(
    reported.includes('A test name is the sentence a report prints, so it is written as a string — \'test "name":\''),
    reported.join(" | "),
  );
});

test("[audit 12] 'using' works on the structurally declared capability handles", async () => {
  const node = await cliProject({
    "src/main.vel": `
import {terminal} from "velar/terminal"

async def main():
    using session = terminal
    await session.write("owned\\n")
    return null

detach main()
`.trimStart(),
  });
  try {
    const ran = node.cli("run", ".");
    assert.equal(ran.status, 0, ran.stderr);
    assert.match(ran.stdout, /owned/u);
  } finally {
    await rm(node.root, { recursive: true, force: true });
  }

  const web = await cliProject({
    "src/main.vel": `
import {eventStream} from "velar/realtime"

export component App():
    action listen():
        using stream = eventStream("https://example.com/events")
        print(stream.state())

    return <button on:click={listen}>listen</button>

@main: pass
`.trimStart(),
  }, true);
  try {
    const checked = web.cli("check", ".");
    assert.equal(checked.status, 0, checked.stderr);
  } finally {
    await rm(web.root, { recursive: true, force: true });
  }
});

test("[audit 12] a user record with a close() is still never detected as ownable", () => {
  const reported = messages(`
type Fake:
    close: () -> null

def own(value: Fake):
    using handle = value
    return null
`.trimStart());
  assert.equal(reported.length, 1);
  assert.match(reported[0]!, /VelarScript|'using' releases a value whose type declares '@dispose'/u);
  assert.match(reported[0]!, /a record is data, so it has nothing to release/u);
});

test("[audit 12] a JSX attribute value accepts the language's backtick delimiter", () => {
  const reported = messages(`
export component App():
    return <div title=\`He said "hi"\` class='single'>text</div>
`.trimStart(), [webCompilerExtension]);
  assert.deepEqual(reported, []);
});
