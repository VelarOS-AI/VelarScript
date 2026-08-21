import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { connect } from "node:net";
import { tmpdir } from "node:os";
import { join, posix, win32 } from "node:path";
import test from "node:test";
import { MessageChannel, Worker } from "node:worker_threads";
import { VELAR_NODE_HOST_WORKER_SOURCE } from "../packages/node/src/node-host-worker-runtime.ts";

interface HostWorker {
  call(operation: string, args: readonly unknown[]): Promise<unknown>;
  on(event: string, handler: (value: Record<string, unknown>) => void): void;
  close(): Promise<void>;
}

// The privileged worker speaks the same port protocol the Node host proxy uses,
// so a bounds test drives it directly instead of through velar/http or
// velar/serve: the defects under test live in the worker's own validators.
async function hostWorker(): Promise<HostWorker> {
  const channel = new MessageChannel();
  const pending = new Map<number, { resolve(value: unknown): void; reject(error: Error): void }>();
  const events = new Map<string, (value: Record<string, unknown>) => void>();
  let nextId = 1;
  let readyResolve: (() => void) | null = null;
  let readyReject: ((error: Error) => void) | null = null;
  const ready = new Promise<void>((resolveReady, rejectReady) => {
    readyResolve = resolveReady;
    readyReject = rejectReady;
  });
  const worker = new Worker(VELAR_NODE_HOST_WORKER_SOURCE, {
    eval: true,
    workerData: channel.port2,
    transferList: [channel.port2],
  });
  channel.port1.on("message", (message: {
    kind?: unknown;
    id?: unknown;
    ok?: unknown;
    value?: unknown;
    event?: unknown;
    error?: { name?: unknown; message?: unknown };
  }) => {
    if (message.kind === "ready") { readyResolve?.(); return; }
    if (message.kind === "event" && typeof message.event === "string") {
      events.get(message.event)?.(message.value as Record<string, unknown>);
      return;
    }
    if (message.kind !== "response" || !Number.isSafeInteger(message.id)) return;
    const request = pending.get(message.id as number);
    if (!request) return;
    pending.delete(message.id as number);
    if (message.ok === true) { request.resolve(message.value); return; }
    const failure = new Error(typeof message.error?.message === "string" ? message.error.message : "Node host worker request failed");
    failure.name = typeof message.error?.name === "string" ? message.error.name : "Error";
    request.reject(failure);
  });
  worker.once("error", (error) => {
    const failure = error instanceof Error ? error : new Error("Node host worker failed");
    readyReject?.(failure);
    for (const request of pending.values()) request.reject(failure);
    pending.clear();
  });
  await ready;
  return {
    call(operation, args) {
      const id = nextId++;
      return new Promise((resolveCall, rejectCall) => {
        pending.set(id, { resolve: resolveCall, reject: rejectCall });
        channel.port1.postMessage({ id, operation, args });
      });
    },
    on(event, handler) { events.set(event, handler); },
    async close() {
      channel.port1.close();
      await worker.terminate();
    },
  };
}

interface RawResponse {
  readonly status: number;
  readonly body: Buffer;
}

// A raw socket client keeps the framing under the test's control: the aggregate
// budget defect is reached by a Content-Length header the client never honors.
// A refused request may close the socket mid-write, so a write failure is
// reported as status 0 rather than as a test error. `halfClose` sends the FIN
// a truncated request needs; a complete request leaves the socket open and
// lets `Connection: close` end it.
function rawRequest(port: number, head: string, body: Buffer | null, halfClose = false): Promise<RawResponse> {
  return new Promise((resolveRequest) => {
    const chunks: Buffer[] = [];
    const socket = connect(port, "127.0.0.1", () => {
      socket.write(head);
      if (body !== null) socket.write(body);
      if (halfClose) socket.end();
    });
    socket.setTimeout(20_000, () => socket.destroy());
    socket.on("data", (chunk: Buffer) => chunks.push(chunk));
    socket.once("error", () => {});
    socket.once("close", () => {
      const raw = Buffer.concat(chunks);
      const separator = raw.indexOf("\r\n\r\n");
      if (separator < 0) { resolveRequest({ status: 0, body: Buffer.alloc(0) }); return; }
      const status = Number(raw.subarray(0, separator).toString("utf8").split("\r\n")[0]?.split(" ")[1]);
      resolveRequest({ status, body: raw.subarray(separator + 4) });
    });
  });
}

