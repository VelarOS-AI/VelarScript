import assert from "node:assert/strict";
import test from "node:test";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { compile as compileCore, formatSource } from "@velarscript/compiler";
import { projectDefinitionAt } from "../../../packages/cli/src/project-semantic.ts";
import { executeModule } from "../../support/execute-module.ts";
import { compile, compileProject } from "../../support/compiler-suite.ts";

test("string-backed enums model finite application states and match qualified members", () => {
  const result = compile(`
export enum TaskStatus:
    todo
    doing
    done

export type Task:
    title: string
    status: TaskStatus

def label(status: TaskStatus) -> string:
    match status:
        case TaskStatus.todo:
            return "To do"
        case TaskStatus.doing:
            return "In progress"
        case TaskStatus.done:
            return "Done"

def persist(value: string):
    print(value)
    return null

component StatusFilter:
    state selected: TaskStatus = TaskStatus.todo
    return <select bind:value={selected}><option value={TaskStatus.todo}>To do</option><option value={TaskStatus.done}>Done</option></select>

const task: Task = {title: "Ship app", status: TaskStatus.doing}
const parsed: TaskStatus = TaskStatus.parse("done")
persist(task.status)
print(label(parsed))
`.trimStart());

  assert.deepEqual(result.diagnostics, []);
  assert.equal(result.moduleInterface.enums.get("TaskStatus")?.members.has("doing"), true);
  assert.equal(result.semanticIndex.symbols.find((symbol) => symbol.name === "TaskStatus")?.kind, "enum");
  assert.equal(result.semanticIndex.symbols.find((symbol) => symbol.name === "parsed")?.type, "TaskStatus");
  assert.match(result.code ?? "", /export const TaskStatus = __velarRegisterRuntimeType\(__velarValidationFreeze/u);
  assert.match(result.code ?? "", /__velarMatchValue\d+ === TaskStatus\.doing/u);
  assert.match(result.code ?? "", /TaskStatus\.is\(__velarField\d+\.value\)/u);
  assert.match(result.code ?? "", /__velarBindValue\([^\n]+TaskStatus\.parse\)/u);
  const execution = executeModule(result.code ?? "");
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, "doing\nDone\n");
});

test("enums map readable member names onto exact external protocol values", () => {
  const source = `
enum ProviderEventKind:
    textDelta = "response.output_text.delta"
    completed = "response.completed"

type TextDeltaEvent:
    type: ProviderEventKind.textDelta
    delta: string

type CompletedEvent:
    type: ProviderEventKind.completed
    responseId: string

type ProviderEvent = TextDeltaEvent | CompletedEvent

def describe(event: ProviderEvent) -> string:
    if event.type == ProviderEventKind.textDelta:
        return event.delta
    return event.responseId

const delta = ProviderEvent.parse({type: "response.output_text.delta", delta: "hello"})
const completed = ProviderEvent.parse({type: "response.completed", responseId: "resp_1"})
print(ProviderEventKind.textDelta)
print(ProviderEventKind.parse("response.completed"))
print(describe(delta))
print(describe(completed))
try:
    ProviderEventKind.parse("forged")
catch:
    print("rejected")
`.trimStart();
  const result = compileCore(source);
  assert.deepEqual(result.diagnostics, []);
  assert.match(result.code ?? "", /textDelta: "response\.output_text\.delta"/u);
  assert.match(result.code ?? "", /value === "response\.output_text\.delta" \|\| value === "response\.completed"/u);
  const execution = executeModule(`Array.prototype.includes = () => true;\n${result.code ?? ""}`);
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, "response.output_text.delta\nresponse.completed\nhello\nresp_1\nrejected\n");
  assert.equal(
    formatSource('enum WireKind:\n textDelta="response.output_text.delta"\n'),
    'enum WireKind:\n    textDelta = "response.output_text.delta"\n',
  );

  const duplicateValues = compileCore(`
enum WireKind:
    first = "same"
    second = "same"
`.trimStart());
  assert.ok(duplicateValues.diagnostics.some((item) => /cannot share the runtime value "same"/u.test(item.message)));

  const layoutValue = compileCore(`
enum WireKind:
    multiline = "
        response.multiline
    "
`.trimStart());
  assert.ok(layoutValue.diagnostics.some((item) => /enum member value must be an inline string/ui.test(item.message)));

  const interpolatedValue = compileCore('enum WireKind:\n    dynamic = f"response.{name}"\n');
  assert.equal(interpolatedValue.diagnostics.length, 1, JSON.stringify(interpolatedValue.diagnostics));
  assert.match(interpolatedValue.diagnostics[0]?.message ?? "", /static.*without interpolation/u);
});

