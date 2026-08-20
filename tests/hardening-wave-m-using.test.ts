import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { compile } from "@velarscript/compiler";
import { velarCompilerExtension } from "@velarscript/web/compiler";
import { velarNodeCompilerExtension } from "@velarscript/node/compiler";
import { compileProject } from "../packages/cli/src/project.ts";

// D43 item 69 — `using` ownership and the `@dispose` release contract.

const handle = `
class Handle:
    constructor(const label: string):
        pass

    def close():
        print(f"release {self.label}")

    @dispose:
        self.close()
`.trimStart();

function execute(code: string): ReturnType<typeof spawnSync> {
  return spawnSync(process.execPath, ["--input-type=module"], { encoding: "utf8", input: code, timeout: 5_000 });
}

function run(source: string): { readonly stdout: string; readonly stderr: string } {
  const result = compile(source.trimStart());
  assert.deepEqual(result.diagnostics, []);
  const execution = execute(result.code ?? "");
  assert.equal(execution.status, 0, String(execution.stderr));
  return { stdout: String(execution.stdout), stderr: String(execution.stderr) };
}

function diagnostics(source: string, web = false): readonly string[] {
  return compile(source.trimStart(), web ? { extensions: [velarCompilerExtension] } : {})
    .diagnostics.map((item) => `${item.code} ${item.message}`);
}

test("[D43 69] every scope exit releases, in reverse declaration order", () => {
  const output = run(`${handle}
def normal():
    using first = Handle("normal-1")
    using second = Handle("normal-2")
    print("normal body")

def early() -> number:
    using first = Handle("return-1")
    using second = Handle("return-2")
    return 7

def breaking():
    for index in [1, 2]:
        using owned = Handle(f"break-{index}")
        if index == 2:
            break
        print("iteration")

def continuing():
    for index in [1, 2]:
        using owned = Handle(f"continue-{index}")
        continue

def failing():
    using owned = Handle("throw")
    throw Error("boom")

normal()
print(f"returned {early()}")
breaking()
continuing()
try:
    failing()
catch error:
    print(f"caught {error.message}")
`);
  assert.equal(output.stdout, [
    "normal body",
    "release normal-2",
    "release normal-1",
    "release return-2",
    "release return-1",
    "returned 7",
    "iteration",
    "release break-1",
    "release break-2",
    "release continue-1",
    "release continue-2",
    "release throw",
    "caught boom",
    "",
  ].join("\n"));
});

test("[D43 69] a loop body releases on every iteration, not once at the end", () => {
  const output = run(`${handle}
def drain():
    for index in [1, 2, 3]:
        using owned = Handle(f"pass-{index}")
        print(f"work {index}")

drain()
`);
  assert.equal(output.stdout, "work 1\nrelease pass-1\nwork 2\nrelease pass-2\nwork 3\nrelease pass-3\n");
});

test("[D43 69] a release is idempotent, so an explicit close before scope exit is safe", () => {
  const output = run(`
class Handle:
    let closed: bool = false

    def close():
        if self.closed:
            print("already closed")
            return null
        self.closed = true
        print("closing")

    @dispose:
        self.close()

def main():
    using owned = Handle()
    owned.close()
    print("body")

main()
`);
  assert.equal(output.stdout, "closing\nbody\nalready closed\n");
});

test("[D43 69] a release failure never replaces an error already in flight", () => {
  const output = run(`
class Fragile:
    @dispose:
        throw Error("release failed")

def withError():
    using owned = Fragile()
    throw Error("original")

def withoutError():
    using owned = Fragile()
    print("clean body")

try:
    withError()
catch error:
    print(f"caught {error.message}")
try:
    withoutError()
catch error:
    print(f"caught {error.message}")
`);
  // In flight: the author's error propagates and the release failure is
  // reported to the host. No error in flight: the release failure throws.
  assert.equal(output.stdout, "caught original\nclean body\ncaught release failed\n");
  assert.match(output.stderr, /Resource release failed while another error was in flight: Error: release failed/u);
});

test("[D43 69] an awaiting release needs an async scope, and acquisition stays ordinary async", () => {
  const asynchronous = `
class Handle:
    async def close():
        print("released")

    @dispose:
        await self.close()
`.trimStart();

  const rejected = diagnostics(`${asynchronous}
def main():
    using owned = Handle()
    print("body")
`);
  assert.equal(rejected.length, 1);
  assert.match(rejected[0]!, /^VEL4033 Releasing Handle awaits, so its 'using' needs an async scope/u);

  const output = run(`${asynchronous}
async def open() -> Handle:
    return Handle()

async def main():
    using owned = await open()
    print("body")

await main()
`);
  assert.equal(output.stdout, "body\nreleased\n");
});

test("[D43 69] '@dispose' is not callable and coexists with an ordinary 'dispose' method", () => {
  const output = run(`
class Handle:
    def dispose() -> string:
        return "ordinary method"

    def close():
        print("released")

    @dispose:
        self.close()

def main():
    using owned = Handle()
    print(owned.dispose())

main()
`);
  assert.equal(output.stdout, "ordinary method\nreleased\n");

  const reported = diagnostics(`
class Handle:
    @dispose:
        print("released")

def main():
    const owned = Handle()
    owned["__velar:dispose"]()
`);
  assert.ok(reported.length > 0, "the emitted release key is not reachable from source");
});

