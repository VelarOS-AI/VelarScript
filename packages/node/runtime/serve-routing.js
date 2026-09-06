function __velarServeRouteShape(path) {
  return __velarServeRouteShapeFromSegments(__velarServeCall(__velarServeStringSplit, path, ["/"]));
}

function __velarServeRouteBinding(pattern, pathname, params, query) {
  const bound = {pattern, pathname, params, query};
  __velarServeCall(__velarServeObjectDefineProperty, __velarServeObject, [bound, "toString", {value: () => pattern.definition, enumerable: false, configurable: false, writable: false}]);
  return __velarServeCall(__velarServeObjectFreeze, __velarServeObject, [bound]);
}

/**
 * 编译器把 p"..." 降低成结构化数据，这里只做边界复核并冻结。路由字符串
 * 不会在每次请求中重新解析；捕获的类型检查函数与 OpenAPI schema 也随模板
 * 一次性保存。
 */
function __velarCreateServePattern(source) {
  source = __velarServeRecord(source, __velarServePatternFields, "RoutePattern");
  const pathname = __velarServeRoutePath(source.pathname, "RoutePattern pathname");
  if (typeof source.definition !== "string" || source.definition.length === 0 || source.definition.length > __velarServeMaxPathCodeUnits) {
    throw new __velarServeTypeError("RoutePattern definition must be bounded text");
  }
  const fieldNames = new __velarServeMap();
  const readCaptures = (items, query) => {
    if (!__velarServeIsArray(items) || items.length > 64) throw new __velarServeTypeError("RoutePattern captures must be a bounded list");
    const output = [];
    const localNames = new __velarServeMap();
    const wireNames = new __velarServeMap();
    for (let index = 0; index < items.length; index += 1) {
      const item = __velarServeRecord(items[index], __velarServePatternCaptureFields, "RoutePattern capture");
      if (typeof item.name !== "string" || !__velarServeCall(__velarServeRegExpTest, __velarServeRouteNamePattern, [item.name])
        || typeof item.wireName !== "string" || item.wireName.length === 0 || item.wireName.length > 256
        || typeof item.explicitWireName !== "boolean" || !query && item.explicitWireName
        || query && !item.explicitWireName && item.wireName !== item.name
        || typeof item.typeName !== "string" || !__velarServeCall(__velarServeRegExpTest, __velarServeRouteNamePattern, [item.typeName])
        || typeof item.optional !== "boolean" || !query && item.optional
        || !__velarServeCall(__velarServeArrayIncludes, ["string", "number", "bool", "enum"], [item.kind])
        || typeof item.check !== "function") throw new __velarServeTypeError("RoutePattern capture is invalid");
      if (__velarServeCall(__velarServeMapHas, localNames, [item.name])) throw new __velarServeTypeError("RoutePattern field names must be unique");
      if (__velarServeCall(__velarServeMapHas, fieldNames, [item.name])) throw new __velarServeTypeError("RoutePattern path and query field names must be unique");
      if (__velarServeCall(__velarServeMapHas, wireNames, [item.wireName])) throw new __velarServeTypeError("RoutePattern wire names must be unique");
      __velarServeCall(__velarServeMapSet, localNames, [item.name, true]);
      __velarServeCall(__velarServeMapSet, fieldNames, [item.name, true]);
      __velarServeCall(__velarServeMapSet, wireNames, [item.wireName, true]);
      output[output.length] = __velarServeCall(__velarServeObjectFreeze, __velarServeObject, [{
        name: item.name, wireName: item.wireName, explicitWireName: item.explicitWireName, typeName: item.typeName, optional: item.optional,
        kind: item.kind, check: item.check, schema: __velarServeSchema(item.schema ?? {}, "RoutePattern capture schema"),
      }]);
    }
    return output;
  };
  const path = readCaptures(source.path, false);
  const query = readCaptures(source.query, true);
  const declared = new __velarServeMap();
  const segments = __velarServeCall(__velarServeStringSplit, pathname, ["/"]);
  // 捕获名在路由注册时按路径段预编译。请求匹配阶段只做数组读取，
  // 不再反复对 {name:type} 执行 startsWith/slice/indexOf。
  const segmentCaptures = [];
  segmentCaptures[0] = null;
  for (let index = 1; index < segments.length; index += 1) {
    const segment = segments[index];
    if (!__velarServeCall(__velarServeStringStartsWith, segment, ["{"])) {
      segmentCaptures[index] = null;
      continue;
    }
    const text = __velarServeCall(__velarServeStringSlice, segment, [1, -1]);
    const colon = __velarServeCall(__velarServeStringIndexOf, text, [":"]);
    const captureName = __velarServeCall(__velarServeStringSlice, text, [0, colon]);
    segmentCaptures[index] = captureName;
    __velarServeCall(__velarServeMapSet, declared, [captureName, true]);
  }
  if (__velarServeCall(__velarServeMapSize, declared, []) !== path.length) throw new __velarServeTypeError("RoutePattern path captures do not match its pathname");
  for (let index = 0; index < path.length; index += 1) {
    if (path[index].wireName !== path[index].name || !__velarServeCall(__velarServeMapHas, declared, [path[index].name])) {
      throw new __velarServeTypeError("RoutePattern path captures do not match its pathname");
    }
  }
  let canonical = pathname;
  if (query.length > 0) {
    const clauses = [];
    for (let index = 0; index < query.length; index += 1) {
      const item = query[index];
      clauses[index] = (item.explicitWireName ? item.wireName + "=" : "")
        + "{" + item.name + ":" + item.typeName + (item.optional ? "?" : "") + "}";
    }
    canonical += "?" + __velarServeCall(__velarServeArrayJoin, clauses, ["&"]);
  }
  if (canonical !== source.definition) throw new __velarServeTypeError("RoutePattern definition does not agree with its compiled structure");
  const value = {definition: source.definition};
  __velarServeCall(__velarServeObjectDefineProperty, __velarServeObject, [value, __velarServePatternMarker, {value: true, enumerable: false, configurable: false, writable: false}]);
  __velarServeCall(__velarServeObjectDefineProperty, __velarServeObject, [value, "pathname", {value: pathname, enumerable: false, configurable: false, writable: false}]);
  __velarServeCall(__velarServeObjectDefineProperty, __velarServeObject, [value, "pathCaptures", {value: __velarServeCall(__velarServeObjectFreeze, __velarServeObject, [path]), enumerable: false, configurable: false, writable: false}]);
  __velarServeCall(__velarServeObjectDefineProperty, __velarServeObject, [value, "queryCaptures", {value: __velarServeCall(__velarServeObjectFreeze, __velarServeObject, [query]), enumerable: false, configurable: false, writable: false}]);
  __velarServeCall(__velarServeObjectDefineProperty, __velarServeObject, [value, "segmentCaptures", {value: __velarServeCall(__velarServeObjectFreeze, __velarServeObject, [segmentCaptures]), enumerable: false, configurable: false, writable: false}]);
  __velarServeCall(__velarServeObjectDefineProperty, __velarServeObject, [value, "toString", {value: () => source.definition, enumerable: false, configurable: false, writable: false}]);
  return __velarServeCall(__velarServeObjectFreeze, __velarServeObject, [value]);
}

function __velarCreateServeRoute(method, pattern, parameters, handler, metadata = {}, bindRoute = true) {
  if (typeof method !== "string" || !__velarServeCall(__velarServeArrayIncludes, ["GET", "POST", "PUT", "PATCH", "DELETE"], [method])) throw new __velarServeTypeError("Route method is invalid");
  if (!__velarServeIsPattern(pattern)) throw new __velarServeTypeError("Route path must be a RoutePattern declared with p\"/...\"");
  const path = pattern.pathname;
  if (!__velarServeIsArray(parameters) || parameters.length > 64) throw new __velarServeTypeError("Route parameters must be a bounded list");
  const checked = [];
  const names = new __velarServeMap();
  for (let index = 0; index < parameters.length; index += 1) {
    const parameter = __velarServeRecord(parameters[index], __velarServeRouteParameterFields, "Route parameter");
    if (typeof parameter.name !== "string" || !__velarServeCall(__velarServeRegExpTest, __velarServeRouteNamePattern, [parameter.name])
      || __velarServeCall(__velarServeMapHas, names, [parameter.name])) throw new __velarServeTypeError("Route parameter names must be unique identifiers");
    if (!__velarServeCall(__velarServeArrayIncludes, ["body", "request", "header", "cookie", "form", "upload", "dependency", "security"], [parameter.source])
      || !__velarServeCall(__velarServeArrayIncludes, ["string", "number", "bool", "enum", "list", "data", "request", "upload", "dependency", "security"], [parameter.kind])
      || typeof parameter.required !== "boolean" || parameter.source !== "request" && typeof parameter.check !== "function") {
      throw new __velarServeTypeError("Route parameter descriptor is invalid");
    }
    const routeInput = parameter.input == null ? null : parameter.input;
    if (routeInput !== null && (!__velarServeIsInput(routeInput) || routeInput.source !== parameter.source)) {
      throw new __velarServeTypeError("Route input descriptor does not agree with its compiled source");
    }
    const scalar = parameter.kind === "string" || parameter.kind === "number" || parameter.kind === "bool" || parameter.kind === "enum";
    if (parameter.source === "body" && parameter.kind !== "data"
      || parameter.source === "request" && (parameter.kind !== "request" || parameter.required !== true)
      || parameter.source === "header" && !scalar
      || parameter.source === "cookie" && !scalar
      || parameter.source === "form" && parameter.kind !== "data"
      || parameter.source === "upload" && parameter.kind !== "upload"
      || parameter.source === "dependency" && parameter.kind !== "dependency"
      || parameter.source === "security" && parameter.kind !== "security") {
      throw new __velarServeTypeError("Route parameter source and kind do not agree");
    }
    __velarServeCall(__velarServeMapSet, names, [parameter.name, true]);
    const schema = parameter.schema == null ? __velarServeDefaultSchema(parameter.kind) : __velarServeSchema(parameter.schema, "Route parameter schema");
    const required = routeInput !== null && (routeInput.source === "header" || routeInput.source === "cookie")
      ? !routeInput.hasDefault
      : parameter.required;
    checked[checked.length] = __velarServeCall(__velarServeObjectFreeze, __velarServeObject, [{name: parameter.name, source: parameter.source, kind: parameter.kind, required, check: parameter.check ?? null, schema, input: routeInput}]);
  }
  const segments = __velarServeCall(__velarServeStringSplit, path, ["/"]);
  if (typeof handler !== "function") throw new __velarServeTypeError("Route handler is invalid");
  if (typeof bindRoute !== "boolean" || !bindRoute && (pattern.pathCaptures.length > 0 || pattern.queryCaptures.length > 0)) {
    throw new __velarServeTypeError("A route with path or query captures must bind its RouteMatch");
  }
  metadata = __velarServeRecord(metadata, __velarServeRouteMetadataFields, "Route metadata");
  const operationId = __velarServeOperationIdentity(metadata.operationId, "Route operationId");
  const responseSchema = metadata.responseSchema == null ? {} : __velarServeSchema(metadata.responseSchema, "Route response schema");
  const responseContentTypes = metadata.responseContentTypes == null ? ["application/json"] : __velarServeStringList(metadata.responseContentTypes, "Route response content types", 8);
  const maxBodyBytes = metadata.maxBodyBytes == null ? null : __velarServeBodyLimit(metadata.maxBodyBytes);
  const middleware = metadata.middleware == null ? [] : metadata.middleware;
  const documented = metadata.documented == null ? true : metadata.documented;
  if (typeof documented !== "boolean") throw new __velarServeTypeError("Route documented metadata must be bool");
  const summary = __velarServeDocumentationText(metadata.summary, "Route summary", 1024);
  const description = __velarServeDocumentationText(metadata.description, "Route description", 16384);
  const tags = metadata.tags == null ? [] : __velarServeStringList(metadata.tags, "Route documentation tags", 32);
  const status = metadata.status == null ? 200 : metadata.status;
  if (!__velarServeIsSafeInteger(status) || status < 200 || status > 599) throw new __velarServeRangeError("Route documentation status must be 200 through 599");
  const errors = __velarServeErrorDocuments(metadata.errors);
  if (!__velarServeIsArray(middleware) || middleware.length > 64) throw new __velarServeRangeError("A route cannot have more than 64 middleware functions");
  const checkedMiddleware = [];
  for (let index = 0; index < middleware.length; index += 1) {
    if (typeof middleware[index] !== "function") throw new __velarServeTypeError("Route middleware entries must be functions");
    checkedMiddleware[checkedMiddleware.length] = middleware[index];
  }
  return __velarServeCall(__velarServeObjectFreeze, __velarServeObject, [{
    [__velarServeRouteMarker]: true,
    method,
    path,
    pattern,
    segments: __velarServeCall(__velarServeObjectFreeze, __velarServeObject, [segments]),
    segmentCaptures: pattern.segmentCaptures,
    bindRoute,
    parameters: __velarServeCall(__velarServeObjectFreeze, __velarServeObject, [checked]),
    handler,
    operationId,
    responseSchema,
    responseContentTypes: __velarServeCall(__velarServeObjectFreeze, __velarServeObject, [responseContentTypes]),
    maxBodyBytes,
    middleware: __velarServeCall(__velarServeObjectFreeze, __velarServeObject, [checkedMiddleware]),
    documented,
    summary,
    description,
    tags: __velarServeCall(__velarServeObjectFreeze, __velarServeObject, [tags]),
    status,
    errors,
  }]);
}

function __velarCreateServeWebSocket(pattern, parameters, handler, metadata = {}, bindRoute = true) {
  if (!__velarServeIsPattern(pattern)) throw new __velarServeTypeError("WebSocket path must be a RoutePattern declared with p\"/...\"");
  if (!__velarServeIsArray(parameters) || parameters.length > 64) throw new __velarServeTypeError("WebSocket parameters must be a bounded list");
  const checked = [];
  const names = new __velarServeMap();
  let connectionIndex = -1;
  for (let index = 0; index < parameters.length; index += 1) {
    const parameter = __velarServeRecord(parameters[index], __velarServeRouteParameterFields, "WebSocket parameter");
    if (typeof parameter.name !== "string" || !__velarServeCall(__velarServeRegExpTest, __velarServeRouteNamePattern, [parameter.name])
      || __velarServeCall(__velarServeMapHas, names, [parameter.name])) throw new __velarServeTypeError("WebSocket parameter names must be unique identifiers");
    if (!__velarServeCall(__velarServeArrayIncludes, ["connection", "request", "header", "cookie", "dependency", "security"], [parameter.source])
      || !__velarServeCall(__velarServeArrayIncludes, ["connection", "request", "string", "number", "bool", "enum", "dependency", "security"], [parameter.kind])
      || parameter.required !== true) throw new __velarServeTypeError("WebSocket parameter descriptor is invalid");
    const routeInput = parameter.input == null ? null : parameter.input;
    if (parameter.source === "connection") {
      if (parameter.kind !== "connection" || routeInput !== null || connectionIndex !== -1) throw new __velarServeTypeError("A WebSocket route requires exactly one connection parameter");
      connectionIndex = index;
    } else if (parameter.source === "request") {
      if (parameter.kind !== "request" || routeInput !== null) throw new __velarServeTypeError("WebSocket Request descriptor is invalid");
    } else {
      if (routeInput === null || !__velarServeIsInput(routeInput) || routeInput.source !== parameter.source) throw new __velarServeTypeError("WebSocket input descriptor does not agree with its compiled source");
      const scalar = parameter.kind === "string" || parameter.kind === "number" || parameter.kind === "bool" || parameter.kind === "enum";
      if (parameter.source === "header" && !scalar || parameter.source === "cookie" && !scalar
        || parameter.source === "dependency" && parameter.kind !== "dependency"
        || parameter.source === "security" && parameter.kind !== "security") throw new __velarServeTypeError("WebSocket parameter source and kind do not agree");
    }
    __velarServeCall(__velarServeMapSet, names, [parameter.name, true]);
    checked[checked.length] = __velarServeCall(__velarServeObjectFreeze, __velarServeObject, [{
      name: parameter.name,
      source: parameter.source,
      kind: parameter.kind,
      required: true,
      check: parameter.check ?? null,
      schema: parameter.schema == null ? __velarServeDefaultSchema(parameter.kind) : __velarServeSchema(parameter.schema, "WebSocket parameter schema"),
      input: routeInput,
    }]);
  }
  if (connectionIndex === -1) throw new __velarServeTypeError("A WebSocket route requires exactly one connection parameter");
  if (typeof handler !== "function") throw new __velarServeTypeError("WebSocket handler is invalid");
  if (typeof bindRoute !== "boolean" || !bindRoute && (pattern.pathCaptures.length > 0 || pattern.queryCaptures.length > 0)) {
    throw new __velarServeTypeError("A WebSocket route with path or query captures must bind its RouteMatch");
  }
  metadata = __velarServeRecord(metadata, __velarServeWebSocketMetadataFields, "WebSocket metadata");
  const operationId = __velarServeOperationIdentity(metadata.operationId, "WebSocket operationId");
  const documented = metadata.documented == null ? true : metadata.documented;
  if (typeof documented !== "boolean") throw new __velarServeTypeError("WebSocket documented metadata must be bool");
  const summary = __velarServeDocumentationText(metadata.summary, "WebSocket summary", 1024);
  const description = __velarServeDocumentationText(metadata.description, "WebSocket description", 16384);
  const tags = metadata.tags == null ? [] : __velarServeStringList(metadata.tags, "WebSocket documentation tags", 32);
  const path = pattern.pathname;
  const segments = __velarServeCall(__velarServeStringSplit, path, ["/"]);
  return __velarServeCall(__velarServeObjectFreeze, __velarServeObject, [{
    [__velarServeWebSocketMarker]: true,
    method: "WEBSOCKET",
    path,
    pattern,
    segments: __velarServeCall(__velarServeObjectFreeze, __velarServeObject, [segments]),
    segmentCaptures: pattern.segmentCaptures,
    bindRoute,
    parameters: __velarServeCall(__velarServeObjectFreeze, __velarServeObject, [checked]),
    connectionIndex,
    handler,
    operationId,
    documented,
    summary,
    description,
    tags: __velarServeCall(__velarServeObjectFreeze, __velarServeObject, [tags]),
  }]);
}

