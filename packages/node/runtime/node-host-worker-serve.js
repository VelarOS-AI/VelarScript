function opaqueFailure(task) {
  if (task.response.headersSent) task.response.destroy();
  else {
    task.response.statusCode = 500;
    task.response.setHeader("Content-Type", "application/problem+json; charset=utf-8");
    task.response.end(task.request.method === "HEAD" ? undefined : serveProblemBody(500, "server.internal", "Internal server error", task.path));
  }
  completeRequest(task);
}

function responseHasNoBody(task, status) {
  return task.request.method === "HEAD" || status >= 100 && status < 200 || status === 204 || status === 304;
}

async function shedServeResponse(task) {
  task.response.statusCode = 503;
  task.response.setHeader("Retry-After", "1");
  task.response.setHeader("Content-Type", "application/json; charset=utf-8");
  await endServeResponse(task, responseHasNoBody(task, 503) ? undefined : '{"error":"outbound_budget_exhausted"}');
  completeRequest(task);
  return null;
}

async function endServeResponse(task, value) {
  await new Promise((resolveEnd, rejectEnd) => {
    let settled = false;
    const cleanup = () => {
      task.response.off("error", failed);
      task.response.off("close", closed);
    };
    const finish = action => { if (settled) return; settled = true; cleanup(); action(); };
    const failed = error => finish(() => rejectEnd(error));
    const closed = () => finish(() => task.response.writableFinished ? resolveEnd(null) : rejectEnd(new Error("ServeResponse client connection is closed")));
    task.response.once("error", failed);
    task.response.once("close", closed);
    task.response.end(value, () => finish(() => resolveEnd(null)));
    if (task.response.destroyed && !task.response.writableFinished) closed();
  });
}

function rawBodyOf(task, maximum) {
  if (task.body !== null) return task.body;
  task.body = (async () => {
    const declaredText = task.request.headers["content-length"];
    let declared = null;
    if (typeof declaredText === "string" && /^[0-9]+$/u.test(declaredText)) {
      declared = Number(declaredText);
      if (!Number.isSafeInteger(declared) || declared > maximum) {
        task.request.resume();
        return {data: null, bytes: maximum, tooLarge: true};
      }
    }
    // A declared Content-Length is a client claim, not a delivered body, so it
    // buys no allocation and no budget reservation up front: a header-only
    // socket that declares 16 MiB and sends nothing would otherwise spend the
    // process-global aggregate budget for the whole request timeout. The
    // declaration is only the effective ceiling; the bytes that actually arrive
    // are charged as they arrive.
    const limit = declared === null ? maximum : declared;
    const chunks = [];
    let total = 0;
    try {
      for await (const chunk of task.request) {
        const data = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
        if (total + data.byteLength > limit) {
          task.request.resume();
          releaseServeBytes(task, total);
          return {data: null, bytes: maximum, tooLarge: true};
        }
        reserveServeBytes(task, data.byteLength);
        total += data.byteLength;
        chunks.push(data);
      }
      if (declared !== null && total !== declared) throw new TypeError("Request body length does not match Content-Length");
      reserveTransientServeBytes(total);
      try { return {data: Buffer.concat(chunks, total), bytes: total, tooLarge: false}; }
      finally { releaseTransientServeBytes(total); }
    } catch (error) {
      releaseServeBytes(task, total);
      throw error;
    }
  })();
  return task.body;
}

async function bodyOf(task, maximum) {
  const value = await rawBodyOf(task, maximum);
  if (value.tooLarge) return {text: null, bytes: value.bytes, tooLarge: true};
  try { return {text: new TextDecoder("utf-8", {fatal: true, ignoreBOM: true}).decode(value.data), bytes: value.bytes, tooLarge: false}; }
  catch { throw new TypeError("Request body must be valid UTF-8 text"); }
}

async function bodyBytesOf(task, maximum) {
  const value = await rawBodyOf(task, maximum);
  return value.tooLarge
    ? {data: null, bytes: value.bytes, tooLarge: true}
    : {data: new Uint8Array(value.data.buffer, value.data.byteOffset, value.data.byteLength), bytes: value.bytes, tooLarge: false};
}

