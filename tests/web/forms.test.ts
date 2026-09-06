import assert from "node:assert/strict";
import test from "node:test";
import { join } from "node:path";
import { VELAR_RUNTIME_SCHEMA_VERSION } from "@velarscript/compiler/extension";
import { executeModule } from "../support/execute-module.ts";
import { standardModuleSource } from "../support/compiler-suite.ts";

test("Web records reject accessors and invalid fields before DOM or history effects", () => {
  const source = standardModuleSource("velar/web", { base: "/" }) ?? "";
  const execution = executeModule(`
let getterReads = 0;
let domCalls = 0;
let historyCalls = 0;
let frameCalls = 0;
class FakeNode {}
globalThis.Node = FakeNode;
globalThis.CharacterData = FakeNode;
// A text node's character data is now written in place, so the stand-in models
// the accessor the DOM writes it through instead of only its creation.
Object.defineProperty(FakeNode.prototype, "data", { configurable: true,
  get() { return this.textContent !== undefined ? this.textContent : this.value; },
  set(next) { if (this.textContent !== undefined) this.textContent = next; else this.value = next; } });
globalThis.document = {
  createElement() { domCalls += 1; return new FakeNode(); },
  createComment() { domCalls += 1; return new FakeNode(); },
  createTextNode() { domCalls += 1; return new FakeNode(); },
  querySelector() { domCalls += 1; return null; },
  body: { append() { domCalls += 1; } },
};
globalThis.location = { pathname: "/", search: "", hash: "", href: "https://example.test/", origin: "https://example.test" };
globalThis.history = {
  pushState() { historyCalls += 1; },
  replaceState() { historyCalls += 1; },
  back() { historyCalls += 1; },
  forward() { historyCalls += 1; },
};
globalThis.dispatchEvent = () => true;
globalThis.PopStateEvent = class {};
globalThis.requestAnimationFrame = () => { frameCalls += 1; };
// D90 R4-a: the four framework components read their props inside the observer
// that consumes them, so a probe that constructs one installs the runtime an
// application installs. Nothing here is reactive, so a tracked run records
// nothing.
globalThis[Symbol.for("velar.runtime.v1")] = {
  version: ${JSON.stringify(VELAR_RUNTIME_SCHEMA_VERSION)},
  toRaw: (value) => value,
  collectionRead: (target, key, value) => value,
  runTracked: (observer, run) => run(),
  schedule: (observer) => observer.run(),
  cleanupObserver: () => {},
};
${source}
const accessor = (key, value) => Object.defineProperty({}, key, { enumerable: true, get() { getterReads += 1; return value; } });
const routeAccessor = Object.defineProperty({ component: () => null }, "path", { enumerable: true, get() { getterReads += 1; return "/"; } });
const operations = [
  () => navigate("/", accessor("replace", true)),
  () => navigate("/", { unknown: true }),
  () => navigate("/", { scroll: "yes" }),
  () => Head({ title: 42 }),
  () => Head({ title: "Title", language: "not a tag!" }),
  () => Router({ routes: new Array(1) }),
  () => Router({ routes: [routeAccessor] }),
  () => Router({ routes: [], fallback: "missing" }),
  () => Link({ to: 42 }),
  () => Link({ to: "/", replace: 1 }),
  () => NavLink({ to: "/", exact: 1 }),
  () => announce(42),
];
const failures = [];
for (const operation of operations) {
  try { operation(); failures.push("accepted"); }
  catch (error) { failures.push(error.name); }
}
console.log(failures.join(","));
console.log([getterReads, domCalls, historyCalls, frameCalls].join(":"));
// A component prop is not one of those records. D90 R4-a: the emitted
// instantiation path hands every component a live props store whose fields are
// tracked getters, so an accessor field is the shape these four are built for,
// and reading it is what subscribes them to the state behind it. A route entry
// inside the routes List is still an ordinary data record -- 'routeAccessor'
// above is refused -- and navigate's options record still is too.
const live = [];
for (const operation of [() => Head(accessor("title", "Title")), () => Link(accessor("to", "/"))]) {
  try { operation(); live.push("accepted"); }
  catch (error) { live.push(error.name); }
}
console.log(live.join(",") + ":" + getterReads);
`);
  assert.equal(execution.status, 0, String(execution.stderr));
  // Three reads for two components: Head reads its record once, inside its
  // observer, and Link checks the record's shape once before reading the target
  // inside its own. Behind a real props store both of Link's reads answer from
  // the same cached derived value, so the author's prop expression still runs
  // exactly once -- tests/hardening-closeout-live-props.test.ts counts that.
  assert.equal(execution.stdout, `${new Array(12).fill("TypeError").join(",")}\n0:0:0:0\naccepted,accepted:3\n`);
});