function __velarServeOperationIdentity(value, name) {
  if (value == null) return null;
  if (typeof value !== "string" || !__velarServeCall(__velarServeRegExpTest, __velarServeRouteNamePattern, [value])) {
    throw new __velarServeTypeError(name + " must be a source identifier");
  }
  return value;
}

function __velarCreateServeNotFound(handler, middleware = []) {
  if (typeof handler !== "function") throw new __velarServeTypeError("@notFound handler is invalid");
  if (!__velarServeIsArray(middleware) || middleware.length > 64) throw new __velarServeRangeError("@notFound cannot have more than 64 middleware functions");
  const checkedMiddleware = [];
  for (let index = 0; index < middleware.length; index += 1) {
    if (typeof middleware[index] !== "function") throw new __velarServeTypeError("@notFound middleware entries must be functions");
    checkedMiddleware[checkedMiddleware.length] = middleware[index];
  }
  return __velarServeCall(__velarServeObjectFreeze, __velarServeObject, [{
    [__velarServeNotFoundMarker]: true,
    handler,
    middleware: __velarServeCall(__velarServeObjectFreeze, __velarServeObject, [checkedMiddleware]),
  }]);
}

function __velarCreateServeResponse(handler, metadata = {}) {
  if (typeof handler !== "function") throw new __velarServeTypeError("@response handler is invalid");
  metadata = __velarServeRecord(metadata, __velarServeResponseHandlerFields, "@response metadata");
  const responseSchema = metadata.responseSchema == null ? {} : __velarServeSchema(metadata.responseSchema, "@response schema");
  const responseContentTypes = metadata.responseContentTypes == null
    ? ["application/json"]
    : __velarServeStringList(metadata.responseContentTypes, "@response content types", 8);
  return __velarServeCall(__velarServeObjectFreeze, __velarServeObject, [{
    [__velarServeResponseHandlerMarker]: true,
    handler,
    responseSchema,
    responseContentTypes: __velarServeCall(__velarServeObjectFreeze, __velarServeObject, [responseContentTypes]),
  }]);
}

function __velarServeDocumentationText(value, name, maximum) {
  if (value == null) return null;
  if (typeof value !== "string" || value.length === 0 || value.length > maximum || /[\0]/u.test(value)) {
    throw new __velarServeTypeError(name + " must be bounded non-empty text");
  }
  return value;
}

function __velarServeErrorDocuments(value) {
  if (value == null) return __velarServeCall(__velarServeObjectFreeze, __velarServeObject, [[]]);
  const output = [];
  if (__velarServeIsArray(value)) {
    if (value.length > 32) throw new __velarServeRangeError("Route documentation cannot declare more than 32 error responses");
    for (let index = 0; index < value.length; index += 1) {
      const item = __velarServeRecord(value[index], __velarServeErrorDocumentationFields, "Route error documentation");
      if (!__velarServeIsSafeInteger(item.status) || item.status < 400 || item.status > 599) throw new __velarServeRangeError("Route error status must be 400 through 599");
      output[output.length] = __velarServeCall(__velarServeObjectFreeze, __velarServeObject, [{status: item.status, description: __velarServeDocumentationText(item.description, "Route error description", 4096)}]);
    }
  } else {
    let size;
    let iterator;
    try { size = __velarServeCall(__velarServeMapSize, value, []); iterator = __velarServeCall(__velarServeMapEntries, value, []); }
    catch { throw new __velarServeTypeError("Route documentation errors must be a Map<number, string>"); }
    if (!__velarServeIsSafeInteger(size) || size < 0 || size > 32) throw new __velarServeRangeError("Route documentation cannot declare more than 32 error responses");
    while (true) {
      const step = __velarServeCall(__velarServeMapIteratorNext, iterator, []);
      if (step.done) break;
      const item = step.value;
      if (!__velarServeIsArray(item) || item.length !== 2 || !__velarServeIsSafeInteger(item[0]) || item[0] < 400 || item[0] > 599) {
        throw new __velarServeTypeError("Route documentation errors must be a Map<number, string> with 400 through 599 status keys");
      }
      output[output.length] = __velarServeCall(__velarServeObjectFreeze, __velarServeObject, [{status: item[0], description: __velarServeDocumentationText(item[1], "Route error description", 4096)}]);
    }
    if (output.length !== size) throw new __velarServeTypeError("Route documentation errors changed while they were being read");
  }
  return __velarServeCall(__velarServeObjectFreeze, __velarServeObject, [output]);
}

function __velarServeRouteMetadata(route, overrides = null) {
  const metadata = overrides ?? {};
  return {
    operationId: route.operationId,
    responseSchema: route.responseSchema,
    responseContentTypes: route.responseContentTypes,
    maxBodyBytes: route.maxBodyBytes,
    middleware: route.middleware,
    documented: metadata.documented ?? route.documented,
    summary: metadata.summary ?? route.summary,
    description: metadata.description ?? route.description,
    tags: metadata.tags ?? route.tags,
    status: metadata.status ?? route.status,
    errors: metadata.errors ?? route.errors,
  };
}

function __velarServeWebSocketMetadata(route) {
  return {
    operationId: route.operationId,
    documented: route.documented,
    summary: route.summary,
    description: route.description,
    tags: route.tags,
  };
}

function __velarServeSchema(value, name) {
  __velarServePlainRecord(value, name);
  const serialized = __velarJsonStringify(value);
  if (__velarUtf8ByteLength(serialized) > 1024 * 1024) throw new __velarServeRangeError(name + " cannot exceed 1 MiB");
  return __velarServeFreezeSchema(__velarJsonParse(serialized, name));
}

function __velarServeFreezeSchema(value) {
  if (!value || typeof value !== "object") return value;
  const keys = __velarServeCall(__velarServeOwnKeys, __velarServeReflect, [value]);
  for (let index = 0; index < keys.length; index += 1) {
    const descriptor = __velarServeOwnDescriptor(value, keys[index]);
    if (descriptor && "value" in descriptor) __velarServeFreezeSchema(descriptor.value);
  }
  return __velarServeCall(__velarServeObjectFreeze, __velarServeObject, [value]);
}

/*
 * D102 后续裁决：线值全为整数的枚举，其 schema 写的是 {"type":"integer",
 * "enum":[1,2]}——URL 段却是文本，成员判定拿到文本对着数字比，于是每一个请求都
 * 422。这里回答的只是「该捕获是不是那种枚举」；解码本身走*已有的* number 规则，
 * 一字未改也一字未加：一个 number 捕获接受什么，它就接受什么。线值混用或全为
 * 字符串的枚举没有 "integer" 这一行，仍旧按原样文本匹配。
 */
function __velarServeIntegerEnum(kind, schema) {
  if (kind !== "enum" || !schema || typeof schema !== "object") return false;
  const descriptor = __velarServeOwnDescriptor(schema, "type");
  return descriptor !== undefined && "value" in descriptor && descriptor.value === "integer";
}

function __velarServeDefaultSchema(kind) {
  if (kind === "string" || kind === "enum") return __velarServeCall(__velarServeObjectFreeze, __velarServeObject, [{type: "string"}]);
  if (kind === "number") return __velarServeCall(__velarServeObjectFreeze, __velarServeObject, [{type: "number"}]);
  if (kind === "bool") return __velarServeCall(__velarServeObjectFreeze, __velarServeObject, [{type: "boolean"}]);
  if (kind === "data") return __velarServeCall(__velarServeObjectFreeze, __velarServeObject, [{type: "object"}]);
  return __velarServeCall(__velarServeObjectFreeze, __velarServeObject, [{}]);
}

function __velarServeBodyLimit(value) {
  if (!__velarServeIsSafeInteger(value) || value < 1 || value > __velarServeMaxBodyBytes) {
    throw new __velarServeRangeError("bodyLimit maxBytes must be an integer from 1 through 16777216");
  }
  return value;
}

function __velarServeAppValue(name, routes, webSockets = [], lifecycles = [], notFound = null, responseHandler = null, supplies = [], middleware = []) {
  const router = __velarServeRouter(routes);
  const webSocketRouter = __velarServeRouter(webSockets);
  return __velarServeCall(__velarServeObjectFreeze, __velarServeObject, [{
    [__velarServeAppMarker]: true,
    name,
    routes: __velarServeCall(__velarServeObjectFreeze, __velarServeObject, [routes]),
    router,
    webSockets: __velarServeCall(__velarServeObjectFreeze, __velarServeObject, [webSockets]),
    webSocketRouter,
    lifecycles: __velarServeCall(__velarServeObjectFreeze, __velarServeObject, [lifecycles]),
    notFound,
    responseHandler,
    supplies: __velarServeCall(__velarServeObjectFreeze, __velarServeObject, [supplies]),
    // SV-U5: use() records its middleware on the application as well as on its
    // routes, so the framework's own 404 — the answer for a path no route
    // claims — leaves through the same middleware every other response does.
    middleware: __velarServeCall(__velarServeObjectFreeze, __velarServeObject, [middleware]),
  }]);
}

function __velarCreateServeApp(name, items) {
  if (typeof name !== "string" || name.length === 0 || name.length > 256) throw new __velarServeTypeError("ServeApp name must be bounded text");
  if (!__velarServeIsArray(items) || items.length > __velarServeMaxRoutes + 2) throw new __velarServeTypeError("ServeApp items cannot exceed 4096 routes, one fallback, and one response policy");
  const routes = [];
  const webSockets = [];
  const lifecycles = [];
  const supplies = [];
  const suppliedProviders = new __velarServeMap();
  let notFound = null;
  let responseHandler = null;
  // D90 R19(b): assembly is the moment the final table exists, so the final
  // table is judged here — a conflict names both routes and both origins,
  // because the statically invisible half of a collision is exactly the one
  // the author cannot see in his own file.
  const shapes = new __velarServeMap();
  const operations = new __velarServeMap();
  const describeRoute = entry => "'" + entry.route.method + " " + entry.route.path + "'"
    + (entry.source === null ? " declared by this server" : " composed in from '" + entry.source + "'");
  const append = (route, source, target) => {
    if (routes.length + webSockets.length >= __velarServeMaxRoutes) throw new __velarServeRangeError("ServeApp cannot contain more than 4096 routes after composition");
    const key = route.method + " " + __velarServeRouteShape(route.path);
    const previous = __velarServeCall(__velarServeMapGet, shapes, [key]);
    if (previous !== undefined) {
      throw new __velarServeTypeError("ServeApp '" + name + "' contains conflicting routes: " + describeRoute({route, source})
        + " and " + describeRoute(previous) + " both answer '" + key + "' — narrow or remove one");
    }
    __velarServeCall(__velarServeMapSet, shapes, [key, {route, source}]);
    if (route.operationId !== null) {
      const previousOperation = __velarServeCall(__velarServeMapGet, operations, [route.operationId]);
      if (previousOperation !== undefined) {
        throw new __velarServeTypeError("ServeApp '" + name + "' contains duplicate operationId '" + route.operationId + "' on "
          + describeRoute({route, source}) + " and " + describeRoute(previousOperation));
      }
      __velarServeCall(__velarServeMapSet, operations, [route.operationId, {route, source}]);
    }
    target[target.length] = route;
  };
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    if (__velarServeIsRoute(item)) append(item, null, routes);
    else if (__velarServeIsWebSocket(item)) append(item, null, webSockets);
    else if (__velarServeIsNotFound(item)) {
      if (notFound !== null) throw new __velarServeTypeError("ServeApp contains more than one @notFound fallback");
      notFound = item;
    }
    else if (__velarServeIsResponseHandler(item)) {
      if (responseHandler !== null) throw new __velarServeTypeError("ServeApp contains more than one @response policy");
      responseHandler = item;
    }
    else if (__velarServeIsApp(item)) {
      for (let route = 0; route < item.routes.length; route += 1) append(item.routes[route], item.name, routes);
      for (let route = 0; route < item.webSockets.length; route += 1) append(item.webSockets[route], item.name, webSockets);
      for (let hook = 0; hook < item.lifecycles.length; hook += 1) {
        if (lifecycles.length >= __velarServeMaxLifecycles) throw new __velarServeRangeError("ServeApp cannot contain more than 4096 lifecycle pairs after composition");
        lifecycles[lifecycles.length] = item.lifecycles[hook];
      }
      for (let binding = 0; binding < item.supplies.length; binding += 1) {
        const supplied = item.supplies[binding];
        if (__velarServeCall(__velarServeMapHas, suppliedProviders, [supplied.provider])) {
          throw new __velarServeTypeError("ServeApp '" + name + "' supplies the same Provider more than once");
        }
        if (supplies.length >= 128) throw new __velarServeRangeError("ServeApp cannot contain more than 128 supplied Providers");
        __velarServeCall(__velarServeMapSet, suppliedProviders, [supplied.provider, true]);
        supplies[supplies.length] = supplied;
      }
      if (item.notFound !== null) {
        if (notFound !== null) throw new __velarServeTypeError("ServeApp contains more than one @notFound fallback");
        notFound = item.notFound;
      }
      if (item.responseHandler !== null) {
        if (responseHandler !== null) throw new __velarServeTypeError("ServeApp contains more than one @response policy");
        responseHandler = item.responseHandler;
      }
    } else throw new __velarServeTypeError("A server composition entry must be a ServeApp");
  }
  return __velarServeAppValue(name, routes, webSockets, lifecycles, notFound, responseHandler, supplies);
}

/**
 * 把一个进程在启动时已经构造好的应用级资源交给 ServeApp。绑定属于应用组合
 * 本身，因此 prefix、middleware、docs 等后续包装不会丢失它；服务器关闭时，
 * 仍由 Provider 声明的 release 负责按统一顺序释放资源。
 */
export function supply(app, provider, value) {
  if (!__velarServeIsApp(app)) throw new __velarServeTypeError("supply requires a ServeApp");
  if (!__velarServeIsProvider(provider)) throw new __velarServeTypeError("supply requires a Provider");
  if (provider.scope !== "app") throw new __velarServeTypeError("supply accepts only app-scoped Providers");
  if (app.supplies.length >= 128) throw new __velarServeRangeError("ServeApp cannot contain more than 128 supplied Providers");
  const supplies = [];
  for (let index = 0; index < app.supplies.length; index += 1) {
    const binding = app.supplies[index];
    if (binding.provider === provider) throw new __velarServeTypeError("A ServeApp cannot supply the same Provider more than once");
    supplies[index] = binding;
  }
  supplies[supplies.length] = __velarServeCall(__velarServeObjectFreeze, __velarServeObject, [{provider, value}]);
  return __velarServeAppValue(app.name, app.routes, app.webSockets, app.lifecycles, app.notFound, app.responseHandler, supplies, app.middleware);
}

export function prefix(path, app) {
  path = __velarServeRoutePath(path, "prefix path");
  if (!__velarServeIsApp(app)) throw new __velarServeTypeError("prefix requires a ServeApp");
  if (__velarServeCall(__velarServeStringIncludes, path, ["{"]) || __velarServeCall(__velarServeStringIncludes, path, ["*"])) {
    throw new __velarServeTypeError("prefix path must contain only literal path segments");
  }
  if (path === "/") return app;
  if (app.notFound !== null) throw new __velarServeTypeError("prefix cannot scope @notFound; compose the fallback on the final server instead");
  if (app.responseHandler !== null) throw new __velarServeTypeError("prefix cannot scope @response; compose the policy on the final server instead");
  const routes = [];
  const webSockets = [];
  for (let index = 0; index < app.routes.length; index += 1) {
    const route = app.routes[index];
    const pathname = path + (route.path === "/" ? "" : route.path);
    const querySuffix = __velarServeCall(__velarServeStringSlice, route.pattern.definition, [route.path.length]);
    const pattern = __velarCreateServePattern({
      definition: pathname + querySuffix,
      pathname,
      path: route.pattern.pathCaptures,
      query: route.pattern.queryCaptures,
    });
    routes[routes.length] = __velarCreateServeRoute(
      route.method,
      pattern,
      route.parameters,
      route.handler,
      __velarServeRouteMetadata(route),
      route.bindRoute,
    );
  }
  for (let index = 0; index < app.webSockets.length; index += 1) {
    const route = app.webSockets[index];
    const pathname = path + (route.path === "/" ? "" : route.path);
    const querySuffix = __velarServeCall(__velarServeStringSlice, route.pattern.definition, [route.path.length]);
    const pattern = __velarCreateServePattern({definition: pathname + querySuffix, pathname, path: route.pattern.pathCaptures, query: route.pattern.queryCaptures});
    webSockets[webSockets.length] = __velarCreateServeWebSocket(
      pattern,
      route.parameters,
      route.handler,
      __velarServeWebSocketMetadata(route),
      route.bindRoute,
    );
  }
  const items = [];
  for (let index = 0; index < routes.length; index += 1) items[items.length] = routes[index];
  for (let index = 0; index < webSockets.length; index += 1) items[items.length] = webSockets[index];
  const output = __velarCreateServeApp(app.name, items);
  return __velarServeAppValue(output.name, output.routes, output.webSockets, app.lifecycles, null, app.responseHandler, app.supplies, app.middleware);
}

export function staticFiles(path, root, fallback = null) {
  path = __velarServeRoutePath(path, "staticFiles path");
  if (path !== "/" && __velarServeCall(__velarServeStringEndsWith, path, ["/"])) throw new __velarServeTypeError("staticFiles path must not end with '/'");
  const pattern = path === "/" ? "/*" : path + "/*";
  const routePattern = __velarCreateServePattern({definition: pattern, pathname: pattern, path: [], query: []});
  const route = __velarCreateServeRoute("GET", routePattern, [{name: "request", source: "request", kind: "request", required: true}], async request => {
    const relative = path === "/" ? request.path : __velarServeCall(__velarServeStringSlice, request.path, [path.length]);
    return fileResponse(root, relative || "/", fallback);
  }, {documented: false}, false);
  return __velarCreateServeApp("static", [route]);
}