// Seven 16 MiB declarations plus sixteen 1 MiB declarations name exactly the
// 128 MiB process-global serve budget, so nothing is left for a real upload.
const withheldDeclarations: readonly number[] = [
  ...new Array<number>(7).fill(16 * 1024 * 1024),
  ...new Array<number>(16).fill(1024 * 1024),
];

function withheldBodySocket(port: number, declared: number): Promise<ReturnType<typeof connect>> {
  return new Promise((resolveSocket, rejectSocket) => {
    const socket = connect(port, "127.0.0.1", () => {
      socket.write(`POST /sink HTTP/1.1\r\nHost: x\r\nContent-Length: ${declared}\r\n\r\n`);
      resolveSocket(socket);
    });
    socket.once("error", rejectSocket);
  });
}

test("worker outbound request headers reject transport-owned names", async () => {
  const host = await hostWorker();
  const seen: Array<Record<string, string | string[] | undefined>> = [];
  const server = createServer((request, response) => {
    seen.push(request.headers);
    request.resume();
    response.writeHead(200, { "content-type": "text/plain" });
    response.end("ok");
  });
  await new Promise<void>((resolveListen, rejectListen) => {
    server.once("error", rejectListen);
    server.listen(0, "127.0.0.1", resolveListen);
  });
  try {
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const url = `http://127.0.0.1:${address.port}/`;
    for (const name of ["content-length", "transfer-encoding", "host", "connection", "Content-Length"]) {
      await assert.rejects(
        host.call("http.request", [1, "POST", url, [[name, "4"]], [], "abcd", 65536]),
        (error: unknown) => error instanceof Error
          && error.name === "TypeError"
          && error.message === `HTTP header '${name}' is transport-controlled`,
        `${name} must not reach the wire`,
      );
    }
    assert.equal(seen.length, 0, "a rejected header never opens a socket");
    // The framing deny-list is exactly transport ownership: credential headers
    // stay legal on the ordinary header path.
    const started = await host.call("http.request", [2, "POST", url, [["x-tenant", "a"], ["cookie", "session=1"]], [], "abcd", 65536]) as {
      readonly handle: number;
      readonly status: number;
    };
    assert.equal(started.status, 200);
    await host.call("http.close", [started.handle]);
    assert.equal(seen.length, 1);
    assert.equal(seen[0]?.["x-tenant"], "a");
    assert.equal(seen[0]?.cookie, "session=1");
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
    await host.close();
  }
});

