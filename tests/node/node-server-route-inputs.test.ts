import assert from "node:assert/strict";
import { join } from "node:path";
import test from "node:test";
import { tmpdir } from "node:os";
import { compileProject } from "../../packages/cli/src/project.ts";
import { velarNodeCompilerExtension } from "@velarscript/node/compiler";

/**
 * D115 §三 — one subject per file, split out of the 1,012-line
 * `node-server-framework.test.ts`. Every test here is the one that was there,
 * moved verbatim.
 *
 * The subject is the two ends of a handler: the inputs the compiler infers for
 * its parameters and providers, and the OpenAPI schema and final status its
 * results reach the document as.
 */

test("route input values infer handler parameters and provider results", async () => {
  const path = join(tmpdir(), "velar-node-route-input-values.vel");
  const project = await compileProject(path, new Map([[path, `
import {input, provide, security} from "velar/serve"

type User:
    id: string

type UploadMetadata:
    title: string

async def authenticate(token: string) -> User:
    return {id: token}

const currentUser = provide(
    inputs={token: security.bearer()},
    resolve=async values => await authenticate(values.token),
)

server api:
    @get(p"/users/me" as path,
        user=input.dependency(currentUser),
        session=input.cookie("session", default=null),
    ) => {id: user.id, session}

    @post(p"/files" as path,
        metadata=input.form(UploadMetadata),
        image=input.upload("image", maxBytes=8_388_608),
    ) => {title: metadata.title, filename: image.filename}
`.trimStart()]]), { extensions: [velarNodeCompilerExtension] });
  assert.deepEqual(project.failures, []);
  assert.deepEqual(project.modules.flatMap((module) => module.result.diagnostics), []);
  const code = project.modules[0]?.result.code ?? "";
  assert.match(code, /source:"dependency",kind:"dependency"[^\n]*input:input\.dependency\(currentUser\)/u);
  assert.match(code, /source:"cookie",kind:"string"[^\n]*input:input\.cookie\([^\n]*"session", null/u);
  assert.match(code, /async \(path, user, session\)/u);
  assert.doesNotMatch(code, /async \(user = input\.dependency/u);
  assert.match(code, /source:"form",kind:"data"/u);
  assert.match(code, /source:"upload",kind:"upload"/u);
});

test("supply checks the concrete result type of an app-scoped Provider", async () => {
  const path = join(tmpdir(), "velar-node-supplied-provider.vel");
  const source = `
import {provide, supply} from "velar/serve"

type Application:
    name: string

async def resolveApplication(_values: Record<unknown>) -> Application:
    return {name: "fallback"}

const applicationProvider = provide(
    inputs={},
    resolve=resolveApplication,
    scope="app",
)

server api:
    @get(p"/health") => {ok: true}

const app = supply(api, applicationProvider, {name: "OpenVoxel"})
`.trimStart();
  const project = await compileProject(path, new Map([[path, source]]), {extensions: [velarNodeCompilerExtension]});
  assert.deepEqual(project.failures, []);
  assert.deepEqual(project.modules.flatMap((module) => module.result.diagnostics), []);
  assert.match(project.modules[0]?.result.code ?? "", /supply\(api, applicationProvider, \{ name: "OpenVoxel" \}\)/u);

  const invalidPath = join(tmpdir(), "velar-node-invalid-supplied-provider.vel");
  const invalid = await compileProject(
    invalidPath,
    new Map([[invalidPath, source.replace('{name: "OpenVoxel"}', "{name: 42}")]]),
    {extensions: [velarNodeCompilerExtension]},
  );
  const invalidDiagnostics = invalid.modules.flatMap((module) => module.result.diagnostics);
  assert.ok(
    invalidDiagnostics.some((item) => /number.*string|string.*number/u.test(item.message)),
    invalidDiagnostics.map((item) => item.message).join("\n"),
  );
});

test("response helpers preserve compiler-derived OpenAPI schemas and final statuses", async () => {
  const path = join(tmpdir(), "velar-node-response-openapi.vel");
  const project = await compileProject(path, new Map([[path, `
import {background, created, json, noContent, setCookie} from "velar/serve"

type Article:
    title: string

server api:
    @post(p"/articles" as path, input: Article) => setCookie(background(created(input), async () => null), "created", "yes")
    @put(p"/articles/{id:string}" as path, input: Article) => json(input, status=202)
    @delete(p"/articles/{id:string}" as path) => noContent()
`.trimStart()]]), {extensions: [velarNodeCompilerExtension]});
  assert.deepEqual(project.failures, []);
  assert.deepEqual(project.modules.flatMap((module) => module.result.diagnostics), []);
  const code = project.modules[0]?.result.code ?? "";
  assert.match(code, /responseSchema:\{"type":"object","properties":\{"title":\{"type":"string"\}\},"required":\["title"\],"additionalProperties":false\},responseContentTypes:\["application\/json"\],status:201/u);
  assert.match(code, /responseContentTypes:\["application\/json"\],status:202/u);
  assert.match(code, /status:204/u);
});

test("[D102-1] an enum reaches OpenAPI as its wire values, integers included", async () => {
  const path = join(tmpdir(), "velar-node-response-enum-wire.vel");
  const project = await compileProject(path, new Map([[path, `
enum KernelProtocol:
    v1 = 1
    v2 = 2

enum Visibility:
    public = "published"
    private = "restricted"

type Frame:
    protocol: KernelProtocol
    pinned: KernelProtocol.v2
    visibility: Visibility
    tag: Visibility.public

def frame() -> Frame:
    return {protocol: KernelProtocol.v1, pinned: KernelProtocol.v2, visibility: Visibility.private, tag: Visibility.public}

server api:
    @get(p"/frame" as path) => frame()
`.trimStart()]]), {extensions: [velarNodeCompilerExtension]});
  assert.deepEqual(project.failures, []);
  assert.deepEqual(project.modules.flatMap((module) => module.result.diagnostics), []);
  const code = project.modules[0]?.result.code ?? "";
  // An all-integer enum says `integer` and lists the integers; a singleton
  // member lists the one wire value rather than the source member name, which
  // is what actually crosses the wire.
  assert.match(code, /"protocol":\{"type":"integer","enum":\[1,2\]\}/u);
  assert.match(code, /"pinned":\{"type":"integer","enum":\[2\]\}/u);
  assert.match(code, /"visibility":\{"type":"string","enum":\["published","restricted"\]\}/u);
  assert.match(code, /"tag":\{"type":"string","enum":\["published"\]\}/u);
});

test("a data record named status remains a JSON OpenAPI response", async () => {
  const path = join(tmpdir(), "velar-node-response-status-field.vel");
  const project = await compileProject(path, new Map([[path, `
server api:
    @get(p"/health" as path) => {status: "ready", service: "openvoxel"}
`.trimStart()]]), {extensions: [velarNodeCompilerExtension]});
  assert.deepEqual(project.failures, []);
  assert.deepEqual(project.modules.flatMap((module) => module.result.diagnostics), []);
  const code = project.modules[0]?.result.code ?? "";
  assert.match(code, /responseSchema:\{"type":"object","properties":\{"status":\{"type":"string"\},"service":\{"type":"string"\}\},"required":\["status","service"\],"additionalProperties":false\},responseContentTypes:\["application\/json"\]/u);
  assert.doesNotMatch(code, /responseContentTypes:\["application\/octet-stream"\]/u);
});