export function use(app, middleware) {
  if (!__velarServeIsApp(app)) throw new __velarServeTypeError("use requires a ServeApp");
  const additions = __velarServeIsArray(middleware) ? middleware : [middleware];
  if (additions.length === 0 || additions.length > 64) throw new __velarServeRangeError("use requires 1 through 64 middleware functions");
  for (let index = 0; index < additions.length; index += 1) if (typeof additions[index] !== "function") throw new __velarServeTypeError("use middleware entries must be functions");
  const routes = [];
  for (let index = 0; index < app.routes.length; index += 1) {
    const route = app.routes[index];
    const entries = [];
    for (let item = 0; item < route.middleware.length; item += 1) entries[entries.length] = route.middleware[item];
    for (let item = 0; item < additions.length; item += 1) entries[entries.length] = additions[item];
    routes[routes.length] = __velarCreateServeRoute(
      route.method,
      route.pattern,
      route.parameters,
      route.handler,
      {...__velarServeRouteMetadata(route), middleware: entries},
      route.bindRoute,
    );
  }
  const appMiddleware = [];
  for (let item = 0; item < app.middleware.length; item += 1) appMiddleware[appMiddleware.length] = app.middleware[item];
  for (let item = 0; item < additions.length; item += 1) appMiddleware[appMiddleware.length] = additions[item];
  let notFound = app.notFound;
  if (notFound !== null) {
    const entries = [];
    for (let item = 0; item < notFound.middleware.length; item += 1) entries[entries.length] = notFound.middleware[item];
    for (let item = 0; item < additions.length; item += 1) entries[entries.length] = additions[item];
    notFound = __velarCreateServeNotFound(notFound.handler, entries);
  }
  const items = [];
  for (let index = 0; index < routes.length; index += 1) items[items.length] = routes[index];
  for (let index = 0; index < app.webSockets.length; index += 1) items[items.length] = app.webSockets[index];
  if (notFound !== null) items[items.length] = notFound;
  const output = __velarCreateServeApp(app.name, items);
  return __velarServeAppValue(output.name, output.routes, output.webSockets, app.lifecycles, output.notFound, app.responseHandler, app.supplies, appMiddleware);
}

export function bodyLimit(app, maxBytes) {
  if (!__velarServeIsApp(app)) throw new __velarServeTypeError("bodyLimit requires a ServeApp");
  maxBytes = __velarServeBodyLimit(maxBytes);
  const routes = [];
  for (let index = 0; index < app.routes.length; index += 1) {
    const route = app.routes[index];
    routes[routes.length] = __velarCreateServeRoute(
      route.method,
      route.pattern,
      route.parameters,
      route.handler,
      {...__velarServeRouteMetadata(route), maxBodyBytes: maxBytes},
      route.bindRoute,
    );
  }
  const items = [];
  for (let index = 0; index < routes.length; index += 1) items[items.length] = routes[index];
  for (let index = 0; index < app.webSockets.length; index += 1) items[items.length] = app.webSockets[index];
  const output = __velarCreateServeApp(app.name, items);
  return __velarServeAppValue(output.name, output.routes, output.webSockets, app.lifecycles, app.notFound, app.responseHandler, app.supplies, app.middleware);
}

export function lifecycle(app, startup = null, shutdown = null) {
  if (!__velarServeIsApp(app)) throw new __velarServeTypeError("lifecycle requires a ServeApp");
  if (startup !== null && typeof startup !== "function" || shutdown !== null && typeof shutdown !== "function") throw new __velarServeTypeError("lifecycle hooks must be functions or null");
  if (app.lifecycles.length >= __velarServeMaxLifecycles) throw new __velarServeRangeError("ServeApp cannot contain more than 4096 lifecycle pairs");
  const lifecycles = [];
  for (let index = 0; index < app.lifecycles.length; index += 1) lifecycles[index] = app.lifecycles[index];
  lifecycles[lifecycles.length] = __velarServeCall(__velarServeObjectFreeze, __velarServeObject, [{startup, shutdown}]);
  return __velarServeAppValue(app.name, app.routes, app.webSockets, lifecycles, app.notFound, app.responseHandler, app.supplies, app.middleware);
}

function __velarServeResponseWithHeaders(value, additions) {
  value = __velarServeAutomaticResponse(value);
  if (__velarServeIsFileResponse(value)) {
    const headers = __velarServeHeaders(value.headers);
    const pairs = __velarServeMapSnapshot(additions, "Middleware headers");
    for (let index = 0; index < pairs.length; index += 1) __velarServeMergeResponseHeader(headers, pairs[index][0], pairs[index][1]);
    return __velarServeCall(__velarServeObjectFreeze, __velarServeObject, [{[__velarServeFileMarker]: true, root: value.root, relocatedRoot: value.relocatedRoot, path: value.path, fallback: value.fallback, headers}]);
  }
  const headers = __velarServeHeaders(value.headers);
  const pairs = __velarServeMapSnapshot(additions, "Middleware headers");
  for (let index = 0; index < pairs.length; index += 1) __velarServeMergeResponseHeader(headers, pairs[index][0], pairs[index][1]);
  return __velarServeResponseCopy(value, headers);
}

function __velarServeMergeResponseHeader(headers, name, value) {
  const lower = __velarServeCall(__velarServeStringToLowerCase, name, []);
  const pairs = __velarServeMapSnapshot(headers, "ServeResponse.headers");
  let previous;
  for (let index = 0; index < pairs.length; index += 1) if (__velarServeCall(__velarServeStringToLowerCase, pairs[index][0], []) === lower) {
    previous = pairs[index][1];
    __velarServeCall(__velarServeMapDelete, headers, [pairs[index][0]]);
  }
  if (lower === "vary" && previous !== undefined) {
    const existing = __velarServeCall(__velarServeStringSplit, previous, [","]);
    const additions = __velarServeCall(__velarServeStringSplit, value, [","]);
    const normalized = [];
    for (let index = 0; index < existing.length; index += 1) normalized[normalized.length] = __velarServeCall(__velarServeStringToLowerCase, __velarServeCall(__velarServeStringTrim, existing[index], []), []);
    for (let index = 0; index < additions.length; index += 1) {
      const item = __velarServeCall(__velarServeStringTrim, additions[index], []);
      if (!__velarServeCall(__velarServeArrayIncludes, normalized, [__velarServeCall(__velarServeStringToLowerCase, item, [])])) {
        previous += (previous === "" ? "" : ", ") + item;
      }
    }
    value = previous;
  }
  __velarServeCall(__velarServeMapSet, headers, [name, value]);
}

function __velarServeStringList(value, name, maximum = 128) {
  if (!__velarServeIsArray(value) || value.length > maximum) throw new __velarServeTypeError(name + " must be a bounded List<string>");
  const output = [];
  for (let index = 0; index < value.length; index += 1) {
    if (typeof value[index] !== "string" || value[index].length === 0 || value[index].length > 1024 || /[\0\r\n]/u.test(value[index])) throw new __velarServeTypeError(name + " must contain bounded single-line strings");
    output[index] = value[index];
  }
  return output;
}

function __velarServeCors(origins = ["*"], methods = ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"], headers = ["content-type", "authorization"], credentials = false, maxAge = 600) {
  origins = __velarServeStringList(origins, "middleware.cors origins");
  methods = __velarServeStringList(methods, "middleware.cors methods");
  headers = __velarServeStringList(headers, "middleware.cors headers");
  if (typeof credentials !== "boolean" || !__velarServeIsSafeInteger(maxAge) || maxAge < 0 || maxAge > 86400) throw new __velarServeTypeError("middleware.cors options are invalid");
  if (credentials && __velarServeCall(__velarServeArrayIncludes, origins, ["*"])) throw new __velarServeTypeError("middleware.cors cannot combine credentials with the '*' origin wildcard");
  return async (request, next) => {
    const origin = __velarServeCall(__velarServeMapHas, request.headers, ["origin"]) ? __velarServeCall(__velarServeMapGet, request.headers, ["origin"]) : null;
    const wildcard = __velarServeCall(__velarServeArrayIncludes, origins, ["*"]);
    const allowed = origin !== null && (wildcard || __velarServeCall(__velarServeArrayIncludes, origins, [origin]));
    if (origin !== null && !allowed) return __velarServeOutcome(null, 403, null, __velarServeProblem(403, "security.origin_not_allowed", "Origin is not allowed", null, "header", "origin"));
    const response = await next();
    if (!allowed) return response;
    const output = new __velarServeMap([
      ["access-control-allow-origin", wildcard && !credentials ? "*" : origin],
      ["access-control-allow-methods", __velarServeCall(__velarServeArrayJoin, methods, [", "])],
      ["access-control-allow-headers", __velarServeCall(__velarServeArrayJoin, headers, [", "])],
      ["access-control-max-age", __velarServeString(maxAge)],
      ["vary", "Origin"],
    ]);
    if (credentials) __velarServeCall(__velarServeMapSet, output, ["access-control-allow-credentials", "true"]);
    return __velarServeResponseWithHeaders(response, output);
  };
}

function __velarServeTrustedHosts(hosts) {
  hosts = __velarServeStringList(hosts, "middleware.trustedHosts hosts");
  return async (request, next) => {
    const hostHeader = __velarServeCall(__velarServeMapHas, request.headers, ["host"]) ? __velarServeCall(__velarServeMapGet, request.headers, ["host"]) : "";
    let host;
    if (__velarServeCall(__velarServeStringStartsWith, hostHeader, ["["])) {
      const end = __velarServeCall(__velarServeStringIndexOf, hostHeader, ["]"]);
      host = end < 2 ? "" : __velarServeCall(__velarServeStringSlice, hostHeader, [1, end]);
    } else {
      const pieces = __velarServeCall(__velarServeStringSplit, hostHeader, [":"]);
      host = pieces.length === 2 ? pieces[0] : hostHeader;
    }
    host = __velarServeCall(__velarServeStringToLowerCase, __velarServeCall(__velarServeStringTrim, host, []), []);
    let accepted = false;
    for (let index = 0; index < hosts.length; index += 1) {
      let allowed = __velarServeCall(__velarServeStringToLowerCase, hosts[index], []);
      if (__velarServeCall(__velarServeStringStartsWith, allowed, ["["]) && __velarServeCall(__velarServeStringEndsWith, allowed, ["]"])) allowed = __velarServeCall(__velarServeStringSlice, allowed, [1, -1]);
      if (allowed === "*" || allowed === host || __velarServeCall(__velarServeStringStartsWith, allowed, ["*."]) && __velarServeCall(__velarServeStringEndsWith, host, [__velarServeCall(__velarServeStringSlice, allowed, [1])])) { accepted = true; break; }
    }
    return accepted ? await next() : __velarServeOutcome(null, 400, null, __velarServeProblem(400, "security.untrusted_host", "Host is not trusted", null, "header", "host"));
  };
}

function __velarServeRequestId(header = "x-request-id") {
  header = __velarServeCall(__velarServeStringToLowerCase, __velarServeInputName(header, "middleware.requestId"), []);
  if (header.length === 0 || !__velarServeCall(__velarServeRegExpTest, __velarServeHeaderNamePattern, [header])) throw new __velarServeTypeError("middleware.requestId header is invalid");
  return async (request, next) => {
    let value = __velarServeCall(__velarServeMapHas, request.headers, [header]) ? __velarServeCall(__velarServeMapGet, request.headers, [header]) : null;
    if (value === null || value.length === 0 || value.length > 256 || /[\0\r\n]/u.test(value)) {
      if (!__velarServeIsSafeInteger(__velarServeNextRequestId)) __velarServeNextRequestId = 1;
      value = "velar-" + __velarServeCall(__velarServeDateNow, __velarServeDate, []) + "-" + __velarServeNextRequestId++;
    }
    return __velarServeResponseWithHeaders(await next(), new __velarServeMap([[header, value]]));
  };
}

function __velarServeAccessLog(write) {
  if (typeof write !== "function") throw new __velarServeTypeError("middleware.accessLog requires a writer function");
  return async (request, next) => {
    const started = __velarServeCall(__velarServeDateNow, __velarServeDate, []);
    const response = await next();
    const normalized = __velarServeAutomaticResponse(response);
    const status = __velarServeIsFileResponse(normalized) ? 200 : normalized.status;
    await __velarServeCall(write, undefined, [{method: request.method, path: request.path, status, durationMs: __velarServeCall(__velarServeDateNow, __velarServeDate, []) - started}]);
    return response;
  };
}

function __velarServeSecurityHeaders() {
  const headers = new __velarServeMap([
    ["x-content-type-options", "nosniff"],
    ["x-frame-options", "DENY"],
    ["referrer-policy", "no-referrer"],
    ["cross-origin-resource-policy", "same-origin"],
  ]);
  return async (_request, next) => __velarServeResponseWithHeaders(await next(), headers);
}

function __velarServeCompression(minimumBytes = 1024) {
  if (!__velarServeIsSafeInteger(minimumBytes) || minimumBytes < 0 || minimumBytes > __velarServeMaxBodyBytes) throw new __velarServeRangeError("middleware.compression minimumBytes is invalid");
  return async (request, next) => {
    const response = __velarServeAutomaticResponse(await next());
    if (__velarServeIsFileResponse(response) || __velarServeOwnDescriptor(response, "stream")) return response;
    const serialized = __velarServeOwnDescriptor(response, "json") ? __velarServeCall(__velarServeWeakMapGet, __velarServeSerializedJson, [response]) : null;
    const size = serialized !== null && serialized !== undefined ? __velarUtf8ByteLength(serialized) : __velarUtf8ByteLength(response.text);
    if (size < minimumBytes || !__velarServeCall(__velarServeMapHas, request.headers, ["accept-encoding"])) return response;
    const accepted = __velarServeCall(__velarServeStringSplit, __velarServeCall(__velarServeStringToLowerCase, __velarServeCall(__velarServeMapGet, request.headers, ["accept-encoding"]), []), [","]);
    let br = -1;
    let gzip = -1;
    let wildcard = -1;
    for (let index = 0; index < accepted.length; index += 1) {
      const parts = __velarServeCall(__velarServeStringSplit, __velarServeCall(__velarServeStringTrim, accepted[index], []), [";"]);
      const name = __velarServeCall(__velarServeStringTrim, parts[0], []);
      let quality = 1;
      for (let part = 1; part < parts.length; part += 1) {
        const option = __velarServeCall(__velarServeStringTrim, parts[part], []);
        if (__velarServeCall(__velarServeStringStartsWith, option, ["q="])) {
          quality = __velarServeNumber(__velarServeCall(__velarServeStringSlice, option, [2]));
          if (!__velarServeCall(__velarServeNumberIsFinite, __velarServeNumber, [quality]) || quality < 0 || quality > 1) quality = 0;
        }
      }
      if (name === "br") br = quality;
      else if (name === "gzip") gzip = quality;
      else if (name === "*") wildcard = quality;
    }
    if (br < 0) br = wildcard;
    if (gzip < 0) gzip = wildcard;
    const encoding = br > 0 && br >= gzip ? "br" : gzip > 0 ? "gzip" : null;
    if (encoding === null) return response;
    const headers = __velarServeHeaders(response.headers);
    __velarServeMergeResponseHeader(headers, "vary", "Accept-Encoding");
    const output = __velarServeResponseCopy(response, headers);
    const fields = {status: output.status, headers: output.headers, compression: encoding};
    if (__velarServeOwnDescriptor(output, "json")) fields.json = output.json;
    else { fields.text = output.text; if (output.contentType != null) fields.contentType = output.contentType; }
    if (output.background != null) fields.background = output.background;
    return __velarServeResponse(fields);
  };
}

function __velarServeErrorMiddleware(handle) {
  if (typeof handle !== "function") throw new __velarServeTypeError("middleware.errors requires a handler function");
  return async (request, next) => {
    let value;
    try { value = await next(); }
    catch (error) { return await __velarServeCall(handle, undefined, [error, request]); }
    // A route failure is already a response by the time it reaches here, so the
    // recovery handler is offered the error it was made from.
    const failure = __velarServeCall(__velarServeWeakMapGet, __velarServeRouteFailures, [request]);
    if (failure === undefined) return value;
    __velarServeCall(__velarServeWeakMapDelete, __velarServeRouteFailures, [request]);
    return await __velarServeCall(handle, undefined, [failure, request]);
  };
}

function __velarServeTimeout(milliseconds) {
  if (!__velarServeIsSafeInteger(milliseconds) || milliseconds < 1 || milliseconds > 3_600_000) throw new __velarServeRangeError("middleware.timeout must be 1 through 3600000 milliseconds");
  return async (request, next) => {
    if (__velarServeActiveTimeouts >= __velarServeMaxActiveTimeouts) {
      return __velarServeOutcome(null, 503, null, __velarServeProblem(503, "server.busy", "Server is busy", null, null, null, new __velarServeMap([["retry-after", "1"]])));
    }
    let timer = null;
    const pending = next();
    const expired = new __velarServePromise(resolve => { timer = __velarServeCall(__velarServeSetTimeout, globalThis, [() => resolve(__velarServeMissing), milliseconds]); });
    try {
      const result = await __velarServeCall(__velarServePromiseRace, __velarServePromise, [__velarServeCall(__velarServeObjectFreeze, __velarServeObject, [[pending, expired]])]);
      if (result !== __velarServeMissing) return result;
      __velarServeCancellation.__velarCancel(request.cancellation, "Request timed out");
      // The published bound counts unfinished timed-out continuations, and the
      // background reservation at __velarServeRunBackground subtracts exactly
      // this many slots from the process total. Admission alone cannot hold
      // that count: a burst admitted while nothing was detached can expire
      // together. When the detached budget is full the request has already been
      // cancelled, so wait for it to unwind here instead of detaching work the
      // process no longer accounts for.
      if (__velarServeActiveTimeouts >= __velarServeMaxActiveTimeouts) {
        try { await pending; }
        catch (error) { __velarServeReportFailure(error); }
        return __velarServeOutcome(null, 504, null, __velarServeProblem(504, "request.timeout", "Request timed out"));
      }
      __velarServeActiveTimeouts += 1;
      __velarServeActiveBackgroundTasks += 1;
      const settlement = (async () => {
        try { await pending; }
        catch (error) { __velarServeReportFailure(error); }
        finally {
          __velarServeActiveTimeouts -= 1;
          __velarServeActiveBackgroundTasks -= 1;
        }
        return null;
      })();
      __velarServeRegisterTimeoutSettlement(request, settlement);
      const continuation = async () => {
        return await settlement;
      };
      __velarServeCall(__velarServeWeakMapSet, __velarServeReservedBackground, [continuation, true]);
      return __velarServeOutcome(null, 504, null, __velarServeProblem(504, "request.timeout", "Request timed out"), [continuation]);
    } finally {
      if (timer !== null) __velarServeCall(__velarServeClearTimeout, globalThis, [timer]);
    }
  };
}