test("[D43 69] a class may declare at most one '@dispose', and no other '@' member", () => {
  assert.ok(diagnostics(`
class Handle:
    @dispose:
        pass
    @dispose:
        pass
`).some((item) => /^VEL2022 Class 'Handle' has more than one '@dispose' block/u.test(item)));

  assert.ok(diagnostics(`
class Handle:
    @release:
        pass
`).some((item) => /^VEL2022 Unknown compiler-owned name '@release' in a class/u.test(item)));
});

test("[D43 69] ownership requires a scope that ends", () => {
  const moduleLevel = diagnostics(`
class Handle:
    @dispose:
        pass

using owned = Handle()
print("x")
`);
  assert.ok(moduleLevel.some((item) => /^VEL3018 A module lives until the process ends/u.test(item)), moduleLevel.join("\n"));

  const component = diagnostics(`
class Handle:
    @dispose:
        pass

component Panel():
    using owned = Handle()

    return <div>ok</div>
`, true);
  assert.ok(component.some((item) => /^VEL3018 A component body builds the component and does not end/u.test(item)), component.join("\n"));
});

test("[D43 69] a record is data and cannot be owned", () => {
  const reported = diagnostics(`
type Session:
    close: () -> null

def main():
    const value: Session = { close: () => null }
    using owned = value
    print("x")
`);
  assert.equal(reported.length, 1);
  assert.match(reported[0]!, /^VEL4032 'using' releases a value whose type declares '@dispose'; Session does not/u);
  assert.match(reported[0]!, /a record is data, so it has nothing to release/u);
});

test("[D43 69] 'using' stays an ordinary name everywhere it is not the statement head", () => {
  const output = run(`
def main():
    const using = 3
    print(f"{using}")

main()
`);
  assert.equal(output.stdout, "3\n");

  const annotated = diagnostics(`
class Handle:
    @dispose:
        pass

def main():
    using owned: Handle = Handle()
    print("x")
`);
  assert.ok(annotated.some((item) => /^VEL2036 A 'using' binding takes its type from the initializer/u.test(item)), annotated.join("\n"));
});

test("[D43 69] the compiler supplies the contract for standard capability handles", async () => {
  const directory = join(tmpdir(), "velar-wave-m-using-capability");
  const entry = join(directory, "main.vel");
  const project = await compileProject(entry, new Map([[entry, `
import {watchFiles} from "velar/fs"
import {start} from "velar/process"
import {serve, ServeRequest, ServeResponse} from "velar/serve"

async def watch(path: string):
    using watcher = await watchFiles(path)
    async for batch in watcher:
        print(f"{batch.paths.size}")

async def build():
    using task = await start("node", ["--version"])
    print(f"{task.pid}")

async def respond(request: ServeRequest) -> ServeResponse:
    return { status: 200, text: "ok" }

async def host():
    using server = await serve(respond, 0)
    print(f"{server.port}")

`.trimStart()]]), { sourceRoot: directory, projectRoot: directory, extensions: [velarNodeCompilerExtension] });
  assert.deepEqual(project.failures, []);
  assert.deepEqual(project.modules.flatMap((module) => module.result.diagnostics), []);
  // FileWatcher releases through close(), Process and Server through stop() —
  // no capability name changed to gain `using`.
  const emitted = project.modules.find((module) => module.inputPath === entry)?.result.code ?? "";
  assert.match(emitted, /await watcher\.close\(\)/u);
  assert.match(emitted, /await task\.stop\(\)/u);
  assert.match(emitted, /await server\.stop\(\)/u);

  const unawaited = await compileProject(entry, new Map([[entry, `
import {watchFiles} from "velar/fs"

def missingAwait(path: string):
    using watcher = watchFiles(path)
    print("no")
`.trimStart()]]), { sourceRoot: directory, projectRoot: directory, extensions: [velarNodeCompilerExtension] });
  const reported = unawaited.modules.flatMap((module) => module.result.diagnostics.map((item) => `${item.code} ${item.message}`));
  assert.equal(reported.length, 1, reported.join("\n"));
  assert.match(reported[0]!, /^VEL4032 .*Promise<FileWatcher> does not; acquisition is ordinary async work/u);
});

test("[D43 69] the release contract crosses a module boundary with its class", async () => {
  const directory = join(tmpdir(), "velar-wave-m-using-module");
  const entry = join(directory, "main.vel");
  const helper = join(directory, "handle.vel");
  const project = await compileProject(entry, new Map([
    [helper, `
export class Handle:
    def close():
        print("released")

    @dispose:
        self.close()
`.trimStart()],
    [entry, `
import {Handle} from "./handle.vel"

def main():
    using owned = Handle()
    print("body")
`.trimStart()],
  ]), { sourceRoot: directory, projectRoot: directory });
  assert.deepEqual(project.failures, []);
  assert.deepEqual(project.modules.flatMap((module) => module.result.diagnostics), []);
  const emitted = project.modules.find((module) => module.inputPath === entry)?.result.code ?? "";
  assert.match(emitted, /owned\["__velar:dispose"\]\(\)/u);
});

test("[D43 69] an owned binding participates in the shadowed-read rule", () => {
  const reported = diagnostics(`
class Handle:
    @dispose:
        pass

const owned = "outer"

def main():
    print(owned)
    using owned = Handle()
`);
  assert.ok(reported.some((item) => /^VEL3017 'owned' is shadowed by a declaration later in this scope/u.test(item)), reported.join("\n"));
});

test("[D43 69] an inherited release contract still runs", () => {
  const output = run(`
class Base:
    def close():
        print("base released")

    @dispose:
        self.close()

class Derived extends Base:
    pass

def main():
    using owned = Derived()
    print("body")

main()
`);
  assert.equal(output.stdout, "body\nbase released\n");
});