test("form boundaries validate descriptors before reading or mutating a form", () => {
  const source = standardModuleSource("velar/forms") ?? "";
  const execution = executeModule(`
let getterReads = 0;
let formDataCalls = 0;
globalThis.HTMLFormElement = class {};
globalThis.FormData = class {
  constructor() { formDataCalls += 1; }
  get() { return null; }
  getAll() { return []; }
  has() { return false; }
  *[Symbol.iterator]() {}
};
${source}
const form = new HTMLFormElement();
const RuntimeType = __velarRegisterRuntimeType(Object.freeze({ is() { return true; }, parse(value) { return value; } }));
const typeAccessor = Object.defineProperty({ is() { return true; } }, "parse", { enumerable: true, get() { getterReads += 1; return value => value; } });
const fieldsAccessor = [];
Object.defineProperty(fieldsAccessor, 0, { enumerable: true, get() { getterReads += 1; return { name: "title", kind: "string", optional: false }; } });
fieldsAccessor.length = 1;
const fieldAccessor = Object.defineProperty({ kind: "string", optional: false }, "name", { enumerable: true, get() { getterReads += 1; return "title"; } });
const operations = [
  () => fieldValue(form, 42),
  () => textValue(form, "title", 42),
  () => checkedValue(form, 42),
  () => read(form, typeAccessor, []),
  () => read(form, RuntimeType, fieldsAccessor),
  () => read(form, RuntimeType, [fieldAccessor]),
  () => read(form, RuntimeType, [{ name: "title", kind: "object", optional: false }]),
  () => setError(form, "title", 42),
  () => setPending(form, "yes"),
];
const failures = [];
for (const operation of operations) {
  try { operation(); failures.push("accepted"); }
  catch (error) { failures.push(error.name); }
}
console.log(failures.join(","));
console.log(getterReads + ":" + formDataCalls);
`);
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, `${new Array(9).fill("TypeError").join(",")}\n0:0\n`);
});

test("form value extraction retains its initialization-time WebIDL host", () => {
  const source = standardModuleSource("velar/forms") ?? "";
  const execution = executeModule(`const HostMap = globalThis.Map;
const HostArray = globalThis.Array;
const hostMapGet = Object.getOwnPropertyDescriptor(HostMap.prototype, "get").value;
const hostArrayJoin = Object.getOwnPropertyDescriptor(HostArray.prototype, "join").value;
const hostReflectApply = Object.getOwnPropertyDescriptor(Reflect, "apply").value;
let ambientReads = 0;
let hostConstructions = 0;
globalThis.HTMLFormElement = class {};
globalThis.FormData = class {
  constructor() { hostConstructions += 1; }
  get(name) { return name === "title" ? "ready" : null; }
  getAll(name) { return name === "tags" ? ["one", "two"] : []; }
  has(name) { return name === "enabled"; }
  forEach(callback) {
    callback("ready", "title");
    callback("one", "tags");
    callback("two", "tags");
    callback("on", "enabled");
  }
};
const HostHTMLFormElement = globalThis.HTMLFormElement;
const HostFormData = globalThis.FormData;
${source}
const poison = () => { ambientReads += 1; throw new Error("ambient form host invoked"); };
Object.defineProperty(HostHTMLFormElement, Symbol.hasInstance, { configurable: true, value: poison });
for (const name of ["get", "getAll", "has", "forEach"]) {
  Object.defineProperty(HostFormData.prototype, name, { configurable: true, value: poison });
}
Object.defineProperty(globalThis, "HTMLFormElement", { configurable: true, value: class {} });
Object.defineProperty(globalThis, "FormData", { configurable: true, value: class { constructor() { poison(); } } });
const form = new HostHTMLFormElement();
console.log(fieldValue(form, "title"));
console.log(checkedValue(form, "enabled"));
console.log(hostReflectApply(hostArrayJoin, fieldValues(form, "tags"), [","]));
const submitted = values(form);
console.log(hostReflectApply(hostMapGet, submitted, ["title"]));
console.log(hostReflectApply(hostArrayJoin, hostReflectApply(hostMapGet, submitted, ["tags"]), [","]));
const Result = __velarRegisterRuntimeType(Object.freeze({ is() { return true; }, parse(value) { return value; } }));
const parsed = read(form, Result, [
  {name: "title", kind: "string", optional: false, enumValues: null},
  {name: "enabled", kind: "bool", optional: false, enumValues: null},
  {name: "tags", kind: "strings", optional: false, enumValues: null},
]);
console.log(parsed.title + ":" + parsed.enabled + ":" + hostReflectApply(hostArrayJoin, parsed.tags, [","]));
console.log(hostConstructions + ":" + ambientReads);
`);
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, "ready\ntrue\none,two\nready\none,two\nready:true:one,two\n5:0\n");
});