function __velarServeConcurrency(maximum) {
  if (!__velarServeIsSafeInteger(maximum) || maximum < 1 || maximum > 4096) throw new __velarServeRangeError("middleware.concurrency maximum must be from 1 through 4096");
  let active = 0;
  return async (_request, next) => {
    if (active >= maximum) return __velarServeOutcome(null, 503, null, __velarServeProblem(503, "server.busy", "Server is busy", null, null, null, new __velarServeMap([["retry-after", "1"]])));
    active += 1;
    try { return await next(); }
    finally { active -= 1; }
  };
}

export const middleware = __velarServeCall(__velarServeObjectFreeze, __velarServeObject, [{
  cors: __velarServeCors,
  trustedHosts: __velarServeTrustedHosts,
  requestId: __velarServeRequestId,
  accessLog: __velarServeAccessLog,
  securityHeaders: __velarServeSecurityHeaders,
  compression: __velarServeCompression,
  errors: __velarServeErrorMiddleware,
  timeout: __velarServeTimeout,
  concurrency: __velarServeConcurrency,
}]);

function __velarServeMatch(route, actual) {
  const pattern = route.segments;
  let values = null;
  let score = 0;
  for (let index = 1; index < pattern.length; index += 1) {
    const expected = pattern[index];
    if (expected === "*") return {values: values === null ? __velarServeEmptyRouteValues : values, score};
    if (index >= actual.length) return null;
    const received = actual[index];
    const captureName = route.segmentCaptures[index];
    if (captureName !== null) {
      // SV-U4: a path parameter names a segment, and an empty segment is not a
      // value. '/n/' does not match '/n/{id:number}' — the request never
      // supplied an id, so it is a 404, not a 422 about one.
      if (received === "") return null;
      if (values === null) values = __velarServeCall(__velarServeObjectCreate, __velarServeObject, [null]);
      values[captureName] = received;
      score += 1;
    } else {
      if (expected !== received) return null;
      score += 4;
    }
  }
  return actual.length === pattern.length ? {values: values === null ? __velarServeEmptyRouteValues : values, score} : null;
}

function __velarServeRouterNode() {
  return {literals: new __velarServeMap(), dynamic: null, exact: [], wildcard: []};
}

function __velarServeRouter(routes) {
  const methods = new __velarServeMap();
  for (let index = 0; index < routes.length; index += 1) {
    const route = routes[index];
    let node = __velarServeCall(__velarServeMapGet, methods, [route.method]);
    if (node === undefined) { node = __velarServeRouterNode(); __velarServeCall(__velarServeMapSet, methods, [route.method, node]); }
    let terminal = true;
    for (let segmentIndex = 1; segmentIndex < route.segments.length; segmentIndex += 1) {
      const segment = route.segments[segmentIndex];
      if (segment === "*") {
        node.wildcard[node.wildcard.length] = route;
        terminal = false;
        break;
      }
      if (__velarServeCall(__velarServeStringStartsWith, segment, ["{"])) {
        if (node.dynamic === null) node.dynamic = __velarServeRouterNode();
        node = node.dynamic;
        continue;
      }
      let child = __velarServeCall(__velarServeMapGet, node.literals, [segment]);
      if (child === undefined) { child = __velarServeRouterNode(); __velarServeCall(__velarServeMapSet, node.literals, [segment, child]); }
      node = child;
    }
    if (terminal) node.exact[node.exact.length] = route;
  }
  return methods;
}

function __velarServeRouterRoutes(app, method, actual) {
  const root = __velarServeCall(__velarServeMapGet, app.router, [method]);
  if (root === undefined) return [];
  const output = [];
  let current = [root];
  for (let segmentIndex = 1; segmentIndex < actual.length; segmentIndex += 1) {
    const next = [];
    for (let nodeIndex = 0; nodeIndex < current.length; nodeIndex += 1) {
      const node = current[nodeIndex];
      for (let wildcardIndex = 0; wildcardIndex < node.wildcard.length; wildcardIndex += 1) output[output.length] = node.wildcard[wildcardIndex];
      const literal = __velarServeCall(__velarServeMapGet, node.literals, [actual[segmentIndex]]);
      if (literal !== undefined) next[next.length] = literal;
      if (node.dynamic !== null) next[next.length] = node.dynamic;
    }
    if (next.length === 0) return output;
    current = next;
  }
  for (let nodeIndex = 0; nodeIndex < current.length; nodeIndex += 1) {
    const node = current[nodeIndex];
    for (let exactIndex = 0; exactIndex < node.exact.length; exactIndex += 1) output[output.length] = node.exact[exactIndex];
    // 通配段与原匹配器一致，可以匹配零个剩余路径段。
    for (let wildcardIndex = 0; wildcardIndex < node.wildcard.length; wildcardIndex += 1) output[output.length] = node.wildcard[wildcardIndex];
  }
  return output;
}

function __velarServeBestRoute(app, method, actual) {
  const routes = __velarServeRouterRoutes(app, method, actual);
  let selected = null;
  for (let index = 0; index < routes.length; index += 1) {
    const match = __velarServeMatch(routes[index], actual);
    if (match !== null && (selected === null || match.score > selected.match.score)) selected = {route: routes[index], match};
  }
  return selected;
}

function __velarServeDecodeScalarValue(raw, kind, name) {
  let value = raw;
  if (kind === "number") {
    value = __velarServeNumber(raw);
    if (!__velarServeCall(__velarServeRegExpTest, __velarServeDecimalPattern, [raw])
      || !__velarServeCall(__velarServeNumberIsFinite, __velarServeNumber, [value])) {
      throw __velarServeRequestProblem(422, {error: "invalid_request", parameter: name});
    }
  } else if (kind === "bool") {
    if (raw === "true") value = true;
    else if (raw === "false") value = false;
    else throw __velarServeRequestProblem(422, {error: "invalid_request", parameter: name});
  }
  return value;
}

function __velarServeDecodeScalar(raw, parameter) {
  // 一个整数线值的枚举捕获，先按 number 捕获解码，再做成员判定;
  // 解码失败与今天的解码失败是同一个 422。判定读的是已经规范化并冻结的 schema，
  // 而不是描述符上多出来的一个字段：规范化后的描述符会被中间件重新登记一次，
  // 多一个字段就是「Route parameter has an unknown field」。
  const kind = __velarServeIntegerEnum(parameter.kind, parameter.schema) ? "number" : parameter.kind;
  const value = __velarServeDecodeScalarValue(raw, kind, parameter.name);
  let valid = false;
  try { valid = parameter.check(value) === true; } catch {}
  if (!valid) throw __velarServeRequestProblem(422, {error: "invalid_request", parameter: parameter.name});
  return value;
}

function __velarServeCookieValue(request, name) {
  const header = __velarServeCall(__velarServeMapGet, request.headers, ["cookie"]);
  if (header === undefined) return __velarServeMissing;
  const pieces = __velarServeCall(__velarServeStringSplit, header, [";"]);
  let encoded = null;
  let matches = 0;
  for (let index = 0; index < pieces.length; index += 1) {
    const piece = __velarServeCall(__velarServeStringTrim, pieces[index], []);
    const separator = __velarServeCall(__velarServeStringIndexOf, piece, ["="]);
    if (separator < 0 || __velarServeCall(__velarServeStringSlice, piece, [0, separator]) !== name) continue;
    matches += 1;
    if (matches > 1) throw __velarServeRequestProblem(400, {error: "duplicate_cookie", parameter: name});
    encoded = __velarServeCall(__velarServeStringSlice, piece, [separator + 1]);
  }
  if (matches === 0) return __velarServeMissing;
  try { return __velarServeCall(__velarServeDecodeURIComponent, undefined, [encoded]); }
  catch { throw __velarServeRequestProblem(400, {error: "invalid_cookie", parameter: name}); }
}

function __velarServeNamedInputRaw(descriptor, parameterName, request) {
  const name = descriptor.name === "" ? parameterName : descriptor.name;
  if (descriptor.source === "query") {
    const values = __velarServeCall(__velarServeMapGet, request.queryAll, [name]);
    if (values === undefined) return __velarServeMissing;
    if (values.length !== 1) throw __velarServeRequestProblem(422, {error: "duplicate_parameter", parameter: name});
    return values[0];
  }
  if (descriptor.source === "header") {
    const normalized = __velarServeCall(__velarServeStringToLowerCase, name, []);
    const value = __velarServeCall(__velarServeMapGet, request.headers, [normalized]);
    return value === undefined ? __velarServeMissing : value;
  }
  if (descriptor.source === "cookie") return __velarServeCookieValue(request, name);
  return __velarServeMissing;
}

function __velarServeAuthenticationChallenge(details) {
  if (details.kind === "apiKey") return "ApiKey";
  return details.kind === "basic" ? "Basic" : "Bearer";
}

export function __velarServeAuthenticationError(credential) {
  credential = __velarServeAuthenticationCredential(credential);
  return __velarServeRequestProblem(
    401,
    {error: "not_authenticated"},
    new __velarServeMap([["www-authenticate", __velarServeAuthenticationChallenge(credential.extra)]]),
  );
}

export function __velarServeAuthenticationCredential(credential) {
  if (!__velarServeIsInput(credential) || credential.source !== "security") {
    throw new __velarServeTypeError("Server authentication requires a security credential descriptor");
  }
  return credential;
}

function __velarServeUnauthorized(descriptor) {
  throw __velarServeAuthenticationError(descriptor);
}

function __velarServeSecurityInput(descriptor, request) {
  const details = descriptor.extra;
  if (details.kind === "apiKey") {
    const carrier = __velarServeInputValue(details.source, details.name);
    const value = __velarServeNamedInputRaw(carrier, details.name, request);
    if (value === __velarServeMissing) __velarServeUnauthorized(descriptor);
    return value;
  }
  const authorization = __velarServeCall(__velarServeMapHas, request.headers, ["authorization"])
    ? __velarServeCall(__velarServeMapGet, request.headers, ["authorization"])
    : __velarServeMissing;
  if (authorization === __velarServeMissing) __velarServeUnauthorized(descriptor);
  const separator = __velarServeCall(__velarServeStringIndexOf, authorization, [" "]);
  if (separator < 1) __velarServeUnauthorized(descriptor);
  const protocol = __velarServeCall(__velarServeStringToLowerCase, __velarServeCall(__velarServeStringSlice, authorization, [0, separator]), []);
  const credential = __velarServeCall(__velarServeStringTrim, __velarServeCall(__velarServeStringSlice, authorization, [separator + 1]), []);
  if (credential.length === 0) __velarServeUnauthorized(descriptor);
  if (details.kind !== "basic") {
    if (protocol !== "bearer") __velarServeUnauthorized(descriptor);
    return credential;
  }
  if (protocol !== "basic" || typeof __velarServeAtob !== "function") __velarServeUnauthorized(descriptor);
  let decoded;
  try { decoded = __velarServeCall(__velarServeAtob, undefined, [credential]); }
  catch { __velarServeUnauthorized(descriptor); }
  const split = __velarServeCall(__velarServeStringIndexOf, decoded, [":"]);
  if (split < 0) __velarServeUnauthorized(descriptor);
  return __velarServeCall(__velarServeObjectFreeze, __velarServeObject, [{
    username: __velarServeCall(__velarServeStringSlice, decoded, [0, split]),
    password: __velarServeCall(__velarServeStringSlice, decoded, [split + 1]),
  }]);
}

function __velarServeRequestContext(appState) {
  // 大部分路由要么没有依赖，要么只读应用级依赖。请求级 Map 和
  // release 列表在这两种情况下都不会被使用，因此延迟到第一个请求级
  // Provider 真正解析时再分配，避免每个普通请求创建并清空两个 Map。
  return {appState, cache: null, resolving: null, releases: null, providerCount: 0, form: null};
}

async function __velarServeCleanupReleases(releases) {
  let failure = null;
  for (let index = releases.length - 1; index >= 0; index -= 1) {
    const entry = releases[index];
    try { await __velarServeCall(entry.release, undefined, [entry.value]); }
    catch (error) { if (failure === null) failure = error; }
  }
  releases.length = 0;
  if (failure !== null) throw failure;
  return null;
}

async function __velarServeCleanupRequestContext(context) {
  let failure = null;
  if (context.releases !== null) {
    try { await __velarServeCleanupReleases(context.releases); }
    catch (error) { failure = error; }
  }
  if (context.form !== null) {
    try { const form = await context.form; if (typeof form?.dispose === "function") form.dispose(); }
    catch {}
    context.form = null;
  }
  if (context.cache !== null) __velarServeCall(__velarServeMapClear, context.cache, []);
  if (context.resolving !== null) __velarServeCall(__velarServeMapClear, context.resolving, []);
  context.providerCount = 0;
  if (failure !== null) throw failure;
  return null;
}

async function __velarServeCleanupAppState(appState) {
  if (appState.activeRequests !== 0) throw new __velarServeError("ServeApp providers cannot close while requests are active");
  let failure = null;
  try { await __velarServeCleanupReleases(appState.releases); }
  catch (error) { failure = error; }
  __velarServeCall(__velarServeMapClear, appState.cache, []);
  __velarServeCall(__velarServeMapClear, appState.resolving, []);
  __velarServeCall(__velarServeMapClear, appState.cancellations, []);
  appState.providerCount = 0;
  appState.phase = "closed";
  appState.drain = null;
  appState.resolveDrain = null;
  if (failure !== null) throw failure;
  return null;
}

async function __velarServeResolveProvider(provider, request, maxBodyBytes, context) {
  if (context.appState.overrides !== null) {
    const override = __velarServeCall(__velarServeMapGet, context.appState.overrides, [provider]);
    if (override !== undefined) return override;
  }
  const appScoped = provider.scope === "app";
  if (!appScoped && context.cache === null) context.cache = new __velarServeMap();
  if (!appScoped && context.resolving === null) context.resolving = new __velarServeMap();
  const cache = appScoped ? context.appState.cache : context.cache;
  const resolving = appScoped ? context.appState.resolving : context.resolving;
  const owner = appScoped ? context.appState : context;
  const providerLimit = appScoped ? __velarServeMaxAppProviders : __velarServeMaxRequestProviders;
  const cached = __velarServeCall(__velarServeMapGet, cache, [provider]);
  if (cached !== undefined) return await cached;
  if (__velarServeCall(__velarServeMapGet, resolving, [provider]) !== undefined) throw __velarServeRequestProblem(500, {error: "provider_cycle"});
  if (owner.providerCount >= providerLimit) throw __velarServeRequestProblem(503, {error: "provider_budget_exhausted"});
  owner.providerCount += 1;
  __velarServeCall(__velarServeMapSet, resolving, [provider, true]);
  const pending = (async () => {
    const values = __velarServeCall(__velarServeObjectCreate, __velarServeObject, [null]);
    const keys = __velarServeCall(__velarServeOwnKeys, __velarServeReflect, [provider.inputs]);
    for (let index = 0; index < keys.length; index += 1) {
      const name = keys[index];
      values[name] = await __velarServeResolveInput(provider.inputs[name], name, null, request, maxBodyBytes, context);
    }
    const result = await __velarServeCall(provider.resolve, undefined, [__velarServeCall(__velarServeObjectFreeze, __velarServeObject, [values])]);
    if (provider.release !== null) {
      if (!appScoped && context.releases === null) context.releases = [];
      const releases = appScoped ? context.appState.releases : context.releases;
      releases[releases.length] = {release: provider.release, value: result};
    }
    return result;
  })();
  __velarServeCall(__velarServeMapSet, cache, [provider, pending]);
  try { return await pending; }
  catch (error) { __velarServeCall(__velarServeMapDelete, cache, [provider]); owner.providerCount -= 1; throw error; }
  finally { __velarServeCall(__velarServeMapDelete, resolving, [provider]); }
}

function __velarServeBytePattern(text) {
  const output = new __velarServeUint8Array(text.length);
  for (let index = 0; index < text.length; index += 1) output[index] = text.charCodeAt(index);
  return output;
}

function __velarServeFindBytes(data, pattern, start) {
  if (pattern.length === 0) return start;
  const prefix = new __velarServeUint8Array(pattern.length);
  for (let index = 1, matched = 0; index < pattern.length;) {
    if (pattern[index] === pattern[matched]) prefix[index++] = ++matched;
    else if (matched > 0) matched = prefix[matched - 1];
    else prefix[index++] = 0;
  }
  for (let index = start, matched = 0; index < data.length;) {
    if (data[index] === pattern[matched]) { index += 1; matched += 1; if (matched === pattern.length) return index - matched; }
    else if (matched > 0) matched = prefix[matched - 1];
    else index += 1;
  }
  return -1;
}

function __velarServeDecodeBytes(data, start = 0, end = data.length) {
  try { return __velarServeCall(__velarServeTextDecode, __velarServeUtf8Decoder, [__velarServeCall(__velarServeUint8Slice, data, [start, end])]); }
  catch { throw __velarServeRequestProblem(400, {error: "invalid_form_encoding"}); }
}

function __velarServeDispositionValue(value, key) {
  const pieces = __velarServeCall(__velarServeStringSplit, value, [";"]);
  for (let index = 1; index < pieces.length; index += 1) {
    const item = __velarServeCall(__velarServeStringTrim, pieces[index], []);
    const separator = __velarServeCall(__velarServeStringIndexOf, item, ["="]);
    if (separator < 1 || __velarServeCall(__velarServeStringToLowerCase, __velarServeCall(__velarServeStringSlice, item, [0, separator]), []) !== key) continue;
    let output = __velarServeCall(__velarServeStringTrim, __velarServeCall(__velarServeStringSlice, item, [separator + 1]), []);
    if (__velarServeCall(__velarServeStringStartsWith, output, ["\""]) && __velarServeCall(__velarServeStringEndsWith, output, ["\""]) && output.length >= 2) output = __velarServeCall(__velarServeStringSlice, output, [1, -1]);
    return output;
  }
  return null;
}