function canonicalServePath(rawPath) {
  const source = rawPath.split("/");
  const decoded = new Array(source.length);
  let units = 0;
  for (let index = 0; index < source.length; index += 1) {
    let segment;
    try { segment = decodeURIComponent(source[index]); }
    catch { throw new TypeError("Request path is not valid percent-encoded UTF-8"); }
    if (segment.includes("/") || segment.includes("\\") || segment.includes("\0") || segment === "." || segment === "..") {
      throw new TypeError("Request path contains an unsafe encoded segment");
    }
    units += segment.length + (index === 0 ? 0 : 1);
    if (units > maxPathCodeUnits) throw new RangeError("Request target path is too long");
    decoded[index] = segment;
  }
  const path = decoded.join("/");
  if (!path.startsWith("/")) throw new TypeError("Request target must use an absolute path");
  return path;
}

function serveHeaderPairs(request) {
  const headers = [];
  let bytes = 0;
  for (const [name, value] of Object.entries(request.headers)) {
    if (typeof value !== "string" && !Array.isArray(value)) continue;
    const text = typeof value === "string" ? value : value.join(", ");
    bytes += Buffer.byteLength(name, "utf8") + Buffer.byteLength(text, "utf8");
    if (bytes > maxServeHeaderTextBytes || headers.length >= maxServeQueryFields) throw new RequestHeadersTooLarge("Request headers are too large");
    headers.push([name, text]);
  }
  return {headers, bytes};
}

function serveQueryPairs(source) {
  const query = [];
  let bytes = 0;
  if (source === "") return {query, bytes};
  const fields = source.split("&");
  if (fields.length > maxServeQueryFields) throw new RangeError("Request query is too large");
  for (const field of fields) {
    const separator = field.indexOf("=");
    const rawName = separator < 0 ? field : field.slice(0, separator);
    const rawValue = separator < 0 ? "" : field.slice(separator + 1);
    let name;
    let value;
    try {
      name = decodeURIComponent(rawName.replaceAll("+", " "));
      value = decodeURIComponent(rawValue.replaceAll("+", " "));
    } catch { throw new TypeError("Request query is not valid percent-encoded UTF-8"); }
    bytes += Buffer.byteLength(name, "utf8") + Buffer.byteLength(value, "utf8");
    if (bytes > maxServeRequestTargetBytes) throw new RangeError("Request query is too large");
    query.push([name, value]);
  }
  return {query, bytes};
}

function rejectIncomingRequest(request, response, status, message) {
  response.statusCode = status;
  response.setHeader("Connection", "close");
  response.setHeader("Content-Type", "text/plain; charset=utf-8");
  response.end(message);
  request.resume();
}

// SV-I1: one wire form for a framework rejection. Once the request line and its
// headers are parsed the request exists, so a refusal is the same problem
// document the application layer and openapi() publish — same field order, same
// media type. Only a transport preflight failure, where there is no request to
// describe yet, stays the one-line text/plain answer above.
function serveProblemBody(status, code, title, instance) {
  const output = {type: "about:blank", title, status, code};
  if (typeof instance === "string" && instance.length > 0) output.instance = instance;
  return JSON.stringify(output);
}

function rejectIncomingProblem(request, response, status, code, title, instance) {
  response.statusCode = status;
  response.setHeader("Connection", "close");
  response.setHeader("Content-Type", "application/problem+json; charset=utf-8");
  response.end(request.method === "HEAD" ? undefined : serveProblemBody(status, code, title, instance));
  request.resume();
}

