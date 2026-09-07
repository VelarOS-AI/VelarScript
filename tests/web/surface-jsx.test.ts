import assert from "node:assert/strict";
import test from "node:test";
import { clean, messages, only } from "../support/web-surface-diagnostics.ts";

/**
 * D115 P5 — the JSX-level diagnostics of the file that was
 * `tests/web/surface.test.ts` before it reached 1,464 lines.
 *
 * A keyword prop name, a `key` in a fixed position, the two ways a reader
 * reaches for a JSX comment, `and` used as a conditional, `??` opening an
 * element, an empty record where a handler body belongs, and the children
 * diagnostic that has to name the prop accepting them. Each is a place where a
 * reflex from another language meets Vel's spelling, and each is answered with
 * one message that names the spelling. The bodies below are the bodies that
 * file had.
 */

// ---------------------------------------------------------------------------
// WEB-N4 / WEB-C1 / WEB-U13 / WEB-U15 / GRM-A3 / GRM-A4.
// ---------------------------------------------------------------------------

test("[WEB-N4] a keyword prop name and a declaration-position '?' each report one message", () => {
  assert.equal(only(`
component Chip(class: string):
    return <div>x</div>

mount(<Chip class="a" />, "#app")
`), "VEL2016 Every component already accepts 'class'; remove it from the prop list and pass it at the call site with class={...}");

  assert.equal(only(`
component Chip(enum: string):
    return <div>label</div>

mount(<Chip enum="a" />, "#app")
`), "VEL2016 'enum' is a VelarScript keyword and cannot name a component prop; choose another name");

  // D30 item 16: the softened statement-head words are ordinary prop names.
  clean(`
component Chip(match: string, type: string):
    return <div>{match}{type}</div>

mount(<Chip match="a" type="b" />, "#app")
`);

  assert.equal(only(`
component Chip(compact?: bool):
    return <div>{str(compact)}</div>

mount(<Chip />, "#app")
`), "VEL2016 A component prop becomes omittable through its default value, not through '?': write 'compact: Type = default' for a real default, or 'compact: Type? = null' when absence is the value");

  assert.equal(only(`
component Chip(children: WebNode?):
    return <div>{children}</div>

mount(<Chip />, "#app")
`), "VEL5012 Component 'Chip' requires prop 'children'; a prop becomes omittable through its default value — declare 'children: WebNode? = null' on the component");

  clean(`
component Chip(children: WebNode? = null):
    return <div>{children}</div>

mount(<Chip />, "#app")
`);
});

test("[WEB-C1] a key in a fixed position is diagnosed instead of silently ignored", () => {
  assert.match(only(`
mount(<div key="static">x</div>, "#app")
`), /^VEL5050 This JSX key has no effect: '<div>' is rendered in a fixed position/u);

  assert.match(only(`
component Row(label: string):
    return <li>{label}</li>

component App:
    return <ul><Row key="a" label="a" /></ul>

@main: mount(<App />, "#app")
`), /^VEL5050 This JSX key has no effect: '<Row>' is rendered in a fixed position/u);

  // A keyed .map() root keeps its key, and the interpolation diagnostic is unchanged.
  clean(`
component App(labels: List<string> = []):
    return <ul>{labels.map(label => <li key={label}>{label}</li>)}</ul>

mount(<App />, "#app")
`);
  assert.ok(messages(`
component App(ready: bool = false):
    return <ul>{ready ? <li key="one">a</li> : null}</ul>

mount(<App />, "#app")
`).some((item) => item.startsWith("VEL5050") && /keys reuse children by identity only when the interpolation is/u.test(item)));
});

test("[WEB-U13] both JSX comment attempts get one targeted message", () => {
  assert.equal(only(`
mount(<div>
    <!-- a note -->
    <span>x</span>
</div>, "#app")
`), "VEL5002 JSX has no comment form; write a '//' comment on its own line outside the markup");

  assert.equal(only(`
mount(<div>
    {/* a note */}
    <span>x</span>
</div>, "#app")
`), "VEL5002 JSX has no comment form; write a '//' comment on its own line outside the markup");
});

test("[WEB-U15] 'and' rendering and a null component root teach the conditional spellings", () => {
  assert.equal(only(`
component App:
    state ready = true
    return <div>{ready and <span>x</span>}</div>

mount(<App />, "#app")
`), "VEL5029 'and' combines bool values and cannot yield an element; render conditionally with '{ready ? <span ... : null}'");

  assert.equal(only(`
component App:
    return null

mount(<App />, "#app")
`), "VEL4001 A component always returns one JSX root; decide at the call site with '{show ? <Card /> : null}', or return an empty element such as <span />");
});

test("[GRM-A3] '??' starts JSX so a nullish fallback element parses", () => {
  clean(`
component Fallback:
    return <i>none</i>

component App(name: string? = null):
    return <div>{name ?? <Fallback />}</div>

mount(<App />, "#app")
`);
  // '<' after an ordinary value is still the comparison operator.
  clean(`
def smaller(left: number, right: number) -> bool:
    return left < right

mount(<p>{smaller(1, 2)}</p>, "#app")
`);
});

test("[GRM-A4] an empty-record arrow body is rejected in a handler position", () => {
  assert.equal(only(`
mount(<button on:click={() => {}}>x</button>, "#app")
`), "VEL5021 Event 'click' handlers return null, and '{}' after '=>' builds an empty record rather than an empty block; write '() => null' for a handler that does nothing, or name a 'def' that performs the work");

  assert.match(only(`
component App:
    def measure() -> number:
        return 1
    return <button on:click={measure}>x</button>

mount(<App />, "#app")
`), /^VEL5021 Event 'click' handlers return null; this handler returns number/u);

  // A no-op handler and an asynchronous handler stay legal.
  clean(`
component App:
    action save() -> string:
        return "ok"

    return <div>
        <button on:click={() => null}>a</button>
        <button on:click={save}>b</button>
        <button on:click={() => save()}>c</button>
    </div>

mount(<App />, "#app")
`);
});

// web-15 / D31 item 26: the diagnostic is the only place the reader meets the
// spelling that accepts children, so it names it.
test("[web-15] the children diagnostic teaches the prop that accepts them", () => {
  assert.equal(only(`
component Card(title: string):
    return <div>{title}</div>

component App:
    return <Card title="Hi"><p>inner</p></Card>

mount(<App />, "#app")
`), "VEL5018 Component 'Card' does not declare JSX children; declare a 'children: WebNode' prop to accept them");

  clean(`
component Card(title: string, children: WebNode):
    return <div>{title}{children}</div>

component App:
    return <Card title="Hi"><p>inner</p></Card>

mount(<App />, "#app")
`);
});
