function __velarServeTestOverrides(value) {
  if (value == null) return new __velarServeMap();
  let size;
  let iterator;
  try { size = __velarServeCall(__velarServeMapSize, value, []); iterator = __velarServeCall(__velarServeMapEntries, value, []); }
  catch { throw new __velarServeTypeError("server-test overrides must be a Map<Provider, value>"); }
  if (!__velarServeIsSafeInteger(size) || size < 0 || size > 128) throw new __velarServeRangeError("server-test overrides cannot contain more than 128 providers");
  const output = new __velarServeMap();
  while (true) {
    const step = __velarServeCall(__velarServeMapIteratorNext, iterator, []);
    if (step.done) break;
    if (!__velarServeIsArray(step.value) || step.value.length !== 2 || !__velarServeIsProvider(step.value[0])) throw new __velarServeTypeError("server-test override keys must be Providers");
    __velarServeCall(__velarServeMapSet, output, [step.value[0], step.value[1]]);
  }
  return output;
}

function __velarServeTestHeaders(value) {
  if (value == null) return new __velarServeMap();
  const pairs = __velarServeMapSnapshot(value, "server-test headers");
  const output = new __velarServeMap();
  for (let index = 0; index < pairs.length; index += 1) __velarServeCall(__velarServeMapSet, output, [__velarServeCall(__velarServeStringToLowerCase, pairs[index][0], []), pairs[index][1]]);
  return output;
}

