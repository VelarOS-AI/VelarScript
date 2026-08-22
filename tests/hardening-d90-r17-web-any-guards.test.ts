import assert from "node:assert/strict";
import test from "node:test";
import { compile, type ValueType } from "@velarscript/compiler";
import { velarCompilerExtension, webModuleInterfaces } from "../packages/web/src/compiler.ts";
import { webModuleSources } from "../packages/web/src/runtime.ts";
import { webComponentConstructor } from "../packages/web/src/types.ts";

/**
 * D90 R17's tail on the Web target: the branches in `packages/web/src/analyzer.ts`
 * that ask whether a type is `any`.
 *
 * R17 ("边界交回 `unknown`") retired the producer the audit assumed those
 * branches were guarding — an undeclared foreign value now arrives as
 * `unknown`, and `any` is refused in every annotation position by Core — so the
 * question was whether the Web branches had gone dead with it. They had not.
 * The Web target mints `any` of its own, in `inferWebIntrinsic`: `web.lazy`
 * returns `anyType` from each of its seven error paths, the retired-accessor
 * intrinsic carries an `any` callback result through, `analyzeResourceDeclaration`
 * falls back to it, and a `look=` / event-assigned attribute value is typed as
 * `anyType` outright. So a program that trips one of those paths still hands a
 * genuinely `any`-typed binding to everything downstream.
 *
 * This file is the audit record. Every one of the 23 surviving guards has a
 * program here that reaches it with an `any`, asserted through the diagnostics
 * that program does and does not produce — the guard's whole job is to keep a
 * cascade off an author who has already been told the real thing. The three
 * that were deleted have their programs here too, showing what reaches those
 * lines instead, so a change that reintroduces an `any` on one of those paths
 * fails here rather than silently restoring a hole.
 *
 * Each guard is cited by the method it lives in, not by a line number. The
 * first draft of this census cited lines, and every one of them had drifted by
 * the time the next wave read it — AGENTS.md's second shape, a promise wider
 * than the code, written into the record meant to prevent it.
 *
 * `web.lazy` with a non-literal export name is the shared producer: it reports
 * once and answers `any`, which is exactly the shape the guards exist for.
 */

const LAZY_NAME_REFUSAL = "VEL4001 A lazy component export name must be a string literal";

/** The lazily imported module every case below names, so only the intended path fails. */
const otherModule: ValueType = {
  kind: "object",
  fields: new Map<string, ValueType>([["Other", webComponentConstructor("Other", new Map(), new Set(), null)]]),
};

function reported(source: string): string[] {
  const imports = new Map<string, ValueType>();
  for (const match of source.matchAll(/import\s*\{([^}]*)\}\s*from\s*"(velar\/[a-z-]+)"/gu)) {
    const exports_ = webModuleInterfaces.get(match[2]!)?.exports;
    for (const raw of match[1]!.split(",")) {
      const [imported, local = imported] = raw.trim().split(/\s+as\s+/u);
      const type = imported ? exports_?.get(imported) : undefined;
      if (type) imports.set(local!, type);
    }
  }
  const result = compile(source, {
    extensions: [velarCompilerExtension],
    analysis: { imports, dynamicImports: new Map([["./other.vel", otherModule]]) },
  });
  return result.diagnostics.map((item) => `${item.code} ${item.message}`);
}

const WEB_IMPORT = 'import {Router, lazy, route} from "velar/web"\n';
/** `A` is `any`: the export name is not a literal, so `web.lazy` reports and answers `anyType`. */
const ANY_BINDING = 'const A = lazy(() => import("./other.vel"), "Ot" + "her")\n';
const HEAD = `${WEB_IMPORT}${ANY_BINDING}`;
const HANDLE_COMPONENT = `type PanelHandle:
    focus: () -> null

component Panel(title: string) exposes PanelHandle:
    def focus():
        return null

    expose {focus}
    return <div>{title}</div>

`;

