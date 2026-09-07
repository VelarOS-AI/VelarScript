import assert from "node:assert/strict";
import test from "node:test";
import { clean, messages, only } from "../support/web-surface-diagnostics.ts";

/**
 * D115 P5 — the attribute spellings a browser would execute, one subject of the
 * file that was `tests/web/surface.test.ts` before it reached 1,464 lines.
 *
 * Three boundaries where a written-down attribute is code rather than data: the
 * lowercase `on*` handler the HTML parser compiles, `srcdoc`, which builds a
 * document inside this page's origin, and a literal script URL in any attribute
 * that carries one. The bodies below are the bodies that file had.
 */

// web-19: the `on*` guard was anchored on an uppercase letter, so it caught the
// React reflex that does nothing and let through the HTML spelling the browser
// compiles as script.
test("[web-19] a lowercase HTML handler attribute is refused as the executable spelling it is", () => {
  for (const [attribute, event] of [["onclick", "click"], ["onmouseover", "mouseover"], ["onerror", "error"], ["onload", "load"]]) {
    const reported = only(`
component App(u: string):
    return <div ${attribute}={u} data-x={u}>hi</div>

mount(<App u="x" />, "#app")
`);
    assert.match(reported, new RegExp(`^VEL5025 Use 'on:${event}';`, "u"));
    assert.match(reported, /compiled as script by the browser/u);
    assert.match(reported, new RegExp(`on:${event}=\\{handler\\}`, "u"));
  }
  // The camelCase spelling reaches the same attribute — an HTML attribute name
  // is matched ASCII-case-insensitively — so it earns the clause too. This
  // assertion used to read `doesNotMatch(/compiled as script/)` on the strength
  // of a comment calling `onClick=` a spelling that merely does nothing; the
  // DOM says otherwise, and `ONCLICK` below already carried the clause, so the
  // old expectation split one attribute across two rules.
  const camel = only(`
component App:
    return <div role="button" onClick={() => null}>hi</div>

mount(<App />, "#app")
`);
  assert.match(camel, /^VEL5025 Use 'on:click';/u);
  assert.match(camel, /an 'onClick' attribute is compiled as script by the browser/u);
  clean(`
component App:
    return <div role="button" on:click={() => null}>hi</div>

mount(<App />, "#app")
`);

  // wr-6: the guard closes the whole `on` prefix, so a name that is no event at
  // all reaches it too. The message states the prefix rule for those names and
  // does not tell the author the browser compiles their attribute as script,
  // because it does not.
  for (const attribute of ["onward", "once"]) {
    const reported = only(`
component App(u: string):
    return <div ${attribute}={u} data-x={u}>hi</div>

mount(<App u="x" />, "#app")
`);
    assert.match(reported, /^VEL5025 Use an 'on:event' directive with a native DOM event name/u);
    assert.match(reported, /reserves every attribute name beginning with 'on'/u);
    assert.doesNotMatch(reported, new RegExp(`'${attribute}' attribute is compiled as script`, "u"));
  }

  // An HTML attribute name is matched case-insensitively, so every casing of a
  // handler name is the executable spelling. The clause is right to fire on all
  // of them, and must not call the name the author wrote lowercase when it is
  // not. `onCLICK` used to be silent because the suppressor was `/^on[A-Z]/`,
  // which is a test for camelCase and not for what the browser does.
  for (const attribute of ["ONCLICK", "Onclick", "onCLICK", "onClick"]) {
    const reported = only(`
component App(u: string):
    return <div ${attribute}={u} data-x={u}>hi</div>

mount(<App u="x" />, "#app")
`);
    assert.match(reported, new RegExp(`an '${attribute}' attribute is compiled as script by the browser`, "u"));
    assert.doesNotMatch(reported, /lowercase/u);
  }

  // wr-6: the clause's roster is HTML's handler attributes, not the `on:`
  // directive vocabulary. These names are absent from that vocabulary and are
  // real handler attributes, so pinning them to the directive list told the
  // author the browser leaves their attribute alone while it compiles it.
  for (const [attribute, event] of [
    ["onanimationstart", "animationstart"], ["onabort", "abort"], ["onauxclick", "auxclick"],
    ["onresize", "resize"], ["ontimeupdate", "timeupdate"], ["onbeforetoggle", "beforetoggle"],
  ]) {
    const reported = only(`
component App(u: string):
    return <div ${attribute}={u} data-x={u}>hi</div>

mount(<App u="x" />, "#app")
`);
    assert.match(reported, new RegExp(`^VEL5025 Use 'on:${event}';`, "u"));
    assert.match(reported, new RegExp(`an '${attribute}' attribute is compiled as script by the browser`, "u"));
  }

  // The prefix rule's own message named the `on:` directive as the remedy and
  // then claimed every `on` name is reserved, which makes the remedy a
  // counterexample to the sentence recommending it. The guard is `/^on(?!:)/`.
  const reserved = only(`
component App(u: string):
    return <div onward={u} data-x={u}>hi</div>

mount(<App u="x" />, "#app")
`);
  assert.match(reserved, /beginning with 'on' other than the 'on:' directive itself/u);
});