function __velarServeAddFormField(fields, name, value) {
  const existing = __velarServeOwnDescriptor(fields, name);
  if (existing === undefined) { fields[name] = value; return; }
  if (!existing.enumerable || !("value" in existing)) throw __velarServeRequestProblem(400, {error: "invalid_form"});
  if (__velarServeIsArray(existing.value)) existing.value[existing.value.length] = value;
  else fields[name] = [existing.value, value];
}

function __velarServeMultipartHeaders(text) {
  const output = __velarServeCall(__velarServeObjectCreate, __velarServeObject, [null]);
  const lines = __velarServeCall(__velarServeStringSplit, text, ["\r\n"]);
  if (lines.length > 64) throw __velarServeRequestProblem(400, {error: "invalid_multipart"});
  for (let index = 0; index < lines.length; index += 1) {
    const separator = __velarServeCall(__velarServeStringIndexOf, lines[index], [":"]);
    if (separator < 1) throw __velarServeRequestProblem(400, {error: "invalid_multipart"});
    const name = __velarServeCall(__velarServeStringToLowerCase, __velarServeCall(__velarServeStringTrim, __velarServeCall(__velarServeStringSlice, lines[index], [0, separator]), []), []);
    output[name] = __velarServeCall(__velarServeStringTrim, __velarServeCall(__velarServeStringSlice, lines[index], [separator + 1]), []);
  }
  return output;
}

function __velarServeUploadBasename(filename) {
  // A client may send a full path, including a Windows path with backslashes.
  // An Upload name is one file name, never a path an application can compose
  // into a directory it did not intend to write.
  const slashed = __velarServeCall(__velarServeStringSplit, filename, ["/"]);
  const separated = __velarServeCall(__velarServeStringSplit, slashed[slashed.length - 1], ["\\"]);
  const base = separated[separated.length - 1];
  if (base === "" || base === "." || base === ".." || __velarServeCall(__velarServeStringIncludes, base, ["\0"])) throw __velarServeRequestProblem(400, {error: "invalid_multipart"});
  return base;
}

function __velarServeMultipart(data, boundary) {
  const opening = __velarServeBytePattern("--" + boundary);
  const separator = __velarServeBytePattern("\r\n\r\n");
  const delimiter = __velarServeBytePattern("\r\n--" + boundary);
  if (__velarServeFindBytes(data, opening, 0) !== 0) throw __velarServeRequestProblem(400, {error: "invalid_multipart"});
  const fields = __velarServeCall(__velarServeObjectCreate, __velarServeObject, [null]);
  const files = new __velarServeMap();
  const uploadStates = [];
  let position = opening.length;
  let parts = 0;
  while (position < data.length) {
    if (data[position] === 45 && data[position + 1] === 45) break;
    if (data[position] !== 13 || data[position + 1] !== 10) throw __velarServeRequestProblem(400, {error: "invalid_multipart"});
    position += 2;
    const headerEnd = __velarServeFindBytes(data, separator, position);
    if (headerEnd < 0 || headerEnd - position > 16 * 1024) throw __velarServeRequestProblem(400, {error: "invalid_multipart"});
    const headers = __velarServeMultipartHeaders(__velarServeDecodeBytes(data, position, headerEnd));
    const contentStart = headerEnd + separator.length;
    const contentEnd = __velarServeFindBytes(data, delimiter, contentStart);
    if (contentEnd < 0) throw __velarServeRequestProblem(400, {error: "invalid_multipart"});
    const disposition = headers["content-disposition"];
    if (typeof disposition !== "string" || !__velarServeCall(__velarServeStringStartsWith, __velarServeCall(__velarServeStringToLowerCase, disposition, []), ["form-data"])) throw __velarServeRequestProblem(400, {error: "invalid_multipart"});
    const name = __velarServeDispositionValue(disposition, "name");
    const filename = __velarServeDispositionValue(disposition, "filename");
    if (name === null || name.length === 0 || name.length > 256) throw __velarServeRequestProblem(400, {error: "invalid_multipart"});
    const part = __velarServeCall(__velarServeUint8Subarray, data, [contentStart, contentEnd]);
    if (filename === null) {
      if (part.length > 1024 * 1024) throw __velarServeRequestProblem(413, {error: "form_field_too_large", parameter: name});
      __velarServeAddFormField(fields, name, __velarServeDecodeBytes(part));
    } else {
      if (filename.length > 1024 || __velarServeCall(__velarServeMapHas, files, [name])) throw __velarServeRequestProblem(400, {error: "invalid_multipart"});
      const base = __velarServeUploadBasename(filename);
      const contentType = typeof headers["content-type"] === "string" ? headers["content-type"] : "application/octet-stream";
      __velarServeCall(__velarServeMapSet, files, [name, __velarServeUploadValue(name, base, contentType, part, uploadStates)]);
    }
    parts += 1;
    if (parts > 128) throw __velarServeRequestProblem(413, {error: "too_many_form_parts"});
    position = contentEnd + delimiter.length;
  }
  return {fields, files, dispose() { for (let index = 0; index < uploadStates.length; index += 1) uploadStates[index].data = null; data = null; }};
}

function __velarServeFormComponent(value) {
  const spaced = __velarServeCall(__velarServeArrayJoin, __velarServeCall(__velarServeStringSplit, value, ["+"]), [" "]);
  try { return __velarServeCall(__velarServeDecodeURIComponent, undefined, [spaced]); }
  catch { throw __velarServeRequestProblem(400, {error: "invalid_form_encoding"}); }
}

function __velarServeUrlEncoded(text) {
  const fields = __velarServeCall(__velarServeObjectCreate, __velarServeObject, [null]);
  if (text === "") return {fields, files: new __velarServeMap(), dispose() {}};
  const pairs = __velarServeCall(__velarServeStringSplit, text, ["&"]);
  if (pairs.length > 128) throw __velarServeRequestProblem(413, {error: "too_many_form_parts"});
  for (let index = 0; index < pairs.length; index += 1) {
    const separator = __velarServeCall(__velarServeStringIndexOf, pairs[index], ["="]);
    const name = __velarServeFormComponent(separator < 0 ? pairs[index] : __velarServeCall(__velarServeStringSlice, pairs[index], [0, separator]));
    const value = __velarServeFormComponent(separator < 0 ? "" : __velarServeCall(__velarServeStringSlice, pairs[index], [separator + 1]));
    if (name.length === 0 || name.length > 256 || value.length > 1024 * 1024) throw __velarServeRequestProblem(400, {error: "invalid_form"});
    __velarServeAddFormField(fields, name, value);
  }
  return {fields, files: new __velarServeMap(), dispose() {}};
}

function __velarServeMediaType(header) {
  const pieces = __velarServeCall(__velarServeStringSplit, header, [";"]);
  return {type: __velarServeCall(__velarServeStringToLowerCase, __velarServeCall(__velarServeStringTrim, pieces[0], []), []), pieces};
}

async function __velarServeRequestForm(request, maxBodyBytes, context) {
  if (context.form !== null) return await context.form;
  context.form = (async () => {
    const header = __velarServeCall(__velarServeMapHas, request.headers, ["content-type"]) ? __velarServeCall(__velarServeMapGet, request.headers, ["content-type"]) : "";
    const media = __velarServeMediaType(header);
    try {
      if (media.type === "application/x-www-form-urlencoded") return __velarServeUrlEncoded(await request.text(maxBodyBytes));
      if (media.type === "multipart/form-data") {
        let boundary = null;
        for (let index = 1; index < media.pieces.length; index += 1) {
          const item = __velarServeCall(__velarServeStringTrim, media.pieces[index], []);
          if (!__velarServeCall(__velarServeStringStartsWith, __velarServeCall(__velarServeStringToLowerCase, item, []), ["boundary="])) continue;
          boundary = __velarServeCall(__velarServeStringSlice, item, [9]);
          if (__velarServeCall(__velarServeStringStartsWith, boundary, ["\""]) && __velarServeCall(__velarServeStringEndsWith, boundary, ["\""])) boundary = __velarServeCall(__velarServeStringSlice, boundary, [1, -1]);
        }
        if (boundary === null || boundary.length === 0 || boundary.length > 128 || /[\0\r\n]/u.test(boundary)) throw __velarServeRequestProblem(400, {error: "invalid_multipart_boundary"});
        return __velarServeMultipart(await request.bytes(maxBodyBytes), boundary);
      }
    } catch (error) { if (error instanceof RequestBodyTooLargeError) throw __velarServeRequestProblem(413, {error: "request_too_large"}); throw error; }
    throw __velarServeRequestProblem(415, {error: "unsupported_media_type", expected: "multipart/form-data or application/x-www-form-urlencoded"});
  })();
  return await context.form;
}

function __velarServeCoerceForm(fields, schema) {
  const output = __velarServeCall(__velarServeObjectCreate, __velarServeObject, [null]);
  const keys = __velarServeCall(__velarServeOwnKeys, __velarServeReflect, [fields]);
  for (let index = 0; index < keys.length; index += 1) {
    const name = keys[index];
    const value = fields[name];
    const property = schema?.properties?.[name];
    const values = __velarServeIsArray(value) ? value : [value];
    if (__velarServeIsArray(value) && property?.type !== "array") throw __velarServeRequestProblem(422, {error: "duplicate_parameter", parameter: name});
    const item = property?.type === "array" ? property.items : property;
    const converted = [];
    for (let itemIndex = 0; itemIndex < values.length; itemIndex += 1) {
      if (item?.type === "number") {
        const number = __velarServeCall(__velarServeNumber, undefined, [values[itemIndex]]);
        if (!__velarServeCall(__velarServeRegExpTest, __velarServeDecimalPattern, [values[itemIndex]]) || !__velarServeCall(__velarServeNumberIsFinite, __velarServeNumber, [number])) throw __velarServeRequestProblem(422, {error: "invalid_request", parameter: name});
        converted[converted.length] = number;
      } else if (item?.type === "boolean") {
        if (values[itemIndex] !== "true" && values[itemIndex] !== "false") throw __velarServeRequestProblem(422, {error: "invalid_request", parameter: name});
        converted[converted.length] = values[itemIndex] === "true";
      } else converted[converted.length] = values[itemIndex];
    }
    output[name] = property?.type === "array" ? __velarServeValidateDenseList(converted, "Form List input") : converted[0];
  }
  return output;
}

async function __velarServeResolveInput(descriptor, parameterName, parameter, request, maxBodyBytes, context) {
  if (descriptor.source === "request") return request;
  if (descriptor.source === "dependency") return await __velarServeResolveProvider(descriptor.extra, request, maxBodyBytes, context);
  if (descriptor.source === "security") return __velarServeSecurityInput(descriptor, request);
  if (descriptor.source === "form") {
    const form = await __velarServeRequestForm(request, maxBodyBytes, context);
    const value = __velarServeCoerceForm(form.fields, parameter?.schema ?? null);
    try { return descriptor.extra.parse(value); }
    catch { throw __velarServeRequestProblem(422, {error: "invalid_request", parameter: parameterName}); }
  }
  if (descriptor.source === "upload") {
    const form = await __velarServeRequestForm(request, maxBodyBytes, context);
    const name = descriptor.name === "" ? parameterName : descriptor.name;
    const upload = __velarServeCall(__velarServeMapGet, form.files, [name]);
    if (upload === undefined) throw __velarServeRequestProblem(422, {error: "missing_parameter", parameter: name});
    if (upload.size > descriptor.extra) throw __velarServeRequestProblem(413, {error: "upload_too_large", parameter: name});
    return upload;
  }
  const raw = __velarServeNamedInputRaw(descriptor, parameterName, request);
  if (raw === __velarServeMissing) {
    if (descriptor.hasDefault) return descriptor.fallback;
    throw __velarServeRequestProblem(422, {error: "missing_parameter", parameter: descriptor.name === "" ? parameterName : descriptor.name});
  }
  return parameter === null ? raw : __velarServeDecodeScalar(raw, parameter);
}

async function __velarServeRouteArguments(route, match, request, maxBodyBytes, context, connection = __velarServeMissing) {
  const values = [];
  if (route.bindRoute) {
    const params = __velarServeCall(__velarServeObjectCreate, __velarServeObject, [null]);
    for (let index = 0; index < route.pattern.pathCaptures.length; index += 1) {
      const capture = route.pattern.pathCaptures[index];
      const descriptor = __velarServeOwnDescriptor(match.values, capture.name);
      if (descriptor === undefined || !("value" in descriptor)) throw __velarServeRequestProblem(422, {error: "missing_parameter", parameter: capture.name});
      params[capture.name] = __velarServeDecodeScalar(descriptor.value, capture);
    }
    const query = __velarServeCall(__velarServeObjectCreate, __velarServeObject, [null]);
    for (let index = 0; index < route.pattern.queryCaptures.length; index += 1) {
      const capture = route.pattern.queryCaptures[index];
      const received = __velarServeCall(__velarServeMapGet, request.queryAll, [capture.wireName]);
      if (received === undefined) {
        if (!capture.optional) throw __velarServeRequestProblem(422, {error: "missing_parameter", parameter: capture.wireName});
        continue;
      }
      if (received.length !== 1) throw __velarServeRequestProblem(422, {error: "duplicate_parameter", parameter: capture.wireName});
      query[capture.name] = __velarServeDecodeScalar(received[0], capture);
    }
    __velarServeCall(__velarServeObjectFreeze, __velarServeObject, [params]);
    __velarServeCall(__velarServeObjectFreeze, __velarServeObject, [query]);
    values[values.length] = __velarServeRouteBinding(route.pattern, request.path, params, query);
  }
  let body = undefined;
  for (let index = 0; index < route.parameters.length; index += 1) {
    const parameter = route.parameters[index];
    if (parameter.source === "connection") {
      if (connection === __velarServeMissing) throw new __velarServeTypeError("WebSocket connection is unavailable outside a @websocket handler");
      values[values.length] = connection;
      continue;
    }
    if (parameter.source === "request") { values[values.length] = request; continue; }
    if (parameter.input !== null) {
      values[values.length] = await __velarServeResolveInput(parameter.input, parameter.name, parameter, request, maxBodyBytes, context);
      continue;
    }
    if (parameter.source === "body") {
      if (body === undefined) {
        if (!__velarServeJsonContentType(request.headers)) {
          throw __velarServeRequestProblem(415, {error: "unsupported_media_type", expected: "application/json"});
        }
        try { body = await request.json(maxBodyBytes); }
        catch (error) {
          if (error instanceof RequestBodyTooLargeError) throw __velarServeRequestProblem(413, {error: "request_too_large"});
          throw __velarServeRequestProblem(400, {error: "invalid_json"});
        }
      }
      let valid = false;
      try { valid = parameter.check(body) === true; } catch {}
      if (!valid) throw __velarServeRequestProblem(422, {error: "invalid_request", parameter: parameter.name});
      values[values.length] = body;
      continue;
    }
    // 路径和查询值只由 RoutePattern 绑定到第一个 RouteMatch 参数。走到这里说明
    // 编译器桥接数据损坏，不能再猜测来源并形成第二套路由协议。
    throw new __velarServeTypeError("Route parameter has no runtime binding strategy");
  }
  return values;
}

function __velarServeJsonContentType(headers) {
  const header = __velarServeCall(__velarServeMapGet, headers, ["content-type"]);
  if (header === undefined) return true;
  const mediaType = __velarServeCall(__velarServeStringToLowerCase, __velarServeCall(__velarServeStringTrim, header, []), []);
  const separator = __velarServeCall(__velarServeStringIndexOf, mediaType, [";"]);
  const value = separator < 0 ? mediaType : __velarServeCall(__velarServeStringTrim, __velarServeCall(__velarServeStringSlice, mediaType, [0, separator]), []);
  return value === "application/json"
    || __velarServeCall(__velarServeStringStartsWith, value, ["application/"]) && __velarServeCall(__velarServeStringEndsWith, value, ["+json"]);
}

function __velarServeIsResponseAttempt(value) {
  if (!value || typeof value !== "object" || __velarServeIsArray(value)) return false;
  if (!__velarServeOwnDescriptor(value, "status")) return false;
  return !!(__velarServeOwnDescriptor(value, "json") || __velarServeOwnDescriptor(value, "text") || __velarServeOwnDescriptor(value, "stream"));
}

function __velarServeAutomaticResponse(value) {
  if (__velarServeIsFileResponse(value)) return value;
  if (__velarServeIsResponseAttempt(value)) return __velarServeResponse(value);
  try { return __velarServeResponse(value); }
  catch { return __velarServeResponse({status: 200, json: value}); }
}

function __velarServeProblemDocument(problem, request) {
  // D114 P6 item 12: the wire name stays `code` — it is what OpenAPI publishes
  // and what clients already read — and the value is the problem's `reason`.
  const output = {type: problem.type, title: problem.title, status: problem.status, code: problem.reason};
  if (problem.detail !== null) output.detail = problem.detail;
  const instance = problem.instance ?? request?.path ?? null;
  if (instance !== null) output.instance = instance;
  if (problem.source !== null) output.source = problem.source;
  if (problem.parameter !== null) output.parameter = problem.parameter;
  return output;
}