function incomingRequest(server, request, response) {
  if (server.stopping) { rejectIncomingRequest(request, response, 503, "Service unavailable"); return; }
  if (requests.size >= maxRequests) { rejectIncomingRequest(request, response, 503, "Service unavailable"); return; }
  const target = request.url ?? "/";
  if (typeof target !== "string" || target.length === 0 || !target.startsWith("/") || Buffer.byteLength(target, "utf8") > maxServeRequestTargetBytes || target.includes("\0")) {
    rejectIncomingRequest(request, response, 414, "Request target too long"); return;
  }
  let path;
  let headerResult;
  let queryResult;
  try {
    if (target.includes("#")) throw new TypeError("Request target must not contain a URL fragment");
    const separator = target.indexOf("?");
    path = canonicalServePath(separator < 0 ? target : target.slice(0, separator));
    headerResult = serveHeaderPairs(request);
    queryResult = serveQueryPairs(separator < 0 ? "" : target.slice(separator + 1));
  } catch (error) {
    const status = error instanceof RequestHeadersTooLarge ? 431 : error instanceof RangeError ? 414 : 400;
    // A 400 here means the target parsed and its path is not a path: dot
    // segments, an encoded separator, a NUL, a bad percent escape, or bytes that
    // are not UTF-8. That is a request, so it is answered as a problem document.
    if (status === 400) rejectIncomingProblem(request, response, 400, "request.invalid.path", "Malformed request input", null);
    else rejectIncomingRequest(request, response, status, status === 431 ? "Request headers too large" : "Request target too long");
    return;
  }
  const declaredText = request.headers["content-length"];
  if (typeof declaredText === "string" && /^[0-9]+$/u.test(declaredText)) {
    const declared = Number(declaredText);
    if (!Number.isSafeInteger(declared) || declared > maxServeBodyBytes) {
      rejectIncomingProblem(request, response, 413, "request.request.too.large", "Request input is too large", path);
      return;
    }
  }
  const handle = allocateHandle(requests, nextRequestHandle, maxRequests, "Node serve request");
  nextRequestHandle = advanceHandle(handle);
  const task = {
    handle, token: server.token, server: server.handle, request, response, path, body: null, streamBytes: 0, responseMode: "idle", writeActive: false, suppressBody: false,
    reservedBytes: 0, completed: false, abandoned: false, cancelled: false, transportDone: false, activeOperations: 0,
  };
  const metadataBytes = (Buffer.byteLength(target, "utf8") + headerResult.bytes + queryResult.bytes + Buffer.byteLength(path, "utf8") + 256) * 2;
  if (metadataBytes > maxServeRequestMetadataBytes) { rejectIncomingRequest(request, response, 431, "Request metadata too large"); return; }
  try { reserveServeBytes(task, metadataBytes); }
  catch { rejectIncomingRequest(request, response, 503, "Service unavailable"); return; }
  requests.set(handle, task);
  request.once("aborted", () => cancelRequest(task));
  response.once("finish", () => closeRequest(task, false));
  response.once("close", () => closeRequest(task, !response.writableFinished));
  port.postMessage({kind: "event", event: "serve.request", value: {
    token: server.token,
    request: handle,
    method: request.method ?? "GET",
    path,
    query: queryResult.query,
    headers: headerResult.headers,
  }});
}

async function startServer(args) {
  if (args.length !== 3 || servers.size >= maxServers) throw new RangeError("Node serve server limit reached");
  const token = integer(args[0], 1, Number.MAX_SAFE_INTEGER, "Node serve token");
  const portValue = integer(args[1], 0, 65535, "serve port");
  const host = boundedHost(args[2]);
  const handle = allocateHandle(servers, nextServerHandle, maxServers, "Node serve server");
  nextServerHandle = advanceHandle(handle);
  const task = {handle, token, server: null, sockets: new Set(), stopping: false, stopPromise: null};
  const server = createServer({
    maxHeaderSize: maxServeHeaderTextBytes,
    headersTimeout: serveHeadersTimeoutMilliseconds,
    requestTimeout: serveRequestTimeoutMilliseconds,
    keepAliveTimeout: serveKeepAliveTimeoutMilliseconds,
    connectionsCheckingInterval: 1000,
  }, (request, response) => incomingRequest(task, request, response));
  task.server = server;
  server.maxConnections = maxServeSocketsPerServer;
  server.maxRequestsPerSocket = 1000;
  server.on("connection", socket => {
    if (task.stopping || task.sockets.size >= maxServeSocketsPerServer || activeServeSockets >= maxServeSockets) {
      socket.destroy();
      return;
    }
    task.sockets.add(socket);
    activeServeSockets += 1;
    socket.setNoDelay(true);
    socket.setKeepAlive(true, serveKeepAliveTimeoutMilliseconds);
    socket.once("close", () => {
      if (!task.sockets.delete(socket)) return;
      activeServeSockets -= 1;
      if (activeServeSockets < 0) activeServeSockets = 0;
    });
  });
  servers.set(handle, task);
  try {
    await new Promise((resolveListen, rejectListen) => {
      const failed = error => { server.off("listening", ready); rejectListen(error); };
      const ready = () => { server.off("error", failed); resolveListen(); };
      server.once("error", failed);
      server.once("listening", ready);
      server.listen({port: portValue, host});
    });
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("velar/serve could not determine the bound port");
    server.on("error", error => {
      if (task.stopping) return;
      const failure = errorRecord(error);
      try { port.postMessage({kind: "event", event: "serve.error", value: {token, message: failure.message}}); }
      catch {}
    });
    return {handle, port: address.port};
  } catch (error) {
    if (servers.get(handle) === task) servers.delete(handle);
    try { server.close(); } catch {}
    throw error;
  }
}

