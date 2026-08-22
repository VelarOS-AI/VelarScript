import assert from "node:assert/strict";
import test from "node:test";
import { compile, type ValueType } from "@velarscript/compiler";
import { velarCompilerExtension, webModuleInterfaces } from "../packages/web/src/compiler.ts";
import { webComponentConstructor } from "../packages/web/src/types.ts";

/**
 * D90 R17-a: the `velar/*` positions the Web target still declared as `any`.
 *
 * R17 ("JS 边界交回 `unknown`,不再是 `any`") and R20 ("`velar/*` 纳入规则 3
 * 管辖") had already been applied to the same intrinsics in the same positions
 * on the Node target — `packages/node/src/compiler.ts` spells
 * `runtime.parseAsync` as `["target"], [unknownType], promise(unknownType)`
 * and the HTTP options body as `optional(unknownType)`, and publishes zero
 * `any`. Web had not followed, so one `runtime.parseAsync` carried two
 * signatures and one boundary carried two rules. This file is the record that
 * it followed.
 *
 * The check that matters most is the census at the bottom: it walks every type
 * `webModuleInterfaces` publishes and refuses `any` anywhere in it, so the next
 * declaration that reaches for `any` fails here rather than in an audit.
 */

const otherModule: ValueType = {
  kind: "object",
  fields: new Map<string, ValueType>([["Other", webComponentConstructor("Other", new Map(), new Set(), null)]]),
};

/** Imports resolved from the published interface, the same way the Web host resolves them. */
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

/**
 * The declared result is what an author is handed whenever the intrinsic's own
 * handler never runs — a named-argument list the planner rejects returns
 * `intrinsic.result` before the Web handler sees the call. While that result
 * was `any`, the refusal was followed by silence: every member read on the
 * binding compiled clean. `unknown` makes the second message the accurate one.
 */
test("[D90 R17-a] a boundary result that falls back to its declaration is unknown, not silence", () => {
  const cases: readonly (readonly [string, string, string])[] = [
    [
      "storage.get",
      'import {storage} from "velar/storage"\ntype Row:\n    n: number\n\nexport def run() -> number:\n    const v = storage.get(key = "k", bogus = Row)\n    return v.whatever\n',
      "VEL4001 Missing required named argument: target",
    ],
    [
      "config.public",
      'import {publicConfig} from "velar/config"\ntype Conf:\n    apiUrl: string\n\nexport def run() -> number:\n    const v = publicConfig(bogus = Conf)\n    return v.whatever\n',
      "VEL4001 Missing required named argument: target",
    ],
    [
      "forms.read",
      'import {read} from "velar/forms"\ntype Row:\n    n: number\n\nexport def run(el: Element) -> number:\n    const v = read(bogus = el, target = Row)\n    return v.whatever\n',
      "VEL4001 Missing required named argument: form",
    ],
  ];
  for (const [surface, source, missing] of cases) {
    assert.deepEqual(reported(source), [
      missing,
      "VEL4001 Unknown named argument 'bogus'",
      "VEL4001 Cannot access 'whatever' on unknown without validation; declare a type naming the fields you rely on — 'type V:' with the 'whatever' field — then validate first: 'const checked = V.parse(v)' and read 'checked.whatever'",
      "VEL4001 Cannot assign unknown to number; a boundary value stays unknown until validated at the edge — narrow it with 'value is number', or parse a declared shape",
    ], surface);
  }
});

/**
 * The positions whose handler does run still answer the runtime type the author
 * named, so the ruling costs a correct program nothing. These are the tour's
 * own spellings (`examples/tour/web/11-storage-realtime-http.vel`,
 * `examples/tour/web/09-routing-and-app.vel`).
 */
test("[D90 R17-a] a boundary value parsed at the edge still types itself", () => {
  const clean: readonly (readonly [string, string])[] = [
    ["storage.get with a fallback", `import {storage} from "velar/storage"
type Draft:
    title: string

const empty = {title: ""}

export def run() -> string:
    return storage.get("k", Draft, empty).title
`],
    ["storage.get without a fallback", `import {storage} from "velar/storage"
type Draft:
    title: string

export def run() -> string:
    const v = storage.get("k", Draft)
    if v == null:
        return ""
    return v.title
`],
    ["storage.watch", `import {storage} from "velar/storage"
type Draft:
    title: string

export def run():
    storage.watch("k", Draft, (next, previous) => print(f"{next?.title} was {previous?.title}"))
    return null
`],
    ["database get and set", `import {database} from "velar/storage"
type Draft:
    title: string

export async def run() -> string:
    const db = database("tour")
    await db.set("k", {title: "a"})
    return (await db.get("k", Draft, {title: ""})).title
`],
    ["publicConfig", `import {publicConfig} from "velar/config"
type Conf:
    apiUrl: string

export def run() -> string:
    return publicConfig(Conf).apiUrl
`],
    ["http parse", `import {http} from "velar/http"
type Row:
    n: number

export async def run() -> number:
    const r = await http.get("https://a.example").response()
    return (await r.parse(Row)).n
`],
    ["http body", `import {http} from "velar/http"
type Row:
    n: number

export def run():
    http.post("https://a.example", {body: {n: 1}})
    return null
`],
    ["route, Router and a fallback", `import {Router, route} from "velar/web"
component Home():
    return <p>home</p>

component Missing():
    return <p>missing</p>

export component App():
    return <Router routes={[route("/", Home)]} fallback={Missing} />
`],
    ["a route list bound to a name", `import {Router, route} from "velar/web"
component Home():
    return <p>home</p>

export component App():
    const routes = [route("/", Home)]
    return <Router routes={routes} />
`],
    ["lazy with both fallbacks", `import {lazy} from "velar/web"
component Spinner():
    return <p>...</p>

component Boom(error: Error):
    return <p>{error.message}</p>

const Other = lazy(() => import("./other.vel"), "Other", Spinner, Boom)

export component App():
    return <Other />
`],
  ];
  for (const [name, source] of clean) assert.deepEqual(reported(source), [], name);
});

