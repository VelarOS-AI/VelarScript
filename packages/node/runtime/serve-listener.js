function __velarServeNativeHeaders(request) {
  const output = new __velarServeMap();
  let units = 0;
  for (const [name, value] of __velarServeObject.entries(request.headers)) {
    if (value === undefined) continue;
    const text = __velarServeIsArray(value) ? value.join(", ") : __velarServeString(value);
    units += name.length + text.length;
    if (units > 64 * 1024) throw new __velarServeRangeError("ServeRequest headers cannot exceed 64 KiB");
    output.set(name, text);
  }
  return output;
}

function __velarServeNativeRequest(request, maximum = __velarServeMaxBodyBytes) {
  maximum = __velarServeBodyLimit(maximum);
  const method = request.method ?? "GET";
  if (typeof method !== "string" || !__velarServeCall(__velarServeRegExpTest, __velarServeMethodPattern, [method])) throw new __velarServeTypeError("Native HTTP method is invalid");
  const target = request.url ?? "/";
  if (typeof target !== "string" || target.length === 0 || __velarUtf8ByteLength(target) > 64 * 1024) throw new __velarServeRangeError("Native HTTP request target is too long");
  const targetParts = __velarServeTargetParts(target, "Native HTTP request target");
  const path = targetParts.path;
  const query = __velarServePairsMaps(targetParts.query, "Native ServeRequest.query");
  const cancellation = __velarServeCancellation.__velarCreate();
  let bodyPromise = null;
  let reservedBodyBytes = 0;
  const rawBody = async () => {
    if (bodyPromise === null) bodyPromise = (async () => {
      const chunks = []; let total = 0;
      try {
        for await (const chunk of request) {
          const data = chunk instanceof __velarServeUint8Array ? chunk : __velarServeCall(__velarServeTextEncode, __velarServeUtf8Encoder, [__velarServeString(chunk)]);
          if (total + data.byteLength > maximum) { request.resume(); throw new RequestBodyTooLargeError(maximum); }
          __velarServeReserveOutbound(data.byteLength);
          total += data.byteLength;
          reservedBodyBytes += data.byteLength;
          chunks[chunks.length] = data;
        }
        __velarServeReserveOutbound(total);
        try {
          const output = new __velarServeUint8Array(total);
          let offset = 0;
          for (let index = 0; index < chunks.length; index += 1) { __velarServeCall(__velarServeUint8Set, output, [chunks[index], offset]); offset += chunks[index].byteLength; }
          chunks.length = 0;
          return output;
        }
        finally { __velarServeReleaseOutbound(total); }
      } catch (error) {
        __velarServeReleaseOutbound(reservedBodyBytes);
        reservedBodyBytes = 0;
        throw error;
      }
    })();
    return await bodyPromise;
  };
  const bytes = async (maxBytes = maximum) => {
    if (!__velarServeIsSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > __velarServeMaxBodyBytes) throw new __velarServeRangeError("Request body maxBytes must be an integer from 1 through 16777216");
    const data = await rawBody();
    const effective = maxBytes > maximum ? maximum : maxBytes;
    if (data.byteLength > effective) throw new RequestBodyTooLargeError(effective);
    return data;
  };
  const body = async (maxBytes = maximum) => {
    const data = await bytes(maxBytes);
    try { return __velarServeCall(__velarServeTextDecode, __velarServeUtf8Decoder, [data]); }
    catch { throw new __velarServeTypeError("Request body must be valid UTF-8 text"); }
  };
  const json = async (maxBytes = maximum) => __velarJsonParse(await body(maxBytes), "ServeRequest JSON text");
  return {
    request: __velarServeCall(__velarServeObjectFreeze, __velarServeObject, [{method, path, query: query.values, queryAll: query.all, headers: __velarServeNativeHeaders(request), cancellation, text: body, bytes, json, parse: async (Type, maxBytes = maximum) => { Type = __velarRequireRuntimeType(Type, "ServeRequest.parse"); return Type.parse(await json(maxBytes)); }}]),
    cancellation,
    cleanup() { if (reservedBodyBytes > 0) { __velarServeReleaseOutbound(reservedBodyBytes); reservedBodyBytes = 0; } return null; },
  };
}