test("[D90 R17] the Web target still mints 'any', so the guards that carry it are live", () => {
  // The producer itself, isolated: one message about the export name, and the
  // binding it hands back accepts a member nobody declared. That silence is
  // what every case below is standing on.
  assert.deepEqual(reported(`${HEAD}export component App:\n    return <p>{A.nothingDeclaredThis}</p>\n`), [LAZY_NAME_REFUSAL]);

  // A declared `anyType` in a `velar/*` parameter or prop position is an
  // expected type, and an expected type never becomes the inferred one — so
  // those declarations are not a second producer. Each of these reads back the
  // literal's own type, not `any`.
  assert.deepEqual(reported(`${WEB_IMPORT}export component App:\n    return <Router routes={[]} fallback={[]} />\n`), [
    "VEL4001 A Router fallback requires a component, received List<unknown>",
  ]);
  assert.deepEqual(reported(`${WEB_IMPORT}const rs = [route("/a", () => 1)]\nexport component App:\n    return <Router routes={rs} />\n`), [
    "VEL4001 A route requires a component, received () -> number",
  ]);
});

test("[D90 R17] guards kept: web.lazy, the retired accessor, and the runtime-type reader", () => {
  // `inferWebIntrinsic`, the retired-accessor case — the reader it answers
  // carries the callback's own result, so an `any` callback gives an `any`
  // reader and the migration message stands alone.
  assert.deepEqual(reported(`${HEAD}export component App:\n    const R = cached(A)\n    return <p>{R()}</p>\n`), [
    LAZY_NAME_REFUSAL,
    "VEL5055 A derived value is declared, not called: write 'computed R = ...' and read 'R' bare. Where the argument is a function rather than an expression, write the call — 'computed R = A()'",
  ]);

  // `inferWebIntrinsic`, `case "web.lazy"` — the two fallback arguments,
  // `loadingFallback` and `failedFallback`. An `any` fallback is not measured
  // against "must be a component"; the author already has the real message.
  assert.deepEqual(reported(`${HEAD}export component App:\n    const B = lazy(() => import("./other.vel"), "Other", A, A)\n    return <B />\n`), [LAZY_NAME_REFUSAL]);
  // The same two positions with a value that is neither `any` nor null do report.
  assert.deepEqual(reported(`${WEB_IMPORT}export component App:\n    const B = lazy(() => import("./other.vel"), "Other", 5, 6)\n    return <B />\n`), [
    "VEL4001 A lazy loading fallback must be a component",
    "VEL4001 A lazy failure fallback must be a component accepting error: Error",
  ]);

  // `inferWebIntrinsic`, `case "forms.read"` — `runtimeTypeAt` hands `any`
  // straight back, and the read returns it rather than demanding a declared
  // record.
  assert.deepEqual(reported(`import {read} from "velar/forms"\n${HEAD}export component App:\n    let form: Element? = null\n    def go():\n        const parsed = try read(form, A)\n    return <form ref={form} on:submit={go}></form>\n`), [
    LAZY_NAME_REFUSAL,
    "VEL4001 Cannot assign Element? to Element",
  ]);
});

test("[D90 R17] guards kept: the route, resource, computed, and component-return checks", () => {
  // `checkRouteComponent`, the `route(path, view)` half.
  assert.deepEqual(reported(`${HEAD}const rs = [route("/a", A)]\nexport component App:\n    return <Router routes={rs} />\n`), [LAZY_NAME_REFUSAL]);

  // `calledComputedBinding` — a called `computed` whose value is `any` is left
  // alone: it may well be callable, so the "read it bare" correction would be
  // wrong.
  assert.deepEqual(reported(`${HEAD}export component App:\n    computed c = A\n    return <p>{c()}</p>\n`), [LAZY_NAME_REFUSAL]);
  // The same shape with a non-callable value is the case VEL5063 exists for.
  assert.deepEqual(reported(`${WEB_IMPORT}export component App:\n    computed c = 1\n    return <p>{c()}</p>\n`), [
    "VEL5063 'c' is a computed value, not a reader: it is read bare like state, so write 'c' rather than 'c()'",
  ]);

  // `analyzeResourceDeclaration` — an initializer that is `any` is not refused
  // for failing to return Promise<T>; the field roster is built from the
  // annotation instead.
  assert.deepEqual(reported(`${HEAD}export component App:\n    resource r = A\n    return <p>{r.loading}</p>\n`), [LAZY_NAME_REFUSAL]);
  assert.deepEqual(reported(`${WEB_IMPORT}export component App:\n    resource r = 1\n    return <p>{r.loading}</p>\n`), [
    "VEL4016 A resource initializer must return Promise<T>, received number",
  ]);

  // `analyzeComponent` — a component returning `any` is not told "a component
  // must return JSX".
  assert.deepEqual(reported(`${HEAD}export component App:\n    return A\n`), [LAZY_NAME_REFUSAL]);
  assert.deepEqual(reported(`${WEB_IMPORT}export component App:\n    return 5\n`), ["VEL4001 A component must return JSX"]);
});

