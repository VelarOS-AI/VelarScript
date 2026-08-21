import type { IncomingHttpHeaders } from "node:http";

/**
 * `velar dev` and `velar preview` bind loopback, which keeps a remote host from
 * reaching them but does not keep a web page out: DNS rebinding points a name
 * the attacker controls at 127.0.0.1, so the browser treats the development
 * server as same-origin and can read every route — including `/main.js.map`,
 * whose `sourcesContent` carries the verbatim `.vel` source and the author's
 * absolute on-disk paths. Binding an interface is therefore not the whole
 * defence; the request has to name the server by a loopback host and must not
 * announce itself as cross-origin. Both servers apply this before routing.
 */
export interface LocalRequestRefusal {
  readonly status: number;
  readonly header: string;
  readonly message: string;
}

const loopbackHostnames = new Set(["127.0.0.1", "localhost", "[::1]"]);

/**
 * The only two values a same-origin request declares. Judging by an accepted
 * list rather than a refused one keeps a duplicated header out: Node joins a
 * repeated `Sec-Fetch-Site` into `"none, cross-site"`, which equals neither
 * `"cross-site"` nor `"same-site"` and would pass a refused-list test.
 */
const sameOriginFetchSites = new Set(["none", "same-origin"]);

export function localRequestRefusal(headers: IncomingHttpHeaders): LocalRequestRefusal | null {
  const host = singleHeader(headers.host);
  const hostPort = host === null ? null : loopbackHostPort(host);
  if (hostPort === null) {
    return refusal("Host", `the request's Host header ${quoted(host)} is not a loopback host`);
  }
  const site = headerValue(headers["sec-fetch-site"])?.toLowerCase() ?? null;
  if (site !== null && !sameOriginFetchSites.has(site)) {
    return refusal("Sec-Fetch-Site", `the request's Sec-Fetch-Site header ${quoted(site)} marks it as a cross-origin request`);
  }
  const origin = singleHeader(headers.origin);
  // A same-origin GET carries no Origin at all, so this only ever judges a
  // request that already declared one. Every loopback spelling of the port this
  // request was addressed to is accepted beside the server's own — `localhost`,
  // `127.0.0.1` and `[::1]` name the same server over the same interface and
  // differ only in spelling. The port is not a spelling: a page served by a
  // second local server is a different origin and is refused like any other.
  if (origin !== null && !isOwnLoopbackOrigin(origin, hostPort)) {
    return refusal("Origin", `the request's Origin header ${quoted(origin)} is not this server's origin`);
  }
  return null;
}

function refusal(header: string, message: string): LocalRequestRefusal {
  return { status: 403, header, message };
}

function singleHeader(value: string | readonly string[] | undefined): string | null {
  // A repeated Host or Origin is ambiguous by construction: whichever value the
  // server judged, a proxy downstream may act on the other one.
  return typeof value === "string" ? value : null;
}

/** A repeated header has to reach the accepted-list test as one unmatchable value. */
function headerValue(value: string | readonly string[] | undefined): string | null {
  if (value === undefined) return null;
  return typeof value === "string" ? value : value.join(", ");
}

/** The port a loopback-addressed request names, or `null` for any other host. */
function loopbackHostPort(value: string): string | null {
  try {
    const url = new URL(`http://${value}`);
    if (url.username || url.password || url.pathname !== "/" || url.search || url.hash) return null;
    return loopbackHostnames.has(url.hostname.toLowerCase()) ? url.port : null;
  } catch {
    return null;
  }
}

function isOwnLoopbackOrigin(origin: string, port: string): boolean {
  try {
    const url = new URL(origin);
    // `URL` drops a default port, so `http://127.0.0.1:80` and `http://127.0.0.1`
    // compare equal here, as they do in the browser's own origin comparison.
    return url.protocol === "http:" && url.port === port && loopbackHostnames.has(url.hostname.toLowerCase());
  } catch {
    return false;
  }
}

/** Header values reach the response body, so only printable ASCII survives. */
function quoted(value: string | null): string {
  if (value === null) return "(absent)";
  const printable = [...value].filter((character) => character >= " " && character <= "~").join("");
  return `'${printable.length > 100 ? `${printable.slice(0, 100)}…` : printable}'`;
}
