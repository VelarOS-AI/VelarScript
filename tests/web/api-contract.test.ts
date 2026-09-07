import assert from "node:assert/strict";
import test, { after } from "node:test";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { runInNewContext } from "node:vm";
import { compile as compileCore } from "@velarscript/compiler";
import { VELAR_FRAMEWORK_HOST_PROTOCOL_VERSION } from "@velarscript/compiler/framework-host";
import { Analyzer } from "@velarscript/compiler/extension";
import { type ValueType } from "../../packages/compiler/src/types.ts";
import { projectSignatureAt } from "../../packages/cli/src/project-semantic.ts";
import { velarNodeCompilerExtension } from "../../packages/node/src/compiler.ts";
import { VELAR_WEB_API_VERSION, VELAR_WEB_MODULES, velarWebFramework } from "../../packages/web/src/index.ts";
import { velarCompilerExtension, webModuleInterfaces, webModuleSource, webModuleSources } from "../../packages/web/src/compiler.ts";
import { velarFrameworkHost } from "../../packages/web/src/host.ts";
import { makeTemporaryDirectory, removeTemporaryDirectories } from "../support/temporary-directory.ts";
import { executeModule } from "../support/execute-module.ts";
import { unavailableOfficialParameterNames, compile, compileProject, standardModuleApi, standardModuleInterface, standardModuleSource } from "../support/compiler-suite.ts";

after(removeTemporaryDirectories);

