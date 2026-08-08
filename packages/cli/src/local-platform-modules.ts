import { optionalOf as optional, type ClassInfo, type ModuleInterface, type ValueType } from "@velarscript/compiler";

const anyType: ValueType = { kind: "any" };
const unknownType: ValueType = { kind: "unknown" };
const nullType: ValueType = { kind: "null" };
const stringType: ValueType = { kind: "string" };
const numberType: ValueType = { kind: "number" };
const boolType: ValueType = { kind: "bool" };
const listStringType: ValueType = { kind: "list", element: stringType };
const stringMapType: ValueType = { kind: "map", key: stringType, value: stringType };

function promise(value: ValueType): ValueType {
  return { kind: "promise", value };
}

function functionType(
  parameterNames: readonly string[],
  parameters: readonly ValueType[],
  result: ValueType,
  requiredParameters = parameters.length,
): ValueType {
  return { kind: "function", parameterNames, parameters, requiredParameters, result };
}

function object(fields: Readonly<Record<string, ValueType>>, optionalFields: readonly string[] = []): ValueType {
  return {
    kind: "object",
    fields: new Map(Object.entries(fields)),
    ...(optionalFields.length > 0 ? { optionalFields: new Set(optionalFields) } : {}),
  };
}

function moduleInterface(
  exports: ReadonlyMap<string, ValueType>,
  namedTypes: ReadonlyMap<string, ReadonlyMap<string, ValueType>> = new Map(),
  namedTypeIdentities: ReadonlyMap<string, string> = new Map(),
  typeAliases: ReadonlyMap<string, ValueType> = new Map(),
  classes: ReadonlyMap<string, ClassInfo> = new Map(),
): ModuleInterface {
  return {
    exports,
    mutableExports: new Set(),
    reactiveExports: new Map(),
    reExports: new Map(),
    namedTypes,
    namedTypeIdentities,
    typeAliases,
    enums: new Map(),
    classes,
    testFunctions: [],
    extensionExports: new Map(),
    extensionData: new Map(),
  };
}

const serveRequestType: ValueType = { kind: "named", name: "ServeRequest", identity: "velar/serve#type:ServeRequest" };
const serverType: ValueType = { kind: "named", name: "Server", identity: "velar/serve#type:Server" };
const blobIdentity = "velar/fs#class:Blob";
const blobType: ValueType = { kind: "class", name: "Blob", identity: blobIdentity };
const blobClass: ClassInfo = {
  identity: blobIdentity,
  parameters: [],
  requiredParameters: 0,
  base: null,
  abstract: true,
  fields: new Map(),
  getters: new Set(),
  abstractGetters: new Set(),
  methods: new Map(),
  abstractMethods: new Set(),
  staticFields: new Map(),
  staticGetters: new Set(),
  staticMethods: new Map(),
};
const writeChunkType = functionType(["chunk"], [stringType], promise(nullType));
const streamProducerType = functionType(["write"], [writeChunkType], promise(nullType));
const responseHeadersType = stringMapType;
const jsonResponseType = object({ status: numberType, json: anyType, headers: responseHeadersType }, ["headers"]);
const textResponseType = object({ status: numberType, text: stringType, contentType: stringType, headers: responseHeadersType }, ["contentType", "headers"]);
const streamResponseType = object({ status: numberType, stream: streamProducerType, headers: responseHeadersType }, ["headers"]);
const serveResponseAlias: ValueType = { kind: "union", members: [jsonResponseType, textResponseType, streamResponseType] };
const handlerType = functionType(["request"], [serveRequestType], promise(serveResponseAlias));