test("form DOM lifecycle retains captured nodes, controls, and mutation operations", () => {
  const source = standardModuleSource("velar/forms") ?? "";
  const execution = executeModule(`const HostMap = globalThis.Map;
const HostWeakMap = globalThis.WeakMap;
const hostMapGet = Object.getOwnPropertyDescriptor(HostMap.prototype, "get").value;
const hostReflectApply = Object.getOwnPropertyDescriptor(Reflect, "apply").value;
let ambientReads = 0;
class HostNode {
  constructor() { this.textValue = ""; }
  get textContent() { return this.textValue; }
  set textContent(value) { this.textValue = value; }
}
class HostElement extends HostNode {
  constructor() { super(); this.attributes = Object.create(null); this.idValue = ""; this.owner = null; this.removed = false; }
  get id() { return this.idValue; }
  set id(value) { this.idValue = value; }
  getAttribute(name) { return Object.prototype.hasOwnProperty.call(this.attributes, name) ? this.attributes[name] : null; }
  setAttribute(name, value) { this.attributes[name] = value; }
  removeAttribute(name) { delete this.attributes[name]; }
  insertAdjacentElement(_position, element) { element.owner = this.owner; this.owner.errorNodes.push(element); return element; }
  remove() {
    this.removed = true;
    if (!this.owner) return;
    const index = this.owner.errorNodes.indexOf(this);
    if (index >= 0) this.owner.errorNodes.splice(index, 1);
  }
}
class HostHTMLElement extends HostElement {
  constructor() { super(); this.focused = false; }
  focus() { this.focused = true; }
}
class HostInput extends HostHTMLElement {
  constructor(owner, name) { super(); this.owner = owner; this.nameValue = name; this.disabledValue = false; }
  get name() { return this.nameValue; }
  get disabled() { return this.disabledValue; }
  set disabled(value) { this.disabledValue = value; }
}
class HostForm extends HostHTMLElement {
  constructor() { super(); this.controls = []; this.errorNodes = []; this.resetCount = 0; }
  get elements() { return this.controls; }
  querySelectorAll() { return this.errorNodes.slice(); }
  querySelector() { return this.errorNodes[0] ?? null; }
  reset() { this.resetCount += 1; }
}
class HostDocument {
  createElement() { return new HostHTMLElement(); }
}
globalThis.Node = HostNode;
globalThis.Element = HostElement;
globalThis.HTMLElement = HostHTMLElement;
globalThis.HTMLInputElement = HostInput;
globalThis.HTMLFormElement = HostForm;
globalThis.Document = HostDocument;
globalThis.document = new HostDocument();
globalThis.FormData = class { get() { return null; } getAll() { return []; } has() { return false; } forEach() {} };
const hostGetAttribute = HostElement.prototype.getAttribute;
${source}
const poison = () => { ambientReads += 1; throw new Error("ambient form DOM invoked"); };
for (const [prototype, names] of [
  [HostElement.prototype, ["getAttribute", "setAttribute", "removeAttribute", "insertAdjacentElement", "remove"]],
  [HostHTMLElement.prototype, ["focus"]],
  [HostForm.prototype, ["querySelectorAll", "querySelector", "reset"]],
  [HostDocument.prototype, ["createElement"]],
  [HostWeakMap.prototype, ["get", "has", "set", "delete"]],
]) {
  for (const name of names) Object.defineProperty(prototype, name, { configurable: true, value: poison });
}
for (const [prototype, name] of [
  [HostNode.prototype, "textContent"], [HostElement.prototype, "id"], [HostInput.prototype, "name"],
  [HostInput.prototype, "disabled"], [HostForm.prototype, "elements"],
]) Object.defineProperty(prototype, name, { configurable: true, get: poison, set: poison });
Object.defineProperty(globalThis, "document", { configurable: true, value: { createElement: poison } });
for (const name of ["Node", "Element", "HTMLElement", "HTMLInputElement", "HTMLFormElement", "Document"]) {
  Object.defineProperty(globalThis, name, { configurable: true, value: class {} });
}
const form = new HostForm();
const field = new HostInput(form, "title");
form.controls.push(field);
setError(form, "title", "Required");
console.log(hostReflectApply(hostGetAttribute, field, ["aria-invalid"]));
console.log(form.errorNodes.length + ":" + form.errorNodes[0].textValue);
console.log(hostReflectApply(hostMapGet, errors(form), ["title"]));
console.log(focusFirstError(form) + ":" + field.focused);
setPending(form, true);
console.log(hostReflectApply(hostGetAttribute, form, ["aria-busy"]) + ":" + field.disabledValue);
setPending(form, false);
console.log(hostReflectApply(hostGetAttribute, form, ["aria-busy"]) + ":" + field.disabledValue);
reset(form);
console.log(form.errorNodes.length + ":" + form.resetCount);
console.log(ambientReads);
`);
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, "true\n1:Required\nRequired\ntrue:true\ntrue:true\nnull:false\n0:1\n0\n");
});