test("[D102-1] an enum member's wire value may be a safe integer", () => {
  // The motivating shape: a protocol version pinned to an integer, carried as
  // the discriminant of a record union, narrowed by match, and validated on the
  // way in. `z.literal(2)` in the real kernel contract had no Vel spelling but
  // `unknown` before this ruling.
  const source = `
enum KernelProtocol:
    v1 = 1
    v2 = 2

type Handshake:
    protocol: KernelProtocol.v1
    name: string

type Session:
    protocol: KernelProtocol.v2
    sessionId: string

type Frame = Handshake | Session

def describe(frame: Frame) -> string:
    match frame.protocol:
        case KernelProtocol.v1:
            return frame.name
        case KernelProtocol.v2:
            return frame.sessionId

const handshake: Frame = Handshake.parse({protocol: 1, name: "ada"})
const session: Frame = Session.parse({protocol: 2, sessionId: "s_1"})
const pinned: number = KernelProtocol.v2
print(describe(handshake))
print(describe(session))
print(str(pinned))
print(str(KernelProtocol.is(2)))
print(str(KernelProtocol.is("2")))
print(str(KernelProtocol.parse(2) == KernelProtocol.v2))
for member in KernelProtocol.values():
    print(str(member))
try:
    KernelProtocol.parse("2")
catch:
    print("string 2 is not the number 2")
try:
    Handshake.parse({protocol: "1", name: "ada"})
catch:
    print("a string tag does not satisfy a numeric singleton")
`.trimStart();
  const result = compileCore(source);
  assert.deepEqual(result.diagnostics, []);
  // The emitted member is a number, not the text of one, and both `is` and the
  // record validator compare with `===` — the string path's own strictness.
  assert.match(result.code ?? "", /v2: 2,/u);
  assert.match(result.code ?? "", /value === 1 \|\| value === 2/u);
  assert.match(result.code ?? "", /=== KernelProtocol\.v1/u);
  assert.equal(/v2: "2"/u.test(result.code ?? ""), false);
  const execution = executeModule(result.code ?? "");
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(
    execution.stdout,
    "ada\ns_1\n2\ntrue\nfalse\ntrue\n1\n2\nstring 2 is not the number 2\na string tag does not satisfy a numeric singleton\n",
  );

  // Declaration-site refusals. The integer literal grammar (charter section 3)
  // decides the slot: decimal or explicit radix, digit separators allowed, an
  // optional leading minus as in `parseMatchValue`, and nothing that spells a
  // decimal — so `2.0` is refused beside `2.5`, because `2.0` and `2` are one
  // JavaScript number and a wire value must read as the integer it is.
  const refusals: readonly (readonly [string, RegExp])[] = [
    ["2.5", /numeric wire value must be a whole number; '2\.5' spells a decimal/u],
    ["2.0", /numeric wire value must be a whole number; '2\.0' spells a decimal/u],
    ["1e2", /numeric wire value must be a whole number; '1e2' spells a decimal/u],
    ["9007199254740993", /exactly representable; '9007199254740993' becomes 9007199254740992/u],
    ["0x20000000000001", /exactly representable; '0x20000000000001' becomes 9007199254740992/u],
    ["true", /Expected an inline string or an integer value after '=' in an enum member/u],
  ];
  for (const [spelling, expected] of refusals) {
    const refused = compileCore(`enum WireKind:\n    only = ${spelling}\n`);
    assert.ok(
      refused.diagnostics.some((item) => expected.test(item.message)),
      `${spelling}: ${JSON.stringify(refused.diagnostics.map((item) => item.message))}`,
    );
  }
  // A refused value does not become a salvaged `0` that then collides with a
  // real one: the member keeps its name-derived value and reports once.
  const refusedOnce = compileCore("enum WireKind:\n    zero = 0\n    broken = 2.5\n");
  assert.equal(refusedOnce.diagnostics.length, 1, JSON.stringify(refusedOnce.diagnostics.map((item) => item.message)));

  // Radix and separators are integer literals by the charter's own definition,
  // and formatting preserves the author's spelling.
  const radix = compileCore("enum WireKind:\n    mask = 0xFF\n    wide = 1_000\n    sentinel = -32600\n");
  assert.deepEqual(radix.diagnostics, []);
  assert.match(radix.code ?? "", /mask: 255,/u);
  assert.match(radix.code ?? "", /wide: 1000,/u);
  assert.match(radix.code ?? "", /sentinel: -32600,/u);
  assert.equal(
    formatSource("enum WireKind:\n  mask=0xFF\n  wide=1_000\n  sentinel=-32600\n"),
    "enum WireKind:\n    mask = 0xFF\n    wide = 1_000\n    sentinel = -32600\n",
  );

  // Uniqueness is by value identity across both kinds: two numbers collide,
  // two strings collide, and a string and a number that spell the same digits
  // do not — they are two wire values, and neither parses as the other.
  const duplicateNumbers = compileCore("enum WireKind:\n    first = 2\n    second = 2\n");
  assert.ok(duplicateNumbers.diagnostics.some((item) => /cannot share the runtime value 2$/u.test(item.message)));
  const acrossKinds = compileCore('enum WireKind:\n    text = "2"\n    code = 2\n\nprint(str(WireKind.is("2")))\nprint(str(WireKind.is(2)))\n');
  assert.deepEqual(acrossKinds.diagnostics, []);
  const acrossKindsRun = executeModule(acrossKinds.code ?? "");
  assert.equal(acrossKindsRun.status, 0, String(acrossKindsRun.stderr));
  assert.equal(acrossKindsRun.stdout, "true\ntrue\n");
});