export const localPlatformModuleInterfaces: ReadonlyMap<string, ModuleInterface> = new Map([
  ["velar/serve", moduleInterface(
    new Map([
      ["ServeRequest", { kind: "typeObject", name: "ServeRequest" }],
      ["ServeResponse", { kind: "typeObject", name: "ServeResponse" }],
      ["Server", { kind: "typeObject", name: "Server" }],
      ["serve", functionType(["handler", "port", "host"], [handlerType, numberType, stringType], promise(serverType), 2)],
      ["fileResponse", functionType(["root", "path", "fallback"], [stringType, stringType, optional(stringType)], serveResponseAlias, 2)],
    ]),
    new Map([
      ["ServeRequest", new Map([
        ["method", stringType],
        ["path", stringType],
        ["query", stringMapType],
        ["headers", stringMapType],
        ["text", functionType([], [], promise(stringType))],
        ["json", functionType([], [], promise(unknownType))],
      ])],
      ["Server", new Map([
        ["port", numberType],
        ["stop", functionType([], [], promise(nullType))],
      ])],
    ]),
    new Map([
      ["ServeRequest", "velar/serve#type:ServeRequest"],
      ["Server", "velar/serve#type:Server"],
    ]),
    new Map([["ServeResponse", serveResponseAlias]]),
  )],
  ["velar/fs", moduleInterface(
    new Map([
      ["Blob", { kind: "classConstructor", name: "Blob", identity: blobIdentity }],
      ["readText", functionType(["path"], [stringType], promise(stringType))],
      ["writeText", functionType(["path", "text"], [stringType, stringType], promise(nullType))],
      ["exists", functionType(["path"], [stringType], promise(boolType))],
      ["list", functionType(["path"], [stringType], promise(listStringType))],
      ["readBlob", functionType(["path"], [stringType], promise(blobType))],
    ]),
    new Map(),
    new Map(),
    new Map(),
    new Map([["Blob", blobClass]]),
  )],
  ["velar/env", moduleInterface(new Map([
    ["get", functionType(["name"], [stringType], optional(stringType))],
    ["require", functionType(["name"], [stringType], stringType)],
  ]))],
  ["velar/host", moduleInterface(new Map([
    ["exit", functionType(["code"], [numberType], nullType, 0)],
    ["onShutdown", functionType(["cleanup"], [functionType([], [], promise(nullType))], nullType)],
  ]))],
]);