test("a withheld request body reserves no serve budget", async () => {
  const host = await hostWorker();
  const attackers: Array<ReturnType<typeof connect>> = [];
  const failures: string[] = [];
  let opened = 0;
  let notifyOpened = (): void => {};
  host.on("serve.request", (value) => {
    void (async () => {
      const handle = value.request as number;
      if (value.path === "/sink") {
        opened += 1;
        notifyOpened();
        try {
          await host.call("serve.bodyBytes", [handle, 16 * 1024 * 1024]);
          await host.call("serve.respond", [handle, 200, [], "text", "sink", null, null, []]);
        } catch { /* the withheld body never arrives */ }
        return;
      }
      try {
        const body = await host.call("serve.bodyBytes", [handle, 16 * 1024 * 1024]) as {
          readonly data: Uint8Array | null;
          readonly bytes: number;
          readonly tooLarge: boolean;
        };
        const digest = body.tooLarge ? "too-large" : createHash("sha256").update(body.data ?? new Uint8Array()).digest("hex");
        await host.call("serve.respond", [handle, 200, [], "text", `${body.bytes}:${digest}`, null, null, []]);
      } catch (error) {
        failures.push(error instanceof Error ? error.message : String(error));
        try { await host.call("serve.fail", [handle]); } catch { /* the client is already gone */ }
      }
    })();
  });
  const started = await host.call("serve.start", [1, 0, "127.0.0.1"]) as { readonly handle: number; readonly port: number };
  try {
    // Twenty-three header-only sockets claim the whole process-global serve
    // budget with about 1.4 KiB of actual traffic and zero body bytes.
    const target = withheldDeclarations.length;
    const arrived = new Promise<void>((resolveArrived) => {
      notifyOpened = () => { if (opened >= target) resolveArrived(); };
    });
    for (const declared of withheldDeclarations) attackers.push(await withheldBodySocket(started.port, declared));
    await arrived;
    // Port messages are answered in order, so a marker round-trip proves every
    // withheld body has already reached the worker's reservation.
    assert.equal(await host.call("http.close", [1]), false);

    // A legitimate multi-MiB upload still round-trips its exact bytes.
    const payload = Buffer.alloc(4 * 1024 * 1024);
    for (let index = 0; index < payload.byteLength; index += 1) payload[index] = index % 251;
    const digest = createHash("sha256").update(payload).digest("hex");
    const uploaded = await rawRequest(
      started.port,
      `POST /echo HTTP/1.1\r\nHost: x\r\nConnection: close\r\nContent-Length: ${payload.byteLength}\r\n\r\n`,
      payload,
    );
    assert.equal(uploaded.status, 200, "a withheld declaration must not consume the aggregate budget");
    assert.equal(uploaded.body.toString("utf8"), `${payload.byteLength}:${digest}`);

    // A short declared-length POST still round-trips exactly.
    const small = Buffer.from("hello worker", "utf8");
    const smallDigest = createHash("sha256").update(small).digest("hex");
    const echoed = await rawRequest(
      started.port,
      `POST /echo HTTP/1.1\r\nHost: x\r\nConnection: close\r\nContent-Length: ${small.byteLength}\r\n\r\n`,
      small,
    );
    assert.equal(echoed.status, 200);
    assert.equal(echoed.body.toString("utf8"), `${small.byteLength}:${smallDigest}`);

    // A body shorter than its declaration is still a failure, never a short read.
    const truncated = await rawRequest(
      started.port,
      "POST /echo HTTP/1.1\r\nHost: x\r\nConnection: close\r\nContent-Length: 64\r\n\r\n",
      Buffer.from("short", "utf8"),
      true,
    );
    assert.notEqual(truncated.status, 200, "an unmet Content-Length must never be accepted as a body");
    const deadline = Date.now() + 5_000;
    while (failures.length === 0 && Date.now() < deadline) await new Promise((tick) => setTimeout(tick, 10));
    assert.equal(failures.length, 1, "the truncated body must fail the read rather than return a short buffer");
    // Which failure wins is a race between the torn-down request stream, the
    // length guard and the closed response, so all three spellings count; what
    // must never happen is a short body reported as a body.
    assert.match(failures[0] ?? "", /aborted|does not match Content-Length|connection is closed/u);
  } finally {
    for (const socket of attackers) socket.destroy();
    try { await host.call("serve.stop", [started.handle, 1000]); } catch { /* the worker is going away */ }
    await host.close();
  }
});