test("0.14 Web APIs have one versioned typed compiler/runtime contract", async () => {
  const api = standardModuleApi();
  assert.equal(api.standardVersion, "0.7");
  assert.equal(api.extensions["@velarscript/node"], undefined);
  assert.equal(api.extensions["@velarscript/web"], "0.14");
  assert.deepEqual(api.modules["velar/app"], ["onError", "reportError"]);
  assert.deepEqual(api.modules["velar/config"], ["has", "keys", "publicConfig"]);
  assert.deepEqual(api.modules["velar/web"], ["Head", "Link", "NavLink", "RouteContext", "Router", "announce", "back", "currentRoute", "domId", "forward", "lazy", "navigate", "redirect", "reload", "route"]);
  assert.deepEqual(api.modules["velar/forms"], ["checkedValue", "clearError", "clearErrors", "errors", "fieldValue", "fieldValues", "focusFirstError", "numberValue", "read", "reset", "setError", "setPending", "textValue", "values"]);
  assert.deepEqual(api.modules["velar/http"], ["HttpAbortError", "HttpResponseError", "HttpTransportError", "HttpTransportPhase", "formBody", "http"]);
  assert.deepEqual(api.modules["velar/storage"], ["StorageQuotaError", "StorageTransactionError", "StorageUpgradeError", "database", "session", "storage"]);
  assert.deepEqual(api.modules["velar/browser"], ["after", "blur", "capturePointer", "clipboardText", "closeDialog", "dialogResult", "environment", "every", "focus", "frame", "location", "measure", "media", "open", "readClipboardText", "releasePointer", "scrollElementTo", "scrollIntoView", "scrollMetrics", "scrollTo", "setClipboardText", "setTextSelection", "showDialog", "textSelection", "watchIntersection", "watchMedia", "watchOnline", "watchVisibility", "writeClipboardText"]);
  assert.deepEqual(api.modules["velar/files"], ["download", "pick", "readDataUrl", "readText"]);
  assert.deepEqual(api.modules["velar/realtime"], ["RealtimeClient", "RealtimeClientFailureAction", "RealtimeClientState", "RealtimeCodec", "RealtimeFailure", "RealtimeOpen", "RealtimeUnavailableError", "eventStream", "realtimeClient"]);
  assert.deepEqual(api.modules["velar/test"], ["expect"]);
  assert.deepEqual(api.modules["velar/web-test"], ["browser", "localStorage", "network", "sessionStorage"]);
  const browserTestController = webModuleInterfaces.get("velar/web-test")?.exports.get("browser");
  assert.equal(browserTestController?.kind, "object");
  if (browserTestController?.kind === "object") {
    assert.deepEqual([...browserTestController.fields.keys()].sort(), [
      "animation", "attribute", "box", "click", "count", "currentPath", "fill", "measureClick", "measureFill", "measurePress", "namespace", "open", "press", "reload", "scroll", "select", "style", "text", "timings", "viewport", "visible", "waitFor", "waitForText",
    ]);
  }
  const webRuntime = standardModuleSource("velar/web", { base: "/studio/" }) ?? "";
  assert.match(webRuntime, /const appBase = "\/studio\/"/u);
  assert.doesNotMatch(webRuntime, /__VELAR_WEB_BASE__/u);
  const routeContextExecution = executeModule(`${webRuntime}
import { runInNewContext } from "node:vm";
const params = runInNewContext('class HostileMap extends Map { get size() { throw new Error("size override") } entries() { throw new Error("entries override") } }; new HostileMap([["id", "7"]])');
console.log(RouteContext.is({ path: "/items/7", params, query: new Map(), hash: "" }));
let getterReads = 0;
const accessor = Object.defineProperty({ params: new Map(), query: new Map(), hash: "" }, "path", { enumerable: true, get() { getterReads += 1; return "/"; } });
console.log(RouteContext.is(accessor));
console.log(RouteContext.is({ path: "/", params: new Map([["id", "x".repeat(2 * 1024 * 1024 + 1)]]), query: new Map(), hash: "" }));
console.log(getterReads);
`);
  assert.equal(routeContextExecution.status, 0, String(routeContextExecution.stderr));
  assert.equal(routeContextExecution.stdout, "true\nfalse\nfalse\n0\n");
  const configRuntime = standardModuleSource("velar/config", { base: "/", publicConfig: { apiBase: "https://api.example.com" } }) ?? "";
  assert.match(configRuntime, /const source = \{"apiBase":"https:\/\/api\.example\.com"\}/u);
  assert.doesNotMatch(configRuntime, /__VELAR_PUBLIC_CONFIG__/u);

  const directory = await makeTemporaryDirectory("velar-web-api-");
  const entry = join(directory, "main.vel");
  await writeFile(entry, `
import {Head, RouteContext, Router, Link, NavLink, announce, back, currentRoute, domId, forward, navigate, redirect, reload, route} from "velar/web"
import {checkedValue, clearError, clearErrors, errors, fieldValue, fieldValues, focusFirstError, numberValue, read, reset, setError, setPending, textValue, values} from "velar/forms"
import {HttpAbortError, formBody, http} from "velar/http"
import {database, session, storage} from "velar/storage"
import {after, blur, capturePointer, clipboardText, closeDialog, dialogResult, environment, every, focus, frame, location as browserLocation, measure, media, releasePointer, scrollElementTo, scrollIntoView, scrollMetrics, setClipboardText, setTextSelection, showDialog, textSelection, watchMedia, watchOnline, watchVisibility} from "velar/browser"
import {download, pick} from "velar/files"
import {eventStream} from "velar/realtime"
import {onError, reportError} from "velar/app"
import {has as hasConfig, keys as configKeys, publicConfig} from "velar/config"

type Item:
    name: string

type AppSettings:
    apiBase: string

enum FormMode:
    create
    update

type FormDraft:
    name: string
    count: number?
    selected: bool
    labels: List<string>
    mode: FormMode

component Missing:
    return <main>Missing</main>

component ItemPage(route: RouteContext):
    return <main>{route.params.get("id") ?? "missing"}</main>

component App:
    let form: Element? = null
    let dialog: DialogElement? = null
    let editor: TextAreaElement? = null
    const request = http.request("GET", "/api/items", {timeout: 100})
    const abortError = HttpAbortError("cancelled")
    const known = storage.has("items")
    const keys = storage.keys()
    const routeInfo = currentRoute()
    const browserInfo = browserLocation()
    const browserEnvironment = environment()
    const dark = media("(prefers-color-scheme: dark)")
    const headingId = domId("heading")

    def compose(event: CompositionEvent):
        print(event.data)

    def paste(event: ClipboardEvent):
        event.preventDefault()
        print(clipboardText(event))

    def copy(event: ClipboardEvent):
        event.preventDefault()
        setClipboardText(event, "copied")

    def inspect():
        if form != null:
            const currentForm = form
            const typed = read(currentForm, FormDraft)
            const data = values(currentForm)
            const name = fieldValue(currentForm, "name")
            const title = textValue(currentForm, "name", "Untitled")
            const count = numberValue(currentForm, "count")
            const selected = checkedValue(currentForm, "selected")
            const labels = fieldValues(currentForm, "label")
            setError(currentForm, "name", "Required")
            const currentErrors = errors(currentForm)
            focusFirstError(currentForm)
            setPending(currentForm, true)
            setPending(currentForm, false)
            reset(currentForm)
            clearError(currentForm, "name")
            clearErrors(currentForm)
            const bounds = measure(currentForm)
            const scrolling = scrollMetrics(currentForm)
            scrollElementTo(currentForm, scrolling.x, scrolling.y)
            scrollIntoView(currentForm)
            capturePointer(currentForm, 1)
            releasePointer(currentForm, 1)
            focus(currentForm, true)
            blur(currentForm)
            announce("Checked")
        if dialog != null:
            const currentDialog = dialog
            showDialog(currentDialog)
            closeDialog(currentDialog, dialogResult(currentDialog))
        if editor != null:
            const currentEditor = editor
            const selectedText = textSelection(currentEditor)
            setTextSelection(currentEditor, selectedText.start, selectedText.end, selectedText.direction)

    return <><Head title="API" description="Typed Web" canonical="https://example.com/" robots="index,follow" image="/share.png" themeColor="#111827" language="en-US" /><form host ref={form}><input name="name" /><input name="count" type="number" /><input name="selected" type="checkbox" /><input name="labels" /><select name="mode"><option value={FormMode.create}>Create</option></select></form><textarea ref={editor} on:compositionend={compose} on:paste={paste} on:copy={copy}></textarea><dialog ref={dialog}>Confirm</dialog><Router routes={[route("/", Missing), route("/items/:id", ItemPage)]} fallback={Missing} /></>

const link = <Link to="/items" replace={true}>Items</Link>
const navLink = <NavLink to="/items" exact={true}>Items</NavLink>
const settings = publicConfig(AppSettings)
const configured = hasConfig("apiBase")
const configuredKeys = configKeys()
const stopErrors = onError(report => print(report.error.message))
reportError(Error("reported"), "manual", "contract")
const local = storage.scope("app")
const stopStorage = local.watch("item", Item, (next, previous) => print(next?.name ?? "null"))
const stored = await database("app").get("item", Item)
const stopSession = session.watch("item", Item, (next, previous) => print(previous?.name ?? "null"))
const stopMedia = watchMedia("(prefers-color-scheme: dark)", matches => print(matches))
const stopOnline = watchOnline(online => print(online))
const stopVisibility = watchVisibility(visible => print(visible))
const stopAfter = after(10ms, () => print("after"))
const stopEvery = every(10ms, () => print("every"))
const response = await http.head("/api/items").response()
const parsed = await http.get("/api/items").parse(Item)
const selected = await pick()
const upload = formBody()
upload.field("label", "items")
upload.files("attachments", selected)
if selected.size > 0:
    upload.file("primary", selected[0], "primary.txt")
const uploadNames = upload.names()
const hasUpload = upload.has("label")
upload.remove("unused")
const uploadRequest = http.post("/api/upload", {body: upload})
const nextFrame = await frame()
download("items.txt", "items")
const stream = eventStream("/events", {message: (value, id) => print(f"{id}:{value}")})
stream.close()
stopAfter()
stopEvery()
back()
forward()
navigate("/items", {scroll: false})
redirect("/items")
reload()
`.trimStart(), "utf8");
  const project = await compileProject(entry);
  assert.deepEqual(project.failures, []);
  assert.deepEqual(project.modules.flatMap((module) => module.result.diagnostics), []);
  const webApiSource = await readFile(entry, "utf8");
  const domIdCall = webApiSource.indexOf('domId("heading")') + "domId(".length;
  assert.deepEqual(projectSignatureAt(project, entry, domIdCall), {
    label: "domId(prefix: string = default) -> string",
    activeParameter: 0,
  });
  const compiled = project.modules[0]?.result;
  assert.match(compiled?.code ?? "", /http\.request/u);
  assert.match(compiled?.code ?? "", /read\(currentForm, FormDraft, \[\{"name":"name","kind":"string","optional":false\}/u);
  assert.match(compiled?.code ?? "", /"name":"mode","kind":"enum","optional":false,"enumValues":\["create","update"\]/u);
  assert.equal(compiled?.semanticIndex.symbols.find((item) => item.name === "typed")?.type, "FormDraft");
});

test("the official Web package publishes its runtime roster and CLI composes the single-owned contracts", async () => {
  assert.equal(VELAR_WEB_API_VERSION, "0.14");
  assert.equal(velarWebFramework.name, "@velarscript/web");
  assert.deepEqual([...velarWebFramework.modules], [...VELAR_WEB_MODULES]);
  assert.deepEqual([...webModuleSources.keys()].sort(), [...VELAR_WEB_MODULES].sort());
  assert.deepEqual(
    [...webModuleInterfaces.keys()].sort(),
    VELAR_WEB_MODULES.filter((source) => source !== "velar/worker").sort(),
  );
  assert.equal(webModuleInterfaces.has("velar/worker"), false);
  for (const source of VELAR_WEB_MODULES) {
    assert.ok(standardModuleInterface(source), `missing combined type contract for ${source}`);
    assert.ok(webModuleSource(source), `missing Web runtime for ${source}`);
  }
  assert.match(webModuleSource("velar/web", { base: "/framework/" }) ?? "", /const appBase = "\/framework\/"/u);
  assert.equal(webModuleSource("velar/collections"), null);

  const assertParameterNames = (type: Extract<ValueType, { kind: "function" | "action" | "intrinsic" }>, path: string): void => {
    assert.equal(type.parameterNames?.length, type.parameters.length, `${path} must expose stable parameter names`);
    assert.ok(type.parameterNames?.every(Boolean), `${path} must not expose an empty parameter name`);
    for (const name of type.parameterNames ?? []) assert.ok(!unavailableOfficialParameterNames.has(name), `${path} parameter '${name}' must be writable at a call site`);
  };
  const assertNamedSurface = (type: ValueType, path: string): void => {
    if (type.kind === "function" || type.kind === "action" || type.kind === "intrinsic") {
      assertParameterNames(type, path);
      assertNamedSurface(type.result, `${path} return`);
      return;
    }
    if (type.kind === "object") {
      for (const [name, field] of type.fields) assertNamedSurface(field, `${path}.${name}`);
      return;
    }
    if (type.kind === "promise") assertNamedSurface(type.value, `${path} value`);
    if (type.kind === "optional") assertNamedSurface(type.inner, `${path} value`);
    if (type.kind === "union") for (const member of type.members) assertNamedSurface(member, `${path} member`);
  };
  for (const [source, interface_] of webModuleInterfaces) {
    for (const [name, type] of interface_.exports) assertNamedSurface(type, `${source}.${name}`);
    for (const [name, info] of interface_.classes) {
      assert.equal(info.parameterNames?.length, info.parameters.length, `${source}.${name} constructor must expose stable parameter names`);
      assert.ok(info.parameterNames?.every(Boolean), `${source}.${name} constructor must not expose an empty parameter name`);
      for (const parameter of info.parameterNames ?? []) assert.ok(!unavailableOfficialParameterNames.has(parameter), `${source}.${name} constructor parameter '${parameter}' must be writable at a call site`);
    }
  }
  for (const [name, type] of velarCompilerExtension.analysis?.globals ?? []) {
    if ((type.kind === "function" || type.kind === "action" || type.kind === "intrinsic") && !(type.parameters.length === 0 && type.rest)) {
      assertParameterNames(type, `Web global ${name}`);
    }
  }

  assert.equal(VELAR_FRAMEWORK_HOST_PROTOCOL_VERSION, 3);
  assert.equal(velarFrameworkHost.id, "@velarscript/web");
  assert.equal(velarFrameworkHost.capability, "web");
  assert.equal(velarFrameworkHost.target, "browser");
  assert.equal(velarFrameworkHost.protocolVersion, VELAR_FRAMEWORK_HOST_PROTOCOL_VERSION);
  assert.equal(velarFrameworkHost.apiVersion, VELAR_WEB_API_VERSION);
  assert.equal(velarFrameworkHost.browserTests?.sourceSuffix, ".browser.test.vel");

  // D114 R1a-R1c / D115 P4: a layer is its entry module plus every collaborator
  // under the sibling directories the split puts them in, read at run time so a
  // module added later is covered without editing the call. Every pin below
  // reads a layer rather than a file for one reason: a `doesNotMatch` over a
  // file stops covering whatever leaves it, and says nothing when it does. Most
  // of these directories are the ones D115 P4 has still to create, and a
  // directory that does not exist yet reads as nothing — the entry alone, which
  // is exactly what the pin covered before.
  const compilerLayer = async (entry: string, ...directories: readonly string[]): Promise<string> => {
    const collaborators = await Promise.all(directories.map(async (directory) => {
      const names: readonly string[] = await readdir(resolve(directory), { recursive: true }).catch(() => []);
      return Promise.all(names.filter((name) => name.endsWith(".ts")).map((name) => readFile(resolve(directory, name), "utf8")));
    }));
    return [await readFile(resolve(entry), "utf8"), ...collaborators.flat()].join("\n");
  };
  const cliStandardModules = await compilerLayer("packages/cli/src/standard-modules.ts", "packages/cli/src/standard-modules");
  const nodeCompiler = await compilerLayer("packages/node/src/compiler.ts", "packages/node/src/modules");
  assert.doesNotMatch(cliStandardModules, /^\s*\["velar\/(?:app|config|web|forms|http|storage|browser|files|realtime|web-test)", String\.raw/gmu);
  assert.doesNotMatch(cliStandardModules, /^\s*\["velar\/(?:app|config|web|forms|http|storage|browser|files|realtime|web-test)", moduleInterface/gmu);
  assert.doesNotMatch(cliStandardModules, /^\s*\["velar\/(?:serve|fs|env|host)", String\.raw/gmu);
  assert.doesNotMatch(cliStandardModules, /^\s*\["velar\/(?:serve|fs|env|host)", moduleInterface/gmu);
  assert.doesNotMatch(cliStandardModules, /@velarscript\/web/u);
  assert.match(cliStandardModules, /@velarscript\/node\/compiler/u);
  assert.match(cliStandardModules, /from "@velarscript\/core"/u);
  assert.match(cliStandardModules, /return extensions\.length === 0 \? \[velarNodeCompilerExtension\] : extensions/u);
  assert.match(cliStandardModules, /coreStandardModuleInterfaces\(withDefaultNode\(extensions\)\)/u);
  assert.match(cliStandardModules, /coreStandardModuleSources\(withDefaultNode\(extensions\)\)/u);
  assert.match(nodeCompiler, /id: "@velarscript\/node"/u);
  assert.match(nodeCompiler, /\["velar\/serve", moduleInterface/u);
  assert.match(nodeCompiler, /\["velar\/fs", VELAR_NODE_FS_MODULE_SOURCE\]/u); // D114 R2d: Node-owned still, a runtime file now

  const [coreParser, coreAnalyzer, coreSemantic, coreIndex, coreEmitter, webCompiler, webParser, webAnalyzer, webSemantic, webInspection, webEmitter, webEditor] = await Promise.all([
    compilerLayer("packages/compiler/src/parser.ts", "packages/compiler/src/parser"),
    compilerLayer("packages/compiler/src/analyzer.ts", "packages/compiler/src/analysis"),
    compilerLayer("packages/compiler/src/semantic.ts", "packages/compiler/src/semantic"),
    readFile(resolve("packages/compiler/src/index.ts"), "utf8"),
    compilerLayer("packages/compiler/src/emitter.ts", "packages/compiler/src/emit"),
    // The one file below that stays a file: D115 P4 R3e leaves `compiler.ts`
    // holding the frozen extension literal and nothing else, and every claim
    // made about `webCompiler` is that the literal is assembled *there*. Read
    // as a layer, those seven assertions would go on passing with the literal
    // scattered across `modules/`, which is the state they exist to refuse.
    readFile(resolve("packages/web/src/compiler.ts"), "utf8"),
    compilerLayer("packages/web/src/parser.ts", "packages/web/src/parser"),
    compilerLayer("packages/web/src/analyzer.ts", "packages/web/src/analysis"),
    compilerLayer("packages/web/src/semantic.ts", "packages/web/src/semantic"),
    compilerLayer("packages/web/src/inspection.ts", "packages/web/src/inspection"),
    compilerLayer("packages/web/src/emitter.ts", "packages/web/src/emit"),
    compilerLayer("packages/web/src/editor.ts", "packages/web/src/editor"),
  ]);
  assert.doesNotMatch(coreParser, /parse(?:Component|StateDeclaration|ComputedDeclaration|ResourceDeclaration|ActionDeclaration|WatchDeclaration|Jsx)/u);
  assert.doesNotMatch(coreEmitter, /HTML(?:Canvas|Dialog|Input|Select|TextArea)Element|instanceof Element|instanceof (?:Keyboard|Pointer|Input)?Event/u);
  assert.doesNotMatch(coreAnalyzer, /analyzeComponent|inferJsx|case "(?:web\.|http\.|storage\.|forms\.|realtime\.|config\.)/u);
  assert.doesNotMatch(coreSemantic, /case "(?:ComponentDeclaration|StateDeclaration|ComputedDeclaration|ResourceDeclaration|ActionDeclaration|WatchDeclaration|JSXElementExpression)"/u);
  assert.doesNotMatch(coreIndex, /case "(?:ComponentDeclaration|StateDeclaration|ComputedDeclaration|ResourceDeclaration|ActionDeclaration|WatchDeclaration|JSXElementExpression)"/u);
  assert.doesNotMatch(coreEmitter, /case "(?:ComponentDeclaration|StateDeclaration|ComputedDeclaration|ResourceDeclaration|ActionDeclaration|WatchDeclaration|JSXElementExpression)"/u);
  assert.match(webParser, /class VelarWebParser extends Parser/u);
  assert.match(webAnalyzer, /class VelarWebAnalyzer extends Analyzer/u);
  assert.match(webAnalyzer, /function inferWebIntrinsic/u);
  assert.match(webSemantic, /velarWebSemanticExtension/u);
  assert.match(webInspection, /velarWebInspectionExtension/u);
  assert.match(webEmitter, /visitExtensionRuntimeExpression/u);
  assert.match(webEmitter, /visitExtensionRuntimeStatement/u);
  assert.match(webCompiler, /parser: Object\.freeze/u);
  assert.match(webCompiler, /analyzer: Object\.freeze/u);
  assert.match(webCompiler, /semantic: velarWebSemanticExtension/u);
  assert.match(webCompiler, /inspection: velarWebInspectionExtension/u);
  assert.match(webCompiler, /project: velarWebProjectEditorExtension/u);
  assert.match(webCompiler, /inferIntrinsic: inferWebIntrinsic/u);
  assert.match(webCompiler, /capabilities: Object\.freeze\(\["web"\]\)/u);
  assert.match(webEditor, /export const velarWebProjectEditorExtension/u);
  assert.match(webEditor, /nativeJsxTags/u);
  assert.match(webEditor, /nativeSvgTags/u);
  assert.match(webEditor, /The JSX children prop cannot be renamed/u);

  const [hostProtocol, webHost, ...cliFrameworkHostSources] = await Promise.all([
    readFile(resolve("packages/compiler/src/framework-host.ts"), "utf8"),
    compilerLayer("packages/web/src/host.ts", "packages/web/src/host"),
    compilerLayer("packages/cli/src/config.ts", "packages/cli/src/config"),
    compilerLayer("packages/cli/src/framework-host.ts", "packages/cli/src/framework-host"),
    compilerLayer("packages/cli/src/module-assets.ts", "packages/cli/src/module-assets"),
    compilerLayer("packages/cli/src/dev-server.ts", "packages/cli/src/dev"),
    compilerLayer("packages/cli/src/production-build.ts", "packages/cli/src/production-build"),
    compilerLayer("packages/cli/src/browser-test-runner.ts", "packages/cli/src/browser-test"),
    compilerLayer("packages/cli/src/project-semantic.ts", "packages/cli/src/semantic"),
    compilerLayer("packages/cli/src/package-manager.ts", "packages/cli/src/package-manager"),
    compilerLayer("packages/cli/src/cli.ts", "packages/cli/src/commands", "packages/cli/src/build"),
  ]);
  assert.doesNotMatch(hostProtocol, /<!doctype|EventSource|Content-Security-Policy|playwright|esbuild/u);
  assert.match(webHost, /export const velarFrameworkHost/u);
  assert.match(webHost, /Content-Security-Policy/u);
  assert.match(webHost, /new EventSource/u);
  assert.match(webHost, /createWebArtifacts/u);
  assert.match(webHost, /createWebErrorDocument/u);
  for (const source of cliFrameworkHostSources) assert.doesNotMatch(source, /@velarscript\/web/u);
  const cliFrameworkHost = cliFrameworkHostSources.join("\n");
  assert.match(cliFrameworkHost, /require\.resolve\(`\$\{name\}\/host`\)/u);
  assert.match(cliFrameworkHost, /VELAR_FRAMEWORK_HOST_PROTOCOL_VERSION/u);
  assert.match(cliFrameworkHost, /createFrameworkArtifacts/u);
  assert.doesNotMatch(cliFrameworkHost, /jsx-tag|component-attribute|native-attribute|The JSX children prop cannot be renamed|new EventSource|<!doctype html>/u);
  assert.doesNotMatch(cliFrameworkHost, /capabilities\?\.includes\("web"\)|capabilities\.has\("web"\)/u);

  assert.throws(() => compileCore("const value = 1\n", {
    extensions: [
      { id: "example-one", capabilities: ["surface"] },
      { id: "example-two", capabilities: ["surface"] },
    ],
  }), /capability 'surface'.*more than one owner/u);
  assert.throws(() => compileCore("const value = 1\n", {
    extensions: [
      { id: "example-one", analysis: { primitiveTypes: new Set(["Surface"]) } },
      { id: "example-two", analysis: { primitiveTypes: new Set(["Surface"]) } },
    ],
  }), /primitive 'Surface'.*more than one owner/u);
  assert.throws(() => compileCore("const value = 1\n", {
    extensions: [{
      id: "example-one",
      analysis: {
        primitiveTypes: new Set(["First", "Second"]),
        primitiveParents: new Map([["First", new Set(["Second"])], ["Second", new Set(["First"])]]),
      },
    }],
  }), /primitive inheritance contains a cycle/u);
  assert.throws(() => compileCore("const value = 1\n", {
    extensions: [
      { id: "example-one", analysis: { primitiveTypes: new Set(["Surface"]) } },
      { id: "example-two", analysis: { primitiveMutableFields: new Map([["Surface", new Set(["value"])]]), primitiveTypes: new Set(["Control"]) } },
    ],
  }), /cannot make fields writable on primitive 'Surface' that it does not own/u);
  assert.throws(() => compileCore("const value = 1\n", {
    extensions: [
      { id: "example-one", analysis: { globals: new Map([["surface", { kind: "number" }]]) } },
      { id: "example-two", analysis: { globals: new Map([["surface", { kind: "string" }]]) } },
    ],
  }), /global 'surface' has more than one owner/u);
  assert.throws(() => compileCore("const value = 1\n", {
    extensions: [{ id: "example-one", analysis: { globals: new Map([["print", { kind: "number" }]]) } }],
  }), /cannot replace reserved Core binding 'print'/u);
  assert.throws(() => compileCore("const value = 1\n", {
    extensions: [{ id: "example-one", analysis: { primitiveTypes: new Set(["string"]) } }],
  }), /cannot replace Core primitive 'string'/u);
});

test("fixed Web APIs share the language named-argument ABI", async () => {
  const directory = await makeTemporaryDirectory("velar-named-web-api-");
  const entry = join(directory, "main.vel");
  await writeFile(entry, `
import {publicConfig} from "velar/config"
import {route, navigate} from "velar/web"
import {http, HttpAbortError, HttpResponseError} from "velar/http"
import {storage, database} from "velar/storage"
import {textValue} from "velar/forms"
import {scrollTo} from "velar/browser"
import {connect} from "velar/websocket"

type User:
    name: string

type BinaryPayload:
    data: Blob

component Page:
    return <main>Page</main>

def markText(label: string, value: string) -> string:
    return value

def markNumber(label: string, value: number) -> number:
    return value

def readName(form: Element) -> string:
    return textValue(fallback="", name="name", form=form)

def canvasContext(canvas: CanvasElement) -> unknown:
    return canvas.getContext(kind="2d")

def useElement(element: Element):
    element.focus()

def usePrimitiveSubtypes(input: InputElement, keyboard: KeyboardEvent):
    useElement(input)
    const event: Event = keyboard

async def prepare():
    const config = publicConfig(target=User)
    const itemRoute = route(view=Page, path="/items")
    navigate(options={scroll: false}, to=itemRoute.path)
    const request = http.get(options={timeout: markNumber("options", 10)}, url=markText("url", "/api/items"))
    const binary: Blob = await request.blob()
    const payload: BinaryPayload = {data: binary}
    const checked = BinaryPayload.parse(payload)
    const upload = http.post(url="/api/copy", options={body: binary})
    const loaded: User? = storage.get(maxBytes=1024, target=User, key="current")
    const fallback: User = storage.get(maxBytes=1024, fallback={name: "Ada"}, target=User, key="fallback")
    storage.set(maxBytes=1024, value=fallback, key="current")
    const stop = storage.watch(maxBytes=1024, callback=(next, previous) => print(next), target=User, key="current")
    stop()
    const records = database(name="users")
    const pending: Promise<User?> = records.get(maxBytes=1024, target=User, key="current")
    await records.set(maxBytes=1024, value=fallback, key="current")
    scrollTo(behavior="smooth", y=20, x=10)
    using live = await connect(options={timeout: 5s}, url="wss://example.com/events")
    await live.send(message="ping")
    await live.send(message=Json.stringify({name: loaded?.name ?? config.name}))
    await live.close(reason="done", code=1000)
    const aborted = HttpAbortError(reason="cancelled")
    const failed = HttpResponseError(body=null, url="/api/items", status=500, message=aborted.message)
`.trimStart(), "utf8");

  const project = await compileProject(entry);
  assert.deepEqual(project.failures, []);
  const diagnostics = project.modules.flatMap((module) => module.result.diagnostics);
  assert.deepEqual(diagnostics, []);
  const code = project.modules[0]?.result.code ?? "";
  assert.ok(code.indexOf('markNumber("options", 10)') < code.indexOf('markText("url", "/api/items")'), code);
  const symbols = project.modules[0]?.result.semanticIndex.symbols ?? [];
  assert.match(symbols.find((symbol) => symbol.name === "itemRoute")?.type ?? "", /component: component Page/u);
  assert.match(symbols.find((symbol) => symbol.name === "request")?.type ?? "", /blob: \(\) -> Promise<Blob>/u);
  assert.match(code, /typeof Blob !== "undefined".*instanceof Blob/u);
  assert.doesNotMatch(code, /Blob\.is/u);

  const invalidPath = join(directory, "invalid.vel");
  await writeFile(invalidPath, `
import {http} from "velar/http"
import {scrollTo} from "velar/browser"

http.get(path="/items")
scrollTo(left=10, top=20)
mount(<main>invalid</main>, 42)

async def inspectBlob():
    const binary = await http.get("/data").blob()
    print(binary.size)

const forged: Blob = {}
const forgedElement: Element = {focus: () => null, remove: () => null}

def inspectCanvas(canvas: CanvasElement):
    canvas.getContext(kind="2d").fillRect(0, 0, 1, 1)
`.trimStart(), "utf8");
  const invalid = await compileProject(invalidPath);
  const messages = invalid.modules.flatMap((module) => module.result.diagnostics).map((item) => item.message).join("\n");
  assert.match(messages, /Unknown named argument 'path'/u);
  assert.match(messages, /Unknown named argument 'left'/u);
  assert.match(messages, /Unknown named argument 'top'/u);
  assert.match(messages, /Cannot assign number to string \| Element/u);
  assert.match(messages, /Type 'Blob' has no field 'size'/u);
  assert.match(messages, /Cannot assign \{\s*\} to Blob/u);
  assert.match(messages, /Cannot assign .* to Element/u);
  assert.match(messages, /Cannot access 'fillRect' on unknown without validation/u);
});

test("Web host values are opaque and expose only intentional writable fields", async () => {
  const directory = await makeTemporaryDirectory("velar-opaque-web-values-");
  const entry = join(directory, "main.vel");
  await writeFile(entry, `
import {pick, readText} from "velar/files"

type Attachment:
    file: File

async def inspect():
    const selected = await pick()
    if selected.size > 0:
        const file = selected[0]
        print(file.name)
        print(file.size)
        await readText(file)
        const checked = Attachment.parse({file})

def edit(input: InputElement, canvas: CanvasElement):
    input.value = "ready"
    input.checked = true
    canvas.width = 640
    canvas.height = 480
`.trimStart(), "utf8");
  const project = await compileProject(entry);
  assert.deepEqual(project.failures, []);
  assert.deepEqual(project.modules.flatMap((module) => module.result.diagnostics), []);
  const valid = project.modules[0]!.result;
  assert.match(valid.semanticIndex.symbols.find((symbol) => symbol.name === "selected")?.type ?? "", /List<File>/u);
  assert.match(valid.code ?? "", /function __velarFileTypeIs/u);
  assert.match(valid.code ?? "", /WeakMap\.prototype\.has\.call/u);

  const forgedRuntime = compile(`
type Attachment:
    file: File

const forged = Attachment.parse({file: {name: "fake.txt", size: 1, type: "text/plain", modified: 0}})
`.trimStart());
  assert.deepEqual(forgedRuntime.diagnostics, []);
  const execution = executeModule(forgedRuntime.code ?? "");
  assert.notEqual(execution.status, 0);
  assert.match(String(execution.stderr), /Value does not match Attachment/u);

  const invalid = compile(`
const forged: File = {name: "fake.txt", size: 1, type: "text/plain", modified: 0}

def overwrite(file: File, event: KeyboardEvent, element: Element, input: InputElement):
    file.name = "changed.txt"
    event.key = "Enter"
    element.focus = () => null
    input.remove = () => null
`.trimStart());
  const messages = invalid.diagnostics.map((item) => item.message).join("\n");
  assert.match(messages, /Cannot assign .* to File/u);
  assert.match(messages, /Cannot assign to read-only member 'name'/u);
  assert.match(messages, /Cannot assign to read-only member 'key'/u);
  assert.match(messages, /Cannot assign to read-only member 'focus'/u);
  assert.match(messages, /Cannot assign to read-only member 'remove'/u);
});