test("[D102-1] the enum wire exit and the equality veto follow the wire value's kind", () => {
  // D42 item 65 gave the enum domain one one-way exit because a member *is* a
  // string at run time. A member pinned to an integer is not, so the exit leads
  // to `number` there and to `string` nowhere near it.
  const toString = compile("enum Proto:\n    v2 = 2\n\nconst wire: string = Proto.v2\nprint(wire)\n");
  assert.ok(toString.diagnostics.some((item) => /Cannot assign Proto\.v2 to string/u.test(item.message)));
  const toNumber = compile("enum Proto:\n    v2 = 2\n\nconst wire: number = Proto.v2\nprint(str(wire))\n");
  assert.deepEqual(toNumber.diagnostics, []);
  const stringToNumber = compile('enum Kind:\n    delta = "d"\n\nconst wire: number = Kind.delta\nprint(str(wire))\n');
  assert.ok(stringToNumber.diagnostics.some((item) => /Cannot assign Kind\.delta to number/u.test(item.message)));
  const stringToString = compile('enum Kind:\n    delta = "d"\n\nconst wire: string = Kind.delta\nprint(wire)\n');
  assert.deepEqual(stringToString.diagnostics, []);

  // The veto that keeps an open string from becoming a member keeps an open
  // number from becoming one, and the report names the domain that collided.
  const openNumber = compile("enum Proto:\n    v2 = 2\n\nconst code: number = 2\nprint(str(code == Proto.v2))\n");
  assert.ok(openNumber.diagnostics.some((item) => /matches a raw number, and the enum and number domains never meet/u.test(item.message)));
  assert.ok(openNumber.diagnostics.some((item) => /an enum member converts to number only as a one-way wire exit/u.test(item.message)));
  assert.ok(openNumber.diagnostics.some((item) => /Proto\.parse\(value\) == Proto\.v2/u.test(item.message)));

  // A whole enum exits only where its members agree; a mixed one narrows first.
  const mixedDomain = compile('enum Mixed:\n    text = "x"\n    code = 2\n\ndef send(value: Mixed) -> string:\n    return value\n');
  assert.ok(mixedDomain.diagnostics.some((item) => /Cannot (assign|return) Mixed/u.test(item.message)));
  const mixedMember = compile('enum Mixed:\n    text = "x"\n    code = 2\n\nconst wire: string = Mixed.text\nprint(wire)\n');
  assert.deepEqual(mixedMember.diagnostics, []);
});

