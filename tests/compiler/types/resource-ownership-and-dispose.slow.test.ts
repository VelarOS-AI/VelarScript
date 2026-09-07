import assert from "node:assert/strict";
import { rm } from "node:fs/promises";
import test from "node:test";
import { compile } from "@velarscript/compiler";
import { clean, cliProject, execute, messages, run } from "../../support/compiler-audit-suite.ts";

/**
 * D115 P5 — owned resources and their release, one subject of the file that
 * was `bounded-generics-and-dispose.slow.test.ts` before it reached 916 lines.
 *
 * What is held here is everything about a handle's lifetime: a derived
 * `@dispose` chains to its base and cannot start awaiting where the base does
 * not (NEW-D4, rule 102), a JavaScript handle has a spelling that actually
 * releases (NEW-D5), and an owned resource does not leave the scope that owns
 * it (rule 101). The harness is in `tests/support/compiler-audit-suite.ts`;
 * the bodies below are the bodies that file had.
 */

// ---------------------------------------------------------------------------
// NEW-D4 + rule 102 — derived disposal chains, and cannot add awaiting
// ---------------------------------------------------------------------------

test("[rule 102] a derived '@dispose' runs before the base's, and both run", () => {
  const output = run(`
class BaseHandle:
    const label: string

    constructor(label: string):
        self.label = label

    @dispose:
        print("base " + self.label)

class DerivedHandle extends BaseHandle:
    constructor(label: string):
        super(label)

    @dispose:
        print("derived " + self.label)

def main():
    using owned = DerivedHandle("report")
    print("body")
    return null

main()
`.trimStart());
  assert.equal(output, "body\nderived report\nbase report\n");
});

test("[rule 102] the base release still runs when the derived part throws, and the first error propagates", () => {
  const result = compile(`
class BaseHandle:
    @dispose:
        print("base released")

class DerivedHandle extends BaseHandle:
    @dispose:
        throw Error("derived release failed")

def main():
    using owned = DerivedHandle()
    print("body")
    return null

main()
`.trimStart());
  assert.deepEqual(result.diagnostics, []);
  const execution = execute(result.code ?? "");
  assert.notEqual(execution.status, 0);
  assert.match(execution.stdout, /body\nbase released/u);
  assert.match(execution.stderr, /derived release failed/u);
});

test("[NEW-D4] a subclass cannot start awaiting in '@dispose' where its base releases without awaiting", () => {
  const reported = messages(`
class BaseHandle:
    @dispose:
        print("base")

class DerivedHandle extends BaseHandle:
    @dispose:
        await Promise.sleep(1ms)
        print("derived")
`.trimStart());
  assert.deepEqual(reported, [
    "Class 'DerivedHandle' awaits in '@dispose', but 'BaseHandle' releases without awaiting; "
    + "a 'using' that owns this value through 'BaseHandle' would not await the release — "
    + "move the awaiting work into the base's '@dispose', or release it there",
  ]);
});

test("[NEW-D4] an awaiting base carries every subclass, so owning through either type needs an async scope", () => {
  const reported = messages(`
class BaseHandle:
    @dispose:
        await Promise.sleep(1ms)

class DerivedHandle extends BaseHandle:
    @dispose:
        print("derived")

def main():
    using owned = DerivedHandle()
    return null
`.trimStart());
  assert.deepEqual(reported, [
    "Releasing DerivedHandle awaits, so its 'using' needs an async scope; declare the enclosing function 'async def'",
  ]);
});

// ---------------------------------------------------------------------------
// NEW-D5 — a JavaScript handle has a spelling that works
// ---------------------------------------------------------------------------