async function stopServer(args) {
  if (args.length < 1 || args.length > 2) throw new TypeError("serve.stop arguments are invalid");
  const handle = integer(args[0], 1, Number.MAX_SAFE_INTEGER, "Node serve server handle");
  const grace = args.length === 2 ? integer(args[1], 1, 120_000, "serve stop grace") : serveShutdownTimeoutMilliseconds;
  const task = servers.get(handle);
  if (!task) return null;
  if (task.stopPromise !== null) return await task.stopPromise;
  task.stopping = true;
  for (const request of requests.values()) if (request.server === handle && !request.completed) {
    request.response.shouldKeepAlive = false;
    if (!request.response.headersSent) request.response.setHeader("Connection", "close");
    cancelRequest(request, "server_stopping");
  }
  const pending = (async () => {
    await new Promise((resolveStop, rejectStop) => {
      let settled = false;
      let forceTimer = null;
      let finalTimer = null;
      const finish = action => {
        if (settled) return;
        settled = true;
        if (forceTimer !== null) clearTimeout(forceTimer);
        if (finalTimer !== null) clearTimeout(finalTimer);
        action();
      };
      task.server.close(error => error ? finish(() => rejectStop(error)) : finish(() => resolveStop(null)));
      task.server.closeIdleConnections?.();
      forceTimer = setTimeout(() => {
        try { task.server.closeAllConnections?.(); } catch {}
        for (const socket of task.sockets) try { socket.destroy(); } catch {}
        finalTimer = setTimeout(() => finish(() => rejectStop(new Error("Node serve transport did not stop within its graceful shutdown deadline"))), 1000);
        finalTimer.unref?.();
      }, grace);
      forceTimer.unref?.();
    });
    if (servers.get(handle) === task) servers.delete(handle);
    return null;
  })();
  task.stopPromise = pending;
  try { return await pending; }
  catch (error) { if (task.stopPromise === pending) { task.stopPromise = null; task.stopping = false; } throw error; }
}