function __velarServeAccepts(request, mediaType) {
  if (!request || !__velarServeCall(__velarServeMapHas, request.headers, ["accept"])) return true;
  const source = __velarServeCall(__velarServeStringSplit, __velarServeCall(__velarServeStringToLowerCase, __velarServeCall(__velarServeMapGet, request.headers, ["accept"]), []), [","]);
  const slash = __velarServeCall(__velarServeStringIndexOf, mediaType, ["/"]);
  const family = __velarServeCall(__velarServeStringSlice, mediaType, [0, slash]);
  for (let index = 0; index < source.length; index += 1) {
    const parts = __velarServeCall(__velarServeStringSplit, __velarServeCall(__velarServeStringTrim, source[index], []), [";"]);
    const accepted = __velarServeCall(__velarServeStringTrim, parts[0], []);
    let quality = 1;
    for (let part = 1; part < parts.length; part += 1) {
      const option = __velarServeCall(__velarServeStringTrim, parts[part], []);
      if (__velarServeCall(__velarServeStringStartsWith, option, ["q="])) quality = __velarServeNumber(__velarServeCall(__velarServeStringSlice, option, [2]));
    }
    if (!(quality > 0)) continue;
    if (accepted === "*/*" || accepted === mediaType || accepted === family + "/*") return true;
    if (__velarServeCall(__velarServeStringEndsWith, mediaType, ["+json"]) && accepted === "application/json") return true;
  }
  return false;
}

function __velarServeOutcomeHeaders(outcome) {
  const headers = __velarServeHeaders(outcome.headers);
  if (outcome.problem !== null) {
    const problemHeaders = __velarServeResponseHeaders(outcome.problem.headers);
    for (let index = 0; index < problemHeaders.length; index += 1) __velarServeCall(__velarServeMapSet, headers, [problemHeaders[index][0], problemHeaders[index][1]]);
  }
  return headers;
}

function __velarServeOutcomeResponse(response, outcome) {
  if (__velarServeIsFileResponse(response)) return response;
  if (outcome.background != null) response = __velarServeResponseCopy(response, null, outcome.background);
  const cookies = __velarServeCall(__velarServeWeakMapGet, __velarServeResponseCookies, [outcome]);
  if (cookies !== undefined) __velarServeCall(__velarServeWeakMapSet, __velarServeResponseCookies, [response, cookies]);
  return response;
}

function __velarServeEncodeOutcome(value, outcome, request, problemDocument = false) {
  const headers = __velarServeOutcomeHeaders(outcome);
  if (outcome.status === 204 || outcome.status === 304) return __velarServeOutcomeResponse(__velarServeResponse({status: outcome.status, text: "", headers}), outcome);
  if (problemDocument) {
    return __velarServeOutcomeResponse(__velarServeResponse({status: outcome.status, json: value, contentType: "application/problem+json; charset=utf-8", headers}), outcome);
  }
  if (typeof value === "string") {
    if (__velarServeAccepts(request, "text/plain")) return __velarServeOutcomeResponse(__velarServeResponse({status: outcome.status, text: value, contentType: "text/plain; charset=utf-8", headers}), outcome);
  } else if (__velarServeAccepts(request, "application/json")) {
    return __velarServeOutcomeResponse(__velarServeResponse({status: outcome.status, json: value, headers}), outcome);
  }
  const unacceptable = __velarServeProblem(406, "response.not_acceptable", "No acceptable response representation");
  const rejected = __velarServeOutcome(null, 406, headers, unacceptable);
  return __velarServeOutcomeResponse(__velarServeResponse({status: 406, json: __velarServeProblemDocument(unacceptable, request), contentType: "application/problem+json; charset=utf-8", headers: __velarServeOutcomeHeaders(rejected)}), rejected);
}

async function __velarServeFinalize(value, app, request, status = 200, problem = null, usePolicy = true) {
  if (__velarServeIsFileResponse(value)) return value;
  if (__velarServeIsResponseAttempt(value)) return __velarServeResponse(value);
  let outcome = __velarServeIsOutcome(value) ? value : __velarServeOutcome(value, problem?.status ?? status, null, problem);
  if (usePolicy && app.responseHandler !== null) {
    try {
      const mapped = await __velarServeCall(app.responseHandler.handler, undefined, [outcome, request]);
      if (__velarServeIsOutcome(mapped)) throw new __velarServeTypeError("@response returns Data or a final response, not another HttpOutcome");
      if (__velarServeIsFileResponse(mapped)) return mapped;
      if (__velarServeIsResponseAttempt(mapped)) return __velarServeOutcomeResponse(__velarServeResponse(mapped), outcome);
      return __velarServeEncodeOutcome(mapped, outcome, request, false);
    } catch (policyError) {
      // 策略是一次性边界。它失败后若回到外层通用 catch，再次 finalize 会重复
      // 调用策略并放大日志、写库等副作用，因此在这里直接降级且明确关闭策略。
      const failure = policyError instanceof HttpProblem
        ? policyError
        : __velarServeProblem(500, "server.response_policy", "Response policy failed");
      if (!(policyError instanceof HttpProblem)) __velarServeReportFailure(policyError);
      const failed = __velarServeOutcome(null, failure.status, null, failure);
      return __velarServeEncodeOutcome(__velarServeProblemDocument(failure, request), failed, request, true);
    }
  }
  const defaultProblem = outcome.problem !== null && outcome.value === null;
  const representation = defaultProblem ? __velarServeProblemDocument(outcome.problem, request) : outcome.value;
  return __velarServeEncodeOutcome(representation, outcome, request, defaultProblem);
}

// SV-D4: every ending a route can have is a response by the time it leaves the
// route wrapper — a thrown HttpProblem, a framework rejection on the way to the
// handler, and an unexpected error narrowed to the opaque 500 alike — so the
// middleware wrapping that route shapes it exactly as it shapes a 200. The
// error itself is kept against this request for middleware.errors.
function __velarServeFailureOutcome(request, error) {
  const problem = error instanceof HttpProblem ? error
    : error instanceof RequestBodyTooLargeError ? __velarServeProblem(413, "request.body_too_large", "Request body is too large")
      : __velarServeProblem(500, "server.internal", "Internal server error");
  if (!(error instanceof HttpProblem) && !(error instanceof RequestBodyTooLargeError)) __velarServeReportFailure(error);
  __velarServeCall(__velarServeWeakMapSet, __velarServeRouteFailures, [request, error]);
  return __velarServeOutcome(null, problem.status, null, problem);
}

async function __velarServeHandleAppResponse(app, request, maxBodyBytes, context) {
  try {
    const actual = __velarServeCall(__velarServeStringSplit, request.path, ["/"]);
    // 成功请求是压倒性的热路径。先只查当前方法（HEAD 复用 GET），
    // 命中后立即执行；只有 OPTIONS 或当前方法没有路由时，才扫描其他
    // 方法以构造准确的 404/405 和 Allow。
    const requestedMethod = request.method === "HEAD" ? "GET" : request.method;
    const canSelect = requestedMethod === "GET" || requestedMethod === "POST" || requestedMethod === "PUT"
      || requestedMethod === "PATCH" || requestedMethod === "DELETE";
    const attemptedMethod = request.method === "OPTIONS" || !canSelect ? null : requestedMethod;
    const selected = attemptedMethod === null ? null : __velarServeBestRoute(app, attemptedMethod, actual);
    if (selected !== null) {
      const routeBodyBytes = selected.route.maxBodyBytes === null || selected.route.maxBodyBytes > maxBodyBytes
        ? maxBodyBytes
        : selected.route.maxBodyBytes;
      const invokeRoute = async () => {
        try { return await __velarServeCall(selected.route.handler, undefined, await __velarServeRouteArguments(selected.route, selected.match, request, routeBodyBytes, context)); }
        catch (error) { return __velarServeFailureOutcome(request, error); }
      };
      return await __velarServeApplyMiddleware(selected.route, request, invokeRoute, value => __velarServeFinalize(value, app, request));
    }

    const allowed = new __velarServeMap();
    let pathOwner = null;
    const declared = ["GET", "POST", "PUT", "PATCH", "DELETE"];
    for (let methodIndex = 0; methodIndex < declared.length; methodIndex += 1) {
      const method = declared[methodIndex];
      if (method === attemptedMethod) continue;
      const candidate = __velarServeBestRoute(app, method, actual);
      if (candidate === null) continue;
      if (pathOwner === null || candidate.match.score > pathOwner.match.score) pathOwner = candidate;
      __velarServeCall(__velarServeMapSet, allowed, [method, true]);
    }
    if (request.method === "OPTIONS" && __velarServeCall(__velarServeMapSize, allowed, []) > 0) {
      const methods = __velarServeAllowedMethods(allowed);
      return await __velarServeApplyMiddleware(pathOwner.route, request, async () => __velarServeOutcome(null, 204, new __velarServeMap([["allow", __velarServeCall(__velarServeArrayJoin, methods, [", "])]])), value => __velarServeFinalize(value, app, request));
    }
    if (__velarServeCall(__velarServeMapSize, allowed, []) > 0) {
      const methods = __velarServeAllowedMethods(allowed);
      const problem = __velarServeProblem(405, "route.method_not_allowed", "Method not allowed", null, "method", request.method, new __velarServeMap([["allow", __velarServeCall(__velarServeArrayJoin, methods, [", "])]]));
      return await __velarServeApplyMiddleware(pathOwner.route, request, async () => __velarServeOutcome(null, 405, null, problem), value => __velarServeFinalize(value, app, request));
    }
    if (app.notFound !== null) {
      const problem = __velarServeProblem(404, "route.not_found", "Route not found", null, "path", request.path);
      return await __velarServeApplyMiddleware(
        app.notFound,
        request,
        async () => {
          const value = await __velarServeCall(app.notFound.handler, undefined, [request]);
          if (__velarServeIsFileResponse(value) || __velarServeIsResponseAttempt(value)) return value;
          return __velarServeOutcome(value, 404, null, problem);
        },
        value => __velarServeFinalize(value, app, request),
      );
    }
    const problem = __velarServeProblem(404, "route.not_found", "Route not found", null, "path", request.path);
    return await __velarServeApplyMiddleware(app, request, async () => __velarServeOutcome(null, 404, null, problem), value => __velarServeFinalize(value, app, request));
  } catch (error) {
    const outcome = __velarServeFailureOutcome(request, error);
    try { return await __velarServeFinalize(outcome, app, request); }
    catch (policyError) {
      __velarServeReportFailure(policyError);
      const internal = __velarServeProblem(500, "server.response_policy", "Response policy failed");
      return await __velarServeFinalize(__velarServeOutcome(null, 500, null, internal), app, request, 500, internal, false);
    }
  }
}

function __velarServeAppState(app = null, overrides = null) {
  const state = {
    cache: new __velarServeMap(), resolving: new __velarServeMap(), releases: [], providerCount: 0, overrides,
    phase: "open", activeRequests: 0, cancellations: new __velarServeMap(), drain: null, resolveDrain: null,
    startedLifecycles: 0,
  };
  if (app !== null) for (let index = 0; index < app.supplies.length; index += 1) {
    const binding = app.supplies[index];
    if (overrides !== null && __velarServeCall(__velarServeMapHas, overrides, [binding.provider])) continue;
    __velarServeCall(__velarServeMapSet, state.cache, [binding.provider, binding.value]);
    state.providerCount += 1;
    if (binding.provider.release !== null) state.releases[state.releases.length] = {release: binding.provider.release, value: binding.value};
  }
  return state;
}

function __velarServeBeginAppRequest(appState, cancellation) {
  if (appState.phase !== "open") return false;
  appState.activeRequests += 1;
  __velarServeCall(__velarServeMapSet, appState.cancellations, [cancellation, true]);
  return true;
}

function __velarServeEndAppRequest(appState, cancellation) {
  if (appState.activeRequests < 1) throw new __velarServeError("ServeApp request ownership is unbalanced");
  appState.activeRequests -= 1;
  __velarServeCall(__velarServeMapDelete, appState.cancellations, [cancellation]);
  if (appState.activeRequests === 0 && appState.resolveDrain !== null) {
    const resolve = appState.resolveDrain;
    appState.resolveDrain = null;
    resolve(null);
  }
}

async function __velarServeDrainAppState(appState, grace = __velarServeDefaultShutdownGrace) {
  if (!__velarServeIsSafeInteger(grace) || grace < 1 || grace > 120_000) throw new __velarServeRangeError("Server shutdown grace must be 1 through 120000 milliseconds");
  if (appState.phase === "closed") return null;
  appState.phase = "closing";
  const cancellations = __velarServeCall(__velarServeMapEntries, appState.cancellations, []);
  while (true) {
    const step = __velarServeCall(__velarServeMapIteratorNext, cancellations, []);
    if (step.done) break;
    __velarServeCancellation.__velarCancel(step.value[0], "Server is stopping");
  }
  if (appState.activeRequests === 0) return null;
  if (appState.drain === null) {
    appState.drain = new __velarServePromise(resolve => { appState.resolveDrain = resolve; });
  }
  let timer = null;
  const deadline = new __velarServePromise((_resolve, reject) => { timer = __velarServeCall(__velarServeSetTimeout, globalThis, [() => reject(new __velarServeError("ServeApp requests did not drain before the shutdown deadline")), grace]); });
  try { await __velarServeCall(__velarServePromiseRace, __velarServePromise, [__velarServeCall(__velarServeObjectFreeze, __velarServeObject, [[appState.drain, deadline]])]); }
  finally { if (timer !== null) __velarServeCall(__velarServeClearTimeout, globalThis, [timer]); }
  return null;
}

function __velarServeCollectEagerProvider(provider, providers, seen) {
  if (__velarServeCall(__velarServeMapHas, seen, [provider])) return;
  __velarServeCall(__velarServeMapSet, seen, [provider, true]);
  const keys = __velarServeCall(__velarServeOwnKeys, __velarServeReflect, [provider.inputs]);
  for (let index = 0; index < keys.length; index += 1) {
    const descriptor = provider.inputs[keys[index]];
    if (descriptor.source === "dependency") __velarServeCollectEagerProvider(descriptor.extra, providers, seen);
  }
  if (provider.scope === "app" && provider.eager) providers[providers.length] = provider;
}

async function __velarServeInitializeEagerProviders(app, maxBodyBytes, appState) {
  const providers = [];
  const seen = new __velarServeMap();
  const groups = [app.routes, app.webSockets];
  for (let groupIndex = 0; groupIndex < groups.length; groupIndex += 1) {
    const group = groups[groupIndex];
    for (let routeIndex = 0; routeIndex < group.length; routeIndex += 1) {
      const parameters = group[routeIndex].parameters;
      for (let parameterIndex = 0; parameterIndex < parameters.length; parameterIndex += 1) {
        const descriptor = parameters[parameterIndex].input;
        if (descriptor !== null && descriptor.source === "dependency") __velarServeCollectEagerProvider(descriptor.extra, providers, seen);
      }
    }
  }
  const context = __velarServeRequestContext(appState);
  for (let index = 0; index < providers.length; index += 1) await __velarServeResolveProvider(providers[index], null, maxBodyBytes, context);
  return null;
}

async function __velarServeRunStartup(app, appState) {
  for (let index = appState.startedLifecycles; index < app.lifecycles.length; index += 1) {
    const hook = app.lifecycles[index].startup;
    if (hook !== null) {
      const result = await __velarServeCall(hook, undefined, []);
      if (result !== null) throw new __velarServeTypeError("A lifecycle startup hook must resolve to null");
    }
    appState.startedLifecycles = index + 1;
  }
  return null;
}

async function __velarServeRunShutdown(app, appState) {
  let failure = null;
  for (let index = appState.startedLifecycles - 1; index >= 0; index -= 1) {
    appState.startedLifecycles = index;
    const hook = app.lifecycles[index].shutdown;
    if (hook === null) continue;
    try {
      const result = await __velarServeCall(hook, undefined, []);
      if (result !== null) throw new __velarServeTypeError("A lifecycle shutdown hook must resolve to null");
    } catch (error) { if (failure === null) failure = error; }
  }
  if (failure !== null) throw failure;
  return null;
}

async function __velarServeFinishApp(app, appState) {
  let failure = null;
  try { await __velarServeCleanupAppState(appState); } catch (error) { failure = error; }
  if (__velarServeIsApp(app)) {
    try { await __velarServeRunShutdown(app, appState); } catch (error) { if (failure === null) failure = error; }
  }
  if (failure !== null) throw failure;
  return null;
}

async function __velarServeFinishAppAfterDrain(app, appState) {
  if (appState.activeRequests > 0) {
    if (appState.drain === null) appState.drain = new __velarServePromise(resolve => { appState.resolveDrain = resolve; });
    await appState.drain;
  }
  return await __velarServeFinishApp(app, appState);
}

async function __velarServeHandleApp(app, request, maxBodyBytes, appState) {
  if (!__velarServeBeginAppRequest(appState, request.cancellation)) {
    const problem = __velarServeProblem(503, "server.stopping", "Server is stopping", null, null, null, new __velarServeMap([["connection", "close"]]));
    return __velarServeCall(__velarServeObjectFreeze, __velarServeObject, [{
      [__velarServeManagedResponseMarker]: true,
      response: await __velarServeFinalize(__velarServeOutcome(null, 503, null, problem), app, request),
      cleanup: async () => null,
    }]);
  }
  const context = __velarServeRequestContext(appState);
  try {
    const response = await __velarServeHandleAppResponse(app, request, maxBodyBytes, context);
    let cleaned = false;
    const cleanup = async () => {
      if (cleaned) return null;
      cleaned = true;
      try {
        await __velarServeWaitTimeoutSettlements(request);
        return await __velarServeCleanupRequestContext(context);
      }
      finally { __velarServeEndAppRequest(appState, request.cancellation); }
    };
    return __velarServeCall(__velarServeObjectFreeze, __velarServeObject, [{[__velarServeManagedResponseMarker]: true, response, cleanup}]);
  } catch (error) {
    try {
      await __velarServeWaitTimeoutSettlements(request);
      await __velarServeCleanupRequestContext(context);
    }
    catch (cleanupError) { __velarServeReportFailure(cleanupError); }
    finally { __velarServeEndAppRequest(appState, request.cancellation); }
    throw error;
  }
}

async function __velarServeHandleFunction(handler, request, appState) {
  if (!__velarServeBeginAppRequest(appState, request.cancellation)) {
    const problem = __velarServeProblem(503, "server.stopping", "Server is stopping");
    return await __velarServeFinalize(__velarServeOutcome(null, 503, null, problem), {responseHandler: null}, request);
  }
  try {
    const response = await __velarServeFinalize(await __velarServeCall(handler, undefined, [request]), {responseHandler: null}, request);
    let cleaned = false;
    const cleanup = async () => { if (cleaned) return null; cleaned = true; __velarServeEndAppRequest(appState, request.cancellation); return null; };
    return __velarServeCall(__velarServeObjectFreeze, __velarServeObject, [{[__velarServeManagedResponseMarker]: true, response, cleanup}]);
  } catch (error) {
    __velarServeEndAppRequest(appState, request.cancellation);
    throw error;
  }
}