test("[D90 R17] guards kept: JSX keys, the Router fallback, and both ref checks", () => {
  // `analyzeComponentElement`, the VEL5022 key check — a component `key` that
  // is `any` passes the key-shape check.
  assert.deepEqual(reported(`${HEAD}${HANDLE_COMPONENT}export component App:\n    return <div><Panel key={A} title="x" /></div>\n`), [
    LAZY_NAME_REFUSAL,
    "VEL5050 This JSX key has no effect: '<Panel>' is rendered in a fixed position, and keys reuse children by identity only inside 'items.map(item => <Row key={item.id} />)' — remove the key, or render this element from a keyed .map()",
  ]);

  // `analyzeComponentElement`, the Router `fallback` attribute. This is also
  // why `checkWebRouteComponent`'s own `any` arm was deleted: this caller
  // filters `any` before it ever calls.
  assert.deepEqual(reported(`${HEAD}export component App:\n    return <Router routes={[]} fallback={A} />\n`), [LAZY_NAME_REFUSAL]);

  // `analyzeComponentRef`, both arms — a component `ref` whose binding is `any`
  // is neither told to be optional nor measured against the Handle. The second
  // of the two is a short-circuit rather than the answer: `isAssignable(handle,
  // any)` agrees with it, so removing it changes no message. It stays because
  // an `any` does reach it and because its neighbour two lines up decides on
  // its own.
  assert.deepEqual(reported(`${HEAD}${HANDLE_COMPONENT}export component App:\n    let h = A\n    return <div><Panel ref={h} title="x" /></div>\n`), [LAZY_NAME_REFUSAL]);
  assert.deepEqual(reported(`${WEB_IMPORT}${HANDLE_COMPONENT}export component App:\n    let h = 1\n    return <div><Panel ref={h} title="x" /></div>\n`), [
    "VEL5057 A component ref requires PanelHandle? so cleanup can restore null",
  ]);
  assert.deepEqual(reported(`${WEB_IMPORT}${HANDLE_COMPONENT}export component App:\n    let h: string? = null\n    return <div><Panel ref={h} title="x" /></div>\n`), [
    "VEL5057 Component 'Panel' exposes PanelHandle, but this ref stores string?",
  ]);

  // `analyzeNativeJsxAttribute`, the native-element `ref` — the same pair one
  // layer down.
  assert.deepEqual(reported(`${HEAD}export component App:\n    let r = A\n    return <div ref={r}></div>\n`), [LAZY_NAME_REFUSAL]);
  assert.deepEqual(reported(`${WEB_IMPORT}export component App:\n    let r = 1\n    return <div ref={r}></div>\n`), [
    "VEL5024 A <div> ref requires Element? or a parent element type so cleanup can restore null",
  ]);

  // `checkWebRouteRecords`, the `component:` entry of a route record literal —
  // the guard R19 arrived with, and the twenty-third. It is the filter that
  // lets `checkWebRouteComponent` keep no `any` arm, so it is alive by the same
  // evidence that retired that one: delete it and this program gains a second
  // message, "A route requires a component, received any", which the
  // `route(...)` spelling of the same route does not produce. The R19 section
  // below asserts the pair side by side.
  assert.deepEqual(reported(`${HEAD}export component App:\n    return <Router routes={[{path: "/a", component: A}]} />\n`), [LAZY_NAME_REFUSAL]);
});