test("[D102-1] the editor surfaces read a numeric wire member exactly as a string one", () => {
  // Hover and completion show an enum member as its nominal singleton, and they
  // show a mapped wire value for neither kind. The ruling asks the numeric form
  // to be presented like the string form, so the assertion is parity: all three
  // spellings — mapped string, pinned integer, unmapped — produce one shape.
  const result = compileCore('enum Wire:\n    textDelta = "response.output_text.delta"\n    v2 = 2\n    plain\n\nprint(str(Wire.v2))\n');
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(
    result.semanticIndex.symbols
      .filter((symbol) => symbol.kind === "enum-member")
      .map((symbol) => `${symbol.container}.${symbol.name}: ${symbol.type}`),
    ["Wire.textDelta: Wire.textDelta", "Wire.v2: Wire.v2", "Wire.plain: Wire.plain"],
  );
  // The completion list behind `Wire.` carries the same detail for each member
  // and the same runtime surface after them, integer member included.
  assert.deepEqual(
    result.semanticIndex.symbols
      .find((symbol) => symbol.kind === "enum")
      ?.members.map((member) => `${member.name} ${member.kind} ${member.type}`),
    [
      "textDelta field Wire.textDelta",
      "v2 field Wire.v2",
      "plain field Wire.plain",
      "is method (value: unknown) -> bool",
      "parse method (value: unknown) -> Wire",
      "values method () -> List<Wire>",
    ],
  );
});

