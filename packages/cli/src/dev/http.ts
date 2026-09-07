/** How this server writes a response: never cached, and a file streamed rather than read. */

import { createReadStream } from "node:fs";
import type { ServerResponse } from "node:http";
import { pipeline } from "node:stream/promises";
import { asHostError } from "../host-error.ts";

/** The request path with the framework's base prefix removed. */
export function stripBase(pathname: string, base: string): string {
  if (base === "/") return pathname;
  const prefix = base.slice(0, -1);
  if (pathname === prefix) return "/";
  return pathname.startsWith(base) ? `/${pathname.slice(base.length)}` : pathname;
}

export function send(response: ServerResponse, status: number, body: string | Buffer, contentType: string): void {
  response.writeHead(status, { "Content-Type": contentType, "Cache-Control": "no-store" });
  response.end(body);
}

export async function sendFile(
  response: ServerResponse,
  asset: { readonly path: string; readonly sizeBytes: number; readonly contentType: string },
  head: boolean,
): Promise<void> {
  response.writeHead(200, {
    "Content-Type": asset.contentType,
    "Content-Length": String(asset.sizeBytes),
    "Cache-Control": "no-store",
  });
  if (head) { response.end(); return; }
  try { await pipeline(createReadStream(asset.path), response); }
  catch (error) { if (!response.destroyed) response.destroy(asHostError(error)); }
}