test("[D90 R17] guards kept: attribute values, event handlers, and the four shape predicates", () => {
  // `analyzeNativeJsxAttribute`, `unsafe:html`.
  assert.deepEqual(reported(`${HEAD}export component App:\n    return <div unsafe:html={A}></div>\n`), [LAZY_NAME_REFUSAL]);
  assert.deepEqual(reported(`${WEB_IMPORT}export component App:\n    return <div unsafe:html={5}></div>\n`), [
    "VEL5047 unsafe:html requires string or string?, received number",
  ]);

  // `analyzeNativeJsxAttribute`, the `on:` handler — one that is `any` is not
  // refused for not being callable.
  assert.deepEqual(reported(`${HEAD}export component App:\n    return <button type="button" on:click={A}>x</button>\n`), [LAZY_NAME_REFUSAL]);
  assert.deepEqual(reported(`${WEB_IMPORT}export component App:\n    return <button type="button" on:click={5}>x</button>\n`), [
    "VEL5021 Event 'click' requires a function",
  ]);

  // `analyzeNativeJsxAttribute`, the native-element `key`.
  assert.deepEqual(reported(`${HEAD}export component App:\n    return <div><span key={A}>x</span></div>\n`), [
    LAZY_NAME_REFUSAL,
    "VEL5050 This JSX key has no effect: '<span>' is rendered in a fixed position, and keys reuse children by identity only inside 'items.map(item => <Row key={item.id} />)' — remove the key, or render this element from a keyed .map()",
  ]);

  // `checkEventHandlerResult` — a handler whose result is `any` is not told
  // that handlers return null.
  assert.deepEqual(reported(`${HEAD}export component App:\n    def handler():\n        return A\n    return <button type="button" on:click={handler}>x</button>\n`), [LAZY_NAME_REFUSAL]);
  assert.deepEqual(reported(`${WEB_IMPORT}export component App:\n    return <button type="button" on:click={() => 1}>x</button>\n`), [
    "VEL5021 Event 'click' handlers return null; this handler returns number — the result is discarded, so call it inside a 'def' that returns null",
  ]);

  // `isLookInput`, `isClassInput`, `isJsxRenderable`, `isJsxAttributeValue` —
  // the four shape predicates that accept `any`.
  assert.deepEqual(reported(`${HEAD}export component App:\n    return <div look={A}></div>\n`), [LAZY_NAME_REFUSAL]);
  assert.deepEqual(reported(`${HEAD}export component App:\n    return <div class={A}></div>\n`), [LAZY_NAME_REFUSAL]);
  assert.deepEqual(reported(`${HEAD}export component App:\n    return <div>{A}</div>\n`), [LAZY_NAME_REFUSAL]);
  assert.deepEqual(reported(`${HEAD}export component App:\n    return <div title={A}></div>\n`), [LAZY_NAME_REFUSAL]);
  // Each of the four still refuses a shape it was written to refuse.
  assert.deepEqual(reported(`${WEB_IMPORT}export component App:\n    return <div look={5}></div>\n`), [
    "VEL5040 JSX look requires Look, Look?, or a list of Look values; received number",
  ]);
  assert.deepEqual(reported(`${WEB_IMPORT}export component App:\n    return <div class={5}></div>\n`), [
    "VEL5040 JSX class requires string, string?, or a list of strings; received number",
  ]);
  assert.deepEqual(reported(`${WEB_IMPORT}export component App:\n    const seen = {a: 1}\n    return <div>{seen}</div>\n`), [
    "VEL5047 JSX can render only text, finite numbers, bool, enums, WebNode values, and Lists of those values; received { a: number }",
  ]);
  assert.deepEqual(reported(`${WEB_IMPORT}export component App:\n    const seen = {a: 1}\n    return <div title={seen}></div>\n`), [
    "VEL5047 Native JSX attributes require text, finite numbers, bool, enums, or null; received { a: number }",
  ]);
});

