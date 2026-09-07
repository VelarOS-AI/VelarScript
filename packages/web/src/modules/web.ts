/**
 * `velar/web` — routes, the route context, navigation, and the four components the router family publishes.
 *
 * D115 §三: one file per `velar/*` surface, holding that surface's `ValueType`
 * tables and the `webModuleInterfaces` entry they build.
 */
import { optionalOf as optional, type ModuleInterface, type ValueType } from "@velarscript/compiler";
import { routeContextIdentity } from "../analyzer.ts";
import { webComponentConstructor } from "../types.ts";
import {
  boolType,
  functionType,
  mapString,
  moduleInterface,
  namedFunction,
  namedIntrinsic,
  nodeType,
  nullType,
  object,
  promise,
  stringType,
  unknownType,
} from "./types.ts";

/**
 * D90 R17-a left exactly one `any` standing in this file, and this is it.
 *
 * `component` holds a component constructor, not a rendered node, so
 * `webNodeType` is the wrong family — the two referees that check this slot
 * (`checkRouteComponent` and `checkWebRouteComponent`) match it with
 * `isWebComponentType`, and `isWebTypeAssignable` refuses a component against a
 * node outright. `unknown`, the answer R17 gives every other boundary position
 * here, is refused by the shape of assignability rather than by the ruling: a
 * writable object field and a List element are both compared *invariantly*, and
 * `unknown` is invariant with nothing, so `List<{path, component: Page}>` — the
 * type a route list bound to a name actually has — would stop being assignable
 * to the Router's `routes` prop. `any` is the only spelling that is invariant
 * with every component type at once, and no published name means "some
 * component"; R17-a declined to mint one. The slot is checked by its two
 * referees, not by this declaration.
 */
const routeComponentType: ValueType = { kind: "any" };
const routeType = object({
  path: stringType,
  component: routeComponentType,
});

const routeContextFields = new Map<string, ValueType>([
  ["path", stringType],
  ["params", mapString(stringType)],
  ["query", mapString(stringType)],
  ["hash", stringType],
]);
const routeContextType: ValueType = { kind: "named", name: "RouteContext", identity: routeContextIdentity };
const navigationOptionsType = object({ replace: optional(boolType), scroll: optional(boolType) });

export const velarWebModuleEntry: readonly [string, ModuleInterface] = ["velar/web", moduleInterface(new Map([
  ["RouteContext", { kind: "typeObject", name: "RouteContext" }],
  ["route", namedIntrinsic("web.route", ["path", "view"], [stringType, unknownType], routeType)],
  ["lazy", namedIntrinsic("web.lazy", ["loader", "exportName", "loading", "failed"], [functionType([], promise(unknownType)), stringType, unknownType, unknownType], unknownType, 2)],
  ["navigate", namedFunction(["to", "options"], [stringType, navigationOptionsType], nullType, 1)],
  ["redirect", namedFunction(["to"], [stringType], nullType)],
  ["back", namedFunction([], [], nullType)],
  ["forward", namedFunction([], [], nullType)],
  ["reload", namedFunction([], [], nullType)],
  ["currentRoute", namedFunction([], [], routeContextType)],
  ["announce", namedFunction(["message", "priority"], [stringType, stringType], nullType, 1)],
  ["domId", namedFunction(["prefix"], [stringType], stringType, 0)],
  ["Head", webComponentConstructor("Head", new Map<string, ValueType>([
    ["title", stringType], ["description", stringType], ["canonical", stringType], ["robots", stringType],
    ["image", stringType], ["themeColor", stringType], ["language", stringType],
  ]), new Set(["title"]), null)],
  ["Router", webComponentConstructor("Router", new Map<string, ValueType>([["routes", { kind: "list", element: routeType }], ["fallback", unknownType]]), new Set(["routes"]), null, "web.router")],
  ["Link", webComponentConstructor("Link", new Map<string, ValueType>([["to", stringType], ["replace", boolType], ["class", optional(stringType)], ["look", optional({ kind: "named", name: "Look" })], ["children", nodeType]]), new Set(["to"]), null)],
  ["NavLink", webComponentConstructor("NavLink", new Map<string, ValueType>([["to", stringType], ["exact", boolType], ["replace", boolType], ["class", optional(stringType)], ["look", optional({ kind: "named", name: "Look" })], ["children", nodeType]]), new Set(["to"]), null)],
]), new Map(), new Map([["RouteContext", routeContextFields]]), new Map([
  ["RouteContext", "@velarscript/web:velar/web#type:RouteContext"],
]))];