test("static containment rejects escapes without rejecting leading-dot names", async () => {
  const host = await hostWorker();
  const directory = await mkdtemp(join(tmpdir(), "velar-worker-static-"));
  const root = join(directory, "public");
  const outside = join(directory, "secret.txt");
  await writeFile(outside, "outside the root", "utf8");
  await mkdir(root, { recursive: true });
  await writeFile(join(root, "..config.json"), '{"ok":true}', "utf8");
  await writeFile(join(root, "index.html"), "<p>root</p>", "utf8");
  await symlink(outside, join(root, "escape.txt"));
  host.on("serve.request", (value) => {
    void (async () => {
      const handle = value.request as number;
      try { await host.call("serve.respondFile", [handle, root, value.path as string, null, [], []]); }
      catch { try { await host.call("serve.fail", [handle]); } catch { /* the client is already gone */ } }
    })();
  });
  const started = await host.call("serve.start", [1, 0, "127.0.0.1"]) as { readonly handle: number; readonly port: number };
  try {
    const dotted = await rawRequest(started.port, "GET /..config.json HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n", null);
    assert.equal(dotted.status, 200, "a top-level name beginning with two dots is an ordinary file");
    assert.equal(dotted.body.toString("utf8"), '{"ok":true}');

    const symlinked = await rawRequest(started.port, "GET /escape.txt HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n", null);
    assert.equal(symlinked.status, 404, "a symlink out of the root is still outside the root");
    assert.doesNotMatch(symlinked.body.toString("utf8"), /outside the root/u);

    const traversal = await rawRequest(started.port, "GET /assets/../../secret.txt HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n", null);
    assert.notEqual(traversal.status, 200, "a dot-dot segment is never a path");
    assert.doesNotMatch(traversal.body.toString("utf8"), /outside the root/u);

    // The buffered body path shares the same containment test.
    const buffered = await host.call("serve.readFile", [root, "/..config.json", null]) as { readonly data: Uint8Array };
    assert.equal(Buffer.from(buffered.data).toString("utf8"), '{"ok":true}');
    await assert.rejects(host.call("serve.readFile", [root, "/escape.txt", null]));
  } finally {
    try { await host.call("serve.stop", [started.handle, 1000]); } catch { /* the worker is going away */ }
    await host.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("the emitted worker source states each bound it now enforces", () => {
  const source = VELAR_NODE_HOST_WORKER_SOURCE;
  // Framing and routing names never reach the outbound header record.
  assert.match(source, /const transportOwnedHttpHeaders = new Set\(\[/u);
  assert.match(source, /transportOwnedHttpHeaders\.has\(pair\[0\]\.toLowerCase\(\)\)/u);
  for (const name of ["connection", "content-length", "expect", "host", "keep-alive", "proxy-connection", "te", "trailer", "transfer-encoding", "upgrade"]) {
    const start = source.indexOf("const transportOwnedHttpHeaders");
    const end = source.indexOf("]);", start);
    assert.ok(source.slice(start, end).includes(`"${name}"`), `${name} is transport-owned`);
  }
  // A declaration buys neither an allocation nor a reservation.
  assert.doesNotMatch(source, /Buffer\.allocUnsafe\(declared\)/u);
  assert.doesNotMatch(source, /reserveServeBytes\(task, declared\)/u);
  assert.match(source, /const limit = declared === null \? maximum : declared;/u);
  assert.match(source, /if \(declared !== null && total !== declared\) throw new TypeError\("Request body length does not match Content-Length"\);/u);
  // Containment compares whole segments, not a text prefix, and the segment
  // separator is the platform's.
  assert.doesNotMatch(source, /!path\.startsWith\("\.\."\)/u);
  assert.doesNotMatch(source, /!path\.startsWith\("\.\.\/"\)/u);
  assert.match(source, /path !== "\.\." && !path\.startsWith\("\.\." \+ sep\) && !isAbsolute\(path\)/u);
  assert.match(source, /import \{ basename, dirname, extname, isAbsolute, relative, resolve, sep \} from "node:path";/u);
});

test("the emitted containment predicate holds on Windows path semantics", () => {
  // The worker runs wherever Node runs, and relative() writes an escape as
  // "..\\name" there, which a "../" prefix test would read as contained. The
  // predicate is lifted out of the emitted source so the text under test is
  // the text that ships.
  const declaration = /function inside\(root, target\) \{[\s\S]*?\n\}/u.exec(VELAR_NODE_HOST_WORKER_SOURCE);
  assert.ok(declaration, "the worker declares inside()");
  const build = new Function("relative", "isAbsolute", "sep", `${declaration[0]}\nreturn inside;`) as (
    relative: typeof win32.relative,
    isAbsolute: typeof win32.isAbsolute,
    separator: string,
  ) => (root: string, target: string) => boolean;
  for (const platform of [posix, win32]) {
    const contained = build(platform.relative, platform.isAbsolute, platform.sep);
    const root = platform === win32 ? "C:\\srv\\public" : "/srv/public";
    const at = (...parts: readonly string[]): string => [root, ...parts].join(platform.sep);
    assert.equal(contained(root, root), true);
    assert.equal(contained(root, at("..config.json")), true, "a leading-dot name is an ordinary file");
    assert.equal(contained(root, at("sub", "..nested.txt")), true);
    assert.equal(contained(root, platform.join(root, "..")), false, "the parent is outside the root");
    assert.equal(contained(root, platform.join(root, "..", "secret.txt")), false, "an escaped file is outside the root");
    assert.equal(contained(root, `${root}-other${platform.sep}sibling.txt`), false, "a sibling root is outside the root");
  }
});
