import assert from "node:assert/strict";
import test from "node:test";
import { clean, messages, only } from "../support/web-surface-diagnostics.ts";

/**
 * D115 P5 — D47 rule 84, the bind subject of the file that was
 * `tests/web/surface.test.ts` before it reached 1,464 lines.
 *
 * A bind target is a writable reactive path and lowers to a get/set pair;
 * `bind:group` is the radio and checkbox spelling and refuses every other
 * shape; and reading `target` or `value` off an event is the spelling bind
 * exists to replace, so it is met once, with the replacement named. The bodies
 * below are the bodies that file had.
 */

// ---------------------------------------------------------------------------
// D47 rule 84: bind member paths, bind groups, and the event-object boundary.
// ---------------------------------------------------------------------------

test("[D47-84] a writable reactive path is a bind target and lowers to a get/set pair", () => {
  const result = clean(`
type Theme:
    mode: string

type Form:
    name: string
    theme: Theme

component App:
    state form: Form = {name: "", theme: {mode: "dark"}}
    state items: List<string> = [""]

    return <form>
        <input bind:value={form.name} aria-label="Name" />
        <input bind:value={form.theme.mode} aria-label="Mode" />
        <input bind:value={items[0]} aria-label="First" />
    </form>
`);
  assert.match(result.code ?? "", /__velarBindValue\(__velarElement\d+, \{ get: \(\) => \(form\.get\(\)\.name\), set: \(__velarBindNext\) => \{ form\.get\(\)\.name = __velarBindNext; \} \}/u);
  assert.match(result.code ?? "", /get: \(\) => \(form\.get\(\)\.theme\.mode\)/u);
  assert.match(result.code ?? "", /get: \(\) => \(__velarListIndexGet\(items\.get\(\), 0\)\), set: \(__velarBindNext\) => \{ __velarListIndexSet\(items\.get\(\), 0, __velarBindNext\); \}/u);
});

test("[D47-84] computed, const, and non-reactive bind targets keep their rejection", () => {
  for (const target of ["doubled", "label", "items.size", "form.missing", "read()"]) {
    const reported = messages(`
type Form:
    name: string

component App:
    state count = 0
    state items: List<string> = []
    state form: Form = {name: ""}
    computed doubled = count * 2
    const label = "fixed"

    def read() -> string:
        return label

    return <input bind:value={${target}} />
`);
    assert.ok(reported.some((item) => item.startsWith("VEL5019")
      && /bind:value requires a writable reactive location/u.test(item)), `${target}: ${JSON.stringify(reported)}`);
  }
});

test("[D47-84] bind:group binds radio and checkbox groups and rejects every other shape", () => {
  const result = clean(`
component App:
    state plan = "team"
    state extras: List<string> = []

    return <form>
        <input type="radio" value="solo" bind:group={plan} />
        <input type="radio" value="team" bind:group={plan} />
        <input type="checkbox" value="digest" bind:group={extras} />
    </form>
`);
  assert.match(result.code ?? "", /__velarBindGroup\(__velarElement\d+, plan, __velarComponentScope, false\)/u);
  assert.match(result.code ?? "", /__velarBindGroup\(__velarElement\d+, extras, __velarComponentScope, true\)/u);

  assert.match(only(`
component App:
    state plan = "team"
    return <input type="text" value="solo" bind:group={plan} />
`), /^VEL5019 bind:group binds a group of choices and requires <input type="radio"> or <input type="checkbox">/u);

  assert.match(only(`
component App:
    state plan = "team"
    return <input type="radio" bind:group={plan} />
`), /^VEL5019 bind:group identifies each choice by its value attribute/u);

  assert.ok(messages(`
component App:
    state plan = 3
    return <input type="radio" value="solo" bind:group={plan} />
`).some((item) => item.startsWith("VEL4001") && /Cannot assign number to string/u.test(item)));

  assert.ok(messages(`
component App:
    state extras = ""
    return <input type="checkbox" value="digest" bind:group={extras} />
`).some((item) => item.startsWith("VEL4001") && /Cannot assign string to List<string>/u.test(item)));
});

test("[D47-84] reading target or value off an event teaches the bind spelling once", () => {
  for (const body of ["event.target.value", "event.currentTarget.value", "event.value"]) {
    assert.match(only(`
component App:
    def onInput(event: InputEvent):
        print(${body})
        return null

    return <input on:input={onInput} />
`), /^VEL5019 A VelarScript event object carries typed event fields only and has no '(?:target|currentTarget|value)': read the element's value through a two-way binding instead/u);
  }

  // The hand-rolled assignment form keeps its own bind guidance.
  assert.ok(messages(`
component App:
    state draft = ""
    return <input on:input={event => draft = event.data} />
`).some((item) => item.startsWith("VEL5019") && item.includes("Use 'bind:value={draft}'")));
});