// web-20: srcdoc builds a document that inherits this page's origin, so it is a
// second raw-HTML boundary with no marker on it.
test("[web-20] an iframe with srcdoc requires a sandbox that really takes the origin away", () => {
  assert.match(only(`
component App(doc: string):
    return <iframe srcdoc={doc} title="t" />

mount(<App doc="x" />, "#app")
`), /^VEL5066 An iframe with srcdoc .*runs script in this page's origin; add a sandbox attribute/u);

  assert.match(only(`
component App(doc: string):
    return <iframe srcdoc={doc} sandbox="allow-scripts allow-same-origin" title="t" />

mount(<App doc="x" />, "#app")
`), /^VEL5066 sandbox='allow-scripts allow-same-origin' lets the framed document remove its own sandbox/u);

  clean(`
component App(doc: string):
    return <iframe srcdoc={doc} sandbox="allow-forms" title="t" />

mount(<App doc="x" />, "#app")
`);
  // An ordinary framed URL is not this boundary and gains no requirement.
  clean(`
component App:
    return <iframe src="https://example.com/embed" title="t" />

mount(<App />, "#app")
`);
});

// web-4, literal half: the analyzer already refuses an anchor that opens a
// window without 'noopener', so a written-down script URL cannot be the one URL
// question it declines to ask.
test("[web-4] a literal script URL is refused in every URL-bearing attribute", () => {
  for (const source of [
    `mount(<a href="javascript:alert(1)">x</a>, "#app")`,
    `mount(<a href="JaVaScRiPt:alert(1)">x</a>, "#app")`,
    `mount(<a href="vbscript:msgbox">x</a>, "#app")`,
    `mount(<img src="javascript:alert(1)" alt="x" />, "#app")`,
    `mount(<form action="javascript:alert(1)"><button>go</button></form>, "#app")`,
  ]) {
    const reported = messages(source);
    assert.ok(reported.some((message) => message.startsWith("VEL5067")), JSON.stringify(reported));
  }
  // The URL parser strips control characters before it reads the scheme, so a
  // split spelling is the same URL and gets the same answer.
  assert.ok(messages(`mount(<a href="java\tscript:alert(1)">x</a>, "#app")`).some((message) => message.startsWith("VEL5067")));

  // A data: URL is refused for the media types that can carry script and
  // accepted for the ones that cannot.
  assert.match(only(`mount(<iframe src="data:text/html,<script>x</script>" title="t" />, "#app")`), /^VEL5067 .*'data:' URL is only accepted for a media type that cannot carry script/u);
  assert.ok(messages(`mount(<img src="data:image/svg+xml,<svg/>" alt="x" />, "#app")`).some((message) => message.startsWith("VEL5067")));
  clean(`mount(<img src="data:image/png;base64,iVBORw0KGgo=" alt="x" />, "#app")`);

  // Every ordinary URL a page writes stays legal.
  clean(`mount(<a href="/about">x</a>, "#app")`);
  clean(`mount(<a href="https://example.com">x</a>, "#app")`);
  clean(`mount(<a href="mailto:team@example.com">x</a>, "#app")`);
  clean(`mount(<a href="#section">x</a>, "#app")`);
});