async function __velarServePrepareWebSocket(app, nativeRequest, maxBodyBytes, appState) {
  const native = __velarServeNativeRequest(nativeRequest, maxBodyBytes);
  const request = native.request;
  const reject = status => {
    __velarServeCancellation.__velarCancel(request.cancellation, "WebSocket upgrade rejected");
    native.cleanup();
    return __velarServeCall(__velarServeObjectFreeze, __velarServeObject, [{accepted: false, status}]);
  };
  const actual = __velarServeCall(__velarServeStringSplit, request.path, ["/"]);
  const selected = __velarServeBestRoute({router: app.webSocketRouter}, "WEBSOCKET", actual);
  if (selected === null) return reject(404);
  if (!__velarServeBeginAppRequest(appState, request.cancellation)) return reject(503);
  const context = __velarServeRequestContext(appState);
  let active = true;
  const finish = async reason => {
    if (!active) return null;
    active = false;
    __velarServeCancellation.__velarCancel(request.cancellation, reason);
    let failure = null;
    try { await __velarServeCleanupRequestContext(context); }
    catch (error) { failure = error; }
    native.cleanup();
    __velarServeEndAppRequest(appState, request.cancellation);
    if (failure !== null) throw failure;
    return null;
  };
  try {
    const prepared = await __velarServeRouteArguments(selected.route, selected.match, request, maxBodyBytes, context, null);
    let started = false;
    return __velarServeCall(__velarServeObjectFreeze, __velarServeObject, [{
      accepted: true,
      status: 101,
      run: async connection => {
        if (started || !active) throw new __velarServeError("A prepared WebSocket route can run only once");
        started = true;
        const values = [];
        for (let index = 0; index < prepared.length; index += 1) values[index] = prepared[index];
        values[selected.route.connectionIndex + (selected.route.bindRoute ? 1 : 0)] = connection;
        try {
          const result = await __velarServeCall(selected.route.handler, undefined, values);
          if (result !== null) throw new __velarServeTypeError("@websocket handler must resolve to null");
          return null;
        } catch (error) {
          __velarServeReportFailure(error);
          throw error;
        } finally { await finish("WebSocket session ended"); }
      },
      abort: async () => {
        if (started) return null;
        started = true;
        return await finish("WebSocket upgrade was abandoned");
      },
      // 连接关闭和服务器停机只请求取消，不在这里提前释放请求级依赖。
      // 真正的清理仍由 run 的 finally 完成，避免处理器仍在执行时销毁资源。
      cancel: reason => {
        if (active) __velarServeCancellation.__velarCancel(request.cancellation, reason);
        return null;
      },
    }]);
  } catch (error) {
    try { await finish("WebSocket upgrade failed"); }
    catch (cleanupError) { __velarServeReportFailure(cleanupError); }
    if (error instanceof HttpProblem) return __velarServeCall(__velarServeObjectFreeze, __velarServeObject, [{accepted: false, status: error.status}]);
    if (error instanceof RequestBodyTooLargeError) return __velarServeCall(__velarServeObjectFreeze, __velarServeObject, [{accepted: false, status: 413}]);
    __velarServeReportFailure(error);
    return __velarServeCall(__velarServeObjectFreeze, __velarServeObject, [{accepted: false, status: 500}]);
  }
}

async function __velarServeNativeApp(app, maxBodyBytes = __velarServeMaxBodyBytes) {
  if (!__velarServeIsApp(app)) throw new __velarServeTypeError("Native HTTP composition requires a ServeApp");
  maxBodyBytes = __velarServeBodyLimit(maxBodyBytes);
  const appState = __velarServeAppState(app);
  try {
    await __velarServeRunStartup(app, appState);
    await __velarServeInitializeEagerProviders(app, maxBodyBytes, appState);
  } catch (error) {
    try { await __velarServeCleanupAppState(appState); } catch (cleanupError) { __velarServeReportFailure(cleanupError); }
    try { await __velarServeRunShutdown(app, appState); } catch (shutdownError) { __velarServeReportFailure(shutdownError); }
    throw error;
  }
  let closing = null;
  let finalized = null;
  const close = async (grace = __velarServeDefaultShutdownGrace) => {
    if (finalized !== null) return finalized;
    if (closing !== null) return closing;
    const attempt = (async () => {
      try { await __velarServeDrainAppState(appState, grace); }
      catch (error) {
        if (finalized === null) finalized = __velarServeFinishAppAfterDrain(app, appState);
        __velarServeCall(__velarServePromiseThen, finalized, [() => null, failure => __velarServeReportFailure(failure)]);
        throw error;
      }
      finalized = __velarServeFinishApp(app, appState);
      return await finalized;
    })();
    closing = attempt;
    try { return await attempt; }
    finally { if (closing === attempt) closing = null; }
  };
  return __velarServeCall(__velarServeObjectFreeze, __velarServeObject, [{
    handle: request => __velarServeHandleApp(app, request, maxBodyBytes, appState),
    webSocketRoutes: app.webSockets.length,
    prepareWebSocket: request => __velarServePrepareWebSocket(app, request, maxBodyBytes, appState),
    close,
  }]);
}

async function __velarServeApplyMiddleware(route, request, handler, finalize) {
  if (route.middleware.length === 0) return await finalize(await handler());
  // 逐层派发只为实际执行的中间件创建一个受保护的 next。旧实现先为整条
  // 链创建一轮包装闭包，执行时又创建一轮 guarded 闭包，请求越多浪费越大。
  const dispatch = async index => {
    if (index === route.middleware.length) return await finalize(await handler());
    let called = false;
    const next = async () => {
      if (called) throw new __velarServeError("A middleware next function can be called only once per request");
      called = true;
      return await dispatch(index + 1);
    };
    return await finalize(await route.middleware[index](request, next));
  };
  return await dispatch(0);
}

function __velarServeAllowedMethods(allowed) {
  const methods = [];
  const declared = ["GET", "POST", "PUT", "PATCH", "DELETE"];
  for (let index = 0; index < declared.length; index += 1) {
    if (__velarServeCall(__velarServeMapHas, allowed, [declared[index]])) methods[methods.length] = declared[index];
  }
  if (__velarServeCall(__velarServeMapHas, allowed, ["GET"])) methods[methods.length] = "HEAD";
  methods[methods.length] = "OPTIONS";
  return methods;
}

export function openapi(app, title = null, version = "1.0.0") {
  if (!__velarServeIsApp(app)) throw new __velarServeTypeError("openapi requires a ServeApp");
  if (title === null) title = app.name;
  if (typeof title !== "string" || title.length === 0 || title.length > 256
    || typeof version !== "string" || version.length === 0 || version.length > 256) {
    throw new __velarServeTypeError("openapi title and version must be bounded text");
  }
  const paths = __velarServeCall(__velarServeObjectCreate, __velarServeObject, [null]);
  const operationIds = new __velarServeMap();
  const securitySchemes = __velarServeCall(__velarServeObjectCreate, __velarServeObject, [null]);
  const securityNames = new __velarServeMap();
  // 显式身份是协议事实，先整体占位；这样后生成的展示身份只能让路，不会因
  // 路由声明顺序改变一个已发布 operationId。
  for (let index = 0; index < app.routes.length + app.webSockets.length; index += 1) {
    const route = index < app.routes.length ? app.routes[index] : app.webSockets[index - app.routes.length];
    if (route.operationId === null) continue;
    if (__velarServeCall(__velarServeMapHas, operationIds, [route.operationId])) {
      throw new __velarServeTypeError("OpenAPI operationId '" + route.operationId + "' is declared more than once");
    }
    __velarServeCall(__velarServeMapSet, operationIds, [route.operationId, true]);
  }
  for (let index = 0; index < app.routes.length; index += 1) {
    const route = app.routes[index];
    if (!route.documented) continue;
    const parameters = [];
    for (let captureIndex = 0; captureIndex < route.pattern.pathCaptures.length; captureIndex += 1) {
      const capture = route.pattern.pathCaptures[captureIndex];
      parameters[parameters.length] = {name: capture.wireName, in: "path", required: true, schema: capture.schema};
    }
    for (let captureIndex = 0; captureIndex < route.pattern.queryCaptures.length; captureIndex += 1) {
      const capture = route.pattern.queryCaptures[captureIndex];
      parameters[parameters.length] = {name: capture.wireName, in: "query", required: !capture.optional, schema: capture.schema};
    }
    let requestBody = null;
    const formProperties = __velarServeCall(__velarServeObjectCreate, __velarServeObject, [null]);
    const formRequired = [];
    let hasUpload = false;
    const operationSecurity = __velarServeCall(__velarServeObjectCreate, __velarServeObject, [null]);
    const securitySeen = new __velarServeMap();
    let documentsValidationFailure = route.pattern.pathCaptures.length > 0 || route.pattern.queryCaptures.length > 0;
    let documentsMalformedInput = false;
    let documentsBoundedBody = false;
    let documentsMediaType = false;
    for (let item = 0; item < route.parameters.length; item += 1) {
      const parameter = route.parameters[item];
      if (parameter.source === "request") continue;
      if (parameter.source !== "dependency" && parameter.source !== "security") documentsValidationFailure = true;
      if (parameter.source === "cookie" || parameter.source === "body" || parameter.source === "form" || parameter.source === "upload") documentsMalformedInput = true;
      if (parameter.source === "body" || parameter.source === "form" || parameter.source === "upload") {
        documentsBoundedBody = true;
        documentsMediaType = true;
      }
      const schema = __velarServeSchema(parameter.schema, "OpenAPI parameter schema");
      if (parameter.source === "body") requestBody = {required: parameter.required, content: {"application/json": {schema}}};
      else if (parameter.source === "form" || parameter.source === "upload") {
        if (parameter.source === "upload") hasUpload = true;
        const name = parameter.input?.name || parameter.name;
        if (parameter.source === "form" && schema.type === "object" && schema.properties && typeof schema.properties === "object") {
          const propertyNames = __velarServeCall(__velarServeOwnKeys, __velarServeReflect, [schema.properties]);
          for (let propertyIndex = 0; propertyIndex < propertyNames.length; propertyIndex += 1) {
            const propertyName = propertyNames[propertyIndex];
            if (__velarServeOwnDescriptor(formProperties, propertyName)) throw new __velarServeTypeError("OpenAPI form inputs contain conflicting field '" + propertyName + "'");
            formProperties[propertyName] = schema.properties[propertyName];
          }
          if (__velarServeIsArray(schema.required)) {
            for (let requiredIndex = 0; requiredIndex < schema.required.length; requiredIndex += 1) {
              if (!__velarServeCall(__velarServeArrayIncludes, formRequired, [schema.required[requiredIndex]])) formRequired[formRequired.length] = schema.required[requiredIndex];
            }
          }
        } else {
          if (__velarServeOwnDescriptor(formProperties, name)) throw new __velarServeTypeError("OpenAPI form inputs contain conflicting field '" + name + "'");
          formProperties[name] = parameter.source === "upload" ? {type: "string", format: "binary"} : schema;
          if (parameter.required) formRequired[formRequired.length] = name;
        }
      } else if (parameter.source === "security" || parameter.source === "dependency") {
        if (parameter.input !== null) __velarServeOpenApiInputSecurity(parameter.input, securitySchemes, securityNames, operationSecurity, securitySeen);
      } else {
        const name = parameter.input?.name || parameter.name;
        parameters[parameters.length] = {name, in: parameter.source, required: parameter.required, schema};
      }
    }
    if (__velarServeCall(__velarServeOwnKeys, __velarServeReflect, [formProperties]).length > 0) {
      const schema = {type: "object", properties: formProperties};
      if (formRequired.length > 0) schema.required = formRequired;
      requestBody = {required: formRequired.length > 0, content: hasUpload ? {"multipart/form-data": {schema}} : {"multipart/form-data": {schema}, "application/x-www-form-urlencoded": {schema}}};
    }
    const documentPath = __velarServeOpenApiPath(route.path);
    const operation = {
      operationId: route.operationId ?? __velarServeAllocateOperationId(route.method, documentPath, operationIds),
      parameters,
      responses: __velarServeCall(__velarServeObjectCreate, __velarServeObject, [null]),
    };
    // 全局策略的 schema 已在 createResponse 时校验，只复用同一份事实；若为每条
    // 路由重新深拷贝，大型 API 会把同一个外壳按路由数成倍复制。
    const responseSchema = app.responseHandler?.responseSchema
      ?? __velarServeSchema(route.responseSchema, "OpenAPI response schema");
    const responseContentTypes = app.responseHandler?.responseContentTypes ?? route.responseContentTypes;
    const responseContent = __velarServeCall(__velarServeObjectCreate, __velarServeObject, [null]);
    for (let contentIndex = 0; contentIndex < responseContentTypes.length; contentIndex += 1) responseContent[responseContentTypes[contentIndex]] = {schema: responseSchema};
    operation.responses[__velarServeString(route.status)] = route.status === 204 || route.status === 304
      ? {description: "Successful response"}
      : {description: "Successful response", content: responseContent};
    if (__velarServeCall(__velarServeOwnKeys, __velarServeReflect, [operationSecurity]).length > 0) {
      operation.responses["401"] = __velarServeOpenApiFailure("Authentication required", app.responseHandler);
    }
    if (documentsMalformedInput) operation.responses["400"] = __velarServeOpenApiFailure("Malformed request input", app.responseHandler);
    if (documentsBoundedBody) operation.responses["413"] = __velarServeOpenApiFailure("Request body or upload is too large", app.responseHandler);
    if (documentsMediaType) operation.responses["415"] = __velarServeOpenApiFailure("Unsupported request content type", app.responseHandler);
    if (documentsValidationFailure) operation.responses["422"] = __velarServeOpenApiFailure("Request validation failed", app.responseHandler);
    for (let errorIndex = 0; errorIndex < route.errors.length; errorIndex += 1) {
      const error = route.errors[errorIndex];
      operation.responses[__velarServeString(error.status)] = app.responseHandler === null
        ? {description: error.description}
        : __velarServeOpenApiFailure(error.description, app.responseHandler);
    }
    if (route.summary !== null) operation.summary = route.summary;
    if (route.description !== null) operation.description = route.description;
    if (route.tags.length > 0) operation.tags = route.tags;
    if (requestBody) operation.requestBody = requestBody;
    if (__velarServeCall(__velarServeOwnKeys, __velarServeReflect, [operationSecurity]).length > 0) operation.security = [operationSecurity];
    const entry = paths[documentPath] ?? (paths[documentPath] = __velarServeCall(__velarServeObjectCreate, __velarServeObject, [null]));
    entry[__velarServeCall(__velarServeStringToLowerCase, route.method, [])] = operation;
  }
  for (let index = 0; index < app.webSockets.length; index += 1) {
    const route = app.webSockets[index];
    if (!route.documented) continue;
    const parameters = [];
    for (let captureIndex = 0; captureIndex < route.pattern.pathCaptures.length; captureIndex += 1) {
      const capture = route.pattern.pathCaptures[captureIndex];
      parameters[parameters.length] = {name: capture.wireName, in: "path", required: true, schema: capture.schema};
    }
    for (let captureIndex = 0; captureIndex < route.pattern.queryCaptures.length; captureIndex += 1) {
      const capture = route.pattern.queryCaptures[captureIndex];
      parameters[parameters.length] = {name: capture.wireName, in: "query", required: !capture.optional, schema: capture.schema};
    }
    const operationSecurity = __velarServeCall(__velarServeObjectCreate, __velarServeObject, [null]);
    const securitySeen = new __velarServeMap();
    for (let item = 0; item < route.parameters.length; item += 1) {
      const parameter = route.parameters[item];
      if (parameter.source === "connection" || parameter.source === "request" || parameter.source === "dependency") continue;
      if (parameter.source === "security") {
        if (parameter.input !== null) __velarServeOpenApiInputSecurity(parameter.input, securitySchemes, securityNames, operationSecurity, securitySeen);
        continue;
      }
      parameters[parameters.length] = {
        name: parameter.input?.name || parameter.name,
        in: parameter.source,
        required: true,
        schema: __velarServeSchema(parameter.schema, "OpenAPI WebSocket parameter schema"),
      };
    }
    const documentPath = __velarServeOpenApiPath(route.path);
    const operation = {
      operationId: route.operationId ?? __velarServeAllocateOperationId("WEBSOCKET", documentPath, operationIds),
      parameters,
      responses: {"101": {description: "Switching Protocols"}},
      "x-velar-transport": "websocket",
    };
    if (route.summary !== null) operation.summary = route.summary;
    if (route.description !== null) operation.description = route.description;
    if (route.tags.length > 0) operation.tags = route.tags;
    if (__velarServeCall(__velarServeOwnKeys, __velarServeReflect, [operationSecurity]).length > 0) operation.security = [operationSecurity];
    const entry = paths[documentPath] ?? (paths[documentPath] = __velarServeCall(__velarServeObjectCreate, __velarServeObject, [null]));
    if (entry.get !== undefined) {
      throw new __velarServeTypeError("OpenAPI cannot describe both GET and WebSocket operations at '" + documentPath + "'");
    }
    entry.get = operation;
  }
  const document = {openapi: "3.1.0", info: {title, version}, paths};
  if (__velarServeCall(__velarServeOwnKeys, __velarServeReflect, [securitySchemes]).length > 0) document.components = {securitySchemes};
  if (__velarUtf8ByteLength(__velarJsonStringify(document)) > __velarServeMaxBodyBytes) throw new __velarServeRangeError("OpenAPI document cannot exceed 16 MiB");
  return document;
}

function __velarServeAllocateOperationId(method, documentPath, operationIds) {
  const base = __velarServeOperationId(method, documentPath);
  let candidate = base;
  let suffix = 2;
  while (__velarServeCall(__velarServeMapHas, operationIds, [candidate])) {
    candidate = base + "_" + suffix;
    suffix += 1;
  }
  __velarServeCall(__velarServeMapSet, operationIds, [candidate, true]);
  return candidate;
}