test("[D90 R17] guards deleted: nothing reaches the three lines that asked", () => {
  // web.lazy's loader, two guards on consecutive lines. The syntactic gate above
  // them has already established a zero-parameter arrow, and `inferArrow` in
  // the core analyzer answers `kind: "function"` on its single return path — so
  // neither `loader.kind !== "any"` nor `if (loader.kind === "any")` could ever
  // decide anything. A well-formed loader takes the ordinary path,
  assert.deepEqual(reported(`${WEB_IMPORT}export component App:\n    const B = lazy(() => import("./other.vel"), "Other")\n    return <B />\n`), []);
  // and every shape that is not that arrow is refused by the gate, before the
  // loader's own type is ever consulted.
  assert.deepEqual(reported(`${WEB_IMPORT}export component App:\n    const B = lazy(5, "Other")\n    return <B />\n`), [
    'VEL4001 A lazy loader must be written as () => import("./module.vel")',
    "VEL5011 Unknown component 'B'",
  ]);
  assert.deepEqual(reported(`${WEB_IMPORT}export component App:\n    const B = lazy(path => import("./other.vel"), "Other")\n    return <B />\n`), [
    'VEL4001 A lazy loader must be written as () => import("./module.vel")',
    "VEL5011 Unknown component 'B'",
  ]);
  // Including one that is `any` itself: the gate answers first, so the loader
  // guards stay unreached even with an `any` in the argument position.
  assert.deepEqual(reported(`${HEAD}export component App:\n    const B = lazy(A, "Other")\n    return <B />\n`), [
    LAZY_NAME_REFUSAL,
    'VEL4001 A lazy loader must be written as () => import("./module.vel")',
    "VEL5011 Unknown component 'B'",
  ]);

  // `checkWebRouteComponent`'s `any` arm. Both its callers — the Router
  // `fallback` attribute and the `routes` record check below — filter `any` out
  // before calling, so the method only ever sees a value that is already worth
  // a message.
  assert.deepEqual(reported(`${WEB_IMPORT}export component App:\n    return <Router routes={[]} fallback={5} />\n`), [
    "VEL4001 A Router fallback requires a component, received number",
  ]);
  assert.deepEqual(reported(`${WEB_IMPORT}export component App:\n    return <Router routes={[]} fallback={null} />\n`), []);
});

/**
 * The corollary the audit of those guards turned up: a declared `anyType` in a
 * `velar/*` position is not a producer of `any` — the assertions above hold —
 * but `routeType.component` was also an open door. `route(path, view)` checks
 * its path and its component at the call; the record that call returns is a
 * legal spelling of the same value, and `{path: "no-leading-slash", component: 5}`
 * written straight into `routes` was checked by nothing and handed `5` to the
 * Router as a component.
 *
 * D90 R19 ("编译期能判的在编译期判"): the runtime already refuses both shapes,
 * so what was missing was the first referee, not the second. Every row here is
 * a `route(...)` refusal beside the record-literal spelling of the same
 * mistake, asserting the two produce the same message.
 */

const PAGE = `component Page:
    return <p>ok</p>

`;

test("[D90 R19] a route record literal is refused exactly where the route(...) call is", () => {
  // The probe that found it. Both questions are asked, and the second names
  // the same type `route(...)` would name.
  assert.deepEqual(reported(`${WEB_IMPORT}export component App:\n    return <Router routes={[{path: "no-leading-slash", component: 5}]} />\n`), [
    "VEL4001 A route path must start with '/'",
    "VEL4001 A route requires a component, received number",
  ]);

  // Side by side, one refusal at a time. The record spelling must not say
  // anything the call spelling does not, or say it differently.
  const pairs: readonly (readonly [string, string, readonly string[]])[] = [
    ['route("no-leading-slash", Page)', '{path: "no-leading-slash", component: Page}', ["VEL4001 A route path must start with '/'"]],
    ['route("/a?b=1", Page)', '{path: "/a?b=1", component: Page}', ["VEL4001 A route path describes only a pathname; read query and hash from RouteContext"]],
    ['route("/*/x", Page)', '{path: "/*/x", component: Page}', ["VEL4001 A route wildcard must be the final segment"]],
    ['route("/a/", Page)', '{path: "/a/", component: Page}', [
      "VEL4001 A route path cannot end with '/'; matching already accepts one trailing slash",
      "VEL4001 A route path cannot contain an empty segment",
    ]],
    ['route("/:id/:id", Page)', '{path: "/:id/:id", component: Page}', ["VEL4001 Route parameter 'id' is repeated"]],
    ['route("/a", 5)', '{path: "/a", component: 5}', ["VEL4001 A route requires a component, received number"]],
    ['route("/a", "nope")', '{path: "/a", component: "nope"}', ["VEL4001 A route requires a component, received string"]],
    ['route("/a", () => 1)', '{path: "/a", component: () => 1}', ["VEL4001 A route requires a component, received () -> number"]],
    ['route("/a", Panel)', '{path: "/a", component: Panel}', ["VEL4001 A route component cannot require props other than route: title"]],
    ['route("/a", Nope)', '{path: "/a", component: Nope}', ["VEL3001 Unknown name 'Nope'", "VEL4001 A route requires a component, received unknown"]],
  ];
  const PANEL = `component Panel(title: string):
    return <p>{title}</p>

`;
  for (const [call, record, expected] of pairs) {
    const head = `${WEB_IMPORT}${PAGE}${PANEL}export component App:\n    return <Router routes={[`;
    assert.deepEqual(reported(`${head}${call}]} />\n`), expected, `route(...) spelling: ${call}`);
    assert.deepEqual(reported(`${head}${record}]} />\n`), expected, `record spelling: ${record}`);
  }
});