/**
 * The two referees that check a component slot keep reporting exactly what they
 * reported before: R17-a moved a declaration, not a check. `web.route`'s `view`
 * parameter is declared `unknown` and its message is still the component one,
 * because an intrinsic parameter's declared type is never the checker — the
 * Web handler infers the argument itself.
 */
test("[D90 R17-a] the component referees are unmoved by the declaration", () => {
  assert.deepEqual(
    reported('import {route} from "velar/web"\nconst r = route("/x", 42)\n'),
    ["VEL4001 A route requires a component, received number"],
  );
  assert.deepEqual(
    reported(`import {Router} from "velar/web"
export component App():
    return <Router routes={[]} fallback={42} />
`),
    ["VEL4001 A Router fallback requires a component, received number"],
  );
});

/**
 * The census. Every type reachable from the published Web interface, refused if
 * it spells `any`.
 *
 * One slot is exempt and named here rather than skipped silently: `Route`'s
 * `component`. A component constructor is not a `WebNode` — `isWebComponentType`
 * and `isWebTypeAssignable` put the two in different families — and `unknown`,
 * the answer R17 gives every other boundary position, is refused by the shape of
 * assignability rather than by the ruling: a writable object field and a List
 * element are both compared invariantly, and `unknown` is invariant with
 * nothing, so `List<{path, component: Page}>` — the type a route list bound to a
 * name actually has — would stop being assignable to the Router's `routes`
 * prop, which the case above proves it still is. `any` is the only spelling
 * invariant with every component type at once. The slot's checking is done by
 * `checkRouteComponent` and `checkWebRouteComponent`, not by its declaration.
 */
test("[D90 R17-a] no velar/* position the Web target publishes spells 'any'", () => {
  const seen = new Set<ValueType>();
  const found: string[] = [];
  const walk = (type: ValueType | undefined, path: string): void => {
    if (!type || seen.has(type)) return;
    seen.add(type);
    if (type.kind === "any") {
      found.push(path);
      return;
    }
    switch (type.kind) {
      case "list": case "set": walk(type.element, `${path}[]`); return;
      case "map": walk(type.key, `${path}<key>`); walk(type.value, `${path}<value>`); return;
      case "record": walk(type.value, `${path}<value>`); return;
      case "optional": walk(type.inner, `${path}?`); return;
      case "promise": walk(type.value, `${path}<resolved>`); return;
      case "union": type.members.forEach((member, index) => walk(member, `${path}|${index}`)); return;
      case "object": for (const [name, field] of type.fields) walk(field, `${path}.${name}`); return;
      case "extension":
        for (const [name, property] of type.properties) walk(property, `${path}.${name}`);
        type.arguments.forEach((argument, index) => walk(argument, `${path}(${index})`));
        return;
      case "function": case "action": case "intrinsic":
        type.parameters.forEach((parameter, index) => walk(parameter, `${path}(${type.parameterNames?.[index] ?? index})`));
        walk(type.rest, `${path}(...)`);
        walk(type.result, `${path} ->`);
        return;
      case "runtimeType": walk(type.value, `${path}<type>`); return;
      case "typeObject": walk(type.value, `${path}<type>`); return;
      default: return;
    }
  };

  for (const [moduleName, interface_] of webModuleInterfaces) {
    for (const [name, type] of interface_.exports) walk(type, `${moduleName}:${name}`);
    for (const [name, type] of interface_.typeAliases) walk(type, `${moduleName}:type ${name}`);
    for (const [name, fields] of interface_.namedTypes) {
      for (const [field, type] of fields) walk(type, `${moduleName}:${name}.${field}`);
    }
    for (const [name, info] of interface_.classes) {
      info.parameters.forEach((parameter, index) => walk(parameter, `${moduleName}:${name}(${info.parameterNames?.[index] ?? index})`));
      for (const [field, info_] of info.fields) walk(info_.type, `${moduleName}:${name}.${field}`);
      for (const [method, type] of info.methods) walk(type, `${moduleName}:${name}.${method}()`);
      for (const [field, info_] of info.staticFields) walk(info_.type, `${moduleName}:${name}::${field}`);
      for (const [method, type] of info.staticMethods) walk(type, `${moduleName}:${name}::${method}()`);
    }
  }

  // One entry, not two: `Route` is one declaration, reached first through
  // `route(...)`'s result and shared by the Router's `routes` prop, and the
  // walk records a type once.
  assert.deepEqual(found, ["velar/web:route ->.component"]);
});