function __velarServeNativeSetHeaders(response, headers, cookies = []) {
  const allCookies = [];
  for (const [name, value] of headers) {
    if (__velarServeCall(__velarServeStringToLowerCase, name, []) === "set-cookie") allCookies[allCookies.length] = value;
    else response.setHeader(name, value);
  }
  for (let index = 0; index < cookies.length; index += 1) allCookies[allCookies.length] = cookies[index];
  if (allCookies.length > 0) response.setHeader("Set-Cookie", allCookies);
}
// Every error branch of __velarServeHandleNative answers with a body of its own,
// so it has to start from an empty header set: a content-length staged for the
// response that failed makes the client wait for bytes that will never arrive,
// and a Set-Cookie staged by a handler whose request was never served hands out
// a session for nothing. The isolated-host transport gets this for free — it
// sheds before the host ever sets a header — so this is the native transport
// reaching the same state.
// SV-I1: the listener adapter answers its own refusals in the framework's one
// wire form, so a static miss reads the same through either transport.
function __velarServeNativeProblem(status, reason, title, path) {
  return __velarJsonStringify(__velarServeProblemDocument(__velarServeProblem(status, reason, title), path === null ? null : {path}));
}

function __velarServeNativeResetHeaders(response) {
  const names = response.getHeaderNames();
  for (let index = 0; index < names.length; index += 1) response.removeHeader(names[index]);
}
class __velarServeNativeNotFound extends __velarServeError {}
function __velarServeNativeMissing(error) {
  const code = error?.code;
  return code === "ENOENT" || code === "ENOTDIR" || code === "EISDIR";
}
// A relative path carries .. only as a whole segment, so a bare two-dot prefix
// test also refuses an ordinary top-level file whose own name begins with two
// dots — the same over-strict form the host worker's containment check carried.
// The operations bag has no separator to consult and may come from a bridge
// embedding, so both separators are refused: fail closed on Windows rather than
// trust a default.
function __velarServeNativeEscapes(path, operations) {
  return path === ".." || path.startsWith("../") || path.startsWith("..\\") || operations.isAbsolute(path);
}
async function __velarServeNativeFile(value, operations) {
  let root;
  // A static root that does not exist is the same miss as a file that does not
  // exist: reporting it as a failure would answer 500 and write the absolute
  // deployment path to stderr, which the host transport never does.
  try { root = await operations.realpath(operations.resolve(value.root)); }
  catch (error) { if (__velarServeNativeMissing(error)) throw new __velarServeNativeNotFound("fileResponse root does not name a directory"); throw error; }
  const load = async path => {
    let target;
    try { target = await operations.realpath(operations.resolve(root, path.startsWith("/") ? "." + path : path)); }
    catch (error) { if (__velarServeNativeMissing(error)) throw new __velarServeNativeNotFound("fileResponse path does not name a file"); throw error; }
    const relative = operations.relative(root, target);
    if (__velarServeNativeEscapes(relative, operations)) throw new __velarServeNativeNotFound("fileResponse path escapes its root");
    let info;
    try { info = await operations.stat(target); }
    catch (error) { if (__velarServeNativeMissing(error)) throw new __velarServeNativeNotFound("fileResponse path does not name a file"); throw error; }
    if (!info.isFile()) throw new __velarServeNativeNotFound("fileResponse path does not name a file");
    if (info.size > 64 * 1024 * 1024) throw new __velarServeRangeError("fileResponse file exceeds 64 MiB");
    return {target, info};
  };
  try { return await load(value.path); } catch (error) { if (value.fallback === null) throw error; return load(value.fallback); }
}
function __velarServeNativeContentType(path, operations) {
  if (typeof operations.extname !== "function") return "application/octet-stream";
  const extension = operations.extname(path).toLowerCase();
  return ({".css":"text/css; charset=utf-8",".gif":"image/gif",".html":"text/html; charset=utf-8",".ico":"image/x-icon",".jpeg":"image/jpeg",".jpg":"image/jpeg",".js":"text/javascript; charset=utf-8",".json":"application/json; charset=utf-8",".map":"application/json; charset=utf-8",".mjs":"text/javascript; charset=utf-8",".png":"image/png",".svg":"image/svg+xml",".txt":"text/plain; charset=utf-8",".wasm":"application/wasm",".webp":"image/webp",".woff":"font/woff",".woff2":"font/woff2"})[extension] ?? "application/octet-stream";
}
async function __velarServeNativeSendFile(request, response, value, operations, path = null) {
  const file = await __velarServeNativeFile(value, operations);
  const modified = __velarServeCall(__velarServeMathFloor, __velarServeMath, [file.info.mtimeMs]);
  const etag = 'W/"' + __velarServeCall(__velarServeNumberToString, file.info.size, [16]) + "-" + __velarServeCall(__velarServeNumberToString, modified, [16]) + '"';
  response.setHeader("content-type", __velarServeNativeContentType(file.target, operations));
  response.setHeader("accept-ranges", "bytes");
  response.setHeader("etag", etag);
  response.setHeader("last-modified", file.info.mtime.toUTCString());
  const noneMatch = request.headers["if-none-match"];
  const modifiedSince = request.headers["if-modified-since"];
  if (typeof noneMatch === "string" && noneMatch.split(",").some(item => item.trim() === "*" || item.trim() === etag)
    || typeof noneMatch !== "string" && typeof modifiedSince === "string" && __velarServeCall(__velarServeNumberIsFinite, __velarServeNumber, [__velarServeCall(__velarServeDateParse, __velarServeDate, [modifiedSince])])
      && __velarServeCall(__velarServeMathFloor, __velarServeMath, [file.info.mtimeMs / 1000]) * 1000 <= __velarServeCall(__velarServeDateParse, __velarServeDate, [modifiedSince])) {
    response.statusCode = 304;
    return __velarServeNativeEnd(response);
  }
  let start = 0;
  let end = file.info.size - 1;
  let range = request.headers.range;
  const ifRange = request.headers["if-range"];
  if (typeof range === "string" && typeof ifRange === "string" && ifRange !== etag) {
    const time = __velarServeCall(__velarServeDateParse, __velarServeDate, [ifRange]);
    if (!__velarServeCall(__velarServeNumberIsFinite, __velarServeNumber, [time]) || __velarServeCall(__velarServeMathFloor, __velarServeMath, [file.info.mtimeMs / 1000]) * 1000 > time) range = undefined;
  }
  if (typeof range === "string") {
    const match = /^bytes=(\d*)-(\d*)$/u.exec(range.trim());
    if (!match || match[1] === "" && match[2] === "" || file.info.size === 0) {
      response.statusCode = 416; response.setHeader("content-range", "bytes */" + file.info.size); response.setHeader("content-type", "application/problem+json; charset=utf-8"); return __velarServeNativeEnd(response, request.method === "HEAD" ? undefined : __velarServeNativeProblem(416, "static.range_not_satisfiable", "Range not satisfiable", path));
    }
    if (match[1] === "") { const suffix = __velarServeCall(__velarServeNumber, undefined, [match[2]]); if (!__velarServeCall(__velarServeNumberIsSafeInteger, __velarServeNumber, [suffix]) || suffix < 1) { response.statusCode = 416; response.setHeader("content-range", "bytes */" + file.info.size); return __velarServeNativeEnd(response); } start = __velarServeCall(__velarServeMathMax, __velarServeMath, [0, file.info.size - suffix]); }
    else { start = __velarServeCall(__velarServeNumber, undefined, [match[1]]); end = match[2] === "" ? end : __velarServeCall(__velarServeNumber, undefined, [match[2]]); }
    if (!__velarServeCall(__velarServeNumberIsSafeInteger, __velarServeNumber, [start]) || !__velarServeCall(__velarServeNumberIsSafeInteger, __velarServeNumber, [end]) || start < 0 || start >= file.info.size || end < start) { response.statusCode = 416; response.setHeader("content-range", "bytes */" + file.info.size); return __velarServeNativeEnd(response); }
    if (end >= file.info.size) end = file.info.size - 1;
    response.statusCode = 206;
    response.setHeader("content-range", "bytes " + start + "-" + end + "/" + file.info.size);
  } else response.statusCode = 200;
  response.setHeader("content-length", __velarServeCall(__velarServeMathMax, __velarServeMath, [0, end - start + 1]));
  if (request.method === "HEAD") return __velarServeNativeEnd(response);
  if (typeof operations.createReadStream !== "function") {
    const data = await operations.readFile(file.target);
    if (!(data instanceof __velarServeUint8Array) || data.byteLength > 64 * 1024 * 1024) throw new __velarServeRangeError("fileResponse file exceeds 64 MiB");
    return __velarServeWithOutbound(end - start + 1, () => __velarServeNativeEnd(response, data.subarray(start, end + 1)));
  }
  const source = operations.createReadStream(file.target, {start, end, highWaterMark: 64 * 1024});
  try { for await (const chunk of source) await __velarServeWithOutbound(chunk.byteLength, () => __velarServeNativeWrite(response, chunk)); }
  finally { source.destroy(); }
  return __velarServeNativeEnd(response);
}
async function __velarServeNativeEnd(response, value) { await new __velarServePromise((resolve, reject) => { response.once("error", reject); response.end(value, () => { response.off("error", reject); resolve(null); }); }); }
async function __velarServeNativeWrite(response, value) { if (response.write(value)) return; await new __velarServePromise((resolve, reject) => { const failed = error => { response.off("drain", ready); reject(error); }; const ready = () => { response.off("error", failed); resolve(null); }; response.once("error", failed); response.once("drain", ready); }); }
async function __velarServeNativeBody(response, value, checked, suppressBody, operations) {
  if (suppressBody) return __velarServeNativeEnd(response);
  const bytes = typeof value === "string" ? __velarUtf8ByteLength(value) : value.byteLength;
  if (checked.compression == null || typeof operations.compress !== "function") return __velarServeWithOutbound(bytes, () => __velarServeNativeEnd(response, value));
  const compressed = await __velarServeWithOutbound(bytes * 2, () => operations.compress(checked.compression, value));
  if (!(compressed instanceof __velarServeUint8Array) || compressed.byteLength > __velarServeMaxBodyBytes) throw new __velarServeRangeError("Compressed ServeResponse exceeds 16 MiB");
  response.setHeader("content-encoding", checked.compression);
  if (!response.hasHeader("vary")) response.setHeader("vary", "Accept-Encoding");
  return __velarServeWithOutbound(compressed.byteLength, () => __velarServeNativeEnd(response, compressed));
}
async function __velarServeHandleNative(handler, request, response, operations, maxBodyBytes = __velarServeMaxBodyBytes) {
  let cleanup = null;
  let backgroundTasks = null;
  let incoming = null;
  let disconnected = null;
  try {
    incoming = __velarServeNativeRequest(request, maxBodyBytes);
    disconnected = () => { if (!response.writableFinished) __velarServeCancellation.__velarCancel(incoming.cancellation, "client_disconnect"); };
    request.once("aborted", disconnected);
    response.once("close", disconnected);
    let value = await handler(incoming.request);
    const managed = value && typeof value === "object" ? __velarServeOwnDescriptor(value, __velarServeManagedResponseMarker) : null;
    if (managed?.enumerable === true && "value" in managed && managed.value === true) { cleanup = value.cleanup; value = value.response; }
    if (__velarServeIsFileResponse(value)) { __velarServeNativeSetHeaders(response, __velarServeResponseHeaders(value.headers)); await __velarServeNativeSendFile(request, response, value, operations, incoming.request.path); return null; }
    const checked = __velarServeResponse(value); backgroundTasks = checked.background ?? null; response.statusCode = checked.status; __velarServeNativeSetHeaders(response, __velarServeResponseHeaders(checked.headers), __velarServeCookies(checked));
    const suppressBody = request.method === "HEAD" || checked.status >= 100 && checked.status < 200 || checked.status === 204 || checked.status === 304;
    if (__velarServeOwnDescriptor(checked, "json")) { if (request.method === "HEAD" || !suppressBody) response.setHeader("content-type", checked.contentType ?? "application/json; charset=utf-8"); await __velarServeNativeBody(response, __velarServeCall(__velarServeWeakMapGet, __velarServeSerializedJson, [checked]), checked, suppressBody, operations); return null; }
    if (__velarServeOwnDescriptor(checked, "text")) { if (request.method === "HEAD" || !suppressBody) response.setHeader("content-type", checked.contentType ?? "text/plain; charset=utf-8"); await __velarServeNativeBody(response, checked.text, checked, suppressBody, operations); return null; }
    let writing = false;
    const write = async chunk => { if (writing) throw new __velarServeError("ServeResponse allows only one active stream write"); writing = true; try { if (typeof chunk !== "string" || __velarUtf8ByteLength(chunk) > 1024 * 1024) throw new __velarServeTypeError("ServeResponse.stream chunks must be text of at most 1 MiB"); if (!suppressBody) await __velarServeWithOutbound(__velarUtf8ByteLength(chunk), () => __velarServeNativeWrite(response, chunk)); return null; } finally { writing = false; } };
    const result = await checked.stream(write); if (result !== null) throw new __velarServeTypeError("ServeResponse.stream producer must resolve to null"); if (writing) throw new __velarServeError("ServeResponse stream producer returned before its write completed"); await __velarServeNativeEnd(response); return null;
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError && !response.headersSent) {
      __velarServeNativeResetHeaders(response);
      response.statusCode = 413;
      response.setHeader("content-type", "application/json; charset=utf-8");
      response.end(request.method === "HEAD" ? undefined : '{"error":"request_too_large"}');
      return null;
    }
    if (error instanceof __velarServeNativeNotFound && !response.headersSent) {
      // SV-I1: the two transports answer a static miss with one wire form.
      __velarServeNativeResetHeaders(response);
      response.statusCode = 404;
      response.setHeader("content-type", "application/problem+json; charset=utf-8");
      response.end(request.method === "HEAD" ? undefined : __velarServeNativeProblem(404, "static.not_found", "Not found", incoming === null ? null : incoming.request.path));
      return null;
    }
    if (error instanceof __velarServeOutboundBudgetError && !response.headersSent) {
      __velarServeNativeResetHeaders(response);
      response.statusCode = 503;
      response.setHeader("retry-after", "1");
      response.setHeader("content-type", "application/json; charset=utf-8");
      response.end(request.method === "HEAD" ? undefined : '{"error":"outbound_budget_exhausted"}');
      return null;
    }
    __velarServeReportFailure(error);
    if (!response.headersSent) { __velarServeNativeResetHeaders(response); response.statusCode = 500; response.setHeader("content-type", "application/problem+json; charset=utf-8"); response.end(__velarServeNativeProblem(500, "server.internal", "Internal server error", incoming === null ? null : incoming.request.path)); }
    else response.destroy();
    return null;
  }
  finally {
    if (disconnected !== null) { request.off("aborted", disconnected); response.off("close", disconnected); }
    await __velarServeRunBackground(backgroundTasks);
    if (typeof cleanup === "function") { try { await cleanup(); } catch (error) { __velarServeReportFailure(error); } }
    if (incoming !== null) incoming.cleanup();
  }
}