test("[D90 R19] the route record check refuses nothing a route(...) call accepts", () => {
  const head = `${WEB_IMPORT}${PAGE}export component App:\n    return <Router routes={`;
  // The shapes an author actually writes, none of which the call spelling
  // refuses either.
  assert.deepEqual(reported(`${head}[{path: "/a", component: Page}]} />\n`), []);
  assert.deepEqual(reported(`${head}[route("/a", Page)]} />\n`), []);
  assert.deepEqual(reported(`${head}[]} />\n`), []);
  assert.deepEqual(reported(`${head}[{path: "/", component: Page}, {path: "/items/:id", component: Page}, {path: "/*", component: Page}]} />\n`), []);
  // Shorthand entries name bindings; the check reads the binding's type, not
  // the spelling.
  assert.deepEqual(reported(`${WEB_IMPORT}${PAGE}export component App:\n    const path = "/a"\n    const component = Page\n    return <Router routes={[{path, component}]} />\n`), []);
  // A spread supplies fields the literal does not show. What is written is
  // still checked; what is not written is left to assignability.
  assert.deepEqual(reported(`${WEB_IMPORT}${PAGE}export component App:\n    const base = {component: Page}\n    return <Router routes={[{...base, path: "/a"}]} />\n`), []);
  // A list that is not a literal shows the check nothing, so it says nothing —
  // the runtime asserted below is the referee for that one.
  assert.deepEqual(reported(`${WEB_IMPORT}${PAGE}export component App:\n    const rs = [{path: "no-slash", component: Page}]\n    return <Router routes={rs} />\n`), []);
  // An `any` component is skipped, exactly as the `route(...)` twin skips it:
  // the author already has the real message.
  assert.deepEqual(reported(`${HEAD}export component App:\n    return <Router routes={[{path: "/a", component: A}]} />\n`), [LAZY_NAME_REFUSAL]);
  assert.deepEqual(reported(`${HEAD}export component App:\n    return <Router routes={[route("/a", A)]} />\n`), [LAZY_NAME_REFUSAL]);
});

test("[D90 R19] the runtime is the second referee for the routes the source does not show", () => {
  // The compile-time check above reports what a list literal shows. The claim
  // in `checkWebRouteRecords` — that a route reaching the Router any other way
  // is still refused, just later — is this runtime, executed here so the
  // comment cannot outlive the code it describes.
  const source = webModuleSources.get("velar/web") ?? "";
  const start = source.indexOf("function validateRoutePath(");
  assert.ok(start >= 0, "velar/web must still ship validateRoutePath");
  let depth = 0;
  let end = start;
  for (let index = source.indexOf("{", start); index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    else if (source[index] === "}") {
      depth -= 1;
      if (depth === 0) { end = index + 1; break; }
    }
  }
  const validateRoutePath = new Function(`${source.slice(start, end)}\nreturn validateRoutePath;`)() as (path: unknown) => void;
  assert.throws(() => validateRoutePath("no-leading-slash"), /route path must start with '\/'/u);
  assert.throws(() => validateRoutePath("/a?b=1"), /describes only a pathname/u);
  assert.throws(() => validateRoutePath("/*/x"), /wildcard must be the final segment/u);
  assert.doesNotThrow(() => validateRoutePath("/a"));
  assert.ok(
    source.includes('if (typeof item.component !== "function") throw new TypeError("A Router route component must be callable");'),
    "routerTable must still refuse a component that is not callable",
  );
});
