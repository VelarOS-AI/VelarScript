function requestPath(value) {
  if (typeof value !== "string" || value.length === 0 || value.length > maxPathCodeUnits || value.includes("\0") || value.includes("\\")) {
    throw new StaticNotFound();
  }
  const source = value.startsWith("/") ? value : "/" + value;
  const segments = source.split("/").filter(Boolean);
  if (segments.some(segment => segment === "." || segment === "..")) throw new StaticNotFound();
  return segments.join("/");
}

function inside(root, target) {
  // relative() emits ".." only as a whole segment, so the escape test compares
  // whole segments too: a prefix test also rejects an ordinary top-level file
  // whose own name begins with two dots. The separator is the platform's,
  // because relative() writes an escape with a backslash on Windows.
  const path = relative(root, target);
  return path === "" || path !== ".." && !path.startsWith(".." + sep) && !isAbsolute(path);
}

/**
 * The directory a static root resolves to.
 *
 * D114 F9-node-cli (audit NO-D1) took the choice away from here. `velar/serve`
 * used to hand over two candidates — the root against the project root the
 * build knew, and the same root beside the emitted entry — and this transport
 * picked between them by which of the two directories existed. Existence is not
 * identity: that is how a `dist/` copied beside a stranger's `public/` came to
 * publish the stranger's files as this application's assets. Only `velar/serve`
 * can ask who the directory at that offset belongs to, so it settles one
 * application root base before any request and what arrives here is a single
 * root. A root that does not resolve is the same miss it has always been.
 */
async function staticRoot(rootValue) {
  return realpath(resolve(boundedPath(rootValue, "fileResponse")));
}

async function staticFile(rootValue, pathValue, fallbackValue) {
  const root = await staticRoot(rootValue);
  const relativePath = requestPath(pathValue);
  const fallback = fallbackValue === null ? null : requestPath(fallbackValue);
  const load = async path => {
    const target = await realpath(resolve(root, path));
    if (!inside(root, target)) throw new StaticNotFound();
    const metadata = await stat(target);
    if (!metadata.isFile() || metadata.size > maxServeFileBytes) throw new StaticNotFound();
    return {target, metadata, contentType: contentTypes[extname(target).toLowerCase()] ?? "application/octet-stream"};
  };
  try { return await load(relativePath); }
  catch (error) {
    if ((error instanceof StaticNotFound || missing(error) || error?.code === "EISDIR") && fallback !== null) return load(fallback);
    throw error;
  }
}

function staticEtag(metadata) {
  const modified = Number.isFinite(metadata.mtimeMs) ? Math.floor(metadata.mtimeMs) : 0;
  return 'W/"' + metadata.size.toString(16) + "-" + modified.toString(16) + '"';
}

function staticNotModified(request, metadata, etag) {
  const noneMatch = request.headers["if-none-match"];
  if (typeof noneMatch === "string") {
    for (const candidate of noneMatch.split(",")) if (candidate.trim() === "*" || candidate.trim() === etag) return true;
    return false;
  }
  const modifiedSince = request.headers["if-modified-since"];
  if (typeof modifiedSince !== "string") return false;
  const time = Date.parse(modifiedSince);
  return Number.isFinite(time) && Math.floor(metadata.mtimeMs / 1000) * 1000 <= time;
}

function staticRange(request, metadata, etag) {
  const value = request.headers.range;
  if (typeof value !== "string") return null;
  const ifRange = request.headers["if-range"];
  if (typeof ifRange === "string" && ifRange !== etag) {
    const time = Date.parse(ifRange);
    if (!Number.isFinite(time) || Math.floor(metadata.mtimeMs / 1000) * 1000 > time) return null;
  }
  const match = /^bytes=(\d*)-(\d*)$/u.exec(value.trim());
  if (!match || match[1] === "" && match[2] === "" || metadata.size === 0) return false;
  let start;
  let end;
  if (match[1] === "") {
    const suffix = Number(match[2]);
    if (!Number.isSafeInteger(suffix) || suffix < 1) return false;
    start = Math.max(0, metadata.size - suffix);
    end = metadata.size - 1;
  } else {
    start = Number(match[1]);
    end = match[2] === "" ? metadata.size - 1 : Number(match[2]);
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start >= metadata.size || end < start) return false;
    if (end >= metadata.size) end = metadata.size - 1;
  }
  return {start, end};
}

async function writeStaticRange(task, file, start, end) {
  if (end < start) return;
  const source = createReadStream(file.target, {start, end, highWaterMark: 64 * 1024});
  try {
    for await (const chunk of source) {
      const bytes = chunk.byteLength;
      reserveTransientServeBytes(bytes);
      try {
        await new Promise((resolveWrite, rejectWrite) => {
          let settled = false;
          const cleanup = () => { task.response.off("error", failed); task.response.off("close", closed); };
          const finish = action => { if (settled) return; settled = true; cleanup(); action(); };
          const failed = error => finish(() => rejectWrite(error));
          const closed = () => finish(() => rejectWrite(new Error("ServeResponse client connection is closed")));
          task.response.once("error", failed);
          task.response.once("close", closed);
          task.response.write(chunk, error => error ? failed(error) : finish(resolveWrite));
        });
      } finally { releaseTransientServeBytes(bytes); }
    }
  } finally { source.destroy(); }
}

async function testStaticFile(rootValue, pathValue, fallbackValue) {
  const root = await staticRoot(rootValue);
  const relativePath = requestPath(pathValue);
  const fallback = fallbackValue === null ? null : requestPath(fallbackValue);
  const load = async path => {
    const target = await realpath(resolve(root, path));
    if (!inside(root, target)) throw new StaticNotFound();
    const metadata = await stat(target);
    if (!metadata.isFile() || metadata.size > maxServeBodyBytes) throw new StaticNotFound();
    let reserved = metadata.size * 2;
    reserveTransientServeBytes(reserved);
    try {
      const source = await readFile(target);
      if (source.byteLength > maxServeBodyBytes) throw new StaticNotFound();
      if (source.byteLength > metadata.size) { const extra = (source.byteLength - metadata.size) * 2; reserveTransientServeBytes(extra); reserved += extra; }
      else if (source.byteLength < metadata.size) { const surplus = (metadata.size - source.byteLength) * 2; releaseTransientServeBytes(surplus); reserved -= surplus; }
      const data = new Uint8Array(source.byteLength);
      data.set(source);
      releaseTransientServeBytes(source.byteLength);
      reserved -= source.byteLength;
      return {data, contentType: contentTypes[extname(target).toLowerCase()] ?? "application/octet-stream"};
    } catch (error) { releaseTransientServeBytes(reserved); throw error; }
  };
  try { return await load(relativePath); }
  catch (error) {
    if ((error instanceof StaticNotFound || missing(error) || error?.code === "EISDIR") && fallback !== null) return load(fallback);
    throw error;
  }
}