async function dispatch(operation, args) {
  if (!operations.has(operation) || !Array.isArray(args)) throw new TypeError("Node host request is invalid");
  if (operation === "http.request") return startHttpRequest(args);
  if (operation === "http.read") return readHttpRequest(args);
  if (operation === "http.readBytes") return readHttpRequest(args, true);
  if (operation === "http.cancel") {
    if (args.length !== 2 || args[1] !== "cancelled" && args[1] !== "timeout") throw new TypeError("http.cancel arguments are invalid");
    const handle = integer(args[0], 1, Number.MAX_SAFE_INTEGER, "Node HTTP request handle");
    const task = httpRequests.get(handle);
    return task ? releaseHttpRequest(task, args[1]) : false;
  }
  if (operation === "http.close") {
    if (args.length !== 1) throw new TypeError("http.close arguments are invalid");
    const handle = integer(args[0], 1, Number.MAX_SAFE_INTEGER, "Node HTTP request handle");
    const task = httpRequests.get(handle);
    return task ? releaseHttpRequest(task, null) : false;
  }
  if (operation === "fs.readFile") {
    if (args.length !== 3 || args[2] !== "readText" && args[2] !== "readBytes") throw new TypeError("fs.readFile arguments are invalid");
    return regularFile(boundedPath(args[0], args[2]), args[2], byteLimit(args[1], args[2]));
  }
  if (operation === "fs.createFile") {
    if (args.length !== 2 && args.length !== 3 || args.length === 3 && args[2] !== "createBytes") throw new TypeError("fs.createFile arguments are invalid");
    const name = args.length === 3 ? "createBytes" : "createText";
    const path = boundedPath(args[0], name);
    const data = byteArray(args[1], name);
    return withFileMutations([path], async () => {
      try { await writeFile(path, data, {flag: "wx"}); }
      catch (error) {
        if (error && typeof error === "object" && error.code === "EEXIST") throw new AlreadyExists(name, path);
        throw error;
      }
      return null;
    });
  }
  if (operation === "fs.replaceFileIfMatches") {
    if (args.length !== 3) throw new TypeError("fs.replaceFileIfMatches arguments are invalid");
    const requestedPath = boundedPath(args[0], "replaceTextIfMatches");
    const expected = byteArray(args[1], "replaceTextIfMatches expected text");
    const replacement = byteArray(args[2], "replaceTextIfMatches replacement text");
    return withFileMutations([requestedPath], async () => {
      const path = await realpath(requestedPath);
      const metadata = await stat(path);
      if (!metadata.isFile()) throw new TypeError("replaceTextIfMatches requires a file path");
      if (metadata.size > maxFileBytes) throw new RangeError("replaceTextIfMatches file exceeds 16 MiB");
      const current = await readFile(path);
      if (current.byteLength > maxFileBytes) throw new RangeError("replaceTextIfMatches file exceeds 16 MiB");
      if (!equalBytes(current, expected)) return false;
      await commitTextReplacement(path, replacement, metadata.mode);
      return true;
    });
  }
  if (operation === "fs.writeFile" || operation === "fs.appendFile") {
    if (args.length !== 2 && args.length !== 3 || args.length === 3 && (operation !== "fs.writeFile" || args[2] !== "writeBytes")) throw new TypeError(operation + " arguments are invalid");
    const name = args.length === 3 ? "writeBytes" : operation === "fs.writeFile" ? "writeText" : "appendText";
    const path = boundedPath(args[0], name);
    const data = byteArray(args[1], name);
    return withFileMutations([path], async () => {
      let metadata = null;
      try { metadata = await stat(path); }
      catch (error) { if (!missing(error)) throw error; }
      if (metadata && !metadata.isFile()) throw new TypeError(name + " requires a file path");
      if (operation === "fs.appendFile" && metadata && metadata.size > maxFileBytes - data.byteLength) {
        throw new RangeError("appendText result cannot exceed 16 MiB");
      }
      if (operation === "fs.writeFile") await writeFile(path, data);
      else await appendFile(path, data);
      return null;
    });
  }
  if (operation === "fs.exists") {
    if (args.length !== 1) throw new TypeError("fs.exists arguments are invalid");
    try { await stat(boundedPath(args[0], "exists")); return true; }
    catch (error) { if (missing(error)) return false; throw error; }
  }
  if (operation === "fs.list") {
    if (args.length !== 2) throw new TypeError("fs.list arguments are invalid");
    const path = boundedPath(args[0], "list");
    const maximum = args[1];
    if (!Number.isSafeInteger(maximum) || maximum < 1 || maximum > maxListItems) {
      throw new RangeError("list maxItems must be an integer from 1 through 100000");
    }
    const names = await readdir(path);
    if (names.length > maximum) throw new RangeError("list result exceeds maxItems");
    let units = 0;
    for (const name of names) {
      if (typeof name !== "string") throw new TypeError("list host result must contain text names");
      units += name.length;
      if (units > maxListCodeUnits) throw new RangeError("list result cannot exceed 2 MiB of text");
    }
    names.sort();
    return names;
  }
  if (operation === "fs.info") {
    if (args.length !== 1) throw new TypeError("fs.info arguments are invalid");
    const path = boundedPath(args[0], "info");
    let metadata;
    try { metadata = await lstat(path); }
    catch (error) { if (missing(error)) return null; throw error; }
    const kind = metadata.isFile() ? "file" : metadata.isDirectory() ? "directory" : metadata.isSymbolicLink() ? "symlink" : "other";
    return {name: basename(path), kind, size: metadata.size, modifiedAt: metadata.mtimeMs};
  }
  if (operation === "fs.canonical") {
    if (args.length !== 1) throw new TypeError("fs.canonical arguments are invalid");
    return realpath(boundedPath(args[0], "canonical"));
  }
  if (operation === "fs.makeDirectory") {
    if (args.length !== 1) throw new TypeError("fs.makeDirectory arguments are invalid");
    await mkdir(boundedPath(args[0], "makeDirectory"), {recursive: true});
    return null;
  }
  if (operation === "fs.copyFile") {
    if (args.length !== 3) throw new TypeError("fs.copyFile arguments are invalid");
    const source = boundedPath(args[0], "copyFile");
    const target = boundedPath(args[1], "copyFile");
    const replace = boolean(args[2], "copyFile");
    if (!(await stat(source)).isFile()) throw new TypeError("copyFile requires a regular file source");
    return withFileMutations([target], async () => {
      if (!replace) await absent(target, "copyFile");
      await copyFile(source, target);
      return null;
    });
  }
  if (operation === "fs.move") {
    if (args.length !== 3) throw new TypeError("fs.move arguments are invalid");
    const source = boundedPath(args[0], "move");
    const target = boundedPath(args[1], "move");
    const replace = boolean(args[2], "move");
    return withFileMutations([source, target], async () => {
      if (!replace) await absent(target, "move");
      else await rm(target, {force: true, recursive: false});
      await rename(source, target);
      return null;
    });
  }
  if (operation === "fs.removeFile") {
    if (args.length !== 1) throw new TypeError("fs.removeFile arguments are invalid");
    const path = boundedPath(args[0], "removeFile");
    return withFileMutations([path], async () => {
      if ((await lstat(path)).isDirectory()) throw new TypeError("removeFile refuses directories");
      await rm(path, {force: false, recursive: false});
      return null;
    });
  }
  if (operation === "fs.watchStart") return startFileWatch(args);
  if (operation === "fs.watchNext") return nextFileWatch(args);
  if (operation === "fs.watchClose") return closeFileWatchHandle(args);
  if (operation === "serve.start") return startServer(args);
  if (operation === "serve.stop") return stopServer(args);
  if (operation === "serve.body") {
    if (args.length !== 2) throw new TypeError("serve.body arguments are invalid");
    const task = requestHandle(args[0]);
    return withRequest(task, async () => {
      const maximum = integer(args[1], 1, maxServeBodyBytes, "Request body maxBytes");
      return bodyOf(task, maximum);
    });
  }
  if (operation === "serve.bodyBytes") {
    if (args.length !== 2) throw new TypeError("serve.bodyBytes arguments are invalid");
    const task = requestHandle(args[0]);
    return withRequest(task, async () => {
      const maximum = integer(args[1], 1, maxServeBodyBytes, "Request body maxBytes");
      return bodyBytesOf(task, maximum);
    });
  }
  if (operation === "serve.readFile") {
    if (args.length !== 3) throw new TypeError("serve.readFile arguments are invalid");
    return testStaticFile(args[0], args[1], args[2]);
  }
  if (operation === "serve.respond") {
    if (args.length !== 8) throw new TypeError("serve.respond arguments are invalid");
    const task = requestHandle(args[0]);
    return withTerminalResponse(task, async () => {
      const status = integer(args[1], 200, 599, "ServeResponse.status");
      const headers = headerPairs(args[2]);
      const kind = args[3];
      const body = args[4];
      const contentType = args[5];
      const compression = args[6];
      const cookies = cookieValues(args[7]);
      if (kind !== "json" && kind !== "text" || typeof body !== "string" || Buffer.byteLength(body, "utf8") > maxServeBodyBytes) {
        throw new TypeError("ServeResponse body is invalid");
      }
      if (contentType !== null && (typeof contentType !== "string" || contentType.length === 0 || contentType.length > 1024 || /[\0\r\n]/u.test(contentType))) {
        throw new TypeError("ServeResponse.contentType must be bounded single-line text");
      }
      if (compression !== null && compression !== "gzip" && compression !== "br") throw new TypeError("ServeResponse compression is invalid");
      const suppressBody = responseHasNoBody(task, status);
      let output = body;
      try {
        if (!suppressBody && compression !== null) {
          const inputBytes = Buffer.byteLength(body, "utf8");
          reserveTransientServeBytes(inputBytes * 2);
          try { output = await (compression === "br" ? brotliCompress(body) : gzip(body)); }
          finally { releaseTransientServeBytes(inputBytes * 2); }
          if (output.byteLength > maxServeBodyBytes) throw new RangeError("Compressed ServeResponse exceeds 16 MiB");
        }
        if (!suppressBody) reserveServeBytes(task, typeof output === "string" ? Buffer.byteLength(output, "utf8") : output.byteLength);
      } catch (error) {
        if (!(error instanceof ServeBudgetError)) throw error;
        return await shedServeResponse(task);
      }
      task.response.statusCode = status;
      setHeaders(task.response, headers, cookies);
      if (!task.response.hasHeader("Content-Type") && (task.request.method === "HEAD" || !suppressBody)) {
        task.response.setHeader("Content-Type", contentType ?? (kind === "json" ? "application/json; charset=utf-8" : "text/plain; charset=utf-8"));
      }
      if (compression !== null) {
        task.response.setHeader("Content-Encoding", compression);
        if (!task.response.hasHeader("Vary")) task.response.setHeader("Vary", "Accept-Encoding");
      }
      await endServeResponse(task, suppressBody ? undefined : output);
      completeRequest(task);
      return null;
    });
  }
  if (operation === "serve.respondFile") {
    if (args.length !== 6) throw new TypeError("serve.respondFile arguments are invalid");
    const task = requestHandle(args[0]);
    return withTerminalResponse(task, async () => {
      try {
        const file = await staticFile(args[1], args[2], args[3]);
        setHeaders(task.response, headerPairs(args[4]), args[5]);
        task.response.setHeader("Content-Type", file.contentType);
        task.response.setHeader("Accept-Ranges", "bytes");
        const etag = staticEtag(file.metadata);
        task.response.setHeader("ETag", etag);
        task.response.setHeader("Last-Modified", file.metadata.mtime.toUTCString());
        if (staticNotModified(task.request, file.metadata, etag)) {
          task.response.statusCode = 304;
          await endServeResponse(task);
        } else {
          const range = staticRange(task.request, file.metadata, etag);
          if (range === false) {
            task.response.statusCode = 416;
            task.response.setHeader("Content-Range", "bytes */" + file.metadata.size);
            task.response.setHeader("Content-Type", "application/problem+json; charset=utf-8");
            await endServeResponse(task, task.request.method === "HEAD" ? undefined : serveProblemBody(416, "static.range_not_satisfiable", "Range not satisfiable", task.path));
          } else {
            const start = range === null ? 0 : range.start;
            const end = range === null ? file.metadata.size - 1 : range.end;
            task.response.statusCode = range === null ? 200 : 206;
            task.response.setHeader("Content-Length", Math.max(0, end - start + 1));
            if (range !== null) task.response.setHeader("Content-Range", "bytes " + start + "-" + end + "/" + file.metadata.size);
            if (task.request.method !== "HEAD") await writeStaticRange(task, file, start, end);
            await endServeResponse(task);
          }
        }
      } catch (error) {
        if (!(error instanceof StaticNotFound) && !missing(error) && error?.code !== "EISDIR") throw error;
        task.response.statusCode = 404;
        task.response.setHeader("Content-Type", "application/problem+json; charset=utf-8");
        await endServeResponse(task, task.request.method === "HEAD" ? undefined : serveProblemBody(404, "static.not_found", "Not found", task.path));
      }
      completeRequest(task);
      return null;
    });
  }
  if (operation === "serve.streamStart") {
    if (args.length !== 4) throw new TypeError("serve.streamStart arguments are invalid");
    const task = requestHandle(args[0]);
    const status = integer(args[1], 200, 599, "ServeResponse.status");
    const headers = headerPairs(args[2]);
    return withRequest(task, async () => {
      if (task.responseMode !== "idle") throw new Error("Node serve request already owns a response operation");
      task.responseMode = "streaming";
      task.response.statusCode = status;
      setHeaders(task.response, headers, args[3]);
      task.suppressBody = responseHasNoBody(task, task.response.statusCode);
      return null;
    });
  }
  if (operation === "serve.streamWrite") {
    if (args.length !== 2) throw new TypeError("serve.streamWrite arguments are invalid");
    const task = requestHandle(args[0]);
    return withStreamWrite(task, async () => {
      const chunk = args[1];
      if (typeof chunk !== "string") throw new TypeError("ServeResponse.stream chunks must be strings");
      const bytes = Buffer.byteLength(chunk, "utf8");
      if (bytes > maxServeStreamChunkBytes || task.streamBytes + bytes > maxServeStreamBytes) {
        throw new RangeError("ServeResponse.stream exceeded its bounded output");
      }
      if (task.suppressBody) return null;
      if (task.response.destroyed || task.response.writableEnded) throw new Error("ServeResponse.stream client connection is closed");
      reserveTransientServeBytes(bytes);
      task.streamBytes += bytes;
      try {
        await new Promise((resolveWrite, rejectWrite) => {
          let settled = false;
          const cleanup = () => {
            task.response.off("error", failed);
            task.response.off("close", closed);
          };
          const finish = action => { if (settled) return; settled = true; cleanup(); action(); };
          const disconnected = () => new Error("ServeResponse.stream client connection is closed");
          const flushed = error => error ? finish(() => rejectWrite(disconnected())) : finish(resolveWrite);
          const failed = () => finish(() => rejectWrite(disconnected()));
          const closed = () => finish(() => rejectWrite(disconnected()));
          task.response.once("error", failed);
          task.response.once("close", closed);
          task.response.write(chunk, flushed);
          if (task.response.destroyed || task.response.writableEnded) closed();
        });
      } finally {
        releaseTransientServeBytes(bytes);
      }
      return null;
    });
  }
  if (operation === "serve.streamEnd") {
    if (args.length !== 1) throw new TypeError("serve.streamEnd arguments are invalid");
    const task = requestHandle(args[0]);
    return withRequest(task, async () => {
      if (task.responseMode !== "streaming") throw new Error("ServeResponse stream has not started");
      if (task.writeActive) throw new Error("ServeResponse stream still has an active write");
      task.responseMode = "terminal";
      await endServeResponse(task);
      completeRequest(task);
      return null;
    });
  }
  if (operation === "serve.fail") {
    if (args.length !== 1) throw new TypeError("serve.fail arguments are invalid");
    const task = requestHandle(args[0]);
    return withRequest(task, async () => { task.responseMode = "terminal"; opaqueFailure(task); return null; });
  }
  throw new TypeError("Unknown Node host operation");
}

