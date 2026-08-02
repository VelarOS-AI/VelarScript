import { createServer, type Server } from "node:http";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { extname, isAbsolute, join, relative, resolve } from "node:path";
import { pipeline } from "node:stream/promises";
import type { VerifiedProductionBuild } from "./production-verifier.ts";

export interface ProductionPreviewHandle {
  readonly server: Server;
  readonly origin: string;
  readonly url: string;
  close(): Promise<void>;
}

export async function startProductionPreview(
  build: VerifiedProductionBuild,
  port: number,
): Promise<ProductionPreviewHandle> {
  const server = createServer(async (request, response) => {
    try {
      if (request.method !== "GET" && request.method !== "HEAD") {
        response.setHeader("Allow", "GET, HEAD");
        response.writeHead(405).end("Method not allowed");
        return;
      }
      const encodedPathname = new URL(request.url ?? "/", `http://${request.headers.host ?? "127.0.0.1"}`).pathname;
      let pathname: string;
      try {
        pathname = decodeURIComponent(encodedPathname);
      } catch {
        if (!build.deployment.spaFallback || !encodedPathname.startsWith(build.deployment.base)
          || !isNavigationRequest(request.headers.accept, encodedPathname)) {
          response.writeHead(400).end("Bad path");
          return;
        }
        pathname = encodedPathname;
      }
      const base = build.deployment.base;
      if (!pathname.startsWith(base)) {
        response.writeHead(404).end("Not found");
        return;
      }
      const requestedPath = pathname.slice(base.length) || "index.html";
      let safePath: string;
      try {
        safePath = confinedPath(build.directory, requestedPath);
      } catch {
        response.writeHead(400).end("Bad path");
        return;
      }
      let servedPath = requestedPath;
      let servedFile = safePath;
      let servedSize: number;
      try {
        const metadata = await stat(safePath);
        if (!metadata.isFile()) throw new Error("Not a file");
        servedSize = metadata.size;
      } catch {
        if (!build.deployment.spaFallback || !isNavigationRequest(request.headers.accept, requestedPath)) {
          response.writeHead(404).end("Not found");
          return;
        }
        servedPath = build.deployment.spaFallback.source;
        servedFile = confinedPath(build.directory, servedPath);
        const metadata = await stat(servedFile);
        if (!metadata.isFile()) throw new Error("SPA fallback is not a file");
        servedSize = metadata.size;
      }

      for (const rule of build.deployment.headers) {
        if (!matchesPath(rule.path, pathname)) continue;
        for (const [name, value] of Object.entries(rule.values)) response.setHeader(name, value);
      }
      const contentType = mimeType(servedPath);
      response.setHeader("Content-Type", contentType);
      response.setHeader("Content-Length", String(servedSize));
      if (!response.hasHeader("Cache-Control") && contentType.startsWith("text/html")) {
        response.setHeader("Cache-Control", build.deployment.caching.documents);
      }
      response.writeHead(200);
      if (request.method === "HEAD") response.end();
      else await pipeline(createReadStream(servedFile), response);
    } catch (error) {
      if (response.headersSent) response.destroy(error instanceof Error ? error : new Error(String(error)));
      else response.writeHead(500).end(error instanceof Error ? error.message : String(error));
    }
  });
  await new Promise<void>((resolvePromise, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolvePromise);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Production preview did not bind a TCP port");
  const origin = `http://127.0.0.1:${address.port}`;
  const close = async (): Promise<void> => {
    server.closeAllConnections();
    if (!server.listening) return;
    await new Promise<void>((resolvePromise, reject) => server.close((error) => error ? reject(error) : resolvePromise()));
  };
  return { server, origin, url: new URL(build.deployment.base, origin).href, close };
}

export async function runProductionPreview(build: VerifiedProductionBuild, port: number): Promise<void> {
  const preview = await startProductionPreview(build, port);
  process.stdout.write(`Velar production preview: ${preview.url}\n`);
  process.stdout.write(`Verified build: ${build.manifest.buildId}\n`);
  await new Promise<void>((resolvePromise) => {
    let settled = false;
    const stop = (): void => {
      if (settled) return;
      settled = true;
      process.off("SIGINT", stop);
      process.off("SIGTERM", stop);
      resolvePromise();
    };
    process.on("SIGINT", stop);
    process.on("SIGTERM", stop);
  });
  await preview.close();
}

function confinedPath(root: string, value: string): string {
  if (!value || isAbsolute(value) || value.includes("\\")) throw new Error("Bad path");
  const target = resolve(root, value);
  const pathFromRoot = relative(root, target);
  if (pathFromRoot === ".." || pathFromRoot.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) || isAbsolute(pathFromRoot)) {
    throw new Error("Bad path");
  }
  return target;
}

function isNavigationRequest(accept: string | undefined, path: string): boolean {
  if (!accept?.toLowerCase().includes("text/html")) return false;
  const extension = extname(path);
  return extension === "" || path.endsWith("/") || extension === ".html";
}

function matchesPath(pattern: string, pathname: string): boolean {
  return pattern.endsWith("*") ? pathname.startsWith(pattern.slice(0, -1)) : pathname === pattern;
}

function mimeType(path: string): string {
  switch (extname(path).toLowerCase()) {
    case ".css": return "text/css; charset=utf-8";
    case ".html": return "text/html; charset=utf-8";
    case ".js":
    case ".mjs": return "text/javascript; charset=utf-8";
    case ".json":
    case ".map": return "application/json; charset=utf-8";
    case ".svg": return "image/svg+xml";
    case ".txt": return "text/plain; charset=utf-8";
    case ".png": return "image/png";
    case ".jpg":
    case ".jpeg": return "image/jpeg";
    case ".webp": return "image/webp";
    case ".gif": return "image/gif";
    case ".ico": return "image/x-icon";
    case ".woff": return "font/woff";
    case ".woff2": return "font/woff2";
    default: return "application/octet-stream";
  }
}