function __velarServeTestUploadEntries(value) {
  if (value == null) return [];
  let size;
  let iterator;
  try { size = __velarServeCall(__velarServeMapSize, value, []); iterator = __velarServeCall(__velarServeMapEntries, value, []); }
  catch { throw new __velarServeTypeError("server-test files must be a Map<string, upload>"); }
  if (!__velarServeIsSafeInteger(size) || size < 0 || size > 128) throw new __velarServeRangeError("server-test files cannot contain more than 128 uploads");
  const output = [];
  while (true) {
    const step = __velarServeCall(__velarServeMapIteratorNext, iterator, []);
    if (step.done) break;
    if (!__velarServeIsArray(step.value) || step.value.length !== 2) throw new __velarServeTypeError("server-test files must be a Map<string, upload>");
    const field = step.value[0];
    const file = __velarServeRecord(step.value[1], __velarServeTestUploadFields, "server-test upload");
    if (typeof field !== "string" || field.length === 0 || field.length > 256 || /[\0\r\n"]/u.test(field)
      || typeof file.filename !== "string" || file.filename.length === 0 || file.filename.length > 1024 || /[\0\r\n"]/u.test(file.filename)
      || file.contentType !== undefined && (typeof file.contentType !== "string" || file.contentType.length === 0 || file.contentType.length > 1024 || /[\0\r\n]/u.test(file.contentType))) {
      throw new __velarServeTypeError("server-test upload names and content types must be bounded HTTP text");
    }
    const data = typeof file.data === "string"
      ? __velarServeCall(__velarServeTextEncode, __velarServeUtf8Encoder, [file.data])
      : __velarServeBytesType.parse(file.data);
    output[output.length] = {field, filename: file.filename, contentType: file.contentType ?? "application/octet-stream", data};
  }
  if (output.length !== size) throw new __velarServeTypeError("server-test files changed while they were being read");
  return output;
}

function __velarServeBytesContain(source, pattern) {
  if (pattern.byteLength === 0 || pattern.byteLength > source.byteLength) return false;
  for (let offset = 0; offset <= source.byteLength - pattern.byteLength; offset += 1) {
    let equal = true;
    for (let index = 0; index < pattern.byteLength; index += 1) if (source[offset + index] !== pattern[index]) { equal = false; break; }
    if (equal) return true;
  }
  return false;
}

function __velarServeTestMultipart(form, files) {
  const fields = form == null ? [] : __velarServeMapSnapshot(form, "server-test form", 256);
  for (let index = 0; index < fields.length; index += 1) if (fields[index][0].length === 0 || /[\0\r\n"]/u.test(fields[index][0])) throw new __velarServeTypeError("server-test form field names must be bounded HTTP text");
  const uploads = __velarServeTestUploadEntries(files);
  const values = [];
  for (let index = 0; index < fields.length; index += 1) values[values.length] = __velarServeCall(__velarServeTextEncode, __velarServeUtf8Encoder, [fields[index][1]]);
  for (let index = 0; index < uploads.length; index += 1) values[values.length] = uploads[index].data;
  let boundary = null;
  for (let attempt = 0; attempt < 32; attempt += 1) {
    if (!__velarServeIsSafeInteger(__velarServeNextTestBoundary)) __velarServeNextTestBoundary = 1;
    const candidate = "velar-test-" + __velarServeCall(__velarServeDateNow, __velarServeDate, []) + "-" + __velarServeNextTestBoundary++;
    const encoded = __velarServeCall(__velarServeTextEncode, __velarServeUtf8Encoder, [candidate]);
    let collision = false;
    for (let index = 0; index < values.length; index += 1) if (__velarServeBytesContain(values[index], encoded)) { collision = true; break; }
    if (!collision) { boundary = candidate; break; }
  }
  if (boundary === null) throw new __velarServeRangeError("server-test could not choose a collision-free multipart boundary");
  const parts = [];
  let total = 0;
  const appendText = text => { const data = __velarServeCall(__velarServeTextEncode, __velarServeUtf8Encoder, [text]); total += data.byteLength; parts[parts.length] = data; };
  const appendData = data => { total += data.byteLength; parts[parts.length] = data; };
  for (let index = 0; index < fields.length; index += 1) {
    appendText("--" + boundary + "\r\nContent-Disposition: form-data; name=\"" + fields[index][0] + "\"\r\n\r\n");
    appendData(values[index]);
    appendText("\r\n");
  }
  for (let index = 0; index < uploads.length; index += 1) {
    const upload = uploads[index];
    appendText("--" + boundary + "\r\nContent-Disposition: form-data; name=\"" + upload.field + "\"; filename=\"" + upload.filename + "\"\r\nContent-Type: " + upload.contentType + "\r\n\r\n");
    appendData(upload.data);
    appendText("\r\n");
  }
  appendText("--" + boundary + "--\r\n");
  if (total > __velarServeMaxBodyBytes) throw new __velarServeRangeError("server-test multipart body exceeds 16 MiB");
  const data = new __velarServeUint8Array(total);
  let offset = 0;
  for (let index = 0; index < parts.length; index += 1) { __velarServeCall(__velarServeUint8Set, data, [parts[index], offset]); offset += parts[index].byteLength; }
  return {data, contentType: "multipart/form-data; boundary=" + boundary};
}

function __velarServeTestRequest(method, target, options, cookies) {
  if (typeof method !== "string" || !__velarServeCall(__velarServeRegExpTest, __velarServeMethodPattern, [method])) throw new __velarServeTypeError("server-test method is invalid");
  if (typeof target !== "string" || target.length === 0 || __velarUtf8ByteLength(target) > 64 * 1024 || !__velarServeCall(__velarServeStringStartsWith, target, ["/"])) throw new __velarServeTypeError("server-test target must be a bounded absolute URL path");
  options = options == null ? {} : __velarServePlainRecord(options, "server-test request options");
  const keys = __velarServeCall(__velarServeOwnKeys, __velarServeReflect, [options]);
  for (let index = 0; index < keys.length; index += 1) if (!__velarServeCall(__velarServeArrayIncludes, ["headers", "json", "text", "form", "files"], [keys[index]])) throw new __velarServeTypeError("server-test request options have an unknown field");
  const structuredBody = __velarServeOwnDescriptor(options, "form") || __velarServeOwnDescriptor(options, "files");
  if ((__velarServeOwnDescriptor(options, "json") ? 1 : 0) + (__velarServeOwnDescriptor(options, "text") ? 1 : 0) + (structuredBody ? 1 : 0) > 1) throw new __velarServeTypeError("server-test request accepts one body source: json, text, or form/files");
  const targetParts = __velarServeTargetParts(target, "server-test target");
  const path = targetParts.path;
  const query = __velarServePairsMaps(targetParts.query, "server-test query");
  const headers = __velarServeTestHeaders(options.headers);
  if (!__velarServeCall(__velarServeMapHas, headers, ["cookie"]) && __velarServeCall(__velarServeMapSize, cookies, []) > 0) {
    const values = [];
    const iterator = __velarServeCall(__velarServeMapEntries, cookies, []);
    while (true) { const step = __velarServeCall(__velarServeMapIteratorNext, iterator, []); if (step.done) break; values[values.length] = step.value[0] + "=" + step.value[1]; }
    __velarServeCall(__velarServeMapSet, headers, ["cookie", __velarServeCall(__velarServeArrayJoin, values, ["; "])]);
  }
  let bodyText = "";
  let bodyData = __velarServeCall(__velarServeTextEncode, __velarServeUtf8Encoder, [bodyText]);
  if (__velarServeOwnDescriptor(options, "json")) {
    bodyText = __velarJsonStringify(options.json);
    if (!__velarServeCall(__velarServeMapHas, headers, ["content-type"])) __velarServeCall(__velarServeMapSet, headers, ["content-type", "application/json"]);
  } else if (__velarServeOwnDescriptor(options, "text")) {
    if (typeof options.text !== "string") throw new __velarServeTypeError("server-test text body must be string");
    bodyText = options.text;
  } else if (structuredBody) {
    const multipart = __velarServeTestMultipart(options.form, options.files);
    bodyData = multipart.data;
    __velarServeCall(__velarServeMapSet, headers, ["content-type", multipart.contentType]);
  }
  if (__velarUtf8ByteLength(bodyText) > __velarServeMaxBodyBytes) throw new __velarServeRangeError("server-test request body exceeds 16 MiB");
  if (!structuredBody) bodyData = __velarServeCall(__velarServeTextEncode, __velarServeUtf8Encoder, [bodyText]);
  const bytes = async maxBytes => {
    const maximum = maxBytes ?? __velarServeMaxBodyBytes;
    if (!__velarServeIsSafeInteger(maximum) || maximum < 1 || maximum > __velarServeMaxBodyBytes || bodyData.byteLength > maximum) throw new RequestBodyTooLargeError(maximum);
    return bodyData;
  };
  const textBody = async maxBytes => { const data = await bytes(maxBytes); if (!structuredBody) return bodyText; try { return __velarServeCall(__velarServeTextDecode, __velarServeUtf8Decoder, [data]); } catch { throw new __velarServeTypeError("server-test request body is not UTF-8 text"); } };
  const jsonBody = async maxBytes => __velarJsonParse(await textBody(maxBytes), "server-test JSON text");
  const cancellation = __velarServeCancellation.__velarCreate();
  return __velarServeCall(__velarServeObjectFreeze, __velarServeObject, [{
    method, path, query: query.values, queryAll: query.all, headers, cancellation, text: textBody, bytes, json: jsonBody,
    parse: async (Type, maxBytes = __velarServeMaxBodyBytes) => { Type = __velarRequireRuntimeType(Type, "server-test request parse"); return Type.parse(await jsonBody(maxBytes)); },
  }]);
}

async function __velarServeTestResponse(value, cookies) {
  let cleanup = null;
  const managed = value && typeof value === "object" ? __velarServeOwnDescriptor(value, __velarServeManagedResponseMarker) : null;
  if (managed?.enumerable === true && "value" in managed && managed.value === true) { cleanup = value.cleanup; value = value.response; }
  let backgroundTasks = null;
  try {
    if (__velarServeIsFileResponse(value)) {
      const loaded = __velarServeRecord(await __velarNodeHostInvoke("serve.readFile", [value.root, value.path, value.fallback]), __velarServeTestFileFields, "server-test file result");
      if (!__velarServeBytesType.is(loaded.data) || loaded.data.byteLength > __velarServeMaxBodyBytes || typeof loaded.contentType !== "string" || loaded.contentType.length === 0 || loaded.contentType.length > 1024 || /[\0\r\n]/u.test(loaded.contentType)) {
        throw new __velarServeTypeError("Node host returned an invalid server-test file result");
      }
      const headers = __velarServeHeaders(value.headers, "content-type", loaded.contentType);
      let textValue = null;
      const readText = async () => {
        if (textValue === null) {
          try { textValue = __velarServeCall(__velarServeTextDecode, __velarServeUtf8Decoder, [loaded.data]); }
          catch { throw new __velarServeTypeError("server-test file response is not UTF-8 text"); }
        }
        return textValue;
      };
      return __velarServeCall(__velarServeObjectFreeze, __velarServeObject, [{status: 200, headers, text: readText, json: async () => __velarJsonParse(await readText(), "server-test file response JSON")}]);
    }
    const response = __velarServeResponse(value);
    backgroundTasks = response.background ?? null;
    const headers = __velarServeHeaders(response.headers);
    const checkedCookies = __velarServeCookies(response);
    const responseCookies = [];
    for (let index = 0; index < checkedCookies.length; index += 1) responseCookies[index] = checkedCookies[index];
    if (__velarServeCall(__velarServeMapHas, headers, ["set-cookie"])) responseCookies[responseCookies.length] = __velarServeCall(__velarServeMapGet, headers, ["set-cookie"]);
    for (let cookieIndex = 0; cookieIndex < responseCookies.length; cookieIndex += 1) {
      const cookie = responseCookies[cookieIndex];
      const first = __velarServeCall(__velarServeStringSplit, cookie, [";"])[0];
      const separator = __velarServeCall(__velarServeStringIndexOf, first, ["="]);
      if (separator > 0) {
        const name = __velarServeCall(__velarServeStringSlice, first, [0, separator]);
        const content = __velarServeCall(__velarServeStringSlice, first, [separator + 1]);
        if (__velarServeCall(__velarServeStringIncludes, __velarServeCall(__velarServeStringToLowerCase, cookie, []), ["max-age=0"])) __velarServeCall(__velarServeMapDelete, cookies, [name]);
        else __velarServeCall(__velarServeMapSet, cookies, [name, content]);
      }
    }
    let jsonValue = __velarServeMissing;
    let textValue = "";
    if (__velarServeOwnDescriptor(response, "json")) {
      jsonValue = response.json;
      textValue = __velarServeCall(__velarServeWeakMapGet, __velarServeSerializedJson, [response]);
    }
    else if (__velarServeOwnDescriptor(response, "text")) textValue = response.text;
    else {
      const chunks = [];
      let size = 0;
      const result = await response.stream(async chunk => { if (typeof chunk !== "string") throw new __velarServeTypeError("server-test stream chunks must be strings"); size += __velarUtf8ByteLength(chunk); if (size > __velarServeMaxBodyBytes) throw new __velarServeRangeError("server-test response exceeds 16 MiB"); chunks[chunks.length] = chunk; return null; });
      if (result !== null) throw new __velarServeTypeError("ServeResponse.stream producer must resolve to null");
      textValue = __velarServeCall(__velarServeArrayJoin, chunks, [""]);
    }
    return __velarServeCall(__velarServeObjectFreeze, __velarServeObject, [{
      status: response.status,
      headers,
      text: async () => textValue,
      json: async () => jsonValue === __velarServeMissing ? __velarJsonParse(textValue, "server-test response JSON") : jsonValue,
    }]);
  } finally {
    try {
      await __velarServeRunBackground(backgroundTasks);
    } finally {
      if (typeof cleanup === "function") await cleanup();
    }
  }
}

async function __velarServeTestClient(app, overrides = null) {
  if (!__velarServeIsApp(app)) throw new __velarServeTypeError("server-test client requires a ServeApp");
  const appState = __velarServeAppState(app, __velarServeTestOverrides(overrides));
  const cookies = new __velarServeMap();
  let closing = null;
  let closed = null;
  try { await __velarServeRunStartup(app, appState); await __velarServeInitializeEagerProviders(app, __velarServeMaxBodyBytes, appState); }
  catch (error) { try { await __velarServeCleanupAppState(appState); } catch {} try { await __velarServeRunShutdown(app, appState); } catch {} throw error; }
  const request = async (method, target, options = null) => {
    if (closed !== null || closing !== null) throw new __velarServeError("server-test client is closed");
    const incoming = __velarServeTestRequest(method, target, options, cookies);
    return await __velarServeTestResponse(await __velarServeHandleApp(app, incoming, __velarServeMaxBodyBytes, appState), cookies);
  };
  const close = async (grace = __velarServeDefaultShutdownGrace) => {
    if (closed !== null) return closed;
    if (closing !== null) return closing;
    const pending = (async () => {
      try { await __velarServeDrainAppState(appState, grace); }
      catch (error) {
        closed = __velarServeFinishAppAfterDrain(app, appState);
        __velarServeCall(__velarServePromiseThen, closed, [() => null, failure => __velarServeReportFailure(failure)]);
        throw error;
      }
      closed = __velarServeFinishApp(app, appState);
      return await closed;
    })();
    closing = pending;
    try { return await pending; }
    finally { if (closing === pending) closing = null; }
  };
  return __velarServeCall(__velarServeObjectFreeze, __velarServeObject, [{
    request,
    get: (target, options = null) => request("GET", target, options),
    post: (target, options = null) => request("POST", target, options),
    put: (target, options = null) => request("PUT", target, options),
    patch: (target, options = null) => request("PATCH", target, options),
    delete: (target, options = null) => request("DELETE", target, options),
    close,
  }]);
}