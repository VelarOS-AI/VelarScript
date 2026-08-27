// Convention-based server application assembly. The Node extension owns the
// transport and route primitives; this application extension owns only root
// configuration discovery, startup assembly, and connection lifetime.

export const VELAR_SERVER_RUNTIME = String.raw`
import { exists as __velarServerExists, readText as __velarServerReadText } from "velar/fs";
import { ServeApp as __velarServerServeApp, __velarServeAuthenticationCredential as __velarServerAuthenticationCredential, __velarServeAuthenticationError as __velarServerAuthenticationError, provide as __velarServerProvide, serve as __velarServerServe } from "velar/serve";
import { parseDocument as __velarServerParseYamlDocument } from "yaml";

const __velarServerApply = Reflect.apply;
const __velarServerArray = Array;
const __velarServerError = Error;
const __velarServerObject = Object;
const __velarServerNumber = Number;
const __velarServerRegExp = RegExp;
const __velarServerString = String;
const __velarServerTypeError = TypeError;
const __velarServerRangeError = RangeError;
const __velarServerArrayIsArray = __velarServerArray.isArray;
const __velarServerArrayIncludes = __velarServerArray.prototype.includes;
const __velarServerObjectFreeze = __velarServerObject.freeze;
const __velarServerObjectGetOwnPropertyDescriptor = __velarServerObject.getOwnPropertyDescriptor;
const __velarServerObjectGetPrototypeOf = __velarServerObject.getPrototypeOf;
const __velarServerObjectKeys = __velarServerObject.keys;
const __velarServerNumberIsSafeInteger = __velarServerNumber.isSafeInteger;
const __velarServerRegExpTest = __velarServerRegExp.prototype.test;
const __velarServerStringEndsWith = __velarServerString.prototype.endsWith;
const __velarServerStringIncludes = __velarServerString.prototype.includes;
const __velarServerStringToLowerCase = __velarServerString.prototype.toLowerCase;
const __velarServerConfigurationPathName = "application.yml";
const __velarServerUnsupportedConfigurationPaths = __velarServerObjectFreeze(["application.yaml", "application.json"]);
const __velarServerOptionFields = __velarServerObjectFreeze(["host", "port", "maxBodyBytes"]);
const __velarServerMaximumConfigurationBytes = 1024 * 1024;
const __velarServerDefaultConfigurationBytes = 64 * 1024;
const __velarServerMaximumBodyBytes = 16 * 1024 * 1024;
const __velarServerHostPattern = /[/\\\s?#]/u;
const __velarServerIpv6Pattern = /^[:0-9a-f]+$/iu;

function __velarServerCall(operation, receiver, args) {
  return __velarServerApply(operation, receiver, args);
}

function __velarServerRecord(value, name, fields = null) {
  if (!value || typeof value !== "object" || __velarServerCall(__velarServerArrayIsArray, __velarServerArray, [value])) {
    throw new __velarServerTypeError(name + " must be a plain record");
  }
  const prototype = __velarServerCall(__velarServerObjectGetPrototypeOf, __velarServerObject, [value]);
  if (prototype !== __velarServerObject.prototype && prototype !== null) throw new __velarServerTypeError(name + " must be a plain record");
  const keys = __velarServerCall(__velarServerObjectKeys, __velarServerObject, [value]);
  for (let index = 0; index < keys.length; index += 1) {
    const key = keys[index];
    if (fields && !__velarServerCall(__velarServerArrayIncludes, fields, [key])) {
      throw new __velarServerTypeError(name + " has unknown field '" + key + "'");
    }
    const descriptor = __velarServerCall(__velarServerObjectGetOwnPropertyDescriptor, __velarServerObject, [value, key]);
    if (!descriptor?.enumerable || !("value" in descriptor)) throw new __velarServerTypeError(name + " fields must be enumerable data values");
  }
  return value;
}

function __velarServerOption(value, name) {
  const descriptor = __velarServerCall(__velarServerObjectGetOwnPropertyDescriptor, __velarServerObject, [value, name]);
  return descriptor && "value" in descriptor ? descriptor.value : undefined;
}

function __velarServerConfigurationExtension(path) {
  if (typeof path !== "string" || path.length === 0 || path.length > 4096 || __velarServerCall(__velarServerStringIncludes, path, ["\0"])) {
    throw new __velarServerTypeError("Server configuration path must be bounded non-empty text");
  }
  const lower = __velarServerCall(__velarServerStringToLowerCase, path, []);
  if (__velarServerCall(__velarServerStringEndsWith, lower, [".yml"]) || __velarServerCall(__velarServerStringEndsWith, lower, [".yaml"])) return "yaml";
  if (__velarServerCall(__velarServerStringEndsWith, lower, [".json"])) return "json";
  throw new __velarServerTypeError("Server configuration path must end in .yml, .yaml, or .json");
}

async function __velarServerConfigurationPath(path, required) {
  if (path !== null) {
    __velarServerConfigurationExtension(path);
    return path;
  }
  for (let index = 0; index < __velarServerUnsupportedConfigurationPaths.length; index += 1) {
    const unsupported = __velarServerUnsupportedConfigurationPaths[index];
    if (await __velarServerExists(unsupported)) {
      throw new __velarServerTypeError("Unsupported conventional Server configuration '" + unsupported + "'; rename it to application.yml or pass it as an explicit configuration path");
    }
  }
  if (!await __velarServerExists(__velarServerConfigurationPathName)) {
    if (!required) return null;
    throw new __velarServerTypeError("Server configuration is missing; create application.yml in the project root");
  }
  return __velarServerConfigurationPathName;
}

function __velarServerYaml(source, path) {
  let document;
  try {
    document = __velarServerParseYamlDocument(source, {prettyErrors: false, strict: true, uniqueKeys: true, maxAliasCount: 100});
  } catch (error) {
    throw new __velarServerTypeError("Cannot parse server YAML configuration '" + path + "': " + (error instanceof __velarServerError ? error.message : "invalid YAML"));
  }
  if (document.errors.length > 0) throw new __velarServerTypeError("Cannot parse server YAML configuration '" + path + "': " + document.errors[0].message);
  return document.toJS({maxAliasCount: 100});
}

async function __velarServerReadConfiguration(path, maxBytes, required) {
  const resolved = await __velarServerConfigurationPath(path, required);
  if (resolved === null) return null;
  let source;
  try { source = await __velarServerReadText(resolved, maxBytes); }
  catch (error) { throw new __velarServerTypeError("Cannot read server configuration '" + resolved + "': " + (error instanceof __velarServerError ? error.message : "read failed")); }
  return __velarServerConfigurationExtension(resolved) === "json"
    ? __velarJsonParse(source, "Server JSON configuration")
    : __velarServerYaml(source, resolved);
}

function __velarServerOptions(configuration) {
  if (configuration === null) return {host: "127.0.0.1", port: 3000, maxBodyBytes: __velarServerMaximumBodyBytes};
  const root = __velarServerRecord(configuration, "Application configuration");
  const raw = __velarServerOption(root, "server");
  const options = raw === undefined ? {} : __velarServerRecord(raw, "Application configuration server", __velarServerOptionFields);
  const host = __velarServerOption(options, "host") ?? "127.0.0.1";
  const port = __velarServerOption(options, "port") ?? 3000;
  const maxBodyBytes = __velarServerOption(options, "maxBodyBytes") ?? __velarServerMaximumBodyBytes;
  if (typeof host !== "string" || host.length === 0 || host.length > 255
    || __velarServerCall(__velarServerRegExpTest, __velarServerHostPattern, [host])
    || (__velarServerCall(__velarServerStringIncludes, host, [":"]) && host !== "::" && !__velarServerCall(__velarServerRegExpTest, __velarServerIpv6Pattern, [host]))) {
    throw new __velarServerTypeError("application server.host must be a hostname or IP address without a URL scheme or port");
  }
  if (!__velarServerCall(__velarServerNumberIsSafeInteger, __velarServerNumber, [port]) || port < 1 || port > 65535) {
    throw new __velarServerRangeError("application server.port must be an integer from 1 through 65535");
  }
  if (!__velarServerCall(__velarServerNumberIsSafeInteger, __velarServerNumber, [maxBodyBytes]) || maxBodyBytes < 1 || maxBodyBytes > __velarServerMaximumBodyBytes) {
    throw new __velarServerRangeError("application server.maxBodyBytes must be an integer from 1 through 16777216");
  }
  return {host, port, maxBodyBytes};
}

export async function configuration(Type, path = null, maxBytes = __velarServerDefaultConfigurationBytes) {
  Type = __velarRequireRuntimeType(Type, "server.configuration");
  if (!__velarServerCall(__velarServerNumberIsSafeInteger, __velarServerNumber, [maxBytes]) || maxBytes < 1 || maxBytes > __velarServerMaximumConfigurationBytes) {
    throw new __velarServerRangeError("server.configuration maxBytes must be an integer from 1 through 1048576");
  }
  return Type.parse(await __velarServerReadConfiguration(path, maxBytes, true));
}

export function application(app, path = null) {
  app = __velarServerServeApp.parse(app);
  if (path !== null) __velarServerConfigurationExtension(path);
  return async () => {
    const options = __velarServerOptions(await __velarServerReadConfiguration(path, __velarServerDefaultConfigurationBytes, false));
    return await __velarServerServe(app, options.port, options.host, options.maxBodyBytes);
  };
}

export function authenticate(credential, verify) {
  if (typeof verify !== "function") throw new __velarServerTypeError("server.authenticate requires a verify function");
  credential = __velarServerAuthenticationCredential(credential);
  return __velarServerProvide(
    {credential},
    async values => {
      const identity = await verify(values.credential);
      if (identity === null) throw __velarServerAuthenticationError(credential);
      if (identity === undefined) throw new __velarServerTypeError("server.authenticate verify must resolve to an identity or null");
      return identity;
    },
  );
}

export function database(connect, disconnect) {
  if (typeof connect !== "function" || typeof disconnect !== "function") {
    throw new __velarServerTypeError("server.database requires connect and disconnect functions");
  }
  return __velarServerProvide(
    {},
    async () => await connect(),
    "app",
    async connection => { await disconnect(connection); return null; },
    true,
  );
}

`.trimStart();