export const localPlatformModuleSources: ReadonlyMap<string, string> = new Map([
  ["velar/fs", String.raw`
import { readdir, readFile, stat, writeFile } from "node:fs/promises";

const maxPathCodeUnits = 4096;
const maxFileBytes = 16 * 1024 * 1024;
const maxListItems = 100000;
const maxListCodeUnits = 2 * 1024 * 1024;
const blobToken = Symbol("velar.fs.blob");

function pathValue(value, operation) {
  if (typeof value !== "string" || value.length === 0) throw new TypeError(operation + " requires a non-empty path string");
  if (value.length > maxPathCodeUnits || value.includes("\0")) throw new RangeError(operation + " path is outside the supported bounds");
  return value;
}

async function boundedFile(path, operation) {
  path = pathValue(path, operation);
  const metadata = await stat(path);
  if (!metadata.isFile()) throw new TypeError(operation + " requires a file path");
  if (metadata.size > maxFileBytes) throw new RangeError(operation + " cannot read files larger than 16 MiB");
  const data = await readFile(path);
  if (data.byteLength > maxFileBytes) throw new RangeError(operation + " cannot read files larger than 16 MiB");
  return data;
}

export class Blob {
  constructor(token, data) {
    if (token !== blobToken) throw new TypeError("Blob values are created only by velar/fs.readBlob");
    Object.defineProperty(this, "data", { value: data, enumerable: false, configurable: false, writable: false });
    Object.freeze(this);
  }
}

export async function readText(path) {
  const data = await boundedFile(path, "readText");
  try { return new TextDecoder("utf-8", { fatal: true }).decode(data); }
  catch { throw new TypeError("readText requires valid UTF-8 text"); }
}

export async function writeText(path, text) {
  path = pathValue(path, "writeText");
  if (typeof text !== "string") throw new TypeError("writeText requires text");
  if (Buffer.byteLength(text, "utf8") > maxFileBytes) throw new RangeError("writeText cannot write more than 16 MiB");
  await writeFile(path, text, "utf8");
  return null;
}

export async function exists(path) {
  path = pathValue(path, "exists");
  try { await stat(path); return true; }
  catch (error) { if (error && error.code === "ENOENT") return false; throw error; }
}

export async function list(path) {
  path = pathValue(path, "list");
  const names = await readdir(path);
  if (names.length > maxListItems) throw new RangeError("list cannot return more than " + maxListItems + " entries");
  let units = 0;
  for (const name of names) {
    units += name.length;
    if (units > maxListCodeUnits) throw new RangeError("list result cannot exceed 2 MiB of text");
  }
  return names.sort();
}

export async function readBlob(path) {
  const data = await boundedFile(path, "readBlob");
  return new Blob(blobToken, data);
}
`.trimStart()],
  ["velar/env", String.raw`
function variableName(value) {
  if (typeof value !== "string" || !/^[A-Za-z_][A-Za-z0-9_]*$/u.test(value) || value.length > 256) {
    throw new TypeError("Environment variable names use ASCII letters, digits, and underscores, starting with a letter or underscore");
  }
  return value;
}
export function get(name) {
  const value = process.env[variableName(name)];
  return value === undefined ? null : value;
}
export function require(name) {
  name = variableName(name);
  const value = process.env[name];
  if (value === undefined) throw new Error("VelarScript environment variable '" + name + "' is required");
  return value;
}
`.trimStart()],
  ["velar/host", String.raw`
const cleanups = [];
let listening = false;
let shuttingDown = false;

function exitCode(value) {
  if (!Number.isSafeInteger(value) || value < 0 || value > 255) throw new RangeError("exit code must be an integer from 0 through 255");
  return value;
}

async function shutdown(signal) {
  if (shuttingDown) process.exit(signal === "SIGINT" ? 130 : 143);
  shuttingDown = true;
  let code = 0;
  for (const cleanup of cleanups) {
    try {
      const result = await cleanup();
      if (result !== null) throw new TypeError("A shutdown cleanup must resolve to null");
    } catch (error) {
      code = 1;
      console.error("[velar/host] shutdown cleanup failed:", error);
    }
  }
  process.exit(code);
}

function listen() {
  if (listening) return;
  listening = true;
  process.on("SIGINT", () => { void shutdown("SIGINT"); });
  process.on("SIGTERM", () => { void shutdown("SIGTERM"); });
}

export function exit(code = 0) { process.exit(exitCode(code)); }
export function onShutdown(cleanup) {
  if (typeof cleanup !== "function") throw new TypeError("onShutdown requires an async cleanup function");
  if (shuttingDown) throw new Error("Cannot register a shutdown cleanup after shutdown begins");
  cleanups.push(cleanup);
  listen();
  return null;
}
`.trimStart()],
  ["velar/serve", String.raw`
import { createServer as createNodeServer } from "node:http";
import { readFile, realpath, stat } from "node:fs/promises";
import { extname, isAbsolute, relative, resolve } from "node:path";

const maxBodyBytes = 16 * 1024 * 1024;
const maxFileBytes = 64 * 1024 * 1024;
const maxStreamChunkBytes = 1024 * 1024;
const maxStreamBytes = 64 * 1024 * 1024;
const maxPathCodeUnits = 4096;
const fileResponseMarker = Symbol("velar.serve.file-response");
const runtimeTypeRegistryKey = Symbol.for("velar.type.registry.v1");
const runtimeTypeRegistry = (() => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, runtimeTypeRegistryKey);
  if (descriptor) return descriptor.value;
  const registry = new WeakSet();
  Object.defineProperty(globalThis, runtimeTypeRegistryKey, { value: registry, enumerable: false, configurable: false, writable: false });
  return registry;
})();
const contentTypes = Object.freeze({
  ".css": "text/css; charset=utf-8", ".gif": "image/gif", ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon", ".jpeg": "image/jpeg", ".jpg": "image/jpeg", ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8", ".map": "application/json; charset=utf-8", ".mjs": "text/javascript; charset=utf-8",
  ".png": "image/png", ".svg": "image/svg+xml", ".txt": "text/plain; charset=utf-8", ".wasm": "application/wasm",
  ".webp": "image/webp", ".woff": "font/woff", ".woff2": "font/woff2",
});

class StaticNotFound extends Error {}

function plainRecord(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function ownData(value, allowed, name) {
  if (!plainRecord(value) || Object.getOwnPropertySymbols(value).length !== 0) throw new TypeError(name + " must be a plain record");
  const output = Object.create(null);
  for (const key of Object.getOwnPropertyNames(value)) {
    if (!allowed.has(key)) throw new TypeError(name + " has unknown field '" + key + "'");
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor?.enumerable || !("value" in descriptor)) throw new TypeError(name + " fields must be enumerable data values");
    output[key] = descriptor.value;
  }
  return output;
}

function boundedStringMap(value, name) {
  if (value == null) return new Map();
  let size;
  try { size = Reflect.getOwnPropertyDescriptor(Map.prototype, "size").get.call(value); }
  catch { throw new TypeError(name + " must be a Map<string, string>"); }
  if (size > 1000) throw new RangeError(name + " cannot contain more than 1000 fields");
  const output = new Map();
  let units = 0;
  for (const [key, item] of Map.prototype.entries.call(value)) {
    if (typeof key !== "string" || typeof item !== "string") throw new TypeError(name + " must be a Map<string, string>");
    units += key.length + item.length;
    if (units > 1024 * 1024) throw new RangeError(name + " cannot exceed 1 MiB of text");
    output.set(key, item);
  }
  return output;
}

function typeObject(check, message) {
  const value = Object.freeze({
    is(candidate) { try { return check(candidate); } catch { return false; } },
    parse(candidate) { if (!this.is(candidate)) throw new TypeError(message); return candidate; },
  });
  runtimeTypeRegistry.add(value);
  return value;
}

function isRequest(value) {
  if (!plainRecord(value)) return false;
  return typeof value.method === "string" && typeof value.path === "string"
    && typeof value.text === "function" && typeof value.json === "function"
    && boundedStringMap(value.query, "ServeRequest.query") && boundedStringMap(value.headers, "ServeRequest.headers");
}

function responseFields(value) {
  if (value?.[fileResponseMarker] === true) return value;
  const fields = ownData(value, new Set(["status", "json", "text", "contentType", "stream", "headers"]), "ServeResponse");
  if (!Number.isSafeInteger(fields.status) || fields.status < 100 || fields.status > 599) throw new RangeError("ServeResponse.status must be an HTTP status integer from 100 through 599");
  const bodies = ["json", "text", "stream"].filter((name) => Object.hasOwn(fields, name));
  if (bodies.length !== 1) throw new TypeError("ServeResponse requires exactly one of json, text, or stream");
  if (Object.hasOwn(fields, "text") && typeof fields.text !== "string") throw new TypeError("ServeResponse.text must be a string");
  if (Object.hasOwn(fields, "stream") && typeof fields.stream !== "function") throw new TypeError("ServeResponse.stream must be an async producer");
  if (fields.contentType != null && (typeof fields.contentType !== "string" || fields.contentType.length > 1024)) throw new TypeError("ServeResponse.contentType must be bounded text");
  boundedStringMap(fields.headers, "ServeResponse.headers");
  return fields;
}

export const ServeRequest = typeObject(isRequest, "ServeRequest requires the request fields provided by velar/serve");
export const ServeResponse = typeObject(value => { responseFields(value); return true; }, "ServeResponse requires exactly one checked body");
export const Server = typeObject(value => plainRecord(value) && Number.isSafeInteger(value.port) && typeof value.stop === "function", "Server requires port and stop fields");

function requestPath(value) {
  if (typeof value !== "string" || value.length === 0 || value.length > maxPathCodeUnits || value.includes("\0") || value.includes("\\")) throw new StaticNotFound();
  let decoded;
  try { decoded = decodeURIComponent(value.split("?", 1)[0]); } catch { throw new StaticNotFound(); }
  if (!decoded.startsWith("/") || decoded.includes("\0") || decoded.includes("\\")) throw new StaticNotFound();
  const segments = decoded.split("/").filter(Boolean);
  if (segments.some(segment => segment === "." || segment === "..")) throw new StaticNotFound();
  return segments.join("/");
}

function fallbackPath(value) {
  if (value == null) return null;
  if (typeof value !== "string" || value.length === 0) throw new TypeError("fileResponse fallback must be non-empty text or null");
  return requestPath(value.startsWith("/") ? value : "/" + value);
}

export function fileResponse(root, path, fallback = null) {
  if (typeof root !== "string" || root.length === 0 || root.length > maxPathCodeUnits || root.includes("\0")) throw new TypeError("fileResponse root must be a bounded path string");
  if (typeof path !== "string") throw new TypeError("fileResponse path must be a string");
  return Object.freeze({ [fileResponseMarker]: true, root, path, fallback: fallbackPath(fallback) });
}

function inside(root, target) {
  const path = relative(root, target);
  return path === "" || (!path.startsWith("..") && !isAbsolute(path));
}

async function staticFile(response) {
  const root = await realpath(resolve(response.root));
  const relativePath = requestPath(response.path);
  const load = async path => {
    const target = await realpath(resolve(root, path));
    if (!inside(root, target)) throw new StaticNotFound();
    const metadata = await stat(target);
    if (!metadata.isFile() || metadata.size > maxFileBytes) throw new StaticNotFound();
    const data = await readFile(target);
    if (data.byteLength > maxFileBytes) throw new StaticNotFound();
    return { data, contentType: contentTypes[extname(target).toLowerCase()] ?? "application/octet-stream" };
  };
  try { return await load(relativePath); }
  catch (error) {
    if ((error instanceof StaticNotFound || error?.code === "ENOENT" || error?.code === "EISDIR") && response.fallback !== null) return load(response.fallback);
    throw error;
  }
}

function safeJson(value) {
  const seen = new WeakSet();
  let items = 0;
  const visit = (current, depth) => {
    if (current === null || typeof current === "string" || typeof current === "boolean") return current;
    if (typeof current === "number") {
      if (!Number.isFinite(current)) throw new TypeError("ServeResponse.json numbers must be finite");
      return Object.is(current, -0) ? 0 : current;
    }
    if (!current || typeof current !== "object" || depth > 128 || seen.has(current)) throw new TypeError("ServeResponse.json must be bounded, acyclic JSON data");
    seen.add(current);
    items += 1;
    if (items > 100000) throw new RangeError("ServeResponse.json cannot contain more than 100000 values");
    if (Array.isArray(current)) {
      if (current.length > 100000 || Object.getOwnPropertySymbols(current).length !== 0) throw new TypeError("ServeResponse.json Lists must be bounded and dense");
      const output = new Array(current.length);
      for (let index = 0; index < current.length; index += 1) {
        const descriptor = Object.getOwnPropertyDescriptor(current, index);
        if (!descriptor || !("value" in descriptor)) throw new TypeError("ServeResponse.json Lists must be dense data");
        output[index] = visit(descriptor.value, depth + 1);
      }
      seen.delete(current);
      return output;
    }
    if (!plainRecord(current) || Object.getOwnPropertySymbols(current).length !== 0) throw new TypeError("ServeResponse.json records must be plain data");
    const output = Object.create(null);
    for (const key of Object.getOwnPropertyNames(current)) {
      const descriptor = Object.getOwnPropertyDescriptor(current, key);
      if (!descriptor?.enumerable || !("value" in descriptor)) throw new TypeError("ServeResponse.json records must contain enumerable data fields");
      output[key] = visit(descriptor.value, depth + 1);
    }
    seen.delete(current);
    return output;
  };
  return JSON.stringify(visit(value, 0));
}

function setHeaders(nodeResponse, values) {
  for (const [name, value] of boundedStringMap(values, "ServeResponse.headers")) {
    if (!/^[!#$%&'*+.^_|~0-9A-Za-z-]+$/u.test(name) || /[\r\n]/u.test(value)) throw new TypeError("ServeResponse headers must use valid HTTP names and single-line values");
    const lower = name.toLowerCase();
    if (lower === "content-length" || lower === "transfer-encoding" || lower === "connection") throw new TypeError("ServeResponse cannot set transport-owned header '" + name + "'");
    nodeResponse.setHeader(name, value);
  }
}

async function writeResponse(nodeResponse, value) {
  if (value?.[fileResponseMarker] === true) {
    try {
      const file = await staticFile(value);
      nodeResponse.statusCode = 200;
      nodeResponse.setHeader("Content-Type", file.contentType);
      nodeResponse.setHeader("Content-Length", file.data.byteLength);
      nodeResponse.end(file.data);
    } catch (error) {
      if (!(error instanceof StaticNotFound) && error?.code !== "ENOENT" && error?.code !== "EISDIR") throw error;
      nodeResponse.statusCode = 404;
      nodeResponse.setHeader("Content-Type", "text/plain; charset=utf-8");
      nodeResponse.end("Not found");
    }
    return;
  }
  const response = responseFields(value);
  nodeResponse.statusCode = response.status;
  setHeaders(nodeResponse, response.headers);
  if (Object.hasOwn(response, "json")) {
    const body = safeJson(response.json);
    if (Buffer.byteLength(body, "utf8") > maxBodyBytes) throw new RangeError("ServeResponse.json cannot exceed 16 MiB");
    if (!nodeResponse.hasHeader("Content-Type")) nodeResponse.setHeader("Content-Type", "application/json; charset=utf-8");
    nodeResponse.end(body);
    return;
  }
  if (Object.hasOwn(response, "text")) {
    if (Buffer.byteLength(response.text, "utf8") > maxBodyBytes) throw new RangeError("ServeResponse.text cannot exceed 16 MiB");
    if (!nodeResponse.hasHeader("Content-Type")) nodeResponse.setHeader("Content-Type", response.contentType ?? "text/plain; charset=utf-8");
    nodeResponse.end(response.text);
    return;
  }
  let total = 0;
  const write = chunk => new Promise((resolveWrite, rejectWrite) => {
    if (typeof chunk !== "string") { rejectWrite(new TypeError("ServeResponse.stream chunks must be strings")); return; }
    const bytes = Buffer.byteLength(chunk, "utf8");
    if (bytes > maxStreamChunkBytes || total + bytes > maxStreamBytes) { rejectWrite(new RangeError("ServeResponse.stream exceeded its bounded output")); return; }
    total += bytes;
    if (nodeResponse.write(chunk)) resolveWrite(null);
    else {
      nodeResponse.once("drain", () => resolveWrite(null));
      nodeResponse.once("error", rejectWrite);
    }
  });
  const result = await response.stream(write);
  if (result !== null) throw new TypeError("ServeResponse.stream producer must resolve to null");
  nodeResponse.end();
}

function requestBody(nodeRequest) {
  let pending = null;
  return () => {
    if (pending) return pending;
    pending = (async () => {
      const declared = Number(nodeRequest.headers["content-length"] ?? 0);
      if (Number.isFinite(declared) && declared > maxBodyBytes) throw new RangeError("Request body cannot exceed 16 MiB");
      const chunks = [];
      let total = 0;
      for await (const chunk of nodeRequest) {
        const data = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
        total += data.byteLength;
        if (total > maxBodyBytes) throw new RangeError("Request body cannot exceed 16 MiB");
        chunks.push(data);
      }
      try { return new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks, total)); }
      catch { throw new TypeError("Request body must be valid UTF-8 text"); }
    })();
    return pending;
  };
}

function serveRequest(nodeRequest, host) {
  const url = new URL(nodeRequest.url ?? "/", "http://" + host);
  const body = requestBody(nodeRequest);
  const headers = new Map();
  for (const [name, value] of Object.entries(nodeRequest.headers)) {
    if (typeof value === "string") headers.set(name, value);
    else if (Array.isArray(value)) headers.set(name, value.join(", "));
  }
  const query = new Map();
  for (const [name, value] of url.searchParams) if (!query.has(name)) query.set(name, value);
  return Object.freeze({
    method: nodeRequest.method ?? "GET",
    path: url.pathname,
    query,
    headers,
    text: body,
    json: async () => JSON.parse(await body()),
  });
}

function opaqueFailure(nodeResponse) {
  if (nodeResponse.headersSent) { nodeResponse.destroy(); return; }
  nodeResponse.statusCode = 500;
  nodeResponse.setHeader("Content-Type", "text/plain; charset=utf-8");
  nodeResponse.end("Internal server error");
}

export async function serve(handler, port, host = "127.0.0.1") {
  if (typeof handler !== "function") throw new TypeError("serve requires an async request handler");
  if (!Number.isSafeInteger(port) || port < 0 || port > 65535) throw new RangeError("serve port must be an integer from 0 through 65535");
  if (typeof host !== "string" || host.length === 0 || host.length > 255) throw new TypeError("serve host must be bounded text");
  const nodeServer = createNodeServer((request, response) => {
    Promise.resolve().then(() => handler(serveRequest(request, host))).then(value => writeResponse(response, value)).catch(error => {
      console.error("[velar/serve] request handler failed:", error);
      opaqueFailure(response);
    });
  });
  await new Promise((resolveListen, rejectListen) => {
    const failed = error => { nodeServer.off("listening", ready); rejectListen(error); };
    const ready = () => { nodeServer.off("error", failed); resolveListen(); };
    nodeServer.once("error", failed);
    nodeServer.once("listening", ready);
    nodeServer.listen({ port, host });
  });
  const address = nodeServer.address();
  if (!address || typeof address === "string") throw new Error("velar/serve could not determine the bound port");
  let stopped = null;
  const stop = () => {
    if (stopped) return stopped;
    stopped = new Promise((resolveStop, rejectStop) => {
      nodeServer.close(error => error ? rejectStop(error) : resolveStop(null));
      nodeServer.closeIdleConnections?.();
    });
    return stopped;
  };
  return Object.freeze({ port: address.port, stop });
}
`.trimStart()],
]);

const localPlatformModules = new Set(localPlatformModuleInterfaces.keys());

export function isLocalPlatformModule(source: string): boolean {
  return localPlatformModules.has(source);
}

export function localPlatformModuleDiagnostic(source: string): string {
  if (source === "velar/serve") return "velar/serve is a local runtime module; web applications use the dev server and velar/http";
  return `${source} is a local runtime module and cannot run in a web application`;
}
