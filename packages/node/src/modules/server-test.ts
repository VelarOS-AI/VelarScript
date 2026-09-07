/**
 * `velar/server-test` — the in-process client a `*.test.vel` module
 * drives its own application through
 *
 * D115 §三: one file per `velar/*` surface, holding that surface's `ValueType`
 * tables and the `nodeModuleInterfaces` entry they build.
 */
import { optionalOf as optional, type ModuleInterface, type ValueType } from "@velarscript/compiler";
import { serveAppType } from "../server-types.ts";
import { providerType } from "./serve.ts";
import { bytesType, functionType, moduleInterface, nullType, numberType, object, promise, stringMapType, stringType, unknownType } from "./types.ts";

const testResponseType: ValueType = { kind: "named", name: "TestResponse", identity: "velar/server-test#type:TestResponse" };
const testClientType: ValueType = { kind: "named", name: "TestClient", identity: "velar/server-test#type:TestClient" };
const testUploadType = object({filename: stringType, contentType: optional(stringType), data: {kind: "union", members: [stringType, bytesType]}}, ["contentType"]);
// `json` is readonly for the same invariance reason as the response payload: the options record
// is a request snapshot, and a mutable unknown field would accept only unknown.
const testRequestOptionsType = object({
  headers: optional(stringMapType),
  json: optional(unknownType),
  text: optional(stringType),
  form: optional(stringMapType),
  files: optional({kind: "map", key: stringType, value: testUploadType}),
}, ["headers", "json", "text", "form", "files"], ["json"]);
const testRequestType = functionType(["method", "path", "options"], [stringType, stringType, testRequestOptionsType], promise(testResponseType), 2);
const testMethodType = functionType(["path", "options"], [stringType, testRequestOptionsType], promise(testResponseType), 1);

export const velarServerTestModuleEntry: readonly [string, ModuleInterface] = ["velar/server-test", moduleInterface(
  new Map([
    ["TestClient", {kind: "typeObject", name: "TestClient", value: testClientType}],
    ["TestResponse", {kind: "typeObject", name: "TestResponse", value: testResponseType}],
    ["client", functionType(["app", "overrides"], [serveAppType, {kind: "map", key: providerType, value: unknownType}], promise(testClientType), 1)],
  ]),
  new Map([
    ["TestClient", new Map([
      ["request", testRequestType], ["get", testMethodType], ["post", testMethodType], ["put", testMethodType], ["patch", testMethodType], ["delete", testMethodType], ["close", functionType(["grace"], [numberType], promise(nullType), 0)],
    ])],
    ["TestResponse", new Map([
      ["status", numberType], ["headers", stringMapType], ["text", functionType([], [], promise(stringType))], ["json", functionType([], [], promise(unknownType))],
    ])],
  ]),
  new Map([["TestClient", "velar/server-test#type:TestClient"], ["TestResponse", "velar/server-test#type:TestResponse"]]),
)];