test("form helpers cap submitted fields and avoid full scans for one field", () => {
  const source = standardModuleSource("velar/forms") ?? "";
  const execution = executeModule(`
let iterations = 0;
let gets = 0;
globalThis.HTMLFormElement = class { constructor() { this.elements = []; } };
globalThis.FormData = class {
  get() { gets += 1; return "first"; }
  forEach(callback) {
    for (let index = 0; index <= 100000; index += 1) {
      iterations += 1;
      callback("value", "field");
    }
  }
};
${source}
const form = new HTMLFormElement();
console.log(fieldValue(form, "field"));
console.log(iterations + ":" + gets);
try { values(form); console.log("accepted"); }
catch (error) { console.log(error.name); }
console.log(iterations + ":" + gets);
`);
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, "first\n0:1\nRangeError\n100001:1\n");
});

test("form helpers bound field names, fallback text, and returned error records", () => {
  const source = (standardModuleSource("velar/forms") ?? "").replace(
    "const maxFormTextCodeUnits = 16 * 1024 * 1024;",
    "const maxFormTextCodeUnits = 16;",
  );
  const execution = executeModule(`
globalThis.HTMLFormElement = class {
  constructor() { this.elements = []; this.errorNodes = []; }
  querySelectorAll() { return this.errorNodes; }
};
globalThis.FormData = class {
  forEach(callback) { callback("value", "x".repeat(1025)); }
  get() { return null; }
  getAll() { return []; }
  has() { return false; }
};
${source}
const form = new HTMLFormElement();
for (const operation of [
  () => values(form),
  () => textValue(form, "field", "x".repeat(17)),
  () => setError(form, "field", "x".repeat(65537)),
]) {
  try { operation(); console.log("accepted"); } catch (error) { console.log(error.name); }
}
form.errorNodes = [{ getAttribute() { return "field"; }, textContent: "x".repeat(65537) }];
try { errors(form); console.log("accepted"); } catch (error) { console.log(error.name); }
`);
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, "RangeError\nRangeError\nRangeError\nRangeError\n");
});

test("form numbers use strict decimal text and pending state preserves bool controls", () => {
  const source = standardModuleSource("velar/forms") ?? "";
  const execution = executeModule(`
let current = "";
let formMutations = 0;
globalThis.HTMLFormElement = class {
  constructor() { this.elements = []; }
  setAttribute() { formMutations += 1; }
  removeAttribute() { formMutations += 1; }
  querySelectorAll() { return []; }
};
globalThis.FormData = class {
  get() { return current; }
  getAll() { return [current]; }
  has() { return false; }
};
${source}
const form = new HTMLFormElement();
for (const text of ["42", " .5 ", "1.", "1e3", "+2", "0x10", "Infinity", "1_0", "   "]) {
  current = text;
  console.log(numberValue(form, "amount"));
}
const Amount = __velarRegisterRuntimeType(Object.freeze({ is() { return true; }, parse(value) { return value; } }));
current = "0x10";
try { read(form, Amount, [{ name: "amount", kind: "number", optional: false, enumValues: null }]); console.log("accepted"); }
catch (error) { console.log(error.name); }
let coercions = 0;
form.elements = [{ disabled: { valueOf() { coercions += 1; return false; } } }];
try { setPending(form, true); console.log("accepted"); }
catch (error) { console.log(error.name); }
console.log(coercions + ":" + formMutations);
let controlLengthReads = 0;
let disabledReads = 0;
form.elements = Object.defineProperty({ 0: {disabled: false} }, "length", { get() { controlLengthReads += 1; return 1; } });
try { setPending(form, true); console.log("accepted"); }
catch (error) { console.log(error.name); }
console.log(controlLengthReads);
const accessorField = Object.defineProperty({}, "disabled", { enumerable: true, get() { disabledReads += 1; return false; } });
form.elements = {0: accessorField, length: 1};
try { setPending(form, true); console.log("accepted"); }
catch (error) { console.log(error.name); }
console.log(disabledReads);
const field = {disabled: false};
form.elements = {0: field, length: 1};
setPending(form, true);
setPending(form, false);
console.log(field.disabled + ":" + formMutations);
`);
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, "42\n0.5\n1\n1000\n2\nnull\nnull\nnull\nnull\nTypeError\nTypeError\n0:0\nTypeError\n0\nTypeError\n0\nfalse:2\n");
});