function __velarServeOpenApiFailure(description, responseHandler = null) {
  if (responseHandler !== null) {
    const content = __velarServeCall(__velarServeObjectCreate, __velarServeObject, [null]);
    for (let index = 0; index < responseHandler.responseContentTypes.length; index += 1) {
      content[responseHandler.responseContentTypes[index]] = {schema: responseHandler.responseSchema};
    }
    return {description, content};
  }
  return {
    description,
    content: {"application/problem+json": {schema: {
      type: "object",
      properties: {
        type: {type: "string"},
        title: {type: "string"},
        status: {type: "integer"},
        code: {type: "string"},
        detail: {type: "string"},
        instance: {type: "string"},
        source: {type: "string"},
        parameter: {type: "string"},
      },
      required: ["type", "title", "status", "code"],
      additionalProperties: true,
    }}},
  };
}

function __velarServeOpenApiInputSecurity(descriptor, schemes, names, requirements, seen) {
  if (descriptor.source === "dependency") {
    const provider = descriptor.extra;
    if (__velarServeCall(__velarServeMapHas, seen, [provider])) return;
    __velarServeCall(__velarServeMapSet, seen, [provider, true]);
    const keys = __velarServeCall(__velarServeOwnKeys, __velarServeReflect, [provider.inputs]);
    for (let index = 0; index < keys.length; index += 1) __velarServeOpenApiInputSecurity(provider.inputs[keys[index]], schemes, names, requirements, seen);
    return;
  }
  if (descriptor.source !== "security") return;
  const details = descriptor.extra;
  const identity = __velarJsonStringify(details);
  let name = __velarServeCall(__velarServeMapGet, names, [identity]);
  if (name == null) {
    name = "security" + (__velarServeCall(__velarServeMapSize, names, []) + 1);
    __velarServeCall(__velarServeMapSet, names, [identity, name]);
    if (details.kind === "apiKey") schemes[name] = {type: "apiKey", name: details.name, in: details.source};
    else if (details.kind === "basic") schemes[name] = {type: "http", scheme: "basic"};
    else if (details.kind === "bearer") schemes[name] = {type: "http", scheme: "bearer"};
    else if (details.kind === "oauth2") {
      const flow = {authorizationUrl: details.authorizationUrl, scopes: __velarServeCall(__velarServeObjectCreate, __velarServeObject, [null])};
      if (details.tokenUrl !== "") flow.tokenUrl = details.tokenUrl;
      for (let index = 0; index < details.scopes.length; index += 1) flow.scopes[details.scopes[index]] = details.scopes[index];
      schemes[name] = {type: "oauth2", flows: {authorizationCode: flow}};
    } else schemes[name] = {type: "openIdConnect", openIdConnectUrl: details.url};
  }
  requirements[name] = descriptor.extra.kind === "oauth2" ? descriptor.extra.scopes : [];
}

export function docs(app, title = null, version = "1.0.0", path = "/docs", openapiPath = "/openapi.json", routes = null) {
  if (!__velarServeIsApp(app)) throw new __velarServeTypeError("docs requires a ServeApp");
  path = __velarServeRoutePath(path, "docs path");
  openapiPath = __velarServeRoutePath(openapiPath, "docs OpenAPI path");
  if (path === openapiPath || /[{}*<>]/u.test(path) || /[{}*<>]/u.test(openapiPath)) throw new __velarServeTypeError("docs paths must be distinct literal URL paths");
  app = __velarServeDocumentRoutes(app, routes);
  const document = openapi(app, title, version);
  const schemaPattern = __velarCreateServePattern({definition: openapiPath, pathname: openapiPath, path: [], query: []});
  const docsPattern = __velarCreateServePattern({definition: path, pathname: path, path: [], query: []});
  const schemaRoute = __velarCreateServeRoute("GET", schemaPattern, [], async () => json(document), {documented: false}, false);
  const html = "<!doctype html><html><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"><title>Velar API Docs</title><style>body{font:15px system-ui;margin:0;background:#0b1020;color:#e8ecf4}main{max-width:960px;margin:auto;padding:32px}article{background:#151c31;border:1px solid #2a3555;border-radius:12px;padding:16px;margin:12px 0}code{color:#8ed7ff}.method{font-weight:700;color:#9cf0b3}button{background:#5b7cff;color:white;border:0;border-radius:7px;padding:8px 12px}</style></head><body><main><h1 id=\"title\">API</h1><p>OpenAPI 3.1 · bundled offline documentation</p><section id=\"routes\"></section></main><script>fetch(" + __velarJsonStringify(openapiPath) + ").then(function(r){return r.json()}).then(function(d){document.getElementById('title').textContent=d.info.title+' '+d.info.version;var root=document.getElementById('routes');Object.keys(d.paths).forEach(function(p){Object.keys(d.paths[p]).forEach(function(m){var a=document.createElement('article');var h=document.createElement('div');h.innerHTML='<span class=\"method\">'+m.toUpperCase()+'</span> <code></code>';h.querySelector('code').textContent=p;a.appendChild(h);var b=document.createElement('button');b.textContent='Try request';b.onclick=function(){fetch(p,{method:m.toUpperCase()}).then(function(r){return r.text().then(function(t){alert(r.status+' '+t)})})};a.appendChild(b);root.appendChild(a)})})}).catch(function(e){document.getElementById('routes').textContent=String(e)});</script></body></html>";
  const uiRoute = __velarCreateServeRoute("GET", docsPattern, [], async () => text(html, 200, "text/html; charset=utf-8"), {documented: false}, false);
  return __velarCreateServeApp(app.name, [app, schemaRoute, uiRoute]);
}

function __velarServeDocumentRoutes(app, documentation) {
  if (documentation == null) return app;
  let size;
  let iterator;
  try { size = __velarServeCall(__velarServeMapSize, documentation, []); iterator = __velarServeCall(__velarServeMapEntries, documentation, []); }
  catch { throw new __velarServeTypeError("docs routes must be a Map<string, route documentation>"); }
  if (!__velarServeIsSafeInteger(size) || size < 0 || size > app.routes.length || size > __velarServeMaxRoutes) throw new __velarServeRangeError("docs routes cannot exceed the application route count or 4096 entries");
  const configured = new __velarServeMap();
  while (true) {
    const step = __velarServeCall(__velarServeMapIteratorNext, iterator, []);
    if (step.done) break;
    if (!__velarServeIsArray(step.value) || step.value.length !== 2 || typeof step.value[0] !== "string" || step.value[0].length > 4352) {
      throw new __velarServeTypeError("docs routes must be a Map with bounded 'METHOD /path' string keys");
    }
    const metadata = __velarServeRecord(step.value[1], __velarServeRouteDocumentationFields, "Route documentation");
    if (metadata.documented !== undefined && typeof metadata.documented !== "boolean") throw new __velarServeTypeError("Route documentation documented must be bool");
    if (metadata.status !== undefined && (!__velarServeIsSafeInteger(metadata.status) || metadata.status < 200 || metadata.status > 599)) throw new __velarServeRangeError("Route documentation status must be 200 through 599");
    const normalized = {
      ...(metadata.summary === undefined ? {} : {summary: __velarServeDocumentationText(metadata.summary, "Route summary", 1024)}),
      ...(metadata.description === undefined ? {} : {description: __velarServeDocumentationText(metadata.description, "Route description", 16384)}),
      ...(metadata.tags === undefined ? {} : {tags: __velarServeStringList(metadata.tags, "Route documentation tags", 32)}),
      ...(metadata.status === undefined ? {} : {status: metadata.status}),
      ...(metadata.errors === undefined ? {} : {errors: __velarServeErrorDocuments(metadata.errors)}),
      ...(metadata.documented === undefined ? {} : {documented: metadata.documented}),
    };
    __velarServeCall(__velarServeMapSet, configured, [step.value[0], normalized]);
  }
  if (__velarServeCall(__velarServeMapSize, configured, []) !== size) throw new __velarServeTypeError("docs routes changed while they were being read");
  const seen = new __velarServeMap();
  const output = [];
  for (let index = 0; index < app.routes.length; index += 1) {
    const route = app.routes[index];
    const internalKey = route.method + " " + route.path;
    const publicKey = route.method + " " + __velarServeOpenApiPath(route.path);
    const key = __velarServeCall(__velarServeMapHas, configured, [internalKey]) ? internalKey
      : __velarServeCall(__velarServeMapHas, configured, [publicKey]) ? publicKey : null;
    if (key === null) { output[output.length] = route; continue; }
    __velarServeCall(__velarServeMapSet, seen, [key, true]);
    output[output.length] = __velarCreateServeRoute(route.method, route.pattern, route.parameters, route.handler, __velarServeRouteMetadata(route, __velarServeCall(__velarServeMapGet, configured, [key])), route.bindRoute);
  }
  if (__velarServeCall(__velarServeMapSize, seen, []) !== size) throw new __velarServeTypeError("docs routes contains a route that the application does not declare");
  return __velarServeAppValue(app.name, output, app.webSockets, app.lifecycles, app.notFound, app.responseHandler, app.supplies, app.middleware);
}

function __velarServeOpenApiPath(path) {
  const segments = __velarServeCall(__velarServeStringSplit, path, ["/"]);
  for (let index = 1; index < segments.length; index += 1) {
    const segment = segments[index];
    if (!__velarServeCall(__velarServeStringStartsWith, segment, ["{"])) continue;
    const declaration = __velarServeCall(__velarServeStringSlice, segment, [1, -1]);
    const separator = __velarServeCall(__velarServeStringIndexOf, declaration, [":"]);
    segments[index] = "{" + __velarServeCall(__velarServeStringSlice, declaration, [0, separator]) + "}";
  }
  return __velarServeCall(__velarServeArrayJoin, segments, ["/"]);
}

function __velarServeOperationId(method, path) {
  let output = __velarServeCall(__velarServeStringToLowerCase, method, []);
  let separated = false;
  for (let index = 0; index < path.length; index += 1) {
    const character = path[index];
    if (__velarServeCall(__velarServeRegExpTest, __velarServeOperationIdCharacterPattern, [character])) {
      output += character;
      separated = false;
    } else if (!separated) {
      output += "_";
      separated = true;
    }
  }
  return output;
}

function __velarServeBodyResult(value, maximum) {
  value = __velarServeRecord(value, __velarServeBodyFields, "ServeRequest body result");
  if (!__velarServeIsSafeInteger(value.bytes) || value.bytes < 0 || value.bytes > __velarServeMaxBodyBytes || typeof value.tooLarge !== "boolean"
    || value.tooLarge && value.text !== null || !value.tooLarge && typeof value.text !== "string") {
    throw new __velarServeTypeError("Node host returned an invalid request body");
  }
  if (value.tooLarge || value.bytes > maximum) throw new RequestBodyTooLargeError(maximum);
  return value.text;
}

function __velarServeBodyBytesResult(value, maximum) {
  value = __velarServeRecord(value, __velarServeBodyBytesFields, "ServeRequest byte body result");
  if (!__velarServeIsSafeInteger(value.bytes) || value.bytes < 0 || value.bytes > __velarServeMaxBodyBytes || typeof value.tooLarge !== "boolean"
    || value.tooLarge && value.data !== null || !value.tooLarge && !__velarServeBytesType.is(value.data)) {
    throw new __velarServeTypeError("Node host returned an invalid request byte body");
  }
  if (value.tooLarge || value.bytes > maximum) throw new RequestBodyTooLargeError(maximum);
  return value.data;
}

function __velarServeRequest(value) {
  value = __velarServeRecord(value, __velarServeRequestFields, "Node serve request event");
  if (!__velarServeIsSafeInteger(value.token) || value.token < 1 || !__velarServeIsSafeInteger(value.request) || value.request < 1
    || typeof value.method !== "string" || value.method.length === 0 || value.method.length > 32
    || !__velarServeCall(__velarServeRegExpTest, __velarServeMethodPattern, [value.method])
    || typeof value.path !== "string" || !__velarServeCall(__velarServeStringStartsWith, value.path, ["/"]) || value.path.length > __velarServeMaxPathCodeUnits) {
    throw new __velarServeTypeError("Node host returned an invalid serve request");
  }
  const handle = value.request;
  const cancellation = __velarServeCancellation.__velarCreate();
  __velarServeCall(__velarServeMapSet, __velarServeHostCancellations, [handle, {token: value.token, cancellation}]);
  const query = __velarServePairsMaps(value.query, "ServeRequest.query");
  let bytesPromise = null;
  const bytes = async (maxBytes = __velarServeMaxBodyBytes) => {
    if (!__velarServeIsSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > __velarServeMaxBodyBytes) {
      throw new __velarServeRangeError("Request body maxBytes must be an integer from 1 through 16777216");
    }
    if (bytesPromise === null) bytesPromise = __velarNodeHostInvoke("serve.bodyBytes", [handle, maxBytes]);
    return __velarServeBodyBytesResult(await bytesPromise, maxBytes);
  };
  const body = async (maxBytes = __velarServeMaxBodyBytes) => {
    const data = await bytes(maxBytes);
    try { return __velarServeCall(__velarServeTextDecode, __velarServeUtf8Decoder, [data]); }
    catch { throw new __velarServeTypeError("Request body must be valid UTF-8 text"); }
  };
  // SV-I2: bytes Core's Json.parse refuses are not JSON here either, and an
  // unparseable body is the framework's own 400 request.invalid.json — the same
  // answer a declared body parameter gives — not an opaque 500.
  const json = async (maxBytes = __velarServeMaxBodyBytes) => { const text = await body(maxBytes); try { return __velarJsonParse(text, "ServeRequest JSON text"); } catch { throw __velarServeRequestProblem(400, {error: "invalid_json"}); } };
  return {token: value.token, handle, request: __velarServeCall(__velarServeObjectFreeze, __velarServeObject, [{
    method: value.method,
    path: value.path,
    query: query.values,
    queryAll: query.all,
    headers: __velarServePairsMap(value.headers, "ServeRequest.headers"),
    cancellation,
    text: body,
    bytes,
    json,
    parse: async (Type, maxBytes = __velarServeMaxBodyBytes) => {
      Type = __velarRequireRuntimeType(Type, "ServeRequest.parse");
      return Type.parse(await json(maxBytes));
    },
  }])};
}

// The budget error can also surface after a response has started, where the host
// refuses a second terminal response; that attempt fails and the request falls
// through to the opaque failure exactly as any other late error does.
async function __velarServeShedOutbound(handle) {
  try {
    await __velarNodeHostInvoke("serve.respond", [handle, 503, [["retry-after", "1"]], "json", '{"error":"outbound_budget_exhausted"}', null, null, []]);
    return true;
  } catch { return false; }
}

async function __velarServeWriteResponse(handle, value) {
  let cleanup = null;
  let backgroundTasks = null;
  const managed = value && typeof value === "object" ? __velarServeOwnDescriptor(value, __velarServeManagedResponseMarker) : null;
  if (managed?.enumerable === true && "value" in managed && managed.value === true) {
    cleanup = value.cleanup;
    value = value.response;
  }
  try {
    if (__velarServeIsFileResponse(value)) {
      const headers = __velarServeResponseHeaders(value.headers);
      await __velarServeWithOutbound(__velarServeHeaderPairBytes(headers), () => __velarNodeHostInvoke("serve.respondFile", [handle, value.root, value.relocatedRoot, value.path, value.fallback, headers, []]));
      return null;
    }
    const response = __velarServeResponse(value);
    backgroundTasks = response.background ?? null;
    const headers = __velarServeResponseHeaders(response.headers);
    const cookies = __velarServeCookies(response);
    let metadataBytes = __velarServeHeaderPairBytes(headers);
    for (let index = 0; index < cookies.length; index += 1) metadataBytes += __velarUtf8ByteLength(cookies[index]);
    if (__velarServeOwnDescriptor(response, "json")) {
      const body = __velarServeCall(__velarServeWeakMapGet, __velarServeSerializedJson, [response]);
      if (__velarUtf8ByteLength(body) > __velarServeMaxBodyBytes) throw new __velarServeRangeError("ServeResponse.json cannot exceed 16 MiB");
      await __velarServeWithOutbound(metadataBytes + __velarUtf8ByteLength(body), () => __velarNodeHostInvoke("serve.respond", [handle, response.status, headers, "json", body, response.contentType ?? null, response.compression ?? null, cookies]));
      return null;
    }
    if (__velarServeOwnDescriptor(response, "text")) {
      await __velarServeWithOutbound(metadataBytes + __velarUtf8ByteLength(response.text), () => __velarNodeHostInvoke("serve.respond", [handle, response.status, headers, "text", response.text, response.contentType ?? null, response.compression ?? null, cookies]));
      return null;
    }
    await __velarServeWithOutbound(metadataBytes, () => __velarNodeHostInvoke("serve.streamStart", [handle, response.status, headers, cookies]));
    let writing = false;
    const write = async chunk => {
      if (writing) throw new __velarServeError("ServeResponse allows only one active stream write");
      writing = true;
      try {
      if (typeof chunk !== "string") throw new __velarServeTypeError("ServeResponse.stream chunks must be strings");
      if (__velarUtf8ByteLength(chunk) > 1024 * 1024) throw new __velarServeRangeError("ServeResponse.stream chunks cannot exceed 1 MiB");
      await __velarServeWithOutbound(__velarUtf8ByteLength(chunk), () => __velarNodeHostInvoke("serve.streamWrite", [handle, chunk]));
      return null;
      } finally { writing = false; }
    };
    const result = await response.stream(write);
    if (result !== null) throw new __velarServeTypeError("ServeResponse.stream producer must resolve to null");
    if (writing) throw new __velarServeError("ServeResponse stream producer returned before its write completed");
    await __velarNodeHostInvoke("serve.streamEnd", [handle]);
    return null;
  } finally {
    await __velarServeRunBackground(backgroundTasks);
    if (typeof cleanup === "function") {
      try { await cleanup(); }
      catch (error) { __velarServeReportFailure(error); }
    }
  }
}