test("enums reject open strings, foreign members, duplicates, and reserved runtime names", () => {
  const openString = compile(`
enum Status:
    ready
    done

const status: Status = "ready"
`.trimStart());
  assert.ok(openString.diagnostics.some((item) => /Cannot assign string to Status/u.test(item.message)));

  const foreign = compile(`
enum Status:
    ready

enum Priority:
    high

match Status.ready:
    case Priority.high:
        pass
`.trimStart());
  assert.ok(foreign.diagnostics.some((item) => /Cannot match Status\.ready against Priority\.high/u.test(item.message)));

  const malformed = compile(`
enum Status:
    ready
    ready
    parse
    prototype
    __proto__
`.trimStart());
  assert.ok(malformed.diagnostics.some((item) => /declared more than once/u.test(item.message)));
  assert.ok(malformed.diagnostics.some((item) => /reserved for the enum's runtime surface/u.test(item.message)));
  assert.equal(malformed.diagnostics.filter((item) => /does not expose prototype manipulation/u.test(item.message)).length, 2);

  const incomplete = compile(`
enum Status:
    ready
    done

def label(status: Status) -> string:
    match status:
        case Status.ready:
            return "Ready"
`.trimStart());
  assert.ok(incomplete.diagnostics.some((item) => item.code === "VEL4015" && /missing: done/u.test(item.message)));
});

test("enum singleton types form discriminated record unions and narrow their owners", async () => {
  const result = compile(`
enum EventKind:
    text
    tool
    failed

type TextEvent:
    kind: EventKind.text
    text: string

type ToolEvent:
    kind: EventKind.tool
    toolId: string

type FailedEvent:
    kind: EventKind.failed
    message: string

type DiscriminatedEvent = TextEvent | ToolEvent | FailedEvent

def describeWithIf(event: DiscriminatedEvent) -> string:
    if event.kind == EventKind.text:
        return event.text
    if event.kind == EventKind.tool:
        return event.toolId
    return event.message

def describeWithMatch(event: DiscriminatedEvent) -> string:
    match event.kind:
        case EventKind.text:
            return event.text
        case EventKind.tool:
            return event.toolId
        case EventKind.failed:
            return event.message

def describeObjectMatch(event: DiscriminatedEvent) -> string:
    match event:
        case {kind: EventKind.text}:
            return event.text
        case {kind: EventKind.tool}:
            return event.toolId
        case {kind: EventKind.failed}:
            return event.message

def batch() -> List<DiscriminatedEvent>:
    return [
        {kind: EventKind.text, text: "one"},
        {kind: EventKind.tool, toolId: "two"},
    ]

const parsed = DiscriminatedEvent.parse({kind: EventKind.tool, toolId: "shell:run"})
print(describeWithIf({kind: EventKind.text, text: "hello"}))
print(describeWithMatch(parsed))
print(describeObjectMatch({kind: EventKind.failed, message: "broken"}))
print(batch().size)
try:
    DiscriminatedEvent.parse({kind: EventKind.text, toolId: "wrong-shape"})
catch error:
    print(error.message)
`.trimStart());

  assert.deepEqual(result.diagnostics, []);
  assert.equal(result.semanticIndex.symbols.find((item) => item.name === "parsed")?.type, "TextEvent | ToolEvent | FailedEvent");
  assert.match(result.code ?? "", /value === EventKind\.text/u);
  const execution = executeModule(result.code ?? "");
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, "hello\nshell:run\nbroken\n2\nValue does not match DiscriminatedEvent\n");
  assert.equal(formatSource("type TextEvent:\n kind: EventKind . text\n"), "type TextEvent:\n    kind: EventKind.text\n");

  const invalid = compile(`
enum EventKind:
    text
    tool

type TextEvent:
    kind: EventKind.text
    text: string

const event: TextEvent = {kind: EventKind.tool, text: "wrong"}
`.trimStart());
  assert.ok(invalid.diagnostics.some((item) => /Cannot assign EventKind\.tool to EventKind\.text/u.test(item.message)), JSON.stringify(invalid.diagnostics));

  const malformed = compile(`
enum EventKind:
    text

type Missing:
    kind: EventKind.missing
`.trimStart());
  assert.ok(malformed.diagnostics.some((item) => /has no member 'missing'/u.test(item.message)));

  // D44 rule 71: a literal initializer proves the variant, so the write is
  // rejected with the precise singleton mismatch; an opaque union owner keeps
  // the union-mutation guidance.
  const unsafeMutation = compile(`
enum EventKind:
    text
    tool

type TextEvent:
    kind: EventKind.text
    text: string

type ToolEvent:
    kind: EventKind.tool
    toolId: string

type DiscriminatedEvent = TextEvent | ToolEvent

def flip(event: DiscriminatedEvent):
    event.kind = EventKind.tool
    return null

let known: DiscriminatedEvent = {kind: EventKind.text, text: "hello"}
known.kind = EventKind.tool
`.trimStart());
  assert.ok(unsafeMutation.diagnostics.some((item) => /Cannot assign field 'kind' through.*variants require different field types/u.test(item.message)));
  assert.ok(unsafeMutation.diagnostics.some((item) => /Cannot assign EventKind\.tool to EventKind\.text/u.test(item.message)));

  const widening = compile(`
enum Status:
    open
    done

type Task:
    status: Status

def consume(tasks: List<Task>) -> number:
    return tasks.size

const sample = [
    {status: Status.open},
    {status: Status.done},
]
let status = Status.open
status = Status.done
const exact = Status.open
const stillExact: Status.open = exact
print(consume(sample))
print(status)
`.trimStart());
  assert.deepEqual(widening.diagnostics, []);
  assert.equal(widening.semanticIndex.symbols.find((item) => item.name === "sample")?.type, "List<{ status: Status }>");
  assert.equal(widening.semanticIndex.symbols.find((item) => item.kind === "variable" && item.name === "status")?.type, "Status");
  assert.equal(widening.semanticIndex.symbols.find((item) => item.name === "exact")?.type, "Status.open");
  const wideningExecution = executeModule(widening.code ?? "");
  assert.equal(wideningExecution.status, 0, String(wideningExecution.stderr));
  assert.equal(wideningExecution.stdout, "2\ndone\n");

  const libraryPath = join(tmpdir(), "velar-discriminated-events", "protocol.vel");
  const consumerPath = join(tmpdir(), "velar-discriminated-events", "consumer.vel");
  const librarySource = `
export enum EventKind:
    text
    tool

export type TextEvent:
    kind: EventKind.text
    text: string

export type ToolEvent:
    kind: EventKind.tool
    toolId: string

export type Event = TextEvent | ToolEvent

export def decode(value: unknown) -> Event:
    return Event.parse(value)
`.trimStart();
  const consumerSource = `
import {Event, EventKind as Kind, decode} from "./protocol.vel"

type LocalText:
    kind: Kind.text
    text: string

def describe(event: Event) -> string:
    if event.kind == Kind.text:
        return event.text
    return event.toolId

const local: LocalText = {kind: Kind.text, text: "local"}
const event = decode({kind: Kind.tool, toolId: "fs:read"})
print(local.text)
print(describe(event))
`.trimStart();
  const project = await compileProject(consumerPath, new Map([
    [libraryPath, librarySource],
    [consumerPath, consumerSource],
  ]), { extensions: [] });
  assert.deepEqual(project.failures, []);
  assert.deepEqual(project.modules.flatMap((module) => module.result.diagnostics), []);
  const consumer = project.modules.find((module) => module.inputPath === consumerPath)?.result;
  assert.equal(consumer?.semanticIndex.symbols.find((item) => item.name === "event")?.type, "TextEvent | ToolEvent");
  assert.match(consumer?.code ?? "", /event\.kind === Kind\.text/u);
  const typeMember = consumerSource.indexOf("Kind.text") + "Kind.".length;
  const definition = projectDefinitionAt(project, consumerPath, typeMember);
  assert.equal(definition?.path, libraryPath);
  assert.equal(librarySource.slice(definition?.span.start, definition?.span.end), "text");
});