test("[NEW-D5] 'using' over an unsafe JavaScript value is rejected instead of degrading to a plain const", async () => {
  const project = await cliProject({
    "node_modules/handle-sdk/package.json": JSON.stringify({ name: "handle-sdk", type: "module", exports: "./index.js" }),
    "node_modules/handle-sdk/index.js": "export function openHandle(name) { return { name, close() { console.log('closed ' + name); } }; }\n",
    "src/main.vel": `
import js unsafe {openHandle} from "handle-sdk"

def main():
    print(f"{openHandle("report") != null}")
    using handle = openHandle
    return null

main()
`.trimStart(),
  });
  try {
    const checked = project.cli("check", ".");
    assert.equal(checked.status, 1, checked.stdout);
    // D90 R17: the unsafe import is unknown now — the call is refused toward a
    // declaration, and the `using` refusal reads `unknown` for the same value.
    // They sit on separate lines because AS-I7 gives a refused call the error
    // type, so owning its result is no longer a second report of one mistake.    assert.match(checked.stderr, /VEL4001: Cannot call an unknown JavaScript value without a declaration or validation/u);
    assert.match(checked.stderr, /VEL4032: 'using' releases a value whose type declares '@dispose'; unknown does not; a JavaScript value carries no release contract; hold it in a field of a VelarScript class whose '@dispose:' block releases it, then own that wrapper/u);
  } finally {
    await rm(project.root, { recursive: true, force: true });
  }
});

test("[NEW-D5] an extern class is told to compose, and the composition spelling actually releases", async () => {
  const project = await cliProject({
    "node_modules/handle-sdk/package.json": JSON.stringify({ name: "handle-sdk", type: "module", exports: "./index.js" }),
    "node_modules/handle-sdk/index.js": `
export class Handle {
  constructor(name) { this.name = name; }
  close() { console.log("closed " + this.name); return null; }
}
export function openHandle(name) { return new Handle(name); }
`.trimStart(),
    "src/direct.vel": `
extern module "handle-sdk":
    export class Handle:
        def close() -> null

    export def openHandle(name: string) -> Handle

import js {openHandle} from "handle-sdk"

def main():
    using handle = openHandle("report")
    return null

main()
`.trimStart(),
    "src/main.vel": `
extern module "handle-sdk":
    export class Handle:
        def close() -> null

    export def openHandle(name: string) -> Handle

import js {Handle, openHandle} from "handle-sdk"

class OwnedHandle:
    const handle: Handle

    constructor(name: string):
        self.handle = openHandle(name)

    @dispose:
        self.handle.close()

def main():
    using owned = OwnedHandle("report")
    print("body")
    return null

main()
`.trimStart(),
  });
  try {
    const direct = project.cli("check", "src/direct.vel");
    assert.equal(direct.status, 1, direct.stdout);
    assert.match(direct.stderr, /an extern class declares the foreign shape and cannot declare '@dispose:'; hold it in a field of a VelarScript class whose '@dispose:' block releases it, then own that wrapper/u);
    const composed = project.cli("run", ".");
    assert.equal(composed.status, 0, composed.stderr);
    assert.equal(composed.stdout, "body\nclosed report\n");
  } finally {
    await rm(project.root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Rule 101 — an owned resource does not leave its scope
// ---------------------------------------------------------------------------

test("[rule 101] returning, aliasing, storing, and capturing an owned handle are all rejected", () => {
  const prelude = `
class Handle:
    let open: bool = true

    @dispose:
        self.open = false

let leaked: Handle? = null

def borrow(handle: Handle) -> bool:
    return handle.open
`.trimStart();
  for (const body of [
    "def escape() -> Handle:\n    using handle = Handle()\n    return handle\n",
    "def escape() -> Handle:\n    using handle = Handle()\n    const alias = handle\n    return alias\n",
    "def escape():\n    using handle = Handle()\n    leaked = handle\n    return null\n",
    "def escape() -> () -> bool:\n    using handle = Handle()\n    return () => handle.open\n",
    "def escape() -> List<Handle>:\n    using handle = Handle()\n    return [handle]\n",
  ]) {
    const reported = messages(`${prelude}\n${body}`);
    assert.equal(reported.length, 1, `${body}: ${reported.join(" | ")}`);
    assert.match(reported[0]!, /^'handle' is owned by this scope, which releases it on the way out/u);
    assert.match(reported[0]!, /move the 'using' up to the scope that really owns it/u);
  }
});

test("[rule 101] borrowing, reading data out, and a same-scope alias stay legal", () => {
  clean(`
class Handle:
    let open: bool = true

    @dispose:
        self.open = false

def borrow(handle: Handle) -> bool:
    return handle.open

def legalBorrow() -> bool:
    using handle = Handle()
    return borrow(handle)

def legalData() -> bool:
    using handle = Handle()
    return handle.open

def legalLocal() -> bool:
    using handle = Handle()
    let inner = handle
    return inner.open
`.trimStart());
});