// D50 rule 89: the operating system's errno vocabulary is not an API — it is
// evidence. These are the failures whose recovery differs (create the file,
// request access, take the other branch on kind, choose another name, choose
// another port); everything else stays an ordinary Error, because a caller
// writes the same recovery for all of it: none.
const namedFailures = new Map([
  ["ENOENT", "FileNotFoundError"],
  ["EACCES", "PermissionError"],
  ["EPERM", "PermissionError"],
  ["ENOTDIR", "NotADirectoryError"],
  ["EEXIST", "FileExistsError"],
  ["EADDRINUSE", "AddressInUseError"],
]);

function errorRecord(error) {
  if (error instanceof HttpTransportFailure) return {name: "HttpTransportError", message: error.message, phase: error.phase};
  const message = error instanceof Error && typeof error.message === "string" && error.message.length > 0
    ? error.message.slice(0, 65536)
    : "Node host operation failed";
  const failure = error && typeof error === "object" && typeof error.code === "string" ? namedFailures.get(error.code) : undefined;
  if (failure === "AddressInUseError") return {name: failure, message};
  if (failure) return {name: failure, message, path: typeof error.path === "string" ? error.path.slice(0, 65536) : ""};
  const name = error instanceof RangeError ? "RangeError" : error instanceof TypeError ? "TypeError" : "Error";
  return {name, message};
}

port.on("message", value => {
  const id = value && typeof value === "object" && Number.isSafeInteger(value.id) ? value.id : 0;
  Promise.resolve().then(() => {
    if (!value || typeof value !== "object" || Array.isArray(value)
      || !Number.isSafeInteger(value.id) || value.id < 1
      || typeof value.operation !== "string" || !Array.isArray(value.args)) {
      throw new TypeError("Node host request is invalid");
    }
    return dispatch(value.operation, value.args);
  }).then(
    result => {
      const message = {kind: "response", id, ok: true, value: result, error: null};
      if ((value?.operation === "serve.bodyBytes" || value?.operation === "serve.readFile") && result?.data instanceof Uint8Array && result.data.byteLength > 0) {
        let data = result.data;
        if (data.byteOffset !== 0 || data.buffer.byteLength !== data.byteLength) data = new Uint8Array(data);
        result.data = data;
        try { port.postMessage(message, [data.buffer]); }
        finally { if (value.operation === "serve.readFile") releaseTransientServeBytes(data.byteLength); }
      } else port.postMessage(message);
    },
    error => port.postMessage({kind: "response", id, ok: false, value: null, error: errorRecord(error)}),
  );
});
port.on("close", () => {
  for (const task of fileWatchers.values()) closeFileWatcher(task);
});
port.start();
port.postMessage({kind: "ready"});
